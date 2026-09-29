/**
 * Air8 Buyer Intelligence Worker v5
 * 8 distinct intents, each with different analysis dimensions and data sources:
 *   1. buyer          — Buyer Layer 1 (6-tab card)
 *   2. buyer_financials — Buyer financial drill-down (report level)
 *   3. buyer_sourcing — Buyer sourcing drill-down (customs-first)
 *   4. buyer_products — Buyer product drill-down (customs-first)
 *   5. buyer_suppliers — Buyer's top suppliers (customs-first)
 *   6. product_market — Standalone product/market query
 *   7. country_sourcing — Standalone country sourcing query
 *   8. comparison     — Buyer vs buyer comparison
 */

// const MODEL = 'claude-sonnet-4-5'; // now using Azure OpenAI gpt-6-sol
const HAIKU_MODEL = 'claude-haiku-3-5-20241022'; // cheaper model for classification + structured-only tasks

// ── INTENT DETECTION ──────────────────────────────────────────────────────────
function detectIntent(msg) {
  const m = msg.toLowerCase();

  // Fast-path: HS/HTS code → unambiguously product_market
  if (/\b(hs|hts)\s*(?:code)?\s*\d{4,6}\b|\b\d{4,6}\s*(hs|hts)\b/i.test(msg)) return 'product_market';
  // Fast-path: highly explicit phrases only (no risk of misrouting buyer queries)
  if (/\b(us\s+imports?\s+of|eu\s+imports?\s+of|fob\s+(?:cost|price)|import\s+volume|import\s+trend|market\s+size\s+of)\b/i.test(msg)) return 'product_market';
  // Everything else → LLM classifier handles it (better accuracy, understands context)

  // ONLY block clearly off-topic — lifestyle/entertainment with no supply chain angle
  const hardOffTopic = [
    'weather', 'recipe', 'how to cook', 'how do i cook', 'cooking', 'bake', 'baking',
    'sport', 'football', 'basketball', 'soccer', 'nba', 'nfl', 'baseball',
    'movie', 'film', 'tv show', 'netflix', 'music', 'song', 'artist',
    'joke', 'poem', 'story', 'novel',
    'dating', 'relationship', 'love', 'romance',
    'religion', 'prayer', 'god', 'bible',
    'health advice', 'medical', 'doctor', 'symptoms'
  ];

  // Only block if CLEARLY off-topic AND has no supply chain angle at all
  const hasOffTopic = hardOffTopic.some(k => m.includes(k));
  const hasSupplyAngle = /buyer|brand|retail|sourcing|supplier|factory|tariff|import|export|trade|finance|product|market|apparel|textile|garment|footwear|home goods|air8|financing|receivable|dpo|payment|revenue|margin|profit|competitor|origin|vietnam|china|bangladesh|walmart|target|amazon|gap|kontoor|levi|pvh|hanesbrands|shein|zara/i.test(msg);

  if (hasOffTopic && !hasSupplyAngle) return 'off_topic';

  // Everything else — let the LLM decide via llm_route
  return 'llm_route';
}

// ── OFF-TOPIC REFUSAL ─────────────────────────────────────────────────────────
const OFF_TOPIC_RESPONSE = {
  text: `感谢您的提问！Air8 Intelligence 专注于供应链金融与贸易相关领域，包括：

- 🏬 **买方分析** — 买方资信、付款行为、采购策略
- 📦 **产品与品类** — 进口品类、价格趋势
- 🌍 **采购来源** — 国别分布、供应链结构
- 📊 **财务与关税** — 贸易政策、关税影响、信用评估
- 📰 **行业信号** — 零售行业动态、供应链事件

如您有以上相关问题，欢迎直接提问。`
};

// ── AIR8 INTERNAL CLIENT BEHAVIOR DATA ───────────────────────────────────────
// DEVELOPER NOTE: This is Air8's OWN internal client settlement records.
// Source: Air8 settled invoice/transaction DB (NOT 1688 customs data).
// Available ONLY when Air8 has existing clients supplying this buyer.
// If no data for this buyer → return null → frontend hides the section entirely.
// Expected response shape:
// { avg_late_days: 7.1, ontime_pct: 13.3, dilution_pct: 1.44, invoice_count: 15,
//   distribution: { early: 13.3, late_1_7: 26.7, late_7plus: 60.0 } }
async function fetchClientBehavior(env, buyerName) {
  // DEVELOPER: Replace this block with your internal client DB call
  // Example:
  // if (!env.CLIENT_BEHAVIOR_API_URL) return null;
  // const resp = await fetch(`${env.CLIENT_BEHAVIOR_API_URL}/behavior?buyer=${encodeURIComponent(buyerName)}`, {
  //   headers: { 'Authorization': `Bearer ${env.CLIENT_BEHAVIOR_API_KEY}` }
  // });
  // if (!resp.ok) return null;
  // return await resp.json(); // ← inject into payment_behavior fields in JSON output
  return null; // ← Currently disabled — developer will connect this
}

// ── INTERNAL AIR8 CUSTOMS DB (1688) ─────────────────────────────────────────
// DEVELOPER NOTE: Connect your internal customs API here (1688 customs data).
// Source: Air8 customs extraction DB — shipment-level HS/origin/supplier data.
// Currently returns null — developer must wire this up.
//
// ⚠️  NAME MATCHING & DEDUPLICATION REQUIRED before returning data:
// Raw customs records contain many name variants for the same buyer, e.g.:
//   "WALMART INC" / "WAL-MART STORES" / "WALMART DC 6094" / "WALMART DISTRIBUTION CENTER 91"
// Steps required before aggregating:
//   1. Normalize buyerName (uppercase, strip punctuation, expand abbreviations)
//   2. Fuzzy-match / group all variant consignee names that belong to the same buyer
//   3. Deduplicate — do NOT double-count shipments appearing under multiple name variants
//   4. Merge & aggregate: sum ticketCount, values; combine originBreakdown across all matched names
// Apply dedup at the API layer or here before returning to the caller.
//
// Expected response shape (post dedup+merge):
// { ticketCount, originBreakdown: [{country, pct, ticketCount}],
//   hsBreakdown: [{hs, desc, value}], supplierList: [{name, country, product, volume}] }
async function fetchAir8Customs(env, buyerName, intent) {
  // DEVELOPER: Replace this block with your internal customs DB call
  // Example:
  // const resp = await fetch(`${env.CUSTOMS_API_URL}/query?buyer=${encodeURIComponent(buyerName)}&intent=${intent}`, {
  //   headers: { 'Authorization': `Bearer ${env.CUSTOMS_API_KEY || ''}`, 'Content-Type': 'application/json' }
  // });
  // if (!resp.ok) return null;
  // const raw = await resp.json();
  // return deduplicateAndMerge(raw, buyerName); // ← apply name matching before returning
  return null; // ← Currently disabled — developer will connect this
}

// ── US CENSUS TRADE API ───────────────────────────────────────────────────────
async function fetchCensusTrade(hsCode, year, month, apiKey) {
  // US Census International Trade API — free, no key required (optional key for higher rate limit)
  // Data: US imports by HS code + country, monthly
  // Ref: TRADE-DATA-SOURCES.md Part 1 Route A
  try {
    const keyParam = apiKey ? `&key=${apiKey}` : '';
    const url = `https://api.census.gov/data/timeseries/intltrade/imports/hs?get=I_COMMODITY,I_COMMODITY_SDESC,CTY_CODE,CTY_NAME,GEN_VAL_MO,GEN_VAL_YR,CON_VAL_MO,CON_CIF_MO&COMM_LVL=HS4&I_COMMODITY=${hsCode}&CTY_CODE=-&time=${year}-${String(month).padStart(2,'0')}${keyParam}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || !Array.isArray(data) || data.length < 2) return null;
    const headers = data[0];
    const rows = data.slice(1);
    // Parse into structured format
    const ctyIdx = headers.indexOf('CTY_NAME');
    const genValIdx = headers.indexOf('GEN_VAL_MO');
    const conValIdx = headers.indexOf('CON_VAL_MO');
    const descIdx = headers.indexOf('I_COMMODITY_SDESC');
    return rows.map(r => ({
      country: r[ctyIdx],
      generalImports: r[genValIdx],
      consumptionImports: r[conValIdx],
      description: r[descIdx]
    })).filter(r => r.generalImports && r.generalImports !== '0');
  } catch(e) { return null; }
}

// ── UN COMTRADE ──────────────────────────────────────────────────────────────
async function fetchComtrade(reporterCode, partnerCode, hsCode, year, apiKey) {
  // UN Comtrade — global trade data, free tier 500 calls/day
  // Ref: TRADE-DATA-SOURCES.md Part 3
  try {
    const keyParam = apiKey ? `?type=C&freq=A&px=HS&ps=${year}&r=${reporterCode}&p=${partnerCode}&rg=1&cc=${hsCode}&fmt=json` : `?type=C&freq=A&px=HS&ps=${year}&r=${reporterCode}&p=${partnerCode}&rg=1&cc=${hsCode}&fmt=json&cmCode=${apiKey||''}`;
    const url = `https://comtradeapi.un.org/public/v1/preview${keyParam}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.data || null;
  } catch(e) { return null; }
}

// ── BRAVE SEARCH ─────────────────────────────────────────────────────────────
async function braveSearch(query, apiKey, count = 6) {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&text_decorations=0`;
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey }
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.web?.results || []).slice(0, count).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: (r.description || r.extra_snippets?.[0] || '').slice(0, 150)
    }));
  } catch(e) { return []; }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace('www.',''); } catch(e) { return 'Web'; }
}

// ── LANGUAGE DETECTION ────────────────────────────────────────────────────────
// Detect user language from message content (CJK = zh, else en)
function detectLanguage(msg) {
  return /[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef]/.test(msg) ? 'zh' : 'en';
}
// Inject as first line of any system prompt so Claude knows which language to use
function languageInstruction(lang) {
  return lang === 'zh'
    ? 'CRITICAL LANGUAGE RULE: The user wrote in Chinese. ALL output — text fields, tab labels, insight lines, bullets, analytical commentary, followup labels — MUST be in Simplified Chinese. Company names, financial metrics, numbers, and technical abbreviations (DPO, SCF, HS, FCF) may remain as-is.'
    : 'CRITICAL LANGUAGE RULE: The user wrote in English. ALL output — text fields, tab labels, insight lines, bullets, analytical commentary, followup labels — MUST be in English.';
}
// ── HEARTBEAT HELPER ─────────────────────────────────────────────────────────
// Sends ping events while awaiting a promise — prevents Cloudflare 30s idle timeout
async function withHeartbeat(writer, encoder, promise, intervalMs = 8000) {
  let finished = false;
  const ping = async () => {
    try { if(!finished) await writer.write(encoder.encode('data: {"type":"ping"}\n\n')); } catch(e) {}
  };
  const interval = setInterval(ping, intervalMs);
  try {
    return await promise;
  } finally {
    finished = true;
    clearInterval(interval);
  }
}

// ── NON-STREAMING CLAUDE CALL ─────────────────────────────────────────────────
// ── AZURE OPENAI CONFIG ──────────────────────────────────────────────────────
const AZURE_BASE_URL = 'https://erictaicp-7383-resource.openai.azure.com/openai';
const AZURE_MODEL   = 'gpt-6-sol';
const AZURE_API_VER = '2024-02-01';

function azureUrl() {
  return `${AZURE_BASE_URL}/deployments/${AZURE_MODEL}/chat/completions?api-version=${AZURE_API_VER}`;
}

function buildMessages(systemPrompt, messages) {
  return [{ role: 'system', content: systemPrompt }, ...messages];
}

// ── NON-STREAMING AZURE OPENAI CALL ──────────────────────────────────────────
async function callClaudeJSON(systemPrompt, messages, env, maxTokens = 8000, model = null, usageAcc = null) {
  const apiKey = env.AZURE_OPENAI_API_KEY;
  const resp = await fetch(azureUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      model: AZURE_MODEL,
      max_completion_tokens: maxTokens,
      stream: false,
      messages: buildMessages(systemPrompt, messages)
    })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (usageAcc && data.usage) {
    usageAcc.input  = (usageAcc.input  || 0) + (data.usage.prompt_tokens     || 0);
    usageAcc.output = (usageAcc.output || 0) + (data.usage.completion_tokens || 0);
    usageAcc.calls  = (usageAcc.calls  || 0) + 1;
  }
  return data.choices?.[0]?.message?.content?.trim() || null;
}

// ── STREAMING AZURE OPENAI CALL ───────────────────────────────────────────────
async function callClaudeStream(systemPrompt, messages, env, maxTokens = 8000, onProgress = null, model = null, usageAcc = null) {
  const apiKey = env.AZURE_OPENAI_API_KEY;
  const resp = await fetch(azureUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      model: AZURE_MODEL,
      max_completion_tokens: maxTokens,
      stream: true,
      messages: buildMessages(systemPrompt, messages)
    })
  });
  if (!resp.ok) return null;

  let fullText = '';
  let lastPing = Date.now();
  let buf = '';
  const reader = resp.body.getReader();
  const dec = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') continue;
      try {
        const evt = JSON.parse(payload);
        const content = evt.choices?.[0]?.delta?.content;
        if (content) fullText += content;
      } catch (e) {}
    }
    if (onProgress && Date.now() - lastPing > 6000) {
      lastPing = Date.now();
      await onProgress(fullText.length);
    }
  }
  return fullText.trim() || null;
}


// ── BUYER LAYER 1 PROMPT (6 tabs, risk_signals merged last) ──────────────────
const BUYER_OVERVIEW_PROMPT = `You are Air8 Intelligence. Generate a buyer intelligence Layer 1 summary as a JSON object.

Return ONLY a valid JSON object with NO code fences and NO extra text. Use NA for any unverifiable data.

Required format:
{
  "buyer": "Full Buyer Name",
  "summary": "Revenue $Xbn | S&P Xxx | DPO ~XX days | X,XXX stores / XX countries",
  "tabs": [
    {
      "id": "overview",
      "icon": "🏢",
      "label": "Overview",
      "insight": "One key sentence: buyer's scale, brand portfolio, and parent company context — what this buyer's scale and payment behavior means for suppliers",
      "stats": [
        {"label":"Revenue","value":"$Xbn","delta":"+X% YoY"},
        {"label":"S&P","value":"Xxx"},
        {"label":"Markets","value":"XX countries"},
        {"label":"DPO","value":"~XX days"},
        {"label":"Brands","value":"Brand A · Brand B · Brand C"},
        {"label":"Parent","value":"Parent Co name or 'Standalone'"}
      ],
      "chart": {"type":"bar","title":"Revenue trend ($bn)","labels":["FY2022","FY2023","FY2024","FY2025"],"values":[X,X,X,X]},
      "text": "3-4 sentences: (1) business model and market position, (2) key brands/sub-brands and parent company if any, (3) corporate strategy in 1 sentence (e.g. private label push / international expansion / cost-cutting), (4) why Asian suppliers choose or avoid this buyer."
    },
    {
      "id": "financials",
      "icon": "💰",
      "label": "Financials",
      "insight": "<One sentence: key financial signal that matters for supplier credit/payment risk — e.g. 'Revenue growing +X% but FCF compressed — supplier payment may slow'>",
      "stats": [
        {"label":"Revenue","value":"$Xbn","delta":"+X% YoY"},
        {"label":"Est. DPO","value":"~XX days","delta":"vs ~XX days industry avg"},
        {"label":"Credit Rating","value":"S&P Xxx / Moody's Xxx"},
        {"label":"Free Cash Flow","value":"$Xbn","delta":"vs $Xbn prior year"}
      ],
      "chart": {
        "type": "bar_line_dual",
        "title": "Revenue ($bn) & Gross Margin trend",
        "labels": ["FY2022","FY2023","FY2024","FY2025"],
        "bar_values": [X,X,X,X],
        "bar_label": "Revenue ($bn)",
        "line_values": [X.X,X.X,X.X,X.X],
        "line_label": "Gross Margin (%)"
      },
      "table": {
        "headers": ["Metric","FY2023","FY2024","FY2025","Signal"],
        "rows": [
          ["Revenue","$Xbn","$Xbn","$Xbn","↑/↓/→"],
          ["Est. DPO","~XX days","~XX days","~XX days","stretching / stable"],
          ["Inventory Level","$Xbn","$Xbn","$Xbn","overstocked / lean / normal"],
          ["S&P Rating","Xxx","Xxx","Xxx","stable / positive / negative watch"]
        ]
      },
      "risks": [
        {"label":"Payment Stability","level":"Low/Medium/High","note":"DPO trend YoY + any SCF program + history of late payments or forced early-pay programs — is payment predictable?"},
        {"label":"Litigation / Legal","level":"Low/Medium/High","note":"Any active major lawsuits, class actions, regulatory investigations (FTC/SEC/DOJ), or FCPA exposure that affect creditworthiness"},
        {"label":"Compliance / ESG Penalties","level":"Low/Medium/High","note":"UFLPA forced-labor audit exposure, environmental fines, sustainability mandates, or supply-chain compliance violations"},
        {"label":"Inventory Risk","level":"Low/Medium/High","note":"Inventory days vs prior year and sector average — overstocked = supplier order-cut risk in next 1-2 quarters"}
      ],
      "text": "SOURCE-READY FORMAT — Line 1: '<Buyer> financials: Revenue $Xbn (+/-X% YoY) | DPO ~XX days | Credit: S&P Xxx | FCF $Xbn'. Then bullets:\\n• Payment stability: Is DPO rising, stable or compressing? Any SCF/early-pay program? History of late payments?\\n• Litigation/compliance: Active major suits, regulatory actions, or compliance penalties that affect creditworthiness.\\n• Inventory risk: Over/under-stocked vs prior year — direct order-cut risk for suppliers in next 1-2 quarters.\X,X.X,X.X,X.X]}
      ],
      "category_table": {
        "headers": ["Category", "% of Imports", "YoY Growth", "Outlook", "Avg Price Point", "Supplier Note"],
        "rows": [
          ["Category 1 (HS XX)", "XX%", "+X%", "growing/declining", "$XX–$XX", "key supply chain flag"],
          ["Category 2 (HS XX)", "XX%", "+X%", "growing/declining", "$XX–$XX", "key supply chain flag"],
          ["Category 3 (HS XX)", "XX%", "+X%", "growing/declining", "$XX–$XX", "key supply chain flag"]
        ]
      },
      "text": "SOURCE-READY FORMAT — Headline: 'Top category: [X] at XX% of imports (+X% YoY) | Growing: [Cat] | Declining: [Cat] | Peak season: Q[X]'. Then bullets: • Top category with exact volume and growth. • Fastest growing category and why (tariff shift / consumer trend). • Price pressure: are buyers raising or cutting wholesale prices? • "
    },
    {
      "id": "sourcing",
      "icon": "🌍",
      "label": "Sourcing",
      "insight": "Key sourcing signal: China exposure and diversification status",
      "chart": {"type":"doughnut","title":"Import origin mix (%)","labels":["China","Vietnam","Bangladesh","India","Mexico","Other"],"values":[40,25,15,10,5,5]},
      "text": "2-3 sentences: tariff exposure, diversification status, supplier model (agent vs direct)."
    },
    {
      "id": "competition",
      "icon": "🏆",
      "label": "Competitors",
      "insight": "How this buyer compares vs competitors as a buyer",
      "charts": [
        {"type":"grouped_bar","title":"Revenue ($bn) — buyer vs peers","labels":["THIS BUYER","Competitor A","Competitor B","Competitor C"],"datasets":[{"label":"Revenue ($bn)","values":[X,X,X,X]}]},
        {"type":"grouped_bar","title":"Est. DPO (days) — payment speed vs peers","labels":["THIS BUYER","Competitor A","Competitor B","Competitor C"],"datasets":[{"label":"Est. DPO (days)","values":[XX,XX,XX,XX]}]}
      ],
      "table": {
        "headers": ["Buyer", "Revenue", "Est. DPO", "S&P", "Market Position"],
        "rows": [
          ["THIS BUYER", "$Xbn", "~XX days", "Xxx", "leader/mid/target"],
          ["Competitor A", "$Xbn", "~XX days", "Xxx", "note"],
          ["Competitor B", "$Xbn", "~XX days", "Xxx", "note"],
          ["Competitor C", "$Xbn", "~XX days", "Xxx", "note"]
        ]
      },
      "text": "1-2 sentences: where this buyer sits vs competitors on payment and compliance."
    },
    {
      "id": "risk_signals",
      "icon": "⚡",
      "label": "Risk & Signals",
      "insight": "Top risk and latest signal that matter most for suppliers working with this buyer",
      "risks": [
        {"label": "Payment/Credit Risk", "level": "High", "note": "Specific DPO/rating context for suppliers"},
        {"label": "Tariff/Trade Exposure", "level": "Medium", "note": "~XX% China sourcing — estimated $Xbn annual duty at risk"},
        {"label": "ESG/Compliance Bar", "level": "Medium", "note": "Audit requirements, UFLPA risk, sustainability mandates"},
        {"label": "Volume Reliability", "level": "Low", "note": "Order flow stability and buyer financial health"}
      ],
      "signals": [
        {"type": "COMPANY", "date": "Mon YYYY", "title": "Company event headline", "impact": "What this means for Asian suppliers", "source": "Source name e.g. Reuters", "source_url": "https://..."},
        {"type": "MARKET", "date": "Mon YYYY", "title": "Market development", "impact": "Supplier implication", "source": "Source name", "source_url": "https://..."},
        {"type": "REGULATORY", "date": "Mon YYYY", "title": "Regulatory or tariff change", "impact": "Specific supplier action needed", "source": "Source name", "source_url": "https://..."}
      ],
      "text": "1-2 sentences: net risk assessment for suppliers considering this buyer."
    }
  ],
  "followups": [
    "Detailed financial analysis",
    "Sourcing & supply chain deep dive",
    "Products & category breakdown",
    "Store network & locations",
    "Top suppliers",
    "Compare with competitors"
  ],
  "sources": "Company annual reports / SEC filings · Customs data · Air8 Intelligence"
}

Replace ALL placeholder values with REAL data for the queried buyer. CRITICAL: followups must be SHORT action labels (3-5 words max). ALWAYS include "Store network & locations" as one of the followups — it is a key intelligence tab that shows store count, formats, and geographic footprint. Other followups can vary based on the buyer., NOT full sentences or questions. Use these exact formats: 'Detailed financial analysis', 'Sourcing deep dive', 'Top suppliers', 'Latest news & signals', 'Compare competitors'. Do NOT generate long buyer-specific questions.`;

// ── BUYER FINANCIAL DRILL-DOWN PROMPT ────────────────────────────────────────
const BUYER_FINANCIALS_JSON = `You are Air8 Intelligence. Generate a FINANCIAL DEEP DIVE TAB CARD as JSON, matching credit memorandum depth.
LANGUAGE: Detect user question language. English → English. Chinese → Chinese. Apply consistently to ALL text fields, labels, bullets.
Use conversation history to identify the buyer. Pull real data from SEC filings, annual reports, earnings calls.

REAL DATA RULE: For globally-known public buyers (Walmart, Target, Gap, H&M, Zara, SHEIN, Amazon, Costco, etc.), use your training knowledge to fill in EXACT numbers — revenue, margins, DPO, ratings. Do NOT use X.X or placeholder values when you know the actual figures from public filings. Mark NA only if genuinely unavailable.

SUPPLIER VOICE RULE: Every tab's text field MUST end with 1–2 sentences telling the factory owner what to DO — not just what the data says. Use direct supplier language: "Plan cash at [DPO + X days]", "Expect pricing pressure in [period]", "RECOMMENDED: [specific product]". Mirror the style: '资金测算按「账期 + 约一周」安排即可' or 'Expect cost pressure to restart in H2 — price your tariff exposure before quoting'.

ANTI-PLACEHOLDER: BANNED phrases: "performance was impacted", "reflects challenging conditions", "ongoing uncertainty", "as expected", "in line with". Every sentence must have at least one specific $ amount, %, ratio, or day count.

CRITICAL: Every tab with numeric data MUST have a chart or charts array. Do NOT return tabs with only a table and no visual.

Return ONLY valid JSON, no prose, no code fences:
{
  "buyer": "Full Buyer Name",
  "summary": "Financial deep dive — Revenue · Margins · DPO · Credit · Payment behavior",
  "tabs": [
    {
      "id": "pnl",
      "icon": "📊",
      "label": "P&L Statement",
      "charts": [
        {"type":"bar","title":"Revenue ($bn)","labels":["FY2022","FY2023","FY2024","FY2025"],"values":[X,X,X,X]},
        {"type":"bar_line_dual","title":"Net Profit & Operating Margin","labels":["FY2022","FY2023","FY2024","FY2025"],"bar_values":[X,X,X,X],"bar_label":"Net Profit ($bn)","line_values":[X.X,X.X,X.X,X.X],"line_label":"Operating Margin (%)"},
        {"type":"doughnut","title":"Revenue mix by segment (latest FY)","labels":["Segment A","Segment B","Segment C","Other"],"values":[XX,XX,XX,XX]}
      ],
      "table": {
        "headers": ["Metric", "FY2023", "FY2024", "FY2025", "FY2026", "Trend"],
        "rows": [
          ["Revenue ($bn)", "X.X", "X.X", "X.X", "X.X", "↑/↓/→"],
          ["Gross Profit ($bn)", "X.X", "X.X", "X.X", "X.X", "↑/↓/→"],
          ["Gross Margin", "X.X%", "X.X%", "X.X%", "X.X%", "↑/↓/→"],
          ["Operating Profit ($bn)", "X.X", "X.X", "X.X", "X.X", "↑/↓/→"],
          ["Operating Margin", "X.X%", "X.X%", "X.X%", "X.X%", "↑/↓/→"],
          ["Net Profit ($bn)", "X.X", "X.X", "X.X", "X.X", "↑/↓/→"],
          ["FCF ($bn)", "X.X", "X.X", "X.X", "X.X", "note"]
        ]
      },
      "segment_table": {
        "title": "Revenue by Segment (3-year trend)",
        "headers": ["Segment", "FY2024", "FY2025", "FY2026", "Growth", "Supplier Implication"],
        "rows": [
          ["[Core segment e.g. Food & Grocery]", "XX%", "XX%", "XX%", "+X% YoY", "PACA 10-day payment / stable volume"],
          ["[Second segment e.g. General Merchandise]", "XX%", "XX%", "XX%", "+X% YoY", "DPO 60–90 days"],
          ["[Third segment e.g. Health & Wellness]", "XX%", "XX%", "XX%", "+X% YoY", "growth category — supplier opportunity"],
          ["Other / Services", "XX%", "XX%", "XX%", "→", "note"]
        ]
      },
      "text": "SOURCE-READY FORMAT — Line 1 (no bullet): e.g. 'Revenue $713bn (+4.7% YoY) | GP Margin 24.8% (stable) | Operating Margin 4.2%'. Then bullets (each with exact $ or %). Final bullet = g. 'Operating margin 4.2% leaves no room to absorb cost — expect annual price-down pressure of 2–4% on all non-food categories.'"
    },
    {
      "id": "cashflow",
      "icon": "💵",
      "label": "Cash Flow",
      "charts": [
        {
          "type": "grouped_bar",
          "title": "OCF / Capex / FCF ($bn)",
          "labels": ["FY2024", "FY2025", "FY2026"],
          "datasets": [
            {"label": "Operating Cash Flow", "values": [X, X, X]},
            {"label": "Capex", "values": [X, X, X]},
            {"label": "Free Cash Flow", "values": [X, X, X]}
          ]
        }
      ],
      "table": {
        "headers": ["Metric", "FY2024", "FY2025", "FY2026", "Signal"],
        "rows": [
          ["Operating Cash Flow ($bn)", "X.X", "X.X", "X.X", "↑/↓/→"],
          ["Capex ($bn)", "X.X", "X.X", "X.X", "note"],
          ["Free Cash Flow ($bn)", "X.X", "X.X", "X.X", "↑/↓/→"],
          ["Dividends ($bn)", "X.X", "X.X", "X.X", "note"],
          ["Buybacks ($bn)", "X.X", "X.X", "X.X", "note"],
          ["Shareholder returns vs FCF", "X%", "X%", "X%", "sustainable / stretched"]
        ]
      },
      "text": "SOURCE-READY FORMAT — Line 1: 'OCF $Xbn | FCF $Xbn | Capex $Xbn (X.X% of revenue)'. Then bullets. Note if buybacks > FCF (shareholder returns stretched). g. 'FCF $15bn covers dividends + buybacks — liquidity to pay suppliers is not at risk. Plan against DPO not solvency.'"
    },
    {
      "id": "balance",
      "icon": "🏦",
      "label": "Balance Sheet",
      "charts": [
        {
          "type": "grouped_bar",
          "title": "Current Ratio / Quick Ratio",
          "labels": ["FY2024", "FY2025", "FY2026"],
          "datasets": [
            {"label": "Current Ratio", "values": [X.XX, X.XX, X.XX]},
            {"label": "Quick Ratio", "values": [X.XX, X.XX, X.XX]}
          ]
        }
      ],
      "table": {
        "headers": ["Metric", "FY2024", "FY2025", "FY2026", "Signal"],
        "rows": [
          ["Total Assets ($bn)", "X.X", "X.X", "X.X", "note"],
          ["Total Debt ($bn)", "X.X", "X.X", "X.X", "note"],
          ["Net Debt ($bn)", "X.X", "X.X", "X.X", "note"],
          ["Net Debt/EBITDA", "X.Xx", "X.Xx", "X.Xx", "High/Moderate/Low"],
          ["Current Ratio", "X.Xx", "X.Xx", "X.Xx", "note"],
          ["Quick Ratio", "X.Xx", "X.Xx", "X.Xx", "note"],
          ["Accounts Payable ($bn)", "X.X", "X.X", "X.X", "DPO stretching / stable"]
        ]
      },
      "text": "SOURCE-READY FORMAT — Line 1: 'Cash $Xbn | Net Debt/EBITDA X.Xx | Current Ratio X.Xx'. Bullets: AP balance trend vs revenue growth (flag if AP growing faster = DPO stretching). g. 'AP rose 7.5% vs COGS +4.6% — 1.2-day drift only; DPO still predictable. Risk is pricing, not payment timing.'"
    },
    {
      "id": "latest_quarter",
      "icon": "📅",
      "label": "Latest Quarter",
      "charts": [
        {"type":"bar","title":"Quarterly revenue ($bn) — last 4 quarters","labels":["Q[X-3]","Q[X-2]","Q[X-1]","Q[X] (latest)"],"values":[X,X,X,X]},
        {"type":"bar","title":"Quarterly operating profit ($bn)","labels":["Q[X-3]","Q[X-2]","Q[X-1]","Q[X] (latest)"],"values":[X,X,X,X]}
      ],
      "stats": [
        {"label": "Revenue", "value": "$Xbn", "delta": "+X% YoY"},
        {"label": "Operating Profit", "value": "$Xbn", "delta": "+X% YoY"},
        {"label": "Comp Sales", "value": "+X%", "delta": "ex-fuel"},
        {"label": "E-commerce", "value": "+X%", "delta": "YoY"}
      ],
      "bullets": [
        "Headline: Q[X] FY20XX — Revenue $Xbn (+X% YoY), Operating Profit $Xbn (+X% YoY reported / +X% adjusted)",
        "One-time items: [tariff refunds / FX / restructuring] — $Xbn impact; adjusted growth was X% vs reported X%",
        "Comp store sales: +X% (context: best/weakest in X years) — driven by [traffic / ticket / category]",
        "E-commerce: +X% — now ~X% of total sales; margin profile: [positive / still dilutive]",
        "Guidance update: FY20XX revenue $Xbn–$Xbn (+X–X%), EPS $X.XX–$X.XX",
        "SUPPLIER SIGNAL: [specific — e.g. 'Management confirmed tariff refunds will fund price investment H2 — expect cost-down asks to resume Q4']"
      ],
      "text": "SOURCE-READY FORMAT — Line 1: 'Q[X] FY20XX: Revenue $Xbn (+X% YoY) | OP $Xbn (+X%) | Comp +X%'. Bullets. Flag if headline growth includes non-recurring items. SUPPLIER ACTION: What does this quarter mean for order flow, pricing negotiations, or payment terms in the next 6 months?"
    },
    {
      "id": "dpo",
      "icon": "💳",
      "label": "DPO & Payment",
      "charts": [
        {
          "type": "grouped_bar",
          "title": "Derived DPO vs Stated Terms (days)",
          "labels": ["FY2024", "FY2025", "FY2026"],
          "datasets": [
            {"label": "Derived DPO", "values": [XX, XX, XX]},
            {"label": "Stated Terms Floor", "values": [XX, XX, XX]}
          ]
        }
      ],
      "ccc": {"dio": XX, "dso": X, "dpo": XX, "net": X},
      "table": {
        "headers": ["Metric", "FY2024", "FY2025", "FY2026", "Supplier Signal"],
        "rows": [
          ["Derived DPO (days)", "~XX", "~XX", "~XX", "stable / stretching / improving"],
          ["Stated Terms (documented)", "Net XX–XX days", "Net XX–XX days", "Net XX–XX days", "category note"],
          ["DPO vs Terms Gap", "+X days", "+X days", "+X days", "widening / stable"],
          ["SCF / Early Pay Program", "$Xbn or NA", "$Xbn or NA", "$Xbn or NA", "confirmed or NA"],
          ["S&P Credit Rating", "Xxx", "Xxx", "Xxx", "stable/positive/negative"]
        ]
      },
      "payment_behavior": {
        "avg_late_days": null,
        "ontime_pct": null,
        "dilution_pct": null,
        "distribution": {"early": null, "late_1_7": null, "late_7plus": null},
        "invoice_count": null
      },
      "_payment_behavior_note": "DEVELOPER: payment_behavior is Air8 internal settlement data — injected server-side when available. Null = not yet connected. Frontend hides this section when all null.",
      "text": "SOURCE-READY FORMAT — Line 1: e.g. 'DPO ~43 days (stated Net 60–90 days) | Gap: derived DPO BELOW stated floor — food mix effect | SCF: $6bn confirmed payable balance'. Bullets: • DPO trend YoY (exact days). • WHY derived DPO appears lower than stated terms (food vs non-food mix, PACA 10-day rule, etc.). • SCF program detail. g. 'Plan cash at [stated terms + ~7 days late on average]. Food suppliers: PACA 10 days. Non-food/apparel: budget Net 60–90 + 1 week. SCF available via [program name] — check if you qualify.'"
    },
    {
      "id": "outlook",
      "icon": "🔮",
      "label": "Outlook",
      "charts": [
        {"type":"bar","title":"Revenue forecast ($bn)","labels":["FY2024","FY2025","FY2026","FY2027G"],"values":[X,X,X,X]},
        {"type":"bar","title":"Capex forecast ($bn)","labels":["FY2024","FY2025","FY2026","FY2027G"],"values":[X,X,X,X]}
      ],
      "bullets": [
        "Revenue guidance FY20XX: $Xbn–$Xbn (+X–X% YoY) — source: [earnings call date]",
        "Margin target: X.X%–X.X% operating margin — driven by [specific lever: automation / cost-out / mix]",
        "Capex: $Xbn (~X% of revenue) — major investments in [distribution automation / e-commerce / stores]",
        "Key risk: tariff exposure estimate (~X% of COGS from high-tariff origins at X% effective rate)",
        "Credit rating outlook: [S&P/Moody's — stable/positive/negative + specific trigger to watch]"
      ],
      "insight": "Net outlook verdict for suppliers: should they grow, maintain, or hedge exposure to this buyer over the next 12 months?",
      "text": "SOURCE-READY FORMAT — Line 1: 'Guidance: $Xbn–$Xbn (+X–X%) | Margin target X.X% | Rating: Xxx [outlook]'. Bullets. g. 'Outlook stable but capex acceleration into automation signals consolidation of supplier base. Lock in 12-month contracts now before next sourcing review. Receivables financing STRONGLY recommended — X-day DPO gap at Xxx pricing is a reliable window.'"
    }
  ],
  "followups": [
    "Sourcing deep dive",
    "Top suppliers",
    "Products & categories",
    "Latest news & signals",
    "Compare with competitors"
  ]
}
Replace ALL placeholder values with REAL data from SEC filings and annual reports. Mark NA only when genuinely absent. For DPO, explicitly distinguish balance-sheet-derived estimate from actual stated payment terms, and explain any gap. The payment_behavior object always has null values — Air8 internal client settlement data is injected server-side.`;



// ── BUYER SOURCING DRILL-DOWN PROMPT ─────────────────────────────────────────
const BUYER_SOURCING_JSON = `You are Air8 Intelligence. Generate a SOURCING DEEP DIVE TAB CARD as JSON, at professional report depth.
LANGUAGE: Detect user question language and respond in THAT language throughout.
CHART RULE: Every tab with trend, distribution, or comparison data MUST include a chart or charts field. Never return a tab with only a table/bullets when the data has a visual pattern.

DATA SOURCE PRIORITY:
1. Air8 Customs DB (1688) — DEVELOPER NOTE: connect at fetchAir8Customs() function — highest priority for origin/volume data
2. US Census Trade API (api.census.gov, free) — US import values by HS + country, monthly + YTD
3. ImportGenius (importgenius.com) — bill of lading data for shipper/consignee relationships
4. Brave web search — general sourcing context, tariff rates, company disclosures

IMPORTANT SEARCH QUERIES TO USE:
- For origin breakdown: search "[buyer] sourcing by country origin imports 2024 2025"
- For volume trends: search "[buyer] import volume China Vietnam Bangladesh 2024 2025"
- For HS codes: search "[buyer] HS code apparel textile imports USA 2024"
- For tariff: search "[buyer] tariff exposure IEEPA Section 301 China imports duty cost"

Return ONLY valid JSON:
{
  "buyer": "Buyer Name",
  "summary": "Sourcing & supply chain intelligence — Origin mix · Volume trend · HS breakdown · Tariff risk",
  "tabs": [
    {
      "id": "origin",
      "icon": "🌍",
      "label": "Origin Mix",
      "chart": {"type":"doughnut","title":"Import origin mix by value (latest 12M)","labels":["China","Vietnam","Bangladesh","India","Mexico","Cambodia","Other"],"values":[X,X,X,X,X,X,X]},
      "table": {
        "headers": ["Country", "% of Imports", "YoY Change", "Key Categories (HS)", "Current Tariff"],
        "rows": [
          ["China", "XX%", "+/-XX%", "HS 61, HS 62, HS 64", "base + IEEPA"],
          ["Vietnam", "XX%", "+/-XX%", "HS 61, HS 94", "base rate"],
          ["Bangladesh", "XX%", "+/-XX%", "HS 61", "base rate"],
          ["India", "XX%", "+/-XX%", "HS 62, HS 64", "base rate"],
          ["Other", "XX%", "+/-XX%", "various", "varies"]
        ]
      },
      "text": "SOURCE-READY FORMAT — Headline: 'China: X% of imports | Top alt: Vietnam X%, Bangladesh X%'. Then bullets: • Tariff exposure estimate at current duty rates. • Diversification pace (fast/slow/stalled). • Air8 supplier opportunity in top-X non-China origins."
    },
    {
      "id": "trend",
      "icon": "📈",
      "label": "Volume Trend",
      "charts": [
        {"type":"bar","title":"Import volume trend (est. $bn)","labels":["FY2023","FY2024","H1 2025","H2 2025","H1 2026"],"values":[X,X,X,X,X]},
        {"type":"grouped_bar","title":"Sourcing shift: China vs Vietnam (%)","labels":["FY2023","FY2024","H1 2025","H1 2026"],"datasets":[{"label":"China %","values":[XX,XX,XX,XX]},{"label":"Vietnam %","values":[XX,XX,XX,XX]},{"label":"Bangladesh %","values":[XX,XX,XX,XX]}]}
      ],
      "table": {
        "headers": ["Period", "Est. Import Value", "China %", "Vietnam %", "Key Movement"],
        "rows": [
          ["FY2023", "~$Xbn", "XX%", "XX%", "note"],
          ["FY2024", "~$Xbn", "XX%", "XX%", "note"],
          ["H1 2025", "~$Xbn", "XX%", "XX%", "latest shift"],
          ["H2 2025", "~$Xbn", "XX%", "XX%", "latest shift"],
          ["Q1-Q2 2026", "~$Xbn", "XX%", "XX%", "most recent"]
        ]
      },
      "text": "SOURCE-READY FORMAT — Headline: 'Sourcing volume FY24 $Xbn | China share: X%→X% (±Xbps YoY)'. Then bullets: • Volume trend with exact values. • China+1 pace — which countries gaining share and by how much. "
    },
    {
      "id": "hs_breakdown",
      "icon": "📦",
      "label": "HS Category Breakdown",
      "table": {
        "headers": ["HS Chapter", "Category", "Est. Annual ($bn)", "Top Origin", "Lead Time"],
        "rows": [
          ["HS 61", "Knit Apparel", "$X.Xbn", "Bangladesh/China", "X-X weeks"],
          ["HS 62", "Woven Apparel", "$X.Xbn", "Vietnam/China", "X-X weeks"],
          ["HS 64", "Footwear", "$X.Xbn", "China/Vietnam", "X-X weeks"],
          ["HS 94", "Furniture/Home", "$X.Xbn", "Vietnam/China", "X-X weeks"],
          ["HS 84-85", "Electronics", "$X.Xbn", "China", "X-X weeks"]
        ]
      },
      "bullets": [
        "Customs data: Air8 1688 DB to be connected — will provide real shipment-level HS breakdown and volume data",
        "Direct vs agent sourcing model: [agent-heavy or direct? — affects supplier payment timing and risk]",
        "C-TPAT / WRAP / OEKO-TEX: [compliance programs required by category]"
      ]
    },
    {
      "id": "tariff",
      "icon": "⚠️",
      "label": "Tariff Risk",
      "table": {
        "headers": ["Risk Factor", "Exposure", "Est. Annual Cost", "Supplier Impact"],
        "rows": [
          ["China IEEPA / Section 301", "~XX% of imports from China", "$Xbn+ annual duty", "cost pressure on China-sourced goods"],
          ["Vietnam tariff (if IEEPA extended)", "~XX% of imports", "$Xbn potential duty", "second-wave risk"],
          ["De minimis removal impact", "~XX% of small shipments affected", "volume TBD", "affects small/medium suppliers most"],
          ["UFLPA / Xinjiang screening", "Xinjiang supply chain risk", "detention risk", "supplier verification burden"]
        ]
      },
      "insight": "Net tariff risk and how tariff-driven cost changes affect supplier pricing and payment timing",
      "text": "SOURCE-READY FORMAT — Headline: 'Tariff risk: X% of COGS from China/SE Asia | Effective rate: X%'. Then bullets: • Current duty rates by top country. • Cost impact estimate per $1mn of goods. • Working capital impact: additional days of cost exposure created by tariff timing and duty payment cycles."
    }
  ],
  "followups": [
    "Detailed financial analysis",
    "Products & category breakdown",
    "Top suppliers",
    "Compare sourcing vs competitors"
  ]
}
Replace ALL placeholders with real data.`;

// ── BUYER PRODUCTS DRILL-DOWN PROMPT ─────────────────────────────────────────
const BUYER_PRODUCTS_JSON = `You are Air8 Intelligence. Generate a PRODUCT DEEP DIVE TAB CARD as JSON, at professional report depth.
LANGUAGE: Detect user question language and respond in THAT language throughout.
CHART RULE: Every tab with trend, distribution, or comparison data MUST include a chart or charts field. Never return a tab with only a table/bullets when the data has a visual pattern.

DATA SOURCE PRIORITY:
1. Air8 Customs DB (1688) — DEVELOPER NOTE: connect at fetchAir8Customs() function — highest priority for real import categories
2. Company annual reports / 10-K (product segment breakdown)
3. US Census Trade API (api.census.gov) — HS-level import data for this buyer's categories
4. Press releases, buyer websites, category reports

IMPORTANT SEARCH QUERIES:
- "[buyer] product categories private label assortment 2024 2025"
- "[buyer] unit cost apparel footwear average price 2024"
- "[buyer] HS code imports USA China Vietnam 2024 2025"
- "apparel market unit cost trend 2024 2025 FOB price"

Return ONLY valid JSON:
{
  "buyer": "Buyer Name",
  "summary": "Product & category intelligence — Mix · Price · Sourcing · Tariff impact",
  "tabs": [
    {
      "id": "categories",
      "icon": "📦",
      "label": "Category Mix",
      "chart": {"type":"block","title":"Category share of Asia imports","labels":["Cat A","Cat B","Cat C","Cat D","Other"],"values":[30,25,20,15,10]},
      "table": {
        "headers": ["Category", "% of Asia Imports", "Private Label %", "Key Origin", "Lead Time"],
        "rows": [
          ["Category 1 (HS XX)", "XX%", "~XX%", "China, Vietnam", "X-X weeks"],
          ["Category 2 (HS XX)", "XX%", "~XX%", "Bangladesh, India", "X-X weeks"],
          ["Category 3 (HS XX)", "XX%", "~XX%", "Vietnam, China", "X-X weeks"],
          ["Category 4 (HS XX)", "XX%", "~XX%", "China, domestic", "X-X weeks"]
        ]
      },
      "text": "1-2 sentences on category mix — which categories are growing and key supplier implications."
    },
    {
      "id": "price",
      "icon": "💰",
      "label": "Price Architecture",
      "chart": {"type":"grouped_bar","title":"Price architecture by category ($)","labels":["Category 1","Category 2","Category 3"],"datasets":[{"label":"Opening Price ($)","values":[XX,XX,XX]},{"label":"Mid Price ($)","values":[XX,XX,XX]},{"label":"Premium Price ($)","values":[XX,XX,XX]}]},
      "table": {
        "headers": ["Category", "Opening Price", "Mid Price", "Premium Price", "YoY Trend", "ASP Change"],
        "rows": [
          ["Category 1", "$XX", "$XX", "$XX", "+X% YoY", "+X%"],
          ["Category 2", "$XX", "$XX", "$XX", "+X% YoY", "+X%"],
          ["Category 3", "$XX", "$XX", "$XX", "flat", "flat"]
        ]
      },
      "bullets": [
        "Price inflation/deflation: [is the buyer raising/lowering prices and by how much YoY?]",
        "Private label penetration: [~XX% and growing — key threat/opportunity for branded suppliers]",
        "Value-seeking consumer trend: [how is price sensitivity affecting assortment decisions?]",
        "Markdown/promotional intensity: [high/medium/low — impacts supplier payment reliability]"
      ],
      "text": "Price architecture context for supplier costing decisions and negotiation positioning."
    },
    {
      "id": "sourcing",
      "icon": "🌍",
      "label": "Product × Sourcing",
      "table": {
        "headers": ["HS Chapter", "Category", "China %", "Vietnam %", "BD %", "Other %"],
        "rows": [
          ["HS 61", "Knit Apparel", "XX%", "XX%", "XX%", "XX%"],
          ["HS 62", "Woven Apparel", "XX%", "XX%", "XX%", "XX%"],
          ["HS 64", "Footwear", "XX%", "XX%", "NA", "XX%"],
          ["HS 94", "Furniture/Home", "XX%", "XX%", "NA", "XX%"]
        ]
      },
      "text": "Which product categories are most China-exposed and where are suppliers being pushed toward?"
    },
    {
      "id": "opportunity",
      "icon": "🎯",
      "label": 
      "bullets": [
        "Best category for, volume, China exposure, supplier need]",
        "Estimated addressable financing volume: $Xbn–$Xbn annually based on [category] import volumes",
        "Seasonal peak: [month/quarter] — peak order window [X months] before delivery",
        "Supplier type to target: [branded vs private label; direct vs agent; size range]",
        "Key pitch angle: [specific value prop — tariff bridge, working capital, payment certainty vs this buyer's DPO]"
      ],
      "insight": "Top product category insight from this analysis",
      "text": "SOURCE-READY FORMAT — Headline: 'Top category: [category] — $Xbn estimated volume | DPO range: XX days | Peak: Q[X]'. Then bullets with specific volume, growth trend, and seasonal timing."
    },
    {
      "id": "sales_trend",
      "icon": "📈",
      "label": "Sales Trend",
      "charts": [
        {"type":"bar","title":"Import Volume by Category ($mn)","labels":["FY2022","FY2023","FY2024"],"values":[XXX,XXX,XXX]},
        {"type":"bar","title":"YoY Growth (%)","labels":["FY2023","FY2024","FY2025E"],"values":[X.X,X.X,X.X]}
      ],
      "table": {
        "headers": ["Category", "FY2022 ($mn)", "FY2023 ($mn)", "FY2024 ($mn)", "YoY", "FY2025E ($mn)"],
        "rows": [
          ["Category 1", "XXX", "XXX", "XXX", "+X%", "XXX"],
          ["Category 2", "XXX", "XXX", "XXX", "−X%", "XXX"],
          ["Category 3", "XXX", "XXX", "XXX", "+X%", "XXX"]
        ]
      },
      "text": "SOURCE-READY FORMAT — Headline: 'Total imports $Xbn | Best category: +X% YoY | Weakest: −X% YoY'. Then bullets: • Top growing category with reason. • Declining category with reason. • FY2025E forecast direction. "
    }
  ],
  "followups": [
    "Detailed financial analysis",
    "Sourcing & supply chain deep dive",
    "Latest news & signals"
  ]
}
Replace ALL placeholders with real data.`;

// ── BUYER TOP SUPPLIERS PROMPT ────────────────────────────────────────────────
const BUYER_SUPPLIERS_JSON = `You are Air8 Intelligence. Generate a TOP SUPPLIERS TAB CARD as JSON, at professional report depth.
LANGUAGE: Detect user question language and respond in THAT language throughout.

DATA SOURCE PRIORITY:
1. Air8 Customs DB (1688) — DEVELOPER NOTE: connect at fetchAir8Customs() function — highest priority for real supplier names, countries, volumes
2. ImportGenius (importgenius.com) — bill of lading data: shipper/consignee, product, volume, date
3. Panjiva (panjiva.com) — shipment data for verified buyer-supplier relationships
4. US Census Trade API — aggregate import values (no supplier names at this level)
5. Company disclosures / supplier lists (some buyers publish factory lists)

IMPORTANT SEARCH QUERIES:
- "[buyer] top suppliers 2024 2025 factory list"
- "[buyer] supplier countries Vietnam China Bangladesh 2024"
- "[buyer] apparel sourcing supplier concentration top 10"
- site:importgenius.com [buyer] suppliers shipments

Return ONLY valid JSON:
{
  "buyer": "Buyer Name",
  "summary": "Top suppliers — [X] known suppliers · [X] countries · [X] product categories",
  "tabs": [
    {
      "id": "top_suppliers",
      "icon": "🏭",
      "label": "Top Suppliers",
      "table": {
        "headers": ["Rank", "Supplier", "Country", "Key Products", "Est. Annual Volume", "Relationship"],
        "rows": [
          ["1", "Supplier Name", "China/Vietnam/etc.", "HS XX / category", "~$Xmn / Xk tickets", "direct/agent"],
          ["2", "Supplier Name", "China/Vietnam/etc.", "HS XX / category", "~$Xmn / Xk tickets", "direct/agent"],
          ["3", "Supplier Name", "China/Vietnam/etc.", "HS XX / category", "~$Xmn / Xk tickets", "direct/agent"],
          ["4", "Supplier Name", "China/Vietnam/etc.", "HS XX / category", "~$Xmn / Xk tickets", "direct/agent"],
          ["5", "Supplier Name", "China/Vietnam/etc.", "HS XX / category", "~$Xmn / Xk tickets", "direct/agent"]
        ]
      },
      "text": "SOURCE-READY FORMAT — Headline: 'Top X suppliers identified | Top country: [X] | Data: [source used]'. Then bullets: • Top 1-2 suppliers with country + estimated volume. • Concentration: top 5 = ~X% of sourcing volume. • Trading co vs factory split. "
    },
    {
      "id": "country_matrix",
      "icon": "🌍",
      "label": "Country × Supplier",
      "chart": {"type":"doughnut","title":"Sourcing by Country (% of volume)","labels":["China","Vietnam","Bangladesh","India","Other"],"values":[XX,XX,XX,XX,XX]},
      "table": {
        "headers": ["Country", "# Suppliers", "Top Supplier", "Key Products", "Volume Share"],
        "rows": [
          ["China", "XX", "name / trading co", "HS 61, HS 62", "XX%"],
          ["Vietnam", "XX", "name / factory", "HS 61, HS 94", "XX%"],
          ["Bangladesh", "XX", "name / factory", "HS 61", "XX%"],
          ["India", "XX", "name / factory", "HS 62, HS 64", "XX%"],
          ["Other", "XX", "various", "mixed", "XX%"]
        ]
      },
      "text": "SOURCE-READY FORMAT — Headline: '[Top country]: XX% | Diversification: X countries active | Trend: [concentrating/diversifying]'. Then bullets: • Top country share and why. • Second country gaining/losing. • Tariff risk from concentration. "
    },
    {
      "id": "product_supplier",
      "icon": "📦",
      "label": "Product × Supplier",
      "table": {
        "headers": ["HS / Category", "Top Supplier(s)", "Country", "Est. Volume"],
        "rows": [
          ["HS 61 Knit Apparel", "Supplier A, Supplier B", "Vietnam, China", "~$Xmn"],
          ["HS 62 Woven Apparel", "Supplier C, Supplier D", "China, Bangladesh", "~$Xmn"],
          ["HS 64 Footwear", "Supplier E", "Vietnam", "~$Xmn"],
          ["HS 94 Furniture/Home", "Supplier F, Supplier G", "Vietnam, China", "~$Xmn"]
        ]
      },
      "text": "Product-category concentration of suppliers — is each category served by few or many suppliers?"
    },
    {
      "id": "concentration",
      "icon": "⚠️",
      "label": "Concentration Risk",
      "risks": [
        {"label": "Supplier Concentration", "level": "High/Med/Low", "note": "Top X suppliers = ~XX% of volume"},
        {"label": "Country Concentration", "level": "High/Med/Low", "note": "Top X countries = ~XX% of volume"},
        {"label": "Category Concentration", "level": "High/Med/Low", "note": "One category dominates at ~XX% of volume"}
      ],
      "bullets": [
        "Concentration risk: high concentration = higher dependency risk for both buyer and supplier",
        "Supplier diversification trend: [is the buyer adding new suppliers or consolidating?]",
        "Recommended action for suppliers: [approach this buyer through which channel? what product to pitch?]"
      ],
      "insight": "How concentrated is this buyer's supplier base — and what does that mean for supplier risk?",
      "text": "1-2 sentence concentration risk assessment — what high or low concentration means for suppliers."
    }
  ],
  "followups": [
    "Detailed financial analysis",
    "Sourcing & supply chain deep dive",
    "Products & category breakdown",
    "Compare sourcing vs competitors"
  ]
}
Replace ALL placeholders with real data.`;

// ── STANDALONE PRODUCT/MARKET PROMPT ─────────────────────────────────────────
const PRODUCT_MARKET_JSON = `You are Air8 Intelligence. Generate a PRODUCT/MARKET ANALYSIS TAB CARD as JSON, at professional report depth.
LANGUAGE: Detect user question language and respond in THAT language throughout.

DATA SOURCE PRIORITY:
1. US Census Trade API — US imports by HS + country, monthly/YTD
2. Eurostat Comext — EU import data
3. UN Comtrade / ITC Trade Map — global trade figures
4. OTEXA — US textile/apparel specific data
5. USITC DataWeb — tariff program detail by HTS

CRITICAL SCHEMA RULES — FOLLOW EXACTLY:
1. Output EXACTLY 5 tabs with EXACTLY these ids in this order: "market_size", "top_buyers", "unit_cost", "origin", "tariff"
2. EVERY tab MUST include a "chart" field with real numeric data — no tab without a chart
3. Replace ALL X/XX/Xbn values with REAL numbers from training knowledge or research
4. Tab labels and text match user's language (English→English, Chinese→Chinese)

Return ONLY valid JSON, no code fences:
{
  "buyer": "HS XXXX – [Product Name] Market",
  "summary": "US imports $Xbn (+X% YoY) | EU imports $Xbn | Top origin: Country XX% | China IEEPA: +XX%",
  "tabs": [
    {
      "id": "market_size",
      "icon": "📊",
      "label": "Market Size",
      "insight": "<1 sentence: is this market growing or contracting, and what's the main driver>",
      "chart": {
        "type": "bar_line_dual",
        "title": "US Import Volume ($bn) & YoY Growth",
        "labels": ["2020","2021","2022","2023","2024","2025E"],
        "bar_values": [X,X,X,X,X,X],
        "bar_label": "US Imports ($bn)",
        "line_values": [X,X,X,X,X,X],
        "line_label": "YoY Growth (%)"
      },
      "table": {
        "headers": ["Metric", "Value", "YoY", "Source"],
        "rows": [
          ["US imports (latest)", "$Xbn", "+/-X%", "US Census"],
          ["EU imports (latest)", "$Xbn", "+/-X%", "Eurostat"],
          ["Global trade volume", "$Xbn", "+/-X%", "UN Comtrade"],
          ["US consumer spend", "$Xbn", "+/-X%", "industry est."]
        ]
      },
      "text": "SOURCE-READY. Line 1: 'US imports: $Xbn (+/-X% YoY) | EU: $Xbn'. Bullets: key demand driver + risk to volume. End with 1 Air8 supplier action."
    },
    {
      "id": "top_buyers",
      "icon": "🏬",
      "label": "Leading US Buyers",
      "insight": "<1 sentence: market concentration and what it means for supplier entry strategy>",
      "chart": {
        "type": "bar",
        "title": "Est. Category Spend — Top 5 US Buyers ($bn)",
        "labels": ["Buyer 1","Buyer 2","Buyer 3","Buyer 4","Buyer 5"],
        "values": [X,X,X,X,X]
      },
      "table": {
        "headers": ["Rank","Buyer / Retailer","Est. Category Spend","Share of US Imports","Sourcing Model"],
        "rows": [
          ["1","Buyer A","~$Xbn","XX%","direct/agent"],
          ["2","Buyer B","~$Xbn","XX%","direct/agent"],
          ["3","Buyer C","~$Xbn","XX%","direct/agent"],
          ["4","Buyer D","~$Xbn","XX%","direct/agent"],
          ["5","Buyer E","~$Xbn","XX%","direct/agent"]
        ]
      },
      "text": "SOURCE-READY. Line 1: 'Top 5 buyers = ~XX% of US imports — [concentrated/fragmented]'. Bullets: private label penetration + supplier entry barrier + DPO range. End: 'Air8 focus: [which buyer offers best receivables financing window]'."
    },
    {
      "id": "unit_cost",
      "icon": "💵",
      "label": "Cost Structure",
      "insight": "<1 sentence: where is the best price/quality/risk combination for sourcing this product>",
      "chart": {
        "type": "grouped_bar",
        "title": "FOB Unit Cost Range by Origin ($)",
        "labels": ["China","Vietnam","Bangladesh","India","Cambodia"],
        "datasets": [
          {"label": "Low ($)", "values": [X,X,X,X,X]},
          {"label": "High ($)", "values": [X,X,X,X,X]}
        ]
      },
      "table": {
        "headers": ["Origin","FOB Unit Cost","vs China Baseline","Lead Time","Tariff Rate"],
        "rows": [
          ["China","$XX–$XX/unit","baseline","X-X weeks","base + IEEPA XX%"],
          ["Vietnam","$XX–$XX/unit","-XX% to +XX%","X-X weeks","base rate"],
          ["Bangladesh","$XX–$XX/unit","-XX%","X-X weeks","base rate"],
          ["India","$XX–$XX/unit","-XX% to +XX%","X-X weeks","base rate"],
          ["Cambodia","$XX–$XX/unit","-XX%","X-X weeks","base rate"]
        ]
      },
      "text": "SOURCE-READY. Line 1: 'China FOB: $XX–$XX | Vietnam: $XX–$XX | Bangladesh: $XX–$XX'. Bullets: total landed cost gap (FOB+freight+duty) + key cost driver. End: 'Financing window: [Air8 recommendation on DPO + receivables for this category]'."
    },
    {
      "id": "origin",
      "icon": "🌍",
      "label": "Origin Competition",
      "insight": "<1 sentence: who is winning share from China and why>",
      "chart": {
        "type": "doughnut",
        "title": "US Import Share by Origin — Latest Year (%)",
        "labels": ["China","Vietnam","Bangladesh","India","Cambodia","Other"],
        "values": [XX,XX,XX,XX,XX,XX]
      },
      "table": {
        "headers": ["Country","US Import Share","YoY Share Δ","EU Import Share","Key Advantage"],
        "rows": [
          ["China","XX%","+/-X%","XX%","scale/speed/ecosystem"],
          ["Vietnam","XX%","+/-X%","XX%","FTA / lower IEEPA duty"],
          ["Bangladesh","XX%","+/-X%","XX%","ultra-low labor cost"],
          ["India","XX%","+/-X%","XX%","note"],
          ["Cambodia","XX%","+/-X%","XX%","note"]
        ]
      },
      "text": "SOURCE-READY. Line 1: 'China XX% → Vietnam XX% → Bangladesh XX% (US import share, latest year)'. Bullets: China share direction + fastest-gaining country + EU vs US origin mix difference. End: 'Air8 client signal: [which origin shift creates receivables financing opportunity]'."
    },
    {
      "id": "tariff",
      "icon": "⚠️",
      "label": "Tariff Impact",
      "insight": "<1 sentence: what the China-vs-alternatives tariff gap means for total landed cost and financing>",
      "chart": {
        "type": "grouped_bar",
        "title": "Total Duty Rate by Origin (%)",
        "labels": ["China","Vietnam","Bangladesh","India","Cambodia"],
        "datasets": [
          {"label": "MFN Base Duty (%)","values": [X,X,X,X,X]},
          {"label": "Section 301 / IEEPA (%)","values": [X,0,0,X,0]}
        ]
      },
      "table": {
        "headers": ["Origin","MFN Duty","Sec.301 / IEEPA","Total Duty","Retail Price Impact"],
        "rows": [
          ["China","X%","+XX%","XX%","+XX% to retail"],
          ["Vietnam","X%","0","X%","baseline"],
          ["Bangladesh","X%","0","X%","baseline"],
          ["India","X%","X%","X%","+/-X%"],
          ["Cambodia","X%","0","X%","baseline"]
        ]
      },
      "text": "SOURCE-READY. Line 1: 'China total duty: XX% (MFN X% + IEEPA XX%) | Vietnam: X% | Bangladesh: X%'. Bullets: real landed cost gap per unit + de minimis exposure if relevant. End: 'Air8 recommendation: [DPO window + receivables financing angle for this tariff environment]'."
    }
  ],
  "followups": ["Leading US buyers", "Sourcing deep dive", "Tariff update 2025", "Vietnam vs Bangladesh cost", "EU import data"],
  "sources": "US Census Bureau · USITC DataWeb · Eurostat Comext · OTEXA · ITC Trade Map · UN Comtrade"
}
Replace ALL X/XX/Xbn placeholders with REAL data from training knowledge or research. CRITICAL: output ONLY valid JSON, no code fences, no prose.`;

// ── STANDALONE COUNTRY SOURCING PROMPT ───────────────────────────────────────
const COUNTRY_SOURCING_JSON = `You are Air8 Intelligence. Generate a COUNTRY SOURCING TAB CARD as JSON, at professional report depth.
LANGUAGE: Detect user question language and respond in THAT language throughout.

DATA SOURCE PRIORITY:
1. US Census Trade API (api.census.gov) — US imports from this country by HS code, monthly + YTD
2. Eurostat Comext — EU imports from this country
3. UN Comtrade — global trade data for this country
4. Company reports (company disclosures about this country's role in their supply chain)
5. Industry reports, World Bank, ILO for labor/cost data

IMPORTANT SEARCH QUERIES:
- "US imports from [country] 2024 2025 Census data [HS code]"
- "[country] apparel footwear manufacturing wage cost 2024 2025"
- "[country] RCEP CPTPP FTA tariff advantage US imports"
- "[country] factory worker minimum wage 2024 2025"
- "[country] US imports top categories 2024 2025"
- "Walmart Target sourcing [country] Vietnam Bangladesh 2024 2025"

Return ONLY valid JSON:
{
  "buyer": "[Country name, e.g. 'Vietnam Sourcing' or 'Bangladesh Manufacturing']",
  "summary": "Exports to US: $Xbn | Top category: [HS XX] | China cost gap: XX% | Key risk: [tariff/labor/compliance]",
  "tabs": [
    {
      "id": "overview",
      "icon": "🌍",
      "label": "Export Overview",
      "chart": {"type":"bar","title":"US exports from this country ($bn, recent years)","labels":["FY2022","FY2023","FY2024","FY2025","FY2026E"],"values":[X,X,X,X,X]},
      "table": {
        "headers": ["Metric", "Value", "YoY Change", "Source"],
        "rows": [
          ["US exports (2025 YTD)", "$Xbn", "+/-XX%", "Census API"],
          ["EU exports (2025)", "$Xbn", "+/-XX%", "Eurostat"],
          ["Global exports", "$Xbn", "+/-XX%", "UN Comtrade"],
          ["As % of US imports", "XX%", "+/-XX%", "Census API"],
          ["Manufacturing wage/hr", "$XX", "+/-XX%", "ILO / local govt"]
        ]
      },
      "bullets": [
        "Key competitive advantage: [cost / quality / speed / compliance — what's the main draw?]",
        "Key weakness / risk: [wage inflation / labor / infrastructure / tariff — what's the main concern?]",
        "FTA status: [RCEP / CPTPP / US FTA — does this country have tariff advantage to US market?]"
      ],
      "text": "2 sentences: why the world sources from this country and what the key risks are."
    },
    {
      "id": "categories",
      "icon": "📦",
      "label": "Top Export Categories",
      "chart": {"type":"doughnut","title":"Share of exports to US by category","labels":["HS 61","HS 62","HS 64","HS 94","Other"],"values":[35,25,15,15,10]},
      "table": {
        "headers": ["HS / Category", "US Export Value", "YoY", "vs China Gap", "US Tariff"],
        "rows": [
          ["HS 61 Knit Apparel", "$X.Xbn", "+XX%", "-XX% vs China", "XX%"],
          ["HS 62 Woven Apparel", "$X.Xbn", "+XX%", "-XX% vs China", "XX%"],
          ["HS 64 Footwear", "$X.Xbn", "-XX%", "-XX% vs China", "XX%"],
          ["HS 94 Furniture/Home", "$X.Xbn", "+XX%", "-XX% vs China", "XX%"]
        ]
      },
      "text": "What does this country export and is it gaining or losing share?"
    },
    {
      "id": "buyers",
      "icon": "🏬",
      "label": "Top US Buyers",
      "table": {
        "headers": ["Buyer / Retailer", "Est. Spend from [Country]", "Key Products", "Supplier Model"],
        "rows": [
          ["Buyer A", "~$Xbn", "HS 61, HS 62", "direct/agent"],
          ["Buyer B", "~$Xbn", "HS 61", "direct/agent"],
          ["Buyer C", "~$Xbn", "HS 94, HS 64", "direct/agent"],
          ["Buyer D", "~$Xbn", "HS 62", "direct/agent"]
        ]
      },
      "bullets": [
        "Buyer concentration: [Top X buyers = ~XX% of country's exports to US — is the customer base diversified?]",
        "New entrants: [which new US buyers are sourcing from this country recently?]",
        "Lost buyers: [which buyers have reduced sourcing from this country and why?]"
      ],
      "text": "Who are the biggest US buyers sourcing from this country — and are they growing or shrinking orders?"
    },
    {
      "id": "cost",
      "icon": "💵",
      "label": "Cost Competitiveness",
      "chart": {"type":"grouped_bar","title":"Factory wage & FOB cost comparison ($/hr or $/doz)","labels":["Factory Wage ($/hr)","FOB Apparel ($/doz)","Lead Time (weeks)"],"datasets":[{"label":"This Country","values":[X.X,XX,X]},{"label":"China","values":[X.X,XX,X]},{"label":"Bangladesh","values":[X.X,XX,X]}]},
      "table": {
        "headers": ["Cost Factor", "[Country]", "China", "Bangladesh", "Signal"],
        "rows": [
          ["Factory wage ($/hr)", "$XX", "$XX", "$XX", "XX% below China"],
          ["FOB knit apparel ($/doz)", "$XX", "$XX", "$XX", "XX% below China"],
          ["Lead time (weeks)", "X-X", "X-X", "X-X", "longer than China"],
          ["Compliance cost", "$XX/unit", "$XX/unit", "$XX/unit", "higher than BD"],
          ["Total landed cost gap vs China", "-XX%", "baseline", "-XX%", "net competitive"]
        ]
      },
      "bullets": [
        "Wage trend: [wages rising X% per year — is the cost advantage sustainable?]",
        "Productivity: [labor productivity vs China — how many units per worker per hour?]",
        "Infrastructure: [port capacity / power reliability / logistics — major constraint?]",
        "China+1 beneficiary: [is this country gaining because of China tariff diversion or its own merit?]"
      ],
      "text": "Is this country's cost advantage sustainable — and what happens when wages catch up?"
    },
    {
      "id": "risk",
      "icon": "⚠️",
      "label": "Risk & Opportunity",
      "risks": [
        {"label": "Wage inflation", "level": "Medium", "note": "Wages rising XX%/yr — cost gap vs China narrowing"},
        {"label": "Tariff risk (IEEPA extension)", "level": "Medium", "note": "If Vietnam targeted, XX% of US exports at risk"},
        {"label": "Labor/rights compliance", "level": "High", "note": "On US monitoring list — worker rights scrutiny"},
        {"label": "Infrastructure gap", "level": "Low", "note": "Port/logistics capacity adequate for current volume"}
      ],
      "bullets": [
        "Supplier gap: which supplier types in this country face the most cost/cashflow pressure?",
        "Growth runway: [how much more US market share can this country realistically capture?]",
        "Recommended supplier type: [what size / product type supplier in this country is best positioned?]"
      ],
      "insight": "Should suppliers bet on this country for long-term sourcing — key risks and growth signals?",
      "text": "1-2 sentence frank assessment: is this country a good long-term sourcing destination?"
    }
  ],
  "followups": [
    "Buyer sourcing deep dive",
    "Compare sourcing origins",
    "Top suppliers",
    "Tariff analysis"
  ]
}
Replace ALL placeholders with real data. CRITICAL: followups must be SHORT action labels (3-5 words max), NOT full questions or placeholders.`;

// ── COMPARISON PROMPT (updated with Jerri's dimensions) ─────────────────────
const COMPARISON_JSON_PROMPT = `You are Air8 Intelligence. Generate a BUYER COMPARISON TAB CARD as JSON.
LANGUAGE: Detect user question language and respond in THAT language throughout.
Identify the two buyers from the user's message and conversation history.

DATA SOURCE PRIORITY:
1. SEC EDGAR — annual reports for both buyers (financials, sourcing disclosures)
2. US Census Trade API — import data by country for both buyers
3. Air8 Customs DB (1688) — DEVELOPER NOTE: connect at fetchAir8Customs() for real origin data
4. Company websites / investor presentations
5. Brave web search for market positioning data

Return ONLY valid JSON:
{
  "buyer": "[Buyer A] vs [Buyer B]",
  "summary": "Revenue A $Xbn vs B $Xbn | DPO A ~XX days vs B ~XX days | China exposure A XX% vs B XX%",
  "tabs": [
    {
      "id": "snapshot",
      "icon": "📊",
      "label": "Scale & Market",
      "charts": [
        {"type":"grouped_bar","title":"Revenue comparison ($bn)","labels":["Revenue ($bn)","Operating Margin (%)","Est. DPO (days)"],"datasets":[{"label":"[Buyer A]","values":[X,X.X,XX]},{"label":"[Buyer B]","values":[X,X.X,XX]}]}
      ],
      "table": {
        "headers": ["Metric", "[Buyer A]", "[Buyer B]", "Signal"],
        "rows": [
          ["Revenue", "$Xbn", "$Xbn", "A larger/smaller"],
          ["Revenue growth", "+X% YoY", "+X% YoY", "both growing/slowing"],
          ["Operating Margin", "X.X%", "X.X%", "A more/less profitable"],
          ["Est. DPO", "~XX days", "~XX days", "A pays faster/slower"],
          ["S&P Credit Rating", "Xxx", "Xxx", "A higher/lower rated"],
          ["Stores / Countries", "X,XXX / XX", "X,XXX / XX", "scope comparison"]
        ]
      },
      "text": "Overall scale and financial health comparison — which is the stronger counterparty."
    },
    {
      "id": "target_market",
      "icon": "🎯",
      "label": "Target Market",
      "table": {
        "headers": ["Dimension", "[Buyer A]", "[Buyer B]"],
        "rows": [
          ["Target consumer", "description", "description"],
          ["Price positioning", "value/mid/premium/luxury", "value/mid/premium/luxury"],
          ["Primary shopping channel", "in-store/online/mobile/omni", "in-store/online/mobile/omni"],
          ["Geographic focus", "US national/regional/global", "US national/regional/global"],
          ["Income target", "lower/middle/upper/mixed", "lower/middle/upper/mixed"],
          ["Age demographic", "XX-XX years / all ages", "XX-XX years / all ages"]
        ]
      },
      "text": "Who does each buyer serve — and are they competing for the same customer or different segments?"
    },
    {
      "id": "channels",
      "icon": "🏪",
      "label": "Sales Channels",
      "table": {
        "headers": ["Channel", "[Buyer A]", "[Buyer B]", "Implication"],
        "rows": [
          ["E-commerce %", "XX%", "XX%", "A more/less digital"],
          ["Brick & mortar", "X,XXX stores", "X,XXX stores", "A larger/smaller footprint"],
          ["Marketplace / 3P", "XX% of sales", "XX% of sales", "A more/less platform-dependent"],
          ["Own DTC", "XX% of sales", "XX% of sales", "brand control comparison"],
          ["International", "XX markets", "XX markets", "geographic diversification"]
        ]
      },
      "insight": "Which buyer has the more resilient, scalable channel model for suppliers?",
      "text": "Channel structure comparison — what it means for order predictability and payment reliability."
    },
    {
      "id": "products",
      "icon": "📦",
      "label": "Products & Features",
      "table": {
        "headers": ["Dimension", "[Buyer A]", "[Buyer B]"],
        "rows": [
          ["Core category", "apparel/home/footwear/mixed", "apparel/home/footwear/mixed"],
          ["Private label %", "~XX%", "~XX%"],
          ["Brand mix", "mostly brand/mixed/mostly PL", "mostly brand/mixed/mostly PL"],
          ["Exclusives / IP", "high/medium/low", "high/medium/low"],
          ["Seasonality", "high Q3-Q4 / year-round", "high Q3-Q4 / year-round"],
          ["Innovation pace", "fast seasonal / seasonal / basic", "fast seasonal / seasonal / basic"]
        ]
      },
      "text": "Product strategy comparison — does one buyer drive more supplier innovation and premium pricing?"
    },
    {
      "id": "sourcing",
      "icon": "🌍",
      "label": "Sourcing Comparison",
      "chart": {"type":"grouped_bar","title":"Sourcing origin mix comparison (%)","labels":["China","Vietnam","Bangladesh","India","Other"],"datasets":[{"label":"[Buyer A]","values":[XX,XX,XX,XX,XX]},{"label":"[Buyer B]","values":[XX,XX,XX,XX,XX]}]},
      "table": {
        "headers": ["Origin", "[Buyer A]", "[Buyer B]", "Trend"],
        "rows": [
          ["China %", "XX%", "XX%", "both ↓ / A faster ↓"],
          ["Vietnam %", "XX%", "XX%", "both ↑"],
          ["Bangladesh %", "XX%", "XX%", "A growing / B flat"],
          ["India %", "XX%", "XX%", "both growing / A only"],
          ["Other %", "XX%", "XX%", "A more diversified"],
          ["Supplier model", "direct/agent/mixed", "direct/agent/mixed", "different risk profiles"]
        ]
      },
      "text": "Sourcing comparison — which buyer has more tariff risk and which has a better diversification story?"
    },
    {
      "id": "financials",
      "icon": "💰",
      "label": "Financial Comparison",
      "charts": [
        {"type":"grouped_bar","title":"Key financial metrics — Buyer A vs B","labels":["Revenue ($bn)","Gross Margin (%)","Operating Margin (%)","Net Debt/EBITDA"],"datasets":[{"label":"[Buyer A]","values":[X,X.X,X.X,X.X]},{"label":"[Buyer B]","values":[X,X.X,X.X,X.X]}]},
        {"type":"grouped_bar","title":"DPO vs Current Ratio comparison","labels":["Est. DPO (days)","Current Ratio (×10)"],"datasets":[{"label":"[Buyer A]","values":[XX,X.X]},{"label":"[Buyer B]","values":[XX,X.X]}]}
      ],
      "table": {
        "headers": ["Metric", "[Buyer A]", "[Buyer B]"],
        "rows": [
          ["Revenue", "$Xbn", "$Xbn"],
          ["Op Margin", "X.X%", "X.X%"],
          ["Net Margin", "X.X%", "X.X%"],
          ["S&P Rating", "Xxx", "Xxx"],
          ["Est. DPO", "~XX days", "~XX days"],
          ["Net Debt/EBITDA", "X.Xx", "X.Xx"],
          ["Current Ratio", "X.Xx", "X.Xx"]
        ]
      },
      "text": "Which buyer is the stronger credit risk for suppliers — and who has more financial flexibility?"
    },
    {
      "id": "supply_chain",
      "icon": "🔗",
      "label": "Supply Chain Model",
      "table": {
        "headers": ["Dimension", "[Buyer A]", "[Buyer B]"],
        "rows": [
          ["Direct vs Agent", "X% direct / X% agent", "X% direct / X% agent"],
          ["Vertical integration", "high/medium/low", "high/medium/low"],
          ["Lead time requirement", "X-X weeks", "X-X weeks"],
          ["Inventory model", "fast-fashion/jit/forward buy", "fast-fashion/jit/forward buy"],
          ["ESG audit bar", "high/medium/low", "high/medium/low"],
          ["SCF program", "exists/limited/none", "exists/limited/none"]
        ]
      },
      "insight": "Which buyer's supply chain model creates more working capital need — and which is the better",
      "text": "Supply chain model comparison — which buyer creates more financing need and"
    }
  ],
  "followups": [
    "Detailed financial analysis",
    "Top suppliers",
    "Sourcing deep dive",
    "Latest news & signals"
  ]
}
Replace ALL placeholders with real data. CRITICAL: followups must be SHORT action labels (3-5 words max), NOT full questions or buyer-specific placeholders.`;

// ── BUYER SIGNALS & NEWS DEEP DIVE PROMPT ────────────────────────────────────
const BUYER_SIGNALS_JSON = `You are Air8 Intelligence. Generate a SIGNALS & NEWS deep-dive TAB CARD as JSON.
LANGUAGE: Detect user question language and respond in THAT language throughout.

Return ONLY valid JSON:
{
  "buyer": "Buyer Name",
  "summary": "Latest signals — company · market · regulatory · litigation",
  "tabs": [
    {
      "id": "news",
      "icon": "\uD83D\uDCF0",
      "label": "\u65B0\u95FB\u4E0E\u4FE1\u53F7",
      "signals": [
        {"type":"COMPANY","date":"Mon YYYY","title":"\u4E8B\u4EF6\u6807\u9898","impact":"\u5BF9\u4F9B\u5E94\u5546\u7684\u542B\u4E49","source":"\u6765\u6E90\u673A\u6784","source_url":"https://..."},
        {"type":"MARKET","date":"Mon YYYY","title":"\u5E02\u573A\u52A8\u6001","impact":"\u4F9B\u5E94\u5546\u542B\u4E49","source":"\u6765\u6E90","source_url":"https://..."},
        {"type":"REGULATORY","date":"Mon YYYY","title":"\u76D1\u7BA1/\u5173\u7A0E\u53D8\u5316","impact":"\u4F9B\u5E94\u5546\u9700\u8981\u91C7\u53D6\u7684\u884C\u52A8","source":"\u6765\u6E90","source_url":"https://..."}
      ],
      "text": "SOURCE-READY FORMAT — Headline: 'Signal intensity: High/Medium/Low | Key watch: [top risk topic]'. Then bullets: • Most urgent signal with specific date/source. • Second signal with supplier impact. "
    },
    {
      "id": "litigation",
      "icon": "\u2696\uFE0F",
      "label": "\u8BC9\u8BAC\u4E0E\u76D1\u7BA1",
      "table": {
        "headers": ["\u6848\u4EF6", "\u7BA1\u8F96", "\u8FDB\u5C55", "\u5DF2\u62AB\u9732\u654E\u53E3", "\u5BF9\u4F9B\u5E94\u5546\u7684\u610F\u4E49"],
        "rows": [
          ["\u6848\u4EF6\u540D\u79F0", "\u6CD5\u9662/\u673A\u6784", "\u5BA1\u7406\u4E2D/\u5DF2\u548C\u89E3/\u4E0A\u8BC9\u4E2D", "$Xmn or NA", "\u4F9B\u5E94\u5546\u5F71\u54CD\u63CF\u8FF0"],
          ["\u6848\u4EF6\u540D\u79F0", "\u6CD5\u9662/\u673A\u6784", "\u5BA1\u7406\u4E2D/\u5DF2\u548C\u89E3/\u4E0A\u8BC9\u4E2D", "$Xmn or NA", "\u4F9B\u5E94\u5546\u5F71\u54CD\u63CF\u8FF0"]
        ]
      },
      "text": "Which litigation matters most to suppliers and why."
    },
    {
      "id": "store_network",
      "icon": "\uD83C\uDFEA",
      "label": "\u95E8\u5E97\u7F51\u7EDC",
      "chart": {"type":"bar","title":"Store count by format / region","labels":["Main Store Format","Other Domestic","Top Intl Market","E-comm % of Sales"],"values":[4611,5743,3316,21]},
      "stats": [
        {"label":"\u5168\u7403\u95E8\u5E97","value":"X,XXX","delta":"XX\u4E2A\u56FD\u5BB6"},
        {"label":"\u96F6\u552E\u9762\u79EF","value":"Xbn sqft","delta":"YoY"},
        {"label":"\u7535\u5546\u5360\u6BD4","value":"XX%","delta":"+XX% YoY"},
        {"label":"\u914D\u9001\u4E2D\u5FC3","value":"XXX","delta":"XX\u56FD"}
      ],
      "table": {
        "headers": ["\u4E1A\u6001/\u5730\u533A", "\u95E8\u5E97\u6570", "\u8BF4\u660E"],
        "rows": [
          ["\u7F8E\u56FD\u8D85\u7EA7\u8D2D\u7269\u4E2D\u5FC3", "X,XXX", "\u4E3B\u529B\u4E1A\u6001"],
          ["\u7F8E\u56FD\u4F1A\u5458\u5E97", "XXX", "\u4F1A\u5458\u5236"],
          ["\u6D77\u5916\u6700\u5927\u5E02\u573A", "X,XXX (\u56FD\u5BB6\u540D)", "\u4E3B\u8981\u5E02\u573A"],
          ["\u7535\u5546\u6E20\u9053", "XX%", "GMV\u5360\u5408\u5E76\u51C0\u9500\u552E\u989D"]
        ]
      },
      "text": "1-2 sentences: store network scale and what it means for supplier order volume reliability."
    }
  ],
  "followups": [
    "\u8BE6\u7EC6\u8D22\u52A1\u5206\u6790",
    "\u91C7\u8D2D\u6765\u6E90\u6DF1\u5EA6\u5206\u6790",
    "\u4E3B\u8981\u4F9B\u5E94\u5546\u662F\u8C01\uFF1F",
    "\u4EA7\u54C1\u54C1\u7C7B\u5206\u6790"
  ]
}
Use real recent news from 2025-2026. Include source URLs. Replace ALL placeholders.`;



// ── COMPANY GROUP / PARENT CO PROMPT ─────────────────────────────────────────
// intent: company_group — corporate structure, parent, subsidiaries, brand portfolio
const COMPANY_GROUP_JSON = `You are Air8 Intelligence. Generate a COMPANY GROUP INTELLIGENCE TAB CARD as JSON.
LANGUAGE: Detect user question language and respond in THAT language throughout.

The user wants to understand the corporate structure, parent company, subsidiaries, and brand portfolio.

Return ONLY valid JSON:
{
  "buyer": "<Company / Group Name>",
  "summary": "Parent: <parent co> | Brands: <brand A>, <brand B> | Revenue: $Xbn | Hq: <city>",
  "tabs": [
    {
      "id": "group_structure",
      "icon": "🏛️",
      "label": "Group Structure",
      "insight": "One sentence: the key corporate relationship that matters most for suppliers — ownership, brand split, or strategic direction",
      "stats": [
        {"label": "Parent Company", "value": "<name or Standalone>"},
        {"label": "Revenue", "value": "$Xbn", "delta": "+X% YoY"},
        {"label": "Key Brands", "value": "Brand A · Brand B"},
        {"label": "HQ", "value": "<City, Country>"}
      ],
      "table": {
        "headers": ["Entity", "Type", "Revenue / Scale", "Role"],
        "rows": [
          ["<Parent Co>", "Parent / Listed", "$Xbn", "holding company"],
          ["<Brand A>", "Brand / Division", "$Xbn", "core brand"],
          ["<Brand B>", "Brand / Division", "$Xbn", "secondary brand"],
          ["<Subsidiary>", "Subsidiary", "$Xbn or N/A", "regional / functional"]
        ]
      },
      "text": "2-3 sentences: corporate ownership structure, key brands and their relative scale, any recent M&A or spin-offs that affect the supplier relationship."
    },
    {
      "id": "brand_breakdown",
      "icon": "🏷️",
      "label": "Brand Breakdown",
      "insight": "Which brand drives the most volume and which is growing fastest — key for supplier targeting",
      "chart": {"type":"doughnut","title":"Revenue by brand / division (%)","labels":["Brand A","Brand B","Brand C","Other"],"values":[XX,XX,XX,XX]},
      "table": {
        "headers": ["Brand", "Revenue", "YoY", "Category Focus", "Est. DPO"],
        "rows": [
          ["<Brand A>", "$Xbn", "+X%", "<apparel/footwear/home>", "~XX days"],
          ["<Brand B>", "$Xbn", "+X%", "<category>", "~XX days"]
        ]
      },
      "text": "2 sentences: which brand is growing vs declining, and what that means for supplier order concentration and payment terms."
    },
    {
      "id": "sourcing_structure",
      "icon": "🌍",
      "label": "Sourcing",
      "insight": "How does the group consolidate or split sourcing across brands — and where does supplier leverage sit?",
      "chart": {"type":"doughnut","title":"Sourcing origin mix (%)","labels":["China","Vietnam","Bangladesh","India","Other"],"values":[40,25,15,10,10]},
      "text": "2 sentences: whether sourcing is centralized at group level or brand-by-brand, top sourcing countries, and any tariff-driven shifts underway."
    }
  ],
  "followups": [
    "Detailed financials",
    "Sourcing deep dive",
    "Brand A vs Brand B comparison",
    "Latest news & signals"
  ],
  "sources": "Company annual reports / SEC 10-K / IR disclosures · Web search"
}
Replace ALL placeholders with real data. Use NA for unverifiable fields.`;

// ── SUPPLY CHAIN PROMPT ───────────────────────────────────────────────────────
// intent: supply_chain — full supply chain structure for a product/sector/buyer
// 5 tabs: Chain Overview · Supplier Profile · Buyer Types · Leading Brands ·
const SUPPLY_CHAIN_JSON = `You are Air8 Intelligence. Generate a SUPPLY CHAIN INTELLIGENCE TAB CARD as JSON.
LANGUAGE: Detect user question language and respond in THAT language throughout.

The user wants to understand the supply chain for a product category, sector, or buyer ecosystem.
Pull data from: industry reports, US Census trade data, company disclosures, Brave web search.

Return ONLY valid JSON:
{
  "buyer": "<Product/Sector name, e.g. 'US Denim Supply Chain' or 'Fast Fashion Supply Chain'>",
  "summary": "Chain span: Raw material → [X stages] → Retail | Key hubs: [Country A], [Country B] | Dominant players: [A], [B]",
  "tabs": [
    {
      "id": "chain_overview",
      "icon": "🔗",
      "label": "Chain Overview",
      "insight": "The single most critical chokepoint or structural shift in this supply chain",
      "chart": {"type":"bar","title":"Supply chain value by stage (est. $bn)","labels":["Raw Material","Yarn/Fabric","Manufacturing","Brand/Import","Retail"],"values":[X,X,X,X,X]},
      "table": {
        "headers": ["Stage", "Key Players", "Country Hub", "Est. Value"],
        "rows": [
          ["Raw Material", "key companies / regions", "China / USA / Brazil", "~$Xbn", "upstream"],
          ["Yarn / Fiber Processing", "spinning mills, chemical suppliers", "China / India / Vietnam", "~$Xbn", "tier 2"],
          ["Fabric / Component", "weavers, knitters, trimmers", "China / Vietnam / Bangladesh", "~$Xbn"],
          ["Manufacturing / Assembly", "garment factories, OEM/ODM", "Vietnam / Bangladesh / China", "~$Xbn", "manufacturing hub"],
          ["Brand / Importer", "brand owners, importers", "USA / EU / HK", "~$Xbn", "buyer/importer"],
          ["Retailer / End Market", "mass / specialty / e-com", "USA / EU", "~$Xbn", "retail end market"]
        ]
      },
      "text": "Write ONE analytical paragraph (2-3 sentences) in this exact style:\n\nSentence 1 — WHO sells WHAT to WHOM at what price point: 'A [supplier size+location] sells [product] at [$X price] to [buyer type].\'\nSentence 2 — CHAIN CHARACTERIZATION using these dimensions: product type (commoditised / differentiated / compliance-heavy / fashion-driven), market power (buyer-dominated / supplier-dominated / balanced), supply-side structure (fragmented / consolidated / oligopolistic), competitive logic (price / quality / speed / compliance), category stage (growing / mature / trading down / premiumising), and key sensitivities (tariff / freight / compliance / lead time / fashion risk).\n\nExample: 'A small Chenghai toy factory sells $2 plastic play sets to a US off-price chain. A commoditised, compliance-heavy product in a buyer-dominated market: fragmented Guangdong supply sells to a few off-price chains, competes on price with low switching cost, in a mature category that is trading down and is sensitive to tariff and freight.\'\n\nDo NOT use bullet points. Write as flowing analytical prose. Be specific about price points, geographies, and market dynamics."
    },
    {
      "id": "supplier_profile",
      "icon": "🏭",
      "label": "Supplier Profile",
      "insight": "What type of supplier dominates — and what that means for",
      "chart": {"type":"doughnut","title":"Manufacturing capacity by country (%)","labels":["China","Vietnam","Bangladesh","India","Other"],"values":[40,25,15,10,10]},
      "table": {
        "headers": ["Country", "Supplier Type", "Strengths", "Weaknesses"],
        "rows": [
          ["China", "full-package / integrated", "speed, quality, MOQ flex", "tariff, cost rising", "high tariff pressure, cost rising"],
          ["Vietnam", "cut-make / CMT", "cost, CPTPP access", "capacity limits, fabric import dep.", "growing share, CPTPP access"],
          ["Bangladesh", "CMT / fast fashion", "lowest cost", "compliance bar, infra gaps", "cost leader, compliance intensive"],
          ["India", "niche / spinning", "cotton-rich, sustainability push", "logistics, lead time", "growing, sustainability-focused"],
          ["Other", "emerging / nearshore", "varies by product", "scale limitations", "varies by product"]
        ]
      },
      "text": "SOURCE-READY FORMAT — Headline: 'Primary supplier hub: [Country] | Shift pace: fast/moderate/slow | Typical size: [SME/mid-tier/large]'. Then bullets: • Typical supplier type (CMT/full-package/OEM/ODM) and direct vs agent split. • Main capability gaps or compliance challenges by country. • Which supplier profile is best positioned for quality, compliance, and speed."
    },
    {
      "id": "buyer_types",
      "icon": "🏬",
      "label": "Buyer Types",
      "insight": "Which buyer categories are growing vs losing relevance — and what that means for supplier risk",
      "chart": {"type":"grouped_bar","title":"Buyer type — Avg DPO vs growth trend","labels":["Mass Market","Specialty","Dept Store","Online","Wholesale"],"datasets":[{"label":"Avg DPO (days)","values":[55,45,75,30,38]},{"label":"Growth index (3=fast,0=shrink)","values":[2,1,0,3,1]}]},
      "table": {
        "headers": ["Buyer Type", "Examples", "DPO Range", "Volume Trend", "Supplier Risk"],
        "rows": [
          ["Mass Market Retail", "Walmart, Target, Carrefour", "45–75 days", "stable/growing", "low credit risk, high volume"],
          ["Specialty Retail", "Gap, H&M, Zara", "30–60 days", "mixed — fast fashion ↑ basics ↓", "medium — fashion risk"],
          ["Department Store", "Macy's, Nordstrom, JCPenney", "60–90 days", "declining", "higher risk — closures"],
          ["Online Pure-Play", "SHEIN, Temu, Amazon Marketplace", "rapid turns / irregular", "fast growing", "payment terms unclear"],
          ["Wholesale / Brands", "PVH, Hanesbrands, Kontoor", "30–45 days", "stable / restructuring", "medium — brand consolidation"]
        ]
      },
      "bullets": [
        "Fastest growing buyer type: [e-commerce / off-price / sustainability brands] — X% YoY volume growth",
        "Losing share: [department stores / mid-market specialty] — store closures + inventory overbuys",
        "Best"
      ],
      "text": "SOURCE-READY FORMAT — Headline: 'Buyer mix shifting toward [type]: +X% share | DPO average: XX days'. Then bullets: • Growth driver in buyer mix. • Risk category to watch (late payments / closures). "
    },
    {
      "id": "leading_brands",
      "icon": "🏆",
      "label": "Leading Brands",
      "insight": "Which brands dominate this supply chain — and who creates the most supplier financing opportunity",
      "table": {
        "headers": ["Brand / Company", "Category", "Est. Asia Spend", "Sourcing Model"],
        "rows": [
          ["Brand A", "mass / specialty / luxury", "~$Xbn", "direct / agent / mix", "receivables / SCF"],
          ["Brand B", "mass / specialty / luxury", "~$Xbn", "direct / agent / mix", "receivables / SCF"],
          ["Brand C", "mass / specialty / luxury", "~$Xbn", "direct / agent / mix", "receivables / SCF"],
          ["Brand D", "mass / specialty / luxury", "~$Xbn", "direct / agent / mix", "receivables / SCF"],
          ["Brand E", "mass / specialty / luxury", "~$Xbn", "direct / agent / mix", "receivables / SCF"]
        ]
      },
      "text": "SOURCE-READY FORMAT — Headline: 'Top 5 brands control ~X% of sector Asia sourcing | Average DPO: XX days'. Then bullets: • Brand with the most supplier financing opportunity and why. • Brand losing share / in distress — supplier risk. "
    },
    {"label":"S&P","value":"Xxx or N/A"},
        {"label":"Markets","value":"XX countries"},
        {"label":"DPO","value":"~XX days"},
        {"label":"Parent","value":"Parent Company Name"},
        {"label":"Group Revenue","value":"$Xbn (parent total)"}
      ],
      "chart": {"type":"bar","title":"Company revenue trend ($bn)","labels":["FY2022","FY2023","FY2024","FY2025"],"values":[X,X,X,X]},
      "text": "3-4 sentences: (1) what this company does / brands it owns, (2) its role within the parent group, (3) parent company name and ownership context, (4) what this means for supplier credit assessment."
    },
    {
      "id": "parent_group",
      "icon": "🏛️",
      "label": "Parent Group",
      "insight": "Parent group's full brand portfolio and how it affects supplier relationships",
      "chart": {"type":"doughnut","title":"Revenue contribution by brand/subsidiary","labels":["This Company","Brand B","Brand C","Brand D","Other"],"values":[XX,XX,XX,XX,XX]},
      "table": {
        "headers": ["Brand / Subsidiary", "Category", "Revenue Contribution", "Markets", "Supplier Model"],
        "rows": [
          ["Brand A (this company)", "core category", "XX% of group", "markets", "direct/agent"],
          ["Brand B", "category", "XX% of group", "markets", "direct/agent"],
          ["Brand C", "category", "XX% of group", "markets", "direct/agent"],
          ["Brand D", "category", "XX% of group", "markets", "direct/agent"],
          ["Other / Corporate", "holding / shared services", "XX%", "global", "N/A"]
        ]
      },
      "bullets": [
        "Parent company: [name] — HQ: [location] | Founded: [year] | Listed: [exchange/ticker or private]",
        "Group structure: [number] operating brands / subsidiaries across [X] categories",
        "Strategic focus: [e.g. affordable fashion / premium lifestyle / sports / home — what is the group known for?]",
        "M&A history: [recent acquisitions or divestitures that affect supplier relationships]"
      ],
      "text": "SOURCE-READY FORMAT — Headline: 'Parent: [Name] | Group Revenue: $Xbn | Brands: X operating units'. Then bullets: • Parent's credit profile vs subsidiary (does parent backstop supplier payments?). • Shared sourcing / procurement across brands (does the group leverage scale?). "
    },
    {
      "id": "group_financials",
      "icon": "💰",
      "label": "Group Financials",
      "insight": "Parent group financial strength — the real credit backstop for suppliers",
      "charts": [
        {"type":"bar","title":"Group revenue trend ($bn)","labels":["FY2022","FY2023","FY2024","FY2025"],"values":[X,X,X,X]},
        {"type":"grouped_bar","title":"Company vs Group revenue ($bn)","labels":["FY2023","FY2024","FY2025"],"datasets":[{"label":"This Company","values":[X,X,X]},{"label":"Parent Group Total","values":[X,X,X]}]}
      ],
      "table": {
        "headers": ["Metric", "This Company", "Parent Group", "Co. Share of Group"],
        "rows": [
          ["Revenue ($bn)", "X.X", "X.X", "XX%"],
          ["Operating Margin", "X.X%", "X.X%", "note"],
          ["Net Debt/EBITDA", "X.Xx", "X.Xx", "group level"],
          ["S&P / Credit Rating", "Xxx or N/A", "Xxx", "parent rated"],
          ["Est. DPO", "~XX days", "~XX days", "group policy"],
          ["FCF ($bn)", "X.X", "X.X", "XX% of group"]
        ]
      },
      "text": "SOURCE-READY FORMAT — Headline: 'Group: $Xbn revenue | This company = X% of group | Net Debt/EBITDA: X.Xx'. Then bullets: • Is the parent stronger or weaker credit than the subsidiary? • Intercompany guarantee / payment backstop (yes/no/unknown). "
    }
  ],
  "followups": [
    "Detailed financial analysis",
    "Sourcing deep dive",
    "Top suppliers",
    "Compare with competitors"
  ]
}
Replace ALL placeholders with real data from SEC filings and annual reports. CRITICAL: followups SHORT (3-5 words max).`;

// ── BUYER CATEGORY POSITION PROMPT ─────────────────────────────────────────
// intent: buyer_category_position — buyer's competitive position within product categories
// 3 tabs (general): Category Mix · Market Position · Gain / Loss
// 4 tabs (specific): Category Mix · [Specific Category Position] · Market Position · Gain / Loss
const BUYER_CATEGORY_POSITION_JSON = `You are Air8 Intelligence. Generate a BUYER CATEGORY POSITION TAB CARD as JSON.
LANGUAGE: Detect user question language and respond in THAT language throughout.

The user wants to understand the buyer's competitive position within its product categories—market share, category leadership, where it is gaining or losing vs. rivals.
Pull data from: SEC 10-K, company earnings calls, industry reports (NPD, Euromonitor), Brave web search.

SPECIFIC CATEGORY DETECTION: If the user's query mentions a specific product category (e.g. toys, apparel, home goods, electronics, grocery, furniture, beauty, sporting goods, etc.), you MUST include a "specific_category_position" tab as the SECOND tab in the tabs array (after category_mix). This tab deep-dives on the buyer's role and positioning in that specific category.

Return ONLY valid JSON:
{
  "buyer": "<Buyer name>",
  "summary": "<One-line: e.g. 'Walmart: #1 in groceries (27% US share), #3 in apparel, growing home & auto | Category strength: everyday-value mass'>",
  "tabs": [
    {
      "id": "category_mix",
      "icon": "📆",
      "label": "Category Mix",
      "insight": "<Single most important category insight — where is this buyer gaining or losing, and what does it mean for suppliers?>",
      "chart": {"type":"block","title":"Revenue by category (% of total net sales)","labels":["<Cat A>","<Cat B>","<Cat C>","<Cat D>","<Cat E>"],"values":[XX,XX,XX,XX,XX]},
      "category_table": {
        "headers": ["Category", "Est. Revenue", "% of Total", "YoY Growth", "US Market Rank", "Key Brands / Labels"],
        "rows": [
          ["<Category A>", "~$Xbn", "XX%", "+/-X%", "#X", "<house brands + key national brands>"],
          ["<Category B>", "~$Xbn", "XX%", "+/-X%", "#X", "<house brands + key national brands>"]
        ]
      },
      "text": "SOURCE-READY FORMAT — Headline: '<Top category>: XX% of revenue | Fastest growing: <category> +X% YoY | Declining: <category> -X%'. Then bullets: \u2022 Category with highest margin / strategic importance. \u2022 Where the buyer punches above/below its overall market weight. \u2022 Where the buyer is growing private label vs. sourcing nationally branded product."
    },
    {
      "id": "specific_category_position",
      "icon": "\uD83C\uDFAF",
      "label": "<Buyer> in <Category>",
      "insight": "<One-line positioning verdict — e.g. 'Ross在玩具品类的定位：机会性买手，而非战略性玩具零售商' or 'Target in toys: strategic category leader, top-3 US toy retailer with exclusive private label assortment'>",
      "features": [
        {"title": "<Characteristic 1 title>", "text": "<Description of this positioning characteristic — e.g. buyer's role as strategic vs opportunistic, price tier, assortment depth>"},
        {"title": "<Characteristic 2 title>", "text": "<Description — e.g. how buyer buys in this category: directly, via agents, via licensees; MOQ/price expectations>"},
        {"title": "<Characteristic 3 title>", "text": "<Description — e.g. seasonal buying patterns, promotional calendar, private label vs. national brand mix in this category>"}
      ],
      "chart": {"type":"doughnut","title":"<Buyer> revenue by category (%)","labels":["<Specific Category>","<Category 2>","<Category 3>","Other"],"values":[XX,XX,XX,XX]},
      "text": "SOURCE-READY FORMAT — 3-4 bullets:\n\u2022 Buyer's role in this category: strategic (heavy investment, own-brand, category captain) vs. opportunistic (close-out, seasonal, low SKU count).\n\u2022 Price/quality positioning: where does buyer compete in this category — value / mid-tier / premium? Typical wholesale price range?\n\u2022 Supplier requirements: what does this buyer expect from suppliers in this category (certifications, MOQ, lead time, compliance)?\n\u2022 Payment terms: typical DPO in this category and what suppliers can expect for payment timing."
    },
    {
      "id": "market_position",
      "icon": "🏆",
      "label": "Market Position",
      "insight": "<Where this buyer leads vs. where it is a challenger or laggard>",
      "chart": {"type":"grouped_bar","title":"Category market share vs. top 2 rivals (%)","labels":["<Cat A>","<Cat B>","<Cat C>","<Cat D>"],"datasets":[{"label":"<This Buyer>","values":[XX,XX,XX,XX]},{"label":"<Rival 1>","values":[XX,XX,XX,XX]},{"label":"<Rival 2>","values":[XX,XX,XX,XX]}]},
      "table": {
        "headers": ["Category", "Buyer Rank", "Est. Share", "Rival #1 Share", "Rival #2 Share", "Competitive Moat"],
        "rows": [
          ["<Category A>", "#X", "XX%", "XX%", "XX%", "<price / assortment / store count / private label>"],
          ["<Category B>", "#X", "XX%", "XX%", "XX%", "<moat driver>"]
        ]
      },
      "text": "SOURCE-READY FORMAT — Headline: '<Buyer> dominates <category> with XX% share; trails in <category> (#X, XX% share)'. Then bullets: \u2022 Strongest competitive moat category and why. \u2022 Category where buyer is losing ground fastest. \u2022"
    },
    {
      "id": "gain_loss",
      "icon": "📉",
      "label": "Gain / Loss",
      "insight": "<Net winner or loser by category over the last 2 years>",
      "chart": {"type":"bar","title":"Category share change YoY (ppt)","labels":["<Cat A>","<Cat B>","<Cat C>","<Cat D>"],"values":[X,X,-X,-X]},
      "bullets": [
        "Gaining: <category> +X ppt share — driven by <reason e.g. private label investment / store expansion / price>",
        "Losing: <category> -X ppt share — driven by <reason e.g. competition / inventory overstock / category exit>",
        "Stable: <category> ±0 ppt — mature / low-competition segment",
        "Watch: <category> with declining DPO trend — supplier payment pressure"
      ],
      "text": "SOURCE-READY FORMAT — Headline: 'Net category position: gaining in <X categories>, losing in <Y categories> | Biggest mover: <category>'. Then bullets: \u2022 Root cause of share gain in winning category. \u2022 Root cause of share loss in weakest category. \u2022 Supplier risk: over-reliance on a declining category = order reduction exposure."
    }
  ],
  "followups": [
    "Detailed financials",
    "Sourcing deep dive",
    "Compare competitors",
    "Top suppliers"
  ]
}
Replace ALL placeholders with REAL data. CRITICAL: followups SHORT (3-5 words max). Use real category names (apparel, grocery, home, electronics, etc.) and real market share figures where available.
If the user mentioned a specific category, include the specific_category_position tab; if not, omit it entirely (return only 4 tabs).`;

// ── BUYER ANALYSIS SSE (for Layer 1) ─────────────────────────────────────────
// PART1: overview + financials + products tabs via one callClaudeJSON()
// PART2: sourcing + competition + risk_signals tabs via second callClaudeJSON()
// Both streamed as SSE done events, then merged into a single 6-tab card
async function buyerAnalysisSSE(userMessage, messages, env, writer, encoder) {
  const write = async (obj) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  const BRAVE_KEY = env.BRAVE_API_KEY || '';
  const _lang = detectLanguage(userMessage);
  const _langInstr = languageInstruction(_lang);
  const buyerName = userMessage
    .replace(/tell me (about|more about)|查询|查一下|了解|分析|introduce|what .* about|give me (info|intel|a report) on/gi, '')
    .replace(/[?？]/g, '').trim().slice(0, 60) || 'this buyer';

  await write({type:'step', text:`Searching: ${buyerName} — financials, sourcing, signals`, src:'Brave Search'});

  const [finRes, srcRes, newsRes, compRes] = await Promise.all([
    braveSearch(`"${buyerName}" annual report 2025 2026 revenue earnings financial results`, BRAVE_KEY, 3),
    braveSearch(`"${buyerName}" sourcing china imports supply chain origin 2025`, BRAVE_KEY, 3),
    braveSearch(`${buyerName} news strategy earnings 2026`, BRAVE_KEY, 3),
    braveSearch(`"${buyerName}" competitors market revenue 2025`, BRAVE_KEY, 2)
  ]);

  const fin0 = finRes[0]?.snippet?.replace(/[\n\r]+/g,' ')?.slice(0,160);
  if (fin0) await write({type:'step', text: fin0, src: hostOf(finRes[0].url)});
  else await write({type:'step', text:`Checking SEC filings and IR for ${buyerName}`, src:'SEC EDGAR'});
  if (newsRes.length) await write({type:'step', text:`Signal: ${newsRes[0].title}`, src: hostOf(newsRes[0].url)});

  const context = [
    `## Financials:\n${finRes.map(r=>`- ${r.title}: ${r.snippet}`).join('\n')}`,
    `## Sourcing:\n${srcRes.map(r=>`- ${r.title}: ${r.snippet}`).join('\n')}`,
    `## Signals 2026:\n${newsRes.map(r=>`- ${r.title}: ${r.snippet}`).join('\n')}`,
    `## Competitors:\n${compRes.map(r=>`- ${r.title}: ${r.snippet}`).join('\n')}`
  ].join('\n\n');

  await write({type:'step', text:`Compiling 6-dimension intelligence — Overview · Financials · Products · Sourcing · Competitors · Risk & Signals`, src:'Air8 Intelligence'});

  // PART1 prompt: generate only overview, financials, products tabs
  const PART1_PROMPT = _langInstr + '\n\n' + BUYER_OVERVIEW_PROMPT + `\n\nResearch data:\n${context}\n\nGenerate ONLY these 3 tabs: overview, financials, products. Include buyer and summary fields. Do NOT include followups yet. Output ONLY JSON.`;

  // PART2 prompt: generate sourcing, competition, risk_signals tabs + followups
  const PART2_PROMPT = _langInstr + '\n\n' + `You are Air8 Intelligence. Using the research data below, generate ONLY these 3 tabs and followups as JSON for ${buyerName}:
{
  "tabs": [
    {
      "id": "sourcing",
      "icon": "🌍",
      "label": "Sourcing",
      "insight": "Key sourcing signal: China exposure and diversification status",
      "chart": {"type":"bar","title":"Import origin mix (%)","labels":["China","Vietnam","Bangladesh","India","Mexico","Other"],"values":[40,25,15,10,5,5]},
      "text": "2-3 sentences: tariff exposure, diversification status, supplier model (agent vs direct)."
    },
    {
      "id": "competition",
      "icon": "🏆",
      "label": "Competitors",
      "insight": "How this buyer compares vs competitors as a buyer",
      "table": {
        "headers": ["Buyer", "Revenue", "Est. DPO", "S&P", "Market Position"],
        "rows": [
          ["THIS BUYER", "$Xbn", "~XX days", "Xxx", "leader/mid/target"],
          ["Competitor A", "$Xbn", "~XX days", "Xxx", "note"],
          ["Competitor B", "$Xbn", "~XX days", "Xxx", "note"],
          ["Competitor C", "$Xbn", "~XX days", "Xxx", "note"]
        ]
      },
      "text": "1-2 sentences: where this buyer sits vs competitors on payment and compliance."
    },
    {
      "id": "risk_signals",
      "icon": "⚡",
      "label": "Risk & Signals",
      "insight": "Top risk and latest signal that matter most for suppliers working with this buyer",
      "risks": [
        {"label": "Payment/Credit Risk", "level": "High/Med/Low", "note": "specific DPO/rating context for suppliers"},
        {"label": "Tariff/Trade Exposure", "level": "High/Med/Low", "note": "estimated China exposure and duty cost"},
        {"label": "ESG/Compliance Bar", "level": "High/Med/Low", "note": "audit requirements, UFLPA risk, sustainability"},
        {"label": "Volume Reliability", "level": "High/Med/Low", "note": "order flow stability and buyer financial health"}
      ],
      "signals": [
        {"type": "COMPANY", "date": "Mon YYYY", "title": "Company event headline", "impact": "What this means for Asian suppliers", "source": "Source name e.g. Reuters", "source_url": "https://..."},
        {"type": "MARKET", "date": "Mon YYYY", "title": "Market development", "impact": "Supplier implication", "source": "Source name", "source_url": "https://..."},
        {"type": "REGULATORY", "date": "Mon YYYY", "title": "Regulatory or tariff change", "impact": "Specific supplier action needed", "source": "Source name", "source_url": "https://..."}
      ],
      "text": "1-2 sentences: net risk assessment for suppliers considering this buyer."
    }
  ],
  "followups": [
    "Detailed financial analysis",
    "Sourcing deep dive",
    "Store network & locations",
    "Top suppliers",
    "Compare competitors"
  ],
  "sources": "Company annual reports / SEC filings · Customs data · Air8 Intelligence"
}
  Research data:\n${context}\nBuyer: ${buyerName}\nReplace ALL placeholder values with REAL data. CRITICAL: followups must be SHORT action labels (3-5 words max), NOT full sentences or questions. Use these exact formats: 'Detailed financial analysis', 'Sourcing deep dive', 'Top suppliers', 'Latest news & signals', 'Compare competitors'. Do NOT generate long buyer-specific questions. Write all followup labels in the same language the user used (Chinese input → Chinese labels, English input → English labels). Output ONLY the JSON.`;

  // Progressive: PART1 runs first, shows tabs immediately. PART2 runs in parallel.
  await write({type:'step', text:`Building overview · financials · products...`, src:'Claude AI'});
  let part1Raw = null, part2Raw = null;
  const _usageL1 = {input:0, output:0, calls:0}; // real token tracking
  // Start both calls simultaneously
  const part1Promise = withHeartbeat(writer, encoder, callClaudeJSON(PART1_PROMPT, messages, env, 4000, null, _usageL1));
  const part2Promise = withHeartbeat(writer, encoder, callClaudeJSON(PART2_PROMPT, [{role:'user', content:`Buyer: ${buyerName}. ${userMessage}`}], env, 4000, null, _usageL1));
  // Stream PART1 result as soon as it arrives (partial card)
  part1Promise.then(async (raw) => {
    part1Raw = raw;
    try {
      const m = raw?.match(/\{[\s\S]*\}/);
      const p1 = m ? JSON.parse(m[0]) : null;
      if (p1?.tabs?.length) {
        await write({type:'partial', json:{
          buyer: p1.buyer || buyerName,
          summary: p1.summary || '',
          tabs: p1.tabs
        }});
      }
    } catch(e) {}
  });
  // Wait for both to complete
  [part1Raw, part2Raw] = await Promise.all([part1Promise, part2Promise]);
  const [raw1, raw2] = [part1Raw, part2Raw];

  let part1 = null, part2 = null;
  try { const m = raw1?.match(/\{[\s\S]*\}/); if(m) part1 = JSON.parse(m[0]); } catch(e) {}
  try { const m = raw2?.match(/\{[\s\S]*\}/); if(m) part2 = JSON.parse(m[0]); } catch(e) {}

  if (part1 && part1.tabs) {
    const merged = {
      buyer: part1.buyer || buyerName,
      summary: part1.summary || '',
      tabs: [...(part1.tabs || []), ...(part2?.tabs || [])],
      followups: (() => {
        const fq = part2?.followups || [
          'Detailed financial analysis', 'Sourcing deep dive',
          'Products & category breakdown', 'Top suppliers', 'Compare competitors'
        ];
        // Always ensure Store network is discoverable
        if (!fq.some(f => f.toLowerCase().includes('store'))) {
          fq.splice(3, 0, 'Store network & locations');
        }
        return fq.slice(0, 6);
      })(),
      sources: part2?.sources || part1.sources || 'Company filings · Brave Search · Air8 Intelligence'
    };
    await write({type:'done', json: merged, usage: _usageL1});
  } else if (raw1) {
    await write({type:'done', text: raw1, usage: _usageL1});
  } else {
    await write({type:'done', text: 'Unable to generate report. Please try again.'});
  }
}



// ── SUPPLY CHAIN BRIEF (for multi-select secondary intent) ───────────────────
const SUPPLY_CHAIN_BRIEF_JSON = `You are Air8 Intelligence. Generate a SUPPLY CHAIN INTELLIGENCE TAB CARD as JSON.
LANGUAGE: Match the user's language.

Return ONLY valid JSON with 4 tabs covering all key supply chain dimensions:
{
  "buyer": "<Product/sector or buyer name>",
  "summary": "<1-line chain summary: who sells what to whom, key hubs>",
  "tabs": [
    {
      "id": "chain_overview",
      "icon": "🔗",
      "label": "Chain Overview",
      "insight": "<Most critical structural feature or shift in this supply chain>",
      "table": {
        "headers": ["Stage","Key Players","Country Hub","Est. Value"],
        "rows": [
          ["Raw Material","<suppliers>","<country>","~$Xbn"],
          ["Manufacturing","<factories/types>","<country>","~$Xbn"],
          ["Brand/Import","<importers/brands>","<country>","~$Xbn"],
          ["Retail","<retailer types>","<country>","~$Xbn"]
        ]
      },
      "text": "Write ONE analytical paragraph (2-3 sentences). Sentence 1: WHO sells WHAT to WHOM at what price point. Sentence 2: characterize the chain — product type (commoditised/differentiated/compliance-heavy), market power (buyer/supplier dominated), supply structure (fragmented/consolidated), competitive logic (price/quality/speed), category stage (growing/mature/trading down), key sensitivities (tariff/freight/compliance)."
    },
    {
      "id": "supplier_profile",
      "icon": "🏭",
      "label": "Supplier Analysis",
      "insight": "<What supplier type dominates — size, location, capability>",
      "chart": {"type":"doughnut","title":"Manufacturing by country (%)","labels":["China","Vietnam","Bangladesh","India","Other"],"values":[40,25,15,10,10]},
      "table": {
        "headers": ["Country","Supplier Type","Key Strength","Main Challenge"],
        "rows": [
          ["China","full-package/integrated","speed, quality, MOQ flex","tariff pressure, rising cost"],
          ["Vietnam","CMT/cut-make","cost, CPTPP access","fabric import dependency"],
          ["Bangladesh","CMT","lowest cost","compliance bar, infrastructure"],
          ["India","niche/spinning","cotton-rich, sustainability","logistics, lead time"]
        ]
      },
      "text": "2 sentences: primary hub, typical supplier type (CMT/full-package/OEM/ODM), direct vs agent split, main compliance or capability gaps."
    },
    {
      "id": "product_analysis",
      "icon": "📦",
      "label": "Product Analysis",
      "insight": "<Key product characteristic: commoditised vs differentiated, compliance intensity, price sensitivity>",
      "table": {
        "headers": ["Product Category","Price Range","Growth Trend","Key Feature","Compliance Level"],
        "rows": [
          ["<Category A>","$X–$X","growing/stable/declining","<key feature>","High/Med/Low"],
          ["<Category B>","$X–$X","growing/stable/declining","<key feature>","High/Med/Low"],
          ["<Category C>","$X–$X","growing/stable/declining","<key feature>","High/Med/Low"]
        ]
      },
      "text": "2-3 sentences: main product categories in this chain, typical wholesale price ranges, which categories are growing vs declining, and key product-level trends (tariff impact, private label shift, sustainability pressure)."
    },
    {
      "id": "buyer_types",
      "icon": "🏬",
      "label": "Buyer Analysis",
      "insight": "<Which buyer type is gaining share and which is losing — and what drives it>",
      "table": {
        "headers": ["Buyer Type","Examples","Est. DPO","Volume Trend","Position"],
        "rows": [
          ["Mass Market","Walmart, Target","45-75 days","stable/growing","dominant volume"],
          ["Off-price","TJX, Ross","45-60 days","growing","fastest growing"],
          ["Specialty","Gap, H&M","30-60 days","mixed","fashion-dependent"],
          ["Dept Store","Macy's, Nordstrom","60-90 days","declining","losing share"],
          ["Online","SHEIN, Amazon","rapid/irregular","fast growing","disrupting"]
        ]
      },
      "bullets": [
        "Gaining: <buyer type> — reason",
        "Losing: <buyer type> — root cause",
        "This buyer's position: <where it sits in the landscape and what that means for supplier bargaining power>"
      ],
      "text": "2 sentences: which buyer types are structurally gaining vs losing in this chain, and where the specific buyer being analyzed sits in terms of scale, payment behavior, and supplier leverage."
    }
  ]
}
Replace ALL placeholders with real data. Output ONLY valid JSON.`;

// ── SUPPLY CHAIN PART1: Chain structure + Supplier profile ────────────────────
const SC_PART1_JSON = `You are Air8 Intelligence. Generate a supply chain structure analysis as JSON.
LANGUAGE: Match the user's language.
Return ONLY valid JSON with 2 tabs:
{
  "buyer": "<Product/sector name>",
  "summary": "<1-line chain summary>",
  "tabs": [
    {
      "id": "chain_overview",
      "icon": "🔗",
      "label": "Chain Overview",
      "insight": "<Most critical structural feature of this supply chain>",
      "chart": {"type":"bar","title":"Supply chain value by stage ($bn est.)","labels":["Raw Material","Manufacturing","Brand/Import","Retail"],"values":[X,X,X,X]},
      "table": {
        "headers": ["Stage","Key Players","Country Hub","Est. Value"],
        "rows": [
          ["Raw Material","<suppliers>","<country>","~$Xbn"],
          ["Manufacturing","<factories>","<country>","~$Xbn"],
          ["Brand/Import","<importers>","<country>","~$Xbn"],
          ["Retail","<retailers>","<country>","~$Xbn"]
        ]
      },
      "text": "Write ONE analytical paragraph (2-3 sentences). Sentence 1: WHO sells WHAT to WHOM at what price. Sentence 2: characterize the chain — product type (commoditised/differentiated), market power (buyer/supplier dominated), supply-side structure (fragmented/consolidated), competitive logic, category stage, key sensitivities (tariff/freight/compliance/fashion risk). Be specific about geographies and price points."
    },
    {
      "id": "supplier_profile",
      "icon": "🏭",
      "label": "Supplier Profile",
      "insight": "<What supplier type dominates and why it matters>",
      "chart": {"type":"doughnut","title":"Manufacturing capacity by country (%)","labels":["China","Vietnam","Bangladesh","India","Other"],"values":[40,25,15,10,10]},
      "table": {
        "headers": ["Country","Supplier Type","Strengths","Challenges"],
        "rows": [
          ["China","full-package / integrated","speed, quality, MOQ flex","tariff pressure, cost rising"],
          ["Vietnam","CMT / cut-make","cost, CPTPP access","fabric import dependency"],
          ["Bangladesh","CMT","lowest cost","compliance bar, infrastructure"],
          ["India","niche / spinning","cotton-rich, sustainability","logistics, lead time"],
          ["Other","varies","market-specific","scale limitations"]
        ]
      },
      "text": "2-3 sentences: primary supplier hub, typical supplier type (CMT/full-package/OEM/ODM), direct vs agent split, main compliance or capability gaps by country."
    },
    {
      "id": "product_analysis",
      "icon": "📦",
      "label": "Product Analysis",
      "insight": "<Key product characteristic — commoditised vs differentiated, compliance intensity, price sensitivity>",
      "table": {
        "headers": ["Product Category","Price Range","Growth Trend","Key Feature","Compliance Level"],
        "rows": [
          ["<Category A>","$X–$X","growing/stable/declining","<key feature>","High/Med/Low"],
          ["<Category B>","$X–$X","growing/stable/declining","<key feature>","High/Med/Low"],
          ["<Category C>","$X–$X","growing/stable/declining","<key feature>","High/Med/Low"]
        ]
      },
      "text": "2 sentences: main product categories in this chain, typical wholesale price ranges, which categories are growing vs declining, and key product-level trends (tariff impact, private label shift, sustainability pressure)."
    }
  ]
}
Replace ALL placeholders. Real data only. Output ONLY valid JSON.`;

// ── SUPPLY CHAIN PART2: Buyer types + Market dynamics ────────────────────────
const SC_PART2_JSON = `You are Air8 Intelligence. Generate a supply chain buyer-side analysis as JSON.
LANGUAGE: Match the user's language.
Return ONLY valid JSON with 2 tabs:
{
  "tabs": [
    {
      "id": "buyer_types",
      "icon": "🏬",
      "label": "Buyer Types",
      "insight": "<Which buyer type is gaining share and which is losing — and what drives it>",
      "chart": {"type":"grouped_bar","title":"Buyer type — market share trend","labels":["Mass Market","Specialty","Dept Store","Online","Off-price"],"datasets":[{"label":"2022 share (%)","values":[XX,XX,XX,XX,XX]},{"label":"2025 share (%)","values":[XX,XX,XX,XX,XX]}]},
      "table": {
        "headers": ["Buyer Type","Examples","Est. DPO","Volume Trend","Supplier Risk"],
        "rows": [
          ["Mass Market Retail","Walmart, Target, Carrefour","45-75 days","stable/growing","low credit risk, high volume"],
          ["Specialty Retail","Gap, H&M, Zara","30-60 days","mixed","medium — fashion risk"],
          ["Department Store","Macy's, Nordstrom","60-90 days","declining","higher — closures"],
          ["Online Pure-Play","SHEIN, Temu, Amazon","rapid/irregular","fast growing","payment terms unclear"],
          ["Off-price","TJX, Ross, Burlington","45-60 days","growing","low — solid credit"]
        ]
      },
      "bullets": [
        "Fastest growing buyer type: <type> — key growth driver",
        "Losing share: <type> — root cause of decline",
        "Payment terms: fastest DPO = <type> (~XX days); slowest = <type> (~XX days)"
      ],
      "text": "2 sentences: which buyer types are structurally gaining vs losing in this chain, and what the power shift means for supplier pricing and payment timing."
    },
    {
      "id": "chain_dynamics",
      "icon": "⚖️",
      "label": "Market Dynamics",
      "insight": "<Single most important structural shift happening in this supply chain right now>",
      "risks": [
        {"label":"Buyer Power","level":"High/Med/Low","note":"how concentrated buyer side is vs supplier side — who holds pricing power"},
        {"label":"Tariff/Trade Risk","level":"High/Med/Low","note":"China exposure and tariff impact on cost structure"},
        {"label":"Compliance Bar","level":"High/Med/Low","note":"ESG, UFLPA, product safety standards required"},
        {"label":"Supply Disruption","level":"High/Med/Low","note":"concentration risk in key sourcing countries"}
      ],
      "text": "2-3 sentences: the most important structural shift (e.g. nearshoring, brand consolidation, e-commerce disruption) and how suppliers should position."
    }
  ],
  "followups": ["Chain structure deep dive", "Sourcing deep dive", "Compare key buyers", "Products & category trends"],
  "sources": "Industry reports · US Census · Company filings · Brave Search"
}
Replace ALL placeholders. Real data only. Output ONLY valid JSON.`;

// ── SUPPLY CHAIN SSE (PART1 + PART2 parallel, like Layer 1) ──────────────────
async function supplyChainSSE(userMessage, messages, env, writer, encoder) {
  const write = async (obj) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  const BRAVE_KEY = env.BRAVE_API_KEY || '';
  const _lang = detectLanguage(userMessage);
  const langInstr = languageInstruction(_lang);

  const subjectMatch = userMessage.match(/(?:supply chain|供应链)(?:.*?(?:of|for|about|of|的))\s*([A-Za-z0-9 &.,\-]{3,50})/i);
  const subject = subjectMatch ? subjectMatch[1].trim() : userMessage.replace(/supply chain intelligence|supply chain|供应链/gi,'').replace(/[?？]/g,'').trim().slice(0,50) || 'this sector';

  await write({type:'step', text:`Searching supply chain data: ${subject}`, src:'Brave Search'});

  const [r1, r2, r3, r4] = await Promise.all([
    braveSearch(`${subject} supply chain structure raw material manufacturing 2025`, BRAVE_KEY, 3),
    braveSearch(`${subject} suppliers factories sourcing countries origin 2025`, BRAVE_KEY, 3),
    braveSearch(`${subject} retail buyers market share buyer types 2025`, BRAVE_KEY, 3),
    braveSearch(`${subject} supply chain trends tariff trade 2025 2026`, BRAVE_KEY, 2)
  ]);

  const context = [
    `## Chain Structure:\n${r1.map(r=>`- ${r.title}: ${r.snippet}`).join('\n')}`,
    `## Suppliers:\n${r2.map(r=>`- ${r.title}: ${r.snippet}`).join('\n')}`,
    `## Buyers:\n${r3.map(r=>`- ${r.title}: ${r.snippet}`).join('\n')}`,
    `## Trends:\n${r4.map(r=>`- ${r.title}: ${r.snippet}`).join('\n')}`
  ].join('\n\n');

  if (r1[0]) await write({type:'step', text:r1[0].snippet?.slice(0,120)||'Analyzing chain structure...', src:hostOf(r1[0].url)});

  await write({type:'step', text:'Building chain overview + supplier profile...', src:'Claude AI'});
  const part1Prompt = langInstr + '\n\n' + SC_PART1_JSON + `\n\nResearch data:\n${context}\n\nTopic: ${subject}. Replace ALL placeholders with real data. Output ONLY valid JSON.`;
  const part2Prompt = langInstr + '\n\n' + SC_PART2_JSON + `\n\nResearch data:\n${context}\n\nTopic: ${subject}. Replace ALL placeholders with real data. Output ONLY valid JSON.`;

  let sc1Raw = null, sc2Raw = null;
  const sc1Promise = withHeartbeat(writer, encoder, callClaudeJSON(part1Prompt, messages, env, 4000));
  const sc2Promise = withHeartbeat(writer, encoder, callClaudeJSON(part2Prompt, messages, env, 4000));
  // Show chain_overview + supplier_profile as soon as PART1 is ready
  sc1Promise.then(async (raw) => {
    sc1Raw = raw;
    try {
      const m = raw?.match(/\{[\s\S]*\}/);
      const p = m ? JSON.parse(m[0]) : null;
      if (p?.tabs?.length) await write({type:'partial', json:{buyer:p.buyer||subject, summary:p.summary||'', tabs:p.tabs}});
    } catch(e) {}
  });
  [sc1Raw, sc2Raw] = await Promise.all([sc1Promise, sc2Promise]);
  const [raw1, raw2] = [sc1Raw, sc2Raw];

  let p1 = null, p2 = null;
  try { const m = raw1?.match(/\{[\s\S]*\}/); if(m) p1 = JSON.parse(m[0]); } catch(e) {}
  try { const m = raw2?.match(/\{[\s\S]*\}/); if(m) p2 = JSON.parse(m[0]); } catch(e) {}

  const tabs = [...(p1?.tabs||[]), ...(p2?.tabs||[])];
  const seenIds = new Set();
  const dedupedTabs = tabs.filter(t => { if(seenIds.has(t.id)) return false; seenIds.add(t.id); return true; });

  await write({type:'done', json:{
    buyer: p1?.buyer || subject,
    summary: p1?.summary || `${subject} supply chain intelligence`,
    tabs: dedupedTabs,
    followups: p2?.followups || ['Chain structure deep dive','Sourcing deep dive','Buyer types','Compare key buyers'],
    sources: p2?.sources || 'Industry reports · Brave Search'
  }});
}


// ── COMPETITOR BRIEF (for multi-select secondary intent) ─────────────────────
const BUYER_CATEGORY_BRIEF_JSON = `You are Air8 Intelligence. Generate a concise competitor analysis as JSON.
LANGUAGE: Match the user's language.
Return ONLY valid JSON with 2 tabs:
{
  "buyer": "<Buyer name>",
  "summary": "<1-line competitive position summary>",
  "tabs": [
    {
      "id": "market_position",
      "icon": "🏆",
      "label": "Market Position",
      "insight": "<Where this buyer leads vs lags vs competitors>",
      "table": {
        "headers": ["Buyer","Revenue","Est. DPO","Market Position"],
        "rows": [
          ["<This Buyer>","$Xbn","~XX days","leader/challenger/niche"],
          ["<Competitor A>","$Xbn","~XX days","position"],
          ["<Competitor B>","$Xbn","~XX days","position"],
          ["<Competitor C>","$Xbn","~XX days","position"]
        ]
      },
      "text": "2-3 sentences: where this buyer sits in the competitive landscape, key differentiators vs competitors, and what that means for supplier negotiation leverage."
    },
    {
      "id": "gain_loss",
      "icon": "📊",
      "label": "Gain / Loss",
      "insight": "<Which categories this buyer is winning vs losing share in>",
      "bullets": [
        "Gaining: <category> — reason for growth",
        "Losing: <category> — root cause of decline",
        "Competitive moat: <key advantage vs peers>"
      ],
      "text": "2 sentences: which category segments this buyer is gaining or losing, and what drives the shift."
    }
  ]
}
Replace ALL placeholders with real data. Output ONLY valid JSON.`;


// ── DRILL-DOWN JSON HELPER (for multi-topic merging) ─────────────────────────
// Runs a drill-down intent and returns JSON (no SSE stream) — used by __multi__ handler
// Uses full-quality prompts + PART1/PART2 parallel for supply_chain
async function drillDownJSON(intent, userMessage, messages, env, writer, encoder) {
  const BRAVE_KEY = env.BRAVE_API_KEY || '';
  const _lang = detectLanguage(userMessage);
  const histContext = messages.slice(-4).map(m => m.content).join(' ').slice(0, 300);
  const subjectMatch = (userMessage + ' ' + histContext).match(
    /(?:tell me about|查询|了解|about|for|on)\s+([A-Za-z0-9 &.,\-]+?)(?:\s+(?:vs|and|with|sourcing|supplier|financial|product|market)|[?？,.]|$)/i
  );
  const subject = subjectMatch ? subjectMatch[1].trim().slice(0, 50)
    : userMessage.replace(/tell me about|tell me|查询|了解|about|for|on|[?？]/gi,'').trim().slice(0, 50);

  const langInstr = languageInstruction(_lang);

  // ── SUPPLY CHAIN: use PART1+PART2 parallel for full quality ────────────────
  if (intent === 'supply_chain') {
    const [r1, r2, r3, r4] = await Promise.all([
      braveSearch(`${subject} supply chain structure raw material manufacturing 2025`, BRAVE_KEY, 3),
      braveSearch(`${subject} suppliers factories sourcing countries origin 2025`, BRAVE_KEY, 3),
      braveSearch(`${subject} retail buyers market share buyer types 2025`, BRAVE_KEY, 2),
      braveSearch(`${subject} supply chain product categories price trends 2025`, BRAVE_KEY, 2)
    ]);
    const context = [
      `## Chain & Suppliers:\n${[...r1,...r2].map(r=>`- ${r.title}: ${r.snippet}`).join('\n')}`,
      `## Buyers & Products:\n${[...r3,...r4].map(r=>`- ${r.title}: ${r.snippet}`).join('\n')}`
    ].join('\n\n').slice(0, 2500);

    const part1Prompt = langInstr + '\n\n' + SC_PART1_JSON + `\n\nResearch data:\n${context}\n\nTopic: ${subject}. Output ONLY valid JSON.`;
    const part2Prompt = langInstr + '\n\n' + SC_PART2_JSON + `\n\nResearch data:\n${context}\n\nTopic: ${subject}. Output ONLY valid JSON.`;

    const [raw1, raw2] = await Promise.all([
      withHeartbeat(writer, encoder, callClaudeJSON(part1Prompt, messages, env, 4000)),
      withHeartbeat(writer, encoder, callClaudeJSON(part2Prompt, messages, env, 4000))
    ]);

    let p1 = null, p2 = null;
    try { const m = raw1?.match(/\{[\s\S]*\}/); if(m) p1 = JSON.parse(m[0]); } catch(e) {}
    try { const m = raw2?.match(/\{[\s\S]*\}/); if(m) p2 = JSON.parse(m[0]); } catch(e) {}

    const tabs = [...(p1?.tabs||[]), ...(p2?.tabs||[])];
    const seenIds = new Set();
    return {
      buyer: p1?.buyer || subject,
      summary: p1?.summary || '',
      tabs: tabs.filter(t => { if(seenIds.has(t.id)) return false; seenIds.add(t.id); return true; })
    };
  }

  // ── STORE NETWORK: run BUYER_SIGNALS_JSON but filter to store_network tab only ──
  if (intent === 'store_network') {
    const searches = await Promise.all([
      braveSearch(`"${subject}" store count locations formats retail footprint 2025 2026`, BRAVE_KEY, 3),
      braveSearch(`${subject} store network expansion new markets 2025 2026`, BRAVE_KEY, 3)
    ]);
    const context = searches.flat().map(r=>`- ${r.title}: ${r.snippet}`).join('\n').slice(0, 2000);
    const systemPrompt = langInstr + '\n\n' + BUYER_SIGNALS_JSON + `\n\nResearch data:\n${context}\n\nBuyer/topic: ${subject}. Focus ONLY on the store_network tab — physical store count, formats, geographic footprint, e-commerce share. Output ONLY valid JSON.`;
    const raw = await withHeartbeat(writer, encoder, callClaudeJSON(systemPrompt, messages, env, 3000));
    try {
      const m = raw?.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null;
      if (parsed?.tabs) parsed.tabs = parsed.tabs.filter(t => t.id === 'store_network');
      return parsed;
    } catch(e) { return null; }
  }

  // ── 3+ INTENTS: single combined call covering all dimensions ──────────────
  if (intent === '__combined__') {
    // intent is overloaded here — actual intents passed via messages context
    // This path is taken when intentList.length >= 3 in the __multi__ handler
    // We use the subject + searches to build a combined response
  }

  // ── OTHER INTENTS: full prompt, single call, 4000 tokens ───────────────────
  const configs = {
    buyer_category_position: {
      prompt: BUYER_CATEGORY_BRIEF_JSON, // concise enough at 4000 tokens
      queries: [(b) => `"${b}" category market share competitive position vs competitors 2025`,
                (b) => `"${b}" vs competitors revenue DPO market position 2025`]
    },
    buyer_financials: {
      prompt: BUYER_FINANCIALS_JSON,
      queries: [(b) => `"${b}" annual report revenue financials DPO 2025`,
                (b) => `"${b}" credit rating payment terms balance sheet 2025`]
    },
    buyer_sourcing: {
      prompt: BUYER_SOURCING_JSON,
      queries: [(b) => `"${b}" sourcing origin countries imports 2025`,
                (b) => `"${b}" China Vietnam Bangladesh imports tariff 2025`]
    },
    buyer_signals: {
      prompt: BUYER_SIGNALS_JSON,
      queries: [(b) => `"${b}" news 2026`, (b) => `"${b}" store network locations 2025`]
    },
    buyer_products: {
      prompt: BUYER_PRODUCTS_JSON,
      queries: [(b) => `"${b}" product categories import breakdown 2025`,
                (b) => `"${b}" top product lines category mix 2025`]
    },
  };

  const cfg = configs[intent];
  if (!cfg) return null;

  const searches = await Promise.all(cfg.queries.map(q => braveSearch(q(subject), BRAVE_KEY, 3)));
  const context = searches.flat().map(r => `- ${r.title}: ${r.snippet}`).join('\n').slice(0, 2000);
  const systemPrompt = langInstr + '\n\n' + cfg.prompt + `\n\nResearch data:\n${context}\n\nBuyer/topic: ${subject}. Output ONLY valid JSON.`;

  const raw = await withHeartbeat(writer, encoder, callClaudeJSON(systemPrompt, messages, env, 4000));
  try {
    const m = raw?.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch(e) { return null; }
}

// ── DRILL-DOWN TAB CARD FUNCTION ──────────────────────────────────────────────
// Routes all 7 drill intents to their respective prompts
// Each intent: step → customs fetch → brave search → Claude → SSE done
async function drillDownTabCard(intent, userMessage, messages, env, writer, encoder) {
  // supply_chain: use dedicated PART1+PART2 parallel handler (like Layer 1)
  if (intent === 'supply_chain') {
    return supplyChainSSE(userMessage, messages, env, writer, encoder);
  }
  const write = async (obj) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  const BRAVE_KEY = env.BRAVE_API_KEY || '';
  const _lang = detectLanguage(userMessage);

  // Extract buyer/topic from conversation history + current message
  const histContext = messages.slice(-4).map(m => m.content).join(' ').slice(0, 500);

  // Intent configuration: prompt, search queries, step label, data source note
  const intentConfig = {
    buyer_financials: {
      prompt: BUYER_FINANCIALS_JSON,
      queries: [
        (buyer) => `"${buyer}" annual report 2025 SEC 10-K revenue earnings financial results`,
        (buyer) => `"${buyer}" DPO payment terms credit rating S&P Moody's supplier payment 2025`,
        (buyer) => `"${buyer}" balance sheet debt EBITDA working capital 2025 2026`,
        (buyer) => `"${buyer}" guidance outlook FY2026 revenue margin earnings call`
      ],
      step: 'Fetching SEC filings & financial data',
      src: 'SEC EDGAR / Company IR'
    },
    buyer_sourcing: {
      prompt: BUYER_SOURCING_JSON,
      queries: [
        (buyer) => `"${buyer}" sourcing by country origin imports 2024 2025`,
        (buyer) => `"${buyer}" import volume China Vietnam Bangladesh 2024 2025`,
        (buyer) => `"${buyer}" HS code apparel textile imports USA 2024`,
        (buyer) => `"${buyer}" tariff exposure IEEPA Section 301 China imports duty cost`
      ],
      step: 'Pulling sourcing & customs data',
      src: 'US Census / Air8 Customs DB'
    },
    buyer_products: {
      prompt: BUYER_PRODUCTS_JSON,
      queries: [
        (buyer) => `"${buyer}" product categories private label assortment 2024 2025`,
        (buyer) => `"${buyer}" unit cost apparel footwear average price 2024`,
        (buyer) => `"${buyer}" HS code imports USA China Vietnam 2024 2025`,
        (buyer) => `apparel market unit cost trend 2024 2025 FOB price`
      ],
      step: 'Analyzing product & category data',
      src: 'Company Reports / Census API'
    },
    buyer_suppliers: {
      prompt: BUYER_SUPPLIERS_JSON,
      queries: [
        (buyer) => `"${buyer}" top suppliers 2024 2025 factory list`,
        (buyer) => `"${buyer}" supplier countries Vietnam China Bangladesh 2024`,
        (buyer) => `"${buyer}" apparel sourcing supplier concentration top 10`,
        (buyer) => `site:importgenius.com "${buyer}" suppliers shipments`
      ],
      step: 'Identifying top suppliers via customs & public data',
      src: 'ImportGenius / Air8 Customs DB'
    },
    product_market: {
      prompt: PRODUCT_MARKET_JSON,
      queries: [
        (topic) => `${topic} US import volume trend 2022 2023 2024 2025 Census OTEXA billion`,
        (topic) => `${topic} import share by country China Vietnam Bangladesh percent 2024`,
        (topic) => `${topic} tariff duty rate Section 301 IEEPA China 2025 percent`,
        (topic) => `${topic} EU import volume Eurostat 2023 2024 trend growth`
      ],
      step: 'Fetching US & EU import data...',
      src: 'US Census · Eurostat · OTEXA · USITC'
    },
    country_sourcing: {
      prompt: COUNTRY_SOURCING_JSON,
      queries: [
        (country) => `US imports from ${country} 2024 2025 Census data apparel`,
        (country) => `${country} apparel footwear manufacturing wage cost 2024 2025`,
        (country) => `${country} RCEP CPTPP FTA tariff advantage US imports`,
        (country) => `${country} factory worker minimum wage 2024 2025`,
        (country) => `Walmart Target sourcing ${country} 2024 2025`
      ],
      step: 'Researching country sourcing intelligence',
      src: 'US Census / UN Comtrade / ILO'
    },
    comparison: {
      prompt: COMPARISON_JSON_PROMPT,
      queries: [
        (buyers) => `${buyers} revenue comparison annual report 2025`,
        (buyers) => `${buyers} DPO payment terms supplier comparison`,
        (buyers) => `${buyers} sourcing China Vietnam origin 2025`,
        (buyers) => `${buyers} market position competitors comparison`
      ],
      step: 'Comparing buyers across all dimensions',
      src: 'SEC EDGAR / Company Reports'
    },
    buyer_signals: {
      prompt: BUYER_SIGNALS_JSON,
      queries: [
        (buyer) => `${buyer} news earnings strategy tariff 2025 2026`,
        (buyer) => `${buyer} litigation lawsuit regulatory 2025 2026`,
        (buyer) => `${buyer} store count network expansion closures 2025 2026`,
        (buyer) => `${buyer} supply chain signals industry 2025 2026`
      ],
      step: 'Scanning latest news, signals & litigation',
      src: 'Brave Search / Company Filings'
    },
    store_network: {
      prompt: BUYER_SIGNALS_JSON,
      queries: [
        (buyer) => `${buyer} store count locations formats retail footprint 2025 2026`,
        (buyer) => `${buyer} store network expansion new markets openings closures 2025 2026`,
        (buyer) => `${buyer} e-commerce share store formats regions 2025`
      ],
      step: 'Mapping store network & locations',
      src: 'Company IR / Annual Reports',
      filterTabs: ['store_network']
    },
    supply_chain: {
      prompt: SUPPLY_CHAIN_BRIEF_JSON,
      queries: [
        (topic) => `${topic} supply chain structure raw material manufacturing retail 2024 2025`,
        (topic) => `${topic} major suppliers factories sourcing countries 2024 2025`,
        (topic) => `${topic} leading brands buyers market share 2025`,
        (topic) => `${topic} supply chain trends tariff China plus one 2025 2026`
      ],
      step: 'Mapping supply chain structure',
      src: 'Industry Reports / Census API / Company Filings'
    },
    company_group: {
      prompt: COMPANY_GROUP_JSON,
      queries: [
        (co) => `"${co}" parent company ownership structure group brands subsidiaries`,
        (co) => `"${co}" annual report 10-K parent group revenue financials 2025`,
        (co) => `"${co}" holding company brands portfolio acquisitions 2024 2025`,
        (co) => `"${co}" corporate structure subsidiary brands DPO payment 2025`
      ],
      step: 'Researching parent group & ownership structure',
      src: 'SEC EDGAR / Company IR / Annual Reports'
    },
    buyer_category_position: {
      prompt: BUYER_CATEGORY_BRIEF_JSON,
      queries: [
        (buyer) => `"${buyer}" product category revenue breakdown market share 2024 2025`,
        (buyer) => `"${buyer}" category mix apparel grocery home electronics vs competitors 2024`,
        (buyer) => `"${buyer}" market share by category NPD Euromonitor ranking 2024 2025`,
        (buyer) => `"${buyer}" private label category strategy expansion 2024 2025`
      ],
      step: 'Mapping category portfolio & competitive position',
      src: 'SEC 10-K / Euromonitor / NPD / IR Reports'
    }
  };

  const cfg = intentConfig[intent] || intentConfig['buyer_financials'];

  // Extract the primary subject (buyer name, country, or topic) from message + context
  const subjectMatch = (userMessage + ' ' + histContext).match(
    /(?:tell me about|查询|了解|分析|introduce|about|for|on|versus|vs|compare)\s+([A-Za-z0-9 &.,\-]+?)(?:\s+(?:vs|versus|and|with|sourcing|supplier|financial|product|market|import|export)|[?？,.]|$)/i
  );
  const subject = subjectMatch
    ? subjectMatch[1].trim().slice(0, 60)
    : userMessage.replace(/[?？]/g,'').trim().slice(0, 60);

  // Disambiguation: if no clear buyer in message or context, ask to clarify
  const buyerInMsg = userMessage.match(/\b([A-Z][a-zA-Z&. '-]{2,}(?:Inc\.?|Corp\.?|Ltd\.?|Brands?|Group|Holdings?)?)\b/);
  const buyerInCtx = messages.slice().reverse().find(m => m.role === 'assistant' && m.content && m.content.length > 10);
  const hasClearBuyer = buyerInMsg || buyerInCtx;

  if (!hasClearBuyer && intent !== 'product_market' && intent !== 'country_sourcing') {
    const clarifyJson = {
      type: 'clarify',
      question: "Which company would you like to analyze? Here are some popular buyers our suppliers work with:",
      options: [
        { icon: '🏪', label: 'Walmart', desc: 'US最大零售商，低价定位。$650B收入', query: 'Tell me about Walmart' },
        { icon: '🎯', label: 'Target', desc: 'US中档密岛零售商。$110B收入', query: 'Tell me about Target' },
        { icon: '💰', label: 'TJX Companies', desc: 'Off-price龙头，T.J.Maxx / Marshalls / HomeGoods', query: 'Tell me about TJX Companies' },
        { icon: '👔', label: 'Ross Stores', desc: 'US最大单一品牌Off-price零售商', query: 'Tell me about Ross Stores' },
        { icon: '🔗', label: 'Amazon', desc: '全球电商龙头，FBA供应商核心买家', query: 'Tell me about Amazon' },
        { icon: '🧵', label: 'Kontoor Brands', desc: 'Wrangler / Lee母公司，钶行直接客户', query: 'Tell me about Kontoor Brands' }],
      followups: ["Tell me about Walmart", "Tell me about Target", "Ross Stores financials", "TJX sourcing strategy"]
    };
    await write({type:'done', json: clarifyJson});
    return;
  }

  await write({type:'step', text:`${cfg.step}: ${subject}`, src: cfg.src});

  // ── STEP 1: Attempt Air8 Customs DB for customs-first intents ────────────────
  let customsContext = '';
  const customsIntents = ['buyer_suppliers', 'buyer_sourcing', 'buyer_products', 'comparison'];
  if (customsIntents.includes(intent)) {
    // DEVELOPER NOTE: fetchAir8Customs() currently returns null.
    // When 1688 DB is connected, this will return real shipment data.
    const customsData = await fetchAir8Customs(env, subject, intent);
    if (customsData) {
      customsContext = `\n## Air8 Customs DB (1688) — Priority Data:\n${JSON.stringify(customsData, null, 2).slice(0, 1200)}`;
      await write({type:'step', text:`Customs records loaded: ${customsData.ticketCount || '?'} shipments · ${customsData.originBreakdown?.length || '?'} origin countries · ${customsData.supplierList?.length || '?'} suppliers`, src:'Air8 Customs DB (1688)'});
    } else {
      await write({type:'step', text:'Air8 1688 Customs DB not yet connected — using web sources (DB is priority when connected)', src:'Brave Search'});
    }
  }

  // ── STEP 2: Brave web searches using intent-specific queries ─────────────────
  const searchQueries = cfg.queries.map(fn => fn(subject));
  const searchResultSets = await Promise.all(
    searchQueries.slice(0, 4).map(q => braveSearch(q, BRAVE_KEY, 4))
  );

  // Surface the top snippet as a progress step
  const topSnippet = searchResultSets.flat().find(r => r.snippet);
  if (topSnippet) {
    await write({type:'step', text: topSnippet.snippet.replace(/[\n\r]+/g,' ').slice(0, 160), src: hostOf(topSnippet.url)});
  }

  // Build research context from all search results
  const searchContext = searchResultSets.map((results, i) =>
    `### Search ${i+1}: ${searchQueries[i].slice(0, 80)}\n${results.map(r => `- ${r.title}: ${r.snippet}`).join('\n')}`
  ).join('\n\n');

  await write({type:'step', text:'Compiling detailed analysis...', src:'Air8 Intelligence'});

  // ── STEP 3: Call Claude with intent-specific prompt + research context ────────
  const systemPrompt = languageInstruction(_lang) + '\n\n' + cfg.prompt +
    `\n\nDATA USED (priority order):\n` +
    (customsContext ? `1. Air8 Customs DB (1688):\n${customsContext}\n\n` : `1. Air8 Customs DB (1688): not yet connected\n\n`) +
    `2. Web search results:\n${searchContext}\n\n` +
    `3. Conversation context:\n${histContext}\n\n` +
    `Subject: ${subject}\n` +
    `Replace ALL JSON placeholders with REAL data. Output ONLY the JSON.`;

  function parseJSON(raw) {
    if (!raw) return null;
    try {
      const clean = raw.replace(/```(?:json)?\s*/g, '').trim();
      const m = clean.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    } catch(e) { return null; }
  }

  // Use streaming for the final Claude call — keeps SSE connection alive during generation
  // and allows larger responses without hitting Cloudflare's wall-clock timeout.
  const intentLabels = {
    buyer_financials: ['Crunching financial ratios...', 'Checking SEC filings...', 'Computing margin trends...'],
    buyer_sourcing: ['Mapping sourcing flows...', 'Checking customs data...', 'Analyzing origin shifts...'],
    buyer_products: ['Scanning category data...', 'Checking import HS codes...', 'Building product breakdown...'],
    buyer_suppliers: ['Scanning supplier records...', 'Matching bill-of-lading data...', 'Ranking top suppliers...'],
    buyer_signals: ['Scanning news feed...', 'Checking regulatory filings...', 'Analyzing risk signals...'],
    store_network: ['Mapping store locations...', 'Checking expansion data...', 'Building store network profile...'],
    product_market: ['Pulling Census trade data...', 'Sizing market...', 'Checking import trends...'],
    country_sourcing: ['Pulling country trade data...', 'Checking wage/cost data...', 'Analyzing sourcing trends...'],
    comparison: ['Pulling data for both buyers...', 'Computing comparison metrics...', 'Finalizing comparison...'],
    buyer_category_position: ['Mapping category portfolio...', 'Checking market share data...', 'Ranking competitive position...'],
  };
  const pingLabels = intentLabels[intent] || ['Compiling analysis...', 'Processing data...', 'Finalizing report...'];
  const _usageDrill = {input:0, output:0, calls:0}; // real token tracking
  let pingCount = 0;
  const raw = await callClaudeStream(systemPrompt, messages, env, 8000, async (charsReceived) => {
    pingCount++;
    await write({type:'step', text: pingLabels[pingCount % pingLabels.length], src:'Air8 Intelligence'});
  }, null, _usageDrill);

  if (raw) {
    let parsed = parseJSON(raw);
    if (parsed) {
      // Post-filter tabs if intent has filterTabs restriction (e.g. store_network)
      if (cfg.filterTabs && Array.isArray(cfg.filterTabs) && parsed.tabs) {
        parsed.tabs = parsed.tabs.filter(t => cfg.filterTabs.includes(t.id));
      }
      await write({type:'done', json: parsed, usage: _usageDrill}); return;
    }
    await write({type:'done', text: raw, usage: _usageDrill});
    return;
  }
  await write({type:'done', text:'Unable to generate analysis. Please try again.'});
}

// ── WEB SEARCH ANSWER ────────────────────────────────────────────────────────
// Supply chain query outside existing intents → Brave search + Claude formats as tab card
async function webSearchAnswer(userMessage, searchQuery, messages, env, writer, encoder) {
  const write = async (data) => writer.write(data);
  const BRAVE_KEY = env.BRAVE_API_KEY || '';
  const lang = detectLanguage(userMessage);

  await write(encoder.encode(`data: ${JSON.stringify({type: 'step', text: `Searching: ${searchQuery}`, src: 'Brave Search'})}\n\n`));

  const results = await braveSearch(searchQuery, BRAVE_KEY, 6);
  const searchContext = results.length
    ? results.map(r => `[${r.title}](${r.url}): ${r.snippet}`).join('\n')
    : 'No web results found. Use your knowledge.';

  const systemPrompt = languageInstruction(lang) + '\n\n' + `You are Air8 Intelligence. A supply chain finance assistant. The user asked a question related to supply chain, trade, or finance. Based on the web search results below, answer in Air8's tab card JSON format.

Web search results:
${searchContext}

Return ONLY valid JSON:
{
  "buyer": "<concise topic title, e.g. 'US Tariff Policy 2025' or 'Vietnam Factory Wages'>",
  "summary": "<one-line key finding>",
  "tabs": [
    {
      "id": "overview",
      "icon": "📊",
      "label": "Overview",
      "insight": "<the single most important insight>",
      "chart": {"type":"bar","title":"<relevant trend title>","labels":["2021","2022","2023","2024","2025E"],"values":[X,X,X,X,X]},
      "bullets": ["key point 1", "key point 2", "key point 3", "key point 4"],
      "text": "2-3 sentences of analytical commentary."
    }
  ],
  "followups": ["Short label 1", "Short label 2", "Short label 3"],
  "sources": "<source names, comma-separated>"
}
Rules:
- Add more tabs as appropriate (max 3 tabs total).
- EVERY tab with numeric/trend/volume data MUST include a chart field. Use type 'bar' for volume trends, 'doughnut' for country mix, 'bar_line_dual' for value+margin.
- Keep followups SHORT (3-5 words max). Always cite sources.
- Replace ALL placeholder X values with REAL numbers from the search results.`;

  const histContext = messages.slice(-6).map(m => ({role: m.role, content: String(m.content || '').slice(0, 400)}));
  const rawText = await callClaudeJSON(systemPrompt, [...histContext, {role: 'user', content: userMessage}], env) || '';

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.tabs) {
        await write(encoder.encode(`data: ${JSON.stringify({type: 'done', json: parsed})}\n\n`));
        return;
      }
    } catch(e) { /* fall through */ }
  }

  // Fallback: plain text
  await write(encoder.encode(`data: ${JSON.stringify({type: 'done', text: rawText || 'No results found.'})}\n\n`));
}

// ── LLM ROUTE HANDLER ────────────────────────────────────────────────────────
// Two-stage: (1) Claude classifies intent, (2) route to existing handler OR web search
async function llmRouteHandler(userMessage, messages, env, writer, encoder) {
  const write = async (data) => writer.write(data);
  const _lang = detectLanguage(userMessage);

  // ── Fast path: known followup labels → skip LLM classify (saves ~5s + avoids timeout) ──
  const FOLLOWUP_INTENTS = {
    'detailed financial analysis': 'buyer_financials',
    'sourcing deep dive': 'buyer_sourcing',
    'sourcing & supply chain deep dive': 'buyer_sourcing',
    'products & category breakdown': 'buyer_products',
    'top suppliers': 'buyer_suppliers',
    'top suppliers — who are they?': 'buyer_suppliers',
    'top suppliers list': 'buyer_suppliers',
    'compare competitors': 'comparison',
    'compare with competitors': 'comparison',
    'compare sourcing vs competitors': 'comparison',
    'latest news & signals': 'buyer_signals',
    'latest news': 'buyer_signals',
    '最新新闻与信号': 'buyer_signals',
    // store_network — MUST NOT leak news/litigation tabs
    'store network': 'store_network',
    'store network & locations': 'store_network',
    'store network and locations': 'store_network',
    '门店网络': 'store_network',
    '门店网络与地点': 'store_network',
    '详细财务分析': 'buyer_financials',
    '采购来源深度分析': 'buyer_sourcing',
    '主要供应商': 'buyer_suppliers',
    '产品品类分析': 'buyer_products',
    '与竞争对手对比': 'comparison',
    'supply chain deep dive': 'supply_chain',
    '供应链分析': 'supply_chain',
    '上下游分析': 'supply_chain',
    'company group': 'company_group',
    '母公司分析': 'company_group',
    '集团分析': 'company_group',
    'category position': 'buyer_category_position',
    'category market position': 'buyer_category_position',
    '品类定位分析': 'buyer_category_position',
    '品类竞争地位': 'buyer_category_position',
    // product market
    'tariff analysis': 'product_market',
    'sourcing cost': 'product_market',
    'fob cost': 'product_market',
    'import trend': 'product_market',
    'product trend': 'product_market',
    'market size': 'product_market',
    '关税分析': 'product_market',
    '进口趋势': 'product_market',
    '品类趋势': 'product_market',
  };
  const fastIntent = FOLLOWUP_INTENTS[userMessage.toLowerCase().trim()];
  if (fastIntent) {
    await drillDownTabCard(fastIntent, userMessage, messages, env, writer, encoder);
    return;
  }

  // Build conversation context
  const histContext = messages.slice(-8).map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content.slice(0, 500) : String(m.content || '').slice(0, 500)
  }));

  await write(encoder.encode(`data: ${JSON.stringify({type: 'step', text: 'Understanding your question...', src: 'Air8 Intelligence'})}\n\n`));

  // ── Stage 1: Classify intent ──────────────────────────────────────────────
  const classifyPrompt = `You are an intent classifier for Air8 Intelligence, a supply chain finance assistant.

Given the user's message and conversation history, classify the intent into EXACTLY ONE of:
- "buyer"             — wants overview/profile of a specific retailer/buyer (Layer 1 analysis)
- "buyer_financials"  — wants financial deep dive for a specific buyer
- "buyer_sourcing"    — wants sourcing/supply chain deep dive for a buyer
- "buyer_products"    — wants product/category breakdown for a buyer
- "buyer_suppliers"   — wants top suppliers list for a buyer
- "product_market"    — wants market analysis for a standalone product category, HS/HTS code, or product type WITHOUT a specific buyer as the subject. Use this for: any HS/HTS code (4-6 digit), product trend questions (knitwear trend, denim market, women's suits import data, footwear sourcing), market size/volume, FOB cost, tariff by category, import volume from US Census or Eurostat. Key triggers: "trend", "market", "import data", "FOB", "sourcing cost", "HS XXXX", "HTS XXXX", any product type + market/import/trend/cost keyword. Do NOT use if the question is clearly about a specific named buyer/retailer's products (use buyer_products instead)
- "country_sourcing"  — wants sourcing intelligence for a specific country
- "comparison"        — wants to compare two buyers side by side
- "buyer_signals"     — wants latest news/signals/events for a specific buyer
- "store_network"     — wants store count, format breakdown, geographic footprint, expansion data for a specific buyer (triggers: "store network", "store locations", "how many stores", "门店", "store count", "retail footprint")
- "supply_chain"      — wants to understand the supply chain structure for a product, sector, or buyer ecosystem (triggers: "supply chain of", "供应链", "上下游", "whole chain", "chain structure")
- "company_group"     — wants to understand a company's parent group, ownership, or subsidiary structure (triggers: "parent company", "母公司", "集团", "Holdings", "Group structure", "subsidiaries")
- "buyer_category_position" — wants to understand the buyer's competitive position within specific product categories — market share by category, which categories they lead vs. lose (triggers: "category position", "market share by category", "品类占比", "where do they lead", "category breakdown vs competitors", "品类竞争力")
- "web_search"        — supply chain / trade / finance question but outside above categories; needs web search
- "off_topic"         — completely unrelated to supply chain, trade, buyers, sourcing, finance

Use conversation history to resolve references: "their products" → the buyer previously discussed.

Return ONLY a JSON object, no prose:
{"intent": "<one of the above>", "buyer": "<extracted buyer name or null>", "query": "<refined web search query if intent=web_search, else null>"}`;

  // Classifier MUST use Sonnet — Haiku misclassifies edge cases (e.g. "Tell me about Action")
  const classifyRaw = await callClaudeJSON(classifyPrompt, [...histContext, {role: 'user', content: userMessage}], env, 200) || '{}';
  let cls = {intent: 'web_search', buyer: null, query: userMessage};
  try {
    const m = classifyRaw.match(/\{[\s\S]*\}/);
    if (m) { const p = JSON.parse(m[0]); if (p.intent) cls = p; }
  } catch(e) {}

  const {intent, buyer, query} = cls;

  // ── Stage 2: Route ────────────────────────────────────────────────────────

  // Completely off-topic
  if (intent === 'off_topic') {
    const _offText = _lang === 'zh' ? OFF_TOPIC_RESPONSE.text : `Air8 Intelligence focuses on supply chain finance and trade intelligence:\n\n- 🏬 **Buyer Analysis** — creditworthiness, payment behavior, procurement strategy\n- 📦 **Products & Categories** — import categories, price trends\n- 🌍 **Sourcing Origins** — country breakdown, supply chain structure\n- 📊 **Finance & Tariffs** — trade policy, tariff impact, credit assessment\n- 📰 **Industry Signals** — retail news, supply chain events\n\nFeel free to ask anything in those areas.`;
    await write(encoder.encode(`data: ${JSON.stringify({type: 'done', text: _offText})}\n\n`));
    return;
  }

  // Buyer Layer 1 — route to full SSE analysis
  if (intent === 'buyer') {
    const msg = buyer ? `Tell me about ${buyer}` : userMessage;
    await buyerAnalysisSSE(msg, messages, env, writer, encoder);
    return;
  }

  // Existing drill-down intents — route to specialized tab card handler
  // Inject resolved buyer name into message so handler doesn't need to re-resolve from history
  const drillIntents = ['buyer_financials','buyer_sourcing','buyer_products','buyer_suppliers','product_market','country_sourcing','comparison','buyer_signals','supply_chain','company_group','buyer_category_position','store_network'];
  if (drillIntents.includes(intent)) {
    const resolvedMsg = buyer ? `[Context: the buyer/company is ${buyer}] ${userMessage}` : userMessage;
    await drillDownTabCard(intent, resolvedMsg, messages, env, writer, encoder);
    return;
  }

  // web_search — supply chain related but outside existing intents
  const searchQ = query || userMessage;
  await webSearchAnswer(userMessage, searchQ, messages, env, writer, encoder);
}


export default {
  async fetch(request, env, ctx) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (request.method === 'OPTIONS') return new Response(null, {headers: cors});

    const url = new URL(request.url);

    // Health endpoint
    if (url.pathname === '/health')
      return new Response(JSON.stringify({status:'ok', service:'air8-buyer-chat-v5', ui:'/'}), {headers:{...cors,'Content-Type':'application/json'}});

    // UI redirect
    if (url.pathname === '/' && request.method === 'GET')
      return Response.redirect('https://erik-ai-bot.github.io/air8-kb-intel/air8-buyer-chat.html', 302);

    if (url.pathname !== '/chat' || request.method !== 'POST')
      return new Response('Not found', {status: 404, headers: cors});

    try {
      const body = await request.json();
      const userMessage = body.message || '';
      const history = Array.isArray(body.history) ? body.history : (Array.isArray(body.context) ? body.context : []);
      const topicHints = Array.isArray(body.topicHints) ? body.topicHints : [];

      if (!userMessage.trim())
        return new Response(JSON.stringify({error:'Empty message'}), {status:400, headers:{...cors,'Content-Type':'application/json'}});

      // Map direction picker topic IDs to specific intents
      const _topicIntentMap = {
        financials:   'buyer_financials',
        products:     'buyer_products',
        sourcing:     'buyer_sourcing',
        risk:         'buyer_signals',
        signals:      'buyer_signals',
        competitors:   'buyer_category_position',
        store_network: 'store_network',
        supply_chain:  'supply_chain',
      };
      let intent = detectIntent(userMessage);
      // Override with topic hint when direction picker was used (single primary topic)
      if (topicHints.length === 1 && _topicIntentMap[topicHints[0]]) {
        intent = _topicIntentMap[topicHints[0]];
      } else if (topicHints.length > 1) {
        // Multiple topics: run each intent in parallel via drillDownJSON, merge tabs
        // Handle inline below after messages array is built
        intent = '__multi__';
      }

      // Build messages array from history
      const messages = [];
      for (const h of history.slice(-6)) {
        if (h.role && h.content) messages.push({role: h.role, content: String(h.content).slice(0, 400)});
      }
      messages.push({role: 'user', content: userMessage});

      // ── MULTI-TOPIC: parallel drill-downs merged into one card ──────────────
      if (intent === '__multi__') {
        const {readable: mr, writable: mw} = new TransformStream();
        const mWriter = mw.getWriter();
        const mEnc = new TextEncoder();
        ctx.waitUntil((async () => {
          const mWrite = async (obj) => mWriter.write(mEnc.encode('data: ' + JSON.stringify(obj) + '\n\n'));
          try {
            const intentList = [...new Set(topicHints.map(h => _topicIntentMap[h]).filter(Boolean))];
            await mWrite({type:'step', text:'Running ' + topicHints.length + '-dimension analysis...', src:'Air8 Intelligence'});
            let results;
            if (intentList.length <= 2) {
              // Full quality: run each intent separately in parallel
              results = await Promise.all(intentList.map(di => drillDownJSON(di, userMessage, messages, env, mWriter, mEnc)));
            } else {
              // 3+ intents: single combined call to avoid overwhelming parallel calls
              const BRAVE_KEY_M = env.BRAVE_API_KEY || '';
              const subjM = userMessage.replace(/tell me about|tell me|查询|了解|about|for|on|[?？]/gi,'').replace(/competitive landscape.*|supply chain.*/gi,'').trim().slice(0,50);
              const dimLabels = {
                supply_chain: 'supply chain: chain overview (who sells what to whom), supplier countries/types, product categories/prices, buyer types gaining/losing. Tab ids: chain_overview, supplier_profile, product_analysis, buyer_types',
                buyer_category_position: 'competitive position: how this buyer ranks vs competitors, category market share. Tab ids: market_position, gain_loss',
                buyer_financials: 'financials: revenue, DPO, credit rating, cash flow. Tab ids: pnl, cashflow',
                buyer_sourcing: 'sourcing: origin countries, China exposure, tariff risk. Tab ids: sourcing_overview, tariff_exposure',
                buyer_signals: 'latest news & signals: company news, market signals, regulatory updates (NO store network, NO litigation separate tab). Tab ids: news, risk_signals',
                buyer_products: 'products: category mix, import breakdown. Tab ids: category_mix, price_points',
                store_network: 'store network ONLY: physical store count, formats, geographic footprint, e-commerce share. Tab id: store_network. Do NOT generate news or litigation tabs.'
              };
              // STRICT tab control: only generate tabs for requested dimensions
              const allowedTabIds = intentList.flatMap(d => {
                const tabMap = {
                  supply_chain: ['chain_overview','supplier_profile','product_analysis','buyer_types'],
                  buyer_category_position: ['market_position','gain_loss'],
                  buyer_financials: ['pnl','cashflow'],
                  buyer_sourcing: ['sourcing_overview','tariff_exposure'],
                  buyer_signals: ['news','risk_signals'],
                  buyer_products: ['category_mix','price_points'],
                  store_network: ['store_network']
                };
                return tabMap[d] || [];
              });
              const dimStr = intentList.map(d => dimLabels[d]||d).join('\n- ');
              const srches = await Promise.all([
                braveSearch(`"${subjM}" overview competitors financials sourcing 2025`, BRAVE_KEY_M, 3),
                braveSearch(`${subjM} supply chain products categories buyers 2025`, BRAVE_KEY_M, 3)
              ]);
              const ctx = srches.flat().map(r=>`- ${r.title}: ${r.snippet}`).join('\n').slice(0,2000);
              const langInstr_m = languageInstruction(detectLanguage(userMessage));
              const allowedTabIdsStr = allowedTabIds.length > 0 ? `\n\nSTRICT RULE: ONLY generate tabs with these ids: ${allowedTabIds.join(', ')}. Do NOT add any other tabs (no news/litigation/risk tabs unless explicitly listed above).` : '';
              const combinedPrompt = langInstr_m + '\n\n' + `You are Air8 Intelligence. Generate a multi-dimension buyer intelligence card as JSON.
The user requested analysis across these dimensions for "${subjM}":
- ${dimStr}

For EACH dimension, generate 1-2 concise tabs. Total tabs: aim for ${intentList.length * 2} tabs covering all dimensions.
Tab ids must be unique. Use real data.${allowedTabIdsStr}

Return ONLY valid JSON:
{
  "buyer": "${subjM}",
  "summary": "<brief summary covering all requested dimensions>",
  "tabs": [
    ... generate tabs for each requested dimension ONLY ...
  ],
  "sources": "Web search · Company filings"
}

Research data:\n${ctx}\n\nOutput ONLY valid JSON. No code fences.`;
              const raw_c = await withHeartbeat(mWriter, mEnc, callClaudeJSON(combinedPrompt, messages, env, 5000));
              let combined = null;
              try { const m_c = raw_c?.match(/\{[\s\S]*\}/); if(m_c) combined = JSON.parse(m_c[0]); } catch(e) {}
              results = combined ? [combined] : [];
            }
            // Build allowed tab whitelist from intentList for post-filtering
            const _tabWhitelist = intentList.flatMap(d => {
              const _tw = {
                supply_chain: ['chain_overview','supplier_profile','product_analysis','buyer_types','supply_chain_overview','supply_chain_categories'],
                buyer_category_position: ['market_position','gain_loss','competitive_position','category_position'],
                buyer_financials: ['pnl','cashflow','balance_sheet','quarterly','guidance'],
                buyer_sourcing: ['sourcing_overview','tariff_exposure','sourcing','origin_mix'],
                buyer_signals: ['news','risk_signals','news_signals'],
                buyer_products: ['category_mix','price_points','products','categories'],
                store_network: ['store_network']
              };
              return _tw[d] || [];
            });
            const seenIds = new Set();
            const allTabs = [];
            for (const r of results) {
              if (!r?.tabs) continue;
              for (const t of r.tabs) {
                // Filter: only include tabs in whitelist (or whitelist is empty = no filter)
                const allowed = _tabWhitelist.length === 0 || _tabWhitelist.includes(t.id);
                if (allowed && !seenIds.has(t.id)) { seenIds.add(t.id); allTabs.push(t); }
              }
            }
            const first = results.find(r => r?.buyer);
            await mWrite({type:'done', json:{
              buyer: first?.buyer || userMessage.slice(0,40),
              summary: results.filter(r=>r?.summary).map(r=>r.summary).join(' · ').slice(0,150),
              tabs: allTabs,
              followups: first?.followups || [],
              sources: 'Multi-dimension analysis · ' + (first?.sources||'Web search')
            }});
          } catch(e) {
            await mWrite({type:'done', text:'Error: '+String(e)});
          } finally { await mWriter.close(); }
        })());
        return new Response(mr, {headers:{...cors,'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'}});
      }

      // ── INTENT ROUTING ────────────────────────────────────────────────────────

      // Off-topic: return immediately without Claude call
      if (intent === 'off_topic') {
        const _ol = detectLanguage(userMessage);
        const _ot = _ol === 'zh' ? OFF_TOPIC_RESPONSE : { text: `Air8 Intelligence focuses on supply chain finance and trade:\n\n- 🏬 **Buyer Analysis** — creditworthiness, payment behavior, sourcing strategy\n- 📦 **Products & Categories** — import categories, price trends\n- 🌍 **Sourcing Origins** — country breakdown, supply chain structure\n- 📊 **Finance & Tariffs** — trade policy, tariff impact, credit assessment\n- 📰 **Industry Signals** — retail news, supply chain events\n\nFeel free to ask anything in those areas.` };
        return new Response(JSON.stringify(_ot), {headers:{...cors,'Content-Type':'application/json'}});
      }

      // Buyer Layer 1 — 6-tab card via parallel PART1 + PART2 calls
      if (intent === 'buyer') {
        const {readable, writable} = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();
        ctx.waitUntil((async () => {
          try { await buyerAnalysisSSE(userMessage, messages, env, writer, encoder); }
          catch(e) { await writer.write(encoder.encode(`data: ${JSON.stringify({type:'done',text:'Error: '+String(e)})}\n\n`)); }
          finally { await writer.close(); }
        })());
        return new Response(readable, {headers:{...cors,'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'}});
      }

      // Drill-down intents — all route to drillDownTabCard()
      const drillIntents = ['buyer_financials','buyer_sourcing','buyer_products','buyer_suppliers','product_market','country_sourcing','comparison','buyer_signals','supply_chain','company_group','buyer_category_position','store_network'];
      if (drillIntents.includes(intent)) {
        const {readable, writable} = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();
        ctx.waitUntil((async () => {
          try { await drillDownTabCard(intent, userMessage, messages, env, writer, encoder); }
          catch(e) { await writer.write(encoder.encode(`data: ${JSON.stringify({type:'done',text:'Error: '+String(e)})}\n\n`)); }
          finally { await writer.close(); }
        })());
        return new Response(readable, {headers:{...cors,'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'}});
      }

      // ── LLM ROUTE: let Claude determine intent and format response ───────────
      if (intent === 'llm_route') {
        const {readable: llmReadable, writable: llmWritable} = new TransformStream();
        const llmWriter = llmWritable.getWriter();
        const llmEncoder = new TextEncoder();
        ctx.waitUntil((async () => {
          try {
            await llmRouteHandler(userMessage, messages, env, llmWriter, llmEncoder);
          } catch(e) {
            await llmWriter.write(llmEncoder.encode(`data: ${JSON.stringify({type:'done', text: 'Error: ' + String(e)})}\n\n`));
          } finally {
            await llmWriter.close();
          }
        })());
        return new Response(llmReadable, {
          headers: {...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
        });
      }

      // Safety fallback — should not reach here
      return new Response(JSON.stringify(OFF_TOPIC_RESPONSE), {headers:{...cors,'Content-Type':'application/json'}});

    } catch(err) {
      return new Response(JSON.stringify({error: String(err)}), {status:500, headers:{...cors,'Content-Type':'application/json'}});
    }
  }
};
