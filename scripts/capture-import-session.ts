/**
 * 首次在本机用「真实浏览器窗口」登录 Pitchbook / Preqin，保存 Playwright storageState，
 * 后续链接导入与无头抓取会自动读取 data/import-sessions/*.json 复用登录态。
 *
 * 用法：pnpm run import:session -- pitchbook
 *       pnpm run import:session -- preqin
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { chromium } from "playwright";

const source = process.argv[2]?.toLowerCase();
if (source !== "pitchbook" && source !== "preqin") {
  console.error("用法: pnpm run import:session -- <pitchbook|preqin>");
  process.exit(1);
}

const dir = path.join(process.cwd(), "data", "import-sessions");
fs.mkdirSync(dir, { recursive: true });
const outPath = path.join(dir, `${source}.json`);

function getProxy(): { server: string } | undefined {
  const raw =
    process.env.IMPORT_FETCH_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.ALL_PROXY?.trim();
  if (!raw) return undefined;
  return { server: raw };
}

const startUrl =
  source === "pitchbook"
    ? "https://pitchbook.com/"
    : "https://www.preqin.com/";

const proxy = getProxy();
const browser = await chromium.launch({
  headless: false,
  args: ["--disable-blink-features=AutomationControlled"],
  ...(proxy ? { proxy } : {}),
});

const context = await browser.newContext({
  viewport: { width: 1365, height: 900 },
  locale: "en-US",
});
const page = await context.newPage();
await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log(
  "\n已在浏览器中打开站点首页。请在窗口内完成登录（含验证码、二次验证等）。\n" +
    "确认能正常打开需要付费/登录后才可见的内容后，回到此终端按 Enter，将保存会话文件供服务端无头抓取复用。\n"
);

await new Promise<void>((resolve) => {
  rl.question("", () => resolve());
});
rl.close();

await context.storageState({ path: outPath });
await browser.close();
console.log(`\n已保存登录态：${outPath}\n请重启 pnpm dev（若已在运行）后再试链接导入。\n`);
