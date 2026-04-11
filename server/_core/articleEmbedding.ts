import type { NewsArticle } from "../../drizzle/schema";
import { getNewsArticleById, updateNewsArticleEmbedding } from "../db";
import { createEmbedding } from "./embedding";

/** 用于向量化的文本：标题 + 摘要 + 关键要点 */
export function buildArticleEmbeddingInput(article: NewsArticle): string {
  const parts: string[] = [article.title, article.summary ?? ""];
  const ki = article.keyInsights;
  if (Array.isArray(ki) && ki.length > 0) {
    parts.push(
      ki
        .map((x) => `${String(x.label ?? "").trim()}: ${String(x.value ?? "").trim()}`)
        .join(" | ")
    );
  }
  return parts.join("\n").trim().slice(0, 8000);
}

export async function embedAndStoreArticleById(id: number): Promise<void> {
  const article = await getNewsArticleById(id);
  if (!article) return;
  const text = buildArticleEmbeddingInput(article);
  if (!text) return;
  const vec = await createEmbedding(text);
  await updateNewsArticleEmbedding(id, vec);
}

/** 异步触发，不阻塞主流程 */
export function scheduleArticleEmbedding(id: number): void {
  void embedAndStoreArticleById(id).catch((e) => {
    console.warn("[scheduleArticleEmbedding]", id, e);
  });
}
