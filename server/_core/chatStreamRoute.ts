import type { Express, Request, Response } from "express";
import {
  getChatHistory,
  saveChatMessage,
  getUserReadingProfile,
  insertReadingEvent,
  searchReadingImages,
} from "../db";
import { invokeLLMStream } from "./llm";
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
} from "./chatShared";
import { maybeBuildHotAnalyticsAnswer } from "./hotViewAnalytics";
import { maybeBuildMyArticlesAnswer } from "./myArticlesQuery";
import { isImageRelatedQuery, buildImageContextBlock } from "./imageQueryHelper";

function sendSse(res: Response, obj: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

async function buildReadingHintText(userId?: number | null): Promise<string> {
  if (!userId) return "";
  const p = await getUserReadingProfile(userId);
  const j = p?.summaryJson as { summaryText?: string } | undefined;
  const t = j?.summaryText?.trim();
  if (!t) return "";
  return `\n【用户阅读习惯摘要】（仅调整表达侧重，事实须来自下文资讯数据）\n${t}`;
}

/**
 * POST /api/chat/stream
 * Body: { sessionId, message, userId?, origin? }
 * 单篇文档问答请继续用 tRPC chat.send（需 JSON 引用）。
 */
export function registerChatStreamRoute(app: Express) {
  app.post("/api/chat/stream", async (req: Request, res: Response) => {
    const { sessionId, message, userId, origin } = req.body ?? {};
    if (!sessionId || typeof sessionId !== "string") {
      res.status(400).json({ error: "sessionId 必填" });
      return;
    }
    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "message 必填" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    const msg = message.trim().slice(0, 2000);
      const hotAnswer = await maybeBuildHotAnalyticsAnswer(msg);

    try {
      const uid = typeof userId === "number" ? userId : null;
      if (uid != null) {
        await insertReadingEvent({
          userId: uid,
          sessionId,
          articleId: null,
          recordCategory: null,
          eventType: "chat_ask",
          payload: { len: msg.length, stream: true },
        });
      }
      await saveChatMessage({
        sessionId,
        userId: uid,
        role: "user",
        content: msg,
      });

      const siteOrigin = typeof origin === "string" ? origin.trim() : "";
      const quickAnswer = hotAnswer ?? (await maybeBuildMyArticlesAnswer(msg, uid));
      if (quickAnswer) {
        await saveChatMessage({
          sessionId,
          userId: uid,
          role: "assistant",
          content: quickAnswer,
        });
        sendSse(res, { type: "chunk", text: quickAnswer });
        sendSse(res, { type: "done", content: quickAnswer, citations: [] });
        res.end();
        return;
      }
      const extGuide = buildChromeExtensionAssistantBlock(siteOrigin);

      const relevantArticles = await resolveRelevantArticlesForChat(msg);
      if (relevantArticles.length === 0) {
        if (guessChromeExtensionOrProductQuestion(msg)) {
          const full = getChromeExtensionUserGuideMarkdown(siteOrigin);
          sendSse(res, { type: "chunk", text: full });
          await saveChatMessage({
            sessionId,
            userId: uid,
            role: "assistant",
            content: full,
          });
          sendSse(res, {
            type: "done",
            content: full,
            citations: [],
          });
          res.end();
          return;
        }
        const fallback =
          "未在资讯库中检索到与问题直接匹配的条目。若需访问热度、PV/UV、停留时长等统计，请在问题中包含「统计」「热度」「表格」等词。";
        await saveChatMessage({
          sessionId,
          userId: uid,
          role: "assistant",
          content: fallback,
        });
        sendSse(res, { type: "chunk", text: fallback });
        sendSse(res, { type: "done", content: fallback, citations: [] });
        res.end();
        return;
      }

      const newsContext = buildNewsContextBlock(relevantArticles);
      const articleRefMap = buildArticleRefMap(relevantArticles);
      const readingHint = await buildReadingHintText(uid);
      const history = await getChatHistory(sessionId);
      const historyMessages = history.slice(-10).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      let imageBlock = "";
      if (isImageRelatedQuery(msg)) {
        const imgCtx = await buildImageContextBlock(msg, {
          userId: uid ?? undefined,
          siteOrigin,
        });
        imageBlock = imgCtx.block;
      }

      let full = "";
      const stream = invokeLLMStream({
        messages: [
          {
            role: "system",
            content: `${GLOBAL_CHAT_SYSTEM_RULES}${readingHint}

${extGuide}

相关资讯数据（供参考）：
${newsContext || "（暂无相关资讯）"}${imageBlock}`,
          },
          ...historyMessages,
          { role: "user", content: msg },
        ],
      });

      for await (const piece of stream) {
        full += piece;
        sendSse(res, { type: "chunk", text: piece });
      }

      const withLinks = appendCitedArticleLinks(
        full,
        articleRefMap,
        typeof origin === "string" ? origin : undefined
      );
      const citations = collectCitationsFromAnswer(withLinks, articleRefMap);

      await saveChatMessage({
        sessionId,
        userId: uid,
        role: "assistant",
        content: withLinks,
      });

      sendSse(res, {
        type: "done",
        content: withLinks,
        citations,
      });
      res.end();
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      sendSse(res, { type: "error", message: err });
      res.end();
    }
  });
}
