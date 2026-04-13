import type { Express, Request, Response } from "express";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { existsSync } from "node:fs";
import path from "node:path";
import superjson from "superjson";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { newsArticles } from "../../drizzle/schema";
import { getDb } from "../db";
import { invokeLLM } from "./llm";
import { semanticSearchArticles } from "./semanticSearch";
import type { AppRouter } from "../routers";

function createBrowserLikeTrpcClient(originBase: string) {
  const base = originBase.replace(/\/$/, "");
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${base}/api/trpc`,
        transformer: superjson,
        fetch(url, init) {
          return fetch(url, {
            ...(init ?? {}),
            credentials: "include",
          } as RequestInit);
        },
      }),
    ],
  });
}

/**
 * 与浏览器资讯页并行请求一致：`news.list` + `news.recommend`（热门阅读），
 * 同一次 httpBatchLink、真实 POST /api/trpc。
 */
async function trpcNewsPageLikeBrowser(originBase: string) {
  const client = createBrowserLikeTrpcClient(originBase);
  const [listOut, recOut] = await Promise.all([
    client.news.list.query({
      page: 1,
      pageSize: 2,
      recordCategory: "news",
    }),
    client.news.recommend.query({ sessionId: "dev_verify_no_ls" }),
  ]);
  return { listOut, recOut };
}

/**
 * 仅开发环境：重启后一键探活（含与浏览器同构的 tRPC HTTP，避免「脚本过了、页面仍 Failed to fetch」）。
 * 生产环境不注册此路由。
 */
export function registerDevVerifyRoute(app: Express): void {
  app.get("/api/dev/verify", async (_req: Request, res: Response) => {
    if (process.env.NODE_ENV !== "development") {
      res.status(404).end();
      return;
    }

    const result: { ok: boolean; checks: Record<string, unknown> } = {
      ok: true,
      checks: {},
    };

    const fail = (key: string, payload: Record<string, unknown>) => {
      result.checks[key] = payload;
      result.ok = false;
    };

    try {
      const db = await getDb();
      if (!db) {
        fail("database", { ok: false, error: "getDb() 为 null（检查 DATABASE_URL）" });
      } else {
        await db.execute(sql`SELECT 1`);
        result.checks.database = { ok: true };
      }
    } catch (e) {
      fail("database", { ok: false, error: String(e) });
    }

    const port = parseInt(process.env.PORT || "3000", 10);
    const trpcOrigins: Array<Record<string, unknown>> = [];
    let trpcAllOk = true;
    for (const base of [`http://127.0.0.1:${port}`, `http://localhost:${port}`]) {
      try {
        const { listOut, recOut } = await trpcNewsPageLikeBrowser(base);
        trpcOrigins.push({
          base,
          ok: true,
          list: { total: listOut.total, itemCount: listOut.items.length },
          recommend: {
            mode: recOut.mode,
            itemCount: recOut.items.length,
          },
        });
      } catch (e) {
        trpcAllOk = false;
        trpcOrigins.push({ base, ok: false, error: String(e) });
      }
    }
    result.checks.browserTrpcNewsList = {
      ok: trpcAllOk,
      origins: trpcOrigins,
      note:
        "须两路均成功；每路含 news.list + news.recommend（与资讯页并行 tRPC 一致），避免只测列表而热门阅读仍 Failed to fetch",
    };
    if (!trpcAllOk) result.ok = false;

    try {
      const resp = await invokeLLM({
        messages: [
          {
            role: "system",
            content: "只输出一个英文单词 ping，不要其它任何字符。",
          },
          { role: "user", content: "开始" },
        ],
        max_tokens: 32,
      });
      const raw = resp.choices?.[0]?.message?.content;
      const text = typeof raw === "string" ? raw.trim() : "";
      result.checks.llm = { ok: true, preview: text.slice(0, 80) };
    } catch (e) {
      fail("llm", { ok: false, error: String(e) });
    }

    try {
      const items = await semanticSearchArticles("私募股权 市场", {
        limit: 5,
        fallbackKeyword: true,
      });
      result.checks.listAiSearch = {
        ok: true,
        resultCount: items.length,
        note: "semanticSearchArticles（与列表「AI」语义/关键词检索同源）",
      };
    } catch (e) {
      fail("listAiSearch", { ok: false, error: String(e) });
    }

    const chatOrigins: Array<Record<string, unknown>> = [];
    let chatAllOk = true;
    for (const host of [`http://127.0.0.1:${port}`, `http://localhost:${port}`]) {
      try {
        const url = `${host}/api/chat/stream`;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 25000);
        const sr = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: `ipms-dev-verify-${Date.now()}-${host.slice(-4)}`,
            message: "只回答一个字：好",
          }),
          signal: ac.signal,
        });
        clearTimeout(timer);
        const raw = await sr.text();
        const hasSse =
          raw.includes('"type":"chunk"') ||
          raw.includes('"type":"done"') ||
          (raw.includes("data:") && raw.length > 10);
        const ok = sr.ok && hasSse;
        if (!ok) chatAllOk = false;
        chatOrigins.push({
          base: host,
          ok,
          status: sr.status,
          preview: raw.slice(0, 120),
        });
      } catch (e) {
        chatAllOk = false;
        chatOrigins.push({ base: host, ok: false, error: String(e) });
      }
    }
    result.checks.chatAssistant = {
      ok: chatAllOk,
      origins: chatOrigins,
      note: "两域名均须能走 SSE，与浏览器打开 localhost / 127 一致",
    };
    if (!chatAllOk) result.ok = false;

    try {
      const db = await getDb();
      if (!db) {
        result.checks.reportAttachment = {
          ok: true,
          skipped: true,
          note: "无数据库连接，跳过",
        };
      } else {
        const rows = await db
          .select({
            id: newsArticles.id,
            key: newsArticles.attachmentStorageKey,
            mime: newsArticles.attachmentMime,
          })
          .from(newsArticles)
          .where(
            and(
              eq(newsArticles.recordCategory, "report"),
              isNotNull(newsArticles.attachmentStorageKey)
            )
          )
          .limit(1);

        const row = rows[0];
        if (!row?.key) {
          result.checks.reportAttachment = {
            ok: true,
            skipped: true,
            note: "库中暂无带附件的报告类资讯，跳过磁盘与静态 URL 校验",
          };
        } else {
          const safeKey =
            typeof row.key === "string" &&
            row.key.length > 0 &&
            !row.key.includes("..") &&
            !row.key.includes("/") &&
            !row.key.includes("\\")
              ? row.key
              : null;
          const fp = safeKey
            ? path.join(process.cwd(), "uploads", "news", safeKey)
            : "";
          const diskOk = Boolean(safeKey && fp && existsSync(fp));
          let staticOk = false;
          let staticByOrigin: Array<{ url: string; ok: boolean }> | undefined;
          if (diskOk && safeKey) {
            const paths = [
              `http://127.0.0.1:${port}/uploads/news/${encodeURIComponent(safeKey)}`,
              `http://localhost:${port}/uploads/news/${encodeURIComponent(safeKey)}`,
            ];
            staticByOrigin = [];
            for (const up of paths) {
              let ok = false;
              try {
                const hr = await fetch(up, {
                  method: "HEAD",
                  signal: AbortSignal.timeout(8000),
                });
                ok = hr.ok || hr.status === 200 || hr.status === 304;
                if (!ok) {
                  const gr = await fetch(up, {
                    method: "GET",
                    signal: AbortSignal.timeout(8000),
                  });
                  ok = gr.ok;
                }
              } catch {
                ok = false;
              }
              staticByOrigin.push({ url: up, ok });
            }
            staticOk = staticByOrigin.every((x) => x.ok);
          }
          result.checks.reportAttachment = {
            ok: diskOk && staticOk,
            articleId: row.id,
            storageKey: row.key,
            diskPathExists: diskOk,
            staticUrlOk: staticOk,
            mime: row.mime ?? null,
            ...(!safeKey ? { note: "附件 storageKey 含路径字符或为空，跳过校验" } : {}),
            ...(staticByOrigin ? { staticByOrigin } : {}),
          };
          if (!safeKey || !diskOk || !staticOk) {
            result.ok = false;
          }
        }
      }
    } catch (e) {
      fail("reportAttachment", { ok: false, error: String(e) });
    }

    res.setHeader("cache-control", "no-store");
    res.status(200).json(result);
  });
}
