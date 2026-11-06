/**
 * Any Solana token, not only launchpad coins: a coin page, USD candles, trending coins and launchers, and Jupiter-routed quotes and
 * swaps. The swap transaction is built by the API and signed by your wallet; see `StealthSolana.marketBuy` / `marketSell`.
 *
 * Market data comes from third-party feeds, so a read can come back `status: "unavailable"` or `stale: true` rather than throwing.
 *
 * @module
 */
import type { ApiClient, RequestOptions } from "../shared/api.js";
import { StealthInputError } from "../shared/errors.js";
import { isSolanaAddress } from "../utils/address.js";
import { requireLiveChain } from "../utils/chains.js";
import { DEFAULT_CANDLE_INTERVAL, normalizeCandleInterval, type CandleInterval } from "./common.js";

export type MarketStatus = "ready" | "loading" | "not_configured" | "unavailable";
/** Candle sizes the market route serves (external coins and any Solana token). The day is a lowercase `1d` here. */
export type MarketCandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export const MARKET_CANDLE_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const satisfies readonly MarketCandleInterval[];

/** The market route's name for a launchpad interval: `1D` → `1d`, the rest unchanged. `1s` (gone) becomes `1m`. */
export function toMarketCandleInterval(interval: CandleInterval | MarketCandleInterval | string): MarketCandleInterval {
  const i = normalizeCandleInterval(interval) ?? DEFAULT_CANDLE_INTERVAL;
  return (i === "1D" ? "1d" : i) as MarketCandleInterval;
}

/** The launchpad's name for a market interval: `1d` → `1D`. */
export function fromMarketCandleInterval(interval: MarketCandleInterval | CandleInterval | string): CandleInterval {
  return normalizeCandleInterval(interval) ?? DEFAULT_CANDLE_INTERVAL;
}

/** Where a market read looks: Solana by default; an external EVM coin needs its chain. */
export interface MarketCoinOptions {
  /** A live chain key. Default `solana`. Required for a 0x address. */
  chain?: string;
}

export interface MarketCoin {
  address: string;
  symbol: string;
  name: string;
  logo: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  athMarketCapUsd: number | null;
  liquidityUsd: number | null;
  volumeUsd: number | null;
  /** Percent. */
  changePct: number | null;
  holders: number | null;
  swaps: number | null;
  /** Unix ms. */
  createdAt: number | null;
  launchpad: string | null;
  creator: string | null;
  twitter: string | null;
  website: string | null;
  telegram: string | null;
  smartWallets: number | null;
  kolWallets: number | null;
  /** 0 to 100. */
  top10Pct: number | null;
  onCurve: boolean | null;
  /** On trending lists: the ranking's extra figures, when the source has them. */
  change5mPct?: number | null;
  change1hPct?: number | null;
  buys?: number | null;
  sells?: number | null;
  supply?: number | null;
  gasFee?: number | null;
  lpBurned?: boolean | null;
  lpLockedPct?: number | null;
}

export interface TrendingCoin extends MarketCoin {
  /** Also launched on Just Stealth It. */
  onPlatform: boolean;
}

export interface FeeShareSummary {
  launchpad: string | null;
  locked: boolean | null;
  holders: { wallet: string | null; bps: number; isCreator: boolean; claimed: boolean | null; name: string | null; twitter: string | null; avatar: string | null; platform: string | null }[];
  rewards: string[];
  sharedPct: number;
}

export interface LauncherBest {
  address: string | null;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  athMarketCapUsd: number | null;
}

/** A coin page for any Solana mint, or an external coin on another chain. `est*` figures are estimates. */
export interface MarketCoinDetail extends MarketCoin {
  /** The chain asked for, filled in by the SDK: `solana`, or the EVM chain of an external coin. */
  chain: string;
  onPlatform: boolean;
  decimals: number | null;
  totalSupply: number | null;
  description: string | null;
  discord: string | null;
  volume24hUsd: number | null;
  buys24h: number | null;
  sells24h: number | null;
  change1hPct: number | null;
  change24hPct: number | null;
  /** 0 to 1, while on a bonding curve. */
  curveProgress: number | null;
  creatorHoldPct: number | null;
  sniperWallets: number | null;
  bundlerWallets: number | null;
  launcher: { address: string; graduated: number | null; best: LauncherBest | null } | null;
  feeSharing: FeeShareSummary | null;
  estCreatorFees24hUsd: number | null;
  estSharedFees24hUsd: number | null;
}

/** USD candles. `time` in unix seconds. */
export interface MarketCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}

export interface TrendingResponse {
  status: MarketStatus;
  updatedAt: number | null;
  stale: boolean;
  coins: TrendingCoin[];
}

export interface LauncherRow {
  wallet: string;
  top: Pick<MarketCoin, "address" | "symbol" | "name" | "logo" | "marketCapUsd" | "volumeUsd" | "changePct" | "launchpad"> & { onPlatform: boolean };
  trendingCoins: number;
  trendingVolumeUsd: number;
  launches: number | null;
  graduated: number | null;
  graduationPct: number | null;
  best: LauncherBest | null;
  liveMarketCapUsd: number | null;
  estCreatorFees24hUsd: number | null;
  estSharedFees24hUsd: number | null;
  feeSharing: FeeShareSummary | null;
}

export interface LaunchersBoard {
  status: MarketStatus;
  updatedAt: number | null;
  stale: boolean;
  launchers: LauncherRow[];
  totals: { estCreatorFees24hUsd: number; estSharedFees24hUsd: number; sharingCoins: number; socialShares: number; rewardCoins: number; trendingVolumeUsd: number } | null;
}

export interface LauncherDetail {
  wallet: string;
  launches: number | null;
  graduated: number | null;
  best: LauncherBest | null;
  coins: {
    address: string;
    symbol: string | null;
    logo: string | null;
    marketCapUsd: number | null;
    athMarketCapUsd: number | null;
    liquidityUsd: number | null;
    holders: number | null;
    volume1hUsd: number | null;
    graduated: boolean;
    createdAt: number | null;
    launchpad: string | null;
  }[];
}

/** A Jupiter-routed quote. Buy: SOL in (lamports). Sell: the token's base units in. */
export interface MarketQuote {
  side: "buy" | "sell";
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  /** Percent. */
  priceImpactPct: number | null;
  /** AMM labels along the route. */
  route: string[];
}

/** An unsigned v0 transaction, paid and signed by `owner` only. */
export interface MarketSwap {
  transaction: string;
  quote: MarketQuote;
  lastValidBlockHeight: number | null;
}

const mint = (m: string) => {
  if (!isSolanaAddress(m)) throw new StealthInputError(`${m} isn't a Solana address.`);
  return m;
};
/** A coin address and chain the market route takes: a Solana mint, or a 0x address with its EVM chain (lower-cased, as the API keys it). */
const coinRef = (address: string, chain?: string): { address: string; chain: string | undefined } => {
  const c = chain === undefined ? (/^0x/i.test(address) ? null : "solana") : requireLiveChain(chain).key;
  if (c === null) throw new StealthInputError("A 0x address needs its chain: pass { chain: \"base\" } or another live EVM chain.");
  if (c === "solana") return { address: mint(address), chain: undefined };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new StealthInputError(`${address} isn't an EVM address.`);
  return { address: address.toLowerCase(), chain: c };
};
const slip = (bps: number) => {
  if (!Number.isInteger(bps) || bps < 10 || bps > 5_000) throw new StealthInputError("slippageBps is 10 to 5,000.");
  return bps;
};

const REQUEST_KEYS = ["signal", "timeoutMs", "retry", "cache", "headers"];
/** 0.2 took `RequestOptions` where the market options now go; an object with only those keys is still read that way. */
function legacy<T extends object>(o: T | RequestOptions | undefined, opts: RequestOptions | undefined): [T, RequestOptions | undefined] {
  if (o && opts === undefined) {
    const keys = Object.keys(o);
    if (keys.length && keys.every((k) => REQUEST_KEYS.includes(k))) return [{} as T, o as RequestOptions];
  }
  return [(o ?? {}) as T, opts];
}

/** Jupiter-routed market reads and swap building. */
export class SolMarketApi {
  constructor(private readonly api: ApiClient) {}

  /**
   * A coin page for any Solana mint, or for an external trending coin on another live chain (`{ chain: "bnb" }` with its 0x address).
   * 404 `not_found` for a coin the market data doesn't know.
   */
  async coin(address: string, options: MarketCoinOptions = {}, requestOpts?: RequestOptions) {
    const [o, opts] = legacy<MarketCoinOptions>(options, requestOpts);
    const ref = coinRef(address, o.chain);
    const coin = await this.api.get<Omit<MarketCoinDetail, "chain"> & { chain?: string }>(`/sol/market/coins/${ref.address}`, { chain: ref.chain }, opts);
    return { ...coin, chain: coin.chain ?? ref.chain ?? "solana" } as MarketCoinDetail;
  }

  /**
   * USD candles, oldest first, from the coin's launch where the history is there. Default `1m`, as the site's charts open. `to`
   * (unix seconds) pages back in time: pass the first candle's `time` to get the ones before it. `1D` and `1s` are accepted and
   * read as `1d` and `1m`.
   */
  async candles(address: string, interval: MarketCandleInterval | CandleInterval = "1m", options: MarketCoinOptions & { to?: number } = {}, requestOpts?: RequestOptions) {
    const [o, opts] = legacy<MarketCoinOptions & { to?: number }>(options, requestOpts);
    const ref = coinRef(address, o.chain);
    if (o.to !== undefined && !(Number.isInteger(o.to) && o.to > 0)) throw new StealthInputError("to is a positive unix time in seconds.");
    return this.api.get<MarketCandle[]>(`/sol/market/coins/${ref.address}/candles`, { interval: toMarketCandleInterval(interval), chain: ref.chain, to: o.to }, opts);
  }

  /** Up to 24 trending Solana coins. */
  async trending(opts?: RequestOptions) {
    return this.api.get<TrendingResponse>("/sol/market/trending", undefined, opts);
  }

  /** The launchers behind trending coins. Built in the background: poll while `status` is `"loading"`. */
  async launchers(opts?: RequestOptions) {
    return this.api.get<LaunchersBoard>("/sol/market/launchers", undefined, opts);
  }

  /** One launcher's coins, up to 100. */
  async launcher(wallet: string, opts?: RequestOptions) {
    return this.api.get<LauncherDetail>(`/sol/market/launchers/${mint(wallet)}`, undefined, opts);
  }

  /** A Jupiter-routed quote. The pay side is always SOL. Slippage 10 to 5,000 bps, default 300. */
  async quote(address: string, side: "buy" | "sell", amount: bigint | string, slippageBps = 300, opts?: RequestOptions) {
    return this.api.get<MarketQuote>("/sol/market/quote", { mint: mint(address), side, amount: amount.toString(), slippageBps: slip(slippageBps) }, { cache: false, ...opts });
  }

  /** Builds an unsigned v0 swap for `owner` to sign. Prefer `StealthSolana.marketBuy` / `marketSell`, which check, sign and send it. */
  async buildSwap(o: { mint: string; owner: string; side: "buy" | "sell"; amount: bigint | string; slippageBps?: number }, opts?: RequestOptions) {
    return this.api.post<MarketSwap>("/sol/market/swap", { mint: mint(o.mint), owner: mint(o.owner), side: o.side, amount: o.amount.toString(), slippageBps: slip(o.slippageBps ?? 300) }, opts);
  }
}
