import path from "path";
import { eq } from "drizzle-orm";
import { invokeLLM } from "./llm";
import { getDb } from "../db";
import { articleReadingImages } from "../../drizzle/schema";

function buildImageUrl(storageKey: string): string {
  const abs = path.resolve(process.cwd(), "uploads", "news", storageKey);
  return `file://${abs}`;
}

export async function analyzeReadingImage(imageId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const rows = await db
    .select()
    .from(articleReadingImages)
    .where(eq(articleReadingImages.id, imageId))
    .limit(1);
  const img = rows[0];
  if (!img) return;
  if (img.analysisText) return;

  const imgPath = path.resolve(
    process.cwd(),
    "uploads",
    "news",
    img.storageKey,
  );

  let base64: string;
  try {
    const fs = await import("fs");
    const buf = fs.readFileSync(imgPath);
    base64 = buf.toString("base64");
  } catch {
    return;
  }

  const dataUrl = `data:image/png;base64,${base64}`;

  try {
    const resp = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "你是图片内容分析助手。请仔细观察图片，输出以下 JSON：\n" +
            '{"description": "图片内容的详细中文描述（200字以内）", "tags": ["标签1","标签2",...], "keyData": "图中的关键数据和数字（若有）"}\n' +
            "标签应包含：图表类型（如柱状图/表格/截图/流程图）、涉及主题、关键实体。tags 至少2个最多8个。",
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "high" },
            },
            {
              type: "text",
              text: `请分析这张图片。来源文章ID: ${img.articleId}${img.caption ? `，用户标注: ${img.caption}` : ""}${img.sourcePage ? `，PDF第${img.sourcePage}页` : ""}`,
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "image_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              description: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              keyData: { type: "string" },
            },
            required: ["description", "tags", "keyData"],
            additionalProperties: false,
          },
        },
      },
    } as any);

    const raw = resp.choices?.[0]?.message?.content;
    if (!raw) return;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

    const analysisText = [
      parsed.description ?? "",
      parsed.keyData ? `关键数据：${parsed.keyData}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const tags: string[] = Array.isArray(parsed.tags)
      ? parsed.tags.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 8)
      : [];

    await db
      .update(articleReadingImages)
      .set({ analysisText, analysisTags: tags.length > 0 ? tags : null })
      .where(eq(articleReadingImages.id, imageId));
  } catch (e) {
    console.error("[imageAnalysis]", imageId, e instanceof Error ? e.message : e);
  }
}

export function scheduleImageAnalysis(imageId: number): void {
  setTimeout(() => {
    analyzeReadingImage(imageId).catch((e) =>
      console.error("[imageAnalysis:schedule]", e),
    );
  }, 2000);
}
