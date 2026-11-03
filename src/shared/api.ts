/**
 * The HTTP core every API-backed part of the SDK shares: base URL, pluggable `fetch`, timeouts, `AbortSignal`, retries with backoff,
 * an optional GET cache, in-flight de-duplication, request ids and the session cookie a server-side caller has to carry itself.
 *
 * @module
 */
import { MemoryCache, type StealthCache } from "./cache.js";
import {
  StealthAbortError,
  StealthApiError,
  StealthBrowserWriteError,
  StealthNetworkError,
  StealthParseError,
  StealthTimeoutError,
  type RequestInfo,
} from "./errors.js";
import { backoffDelay, parseRetryAfter, resolveRetry, sleep, type RetryOptions } from "./retry.js";
import { SDK_VERSION } from "./version.js";

/** The official API. */
export const DEFAULT_API_URL = "https://juststealthit.xyz/api";

/** What a request hook sees. */
export interface RequestEvent extends RequestInfo {
  /** Set on responses. */
  status?: number;
  /** Milliseconds since the try started. Set on responses and errors. */
  durationMs?: number;
  /** Whether the answer came from the cache. */
  cached?: boolean;
  error?: unknown;
}

export interface ApiOptions {
  /** The API's base URL, without a trailing slash. Point it at your own backend to write from a browser, or at a staging server. */
  apiUrl?: string;
  /** Your own `fetch`, for proxies, logging or tests. Default: the global one. */
  fetch?: typeof globalThis.fetch;
  /** Per try. Default 30 s. */
  timeoutMs?: number;
  /** Retries on 5xx, 429, timeouts and network errors. A number is the retry count; `false` turns them off. Default 2 retries. */
  retry?: RetryOptions | number | false;
  /**
   * Caches GET answers. `true` uses a {@link MemoryCache} with a 5 s TTL; pass your own {@link StealthCache} for anything else.
   * Off by default: the API's data moves every second.
   */
  cache?: StealthCache | boolean;
  /** TTL for cached GETs when a call doesn't set one. Default: the cache's own, or 5 s. */
  cacheTtlMs?: number;
  /** Headers sent with every request, such as an `authorization` your own backend expects. */
  headers?: Record<string, string>;
  /**
   * Sends `x-request-id` on every request, so the id in an error matches what a proxy logs. A function picks the id.
   * Default: on, with a random UUID. `false` turns it off (browsers then skip a CORS preflight).
   */
  requestId?: boolean | (() => string);
  /** Called before every try. */
  onRequest?: (event: RequestEvent) => void;
  /** Called after every try, whether it succeeded or not. */
  onResponse?: (event: RequestEvent) => void;
}

/** Per-call settings. */
export interface RequestOptions {
  /** Cancels the request, including any wait between retries. */
  signal?: AbortSignal;
  /** Overrides the client's timeout for this call. */
  timeoutMs?: number;
  /** Overrides the client's retry settings for this call. */
  retry?: RetryOptions | number | false;
  /** GETs only: a TTL for this answer in the cache, or `false` to bypass it. Ignored without a client cache. */
  cache?: number | false;
  /** Extra headers for this call. */
  headers?: Record<string, string>;
}

export type Query = Record<string, string | number | boolean | undefined | null>;

const isBrowserPage = () => typeof (globalThis as { document?: unknown }).document !== "undefined";

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** `?a=1&b=2`, without empty values. Arrays aren't sent by any public route, so they're joined with commas. */
export function toQueryString(query?: Query): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Joins a timeout and the caller's signal. Returns the joint signal and which one fired. */
function linkSignals(timeoutMs: number, outer?: AbortSignal) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort(new Error("timeout"));
  }, timeoutMs);
  const onAbort = () => ctrl.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) ctrl.abort(outer.reason);
    else outer.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

/** The API over HTTP, with the session cookie a server-side caller has to carry itself. */
export class ApiClient {
  readonly apiUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly retry: RetryOptions | number | false | undefined;
  private readonly cache: StealthCache | null;
  private readonly cacheTtlMs: number;
  private readonly headers: Record<string, string>;
  private readonly requestId: (() => string) | null;
  private readonly onRequest: ApiOptions["onRequest"];
  private readonly onResponse: ApiOptions["onResponse"];
  private readonly cookies = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(opts: ApiOptions = {}) {
    this.apiUrl = (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.fetcher = opts.fetch ?? ((...args) => globalThis.fetch(...args));
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.retry = opts.retry;
    this.cache = opts.cache === true ? new MemoryCache() : opts.cache || null;
    this.cacheTtlMs = opts.cacheTtlMs ?? (this.cache instanceof MemoryCache ? this.cache.ttlMs : 5_000);
    this.headers = { ...(opts.headers ?? {}) };
    this.requestId = opts.requestId === false ? null : typeof opts.requestId === "function" ? opts.requestId : randomId;
    this.onRequest = opts.onRequest;
    this.onResponse = opts.onResponse;
  }

  /** The stored session cookies as a `Cookie` header, to keep a session across restarts. Treat it like a password for 8 hours. */
  exportSession(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** Restores cookies from {@link exportSession}. */
  importSession(cookie: string) {
    for (const part of cookie.split(";")) {
      const at = part.indexOf("=");
      if (at > 0) this.cookies.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
    }
  }

  /** Forgets the session cookies. */
  clearSession() {
    this.cookies.clear();
  }

  /** Empties the GET cache, if there is one. */
  async clearCache() {
    await this.cache?.clear?.();
  }

  /** A full URL for `path` under the API. */
  url(path: string, query?: Query): string {
    return `${this.apiUrl}${path}${toQueryString(query)}`;
  }

  /** A GET. Identical GETs in flight at once share one request. */
  get<T>(path: string, query?: Query, opts: RequestOptions = {}): Promise<T> {
    const full = `${path}${toQueryString(query)}`;
    const useCache = this.cache && opts.cache !== false;
    const key = `GET ${this.apiUrl}${full}`;
    const run = async (): Promise<T> => {
      if (useCache) {
        const hit = await this.cache!.get(key);
        if (hit !== undefined) {
          this.onResponse?.({ method: "GET", url: `${this.apiUrl}${full}`, requestId: null, attempt: 0, status: 200, durationMs: 0, cached: true });
          return hit as T;
        }
      }
      const value = await this.request<T>(full, { method: "GET" }, opts);
      if (useCache) await this.cache!.set(key, value, typeof opts.cache === "number" ? opts.cache : this.cacheTtlMs);
      return value;
    };
    if (opts.signal) return run();
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    const p = run().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** A JSON POST. Refused up front from a browser page on another site, which the official API wouldn't answer. */
  async post<T>(path: string, body: unknown = {}, opts: RequestOptions = {}): Promise<T> {
    this.assertCanWrite();
    return this.request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, bigintReplacer) }, opts);
  }

  /** A page on another site can't reach the official API's writes; a backend or an `apiUrl` of its own can. */
  private assertCanWrite() {
    if (!isBrowserPage()) return;
    const page = (globalThis as { location?: { origin?: string } }).location?.origin;
    if (page && this.apiUrl.startsWith(DEFAULT_API_URL) && page !== new URL(this.apiUrl).origin) throw new StealthBrowserWriteError();
  }

  private async request<T>(path: string, init: RequestInit, opts: RequestOptions): Promise<T> {
    const method = (init.method ?? "GET").toUpperCase();
    const url = `${this.apiUrl}${path}`;
    const retry = resolveRetry(opts.retry ?? this.retry);
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const requestId = this.requestId?.() ?? null;
    const write = method !== "GET" && method !== "HEAD";

    for (let attempt = 1; ; attempt++) {
      if (opts.signal?.aborted) throw new StealthAbortError({ cause: opts.signal.reason });
      const info: RequestInfo = { method, url, requestId, attempt };
      const headers = new Headers(this.headers);
      new Headers(init.headers).forEach((v, k) => headers.set(k, v));
      for (const [k, v] of Object.entries(opts.headers ?? {})) headers.set(k, v);
      if (requestId) headers.set("x-request-id", requestId);
      if (!isBrowserPage() && !headers.has("x-stealth-sdk")) headers.set("x-stealth-sdk", SDK_VERSION);
      if (this.cookies.size) headers.set("cookie", this.exportSession());

      const started = Date.now();
      this.onRequest?.(info);
      const link = linkSignals(timeoutMs, opts.signal);
      let res: Response;
      try {
        res = await this.fetcher(url, { ...init, headers, signal: link.signal });
      } catch (error) {
        link.done();
        if (opts.signal?.aborted) {
          this.onResponse?.({ ...info, durationMs: Date.now() - started, error });
          throw new StealthAbortError({ cause: opts.signal.reason });
        }
        const failure = link.timedOut()
          ? new StealthTimeoutError(timeoutMs, info)
          : new StealthNetworkError(`Couldn't reach the API: ${error instanceof Error ? error.message : String(error)}`, info, { cause: error });
        this.onResponse?.({ ...info, durationMs: Date.now() - started, error: failure });
        // a write that may have reached the server isn't sent twice unless the caller said so
        const canRetry = !write || retry.writes === true;
        if (canRetry && attempt <= retry.retries) {
          await this.wait(backoffDelay(attempt - 1, retry), opts.signal);
          continue;
        }
        throw failure;
      }

      this.keepCookies(res);
      let text: string;
      try {
        text = await res.text();
      } catch (error) {
        link.done();
        if (opts.signal?.aborted) throw new StealthAbortError({ cause: opts.signal.reason });
        if (link.timedOut()) throw new StealthTimeoutError(timeoutMs, info);
        throw new StealthNetworkError(`The API's answer was cut off: ${error instanceof Error ? error.message : String(error)}`, info, { cause: error });
      }
      link.done();
      const answered = { ...info, requestId: res.headers.get("x-request-id") ?? requestId };
      this.onResponse?.({ ...answered, status: res.status, durationMs: Date.now() - started });

      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        const e = (json && typeof json === "object" ? json : {}) as { error?: string; message?: string; issues?: { path: string; message: string }[]; retryAfterSec?: number };
        const headerWait = parseRetryAfter(res.headers.get("retry-after"));
        const waitMs = typeof e.retryAfterSec === "number" ? e.retryAfterSec * 1000 : headerWait;
        const retryAfterSec = waitMs === null ? null : Math.ceil(waitMs / 1000);
        const failure = new StealthApiError(res.status, e.error ?? `http_${res.status}`, e.message ?? e.error ?? `The API answered ${res.status}.`, e.issues ?? [], retryAfterSec, answered);
        const statusRetryable = retry.statuses.includes(res.status);
        const canRetry = write ? (retry.writes === true ? statusRetryable : retry.writes === "rate-limited" && res.status === 429) : statusRetryable;
        if (canRetry && attempt <= retry.retries && (waitMs === null || waitMs <= retry.maxRetryAfterMs)) {
          await this.wait(waitMs ?? backoffDelay(attempt - 1, retry), opts.signal);
          continue;
        }
        throw failure;
      }
      if (json === null) throw new StealthParseError("The API sent something that isn't JSON.", answered);
      return json as T;
    }
  }

  private async wait(ms: number, signal?: AbortSignal) {
    try {
      await sleep(ms, signal);
    } catch (reason) {
      throw new StealthAbortError({ cause: reason });
    }
  }

  private keepCookies(res: Response) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const first = line.split(";")[0] ?? "";
      const at = first.indexOf("=");
      if (at > 0) this.cookies.set(first.slice(0, at), first.slice(at + 1));
    }
  }
}

/** JSON.stringify can't write a bigint; the API takes big amounts as decimal strings. */
export function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}
