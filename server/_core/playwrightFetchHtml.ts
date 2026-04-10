import { chromium } from "playwright";
import { MAX_FETCH_HTML_CHARS } from "./fetchImportConstants";
import { resolveStorageStatePathForUrl } from "./importSessionStorage";

function getProxyServer(): { server: string } | undefined {
  const raw =
    process.env.IMPORT_FETCH_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.ALL_PROXY?.trim();
  if (!raw) return undefined;
  return { server: raw };
}

/**
 * 使用 Chromium 无头浏览器加载页面，尽量贴近真实用户（与简单 HTTP 抓取相比更易通过 WAF/403）。
 */
export async function fetchHtmlWithPlaywright(
  url: string,
  headers: Record<string, string>
): Promise<string> {
  const proxy = getProxyServer();
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
    ...(proxy ? { proxy } : {}),
  });

  const hasCookieHeader = Boolean(headers["Cookie"]?.trim());
  const storageStatePath = resolveStorageStatePathForUrl(url, {
    skipIfCookieHeader: true,
    hasCookieHeader,
  });
  if (storageStatePath) {
    console.info(`[playwright] 使用已保存的站点会话：${storageStatePath}`);
  }

  const extraHTTPHeaders: Record<string, string> = {
    Accept:
      headers["Accept"] ??
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": headers["Accept-Language"] ?? "en-US,en;q=0.9",
    ...(headers["Referer"] ? { Referer: headers["Referer"] } : {}),
  };
  if (!storageStatePath && hasCookieHeader) {
    extraHTTPHeaders.Cookie = headers["Cookie"]!;
  }

  try {
    const context = await browser.newContext({
      ...(storageStatePath ? { storageState: storageStatePath } : {}),
      userAgent:
        headers["User-Agent"] ??
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      extraHTTPHeaders,
      viewport: { width: 1365, height: 900 },
      locale: "en-US",
      timezoneId: "America/New_York",
      javaScriptEnabled: true,
    });

    const page = await context.newPage();

    const resp = await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 })
      .catch((err) => {
        throw new Error(
          `页面导航失败：${err instanceof Error ? err.message : String(err)}`
        );
      });

    if (resp && resp.status() >= 400) {
      console.warn(
        `[playwright] ${url} HTTP ${resp.status()}，仍尝试解析已渲染 HTML`
      );
    }

    await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));

    let html = await page.content();
    if (html.length < 800) {
      await new Promise((r) => setTimeout(r, 2500));
      html = await page.content();
    }

    return html.slice(0, MAX_FETCH_HTML_CHARS);
  } finally {
    await browser.close();
  }
}
