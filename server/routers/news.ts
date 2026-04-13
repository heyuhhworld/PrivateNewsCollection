import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import {
  normalizeNewsRegion,
  normalizeNewsStrategy,
  sanitizeNewsTags,
} from "../_core/articleMetaNormalize";
import {
  extractArticleFromHtml,
  extractPublishedDateFromHtml,
  parseLlmPublishedAtField,
  resolveImportPublishedAt,
} from "../_core/articleExtract";
import { fetchHtmlForArticleImport } from "../_core/fetchImportUrl";
import { getImportSessionStatus } from "../_core/importSessionStorage";
import { inferArticleImportSourceFromUrl } from "../_core/importSourceFromUrl";
import { invokeLLM } from "../_core/llm";
import { scheduleArticleEmbedding, buildArticleEmbeddingInput } from "../_core/articleEmbedding";
import { scheduleEntityExtraction } from "../_core/entityExtraction";
import { buildTagCorrectionContext } from "../_core/tagLearning";
import { dateRangeFromPreset, parseNewsSearchIntent } from "../_core/intentParser";
import {
  recommendByEmbeddingCentroid,
  semanticSearchArticles,
} from "../_core/semanticSearch";
import {
  getNewsArticles,
  getNewsArticleById,
  getUserById,
  markArticleAsRead,
  addBookmark,
  removeBookmark,
  getBookmarks,
  isBookmarked,
  adminListNewsArticles,
  adminSetNewsArticleHidden,
  adminSetNewsArticlesHidden,
  adminDeleteNewsArticle,
  adminDeleteNewsArticles,
  recordDailyArticleView,
  getNewsArticlesByIds,
  insertTagCorrection,
  updateArticleTags,
  getArticleEntityIds,
  getEntitiesByIds,
} from "../db";
import { getDb, getDbUnavailableHint } from "../db";
import { newsArticles } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ArticleSection {
  heading: string;
  body: string;
}

// ─── Core import helper (shared by importByUrl and crawl runNow) ────────────

/** 正文过短则视为未取到有效内容（反爬/登录墙/纯前端渲染等） */
const MIN_ARTICLE_TEXT_CHARS = 120;

function isLikelyLoginWall(args: {
  source: "Preqin" | "Pitchbook";
  url: string;
  title?: string | null;
  text: string;
  html: string;
}): boolean {
  const probe = [
    args.title ?? "",
    args.text.slice(0, 1500),
    args.html.slice(0, 3000),
    args.url,
  ]
    .join(" ")
    .toLowerCase();

  const genericSignals = [
    "sign in",
    "log in",
    "login",
    "forgot password",
    "create account",
    "remember me",
    "verify you are human",
    "captcha",
  ];
  const sourceSignals =
    args.source === "Preqin"
      ? ["preqin - sign in", "pro.preqin.com/login", "continue with"]
      : ["pitchbook login", "pitchbook sign in", "account sign in"];

  const hit = [...genericSignals, ...sourceSignals].some((k) => probe.includes(k));
  if (!hit) return false;

  // 登录页通常正文信息密度很低，进一步减少误判
  const textLen = args.text.trim().length;
  const sentenceLike = (args.text.match(/[.!?。！？]/g) || []).length;
  return textLen < 3000 || sentenceLike < 8;
}

/**
 * Import a single article URL:
 * 1. Check for duplicate (by originalUrl) — skip if already exists
 * 2. Fetch page HTML（Pitchbook/Preqin 默认 Chromium 无头；其余先 HTTP，403 等再回退浏览器）
 * 3. 用 Readability 从 HTML 抽取真实正文写入 `content`（禁止用 AI 编造正文）
 * 4. 可选：LLM 仅基于正文生成摘要/标签/分类（不得编造事实）
 * 5. Insert into DB，或管理员传入 `replaceArticleId` 时原地更新该条
 */
export type ImportArticleOptions = {
  /** 登录后的 Cookie，用于 Preqin 等需登录页面抓取正文 */
  cookieHeader?: string;
  /** 管理员：按 URL 重新抓取并**原地更新**该 id（跳过「已存在 URL」校验） */
  replaceArticleId?: number;
};

export async function importSingleArticle(
  url: string,
  source: "Preqin" | "Pitchbook",
  options?: ImportArticleOptions
): Promise<{ status: "success" | "duplicate" | "failed"; title?: string; error?: string }> {
  const db = await getDb();
  if (!db) return { status: "failed", error: getDbUnavailableHint() };

  let priorPublishedAtForReplace: Date | undefined;
  if (options?.replaceArticleId) {
    const rows = await db
      .select({ id: newsArticles.id, publishedAt: newsArticles.publishedAt })
      .from(newsArticles)
      .where(eq(newsArticles.id, options.replaceArticleId))
      .limit(1);
    if (rows.length === 0) {
      return { status: "failed", error: "要更新的资讯不存在" };
    }
    priorPublishedAtForReplace = rows[0].publishedAt ?? undefined;
  }

  // ── Step 1: Duplicate check（原地更新时跳过，否则同 URL 会误判为重复）────────
  if (!options?.replaceArticleId) {
    try {
      const existing = await db
        .select({ id: newsArticles.id, title: newsArticles.title })
        .from(newsArticles)
        .where(eq(newsArticles.originalUrl, url))
        .limit(1);
      if (existing.length > 0) {
        console.log(`[Import] Duplicate skipped: ${url}`);
        return {
          status: "duplicate",
          title: existing[0].title,
          error: "该文章已存在，跳过",
        };
      }
    } catch (checkErr: any) {
      console.warn(`[Import] Duplicate check failed: ${checkErr?.message}`);
    }
  }

  // ── Step 2: Fetch page HTML ───────────────────────────────────────────────
  let articleHtml = "";
  try {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer:
        source === "Preqin"
          ? "https://www.preqin.com/"
          : "https://pitchbook.com/",
    };
    if (options?.cookieHeader) {
      headers.Cookie = options.cookieHeader;
    }
    articleHtml = await fetchHtmlForArticleImport(url, headers);
  } catch (fetchErr: unknown) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    console.warn(`[Import] Could not fetch ${url}: ${msg}`);
    return {
      status: "failed",
      error: `无法抓取页面：${msg}`,
    };
  }

  if (!articleHtml.trim()) {
    return { status: "failed", error: "页面内容为空，无法导入" };
  }

  const htmlPublishedAt = extractPublishedDateFromHtml(articleHtml, url);

  // ── Step 3: 从 HTML 抽取真实正文 ─────────────────────────────────────────
  const extracted = extractArticleFromHtml(articleHtml, url);
  if (
    isLikelyLoginWall({
      source,
      url,
      title: extracted.title ?? "",
      text: extracted.text,
      html: articleHtml,
    })
  ) {
    return {
      status: "failed",
      error:
        "检测到登录页/权限页，当前链接无法直接抓取正文。请在系统管理中配置并使用带登录 Cookie 的抓取任务，或先完成站点登录后再导入。",
    };
  }
  if (extracted.text.length < MIN_ARTICLE_TEXT_CHARS) {
    return {
      status: "failed",
      error:
        "无法从页面解析出足够正文（可能被反爬、需登录，或为纯前端渲染页面）。可尝试用系统抓取任务携带 Cookie，或后续接入无头浏览器。",
    };
  }

  const bodyForLlm = extracted.text.slice(0, 16_000);

  // ── Step 4: LLM 仅生成摘要与元数据（不生成正文） ─────────────────────────
  try {
    const tagContext = await buildTagCorrectionContext(20);
    const llmResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `你是金融资讯编辑助手。下面「正文摘录」是唯一事实来源。你只能撰写简短中文摘要与分类标签，不得编造正文未出现的数据、引语、结论或细节。禁止输出正文全文。禁止把摘要写成评论文章。${tagContext ? "\n\n" + tagContext : ""}`,
        },
        {
          role: "user",
          content: `来源站点：${source}
文章 URL：${url}

以下为从网页抽取的正文摘录（唯一事实来源）：
"""
${bodyForLlm}
"""

请返回 JSON（所有字段必填，strategy/region/author 可 null）：
- title: 英文标题；若正文前有明确标题可摘录，否则用简短英文概括主题（不得编造具体数据）
- summary: 2-3 句中文摘要，仅概括正文中实际出现的信息
- keyInsights: 3-5 条模块化要点，每条含 label（≤8 字中文小标题）与 value（1-2 句中文，仅来自摘录事实）；语气要直接给结论，不要写“文中指出/报道提到/数据显示”等转述句式
- sections: 3-5 个结构化模块，每条含 heading（中文小节标题）与 body（2-4 句中文解读/归纳，严禁编造摘录未出现的数据与引语）；语气与 keyInsights 保持一致，直接陈述，不要“文中指出/报告显示/作者认为”
- author: 若正文/摘录中能识别作者则填写，否则 null
- publishedAt: 仅当正文摘录中能**明确核对**到文章发布日期时填 ISO 日期 YYYY-MM-DD；若摘录中仅有模糊表述或无法确定具体日，**必须填 null**（禁止用今天或猜测日期占位）
- strategy: 从 ["私募股权","风险投资","房地产","信贷","基础设施","对冲基金","母基金","并购","成长股权","其他"] 选一或 null
- region: 从 ["全球","亚太","北美","欧洲","中国","东南亚","中东","其他"] 选一或 null
- tags: 3-5 个中文标签，需与正文内容相关；不要包含来源站点名或「手工上传」「自动导入」类字样
- contentZh: 将上文「正文摘录」忠实翻译为流畅中文正文，保持段落（用 \\n 分段），不得编造摘录未出现的事实；摘录过长时可译至约 12000 字并在末段注明「（以下略）」`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "imported_article_meta",
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
              sections: {
                type: "array",
                minItems: 3,
                maxItems: 6,
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
              publishedAt: { type: ["string", "null"] },
              strategy: { type: ["string", "null"] },
              region: { type: ["string", "null"] },
              tags: { type: "array", items: { type: "string" } },
              contentZh: { type: "string" },
            },
            required: [
              "title",
              "summary",
              "keyInsights",
              "sections",
              "author",
              "publishedAt",
              "strategy",
              "region",
              "tags",
              "contentZh",
            ],
            additionalProperties: false,
          },
        },
      },
    } as any);

    const llmContent = llmResponse.choices[0]?.message?.content;
    if (!llmContent) throw new Error("LLM 返回空内容");
    const metadata =
      typeof llmContent === "string" ? JSON.parse(llmContent) : llmContent;

    const titleFinal =
      (extracted.title && extracted.title.trim()) ||
      (metadata.title as string) ||
      "Untitled";
    const authorFinal =
      (extracted.byline && extracted.byline.trim()) ||
      (metadata.author as string | null) ||
      null;

    const keyInsightsRaw = metadata.keyInsights as { label: string; value: string }[] | undefined;
    const sectionsRaw = metadata.sections as { heading: string; body: string }[] | undefined;
    const keyInsights =
      Array.isArray(keyInsightsRaw) && keyInsightsRaw.length > 0
        ? keyInsightsRaw.map((x) => ({
            label: String(x.label ?? "").trim() || "要点",
            value: String(x.value ?? "").trim(),
          }))
        : [];
    const sections =
      Array.isArray(sectionsRaw) && sectionsRaw.length > 0
        ? sectionsRaw.map((x) => ({
            heading: String(x.heading ?? "").trim() || "小节",
            body: String(x.body ?? "").trim(),
          }))
        : [];

    // ── Step 5: Insert / 原地更新 ───────────────────────────────────────────
    const contentZhRaw = String((metadata as { contentZh?: string }).contentZh ?? "").trim();
    const llmPublishedAt = parseLlmPublishedAtField(metadata.publishedAt);
    const publishedAtResolved = resolveImportPublishedAt({
      htmlDate: htmlPublishedAt,
      llmDate: llmPublishedAt,
      replaceFallback: options?.replaceArticleId
        ? (priorPublishedAtForReplace ?? null)
        : undefined,
    });

    const payload = {
      title: titleFinal,
      summary: metadata.summary as string,
      content: extracted.text,
      contentZh: contentZhRaw || null,
      keyInsights: keyInsights.length > 0 ? keyInsights : null,
      sections: sections.length > 0 ? sections : [],
      originalUrl: url,
      author: authorFinal,
      publishedAt: publishedAtResolved,
      strategy: normalizeNewsStrategy(metadata.strategy),
      region: normalizeNewsRegion(metadata.region),
      tags: sanitizeNewsTags(metadata.tags),
      isHidden: false,
      embedding: null,
    };

    if (options?.replaceArticleId) {
      const rid = options.replaceArticleId;
      await db
        .update(newsArticles)
        .set({
          ...payload,
          source,
          createdAt: new Date(),
        })
        .where(eq(newsArticles.id, rid));
      scheduleArticleEmbedding(rid);
      scheduleEntityExtraction(rid);
      console.log(`[Import] Re-import updated id=${rid}: ${titleFinal}`);
      return { status: "success", title: titleFinal };
    }

    await db.insert(newsArticles).values({
      source,
      ...payload,
      isRead: false,
      recordCategory: "news",
    });

    const insertedRow = await db
      .select({ id: newsArticles.id })
      .from(newsArticles)
      .where(eq(newsArticles.originalUrl, url))
      .limit(1);
    if (insertedRow[0]?.id) {
      scheduleArticleEmbedding(insertedRow[0].id);
      scheduleEntityExtraction(insertedRow[0].id);
    }

    console.log(`[Import] Imported: ${titleFinal}`);
    return { status: "success", title: titleFinal };
  } catch (err: any) {
    const msg = err?.message ?? "未知错误";
    // Handle DB-level duplicate (unique index violation)
    if (
      msg.includes("Duplicate entry") ||
      msg.includes("duplicate") ||
      msg.toLowerCase().includes("unique")
    ) {
      return { status: "duplicate", error: "该文章已存在，跳过" };
    }
    console.error(`[Import] Failed for ${url}:`, err);
    return { status: "failed", error: msg };
  }
}

// ─── Router ────────────────────────────────────────────────────────────────

export const newsRouter = router({
  // 获取资讯列表（含筛选分页）
  list: publicProcedure
    .input(
      z.object({
        source: z.enum(["Preqin", "Pitchbook", "Manual", "ChromeExtension"]).optional(),
        strategy: z.string().optional(),
        region: z.string().optional(),
        tag: z.string().optional(),
        keyword: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
        recordCategory: z.enum(["report", "news"]).optional(),
        sortBy: z.enum(["published_desc", "hot_desc"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const { dateFrom, dateTo, ...rest } = input;
      return getNewsArticles({
        ...rest,
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
      });
    }),

  // 获取单条资讯详情
  detail: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input, ctx }) => {
      const article = await getNewsArticleById(input.id);
      if (!article) {
        throw new TRPCError({ code: "NOT_FOUND", message: "资讯不存在" });
      }
      if (article.isHidden && ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "NOT_FOUND", message: "资讯不存在" });
      }
      let uploader: { name: string | null; email: string | null } | null = null;
      if (article.uploaderUserId) {
        const u = await getUserById(article.uploaderUserId);
        if (u) uploader = { name: u.name, email: u.email };
      }
      const attachmentPublicUrl = article.attachmentStorageKey
        ? `/uploads/news/${article.attachmentStorageKey}`
        : null;
      return { ...article, uploader, attachmentPublicUrl };
    }),

  // 标记已读
  markRead: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await markArticleAsRead(input.id);
      return { success: true };
    }),

  /** 详情浏览 +1，用于列表热度 */
  recordView: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        sessionId: z.string().optional(),
        entrySource: z.enum(["list", "chat", "other"]).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const out = await recordDailyArticleView({
        articleId: input.id,
        userId: ctx.user?.id ?? null,
        sessionId: input.sessionId ?? null,
        entrySource: input.entrySource ?? "other",
      });
      return { success: true, counted: out.counted };
    }),

  // 书签：添加
  addBookmark: publicProcedure
    .input(
      z.object({
        articleId: z.number().int(),
        sessionId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user?.id;
      const result = await addBookmark({
        articleId: input.articleId,
        userId: userId ?? null,
        sessionId: input.sessionId ?? null,
      });
      return { success: true, bookmark: result };
    }),

  // 书签：移除
  removeBookmark: publicProcedure
    .input(
      z.object({
        articleId: z.number().int(),
        sessionId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user?.id;
      await removeBookmark(input.articleId, userId, input.sessionId);
      return { success: true };
    }),

  // 书签：检查是否已收藏
  isBookmarked: publicProcedure
    .input(
      z.object({
        articleId: z.number().int(),
        sessionId: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.user?.id;
      return isBookmarked(input.articleId, userId, input.sessionId);
    }),

  /** 是否已保存 Pitchbook/Preqin 的本机会话（供链导入复用登录态） */
  importSessionStatus: publicProcedure.query(() => getImportSessionStatus()),

  // 手动导入文章 URL（支持批量，最多 10 条）；来源按 URL 域名自动识别
  importByUrl: publicProcedure
    .input(
      z.object({
        urls: z.array(z.string().url()).min(1).max(10),
      })
    )
    .mutation(async ({ input }) => {
      const results: Array<{
        url: string;
        status: "success" | "duplicate" | "failed";
        title?: string;
        error?: string;
      }> = [];

      for (const url of input.urls) {
        const inferred = inferArticleImportSourceFromUrl(url);
        if (!inferred.ok) {
          results.push({ url, status: "failed", error: inferred.message });
          continue;
        }
        const result = await importSingleArticle(url, inferred.source);
        results.push({ url, ...result });
      }

      const successCount = results.filter((r) => r.status === "success").length;
      const dupCount = results.filter((r) => r.status === "duplicate").length;
      const failCount = results.filter((r) => r.status === "failed").length;

      return {
        results,
        successCount,
        message: `导入完成：${successCount} 条成功，${dupCount} 条重复跳过，${failCount} 条失败`,
      };
    }),

  // 书签：获取列表（含文章信息）
  bookmarks: publicProcedure
    .input(z.object({ sessionId: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user?.id;
      const bookmarkList = await getBookmarks(userId, input.sessionId);
      const db = await getDb();
      if (!db || bookmarkList.length === 0) return [];
      const articleIds = bookmarkList.map((b) => b.articleId);
      const articles = await Promise.all(
        articleIds.map((id) => getNewsArticleById(id))
      );
      const isAdmin = ctx.user?.role === "admin";
      return bookmarkList
        .map((bookmark, i) => ({
          ...bookmark,
          article: articles[i],
        }))
        .filter((row) => {
          if (!row.article) return false;
          if (row.article.isHidden && !isAdmin) return false;
          return true;
        });
    }),

  /** 自然语言解析筛选 + 列表（或纯语义结果） */
  smartSearch: publicProcedure
    .input(z.object({ query: z.string().min(1).max(500) }))
    .mutation(async ({ input }) => {
      const intent = await parseNewsSearchIntent(input.query);
      if (intent.semanticOnly) {
        const items = await semanticSearchArticles(input.query, {
          limit: 30,
          fallbackKeyword: true,
        });
        return {
          intent,
          semanticOnly: true as const,
          items,
          total: items.length,
        };
      }
      const dr = dateRangeFromPreset(intent.datePreset ?? undefined);
      const { items, total } = await getNewsArticles({
        keyword: intent.keyword ?? undefined,
        source: intent.source ?? undefined,
        strategy: intent.strategy ?? undefined,
        region: intent.region ?? undefined,
        recordCategory: intent.recordCategory ?? undefined,
        dateFrom: dr.dateFrom,
        dateTo: dr.dateTo,
        page: 1,
        pageSize: 30,
      });
      return { intent, semanticOnly: false as const, items, total };
    }),

  /** 基于收藏 embedding 均值的个性化推荐；无向量则热度 */
  recommend: publicProcedure
    .input(z.object({ sessionId: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user?.id;
      const bookmarkList = await getBookmarks(userId, input.sessionId);
      const ids = bookmarkList.map((b) => b.articleId).slice(0, 12);
      if (ids.length === 0) {
        const { items } = await getNewsArticles({
          sortBy: "hot_desc",
          pageSize: 5,
        });
        return { mode: "hot" as const, items };
      }
      const byIds = await getNewsArticlesByIds(ids);
      const seeds = byIds.filter(
        (a) => Array.isArray(a.embedding) && (a.embedding as number[]).length > 0
      );
      if (seeds.length === 0) {
        const { items } = await getNewsArticles({
          sortBy: "hot_desc",
          pageSize: 5,
        });
        return { mode: "hot" as const, items };
      }
      const items = await recommendByEmbeddingCentroid(seeds, {
        limit: 5,
        excludeIds: ids,
      });
      return { mode: "personalized" as const, items };
    }),

  /** 详情页：相关语义文章 + AI 对比洞察 */
  relatedInsight: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input, ctx }) => {
      const doc = await getNewsArticleById(input.id);
      if (!doc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "资讯不存在" });
      }
      if (doc.isHidden && ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "NOT_FOUND", message: "资讯不存在" });
      }
      const q = buildArticleEmbeddingInput(doc);
      let related = await semanticSearchArticles(q, {
        limit: 8,
        excludeIds: [doc.id],
        fallbackKeyword: true,
      });
      related = related.filter((r) => r.id !== doc.id).slice(0, 5);
      if (related.length === 0) {
        return { markdown: "", related: [] as typeof related };
      }
      const brief = related
        .map(
          (r) =>
            `[id=${r.id}] ${r.title} | ${r.source}\n${(r.summary ?? "—").slice(0, 220)}`
        )
        .join("\n\n");
      const resp = await invokeLLM({
        messages: [
          {
            role: "system",
            content:
              "你是卖方研究风格的助手。请用中文 Markdown 输出简短「跨文档洞察」：与主文相比，相关报道补充了哪些视角、有何异同或趋势。不得编造列表外事实。无结论可说数据不足。",
          },
          {
            role: "user",
            content: `【主文】${doc.title}\n摘要：${doc.summary ?? "—"}\n\n【库内相关资讯】\n${brief}`,
          },
        ],
      });
      const raw = resp.choices?.[0]?.message?.content;
      const markdown =
        typeof raw === "string" ? raw.trim() : "";
      return { markdown, related };
    }),

  /** 后台：资讯记录清单（含已隐藏） */
  adminArticleList: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(30),
        visibility: z.enum(["all", "visible", "hidden"]).default("all"),
      })
    )
    .query(async ({ input }) => adminListNewsArticles(input)),

  adminSetArticleHidden: adminProcedure
    .input(z.object({ id: z.number().int(), hidden: z.boolean() }))
    .mutation(async ({ input }) => {
      await adminSetNewsArticleHidden(input.id, input.hidden);
      return { success: true };
    }),

  adminDeleteArticle: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await adminDeleteNewsArticle(input.id);
      return { success: true };
    }),

  adminSetArticlesHidden: adminProcedure
    .input(
      z.object({
        ids: z.array(z.number().int()).min(1).max(50),
        hidden: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      await adminSetNewsArticlesHidden(input.ids, input.hidden);
      return { success: true, count: input.ids.length };
    }),

  adminDeleteArticles: adminProcedure
    .input(z.object({ ids: z.array(z.number().int()).min(1).max(50) }))
    .mutation(async ({ input }) => {
      await adminDeleteNewsArticles(input.ids);
      return { success: true, count: input.ids.length };
    }),

  /**
   * 按库内 originalUrl 重新抓取并原地更新（仅 Preqin/Pitchbook 资讯且需有效链接）。
   * 逐条执行并短暂间隔，降低对源站压力。
   */
  adminBatchReimportArticles: adminProcedure
    .input(z.object({ ids: z.array(z.number().int()).min(1).max(15) }))
    .mutation(async ({ input }) => {
      type RowStatus = "success" | "skipped" | "failed";
      const results: { id: number; status: RowStatus; message?: string }[] = [];
      let success = 0;
      let skipped = 0;
      let failed = 0;

      for (let i = 0; i < input.ids.length; i++) {
        const id = input.ids[i]!;
        const article = await getNewsArticleById(id);
        if (!article) {
          failed++;
          results.push({ id, status: "failed", message: "记录不存在" });
          continue;
        }
        const url = (article.originalUrl ?? "").trim();
        if (
          article.recordCategory !== "news" ||
          (article.source !== "Preqin" && article.source !== "Pitchbook") ||
          !url
        ) {
          skipped++;
          results.push({
            id,
            status: "skipped",
            message: "仅支持带有效链接的 Preqin / Pitchbook 资讯",
          });
          continue;
        }

        const r = await importSingleArticle(url, article.source as "Preqin" | "Pitchbook", {
          replaceArticleId: id,
        });
        if (r.status === "success") {
          success++;
          results.push({ id, status: "success" });
        } else if (r.status === "duplicate") {
          skipped++;
          results.push({ id, status: "skipped", message: r.error ?? "重复" });
        } else {
          failed++;
          results.push({ id, status: "failed", message: r.error ?? "导入失败" });
        }

        if (i < input.ids.length - 1) {
          await new Promise((res) => setTimeout(res, 600));
        }
      }

      return { success, skipped, failed, results };
    }),

  /** 用户修正标签/策略/地区 */
  correctTags: publicProcedure
    .input(
      z.object({
        articleId: z.number().int(),
        tags: z.array(z.string()).optional(),
        strategy: z.string().nullable().optional(),
        region: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const article = await getNewsArticleById(input.articleId);
      if (!article) throw new TRPCError({ code: "NOT_FOUND", message: "文章不存在" });
      const userId = ctx.user?.id ?? null;

      if (input.tags !== undefined) {
        await insertTagCorrection({
          articleId: input.articleId,
          userId,
          fieldName: "tags",
          oldValue: JSON.stringify(article.tags ?? []),
          newValue: JSON.stringify(input.tags),
        });
      }
      if (input.strategy !== undefined) {
        await insertTagCorrection({
          articleId: input.articleId,
          userId,
          fieldName: "strategy",
          oldValue: article.strategy ?? null,
          newValue: input.strategy,
        });
      }
      if (input.region !== undefined) {
        await insertTagCorrection({
          articleId: input.articleId,
          userId,
          fieldName: "region",
          oldValue: article.region ?? null,
          newValue: input.region,
        });
      }

      await updateArticleTags(input.articleId, {
        tags: input.tags,
        strategy: input.strategy,
        region: input.region,
      });

      return { success: true };
    }),

  /** 获取文章关联的实体 */
  articleEntities: publicProcedure
    .input(z.object({ articleId: z.number().int() }))
    .query(async ({ input }) => {
      const ids = await getArticleEntityIds(input.articleId);
      if (ids.length === 0) return [];
      return getEntitiesByIds(ids);
    }),
});
