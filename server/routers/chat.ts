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
      if (articleId) {
        const doc = await getNewsArticleById(articleId);
        if (doc) {
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

      // 调用 LLM
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

${focusedDocBlock ? `用户正在阅读某篇资讯/上传文件，请**优先依据下方「当前聚焦文档」**作答；若文档未涉及再补充通用知识。\n\n${focusedDocBlock}\n` : ""}

相关资讯数据（供参考）：
${newsContext || (focusedDocBlock ? "（已提供上方聚焦文档）" : "（暂无相关资讯，请基于通用金融知识回答）")}`,
          },
          ...historyMessages,
          { role: "user", content: message },
        ],
      });

      const rawContent = response.choices?.[0]?.message?.content;
      let assistantContent =
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

      // 保存 AI 回复
      await saveChatMessage({
        sessionId,
        userId: userId ?? null,
        role: "assistant",
        content: assistantContent,
      });

      return { content: assistantContent };
    }),
});
