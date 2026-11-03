# Errors and HTTP

## Client options

Every API-backed client takes these: `createStealthClient`, `createStealthSolana` and `createStealthMultichain`.

| Option | Default | What it does |
| --- | --- | --- |
| `apiUrl` | `https://juststealthit.xyz/api` | Point it at your own backend, or a staging server |
| `fetch` | global `fetch` | Your own, for proxies, logging or tests |
| `timeoutMs` | 30,000 | Applies to each try |
| `retry` | 2 retries | `{ retries, minDelayMs, maxDelayMs, maxRetryAfterMs, statuses, writes }`, a number, or `false` |
| `cache` | off | `true` for an in-memory cache with a 5 s TTL, or any `StealthCache` |
| `cacheTtlMs` | the cache's | TTL for cached GETs |
| `headers` | none | Sent with every request |
| `requestId` | random UUID | Sends `x-request-id`. Pass a function to choose the id, or `false` to send none |
| `onRequest`, `onResponse` | none | Hooks for logging and metrics, called on every try |

Per call, pass `{ signal, timeoutMs, retry, cache, headers }` as the last argument. `cache` there is a TTL for that answer, or `false` to bypass the cache.

## Retries

- A GET is retried on 408, 425, 429 and 5xx, on a timeout, and on a network error, with exponential backoff and full jitter between `minDelayMs` and `maxDelayMs`.
- On a 429 the SDK waits as long as the server's `Retry-After` header (or `retryAfterSec`) says. It assumes no limits of its own. If the server asks for longer than `maxRetryAfterMs` (default 30 s), it throws at once with `retryAfterSec` set, so you can decide.
- A POST is retried **only on a 429** by default, because the server refused it before doing anything. A POST that may have reached the server is never sent twice unless you set `retry: { writes: true }`.
- Your `AbortSignal` cancels the request and any wait between retries.

## Cache and de-duplication

GETs only, keyed by full URL. Identical GETs in flight at the same moment share one request, cache or not. Live data (`tokens.price`, `quote`, `txStatus`, positions) skips the cache.

```ts
import { MemoryCache } from "@juststealthit/sdk";
const stealth = createStealthClient({ cache: new MemoryCache({ ttlMs: 10_000, maxEntries: 500 }) });
```

Any object with `get(key)` and `set(key, value, ttlMs)`, sync or async, works as a `StealthCache`.

## Error classes

Every error the SDK throws on purpose extends `StealthError` and has a stable `code`. Some also have a `retryable` getter.

| Class | `code` | Extra fields |
| --- | --- | --- |
| `StealthInputError` | `invalid_input` | |
| `StealthFeeTooHighError` | `fee_too_high` | `feeBps`, `maxFeeBps` |
| `StealthTransactionMismatchError` | `transaction_mismatch` | |
| `StealthTransactionError` | `transaction_failed`, `confirmation_timeout`, `bundle_rejected`, `bundle_expired` | `signature` |
| `StealthApiError` | the API's code | `status`, `issues`, `retryAfterSec`, `request`, `requestId` |
| `StealthNetworkError` | `network_error` | `request` |
| `StealthTimeoutError` (a `StealthNetworkError`) | `timeout` | `timeoutMs` |
| `StealthAbortError` | `aborted` | |
| `StealthParseError` | `invalid_response` | `request` |
| `StealthBrowserWriteError` | `browser_write_blocked` | |
| `StealthWebSocketError` | `websocket_error` | |
| `StealthUnsupportedError` | `unsupported` | |

API codes you'll meet include `invalid_request` (with `issues`), `not_found`, `bad_address`, `rate_limited`, `not_configured`, `use_jupiter`, `no_route`, `unknown_chain`, `evm_disabled` and `internal_error`.

```ts
import { isStealthError } from "@juststealthit/sdk";

try {
  await sol.buy({ mint, amount });
} catch (e) {
  if (isStealthError(e, "fee_too_high")) return wait(15_000);
  if (isStealthError(e, "use_jupiter")) return sol.marketBuy({ mint, amount });
  throw e;
}
```

Quote `error.requestId` when you report a problem.
