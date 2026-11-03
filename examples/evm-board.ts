// An EVM chain through the API: its newest coins, one coin's chart and trades, and new trades as they come (by polling). CHAIN defaults to base.
import { createStealthClient } from "@juststealthit/sdk";
import { pollTrades } from "@juststealthit/sdk/live";
import { formatPrice, formatUsd } from "@juststealthit/sdk/utils";
import type { EvmApiChain } from "@juststealthit/sdk/api";

const stealth = createStealthClient();
const chain = stealth.evm.chain((process.env.CHAIN ?? "base") as EvmApiChain);

const cfg = await stealth.evm.config();
console.log("Live EVM chains:", cfg.chains.map((c) => c.name).join(", "));

const { items } = await chain.listTokens({ stages: ["new", "graduating"], sort: "volume" });
const coin = items[0];
if (!coin) process.exit(0);
const [native, candles, risk] = await Promise.all([chain.nativePrice(), chain.getCandles(coin.address, { interval: "15m" }), chain.getRisk(coin.address)]);
console.log(`${coin.symbol}: ${formatPrice(coin.priceUsd)}, ${candles.length} candles, top 10 hold ${risk.top10Pct.toFixed(1)}%, native $${native.usd}`);

const stop = pollTrades((t) => chain.getTrades(t), coin.address, (t) => console.log(t.side, formatUsd(t.valueUsd), t.txHash), { intervalMs: 4_000 });
setTimeout(stop, 60_000);
