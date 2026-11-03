// Perps markets across Hyperliquid, Aster and Jupiter Perps, grouped by coin like the site. Read-only: no orders, no account.
import { createPerpsClient, filterPerpGroups, groupPerpMarkets } from "@juststealthit/sdk/perps";
import { formatPercent, formatPrice, formatUsd } from "@juststealthit/sdk/utils";

const perps = createPerpsClient();
const { markets, failed } = await perps.markets();
if (failed.length) console.log("Skipped:", failed.map((f) => f.venue));

const groups = filterPerpGroups(groupPerpMarkets(markets), { kind: "perp" });
for (const g of groups.slice(0, 15)) {
  const venues = g.markets.map((m) => `${m.venue}:${formatPrice(m.price / m.unitMultiplier)}`).join("  ");
  console.log(g.coin.padEnd(8), formatUsd(g.volume24hUsd).padStart(8), formatPercent(g.markets[0]!.change24hPct).padStart(8), venues);
}

const btc = groups.find((g) => g.coin === "BTC")!.markets[0]!;
const candles = await perps.candles(btc, "1h");
console.log(`BTC on ${btc.venue}: ${candles.length} hourly candles, last close ${candles.at(-1)?.close}`);
