import cron from "node-cron";
import { generateBriefingMarkdownFromArticles } from "./briefingGenerate";
import { ENV } from "./env";
import {
  insertAiBriefing,
  listRecentNewsArticlesSince,
  listBriefingSubscriptions,
  mergeDuplicateEntitiesByMatchKey,
} from "../db";
import { sendMail, isMailerConfigured } from "./mailer";

async function generateBriefingBody(): Promise<{
  body: string;
  articleCount: number;
}> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const articles = await listRecentNewsArticlesSince(since, 100);
  if (articles.length === 0) {
    const body = "## 过去 24 小时资讯简报\n\n当前时段内没有新入库文章。";
    return { body, articleCount: 0 };
  }

  const extra = ENV.briefingExtraInstruction?.trim() || null;
  const body = await generateBriefingMarkdownFromArticles(articles, {
    extraInstruction: extra,
  });
  return { body, articleCount: articles.length };
}

function markdownToBasicHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/((?:<li>.+<\/li>\n?)+)/g, "<ul>$1</ul>")
    .replace(/\n{2,}/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}

async function pushBriefing(body: string): Promise<void> {
  const subs = await listBriefingSubscriptions();
  const active = subs.filter((s) => s.isEnabled);
  if (active.length === 0) {
    console.log("[Scheduler] No active briefing subscriptions");
    return;
  }

  const today = new Date().toLocaleDateString("zh-CN");
  const subject = `IPMS 每日简报 — ${today}`;
  const html = `<div style="max-width:680px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;padding:20px">${markdownToBasicHtml(body)}</div>`;

  for (const sub of active) {
    if (sub.email) {
      const ok = await sendMail({ to: sub.email, subject, html });
      console.log(
        `[Scheduler] Email to ${sub.email}: ${ok ? "sent" : "failed"}`
      );
    }
    if (sub.webhookUrl) {
      try {
        const res = await fetch(sub.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msgtype: "markdown",
            markdown: { title: subject, text: body },
            text: { content: `${subject}\n\n${body}` },
          }),
        });
        console.log(
          `[Scheduler] Webhook ${sub.webhookUrl}: ${res.ok ? "ok" : res.status}`
        );
      } catch (e) {
        console.error("[Scheduler] Webhook failed:", e);
      }
    }
  }
}

export function startScheduler(): void {
  const expr = ENV.briefingCron;
  if (!cron.validate(expr)) {
    console.warn(`[Scheduler] Invalid cron expression: "${expr}", skip`);
    return;
  }

  cron.schedule(expr, async () => {
    console.log("[Scheduler] Cron triggered — generating briefing…");
    try {
      const { body, articleCount } = await generateBriefingBody();
      await insertAiBriefing(body);
      console.log(
        `[Scheduler] Briefing saved (${articleCount} articles), pushing…`
      );
      await pushBriefing(body);
    } catch (e) {
      console.error("[Scheduler] Briefing generation/push failed:", e);
    }
  });

  const mailHint = isMailerConfigured() ? "SMTP ✓" : "SMTP ✗";
  console.log(
    `[Scheduler] Briefing cron "${expr}" registered (${mailHint})`
  );

  const kgExpr = ENV.kgMergeCron;
  if (kgExpr && cron.validate(kgExpr)) {
    cron.schedule(kgExpr, async () => {
      console.log("[Scheduler] KG merge cron — deduplicating entities…");
      try {
        const { groupsMerged, entitiesRemoved } = await mergeDuplicateEntitiesByMatchKey();
        console.log(
          `[Scheduler] KG merge done: ${groupsMerged} duplicate groups, ${entitiesRemoved} rows merged away`
        );
      } catch (e) {
        console.error("[Scheduler] KG merge failed:", e);
      }
    });
    console.log(`[Scheduler] Knowledge graph merge cron "${kgExpr}" registered`);
  } else if (kgExpr) {
    console.warn(`[Scheduler] Invalid KG_MERGE_CRON "${kgExpr}", skip`);
  }
}
