import { createConnection } from "mysql2/promise";
import "dotenv/config";

const conn = await createConnection(process.env.DATABASE_URL);

const articles = [
  {
    title: "Blackstone Raises $30.4B for Latest Real Estate Fund, Surpassing Target",
    summary:
      "Blackstone has closed its latest real estate fund, BREP X, at $30.4 billion, exceeding its initial target of $25 billion. The fund focuses on logistics, rental housing, and data centers across North America and Europe. This marks the largest real estate private equity fund ever raised, reflecting continued institutional appetite for hard assets amid inflationary pressures.",
    content:
      "Blackstone Real Estate Partners X has officially closed at $30.4 billion, making it the largest real estate private equity fund in history. The fund attracted capital from sovereign wealth funds, pension funds, and endowments globally. Key investment themes include last-mile logistics facilities, build-to-rent residential communities, and hyperscale data centers. Blackstone's real estate AUM now stands at over $320 billion.",
    source: "Preqin",
    originalUrl: "https://www.preqin.com/insights",
    author: "Sarah Mitchell",
    tags: JSON.stringify(["房地产", "北美", "欧洲", "大型基金", "募资"]),
    strategy: "房地产",
    region: "北美",
    keyInsights: JSON.stringify([
      { label: "基金规模", value: "$30.4B" },
      { label: "目标规模", value: "$25B" },
      { label: "超募比例", value: "21.6%" },
      { label: "核心策略", value: "物流、住宅、数据中心" },
    ]),
    publishedAt: new Date("2026-04-08T09:00:00Z"),
  },
  {
    title: "KKR Targets $20B for Asia-Pacific Private Equity Fund IV",
    summary:
      "KKR has launched fundraising for its fourth Asia-Pacific private equity fund with a target of $20 billion. The fund will focus on buyout and growth equity opportunities across Japan, Australia, India, and Southeast Asia. KKR's previous Asia fund closed at $15 billion in 2021.",
    content:
      "KKR Asia Pacific Fund IV is targeting $20 billion in commitments, building on the success of its predecessor fund which generated a net IRR of 22%. The new fund will pursue control buyouts in Japan's corporate carve-out market, growth equity in India's technology sector, and infrastructure-adjacent opportunities in Southeast Asia. KKR has already secured anchor commitments from several Asian sovereign wealth funds.",
    source: "Pitchbook",
    originalUrl: "https://pitchbook.com/news",
    author: "James Chen",
    tags: JSON.stringify(["私募股权", "亚太", "并购", "成长股权", "募资"]),
    strategy: "私募股权",
    region: "亚太",
    keyInsights: JSON.stringify([
      { label: "目标规模", value: "$20B" },
      { label: "上期规模", value: "$15B" },
      { label: "上期净IRR", value: "22%" },
      { label: "重点市场", value: "日本、印度、东南亚" },
    ]),
    publishedAt: new Date("2026-04-07T14:30:00Z"),
  },
  {
    title: "Sequoia Capital Restructures Global Operations, Splits into Three Independent Entities",
    summary:
      "Sequoia Capital has announced a major restructuring, separating its US/Europe, China (HongShan), and India/Southeast Asia operations into fully independent entities. The move reflects regulatory pressures and the desire for each regional team to operate with greater autonomy and localized LP bases.",
    content:
      "The restructuring of Sequoia Capital marks a significant shift in how global venture capital firms manage geopolitical risk. HongShan (formerly Sequoia China) will operate independently with its own LP base and investment committee. The India/Southeast Asia entity will focus on early-stage technology investments. The US/Europe entity retains the Sequoia brand and will continue its heritage of backing transformative technology companies.",
    source: "Pitchbook",
    originalUrl: "https://pitchbook.com/news",
    author: "Emily Wang",
    tags: JSON.stringify(["风险投资", "全球", "中国", "亚太", "机构动态"]),
    strategy: "风险投资",
    region: "全球",
    keyInsights: JSON.stringify([
      { label: "拆分实体数", value: "3" },
      { label: "中国品牌", value: "HongShan (红杉)" },
      { label: "主要原因", value: "监管压力与运营自主性" },
    ]),
    publishedAt: new Date("2026-04-07T08:00:00Z"),
  },
  {
    title: "Apollo Global Launches $5B Credit Opportunities Fund Targeting Asia",
    summary:
      "Apollo Global Management has launched a new $5 billion credit fund specifically targeting Asia-Pacific credit opportunities, including distressed debt, direct lending, and structured credit. The fund marks Apollo's most significant commitment to Asian credit markets to date.",
    content:
      "Apollo's Asia Credit Opportunities Fund will deploy capital across investment-grade and sub-investment-grade credit instruments in the Asia-Pacific region. Key focus areas include real estate credit in China's distressed property sector, corporate direct lending in India, and structured finance in Australia. Apollo has identified over $50 billion in potential deal flow across the region.",
    source: "Preqin",
    originalUrl: "https://www.preqin.com/insights",
    author: "David Park",
    tags: JSON.stringify(["信贷", "亚太", "中国", "直接贷款", "不良资产"]),
    strategy: "信贷",
    region: "亚太",
    keyInsights: JSON.stringify([
      { label: "基金规模", value: "$5B" },
      { label: "核心策略", value: "不良债务、直接贷款、结构化信贷" },
      { label: "重点市场", value: "中国、印度、澳大利亚" },
    ]),
    publishedAt: new Date("2026-04-06T11:00:00Z"),
  },
  {
    title: "Brookfield Infrastructure Partners Acquires Australian Data Center Portfolio for A$3.5B",
    summary:
      "Brookfield Infrastructure Partners has completed the acquisition of a portfolio of 12 data centers across Australia for A$3.5 billion (~$2.3B USD). The deal represents one of the largest infrastructure transactions in Australia this year and reflects growing demand for digital infrastructure.",
    content:
      "The acquired portfolio spans Sydney, Melbourne, Brisbane, and Perth, with a combined capacity of 180MW. Brookfield plans to expand the portfolio to 350MW over the next five years through greenfield development. The transaction was funded through a combination of equity from Brookfield Infrastructure Fund V and project-level debt financing. Data center demand in Australia is driven by cloud adoption, AI workloads, and government digitization initiatives.",
    source: "Preqin",
    originalUrl: "https://www.preqin.com/insights",
    author: "Rachel Thompson",
    tags: JSON.stringify(["基础设施", "亚太", "数据中心", "并购", "数字基础设施"]),
    strategy: "基础设施",
    region: "亚太",
    keyInsights: JSON.stringify([
      { label: "交易金额", value: "A$3.5B (~$2.3B USD)" },
      { label: "数据中心数量", value: "12个" },
      { label: "当前容量", value: "180MW" },
      { label: "扩张目标", value: "350MW（5年内）" },
    ]),
    publishedAt: new Date("2026-04-05T06:00:00Z"),
  },
  {
    title: "Hillhouse Capital Closes RMB Fund at ¥15B, Focuses on Hard Tech and Healthcare",
    summary:
      "Hillhouse Capital has closed its latest RMB-denominated fund at ¥15 billion ($2.1B), with a focus on hard technology, semiconductor supply chain, and innovative healthcare. The fund attracted significant commitments from Chinese state-owned enterprises and provincial government guidance funds.",
    content:
      "Hillhouse's RMB Fund III reflects the firm's strategic pivot toward sectors aligned with China's industrial policy priorities. Hard tech investments will target semiconductor equipment, advanced materials, and industrial automation. Healthcare investments will focus on innovative drugs, medical devices, and AI-assisted diagnostics. The fund has already made 8 investments since its first close in Q3 2025.",
    source: "Pitchbook",
    originalUrl: "https://pitchbook.com/news",
    author: "Li Wei",
    tags: JSON.stringify(["风险投资", "中国", "硬科技", "医疗健康", "人民币基金"]),
    strategy: "风险投资",
    region: "中国",
    keyInsights: JSON.stringify([
      { label: "基金规模", value: "¥15B (~$2.1B)" },
      { label: "币种", value: "人民币" },
      { label: "核心赛道", value: "硬科技、半导体、医疗健康" },
      { label: "已完成投资", value: "8笔" },
    ]),
    publishedAt: new Date("2026-04-04T10:00:00Z"),
  },
  {
    title: "Carlyle Group Reports Strong Q1 2026 Fundraising, AUM Reaches $450B",
    summary:
      "The Carlyle Group reported strong Q1 2026 fundraising results, raising $18 billion across its platform and bringing total AUM to $450 billion. The firm highlighted strong demand for its credit and infrastructure strategies, while its flagship buyout fund continues to attract institutional capital.",
    content:
      "Carlyle's Q1 2026 results demonstrate the resilience of diversified alternative asset managers. Fee-related earnings grew 15% year-over-year, driven by management fees from recently closed funds. The firm's credit platform, which now manages $180 billion, saw the strongest inflows. Infrastructure fundraising benefited from increased allocations from pension funds seeking inflation-protected returns. Carlyle's flagship buyout fund, CEP VI, is targeting $22 billion.",
    source: "Preqin",
    originalUrl: "https://www.preqin.com/insights",
    author: "Michael Brown",
    tags: JSON.stringify(["私募股权", "信贷", "基础设施", "全球", "机构动态", "业绩报告"]),
    strategy: "母基金",
    region: "全球",
    keyInsights: JSON.stringify([
      { label: "Q1募资额", value: "$18B" },
      { label: "总AUM", value: "$450B" },
      { label: "信贷平台AUM", value: "$180B" },
      { label: "旗舰基金目标", value: "$22B (CEP VI)" },
    ]),
    publishedAt: new Date("2026-04-03T15:00:00Z"),
  },
  {
    title: "Southeast Asia Venture Capital Activity Rebounds in Q1 2026, Led by AI and Fintech",
    summary:
      "Venture capital investment in Southeast Asia rebounded strongly in Q1 2026, with total deal value reaching $4.2 billion across 312 transactions. AI infrastructure, fintech, and climate tech emerged as the top sectors, while Singapore and Indonesia accounted for 65% of total deal value.",
    content:
      "After a challenging 2024-2025 period marked by valuation corrections and reduced LP appetite, Southeast Asian venture capital is showing signs of recovery. AI-related investments accounted for $1.8 billion of Q1 deal value, spanning foundation model development, enterprise AI applications, and AI-enabled services. Fintech remains resilient, driven by digital payments, embedded finance, and cross-border remittances. Notable Q1 deals include a $200M Series C for a Singapore-based AI infrastructure company and a $150M growth round for an Indonesian super-app.",
    source: "Pitchbook",
    originalUrl: "https://pitchbook.com/news",
    author: "Anna Tan",
    tags: JSON.stringify(["风险投资", "东南亚", "人工智能", "金融科技", "市场报告"]),
    strategy: "风险投资",
    region: "东南亚",
    keyInsights: JSON.stringify([
      { label: "Q1总投资额", value: "$4.2B" },
      { label: "交易数量", value: "312笔" },
      { label: "AI投资占比", value: "$1.8B" },
      { label: "主要市场", value: "新加坡、印度尼西亚（占65%）" },
    ]),
    publishedAt: new Date("2026-04-02T09:30:00Z"),
  },
  {
    title: "European Private Equity Buyout Activity Slows as Financing Costs Remain Elevated",
    summary:
      "European private equity buyout activity declined 18% in Q1 2026 compared to the same period last year, as elevated interest rates continue to weigh on deal financing. However, deal quality has improved, with GPs focusing on businesses with strong pricing power and recurring revenue.",
    content:
      "The European buyout market faces a challenging environment with the ECB maintaining rates above 3%. Average deal leverage has declined from 6x to 4.5x EBITDA, compressing returns for highly leveraged transactions. GPs are increasingly focusing on operational value creation rather than financial engineering. Technology-enabled services, healthcare, and business services remain the most active sectors. Several large-cap buyouts are being structured as 'equity-heavy' transactions to accommodate the higher cost of debt.",
    source: "Preqin",
    originalUrl: "https://www.preqin.com/insights",
    author: "Thomas Mueller",
    tags: JSON.stringify(["私募股权", "欧洲", "并购", "市场报告", "利率环境"]),
    strategy: "并购",
    region: "欧洲",
    keyInsights: JSON.stringify([
      { label: "同比变化", value: "-18%" },
      { label: "平均杠杆倍数", value: "4.5x EBITDA（从6x下降）" },
      { label: "ECB利率", value: ">3%" },
      { label: "活跃行业", value: "科技服务、医疗、商业服务" },
    ]),
    publishedAt: new Date("2026-04-01T12:00:00Z"),
  },
  {
    title: "GIC and Temasek Co-Invest in $3B Indian Renewable Energy Platform",
    summary:
      "Singapore sovereign wealth funds GIC and Temasek have jointly invested $1.5 billion each in a new Indian renewable energy platform targeting 10GW of solar and wind capacity. The platform will develop greenfield projects across Rajasthan, Gujarat, and Tamil Nadu over the next decade.",
    content:
      "The joint investment by GIC and Temasek underscores Singapore's strategic interest in India's energy transition. The platform, named IndiaRenew, will partner with local developers and EPC contractors to build utility-scale solar and wind projects. The Indian government's target of 500GW of renewable capacity by 2030 creates a significant investment opportunity. The platform expects to generate returns of 12-15% IRR in USD terms, supported by long-term power purchase agreements with state utilities.",
    source: "Preqin",
    originalUrl: "https://www.preqin.com/insights",
    author: "Priya Sharma",
    tags: JSON.stringify(["基础设施", "亚太", "印度", "可再生能源", "主权财富基金"]),
    strategy: "基础设施",
    region: "亚太",
    keyInsights: JSON.stringify([
      { label: "总投资额", value: "$3B" },
      { label: "目标容量", value: "10GW" },
      { label: "预期IRR", value: "12-15% (USD)" },
      { label: "项目省份", value: "拉贾斯坦邦、古吉拉特邦、泰米尔纳德邦" },
    ]),
    publishedAt: new Date("2026-03-31T07:00:00Z"),
  },
  {
    title: "Warburg Pincus Exits Chinese Healthcare Investment at 4x Return",
    summary:
      "Warburg Pincus has completed the sale of its stake in a leading Chinese hospital group to a strategic buyer, generating approximately 4x return on invested capital over a 7-year holding period. The exit represents one of the most successful healthcare investments in China by a foreign PE firm.",
    content:
      "The exit from the hospital group, which operates 45 hospitals across tier-1 and tier-2 Chinese cities, was completed through a trade sale to a Hong Kong-listed healthcare conglomerate. Warburg Pincus invested $400 million in 2019 and realized approximately $1.6 billion in proceeds. The investment thesis centered on China's aging population, rising healthcare expenditure, and the shift toward private healthcare services. The successful exit demonstrates that foreign PE firms can still generate strong returns in China's healthcare sector despite regulatory headwinds.",
    source: "Pitchbook",
    originalUrl: "https://pitchbook.com/news",
    author: "Kevin Liu",
    tags: JSON.stringify(["私募股权", "中国", "医疗健康", "退出", "并购"]),
    strategy: "私募股权",
    region: "中国",
    keyInsights: JSON.stringify([
      { label: "投资回报倍数", value: "4x MOIC" },
      { label: "持有期", value: "7年" },
      { label: "投资金额", value: "$400M" },
      { label: "退出金额", value: "~$1.6B" },
    ]),
    publishedAt: new Date("2026-03-29T10:00:00Z"),
  },
  {
    title: "Middle East SWFs Accelerate Direct Investment Strategy, Bypassing Traditional PE Funds",
    summary:
      "Sovereign wealth funds from Saudi Arabia, UAE, and Qatar are increasingly pursuing direct investments in global companies, bypassing traditional private equity fund structures. ADIA, PIF, and QIA collectively deployed over $80 billion in direct deals in 2025, up 35% from 2024.",
    content:
      "The shift toward direct investing by Middle Eastern SWFs reflects their growing in-house capabilities and desire to reduce fee drag. ADIA has expanded its direct investment team to over 200 professionals, while PIF has established sector-specific investment units for technology, sports, and real estate. This trend is creating both competition and co-investment opportunities for traditional PE firms. Several major GPs have responded by offering co-investment rights and separately managed accounts to maintain relationships with these large LPs.",
    source: "Preqin",
    originalUrl: "https://www.preqin.com/insights",
    author: "Omar Al-Rashid",
    tags: JSON.stringify(["私募股权", "中东", "主权财富基金", "直接投资", "市场趋势"]),
    strategy: "私募股权",
    region: "中东",
    keyInsights: JSON.stringify([
      { label: "2025年直投规模", value: "$80B+" },
      { label: "同比增长", value: "35%" },
      { label: "主要机构", value: "ADIA、PIF、QIA" },
      { label: "ADIA直投团队", value: "200+人" },
    ]),
    publishedAt: new Date("2026-03-28T14:00:00Z"),
  },
  {
    title: "Advent International Raises €4.5B for European Buyout Fund, Targeting Tech-Enabled Services",
    summary:
      "Advent International has held the final close of its European buyout fund at €4.5 billion, exceeding its initial target of €4 billion. The fund will focus on technology-enabled business services, healthcare IT, and financial technology across Western and Central Europe.",
    content:
      "Advent International's European Private Equity Fund X attracted strong demand from European and North American institutional investors. The fund's strategy centers on businesses undergoing digital transformation, with a particular focus on companies providing mission-critical software and services. Advent has already made three investments from the new fund, including a €400 million buyout of a German enterprise software company and a €250 million investment in a UK-based healthcare IT platform.",
    source: "Pitchbook",
    originalUrl: "https://pitchbook.com/news",
    author: "Sophie Laurent",
    tags: JSON.stringify(["私募股权", "欧洲", "并购", "科技", "募资"]),
    strategy: "并购",
    region: "欧洲",
    keyInsights: JSON.stringify([
      { label: "基金规模", value: "€4.5B" },
      { label: "目标规模", value: "€4B" },
      { label: "核心策略", value: "科技赋能商业服务、医疗IT、金融科技" },
      { label: "已完成投资", value: "3笔" },
    ]),
    publishedAt: new Date("2026-03-27T09:00:00Z"),
  },
  {
    title: "TPG Rise Climate Fund Deploys $3B in Clean Energy Transition Assets",
    summary:
      "TPG's Rise Climate fund has deployed $3 billion of its $7.3 billion target, focusing on clean energy transition opportunities including green hydrogen, battery storage, and sustainable aviation fuel. The fund has made 15 investments across North America, Europe, and Asia.",
    content:
      "TPG Rise Climate is emerging as one of the most active climate-focused PE funds globally. Recent investments include a $300 million commitment to a green hydrogen production facility in Texas, a $200 million investment in a European battery storage developer, and a $150 million stake in a sustainable aviation fuel company. The fund benefits from the US Inflation Reduction Act's incentives for clean energy investments, which have significantly improved project economics.",
    source: "Preqin",
    originalUrl: "https://www.preqin.com/insights",
    author: "Jennifer Adams",
    tags: JSON.stringify(["基础设施", "全球", "气候科技", "ESG", "清洁能源"]),
    strategy: "基础设施",
    region: "全球",
    keyInsights: JSON.stringify([
      { label: "已部署资金", value: "$3B" },
      { label: "基金目标", value: "$7.3B" },
      { label: "投资数量", value: "15笔" },
      { label: "核心主题", value: "绿氢、储能、可持续航空燃料" },
    ]),
    publishedAt: new Date("2026-03-25T11:00:00Z"),
  },
  {
    title: "Hedge Fund Industry AUM Surpasses $5 Trillion for First Time",
    summary:
      "The global hedge fund industry has surpassed $5 trillion in assets under management for the first time, driven by strong performance in macro and quantitative strategies. Multi-strategy funds and systematic macro funds led inflows in 2025.",
    content:
      "According to Preqin's latest hedge fund report, total industry AUM reached $5.1 trillion at the end of 2025, up 12% from $4.55 trillion at year-end 2024. Multi-strategy platforms such as Citadel, Millennium, and Point72 continued to attract significant capital, collectively managing over $200 billion. Quantitative and systematic strategies benefited from increased market volatility and the availability of alternative data. The industry's average net return in 2025 was 11.3%, outperforming traditional 60/40 portfolios.",
    source: "Preqin",
    originalUrl: "https://www.preqin.com/insights",
    author: "Robert Hayes",
    tags: JSON.stringify(["对冲基金", "全球", "市场报告", "量化策略", "宏观策略"]),
    strategy: "对冲基金",
    region: "全球",
    keyInsights: JSON.stringify([
      { label: "行业总AUM", value: "$5.1T" },
      { label: "同比增长", value: "12%" },
      { label: "2025年平均净回报", value: "11.3%" },
      { label: "头部机构", value: "Citadel、Millennium、Point72" },
    ]),
    publishedAt: new Date("2026-03-24T08:00:00Z"),
  },
];

// Insert articles
for (const article of articles) {
  await conn.execute(
    `INSERT INTO news_articles (title, summary, content, source, originalUrl, author, tags, strategy, region, keyInsights, publishedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      article.title,
      article.summary,
      article.content,
      article.source,
      article.originalUrl,
      article.author,
      article.tags,
      article.strategy,
      article.region,
      article.keyInsights,
      article.publishedAt,
    ]
  );
}

console.log(`Inserted ${articles.length} articles`);
await conn.end();
