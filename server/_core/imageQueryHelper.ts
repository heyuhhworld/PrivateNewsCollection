import { searchReadingImages } from "../db";

const IMAGE_QUERY_RE =
  /图片|截图|截屏|图表|图像|图形|保存的图|存图|图中|图里|剪藏.*图|看.*图/;

export function isImageRelatedQuery(msg: string): boolean {
  return IMAGE_QUERY_RE.test(msg);
}

export function extractImageSearchKeywords(msg: string): string {
  return msg
    .replace(/请|帮我|给我|看看|找找|搜索|查找|有没有|的?图片|的?截图|的?截屏/g, "")
    .trim()
    .slice(0, 100) || msg.slice(0, 60);
}

export async function buildImageContextBlock(
  query: string,
  opts?: { articleId?: number; userId?: number; siteOrigin?: string },
): Promise<{ block: string; imageUrls: { url: string; desc: string }[] }> {
  const keywords = extractImageSearchKeywords(query);
  const imgs = await searchReadingImages(keywords, {
    articleId: opts?.articleId,
    userId: opts?.userId,
    limit: 6,
  });
  if (imgs.length === 0) return { block: "", imageUrls: [] };

  const base = opts?.siteOrigin ?? "";
  const imageUrls = imgs.map((img) => ({
    url: `${base}/uploads/news/${img.storageKey}`,
    desc: img.analysisText ?? img.caption ?? "图片",
  }));

  const lines = imgs.map((img, i) => {
    const url = `${base}/uploads/news/${img.storageKey}`;
    const tags = img.analysisTags?.join("、") ?? "";
    return (
      `[图片${i + 1}] 文章ID:${img.articleId} | URL:${url}\n` +
      `内容描述: ${img.analysisText ?? "（未分析）"}\n` +
      `标签: ${tags || "无"}\n` +
      `用户标注: ${img.caption ?? "无"}`
    );
  });

  const block =
    `\n【相关图片数据】以下是与用户问题匹配的已保存图片。回答时请使用 markdown 图片语法 ![描述](url) 展示相关图片。\n` +
    lines.join("\n\n");

  return { block, imageUrls };
}
