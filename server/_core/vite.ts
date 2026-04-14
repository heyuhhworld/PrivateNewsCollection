import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("/{*path}", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

function resolveClientDistDir(): string {
  const here = import.meta.dirname;
  // `node dist/index.js` → dirname 为 …/dist，静态资源在 …/dist/public
  const nextToBundle = path.join(here, "public");
  // `tsx server/_core/index.ts` → dirname 为 …/server/_core，构建产物在 …/dist/public
  const fromRepoRoot = path.resolve(here, "../..", "dist", "public");
  if (fs.existsSync(path.join(nextToBundle, "index.html"))) {
    return nextToBundle;
  }
  if (fs.existsSync(path.join(fromRepoRoot, "index.html"))) {
    return fromRepoRoot;
  }
  return fromRepoRoot;
}

export function serveStatic(app: Express) {
  const distPath = resolveClientDistDir();
  const indexHtml = path.resolve(distPath, "index.html");

  if (!fs.existsSync(indexHtml)) {
    console.error(
      `[serveStatic] 找不到前端构建产物: ${indexHtml}\n` +
        `请先执行: pnpm build`
    );
    process.exit(1);
  }

  app.use(express.static(distPath));

  // SPA：非静态文件请求回退到 index.html
  app.use("/{*path}", (_req, res) => {
    res.sendFile(indexHtml);
  });
}
