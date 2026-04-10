import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
  boolean,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// 资讯文章表
export const newsArticles = mysqlTable("news_articles", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 512 }).notNull(),
  summary: text("summary"),
  content: text("content"),
  source: mysqlEnum("source", ["Preqin", "Pitchbook", "Manual"]).notNull(),
  originalUrl: varchar("originalUrl", { length: 1024 }),
  author: varchar("author", { length: 128 }),
  // 标签：JSON 数组，如 ["私募股权", "亚太", "并购"]
  tags: json("tags").$type<string[]>(),
  // 策略类型
  strategy: mysqlEnum("strategy", [
    "私募股权",
    "风险投资",
    "房地产",
    "信贷",
    "基础设施",
    "对冲基金",
    "母基金",
    "并购",
    "成长股权",
    "其他",
  ]),
  // 地区
  region: mysqlEnum("region", [
    "全球",
    "亚太",
    "北美",
    "欧洲",
    "中国",
    "东南亚",
    "中东",
    "其他",
  ]),
  // 关键信息提取（JSON）
  keyInsights: json("keyInsights").$type<{ label: string; value: string }[]>(),
  // 智能章节化内容（JSON），由 LLM 生成，用于详情页结构化展示
  sections: json("sections").$type<{ heading: string; body: string }[]>(),
  publishedAt: timestamp("publishedAt").notNull(),
  isRead: boolean("isRead").default(false),
  /** 列表大类：报告（手工文档） / 资讯（站点抓取导入） */
  recordCategory: mysqlEnum("recordCategory", ["report", "news"])
    .default("news")
    .notNull(),
  /** 后台隐藏后全员列表与详情不可见（admin 除外） */
  isHidden: boolean("isHidden").default(false).notNull(),
  /** 正文中文译本（抓取正文多为英文时由导入流程写入） */
  contentZh: text("contentZh"),
  /** 手工上传文件：上传人 */
  uploaderUserId: int("uploaderUserId"),
  /** 文件上传时间 */
  fileUploadedAt: timestamp("fileUploadedAt"),
  /** 存储文件名（uploads/news 下） */
  attachmentStorageKey: varchar("attachmentStorageKey", { length: 512 }),
  attachmentMime: varchar("attachmentMime", { length: 128 }),
  attachmentOriginalName: varchar("attachmentOriginalName", { length: 512 }),
  /** 从正文/元数据推断的资讯相关时间说明 */
  effectivePeriodLabel: varchar("effectivePeriodLabel", { length: 512 }),
  /** 从 PDF/Word 抽取的全文，供预览与 AI 问答 */
  extractedText: text("extractedText"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type NewsArticle = typeof newsArticles.$inferSelect;
export type InsertNewsArticle = typeof newsArticles.$inferInsert;

// AI Bot 对话记录表
export const chatMessages = mysqlTable("chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("sessionId", { length: 64 }).notNull(),
  userId: int("userId"),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

// 稽后再看书签表
// 用户收藏的资讯，支持未登录用户通过 sessionId 识别
export const bookmarks = mysqlTable("bookmarks", {
  id: int("id").autoincrement().primaryKey(),
  articleId: int("articleId").notNull(),
  userId: int("userId"),
  sessionId: varchar("sessionId", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Bookmark = typeof bookmarks.$inferSelect;
export type InsertBookmark = typeof bookmarks.$inferInsert;

// 定时抓取任务配置表
export const crawlJobs = mysqlTable("crawl_jobs", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  url: varchar("url", { length: 1024 }).notNull(),
  source: mysqlEnum("source", ["Preqin", "Pitchbook"]).notNull(),
  // cron 表达式，如 "0 9 * * 1-5" 表示工作日早 9 点
  cronExpr: varchar("cronExpr", { length: 64 }).notNull(),
  // 抓取时间区间（天），如 7 表示抓取过去 7 天的资讯
  rangeInDays: int("rangeInDays").default(7).notNull(),
  isEnabled: boolean("isEnabled").default(true).notNull(),
  lastRunAt: timestamp("lastRunAt"),
  lastRunStatus: mysqlEnum("lastRunStatus", ["success", "failed", "running"]),
  lastRunMessage: text("lastRunMessage"),
  /** Preqin 等需登录站点：登录邮箱/用户名 */
  authUsername: varchar("authUsername", { length: 320 }),
  /** AES-GCM 加密后的密码（服务端解密，永不返回给前端） */
  authPasswordEnc: text("authPasswordEnc"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CrawlJob = typeof crawlJobs.$inferSelect;
export type InsertCrawlJob = typeof crawlJobs.$inferInsert;

// 抓取执行日志表
export const crawlLogs = mysqlTable("crawl_logs", {
  id: int("id").autoincrement().primaryKey(),
  jobId: int("jobId").notNull(),
  status: mysqlEnum("status", ["success", "failed", "running"]).notNull(),
  articlesFound: int("articlesFound").default(0),
  articlesAdded: int("articlesAdded").default(0),
  message: text("message"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
});

export type CrawlLog = typeof crawlLogs.$inferSelect;
export type InsertCrawlLog = typeof crawlLogs.$inferInsert;
