// Reads only: no wallet, no key, nothing spent.
import { createStealthEvm } from "@juststealthit/sdk/evm";
import { createStealthSolana, METEORA_SHARED_CONFIGS } from "@juststealthit/sdk/solana";

const base = createStealthEvm({ chain: "base" });
const cfg = await base.getConfig();
console.log("Base: default graduation target", cfg.defaultTarget, "wei, launch fee", cfg.launchFee);

const sol = createStealthSolana();
const { items } = await sol.getTokens({ stages: "new,graduating,migrated", sort: "volume" });
for (const coin of items.slice(0, 5)) console.log(coin.symbol, coin.address);
console.log(Object.keys(METEORA_SHARED_CONFIGS).length, "Meteora pairs share a config at 1.25%");
