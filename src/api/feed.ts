/**
 * The Feed: launches, graduations, burns, claims and people's posts, plus profiles and the public fee board. Reading needs no session.
 *
 * @module
 */
import type { ApiClient, RequestOptions } from "../shared/api.js";
import { StealthInputError } from "../shared/errors.js";
import { paginate, type PaginateOptions, type Paginator } from "../shared/paginate.js";

export interface ProfileCard {
  id: number;
  displayName: string | null;
  avatarUrl: string | null;
  login: { kind: "solana" | "evm" | "social"; address: string | null; provider: string | null; handle: string | null };
}

export interface FeedPost {
  /** `p<n>`. */
  id: string;
  type: "post";
  at: number;
  author: ProfileCard;
  text: string;
  /** Show it with `stealth.platform.ipfsUrl(imageCid)`. */
  imageCid: string | null;
  mine: boolean;
}

export type FeedEventKind = "launch" | "graduated" | "marketing_done" | "burn" | "dev_buy" | "social_claim" | "fee_claim";

export interface FeedEventView {
  template: string;
  kind: FeedEventKind;
  chain: string;
  token: string | null;
  name: string | null;
  symbol: string | null;
  logoUrl: string | null;
  txUrl: string | null;
  proofUrl: string | null;
  social: { provider: string; label: string; handle: string; url: string | null; vaultId: number | null } | null;
  usd: number | null;
  native: number | null;
  nativeSymbol: string | null;
  tokens: number | null;
  tiersDone: number | null;
}

export interface FeedEvent {
  /** `e<n>`. */
  id: string;
  type: "event";
  at: number;
  event: FeedEventView;
  author?: { address: string; profile: ProfileCard | null } | null;
  market?: { marketCapUsd: number; volume24hUsd: number; change24h: number; priceUsd: number } | null;
}

export type FeedItem = FeedPost | FeedEvent;
export type FeedFilter = "all" | "coins" | "posts" | "socials";

export type FeeType = "creator" | "social" | "holders" | "buyback" | "marketing" | "liquidity";

/** Fees paid out by type over 7 or 30 days. */
export interface FeeBoard {
  days: number;
  totalUsd: number;
  updatedAt: number;
  types: {
    type: FeeType;
    usd: number;
    payouts: number;
    series: { day: string; usd: number }[];
    chains: { chain: string; usd: number }[];
    coins: { address: string; chain: string; name: string; symbol: string; logoUrl: string | null; usd: number }[];
    recent: { kind: string; chain: string; token: string | null; symbol: string | null; usd: number | null; native: number | null; nativeSymbol: string | null; txUrl: string | null; at: number }[];
  }[];
}

export interface SeriesDay {
  day: string;
  value: number;
}
export interface PublicTx {
  tx: string;
  txUrl: string;
  at: number;
  sol: number | null;
  usd: number | null;
  tokens: number | null;
}

/** Creator fees, the platform's dev buys and $STEALTH burns. `null` means unknown, not zero. */
export interface FeesOverview {
  token: { mint: string; symbol: string | null } | null;
  creatorFees: { usd: number | null; payouts: number; unpriced: number; chains: { chain: string; usd: number }[]; types: { type: FeeType; usd: number }[]; series: SeriesDay[] } | null;
  devBuys: { wallet: string; walletUrl: string; count: number; sol: number | null; usd: number | null; unknownSol: number; unpriced: number; series: SeriesDay[]; recent: PublicTx[] } | null;
  burns: { count: number; tokens: number; pctOfSupply: number | null; sol: number | null; usd: number | null; unknownSol: number; unpriced: number; series: SeriesDay[]; recent: PublicTx[] } | null;
  updatedAt: number;
}

export interface ProfilePage {
  profile: ProfileCard;
  stats: { posts: number; coins: number; followers: number; following: number };
  /** Meaningful only with a session. */
  following: boolean;
  self: boolean;
}

export interface FeedListOptions {
  /** Default `all`. */
  filter?: FeedFilter;
  /** 1 to 50, default 20. */
  limit?: number;
  /** The previous page's `next`. */
  before?: string;
  /** Only this profile's items. */
  author?: number;
}

const profileId = (id: number) => {
  if (!Number.isSafeInteger(id) || id <= 0) throw new StealthInputError("A profile id is a positive integer.");
  return id;
};

/** Feed and profile reads. */
export class FeedApi {
  constructor(private readonly api: ApiClient) {}

  /** One page, newest first. Pass `next` back as `before`. */
  async list(o: FeedListOptions = {}, opts?: RequestOptions) {
    return this.api.get<{ items: FeedItem[]; next: string | null }>("/feed", { filter: o.filter, limit: o.limit, before: o.before, author: o.author }, opts);
  }

  /** The whole feed, newest first, page by page. */
  iterate(o: Omit<FeedListOptions, "before"> = {}, p: PaginateOptions = {}): Paginator<FeedItem> {
    return paginate(async (cursor, signal) => {
      const page = await this.list({ ...o, before: cursor }, { signal });
      return { items: page.items, nextCursor: page.next };
    }, p);
  }

  /** Fees paid by type, over 7 or 30 days. */
  async fees(days: 7 | 30 = 30, opts?: RequestOptions) {
    return this.api.get<FeeBoard>("/feed/fees", { days }, opts);
  }

  /** Creator fees, dev buys and burns at a glance. */
  async feesOverview(opts?: RequestOptions) {
    return this.api.get<FeesOverview>("/feed/fees/overview", undefined, opts);
  }

  async profile(id: number, opts?: RequestOptions) {
    return this.api.get<ProfilePage>(`/feed/profiles/${profileId(id)}`, undefined, opts);
  }

  /** Coins a profile launched, up to 50; `total` has the full count. */
  async profileCoins(id: number, opts?: RequestOptions) {
    return this.api.get<{ coins: { address: string; chain: string; name: string; symbol: string; logoUrl: string | null; launchedAt: number | null }[]; total: number }>(
      `/feed/profiles/${profileId(id)}/coins`,
      undefined,
      opts,
    );
  }

  /** Up to 100, newest first. */
  async followers(id: number, opts?: RequestOptions): Promise<ProfileCard[]> {
    return (await this.api.get<{ profiles: ProfileCard[] }>(`/feed/profiles/${profileId(id)}/followers`, undefined, opts)).profiles;
  }

  /** Up to 100, newest first. */
  async following(id: number, opts?: RequestOptions): Promise<ProfileCard[]> {
    return (await this.api.get<{ profiles: ProfileCard[] }>(`/feed/profiles/${profileId(id)}/following`, undefined, opts)).profiles;
  }
}

/** Narrows a feed item. */
export const isFeedEvent = (item: FeedItem): item is FeedEvent => item.type === "event";
export const isFeedPost = (item: FeedItem): item is FeedPost => item.type === "post";
