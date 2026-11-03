/**
 * EVM reads through the API: the indexed board, candles, trades, holders, risk and the money a coin moved, per chain.
 * Direct on-chain reads and writes live in `@juststealthit/sdk/evm` instead.
 *
 * @module
 */
import type { ApiClient, RequestOptions } from "../shared/api.js";
import { StealthInputError } from "../shared/errors.js";
import { paginate, type PaginateOptions, type Paginator } from "../shared/paginate.js";
import { isEvmAddress } from "../utils/address.js";
import {
  orNull,
  flag,
  stagesParam,
  type ApiCandle,
  type ApiTrade,
  type CandleInterval,
  type CursorPage,
  type EvmApiToken,
  type TokenFilters,
  type TokenListOptionsBase,
  type TokenStage,
} from "./common.js";

/** The EVM chains the API serves. */
export type EvmApiChain = "robinhood" | "bnb" | "hyperevm" | "base" | "arc";
export const EVM_API_CHAINS = ["robinhood", "bnb", "hyperevm", "base", "arc"] as const satisfies readonly EvmApiChain[];

export interface EvmConfigChain {
  id: EvmApiChain;
  chainId: number;
  name: string;
  native: string;
  dex: "v4" | "infinity";
  factory: string;
  router: string;
  feeVault: string;
  hook: string;
  rules: number;
  potModes: string[];
}

/** `GET /evm/config`. A chain missing from `chains` is off right now. */
export interface EvmConfig {
  enabled: boolean;
  allowed: boolean;
  session: boolean;
  chains: EvmConfigChain[];
  limits: { maxRequestUsd: number; maxDayUsd: number; usedTodayUsd: number } | null;
}

export interface EvmFeePlanPublic {
  slices: {
    kind: string;
    bps: number;
    team?: { wallet: string; bps: number }[];
    wallet?: { chainId: number; chain: string; address: string; symbol: string; currency: string; fallback: boolean };
    feed?: { token: string };
    social?: { vault: string };
  }[];
  home: { chain: string; address: string; groupId: string } | null;
}

/** One coin, with its pool and fee books. */
export interface EvmTokenDetail extends EvmApiToken {
  feePlan: EvmFeePlanPublic | null;
  pool: {
    poolId: string;
    currency0: string;
    currency1: string;
    lpFee: number;
    tickSpacing: number;
    hooks: string;
    ethReserve: number;
    tokenReserve: number;
    sqrtPriceX96: string;
    startSqrtPriceX96: string;
    graduationSqrtPriceX96: string;
    liquidityLocked: boolean;
  };
  fees: {
    creator: { unclaimedEth: number; claimedEth: number; recipient: string; pendingRecipient: string | null };
    marketing: { unclaimedEth: number; claimedEth: number };
    platform: { unclaimedEth: number; claimedEth: number };
  };
  launchTx: string;
  creatorLaunchBuyTokens: number;
  creatorBalance: number;
  creatorSold: boolean;
}

export interface EvmHolder {
  address: string;
  balance: number;
  /** 0 to 100. */
  pctOfSupply: number;
  valueUsd: number;
  label?: "pool" | "burn" | "creator" | "sniper";
}

export interface EvmTopTrader {
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

export interface EvmRisk {
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

/** The API's quote, read from the pool. Raw amounts in wei (18 decimals everywhere, Arc's USDC included). */
export interface EvmApiQuote {
  venue: "pool";
  side: "buy" | "sell";
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  feeRaw: string;
  feeBps: number;
  priceImpactPct: number | null;
}

export interface EvmTokenRewards {
  feeMode: string;
  asset: { mint: null; symbol: string; decimals: number };
  pot: { amount: string; usd: number | null };
  totalPaid: { amount: string; usd: number | null };
  holdersPaid: number;
  lastRoundAt: number | null;
  nextRoundAt: number | null;
  rounds: { at: number; recipients: number; amount: string; usd: number | null; sigs: string[] }[];
  rules: { minTokens: number; maxTokens: number; everySec: number };
}

export interface EvmPot {
  slices: { slice: string; balance: string }[];
  runs: { slice: string; kind: string; status: string; amount: string; tx: string | null; time: number }[];
}

/** Buy back and burn totals. `solSpent` is in the chain's native coin (the API keeps a historic name). */
export interface EvmBuybacks {
  totals: { buys: number; solSpent: number; tokensBurned: number };
  recent: { time: number; solSpent: number; tokensBurned: number; buyTx: string; burnTx: string }[];
}

export interface PayoutBotStatus {
  payouts: boolean;
  rules: { minTokens: number; maxTokens: number; everySec: number };
  nextRoundAt: number | null;
}

/** A hidden wallet's balances, by Solana owner. */
export interface EvmWalletView {
  exists: boolean;
  address: string | null;
  chains: {
    chain: EvmApiChain;
    chainId: number;
    native: string;
    ok: boolean;
    balanceRaw: string;
    balance: number;
    usd: number;
    maxWithdrawRaw: string;
    tokens: { address: string; symbol: string; name: string; balanceRaw: string; balance: number; valueUsd: number; claimableRaw: string; claimable: number }[];
  }[];
}

/** A wallet's position in one coin. `*Wei` strings are 18-decimal fixed point. */
export interface WalletPosition {
  token: string;
  name: string;
  symbol: string;
  logo: string | null;
  launchTime: number;
  hidden: boolean;
  balanceWei: string;
  valueUsd: number;
  costBasisUsd: number;
  boughtEthWei: string;
  boughtUsd: number;
  avgBuyMcUsd: number | null;
  soldEthWei: string;
  soldUsd: number;
  avgSellMcUsd: number | null;
  unrealizedUsd: number;
  unrealizedPct: number | null;
  realizedUsd: number;
  totalProfitUsd: number;
  totalProfitPct: number | null;
  firstBuyAt: number | null;
  lastTradeAt: number | null;
  holdingSec: number;
  closed: boolean;
}

export interface EvmPosition extends WalletPosition {
  chain: EvmApiChain;
  native: string;
}

export interface EvmTokenListOptions extends TokenListOptionsBase {
  /** Coins whose creator or fee recipient is this address. */
  creator?: string;
}

export interface EvmCandleOptions {
  /** Default `1m`. */
  interval?: CandleInterval;
  /** Unix seconds. Default a day before `to`. */
  from?: number;
  /** Unix seconds. Default now. */
  to?: number;
}

export type { CoinRef, TierStatus, MarketingTier, MarketingOverview, MarketingSummary, MarketingLeaderboard, CoinMarketing, CoinMarketingStats, MarketingAnalytics } from "./marketing.js";
import type { CoinMarketing, CoinMarketingStats, MarketingAnalytics, MarketingLeaderboard, MarketingOverview, MarketingSummary, MarketingTier } from "./marketing.js";

const assertChain = (chain: string): EvmApiChain => {
  if (!(EVM_API_CHAINS as readonly string[]).includes(chain)) throw new StealthInputError(`Unknown EVM chain ${chain}. Use one of ${EVM_API_CHAINS.join(", ")}.`);
  return chain as EvmApiChain;
};
const assertAddress = (a: string) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new StealthInputError(`${a} isn't an EVM address.`);
  return a;
};

/** One EVM chain's reads. Get one with `stealth.evm.chain("base")`. */
export class EvmChainApi {
  readonly chain: EvmApiChain;
  private readonly base: string;

  constructor(
    private readonly api: ApiClient,
    chain: EvmApiChain,
  ) {
    this.chain = assertChain(chain);
    this.base = `/evm/chains/${this.chain}`;
  }

  /** The native coin's USD price. `stale` while the server has none. */
  async nativePrice(opts?: RequestOptions) {
    return this.api.get<{ usd: number; updatedAt: number; stale: boolean }>(`${this.base}/eth-price`, undefined, opts);
  }

  /** One page of coins, 50 at a time. Default stage `new`, sort `age`. */
  async listTokens(o: EvmTokenListOptions = {}, opts?: RequestOptions) {
    return this.api.get<CursorPage<EvmApiToken>>(`${this.base}/tokens`, listQuery(o), opts);
  }

  /** Every coin matching `o`, page by page. */
  iterateTokens(o: Omit<EvmTokenListOptions, "cursor"> = {}, p: PaginateOptions = {}): Paginator<EvmApiToken> {
    return paginate((cursor, signal) => this.listTokens({ ...o, cursor }, { signal }), p);
  }

  /** How many coins sit in each stage. */
  async countTokens(f: TokenFilters & { creator?: string } = {}, opts?: RequestOptions) {
    return this.api.get<Record<TokenStage, number>>(`${this.base}/tokens/counts`, { q: f.q, mcap: f.mcap, vol: f.vol, socials: flag(f.socials), creator: f.creator }, opts);
  }

  /** Name, ticker or address prefix. `limit` up to 20, default 8. */
  async searchTokens(q: string, limit = 8, opts?: RequestOptions) {
    return this.api.get<EvmApiToken[]>(`${this.base}/tokens/search`, { q, limit }, opts);
  }

  /** A coin with its pool and fee books. Throws `not_found` (404) for an unknown address; see {@link findToken}. */
  async getToken(address: string, opts?: RequestOptions) {
    return this.api.get<EvmTokenDetail>(`${this.base}/tokens/${assertAddress(address)}`, undefined, opts);
  }

  /** Like {@link getToken}, with `null` for a coin the API doesn't know. */
  async findToken(address: string, opts?: RequestOptions) {
    return orNull(this.getToken(address, opts));
  }

  /** Candles, oldest first, at most 2,000. Gaps are filled with flat candles. */
  async getCandles(address: string, o: EvmCandleOptions = {}, opts?: RequestOptions) {
    return this.api.get<ApiCandle[]>(`${this.base}/tokens/${assertAddress(address)}/candles`, { interval: o.interval, from: o.from, to: o.to }, opts);
  }

  /** One page of trades, newest first, 50 at a time. */
  async getTrades(address: string, cursor?: string, opts?: RequestOptions) {
    return this.api.get<CursorPage<ApiTrade>>(`${this.base}/tokens/${assertAddress(address)}/trades`, { cursor }, opts);
  }

  /** Every trade, newest first. */
  iterateTrades(address: string, p: PaginateOptions = {}): Paginator<ApiTrade> {
    return paginate((cursor, signal) => this.getTrades(address, cursor, { signal }), p);
  }

  /** The top 50 holders, with the pool, burn, creator and snipers labelled. */
  async getHolders(address: string, opts?: RequestOptions) {
    return this.api.get<EvmHolder[]>(`${this.base}/tokens/${assertAddress(address)}/holders`, undefined, opts);
  }

  /** The top 20 traders by PnL. Buybacks are left out. */
  async getTopTraders(address: string, opts?: RequestOptions) {
    return this.api.get<EvmTopTrader[]>(`${this.base}/tokens/${assertAddress(address)}/top-traders`, undefined, opts);
  }

  /** Holder concentration, the dev's holdings and sniper share. */
  async getRisk(address: string, opts?: RequestOptions) {
    return this.api.get<EvmRisk>(`${this.base}/tokens/${assertAddress(address)}/risk`, undefined, opts);
  }

  /**
   * The API's quote from the pool. `amount` is wei on a buy, token raw units (18 decimals) on a sell.
   * For a quote straight from the chain's quoter, use `StealthEvm.quoteBuy` / `quoteSell`.
   */
  async quote(address: string, side: "buy" | "sell", amount: bigint | string, slippageBps?: number, opts?: RequestOptions) {
    return this.api.get<EvmApiQuote>(`${this.base}/tokens/${assertAddress(address)}/quote`, { side, amount: amount.toString(), slippageBps }, opts);
  }

  /** A Holders or Diamond Hands coin's pot and payout rounds. */
  async getRewards(address: string, opts?: RequestOptions) {
    return this.api.get<EvmTokenRewards>(`${this.base}/tokens/${assertAddress(address)}/rewards`, undefined, opts);
  }

  /** A Pot coin's slice balances and runs. */
  async getPot(address: string, opts?: RequestOptions) {
    return this.api.get<EvmPot>(`${this.base}/tokens/${assertAddress(address)}/pot`, undefined, opts);
  }

  /** A Buyback coin's buys and burns. */
  async getBuybacks(address: string, opts?: RequestOptions) {
    return this.api.get<EvmBuybacks>(`${this.base}/tokens/${assertAddress(address)}/buybacks`, undefined, opts);
  }

  /** Whether holder payouts run on this chain, their rules and the next round. */
  async getPayoutBot(opts?: RequestOptions) {
    return this.api.get<PayoutBotStatus>(`${this.base}/bot`, undefined, opts);
  }

  /** A Marketing coin's ladder. */
  async getMarketing(address: string, opts?: RequestOptions) {
    return this.api.get<CoinMarketing>(`${this.base}/tokens/${assertAddress(address)}/marketing`, undefined, opts);
  }

  /** A Marketing coin's raise, rank and events. */
  async getMarketingStats(address: string, opts?: RequestOptions) {
    return this.api.get<CoinMarketingStats>(`${this.base}/tokens/${assertAddress(address)}/marketing/stats`, undefined, opts);
  }

  /** The marketing ladder's tiers and prices on this chain. */
  async marketingTiers(opts?: RequestOptions) {
    return this.api.get<{ tiers: MarketingTier[]; bufferUsd: number }>(`${this.base}/marketing/tiers`, undefined, opts);
  }

  /** Recently completed tiers and the coins closest to their next one. `limit` 1 to 50, default 12. */
  async marketingOverview(limit?: number, opts?: RequestOptions) {
    return this.api.get<MarketingOverview>(`${this.base}/marketing/overview`, { limit }, opts);
  }

  /** Every Marketing coin's latest and next tier. */
  async marketingSummary(opts?: RequestOptions) {
    return this.api.get<MarketingSummary>(`${this.base}/marketing/summary`, undefined, opts);
  }

  /** The top 50 Marketing coins by raise. */
  async marketingLeaderboard(range: "7d" | "30d" | "all" = "7d", opts?: RequestOptions) {
    return this.api.get<MarketingLeaderboard>(`${this.base}/marketing/leaderboard`, { range }, opts);
  }

  /** Raise and spend over time, by coin, weekday and month. */
  async marketingAnalytics(opts?: RequestOptions) {
    return this.api.get<MarketingAnalytics>(`${this.base}/marketing/analytics`, undefined, opts);
  }
}

function listQuery(o: EvmTokenListOptions) {
  return { stages: stagesParam(o.stages), sort: o.sort, dir: o.dir, cursor: o.cursor, q: o.q, mcap: o.mcap, vol: o.vol, socials: flag(o.socials), creator: o.creator };
}

/** EVM reads across chains. */
export class EvmApi {
  private readonly chains = new Map<EvmApiChain, EvmChainApi>();

  constructor(private readonly api: ApiClient) {}

  /** Which EVM chains are live and their contracts. Pass a Solana `wallet` to see its limits. */
  async config(wallet?: string, opts?: RequestOptions) {
    return this.api.get<EvmConfig>("/evm/config", { wallet }, { cache: false, ...opts });
  }

  /** The reads for one chain. */
  chain(chain: EvmApiChain): EvmChainApi {
    let c = this.chains.get(chain);
    if (!c) this.chains.set(chain, (c = new EvmChainApi(this.api, chain)));
    return c;
  }

  /** A Solana wallet's hidden EVM wallet: balances on every chain. */
  async wallet(solanaOwner: string, opts?: RequestOptions) {
    return this.api.get<EvmWalletView>(`/evm/wallets/${solanaOwner}`, undefined, opts);
  }

  /** A Solana wallet's hidden EVM wallet: positions on every chain, open ones first. */
  async positions(solanaOwner: string, opts?: RequestOptions): Promise<EvmPosition[]> {
    return (await this.api.get<{ positions: EvmPosition[] }>(`/evm/wallets/${solanaOwner}/positions`, undefined, opts)).positions;
  }
}

/** True if `address` looks like an EVM token address (no checksum required, as the API accepts any case). */
export const isEvmTokenAddress = (address: string) => /^0x[0-9a-fA-F]{40}$/.test(address) || isEvmAddress(address);
