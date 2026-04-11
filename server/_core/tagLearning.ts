import { getRecentTagCorrections } from "../db";

/**
 * 从最近的标签修正记录中构建 LLM few-shot 示例片段，
 * 注入到文章导入 prompt 中以持续优化分类质量。
 */
export async function buildTagCorrectionContext(limit = 30): Promise<string> {
  const corrections = await getRecentTagCorrections(limit);
  if (corrections.length === 0) return "";

  const lines: string[] = [
    "【历史标签修正参考】以下是用户对 AI 分类结果的修正，请在本次分类时参考这些偏好：",
  ];

  for (const c of corrections) {
    const field =
      c.fieldName === "tags"
        ? "标签"
        : c.fieldName === "strategy"
          ? "策略"
          : "地区";
    lines.push(
      `- 文章 #${c.articleId} 的「${field}」: "${c.oldValue ?? "(空)"}" → "${c.newValue ?? "(空)"}"`
    );
  }

  return lines.join("\n");
}
