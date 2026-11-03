# @juststealthit/sdk

The TypeScript SDK for [Just Stealth It](https://juststealthit.xyz) ($STEALTH), the multi-chain memecoin launchpad and trading terminal.

- **Read everything**: coins on every chain, candles, trades, holders, risk, fee books, the Feed, staking, wallets, burns, leaderboards, all typed.
- **Go live**: a self-healing WebSocket for trades, launches, token updates, candles and the chain head.
- **Launch, trade and stake** on Solana (Pump.fun, Raydium LaunchLab, Meteora, and any token through Jupiter). The API builds each transaction, and your wallet checks and signs it.
- **Go direct on chain** on Robinhood Chain, BNB Chain, HyperEVM, Base and Arc, with no API in between.
- **Do the maths offline**: tax tiers, the anti-sniper line, bonding-curve quotes, staking estimates, tiny-price formatting.
- **Read perps markets**: read-only Hyperliquid, Aster and Jupiter Perps data, grouped by coin.

```bash
npm install @juststealthit/sdk
```

Node 20 or newer, or any modern browser. ESM only, with full types. Three runtime dependencies: `viem`, `@solana/web3.js` and `@noble/curves`.

> [!WARNING]
> **The EVM contracts are not audited.** Trades and launches cost real money and can't be undone. Start small, on a throwaway wallet. Nothing in this SDK is financial advice, and no estimate it gives is a promise of any return.

## Quick start

```ts
import { createStealthClient } from "@juststealthit/sdk";
import { formatPrice, formatUsd } from "@juststealthit/sdk/utils";

const stealth = createStealthClient(); // no key, no wallet

// the launchpad's board, every chain at once
const { items } = await stealth.market.list({ stages: ["new", "graduating"], sort: "volume" });
for (const coin of items.slice(0, 5)) console.log(coin.symbol, formatPrice(coin.priceUsd), formatUsd(coin.marketCapUsd));

// one Solana coin
const mint = items.find((c) => c.sol)!.address;
const [risk, holders] = await Promise.all([stealth.sol.tokens.risk(mint), stealth.sol.tokens.holders(mint)]);

// every trade, page by page, as an async iterator
for await (const trade of stealth.sol.tokens.iterateTrades(mint)) {
  if (trade.timestamp < Date.now() - 3_600_000) break;
  console.log(trade.side, trade.valueUsd);
}

// live trades
stealth.live().trades(mint, ({ trade }) => console.log("live:", trade.side, trade.valueUsd));
```

More in [`examples/`](examples): 20 runnable scripts.

## Modules

Import the part you use. `/api`, `/math`, `/utils` and `/perps` never load Solana's library.

| Import | What it does | Docs |
| --- | --- | --- |
| `@juststealthit/sdk` | `createStealthClient` and the errors, plus every module as a namespace | |
| `@juststealthit/sdk/api` | Every public read, typed, with retries, cache, pagination | [docs/api.md](docs/api.md) |
| `@juststealthit/sdk/live` | The live stream, and a polling helper for EVM | [docs/live.md](docs/live.md) |
| `@juststealthit/sdk/solana` | Launch, trade and stake on Solana; Jupiter swaps for any token | [docs/solana.md](docs/solana.md) |
| `@juststealthit/sdk/evm` | Launch, trade, claim and read, direct on five EVM chains | [docs/evm.md](docs/evm.md) |
| `@juststealthit/sdk/multichain` | One payment, a separate coin on each chain, from a server | [docs/multichain.md](docs/multichain.md) |
| `@juststealthit/sdk/perps` | Read-only perps market data from Hyperliquid, Aster and Jupiter | [docs/perps.md](docs/perps.md) |
| `@juststealthit/sdk/math` | Fees, the anti-sniper line, curves and staking rewards | [docs/math.md](docs/math.md) |
| `@juststealthit/sdk/utils` | Formatting, address checks and the chain registry | [docs/utils.md](docs/utils.md) |

Errors, retries, timeouts and caching are covered in [docs/errors-and-http.md](docs/errors-and-http.md).

## The read client

`createStealthClient(options?)` groups every public read by area. Every method takes an optional last argument with `{ signal, timeoutMs, retry, cache, headers }`.

| Area | Methods |
| --- | --- |
| `stealth.platform` | `appConfig`, `tokenConfig`, `officialToken`, `status`, `statusSummary`, `chartEvents`, `ipfsUrl` |
| `stealth.market` | The launchpad's coins across chains: `list`, `iterate`, `counts`, `search`, `stats` |
| `stealth.sol` | `config`, `status`, `stats`, `solPrice`, `locks`, `leaderboard`, `leaderboardStatus`, `quote`, `txStatus`, `bundleStatus`, `balance` |
| `stealth.sol.tokens` | `list`, `iterate`, `counts`, `search`, `get`, `find`, `candles`, `trades`, `iterateTrades`, `holders`, `topTraders`, `risk`, `creator`, `price`, `feePlan`, `buybacks`, `rewards`, `payout`, `marketing`, `marketingStats`, `metadata` |
| `stealth.sol.market` | Any Solana token, through Jupiter: `coin`, `candles`, `trending`, `launchers`, `launcher`, `quote`, `buildSwap` |
| `stealth.sol.wallets` | `pnl`, `trades`, `iterateTrades`, `rewards`, `analytics`, `activity`, `analysis`, `portfolio` |
| `stealth.sol.burn` | The $STEALTH buy back and burn: `overview`, `events`, `iterateEvents`, `coins`, `coin`, `next` |
| `stealth.sol.marketing` | The marketing ladder: `tiers`, `overview`, `summary`, `leaderboard` |
| `stealth.evm` | `config`, `wallet`, `positions`, and `chain(key)` for one chain's reads |
| `stealth.evm.chain("base")` | `nativePrice`, `listTokens`, `iterateTokens`, `countTokens`, `searchTokens`, `getToken`, `findToken`, `getCandles`, `getTrades`, `iterateTrades`, `getHolders`, `getTopTraders`, `getRisk`, `quote`, `getRewards`, `getPot`, `getBuybacks`, `getPayoutBot`, `getMarketing`, `getMarketingStats`, `marketing*` |
| `stealth.feed` | `list`, `iterate`, `fees`, `feesOverview`, `profile`, `profileCoins`, `followers`, `following` |
| `stealth.staking` | `overview`, `pool`, `position`, `estimate`, and the raw `prepareStake`, `prepareUnstake`, `submit` |
| `stealth.multichain` | Launch groups: `list`, `get`, `ofCoin` |
| `stealth.social` | `people`, `lookup`, `profile`, `checkHandle` |
| `stealth.live()` | The live stream, shared by the client |

Names that end in `Eth` (`priceEth`, `ethAmount`, `raisedEth`) hold the chain's **native coin**: SOL on Solana. The SDK keeps the API's names, so a row reads the same in the SDK as on the wire.

## Live stream

```ts
const live = stealth.live(); // or createStealthStream() from /live

const off = live.trades(mint, ({ trade, token }) => console.log(trade.side, token.marketCapUsd));
live.launches(({ token }) => console.log("new coin", token.symbol));
live.candles(mint, "1m", ({ candle }) => chart.update(candle));
live.heads(({ block, lag }) => console.log("slot", block, "indexer lag", lag));
live.onReconnect(() => refetch()); // messages sent while it was down are gone

for await (const msg of live.iterate("tokens")) console.log(msg.type); // or as an async iterator

off();
live.close();
```

One WebSocket, subscriptions counted per channel, exponential backoff with jitter, every channel re-subscribed after a reconnect, an application ping and an idle watchdog. It uses the global `WebSocket` (browsers, Node 22+); on Node 20 pass the `ws` package's: `createStealthClient({ stream: { WebSocket } })`.

EVM chains have no stream. `pollTrades(readPage, token, handler)` polls and calls `handler` once per new trade.

## Solana: launch, trade, stake

```ts
import { Keypair } from "@solana/web3.js";
import { createStealthSolana, keypairSigner } from "@juststealthit/sdk/solana";

const sol = createStealthSolana({ signer: keypairSigner(keypair) }); // or a wallet adapter, as it is

const { mint } = await sol.launch({ venue: "pump", name: "My Coin", symbol: "MINE", feeMode: "buyback", firstBuyLamports: 10_000_000n });

await sol.buy({ mint, amount: 10_000_000n, slippageBps: 300 });   // a launchpad coin, on its own venue
await sol.marketBuy({ mint: anyMint, amount: 5_000_000n });        // any Solana token, through Jupiter
await sol.swap({ mint: anyMint, side: "buy", amount: 1_000_000n }); // picks the route for you

await sol.stake(100n * 10n ** 6n); // $STEALTH staking: prepare, check, sign, submit
```

**Your key never leaves your process.** The API builds each transaction (a launch has to be built there: the coin's escrow comes from a key the server holds, and the mint is the server's to sign). The SDK checks that your wallet pays for it, and refuses one paid by anyone else. Then it adds your signature and sends it, through the API or your own `connection`. A staking transaction comes co-signed by the staking wallet and is signed exactly as it came.

| Venue | `venue` | Tiers |
| --- | --- | --- |
| Pump.fun | `pump` | None: Pump sets the fee. 70% of the creator part goes to the coin, 30% to the platform, locked on chain |
| Raydium LaunchLab | `raydium` | `RAYDIUM_TIERS`. The coin gets 0.5% on each tier, because Raydium caps it there, so it isn't 70/30 |
| Meteora | `meteora` | `METEORA_TIERS`. Meteora keeps 20%, and the rest splits 70/30 |

`feeMode` picks where creator fees go, locked at launch: `creator`, `social`, `team`, `wallet`, `marketing`, `holders`, `diamond`, `buyback`, `feed`, `liquidity` or `mix`. See [docs/solana.md](docs/solana.md) for what each needs. What's switched on can change: `stealth.sol.config()` says what the server offers right now.

## EVM: direct on chain

```ts
import { createWalletClient, http, parseEther } from "viem";
import { createStealthEvm, EVM_CHAINS } from "@juststealthit/sdk/evm";

const walletClient = createWalletClient({ account, chain: EVM_CHAINS.base, transport: http(rpcUrl) });
const stealth = createStealthEvm({ chain: "base", walletClient, rpcUrl });

const { token } = await stealth.launch({ name: "My Coin", symbol: "MINE", taxBps: 125, firstBuy: parseEther("0.001") });
const bought = await stealth.buy({ token, amountIn: parseEther("0.01"), slippageBps: 300 });
await stealth.sell({ token, amountIn: bought.amountOut / 2n });
await stealth.claim(token);
```

| Chain | Key | Id | Gas | DEX |
| --- | --- | --- | --- | --- |
| Robinhood Chain | `robinhood` | 4663 | ETH | Uniswap v4 |
| BNB Chain | `bnb` | 56 | BNB | PancakeSwap Infinity |
| HyperEVM | `hyperevm` | 999 | HYPE | Uniswap v4 |
| Base | `base` | 8453 | ETH | Uniswap v4 |
| Arc | `arc` | 5042 | USDC (18 decimals) | Uniswap v4 |

Avalanche, Arbitrum and X Layer are announced but have nothing deployed. The chain registry in `/utils` marks them `coming_soon`, and the SDK refuses them.

## Multi-chain

One payment from a home chain makes **a separate coin on each chain**. They're not bridged versions of one token. It runs server-side, because it needs the API's session cookie. See [docs/multichain.md](docs/multichain.md).

## Perps (read-only)

```ts
import { createPerpsClient } from "@juststealthit/sdk/perps";

const perps = createPerpsClient();
const groups = await perps.groups(); // Hyperliquid, Aster and Jupiter Perps, grouped by coin
const candles = await perps.candles(groups[0]!.markets[0]!, "15m");
perps.watchMids((mids) => console.log(mids.BTC));
```

Market data only, from each venue's public API. There is no order placement, no account access and nothing to sign.

## Maths and helpers

```ts
import { sniperFeeBps, splitEvmFee, quoteCurveBuy, estimateStakingReward } from "@juststealthit/sdk/math";
import { formatPrice, isSolanaAddress, CHAINS } from "@juststealthit/sdk/utils";

sniperFeeBps(125, 3);           // 7225: 72.25% three seconds after launch
formatPrice(0.00000123);        // "$0.0₅123"
isSolanaAddress("So111…112");   // true
```

## Sniper fee

A coin's first 15 seconds on Meteora and every EVM chain cost up to 90%, falling each second to the tier. `buy` and `sell` refuse a trade charged above `maxFeeBps` with a `StealthFeeTooHighError`. The default is 1,000 (10%), and raising it is your call. `sniperSchedule(tierBps)` shows the whole line.

## Errors

Everything the SDK throws on purpose is a `StealthError` with a stable `code`.

| Error | `code` | Meaning |
| --- | --- | --- |
| `StealthInputError` | `invalid_input` | The SDK refused your input before sending |
| `StealthFeeTooHighError` | `fee_too_high` | Over `maxFeeBps`: `feeBps` has the rate |
| `StealthTransactionMismatchError` | `transaction_mismatch` | A transaction from the API wasn't what you asked for, so it wasn't signed |
| `StealthTransactionError` | `transaction_failed`, `confirmation_timeout`, `bundle_*` | Failed on chain, or not confirmed in time. `signature` is set |
| `StealthApiError` | the API's own, such as `not_found`, `invalid_request`, `rate_limited` | `status`, `issues`, `retryAfterSec`, `requestId` |
| `StealthNetworkError` | `network_error` | No answer at all |
| `StealthTimeoutError` | `timeout` | Over `timeoutMs` |
| `StealthAbortError` | `aborted` | Your `AbortSignal` fired |
| `StealthParseError` | `invalid_response` | The answer wasn't JSON |
| `StealthBrowserWriteError` | `browser_write_blocked` | See [Browsers](#browsers) |
| `StealthWebSocketError` | `websocket_error` | The stream closed or couldn't connect |

`isStealthError(e, "not_found")` narrows by code. EVM reverts come through viem with the contract's error name, such as `StaleConfig` or `MaxBuyExceeded`.

## Reliability

- **Retries** on 5xx, 408, 425, 429, timeouts and network errors, with exponential backoff and jitter. A 429 waits as long as the server's `Retry-After` says, and the SDK assumes no limits of its own. A POST is retried only on a 429, so nothing is ever sent twice by surprise.
- **Timeouts** per try, and an **`AbortSignal`** per call that also cancels waits between retries.
- **An optional cache** for GETs (`cache: true`, or your own store), and identical GETs in flight share one request.
- **Request ids**: each request carries an `x-request-id`, which shows up on its error.
- **Hooks**: `onRequest` and `onResponse` for logging and metrics.
- **Pluggable `fetch`** and **base URL override** (`apiUrl`), for proxies, tests and your own backend.

## Browsers

**Reads work anywhere.** API writes don't work from a browser page on another site: the API allows cross-origin requests only for reads, so `POST /sol/launch`, `/sol/swap`, staking and `/multichain` are refused by the browser. The SDK raises `StealthBrowserWriteError` rather than a bare CORS failure. Call those from a server, or give the SDK your own backend with `apiUrl`. EVM needs none of this: it runs on your RPC, in a browser too.

No API key is needed. The API limits requests per IP. If you're limited, the error is `rate_limited` with `retryAfterSec`, and the client already waited and retried before throwing it.

## Development

```bash
npm install
npm run typecheck
npm test             # unit tests, no network
npm run build
npm run docs         # API reference into docs/api (typedoc)
npm run test:live    # reads against production: nothing written, nothing spent
npm run test:fork    # the real contracts, on local anvil forks (needs Foundry)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [CHANGELOG](CHANGELOG.md).

## Links

[Website](https://juststealthit.xyz) · [Docs](https://github.com/juststealthit/docs) · [Contracts](https://github.com/juststealthit/smart-contracts) · [X](https://x.com/juststealthit) · [Telegram](https://t.me/juststealthit)

Just Stealth It is not affiliated with Pump.fun, Raydium, Meteora, Jupiter, Hyperliquid, Aster, Robinhood, BNB Chain, Base, Circle or Solana Foundation.

MIT License.
