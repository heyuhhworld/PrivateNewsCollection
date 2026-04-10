import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');

const conn = await createConnection(url);

// Step 1: Add sections column
try {
  await conn.execute('ALTER TABLE `news_articles` ADD COLUMN `sections` json');
  console.log('✓ sections column added');
} catch (e) {
  if (e.code === 'ER_DUP_FIELDNAME') {
    console.log('✓ sections column already exists');
  } else {
    console.error('Error adding sections:', e.message);
  }
}

// Step 2: Check for duplicate originalUrls and remove dupes (keep lowest id)
console.log('Checking for duplicate originalUrls...');
const [dupes] = await conn.execute(`
  SELECT originalUrl, COUNT(*) as cnt, MIN(id) as keep_id
  FROM news_articles
  WHERE originalUrl IS NOT NULL
  GROUP BY originalUrl
  HAVING cnt > 1
`);
console.log(`Found ${dupes.length} duplicate URL groups`);

for (const dupe of dupes) {
  await conn.execute(
    'DELETE FROM news_articles WHERE originalUrl = ? AND id != ?',
    [dupe.originalUrl, dupe.keep_id]
  );
  console.log(`  Removed dupes for: ${dupe.originalUrl?.slice(0, 80)}`);
}

// Step 3: Create unique index
try {
  await conn.execute('DROP INDEX IF EXISTS `idx_news_articles_url` ON `news_articles`');
} catch {}

try {
  await conn.execute('CREATE UNIQUE INDEX `idx_news_articles_url` ON `news_articles` (`originalUrl`(512))');
  console.log('✓ Unique index on originalUrl created');
} catch (e) {
  if (e.code === 'ER_DUP_KEYNAME') {
    console.log('✓ Unique index already exists');
  } else {
    console.error('Error creating index:', e.message);
  }
}

await conn.end();
console.log('Migration done!');
