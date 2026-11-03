/**
 * The marketing ladder's shapes, the same on Solana and every EVM chain: a Marketing coin's fees fill a pot that buys promotion tiers
 * in order.
 *
 * @module
 */

export interface CoinRef {
  address: string;
  name: string;
  symbol: string;
  logoUrl: string | null;
}

export type TierStatus = "completed" | "processing" | "ready" | "funding" | "upcoming";

export interface MarketingTier {
  key: string;
  label: string;
  category: string;
  costUsd: number;
  /** 1-based order on the ladder. */
  step: number;
}

export interface MarketingOverview {
  recentlyCompleted: { coin: CoinRef; tier: { key: string; label: string; category: string; costUsd: number }; proofUrl: string | null; completedAt: number }[];
  closest: {
    coin: CoinRef;
    potUsd: number;
    availableUsd: number;
    boosted: boolean;
    tier: { key: string; label: string; category: string; costUsd: number; status: TierStatus; progress: number };
    remainingUsd: number;
    completed: number;
  }[];
  totals: { coins: number; potUsd: number; completed: number };
  updatedAt: number;
}

export interface MarketingSummary {
  items: {
    mint: string;
    boosted: boolean;
    completed: number;
    latest: { key: string; label: string; category: string } | null;
    next: { key: string; label: string; category: string; status: TierStatus; progress: number } | null;
  }[];
  updatedAt: number;
}

export interface MarketingLeaderboard {
  range: "7d" | "30d" | "all";
  from: number;
  to: number;
  rows: { rank: number; coin: CoinRef; launcher: string; raisedUsd: number; spentUsd: number; tiersBought: number; boosted: boolean; next: { label: string } | null }[];
}

/** One coin's ladder. */
export interface CoinMarketing {
  mint: string;
  potUsd: number;
  spentUsd: number;
  availableUsd: number;
  boosted: boolean;
  tiers: { key: string; label: string; category: string; costUsd: number; status: TierStatus; progress: number; completedAt: number | null; proofUrl: string | null }[];
  next: { key: string; label: string; costUsd: number; remainingUsd: number } | null;
  updatedAt: number;
}

export interface CoinMarketingRank {
  rank: number | null;
  previous: number | null;
  of: number;
  averageUsd: number;
  neighbors: { rank: number; coin: CoinRef; raisedUsd: number }[];
}

export type CoinMarketingEvent =
  | { kind: "unlocked"; at: number; tier: { key: string; label: string }; costUsd: number; url: null }
  | { kind: "bought"; at: number; tier: { key: string; label: string }; costUsd: number; url: string | null }
  | { kind: "x_post"; at: number; tier: { key: string; label: string } | null; costUsd: null; url: string | null };

export interface CoinMarketingStats {
  mint: string;
  boosted: boolean;
  raised7d: number;
  raisedPrev7d: number;
  raised30d: number;
  raisedPrev30d: number;
  raisedAll: number;
  spentAll: number;
  availableUsd: number;
  daily: { day: string; at: number; raisedUsd: number }[];
  rank: Record<"7d" | "30d" | "all", CoinMarketingRank>;
  platformAveragePot: number;
  platformCoins: number;
  events: CoinMarketingEvent[];
  updatedAt: number;
}

export type MarketingDay = { day: string; usd: number };
export type MarketingPeriod = { from: string; to: string; raised: number[]; spent: number[]; raisedUsd: number; spentUsd: number };
export type MarketingRhythm = { from: string; to: string; usd: number[]; raisedUsd: number; tiersBought: number; coins: number; avgPerCoinUsd: number };

export interface MarketingAnalytics {
  raised30d: MarketingDay[];
  spent30d: MarketingDay[];
  raised30dUsd: number;
  spent30dUsd: number;
  prior: MarketingPeriod[];
  byCoin: {
    range: "7d" | "30d" | "all";
    raisedUsd: number;
    priorUsd: number | null;
    coins: number;
    top: { coin: CoinRef; feeMode: string; raisedUsd: number; tiersBought: number }[];
    other: { coins: number; raisedUsd: number };
    groups: { feeMode: string; raisedUsd: number; coins: number }[];
  }[];
  byWeekday: { periodDays: number; current: MarketingRhythm; previous: MarketingRhythm };
  byMonth: { months: string[]; current: number[]; previous: number[] } | null;
  campaigns: {
    coin: CoinRef;
    feeMode: string;
    launchedAt: number | null;
    tier: { key: string; label: string; category: string; costUsd: number };
    status: "funding" | "ready" | "processing";
    progress: number;
    potUsd: number;
    availableUsd: number;
    remainingUsd: number;
    ready: boolean;
    tiersBought: number;
  }[];
  firstRaisedAt: number | null;
  updatedAt: number;
}
