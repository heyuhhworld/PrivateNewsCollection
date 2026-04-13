import { getHotViewAnalytics } from "../db";

type TimeRange = { from: Date; to: Date; label: string };

function parseTimeRange(question: string): TimeRange {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const m = question.match(/(\d{4}-\d{1,2}-\d{1,2})\s*(?:到|至|~|-)\s*(\d{4}-\d{1,2}-\d{1,2})/);
  if (m) {
    const from = new Date(`${m[1]}T00:00:00`);
    const to = new Date(`${m[2]}T23:59:59.999`);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
      return { from, to, label: `${m[1]} ~ ${m[2]}` };
    }
  }

  const recent = question.match(/最近\s*(\d+)\s*天/);
  if (recent) {
    const n = Math.max(1, Math.min(Number(recent[1]), 365));
    const from = new Date(now);
    from.setDate(from.getDate() - n + 1);
    from.setHours(0, 0, 0, 0);
    return { from, to: end, label: `最近 ${n} 天` };
  }

  if (question.includes("本周")) {
    const d = new Date(now);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    d.setHours(0, 0, 0, 0);
    return { from: d, to: end, label: "本周" };
  }

  if (question.includes("本月")) {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    d.setHours(0, 0, 0, 0);
    return { from: d, to: end, label: "本月" };
  }

  const from = new Date(now);
  from.setDate(from.getDate() - 29);
  from.setHours(0, 0, 0, 0);
  return { from, to: end, label: "最近 30 天" };
}

function shouldHandle(question: string): boolean {
  const q = question.toLowerCase();
  const hasHot = /热[度点]|最热|热门|访问量|浏览量|查看量|阅读量|点击量/.test(q);
  const hasStats = /统计|排[名行]|top\s*\d|多少人|几个人|用户[数量]|查看[过了]|阅读[过了]|平均|人[次数]/.test(q);
  const hasRange = /最近\s*\d+\s*天|本周|本月|\d{4}-\d{1,2}-\d{1,2}\s*(到|至|~|-)\s*\d{4}-\d{1,2}-\d{1,2}|时间区间|时间段/.test(q);
  const hasDist = /分布|入口|通过问答|通过资讯列表|chat|列表/.test(q);
  const behaviorMetrics =
    /\bpv\b|\buv\b|埋点|行为统计|访问人次|停留|查看时间|阅读时长|页面访问|表格展示|制表|数据报表/.test(q);
  return (
    (hasHot && (hasStats || hasRange || hasDist)) ||
    (behaviorMetrics &&
      (hasStats || hasRange || hasDist || /统计|分析|汇总|表格|列出|哪些|帮我|数值/.test(q)))
  );
}

function parseMinViews(question: string): number {
  const m = question.match(/热[度点][值]?\s*(?:在|>|>=|大于|超过|不低于)\s*(\d+)/);
  if (m) return Math.max(1, Number(m[1]));
  const m2 = question.match(/(\d+)\s*以上/);
  if (m2 && /热[度点]/.test(question)) return Math.max(1, Number(m2[1]));
  return 0;
}

function parseLimit(question: string): number {
  const m = question.match(/top\s*(\d+)/i);
  if (m) return Math.max(1, Math.min(Number(m[1]), 30));
  return 15;
}

export async function maybeBuildHotAnalyticsAnswer(
  question: string
): Promise<string | null> {
  if (!shouldHandle(question)) return null;
  const range = parseTimeRange(question);
  const minViews = parseMinViews(question);
  const limit = parseLimit(question);
  const out = await getHotViewAnalytics({
    dateFrom: range.from,
    dateTo: range.to,
    limit,
    minViews,
  });
  if (out.topArticles.length === 0) {
    const hint = minViews > 0 ? `（筛选条件：热度 ≥ ${minViews}）` : "";
    return `## 热度统计${hint}\n\n暂无符合条件的文章。`;
  }

  const total =
    out.overallByEntry.list + out.overallByEntry.chat + out.overallByEntry.other;
  const pct = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "0%");

  const header = minViews > 0
    ? `## 热度 ≥ ${minViews} 的文章（共 ${out.topArticles.length} 篇）`
    : `## 热度与访问行为（${range.label}）`;

  const tableRows = out.topArticles.map((x) => {
    const title = x.title.replace(/\|/g, "/");
    return `| [${title}](/news/${x.articleId}?entry=chat) | ${x.total} | ${x.periodPv} | ${x.uniqueViewers} | ${x.avgDwellSec} |`;
  });
  const tableBlock = [
    "",
    "| 文章 | 热度🔥(累计，与列表一致) | 区间内PV | UV | 平均查看(秒) |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...tableRows,
    "",
    "说明：**PV**=所选时间内 `article_view_daily` 记录数（同一用户同一天同一篇计 1 次）；**UV**=去重访客（登录用户或会话）；**平均查看**=停留埋点累计秒数÷区间内PV（报告/PDF 页每约10秒上报一次停留）。",
    "",
  ];

  const lines = out.topArticles.map((x, idx) => {
    const s = x.byEntry;
    const viewerPart = x.uniqueViewers > 0 ? `，UV ${x.uniqueViewers}` : "";
    const entryParts: string[] = [];
    if (s.list > 0) entryParts.push(`列表 ${s.list}`);
    if (s.chat > 0) entryParts.push(`问答 ${s.chat}`);
    if (s.other > 0) entryParts.push(`其他 ${s.other}`);
    const entryPart = entryParts.length > 0 ? `（${entryParts.join(" / ")}）` : "";
    return `${idx + 1}. [${x.title}](/news/${x.articleId}?entry=chat) — 🔥 **${x.total}** · 区间内PV **${x.periodPv}**${viewerPart} · 均停留 **${x.avgDwellSec}s**${entryPart}`;
  });

  const sections = [header, ...tableBlock, "### 条目列表", "", ...lines];

  if (total > 0) {
    sections.push(
      "",
      `### 进入方式分布（${range.label}）`,
      "",
      `- 通过资讯列表：${out.overallByEntry.list}（${pct(out.overallByEntry.list)}）`,
      `- 通过问答引用：${out.overallByEntry.chat}（${pct(out.overallByEntry.chat)}）`,
      `- 其他入口：${out.overallByEntry.other}（${pct(out.overallByEntry.other)}）`,
    );
  }

  sections.push(
    "",
    "> **热度🔥**与资讯列表一致；**PV/UV/停留**来自访问与详情页埋点，不是正文检索。无停留数据时平均查看可能为 0。"
  );

  return sections.join("\n");
}

