import { z } from "zod";
import { eq } from "drizzle-orm";
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
import { getDb } from "../db";
import { newsArticles } from "../../drizzle/schema";

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

  async function tryFillAndSubmitInScope(scope: any): Promise<boolean> {
    const pwLoc = scope.locator('input[type="password"]');
    const n = await pwLoc.count();
    if (n === 0) return false;
    const first = pwLoc.first();
    const vis = await first.isVisible().catch(() => false);
    if (!vis) return false;

    const emailLoc = scope
      .locator(
        'input[type="email"], input[name="email"], input[name="username"], input[autocomplete="username"], input[id*="email" i], input[name="Email"]'
      )
      .first();
    if ((await emailLoc.count()) > 0) {
      await emailLoc.fill(username);
    } else {
      const txt = scope.locator("input[type=text]").first();
      if ((await txt.count()) > 0) await txt.fill(username);
    }
    await first.fill(password);

    const submit = scope
      .locator(
        'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Continue"), input[type="submit"]'
      )
      .first();
    await submit.click().catch(async () => {
      await page.keyboard.press("Enter");
    });
    await page.waitForTimeout(6000);
    return true;
  }

  async function openLoginEntryIfExists(): Promise<void> {
    const trigger = page
      .locator(
        'a:has-text("Sign in"), a:has-text("Log in"), button:has-text("Sign in"), button:has-text("Log in"), [data-testid*="login" i], [href*="login" i]'
      )
      .first();
    const c = await trigger.count();
    if (c > 0) {
      await trigger.click().catch(() => {});
      await page.waitForTimeout(2000);
    }
  }

  async function fillVisibleLoginForm(): Promise<boolean> {
    await openLoginEntryIfExists();
    if (await tryFillAndSubmitInScope(page)) return true;

    // 某些站点登录表单在 iframe（如 Auth0 嵌入）里
    const frames = page.frames();
    for (const fr of frames) {
      if (fr === page.mainFrame()) continue;
      try {
        if (await tryFillAndSubmitInScope(fr)) return true;
      } catch {
        // ignore frame and continue
      }
    }
    return false;
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

type LinkCandidate = { url: string; publishedAt?: string };
type ExtractResult = { candidates: LinkCandidate[]; cookieHeader?: string };
type RunningJobState = { cancelRequested: boolean; logId: number | null };
const runningJobs = new Map<number, RunningJobState>();
const IMPORT_DELAY_MS = 30_000;
const MAX_IMPORT_PER_RUN = 5;

function normalizeUrlForDedup(url: string): string {
  try {
    const u = new URL(url);
    // 去掉 hash；保留 query 供必要页面识别，但去掉末尾斜杠
    u.hash = "";
    const p = u.pathname.replace(/\/+$/, "");
    return `${u.origin}${p}${u.search}`;
  } catch {
    return url;
  }
}

function parsePublishedAtFromText(text: string): string | undefined {
  if (!text) return undefined;
  const normalized = text.replace(/\s+/g, " ").trim();
  // e.g. "Apr 1, 2026" / "April 1, 2026"
  const monthFirst = normalized.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b/i
  );
  if (monthFirst) {
    const d = new Date(monthFirst[0]);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  // e.g. "1 Apr 2026"
  const dayFirst = normalized.match(
    /\b\d{1,2}\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b/i
  );
  if (dayFirst) {
    const d = new Date(dayFirst[0]);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}

async function delayWithCancelCheck(
  ms: number,
  shouldStop: () => boolean
): Promise<void> {
  const step = 1000;
  let left = ms;
  while (left > 0) {
    if (shouldStop()) throw new Error("任务已手动停止");
    const chunk = Math.min(step, left);
    await new Promise((r) => setTimeout(r, chunk));
    left -= chunk;
  }
}

/** 仅保留可导入的“具体文章页”链接，避免把列表页写入 originalUrl */
function isConcreteArticleUrl(
  url: string,
  source: "Preqin" | "Pitchbook",
  listingUrl: string
): boolean {
  try {
    const u = new URL(url);
    const listing = new URL(listingUrl);
    const path = u.pathname.replace(/\/+$/, "");
    const listingPath = listing.pathname.replace(/\/+$/, "");

    // 过滤明显非内容页
    if (!/^https?:$/i.test(u.protocol)) return false;
    if (
      path === "" ||
      path === "/" ||
      path.startsWith("/search") ||
      path.includes("/login") ||
      path.includes("/account")
    ) {
      return false;
    }

    if (source === "Pitchbook") {
      return (
        path.includes("/news/articles/") ||
        path.includes("/news/reports/")
      );
    }

    // Preqin:
    // 列表页常见：/insights/research?...
    // 文章页通常：/insights/research/<slug>（至少比列表页多一级）
    if (!(path.includes("/insights/") || path.includes("/research/"))) {
      return false;
    }
    if (u.host !== listing.host) return false;
    if (path === listingPath) return false;
    if (u.search && path === listingPath) return false;
    if (path.startsWith("/insights/research") && !path.startsWith("/insights/research/")) {
      return false;
    }

    const segs = path.split("/").filter(Boolean);
    // 至少 3 段：insights / research / slug
    if (segs.length < 3) return false;
    return true;
  } catch {
    return false;
  }
}

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
    return { candidates: [] };
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

    const rawEntries: Array<{ href: string; context: string }> = await page.evaluate(
      (src: string) => {
      const anchors = Array.from(
        document.querySelectorAll("a[href]")
      ) as HTMLAnchorElement[];
      const hrefs = anchors.map((a) => {
        const ctx =
          (a.closest("article, li, .card, .tile, .result, .news, .insight, div")
            ?.textContent ?? a.textContent ?? "")
            .slice(0, 400)
            .trim();
        return { href: a.href, context: ctx };
      });

      if (src === "Pitchbook") {
        return hrefs
          .filter(
            (h) =>
              h.href.includes("pitchbook.com/news/articles/") ||
              h.href.includes("pitchbook.com/news/reports/")
          )
          .filter((v, i, arr) => arr.findIndex((x) => x.href === v.href) === i);
      }
      return hrefs
        .filter(
          (h) =>
            h.href.includes("preqin.com/insights/") ||
            h.href.includes("preqin.com/research/")
        )
        .filter((v, i, arr) => arr.findIndex((x) => x.href === v.href) === i);
    }, source);

    const candidates = rawEntries
      .map((e) => ({
        url: normalizeUrlForDedup(e.href),
        publishedAt: parsePublishedAtFromText(e.context),
      }))
      .filter(
        (e, i, arr) =>
          arr.findIndex((x) => x.url === e.url) === i &&
          isConcreteArticleUrl(
            e.url,
            source as "Preqin" | "Pitchbook",
            listingUrl
          )
      );

    let cookieHeader: string | undefined;
    if (source === "Preqin" && auth?.username) {
      try {
        const cookies = await context.cookies();
        cookieHeader = cookiesToHeader(cookies);
      } catch {
        /* ignore */
      }
    }

    console.log(
      `[Crawl] Found ${candidates.length} candidate links from ${listingUrl}`
    );
    await browser.close();
    return { candidates, cookieHeader };
  } catch (err: any) {
    console.error(`[Crawl] Browser extraction failed: ${err?.message}`);
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
    return { candidates: [] };
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

  /** 停止正在执行中的任务（协作式中止：当前文章处理完后立即停止后续导入） */
  stopRun: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const state = runningJobs.get(input.id);
      if (!state) {
        // 兜底：若服务重启导致内存态丢失，但日志仍是 running，则执行强制收口
        const logs = await getCrawlLogs(input.id);
        const runningLog = logs.find((l) => l.status === "running");
        if (!runningLog) {
          return { success: false, message: "任务当前未在执行" };
        }
        await updateCrawlLog(runningLog.id, {
          status: "failed",
          message: "任务已手动停止（强制收口）",
          finishedAt: new Date(),
        });
        await updateCrawlJob(input.id, { lastRunStatus: "failed" });
        return { success: true, message: "已强制停止并结束执行日志" };
      }
      state.cancelRequested = true;
      runningJobs.set(input.id, state);
      if (state.logId) {
        await updateCrawlLog(state.logId, {
          message: "收到停止请求，正在安全停止...",
        });
      }
      return { success: true, message: "已发送停止请求" };
    }),

  /** 刷新时清理僵尸 running 日志（进程已不在执行但日志仍是 running） */
  reconcileRunningLogs: publicProcedure
    .input(z.object({ jobId: z.number().int().optional() }).optional())
    .mutation(async ({ input }) => {
      const logs = await getCrawlLogs(input?.jobId);
      const zombies = logs.filter(
        (l) => l.status === "running" && !runningJobs.has(l.jobId)
      );
      if (zombies.length === 0) {
        return { updated: 0, message: "无僵尸执行日志" };
      }

      for (const l of zombies) {
        await updateCrawlLog(l.id, {
          status: "failed",
          message: "任务已终止（刷新时自动收口）",
          finishedAt: new Date(),
        });
        await updateCrawlJob(l.jobId, { lastRunStatus: "failed" });
      }
      return { updated: zombies.length, message: `已收口 ${zombies.length} 条执行中日志` };
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
      if (runningJobs.has(job.id)) {
        throw new Error("该任务正在执行中，请勿重复触发");
      }

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

      runningJobs.set(job.id, { cancelRequested: false, logId: log?.id ?? null });
      await updateCrawlJob(job.id, { lastRunAt: new Date(), lastRunStatus: "running" });

      try {
        const shouldStop = () => Boolean(runningJobs.get(job.id)?.cancelRequested);
        const ensureNotStopped = () => {
          if (shouldStop()) {
            throw new Error("任务已手动停止");
          }
        };

        ensureNotStopped();
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

        const { candidates, cookieHeader } =
          await extractArticleLinksWithBrowser(
            job.url,
            job.source as "Preqin" | "Pitchbook",
            preqinAuth
          );
        ensureNotStopped();

        if (candidates.length === 0) {
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

        // 按任务配置的抓取时间区间过滤（优先使用列表提取到的发布日期）
        const now = Date.now();
        const cutoffMs = now - Math.max(1, job.rangeInDays || 1) * 24 * 3600 * 1000;
        const inRangeCandidates = candidates.filter((c) => {
          // 严格时间过滤：拿不到发布日期时不入队，避免混入历史文章
          if (!c.publishedAt) return false;
          const t = new Date(c.publishedAt).getTime();
          if (Number.isNaN(t)) return false;
          return t >= cutoffMs;
        });

        if (inRangeCandidates.length === 0) {
          const msg = `已提取 ${candidates.length} 篇链接，但无符合近 ${job.rangeInDays} 天范围的文章`;
          if (log) {
            await updateCrawlLog(log.id, {
              status: "success",
              articlesFound: candidates.length,
              articlesAdded: 0,
              message: msg,
              finishedAt: new Date(),
            });
          }
          await updateCrawlJob(job.id, { lastRunStatus: "success" });
          return {
            success: true,
            articlesFound: candidates.length,
            articlesAdded: 0,
            message: msg,
          };
        }

        // Update log with found/queued count
        if (log) {
          await updateCrawlLog(log.id, {
            articlesFound: candidates.length,
            message: `发现 ${candidates.length} 篇，符合近 ${job.rangeInDays} 天 ${inRangeCandidates.length} 篇，已加入导入队列（单线程）`,
          });
        }

        // Step 2: 单线程逐条导入；每篇完成后停 30s 再处理下一篇
        const db = await getDb();
        let dedupedQueue = inRangeCandidates.map((c) => c.url);
        if (db) {
          const deduped: string[] = [];
          for (const u of dedupedQueue) {
            const existing = await db
              .select({ id: newsArticles.id })
              .from(newsArticles)
              .where(eq(newsArticles.originalUrl, u))
              .limit(1);
            if (existing.length === 0) deduped.push(u);
          }
          dedupedQueue = deduped;
        }

        const linksToProcess = dedupedQueue.slice(0, MAX_IMPORT_PER_RUN);
        const limit = linksToProcess.length;

        let successCount = 0;
        let duplicateCount = 0;
        let failedCount = 0;

        const importOpts =
          job.source === "Preqin" && cookieHeader
            ? { cookieHeader }
            : undefined;

        for (let i = 0; i < linksToProcess.length; i++) {
          const articleUrl = linksToProcess[i];
          ensureNotStopped();
          const result = await importSingleArticle(
            articleUrl,
            job.source as "Preqin" | "Pitchbook",
            importOpts
          );
          if (result.status === "success") successCount++;
          else if (result.status === "duplicate") duplicateCount++;
          else failedCount++;

          if (log) {
            await updateCrawlLog(log.id, {
              message:
                i < linksToProcess.length - 1
                  ? `队列进度 ${i + 1}/${linksToProcess.length}，成功 ${successCount}，重复 ${duplicateCount}，失败 ${failedCount}。等待 30s 后抓取下一篇...`
                  : `队列进度 ${i + 1}/${linksToProcess.length}，成功 ${successCount}，重复 ${duplicateCount}，失败 ${failedCount}`,
            });
          }
          if (i < linksToProcess.length - 1) {
            await delayWithCancelCheck(IMPORT_DELAY_MS, shouldStop);
          }
        }

        const message = `发现 ${candidates.length} 篇，符合近 ${job.rangeInDays} 天 ${inRangeCandidates.length} 篇，去重后待处理 ${dedupedQueue.length} 篇，本次最多抓取 ${MAX_IMPORT_PER_RUN} 篇，实际处理 ${limit} 篇：成功导入 ${successCount} 篇，已存在 ${duplicateCount} 篇，失败 ${failedCount} 篇`;

        if (log) {
          await updateCrawlLog(log.id, {
            status: failedCount === limit ? "failed" : "success",
            articlesFound: candidates.length,
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
          articlesFound: candidates.length,
          articlesAdded: successCount,
          message,
        };
      } catch (err: any) {
        const errMsg = err?.message ?? "未知错误";
        const stopped = errMsg.includes("手动停止");
        if (log) {
          await updateCrawlLog(log.id, {
            status: "failed",
            message: errMsg,
            finishedAt: new Date(),
          });
        }
        await updateCrawlJob(job.id, { lastRunStatus: "failed" });
        throw new Error(stopped ? errMsg : `执行失败: ${errMsg}`);
      } finally {
        runningJobs.delete(job.id);
      }
    }),

  logs: publicProcedure
    .input(z.object({ jobId: z.number().int().optional() }))
    .query(async ({ input }) => {
      return getCrawlLogs(input.jobId);
    }),
});
