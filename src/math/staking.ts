/**
 * Staking reward maths, the same formulas the staking server accrues with. Use them to preview a position; the server's figures
 * (`stealth.staking.position`) are what's owed. An estimate assumes today's APR and boosts hold for the whole period, which they
 * may not, and a payout is capped by what the reward pool holds. Nothing here is a promise of any return.
 *
 * @module
 */

export const YEAR_SEC = 365 * 86_400;
/** 1× in bps. */
export const BOOST_ONE_BPS = 10_000;

/** A boost step: after holding `days`, rewards accrue at `multBps / 10,000` ×. */
export interface StakingBoost {
  days: number;
  multBps: number;
}

/** The multiplier for a position `ageSec` old: the highest step reached, and never below 1×. */
export function boostAt(boosts: readonly StakingBoost[], ageSec: number): number {
  let best = BOOST_ONE_BPS;
  for (const b of boosts) if (ageSec >= b.days * 86_400 && b.multBps > best) best = b.multBps;
  return best;
}

/** The next step a position `ageSec` old will reach, and how many seconds until it does. `null` once at the top. */
export function nextBoost(boosts: readonly StakingBoost[], ageSec: number): { multBps: number; inSec: number } | null {
  const now = boostAt(boosts, ageSec);
  const ahead = [...boosts].filter((b) => b.days * 86_400 > ageSec && b.multBps > now).sort((a, b) => a.days - b.days);
  const n = ahead[0];
  return n ? { multBps: n.multBps, inSec: n.days * 86_400 - ageSec } : null;
}

/**
 * Reward on `staked` base units over `seconds` at `aprBps` and a `multBps` boost, rounded down:
 * `staked × apr × mult × seconds / (10,000 × 10,000 × year)`.
 */
export function rewardFor(staked: bigint, aprBps: number, multBps: number, seconds: number): bigint {
  const s = Math.floor(seconds);
  if (staked <= 0n || aprBps <= 0 || s <= 0) return 0n;
  return (staked * BigInt(Math.round(aprBps)) * BigInt(Math.round(multBps)) * BigInt(s)) / (10_000n * 10_000n * BigInt(YEAR_SEC));
}

/**
 * What `amount` would earn over `days` from a fresh stake, stepping through the boosts as it ages. Each segment uses the boost reached at
 * its start, as the server does.
 */
export function estimateStakingReward(amount: bigint, aprBps: number, boosts: readonly StakingBoost[], days: number): bigint {
  if (days <= 0) return 0n;
  const edges = [...new Set([0, ...boosts.map((b) => b.days).filter((d) => d > 0 && d < days), days])].sort((a, b) => a - b);
  let total = 0n;
  for (let i = 0; i + 1 < edges.length; i++) {
    const from = edges[i]!;
    const to = edges[i + 1]!;
    total += rewardFor(amount, aprBps, boostAt(boosts, from * 86_400), (to - from) * 86_400);
  }
  return total;
}

/** The effective yearly rate in bps after `days`, counting boosts: `estimate / amount × 365 / days`. */
export function effectiveAprBps(aprBps: number, boosts: readonly StakingBoost[], days: number): number {
  if (days <= 0 || aprBps <= 0) return 0;
  const unit = 10n ** 18n;
  const r = estimateStakingReward(unit, aprBps, boosts, days);
  return (Number(r) / 1e18) * (365 / days) * 10_000;
}

/** The share of an accrued reward that leaves with an unstake of `amount` out of `staked`. */
export function rewardShare(accrued: bigint, amount: bigint, staked: bigint): bigint {
  if (staked <= 0n) return 0n;
  return amount >= staked ? accrued : (accrued * amount) / staked;
}
