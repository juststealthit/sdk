/**
 * @juststealthit/sdk. The root exports the read client, maths and helpers flat, and each chain module as a namespace.
 * Import a part directly to load only what it needs:
 *
 *   @juststealthit/sdk/api         every public read, typed, with retries, cache and pagination
 *   @juststealthit/sdk/live        the live stream: trades, launches, candles, chain head
 *   @juststealthit/sdk/solana      launch, trade and stake through the API, signed by your wallet
 *   @juststealthit/sdk/evm         direct on chain, the live EVM chains
 *   @juststealthit/sdk/multichain  one payment, a coin on each chain, from a server
 *   @juststealthit/sdk/perps       read-only perps market data, grouped by coin
 *   @juststealthit/sdk/math        fees, anti-sniper line, curves, staking rewards
 *   @juststealthit/sdk/utils       formatting, address checks, chain registry, site links
 *   @juststealthit/sdk/keystore    Node only: the config directory and keystore the Stealth CLI and MCP server share
 *
 * @module
 */
export * as evm from "./evm/index.js";
export * as solana from "./solana/index.js";
export * as multichain from "./multichain/index.js";
export * as perps from "./perps/index.js";
export * as live from "./live/index.js";
export * as math from "./math/index.js";
export * as utils from "./utils/index.js";

export { StealthClient, createStealthClient, type StealthClientOptions } from "./client.js";
export { StealthStream, createStealthStream, type StreamOptions } from "./live/stream.js";
export { ApiClient, DEFAULT_API_URL, type ApiOptions, type RequestOptions } from "./shared/api.js";
export { MemoryCache, type StealthCache } from "./shared/cache.js";
export { Paginator, paginate, type Page } from "./shared/paginate.js";
export type { RetryOptions } from "./shared/retry.js";
export { SDK_VERSION } from "./shared/version.js";
export { isEvmToken, isOutsideToken, isSolToken, normalizeCandleInterval, tokenChain, type CandleInterval, type MarketToken } from "./api/common.js";
export { isStakingNotOpenError } from "./api/staking.js";
export * from "./shared/errors.js";
