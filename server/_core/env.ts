/**
 * 临时免登录（注入本地开发用户）：默认关闭，须显式开启。
 * - 设置 DEV_ALLOW_AUTH_BYPASS=1 或 true 时启用（开发/生产均可，用于内网临时放开）
 * - 设置 DEV_REQUIRE_AUTH=1 或 true 时强制关闭（兼容旧 .env）
 */
export const devAuthBypass =
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
  /** 与邮箱登录 openId 规则一致（小写）；与 OWNER_OPEN_ID 二选一或同时配置均可 */
  ownerEmail: process.env.OWNER_EMAIL?.trim().toLowerCase() ?? "",
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
  /** OpenAI 兼容 /v1/embeddings；默认 text-embedding-3-small */
  embeddingModel:
    process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
  /** 完整 Embeddings URL；未设则用 embeddingOpenAiBaseUrl 或 forgeApiUrl 拼 /v1/embeddings */
  embeddingApiUrl: process.env.EMBEDDING_API_URL?.trim() || "",
  /** 仅基址，拼 /v1/embeddings；可与 chat 的 forgeApiUrl 不同（网关无 embeddings 时用） */
  embeddingOpenAiBaseUrl: process.env.EMBEDDING_OPENAI_BASE_URL?.trim() || "",
  /** Cron 表达式：定时生成并推送简报；默认工作日早 8:30 */
  briefingCron: process.env.BRIEFING_CRON?.trim() || "30 8 * * 1-5",
  /** SMTP 邮件 */
  smtpHost: process.env.SMTP_HOST?.trim() || "",
  smtpPort: parseInt(process.env.SMTP_PORT?.trim() || "465", 10),
  smtpUser: process.env.SMTP_USER?.trim() || "",
  smtpPass: process.env.SMTP_PASS?.trim() || "",
  smtpFrom: process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || "",
  devAuthBypass,
};
