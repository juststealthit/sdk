/**
 * `StealthClient`: one typed client for every public read of the Just Stealth It API, plus the live stream. No key, no wallet.
 *
 * ```ts
 * import { createStealthClient } from "@juststealthit/sdk";
 *
 * const stealth = createStealthClient();
 * const { items } = await stealth.market.list({ stages: ["new"], sort: "volume" });
 * const coin = await stealth.sol.tokens.get(items[0]!.address);
 * for await (const trade of stealth.sol.tokens.iterateTrades(coin.address).take(100)) console.log(trade);
 * ```
 *
 * For launches and trades that need a signature, use `StealthSolana` (`/solana`) and `StealthEvm` (`/evm`).
 *
 * @module
 */
import { EvmApi } from "./api/evm.js";
import { FeedApi } from "./api/feed.js";
import { MarketApi, MultichainGroupsApi, PlatformApi, SocialApi } from "./api/platform.js";
import { SolApi } from "./api/sol.js";
import { StakingApi } from "./api/staking.js";
import { StealthStream, type StreamOptions } from "./live/stream.js";
import { ApiClient, type ApiOptions } from "./shared/api.js";

export interface StealthClientOptions extends ApiOptions {
  /** Settings for {@link StealthClient.live}. Its URL follows `apiUrl` unless you set `stream.url`. */
  stream?: Omit<StreamOptions, "apiUrl">;
}

/** Every public read, grouped by area. */
export class StealthClient {
  /** The HTTP core, for a route the SDK doesn't wrap yet: `stealth.api.get<T>("/path")`. */
  readonly api: ApiClient;
  /** Site settings, $STEALTH's config, status, chart events, IPFS. */
  readonly platform: PlatformApi;
  /** The launchpad's coins across every chain at once. */
  readonly market: MarketApi;
  /** Solana: coins, the Jupiter market, wallets, burns, leaderboards, marketing. */
  readonly sol: SolApi;
  /** EVM chains: per-chain boards, coins, marketing and hidden wallets. */
  readonly evm: EvmApi;
  /** The Feed, profiles and the fee board. */
  readonly feed: FeedApi;
  /** $STEALTH staking pools and positions. */
  readonly staking: StakingApi;
  /** Multi-chain launch groups. */
  readonly multichain: MultichainGroupsApi;
  /** Social accounts, for social launches. */
  readonly social: SocialApi;

  private readonly streamOpts: StreamOptions;
  private stream: StealthStream | null = null;

  constructor(opts: StealthClientOptions = {}) {
    const { stream, ...api } = opts;
    this.api = new ApiClient(api);
    this.platform = new PlatformApi(this.api);
    this.market = new MarketApi(this.api);
    this.sol = new SolApi(this.api);
    this.evm = new EvmApi(this.api);
    this.feed = new FeedApi(this.api);
    this.staking = new StakingApi(this.api);
    this.multichain = new MultichainGroupsApi(this.api);
    this.social = new SocialApi(this.api);
    this.streamOpts = { ...stream, apiUrl: this.api.apiUrl };
  }

  /** The live stream, opened on first subscription and shared by every caller of this client. */
  live(): StealthStream {
    if (!this.stream || this.stream.state === "closed") this.stream = new StealthStream(this.streamOpts);
    return this.stream;
  }

  /** Closes the live stream, if open. */
  close(): void {
    this.stream?.close();
    this.stream = null;
  }
}

export const createStealthClient = (opts: StealthClientOptions = {}) => new StealthClient(opts);
