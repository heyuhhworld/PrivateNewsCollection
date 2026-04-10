import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the database module
vi.mock("./db", () => ({
  getNewsArticles: vi.fn().mockResolvedValue({
    items: [
      {
        id: 1,
        title: "Test Article",
        source: "Preqin",
        strategy: "私募股权",
        region: "亚太",
        summary: "Test summary",
        content: "Test content",
        tags: ["私募股权", "亚太", "募资"],
        keyInsights: null,
        originalUrl: "https://preqin.com/test",
        author: "Test Author",
        publishedAt: new Date("2026-04-08"),
        isRead: false,
        isHidden: false,
        recordCategory: "news" as const,
        contentZh: null,
        createdAt: new Date("2026-04-08"),
        updatedAt: new Date("2026-04-08"),
      },
    ],
    total: 1,
  }),
  getNewsArticleById: vi.fn().mockResolvedValue({
    id: 1,
    title: "Test Article",
    source: "Preqin",
    strategy: "私募股权",
    region: "亚太",
    summary: "Test summary",
    content: "Test content",
    tags: ["私募股权", "亚太"],
    keyInsights: null,
    originalUrl: "https://preqin.com/test",
    author: "Test Author",
    publishedAt: new Date("2026-04-08"),
    isRead: false,
    isHidden: false,
    recordCategory: "news" as const,
    contentZh: null,
    createdAt: new Date("2026-04-08"),
    updatedAt: new Date("2026-04-08"),
  }),
  markArticleAsRead: vi.fn().mockResolvedValue(undefined),
  markNewsAsRead: vi.fn().mockResolvedValue(undefined),
}));

function createTestContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("news router", () => {
  it("news.list returns paginated articles", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.news.list({ page: 1, pageSize: 10 });

    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.total).toBe(1);
  });

  it("news.list accepts source filter", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.news.list({ source: "Preqin", page: 1, pageSize: 10 });
    expect(result).toHaveProperty("items");
  });

  it("news.list accepts strategy filter", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.news.list({ strategy: "私募股权", page: 1, pageSize: 10 });
    expect(result).toHaveProperty("items");
  });

  it("news.detail returns article by id", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.news.detail({ id: 1 });
    expect(result).toHaveProperty("id", 1);
    expect(result).toHaveProperty("title", "Test Article");
    expect(result).toHaveProperty("source", "Preqin");
  });

  it("news.markRead accepts valid id", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.news.markRead({ id: 1 });
    expect(result).toHaveProperty("success", true);
  });
});

describe("auth.logout", () => {
  it("clears session cookie and returns success", async () => {
    const clearedCookies: { name: string; options: Record<string, unknown> }[] = [];

    const ctx: TrpcContext = {
      user: {
        id: 1,
        openId: "test-user",
        email: "test@example.com",
        name: "Test User",
        loginMethod: "manus",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: {
        protocol: "https",
        headers: {},
      } as TrpcContext["req"],
      res: {
        clearCookie: (name: string, options: Record<string, unknown>) => {
          clearedCookies.push({ name, options });
        },
      } as unknown as TrpcContext["res"],
    };

    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
  });
});
