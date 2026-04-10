import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getChatHistory, saveChatMessage, getNewsArticleById } from "../db";
import { invokeLLM } from "../_core/llm";
import { getNewsArticles } from "../db";

// ─── Helper: search relevant articles ─────────────────────────────────────

/**
 * Retrieve articles from DB that are relevant to the user's question.
 * We fetch recent articles and let the LLM pick the most relevant ones.
 * Returns up to 8 articles with their IDs and URLs for citation.
 */
async function getRelevantArticles(question: string) {
  try {
    const { items } = await getNewsArticles({ pageSize: 30 });
    if (items.length === 0) return [];

    // Simple keyword-based pre-filter to reduce LLM context size
    const q = question.toLowerCase();
    const keywords = q.split(/\s+/).filter((w) => w.length > 1);

    const scored = items.map((article) => {
      const text = [
        article.title,
        article.summary ?? "",
        article.content ?? "",
        article.strategy ?? "",
        article.region ?? "",
        (article.tags as string[] | null ?? []).join(" "),
      ]
        .join(" ")
        .toLowerCase();

      let score = 0;
      for (const kw of keywords) {
        if (text.includes(kw)) score++;
      }
      return { article, score };
    });

    // Return top 8 by relevance score (fall back to most recent if all score 0)
    const sorted = scored.sort((a, b) => b.score - a.score);
    return sorted.slice(0, 8).map((s) => s.article);
  } catch {
    return [];
  }
}

// ─── Router ────────────────────────────────────────────────────────────────

export const chatRouter = router({
  // 获取对话历史
  history: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      return getChatHistory(input.sessionId);
    }),

  // 发送消息并获取 AI 回复（含资讯引用链接）
  send: publicProcedure
    .input(
        z.object({
        sessionId: z.string(),
        message: z.string().min(1).max(2000),
        userId: z.number().optional(),
        /** 指定资讯详情页当前文档时，优先基于该条（含上传文件全文）回答 */
        articleId: z.number().int().optional(),
        // Frontend base URL so we can build internal article links
        origin: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { sessionId, message, userId, origin, articleId } = input;

      // 保存用户消息
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

      // 获取相关资讯作为上下文
      const relevantArticles = articleId
        ? []
        : await getRelevantArticles(message);

      // Build context with article IDs for citation
      const newsContext = relevantArticles
        .map(
          (n, i) =>
            `[文章${i + 1}] ID:${n.id} | 来源:${n.source} | 标题:${n.title}\n` +
            `摘要: ${n.summary ?? ""}\n` +
            `详细内容: ${(n.content ?? "").slice(0, 500)}\n` +
            `策略: ${n.strategy ?? "—"} | 地区: ${n.region ?? "—"} | 发布: ${n.publishedAt.toISOString().slice(0, 10)}`
        )
        .join("\n\n---\n\n");

      // Build article reference map for appending links
      const articleRefMap = relevantArticles.reduce(
        (acc, n, i) => {
          acc[`文章${i + 1}`] = { id: n.id, title: n.title };
          return acc;
        },
        {} as Record<string, { id: number; title: string }>
      );

      // 获取历史对话
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

        const focusedResp = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是严谨的文档问答助手。必须仅根据给定文档文本回答，不得使用外部知识。若文档无依据，明确回答“当前文档未提供该信息”。`,
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
        // 调用 LLM（全局资讯模式）
        const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是 IPMS 投资项目管理系统的智能资讯助手，专门服务于资管公司的基金筛选团队和项目投资团队。

你的职责：
1. 基于最新资讯数据，回答用户关于私募股权、风险投资、房地产、基础设施、信贷等另类资产的问题
2. 帮助用户快速查询、整理、总结和分析资讯内容
3. 提供专业的投资视角和市场洞察
4. 回答时请使用中文，保持专业、简洁的风格

重要规则：当你的回答引用了以下资讯库中的文章时，请在引用处用 [文章N] 标注（如"根据[文章1]..."），系统会自动在回答末尾附上对应文章的跳转链接。

${focusedDocBlock ? `用户正在阅读某篇资讯/上传文件。你必须严格遵循：
1) 默认仅基于下方「当前聚焦文档」回答；
2) 若问题在文档中找不到依据，明确回复“当前文档未提供该信息”；
3) 禁止使用通用常识、外部知识补充事实；
4) 回答开头用一句话说明“以下基于当前文档内容回答”。\n\n${focusedDocBlock}\n` : ""}

相关资讯数据（供参考）：
${newsContext || (focusedDocBlock ? "（已提供上方聚焦文档）" : "（暂无相关资讯，请基于通用金融知识回答）")}`,
          },
          ...historyMessages,
          { role: "user", content: message },
        ],
      });

        const rawContent = response.choices?.[0]?.message?.content;
        assistantContent =
          typeof rawContent === "string"
            ? rawContent
            : "抱歉，我暂时无法回答这个问题。";

      // ── Append cited article links ──────────────────────────────────────
      // Find which [文章N] references appear in the answer
      const citedRefs = new Set<string>();
      for (const ref of Object.keys(articleRefMap)) {
        if (assistantContent.includes(`[${ref}]`)) {
          citedRefs.add(ref);
        }
      }

        if (citedRefs.size > 0) {
          const baseUrl = origin ?? "";
          const linkLines = Array.from(citedRefs)
            .sort()
            .map((ref) => {
              const { id, title } = articleRefMap[ref];
              const url = `${baseUrl}/news/${id}`;
              return `- [${title}](${url})`;
            });

          assistantContent +=
            "\n\n---\n**相关资讯链接：**\n" + linkLines.join("\n");
        }
      }

      if (focusedDocMeta && !assistantContent.includes("以下基于当前文档内容回答")) {
        assistantContent = `以下基于当前文档内容回答。\n\n${assistantContent}`;
      }

      // 保存 AI 回复
      await saveChatMessage({
        sessionId,
        userId: userId ?? null,
        role: "assistant",
        content: assistantContent,
      });

      return { content: assistantContent, references: references ?? [] };
    }),
});
