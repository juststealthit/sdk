/**
 * Solana reads through the API: the board, a coin's candles, trades, holders, risk and fee books, burns, leaderboards and the
 * marketing ladder. Launches and trades that need a signature live on `StealthSolana` (`@juststealthit/sdk/solana`).
 *
 * @module
 */
import type { ApiClient, RequestOptions } from "../shared/api.js";
import { StealthInputError } from "../shared/errors.js";
import { paginate, type PaginateOptions, type Paginator } from "../shared/paginate.js";
import { isSolanaAddress } from "../utils/address.js";
import { flag, orNull, stagesParam, type ApiCandle, type ApiTrade, type CandleInterval, type CursorPage, type SolApiToken, type TokenFilters, type TokenListOptionsBase, type TokenStage } from "./common.js";
import type { CoinMarketing, CoinMarketingStats, MarketingLeaderboard, MarketingOverview, MarketingSummary, MarketingTier } from "./marketing.js";
import { SolMarketApi } from "./sol-market.js";
import { SolWalletsApi } from "./wallets.js";

export type FeatureState = "ready" | "not_configured" | "misconfigured" | "disabled" | "degraded" | "off" | "required";

export interface UsdPrice {
  usd: number;
  updatedAt: number;
  stale: boolean;
}

export interface SolIndexerStatus {
  running: boolean;
  watched: number;
  lastSlot: number | null;
  lastPollAt: number | null;
  lastError: string | null;
  lagSec: number | null;
  headSlot: number | null;
  syncedSlot: number | null;
  backlog: number;
  head: number | null;
  lastIndexed: number | null;
  /** Slots behind the chain. */
  lag: number | null;
}

/** `GET /sol/status`. */
export interface SolStatus {
  network: "mainnet" | "devnet";
  indexer: SolIndexerStatus | null;
  solUsd: UsdPrice;
  features: Record<"launches" | "pump" | "raydium" | "meteora" | "escrow" | "bot" | "indexer", FeatureState> & { network?: string };
  [field: string]: unknown;
}

export interface SolTaxTierInfo {
  id: string;
  totalBps: number;
  platformBps: number;
  creatorBps: number;
  protocolBps: number;
  afterGraduation: { totalBps: number; lpBps: number; creatorBps: number };
  creatorPct?: number;
  default: boolean;
}

export interface SolVenueInfo {
  id: "pump" | "raydium" | "meteora";
  label: string;
  enabled: boolean;
  default: boolean;
  taxTiers: SolTaxTierInfo[];
  shares?: { escrowBps: number; treasuryBps: number };
  sniperFee?: { startBps: number; seconds: number };
  globalTaxStops?: number[];
}

export interface SolFeeModeInfo {
  id: string;
  default: boolean;
  shares: { creatorBps: number; marketingBps: number };
  escrowPays: string | null;
  available: boolean;
  team?: { min: number; max: number };
  crossChain?: boolean;
  mix?: { minSlices: number; maxSlices: number; minBps: number; slices: string[] };
  feeMode?: string;
  recipient?: string;
}

/** `GET /sol/config`: what launching on Solana offers right now. The common fields are typed; the rest pass through. */
export interface SolConfig {
  launchesPaused: boolean;
  totalSupply: number;
  limits: { name: number; symbol: number; logo: number; description: number; social: number };
  sol: { network: "mainnet" | "devnet"; pump: SolVenueLimits | null; raydium: SolVenueLimits | null; meteora: SolVenueLimits | null };
  venues: SolVenueInfo[];
  feeModes: SolFeeModeInfo[];
  holders: { minTokens: number; maxTokens: number; everySec: number; enabled: boolean };
  socialFees: { enabled: boolean; providers?: { key: string; enabled: boolean }[]; [k: string]: unknown };
  mix: { minSlices: number; maxSlices: number; minBps: number; teamMax: number };
  diamond: { minTokens: number; maxTokens: number; everySec: number; enabled: boolean };
  liquidity: { enabled: boolean; minUsd: number; burnAfterDays: number; lp: Record<string, string> };
  wallet: { crossChain: boolean; minUsd: number; maxCostBps: number; solanaChainId: number; chains: SolPayoutChain[] };
  [field: string]: unknown;
}

export interface SolVenueLimits {
  maxFirstBuySol: number;
  raiseSol: number;
  lookupTable?: string | null;
}

export interface SolPayoutChain {
  id: number;
  name: string;
  displayName: string;
  vmType: string;
  iconUrl: string | null;
  supported: boolean;
  native: { symbol: string; address: string; decimals: number; bridges: boolean };
  stable: { symbol: string; address: string; decimals: number } | null;
}

export interface StatsCoin {
  address: string;
  name: string;
  symbol: string;
  logoUrl: string | null;
}

/** Platform totals: launches, volume, payouts, the pair and launch-type mix, recent activity. */
export interface PlatformStats {
  coins: number;
  coinsLive: number;
  graduated: number;
  launches30d: { day: string; count: number }[];
  volume24hUsd: number;
  volume30d: { day: string; usd: number }[];
  holderRewardsPaidUsd: number;
  holderRounds: number;
  holderCoins: number;
  holderRecent: { at: number; usd: number; recipients: number; coin: StatsCoin }[];
  marketingRaisedUsd: number;
  tiersBought: number;
  pairMix: { kind: "sol" | "stable" | "stock" | "token"; count: number }[];
  feeModes: { mode: string; count: number }[];
  recentTrades: { id: string; at: number; side: "buy" | "sell"; usd: number; coin: StatsCoin }[];
  activity: { kind: "launch" | "graduation" | "payout"; at: number; coin: StatsCoin & { chain?: string }; usd: number | null; recipients: number | null }[];
  updatedAt: number;
}

/** One Solana coin, with pool and fee books. */
export interface SolTokenDetail extends SolApiToken {
  pool: { poolId: string; currency0: string; currency1: string; lpFee: number; ethReserve: number; liquidityLocked: boolean; [k: string]: unknown };
  fees: {
    creator: { unclaimedEth: number; claimedEth: number; recipient: string; pendingRecipient: string | null };
    marketing: { unclaimedEth: number; claimedEth: number };
    platform: { unclaimedEth: number; claimedEth: number };
  };
  launchTx: string;
  creatorLaunchBuyTokens: number;
  creatorBalance: number;
  creatorSold: boolean;
  hidden: boolean;
}

export interface SolHolder {
  address: string;
  balance: number;
  /** 0 to 100. */
  pctOfSupply: number;
  valueUsd: number;
  label?: "pool" | "dev_lock" | "creator" | "escrow" | "sniper" | "burn";
}

export interface SolTopTrader {
  address: string;
  boughtTokens: number;
  boughtEth: number;
  soldTokens: number;
  soldEth: number;
  unrealizedEth: number;
  pnlEth: number;
  pnlUsd: number;
  trades: number;
}

export interface TokenRisk {
  holders: number;
  top10Pct: number;
  devHoldingPct: number;
  devSold: boolean;
  devSoldPct: number;
  sniperHeldPct: number;
  firstBlockBuyers: number;
  excluded: string[];
  /** ISO time. */
  updatedAt: string;
}

export interface TokenCreator {
  token: string;
  kind: "wallet" | "social";
  address: string;
  launcher: string;
  social: { provider: string; providerLabel: string; handle: string; avatarUrl: string | null; claimed: boolean; claimedWallet: string | null; escrowAddress: string } | null;
  owedWei: string;
  pendingReassign: { to: string; eta: number; expiresAt: number; live: boolean } | null;
  eligibleForCto: boolean;
  ctoOpensAt: number;
}

export interface LivePrice {
  priceSol: number;
  priceUsd: number;
  marketCapUsd: number;
  solUsd: number;
  at: number;
  /** `false`: the pool read failed and this is the indexed price. */
  live: boolean;
}

export interface FeePlanSlice {
  kind: string;
  bps: number;
  team?: { wallet: string; bps: number }[];
  wallet?: { chainId: number; chain: string; address: string; symbol: string; currency: string; fallback: boolean };
  feed?: { mint: string; symbol: string | null };
  liquidity?: { wallet: string };
}

/** A coin's locked launch type and, for a stored plan, what each slice holds and has done. */
export interface TokenFeePlan {
  feeMode: string;
  plan: { slices: FeePlanSlice[] } | null;
  /** Base units held per slice kind. */
  slices?: Record<string, string>;
  bridges?: {
    status: string;
    amountIn: string;
    payMint: string;
    chainId: number;
    recipient: string;
    currency: string;
    symbol: string | null;
    fallback: boolean;
    expectedOut: string;
    refunded: string | null;
    depositTx: string;
    fillTxs: string[];
    time: number;
  }[];
  liquidity?: { status: string; venue: string; lpMethod: string | null; coinIn: string | null; quoteIn: string | null; position: string | null; addTx: string | null; time: number }[];
}

export interface TokenBuybacks {
  totals: { buys: number; solSpent: number; tokensBurned: number };
  recent: ({ time: number; solSpent: number; buyTx: string; burnTx: string | null } & ({ tokensBurned: number } | { target: string; targetRaw: string }))[];
}

export interface RewardAsset {
  /** `null`: SOL. */
  mint: string | null;
  symbol: string;
  decimals: number;
}

export interface TokenRewards {
  feeMode: string;
  asset: RewardAsset;
  pot: { amount: string; usd: number | null };
  totalPaid: { amount: string; usd: number | null };
  holdersPaid: number;
  lastRoundAt: number | null;
  nextRoundAt: number | null;
  rounds: { at: number; recipients: number; amount: string; usd: number | null; sigs: string[] }[];
  rules: { minTokens: number; maxTokens: number; everySec: number };
}

export interface PayoutStatus {
  enabled: boolean;
  nextAt: number | null;
  minLamports: string;
}

export interface TokenMetadataJson {
  name: string;
  symbol: string;
  description: string;
  image?: string;
  showName: boolean;
  createdOn?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

export interface TokenLock {
  mint: string;
  symbol: string;
  wallet: string;
  contract: string;
  escrow: string;
  amount: number;
  fee: number;
  pctOfSupply: number;
  withdrawn: number;
  lockedAt: number;
  unlocksAt: number;
  cancelable: boolean;
  transferable: boolean;
  /** A dashboard link for the lock. */
  streamflow: string;
}

export type BurnStatus = "live" | "syncing" | "degraded" | "not_configured";

/** The $STEALTH buy back and burn: supply, wallets, fees in and burns out. */
export interface BurnOverview {
  mint: string | null;
  symbol: string | null;
  onchainSymbol: string | null;
  decimals: number;
  initialSupply: number;
  currentSupply: number | null;
  burned: number | null;
  burnedPct: number | null;
  raw: { initialSupply: string; currentSupply: string | null; burned: string | null };
  supplySource: "rpc" | "db" | null;
  wallets: { address: string; solBalance: number | null; tokenBalance: number | null; solscan: string }[];
  split: { marketingPctOfCoinFee: number };
  totals: {
    feesSol: number;
    feesUsd: number;
    fees24hSol: number;
    fees7dSol: number;
    sentSol: number;
    accruingSol: number;
    coins: number;
    burnsCount: number;
    burnedByWallets: number;
    buybacksCount: number;
    boughtBack: number;
    solSpent: number;
  };
  solUsd: number;
  recentBurns: { sig: string; time: number; amount: number; solSpent: number | null; solscan: string }[];
  syncedAt: number | null;
  updatedAt: number;
  status: BurnStatus;
}

export interface BurnEvent {
  sig: string;
  seq: number;
  slot: number;
  time: number;
  amount: number;
  amountRaw: string;
  wallet: string;
  authority: string;
  solSpent: number | null;
  solscan: string;
}

export interface BurnCoinContribution {
  mint: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  status: TokenStage;
  feesSol: number;
  feesUsd: number;
  sharePct: number;
  fees24hSol: number;
  allTimeFeesSol: number;
  sentSol: number;
  accruingSol: number;
  rank: number;
}

export interface BurnCoins {
  range: "all" | "24h" | "7d";
  items: BurnCoinContribution[];
  count: number;
  totalFeesSol: number;
  totalFeesUsd: number;
  updatedAt: number;
}

export interface BurnCoin {
  mint: string;
  feesSol: number;
  feesUsd: number;
  fees24hSol: number;
  /** 0: none. */
  rank: number;
  sharePct: number;
  coins: number;
  updatedAt: number;
}

export interface BurnSchedule {
  everyHours: number;
  lastAt: number | null;
  nextAt: number | null;
  /** 0 to 1. */
  progress: number;
  now: number;
}

export type LeaderboardSource = "all" | "kols" | "smart" | "launchpad";
export type LeaderboardRange = "1d" | "7d" | "30d" | "all";
export type LeaderboardSort = "pnl" | "roi" | "winrate" | "volume";
export type DataStatus = "ready" | "not_configured" | "unavailable";

export interface LeaderboardRow {
  rank: number;
  wallet: string;
  name: string | null;
  twitter: string | null;
  telegram: string | null;
  avatar: string | null;
  tags: ("kol" | "smart" | "launchpad")[];
  pnlSol: number | null;
  pnlUsd: number | null;
  roiPct: number | null;
  winRatePct: number | null;
  trades: number | null;
  wins: number | null;
  losses: number | null;
  buys: number | null;
  sells: number | null;
  volumeSol: number | null;
  volumeUsd: number | null;
  bestToken: { mint: string; symbol: string | null; name: string | null; logo: string | null; pnlSol: number | null; pnlUsd: number | null } | null;
  links: Record<string, string>;
}

export interface Leaderboard {
  source: LeaderboardSource;
  range: LeaderboardRange;
  sort: LeaderboardSort;
  limit: number;
  status: DataStatus;
  updatedAt: number;
  stale: boolean;
  solUsd: number;
  sorts: LeaderboardSort[];
  ranges: LeaderboardRange[];
  providers: { id: string; status: DataStatus | "unsupported" }[];
  rows: LeaderboardRow[];
}

export interface SolTokenListOptions extends TokenListOptionsBase {
  /** Coins whose creator or fee recipient is this wallet. */
  creator?: string;
}

export interface SolCandleOptions {
  /** Default `1m`. */
  interval?: CandleInterval;
  /** Unix seconds. Default a day before `to`. */
  from?: number;
  /** Unix seconds. Default now. */
  to?: number;
}

/** The app-route quote from `/sol/quote`: a launchpad coin still on its own venue. */
export interface SolApiQuote {
  venue: "curve" | "amm";
  side: "buy" | "sell";
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  feeLamports: string;
  quoteMint?: string;
  feeQuote?: string;
  feeBps: number;
  priceImpactPct: number | null;
}

const mintPath = (mint: string) => {
  if (!isSolanaAddress(mint)) throw new StealthInputError(`${mint} isn't a Solana address.`);
  return mint;
};

/** A Solana coin's reads. */
export class SolTokensApi {
  constructor(private readonly api: ApiClient) {}

  /** One page of coins, 50 at a time. Default stage `new`, sort `age`. */
  async list(o: SolTokenListOptions = {}, opts?: RequestOptions) {
    return this.api.get<CursorPage<SolApiToken>>("/sol/tokens", {
      stages: stagesParam(o.stages),
      sort: o.sort,
      dir: o.dir,
      cursor: o.cursor,
      q: o.q,
      mcap: o.mcap,
      vol: o.vol,
      socials: flag(o.socials),
      creator: o.creator,
    }, opts);
  }

  /** Every coin matching `o`, page by page. */
  iterate(o: Omit<SolTokenListOptions, "cursor"> = {}, p: PaginateOptions = {}): Paginator<SolApiToken> {
    return paginate((cursor, signal) => this.list({ ...o, cursor }, { signal }), p);
  }

  /** Coins per stage. */
  async counts(f: TokenFilters & { creator?: string } = {}, opts?: RequestOptions) {
    return this.api.get<Record<TokenStage, number>>("/sol/tokens/counts", { q: f.q, mcap: f.mcap, vol: f.vol, socials: flag(f.socials), creator: f.creator }, opts);
  }

  /** Name, ticker or address. `limit` up to 20, default 8. */
  async search(q: string, limit = 8, opts?: RequestOptions) {
    return this.api.get<SolApiToken[]>("/sol/tokens/search", { q, limit }, opts);
  }

  /** A coin, with pool and fee books. Throws `not_found` for one the API doesn't know; see {@link find}. */
  async get(mint: string, opts?: RequestOptions) {
    return this.api.get<SolTokenDetail>(`/sol/tokens/${mintPath(mint)}`, undefined, opts);
  }

  /** {@link get}, with `null` for an unknown coin. */
  async find(mint: string, opts?: RequestOptions) {
    return orNull(this.get(mint, opts));
  }

  /** Candles, oldest first, at most 3,000, gaps filled flat. Prices in SOL per token, `volume` in USD. */
  async candles(mint: string, o: SolCandleOptions = {}, opts?: RequestOptions) {
    return this.api.get<ApiCandle[]>(`/sol/tokens/${mintPath(mint)}/candles`, { interval: o.interval, from: o.from, to: o.to }, opts);
  }

  /** One page of trades, newest first, 50 at a time. */
  async trades(mint: string, cursor?: string, opts?: RequestOptions) {
    return this.api.get<CursorPage<ApiTrade>>(`/sol/tokens/${mintPath(mint)}/trades`, { cursor }, opts);
  }

  /** Every trade, newest first, fetched a page at a time. */
  iterateTrades(mint: string, p: PaginateOptions = {}): Paginator<ApiTrade> {
    return paginate((cursor, signal) => this.trades(mint, cursor, { signal }), p);
  }

  /** The 20 largest holders, with the pool, escrow, creator, locks, snipers and burns labelled. */
  async holders(mint: string, opts?: RequestOptions) {
    return this.api.get<SolHolder[]>(`/sol/tokens/${mintPath(mint)}/holders`, undefined, opts);
  }

  /** Up to 30 traders by PnL. */
  async topTraders(mint: string, opts?: RequestOptions) {
    return this.api.get<SolTopTrader[]>(`/sol/tokens/${mintPath(mint)}/top-traders`, undefined, opts);
  }

  /** Holder concentration, the dev's holdings, snipers. */
  async risk(mint: string, opts?: RequestOptions) {
    return this.api.get<TokenRisk>(`/sol/tokens/${mintPath(mint)}/risk`, undefined, opts);
  }

  /** Who the coin pays, and any pending reassignment. */
  async creator(mint: string, opts?: RequestOptions) {
    return this.api.get<TokenCreator>(`/sol/tokens/${mintPath(mint)}/creator`, undefined, opts);
  }

  /** The price read from the pool now, when it can be. Never cached. */
  async price(mint: string, opts?: RequestOptions) {
    return this.api.get<LivePrice>(`/sol/tokens/${mintPath(mint)}/price`, undefined, { cache: false, ...opts });
  }

  /** The coin's locked launch type and slices. */
  async feePlan(mint: string, opts?: RequestOptions) {
    return this.api.get<TokenFeePlan>(`/sol/tokens/${mintPath(mint)}/fee-plan`, undefined, opts);
  }

  /** Buybacks and burns. All zeros for a coin without any. */
  async buybacks(mint: string, opts?: RequestOptions) {
    return this.api.get<TokenBuybacks>(`/sol/tokens/${mintPath(mint)}/buybacks`, undefined, opts);
  }

  /** Holders / Diamond Hands payouts: pot, totals and rounds. */
  async rewards(mint: string, opts?: RequestOptions) {
    return this.api.get<TokenRewards>(`/sol/tokens/${mintPath(mint)}/rewards`, undefined, opts);
  }

  /** When the fee bot next runs for this coin. */
  async payout(mint: string, opts?: RequestOptions) {
    return this.api.get<PayoutStatus>(`/sol/tokens/${mintPath(mint)}/payout`, undefined, opts);
  }

  /** A Marketing coin's ladder. */
  async marketing(mint: string, opts?: RequestOptions) {
    return this.api.get<CoinMarketing>(`/sol/tokens/${mintPath(mint)}/marketing`, undefined, opts);
  }

  /** A Marketing coin's raise, rank and events. */
  async marketingStats(mint: string, opts?: RequestOptions) {
    return this.api.get<CoinMarketingStats>(`/sol/tokens/${mintPath(mint)}/marketing/stats`, undefined, opts);
  }

  /** The coin's metadata JSON, as its on-chain URI serves it. */
  async metadata(mint: string, opts?: RequestOptions) {
    return this.api.get<TokenMetadataJson>(`/sol/metadata/${mintPath(mint)}`, undefined, opts);
  }
}

/** The $STEALTH buy back and burn. */
export class SolBurnApi {
  constructor(private readonly api: ApiClient) {}

  async overview(opts?: RequestOptions) {
    return this.api.get<BurnOverview>("/sol/burn", undefined, opts);
  }

  /** One page of burns, newest first. `limit` 1 to 100, default 25. */
  async events(o: { cursor?: string; limit?: number } = {}, opts?: RequestOptions) {
    return this.api.get<{ items: BurnEvent[]; nextCursor: string | null; updatedAt: number }>("/sol/burn/events", o, opts);
  }

  /** Every burn, newest first. */
  iterateEvents(limit = 100, p: PaginateOptions = {}): Paginator<BurnEvent> {
    return paginate((cursor, signal) => this.events({ cursor, limit }, { signal }), p);
  }

  /** Coins ranked by the fees they sent to the burn. */
  async coins(o: { range?: "all" | "24h" | "7d"; limit?: number } = {}, opts?: RequestOptions) {
    return this.api.get<BurnCoins>("/sol/burn/coins", o, opts);
  }

  /** One coin's part in the burn. */
  async coin(mint: string, opts?: RequestOptions) {
    return this.api.get<BurnCoin>(`/sol/burn/coins/${mintPath(mint)}`, undefined, opts);
  }

  /** When the next burn runs. */
  async next(opts?: RequestOptions) {
    return this.api.get<BurnSchedule>("/sol/burn/next", undefined, opts);
  }
}

/** Solana's marketing ladder across coins. */
export class SolMarketingApi {
  constructor(private readonly api: ApiClient) {}

  async tiers(opts?: RequestOptions) {
    return this.api.get<{ tiers: MarketingTier[]; bufferUsd: number }>("/sol/marketing/tiers", undefined, opts);
  }
  /** `limit` 1 to 50, default 12. */
  async overview(limit?: number, opts?: RequestOptions) {
    return this.api.get<MarketingOverview>("/sol/marketing/overview", { limit }, opts);
  }
  async summary(opts?: RequestOptions) {
    return this.api.get<MarketingSummary>("/sol/marketing/summary", undefined, opts);
  }
  async leaderboard(range: "7d" | "30d" | "all" = "7d", opts?: RequestOptions) {
    return this.api.get<MarketingLeaderboard>("/sol/marketing/leaderboard", { range }, opts);
  }
}

/** Everything Solana the API reads. */
export class SolApi {
  readonly tokens: SolTokensApi;
  readonly burn: SolBurnApi;
  readonly marketing: SolMarketingApi;
  /** Any Solana token, priced and routed through Jupiter. */
  readonly market: SolMarketApi;
  readonly wallets: SolWalletsApi;

  constructor(private readonly api: ApiClient) {
    this.tokens = new SolTokensApi(api);
    this.burn = new SolBurnApi(api);
    this.marketing = new SolMarketingApi(api);
    this.market = new SolMarketApi(api);
    this.wallets = new SolWalletsApi(api);
  }

  /** Venues, tiers, launch types and limits as the server has them right now. */
  async config(opts?: RequestOptions) {
    return this.api.get<SolConfig>("/sol/config", undefined, opts);
  }

  /** Network, indexer lag, the SOL price and which features are up. */
  async status(opts?: RequestOptions) {
    return this.api.get<SolStatus>("/sol/status", undefined, opts);
  }

  /** Solana platform totals. */
  async stats(opts?: RequestOptions) {
    return this.api.get<PlatformStats>("/sol/stats", undefined, opts);
  }

  /** SOL in USD, as the server prices it. */
  async solPrice(opts?: RequestOptions) {
    return this.api.get<UsdPrice>("/sol/eth-price", undefined, opts);
  }

  /** Token locks the platform tracks. */
  async locks(opts?: RequestOptions): Promise<TokenLock[]> {
    return (await this.api.get<{ locks: TokenLock[] }>("/sol/locks", undefined, opts)).locks;
  }

  /** Top wallets by PnL, ROI, win rate or volume. */
  async leaderboard(o: { source?: LeaderboardSource; range?: LeaderboardRange; sort?: LeaderboardSort; limit?: number } = {}, opts?: RequestOptions) {
    return this.api.get<Leaderboard>("/sol/leaderboard", o, opts);
  }

  /** Which leaderboard sources are up. */
  async leaderboardStatus(opts?: RequestOptions) {
    return this.api.get<{ sources: Record<LeaderboardSource, { status: string; lastError?: { reason: string; at: number } | null }> }>("/sol/leaderboard/status", undefined, opts);
  }

  /**
   * A quote for a launchpad coin still on its own venue (`sol.swapVia === "app"`). Others answer `use_jupiter` (409): use
   * {@link SolMarketApi.quote} for those. `amount` is lamports on a buy, token base units (6 decimals) on a sell.
   */
  async quote(mint: string, side: "buy" | "sell", amount: bigint | string, slippageBps = 300, opts?: RequestOptions) {
    return this.api.get<SolApiQuote>("/sol/quote", { mint: mintPath(mint), side, amount: amount.toString(), slippageBps }, { cache: false, ...opts });
  }

  /** A sent transaction's status. Use it right after sending: an old signature reads `pending`. */
  async txStatus(signature: string, opts?: RequestOptions) {
    return this.api.get<{ status: "pending" | "confirmed" | "failed"; error: string | null }>(`/sol/tx/${signature}`, undefined, { cache: false, ...opts });
  }

  /** A bundle's status. */
  async bundleStatus(id: string, opts?: RequestOptions) {
    return this.api.get<{ status: "pending" | "landed" | "failed" | "invalid" | "unknown" }>(`/sol/bundle/${id}`, undefined, { cache: false, ...opts });
  }

  /** Lamports, and the balance of `mint` if given (SPL and Token-2022 summed). */
  async balance(owner: string, mint?: string, opts?: RequestOptions) {
    return this.api.get<{ lamports: string; tokenBaseUnits: string | null }>(`/sol/balance/${mintPath(owner)}`, { mint }, opts);
  }
}
