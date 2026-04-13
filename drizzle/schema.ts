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
  passwordHash: varchar("passwordHash", { length: 255 }),
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
  source: mysqlEnum("source", ["Preqin", "Pitchbook", "Manual", "ChromeExtension"]).notNull(),
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
  /**
   * PDF 抽取时：与 extractedText 按行对齐（非空行），每项为该行在 PDF 中的真实页码（1-based）。
   * Word/纯文本或未回填的旧数据为 null。
   */
  extractedLinePageMap: json("extractedLinePageMap").$type<number[] | null>(),
  /** 详情页浏览累计，用于列表热度展示 */
  viewCount: int("viewCount").default(0).notNull(),
  /** 标题+摘要+要点 的 embedding，用于语义检索（JSON 浮点数组） */
  embedding: json("embedding").$type<number[] | null>(),
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

/** AI 生成的每日简报（晨报） */
export const aiBriefings = mysqlTable("ai_briefings", {
  id: int("id").autoincrement().primaryKey(),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AiBriefing = typeof aiBriefings.$inferSelect;
export type InsertAiBriefing = typeof aiBriefings.$inferInsert;

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

// ─── 知识图谱：实体 ──────────────────────────────────────────────────────────
export const entities = mysqlTable("entities", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  type: mysqlEnum("type", ["fund", "institution", "person", "other"]).notNull(),
  aliases: json("aliases").$type<string[]>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Entity = typeof entities.$inferSelect;
export type InsertEntity = typeof entities.$inferInsert;

// 实体 ↔ 文章关联
export const entityArticles = mysqlTable("entity_articles", {
  id: int("id").autoincrement().primaryKey(),
  entityId: int("entityId").notNull(),
  articleId: int("articleId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type EntityArticle = typeof entityArticles.$inferSelect;

// 实体关系
export const entityRelations = mysqlTable("entity_relations", {
  id: int("id").autoincrement().primaryKey(),
  sourceEntityId: int("sourceEntityId").notNull(),
  targetEntityId: int("targetEntityId").notNull(),
  relationType: varchar("relationType", { length: 64 }).notNull(),
  articleId: int("articleId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type EntityRelation = typeof entityRelations.$inferSelect;
export type InsertEntityRelation = typeof entityRelations.$inferInsert;

// ─── 标签修正记录 ────────────────────────────────────────────────────────────
export const tagCorrections = mysqlTable("tag_corrections", {
  id: int("id").autoincrement().primaryKey(),
  articleId: int("articleId").notNull(),
  userId: int("userId"),
  fieldName: mysqlEnum("fieldName", ["tags", "strategy", "region"]).notNull(),
  oldValue: text("oldValue"),
  newValue: text("newValue"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TagCorrection = typeof tagCorrections.$inferSelect;
export type InsertTagCorrection = typeof tagCorrections.$inferInsert;

// ─── 简报推送订阅 ────────────────────────────────────────────────────────────
export const briefingSubscriptions = mysqlTable("briefing_subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  email: varchar("email", { length: 320 }),
  webhookUrl: varchar("webhookUrl", { length: 1024 }),
  isEnabled: boolean("isEnabled").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type BriefingSubscription = typeof briefingSubscriptions.$inferSelect;
export type InsertBriefingSubscription = typeof briefingSubscriptions.$inferInsert;

/** PDF 上用户持久化高亮（归一化矩形，团队同文可见） */
export type PdfHighlightRectNorm = { x: number; y: number; w: number; h: number };

export const articlePdfHighlights = mysqlTable("article_pdf_highlights", {
  id: int("id").autoincrement().primaryKey(),
  articleId: int("articleId").notNull(),
  userId: int("userId"),
  sessionId: varchar("sessionId", { length: 64 }),
  page: int("page").notNull(),
  rectsNorm: json("rectsNorm").$type<PdfHighlightRectNorm[]>().notNull(),
  color: varchar("color", { length: 32 }).default("#fde047"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ArticlePdfHighlight = typeof articlePdfHighlights.$inferSelect;
export type InsertArticlePdfHighlight = typeof articlePdfHighlights.$inferInsert;

/** 报告/资讯研读剪藏图片（团队同文可见） */
export const articleReadingImages = mysqlTable("article_reading_images", {
  id: int("id").autoincrement().primaryKey(),
  articleId: int("articleId").notNull(),
  createdByUserId: int("createdByUserId"),
  sessionId: varchar("sessionId", { length: 64 }),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  caption: text("caption"),
  sourcePage: int("sourcePage"),
  sourceRect: json("sourceRect").$type<PdfHighlightRectNorm | null>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ArticleReadingImage = typeof articleReadingImages.$inferSelect;
export type InsertArticleReadingImage = typeof articleReadingImages.$inferInsert;

/** 轻量研读行为事件（用于汇总画像，不直传原始流水进 LLM） */
export const readingEvents = mysqlTable("reading_events", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  sessionId: varchar("sessionId", { length: 64 }),
  articleId: int("articleId"),
  recordCategory: varchar("recordCategory", { length: 32 }),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  payload: json("payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ReadingEvent = typeof readingEvents.$inferSelect;
export type InsertReadingEvent = typeof readingEvents.$inferInsert;

/** 用户阅读习惯汇总（由 reading_events rollup） */
export const userReadingProfiles = mysqlTable("user_reading_profiles", {
  userId: int("userId").notNull().primaryKey(),
  summaryJson: json("summaryJson").$type<Record<string, unknown>>().notNull(),
  /** 用户对「每日简报」正文的额外写作要求（合并进 system prompt） */
  briefingInstruction: text("briefingInstruction"),
  /** 已在简报页看过默认 prompt 说明（含「暂不调整」），不再自动弹层 */
  briefingIntroCompleted: boolean("briefingIntroCompleted").default(false).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserReadingProfile = typeof userReadingProfiles.$inferSelect;
export type InsertUserReadingProfile = typeof userReadingProfiles.$inferInsert;
