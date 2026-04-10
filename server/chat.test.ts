import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock db module
vi.mock("./db", () => ({
  getNewsArticles: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getNewsArticleById: vi.fn().mockResolvedValue(null),
  markArticleAsRead: vi.fn().mockResolvedValue(undefined),
  getChatHistory: vi.fn().mockResolvedValue([]),
  saveChatMessage: vi.fn().mockResolvedValue(undefined),
}));

// Mock LLM
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: "根据最新资讯，私募股权市场表现活跃，Blackstone 完成了 304 亿美元的房地产基金募集。",
        },
      },
    ],
  }),
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

describe("chat router", () => {
  it("chat.send returns AI response content", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.chat.send({
      sessionId: "test-session-123",
      message: "最近有哪些重要的私募股权资讯？",
    });

    expect(result).toHaveProperty("content");
    expect(typeof result.content).toBe("string");
    expect(result.content.length).toBeGreaterThan(0);
  });

  it("chat.send accepts different session IDs", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result1 = await caller.chat.send({
      sessionId: "session-a",
      message: "分析亚太地区投资趋势",
    });

    const result2 = await caller.chat.send({
      sessionId: "session-b",
      message: "总结基础设施投资动态",
    });

    expect(result1).toHaveProperty("content");
    expect(result2).toHaveProperty("content");
  });

  it("chat.send validates required fields", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Empty message should fail validation
    await expect(
      caller.chat.send({ sessionId: "test", message: "" })
    ).rejects.toThrow();
  });
});
