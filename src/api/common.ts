/**
 * Types shared by the API's Solana, EVM and cross-chain lists.
 *
 * A note on names: fields ending in `Eth` (`priceEth`, `ethAmount`, `feeEth`, `raisedEth`, `volumeEth`) hold the chain's **native coin**:
 * SOL on Solana, ETH / BNB / HYPE / USDC on EVM. The API keeps the historic names, and so does the SDK, so a row reads the same here
 * as on the wire.
 *
 * @module
 */
import { StealthApiError } from "../shared/errors.js";

/** A coin's stage on the board. */
export type TokenStage = "new" | "graduating" | "migrated";
export const TOKEN_STAGES = ["new", "graduating", "migrated"] as const satisfies readonly TokenStage[];

/** How a coin list can be sorted. */
export type TokenSortKey =
  | "age"
  | "price"
  | "marketCap"
  | "liquidity"
  | "volume"
  | "txns"
  | "holders"
  | "change5m"
  | "change1h"
  | "change24h"
  | "progress"
  | "tax"
  | "lastTrade"
  | "migrated";

/** Candle sizes the launchpad's own charts serve, on Solana and EVM alike. */
export type CandleInterval = "1s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1D";
export const CANDLE_INTERVALS = ["1s", "1m", "5m", "15m", "1h", "4h", "1D"] as const satisfies readonly CandleInterval[];
/** Seconds per candle. */
export const CANDLE_SECONDS: Record<CandleInterval, number> = { "1s": 1, "1m": 60, "5m": 300, "15m": 900, "1h": 3_600, "4h": 14_400, "1D": 86_400 };

/** A cursor-paged list. `cursor` / `nextCursor` are opaque strings: pass them back as they came. */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  /** The filtered total where the server counts it. On trades it's only "rows seen so far": rely on `nextCursor`. */
  total: number;
}

export interface TokenSocials {
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;
  farcaster?: string;
}

/** The fields every launchpad coin has, on any chain. */
export interface BaseToken {
  address: string;
  launcher: string;
  creator: string;
  feeRecipient: string;
  name: string;
  symbol: string;
  description: string;
  logoUrl: string | null;
  socials: TokenSocials;
  /** Unix ms. */
  createdAt: number;
  /** Slot on Solana, block on EVM. */
  launchBlock: number;
  decimals: number;
  /** Whole tokens. */
  totalSupply: number;
  burnedTokens?: number;
  circulatingSupply?: number;
  taxBps: number;
  sniperWindowSec: number;
  sniperTaxBps: number;
  poolId: string;
  status: TokenStage;
  /** Native coin per token. */
  priceEth: number;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  txns24h: { buys: number; sells: number };
  holders: number;
  /** Percent changes. */
  change: { m5: number; h1: number; h24: number };
  graduation: {
    /** Native coin raised on the curve. */
    raisedEth: number;
    targetEth: number;
    chosenTargetEth: number;
    /** 0 to 1. */
    progress: number;
    migrated: boolean;
    migratedAt: number | null;
    migratedTx: string | null;
  };
  /** Unix ms. */
  lastTradeAt: number | null;
}

/** A social account a coin pays, when it has one. */
export interface TokenSocialRecipient {
  provider: string;
  handle: string;
  vault: string | null;
  avatarUrl: string | null;
  claimed: boolean;
}

/** The Solana half of a Solana coin. */
export interface SolTokenExtra {
  chain: "solana";
  network: string;
  /** The program family: Pump.fun, Raydium LaunchLab or Meteora DBC. */
  kind: "pump" | "launchlab" | "meteora";
  venue: "pump" | "raydium" | "meteora" | null;
  taxTier: string | null;
  globalTaxBps: number;
  pool: string;
  ammPool: string | null;
  escrow: string;
  recipientKind: "wallet" | "social";
  recipientWallet: string | null;
  social: TokenSocialRecipient | null;
  poolFeeBps: number;
  launchSig: string | null;
  /** Indexed, but launched elsewhere. */
  external: boolean;
  /** The platform's own coin. */
  official: boolean;
  onchainSymbol: string | null;
  tradable: boolean;
  tradeReason: "non_sol_quote" | null;
  tradeMessage: string | null;
  quoteMint: string | null;
  quoteSymbol: string | null;
  /**
   * Which swap route trades it: `"app"` → `sol.quote` / `StealthSolana.buy`; `"jupiter"` → `sol.market.quote` / `StealthSolana.marketBuy`.
   * `null`: not tradable here.
   */
  swapVia: "app" | "jupiter" | null;
  pair: { mint: string; symbol: string | null; kind: string | null; creatorFeeBps: number | null } | null;
  feeMode: string;
  feeShares: { creatorBps: number; marketingBps: number };
  feePlan: SolFeePlanSummary | null;
}

export interface SolFeePlanSummary {
  slices: Array<{
    kind: string;
    bps: number;
    team?: unknown;
    wallet?: { chainId: number; chain: string; address: string; symbol: string; currency: string; fallback: boolean };
    feed?: { mint: string; symbol: string | null };
    liquidity?: { wallet: string };
  }>;
}

/** The EVM half of an EVM coin. */
export interface EvmTokenExtra {
  chain: string;
  chainId: number;
  native: string;
  launchType: "creator" | "team" | "marketing" | "holders" | "buyback" | "pot";
  rules: number;
  dex: "v4" | "infinity";
  feeVault: string;
  settlement: string;
  /** Detail only. `false`: the fee figures are unknown, not zero. */
  feesRead?: boolean;
  autoClaims?: boolean;
  social?: TokenSocialRecipient | null;
}

/** A Solana coin as `/sol/*` returns it. */
export interface SolApiToken extends BaseToken {
  sol: SolTokenExtra;
  [field: string]: unknown;
}

/** An EVM coin as `/evm/chains/:chain/*` returns it. */
export interface EvmApiToken extends BaseToken {
  feeMode: string;
  hidden?: boolean;
  evm: EvmTokenExtra;
  [field: string]: unknown;
}

/** A coin from the cross-chain list: one of the two halves is set. */
export interface MarketToken extends BaseToken {
  sol?: SolTokenExtra;
  evm?: EvmTokenExtra;
  feeMode?: string;
  hidden?: boolean;
  [field: string]: unknown;
}

/** A trade on a launchpad coin. Amounts are display floats; `ethAmount` and `feeEth` are in the native coin. */
export interface ApiTrade {
  /** `${signature}:${seq}` on Solana, `${txHash}:${logIndex}` on EVM. */
  id: string;
  token: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  kind: "trade" | "dev_buy";
  trader: string;
  side: "buy" | "sell";
  ethAmount: number;
  tokenAmount: number;
  priceEth: number;
  priceUsd: number;
  valueUsd: number;
  feeEth: number;
  /** Fee rate in pips (1/1,000,000). */
  feePips: number;
  sqrtPriceX96: string;
  sniperTaxed: boolean;
  isCreatorLaunchBuy: boolean;
  /** Unix ms. */
  timestamp: number;
}

/** A candle. `time` is the bucket start in unix seconds; prices are native coin per token; `volume` is USD. */
export interface ApiCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  volumeEth: number;
}

/** Filters every coin list takes. */
export interface TokenFilters {
  /** Name or symbol (case-insensitive), or an address prefix. A leading `$` is ignored. */
  q?: string;
  /** Minimum market cap, USD. */
  mcap?: number;
  /** Minimum 24 h volume, USD. */
  vol?: number;
  /** Only coins with at least one social link. */
  socials?: boolean;
}

export interface TokenListOptionsBase extends TokenFilters {
  /** Stages to include. */
  stages?: TokenStage[] | string;
  sort?: TokenSortKey;
  /** Default `asc` for `age` (newest first), `desc` for every other sort. */
  dir?: "asc" | "desc";
  cursor?: string;
}

/** Search results keep at most this many. */
export const SEARCH_LIMIT_MAX = 20;

export const stagesParam = (s: TokenStage[] | string | undefined) => (Array.isArray(s) ? s.join(",") : s);
export const flag = (b: boolean | undefined) => (b ? 1 : undefined);

/** 404 → null, for lookups where "none" is a normal answer. */
export async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (error) {
    if (error instanceof StealthApiError && error.status === 404) return null;
    throw error;
  }
}
