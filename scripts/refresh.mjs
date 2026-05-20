// scripts/refresh.mjs
// Pulls NTSK price history + latest prices for cybersecurity comps from Alpha Vantage.
// Writes /data/ntsk.json with both NTSK chart data and live comp EVs.

import fs from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.ALPHA_VANTAGE_KEY;
const OUT = path.join("data", "ntsk.json");

if (!API_KEY) { console.error("Missing ALPHA_VANTAGE_KEY"); process.exit(1); }

// Static comp fundamentals (update quarterly after each comp's earnings)
const COMPS = [
  { ticker: "ZS",   name: "Zscaler",            sharesM: 160.6,  cashB: 3.51, debtB: 1.15, fwdRevB: 3.32,  growth: 24.0 },
  { ticker: "PANW", name: "Palo Alto Networks", sharesM: 696.0,  cashB: 4.16, debtB: 0.00, fwdRevB: 11.30, growth: 14.5 },
  { ticker: "CRWD", name: "CrowdStrike",        sharesM: 254.5,  cashB: 5.23, debtB: 0.74, fwdRevB: 5.90,  growth: 23.0 },
  { ticker: "FTNT", name: "Fortinet",           sharesM: 730.0,  cashB: 2.50, debtB: 0.50, fwdRevB: 7.79,  growth: 15.0 },
  { ticker: "S",    name: "SentinelOne",        sharesM: 340.3,  cashB: 0.63, debtB: 0.02, fwdRevB: 1.20,  growth: 19.0 },
  { ticker: "NET",  name: "Cloudflare",         sharesM: 388.0,  cashB: 4.20, debtB: 3.27, fwdRevB: 2.81,  growth: 30.0 },
];

async function fetchDaily(ticker, attempt = 1) {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=compact&apikey=${API_KEY}`;
  const res = await fetch(url);
  const raw = await res.json();

  // If rate limited, wait and retry up to 3 times
  if ((raw["Information"] || raw["Note"]) && attempt < 4) {
    const wait = 30 * attempt; // 30s, 60s, 90s
    console.log(`  ${ticker}: rate limited, waiting ${wait}s and retrying (attempt ${attempt + 1}/4)...`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return fetchDaily(ticker, attempt + 1);
  }

  if (raw["Information"] || raw["Note"] || raw["Error Message"]) {
    throw new Error(`${ticker}: ${JSON.stringify(raw)}`);
  }
  const series = raw["Time Series (Daily)"];
  if (!series) throw new Error(`${ticker}: no series in response`);
  return Object.entries(series)
    .map(([date, o]) => ({ date, close: parseFloat(o["4. close"]) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

console.log("Fetching NTSK…");
const ntskAll = await fetchDaily("NTSK");
const IPO_DATE = "2025-09-18";
const ntskSinceIpo = ntskAll.filter((d) => d.date >= IPO_DATE);
const last = ntskSinceIpo[ntskSinceIpo.length - 1];
const prev = ntskSinceIpo[ntskSinceIpo.length - 2];
const closes = ntskSinceIpo.map((d) => d.close);

const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = (iso) => { const [y,m,d] = iso.split("-"); return `${months[+m-1]} ${+d} '${y.slice(2)}`; };

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
  }
  await new Promise((r) => setTimeout(r, 15000));
}

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
