import { describe, expect, it } from "vitest";
import { getAddress } from "viem";

import { createStealthClient, StealthApiError, StealthInputError } from "../../src/index.js";
import { fakeApi, reply } from "./helpers.js";

const MINT = "So11111111111111111111111111111111111111112";
const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TOKEN = "0x1111111111111111111111111111111111111111";

/** A client over a fake API that answers every listed GET/POST with `{}` and records calls. */
function client(routes: Record<string, unknown> = {}) {
  const api = fakeApi(routes);
  return { ...api, stealth: createStealthClient({ fetch: api.fetch, retry: false }) };
}
const last = (calls: { path: string }[]) => calls[calls.length - 1]!.path;

describe("platform", () => {
  it("reads app config, token config, status and the summary", async () => {
    const { stealth, calls } = client({
      "GET /app-config": { comingSoon: false, officialCa: "X" },
      "GET /token-config": { tokens: [{ key: "a", status: "coming_soon" }, { key: "b", status: "live" }] },
      "GET /status": {},
      "GET /status/summary": { overall: "operational" },
    });
    expect((await stealth.platform.appConfig()).comingSoon).toBe(false);
    expect((await stealth.platform.officialToken())?.key).toBe("b");
    await stealth.platform.status();
    expect((await stealth.platform.statusSummary()).overall).toBe("operational");
    expect(calls.map((c) => c.path)).toEqual(["/app-config", "/token-config", "/status", "/status/summary"]);
  });

  it("officialToken is null before one is configured", async () => {
    const { stealth } = client({ "GET /token-config": { tokens: [] } });
    expect(await stealth.platform.officialToken()).toBeNull();
  });

  it("reads chart events for Solana and EVM tokens, and refuses anything else", async () => {
    const { stealth, calls } = client({ [`GET /tokens/${MINT}/chart-events`]: { events: [{ id: "x:1" }] }, [`GET /tokens/${TOKEN}/chart-events`]: { events: [] } });
    expect(await stealth.platform.chartEvents(MINT, "STEALTH")).toEqual([{ id: "x:1" }]);
    expect(last(calls)).toBe(`/tokens/${MINT}/chart-events?symbol=STEALTH`);
    await stealth.platform.chartEvents(TOKEN);
    await expect(stealth.platform.chartEvents("nope")).rejects.toBeInstanceOf(StealthInputError);
    await expect(stealth.platform.chartEvents(MINT, "$BAD!")).rejects.toBeInstanceOf(StealthInputError);
  });

  it("builds IPFS URLs under the API", () => {
    const { stealth } = client();
    expect(stealth.platform.ipfsUrl("bafkreifbjxsikdmuhk5qi6krg3sqk2fc")).toBe("https://juststealthit.xyz/api/ipfs/bafkreifbjxsikdmuhk5qi6krg3sqk2fc");
    expect(() => stealth.platform.ipfsUrl("../x")).toThrow(StealthInputError);
  });
});

describe("cross-chain market", () => {
  it("lists with every filter, and iterates pages", async () => {
    let n = 0;
    const { stealth, calls } = client({ "GET /market/tokens": () => (++n === 1 ? { items: [{ address: "a" }], nextCursor: "50", total: 2 } : { items: [{ address: "b" }], nextCursor: null, total: 2 }) });
    await stealth.market.list({ stages: ["new", "graduating"], sort: "volume", dir: "desc", q: "pepe", mcap: 1000, vol: 50, socials: true, chains: ["solana", "base"] });
    expect(calls[0]!.path).toBe("/market/tokens?stages=new%2Cgraduating&sort=volume&dir=desc&q=pepe&mcap=1000&vol=50&socials=1&chains=solana%2Cbase");
    n = 0;
    const all = await stealth.market.iterate({ sort: "age" }).toArray();
    expect(all.map((t) => t.address)).toEqual(["a", "b"]);
    expect(last(calls)).toBe("/market/tokens?sort=age&cursor=50");
  });

  it("counts, searches and reads stats", async () => {
    const { stealth, calls } = client({ "GET /market/tokens/counts": { new: 1, graduating: 2, migrated: 3, chains: { solana: 6 } }, "GET /market/tokens/search": [], "GET /market/stats": { coins: 9 } });
    expect((await stealth.market.counts({ q: "x" })).chains.solana).toBe(6);
    await stealth.market.search("$PEPE", { limit: 5 });
    expect(last(calls)).toBe("/market/tokens/search?q=%24PEPE&limit=5");
    expect((await stealth.market.stats()).coins).toBe(9);
  });
});

describe("Solana reads", () => {
  it("hits every token route", async () => {
    const routes: Record<string, unknown> = {};
    for (const sub of ["", "/candles", "/trades", "/holders", "/top-traders", "/risk", "/creator", "/price", "/fee-plan", "/buybacks", "/rewards", "/payout", "/marketing", "/marketing/stats"]) routes[`GET /sol/tokens/${MINT}${sub}`] = sub === "/trades" ? { items: [], nextCursor: null, total: 0 } : {};
    routes[`GET /sol/metadata/${MINT}`] = {};
    const { stealth, calls } = client(routes);
    const t = stealth.sol.tokens;
    await t.get(MINT);
    await t.candles(MINT, { interval: "5m", from: 1, to: 2 });
    expect(last(calls)).toBe(`/sol/tokens/${MINT}/candles?interval=5m&from=1&to=2`);
    await t.trades(MINT, "50");
    expect(last(calls)).toBe(`/sol/tokens/${MINT}/trades?cursor=50`);
    for (const fn of ["holders", "topTraders", "risk", "creator", "price", "feePlan", "buybacks", "rewards", "payout", "marketing", "marketingStats", "metadata"] as const) await t[fn](MINT);
    expect(calls).toHaveLength(15);
  });

  it("checks a mint before sending", async () => {
    const { stealth, calls } = client();
    await expect(stealth.sol.tokens.get("0xnotsolana")).rejects.toBeInstanceOf(StealthInputError);
    expect(calls).toHaveLength(0);
  });

  it("find returns null on 404 and throws anything else", async () => {
    const { stealth } = client({ [`GET /sol/tokens/${MINT}`]: reply(404, { error: "not_found" }), [`GET /sol/tokens/${WALLET}`]: reply(500, { error: "internal_error" }) });
    expect(await stealth.sol.tokens.find(MINT)).toBeNull();
    await expect(stealth.sol.tokens.find(WALLET)).rejects.toBeInstanceOf(StealthApiError);
  });

  it("lists, counts and searches the board", async () => {
    const { stealth, calls } = client({ "GET /sol/tokens": { items: [], nextCursor: null, total: 0 }, "GET /sol/tokens/counts": {}, "GET /sol/tokens/search": [] });
    await stealth.sol.tokens.list({ stages: "migrated", creator: WALLET, socials: false });
    expect(last(calls)).toBe(`/sol/tokens?stages=migrated&creator=${WALLET}`);
    await stealth.sol.tokens.counts({ mcap: 5 });
    expect(last(calls)).toBe("/sol/tokens/counts?mcap=5");
    await stealth.sol.tokens.search("abc", 3);
    expect(last(calls)).toBe("/sol/tokens/search?q=abc&limit=3");
  });

  it("iterates trades across pages", async () => {
    let n = 0;
    const { stealth } = client({ [`GET /sol/tokens/${MINT}/trades`]: () => (++n === 1 ? { items: [{ id: "a" }, { id: "b" }], nextCursor: "2", total: 3 } : { items: [{ id: "c" }], nextCursor: null, total: 3 }) });
    expect((await stealth.sol.tokens.iterateTrades(MINT).take(10)).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("reads config, status, stats, price, locks, leaderboard, quote and tx status", async () => {
    const { stealth, calls } = client({
      "GET /sol/config": { venues: [] },
      "GET /sol/status": {},
      "GET /sol/stats": {},
      "GET /sol/eth-price": { usd: 150, updatedAt: 1, stale: false },
      "GET /sol/locks": { locks: [{ mint: "m" }] },
      "GET /sol/leaderboard": { rows: [] },
      "GET /sol/leaderboard/status": { sources: {} },
      "GET /sol/quote": {},
      "GET /sol/tx/SIG": { status: "pending", error: null },
      "GET /sol/bundle/B": { status: "landed" },
      [`GET /sol/balance/${WALLET}`]: { lamports: "1", tokenBaseUnits: null },
    });
    await stealth.sol.config();
    await stealth.sol.status();
    await stealth.sol.stats();
    expect((await stealth.sol.solPrice()).usd).toBe(150);
    expect(await stealth.sol.locks()).toEqual([{ mint: "m" }]);
    await stealth.sol.leaderboard({ source: "kols", range: "30d", sort: "roi", limit: 10 });
    expect(last(calls)).toBe("/sol/leaderboard?source=kols&range=30d&sort=roi&limit=10");
    await stealth.sol.leaderboardStatus();
    await stealth.sol.quote(MINT, "buy", 1_000_000n, 150);
    expect(last(calls)).toBe(`/sol/quote?mint=${MINT}&side=buy&amount=1000000&slippageBps=150`);
    await stealth.sol.txStatus("SIG");
    expect((await stealth.sol.bundleStatus("B")).status).toBe("landed");
    await stealth.sol.balance(WALLET, MINT);
    expect(last(calls)).toBe(`/sol/balance/${WALLET}?mint=${MINT}`);
  });

  it("reads the burn and the marketing ladder", async () => {
    let n = 0;
    const { stealth, calls } = client({
      "GET /sol/burn": { status: "live" },
      "GET /sol/burn/events": () => (++n === 1 ? { items: [{ sig: "a" }], nextCursor: "c1", updatedAt: 0 } : { items: [{ sig: "b" }], nextCursor: null, updatedAt: 0 }),
      "GET /sol/burn/coins": { items: [] },
      [`GET /sol/burn/coins/${MINT}`]: { rank: 1 },
      "GET /sol/burn/next": { progress: 0.5 },
      "GET /sol/marketing/tiers": { tiers: [] },
      "GET /sol/marketing/overview": {},
      "GET /sol/marketing/summary": { items: [] },
      "GET /sol/marketing/leaderboard": { rows: [] },
    });
    expect((await stealth.sol.burn.overview()).status).toBe("live");
    expect((await stealth.sol.burn.iterateEvents(50).toArray()).map((e) => e.sig)).toEqual(["a", "b"]);
    expect(last(calls)).toBe("/sol/burn/events?cursor=c1&limit=50");
    await stealth.sol.burn.coins({ range: "24h", limit: 5 });
    expect(last(calls)).toBe("/sol/burn/coins?range=24h&limit=5");
    await stealth.sol.burn.coin(MINT);
    expect((await stealth.sol.burn.next()).progress).toBe(0.5);
    await stealth.sol.marketing.tiers();
    await stealth.sol.marketing.overview(5);
    expect(last(calls)).toBe("/sol/marketing/overview?limit=5");
    await stealth.sol.marketing.summary();
    await stealth.sol.marketing.leaderboard("30d");
    expect(last(calls)).toBe("/sol/marketing/leaderboard?range=30d");
  });
});

describe("the Jupiter market", () => {
  it("reads coins, candles, trending and launchers", async () => {
    const { stealth, calls } = client({
      [`GET /sol/market/coins/${MINT}`]: { address: MINT },
      [`GET /sol/market/coins/${MINT}/candles`]: [],
      "GET /sol/market/trending": { status: "ready", coins: [] },
      "GET /sol/market/launchers": { status: "loading", launchers: [] },
      [`GET /sol/market/launchers/${WALLET}`]: { wallet: WALLET, coins: [] },
      "GET /sol/market/quote": { side: "buy", amountIn: "1", amountOut: "2", minAmountOut: "1", priceImpactPct: 0.1, route: ["Raydium"] },
    });
    await stealth.sol.market.coin(MINT);
    await stealth.sol.market.candles(MINT, "1h");
    expect(last(calls)).toBe(`/sol/market/coins/${MINT}/candles?interval=1h`);
    expect((await stealth.sol.market.trending()).status).toBe("ready");
    expect((await stealth.sol.market.launchers()).status).toBe("loading");
    await stealth.sol.market.launcher(WALLET);
    expect((await stealth.sol.market.quote(MINT, "sell", 5n)).route).toEqual(["Raydium"]);
    expect(last(calls)).toBe(`/sol/market/quote?mint=${MINT}&side=sell&amount=5&slippageBps=300`);
  });

  it("refuses slippage outside 10 to 5,000 bps", async () => {
    const { stealth, calls } = client();
    await expect(stealth.sol.market.quote(MINT, "buy", 1n, 5)).rejects.toBeInstanceOf(StealthInputError);
    await expect(stealth.sol.market.quote(MINT, "buy", 1n, 6_000)).rejects.toBeInstanceOf(StealthInputError);
    expect(calls).toHaveLength(0);
  });

  it("sends amounts as strings when building a swap", async () => {
    const { stealth, calls } = client({ "POST /sol/market/swap": { transaction: "T", quote: {}, lastValidBlockHeight: 1 } });
    await stealth.sol.market.buildSwap({ mint: MINT, owner: WALLET, side: "buy", amount: 10n });
    expect(calls[0]!.body).toEqual({ mint: MINT, owner: WALLET, side: "buy", amount: "10", slippageBps: 300 });
  });
});

describe("wallets", () => {
  it("reads PnL, trades, rewards, analytics and the portfolio", async () => {
    const base = `/sol/wallets/${WALLET}`;
    let n = 0;
    const { stealth, calls } = client({
      [`GET ${base}/pnl`]: { range: "7d" },
      [`GET ${base}/trades`]: () => (++n === 1 ? { items: [{ id: "1" }], nextCursor: "1" } : { items: [{ id: "2" }], nextCursor: null }),
      [`GET ${base}/rewards`]: { totalUsd: 1 },
      [`GET ${base}/analytics`]: { wallet: WALLET },
      [`GET ${base}/analytics/activity`]: { activity: [] },
      [`GET ${base}/analytics/analysis`]: { analysis: null },
      [`GET /sol/portfolio/${WALLET}`]: { owner: WALLET },
    });
    const w = stealth.sol.wallets;
    await w.pnl(WALLET, "7d");
    expect(last(calls)).toBe(`${base}/pnl?range=7d`);
    expect((await w.iterateTrades(WALLET, { limit: 1, token: MINT }).toArray()).map((t) => t.id)).toEqual(["1", "2"]);
    expect(last(calls)).toBe(`${base}/trades?limit=1&token=${MINT}&cursor=1`);
    await w.rewards(WALLET);
    await w.analytics(WALLET, true);
    expect(last(calls)).toBe(`${base}/analytics?refresh=1`);
    await w.activity(WALLET);
    await w.analysis(WALLET);
    await w.portfolio(WALLET);
    await expect(w.pnl("bad")).rejects.toBeInstanceOf(StealthInputError);
  });
});

describe("EVM reads", () => {
  it("hits every per-chain route", async () => {
    const b = `/evm/chains/base`;
    const routes: Record<string, unknown> = {
      [`GET ${b}/eth-price`]: { usd: 3000 },
      [`GET ${b}/tokens`]: { items: [], nextCursor: null, total: 0 },
      [`GET ${b}/tokens/counts`]: {},
      [`GET ${b}/tokens/search`]: [],
      [`GET ${b}/bot`]: {},
      [`GET ${b}/marketing/tiers`]: {},
      [`GET ${b}/marketing/overview`]: {},
      [`GET ${b}/marketing/summary`]: {},
      [`GET ${b}/marketing/leaderboard`]: {},
      [`GET ${b}/marketing/analytics`]: {},
    };
    for (const sub of ["", "/candles", "/trades", "/holders", "/top-traders", "/risk", "/quote", "/rewards", "/pot", "/buybacks", "/marketing", "/marketing/stats"]) routes[`GET ${b}/tokens/${TOKEN}${sub}`] = sub === "/trades" ? { items: [], nextCursor: null, total: 0 } : {};
    const { stealth, calls } = client(routes);
    const c = stealth.evm.chain("base");
    expect(stealth.evm.chain("base")).toBe(c);
    expect((await c.nativePrice()).usd).toBe(3000);
    await c.listTokens({ stages: ["new"], creator: TOKEN });
    expect(last(calls)).toBe(`${b}/tokens?stages=new&creator=${TOKEN}`);
    await c.countTokens();
    await c.searchTokens("x");
    await c.getToken(TOKEN);
    await c.getCandles(TOKEN, { interval: "1h", from: 10 });
    expect(last(calls)).toBe(`${b}/tokens/${TOKEN}/candles?interval=1h&from=10`);
    await c.getTrades(TOKEN);
    await c.getHolders(TOKEN);
    await c.getTopTraders(TOKEN);
    await c.getRisk(TOKEN);
    await c.quote(TOKEN, "buy", 10n ** 18n, 100);
    expect(last(calls)).toBe(`${b}/tokens/${TOKEN}/quote?side=buy&amount=1000000000000000000&slippageBps=100`);
    await c.getRewards(TOKEN);
    await c.getPot(TOKEN);
    await c.getBuybacks(TOKEN);
    await c.getPayoutBot();
    await c.getMarketing(TOKEN);
    await c.getMarketingStats(TOKEN);
    await c.marketingTiers();
    await c.marketingOverview(3);
    await c.marketingSummary();
    await c.marketingLeaderboard("all");
    expect(last(calls)).toBe(`${b}/marketing/leaderboard?range=all`);
    await c.marketingAnalytics();
    expect(calls).toHaveLength(22);
  });

  it("refuses unknown chains and bad addresses", async () => {
    const { stealth } = client();
    expect(() => stealth.evm.chain("polygon" as never)).toThrow(StealthInputError);
    expect(() => stealth.evm.chain("ethereum" as never)).toThrow(/coming soon/);
    await expect(stealth.evm.chain("bnb").getToken("0x12")).rejects.toBeInstanceOf(StealthInputError);
  });

  it("reads config, hidden wallets and positions", async () => {
    const { stealth, calls } = client({ "GET /evm/config": { enabled: true, chains: [] }, [`GET /evm/wallets/${WALLET}`]: { exists: false }, [`GET /evm/wallets/${WALLET}/positions`]: { positions: [{ chain: "base" }] } });
    await stealth.evm.config(WALLET);
    expect(last(calls)).toBe(`/evm/config?wallet=${WALLET}`);
    expect((await stealth.evm.wallet(WALLET)).exists).toBe(false);
    expect(await stealth.evm.positions(WALLET)).toEqual([{ chain: "base" }]);
  });
});

describe("feed", () => {
  it("lists, iterates with before/next, and reads profiles", async () => {
    let n = 0;
    const { stealth, calls } = client({
      "GET /feed": () => (++n === 1 ? { items: [{ id: "p1", type: "post" }], next: "c" } : { items: [{ id: "e1", type: "event" }], next: null }),
      "GET /feed/fees": { days: 7 },
      "GET /feed/fees/overview": { updatedAt: 1 },
      "GET /feed/profiles/7": { profile: { id: 7 } },
      "GET /feed/profiles/7/coins": { coins: [], total: 0 },
      "GET /feed/profiles/7/followers": { profiles: [{ id: 1 }] },
      "GET /feed/profiles/7/following": { profiles: [] },
    });
    const items = await stealth.feed.iterate({ filter: "coins", limit: 10 }).toArray();
    expect(items.map((i) => i.id)).toEqual(["p1", "e1"]);
    expect(last(calls)).toBe("/feed?filter=coins&limit=10&before=c");
    await stealth.feed.fees(7);
    expect(last(calls)).toBe("/feed/fees?days=7");
    await stealth.feed.feesOverview();
    await stealth.feed.profile(7);
    await stealth.feed.profileCoins(7);
    expect(await stealth.feed.followers(7)).toEqual([{ id: 1 }]);
    expect(await stealth.feed.following(7)).toEqual([]);
    await expect(stealth.feed.profile(-1)).rejects.toBeInstanceOf(StealthInputError);
  });
});

describe("staking", () => {
  it("reads pools and positions, and prepares and submits", async () => {
    const { stealth, calls } = client({
      "GET /staking": { enabled: true, pools: [{ id: "stealth", aprBps: 1_000, boosts: [] }] },
      [`GET /staking/stealth/positions/${WALLET}`]: { staked: "5" },
      "POST /staking/stealth/stake": { actionId: 1, transaction: "T", depositLamports: 0, escrow: "E" },
      "POST /staking/stealth/unstake": { actionId: 2, transaction: "T", unlockInSec: 60 },
      "POST /staking/actions/1/submit": { signature: "S", status: "confirmed" },
    });
    expect((await stealth.staking.pool())?.aprBps).toBe(1_000);
    expect(await stealth.staking.pool("nope")).toBeNull();
    expect((await stealth.staking.position("stealth", WALLET)).staked).toBe("5");
    await stealth.staking.prepareStake("stealth", WALLET, 10n);
    expect(calls[calls.length - 1]!.body).toEqual({ owner: WALLET, amount: "10" });
    await stealth.staking.prepareUnstake("stealth", WALLET, "3");
    expect(await stealth.staking.submit(1, "A".repeat(120))).toEqual({ signature: "S", status: "confirmed" });
    await expect(stealth.staking.prepareStake("stealth", WALLET, 0n)).rejects.toBeInstanceOf(StealthInputError);
    await expect(stealth.staking.submit(0, "x")).rejects.toBeInstanceOf(StealthInputError);
  });

  it("estimates with the pool's rate", () => {
    const { stealth } = client();
    expect(stealth.staking.estimate({ aprBps: 3_650, boosts: [] }, 10_000n * 10n ** 6n, 365)).toBe(3_650n * 10n ** 6n);
  });
});

describe("multichain groups and social", () => {
  it("returns null for a coin without a group", async () => {
    const G = "0b6f4c1e-2a8d-4f6b-9c3e-7d5a1b2c3d4e";
    const { stealth, calls } = client({ "GET /multichain/coins/base/0xabc": reply(404, { error: "not_found" }), [`GET /multichain/groups/${G}`]: { id: G, coins: [] }, "GET /multichain/groups": { coins: [{ groupId: G }] } });
    expect(await stealth.multichain.ofCoin("base", "0xabc")).toBeNull();
    expect((await stealth.multichain.get(G))?.id).toBe(G);
    expect(await stealth.multichain.get("../x")).toBeNull();
    // EVM coins are stored checksummed: a lower-case address is checksummed before the lookup
    await stealth.multichain.ofCoin("base", TOKEN.replace("0x1111", "0xabcd"));
    expect(last(calls)).toBe(`/multichain/coins/base/${getAddress(TOKEN.replace("0x1111", "0xabcd"))}`);
    expect(await stealth.multichain.list()).toEqual([{ groupId: G }]);
  });

  it("looks up social accounts", async () => {
    const { stealth, calls } = client({ "GET /social-fees/people": { people: [] }, "GET /social-fees/lookup": { accountId: "1" }, "GET /social-fees/profile/x/jack": { handle: "jack" }, "GET /social/lookup": { exists: true } });
    await stealth.social.people("x");
    expect((await stealth.social.lookup("github", "octocat")).accountId).toBe("1");
    expect(last(calls)).toBe("/social-fees/lookup?provider=github&handle=octocat");
    await stealth.social.profile("x", "jack");
    expect((await stealth.social.checkHandle("x", "@jack")).exists).toBe(true);
  });
});

describe("the client", () => {
  it("shares one HTTP core and one live stream", () => {
    const { stealth } = client();
    expect(stealth.live()).toBe(stealth.live());
    expect(stealth.live().url).toBe("wss://juststealthit.xyz/api/sol/ws");
    stealth.close();
    const own = createStealthClient({ apiUrl: "http://localhost:8080/api" });
    expect(own.live().url).toBe("ws://localhost:8080/api/sol/ws");
  });
});
