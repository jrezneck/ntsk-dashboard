// scripts/refresh.mjs
// Pulls NTSK price history + latest prices for cybersecurity comps from Alpha Vantage.
// Writes /data/ntsk.json with both NTSK chart data and live comp EVs.

import fs from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.ALPHA_VANTAGE_KEY;
const OUT = path.join("data", "ntsk.json");

if (!API_KEY) { console.error("Missing ALPHA_VANTAGE_KEY"); process.exit(1); }

// ─── Static comp fundamentals (update quarterly) ─────────────────────
// EV = Market Cap + Debt - Cash. Market Cap is computed live below.
// Forward revenue and growth update with each comp's earnings cycle.
const COMPS = [
  { ticker: "ZS",   name: "Zscaler",            sharesM: 156.0,  cashB: 2.95, debtB: 1.15, fwdRevB: 3.32,  growth: 24.0 },
  { ticker: "PANW", name: "Palo Alto Networks", sharesM: 666.0,  cashB: 3.50, debtB: 0.05, fwdRevB: 11.30, growth: 14.5 },
  { ticker: "CRWD", name: "CrowdStrike",        sharesM: 247.5,  cashB: 4.40, debtB: 0.74, fwdRevB: 5.90,  growth: 22.8 },
  { ticker: "FTNT", name: "Fortinet",           sharesM: 740.0,  cashB: 2.50, debtB: 0.50, fwdRevB: 6.95,  growth: 12.0 },
  { ticker: "S",    name: "SentinelOne",        sharesM: 340.3,  cashB: 0.63, debtB: 0.02, fwdRevB: 0.99,  growth: 24.0 },
  { ticker: "NET",  name: "Cloudflare",         sharesM: 352.0,  cashB: 4.10, debtB: 3.52, fwdRevB: 2.30,  growth: 26.0 },
];

// ─── Generic Alpha Vantage daily fetch ───────────────────────────────
async function fetchDaily(ticker) {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=compact&apikey=${API_KEY}`;
  const res = await fetch(url);
  const raw = await res.json();
  if (raw["Information"] || raw["Note"] || raw["Error Message"]) {
    throw new Error(`${ticker}: ${JSON.stringify(raw)}`);
  }
  const series = raw["Time Series (Daily)"];
  if (!series) throw new Error(`${ticker}: no series in response`);
  return Object.entries(series)
    .map(([date, o]) => ({ date, close: parseFloat(o["4. close"]) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── 1. NTSK full history for chart ──────────────────────────────────
console.log("Fetching NTSK…");
const ntskAll = await fetchDaily("NTSK");
const IPO_DATE = "2025-09-18";
const ntskSinceIpo = ntskAll.filter((d) => d.date >= IPO_DATE);
const last = ntskSinceIpo[ntskSinceIpo.length - 1];
const prev = ntskSinceIpo[ntskSinceIpo.length - 2];
const closes = ntskSinceIpo.map((d) => d.close);

const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = (iso) => { const [y,m,d] = iso.split("-"); return `${months[+m-1]} ${+d} '${y.slice(2)}`; };

// ─── 2. Latest price for each comp ────────────────────────────────────
// Alpha Vantage free tier: 25 calls/day. We use 1 + 6 = 7 calls.
// Sleep 12s between calls to stay under 5/min rate limit.
const compResults = [];
for (const c of COMPS) {
  console.log(`Fetching ${c.ticker}…`);
  try {
    const series = await fetchDaily(c.ticker);
    const lastPrice = series[series.length - 1].close;
    const marketCapB = (lastPrice * c.sharesM) / 1000;
    const evB = marketCapB + c.debtB - c.cashB;
    compResults.push({
      ticker: c.ticker,
      name: c.name,
      price: +lastPrice.toFixed(2),
      marketCapB: +marketCapB.toFixed(2),
      evB: +evB.toFixed(2),
      fwdRevB: c.fwdRevB,
      growth: c.growth,
      evRev: +(evB / c.fwdRevB).toFixed(2),
    });
  } catch (e) {
    console.error(`  Failed for ${c.ticker}: ${e.message}`);
    // Continue with other comps even if one fails
  }
  // Throttle to be polite to free API
  await new Promise((r) => setTimeout(r, 12000));
}

// ─── 3. Write output JSON ────────────────────────────────────────────
const output = {
  ticker: "NTSK",
  asOf: last.date,
  refreshedAt: new Date().toISOString(),
  market: {
    price: +last.close.toFixed(2),
    prevClose: +prev.close.toFixed(2),
    dayChangePct: +(((last.close - prev.close) / prev.close) * 100).toFixed(2),
    yearLow: +Math.min(...closes).toFixed(2),
    yearHigh: +Math.max(...closes).toFixed(2),
  },
  priceHistory: ntskSinceIpo.map((d) => ({ date: fmtDate(d.date), close: +d.close.toFixed(2) })),
  comps: compResults,
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(output, null, 2) + "\n");
console.log(`Wrote ${output.priceHistory.length} NTSK points + ${compResults.length} comps. Latest NTSK: $${last.close} on ${last.date}`);
