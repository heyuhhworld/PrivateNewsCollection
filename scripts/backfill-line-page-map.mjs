/**
 * 回填 extractedLinePageMap：对已有的 PDF 类报告重新提取按页行映射。
 * 解决旧数据 extractedLinePageMap = null 导致 AI 引用页码与 PDF 页码不一致的问题。
 * 可重复执行——仅处理 extractedLinePageMap IS NULL 且有 attachmentStorageKey 的记录。
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFParse } from "pdf-parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const UPLOAD_DIR = path.join(root, "uploads", "news");

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("未设置 DATABASE_URL");
  process.exit(1);
}

async function extractPageMap(filePath) {
  const buf = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    const pages = [...result.pages].sort((a, b) => a.num - b.num);
    const linePageMap = [];
    const lineTexts = [];
    for (const p of pages) {
      for (const line of p.text.split(/\r?\n/)) {
        const t = line.trim();
        if (t.length > 0) {
          lineTexts.push(t);
          linePageMap.push(Math.max(1, p.num));
        }
      }
    }
    return { lineTexts, linePageMap };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function main() {
  const conn = await mysql.createConnection({ uri: url });
  try {
    const [rows] = await conn.query(
      `SELECT id, title, attachmentStorageKey, attachmentMime
       FROM news_articles
       WHERE attachmentMime LIKE '%pdf%'
         AND attachmentStorageKey IS NOT NULL
         AND (extractedLinePageMap IS NULL OR extractedLinePageMap = 'null')`
    );

    if (rows.length === 0) {
      console.log("无需回填：所有 PDF 记录已有 extractedLinePageMap。");
      return;
    }

    console.log(`找到 ${rows.length} 条需要回填的 PDF 记录：`);

    let ok = 0;
    let fail = 0;
    for (const row of rows) {
      const filePath = path.join(UPLOAD_DIR, row.attachmentStorageKey);
      if (!fs.existsSync(filePath)) {
        console.warn(`  [跳过] id=${row.id} 文件不存在: ${row.attachmentStorageKey}`);
        fail++;
        continue;
      }
      try {
        const { lineTexts, linePageMap } = await extractPageMap(filePath);

        const existingText = await conn
          .query("SELECT extractedText FROM news_articles WHERE id = ?", [row.id])
          .then(([r]) => (r[0]?.extractedText ?? "").trim());
        const existingLines = existingText
          .split(/\r?\n/)
          .filter((l) => l.trim().length > 0);

        if (existingLines.length === lineTexts.length) {
          await conn.query(
            "UPDATE news_articles SET extractedLinePageMap = ? WHERE id = ?",
            [JSON.stringify(linePageMap), row.id]
          );
          console.log(
            `  [OK] id=${row.id} "${row.title}" — ${linePageMap.length} 行, ` +
            `页码范围 1..${Math.max(...linePageMap)}`
          );
          ok++;
        } else {
          await conn.query(
            "UPDATE news_articles SET extractedText = ?, extractedLinePageMap = ? WHERE id = ?",
            [lineTexts.join("\n"), JSON.stringify(linePageMap), row.id]
          );
          console.log(
            `  [OK+TEXT] id=${row.id} "${row.title}" — 行数变更 ${existingLines.length} → ${lineTexts.length}, ` +
            `页码范围 1..${Math.max(...linePageMap)}`
          );
          ok++;
        }
      } catch (e) {
        console.error(`  [失败] id=${row.id}:`, e.message);
        fail++;
      }
    }
    console.log(`\n完成：成功 ${ok}，跳过/失败 ${fail}`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
