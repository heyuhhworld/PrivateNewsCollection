import "dotenv/config";
import path from "path";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerExtensionCors } from "./extensionCors";
import { registerExtensionImportRoutes } from "./extensionImport";
import { registerOAuthRoutes } from "./oauth";
import { registerNewsUploadRoutes } from "./newsUpload";
import { registerReadingImageUploadRoutes } from "./readingImageUpload";
import { registerChatStreamRoute } from "./chatStreamRoute";
import { registerChromeExtensionDownload } from "./chromeExtensionDownload";
import { registerLanHintRoute } from "./lanHintRoute";
import { startScheduler } from "./scheduler";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

async function startServer() {
  const app = express();
  const server = createServer(app);
  registerExtensionCors(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  /** 浏览器直接打开可确认后端是否在跑（与 tRPC 无关） */
  app.get("/api/health", (_req, res) => {
    res.setHeader("cache-control", "no-store");
    res.status(200).json({ ok: true });
  });

  registerChromeExtensionDownload(app);
  registerLanHintRoute(app);

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
  registerNewsUploadRoutes(app);
  registerExtensionImportRoutes(app);
  registerReadingImageUploadRoutes(app);
  registerChatStreamRoute(app);
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "3000", 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`无效 PORT: ${process.env.PORT ?? ""}`);
  }

  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[启动失败] 端口 ${port} 已被占用。请结束占用进程后重试（开发模式不再自动改用其它端口）。\n` +
          `  macOS 可执行: lsof -ti :${port} | xargs kill -9`
      );
    } else {
      console.error("[server listen]", err);
    }
    process.exit(1);
  });

  const bindHost = process.env.BIND_HOST?.trim() || "0.0.0.0";
  server.listen(port, bindHost, () => {
    console.log(`Server running on http://127.0.0.1:${port}/`);
    console.log(`  (bound ${bindHost}; 浏览器也可用 http://localhost:${port}/ )`);
    startScheduler();
  });
}

startServer().catch(console.error);
