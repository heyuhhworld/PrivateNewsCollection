import { getArticlesByUploader } from "../db";

type TimeRange = { from: Date; to: Date; label: string };

function parseTimeRange(question: string): TimeRange {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setHours(23, 59, 59, 999);

  if (/今[日天]/.test(question)) {
    return { from: todayStart, to: todayEnd, label: "今日" };
  }
  if (/昨[日天]/.test(question)) {
    const d = new Date(todayStart);
    d.setDate(d.getDate() - 1);
    const dEnd = new Date(d);
    dEnd.setHours(23, 59, 59, 999);
    return { from: d, to: dEnd, label: "昨日" };
  }
  if (/本周/.test(question)) {
    const d = new Date(now);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    d.setHours(0, 0, 0, 0);
    return { from: d, to: todayEnd, label: "本周" };
  }
  if (/本月/.test(question)) {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: d, to: todayEnd, label: "本月" };
  }
  const recent = question.match(/最近\s*(\d+)\s*天/);
  if (recent) {
    const n = Math.max(1, Math.min(Number(recent[1]), 365));
    const d = new Date(todayStart);
    d.setDate(d.getDate() - n + 1);
    return { from: d, to: todayEnd, label: `最近 ${n} 天` };
  }
  return { from: todayStart, to: todayEnd, label: "今日" };
}

const TRIGGER_RE =
  /我.{0,4}(导入|上传|提交|录入|添加).{0,6}(资讯|报告|文章|内容|文件)|我的.{0,4}(资讯|报告|文章).{0,4}(汇总|总结|列表|有哪些|多少)/;

function shouldHandle(question: string): boolean {
  return TRIGGER_RE.test(question);
}

export async function maybeBuildMyArticlesAnswer(
  question: string,
  userId?: number | null,
): Promise<string | null> {
  if (!shouldHandle(question)) return null;
  if (!userId) {
    return "请先登录后再查询您导入的资讯。";
  }

  const range = parseTimeRange(question);
  const articles = await getArticlesByUploader({
    uploaderUserId: userId,
    dateFrom: range.from,
    dateTo: range.to,
    limit: 50,
  });

  if (articles.length === 0) {
    return `## 我的导入记录（${range.label}）\n\n${range.label}暂无您导入的资讯或报告。`;
  }

  const reports = articles.filter((a) => a.recordCategory === "report");
  const news = articles.filter((a) => a.recordCategory !== "report");

  const lines: string[] = [`## 我的导入记录（${range.label}，共 ${articles.length} 篇）`];
  lines.push("");

  if (reports.length > 0) {
    lines.push(`### 报告（${reports.length} 篇）`);
    lines.push("");
    for (const a of reports) {
      const tags = [a.strategy, a.region].filter(Boolean).join(" · ");
      const tagSuffix = tags ? ` · ${tags}` : "";
      const summary = a.summary ? ` — ${a.summary.slice(0, 80)}${a.summary.length > 80 ? "…" : ""}` : "";
      lines.push(`- [${a.title}](/news/${a.id}?entry=chat)${tagSuffix}${summary}`);
    }
    lines.push("");
  }

  if (news.length > 0) {
    lines.push(`### 资讯（${news.length} 篇）`);
    lines.push("");
    for (const a of news) {
      const tags = [a.strategy, a.region].filter(Boolean).join(" · ");
      const tagSuffix = tags ? ` · ${tags}` : "";
      const summary = a.summary ? ` — ${a.summary.slice(0, 80)}${a.summary.length > 80 ? "…" : ""}` : "";
      lines.push(`- [${a.title}](/news/${a.id}?entry=chat)${tagSuffix}${summary}`);
    }
    lines.push("");
  }

  const strategyDist = new Map<string, number>();
  for (const a of articles) {
    const s = a.strategy ?? "未分类";
    strategyDist.set(s, (strategyDist.get(s) ?? 0) + 1);
  }
  if (strategyDist.size > 1) {
    lines.push("### 策略分布");
    lines.push("");
    for (const [s, c] of Array.from(strategyDist.entries()).sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${s}：${c} 篇`);
    }
    lines.push("");
  }

  lines.push("> 点击标题可查看详情。如需进一步了解某篇内容，可直接提问。");

  return lines.join("\n");
}
