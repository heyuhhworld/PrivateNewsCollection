/**
 * 根据文章 URL 推断导入站点（用于 Referer、抓取策略、入库 `source` 等）。
 * 新增站点：在 `IMPORT_SOURCE_RULES` 追加规则，并确保 `importSingleArticle` / 库表 `source` 枚举已支持。
 */
export type UrlImportableSource = "Preqin" | "Pitchbook";

export type InferArticleImportSourceFromUrlResult =
  | { ok: true; source: UrlImportableSource }
  | { ok: false; message: string };

type SourceRule = {
  /** 便于排查与文档 */
  id: string;
  test: (hostname: string) => boolean;
  source: UrlImportableSource;
};

/** 自上而下匹配，先命中先生效 */
const IMPORT_SOURCE_RULES: SourceRule[] = [
  {
    id: "preqin",
    test: (h) => h === "preqin.com" || h.endsWith(".preqin.com"),
    source: "Preqin",
  },
  {
    id: "pitchbook",
    test: (h) => h === "pitchbook.com" || h.endsWith(".pitchbook.com"),
    source: "Pitchbook",
  },
];

function normalizeUrlForParse(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^www\./i.test(t)) return `https://${t}`;
  return null;
}

export function inferArticleImportSourceFromUrl(
  rawUrl: string
): InferArticleImportSourceFromUrlResult {
  const href = normalizeUrlForParse(rawUrl);
  if (!href) {
    return {
      ok: false,
      message: "链接为空或格式无效（需以 http(s):// 或 www. 开头）",
    };
  }
  let hostname = "";
  try {
    hostname = new URL(href).hostname.toLowerCase();
  } catch {
    return { ok: false, message: "链接格式无效" };
  }
  for (const rule of IMPORT_SOURCE_RULES) {
    if (rule.test(hostname)) {
      return { ok: true, source: rule.source };
    }
  }
  return {
    ok: false,
    message:
      "无法从链接识别来源。当前仅支持 Preqin、Pitchbook 域名；其他站点将陆续开放。",
  };
}
