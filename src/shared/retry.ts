/**
 * Retries with exponential backoff and full jitter. The SDK never assumes the server's limits: on a 429 it waits for what the server
 * says in `Retry-After` (or `retryAfterSec`), and otherwise backs off on its own.
 *
 * @module
 */

export interface RetryOptions {
  /** Extra tries after the first. Default 2. `0` turns retries off. */
  retries?: number;
  /** The first backoff. Default 250 ms. */
  minDelayMs?: number;
  /** The longest backoff between two tries. Default 8,000 ms. */
  maxDelayMs?: number;
  /** A server asking to wait longer than this isn't retried: the error is thrown with `retryAfterSec` set. Default 30,000 ms. */
  maxRetryAfterMs?: number;
  /** HTTP statuses worth another try on a GET. Default 408, 425, 429, 500, 502, 503, 504. */
  statuses?: readonly number[];
  /**
   * Whether a POST is retried. `"rate-limited"` (default) retries only a 429, which the server refused before doing anything;
   * `true` retries like a GET, `false` never.
   */
  writes?: boolean | "rate-limited";
}

export const DEFAULT_RETRY: Required<RetryOptions> = {
  retries: 2,
  minDelayMs: 250,
  maxDelayMs: 8_000,
  maxRetryAfterMs: 30_000,
  statuses: [408, 425, 429, 500, 502, 503, 504],
  writes: "rate-limited",
};

export function resolveRetry(opts: RetryOptions | number | false | undefined): Required<RetryOptions> {
  if (opts === false) return { ...DEFAULT_RETRY, retries: 0 };
  if (typeof opts === "number") return { ...DEFAULT_RETRY, retries: Math.max(0, Math.floor(opts)) };
  return { ...DEFAULT_RETRY, ...(opts ?? {}) };
}

/** Full jitter: a random wait between 0 and min(max, min × 2^attempt). `attempt` is 0 for the first retry. */
export function backoffDelay(attempt: number, opts: Pick<Required<RetryOptions>, "minDelayMs" | "maxDelayMs">, random: () => number = Math.random): number {
  const ceiling = Math.min(opts.maxDelayMs, opts.minDelayMs * 2 ** Math.max(0, attempt));
  return Math.round(ceiling * random());
}

/**
 * `Retry-After` as milliseconds: either delay-seconds or an HTTP date. `null` if it's missing or unreadable.
 * `now` is for tests.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** Resolves after `ms`, or rejects with the signal's reason if it aborts first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
