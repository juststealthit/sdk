/**
 * $STEALTH staking reads and the raw prepare / submit calls. To stake from a wallet in one call, use `StealthSolana.stake` /
 * `unstake`, which prepare, check, sign and submit.
 *
 * The flow: `prepareStake` returns a legacy transaction the staking wallet has already co-signed. Your wallet adds its signature,
 * without changing anything else, and `submit` sends it. An unstake is released by the server after the pool's cooldown, with its
 * reward; there's nothing to call for that.
 *
 * @module
 */
import type { ApiClient, RequestOptions } from "../shared/api.js";
import { StealthInputError } from "../shared/errors.js";
import { estimateStakingReward, type StakingBoost } from "../math/staking.js";

export interface StakePool {
  id: string;
  name: string;
  symbol: string;
  receiptSymbol: string;
  mint: string;
  receiptMint: string;
  decimals: number;
  /** Today's base rate. It can change. */
  aprBps: number;
  boosts: StakingBoost[];
  /** How long an unstake waits before release. */
  cooldownSec: number;
  /** SOL a new position's escrow is topped up with, returned when the last unstake is released. */
  depositLamports: number;
  /** Base units. */
  minAmount: string;
  totalStaked: string;
  stakers: number;
  /** What the reward pool can still pay, base units. */
  rewardPool: string;
}

export interface StakingOverview {
  enabled: boolean;
  network?: string;
  pools: StakePool[];
}

export interface StakePosition {
  owner: string;
  escrow: string | null;
  staked: string;
  unstaking: string;
  /** Accrued up to the request. */
  rewardEarned: string;
  rewardPaid: string;
  openedAt: number | null;
  boostBps: number;
  nextBoost: { multBps: number; at: number } | null;
  wallet: { stake: string; receipt: string };
  needsDeposit: boolean;
  unstakes: { id: number; amount: string; reward: string; unlockAt: number | null; status: "waiting" | "sending" | "released"; sig: string | null; releaseSig: string | null }[];
  history: { id: number; kind: "stake" | "unstake" | "release"; amount: string; reward?: string; at: number | null; sig: string | null }[];
}

/** An unsigned-by-you, co-signed legacy transaction. */
export interface PreparedStake {
  actionId: number;
  transaction: string;
  depositLamports: number;
  escrow: string;
}

export interface PreparedUnstake {
  actionId: number;
  transaction: string;
  unlockInSec: number;
}

export interface StakeSubmitResult {
  signature: string;
  /** `sent`: not confirmed in time; the server settles it later. */
  status: "confirmed" | "sent";
}

const amountParam = (amount: bigint | string) => {
  const s = amount.toString();
  if (!/^\d{1,30}$/.test(s) || BigInt(s) <= 0n) throw new StealthInputError("amount is a positive integer of base units.");
  return s;
};

/** Staking reads and raw writes. */
export class StakingApi {
  constructor(private readonly api: ApiClient) {}

  /** Pools, rates, boosts and totals. `{ enabled: false, pools: [] }` while staking is off. */
  async overview(opts?: RequestOptions) {
    return this.api.get<StakingOverview>("/staking", undefined, opts);
  }

  /** One pool, or `null`. Default `stealth`. */
  async pool(id = "stealth", opts?: RequestOptions): Promise<StakePool | null> {
    return (await this.overview(opts)).pools.find((p) => p.id === id) ?? null;
  }

  /** A wallet's position. Never cached. */
  async position(pool: string, owner: string, opts?: RequestOptions) {
    return this.api.get<StakePosition>(`/staking/${encodeURIComponent(pool)}/positions/${owner}`, undefined, { cache: false, ...opts });
  }

  /** Builds a stake of `amount` base units. */
  async prepareStake(pool: string, owner: string, amount: bigint | string, opts?: RequestOptions) {
    return this.api.post<PreparedStake>(`/staking/${encodeURIComponent(pool)}/stake`, { owner, amount: amountParam(amount) }, opts);
  }

  /** Builds an unstake of `amount` base units of receipts. */
  async prepareUnstake(pool: string, owner: string, amount: bigint | string, opts?: RequestOptions) {
    return this.api.post<PreparedUnstake>(`/staking/${encodeURIComponent(pool)}/unstake`, { owner, amount: amountParam(amount) }, opts);
  }

  /** Sends a prepared action, signed by the owner. Submitting a confirmed action again returns it as confirmed. */
  async submit(actionId: number, signedTransaction: string, opts?: RequestOptions) {
    if (!Number.isSafeInteger(actionId) || actionId <= 0) throw new StealthInputError("actionId is a positive integer.");
    return this.api.post<StakeSubmitResult>(`/staking/actions/${actionId}/submit`, { transaction: signedTransaction }, opts);
  }

  /** What `amount` would earn in `pool` over `days` at today's rate and boosts. An estimate, not a promise. */
  estimate(pool: Pick<StakePool, "aprBps" | "boosts">, amount: bigint, days: number): bigint {
    return estimateStakingReward(amount, pool.aprBps, pool.boosts, days);
  }
}
