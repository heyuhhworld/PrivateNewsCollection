/**
 * 应用 drizzle/0007_news_record_category_visibility.sql（可重复执行：已存在则跳过）
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("未设置 DATABASE_URL，请在 .env 中配置 MySQL 连接串。");
  process.exit(1);
}

const sqlPath = path.join(root, "drizzle/0007_news_record_category_visibility.sql");

async function main() {
  const conn = await mysql.createConnection({
    uri: url,
    multipleStatements: true,
  });

  try {
    const [[row]] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'news_articles'
         AND COLUMN_NAME = 'recordCategory'`
    );
    if (Number(row.c) > 0) {
      console.log("0007 已应用：news_articles.recordCategory 已存在，跳过。");
      return;
    }

    const sql = readFileSync(sqlPath, "utf8").trim();
    if (!sql) {
      console.error("迁移文件为空:", sqlPath);
      process.exit(1);
    }

    await conn.query(sql);
    console.log("0007 迁移已成功执行：recordCategory / isHidden / contentZh。");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
