#!/usr/bin/env node
/**
 * 本地开发「一键重启」清单：
 *
 * 1. 加载 .env
 * 2. 结束本机 dev（释放 PORT + 结束 tsx watch），避免与库重启抢连接
 * 3. 重启 MySQL（Docker / brew；未配置则跳过）
 * 4. 轮询 DATABASE_URL 直至可连（或超时）
 * 5. 对齐库表 → pnpm run db:ensure-schema
 * 6. 启动 pnpm dev（前后端同一进程）
 * 7. 等待 /api/health 就绪后执行快速验证（GET /api/dev/verify）：
 *    - LLM 补全
 *    - 列表 AI 检索（semanticSearchArticles）
 *    - AI 助手流式接口（POST /api/chat/stream）
 *    - 报告类附件磁盘 + /uploads 静态访问（库中有样本时）
 *
 * 环境变量见 .env.example（DOCKER_MYSQL_CONTAINER / MYSQL_BREW_SERVICE / SKIP_MYSQL_RESTART）。
 */
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
process.chdir(root);

const envPath = path.join(root, ".env");
if (existsSync(envPath)) {
  loadEnv({ path: envPath });
}

const port = String(process.env.PORT || "3000").trim() || "3000";
const dockerMysql = (process.env.DOCKER_MYSQL_CONTAINER || "").trim();
const brewMysql = (process.env.MYSQL_BREW_SERVICE || "").trim();
const skipMysql = process.env.SKIP_MYSQL_RESTART === "1" || process.env.SKIP_MYSQL_RESTART === "true";

function assertSafeName(name, kind) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(name)) {
    throw new Error(`[dev:restart] 非法 ${kind}: ${JSON.stringify(name)}`);
  }
  return name;
}

function killDev() {
  try {
    execSync(`lsof -ti :${port}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: "inherit" });
    console.log(`[dev:restart] 已结束占用端口 ${port} 的进程`);
  } catch {
    /* 无占用 */
  }
  try {
    execSync(
      'pkill -f "tsx watch server/_core/index.ts" 2>/dev/null || true',
      { shell: true, stdio: "pipe" }
    );
  } catch {
    /* ignore */
  }
}

function restartMysqlFromEnv() {
  if (skipMysql) {
    console.log("[dev:restart] 已设 SKIP_MYSQL_RESTART=1，跳过 MySQL 进程重启\n");
    return;
  }
  if (dockerMysql && brewMysql) {
    console.warn(
      "[dev:restart] 同时配置了 DOCKER_MYSQL_CONTAINER 与 MYSQL_BREW_SERVICE，仅执行 Docker 重启\n"
    );
  }
  if (dockerMysql) {
    const name = assertSafeName(dockerMysql, "DOCKER_MYSQL_CONTAINER");
    try {
      execSync(`docker restart ${name}`, { stdio: "inherit", env: process.env });
      console.log(`[dev:restart] 已执行 docker restart ${name}\n`);
    } catch (e) {
      console.warn(
        "[dev:restart] Docker 重启失败（未装 Docker、无权限或容器名不对）。可改 .env 或装 Docker 后重试。\n",
        e?.message ?? e
      );
    }
    return;
  }
  if (brewMysql) {
    const svc = assertSafeName(brewMysql, "MYSQL_BREW_SERVICE");
    try {
      execSync(`brew services restart ${svc}`, { stdio: "inherit", env: process.env });
      console.log(`[dev:restart] 已执行 brew services restart ${svc}\n`);
    } catch (e) {
      console.warn(
        "[dev:restart] brew services restart 失败（未用 Homebrew 装 MySQL 或服务名不对）。\n",
        e?.message ?? e
      );
    }
    return;
  }
  console.log(
    "[dev:restart] 未配置 DOCKER_MYSQL_CONTAINER / MYSQL_BREW_SERVICE，跳过 MySQL 进程重启（仅连已有实例）。\n" +
      "  若 MySQL 在 Docker 里：在 .env 增加一行，例如 DOCKER_MYSQL_CONTAINER=ipms-local-mysql\n" +
      "  若用 Homebrew：例如 MYSQL_BREW_SERVICE=mysql\n" +
      "  若不想每次重启库：SKIP_MYSQL_RESTART=1\n"
  );
}

async function waitForMysql() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log("[dev:restart] 无 DATABASE_URL，跳过等待 MySQL\n");
    return;
  }
  const { createConnection } = await import("mysql2/promise");
  for (let i = 0; i < 35; i++) {
    try {
      const c = await createConnection({ uri: url });
      await c.query("SELECT 1");
      await c.end();
      console.log(`[dev:restart] MySQL 已可连接（第 ${i + 1} 次探测）\n`);
      return;
    } catch {
      if (i === 0) console.log("[dev:restart] 等待 MySQL 接受连接…");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.warn(
    "[dev:restart] 35 秒内未连上 MySQL，仍继续执行 db:ensure-schema（可能失败）\n"
  );
}

async function waitForHttpHealth(maxSec = 90) {
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < maxSec; i++) {
    try {
      const r = await fetch(`${base}/api/health`, { cache: "no-store" });
      if (r.ok) return true;
    } catch {
      /* 服务尚未监听 */
    }
    if (i === 0) console.log("[dev:restart] 等待开发服务 /api/health …");
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  const steps = [
    `[1/7] 加载环境变量（${existsSync(envPath) ? ".env 已读" : "无 .env"}）`,
    `[2/7] 结束本机 dev（端口 ${port} + tsx watch）`,
    `[3/7] 重启 MySQL（Docker / brew，见 .env；可跳过）`,
    `[4/7] 等待 DATABASE_URL 可连接`,
    `[5/7] 对齐数据库结构 → pnpm run db:ensure-schema`,
    `[6/7] 启动 → pnpm dev（前后台同终端输出）`,
    `[7/7] 就绪后 GET /api/dev/verify（LLM / 列表AI / 助手流式 / 报告附件）`,
  ];

  console.log("\n======== IPMS 本地重启清单 ========");
  for (const s of steps) console.log(s);
  console.log("====================================\n");

  killDev();
  console.log("");

  restartMysqlFromEnv();
  await waitForMysql();

  try {
    execSync("pnpm run db:ensure-schema", { stdio: "inherit", env: process.env });
  } catch {
    console.warn(
      "\n[dev:restart] db:ensure-schema 失败。请检查 DATABASE_URL、MySQL 是否已启动；修好后再执行本脚本。\n"
    );
  }

  const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(pnpmCmd, ["dev"], {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });

  const healthy = await waitForHttpHealth(90);
  if (!healthy) {
    console.warn(
      "\n[dev:restart] 90 秒内 /api/health 未就绪，跳过快速验证；请查看上方 dev 日志。\n"
    );
  } else {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      execSync("node scripts/dev-verify.mjs", {
        stdio: "inherit",
        cwd: root,
        env: { ...process.env, VERIFY_PORT: port },
      });
    } catch {
      console.warn(
        "\n[dev:restart] 快速验证存在失败项（见上 JSON）；服务仍在前台运行，请按需修 .env / 数据后再执行 pnpm run dev:verify。\n"
      );
    }
  }

  const code = await new Promise((resolve) => {
    child.on("exit", (c, signal) => {
      resolve(signal ? 1 : (c ?? 0));
    });
  });
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
