// $STEALTH staking: the pool, an estimate, your position, and a stake. SOLANA_KEY signs; AMOUNT is whole tokens (default 100).
// Estimates assume today's rate and boosts hold, which they may not. Nothing here is a promise of any return.
import { Keypair } from "@solana/web3.js";

import { createStealthClient } from "@juststealthit/sdk";
import { estimateStakingReward, nextBoost } from "@juststealthit/sdk/math";
import { createStealthSolana, keypairSigner } from "@juststealthit/sdk/solana";
import { formatBps, formatDuration, formatUnits, parseUnits } from "@juststealthit/sdk/utils";

const stealth = createStealthClient();
const pool = await stealth.staking.pool("stealth");
if (!pool) {
  console.log("Staking isn't open right now.");
  process.exit(0);
}
console.log(`${pool.name}: base rate ${formatBps(pool.aprBps)}, cooldown ${formatDuration(pool.cooldownSec)}, ${pool.stakers} stakers`);
for (const b of pool.boosts) console.log(`  after ${b.days} days: ×${b.multBps / 10_000}`);

const amount = parseUnits(process.env.AMOUNT ?? "100", pool.decimals);
for (const days of [7, 30, 90, 365]) console.log(`  ${days} days ≈`, formatUnits(estimateStakingReward(amount, pool.aprBps, pool.boosts, days), pool.decimals, 4), pool.symbol);

if (!process.env.SOLANA_KEY) process.exit(0);
const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SOLANA_KEY)));
const sol = createStealthSolana({ signer: keypairSigner(keypair) });

const result = await sol.stake(amount);
console.log("Staked:", result.status, result.signature);

const position = await stealth.staking.position("stealth", keypair.publicKey.toBase58());
const age = position.openedAt ? (Date.now() - position.openedAt) / 1000 : 0;
console.log("Staked", formatUnits(position.staked, pool.decimals), "earned so far", formatUnits(position.rewardEarned, pool.decimals));
console.log("Next boost:", nextBoost(pool.boosts, age));
