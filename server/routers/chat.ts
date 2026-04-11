import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  getChatHistory,
  saveChatMessage,
  getNewsArticleById,
  getUserReadingProfile,
  insertReadingEvent,
} from "../db";
import { invokeLLM } from "../_core/llm";
import type { Message, Tool, ToolCall } from "../_core/llm";
import { semanticSearchArticles } from "../_core/semanticSearch";
import {
  appendCitedArticleLinks,
  buildArticleRefMap,
  buildNewsContextBlock,
  collectCitationsFromAnswer,
  GLOBAL_CHAT_SYSTEM_RULES,
  resolveRelevantArticlesForChat,
} from "../_core/chatShared";
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

function formatRefTable(refOrder: { id: number; title: string }[]): string {
  if (refOrder.length === 0) return "（暂无）";
  return refOrder
    .map((r, i) => `[文章${i + 1}] id=${r.id} | ${r.title}`)
    .join("\n");
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
  readingHint = ""
): Promise<{ content: string; refOrder: { id: number; title: string }[] }> {
  const refOrder: { id: number; title: string }[] = [];
  for (const a of seedArticles) {
    if (!refOrder.some((x) => x.id === a.id)) {
      refOrder.push({ id: a.id, title: a.title });
    }
  }
  const initialCtx = buildNewsContextBlock(seedArticles);
  const systemText = `${GLOBAL_CHAT_SYSTEM_RULES}${readingHint}

【初步语义检索结果】（务必优先使用；不足时再调用工具）
${initialCtx || "（无）"}

【当前引用表】引用资讯时请使用 [文章N]，N 与下表一致：
${formatRefTable(refOrder)}

可用工具：
- search_articles：补充检索，新文章会追加到引用表并更新编号；
- get_article_detail：按 id 拉取长正文。`;

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

  send: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        message: z.string().min(1).max(2000),
        userId: z.number().optional(),
        articleId: z.number().int().optional(),
        origin: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { sessionId, message, userId, origin, articleId } = input;

      if (userId) {
        await insertReadingEvent({
          userId,
          sessionId,
          articleId: articleId ?? null,
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

      const relevantArticles = articleId
        ? []
        : await resolveRelevantArticlesForChat(message);

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
        const focusedResp = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是严谨的文档问答助手。必须仅根据给定文档文本回答，不得使用外部知识。若文档无依据，明确回答“当前文档未提供该信息”。${readingHint}`,
            },
            {
              role: "user",
              content: `当前问题：${message}

请基于以下文档行号文本回答。每行都有 [P页码|L行号] 标记。
---
${numbered || "（无可用文本）"}
---

请输出 JSON：
- answer: 中文回答，第一句必须是“以下基于当前文档内容回答。”
- refs: 1-4 条引用，字段：
  - page: 页码（整数，>=1）
  - startLine: 起始行号（整数，>=1）
  - endLine: 结束行号（整数，>=startLine）
  - quote: 该行段的简短摘录（20-120 字）`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "focused_doc_answer",
              strict: true,
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

        const focusedRaw = focusedResp.choices?.[0]?.message?.content;
        const focusedJson =
          typeof focusedRaw === "string" ? JSON.parse(focusedRaw) : focusedRaw;
        assistantContent = String(focusedJson?.answer ?? assistantContent);
        references = Array.isArray(focusedJson?.refs)
          ? focusedJson.refs
              .map((r: any) => ({
                page: Math.max(1, Number(r.page) || 1),
                startLine: Math.max(1, Number(r.startLine) || 1),
                endLine: Math.max(1, Number(r.endLine) || Number(r.startLine) || 1),
                quote: String(r.quote ?? "").trim() || undefined,
              }))
              .slice(0, 4)
          : [];
      } else {
        if (relevantArticles.length === 0) {
          assistantContent = "资讯库未提供与该问题直接相关的信息。";
        } else {
          const readingHint = await buildReadingHintText(userId ?? null);
          const agentOut = await runGlobalAgentChat(
            message,
            historyMessages,
            relevantArticles,
            readingHint
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

      if (focusedDocMeta && !assistantContent.includes("以下基于当前文档内容回答")) {
        assistantContent = `以下基于当前文档内容回答。\n\n${assistantContent}`;
      }

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
