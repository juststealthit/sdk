// Offline maths: the anti-sniper line, what a coin earns per tier, and a bonding-curve preview. No network.
import { feeTable, initCurve, quoteCurveBuy, sniperSchedule, splitEvmFee } from "@juststealthit/sdk/math";
import { formatBps, formatUnits } from "@juststealthit/sdk/utils";

console.log("Anti-sniper fee on a 1.25% coin:");
for (const { second, feeBps } of sniperSchedule(125)) console.log(`  ${String(second).padStart(2)}s  ${formatBps(Math.round(feeBps * 100) / 100)}`);

console.log("\nWhat the coin earns of each trade:");
console.table(feeTable().map((r) => ({ tier: formatBps(r.tierBps), evm: formatBps(r.evm), meteora: formatBps(r.meteora), raydium: formatBps(r.raydium) })));

const split = splitEvmFee(10n ** 18n, 225);
console.log("A 1 ETH buy at 2.25%: coin", formatUnits(split.coin, 18), "ETH, platform", formatUnits(split.platform, 18), "ETH");

// a constant-product curve that sells 79.31% of 1B tokens for 85 SOL
const supply = 10n ** 15n;
const curve = initCurve({ supply, totalSell: (supply * 7_931n) / 10_000n, raise: 85n * 10n ** 9n });
const q = quoteCurveBuy(curve, 10n ** 9n, 125);
console.log("\n1 SOL on a fresh curve buys about", formatUnits(q.amountOut, 6, 0), "tokens, moving the price", q.priceImpactPct.toFixed(2), "%");
