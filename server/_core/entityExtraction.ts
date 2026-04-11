import { invokeLLM } from "./llm";
import {
  upsertEntity,
  linkEntityToArticle,
  upsertEntityRelation,
} from "../db";
import type { NewsArticle } from "../../drizzle/schema";

interface ExtractedEntity {
  name: string;
  type: "fund" | "institution" | "person" | "other";
  aliases?: string[];
}

interface ExtractedRelation {
  source: string;
  target: string;
  relation: string;
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

export async function extractEntitiesFromArticle(
  article: NewsArticle
): Promise<ExtractionResult> {
  const text = [
    article.title,
    article.summary ?? "",
    (article.keyInsights as { label: string; value: string }[] | null)
      ?.map((k) => `${k.label}: ${k.value}`)
      .join("\n") ?? "",
    (article.content ?? "").slice(0, 6000),
  ]
    .filter(Boolean)
    .join("\n\n");

  if (text.length < 50) return { entities: [], relations: [] };

  try {
    const resp = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `你是金融领域 NER（命名实体识别）专家。从给定文本中抽取实体与关系。
实体类型：fund（基金/策略产品）、institution（机构/公司/GP/LP）、person（人物）、other。
关系类型举例：manages（管理）、invests_in（投资）、works_at（任职）、acquires（收购）、partners_with（合作）、raises_fund（募资）、advises（顾问）。
返回 JSON：
{
  "entities": [{ "name": "...", "type": "fund|institution|person|other", "aliases": ["别名"] }],
  "relations": [{ "source": "实体名A", "target": "实体名B", "relation": "关系动词" }]
}
规则：
- 去重；同一实体仅出现一次
- 人名尽量用全称
- 仅抽取文中明确提及的关系
- 若无可识别实体则返回空数组`,
        },
        { role: "user", content: text },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "entity_extraction",
          strict: false,
          schema: {
            type: "object",
            properties: {
              entities: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    type: {
                      type: "string",
                      enum: ["fund", "institution", "person", "other"],
                    },
                    aliases: { type: "array", items: { type: "string" } },
                  },
                  required: ["name", "type"],
                },
              },
              relations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    source: { type: "string" },
                    target: { type: "string" },
                    relation: { type: "string" },
                  },
                  required: ["source", "target", "relation"],
                },
              },
            },
            required: ["entities", "relations"],
          },
        },
      },
    });

    const raw = resp.choices?.[0]?.message?.content;
    const parsed: ExtractionResult =
      typeof raw === "string" ? JSON.parse(raw) : (raw as any);

    if (!Array.isArray(parsed.entities)) parsed.entities = [];
    if (!Array.isArray(parsed.relations)) parsed.relations = [];
    return parsed;
  } catch (e) {
    console.warn("[EntityExtraction] LLM failed:", e);
    return { entities: [], relations: [] };
  }
}

export async function extractAndStoreEntities(
  article: NewsArticle
): Promise<void> {
  const { entities, relations } = await extractEntitiesFromArticle(article);
  if (entities.length === 0) return;

  const nameToId = new Map<string, number>();

  for (const ent of entities) {
    const id = await upsertEntity({
      name: ent.name.trim(),
      type: ent.type,
      aliases: ent.aliases?.filter(Boolean) ?? null,
    });
    if (id) {
      nameToId.set(ent.name.trim(), id);
      await linkEntityToArticle(id, article.id);
    }
  }

  for (const rel of relations) {
    const srcId = nameToId.get(rel.source.trim());
    const tgtId = nameToId.get(rel.target.trim());
    if (srcId && tgtId) {
      await upsertEntityRelation({
        sourceEntityId: srcId,
        targetEntityId: tgtId,
        relationType: rel.relation.trim(),
        articleId: article.id,
      });
    }
  }
}

export function scheduleEntityExtraction(articleId: number): void {
  setTimeout(async () => {
    try {
      const { getNewsArticleById } = await import("../db");
      const article = await getNewsArticleById(articleId);
      if (!article) return;
      await extractAndStoreEntities(article);
      console.log(`[EntityExtraction] Done for article #${articleId}`);
    } catch (e) {
      console.warn(`[EntityExtraction] Failed for article #${articleId}:`, e);
    }
  }, 3000);
}
