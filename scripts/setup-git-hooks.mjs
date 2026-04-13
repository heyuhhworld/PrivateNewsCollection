/**
 * 将本仓库的 Git hooks 目录设为 .githooks（仅本仓库生效）。
 * CI / 无 .git 目录时跳过。
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

if (process.env.CI === "true" || process.env.GITHUB_ACTIONS) process.exit(0);
if (!existsSync(path.join(root, ".git"))) process.exit(0);

try {
  execSync("git config core.hooksPath .githooks", { cwd: root, stdio: "pipe" });
  console.log("[ipms] Git hooks 已指向 .githooks（提交前会拦截 .env）");
} catch {
  // 非 git 仓库或权限不足时静默跳过
}
