/**
 * 将 LLM 返回的 strategy/region 等归一为 news_articles 表可接受的枚举值，避免 MySQL 拒写。
 */
export const NEWS_STRATEGY_VALUES = [
  "私募股权",
  "风险投资",
  "房地产",
  "信贷",
  "基础设施",
  "对冲基金",
  "母基金",
  "并购",
  "成长股权",
  "其他",
] as const;

export const NEWS_REGION_VALUES = [
  "全球",
  "亚太",
  "北美",
  "欧洲",
  "中国",
  "东南亚",
  "中东",
  "其他",
] as const;

export type NewsStrategyEnum = (typeof NEWS_STRATEGY_VALUES)[number];
export type NewsRegionEnum = (typeof NEWS_REGION_VALUES)[number];

const STRATEGY_SET = new Set<string>(NEWS_STRATEGY_VALUES);
const REGION_SET = new Set<string>(NEWS_REGION_VALUES);

export function normalizeNewsStrategy(v: unknown): NewsStrategyEnum | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "null") return null;
  return STRATEGY_SET.has(s) ? (s as NewsStrategyEnum) : null;
}

export function normalizeNewsRegion(v: unknown): NewsRegionEnum | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "null") return null;
  return REGION_SET.has(s) ? (s as NewsRegionEnum) : null;
}

export function normalizePublishedAt(v: unknown): Date {
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) {
      const d = new Date(m[1] + "T12:00:00.000Z");
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return new Date();
}

export function sanitizeNewsTags(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out = v
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, 20);
  return out.length > 0 ? out : null;
}

export function sanitizeNewsSections(
  v: unknown
): { heading: string; body: string }[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: { heading: string; body: string }[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const heading = String(o.heading ?? "").trim();
    const body = String(o.body ?? "").trim();
    if (heading || body) out.push({ heading: heading || "章节", body });
  }
  return out.length > 0 ? out : null;
}

/** 开发占位用户 id=0 时不要写入外键列，避免异常 */
export function normalizeUploaderUserId(userId: number | undefined | null): number | null {
  if (userId == null || !Number.isFinite(userId) || userId <= 0) return null;
  return userId;
}
