import { StealthApiError, StealthBrowserWriteError, StealthError } from "./errors.js";

export const DEFAULT_API_URL = "https://juststealthit.xyz/api";

export interface ApiOptions {
  /** The API's base URL, without a trailing slash. Point it at your own backend to write from a browser. */
  apiUrl?: string;
  /** Your own `fetch`, for proxies, retries or tests. */
  fetch?: typeof globalThis.fetch;
  /** Per request. Default 30 s. */
  timeoutMs?: number;
}

type Query = Record<string, string | number | boolean | undefined | null>;

/** The API over HTTP, with the session cookie a server-side caller has to carry itself. */
export class ApiClient {
  readonly apiUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly cookies = new Map<string, string>();

  constructor(opts: ApiOptions = {}) {
    this.apiUrl = (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.fetcher = opts.fetch ?? ((...args) => globalThis.fetch(...args));
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** The stored session cookies as a `Cookie` header, to keep a session across restarts. Treat it like a password for 8 hours. */
  exportSession(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  importSession(cookie: string) {
    for (const part of cookie.split(";")) {
      const at = part.indexOf("=");
      if (at > 0) this.cookies.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
    }
  }

  get<T>(path: string, query?: Query): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) params.set(k, String(v));
    const qs = params.size ? `?${params}` : "";
    return this.request<T>(`${path}${qs}`, { method: "GET" });
  }

  async post<T>(path: string, body: unknown = {}): Promise<T> {
    this.assertCanWrite();
    return this.request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  /** A page on another site can't reach the official API's writes; a backend or an `apiUrl` of its own can. */
  private assertCanWrite() {
    const page = (globalThis as { location?: { origin?: string }; document?: unknown }).document ? (globalThis as { location?: { origin?: string } }).location?.origin : undefined;
    if (page && this.apiUrl.startsWith(DEFAULT_API_URL) && page !== new URL(this.apiUrl).origin) throw new StealthBrowserWriteError();
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set("cookie", this.exportSession());
    let res: Response;
    try {
      res = await this.fetcher(`${this.apiUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw new StealthError(`Couldn't reach the API: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const first = line.split(";")[0] ?? "";
      const at = first.indexOf("=");
      if (at > 0) this.cookies.set(first.slice(0, at), first.slice(at + 1));
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const e = (json ?? {}) as { error?: string; message?: string; issues?: { path: string; message: string }[]; retryAfterSec?: number };
      const retry = e.retryAfterSec ?? (Number(res.headers.get("retry-after")) || null);
      throw new StealthApiError(res.status, e.error ?? `http_${res.status}`, e.message ?? e.error ?? `The API answered ${res.status}.`, e.issues ?? [], retry);
    }
    if (json === null) throw new StealthError("The API sent something that isn't JSON.");
    return json as T;
  }
}
