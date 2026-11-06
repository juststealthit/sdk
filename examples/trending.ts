// Trending from every chain: coins launched here and external coins, then one external coin's page, its chart and its link.
// External coins aren't launched on Just Stealth It and nobody here checks them. This reads data; it isn't advice.
import { createStealthClient, isOutsideToken, tokenChain } from "@juststealthit/sdk";
import { coinPageUrl, formatPercent, formatUsd } from "@juststealthit/sdk/utils";

const stealth = createStealthClient();

const { coins, outside } = await stealth.market.trending();
if (!outside) console.log("External coins are off on this server: only coins launched here.");
for (const c of coins.slice(0, 15)) {
  const from = c.onPlatform ? "launched here" : (c.launchpad ?? "external");
  console.log(c.chain.padEnd(10), c.symbol.padEnd(10), formatUsd(c.marketCapUsd).padStart(8), formatPercent(c.changePct).padStart(8), from);
}

// the All list mixes external coins in; ownOnly leaves them out
const all = await stealth.market.list({ sort: "volume" });
const external = all.items.filter(isOutsideToken);
console.log(`${external.length} of ${all.items.length} rows on the first All page are external`);

const pick = coins.find((c) => !c.onPlatform);
if (pick) {
  const chain = pick.chain;
  const page = await stealth.sol.market.coin(pick.address, { chain });
  const candles = await stealth.sol.market.candles(pick.address, "1m", { chain });
  console.log(`${page.symbol} on ${page.chain}: ${formatUsd(page.liquidityUsd)} liquidity, ${candles.length} one-minute candles`);
  console.log("Its page:", coinPageUrl({ address: pick.address, chain, onPlatform: false }));
}

const first = all.items[0];
if (first) console.log("First row's chain:", tokenChain(first), coinPageUrl({ address: first.address, chain: tokenChain(first), onPlatform: !first.outside }));
