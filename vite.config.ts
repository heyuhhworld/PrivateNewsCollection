import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";

// =============================================================================
// Manus Debug Collector - 仅注入脚本；POST /__manus__/logs 由 Express 注册（见 manusDebugLogs.ts）
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;

/** 开发环境在 index.html 注入采集脚本；落盘由 Express 处理，避免 middlewareMode 下 Vite 收不到 POST */
function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "manus-debug-collector",

    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true,
            },
            injectTo: "head",
          },
        ],
      };
    },
  };
}

/** 将 pdfjs worker 拷到 client/public，避免 dev 下 ?url 变成 @fs/... 导致浏览器无法加载 */
function ensurePdfjsWorkerPublic(): Plugin {
  const src = path.join(PROJECT_ROOT, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
  const dest = path.join(PROJECT_ROOT, "client", "public", "pdf.worker.min.mjs");
  return {
    name: "ensure-pdfjs-worker-public",
    buildStart() {
      try {
        if (!fs.existsSync(src)) return;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      } catch (e) {
        console.warn("[ensure-pdfjs-worker-public]", e);
      }
    },
  };
}

const plugins = [
  react(),
  tailwindcss(),
  jsxLocPlugin(),
  vitePluginManusRuntime(),
  vitePluginManusDebugCollector(),
  ensurePdfjsWorkerPublic(),
];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
