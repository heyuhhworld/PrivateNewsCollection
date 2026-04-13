import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { getDevBypassUser } from "./devAuth";
import { ENV } from "./env";
import { invokeLLM } from "./llm";
import { scheduleArticleEmbedding } from "./articleEmbedding";
import { sdk } from "./sdk";
import type { User } from "../../drizzle/schema";
import { getDb } from "../db";
import { newsArticles } from "../../drizzle/schema";

const MAX_TEXT = 400_000;
const LLM_BUDGET = 28_000;

function buildSnippet(text: string, budget: number): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  if (t.length <= budget) return t;
  const n = 6;
  const seg = Math.floor(budget / n);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const ratio = i / (n - 1);
    const start = Math.min(Math.max(0, t.length - seg), Math.floor((t.length - seg) * ratio));
    parts.push(`【片段 ${i + 1}】\n${t.slice(start, start + seg)}`);
  }
  return parts.join("\n\n-----\n\n");
}

async function analyzeWebClipWithLlm(params: {
  title: string;
  url: string;
  text: string;
}) {
  const snippet = buildSnippet(params.text, LLM_BUDGET);
  const llmResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "用户从浏览器网页剪藏到内部资讯库。请根据正文片段生成结构化元数据（与手工上传 PDF 后同一套字段风格），事实严格来自文本；无法推断的字段用 null 或空数组。",
      },
      {
        role: "user",
        content: `页面标题: ${params.title}\n页面 URL: ${params.url}\n\n正文片段:\n${snippet}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "web_clip",
        strict: true,
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            keyInsights: {
              type: "array",
              minItems: 2,
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
  const raw = llmResponse.choices?.[0]?.message?.content;
  if (!raw) throw new Error("LLM 返回空内容");
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export function registerExtensionImportRoutes(app: Express) {
  /** 依赖应用级 express.json（已在 index 注册） */
  app.post("/api/news/import-page", async (req: Request, res: Response) => {
    let user: User;
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

    const title = String(req.body?.title ?? "").trim().slice(0, 512);
    const url = String(req.body?.url ?? "").trim().slice(0, 1024);
    const text = String(req.body?.text ?? "").trim();
    const recordCategory = req.body?.recordCategory === "report" ? "report" : "news";

    if (!title || !url) {
      res.status(400).json({ error: "缺少 title 或 url" });
      return;
    }
    if (!text || text.length < 80) {
      res.status(400).json({ error: "正文过短，请确认页面已加载完成后再导入" });
      return;
    }
    const clipped = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;

    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: "数据库不可用" });
      return;
    }

    try {
      const dup = await db
        .select({ id: newsArticles.id })
        .from(newsArticles)
        .where(eq(newsArticles.originalUrl, url))
        .limit(1);
      if (dup[0]) {
        res.json({
          success: true,
          duplicate: true,
          articleId: dup[0].id,
          message: "该 URL 已存在，跳过重复导入",
        });
        return;
      }
    } catch (e) {
      console.error("[import-page][dedupe]", e);
      res.status(500).json({ error: "重复检查失败" });
      return;
    }

    let meta: Record<string, unknown>;
    try {
      meta = await analyzeWebClipWithLlm({ title, url, text: clipped });
    } catch (e: unknown) {
      res.status(500).json({ error: `内容分析失败：${e instanceof Error ? e.message : String(e)}` });
      return;
    }

    const keyInsightsRaw = meta.keyInsights as { label: string; value: string }[] | undefined;
    const keyInsights =
      Array.isArray(keyInsightsRaw) && keyInsightsRaw.length > 0
        ? keyInsightsRaw.map((x) => ({
            label: String(x.label ?? "").trim() || "要点",
            value: String(x.value ?? "").trim(),
          }))
        : [];

    try {
      await db.insert(newsArticles).values({
        source: "ChromeExtension",
        title: (meta.title as string) || title,
        summary: meta.summary as string,
        content: meta.content as string,
        keyInsights: keyInsights.length > 0 ? keyInsights : null,
        sections: meta.sections as any,
        originalUrl: url,
        author: (meta.author as string | null) ?? null,
        publishedAt: new Date((meta.publishedAt as string) || new Date().toISOString().slice(0, 10)),
        strategy: meta.strategy as any,
        region: meta.region as any,
        tags: meta.tags as string[],
        isRead: false,
        recordCategory,
        isHidden: false,
        uploaderUserId: user.id,
        fileUploadedAt: new Date(),
        effectivePeriodLabel: meta.effectivePeriodLabel as string,
        extractedText: clipped,
        extractedLinePageMap: null,
      });

      const row = await db
        .select({ id: newsArticles.id })
        .from(newsArticles)
        .where(eq(newsArticles.originalUrl, url))
        .limit(1);
      const finalId = row[0]?.id;
      if (finalId != null) scheduleArticleEmbedding(finalId);

      res.json({
        success: true,
        articleId: finalId,
        title: (meta.title as string) || title,
      });
    } catch (e: unknown) {
      console.error("[import-page]", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "入库失败" });
    }
  });
}
