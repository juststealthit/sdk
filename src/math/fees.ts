/**
 * Tax tiers, the 70 / 30 split and the anti-sniper line, as the public docs and the contracts state them. Pure functions: nothing here
 * reads the chain. The live rate of a coin is still what the chain says; use these to explain, preview or check it.
 *
 * @module
 */
import { METEORA_TIERS, PUMP_SHARES, RAYDIUM_TIERS, type SolanaTier } from "../solana/constants.js";

/** The anti-sniper fee at launch, in bps: 90%. */
export const SNIPER_START_BPS = 9_000;
/** How long the anti-sniper window lasts, in seconds. */
export const SNIPER_WINDOW_SEC = 15;
/** The tiers a Meteora or EVM coin can pick, in bps. */
export const TAX_TIERS_BPS = [125, 225, 325, 425, 575] as const;
export type TaxTierBps = (typeof TAX_TIERS_BPS)[number];

/** The coin's part of every tier, in bps of the tier, where the split is 70 / 30 (EVM chains, Meteora after the venue's cut, Pump). */
export const COIN_SHARE_BPS = 7_000;
/** Just Stealth It's part of every tier, in bps of the tier, where the split is 70 / 30. */
export const PLATFORM_SHARE_BPS = 3_000;

/**
 * The anti-sniper rate, in pips (1/1,000,000), at `elapsedSec` after launch, as the EVM hook computes it: 90% in the launch's own second,
 * then one straight step down per whole second to the tier at 15 s.
 *
 * `rate = 90% − (90% − tier) × floor(seconds) / 15`
 */
export function sniperFeePips(tierBps: number, elapsedSec: number): number {
  const tier = tierBps * 100;
  if (!(elapsedSec >= 0)) return SNIPER_START_BPS * 100;
  if (elapsedSec >= SNIPER_WINDOW_SEC) return tier;
  const start = SNIPER_START_BPS * 100;
  return start - Math.floor(((start - tier) * Math.floor(elapsedSec)) / SNIPER_WINDOW_SEC);
}

/** The anti-sniper rate in bps (fractional): `sniperFeeBps(125, 14)` → 716.67, which the docs round to 7.17%. */
export function sniperFeeBps(tierBps: number, elapsedSec: number): number {
  return sniperFeePips(tierBps, elapsedSec) / 100;
}

/** One row per second of the window, `0` to `15`: what a trade pays then. Handy for a chart or a warning. */
export function sniperSchedule(tierBps: number): { second: number; feeBps: number }[] {
  return Array.from({ length: SNIPER_WINDOW_SEC + 1 }, (_, second) => ({ second, feeBps: sniperFeeBps(tierBps, second) }));
}

/** Seconds left before the anti-sniper window closes, from a launch time in unix seconds. `0` once it's over. */
export function sniperSecondsLeft(launchTimeSec: number, nowSec: number = Date.now() / 1000): number {
  return Math.max(0, launchTimeSec + SNIPER_WINDOW_SEC - nowSec);
}

/** Whether a venue has the anti-sniper window. Pump.fun and Raydium LaunchLab don't. */
export const hasSniperWindow = (venue: "pump" | "raydium" | "meteora" | "evm") => venue === "meteora" || venue === "evm";

/** How a trade's fee splits, in base units of what it's paid in. */
export interface FeeSplit {
  /** Everything the trade pays. */
  total: bigint;
  /** The venue's own cut (Raydium, Meteora), or the DEX protocol fee if you pass one. */
  protocol: bigint;
  /** Just Stealth It's part. */
  platform: bigint;
  /** The coin's part: what its launch type spends. */
  coin: bigint;
}

/**
 * Splits an EVM trade's fee the way the fee vault books it: the coin gets 70% of the tier, Just Stealth It the rest of the tier and
 * everything above it (the anti-sniper surplus).
 *
 * @param amount What the trade pays in, base units.
 * @param tierBps The coin's tier.
 * @param chargedBps What the trade was charged: the tier, or the sniper rate inside the window. Default the tier.
 */
export function splitEvmFee(amount: bigint, tierBps: number, chargedBps: number = tierBps): FeeSplit {
  const pips = (bps: number) => BigInt(Math.round(bps * 100));
  const total = (amount * pips(chargedBps)) / 1_000_000n;
  const coin = (amount * pips(tierBps) * BigInt(COIN_SHARE_BPS)) / (1_000_000n * 10_000n);
  return { total, protocol: 0n, coin, platform: total - coin };
}

/** Splits a Solana curve trade's fee by a venue tier (`RAYDIUM_TIERS`, `METEORA_TIERS`). Anti-sniper surplus on Meteora splits pro rata. */
export function splitTierFee(amount: bigint, tier: SolanaTier, chargedBps: number = tier.totalBps): FeeSplit {
  const total = (amount * BigInt(Math.round(chargedBps * 100))) / 1_000_000n;
  const t = BigInt(tier.totalBps);
  const platform = (total * BigInt(tier.platformBps)) / t;
  const coin = (total * BigInt(tier.creatorBps)) / t;
  return { total, protocol: total - platform - coin, platform, coin };
}

/** Splits a Pump.fun creator fee as every launch locks it on chain: 70% to the coin's escrow, 30% to Just Stealth It. */
export function splitPumpCreatorFee(creatorFee: bigint): { coin: bigint; platform: bigint } {
  const coin = (creatorFee * BigInt(PUMP_SHARES.escrowBps)) / 10_000n;
  return { coin, platform: creatorFee - coin };
}

/** What a coin earns of each trade, in bps of the trade, per venue and tier. Raydium is 50 on every tier (Raydium caps it). */
export function coinRateBps(venue: "evm" | "meteora" | "raydium", tierBps: number): number {
  if (venue === "evm") return (tierBps * COIN_SHARE_BPS) / 10_000;
  const tiers = venue === "raydium" ? RAYDIUM_TIERS : METEORA_TIERS;
  const t = tiers.find((x) => x.totalBps === tierBps);
  if (!t) throw new RangeError(`No ${venue} tier at ${tierBps} bps.`);
  return t.creatorBps;
}

/** The whole fee table of the docs: per tier, the coin's rate on each venue. */
export function feeTable(): { tierBps: number; evm: number; meteora: number; raydium: number }[] {
  return TAX_TIERS_BPS.map((tierBps) => ({ tierBps, evm: coinRateBps("evm", tierBps), meteora: coinRateBps("meteora", tierBps), raydium: coinRateBps("raydium", tierBps) }));
}

/** Applies slippage to an expected output: the least a trade should accept. */
export function minOut(amountOut: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new RangeError("slippageBps is 0 to 9,999.");
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** Applies slippage to an expected input, rounding up: the most a trade should spend. */
export function maxIn(amountIn: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new RangeError("slippageBps is 0 to 9,999.");
  return (amountIn * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n;
}
