import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

/** 与 MySQL `TEXT` 上限接近，避免插入失败 */
const MAX_STORED_BODY_CHARS = 62_000;

export type ExtractedArticle = {
  title: string | null;
  /** Readability 解析到的作者行（若有） */
  byline: string | null;
  /** 从 HTML 解析出的正文纯文本（唯一可信正文来源） */
  text: string;
  excerpt: string | null;
  truncated: boolean;
};

function stripAndCollapseWhitespace(s: string): string {
  return s.replace(/[\u00a0\t\n\r ]+/g, " ").trim();
}

function htmlStringToPlainText(html: string): string {
  const frag = new JSDOM(html).window.document;
  const root = frag.body ?? frag.documentElement;
  return stripAndCollapseWhitespace(root?.textContent ?? "");
}

function fallbackBodyText(html: string): string {
  const d = new JSDOM(html).window.document;
  d.querySelectorAll("script,style,noscript,iframe,svg").forEach((el) => {
    el.remove();
  });
  const t = d.body?.textContent ?? "";
  return stripAndCollapseWhitespace(t);
}

/**
 * 使用 Mozilla Readability 从 HTML 提取正文（模拟浏览器可读内容抽取，非执行 JS）。
 * 若 SPA/强反爬导致正文为空，请改用带 Cookie 的抓取或后续接入无头浏览器。
 */
export function extractArticleFromHtml(html: string, pageUrl: string): ExtractedArticle {
  const dom = new JSDOM(html, { url: pageUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (article) {
    let raw =
      (article.textContent && article.textContent.trim()) ||
      (typeof article.content === "string" ? htmlStringToPlainText(article.content) : "");
    if (!raw.trim()) {
      raw = fallbackBodyText(html);
    }
    if (raw.trim().length > 0) {
      let out = stripAndCollapseWhitespace(raw);
      let truncated = false;
      if (out.length > MAX_STORED_BODY_CHARS) {
        out = out.slice(0, MAX_STORED_BODY_CHARS);
        truncated = true;
      }
      return {
        title: article.title?.trim() || null,
        byline: article.byline?.trim() || null,
        text: out,
        excerpt: article.excerpt?.trim() || null,
        truncated,
      };
    }
  }

  const fallback = fallbackBodyText(html);
  let out = fallback;
  let truncated = false;
  if (out.length > MAX_STORED_BODY_CHARS) {
    out = out.slice(0, MAX_STORED_BODY_CHARS);
    truncated = true;
  }

  const d2 = new JSDOM(html, { url: pageUrl }).window.document;
  const titleEl =
    d2.querySelector("h1")?.textContent?.trim() ||
    d2.querySelector("title")?.textContent?.trim() ||
    null;

  return {
    title: titleEl,
    byline: null,
    text: out,
    excerpt: null,
    truncated,
  };
}

const PUB_YEAR_MIN = 1995;
const PUB_YEAR_MAX = 2036;

function isReasonableArticleDate(d: Date): boolean {
  const t = d.getTime();
  if (Number.isNaN(t)) return false;
  const y = d.getUTCFullYear();
  return y >= PUB_YEAR_MIN && y <= PUB_YEAR_MAX;
}

/** 将 YYYY-MM-DD 或常见 ISO 串解析为 UTC 正午，减少时区导致的「差一天」 */
function parseLooseDateString(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  const isoDay = /^\d{4}-\d{2}-\d{2}$/;
  const d = new Date(isoDay.test(s) ? `${s}T12:00:00.000Z` : s);
  return isReasonableArticleDate(d) ? d : null;
}

function collectJsonLdNodes(obj: unknown, out: Record<string, unknown>[]): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((x) => collectJsonLdNodes(x, out));
    return;
  }
  const o = obj as Record<string, unknown>;
  out.push(o);
  const graph = o["@graph"];
  if (Array.isArray(graph)) {
    graph.forEach((g) => collectJsonLdNodes(g, out));
  }
  for (const k of ["mainEntity", "about"]) {
    const v = o[k];
    if (v && typeof v === "object") collectJsonLdNodes(v, out);
  }
}

function firstDateFromJsonLdScripts(doc: Document): Date | null {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts.item(i);
    const txt = script.textContent?.trim();
    if (!txt) continue;
    let data: unknown;
    try {
      data = JSON.parse(txt);
    } catch {
      continue;
    }
    const nodes: Record<string, unknown>[] = [];
    collectJsonLdNodes(data, nodes);
    for (let j = 0; j < nodes.length; j++) {
      const node = nodes[j]!;
      for (const key of ["datePublished", "dateCreated", "uploadDate"]) {
        const v = node[key];
        if (typeof v === "string") {
          const d = parseLooseDateString(v);
          if (d) return d;
        }
      }
    }
  }
  return null;
}

/**
 * 从文章页 HTML 尽量提取「发布日期」（meta / JSON-LD / time / URL 路径），供列表 `publishedAt` 使用。
 */
export function extractPublishedDateFromHtml(html: string, pageUrl: string): Date | null {
  const dom = new JSDOM(html, { url: pageUrl }).window.document;

  const metaPairs: Array<[string, string]> = [
    ["property", "article:published_time"],
    ["property", "og:published_time"],
    ["property", "article:modified_time"],
    ["name", "pubdate"],
    ["name", "publishdate"],
    ["name", "date"],
    ["itemprop", "datePublished"],
  ];
  for (const [attr, val] of metaPairs) {
    const el = dom.querySelector(`meta[${attr}="${val}"]`) as HTMLMetaElement | null;
    const content = el?.getAttribute("content")?.trim();
    if (content) {
      const d = parseLooseDateString(content);
      if (d) return d;
    }
  }

  const timeDt = dom.querySelector("time[datetime]")?.getAttribute("datetime")?.trim();
  if (timeDt) {
    const d = parseLooseDateString(timeDt);
    if (d) return d;
  }

  const fromLd = firstDateFromJsonLdScripts(dom);
  if (fromLd) return fromLd;

  try {
    const u = new URL(pageUrl);
    const m = u.pathname.match(
      /\/(19\d{2}|20\d{2})[\/-](0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])\b/
    );
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const da = Number(m[3]);
      const d = new Date(Date.UTC(y, mo - 1, da, 12, 0, 0));
      if (isReasonableArticleDate(d)) return d;
    }
  } catch {
    /* ignore */
  }

  return null;
}

/** LLM 返回的 publishedAt（可为 null）；空串视为 null */
export function parseLlmPublishedAtField(raw: unknown): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return parseLooseDateString(s);
}

/**
 * 合并页面解析、模型输出与重导兜底，得到写入 `newsArticles.publishedAt` 的值。
 */
export function resolveImportPublishedAt(args: {
  htmlDate: Date | null;
  llmDate: Date | null;
  /** 原地更新且页面/模型均无可靠日期时沿用库内原值 */
  replaceFallback?: Date | null;
}): Date {
  if (args.htmlDate && isReasonableArticleDate(args.htmlDate)) return args.htmlDate;
  if (args.llmDate && isReasonableArticleDate(args.llmDate)) return args.llmDate;
  if (args.replaceFallback && isReasonableArticleDate(args.replaceFallback)) {
    return args.replaceFallback;
  }
  return new Date();
}
