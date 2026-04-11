import type { NewsArticle } from "../../drizzle/schema";
import { semanticSearchArticles } from "./semanticSearch";

const CONTEXT_SLICE = 1500;

/** 资讯库问答：语义检索（失败回退关键词），最多 5 篇 */
export async function resolveRelevantArticlesForChat(question: string): Promise<NewsArticle[]> {
  return semanticSearchArticles(question, { limit: 5, fallbackKeyword: true });
}

export function buildNewsContextBlock(articles: NewsArticle[]): string {
  return articles
    .map(
      (n, i) =>
        `[文章${i + 1}] ID:${n.id} | 来源:${n.source} | 标题:${n.title}\n` +
        `摘要: ${n.summary ?? ""}\n` +
        `详细内容: ${(n.content ?? "").slice(0, CONTEXT_SLICE)}\n` +
        `策略: ${n.strategy ?? "—"} | 地区: ${n.region ?? "—"} | 发布: ${n.publishedAt.toISOString().slice(0, 10)}`
    )
    .join("\n\n---\n\n");
}

export function buildArticleRefMap(
  articles: NewsArticle[]
): Record<string, { id: number; title: string }> {
  return articles.reduce(
    (acc, n, i) => {
      acc[`文章${i + 1}`] = { id: n.id, title: n.title };
      return acc;
    },
    {} as Record<string, { id: number; title: string }>
  );
}

export function appendCitedArticleLinks(
  assistantContent: string,
  articleRefMap: Record<string, { id: number; title: string }>,
  origin: string | undefined
): string {
  const citedRefs = new Set<string>();
  for (const ref of Object.keys(articleRefMap)) {
    const n = ref.replace(/^文章/, "");
    const patterns = [`[${ref}]`, `[文章 ${n}]`, `[文章${n}]`];
    if (patterns.some((p) => assistantContent.includes(p))) {
      citedRefs.add(ref);
    }
  }
  if (citedRefs.size === 0) return assistantContent;
  const baseUrl = origin ?? "";
  const linkLines = Array.from(citedRefs)
    .sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const nb = parseInt(b.replace(/\D/g, ""), 10) || 0;
      return na - nb;
    })
    .map((ref) => {
      const { id, title } = articleRefMap[ref];
      const url = `${baseUrl}/news/${id}`;
      return `- [${title}](${url})`;
    });
  return assistantContent + "\n\n---\n**相关资讯链接：**\n" + linkLines.join("\n");
}

export function collectCitationsFromAnswer(
  assistantContent: string,
  articleRefMap: Record<string, { id: number; title: string }>
): { refKey: string; articleId: number; title: string }[] {
  const cited = new Set<string>();
  for (const ref of Object.keys(articleRefMap)) {
    const n = ref.replace(/^文章/, "");
    const patterns = [`[${ref}]`, `[文章 ${n}]`, `[文章${n}]`];
    if (patterns.some((p) => assistantContent.includes(p))) {
      cited.add(ref);
    }
  }
  const out: { refKey: string; articleId: number; title: string }[] = [];
  for (const ref of Array.from(cited).sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ""), 10) || 0;
    const nb = parseInt(b.replace(/\D/g, ""), 10) || 0;
    return na - nb;
  })) {
    const meta = articleRefMap[ref];
    if (meta) {
      out.push({ refKey: ref, articleId: meta.id, title: meta.title });
    }
  }
  return out;
}

export const GLOBAL_CHAT_SYSTEM_RULES = `你是 IPMS 投资项目管理系统的智能资讯助手。你必须且只能基于提供的「相关资讯数据」回答，严禁使用外部知识、常识补充、猜测或发散推断。

回答规则（必须严格遵守）：
1) 仅使用给定资讯中的事实；若证据不足，明确回答“资讯库未提供相关信息”；
2) 不得编造时间、数字、机构观点或结论；
3) 输出中文，简洁、可执行；
4) 仅在有明确依据时引用 [文章N]，不要滥引；
5) 若用户问题范围过大，先给基于已知资讯的结论，再指出信息缺口。`;
