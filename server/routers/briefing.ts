import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import {
  getLatestAiBriefing,
  insertAiBriefing,
  listRecentNewsArticlesSince,
  listBriefingSubscriptions,
  addBriefingSubscription,
  removeBriefingSubscription,
  toggleBriefingSubscription,
} from "../db";
import { invokeLLM } from "../_core/llm";
import { isMailerConfigured } from "../_core/mailer";
import { ENV } from "../_core/env";

export const briefingRouter = router({
  latest: publicProcedure.query(async () => {
    return getLatestAiBriefing();
  }),

  /** 生成并入库最新简报（管理员） */
  generate: adminProcedure.mutation(async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const articles = await listRecentNewsArticlesSince(since, 100);
    if (articles.length === 0) {
      const body =
        "## 过去 24 小时资讯简报\n\n当前时段内没有新入库文章。您可在系统管理中抓取或导入后再生成。";
      await insertAiBriefing(body);
      return { body, articleCount: 0 };
    }

    const lines = articles.map(
      (a) =>
        `- id=${a.id} | ${a.source} | ${a.title} | 摘要: ${(a.summary ?? "—").slice(0, 160)}`
    );

    const resp = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `你是 IPMS 投资资讯编辑。根据给定文章列表写一份**中文 Markdown 晨报**：
- 一级标题用 ## 
- 2～3 段市场概览
- 用 ### 小标题按主题或策略分组要点
- 每条要点可标注来源 id（便于核对）
- 勿编造列表中不存在的事实`,
        },
        {
          role: "user",
          content: `共 ${articles.length} 篇新入库（过去约 24 小时），请写晨报：\n\n${lines.join("\n")}`,
        },
      ],
    });

    const raw = resp.choices?.[0]?.message?.content;
    const body =
      typeof raw === "string" && raw.trim()
        ? raw.trim()
        : "## 简报\n\n生成失败，请稍后重试。";
    await insertAiBriefing(body);
    return { body, articleCount: articles.length };
  }),

  /** 推送配置信息 */
  pushConfig: publicProcedure.query(async () => {
    return {
      cronExpr: ENV.briefingCron,
      smtpConfigured: isMailerConfigured(),
    };
  }),

  /** 订阅列表 */
  subscriptions: adminProcedure.query(async () => {
    return listBriefingSubscriptions();
  }),

  addSubscription: adminProcedure
    .input(
      z.object({
        email: z.string().email().optional(),
        webhookUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!input.email && !input.webhookUrl)
        throw new Error("请至少填写邮箱或 Webhook URL");
      await addBriefingSubscription({
        userId: ctx.user?.id ?? null,
        email: input.email ?? null,
        webhookUrl: input.webhookUrl ?? null,
        isEnabled: true,
      });
      return { success: true };
    }),

  removeSubscription: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await removeBriefingSubscription(input.id);
      return { success: true };
    }),

  toggleSubscription: adminProcedure
    .input(z.object({ id: z.number().int(), isEnabled: z.boolean() }))
    .mutation(async ({ input }) => {
      await toggleBriefingSubscription(input.id, input.isEnabled);
      return { success: true };
    }),
});
