#!/usr/bin/env node
/**
 * 开发服务已启动后：请求 GET /api/dev/verify（含与浏览器同构的 tRPC HTTP、双域名），打印 JSON 并以退出码反映是否全部通过。
 * 由 pnpm run dev:restart 在服务就绪后自动调用；也可单独执行：pnpm run dev:verify
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
if (existsSync(envPath)) loadEnv({ path: envPath });

const port = String(
  process.env.VERIFY_PORT || process.env.PORT || "3000"
).trim() || "3000";
const url = `http://127.0.0.1:${port}/api/dev/verify`;

try {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error(`GET ${url} 非 JSON：`, text.slice(0, 500));
    process.exit(1);
  }
  console.log("\n======== 重启后快速验证（/api/dev/verify）========");
  console.log(JSON.stringify(json, null, 2));
  console.log("==================================================\n");
  process.exit(json.ok === true ? 0 : 1);
} catch (e) {
  console.error(`\n[dev:verify] 无法请求 ${url}`);
  console.error(e?.message ?? e);
  console.error("\n请先启动开发服务（pnpm dev 或 pnpm run dev:restart）。\n");
  process.exit(1);
}
