/**
 * An optional response cache for GET requests. Off unless you pass `cache` to a client.
 *
 * ```ts
 * const stealth = createStealthClient({ cache: new MemoryCache({ ttlMs: 10_000, maxEntries: 500 }) });
 * ```
 *
 * @module
 */

/** Anything that can hold JSON for a while: an in-memory map, a Redis wrapper, a KV store. */
export interface StealthCache {
  get(key: string): unknown | undefined | Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlMs: number): void | Promise<void>;
  delete?(key: string): void | Promise<void>;
  clear?(): void | Promise<void>;
}

export interface MemoryCacheOptions {
  /** How long an entry lives when the caller doesn't say. Default 5,000 ms. */
  ttlMs?: number;
  /** Oldest entries go first past this size. Default 1,000. */
  maxEntries?: number;
  /** For tests. Default `Date.now`. */
  now?: () => number;
}

/** A small in-process cache with a TTL per entry and a size cap. */
export class MemoryCache implements StealthCache {
  readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, { value: unknown; expires: number }>();

  constructor(opts: MemoryCacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 5_000;
    this.maxEntries = Math.max(1, opts.maxEntries ?? 1_000);
    this.now = opts.now ?? Date.now;
  }

  get(key: string): unknown | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // most recently used last, so the oldest is evicted first
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: unknown, ttlMs: number = this.ttlMs): void {
    if (ttlMs <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Live entries, expired ones included until they're next read. */
  get size(): number {
    return this.entries.size;
  }
}
