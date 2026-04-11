#!/usr/bin/env node
/**
 * 为已有资讯回填 embedding（需配置 DATABASE_URL + API Key + EMBEDDING_MODEL）。
 * 用法: node scripts/backfill-embeddings.mjs [--limit=200] [--delay=200] [--retries=3]
 *
 * Embeddings 地址（按优先级）：
 * 1) EMBEDDING_API_URL — 完整 URL，如 https://api.openai.com/v1/embeddings
 * 2) EMBEDDING_OPENAI_BASE_URL — 仅基址，自动拼 /v1/embeddings
 * 3) BUILT_IN_FORGE_API_URL / OPENAI_BASE_URL — 同上
 * 若 Forge/自建网关只提供 chat/completions、不提供 embeddings，请用 1 或 2 指向 OpenAI 或其它支持 embeddings 的网关。
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v === undefined ? true : v];
  })
);
const limit = Math.min(5000, Number(args.limit) || 500);
const batchDelayMs = Number(args.delay) || 200;
const maxRetries = Math.min(8, Math.max(1, Number(args.retries) || 3));

const databaseUrl = process.env.DATABASE_URL?.trim();
const apiKey =
  process.env.BUILT_IN_FORGE_API_KEY?.trim() ||
  process.env.OPENAI_API_KEY?.trim();
const base =
  process.env.BUILT_IN_FORGE_API_URL?.trim() ||
  process.env.OPENAI_BASE_URL?.trim() ||
  "https://api.openai.com";
const model = process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

function resolveEmbeddingsPostUrl() {
  const full = process.env.EMBEDDING_API_URL?.trim();
  if (full) return full.replace(/\/$/, "");
  const embBase =
    process.env.EMBEDDING_OPENAI_BASE_URL?.trim() ||
    base;
  return `${embBase.replace(/\/$/, "")}/v1/embeddings`;
}

if (!databaseUrl) {
  console.error("缺少 DATABASE_URL");
  process.exit(1);
}
if (!apiKey) {
  console.error("缺少 BUILT_IN_FORGE_API_KEY 或 OPENAI_API_KEY");
  process.exit(1);
}

const embeddingsUrl = resolveEmbeddingsPostUrl();
console.log("Embeddings POST:", embeddingsUrl.replace(/^(https?:\/\/[^/]+).*/, "$1/…"));

function buildText(row) {
  const parts = [row.title || "", row.summary || ""];
  let ki = row.keyInsights;
  if (typeof ki === "string") {
    try {
      ki = JSON.parse(ki);
    } catch {
      ki = null;
    }
  }
  if (Array.isArray(ki)) {
    parts.push(
      ki.map((x) => `${x.label || ""}: ${x.value || ""}`).join(" | ")
    );
  }
  return parts.join("\n").trim().slice(0, 8000);
}

function formatFetchError(err) {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  const c = err.cause;
  if (c instanceof Error) parts.push(`cause: ${c.message}`);
  else if (c != null) parts.push(`cause: ${String(c)}`);
  return parts.join(" | ");
}

async function embed(text) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(embeddingsUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: text }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`HTTP ${res.status} ${t.slice(0, 500)}`);
      }
      const j = await res.json();
      const v = j.data?.[0]?.embedding;
      if (!v?.length) throw new Error(j.error?.message || "empty embedding");
      return v;
    } catch (e) {
      lastErr = e;
      const wait = 500 * (attempt + 1);
      if (attempt < maxRetries - 1) {
        console.warn(`  重试 ${attempt + 1}/${maxRetries}，${wait}ms 后… (${formatFetchError(e)})`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

async function main() {
  const conn = await mysql.createConnection(databaseUrl);
  const [rows] = await conn.query(
    `SELECT id, title, summary, keyInsights FROM news_articles
     WHERE isHidden = 0 AND (embedding IS NULL OR JSON_LENGTH(embedding) = 0)
     ORDER BY publishedAt DESC
     LIMIT ?`,
    [limit]
  );
  console.log(`待处理 ${rows.length} 条`);
  let ok = 0;
  for (const row of rows) {
    const text = buildText(row);
    if (!text) {
      console.warn(`跳过 id=${row.id} 无文本`);
      continue;
    }
    try {
      const vec = await embed(text);
      await conn.query(`UPDATE news_articles SET embedding = ? WHERE id = ?`, [
        JSON.stringify(vec),
        row.id,
      ]);
      ok++;
      console.log(`ok id=${row.id}`);
    } catch (e) {
      console.error(`fail id=${row.id}`, formatFetchError(e));
    }
    await new Promise((r) => setTimeout(r, batchDelayMs));
  }
  await conn.end();
  console.log(`完成，成功 ${ok}/${rows.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
