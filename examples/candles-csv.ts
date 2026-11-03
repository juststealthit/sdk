// A day of 5-minute candles for a Solana coin, as CSV on stdout. MINT is the coin.
import { createStealthClient } from "@juststealthit/sdk";

const mint = process.env.MINT!;
const stealth = createStealthClient();
const now = Math.floor(Date.now() / 1000);
const candles = await stealth.sol.tokens.candles(mint, { interval: "5m", from: now - 86_400, to: now });

console.log("time,open,high,low,close,volume_usd,volume_sol");
for (const c of candles) console.log([new Date(c.time * 1000).toISOString(), c.open, c.high, c.low, c.close, c.volume, c.volumeEth].join(","));
