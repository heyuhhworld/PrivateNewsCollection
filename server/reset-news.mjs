import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const connection = await mysql.createConnection(process.env.DATABASE_URL);

// 清空所有模拟数据
await connection.execute('DELETE FROM news_articles');
console.log('Cleared all existing news articles');

// 两条真实资讯数据
const articles = [
  {
    title: "Anthropic's Mythos raises questions for cybersecurity startup valuations",
    source: 'Pitchbook',
    author: 'Rosie Bradbury',
    publishedAt: new Date('2026-04-08'),
    summary: "Anthropic says its new model has identified threats that decades of cyber researchers have failed to detect. Will some startups' moats disintegrate?",
    content: `Anthropic's Mythos Preview frontier model, formally announced this week, is expected to be a boon for startups in some cybersecurity categories and a competitive threat to others.

The Mythos Preview model has, according to Anthropic, identified thousands of high-severity vulnerabilities "in every major operating system and browser." It is a major revelation for the cybersecurity industry, and is expected to have immediate implications for more mature startups whose products can be rendered obsolete by Anthropic.

Alongside Mythos, Anthropic unveiled Project Glasswing, an initiative to secure critical systems that already includes Amazon, Cisco, Apple and others as partners to help identify novel threats to their operating systems and to understand what guardrails the Mythos model needs.

For application security startups working on vulnerability management and code security, valuations just got a whole lot harder to justify, according to Sid Trivedi, partner at Foundation Capital. "In the near to mid-term, the greatest threat [of Mythos] is to the vulnerability management companies," he said.

Stock prices of publicly traded vulnerability management companies have fallen as markets have learned more about Mythos' capabilities. The stock price of Qualys is down by nearly 10% over the past month, with much of the drop happening since Fortune reported the existence of Mythos on March 26. Competitor Tenable has seen its stock price drop by almost 15% in the same period.

With investor expectations that AI would usher in a new era of cybersecurity enforcement, application security startups have fared relatively well in the past few years. In 2025, VCs invested a total of $2.66 billion across 186 deals, a 45% increase year-over-year, according to PitchBook's Q4 2025 Cybersecurity Trends report.`,
    originalUrl: 'https://pitchbook.com/news/articles/anthropics-mythos-raises-questions-for-cybersecurity-startup-valuations',
    tags: JSON.stringify(['网络安全', '人工智能', 'Anthropic', '科技', '估值']),
    strategy: '风险投资',
    region: '北美',

    isRead: false,
    keyInsights: JSON.stringify([
      'Anthropic Mythos model identified thousands of high-severity vulnerabilities in major OS and browsers',
      'Application security startups face valuation pressure; Qualys down ~10%, Tenable down ~15%',
      'VC investment in cybersecurity reached $2.66B across 186 deals in 2025, up 45% YoY',
      'Project Glasswing partners include Amazon, Cisco, Apple — expanding institutional AI-security collaboration'
    ]),
  },
  {
    title: 'Sector in Focus: Digital assets',
    source: 'Preqin',
    author: 'Preqin Research',
    publishedAt: new Date('2026-04-01'),
    summary: 'Digital assets, namely cryptocurrency, tokenized assets, NFTs and stablecoins, have reached a market cap of $2.50tn. Institutional engagement is at a pivotal moment, after years of interest from both hedge funds and venture capital in different ways.',
    content: `Digital assets, namely cryptocurrency, tokenized assets, NFTs and stablecoins, have reached a market cap of $2.50tn. Institutional engagement is at a pivotal moment, after years of interest from both hedge funds and venture capital in different ways.

Key findings from this Preqin Sector in Focus report:

The blockchain vertical within venture capital has seen exceptional growth over the past decade, increasing from $6.3bn in December 2016 to $138bn in June 2025. This dramatic expansion reflects growing institutional confidence in the underlying technology and its applications across financial services.

Regulatory shifts across major markets are offering the clarity required for institutional adoption, directly influencing deal flow and investment formation across VC and hedge funds. The US, EU, and Asia-Pacific regions have all moved toward more defined regulatory frameworks for digital assets in 2025-2026.

Tokenization promises to enhance transparency and supporting liquidity through fractional ownership via digital tokens. Real-world asset tokenization is emerging as a key growth area, with traditional financial institutions exploring tokenized bonds, real estate, and private equity.

Cryptocurrency hedge funds remain a niche but increasingly sophisticated strategy. Despite high volatility, their strong risk-adjusted returns continue to attract institutions seeking differentiated exposure to digital assets. The number of crypto-focused hedge funds has grown significantly, with total AUM surpassing $50bn.`,
    originalUrl: 'https://www.preqin.com/insights/research/sector-in-focus/sector-in-focus-digital-assets',
    tags: JSON.stringify(['数字资产', '加密货币', '代币化', '风险投资', '对冲基金', '机构投资']),
    strategy: '其他',
    region: '全球',
    isRead: false,
    keyInsights: JSON.stringify([
      'Digital assets market cap reached $2.50tn; blockchain VC grew from $6.3bn (2016) to $138bn (June 2025)',
      'Regulatory clarity across US, EU, APAC driving institutional adoption in VC and hedge funds',
      'Real-world asset tokenization emerging as key growth area for traditional financial institutions',
      'Crypto hedge fund AUM surpassed $50bn; strong risk-adjusted returns attracting institutional allocators'
    ]),
  },
];

for (const article of articles) {
  await connection.execute(
    `INSERT INTO news_articles 
     (title, source, author, publishedAt, summary, content, originalUrl, tags, strategy, region, isRead, keyInsights)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      article.title,
      article.source,
      article.author,
      article.publishedAt,
      article.summary,
      article.content,
      article.originalUrl,
      article.tags,
      article.strategy,
      article.region,
      article.isRead ? 1 : 0,
      article.keyInsights,
    ]
  );
  console.log(`Inserted: [${article.source}] ${article.title}`);
}

await connection.end();
console.log('\nDone! 2 real articles inserted.');
