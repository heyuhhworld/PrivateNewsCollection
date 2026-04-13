import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { getDevBypassUser } from "./devAuth";
import { ENV } from "./env";
import { sdk } from "./sdk";
import type { User } from "../../drizzle/schema";
import {
  getDb,
  getNewsArticleById,
  insertReadingEvent,
  insertReadingImage,
} from "../db";
import { scheduleImageAnalysis } from "./imageAnalysis";

const DIR = path.join(process.cwd(), "uploads", "news", "reading-images");
const MAX_BYTES = 8 * 1024 * 1024;

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDir();
    cb(null, DIR);
  },
  filename: (_req, _file, cb) => {
    cb(null, `${nanoid(16)}.png`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "image/png" || file.mimetype === "image/jpeg") {
      cb(null, true);
      return;
    }
    cb(new Error("仅支持 PNG / JPEG"));
  },
});

export function registerReadingImageUploadRoutes(app: Express) {
  app.post(
    "/api/news/reading-image",
    upload.single("file"),
    async (req: Request, res: Response) => {
      let user: User | null = null;
      if (ENV.devAuthBypass) {
        user = await getDevBypassUser();
      } else {
        try {
          user = await sdk.authenticateRequest(req);
        } catch {
          res.status(401).json({ error: "请先登录" });
          return;
        }
      }

      const articleId = parseInt(String(req.body.articleId ?? ""), 10);
      if (!articleId || articleId < 1) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        res.status(400).json({ error: "articleId 无效" });
        return;
      }

      const art = await getNewsArticleById(articleId);
      if (!art || art.isHidden) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        res.status(404).json({ error: "资讯不存在" });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "请选择图片文件" });
        return;
      }

      const db = await getDb();
      if (!db) {
        fs.unlink(file.path, () => {});
        res.status(503).json({ error: "数据库不可用" });
        return;
      }

      const relKey = path.relative(path.join(process.cwd(), "uploads", "news"), file.path);
      const storageKey = relKey.replace(/\\/g, "/");
      const sourcePage = req.body.sourcePage
        ? parseInt(String(req.body.sourcePage), 10)
        : null;
      const caption = String(req.body.caption ?? "").trim() || null;

      try {
        const id = await insertReadingImage({
          articleId,
          createdByUserId: user?.id ?? null,
          sessionId: String(req.body.sessionId ?? "").trim() || null,
          storageKey,
          caption,
          sourcePage: sourcePage && sourcePage > 0 ? sourcePage : null,
          sourceRect: null,
        });
        await insertReadingEvent({
          userId: user?.id ?? null,
          sessionId: String(req.body.sessionId ?? "").trim() || null,
          articleId,
          recordCategory: art.recordCategory ?? null,
          eventType: "reading_image_save",
          payload: { storageKey },
        });
        if (id) scheduleImageAnalysis(id);
        res.json({ success: true, id, url: `/uploads/news/${storageKey}` });
      } catch (e: unknown) {
        fs.unlink(file.path, () => {});
        console.error("[reading-image]", e);
        res.status(500).json({ error: "保存失败" });
      }
    }
  );
}
