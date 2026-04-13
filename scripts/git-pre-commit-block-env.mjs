/**
 * 防止误将含密钥的 .env 提交进仓库（与 .gitignore 双保险）。
 */
import { execSync } from "node:child_process";

const blocked = new Set([
  ".env",
  ".env.local",
  ".env.development.local",
  ".env.test.local",
  ".env.production.local",
]);

let staged = "";
try {
  staged = execSync("git diff --cached --name-only", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
} catch {
  process.exit(0);
}

const hits = staged
  .split("\n")
  .map((s) => s.trim())
  .filter((name) => blocked.has(name));

if (hits.length > 0) {
  console.error(
    "\n[ipms] 已阻止提交以下环境文件（含密钥，勿进 Git）：",
    hits.join(", ")
  );
  console.error("从暂存区移除：git restore --staged " + hits.join(" "));
  console.error("密钥只应保留在本机 .env；仓库内请维护 .env.example。\n");
  process.exit(1);
}

process.exit(0);
