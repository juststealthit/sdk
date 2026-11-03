// A Solana wallet's PnL on launchpad coins, its last trades, rewards and trading profile. WALLET is the address.
import { createStealthClient } from "@juststealthit/sdk";
import { formatUsd } from "@juststealthit/sdk/utils";

const wallet = process.env.WALLET!;
const stealth = createStealthClient();

const pnl = await stealth.sol.wallets.pnl(wallet, "30d");
console.log(`30d: realized ${formatUsd(pnl.summary.realizedUsd)}, unrealized ${formatUsd(pnl.summary.unrealizedUsd)}, volume ${formatUsd(pnl.summary.volumeUsd)}`);
for (const p of pnl.positions.filter((x) => !x.closed).slice(0, 5)) console.log(" open", p.symbol.padEnd(10), formatUsd(p.valueUsd), formatUsd(p.totalProfitUsd));

for (const t of await stealth.sol.wallets.iterateTrades(wallet, { limit: 20 }).take(10)) console.log(" ", new Date(t.timestamp).toISOString(), t.side, t.symbol, formatUsd(t.valueUsd));

const rewards = await stealth.sol.wallets.rewards(wallet);
console.log("Rewards received:", formatUsd(rewards.totalUsd), "owed:", rewards.owed.length);

const profile = await stealth.sol.wallets.analytics(wallet);
console.log("Profile:", profile.identity.name ?? "anonymous", profile.identity.tags.join(", "), profile.analysisFresh ? "" : "(analysis stale)");
