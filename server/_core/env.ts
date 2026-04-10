/**
 * 开发环境免登录（注入本地开发用户）：默认关闭，须显式开启。
 * - 设置 DEV_ALLOW_AUTH_BYPASS=1 或 true 时启用（仅 NODE_ENV=development）
 * - 设置 DEV_REQUIRE_AUTH=1 或 true 时强制关闭（兼容旧 .env）
 */
export const devAuthBypass =
  process.env.NODE_ENV === "development" &&
  process.env.DEV_REQUIRE_AUTH !== "1" &&
  process.env.DEV_REQUIRE_AUTH !== "true" &&
  (process.env.DEV_ALLOW_AUTH_BYPASS === "1" ||
    process.env.DEV_ALLOW_AUTH_BYPASS === "true");

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  /** LLM 基址（不含路径）；代码会拼接 `/v1/chat/completions`。可与 OPENAI_BASE_URL 二选一 */
  forgeApiUrl:
    process.env.BUILT_IN_FORGE_API_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    "",
  /** Bearer Token；可与 OPENAI_API_KEY 二选一 */
  forgeApiKey:
    process.env.BUILT_IN_FORGE_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "",
  /** chat/completions 的 model 字段；可用 LLM_MODEL 或 OPENAI_MODEL 覆盖 */
  llmModel:
    process.env.LLM_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-5.4",
  devAuthBypass,
};
