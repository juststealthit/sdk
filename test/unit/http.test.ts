import { describe, expect, it, vi } from "vitest";

import { ApiClient, toQueryString } from "../../src/shared/api.js";
import { MemoryCache } from "../../src/shared/cache.js";
import {
  isStealthError,
  StealthAbortError,
  StealthApiError,
  StealthError,
  StealthFeeTooHighError,
  StealthInputError,
  StealthNetworkError,
  StealthParseError,
  StealthTimeoutError,
} from "../../src/shared/errors.js";
import { paginate } from "../../src/shared/paginate.js";
import { backoffDelay, parseRetryAfter, resolveRetry, sleep } from "../../src/shared/retry.js";
import { fakeApi, reply } from "./helpers.js";

/** The error a promise rejects with. */
const fail = (p: Promise<unknown>): Promise<any> => p.then(() => { throw new Error("resolved"); }, (e: unknown) => e);

const fastRetry = { retries: 2, minDelayMs: 1, maxDelayMs: 2 };

describe("retries", () => {
  it("retries a GET on 5xx, then succeeds", async () => {
    let n = 0;
    const { fetch, calls } = fakeApi({ "GET /x": () => (++n < 3 ? reply(503, { error: "busy" }) : { ok: true }) });
    await expect(new ApiClient({ fetch, retry: fastRetry }).get("/x")).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(3);
  });

  it("gives up after the retry count and throws the last error", async () => {
    const { fetch, calls } = fakeApi({ "GET /x": reply(502, { error: "bad_gateway" }) });
    const err = await fail(new ApiClient({ fetch, retry: fastRetry }).get("/x"));
    expect(err).toBeInstanceOf(StealthApiError);
    expect(err.code).toBe("bad_gateway");
    expect(err.retryable).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("never retries a 4xx other than 408, 425 and 429", async () => {
    const { fetch, calls } = fakeApi({ "GET /x": reply(404, { error: "not_found" }) });
    await expect(new ApiClient({ fetch, retry: fastRetry }).get("/x")).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(calls).toHaveLength(1);
  });

  it("waits what the server asks on a 429, and doesn't wait past maxRetryAfterMs", async () => {
    let n = 0;
    const { fetch, calls } = fakeApi({ "GET /x": () => (++n === 1 ? reply(429, { error: "rate_limited", retryAfterSec: 0 }) : { ok: 1 }) });
    await expect(new ApiClient({ fetch, retry: fastRetry }).get("/x")).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);

    const slow = fakeApi({ "GET /x": reply(429, { error: "rate_limited", retryAfterSec: 600 }) });
    await expect(new ApiClient({ fetch: slow.fetch, retry: fastRetry }).get("/x")).rejects.toMatchObject({ retryAfterSec: 600 });
    expect(slow.calls).toHaveLength(1);
  });

  it("retries a POST only on 429 by default", async () => {
    const five = fakeApi({ "POST /x": reply(500, { error: "internal_error" }) });
    await expect(new ApiClient({ fetch: five.fetch, retry: fastRetry }).post("/x")).rejects.toMatchObject({ status: 500 });
    expect(five.calls).toHaveLength(1);

    let n = 0;
    const limited = fakeApi({ "POST /x": () => (++n === 1 ? reply(429, { error: "rate_limited", retryAfterSec: 0 }) : { ok: true }) });
    await expect(new ApiClient({ fetch: limited.fetch, retry: fastRetry }).post("/x")).resolves.toEqual({ ok: true });
    expect(limited.calls).toHaveLength(2);
  });

  it("retries a POST like a GET when asked", async () => {
    let n = 0;
    const { fetch, calls } = fakeApi({ "POST /x": () => (++n === 1 ? reply(503, {}) : { ok: true }) });
    await expect(new ApiClient({ fetch, retry: { ...fastRetry, writes: true } }).post("/x")).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it("retries a network error on a GET, not on a POST", async () => {
    let n = 0;
    const flaky = (async () => {
      if (++n === 1) throw new TypeError("socket hang up");
      return new Response("{}");
    }) as typeof fetch;
    await expect(new ApiClient({ fetch: flaky, retry: fastRetry }).get("/x")).resolves.toEqual({});
    const down = (async () => {
      throw new TypeError("ECONNRESET");
    }) as typeof fetch;
    const err = await fail(new ApiClient({ fetch: down, retry: fastRetry }).post("/x"));
    expect(err).toBeInstanceOf(StealthNetworkError);
    expect(err.code).toBe("network_error");
    expect(err.message).toMatch(/Couldn't reach the API: ECONNRESET/);
  });

  it("per-call retry settings override the client's", async () => {
    const { fetch, calls } = fakeApi({ "GET /x": reply(503, {}) });
    await new ApiClient({ fetch, retry: fastRetry }).get("/x", undefined, { retry: false }).catch(() => null);
    expect(calls).toHaveLength(1);
  });
});

describe("timeouts and abort", () => {
  const hang = ((_: unknown, init?: RequestInit) =>
    new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch;

  it("throws a StealthTimeoutError after timeoutMs", async () => {
    const err = await fail(new ApiClient({ fetch: hang, timeoutMs: 20, retry: false }).get("/x"));
    expect(err).toBeInstanceOf(StealthTimeoutError);
    expect(err).toBeInstanceOf(StealthNetworkError);
    expect(err.code).toBe("timeout");
    expect(err.timeoutMs).toBe(20);
  });

  it("throws a StealthAbortError when the caller aborts, and doesn't retry", async () => {
    const ctrl = new AbortController();
    let calls = 0;
    const counting = ((u: unknown, init?: RequestInit) => (calls++, hang(u as string, init))) as typeof fetch;
    const p = new ApiClient({ fetch: counting, retry: fastRetry }).get("/x", undefined, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 5);
    const err = await fail(p);
    expect(err).toBeInstanceOf(StealthAbortError);
    expect(err.code).toBe("aborted");
    expect(calls).toBe(1);
  });

  it("an already-aborted signal never waits", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(new ApiClient({ fetch: hang }).get("/x", undefined, { signal: ctrl.signal })).rejects.toBeInstanceOf(StealthAbortError);
  });
});

describe("request ids, headers and hooks", () => {
  it("sends one x-request-id per request, the same on every retry, and puts it on the error", async () => {
    let n = 0;
    const { fetch, calls } = fakeApi({ "GET /x": () => (++n < 3 ? reply(500, {}) : reply(400, { error: "invalid_request" })) });
    const err = await fail(new ApiClient({ fetch, retry: fastRetry, requestId: () => "req-1" }).get("/x"));
    expect(calls.map((c) => c.headers.get("x-request-id"))).toEqual(["req-1", "req-1", "req-1"]);
    expect(err.requestId).toBe("req-1");
    expect(err.request).toMatchObject({ method: "GET", attempt: 3, url: "https://juststealthit.xyz/api/x" });
  });

  it("can turn request ids off, and sends custom headers", async () => {
    const { fetch, calls } = fakeApi({ "GET /x": {} });
    await new ApiClient({ fetch, requestId: false, headers: { authorization: "Bearer t" } }).get("/x", undefined, { headers: { "x-extra": "1" } });
    expect(calls[0]!.headers.get("x-request-id")).toBeNull();
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer t");
    expect(calls[0]!.headers.get("x-extra")).toBe("1");
    expect(calls[0]!.headers.get("x-stealth-sdk")).toBe("0.2.0");
  });

  it("calls onRequest and onResponse for every try", async () => {
    const seen: string[] = [];
    let n = 0;
    const { fetch } = fakeApi({ "GET /x": () => (++n === 1 ? reply(503, {}) : {}) });
    await new ApiClient({ fetch, retry: fastRetry, onRequest: (e) => seen.push(`req${e.attempt}`), onResponse: (e) => seen.push(`res${e.attempt}:${e.status}`) }).get("/x");
    expect(seen).toEqual(["req1", "res1:503", "req2", "res2:200"]);
  });

  it("overrides the base URL and trims its slash", () => {
    const api = new ApiClient({ apiUrl: "https://staging.example/api///" });
    expect(api.url("/sol/tokens", { q: "a b" })).toBe("https://staging.example/api/sol/tokens?q=a+b");
  });

  it("sends bigints as strings", async () => {
    const { fetch, calls } = fakeApi({ "POST /x": {} });
    await new ApiClient({ fetch }).post("/x", { amount: 10n ** 20n });
    expect(calls[0]!.body).toEqual({ amount: "100000000000000000000" });
  });

  it("builds query strings without empty values", () => {
    expect(toQueryString({ a: 1, b: undefined, c: null, d: "", e: false })).toBe("?a=1&e=false");
    expect(toQueryString({})).toBe("");
  });
});

describe("cache and de-duplication", () => {
  it("caches GETs for the TTL, and a call can bypass it", async () => {
    let now = 0;
    let n = 0;
    const { fetch, calls } = fakeApi({ "GET /x": () => ({ n: ++n }) });
    const api = new ApiClient({ fetch, cache: new MemoryCache({ ttlMs: 100, now: () => now }) });
    expect(await api.get("/x")).toEqual({ n: 1 });
    expect(await api.get("/x")).toEqual({ n: 1 });
    expect(await api.get("/x", undefined, { cache: false })).toEqual({ n: 2 });
    now = 200;
    expect(await api.get("/x")).toEqual({ n: 3 });
    expect(calls).toHaveLength(3);
  });

  it("shares one request between identical GETs in flight", async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((r) => (resolve = r));
    let calls = 0;
    const fetch = (async () => {
      calls++;
      await gate;
      return new Response('{"ok":true}');
    }) as typeof globalThis.fetch;
    const api = new ApiClient({ fetch });
    const a = api.get("/x");
    const b = api.get("/x");
    resolve();
    expect(await Promise.all([a, b])).toEqual([{ ok: true }, { ok: true }]);
    expect(calls).toBe(1);
  });

  it("MemoryCache evicts the least recently used past maxEntries", () => {
    const c = new MemoryCache({ maxEntries: 2 });
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBeUndefined();
    expect(c.size).toBe(2);
    c.clear();
    expect(c.size).toBe(0);
  });

  it("clearCache empties a client's cache", async () => {
    let n = 0;
    const { fetch } = fakeApi({ "GET /x": () => ({ n: ++n }) });
    const api = new ApiClient({ fetch, cache: true });
    await api.get("/x");
    await api.clearCache();
    expect(await api.get("/x")).toEqual({ n: 2 });
  });
});

describe("retry helpers", () => {
  it("reads Retry-After as seconds or a date", () => {
    expect(parseRetryAfter("5")).toBe(5_000);
    expect(parseRetryAfter("1.5")).toBe(1_500);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6_000);
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });

  it("backs off exponentially under a ceiling", () => {
    const o = { minDelayMs: 100, maxDelayMs: 1_000 };
    expect(backoffDelay(0, o, () => 1)).toBe(100);
    expect(backoffDelay(2, o, () => 1)).toBe(400);
    expect(backoffDelay(10, o, () => 1)).toBe(1_000);
    expect(backoffDelay(3, o, () => 0)).toBe(0);
  });

  it("resolves retry settings", () => {
    expect(resolveRetry(false).retries).toBe(0);
    expect(resolveRetry(5).retries).toBe(5);
    expect(resolveRetry(undefined).statuses).toContain(429);
  });

  it("sleep can be aborted", async () => {
    const ctrl = new AbortController();
    const p = sleep(10_000, ctrl.signal);
    ctrl.abort(new Error("stop"));
    await expect(p).rejects.toThrow("stop");
  });
});

describe("errors", () => {
  it("every SDK error has a stable code and is a StealthError", () => {
    expect(new StealthInputError("x").code).toBe("invalid_input");
    expect(new StealthFeeTooHighError(9_000, 1_000).code).toBe("fee_too_high");
    expect(new StealthParseError().code).toBe("invalid_response");
    expect(new StealthApiError(404, "not_found", "nope").code).toBe("not_found");
    expect(new StealthError("x").code).toBe("stealth_error");
    expect(new StealthError("x", { code: "custom" }).code).toBe("custom");
    expect(new StealthInputError("x").name).toBe("StealthInputError");
  });

  it("isStealthError narrows by code", () => {
    const e = new StealthApiError(429, "rate_limited", "slow down", [], 3);
    expect(isStealthError(e)).toBe(true);
    expect(isStealthError(e, "rate_limited")).toBe(true);
    expect(isStealthError(e, "not_found")).toBe(false);
    expect(isStealthError(new Error("x"))).toBe(false);
  });

  it("keeps the cause", () => {
    const cause = new Error("root");
    expect(new StealthNetworkError("x", null, { cause }).cause).toBe(cause);
  });
});

describe("paginate", () => {
  const pages: Record<string, { items: number[]; nextCursor: string | null }> = {
    start: { items: [1, 2], nextCursor: "2" },
    "2": { items: [3, 4], nextCursor: "4" },
    "4": { items: [5], nextCursor: null },
  };
  const fetchPage = vi.fn(async (cursor: string | undefined) => pages[cursor ?? "start"]!);

  it("walks every page as one async iterable", async () => {
    fetchPage.mockClear();
    expect(await paginate(fetchPage).toArray()).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("take fetches only the pages it needs", async () => {
    fetchPage.mockClear();
    expect(await paginate(fetchPage).take(3)).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("stops at maxPages, at an empty page and at a repeated cursor", async () => {
    expect(await paginate(fetchPage, { maxPages: 1 }).toArray()).toEqual([1, 2]);
    const loop = paginate(async () => ({ items: [1], nextCursor: "same" }));
    expect(await loop.toArray()).toEqual([1, 1]);
    const empty = paginate(async () => ({ items: [] as number[], nextCursor: "more" }));
    expect(await empty.toArray()).toEqual([]);
  });

  it("starts after a given cursor and yields pages", async () => {
    const seen: number[][] = [];
    for await (const page of paginate(fetchPage, { cursor: "2" }).pages()) seen.push(page.items);
    expect(seen).toEqual([[3, 4], [5]]);
  });
});
