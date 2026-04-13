import { z } from "zod";
import { BRIEFING_DEFAULT_SYSTEM_PROMPT } from "@shared/briefingConstants";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { generateBriefingMarkdownFromArticles } from "../_core/briefingGenerate";
import { ENV } from "../_core/env";
import { isMailerConfigured } from "../_core/mailer";
import {
  addBriefingSubscription,
  getLatestAiBriefing,
  getNewsArticlesByIds,
  getUserPreferredStrategy,
  getUserReadingProfile,
  insertAiBriefing,
  listBriefingSubscriptions,
  listRecentNewsArticlesSince,
  removeBriefingSubscription,
  toggleBriefingSubscription,
  upsertUserBriefingPrefs,
} from "../db";

export const briefingRouter = router({
  latest: publicProcedure.query(async () => {
    return getLatestAiBriefing();
  }),

  /** 当前用户对简报的偏好与默认 system prompt 文案 */
  myPrefs: protectedProcedure.query(async ({ ctx }) => {
    const row = await getUserReadingProfile(ctx.user.id);
    return {
      instruction: row?.briefingInstruction ?? null,
      systemPromptCustom: row?.briefingSystemPromptCustom ?? null,
      introCompleted: Boolean(row?.briefingIntroCompleted),
      defaultSystemPrompt: BRIEFING_DEFAULT_SYSTEM_PROMPT,
    };
  }),

  setMyPrefs: protectedProcedure
    .input(
      z.object({
        instruction: z.string().max(2000).nullable().optional(),
        briefingSystemPromptCustom: z.string().max(12000).nullable().optional(),
        introCompleted: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await upsertUserBriefingPrefs(ctx.user.id, {
        ...(input.instruction !== undefined && {
          briefingInstruction: input.instruction,
        }),
        ...(input.briefingSystemPromptCustom !== undefined && {
          briefingSystemPromptCustom: input.briefingSystemPromptCustom,
        }),
        ...(input.introCompleted !== undefined && {
          briefingIntroCompleted: input.introCompleted,
        }),
      });
      return { success: true as const };
    }),

  /** 将简报正文中的 [id] 转为可点链接时拉取元数据 */
  citationMeta: protectedProcedure
    .input(z.object({ ids: z.array(z.number().int()).max(200) }))
    .query(async ({ input }) => {
      if (input.ids.length === 0) return [];
      const arts = await getNewsArticlesByIds(input.ids);
      return arts.map((a) => ({
        id: a.id,
        title: a.title,
        originalUrl: a.originalUrl ?? null,
      }));
    }),

  /** 生成并入库最新简报（管理员）；合并管理员本人保存的简报写作偏好 */
  generate: adminProcedure.mutation(async ({ ctx }) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const articles = await listRecentNewsArticlesSince(since, 100);
    if (articles.length === 0) {
      const body =
        "## 过去 24 小时资讯简报\n\n当前时段内没有新入库文章。您可在系统管理中抓取或导入后再生成。";
      await insertAiBriefing(body);
      return { body, articleCount: 0 };
    }

    const profile = await getUserReadingProfile(ctx.user.id);
    const custom = profile?.briefingSystemPromptCustom?.trim() || null;
    const extra = custom ? null : profile?.briefingInstruction?.trim() || null;

    const body = await generateBriefingMarkdownFromArticles(articles, {
      extraInstruction: extra,
      systemPromptOverride: custom,
    });
    await insertAiBriefing(body);
    return { body, articleCount: articles.length };
  }),

  /** 当前登录用户即时生成「今日简报」预览（不入库），可选策略过滤 */
  generateForMe: protectedProcedure
    .input(z.object({ strategy: z.string().nullish() }).optional())
    .mutation(async ({ ctx, input }) => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      let strategy = input?.strategy ?? null;

      if (!strategy) {
        strategy = await getUserPreferredStrategy(ctx.user.id);
      }

      const articles = await listRecentNewsArticlesSince(since, 100, strategy);
      if (articles.length === 0) {
        const hint = strategy ? `（策略：${strategy}）` : "";
        return {
          body: `## 今日资讯简报${hint}\n\n过去 24 小时暂无${strategy ? `「${strategy}」相关` : "新入库"}资讯。`,
          articleCount: 0,
          strategy,
        };
      }
      const profile = await getUserReadingProfile(ctx.user.id);
      const custom = profile?.briefingSystemPromptCustom?.trim() || null;
      const strategyHint = strategy
        ? `以下资讯聚焦于「${strategy}」策略方向，请侧重该领域进行分析。\n`
        : "";
      const extra = custom
        ? null
        : [strategyHint, profile?.briefingInstruction?.trim()]
            .filter(Boolean)
            .join("\n") || null;
      const body = await generateBriefingMarkdownFromArticles(articles, {
        extraInstruction: extra,
        systemPromptOverride: custom,
      });
      return { body, articleCount: articles.length, strategy };
    }),

  pushConfig: publicProcedure.query(async () => {
    return {
      cronExpr: ENV.briefingCron,
      smtpConfigured: isMailerConfigured(),
    };
  }),

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
