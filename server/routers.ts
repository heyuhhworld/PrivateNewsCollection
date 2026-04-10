import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { hashPassword, normalizeEmail, verifyPassword } from "./_core/passwordAuth";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getUserByEmail, upsertUser } from "./db";
import { newsRouter } from "./routers/news";
import { chatRouter } from "./routers/chat";
import { crawlRouter } from "./routers/crawl";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    emailRegister: publicProcedure
      .input(
        z.object({
          name: z.string().min(1).max(80),
          email: z.string().email(),
          password: z.string().min(8).max(128),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const email = normalizeEmail(input.email);
        const existing = await getUserByEmail(email);
        if (existing) {
          throw new Error("该邮箱已注册，请直接登录");
        }
        const displayName = input.name.trim();
        const openId = `email:${email}`;
        await upsertUser({
          openId,
          name: displayName,
          email,
          loginMethod: "email",
          passwordHash: hashPassword(input.password),
          lastSignedIn: new Date(),
        });

        const sessionToken = await sdk.createSessionToken(openId, {
          name: displayName,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions });
        return { success: true } as const;
      }),
    emailLogin: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          password: z.string().min(1).max(128),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const email = normalizeEmail(input.email);
        const user = await getUserByEmail(email);
        if (!user || !user.passwordHash) {
          throw new Error("邮箱或密码错误");
        }
        if (!verifyPassword(input.password, user.passwordHash)) {
          throw new Error("邮箱或密码错误");
        }
        await upsertUser({
          openId: user.openId,
          email: user.email ?? undefined,
          lastSignedIn: new Date(),
        });
        const displayName = user.name?.trim() || email.split("@")[0] || "User";
        const sessionToken = await sdk.createSessionToken(user.openId, {
          name: displayName,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions });
        return { success: true } as const;
      }),
    /** 未登录时凭邮箱 + 当前密码修改（与登录校验一致，防枚举用统一错误文案） */
    emailChangePassword: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          currentPassword: z.string().min(1).max(128),
          newPassword: z.string().min(8).max(128),
        })
      )
      .mutation(async ({ input }) => {
        const email = normalizeEmail(input.email);
        const user = await getUserByEmail(email);
        if (!user || !user.passwordHash) {
          throw new Error("邮箱或当前密码不正确");
        }
        if (!verifyPassword(input.currentPassword, user.passwordHash)) {
          throw new Error("邮箱或当前密码不正确");
        }
        await upsertUser({
          openId: user.openId,
          email: user.email ?? undefined,
          passwordHash: hashPassword(input.newPassword),
          lastSignedIn: new Date(),
        });
        return { success: true } as const;
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  news: newsRouter,
  chat: chatRouter,
  crawl: crawlRouter,
});

export type AppRouter = typeof appRouter;
