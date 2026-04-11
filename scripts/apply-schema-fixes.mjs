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

async function getColumnDataType(conn, table, column) {
  const [[row]] = await conn.query(
    `SELECT DATA_TYPE AS dataType FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  return row?.dataType ? String(row.dataType).toLowerCase() : null;
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

      if (!(await columnExists(conn, "news_articles", "viewCount"))) {
        const p9 = path.join(root, "drizzle/0009_news_view_count.sql");
        const sql9 = readFileSync(p9, "utf8").trim();
        await conn.query(sql9);
        console.log("已执行 0009：viewCount");
      } else {
        console.log("news_articles.viewCount 已存在");
      }

      if (!(await columnExists(conn, "news_articles", "embedding"))) {
        await conn.query(
          "ALTER TABLE `news_articles` ADD COLUMN `embedding` JSON NULL AFTER `viewCount`"
        );
        console.log("已添加 news_articles.embedding");
      } else {
        console.log("news_articles.embedding 已存在");
      }
      if (!(await tableExists(conn, "ai_briefings"))) {
        await conn.query(`CREATE TABLE \`ai_briefings\` (
  \`id\` int AUTO_INCREMENT NOT NULL,
  \`body\` text NOT NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT \`ai_briefings_id\` PRIMARY KEY(\`id\`)
)`);
        console.log("已创建 ai_briefings");
      } else {
        console.log("ai_briefings 表已存在");
      }

      const extractedType = await getColumnDataType(
        conn,
        "news_articles",
        "extractedText"
      );
      if (extractedType && extractedType !== "longtext") {
        const p11 = path.join(root, "drizzle/0011_news_extracted_text_longtext.sql");
        const sql11 = readFileSync(p11, "utf8").trim();
        await conn.query(sql11);
        console.log("已执行 0011：extractedText -> LONGTEXT");
      } else if (extractedType === "longtext") {
        console.log("news_articles.extractedText 已是 LONGTEXT");
      }
    } else {
      console.log("跳过 news_articles：表不存在");
    }

    if (await tableExists(conn, "users")) {
      if (!(await columnExists(conn, "users", "passwordHash"))) {
        const p10 = path.join(root, "drizzle/0010_users_password_hash.sql");
        const sql10 = readFileSync(p10, "utf8").trim();
        await conn.query(sql10);
        console.log("已执行 0010：users.passwordHash");
      } else {
        console.log("users.passwordHash 已存在");
      }
    } else {
      console.log("跳过 users：表不存在");
    }

    // ── Phase 4 tables ──────────────────────────────────────────────────
    const phase4Tables = [
      { name: "entities", sql: `CREATE TABLE IF NOT EXISTS \`entities\` (
  \`id\` int AUTO_INCREMENT NOT NULL,
  \`name\` varchar(256) NOT NULL,
  \`type\` enum('fund','institution','person','other') NOT NULL,
  \`aliases\` JSON NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT \`entities_id\` PRIMARY KEY(\`id\`)
)` },
      { name: "entity_articles", sql: `CREATE TABLE IF NOT EXISTS \`entity_articles\` (
  \`id\` int AUTO_INCREMENT NOT NULL,
  \`entityId\` int NOT NULL,
  \`articleId\` int NOT NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT \`entity_articles_id\` PRIMARY KEY(\`id\`),
  INDEX \`idx_ea_entity\` (\`entityId\`),
  INDEX \`idx_ea_article\` (\`articleId\`)
)` },
      { name: "entity_relations", sql: `CREATE TABLE IF NOT EXISTS \`entity_relations\` (
  \`id\` int AUTO_INCREMENT NOT NULL,
  \`sourceEntityId\` int NOT NULL,
  \`targetEntityId\` int NOT NULL,
  \`relationType\` varchar(64) NOT NULL,
  \`articleId\` int NOT NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT \`entity_relations_id\` PRIMARY KEY(\`id\`),
  INDEX \`idx_er_source\` (\`sourceEntityId\`),
  INDEX \`idx_er_target\` (\`targetEntityId\`)
)` },
      { name: "tag_corrections", sql: `CREATE TABLE IF NOT EXISTS \`tag_corrections\` (
  \`id\` int AUTO_INCREMENT NOT NULL,
  \`articleId\` int NOT NULL,
  \`userId\` int NULL,
  \`fieldName\` enum('tags','strategy','region') NOT NULL,
  \`oldValue\` text NULL,
  \`newValue\` text NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT \`tag_corrections_id\` PRIMARY KEY(\`id\`),
  INDEX \`idx_tc_article\` (\`articleId\`)
)` },
      { name: "briefing_subscriptions", sql: `CREATE TABLE IF NOT EXISTS \`briefing_subscriptions\` (
  \`id\` int AUTO_INCREMENT NOT NULL,
  \`userId\` int NULL,
  \`email\` varchar(320) NULL,
  \`webhookUrl\` varchar(1024) NULL,
  \`isEnabled\` boolean NOT NULL DEFAULT true,
  \`createdAt\` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT \`briefing_subscriptions_id\` PRIMARY KEY(\`id\`)
)` },
    ];
    for (const t of phase4Tables) {
      if (!(await tableExists(conn, t.name))) {
        await conn.query(t.sql);
        console.log(`已创建 ${t.name}`);
      } else {
        console.log(`${t.name} 表已存在`);
      }
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
