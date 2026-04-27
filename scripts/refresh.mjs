import fs from "node:fs/promises";
import path from "node:path";

const TICKER = "NTSK";
const API_KEY = process.env.ALPHA_VANTAGE_KEY;
const OUT = path.join("data", "ntsk.json");

if (!API_KEY) { console.error("Missing ALPHA_VANTAGE_KEY"); process.exit(1); }

const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${TICKER}&outputsize=compact&apikey=${API_KEY}`;
const res = await fetch(url);
const raw = await res.json();

if (raw["Information"] || raw["Note"] || raw["Error Message"]) {
  console.error("API error:", raw); process.exit(1);
}

const series = raw["Time Series (Daily)"];
const IPO_DATE = "2025-09-18";
const allDays = Object.entries(series)
  .filter(([d]) => d >= IPO_DATE)
  .map(([date, o]) => ({ date, close: parseFloat(o["4. close"]) }))
  .sort((a, b) => a.date.localeCompare(b.date));

const last = allDays[allDays.length - 1];
const prev = allDays[allDays.length - 2];
const closes = allDays.map(d => d.close);

const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmt = iso => { const [y,m,d] = iso.split("-"); return `${months[+m-1]} ${+d} '${y.slice(2)}`; };

const output = {
  ticker: TICKER,
  asOf: last.date,
  refreshedAt: new Date().toISOString(),
  market: {
    price: +last.close.toFixed(2),
    prevClose: +prev.close.toFixed(2),
    dayChangePct: +(((last.close - prev.close) / prev.close) * 100).toFixed(2),
    yearLow: +Math.min(...closes).toFixed(2),
    yearHigh: +Math.max(...closes).toFixed(2),
  },
  priceHistory: allDays.map(d => ({ date: fmt(d.date), close: +d.close.toFixed(2) })),
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(output, null, 2) + "\n");
console.log(`Wrote ${output.priceHistory.length} points, latest $${last.close} on ${last.date}`);
