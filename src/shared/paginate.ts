/**
 * Cursor pagination as an async iterator.
 *
 * ```ts
 * for await (const trade of stealth.sol.tokens.iterateTrades(mint)) console.log(trade.txHash);
 * const last500 = await stealth.sol.tokens.iterateTrades(mint).take(500);
 * for await (const page of stealth.sol.tokens.iterateTrades(mint).pages()) console.log(page.items.length);
 * ```
 *
 * @module
 */

export interface Page<T> {
  items: T[];
  /** Pass it back for the next page. `null` at the end. */
  nextCursor: string | null;
}

export type PageFetcher<T> = (cursor: string | undefined, signal?: AbortSignal) => Promise<Page<T>>;

export interface PaginateOptions {
  /** Start after this cursor. */
  cursor?: string;
  /** Stop after this many pages. Default: no limit. */
  maxPages?: number;
  /** Stops the walk between pages. */
  signal?: AbortSignal;
}

/** An async iterable over every item of a cursor-paged list, one page fetched at a time. */
export class Paginator<T> implements AsyncIterable<T> {
  constructor(
    private readonly fetchPage: PageFetcher<T>,
    private readonly opts: PaginateOptions = {},
  ) {}

  /** Page by page. A page whose cursor repeats the last one ends the walk, so a stuck server can't loop it. */
  async *pages(): AsyncGenerator<Page<T>, void, undefined> {
    let cursor = this.opts.cursor;
    // the starting cursor counts as seen: a server answering it with itself mustn't loop
    const seen = new Set<string>(cursor ? [cursor] : []);
    for (let n = 0; this.opts.maxPages === undefined || n < this.opts.maxPages; n++) {
      if (this.opts.signal?.aborted) return;
      const page = await this.fetchPage(cursor, this.opts.signal);
      yield page;
      if (!page.nextCursor || seen.has(page.nextCursor) || page.items.length === 0) return;
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for await (const page of this.pages()) for (const item of page.items) yield item;
  }

  /** The first `n` items, fetching only the pages they need. */
  async take(n: number): Promise<T[]> {
    const out: T[] = [];
    if (n <= 0) return out;
    for await (const item of this) {
      out.push(item);
      if (out.length >= n) break;
    }
    return out;
  }

  /** Every item. Mind long lists: pass `maxPages` to bound it. */
  async toArray(): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this) out.push(item);
    return out;
  }
}

export const paginate = <T>(fetchPage: PageFetcher<T>, opts?: PaginateOptions) => new Paginator(fetchPage, opts);
