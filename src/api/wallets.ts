/**
 * Wallet analytics for Solana wallets: PnL on launchpad coins, their trades, rewards owed and paid, and a trading profile.
 * `*Wei` strings are 18-decimal fixed point (lamports × 1e9, token base units × 1e12), kept as the API sends them;
 * {@link weiToNumber} turns one into a float.
 *
 * @module
 */
import type { ApiClient, RequestOptions } from "../shared/api.js";
import { StealthInputError } from "../shared/errors.js";
import { paginate, type PaginateOptions, type Paginator } from "../shared/paginate.js";
import { isSolanaAddress } from "../utils/address.js";
import type { SolApiToken } from "./common.js";
import type { WalletPosition } from "./evm.js";
import type { RewardAsset } from "./sol.js";

export type PnlRange = "1d" | "7d" | "30d" | "all";

export interface WalletPnl {
  range: PnlRange;
  updatedAt: number;
  /** SOL in USD. */
  ethUsd: number;
  summary: {
    ethBalanceWei: string | null;
    tokenValueUsd: number;
    totalBalanceUsd: number;
    volumeUsd: number;
    realizedUsd: number;
    unrealizedUsd: number;
    totalPnlUsd: number;
    totalPnlPct: number | null;
  };
  positions: WalletPosition[];
}

export interface WalletTrade {
  id: string;
  token: string;
  name: string;
  symbol: string;
  logo: string | null;
  hidden: boolean;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  timestamp: number;
  kind: "trade" | "dev_buy";
  side: "buy" | "sell";
  ethWei: string;
  tokenWei: string;
  feeWei: string;
  priceEth: number;
  ethUsd: number;
  priceUsd: number;
  valueUsd: number;
  marketCapUsd: number;
}

export interface WalletRewards {
  totalUsd: number;
  byAsset: { asset: RewardAsset; amount: string; usd: number | null }[];
  owed: { mint: string; symbol: string; asset: RewardAsset; amount: string; usd: number | null }[];
  recent: { mint: string; symbol: string; asset: RewardAsset; amount: string; usd: number | null; at: number; sig: string }[];
}

export type AnalyticsStatus = "ready" | "not_configured" | "unavailable";

export interface WalletStats {
  realizedUsd: number | null;
  unrealizedUsd: number | null;
  winRatePct: number | null;
  costUsd: number | null;
  buys: number | null;
  sells: number | null;
  pnlMultiple: number | null;
  tokens: number | null;
  avgHoldSec: number | null;
  buckets: { lt50: number; neg: number; x0to2: number; x2to5: number; gt5: number } | null;
}

export type ActivityType = "buy" | "sell" | "transferIn" | "transferOut" | "add" | "remove" | "claimFee" | "other";

export interface WalletActivity {
  tx: string | null;
  type: ActivityType;
  token: { address: string | null; symbol: string | null; name: string | null; logo: string | null };
  costUsd: number | null;
  tokenAmount: number | null;
  priceUsd: number | null;
  buyCostUsd: number | null;
  timestamp: number | null;
  launchpad: string | null;
  gasUsd: number | null;
  prioritySol: number | null;
  tipSol: number | null;
  closed: boolean | null;
}

export interface BigWin {
  token: { address: string; symbol: string | null; name: string | null; logo: string | null; launchpad: string | null };
  boughtUsd: number | null;
  soldUsd: number | null;
  realizedUsd: number;
  multiple: number;
  closed: boolean | null;
  lastAt: number | null;
  partial: boolean;
}

export interface TradingStyle {
  trades: number;
  buys: number;
  sells: number;
  tippedPct: number | null;
  priorityPct: number | null;
  avgTipSol: number | null;
  avgPrioritySol: number | null;
  avgGasUsd: number | null;
  avgTradeUsd: number | null;
  medianTradeUsd: number | null;
  largestTradeUsd: number | null;
  tradesPerDay: number | null;
  from: number | null;
  to: number | null;
  launchpads: { name: string; trades: number; pct: number }[];
  activeHoursUtc: number[];
  weekendPct: number | null;
  execution: "terminal" | "wallet" | "mixed" | "unknown";
  closingSellsPct: number | null;
}

export interface WalletAnalysis {
  source: "holdings" | "activity";
  wins: { wins: BigWin[]; coins: number; profitable: number | null; losing: number | null; winsUsd: number };
  style: TradingStyle | null;
  routes: { id: string; name: string; trades: number; pct: number }[] | null;
  jitoPct: number | null;
  txsLookedAt: number;
  rows: number;
  coverage: { from: number | null; to: number | null; exhausted: boolean };
  reason: string | null;
}

export type WalletPeriod = { realizedUsd: number | null; costUsd: number | null; roiPct: number | null; buys: number | null; sells: number | null } | null;

/** A wallet's headline figures from the market analytics feed. */
export interface WalletMarketFigures {
  status: AnalyticsStatus;
  updatedAt: number | null;
  stale: boolean;
  reason: string | null;
  periods: Record<PnlRange, WalletPeriod>;
  stats: Record<"7d" | "30d", WalletStats | null>;
  unrealizedUsd: number | null;
  totalProfitUsd: number | null;
  activity?: WalletActivity[];
}

/** A wallet's public profile: identity, leaderboard ranks, headline PnL and, when fresh, an analysis. */
export interface WalletProfile {
  wallet: string;
  identity: { name: string | null; twitter: string | null; telegram: string | null; avatar: string | null; tags: string[] };
  boards: { source: string; range: "7d" | "30d"; rank: number; pnlUsd: number | null }[];
  links: Record<string, string>;
  /** Headline figures from the market analytics feed. */
  market: WalletMarketFigures;
  analysis: WalletAnalysis | null;
  analysisAt: number | null;
  /** `false`: call {@link SolWalletsApi.analysis} for a fresh one. */
  analysisFresh: boolean;
}

export interface Holding {
  token: SolApiToken;
  balance: number;
  valueEth: number;
  valueUsd: number;
  costBasisEth: number;
  pnlEth: number;
  pnlUsd: number;
  pnlPct: number;
}

/** Holdings and launches of launchpad coins only; not a general wallet portfolio. */
export interface Portfolio {
  owner: string;
  /** SOL. */
  ethBalance: number;
  holdings: Holding[];
  launches: { token: SolApiToken; fees: { unclaimedEth: number; claimedEth: number; recipient: string; pendingRecipient: string | null } }[];
  incomingOffers: unknown[];
  totals: { holdingsUsd: number; pnlUsd: number; claimableEth: number };
}

const wallet = (w: string) => {
  if (!isSolanaAddress(w)) throw new StealthInputError(`${w} isn't a Solana address.`);
  return w;
};

/** An 18-decimal `*Wei` string as a float. */
export const weiToNumber = (wei: string | null | undefined) => (wei ? Number(BigInt(wei)) / 1e18 : 0);

/** Solana wallet reads. */
export class SolWalletsApi {
  constructor(private readonly api: ApiClient) {}

  /** PnL on launchpad coins over a range. Default `all`. */
  async pnl(address: string, range: PnlRange = "all", opts?: RequestOptions) {
    return this.api.get<WalletPnl>(`/sol/wallets/${wallet(address)}/pnl`, { range }, opts);
  }

  /** One page of the wallet's trades on launchpad coins, newest first. `limit` 1 to 100, default 50. */
  async trades(address: string, o: { cursor?: string; limit?: number; token?: string } = {}, opts?: RequestOptions) {
    return this.api.get<{ items: WalletTrade[]; nextCursor: string | null }>(`/sol/wallets/${wallet(address)}/trades`, o, opts);
  }

  /** Every trade, newest first. */
  iterateTrades(address: string, o: { limit?: number; token?: string } = {}, p: PaginateOptions = {}): Paginator<WalletTrade> {
    return paginate((cursor, signal) => this.trades(address, { ...o, cursor }, { signal }), p);
  }

  /** Rewards paid and owed, by asset. */
  async rewards(address: string, opts?: RequestOptions) {
    return this.api.get<WalletRewards>(`/sol/wallets/${wallet(address)}/rewards`, undefined, opts);
  }

  /** The wallet's profile. `refresh` re-reads a headline older than a couple of minutes. */
  async analytics(address: string, refresh = false, opts?: RequestOptions): Promise<WalletProfile> {
    // the wire names the figures after their data source; the SDK gives them a neutral name
    const raw = await this.api.get<Omit<WalletProfile, "market"> & { market?: WalletMarketFigures; [k: string]: unknown }>(`/sol/wallets/${wallet(address)}/analytics`, { refresh: refresh ? 1 : undefined }, opts);
    const wire = Object.keys(raw).find((k) => k !== "market" && /^g[a-z]{2}n$/.test(k) && typeof raw[k] === "object");
    const { [wire ?? "market"]: figures, ...rest } = raw as Record<string, unknown>;
    return { ...(rest as Omit<WalletProfile, "market">), market: (raw.market ?? figures) as WalletMarketFigures };
  }

  /** The last 20 on-chain actions, newest first. */
  async activity(address: string, opts?: RequestOptions) {
    return this.api.get<{ status: AnalyticsStatus; updatedAt: number | null; stale: boolean; reason: string | null; activity: WalletActivity[] }>(
      `/sol/wallets/${wallet(address)}/analytics/activity`,
      undefined,
      opts,
    );
  }

  /** Wins, trading style and routes. Built on demand and kept about a day. */
  async analysis(address: string, opts?: RequestOptions) {
    return this.api.get<{ status: AnalyticsStatus; updatedAt: number | null; stale: boolean; reason: string | null; analysis: WalletAnalysis | null }>(
      `/sol/wallets/${wallet(address)}/analytics/analysis`,
      undefined,
      opts,
    );
  }

  /** Holdings and launches of launchpad coins. */
  async portfolio(owner: string, opts?: RequestOptions) {
    return this.api.get<Portfolio>(`/sol/portfolio/${wallet(owner)}`, undefined, opts);
  }
}
