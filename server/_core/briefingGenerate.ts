import type { NewsArticle } from "../../drizzle/schema";
import { buildBriefingSystemPrompt } from "@shared/briefingConstants";
import { invokeLLM } from "./llm";

export function formatBriefingArticleLines(articles: NewsArticle[]): string {
  return articles
    .map((a) => {
      const url = (a.originalUrl ?? "").trim();
      const urlField = url ? url : "none";
      return `- id=${a.id} | url=${urlField} | ${a.source} | ${a.title} | 摘要: ${(a.summary ?? "—").slice(0, 160)}`;
    })
    .join("\n");
}

export async function generateBriefingMarkdownFromArticles(
  articles: NewsArticle[],
  options?: {
    extraInstruction?: string | null;
    /** 非空时整条作为 system，不再拼接默认模板与 extraInstruction */
    systemPromptOverride?: string | null;
  }
): Promise<string> {
  if (articles.length === 0) {
    return "## 过去 24 小时资讯简报\n\n当前时段内没有新入库文章。";
  }

  const lines = formatBriefingArticleLines(articles);
  const system =
    options?.systemPromptOverride?.trim() ||
    buildBriefingSystemPrompt(options?.extraInstruction ?? null);
  const resp = await invokeLLM({
    messages: [
      {
        role: "system",
        content: system,
      },
      {
        role: "user",
        content: `共 ${articles.length} 篇新入库（过去约 24 小时），请写晨报：\n\n${lines}`,
      },
    ],
  });

  const raw = resp.choices?.[0]?.message?.content;
  return typeof raw === "string" && raw.trim()
    ? raw.trim()
    : "## 简报\n\n生成失败，请稍后重试。";
}
