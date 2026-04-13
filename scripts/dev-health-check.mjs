#!/usr/bin/env node
/**
 * 检查本机 dev 后端是否可访问（与浏览器 tRPC 无关的轻量探活）。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
if (existsSync(envPath)) loadEnv({ path: envPath });

const port = String(process.env.PORT || "3000").trim() || "3000";
const url = `http://127.0.0.1:${port}/api/health`;

try {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  console.log(`GET ${url} → ${res.status} ${res.statusText}`);
  console.log(text);
  if (!res.ok) process.exit(1);
  try {
    const j = JSON.parse(text);
    if (j?.ok !== true) process.exit(1);
  } catch {
    process.exit(1);
  }
  console.log(
    "\n[dev:check] 后端正常，可刷新资讯页。完整链路（LLM / 列表AI / 助手 / 报告附件）请执行: pnpm run dev:verify\n"
  );
} catch (e) {
  console.error(`\n[dev:check] 无法连接 ${url}`);
  console.error(e?.message ?? e);
  console.error("\n请先在本机项目根目录执行: pnpm run dev:restart\n");
  process.exit(1);
}
