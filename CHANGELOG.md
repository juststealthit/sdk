# Changelog

This project follows [Semantic Versioning](https://semver.org). Until 1.0, a minor version may change behaviour, and every such change is listed here.

## 0.3.0 (2026-11-06)

### Added

- **External coins from every chain.** The All list of `stealth.market.list()` now carries the coins trending on Solana and the other chains, marked `outside: { chain, launchpad, trendRank }`. `tokenChain(row)`, `isOutsideToken`, `isSolToken` and `isEvmToken` tell rows apart, and `ownOnly: true` leaves external coins out (`iterate` keeps walking past a page of only those).
- **`stealth.market.trending({ chains })`**: Trending across chains, coins launched here and external ones mixed, Solana first.
- **External coin pages on any live chain**: `sol.market.coin(address, { chain })` and `sol.market.candles(address, interval, { chain, to })` open an EVM coin by its 0x address. `to` pages back through the chart; the result's `chain` says which chain it is.
- **`@juststealthit/sdk/keystore`** (Node only): the config directory and the encrypted keystore the Stealth CLI and MCP server share, in one place. Same version 1 format as before, written atomically with mode 0600. `stealthConfigDir()` falls back to where the 0.1 CLI looked when only that holds files. Importing it doesn't load Solana's or viem's libraries.
- **Chains coming soon**: Ethereum, Arbitrum One and Avalanche C-Chain (contracts being deployed: `deploying: true`, no addresses yet) and X Layer, with their chain ids, gas coins and explorers. `LIVE_CHAIN_KEYS`, `LIVE_EVM_CHAIN_KEYS`, `COMING_SOON_CHAIN_KEYS`, `deployingChains()`, `isLiveEvmChain`, `isComingSoonChain`, `chainKeyOf` and `requireLiveChain`. Aliases such as `bsc`, `eth`, `arb` and `avax` work wherever a chain key goes.
- **Live stream filters**: `TradeFilter` (`side`, `minValueUsd`, `maxValueUsd`, `minNative`, `traders`, `excludeTraders`, `devBuys`, `sniperTaxed`), `matchesTrade`, `live.trades(mint, fn, filter)` and `live.iterateTrades(mint, { filter, onDrop })`. `iterate` takes `filter` and `onDrop` too.
- **Staking status**: `stealth.staking.status()` answers `open` or `not_open` (staking is built and opens soon), and `isStakingNotOpenError(e)` recognises the API's 503 `not_configured`.
- New reads: `sol.burn.bot()` (the $STEALTH buy-back bot, paid for by the coin's own fees), `sol.marketing.analytics()`, `sol.tokens.ctoEligibility(mint, wallet?)`, `sol.ctoApplications(wallet)`, `multichain.config()`, `platform.logoUrl(file)` and `platform.health()`.
- `coinPageUrl({ address, chain, onPlatform })` and `SITE_URL` in `/utils`: the site's page for a coin, `/token` for ours and `/trending` for external ones.
- `normalizeCandleInterval`, `DEFAULT_CANDLE_INTERVAL`, `toMarketCandleInterval` and `fromMarketCandleInterval` (`1D` and `1d`).
- Typed pair search and pair detail (`PairSearch`, `PairDetail`), `SolTokenDetail.sol.pendingRecipient`, and the trending ranking's extra figures on `MarketCoin`.
- A new example, `examples/trending.ts`, and `docs/keystore.md`.

### Changed

- **One minute is the smallest candle.** The platform dropped the `1s` interval, so `CandleInterval` and `CANDLE_INTERVALS` no longer list it. Passing `"1s"` still works: it reads `1m`, as the API itself does, with a one-time deprecation warning. `sol.market.candles` now defaults to `1m`, as the site's charts open.
- Coming-soon chains are refused with a `StealthUnsupportedError` (code `unsupported`) that says the chain is coming soon, instead of an unknown-chain error.
- `EvmChainKey`, `EvmApiChain`, `MarketChain`, `MultichainChain`, `EVM_CHAINS`, `EVM_API_CHAINS` and `MULTICHAIN_CHAINS` all follow the chain registry; their values are unchanged. Contract addresses live only in `evm/deployments.ts`.
- `getChain` takes any case and aliases, and no longer answers for keys such as `toString`. `explorerUrl` works on coming-soon chains.
- The wallet profile's headline figures are now `WalletProfile.market` (`WalletMarketFigures`), a neutral name; the SDK maps the API's key.
- `live.iterate` returns an async iterator whose `return()` ends it at once, even while it waits for a message. Subscribing on a closed stream throws `StealthWebSocketError`, and a stream holds at most 200 channels (`MAX_STREAM_CHANNELS`), as the server does.
- The live stream's idle timeout is off when `pingMs` is 0, and never shorter than 2.5 pings.
- `isStealthError` also recognises errors thrown by another installed copy of the SDK.
- `feed.feesOverview()` answers `null` on a server that doesn't publish it, instead of throwing `not_found`. `FeedEventKind` is open to kinds added later.
- Docs match the API: candles only form where someone traded (no flat filler), buy-back and payout transaction fields are explorer links, and the fee bot's schedule is the same for every coin.

### Fixed

- The live stream could open a second socket when you subscribed while it waited to reconnect, delivering every message twice and leaking a ping timer.
- A silent socket was only reopened after its close event, which a dead connection can take minutes to send; a connect that hung was never retried. Both now reconnect at once (`connectTimeoutMs` is new).
- A server that accepted and dropped the socket at once was retried every 500 ms: the backoff now resets only after the first message.
- `pollTrades` could call its handler after it was stopped.
- An explicit `undefined` in the reconnect options made the delay `NaN`.
- With the cache on, `StealthSolana.getPrice`, `quote` and the confirmation polls could be served stale answers. They're never cached now.
- `StealthSolana.confirm` kept polling a signature the API refused (a 400) until its timeout, and a launch bundle was resent to a server without bundles for 70 seconds. Both fail at once now.
- `sol.quote` and `StealthSolana.quote` accepted slippage the swap then refused; both take 10 to 5,000 bps, like the swap.
- `evm.chain(c).searchTokens` found nothing for a full address in lower case; it's checksummed first. `quote` checks its amount and slippage, and `wallet` / `positions` the Solana owner.
- `multichain.ofCoin` and `getGroupOfCoin` missed EVM coins given in lower case; group ids and coin paths are encoded.
- Staking calls check the pool (`stealth`), the owner and the signed transaction before sending.
- `formatCompact(999_999)` printed `1000K`, `formatUsd(999.6)` printed `$1000`, and `formatPrice(0.0000099999)` printed a price ten times too small. `parseUnits` reads numbers in exponent form such as `1e-7`.
- `rewardShare` could return a negative share.
- `checkLaunchInput` allowed `slippageBps: 10000` (no protection on the first buy) and fractional lock or window seconds.
- Path parameters of `StealthSolana`'s reads are checked before they go into a URL.
- A paginator whose starting cursor came back as the next one looped once more; it stops now.

### Compatibility

Code written for 0.2 keeps working, with two type-level changes: `"1s"` is no longer a `CandleInterval` (it still works at runtime), and `WalletProfile`'s headline figures moved to `market`. `sol.market.coin(address, requestOptions)` in the 0.2 form is still read as before.

## 0.2.0

### Added

- **`createStealthClient()`**: one typed client for every public read, grouped by area.
  - `platform`: app config, $STEALTH's token config, status and the status page, chart events, IPFS URLs.
  - `market`: the launchpad's coins across every chain, with counts, search and platform stats.
  - `sol`: config, status, stats, SOL price, locks, leaderboards, quotes, transaction and bundle status, balances.
  - `sol.tokens`: list, search, counts, detail, candles, trades, holders, top traders, risk, creator, live price, fee plan, buybacks, rewards, payouts, marketing and metadata.
  - `sol.market`: any Solana token through Jupiter (coin pages, USD candles, trending coins, launchers, quotes and swaps).
  - `sol.wallets`: PnL, trades, rewards, analytics, activity, analysis and portfolio.
  - `sol.burn` (the $STEALTH buy back and burn) and `sol.marketing` (the marketing ladder).
  - `evm` and `evm.chain(key)`: per-chain boards, coin detail, candles, trades, holders, top traders, risk, quotes, rewards, pots, buybacks, the payout bot and marketing, plus hidden-wallet balances and positions.
  - `feed`: the Feed, profiles, followers and the fee board.
  - `staking`: pools, positions, estimates, and the raw prepare and submit calls.
  - `multichain` (launch groups) and `social` (account lookups).
- **Async-iterator pagination** on every paged list (`iterate*`): `for await`, `.take(n)`, `.toArray()` and `.pages()`.
- **`/live`**: a live stream over the platform's WebSocket for trades, launches, token updates, candles and the chain head. It reconnects with backoff, re-subscribes every channel, sends an application ping, reopens an idle socket, offers `onReconnect` and async iteration, and works with any WebSocket implementation. `pollTrades` polls EVM chains, which have no stream.
- **Solana trading**: `marketQuote`, `marketBuy` and `marketSell` trade any token through Jupiter. `swap` picks the route automatically. `stake` and `unstake` stake $STEALTH: prepare, check, sign, submit. `StealthSolana.data` exposes the full typed read client.
- **`/perps`**: read-only perps market data from Hyperliquid, Aster and Jupiter Perps, normalised and grouped by coin. Includes candles and live mids. There is no order placement.
- **`/math`**: the anti-sniper line, fee splits per venue and tier, slippage bounds, constant-product bonding-curve quotes, EVM `sqrtPriceX96` prices, and staking reward estimates with boosts.
- **`/utils`**: tiny-price formatting with subscript zeros (and parsing it back), exact `formatUnits` and `parseUnits`, address checks per chain family with EIP-55 checksums, and a chain registry with coming-soon chains marked.
- **HTTP core**:
  - retries with exponential backoff and jitter on 5xx, 408, 425, 429, timeouts and network errors, respecting `Retry-After`;
  - a per-try timeout, and an `AbortSignal` on every call;
  - an optional GET cache (`MemoryCache` or your own) and de-duplication of identical GETs in flight;
  - an `x-request-id` per request, `onRequest` and `onResponse` hooks, custom headers, and bigint-safe JSON bodies.
- **Errors**: every `StealthError` has a stable `code` and a `retryable` getter. New classes: `StealthNetworkError`, `StealthTimeoutError`, `StealthAbortError`, `StealthParseError`, `StealthTransactionError`, `StealthWebSocketError` and `StealthUnsupportedError`. `StealthApiError` carries the request's id, method and URL. `isStealthError(e, code)` narrows.
- New subpath exports: `/api`, `/live`, `/math`, `/utils`, `/perps`.
- Docs for every module in `docs/`, 13 new examples (20 in all), `CONTRIBUTING.md` and a typedoc config (`npm run docs`).

### Changed

- **Retries are on by default** (2 retries). Pass `retry: false` for the old fail-fast behaviour. POSTs are retried only on a 429.
- Solana transaction failures and confirmation timeouts now throw `StealthTransactionError`, which extends `StealthError`, so existing `instanceof StealthError` checks still match.
- `StealthSolana.getTrades`, `getHolders`, `getFeePlan`, `getBuybacks`, `getRewards` and `getPortfolio` now return typed results instead of `unknown`.
- A non-JSON answer is a `StealthParseError` (still a `StealthError`, with the same message).
- The README no longer lists rate limits. The server sets and changes them, and the SDK follows its `Retry-After`.

### Compatibility

The 0.1 API keeps working: `StealthSolana`, `StealthEvm`, `StealthMultichain`, every constant and every error class keep their names and signatures.

## 0.1.0

- First release: `StealthEvm` (direct on chain, five EVM chains), `StealthSolana` (launches and trades through the API, signed locally) and `StealthMultichain` (one payment, a coin on each chain).
