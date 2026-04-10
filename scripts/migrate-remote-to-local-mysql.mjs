import "dotenv/config";
import mysql from "mysql2/promise";

const SOURCE_URL = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
const TARGET_URL =
  process.env.TARGET_DATABASE_URL ||
  "mysql://root:root@127.0.0.1:3306/ipms_local";
const CHUNK_SIZE = Number(process.env.MIGRATE_CHUNK_SIZE || 1000);

if (!SOURCE_URL) {
  throw new Error("缺少 SOURCE_DATABASE_URL / DATABASE_URL");
}

function getDbName(url) {
  const pathname = new URL(url).pathname;
  return pathname.replace(/^\//, "").trim();
}

function normalizeValue(v) {
  if (v == null) return v;
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Date) return v;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

const sourceDbName = getDbName(SOURCE_URL);
const targetDbName = getDbName(TARGET_URL);
if (!sourceDbName || !targetDbName) {
  throw new Error("无法从连接串解析数据库名");
}

const source = await mysql.createConnection(SOURCE_URL);

// 先连到 target server（不指定 db），确保数据库存在
const targetServerUrl = new URL(TARGET_URL);
targetServerUrl.pathname = "/";
const targetServer = await mysql.createConnection(targetServerUrl.toString());
await targetServer.query(`CREATE DATABASE IF NOT EXISTS \`${targetDbName}\``);
await targetServer.end();

const target = await mysql.createConnection(TARGET_URL);
await target.query("SET FOREIGN_KEY_CHECKS = 0");

try {
  const [tableRows] = await source.query(
    "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'"
  );
  const tableKey = `Tables_in_${sourceDbName}`;
  const tables = tableRows.map((r) => r[tableKey]).filter(Boolean);

  console.log(`源库 ${sourceDbName} 共 ${tables.length} 张表`);

  for (const table of tables) {
    console.log(`\n[${table}] 复制结构...`);
    const [createRows] = await source.query(`SHOW CREATE TABLE \`${table}\``);
    const createSql = createRows[0]["Create Table"];

    await target.query(`DROP TABLE IF EXISTS \`${table}\``);
    await target.query(createSql);

    const [countRows] = await source.query(
      `SELECT COUNT(*) AS c FROM \`${table}\``
    );
    const total = Number(countRows[0]?.c || 0);
    console.log(`[${table}] 行数: ${total}`);
    if (total === 0) continue;

    let copied = 0;
    while (copied < total) {
      const [rows] = await source.query(
        `SELECT * FROM \`${table}\` LIMIT ${CHUNK_SIZE} OFFSET ${copied}`
      );
      if (!rows.length) break;

      const cols = Object.keys(rows[0]);
      const values = rows.map((row) => cols.map((c) => normalizeValue(row[c])));
      const colSql = cols.map((c) => `\`${c}\``).join(", ");
      const insertSql = `INSERT INTO \`${table}\` (${colSql}) VALUES ?`;
      await target.query(insertSql, [values]);
      copied += rows.length;
      console.log(`[${table}] ${copied}/${total}`);
    }
  }

  console.log("\n迁移完成。");
} finally {
  await target.query("SET FOREIGN_KEY_CHECKS = 1");
  await source.end();
  await target.end();
}
