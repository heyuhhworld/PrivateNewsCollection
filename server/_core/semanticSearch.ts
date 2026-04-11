import type { NewsArticle } from "../../drizzle/schema";
import { getNewsArticles, listNewsArticlesWithEmbeddings } from "../db";
import { createEmbedding } from "./embedding";

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/** 关键词回退（与旧版 chat 逻辑一致） */
export async function keywordRankArticles(
  question: string,
  opts: { limit: number }
): Promise<NewsArticle[]> {
  const { items } = await getNewsArticles({ pageSize: 30 });
  if (items.length === 0) return [];
  const q = question.toLowerCase();
  const keywords = q.split(/\s+/).filter((w) => w.length > 1);
  const scored = items.map((article) => {
    const text = [
      article.title,
      article.summary ?? "",
      article.content ?? "",
      article.strategy ?? "",
      article.region ?? "",
      ((article.tags as string[] | null) ?? []).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score++;
    }
    return { article, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit).map((s) => s.article);
}

export type SemanticSearchOptions = {
  limit?: number;
  excludeIds?: number[];
  /** 无可用向量时是否回退关键词 */
  fallbackKeyword?: boolean;
};

/**
 * 语义检索可见资讯；无 embedding 或未配置 API 时可选回退关键词。
 */
export async function semanticSearchArticles(
  query: string,
  options: SemanticSearchOptions = {}
): Promise<NewsArticle[]> {
  const limit = options.limit ?? 8;
  const exclude = new Set(options.excludeIds ?? []);

  try {
    const queryVec = await createEmbedding(query.trim().slice(0, 2000));
    const rows = await listNewsArticlesWithEmbeddings(5000);
    const scored: { article: NewsArticle; score: number }[] = [];
    for (const article of rows) {
      if (exclude.has(article.id)) continue;
      const emb = article.embedding;
      if (!Array.isArray(emb) || emb.length === 0) continue;
      const score = cosineSimilarity(queryVec, emb as number[]);
      scored.push({ article, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit).map((s) => s.article);
    if (top.length > 0) return top;
  } catch (e) {
    console.warn("[semanticSearchArticles]", e);
  }

  if (options.fallbackKeyword !== false) {
    const kw = await keywordRankArticles(query, { limit });
    return kw.filter((a) => !exclude.has(a.id));
  }
  return [];
}

/** 用若干篇文章的 embedding 求平均，再与库内文章比相似度 */
export async function recommendByEmbeddingCentroid(
  seedArticles: NewsArticle[],
  opts: { limit: number; excludeIds: number[] }
): Promise<NewsArticle[]> {
  const seeds = seedArticles.filter(
    (a) => Array.isArray(a.embedding) && (a.embedding as number[]).length > 0
  );
  if (seeds.length === 0) return [];
  const dim = (seeds[0].embedding as number[]).length;
  const sum = new Array(dim).fill(0);
  for (const a of seeds) {
    const v = a.embedding as number[];
    for (let i = 0; i < dim; i++) sum[i] += v[i] ?? 0;
  }
  for (let i = 0; i < dim; i++) sum[i] /= seeds.length;

  const exclude = new Set(opts.excludeIds);
  const rows = await listNewsArticlesWithEmbeddings(5000);
  const scored: { article: NewsArticle; score: number }[] = [];
  for (const article of rows) {
    if (exclude.has(article.id)) continue;
    const emb = article.embedding;
    if (!Array.isArray(emb) || emb.length !== dim) continue;
    scored.push({
      article,
      score: cosineSimilarity(sum, emb as number[]),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit).map((s) => s.article);
}
