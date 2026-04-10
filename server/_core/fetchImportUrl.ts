import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import axios, { type AxiosRequestConfig } from "axios";
import { MAX_FETCH_HTML_CHARS } from "./fetchImportConstants";
import { fetchHtmlWithPlaywright } from "./playwrightFetchHtml";

export { MAX_FETCH_HTML_CHARS } from "./fetchImportConstants";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  /* ignore */
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getProxyUrl(): string | undefined {
  const raw =
    process.env.IMPORT_FETCH_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.ALL_PROXY?.trim();
  return raw || undefined;
}

function axiosProxyFromEnv(): AxiosRequestConfig["proxy"] | undefined {
  const raw = getProxyUrl();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    return {
      protocol: u.protocol.replace(":", "") === "https" ? "https" : "http",
      host: u.hostname,
      port,
    };
  } catch {
    return undefined;
  }
}

/** Pitchbook / Preqin 等站点对纯 HTTP 常返回 403，默认优先用无头浏览器 */
function hostPrefersBrowserFirst(url: string): boolean {
  if (
    process.env.IMPORT_HTTP_FIRST === "1" ||
    process.env.IMPORT_HTTP_FIRST === "true"
  ) {
    return false;
  }
  try {
    const h = new URL(url).hostname.toLowerCase();
    return (
      h === "pitchbook.com" ||
      h.endsWith(".pitchbook.com") ||
      h === "preqin.com" ||
      h.endsWith(".preqin.com") ||
      h === "www.preqin.com"
    );
  } catch {
    return false;
  }
}

function isLikelyBlockedError(e: unknown): boolean {
  if (axios.isAxiosError(e)) {
    const s = e.response?.status;
    if (
      s === 403 ||
      s === 401 ||
      s === 429 ||
      s === 503 ||
      s === 405
    ) {
      return true;
    }
  }
  const msg = e instanceof Error ? e.message : String(e);
  return /403|401|429|Forbidden|blocked|status code 403|status code 401|HTTP 403|HTTP 401/i.test(
    msg
  );
}

async function fetchHtmlDirect(
  url: string,
  headers: Record<string, string>
): Promise<string> {
  const proxy = axiosProxyFromEnv();

  const axiosConfig: AxiosRequestConfig = {
    timeout: 45_000,
    headers,
    maxContentLength: MAX_FETCH_HTML_CHARS,
    maxBodyLength: MAX_FETCH_HTML_CHARS,
    proxy,
    httpsAgent: new https.Agent({
      keepAlive: false,
      family: 4,
      minVersion: "TLSv1.2",
    }),
    httpAgent: new http.Agent({ keepAlive: false, family: 4 }),
    validateStatus: (s) => s >= 200 && s < 400,
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(700 * attempt);
    try {
      const resp = await axios.get(url, axiosConfig);
      const raw =
        typeof resp.data === "string" ? resp.data : String(resp.data ?? "");
      return raw.slice(0, MAX_FETCH_HTML_CHARS);
    } catch (e) {
      lastErr = e;
    }
  }

  try {
    const { Agent, ProxyAgent, fetch: undiciFetch } = await import("undici");
    const proxyUrl = getProxyUrl();
    const dispatcher = proxyUrl
      ? new ProxyAgent(proxyUrl)
      : new Agent({ connect: { family: 4 } });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const res = await undiciFetch(url, {
      headers,
      signal: controller.signal,
      dispatcher,
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const raw = await res.text();
    return raw.slice(0, MAX_FETCH_HTML_CHARS);
  } catch (e2) {
    const a = lastErr instanceof Error ? lastErr.message : String(lastErr);
    const b = e2 instanceof Error ? e2.message : String(e2);
    const hint =
      /TLS|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|aborted|fetch failed/i.test(
        `${a} ${b}`
      )
        ? " 可尝试：在 .env 中设置 IMPORT_FETCH_PROXY（如 http://127.0.0.1:7890）走本地代理、更换网络或使用 VPN；公司网络可能拦截境外站点。"
        : "";
    throw new Error(`${a || b}${hint}`);
  }
}

function playwrightInstallHint(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/Executable doesn't exist|browserType\.launch|chromium/i.test(m)) {
    return " 请先在本机执行：pnpm exec playwright install chromium";
  }
  return "";
}

/**
 * 抓取资讯页 HTML：Pitchbook/Preqin 默认无头浏览器；其余先 HTTP，遇 403 等再回退浏览器。
 */
export async function fetchHtmlForArticleImport(
  url: string,
  headers: Record<string, string>
): Promise<string> {
  if (process.env.IMPORT_SKIP_PLAYWRIGHT === "1") {
    return fetchHtmlDirect(url, headers);
  }

  if (hostPrefersBrowserFirst(url)) {
    try {
      return await fetchHtmlWithPlaywright(url, headers);
    } catch (e) {
      const hint = playwrightInstallHint(e);
      console.warn(`[Import] Playwright 失败，回退 HTTP：${e}${hint}`);
      try {
        return await fetchHtmlDirect(url, headers);
      } catch (e2) {
        const msg = e instanceof Error ? e.message : String(e);
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        throw new Error(
          `无头浏览器抓取失败：${msg}${hint}；HTTP 回退也失败：${msg2}`
        );
      }
    }
  }

  try {
    return await fetchHtmlDirect(url, headers);
  } catch (e) {
    if (!isLikelyBlockedError(e)) {
      throw e;
    }
    console.warn(`[Import] HTTP 被拒绝或拦截，改用 Chromium 无头浏览器…`);
    try {
      return await fetchHtmlWithPlaywright(url, headers);
    } catch (e2) {
      const hint = playwrightInstallHint(e2);
      const msg = e instanceof Error ? e.message : String(e);
      const msg2 = e2 instanceof Error ? e2.message : String(e2);
      throw new Error(`HTTP：${msg}；浏览器模式：${msg2}${hint}`);
    }
  }
}
