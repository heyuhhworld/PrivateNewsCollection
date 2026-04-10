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
