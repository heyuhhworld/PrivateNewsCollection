export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/** 是否已配置 OAuth 门户基地址（非空）。 */
export function isOAuthLoginConfigured(): boolean {
  return Boolean(import.meta.env.VITE_OAUTH_PORTAL_URL?.trim());
}

/**
 * 生成登录跳转 URL（含当前站点作为 redirectUri）。
 * 未配置 VITE_OAUTH_PORTAL_URL 或地址非法时返回 null（勿再回退到本站首页，否则点击登录看似无反应）。
 */
export function getLoginUrl(): string | null {
  const oauthPortalUrl =
    import.meta.env.VITE_OAUTH_PORTAL_URL?.trim().replace(/\/$/, "") ?? "";
  const appId = import.meta.env.VITE_APP_ID?.trim() ?? "";
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  if (!oauthPortalUrl) {
    return null;
  }

  try {
    const url = new URL(`${oauthPortalUrl}/app-auth`);
    url.searchParams.set("appId", appId);
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("type", "signIn");
    return url.toString();
  } catch {
    console.error(
      "[getLoginUrl] 无效的 VITE_OAUTH_PORTAL_URL:",
      oauthPortalUrl
    );
    return null;
  }
}
