import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDevBypassUser } from "./devAuth";
import { ENV } from "./env";
import { invokeLLM } from "./llm";
import { sdk } from "./sdk";
import type { User } from "../../drizzle/schema";
import {
  buildUniqueStoredUploadFilename,
  extractTextFromFile,
  normalizeExtension,
} from "./extractDocument";
import { getDb } from "../db";
import { newsArticles } from "../../drizzle/schema";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "news");
const MAX_SIZE_BYTES = 25 * 1024 * 1024;

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDir();
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    try {
      cb(null, buildUniqueStoredUploadFilename(file.originalname, UPLOAD_DIR));
    } catch {
      const ext = normalizeExtension(file.originalname) || ".bin";
      cb(null, `${nanoid(16)}${ext}`);
    }
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "application/pdf" ||
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (!ok) {
      cb(new Error("仅支持 PDF 或 Word（.docx）"));
      return;
    }
    cb(null, true);
  },
});

async function analyzeDocumentWithLlm(
  extractedText: string,
  originalName: string
) {
  const snippet = buildSegmentedSnippet(extractedText, 28_000);
  const llmResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a professional financial analyst. Read the uploaded document text and produce structured metadata and Chinese summaries for investment professionals.`,
      },
      {
        role: "user",
        content: `Document filename: ${originalName}

Extracted text (may be truncated):
${snippet}

Return a JSON object with ALL fields:
- title: concise English title for the document
- summary: 2-3 sentences IN CHINESE
- keyInsights: 3-5 items with "label" (short Chinese, max 8 chars) and "value" (1-2 Chinese sentences), factual from the document only. Use direct takeaway tone; do NOT use wording like "文中指出/报告提到/数据显示".
- content: 6-8 paragraphs IN CHINESE analyzing the document for PE/VC/alternative investment readers
- sections: 4-6 sections with "heading" and "body" (Chinese), driven by actual content. Keep the same concise/direct tone as keyInsights; avoid source-referencing phrases like "文中指出/报告显示/作者认为".
- author: author or institution if inferable, else null
- publishedAt: best-guess document date as ISO date string (YYYY-MM-DD); if unclear use ${new Date().toISOString().split("T")[0]}
- effectivePeriodLabel: ONE short line IN CHINESE describing the time period this document's information is relevant for (e.g. "主要涉及 2024Q2 至 2025 年的市场数据" or "未标明具体时效，内容偏方法论"). Required.
- strategy: one of ["私募股权","风险投资","房地产","信贷","基础设施","对冲基金","母基金","并购","成长股权"] or null
- region: one of ["全球","亚太","北美","欧洲","中国","东南亚","中东","其他"] or null
- tags: 3-5 Chinese tags`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "manual_doc",
        strict: true,
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            keyInsights: {
              type: "array",
              minItems: 3,
              maxItems: 6,
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                },
                required: ["label", "value"],
                additionalProperties: false,
              },
            },
            content: { type: "string" },
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  heading: { type: "string" },
                  body: { type: "string" },
                },
                required: ["heading", "body"],
                additionalProperties: false,
              },
            },
            author: { type: ["string", "null"] },
            publishedAt: { type: "string" },
            effectivePeriodLabel: { type: "string" },
            strategy: { type: ["string", "null"] },
            region: { type: ["string", "null"] },
            tags: { type: "array", items: { type: "string" } },
          },
          required: [
            "title",
            "summary",
            "keyInsights",
            "content",
            "sections",
            "author",
            "publishedAt",
            "effectivePeriodLabel",
            "strategy",
            "region",
            "tags",
          ],
          additionalProperties: false,
        },
      },
    },
  } as any);

  const llmContent = llmResponse.choices[0]?.message?.content;
  if (!llmContent) throw new Error("LLM 返回空内容");
  return typeof llmContent === "string"
    ? JSON.parse(llmContent)
    : llmContent;
}

/**
 * 文本过大时做分段提取，避免只看开头导致信息偏差。
 * - 小文本：直接使用全文（上限）
 * - 大文本：均匀抽取多个窗口（头/中/尾），并附上段标记
 */
function buildSegmentedSnippet(text: string, totalBudget = 28_000): string {
  const normalized = (text ?? "").trim();
  if (!normalized) return "";
  if (normalized.length <= totalBudget) return normalized;

  const segmentCount: number = 6;
  const segmentBudget = Math.floor(totalBudget / segmentCount);
  const maxStart = Math.max(0, normalized.length - segmentBudget);
  const segments: string[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const ratio = segmentCount === 1 ? 0 : i / (segmentCount - 1);
    const start = Math.min(maxStart, Math.floor(maxStart * ratio));
    const end = Math.min(normalized.length, start + segmentBudget);
    const part = normalized.slice(start, end);
    if (!part) continue;
    segments.push(
      `【片段 ${i + 1}/${segmentCount} | 字符 ${start + 1}-${end}】\n${part}`
    );
  }
  return segments.join("\n\n-----\n\n");
}

function normalizeExtractErrorMessage(err: unknown): string {
  const raw = (err as { message?: unknown })?.message;
  const msg = String(raw ?? err ?? "文本提取失败");
  const low = msg.toLowerCase();
  if (
    low.includes("invalid pdf structure") ||
    low.includes("invalidpdfexception") ||
    low.includes("malformed")
  ) {
    return "PDF 文件结构异常或已损坏，暂时无法解析。请先用 PDF 阅读器“另存为/打印为 PDF”后重试，或上传 Word 版本。";
  }
  return msg;
}

function normalizeTextForDuplicateCompare(text: string): string {
  return (text ?? "")
    .replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function registerNewsUploadRoutes(app: Express) {
  app.post(
    "/api/news/upload-document",
    upload.single("file"),
    async (req: Request, res: Response) => {
      let user: User;
      if (ENV.devAuthBypass) {
        user = await getDevBypassUser();
      } else {
        try {
          user = await sdk.authenticateRequest(req);
        } catch {
          res.status(401).json({ error: "请先登录后再上传文件" });
          return;
        }
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "请选择要上传的 PDF 或 Word 文件" });
        return;
      }

      const db = await getDb();
      if (!db) {
        if (file.path) fs.unlink(file.path, () => {});
        res.status(503).json({ error: "数据库不可用" });
        return;
      }

      const ext = normalizeExtension(file.originalname);
      let extracted: string;
      let extractedLinePageMap: number[] | null = null;
      try {
        const buf = fs.readFileSync(file.path);
        const ex = await extractTextFromFile(buf, file.mimetype, ext);
        extracted = ex.text;
        extractedLinePageMap =
          ex.linePageMap && ex.linePageMap.length > 0 ? ex.linePageMap : null;
      } catch (e: any) {
        fs.unlink(file.path, () => {});
        res.status(400).json({ error: normalizeExtractErrorMessage(e) });
        return;
      }

      // Deduplicate: same original filename + same extracted document content.
      // If matched, skip LLM analysis and DB insert.
      try {
        const sameNameCandidates = await db
          .select({
            id: newsArticles.id,
            title: newsArticles.title,
            extractedText: newsArticles.extractedText,
          })
          .from(newsArticles)
          .where(eq(newsArticles.attachmentOriginalName, file.originalname));

        const currentNormalized = normalizeTextForDuplicateCompare(extracted);
        const duplicated = sameNameCandidates.find((item) => {
          const existingNormalized = normalizeTextForDuplicateCompare(
            item.extractedText ?? ""
          );
          return !!existingNormalized && existingNormalized === currentNormalized;
        });

        if (duplicated) {
          fs.unlink(file.path, () => {});
          res.json({
            success: true,
            duplicate: true,
            articleId: duplicated.id,
            title: duplicated.title,
            message: "检测到同名且内容一致的报告，已跳过重复上传",
          });
          return;
        }
      } catch (e) {
        fs.unlink(file.path, () => {});
        console.error("[upload-document][deduplicate-check]", e);
        res.status(500).json({ error: "重复校验失败，请稍后重试" });
        return;
      }

      let meta: Record<string, unknown>;
      try {
        meta = await analyzeDocumentWithLlm(extracted, file.originalname);
      } catch (e: any) {
        fs.unlink(file.path, () => {});
        res.status(500).json({ error: `内容分析失败：${e?.message ?? e}` });
        return;
      }

      const storageKey = path.basename(file.path);
      const syntheticUrl = `manual://doc/${nanoid()}`;

      try {
        const keyInsightsRaw = meta.keyInsights as
          | { label: string; value: string }[]
          | undefined;
        const keyInsights =
          Array.isArray(keyInsightsRaw) && keyInsightsRaw.length > 0
            ? keyInsightsRaw.map((x) => ({
                label: String(x.label ?? "").trim() || "要点",
                value: String(x.value ?? "").trim(),
              }))
            : [];

        await db.insert(newsArticles).values({
          source: "Manual",
          title: meta.title as string,
          summary: meta.summary as string,
          content: meta.content as string,
          keyInsights: keyInsights.length > 0 ? keyInsights : null,
          sections: meta.sections as any,
          originalUrl: syntheticUrl,
          author: (meta.author as string | null) ?? null,
          publishedAt: new Date(meta.publishedAt as string),
          strategy: meta.strategy as any,
          region: meta.region as any,
          tags: meta.tags as string[],
          isRead: false,
          recordCategory: "report",
          isHidden: false,
          uploaderUserId: user.id,
          fileUploadedAt: new Date(),
          attachmentStorageKey: storageKey,
          attachmentMime: file.mimetype,
          attachmentOriginalName: file.originalname,
          effectivePeriodLabel: meta.effectivePeriodLabel as string,
          extractedText: extracted,
          extractedLinePageMap,
        });

        const row = await db
          .select({ id: newsArticles.id })
          .from(newsArticles)
          .where(eq(newsArticles.originalUrl, syntheticUrl))
          .limit(1);
        const finalId = row[0]?.id;

        res.json({
          success: true,
          articleId: finalId,
          title: meta.title as string,
        });
      } catch (e: any) {
        fs.unlink(file.path, () => {});
        console.error("[upload-document]", e);
        res.status(500).json({ error: e?.message ?? "入库失败" });
      }
    }
  );
}
