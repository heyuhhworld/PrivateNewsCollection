import { z } from "zod";
import {
  decryptCredential,
  encryptCredential,
  isCredentialCryptoAvailable,
} from "../_core/credentialCrypto";
import { publicProcedure, router } from "../_core/trpc";
import type { InsertCrawlJob } from "../../drizzle/schema";
import {
  getCrawlJobs,
  getCrawlJobById,
  createCrawlJob,
  updateCrawlJob,
  deleteCrawlJob,
  getCrawlLogs,
  createCrawlLog,
  updateCrawlLog,
} from "../db";
import { importSingleArticle } from "./news";

function cookiesToHeader(
  cookies: { name: string; value: string; domain?: string }[]
): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Preqin：在列表页或独立登录页尝试填写账号密码并提交（站点改版时需调整选择器）
 */
async function tryPreqinLogin(
  page: any,
  listingUrl: string,
  username: string,
  password: string
): Promise<void> {
  console.log("[Crawl] Preqin: 尝试登录…");
  await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);

  async function fillVisibleLoginForm(): Promise<boolean> {
    const pwLoc = page.locator('input[type="password"]');
    const n = await pwLoc.count();
    if (n === 0) return false;
    const first = pwLoc.first();
    const vis = await first.isVisible().catch(() => false);
    if (!vis) return false;

    const emailLoc = page
      .locator(
        'input[type="email"], input[name="email"], input[name="username"], input[autocomplete="username"], input[id*="email" i], input[name="Email"]'
      )
      .first();
    if ((await emailLoc.count()) > 0) {
      await emailLoc.fill(username);
    } else {
      const txt = page.locator("input[type=text]").first();
      if ((await txt.count()) > 0) await txt.fill(username);
    }
    await first.fill(password);

    const submit = page
      .locator(
        'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Continue"), input[type="submit"]'
      )
      .first();
    await submit.click().catch(async () => {
      await page.keyboard.press("Enter");
    });
    await page.waitForTimeout(5000);
    return true;
  }

  let ok = await fillVisibleLoginForm();
  if (!ok) {
    const fallbacks = [
      "https://www.preqin.com/login",
      "https://www.preqin.com/account/login",
      "https://www.preqin.com/users/sign_in",
    ];
    for (const u of fallbacks) {
      try {
        await page.goto(u, { waitUntil: "domcontentloaded", timeout: 35000 });
        await page.waitForTimeout(2000);
        ok = await fillVisibleLoginForm();
        if (ok) break;
      } catch {
        /* try next */
      }
    }
  }

  await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
}

// ─── Playwright browser helper ─────────────────────────────────────────────

type ExtractResult = { links: string[]; cookieHeader?: string };

/**
 * Use Playwright (headless Chromium) to load a listing page and extract
 * concrete article URLs. Preqin 可传入账号密码，先登录再抓链接，并把 Cookie 交给后续 HTTP 拉正文。
 */
async function extractArticleLinksWithBrowser(
  listingUrl: string,
  source: "Preqin" | "Pitchbook",
  auth?: { username: string; password: string } | null
): Promise<ExtractResult> {
  let chromium: any;
  let browser: any;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    console.error("[Crawl] playwright not available");
    return { links: [] };
  }

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });
    const page = await context.newPage();

    if (source === "Preqin" && auth?.username && auth?.password) {
      try {
        await tryPreqinLogin(page, listingUrl, auth.username, auth.password);
      } catch (e: any) {
        console.warn(`[Crawl] Preqin login helper: ${e?.message ?? e}`);
      }
    } else {
      console.log(`[Crawl] Loading listing page: ${listingUrl}`);
      try {
        await page.goto(listingUrl, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
      } catch (navErr: any) {
        console.warn(
          `[Crawl] Navigation warning: ${navErr?.message?.slice(0, 80)}`
        );
      }
      await page.waitForTimeout(6000);
    }

    const links: string[] = await page.evaluate((src: string) => {
      const anchors = Array.from(
        document.querySelectorAll("a[href]")
      ) as HTMLAnchorElement[];
      const hrefs = anchors.map((a) => a.href);

      if (src === "Pitchbook") {
        return hrefs
          .filter(
            (h) =>
              h.includes("pitchbook.com/news/articles/") ||
              h.includes("pitchbook.com/news/reports/")
          )
          .filter((v, i, arr) => arr.indexOf(v) === i);
      }
      return hrefs
        .filter(
          (h) =>
            h.includes("preqin.com/insights/") ||
            h.includes("preqin.com/research/")
        )
        .filter((v, i, arr) => arr.indexOf(v) === i);
    }, source);

    let cookieHeader: string | undefined;
    if (source === "Preqin" && auth?.username) {
      try {
        const cookies = await context.cookies();
        cookieHeader = cookiesToHeader(cookies);
      } catch {
        /* ignore */
      }
    }

    console.log(`[Crawl] Found ${links.length} article links from ${listingUrl}`);
    await browser.close();
    return { links, cookieHeader };
  } catch (err: any) {
    console.error(`[Crawl] Browser extraction failed: ${err?.message}`);
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
    return { links: [] };
  }
}

function sanitizeJob(row: NonNullable<Awaited<ReturnType<typeof getCrawlJobById>>>) {
  const { authPasswordEnc, ...rest } = row;
  return {
    ...rest,
    hasAuthPassword: Boolean(authPasswordEnc),
  };
}

// ─── Router ────────────────────────────────────────────────────────────────

export const crawlRouter = router({
  list: publicProcedure.query(async () => {
    const jobs = await getCrawlJobs();
    return jobs.map((j) => sanitizeJob(j));
  }),

  get: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const job = await getCrawlJobById(input.id);
      return job ? sanitizeJob(job) : null;
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        url: z.string().url(),
        source: z.enum(["Preqin", "Pitchbook"]),
        cronExpr: z.string().min(1),
        rangeInDays: z.number().int().min(1).max(365).default(7),
        isEnabled: z.boolean().default(true),
        authUsername: z.string().max(320).optional(),
        authPassword: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { authPassword, authUsername, ...rest } = input;
      const payload: InsertCrawlJob = {
        ...rest,
        authUsername: authUsername?.trim() || null,
        authPasswordEnc: null,
      };
      if (authPassword?.trim()) {
        if (!isCredentialCryptoAvailable()) {
          throw new Error(
            "无法加密保存密码：请配置 JWT_SECRET，或使用开发环境（NODE_ENV=development）"
          );
        }
        payload.authPasswordEnc = encryptCredential(authPassword.trim());
      }
      const created = await createCrawlJob(payload);
      return created ? sanitizeJob(created) : null;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().min(1).max(100).optional(),
        url: z.string().url().optional(),
        source: z.enum(["Preqin", "Pitchbook"]).optional(),
        cronExpr: z.string().min(1).optional(),
        rangeInDays: z.number().int().min(1).max(365).optional(),
        isEnabled: z.boolean().optional(),
        authUsername: z.string().max(320).optional().nullable(),
        /** 新密码；不传表示不修改；传空串表示清除已保存密码 */
        authPassword: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, authPassword, ...rest } = input;
      const data = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined)
      ) as Partial<InsertCrawlJob>;
      if (authPassword !== undefined) {
        if (authPassword === "") {
          data.authPasswordEnc = null;
        } else if (authPassword.trim()) {
          if (!isCredentialCryptoAvailable()) {
            throw new Error(
              "无法加密保存密码：请配置 JWT_SECRET，或使用开发环境（NODE_ENV=development）"
            );
          }
          data.authPasswordEnc = encryptCredential(authPassword.trim());
        }
      }
      await updateCrawlJob(id, data);
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await deleteCrawlJob(input.id);
      return { success: true };
    }),

  /**
   * runNow: 
   * 1. Use Playwright to load the listing page URL and extract article links
   * 2. Import each article one by one using LLM
   * 3. Record results in crawl log
   */
  runNow: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const job = await getCrawlJobById(input.id);
      if (!job) throw new Error("任务不存在");

      // Create log entry
      const log = await createCrawlLog({
        jobId: job.id,
        status: "running",
        articlesFound: 0,
        articlesAdded: 0,
        message: "正在从列表页提取文章链接...",
        startedAt: new Date(),
        finishedAt: null,
      });

      await updateCrawlJob(job.id, { lastRunAt: new Date() });

      try {
        let preqinAuth: { username: string; password: string } | null = null;
        if (
          job.source === "Preqin" &&
          job.authUsername?.trim() &&
          job.authPasswordEnc
        ) {
          try {
            preqinAuth = {
              username: job.authUsername.trim(),
              password: decryptCredential(job.authPasswordEnc),
            };
          } catch (e) {
            console.error("[Crawl] 解密 Preqin 密码失败", e);
          }
        }

        const { links: articleLinks, cookieHeader } =
          await extractArticleLinksWithBrowser(
            job.url,
            job.source as "Preqin" | "Pitchbook",
            preqinAuth
          );

        if (articleLinks.length === 0) {
          const msg = "未能从列表页提取到文章链接，请检查 URL 是否为有效的资讯列表页";
          if (log) {
            await updateCrawlLog(log.id, {
              status: "failed",
              articlesFound: 0,
              articlesAdded: 0,
              message: msg,
              finishedAt: new Date(),
            });
          }
          await updateCrawlJob(job.id, { lastRunStatus: "failed" });
          throw new Error(msg);
        }

        // Update log with found count
        if (log) {
          await updateCrawlLog(log.id, {
            articlesFound: articleLinks.length,
            message: `发现 ${articleLinks.length} 篇文章，正在逐篇导入...`,
          });
        }

        // Step 2: Import each article (limit to first 20 to avoid timeout)
        const limit = Math.min(articleLinks.length, 20);
        const linksToProcess = articleLinks.slice(0, limit);

        let successCount = 0;
        let duplicateCount = 0;
        let failedCount = 0;

        const importOpts =
          job.source === "Preqin" && cookieHeader
            ? { cookieHeader }
            : undefined;

        for (const articleUrl of linksToProcess) {
          const result = await importSingleArticle(
            articleUrl,
            job.source as "Preqin" | "Pitchbook",
            importOpts
          );
          if (result.status === "success") successCount++;
          else if (result.status === "duplicate") duplicateCount++;
          else failedCount++;
        }

        const message = `发现 ${articleLinks.length} 篇，处理 ${limit} 篇：成功导入 ${successCount} 篇，已存在 ${duplicateCount} 篇，失败 ${failedCount} 篇`;

        if (log) {
          await updateCrawlLog(log.id, {
            status: failedCount === limit ? "failed" : "success",
            articlesFound: articleLinks.length,
            articlesAdded: successCount,
            message,
            finishedAt: new Date(),
          });
        }

        await updateCrawlJob(job.id, {
          lastRunStatus: failedCount === limit ? "failed" : "success",
        });

        return {
          success: true,
          articlesFound: articleLinks.length,
          articlesAdded: successCount,
          message,
        };
      } catch (err: any) {
        const errMsg = err?.message ?? "未知错误";
        if (log) {
          await updateCrawlLog(log.id, {
            status: "failed",
            message: errMsg,
            finishedAt: new Date(),
          });
        }
        await updateCrawlJob(job.id, { lastRunStatus: "failed" });
        throw new Error(`执行失败: ${errMsg}`);
      }
    }),

  logs: publicProcedure
    .input(z.object({ jobId: z.number().int().optional() }))
    .query(async ({ input }) => {
      return getCrawlLogs(input.jobId);
    }),
});
