// The HTTP knobs: retries with backoff, a cache, request ids and logging hooks, timeouts, cancellation and typed errors.
import { createStealthClient, isStealthError, MemoryCache, StealthApiError, StealthTimeoutError } from "@juststealthit/sdk";

const stealth = createStealthClient({
  retry: { retries: 3, minDelayMs: 300, maxDelayMs: 5_000 },
  cache: new MemoryCache({ ttlMs: 10_000, maxEntries: 500 }),
  timeoutMs: 10_000,
  onResponse: (e) => console.log(`${e.method} ${e.url} → ${e.status ?? "error"} in ${e.durationMs} ms${e.cached ? " (cache)" : ""} [${e.requestId}]`),
});

await stealth.sol.config();
await stealth.sol.config(); // served from the cache

// cancel a slow request
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 50);
await stealth.market.stats({ signal: ctrl.signal }).catch((e) => console.log("aborted:", isStealthError(e, "aborted")));

try {
  await stealth.sol.tokens.get("11111111111111111111111111111111");
} catch (error) {
  if (error instanceof StealthApiError) console.log(`API said ${error.status} ${error.code}, request ${error.requestId}`);
  else if (error instanceof StealthTimeoutError) console.log("timed out");
  else throw error;
}

// or for "maybe there's nothing": find() returns null on a 404
console.log(await stealth.sol.tokens.find("11111111111111111111111111111111"));
