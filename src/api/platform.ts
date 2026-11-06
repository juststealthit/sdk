/**
 * Site-wide reads: public settings, the official $STEALTH token's config, platform status, cross-chain totals and the cross-chain
 * coin board, chart events, multi-chain groups and social lookups.
 *
 * @module
 */
import type { ApiClient, RequestOptions } from "../shared/api.js";
import { StealthInputError } from "../shared/errors.js";
import { paginate, type PaginateOptions, type Paginator } from "../shared/paginate.js";
import { getAddress } from "viem";

import { isEvmAddress } from "../utils/address.js";
import type { LiveChainKey } from "../utils/chains.js";
import { flag, orNull, stagesParam, type CursorPage, type MarketToken, type TokenFilters, type TokenListOptionsBase, type TokenStage } from "./common.js";
import type { FeatureState, PlatformStats, SolIndexerStatus, UsdPrice } from "./sol.js";

/** `GET /app-config`: whether the site is open, and its public settings. */
export interface AppConfig {
  comingSoon: boolean;
  /** ISO time, when set. */
  comingSoonUntil: string | null;
  xUrl: string;
  partnerLine: string;
  tagline: string;
  /** The official coin's contract address, for display. The coin the site acts on is in {@link PlatformApi.tokenConfig}. */
  officialCa: string;
  [field: string]: unknown;
}

/** The platform's own coin, $STEALTH. */
export interface OfficialToken {
  key: string;
  chain: "solana";
  name: string;
  symbol: string;
  ca: string | null;
  status: "coming_soon" | "live";
  logoUrl: string | null;
  description: string;
  links: { website: string | null; twitter: string | null; telegram: string | null };
  pool: string | null;
  quoteMint: string | null;
  quoteSymbol: string | null;
  tradable: boolean;
  tradeReason: "non_sol_quote" | "not_indexed" | null;
  tradeMessage: string | null;
}

/** `GET /status`. */
export interface PlatformStatus {
  network: string;
  /** `null` when the indexer runs apart from the API; `statusSummary()` still reports it. */
  indexer: SolIndexerStatus | null;
  solUsd: UsdPrice;
  features: Record<string, FeatureState>;
}

export type StatusComponent = "api" | "database" | "indexer" | "rpc" | "bot" | "pump" | "raydium" | "meteora";

/** `GET /status/summary`: the public status page. */
export interface StatusSummary {
  overall: "operational" | "degraded" | "down";
  network: string;
  checkedAt: number;
  sampleEveryMin: number;
  components: {
    key: StatusComponent;
    state: "operational" | "degraded" | "down" | "off";
    latencyMs: number | null;
    lagSec: number | null;
    incident: boolean;
    uptimePct: number | null;
    days: { day: string; ok: number; degraded: number; down: number; off: number }[];
  }[];
  incidents: {
    id: number;
    title: string;
    severity: "minor" | "major" | "critical";
    component: StatusComponent | "platform";
    status: "investigating" | "identified" | "monitoring" | "resolved";
    body: string;
    startedAt: number;
    resolvedAt: number | null;
    updatedAt: number;
  }[];
  metrics: { windowDays: number; incidentsByComponent: { component: string; count: number }[]; incidents: number; mttrMs: number | null; ticketsOpen: number; ticketsResolved: number } | null;
}

export type ChartEventKind = "dev" | "event" | "callout" | "x";

/** A marker for a coin's chart: dev trades, platform events, callouts and posts. */
export interface ChartEvent {
  id: string;
  kind: ChartEventKind;
  /** Unix ms. */
  at: number;
  /** `buy`, `sell`, `post`, or the event's kind. */
  sub: string;
  who: string | null;
  avatar: string | null;
  text: string | null;
  /** A URL, or for a callout a path on the site such as `/profile/<id>`. */
  link: string | null;
  sol: number | null;
}

export interface MultichainGroup {
  id: string;
  name: string;
  symbol: string;
  home: string;
  coins: { chain: string; token: string; home: boolean }[];
}

export type SocialProviderKey = "x" | "twitch" | "github" | "tiktok";

export interface SocialPerson {
  handle: string;
  name: string | null;
  accountId: string;
  avatarUrl: string | null;
  verified: boolean | null;
  tag: string;
}

export interface SocialAccountLookup {
  provider: string;
  handle: string;
  /** The account's permanent id: bind a social launch to it. */
  accountId: string;
  avatarUrl: string | null;
  name: string | null;
  verified: boolean | null;
  hasVault: boolean;
  claimed: boolean;
}

export interface SocialProfile {
  provider: string;
  handle: string;
  name: string | null;
  accountId: string | null;
  avatarUrl: string | null;
  verified: boolean | null;
  hasVault: boolean;
  claimed: boolean;
  totals: { coins: number; chains: number; earnedUsd: number | null };
  chains: {
    chain: string;
    decimals: number;
    earned: string | null;
    earnedUsd: number | null;
    coins: { address: string; name: string; symbol: string; logo: string | null; earned: string | null; status: string }[];
  }[];
}

export interface SocialHandleCheck {
  provider: string;
  handle: string;
  /** `null`: the provider couldn't say. */
  exists: boolean | null;
  avatarUrl: string | null;
}

/** Chains the cross-chain board can filter on: every live chain. */
export type MarketChain = LiveChainKey;

export interface MarketTokenListOptions extends TokenListOptionsBase {
  /** Default: every chain that's open. */
  chains?: MarketChain[] | string;
  /**
   * `true` leaves out the external trending coins the All list mixes in (rows with `outside`), so you get only coins launched here.
   * Filtered in the SDK, so a page can hold fewer than 50 rows. Default false.
   */
  ownOnly?: boolean;
}

/** One coin of the cross-chain Trending list: coins launched here and external coins trending on their chains, mixed. */
export interface MarketTrendingEntry {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  logo: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  /** Percent. Over 1 hour for an external coin, over 24 hours for a coin launched here. */
  changePct: number | null;
  /** USD in the last hour; for a coin launched here, its 24 hour volume / 24. */
  volume1hUsd: number;
  /** Launched on Just Stealth It. */
  onPlatform: boolean;
  /** An external coin's launchpad, as the data source names it. `null` for ours. */
  launchpad: string | null;
  /** $STEALTH. */
  official: boolean;
}

export interface MarketTrending {
  /** Ranked: Solana first, the other chains a few each. At most 60. */
  coins: MarketTrendingEntry[];
  /** Whether external coins are switched on at the server. `false`: only coins launched here. */
  outside: boolean;
}

const chainsParam = (c: MarketChain[] | string | undefined) => (Array.isArray(c) ? c.join(",") : c);

/** The launchpad's coins merged across Solana and every open EVM chain. A chain that fails is left out rather than failing the list. */
export class MarketApi {
  constructor(private readonly api: ApiClient) {}

  /**
   * One page, 50 coins. Default: every stage, sort `age`. The All list (every stage) also carries external trending coins, marked
   * `outside`; New, Graduating and Graduated never do. Pass `ownOnly` to drop them.
   */
  async list(o: MarketTokenListOptions = {}, opts?: RequestOptions): Promise<CursorPage<MarketToken>> {
    const page = await this.api.get<CursorPage<MarketToken>>("/market/tokens", {
      stages: stagesParam(o.stages),
      sort: o.sort,
      dir: o.dir,
      cursor: o.cursor,
      q: o.q,
      mcap: o.mcap,
      vol: o.vol,
      socials: flag(o.socials),
      chains: chainsParam(o.chains),
    }, opts);
    return o.ownOnly ? { ...page, items: page.items.filter((t) => !t.outside) } : page;
  }

  /** Trending across chains: coins launched here and external coins trending on the picked chains (default: every open chain). */
  async trending(o: { chains?: MarketChain[] | string } = {}, opts?: RequestOptions) {
    return this.api.get<MarketTrending>("/market/trending", { chains: chainsParam(o.chains) }, opts);
  }

  /** Every coin, page by page. */
  iterate(o: Omit<MarketTokenListOptions, "cursor"> = {}, p: PaginateOptions = {}): Paginator<MarketToken> {
    const { ownOnly, ...rest } = o;
    return paginate(async (cursor, signal) => {
      let page = await this.list({ ...rest, cursor }, { signal });
      if (!ownOnly) return page;
      // a page of external coins only mustn't end the walk: skip ahead (bounded) to one with coins launched here
      for (let hops = 0; ; hops++) {
        const items = page.items.filter((t) => !t.outside);
        if (items.length || !page.nextCursor || hops >= 20 || page.nextCursor === cursor) return { ...page, items };
        cursor = page.nextCursor;
        page = await this.list({ ...rest, cursor }, { signal });
      }
    }, p);
  }

  /** Coins per stage, and per chain. */
  async counts(f: TokenFilters & { chains?: MarketChain[] | string } = {}, opts?: RequestOptions) {
    return this.api.get<Record<TokenStage, number> & { chains: Record<string, number> }>("/market/tokens/counts", { q: f.q, mcap: f.mcap, vol: f.vol, socials: flag(f.socials), chains: chainsParam(f.chains) }, opts);
  }

  /** Search across chains. `limit` up to 20, default 8. */
  async search(q: string, o: { limit?: number; chains?: MarketChain[] | string } = {}, opts?: RequestOptions) {
    return this.api.get<MarketToken[]>("/market/tokens/search", { q, limit: o.limit, chains: chainsParam(o.chains) }, opts);
  }

  /** Cross-chain platform totals. */
  async stats(opts?: RequestOptions) {
    return this.api.get<PlatformStats>("/market/stats", undefined, opts);
  }
}

/** Site-wide reads. */
export class PlatformApi {
  constructor(private readonly api: ApiClient) {}

  /** Whether the site is open, and its public settings. */
  async appConfig(opts?: RequestOptions) {
    return this.api.get<AppConfig>("/app-config", undefined, opts);
  }

  /** Every official token config. Empty until one is set. */
  async tokenConfig(opts?: RequestOptions): Promise<OfficialToken[]> {
    return (await this.api.get<{ tokens: OfficialToken[] }>("/token-config", undefined, opts)).tokens;
  }

  /** $STEALTH, once it's live: the first official token with status `live`, else the first one, else `null`. */
  async officialToken(opts?: RequestOptions): Promise<OfficialToken | null> {
    const tokens = await this.tokenConfig(opts);
    return tokens.find((t) => t.status === "live") ?? tokens[0] ?? null;
  }

  /** Network, indexer, SOL price and features. */
  async status(opts?: RequestOptions) {
    return this.api.get<PlatformStatus>("/status", undefined, opts);
  }

  /** Components, uptime and incidents. */
  async statusSummary(opts?: RequestOptions) {
    return this.api.get<StatusSummary>("/status/summary", undefined, opts);
  }

  /** Chart markers for a coin on any chain, oldest first. `symbol` also matches $CASHTAG posts. */
  async chartEvents(token: string, symbol?: string, opts?: RequestOptions): Promise<ChartEvent[]> {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token) && !/^0x[0-9a-fA-F]{40}$/.test(token)) throw new StealthInputError(`${token} isn't a token address.`);
    if (symbol !== undefined && !/^[A-Za-z0-9]{1,12}$/.test(symbol)) throw new StealthInputError("symbol is 1 to 12 letters or digits.");
    return (await this.api.get<{ events: ChartEvent[] }>(`/tokens/${token}/chart-events`, { symbol }, opts)).events;
  }

  /** The image behind an IPFS CID, served through the API (PNG, JPEG, WebP or GIF). A URL, not a fetch. */
  ipfsUrl(cid: string, file?: string): string {
    if (!/^[A-Za-z0-9]{20,100}$/.test(cid)) throw new StealthInputError(`${cid} isn't a CID.`);
    if (file !== undefined && !/^[A-Za-z0-9._-]{1,100}$/.test(file)) throw new StealthInputError("file is 1 to 100 letters, digits, dots, dashes or underscores.");
    return this.api.url(`/ipfs/${cid}${file ? `/${file}` : ""}`);
  }

  /** A logo uploaded through the site (`<40 hex>.png|jpg|webp|gif`), served by the API. A URL, not a fetch. */
  logoUrl(file: string): string {
    if (!/^[0-9a-f]{40}\.(png|jpg|webp|gif)$/.test(file)) throw new StealthInputError(`${file} isn't an uploaded logo's file name.`);
    return this.api.url(`/uploads/logo/${file}`);
  }

  /** Whether the API is up: `{ status: "ok" }`. */
  async health(opts?: RequestOptions) {
    return this.api.get<{ status: string }>("/healthz", undefined, { cache: false, ...opts });
  }
}

/** Which coins launched together in one multi-chain launch. Public, no session. */
export class MultichainGroupsApi {
  constructor(private readonly api: ApiClient) {}

  /** Every coin of the most recent groups. */
  async list(opts?: RequestOptions) {
    return (await this.api.get<{ coins: { groupId: string; chain: string; token: string; home: boolean }[] }>("/multichain/groups", undefined, opts)).coins;
  }

  /** A group by id (a UUID), or `null`. */
  async get(id: string, opts?: RequestOptions) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return orNull(this.api.get<MultichainGroup>(`/multichain/groups/${id.toLowerCase()}`, undefined, opts));
  }

  /** The group a coin belongs to, or `null` (most coins have none). EVM addresses are matched in any case. */
  async ofCoin(chain: string, token: string, opts?: RequestOptions) {
    const t = chain === "solana" ? token : isEvmAddress(token) || /^0x[0-9a-fA-F]{40}$/.test(token) ? getAddress(token.toLowerCase()) : token;
    return orNull(this.api.get<MultichainGroup>(`/multichain/coins/${encodeURIComponent(chain)}/${encodeURIComponent(t)}`, undefined, opts));
  }

  /** Whether multi-chain launches are on, and on which chains, with the limits. */
  async config(opts?: RequestOptions) {
    return this.api.get<MultichainConfigView>("/multichain/config", undefined, opts);
  }
}

/** `/multichain/config`: the chains a multi-chain launch can use. `{ enabled: false, chains: [] }` while it's off. */
export interface MultichainConfigView {
  enabled: boolean;
  chains: { chain: string; name: string; native: string; chainId: number; available: boolean; reason: string | null }[];
  limits?: { maxRequestUsd: number; maxDayUsd: number; perDay: number };
  bufferBps?: number;
  retries?: number;
}

/** Social accounts, for social launches and vaults. */
export class SocialApi {
  constructor(private readonly api: ApiClient) {}

  /** Suggested accounts for a provider. */
  async people(provider: SocialProviderKey, opts?: RequestOptions) {
    return this.api.get<{ provider: string; checkedAt: string; people: SocialPerson[] }>("/social-fees/people", { provider }, opts);
  }

  /** An account's permanent id and vault state. Off while the server has social fees off. */
  async lookup(provider: SocialProviderKey, handle: string, opts?: RequestOptions) {
    return this.api.get<SocialAccountLookup>("/social-fees/lookup", { provider, handle }, opts);
  }

  /** What an account's vault holds across chains. */
  async profile(provider: SocialProviderKey, handle: string, opts?: RequestOptions) {
    return this.api.get<SocialProfile>(`/social-fees/profile/${provider}/${encodeURIComponent(handle)}`, undefined, opts);
  }

  /** Whether a handle exists on a provider. A leading `@` is ignored. */
  async checkHandle(provider: string, handle: string, opts?: RequestOptions) {
    return this.api.get<SocialHandleCheck>("/social/lookup", { provider, handle }, opts);
  }
}


