import { z } from "zod";
import { TRPCError } from "@trpc/server";
import fs from "fs";
import path from "path";
import { publicProcedure, router } from "../_core/trpc";
import {
  getNewsArticleById,
  listPdfHighlightsByArticle,
  insertPdfHighlight,
  deletePdfHighlight,
  listReadingImagesByArticle,
  updateReadingImageCaption,
  deleteReadingImage,
  insertReadingEvent,
  getUserReadingProfile,
  rollupUserReadingProfile,
} from "../db";
import type { PdfHighlightRectNorm } from "../../drizzle/schema";

const lastProfileRollupAt = new Map<number, number>();
const ROLLUP_MIN_MS = 60_000;

async function throttledRollup(userId: number) {
  const now = Date.now();
  const prev = lastProfileRollupAt.get(userId) ?? 0;
  if (now - prev < ROLLUP_MIN_MS) return;
  lastProfileRollupAt.set(userId, now);
  await rollupUserReadingProfile(userId);
}

async function assertArticleReadable(articleId: number, role?: string | null) {
  const art = await getNewsArticleById(articleId);
  if (!art) {
    throw new TRPCError({ code: "NOT_FOUND", message: "资讯不存在" });
  }
  if (art.isHidden && role !== "admin") {
    throw new TRPCError({ code: "NOT_FOUND", message: "资讯不存在" });
  }
  return art;
}

const rectNormSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const readingRouter = router({
  pdfHighlightsList: publicProcedure
    .input(z.object({ articleId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      await assertArticleReadable(input.articleId, ctx.user?.role);
      return listPdfHighlightsByArticle(input.articleId);
    }),

  pdfHighlightCreate: publicProcedure
    .input(
      z.object({
        articleId: z.number().int(),
        page: z.number().int().min(1),
        rectsNorm: z.array(rectNormSchema).min(1).max(20),
        color: z.string().max(32).optional(),
        note: z.string().max(500).optional(),
        sessionId: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await assertArticleReadable(input.articleId, ctx.user?.role);
      await insertPdfHighlight({
        articleId: input.articleId,
        userId: ctx.user?.id ?? null,
        sessionId: input.sessionId ?? null,
        page: input.page,
        rectsNorm: input.rectsNorm as PdfHighlightRectNorm[],
        color: input.color,
        note: input.note,
      });
      await insertReadingEvent({
        userId: ctx.user?.id ?? null,
        sessionId: input.sessionId ?? null,
        articleId: input.articleId,
        recordCategory: null,
        eventType: "pdf_highlight_save",
        payload: { page: input.page },
      });
      if (ctx.user?.id) void throttledRollup(ctx.user.id);
      return { success: true as const };
    }),

  pdfHighlightDelete: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        sessionId: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ok = await deletePdfHighlight(
        input.id,
        ctx.user?.id ?? null,
        ctx.user?.role === "admin",
        input.sessionId ?? null
      );
      if (!ok) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权删除该高亮" });
      }
      return { success: true };
    }),

  readingImagesList: publicProcedure
    .input(z.object({ articleId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      await assertArticleReadable(input.articleId, ctx.user?.role);
      return listReadingImagesByArticle(input.articleId);
    }),

  readingImageUpdate: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        caption: z.string().max(200).optional(),
        sessionId: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ok = await updateReadingImageCaption(
        input.id,
        (input.caption ?? "").trim() || null,
        ctx.user?.id ?? null,
        ctx.user?.role === "admin",
        input.sessionId ?? null
      );
      if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "无权编辑该图片" });
      return { success: true };
    }),

  readingImageDelete: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        sessionId: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const out = await deleteReadingImage(
        input.id,
        ctx.user?.id ?? null,
        ctx.user?.role === "admin",
        input.sessionId ?? null
      );
      if (!out.ok) throw new TRPCError({ code: "FORBIDDEN", message: "无权删除该图片" });
      if (out.storageKey) {
        const abs = path.join(process.cwd(), "uploads", "news", out.storageKey);
        fs.unlink(abs, () => {});
      }
      return { success: true };
    }),

  logEvent: publicProcedure
    .input(
      z.object({
        articleId: z.number().int().optional(),
        sessionId: z.string().max(64).optional(),
        recordCategory: z.string().max(32).optional(),
        eventType: z.string().max(64),
        payload: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.articleId != null) {
        await assertArticleReadable(input.articleId, ctx.user?.role);
      }
      await insertReadingEvent({
        userId: ctx.user?.id ?? null,
        sessionId: input.sessionId ?? null,
        articleId: input.articleId ?? null,
        recordCategory: input.recordCategory ?? null,
        eventType: input.eventType,
        payload: (input.payload ?? null) as Record<string, unknown> | null,
      });
      if (ctx.user?.id && input.eventType !== "dwell_tick") {
        void throttledRollup(ctx.user.id);
      }
      return { success: true };
    }),

  profileSnippet: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user?.id) return { text: null as string | null };
    let p = await getUserReadingProfile(ctx.user.id);
    const j0 = p?.summaryJson as { summaryText?: string } | undefined;
    if (!j0?.summaryText?.trim()) {
      await rollupUserReadingProfile(ctx.user.id);
      p = await getUserReadingProfile(ctx.user.id);
    }
    const j = p?.summaryJson as { summaryText?: string } | undefined;
    const text =
      typeof j?.summaryText === "string" && j.summaryText.trim()
        ? j.summaryText.trim()
        : null;
    return { text };
  }),
});
