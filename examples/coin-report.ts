// A Solana coin at a glance: price, risk, holders, top traders and where its fees go. MINT is the coin.
import { createStealthClient } from "@juststealthit/sdk";
import { formatBps, formatPercent, formatPrice, formatUsd, shortAddress } from "@juststealthit/sdk/utils";

const mint = process.env.MINT ?? "So11111111111111111111111111111111111111112";
const stealth = createStealthClient();

const coin = await stealth.sol.tokens.find(mint);
if (!coin) {
  console.log("Not a launchpad coin. Try the market route:", await stealth.sol.market.coin(mint));
  process.exit(0);
}
const [risk, holders, traders, plan, price] = await Promise.all([
  stealth.sol.tokens.risk(mint),
  stealth.sol.tokens.holders(mint),
  stealth.sol.tokens.topTraders(mint),
  stealth.sol.tokens.feePlan(mint),
  stealth.sol.tokens.price(mint),
]);

console.log(`${coin.name} ($${coin.symbol}) on ${coin.sol.venue ?? coin.sol.kind}, tax ${formatBps(coin.taxBps)}`);
console.log(`price ${formatPrice(price.priceUsd)} · mcap ${formatUsd(price.marketCapUsd)} · graduation ${formatPercent(coin.graduation.progress * 100, { sign: false })}`);
console.log(`top 10 hold ${risk.top10Pct.toFixed(1)}% · dev holds ${risk.devHoldingPct.toFixed(1)}% · snipers ${risk.sniperHeldPct.toFixed(1)}%`);
console.log("launch type:", plan.feeMode, plan.plan?.slices.map((s) => `${s.kind} ${formatBps(s.bps)}`).join(", ") ?? "");
for (const h of holders.slice(0, 5)) console.log(" holder", shortAddress(h.address), `${h.pctOfSupply.toFixed(2)}%`, h.label ?? "");
for (const t of traders.slice(0, 5)) console.log(" trader", shortAddress(t.address), formatUsd(t.pnlUsd));
