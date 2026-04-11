import { and, desc, eq, gte, inArray, isNotNull, like, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  aiBriefings,
  chatMessages,
  InsertChatMessage,
  newsArticles,
  users,
  bookmarks,
  InsertBookmark,
  crawlJobs,
  InsertCrawlJob,
  crawlLogs,
  InsertCrawlLog,
  entities,
  InsertEntity,
  entityArticles,
  entityRelations,
  InsertEntityRelation,
  tagCorrections,
  InsertTagCorrection,
  briefingSubscriptions,
  InsertBriefingSubscription,
  articlePdfHighlights,
  articleReadingImages,
  readingEvents,
  userReadingProfiles,
  type NewsArticle,
  type PdfHighlightRectNorm,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _connectPromise: Promise<void> | null = null;
let _lastConnectError: string | null = null;

function rootErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const c = (err as Error & { cause?: unknown }).cause;
  if (c instanceof Error) return c.message;
  if (c != null && typeof c === "object" && "message" in c) {
    return String((c as { message: unknown }).message);
  }
  return err.message;
}

/** 供业务层在 getDb() 为 null 时返回给前端的说明 */
export function getDbUnavailableHint(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    return "未检测到 DATABASE_URL：请在项目根目录 .env 中配置 MySQL 连接串（例如 mysql://用户:密码@127.0.0.1:3306/库名），保存后务必重启 pnpm dev。";
  }
  if (_lastConnectError) {
    return `数据库连接失败：${_lastConnectError}`;
  }
  return "数据库暂不可用，请确认 MySQL 已启动，且用户、密码、库名正确；远程数据库需检查网络与白名单。";
}

async function ensureConnected(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return;
  try {
    const instance = drizzle(url);
    await instance.execute(sql.raw("SELECT 1"));
    _db = instance;
    _lastConnectError = null;
  } catch (e) {
    _db = null;
    _lastConnectError = rootErrorMessage(e);
    console.warn("[Database] Connection failed:", _lastConnectError, e);
  }
}

export async function getDb() {
  if (_db) return _db;
  if (!process.env.DATABASE_URL?.trim()) return null;
  if (!_connectPromise) {
    _connectPromise = ensureConnected();
  }
  await _connectPromise;
  return _db;
}

function isOwnerUser(openId: string, email?: string | null): boolean {
  if (ENV.ownerOpenId && openId === ENV.ownerOpenId) return true;
  if (!ENV.ownerEmail) return false;
  const e = ENV.ownerEmail;
  if (openId === `email:${e}`) return true;
  if (email && email.trim().toLowerCase() === e) return true;
  return false;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod", "passwordHash"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (isOwnerUser(user.openId, user.email)) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── News Articles ───────────────────────────────────────────────────────────

export interface NewsFilter {
  source?: "Preqin" | "Pitchbook" | "Manual";
  strategy?: string;
  region?: string;
  tag?: string;
  keyword?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
  recordCategory?: "report" | "news";
  /** 默认按发布时间；hot 按浏览量优先 */
  sortBy?: "published_desc" | "hot_desc";
}

export async function getNewsArticles(filter: NewsFilter = {}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const {
    source,
    strategy,
    region,
    tag,
    keyword,
    dateFrom,
    dateTo,
    page = 1,
    pageSize = 20,
    recordCategory,
    sortBy = "published_desc",
  } = filter;

  const conditions = [eq(newsArticles.isHidden, false)];
  if (source) conditions.push(eq(newsArticles.source, source));
  if (strategy) conditions.push(eq(newsArticles.strategy, strategy as any));
  if (region) conditions.push(eq(newsArticles.region, region as any));
  if (tag?.trim()) {
    conditions.push(
      sql`JSON_CONTAINS(${newsArticles.tags}, ${JSON.stringify(tag.trim())})`
    );
  }
  if (recordCategory) conditions.push(eq(newsArticles.recordCategory, recordCategory));
  if (keyword) {
    const kwExpr = or(
      like(newsArticles.title, `%${keyword}%`),
      like(newsArticles.summary, `%${keyword}%`),
      like(newsArticles.content, `%${keyword}%`),
      like(newsArticles.extractedText, `%${keyword}%`)
    );
    if (kwExpr) conditions.push(kwExpr);
  }
  if (dateFrom) conditions.push(gte(newsArticles.publishedAt, dateFrom));
  if (dateTo) conditions.push(lte(newsArticles.publishedAt, dateTo));

  const where = and(...conditions);

  const orderByExpr =
    sortBy === "hot_desc"
      ? [desc(newsArticles.viewCount), desc(newsArticles.publishedAt)]
      : [desc(newsArticles.publishedAt)];

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(newsArticles)
      .where(where)
      .orderBy(...orderByExpr)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: sql<number>`count(*)` })
      .from(newsArticles)
      .where(where),
  ]);

  return { items, total: Number(countResult[0]?.count ?? 0) };
}

export async function getNewsArticleById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(newsArticles)
    .where(eq(newsArticles.id, id))
    .limit(1);
  return result[0] ?? null;
}

export async function incrementArticleViewCount(id: number) {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(newsArticles)
      .set({ viewCount: sql`${newsArticles.viewCount} + 1` })
      .where(eq(newsArticles.id, id));
  } catch (e) {
    console.warn("[incrementArticleViewCount]", e);
  }
}

export async function updateNewsArticleEmbedding(id: number, embedding: number[]) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.update(newsArticles).set({ embedding }).where(eq(newsArticles.id, id));
  } catch (e) {
    console.warn("[updateNewsArticleEmbedding]", e);
  }
}

/** 用于语义检索：可见且已有 embedding 的资讯，按发布时间新到旧 */
export async function listNewsArticlesWithEmbeddings(limit: number): Promise<NewsArticle[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(newsArticles)
    .where(and(eq(newsArticles.isHidden, false), isNotNull(newsArticles.embedding)))
    .orderBy(desc(newsArticles.publishedAt))
    .limit(Math.min(limit, 8000));
}

export async function getNewsArticlesByIds(ids: number[]): Promise<NewsArticle[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(newsArticles)
    .where(and(eq(newsArticles.isHidden, false), inArray(newsArticles.id, ids)));
}

export async function insertAiBriefing(body: string) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(aiBriefings).values({ body });
  const row = await db
    .select()
    .from(aiBriefings)
    .orderBy(desc(aiBriefings.id))
    .limit(1);
  return row[0] ?? null;
}

export async function getLatestAiBriefing() {
  const db = await getDb();
  if (!db) return null;
  const row = await db
    .select()
    .from(aiBriefings)
    .orderBy(desc(aiBriefings.id))
    .limit(1);
  return row[0] ?? null;
}

export async function listRecentNewsArticlesSince(since: Date, limit: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(newsArticles)
    .where(
      and(eq(newsArticles.isHidden, false), gte(newsArticles.createdAt, since))
    )
    .orderBy(desc(newsArticles.publishedAt))
    .limit(limit);
}

export type AdminNewsArticleListItem = NewsArticle & {
  uploaderName: string | null;
  uploaderEmail: string | null;
};

export async function adminListNewsArticles(opts: {
  page?: number;
  pageSize?: number;
  visibility?: "all" | "visible" | "hidden";
}): Promise<{ items: AdminNewsArticleListItem[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const page = opts.page ?? 1;
  const pageSize = Math.min(opts.pageSize ?? 30, 100);
  const conditions = [];
  if (opts.visibility === "visible") conditions.push(eq(newsArticles.isHidden, false));
  if (opts.visibility === "hidden") conditions.push(eq(newsArticles.isHidden, true));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(newsArticles)
      .where(where)
      .orderBy(desc(newsArticles.publishedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: sql<number>`count(*)` })
      .from(newsArticles)
      .where(where),
  ]);

  const uploaderIds = Array.from(
    new Set(
      items
        .map((a) => a.uploaderUserId)
        .filter((id): id is number => typeof id === "number" && id > 0)
    )
  );
  let uploaderMap = new Map<number, { name: string | null; email: string | null }>();
  if (uploaderIds.length > 0) {
    const uploaders = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, uploaderIds));
    uploaderMap = new Map(
      uploaders.map((u) => [u.id, { name: u.name ?? null, email: u.email ?? null }])
    );
  }

  const enriched: AdminNewsArticleListItem[] = items.map((a) => {
    const u = a.uploaderUserId != null ? uploaderMap.get(a.uploaderUserId) : undefined;
    return {
      ...a,
      uploaderName: u?.name ?? null,
      uploaderEmail: u?.email ?? null,
    };
  });

  return { items: enriched, total: Number(countResult[0]?.count ?? 0) };
}

export async function adminSetNewsArticleHidden(id: number, isHidden: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(newsArticles).set({ isHidden }).where(eq(newsArticles.id, id));
}

export async function adminDeleteNewsArticle(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(bookmarks).where(eq(bookmarks.articleId, id));
  await db.delete(newsArticles).where(eq(newsArticles.id, id));
}

export async function markArticleAsRead(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(newsArticles).set({ isRead: true }).where(eq(newsArticles.id, id));
}

// ─── Bookmarks ────────────────────────────────────────────────────────────────

export async function addBookmark(data: InsertBookmark) {
  const db = await getDb();
  if (!db) return null;
  // Check if already bookmarked
  const conditions = [eq(bookmarks.articleId, data.articleId)];
  if (data.userId) conditions.push(eq(bookmarks.userId, data.userId));
  else if (data.sessionId) conditions.push(eq(bookmarks.sessionId, data.sessionId));
  const existing = await db.select().from(bookmarks).where(and(...conditions)).limit(1);
  if (existing.length > 0) return existing[0];
  await db.insert(bookmarks).values(data);
  const inserted = await db.select().from(bookmarks).where(and(...conditions)).limit(1);
  return inserted[0] ?? null;
}

export async function removeBookmark(articleId: number, userId?: number, sessionId?: string) {
  const db = await getDb();
  if (!db) return;
  const conditions = [eq(bookmarks.articleId, articleId)];
  if (userId) conditions.push(eq(bookmarks.userId, userId));
  else if (sessionId) conditions.push(eq(bookmarks.sessionId, sessionId));
  await db.delete(bookmarks).where(and(...conditions));
}

export async function getBookmarks(userId?: number, sessionId?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (userId) conditions.push(eq(bookmarks.userId, userId));
  else if (sessionId) conditions.push(eq(bookmarks.sessionId, sessionId));
  if (conditions.length === 0) return [];
  return db
    .select()
    .from(bookmarks)
    .where(and(...conditions))
    .orderBy(desc(bookmarks.createdAt));
}

export async function isBookmarked(articleId: number, userId?: number, sessionId?: string) {
  const db = await getDb();
  if (!db) return false;
  const conditions = [eq(bookmarks.articleId, articleId)];
  if (userId) conditions.push(eq(bookmarks.userId, userId));
  else if (sessionId) conditions.push(eq(bookmarks.sessionId, sessionId));
  const result = await db.select().from(bookmarks).where(and(...conditions)).limit(1);
  return result.length > 0;
}

// ─── Crawl Jobs ────────────────────────────────────────────────────────────────

export async function getCrawlJobs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(crawlJobs).orderBy(desc(crawlJobs.createdAt));
}

export async function getCrawlJobById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(crawlJobs).where(eq(crawlJobs.id, id)).limit(1);
  return result[0] ?? null;
}

export async function createCrawlJob(data: InsertCrawlJob) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(crawlJobs).values(data);
  const inserted = await db.select().from(crawlJobs).orderBy(desc(crawlJobs.createdAt)).limit(1);
  return inserted[0] ?? null;
}

export async function updateCrawlJob(id: number, data: Partial<InsertCrawlJob>) {
  const db = await getDb();
  if (!db) return;
  await db.update(crawlJobs).set(data).where(eq(crawlJobs.id, id));
}

export async function deleteCrawlJob(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(crawlJobs).where(eq(crawlJobs.id, id));
}

export async function getCrawlLogs(jobId?: number) {
  const db = await getDb();
  if (!db) return [];
  const where = jobId ? eq(crawlLogs.jobId, jobId) : undefined;
  return db
    .select()
    .from(crawlLogs)
    .where(where)
    .orderBy(desc(crawlLogs.startedAt))
    .limit(50);
}

export async function createCrawlLog(data: InsertCrawlLog) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(crawlLogs).values(data);
  const inserted = await db.select().from(crawlLogs).orderBy(desc(crawlLogs.startedAt)).limit(1);
  return inserted[0] ?? null;
}

export async function updateCrawlLog(id: number, data: Partial<InsertCrawlLog>) {
  const db = await getDb();
  if (!db) return;
  await db.update(crawlLogs).set(data).where(eq(crawlLogs.id, id));
}

// ─── Chat Messages ────────────────────────────────────────────────────────────

export async function getChatHistory(sessionId: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(chatMessages.createdAt);
}

export async function saveChatMessage(msg: InsertChatMessage) {
  const db = await getDb();
  if (!db) return;
  await db.insert(chatMessages).values(msg);
}

// ─── Entities (Knowledge Graph) ─────────────────────────────────────────────

export async function upsertEntity(data: {
  name: string;
  type: "fund" | "institution" | "person" | "other";
  aliases?: string[] | null;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const existing = await db
    .select()
    .from(entities)
    .where(eq(entities.name, data.name))
    .limit(1);
  if (existing.length > 0) return existing[0].id;
  await db.insert(entities).values({
    name: data.name,
    type: data.type,
    aliases: data.aliases ?? null,
  });
  const row = await db
    .select({ id: entities.id })
    .from(entities)
    .where(eq(entities.name, data.name))
    .limit(1);
  return row[0]?.id ?? null;
}

export async function linkEntityToArticle(
  entityId: number,
  articleId: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select()
    .from(entityArticles)
    .where(
      and(
        eq(entityArticles.entityId, entityId),
        eq(entityArticles.articleId, articleId)
      )
    )
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(entityArticles).values({ entityId, articleId });
}

export async function upsertEntityRelation(
  data: InsertEntityRelation
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select()
    .from(entityRelations)
    .where(
      and(
        eq(entityRelations.sourceEntityId, data.sourceEntityId),
        eq(entityRelations.targetEntityId, data.targetEntityId),
        eq(entityRelations.relationType, data.relationType)
      )
    )
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(entityRelations).values(data);
}

export async function getAllEntities() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(entities).orderBy(desc(entities.createdAt)).limit(2000);
}

export async function getAllEntityRelations() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(entityRelations)
    .orderBy(desc(entityRelations.createdAt))
    .limit(5000);
}

export async function getEntityArticleLinks(entityId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(entityArticles)
    .where(eq(entityArticles.entityId, entityId));
}

export async function getArticleEntityIds(articleId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ entityId: entityArticles.entityId })
    .from(entityArticles)
    .where(eq(entityArticles.articleId, articleId));
  return rows.map((r) => r.entityId);
}

export async function getEntitiesByIds(ids: number[]) {
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  return db.select().from(entities).where(inArray(entities.id, ids));
}

// ─── Tag Corrections ────────────────────────────────────────────────────────

export async function insertTagCorrection(
  data: InsertTagCorrection
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(tagCorrections).values(data);
}

export async function getRecentTagCorrections(limit = 30) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(tagCorrections)
    .orderBy(desc(tagCorrections.createdAt))
    .limit(limit);
}

export async function updateArticleTags(
  id: number,
  data: {
    tags?: string[];
    strategy?: string | null;
    region?: string | null;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const set: Record<string, unknown> = {};
  if (data.tags !== undefined) set.tags = data.tags;
  if (data.strategy !== undefined) set.strategy = data.strategy;
  if (data.region !== undefined) set.region = data.region;
  if (Object.keys(set).length === 0) return;
  await db.update(newsArticles).set(set).where(eq(newsArticles.id, id));
}

// ─── Briefing Subscriptions ─────────────────────────────────────────────────

export async function listBriefingSubscriptions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(briefingSubscriptions).orderBy(desc(briefingSubscriptions.createdAt));
}

export async function addBriefingSubscription(
  data: InsertBriefingSubscription
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(briefingSubscriptions).values(data);
}

export async function removeBriefingSubscription(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(briefingSubscriptions).where(eq(briefingSubscriptions.id, id));
}

export async function toggleBriefingSubscription(
  id: number,
  isEnabled: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(briefingSubscriptions)
    .set({ isEnabled })
    .where(eq(briefingSubscriptions.id, id));
}

// ─── PDF 高亮 / 研读图片 / 行为事件 ─────────────────────────────────────────

export async function listPdfHighlightsByArticle(articleId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(articlePdfHighlights)
    .where(eq(articlePdfHighlights.articleId, articleId))
    .orderBy(desc(articlePdfHighlights.createdAt));
}

export async function insertPdfHighlight(data: {
  articleId: number;
  userId: number | null;
  sessionId: string | null;
  page: number;
  rectsNorm: PdfHighlightRectNorm[];
  color?: string | null;
  note?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(articlePdfHighlights).values({
    articleId: data.articleId,
    userId: data.userId ?? undefined,
    sessionId: data.sessionId ?? undefined,
    page: data.page,
    rectsNorm: data.rectsNorm,
    color: data.color ?? undefined,
    note: data.note ?? undefined,
  });
}

export async function deletePdfHighlight(
  id: number,
  userId: number | null,
  isAdmin: boolean
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select()
    .from(articlePdfHighlights)
    .where(eq(articlePdfHighlights.id, id))
    .limit(1);
  const h = rows[0];
  if (!h) return false;
  if (!isAdmin && h.userId != null && h.userId !== userId) return false;
  if (!isAdmin && h.userId == null && userId != null) return false;
  await db.delete(articlePdfHighlights).where(eq(articlePdfHighlights.id, id));
  return true;
}

export async function listReadingImagesByArticle(articleId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(articleReadingImages)
    .where(eq(articleReadingImages.articleId, articleId))
    .orderBy(desc(articleReadingImages.createdAt));
}

export async function insertReadingImage(data: {
  articleId: number;
  createdByUserId: number | null;
  sessionId: string | null;
  storageKey: string;
  caption?: string | null;
  sourcePage?: number | null;
  sourceRect?: PdfHighlightRectNorm | null;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(articleReadingImages).values({
    articleId: data.articleId,
    createdByUserId: data.createdByUserId ?? undefined,
    sessionId: data.sessionId ?? undefined,
    storageKey: data.storageKey,
    caption: data.caption ?? undefined,
    sourcePage: data.sourcePage ?? undefined,
    sourceRect: data.sourceRect ?? undefined,
  });
  const row = await db
    .select({ id: articleReadingImages.id })
    .from(articleReadingImages)
    .where(eq(articleReadingImages.articleId, data.articleId))
    .orderBy(desc(articleReadingImages.id))
    .limit(1);
  return row[0]?.id ?? null;
}

export async function insertReadingEvent(data: {
  userId: number | null;
  sessionId: string | null;
  articleId: number | null;
  recordCategory: string | null;
  eventType: string;
  payload: Record<string, unknown> | null;
}) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(readingEvents).values({
      userId: data.userId ?? undefined,
      sessionId: data.sessionId ?? undefined,
      articleId: data.articleId ?? undefined,
      recordCategory: data.recordCategory ?? undefined,
      eventType: data.eventType,
      payload: data.payload ?? undefined,
    });
  } catch (e) {
    console.warn("[insertReadingEvent]", e);
  }
}

export async function getUserReadingProfile(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(userReadingProfiles)
    .where(eq(userReadingProfiles.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertUserReadingProfile(
  userId: number,
  summaryJson: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(userReadingProfiles)
    .values({ userId, summaryJson })
    .onDuplicateKeyUpdate({ set: { summaryJson, updatedAt: new Date() } });
}

/** 按最近事件聚合为简短画像（供 chat 注入，非原始流水） */
export async function rollupUserReadingProfile(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const rows = await db
    .select({
      eventType: readingEvents.eventType,
      c: sql<number>`count(*)`.mapWith(Number),
    })
    .from(readingEvents)
    .where(and(eq(readingEvents.userId, userId), gte(readingEvents.createdAt, since)))
    .groupBy(readingEvents.eventType);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.eventType] = r.c;
  const parts: string[] = [];
  if ((counts.article_open ?? 0) > 3) parts.push("近期频繁打开资讯/报告详情");
  if ((counts.citation_locate ?? 0) > 2) parts.push("多次使用助手引用定位到原文");
  if ((counts.pdf_highlight_save ?? 0) > 1) parts.push("有在 PDF 上保存团队高亮");
  if ((counts.reading_image_save ?? 0) > 0) parts.push("有保存重点图片到图片流");
  if ((counts.chat_ask ?? 0) > 5) parts.push("与助手问答较活跃");
  const summaryText =
    parts.length > 0 ? parts.join("；") : "近期研读行为较少，暂无显著偏好信号";
  await upsertUserReadingProfile(userId, {
    counts,
    summaryText,
    rolledUpAt: new Date().toISOString(),
  });
}
