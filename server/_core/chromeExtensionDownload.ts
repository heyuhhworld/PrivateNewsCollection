import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import path from "path";
import type { Express, Request, Response } from "express";

const EXT_DIR = path.join(process.cwd(), "chrome-extension", "ipms-news-importer");
const ZIP_CACHE = path.join(
  process.cwd(),
  "node_modules",
  ".cache",
  "ipms-news-importer.zip"
);

function zipNeedsRebuild(): boolean {
  if (!existsSync(ZIP_CACHE)) return true;
  if (!existsSync(EXT_DIR)) return false;
  try {
    const zipMtime = statSync(ZIP_CACHE).mtimeMs;
    const { readdirSync } = require("fs") as typeof import("fs");
    const files = readdirSync(EXT_DIR);
    for (const f of files) {
      if (statSync(path.join(EXT_DIR, f)).mtimeMs > zipMtime) return true;
    }
    return statSync(EXT_DIR).mtimeMs > zipMtime;
  } catch {
    return true;
  }
}

function rebuildZipQuiet(): void {
  mkdirSync(path.dirname(ZIP_CACHE), { recursive: true });
  execFileSync("zip", ["-r", "-q", ZIP_CACHE, "ipms-news-importer"], {
    cwd: path.join(process.cwd(), "chrome-extension"),
    stdio: "ignore",
    env: process.env,
  });
}

/**
 * GET /api/chrome-extension/bundle.zip — 供用户在浏览器中下载后解压，再在 Chrome「加载已解压的扩展程序」。
 */
export function registerChromeExtensionDownload(app: Express) {
  app.get("/api/chrome-extension/bundle.zip", (_req: Request, res: Response) => {
    if (!existsSync(EXT_DIR)) {
      res.status(404).json({ error: "未找到 chrome-extension/ipms-news-importer 目录" });
      return;
    }
    try {
      if (zipNeedsRebuild()) {
        rebuildZipQuiet();
      }
    } catch (e) {
      console.error("[chrome-extension] zip 打包失败:", e);
      res.status(500).json({
        error:
          "无法生成 ZIP。请在本机安装 zip 命令，或从仓库目录 chrome-extension/ipms-news-importer 手动压缩。",
      });
      return;
    }
    if (!existsSync(ZIP_CACHE)) {
      res.status(500).json({ error: "ZIP 未生成" });
      return;
    }
    const ts = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .slice(0, 15);
    const filename = `ipms-news-importer-${ts}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.setHeader("Cache-Control", "public, max-age=300");
    const stream = createReadStream(ZIP_CACHE);
    stream.on("error", (err) => {
      console.error("[chrome-extension] read zip:", err);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  });
}
