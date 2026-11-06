# Live stream

```ts
import { createStealthStream } from "@juststealthit/sdk/live";
// or: createStealthClient().live()

const live = createStealthStream();
```

One WebSocket carries every subscription. It opens on the first one, and later ones share it.

## Helpers

| Method | Gets | Channel |
| --- | --- | --- |
| `trades(mint, fn, filter?)` | Trades on one coin | `token:<mint>` |
| `trades(null, fn, filter?)` | Trades on every coin | `tokens` |
| `iterateTrades(mint \| null, { filter, bufferSize, signal, onDrop })` | The same, as an async iterator | either |
| `launches(fn)` | New coins | `tokens` |
| `token(mint, fn)` | One coin's trades and state changes | `token:<mint>` |
| `allTokens(fn)` | Every launch, trade and state change | `tokens` |
| `candles(mint, interval, fn)` | The latest candle after each trade. `1m` is the smallest interval | `candles:<mint>:<interval>` |
| `heads(fn)` | Chain slot and indexer lag, every few seconds | `head` |
| `subscribe(channel, fn)` | Raw messages | any |
| `iterate(channel, { bufferSize, signal, filter, onDrop })` | An async iterator; breaking out, `return()` or `signal` unsubscribes at once | any |

Each returns a function that unsubscribes. The last handler leaving a channel unsubscribes it on the server. One stream holds up to `MAX_STREAM_CHANNELS` (200) channels; subscribing on a closed stream throws `StealthWebSocketError` (`createStealthClient().live()` opens a new one for you).

## Filters

A `TradeFilter` keeps only the trades you want: `{ side, minValueUsd, maxValueUsd, minNative, traders, excludeTraders, devBuys, sniperTaxed }`. Every field is optional, and all of them have to match. `matchesTrade(trade, filter)` applies one anywhere.

```ts
live.trades(mint, ({ trade }) => alert(trade), { side: "buy", minValueUsd: 1_000, devBuys: false });
for await (const { trade } of live.iterateTrades(null, { filter: { side: "sell" }, onDrop: (n) => console.warn(n, "dropped") })) console.log(trade.id);
```

Filters run in the SDK: the socket still carries every message of the channel.

An iterator buffers `bufferSize` messages (default 1,000) while your loop is busy; past that the oldest go, and `onDrop` hears how many so far.

A trade message is `{ type: "trade", trade, token }`: the trade, and the coin as it stands after it. A candle message is `{ type: "candle", candle }`, where the candle may still be open. A head message is `{ type: "head", block, timestamp, indexed, lag, indexer }`.

## Reconnects

- Backoff: exponential with jitter, from `reconnect.minDelayMs` (default 500 ms) to `reconnect.maxDelayMs` (default 30 s). `reconnect.maxAttempts` gives up after that many failures in a row; the default never gives up. The backoff resets on the first message after a reconnect, not on the open itself, so a server that accepts and drops at once isn't hammered.
- Every channel is re-subscribed on reconnect.
- `onReconnect(fn)` fires after each one. **Messages sent while the socket was down are gone**, so refetch whatever you show.
- `onStateChange(fn)` reports `connecting`, `open`, `reconnecting` and `closed`. `onError(fn)` reports each close.
- An application ping goes every `pingMs` (default 25 s), and a socket silent for `idleTimeoutMs` (default 90 s, and never under 2.5 pings) is reopened at once, without waiting for a dead connection's close. With `pingMs: 0` the idle timeout is off unless you set it.
- A connect that neither opens nor fails within `connectTimeoutMs` (on `ReconnectingSocket`; default the idle timeout, or 30 s) is dropped and retried.

## Environments

The stream uses the global `WebSocket`, which browsers, Node 22+, Deno and Bun all have. On Node 20, pass one in:

```ts
import { WebSocket } from "ws";
const live = createStealthStream({ WebSocket });
```

The URL follows `apiUrl`: `https://host/api` streams from `wss://host/api/sol/ws`. Pass `url` to set it directly.

## EVM: polling

EVM chains have no stream. `pollTrades` reads the newest page on an interval and calls your handler once per trade it hasn't seen, oldest first. Its first poll only records what's already there.

```ts
import { pollTrades } from "@juststealthit/sdk/live";
const chain = stealth.evm.chain("base");
const stop = pollTrades((token) => chain.getTrades(token), token, (trade) => console.log(trade), { intervalMs: 4_000 });
```
