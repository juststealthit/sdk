// The launchpad's board across every chain: counts per stage, the top coins by volume, and a walk over every new coin.
import { createStealthClient } from "@juststealthit/sdk";
import { formatPercent, formatUsd } from "@juststealthit/sdk/utils";

const stealth = createStealthClient();

const counts = await stealth.market.counts();
console.log(`new ${counts.new} · graduating ${counts.graduating} · migrated ${counts.migrated}`, counts.chains);

const { items } = await stealth.market.list({ stages: ["new", "graduating", "migrated"], sort: "volume" });
for (const coin of items.slice(0, 10)) {
  const chain = coin.sol ? "solana" : coin.evm?.chain;
  console.log(chain?.padEnd(10), coin.symbol.padEnd(10), formatUsd(coin.marketCapUsd).padStart(8), formatPercent(coin.change.h24).padStart(8));
}

// every coin launched in the last hour, page by page
const hourAgo = Date.now() - 3_600_000;
let fresh = 0;
for await (const coin of stealth.market.iterate({ stages: ["new"], sort: "age" })) {
  if (coin.createdAt < hourAgo) break;
  fresh++;
}
console.log(fresh, "coins launched in the last hour");
