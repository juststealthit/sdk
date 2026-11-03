import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClient } from "../../src/shared/api.js";
import { StealthApiError, StealthBrowserWriteError } from "../../src/shared/errors.js";
import { fakeApi, reply } from "./helpers.js";

describe("ApiClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to the production API, and drops empty query values", async () => {
    let url = "";
    const api = new ApiClient({ fetch: (async (u: string) => ((url = u), new Response("{}"))) as never });
    await api.get("/sol/tokens", { sort: "age", cursor: undefined, q: null, limit: 3 });
    expect(url).toBe("https://juststealthit.xyz/api/sol/tokens?sort=age&limit=3");
  });

  it("turns the API's error JSON into a typed error", async () => {
    const { fetch } = fakeApi({ "POST /x": reply(400, { error: "invalid_request", message: "Some fields are missing or invalid.", issues: [{ path: "name", message: "Required" }] }) });
    const err = await new ApiClient({ fetch }).post("/x").catch((e) => e);
    expect(err).toBeInstanceOf(StealthApiError);
    expect(err).toMatchObject({ status: 400, code: "invalid_request", issues: [{ path: "name", message: "Required" }] });
  });

  it("reports a rate limit's wait", async () => {
    const { fetch } = fakeApi({ "GET /x": reply(429, { error: "rate_limited", message: "Too many requests.", retryAfterSec: 42 }) });
    await expect(new ApiClient({ fetch }).get("/x")).rejects.toMatchObject({ code: "rate_limited", retryAfterSec: 42 });
  });

  it("falls back to the Retry-After header", async () => {
    const { fetch } = fakeApi({ "GET /x": reply(429, { error: "cooldown" }, [["retry-after", "7"]]) });
    await expect(new ApiClient({ fetch, retry: false }).get("/x")).rejects.toMatchObject({ retryAfterSec: 7 });
  });

  it("keeps a session cookie and sends it back, and only its name and value", async () => {
    const { fetch, calls } = fakeApi({
      "POST /in": reply(200, {}, [["set-cookie", "fp_multichain=abc.def; Path=/api; HttpOnly; Secure; SameSite=Lax"]]),
      "GET /me": { ok: true },
    });
    const api = new ApiClient({ fetch });
    await api.post("/in");
    await api.get("/me");
    expect(calls[0]!.cookie).toBeNull();
    expect(calls[1]!.cookie).toBe("fp_multichain=abc.def");
  });

  it("carries a session across processes", async () => {
    const { fetch, calls } = fakeApi({ "GET /me": { ok: true } });
    const api = new ApiClient({ fetch });
    api.importSession("fp_multichain=abc.def");
    expect(api.exportSession()).toBe("fp_multichain=abc.def");
    await api.get("/me");
    expect(calls[0]!.cookie).toBe("fp_multichain=abc.def");
  });

  it("says why a browser page on another site can't write, without trying", async () => {
    vi.stubGlobal("document", {});
    vi.stubGlobal("location", { origin: "https://someone-elses.site" });
    const { fetch, calls } = fakeApi({ "POST /x": {} });
    await expect(new ApiClient({ fetch }).post("/x")).rejects.toBeInstanceOf(StealthBrowserWriteError);
    expect(calls).toHaveLength(0);
  });

  it("lets that page read, and write through its own backend", async () => {
    vi.stubGlobal("document", {});
    vi.stubGlobal("location", { origin: "https://someone-elses.site" });
    const { fetch } = fakeApi({ "GET /x": { ok: true }, "POST /x": { ok: true } });
    await expect(new ApiClient({ fetch }).get("/x")).resolves.toEqual({ ok: true });
    await expect(new ApiClient({ fetch, apiUrl: "https://someone-elses.site/api/" }).post("/x")).resolves.toEqual({ ok: true });
  });

  it("explains a non-JSON answer", async () => {
    const api = new ApiClient({ fetch: (async () => new Response("<html>")) as never });
    await expect(api.get("/x")).rejects.toThrow(/isn't JSON/);
  });
});
