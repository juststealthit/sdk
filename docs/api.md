# The read client

```ts
import { createStealthClient } from "@juststealthit/sdk"; // or from "@juststealthit/sdk/api"

const stealth = createStealthClient({ /* every option is optional; see errors-and-http.md */ });
```

No key and no wallet. Every method returns a promise and takes an optional last argument, `{ signal, timeoutMs, retry, cache, headers }`. Input is checked before anything is sent: a malformed address rejects with `StealthInputError` and costs no request.

## Conventions

- **Units.** Display figures are floats in whole units (`priceUsd`, `valueUsd`, `balance`). Raw amounts are decimal strings in base units (`amount`, `balanceRaw`, `minAmount`). Fields ending in `Eth` hold the chain's native coin, which is SOL on Solana. Fields ending in `Wei` are 18-decimal fixed point; `weiToNumber()` reads one.
- **Times.** `timestamp`, `at`, `createdAt` and `updatedAt` are unix milliseconds. Candle `time`, and the `from` / `to` of a candle request, are unix seconds.
- **Paging.** Lists that page return `{ items, nextCursor }`. Each has an `iterate*` twin that returns a `Paginator`: an async iterable with `.take(n)`, `.toArray()` and `.pages()`.
- **Missing things.** `get` throws a `not_found` `StealthApiError` for an unknown coin; `find` returns `null` instead.

## Platform: `stealth.platform`

| Method | Returns |
| --- | --- |
| `appConfig()` | Whether the site is open (`comingSoon`), its public links and the official contract address |
| `tokenConfig()` | Every official token config |
| `officialToken()` | $STEALTH once it's live, or `null` |
| `status()` | Network, indexer, SOL price, which features are up |
| `statusSummary()` | Components, uptime by day, incidents |
| `chartEvents(token, symbol?)` | Chart markers for any chain's coin: dev trades, events, callouts, posts |
| `ipfsUrl(cid, file?)` | A URL for an image stored on IPFS, served through the API |

## Cross-chain board: `stealth.market`

The launchpad's own coins, Solana and every open EVM chain merged. A chain that fails is left out rather than failing the list.

| Method | Notes |
| --- | --- |
| `list({ stages, sort, dir, cursor, q, mcap, vol, socials, chains })` | 50 per page. Default: every stage, sorted by `age` |
| `iterate(options)` | Every page |
| `counts(filters)` | Per stage, and per chain |
| `search(q, { limit, chains })` | Up to 20 |
| `stats()` | Platform totals: launches, volume, payouts, the pair and launch-type mix, recent activity |

`sort` is one of `age`, `price`, `marketCap`, `liquidity`, `volume`, `txns`, `holders`, `change5m`, `change1h`, `change24h`, `progress`, `tax`, `lastTrade` and `migrated`. `dir` defaults to `asc` for `age` (newest first) and `desc` for the rest.

## Solana: `stealth.sol`

| Method | Notes |
| --- | --- |
| `config()` | Venues, tax tiers, launch types and limits as the server has them now |
| `status()` | Indexer lag, SOL price, feature states |
| `stats()` | Solana platform totals |
| `solPrice()` | `{ usd, updatedAt, stale }` |
| `locks()` | Token locks the platform tracks |
| `leaderboard({ source, range, sort, limit })` | Top wallets. `source`: `all`, `kols`, `smart`, `launchpad` |
| `quote(mint, side, amount, slippageBps?)` | A launchpad coin still on its own venue. Others answer `use_jupiter`: use `sol.market.quote` |
| `txStatus(signature)`, `bundleStatus(id)` | Right after sending |
| `balance(owner, mint?)` | Lamports, and a token balance |

### `stealth.sol.tokens`

`list`, `iterate`, `counts`, `search`, `get`, `find`, plus per coin:

| Method | Returns |
| --- | --- |
| `candles(mint, { interval, from, to })` | Up to 3,000 candles, gaps filled flat. Intervals: `1s`, `1m`, `5m`, `15m`, `1h`, `4h`, `1D` |
| `trades(mint, cursor?)` / `iterateTrades(mint)` | Newest first, 50 per page |
| `holders(mint)` | The 20 largest, with the pool, escrow, creator, locks, snipers and burns labelled |
| `topTraders(mint)` | Up to 30, by PnL |
| `risk(mint)` | Top 10 share, the dev's holdings, sniper share, first-block buyers |
| `creator(mint)` | Who the coin pays |
| `price(mint)` | Read from the pool now when it can be (`live: true`). Never cached |
| `feePlan(mint)` | The locked launch type, its slices, and what each holds |
| `buybacks(mint)`, `rewards(mint)`, `payout(mint)` | What the launch type has done, and when the bot next runs |
| `marketing(mint)`, `marketingStats(mint)` | A Marketing coin's ladder, raise and rank |
| `metadata(mint)` | The metadata JSON behind the coin's URI |

### `stealth.sol.market`: any Solana token

Coin pages, USD candles, trending coins and launchers, and Jupiter-routed quotes, for any mint. The data comes from third-party feeds, so a read can come back `status: "unavailable"` or `stale: true` rather than throwing.

| Method | Notes |
| --- | --- |
| `coin(mint)` | Price, liquidity, holders, socials, curve progress, launcher, fee sharing |
| `candles(mint, interval?)` | USD. `1m`, `5m` (default), `15m`, `1h`, `4h`, `1d` |
| `trending()` | Up to 24 coins. `onPlatform` marks ones launched here too |
| `launchers()`, `launcher(wallet)` | Built in the background: poll while `status` is `"loading"` |
| `quote(mint, side, amount, slippageBps?)` | Buy: lamports in. Sell: base units in |
| `buildSwap({ mint, owner, side, amount })` | The unsigned v0 transaction. `StealthSolana.marketBuy` does all of it for you |

### `stealth.sol.wallets`

| Method | Notes |
| --- | --- |
| `pnl(address, range?)` | On launchpad coins. `1d`, `7d`, `30d`, `all` |
| `trades(address, { cursor, limit, token })` / `iterateTrades` | Newest first |
| `rewards(address)` | Paid and owed, by asset |
| `analytics(address, refresh?)` | Profile: identity, leaderboard ranks, headline PnL |
| `activity(address)` | The last 20 actions |
| `analysis(address)` | Wins, trading style, routes |
| `portfolio(owner)` | Holdings and launches of launchpad coins |

### `stealth.sol.burn` and `stealth.sol.marketing`

`burn.overview()`, `burn.events()` / `burn.iterateEvents()`, `burn.coins({ range, limit })`, `burn.coin(mint)` and `burn.next()` cover the $STEALTH buy back and burn. `marketing.tiers()`, `overview(limit?)`, `summary()` and `leaderboard(range?)` cover the marketing ladder across coins.

## EVM: `stealth.evm`

| Method | Notes |
| --- | --- |
| `config(wallet?)` | Which chains are live, with their contracts |
| `chain(key)` | One chain's reads. Keys: `robinhood`, `bnb`, `hyperevm`, `base`, `arc` |
| `wallet(solanaOwner)`, `positions(solanaOwner)` | A Solana wallet's hidden EVM wallet |

On `stealth.evm.chain("base")`: `nativePrice`, `listTokens`, `iterateTokens`, `countTokens`, `searchTokens`, `getToken`, `findToken`, `getCandles`, `getTrades`, `iterateTrades`, `getHolders`, `getTopTraders`, `getRisk`, `quote`, `getRewards`, `getPot`, `getBuybacks`, `getPayoutBot`, `getMarketing`, `getMarketingStats`, `marketingTiers`, `marketingOverview`, `marketingSummary`, `marketingLeaderboard` and `marketingAnalytics`.

For reads straight from the contracts, with no API, use `StealthEvm` (see [evm.md](evm.md)).

## Feed: `stealth.feed`

| Method | Notes |
| --- | --- |
| `list({ filter, limit, before, author })` / `iterate` | `filter`: `all`, `coins`, `posts`, `socials`. `isFeedEvent()` and `isFeedPost()` narrow an item |
| `fees(days)` | Fees paid by type over 7 or 30 days |
| `feesOverview()` | Creator fees, the platform's dev buys and burns |
| `profile(id)`, `profileCoins(id)`, `followers(id)`, `following(id)` | Public profiles |

## Staking: `stealth.staking`

| Method | Notes |
| --- | --- |
| `overview()`, `pool(id?)` | Rate, boosts, cooldown, totals. `{ enabled: false }` while staking is off |
| `position(pool, owner)` | Staked, unstaking, earned, boost, history. Never cached |
| `estimate(pool, amount, days)` | At today's rate and boosts. An estimate, not a promise |
| `prepareStake`, `prepareUnstake`, `submit` | The raw flow. `StealthSolana.stake` and `unstake` wrap it |

## Multi-chain groups and social

`stealth.multichain.list()`, `get(id)` and `ofCoin(chain, token)` say which coins launched together (`null` when there's no group). `stealth.social.people(provider)`, `lookup(provider, handle)`, `profile(provider, handle)` and `checkHandle(provider, handle)` cover social accounts.

## Anything else

`stealth.api.get<T>(path, query?, options?)` reaches any public route the SDK doesn't wrap yet, with the same retries, cache and errors.
