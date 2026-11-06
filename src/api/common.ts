/**
 * Types shared by the API's Solana, EVM and cross-chain lists.
 *
 * A note on names: fields ending in `Eth` (`priceEth`, `ethAmount`, `feeEth`, `raisedEth`, `volumeEth`) hold the chain's **native coin**:
 * SOL on Solana, ETH / BNB / HYPE / USDC on EVM. The API keeps the historic names, and so does the SDK, so a row reads the same here
 * as on the wire.
 *
 * @module
 */
import { StealthApiError, StealthInputError } from "../shared/errors.js";

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

/**
 * Candle sizes the launchpad's own charts serve, on Solana and EVM alike. One minute is the smallest: the platform dropped the
 * 1 second interval, and a candle only forms when someone trades.
 */
export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1D";
export const CANDLE_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1D"] as const satisfies readonly CandleInterval[];
/** What the platform uses when no interval is given. */
export const DEFAULT_CANDLE_INTERVAL: CandleInterval = "1m";
/**
 * Intervals the platform no longer serves. Passing one still works for now: it is read as `1m` (what the API itself answers for
 * them) with a one-time deprecation warning. This list goes in 1.0.
 *
 * @deprecated `1s` candles are gone. Use `1m`.
 */
export const DEPRECATED_CANDLE_INTERVALS = ["1s"] as const;
/** @deprecated `1s` candles are gone. Use `1m`. */
export type DeprecatedCandleInterval = (typeof DEPRECATED_CANDLE_INTERVALS)[number];
/** Seconds per candle. */
export const CANDLE_SECONDS: Record<CandleInterval, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3_600, "4h": 14_400, "1D": 86_400 };

let warnedOneSecond = false;

/**
 * A candle interval the platform serves. `"1s"` (gone) becomes `"1m"` with a one-time warning; `"1d"` is read as `"1D"`; `undefined`
 * stays `undefined` so the API's default applies. Anything else is a {@link StealthInputError}.
 */
export function normalizeCandleInterval(interval: string | undefined | null): CandleInterval | undefined {
  if (interval === undefined || interval === null || interval === "") return undefined;
  if ((CANDLE_INTERVALS as readonly string[]).includes(interval)) return interval as CandleInterval;
  if (interval === "1d") return "1D";
  if ((DEPRECATED_CANDLE_INTERVALS as readonly string[]).includes(interval)) {
    if (!warnedOneSecond) {
      warnedOneSecond = true;
      const p = (globalThis as { process?: { emitWarning?: (m: string, o: { type: string; code: string }) => void } }).process;
      const message = `Candle interval "${interval}" is gone on Just Stealth It; reading 1m candles instead. Pass "1m".`;
      if (p?.emitWarning) p.emitWarning(message, { type: "DeprecationWarning", code: "STEALTH_CANDLE_1S" });
      else console.warn(message);
    }
    return "1m";
  }
  throw new StealthInputError(`interval is one of ${CANDLE_INTERVALS.join(", ")}.`);
}

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

/**
 * An external coin on the All list: trending on its chain, launched elsewhere. Its chain, its launchpad as the data source names
 * it (`Pump.fun`, `letsbonk`, `fourmeme`, ...) and its place in its chain's trending list.
 */
export interface OutsideTokenInfo {
  chain: string;
  launchpad: string | null;
  trendRank: number | null;
}

/**
 * A coin from the cross-chain list: `sol` for a Solana coin launched here, `evm` for an EVM one, `outside` for an external trending
 * coin (All list only). An outside row has no launchpad fields of its own: `launcher`, `creator`, `feeRecipient` and `poolId` can be
 * `""`, `taxBps` and `launchBlock` 0, `graduation` all zeros, and `priceEth` 0 off Solana. Use {@link tokenChain} for its chain.
 */
export interface MarketToken extends BaseToken {
  sol?: SolTokenExtra;
  evm?: EvmTokenExtra;
  outside?: OutsideTokenInfo;
  feeMode?: string;
  hidden?: boolean;
  [field: string]: unknown;
}

/** An external trending coin on the All list (it didn't launch on Just Stealth It). */
export const isOutsideToken = (t: MarketToken): t is MarketToken & { outside: OutsideTokenInfo } => !!t.outside && !t.sol && !t.evm;
/** A Solana coin launched here. */
export const isSolToken = (t: MarketToken): t is MarketToken & { sol: SolTokenExtra } => !!t.sol;
/** An EVM coin launched here. */
export const isEvmToken = (t: MarketToken): t is MarketToken & { evm: EvmTokenExtra } => !!t.evm;

/** The chain key of any coin row: `evm.chain`, `outside.chain`, else `solana`. */
export function tokenChain(t: { evm?: { chain?: string } | null; outside?: { chain?: string } | null; sol?: unknown }): string {
  return t.evm?.chain || t.outside?.chain || "solana";
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
