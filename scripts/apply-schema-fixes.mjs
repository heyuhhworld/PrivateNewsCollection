/**
 * 补齐与当前 Drizzle schema 不一致的列（可重复执行）。
 * 解决：抓取任务 INSERT 失败、crawl_jobs 缺 auth 列、资讯列表 SELECT 缺列导致空白页等。
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

async function columnExists(conn, table, column) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(row.c) > 0;
}

async function tableExists(conn, table) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(row.c) > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    uri: url,
    multipleStatements: true,
  });

  try {
    if (await tableExists(conn, "crawl_jobs")) {
      if (!(await columnExists(conn, "crawl_jobs", "authUsername"))) {
        await conn.query(
          "ALTER TABLE `crawl_jobs` ADD `authUsername` varchar(320)"
        );
        console.log("已添加 crawl_jobs.authUsername");
      } else {
        console.log("crawl_jobs.authUsername 已存在");
      }
      if (!(await columnExists(conn, "crawl_jobs", "authPasswordEnc"))) {
        await conn.query(
          "ALTER TABLE `crawl_jobs` ADD `authPasswordEnc` text"
        );
        console.log("已添加 crawl_jobs.authPasswordEnc");
      } else {
        console.log("crawl_jobs.authPasswordEnc 已存在");
      }
    } else {
      console.log("跳过 crawl_jobs：表不存在");
    }

    if (await tableExists(conn, "news_articles")) {
      if (!(await columnExists(conn, "news_articles", "recordCategory"))) {
        const p7 = path.join(root, "drizzle/0007_news_record_category_visibility.sql");
        const sql7 = readFileSync(p7, "utf8").trim();
        await conn.query(sql7);
        console.log("已执行 0007：recordCategory / isHidden / contentZh");
      } else {
        console.log("news_articles.recordCategory 已存在（跳过 0007）");
      }

      if (!(await columnExists(conn, "news_articles", "extractedLinePageMap"))) {
        const p8 = path.join(root, "drizzle/0008_news_extracted_line_page_map.sql");
        const sql8 = readFileSync(p8, "utf8").trim();
        await conn.query(sql8);
        console.log("已执行 0008：extractedLinePageMap");
      } else {
        console.log("news_articles.extractedLinePageMap 已存在");
      }
    } else {
      console.log("跳过 news_articles：表不存在");
    }

    console.log("\nschema 检查完成。请重启 pnpm dev 后重试。");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
