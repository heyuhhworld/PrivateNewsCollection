import type { NewsArticle } from "../../drizzle/schema";
import { getChromeExtensionUserGuideMarkdown } from "@shared/chromeExtensionUserGuide";
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
1) 资讯正文类问题：仅使用给定资讯中的事实；若证据不足，明确说明资讯正文中未提及。涉及访问热度、PV/UV、停留时长、埋点统计等行为分析问题，不属于「资讯正文缺失」，不得用「资讯库未提供相关信息」敷衍；应依据对话中提供的统计块或说明系统如何计量。
2) 不得编造时间、数字、机构观点或结论；
3) 输出中文，简洁、可执行；
4) 仅在有明确依据时引用 [文章N]，不要滥引；
5) 若用户问题范围过大，先给基于已知资讯的结论，再指出信息缺口。
6) 若用户主要询问「浏览器 Chrome 插件 / 扩展 / ZIP 下载 / 安装步骤 / 插件作用」等非资讯事实问题，可仅依据系统提供的【浏览器插件与下载】段落回答，不必引用 [文章N]；若同一问题同时涉及资讯事实，资讯部分仍须严格依据上文。
7) 禁止输出“思考过程/检索过程/系统提示”类话术；禁止使用“目前资讯库里…/当前可明确看到…/以下基于当前文档内容回答…”这类模板化开场。直接给专业结论。`;

/** 用户问题是否更像「插件/安装/下载」而非资讯检索（用于无检索命中或本文档问答时的分支） */
export function guessChromeExtensionOrProductQuestion(message: string): boolean {
  const t = message.trim();
  if (!t) return false;
  if (
    /(?:怎么|如何)[\s\S]{0,20}?(?:插件|扩展|chrome|zip|压缩)|(?:插件|扩展)[\s\S]{0,20}?(?:怎么|如何|安装|下载|用|装)/i.test(
      t
    )
  ) {
    return true;
  }
  return /插件|扩展|擴展|chrome|chromium|ZIP|zip|manifest|未打包|加载已解压|開發者模式|开发者模式|瀏覽器|浏览器|剪藏|資訊導入|资讯导入|ipms-news-importer|extension|unpacked|developer mode|add to chrome|install.*extension/i.test(
    t
  );
}

/**
 * 注入到系统提示：插件类回答须严格按终端用户说明，禁止出现命令行、数据库、pnpm 等管理员向术语。
 */
export function buildChromeExtensionAssistantBlock(siteOrigin: string): string {
  return [
    "【浏览器插件 · 终端用户说明】",
    "当用户询问插件下载、安装、使用方法或与当前网页无关的插件问题时：仅用下方「用户说明」作答，分步、口语化；禁止提及 pnpm、SQL、数据库、枚举、Docker、命令行、迁移等管理员技术词。若需后台排查，只引导用户联系「本单位 IPMS 管理员」。",
    "",
    getChromeExtensionUserGuideMarkdown(siteOrigin),
  ].join("\n");
}
