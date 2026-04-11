import { invokeLLM } from "./llm";

export type ParsedNewsIntent = {
  keyword?: string | null;
  source?: "Preqin" | "Pitchbook" | "Manual" | null;
  strategy?: string | null;
  region?: string | null;
  recordCategory?: "report" | "news" | null;
  /** 自然语言检索：仅语义、不应用结构化筛选 */
  semanticOnly?: boolean | null;
  datePreset?: "today" | "7d" | "30d" | "90d" | null;
};

const INTENT_SCHEMA = {
  name: "news_search_intent",
  strict: false,
  schema: {
    type: "object",
    properties: {
      keyword: { type: "string", description: "关键词，可空字符串" },
      source: { type: "string", enum: ["Preqin", "Pitchbook", "Manual", ""] },
      strategy: { type: "string" },
      region: { type: "string" },
      recordCategory: { type: "string", enum: ["report", "news", ""] },
      semanticOnly: { type: "boolean" },
      datePreset: { type: "string", enum: ["today", "7d", "30d", "90d", ""] },
    },
    required: [
      "keyword",
      "source",
      "strategy",
      "region",
      "recordCategory",
      "semanticOnly",
      "datePreset",
    ],
    additionalProperties: false,
  },
} as const;

export async function parseNewsSearchIntent(
  userText: string
): Promise<ParsedNewsIntent> {
  const trimmed = userText.trim().slice(0, 500);
  if (!trimmed) {
    return { semanticOnly: true };
  }
  const resp = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "将用户关于「找资讯/报告」的表述解析为结构化筛选。无法确定则对应字段填 null。semanticOnly 为 true 表示只适合语义搜索、不宜强套筛选。",
      },
      { role: "user", content: trimmed },
    ],
    response_format: { type: "json_schema", json_schema: INTENT_SCHEMA },
  } as any);
  const raw = resp.choices?.[0]?.message?.content;
  const obj =
    typeof raw === "string" ? JSON.parse(raw) : (raw as ParsedNewsIntent);
  const o = obj ?? { semanticOnly: true };
  const norm = (s: string | null | undefined) => {
    const t = (s ?? "").trim();
    return t.length ? t : null;
  };
  return {
    keyword: norm(o.keyword as string),
    source: norm(o.source as string) as ParsedNewsIntent["source"],
    strategy: norm(o.strategy as string) as ParsedNewsIntent["strategy"],
    region: norm(o.region as string) as ParsedNewsIntent["region"],
    recordCategory: norm(o.recordCategory as string) as ParsedNewsIntent["recordCategory"],
    semanticOnly: Boolean(o.semanticOnly),
    datePreset: norm(o.datePreset as string) as ParsedNewsIntent["datePreset"],
  };
}

export function dateRangeFromPreset(
  preset: ParsedNewsIntent["datePreset"]
): { dateFrom?: Date; dateTo?: Date } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  if (!preset) return {};
  if (preset === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { dateFrom: start, dateTo: end };
  }
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return { dateFrom: start, dateTo: end };
}
