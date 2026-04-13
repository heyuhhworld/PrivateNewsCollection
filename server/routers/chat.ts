import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  getChatHistory,
  saveChatMessage,
  getNewsArticleById,
  getNewsArticlesByIds,
  getUserReadingProfile,
  insertReadingEvent,
  searchReadingImages,
  listChatSessionsByUser,
  renameChatSessionByUser,
  deleteChatSessionByUser,
} from "../db";
import { invokeLLM } from "../_core/llm";
import type { Message, Tool, ToolCall } from "../_core/llm";
import { semanticSearchArticles } from "../_core/semanticSearch";
import { getChromeExtensionUserGuideMarkdown } from "@shared/chromeExtensionUserGuide";
import {
  appendCitedArticleLinks,
  buildArticleRefMap,
  buildChromeExtensionAssistantBlock,
  buildNewsContextBlock,
  collectCitationsFromAnswer,
  GLOBAL_CHAT_SYSTEM_RULES,
  guessChromeExtensionOrProductQuestion,
  resolveRelevantArticlesForChat,
} from "../_core/chatShared";
import { maybeBuildHotAnalyticsAnswer } from "../_core/hotViewAnalytics";
import { maybeBuildMyArticlesAnswer } from "../_core/myArticlesQuery";
import { isImageRelatedQuery, buildImageContextBlock } from "../_core/imageQueryHelper";
import type { NewsArticle } from "../../drizzle/schema";

const CHAT_AGENT_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "search_articles",
      description:
        "在资讯库中语义检索相关文章。可对用户问题换说法多次检索。结果会分配 [文章N] 编号。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索查询（中文或英文）" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_article_detail",
      description:
        "按文章 ID 获取较长正文片段（优先抽取文本）。仅在需要细节时调用。",
      parameters: {
        type: "object",
        properties: { articleId: { type: "integer" } },
        required: ["articleId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_images",
      description:
        "搜索用户保存的图片（截图、剪藏图等）。按关键词匹配图片内容描述和标签。返回图片 URL 和内容描述，在回答中引用时使用 markdown 图片语法 ![描述](url)。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          articleId: { type: "integer", description: "限定文章 ID（可选）" },
        },
        required: ["query"],
      },
    },
  },
];

function textFromAssistantContent(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .filter(
        (c): c is { type?: string; text?: string } =>
          typeof c === "object" && c != null && "type" in c
      )
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
  }
  return "";
}

/** 模型偶发在 JSON 外包裹 markdown 代码块，直接 JSON.parse 会整段 mutation 失败 */
function stripMarkdownJsonFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/i);
  return m ? m[1].trim() : t;
}

function parseFocusedDocLlmJson(raw: unknown): {
  answer: string;
  refs: unknown[];
} | null {
  const text = textFromAssistantContent(raw).trim();
  if (!text) return null;
  const attempts = [text, stripMarkdownJsonFence(text)];
  for (const chunk of attempts) {
    const c = chunk.trim();
    if (!c) continue;
    try {
      const j = JSON.parse(c) as {
        answer?: unknown;
        refs?: unknown;
      };
      if (j && typeof j.answer === "string" && j.answer.trim()) {
        const refs = Array.isArray(j.refs) ? j.refs : [];
        return { answer: j.answer.trim(), refs };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function formatRefTable(refOrder: { id: number; title: string }[]): string {
  if (refOrder.length === 0) return "（暂无）";
  return refOrder
    .map((r, i) => `[文章${i + 1}] id=${r.id} | ${r.title}`)
    .join("\n");
}

function stripProcessPreamble(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let dropped = false;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const t = raw.trim();
    if (
      !dropped &&
      /^(目前资讯库里|当前可明确看到|以下基于当前文档内容回答|我先|先说明|先总结|简要总结如下[:：]?)/.test(
        t
      )
    ) {
      dropped = true;
      continue;
    }
    out.push(raw);
  }
  return out.join("\n").replace(/^\s+/, "").trimStart();
}

async function runAgentTool(
  tc: ToolCall,
  refOrder: { id: number; title: string }[]
): Promise<string> {
  const name = tc.function.name;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(tc.function.arguments || "{}");
  } catch {
    return JSON.stringify({ error: "参数 JSON 无效" });
  }
  if (name === "search_articles") {
    const q = String(args.query ?? "").trim();
    if (!q) return JSON.stringify({ error: "query 为空" });
    const arts = await semanticSearchArticles(q, {
      limit: 8,
      fallbackKeyword: true,
    });
    const prevLen = refOrder.length;
    for (const a of arts) {
      if (!refOrder.some((x) => x.id === a.id)) {
        refOrder.push({ id: a.id, title: a.title });
      }
    }
    return JSON.stringify({
      addedCount: refOrder.length - prevLen,
      totalRefs: refOrder.length,
      refTable: formatRefTable(refOrder),
      previews: arts.map((a) => ({
        id: a.id,
        title: a.title,
        summary: (a.summary ?? "").slice(0, 400),
        source: a.source,
      })),
    });
  }
  if (name === "get_article_detail") {
    const id = Math.floor(Number(args.articleId));
    if (!Number.isFinite(id)) return JSON.stringify({ error: "articleId 无效" });
    const doc = await getNewsArticleById(id);
    if (!doc || doc.isHidden) return JSON.stringify({ error: "未找到文章" });
    const body = (doc.extractedText ?? doc.content ?? doc.summary ?? "").slice(
      0,
      15_000
    );
    return JSON.stringify({
      id: doc.id,
      title: doc.title,
      source: doc.source,
      body,
    });
  }
  if (name === "search_images") {
    const q = String(args.query ?? "").trim();
    if (!q) return JSON.stringify({ error: "query 为空" });
    const artId = args.articleId ? Math.floor(Number(args.articleId)) : undefined;
    const imgs = await searchReadingImages(q, {
      articleId: artId && Number.isFinite(artId) ? artId : undefined,
      limit: 6,
    });
    if (imgs.length === 0) return JSON.stringify({ results: [], hint: "未找到匹配图片" });
    return JSON.stringify({
      results: imgs.map((img) => ({
        id: img.id,
        articleId: img.articleId,
        url: `/uploads/news/${img.storageKey}`,
        caption: img.caption,
        description: img.analysisText,
        tags: img.analysisTags,
        page: img.sourcePage,
      })),
      hint: "在回答中使用 ![描述](url) 展示图片",
    });
  }
  return JSON.stringify({ error: "未知工具" });
}

async function buildReadingHintText(userId?: number | null): Promise<string> {
  if (!userId) return "";
  const p = await getUserReadingProfile(userId);
  const j = p?.summaryJson as { summaryText?: string } | undefined;
  const t = j?.summaryText?.trim();
  if (!t) return "";
  return `\n【用户阅读习惯摘要】（仅调整表达侧重，事实须来自检索与引用内容）\n${t}`;
}

async function runGlobalAgentChat(
  message: string,
  historyMessages: { role: "user" | "assistant"; content: string }[],
  seedArticles: NewsArticle[],
  readingHint = "",
  siteOrigin = ""
): Promise<{ content: string; refOrder: { id: number; title: string }[] }> {
  const refOrder: { id: number; title: string }[] = [];
  for (const a of seedArticles) {
    if (!refOrder.some((x) => x.id === a.id)) {
      refOrder.push({ id: a.id, title: a.title });
    }
  }
  const initialCtx = buildNewsContextBlock(seedArticles);
  const extBlock = buildChromeExtensionAssistantBlock(siteOrigin);
  const systemText = `${GLOBAL_CHAT_SYSTEM_RULES}${readingHint}

${extBlock}

【初步语义检索结果】（务必优先使用；不足时再调用工具）
${initialCtx || "（无）"}

【当前引用表】引用资讯时请使用 [文章N]，N 与下表一致：
${formatRefTable(refOrder)}

可用工具：
- search_articles：补充检索，新文章会追加到引用表并更新编号；
- get_article_detail：按 id 拉取长正文；
- search_images：搜索已保存的图片/截图，按关键词匹配图片内容。找到后在回答中用 ![描述](url) 展示。`;

  const messages: Message[] = [
    { role: "system", content: systemText },
    ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  let assistantContent = "抱歉，我暂时无法回答这个问题。";

  for (let step = 0; step < 8; step += 1) {
    const response = await invokeLLM({
      messages,
      tools: CHAT_AGENT_TOOLS,
      tool_choice: "auto",
    } as any);
    const choice = response.choices?.[0]?.message;
    if (!choice) break;

    const toolCalls = choice.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const contentStr = textFromAssistantContent(choice.content);
      messages.push({
        role: "assistant",
        content: contentStr || null,
        tool_calls: toolCalls,
      } as Message);
      for (const tc of toolCalls) {
        const out = await runAgentTool(tc, refOrder);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: out,
        } as Message);
      }
      continue;
    }

    assistantContent = textFromAssistantContent(choice.content) || assistantContent;
    break;
  }

  return { content: assistantContent, refOrder };
}

// ─── Router ────────────────────────────────────────────────────────────────

export const chatRouter = router({
  history: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      return getChatHistory(input.sessionId);
    }),

  sessions: publicProcedure
    .input(z.object({ userId: z.number().int() }))
    .query(async ({ input }) => {
      return listChatSessionsByUser(input.userId);
    }),

  renameSession: publicProcedure
    .input(
      z.object({
        userId: z.number().int(),
        sessionId: z.string().min(1).max(64),
        title: z.string().min(1).max(60),
      })
    )
    .mutation(async ({ input }) => {
      const ok = await renameChatSessionByUser(input.userId, input.sessionId, input.title);
      return { success: ok };
    }),

  deleteSession: publicProcedure
    .input(
      z.object({
        userId: z.number().int(),
        sessionId: z.string().min(1).max(64),
      })
    )
    .mutation(async ({ input }) => {
      const n = await deleteChatSessionByUser(input.userId, input.sessionId);
      return { success: n > 0 };
    }),

  send: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        message: z.string().min(1).max(2000),
        userId: z.number().optional(),
        articleId: z.number().int().optional(),
        articleIds: z.array(z.number().int()).max(5).optional(),
        origin: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { sessionId, message, userId, origin, articleId } = input;
      const linkedArticleIds = Array.from(new Set(input.articleIds ?? [])).filter(
        (id) => Number.isFinite(id) && id > 0
      );
      const hotAnswer = await maybeBuildHotAnalyticsAnswer(message);

      if (userId) {
        await insertReadingEvent({
          userId,
          sessionId,
          articleId: articleId ?? linkedArticleIds[0] ?? null,
          recordCategory: null,
          eventType: "chat_ask",
          payload: { len: message.length },
        });
      }

      await saveChatMessage({
        sessionId,
        userId: userId ?? null,
        role: "user",
        content: message,
      });

      const quickAnswer =
        hotAnswer ??
        (articleId == null && linkedArticleIds.length === 0
          ? await maybeBuildMyArticlesAnswer(message, userId ?? null)
          : null);
      if (quickAnswer) {
        await saveChatMessage({
          sessionId,
          userId: userId ?? null,
          role: "assistant",
          content: quickAnswer,
        });
        return {
          content: quickAnswer,
          references: [],
          citations: [],
        };
      }

      let focusedDocBlock = "";
      let focusedDocMeta: { id: number; title: string } | null = null;
      if (articleId) {
        const doc = await getNewsArticleById(articleId);
        if (doc) {
          focusedDocMeta = { id: doc.id, title: doc.title };
          const raw = (doc.extractedText ?? doc.content ?? doc.summary ?? "").slice(
            0,
            18_000
          );
          focusedDocBlock = `
【当前聚焦文档】
标题: ${doc.title}
来源: ${doc.source}
摘要: ${doc.summary ?? "—"}
资讯相关时间说明: ${doc.effectivePeriodLabel ?? "—"}
正文与抽取文本（截断）:
${raw || "（无文本）"}
---
`;
        }
      }

      if (articleId != null && !focusedDocMeta) {
        const notFoundMsg =
          "未找到该篇资讯或暂不可用（可能已下线）。请返回列表刷新后再试。";
        await saveChatMessage({
          sessionId,
          userId: userId ?? null,
          role: "assistant",
          content: notFoundMsg,
        });
        return {
          content: notFoundMsg,
          citations: [],
          references: [],
        };
      }

      let relevantArticles: NewsArticle[] = [];
      if (!articleId) {
        if (linkedArticleIds.length > 0) {
          const rows = (await getNewsArticlesByIds(linkedArticleIds)).filter(
            (a) => !a.isHidden
          );
          const map = new Map(rows.map((r) => [r.id, r]));
          relevantArticles = linkedArticleIds
            .map((id) => map.get(id))
            .filter((v): v is NewsArticle => Boolean(v));
        } else {
          relevantArticles = await resolveRelevantArticlesForChat(message);
        }
      }

      let articleRefMap = buildArticleRefMap(relevantArticles);

      const history = await getChatHistory(sessionId);
      const historyMessages = history.slice(-10).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      let assistantContent = "抱歉，我暂时无法回答这个问题。";
      let references:
        | Array<{ page: number; startLine: number; endLine: number; quote?: string }>
        | undefined;

      if (focusedDocMeta) {
        if (guessChromeExtensionOrProductQuestion(message)) {
          const siteOrigin = origin?.trim() ?? "";
          const pluginGuide = getChromeExtensionUserGuideMarkdown(siteOrigin);
          await saveChatMessage({
            sessionId,
            userId: userId ?? null,
            role: "assistant",
            content: pluginGuide,
          });
          return {
            content: pluginGuide,
            citations: [],
            references: [],
          };
        }
        const doc = await getNewsArticleById(focusedDocMeta.id);
        const extracted = (doc?.extractedText ?? doc?.content ?? "").trim();
        const allLines = extracted.split(/\r?\n/).filter((l) => l.trim().length > 0);
        const rawMap = (doc as { extractedLinePageMap?: unknown } | null)
          ?.extractedLinePageMap;
        const linePageMapFull =
          Array.isArray(rawMap) && rawMap.length === allLines.length
            ? rawMap.map((n) => Math.max(1, Math.floor(Number(n)) || 1))
            : null;
        const lines = allLines.slice(0, 1800);
        const linePageMap = linePageMapFull
          ? linePageMapFull.slice(0, lines.length)
          : null;
        const numbered = lines
          .map((line, idx) => {
            const lineNo = idx + 1;
            const pageNo =
              linePageMap?.[idx] ??
              Math.max(1, Math.floor((lineNo - 1) / 40) + 1);
            return `[P${pageNo}|L${lineNo}] ${line}`;
          })
          .join("\n");

        const readingHint = await buildReadingHintText(userId ?? null);
        let focusedImageBlock = "";
        if (isImageRelatedQuery(message)) {
          const imgCtx = await buildImageContextBlock(message, {
            articleId: focusedDocMeta.id,
            userId: userId ?? undefined,
            siteOrigin: origin?.trim() ?? "",
          });
          focusedImageBlock = imgCtx.block;
        }
        try {
          const focusedResp = await invokeLLM({
            messages: [
              {
                role: "system",
                content: `你是严谨的文档问答助手。必须仅根据给定文档文本回答，不得使用外部知识。若文档无依据，明确回答“当前文档未提供该信息”。${readingHint}${focusedImageBlock}`,
              },
              {
                role: "user",
                content: `当前问题：${message}

请基于以下文档行号文本回答。每行都有 [P页码|L行号] 标记。
---
${numbered || "（无可用文本）"}
---

请**只输出**一个 JSON 对象，不要 markdown 围栏或其它说明。字段：
- answer: 中文专业回答，直接给结论，不要写“以下基于当前文档内容回答”等过程化前缀
- refs: 0-4 条引用，每项含 page、startLine、endLine、quote（quote 为该行段摘录，20-120 字）`,
              },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "focused_doc_answer",
                strict: false,
                schema: {
                  type: "object",
                  properties: {
                    answer: { type: "string" },
                    refs: {
                      type: "array",
                      minItems: 0,
                      maxItems: 4,
                      items: {
                        type: "object",
                        properties: {
                          page: { type: "integer", minimum: 1 },
                          startLine: { type: "integer", minimum: 1 },
                          endLine: { type: "integer", minimum: 1 },
                          quote: { type: "string" },
                        },
                        required: ["page", "startLine", "endLine", "quote"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["answer", "refs"],
                  additionalProperties: false,
                },
              },
            },
          } as any);

          const rawContent = focusedResp.choices?.[0]?.message?.content;
          const parsed = parseFocusedDocLlmJson(rawContent);
          if (parsed) {
            assistantContent = parsed.answer;
            references = parsed.refs
              .filter(
                (r): r is Record<string, unknown> =>
                  typeof r === "object" && r !== null && !Array.isArray(r)
              )
              .map((r) => ({
                page: Math.max(1, Number(r.page) || 1),
                startLine: Math.max(1, Number(r.startLine) || 1),
                endLine: Math.max(
                  1,
                  Number(r.endLine) || Number(r.startLine) || 1
                ),
                quote: String(r.quote ?? "").trim() || undefined,
              }))
              .slice(0, 4);
          } else {
            const plain = textFromAssistantContent(rawContent).trim();
            if (plain.length > 15 && !plain.startsWith("{")) {
              assistantContent = plain;
              references = [];
            } else {
              assistantContent =
                "未能解析模型返回的结构化结果。请重试一次；若仍失败，请检查 LLM API 是否支持 json_schema 或网络是否稳定。";
              references = [];
            }
          }
        } catch (e) {
          const hint = e instanceof Error ? e.message : String(e);
          assistantContent = `文档问答调用失败：${hint.slice(0, 500)}`;
          references = [];
        }
      } else {
        if (relevantArticles.length === 0) {
          const siteOrigin = origin?.trim() ?? "";
          if (hotAnswer) {
            assistantContent = hotAnswer;
            articleRefMap = {};
          } else if (guessChromeExtensionOrProductQuestion(message)) {
            assistantContent = getChromeExtensionUserGuideMarkdown(siteOrigin);
            articleRefMap = {};
          } else {
            assistantContent =
              "未在资讯库中检索到与问题直接匹配的条目。若你问的是访问热度、PV/UV 或停留时长，请用「统计」「热度」「表格」等词重新提问，以便走行为分析回答。";
          }
        } else {
          const readingHint = await buildReadingHintText(userId ?? null);
          const agentOut = await runGlobalAgentChat(
            message,
            historyMessages,
            relevantArticles,
            readingHint,
            origin?.trim() ?? ""
          );
          assistantContent = agentOut.content;
          articleRefMap = agentOut.refOrder.reduce(
            (acc, r, i) => {
              acc[`文章${i + 1}`] = { id: r.id, title: r.title };
              return acc;
            },
            {} as Record<string, { id: number; title: string }>
          );
        }

        if (!articleId && relevantArticles.length > 0) {
          assistantContent = appendCitedArticleLinks(
            assistantContent,
            articleRefMap,
            origin
          );
        }
      }

      assistantContent = stripProcessPreamble(assistantContent);

      await saveChatMessage({
        sessionId,
        userId: userId ?? null,
        role: "assistant",
        content: assistantContent,
      });

      const citationList = collectCitationsFromAnswer(assistantContent, articleRefMap);

      return {
        content: assistantContent,
        citations: !articleId ? citationList : [],
        references: references ?? [],
      };
    }),
});
