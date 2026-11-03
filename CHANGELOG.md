# Changelog

This project follows [Semantic Versioning](https://semver.org). Until 1.0, a minor version may change behaviour, and every such change is listed here.

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
