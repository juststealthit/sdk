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
| `trades(mint, fn)` | Trades on one coin | `token:<mint>` |
| `trades(null, fn)` | Trades on every coin | `tokens` |
| `launches(fn)` | New coins | `tokens` |
| `token(mint, fn)` | One coin's trades and state changes | `token:<mint>` |
| `allTokens(fn)` | Every launch, trade and state change | `tokens` |
| `candles(mint, interval, fn)` | The latest candle after each trade | `candles:<mint>:<interval>` |
| `heads(fn)` | Chain slot and indexer lag, every few seconds | `head` |
| `subscribe(channel, fn)` | Raw messages | any |
| `iterate(channel, { bufferSize, signal })` | An async iterator; breaking out unsubscribes | any |

Each returns a function that unsubscribes. The last handler leaving a channel unsubscribes it on the server.

A trade message is `{ type: "trade", trade, token }`: the trade, and the coin as it stands after it. A candle message is `{ type: "candle", candle }`, where the candle may still be open. A head message is `{ type: "head", block, timestamp, indexed, lag, indexer }`.

## Reconnects

- Backoff: exponential with jitter, from `reconnect.minDelayMs` (default 500 ms) to `reconnect.maxDelayMs` (default 30 s). `reconnect.maxAttempts` gives up after that many failures in a row; the default never gives up.
- Every channel is re-subscribed on reconnect.
- `onReconnect(fn)` fires after each one. **Messages sent while the socket was down are gone**, so refetch whatever you show.
- `onStateChange(fn)` reports `connecting`, `open`, `reconnecting` and `closed`. `onError(fn)` reports each close.
- An application ping goes every `pingMs` (default 25 s), and a socket silent for `idleTimeoutMs` (default 90 s) is reopened.

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
