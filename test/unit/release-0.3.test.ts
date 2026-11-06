import { Keypair } from "@solana/web3.js";
import { getAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CANDLE_INTERVALS,
  createStealthClient,
  isEvmToken,
  isOutsideToken,
  isSolToken,
  isStakingNotOpenError,
  isStealthError,
  normalizeCandleInterval,
  StealthApiError,
  StealthInputError,
  StealthUnsupportedError,
  StealthWebSocketError,
  toMarketCandleInterval,
  fromMarketCandleInterval,
  tokenChain,
  type MarketToken,
} from "../../src/api/index.js";
import { EVM_CHAINS } from "../../src/evm/chains.js";
import { EVM_DEPLOYMENTS } from "../../src/evm/deployments.js";
import { ReconnectingSocket, type WebSocketLike } from "../../src/live/socket.js";
import { candleChannel, createStealthStream, matchesTrade, MAX_STREAM_CHANNELS, pollTrades, type TradeMessage } from "../../src/live/stream.js";
import { rewardShare } from "../../src/math/staking.js";
import { MULTICHAIN_CHAINS } from "../../src/multichain/index.js";
import { createStealthSolana, keypairSigner } from "../../src/solana/index.js";
import {
  CHAINS,
  chainById,
  chainKeyOf,
  COMING_SOON_CHAIN_KEYS,
  deployingChains,
  formatCompact,
  formatPrice,
  formatUsd,
  getChain,
  isComingSoonChain,
  isLiveChain,
  isLiveEvmChain,
  LIVE_CHAIN_KEYS,
  LIVE_EVM_CHAIN_KEYS,
  parseUnits,
  requireLiveChain,
  coinPageUrl,
} from "../../src/utils/index.js";
import { fakeApi, reply } from "./helpers.js";

const MINT = "So11111111111111111111111111111111111111112";
const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TOKEN = "0xabcdef0000000000000000000000000000000001";

function client(routes: Record<string, unknown> = {}) {
  const api = fakeApi(routes);
  return { ...api, stealth: createStealthClient({ fetch: api.fetch, retry: false }) };
}
const last = (calls: { path: string }[]) => calls[calls.length - 1]!.path;

describe("chain registry 0.3", () => {
  it("lists the live chains and the coming-soon ones, with Ethereum, Arbitrum and Avalanche deploying", () => {
    expect(LIVE_CHAIN_KEYS).toEqual(["solana", "robinhood", "bnb", "hyperevm", "base", "arc"]);
    expect(LIVE_EVM_CHAIN_KEYS).toEqual(["robinhood", "bnb", "hyperevm", "base", "arc"]);
    expect(COMING_SOON_CHAIN_KEYS).toEqual(["ethereum", "arbitrum", "avalanche", "xlayer"]);
    expect(deployingChains().map((c) => c.key)).toEqual(["ethereum", "arbitrum", "avalanche"]);
    expect(CHAINS.arbitrum.name).toBe("Arbitrum One");
    expect(CHAINS.avalanche.name).toBe("Avalanche C-Chain");
    expect(chainById(42161)?.key).toBe("arbitrum");
    expect(chainById(1)?.status).toBe("coming_soon");
  });

  it("never carries an address for a chain that isn't live, and every list follows the registry", () => {
    for (const c of Object.values(CHAINS)) {
      if (c.status !== "live") {
        expect(c.dex).toBeNull();
        expect(c.key in EVM_DEPLOYMENTS).toBe(false);
      }
      if (c.status === "live") expect(c.deploying).toBe(false);
    }
    expect(Object.keys(EVM_DEPLOYMENTS)).toEqual(LIVE_EVM_CHAIN_KEYS);
    expect(Object.keys(EVM_CHAINS)).toEqual(LIVE_EVM_CHAIN_KEYS);
    expect(MULTICHAIN_CHAINS).toEqual(["solana", ...LIVE_EVM_CHAIN_KEYS]);
  });

  it("reads aliases and any case, and ignores prototype keys", () => {
    expect(getChain("BSC")?.key).toBe("bnb");
    expect(getChain(" Base ")?.key).toBe("base");
    expect(getChain("toString")).toBeUndefined();
    expect(getChain("__proto__")).toBeUndefined();
    expect(chainKeyOf("avax")).toBe("avalanche");
    expect(chainKeyOf("polygon")).toBeNull();
    expect(isLiveChain("bsc")).toBe(false);
    expect(isLiveEvmChain("base")).toBe(true);
    expect(isLiveEvmChain("solana")).toBe(false);
    expect(isComingSoonChain("xlayer")).toBe(true);
  });

  it("refuses coming-soon chains with a clear error, and unknown ones as input errors", () => {
    expect(requireLiveChain("bsc", "evm").key).toBe("bnb");
    expect(() => requireLiveChain("ethereum")).toThrow(StealthUnsupportedError);
    expect(() => requireLiveChain("ethereum")).toThrow(/Ethereum is coming soon: its contracts are being deployed/);
    expect(() => requireLiveChain("solana", "evm")).toThrow(StealthInputError);
    expect(() => requireLiveChain("polygon")).toThrow(/Unknown chain/);
    const e = (() => {
      try {
        requireLiveChain("avalanche", "evm");
      } catch (error) {
        return error;
      }
    })();
    expect(isStealthError(e, "unsupported")).toBe(true);
  });
});

describe("site links", () => {
  it("links coins launched here to /token and external ones to /trending", () => {
    expect(coinPageUrl({ address: MINT })).toBe(`https://juststealthit.xyz/token/${MINT}`);
    expect(coinPageUrl({ address: TOKEN, chain: "bsc" })).toBe(`https://juststealthit.xyz/token/${TOKEN}?chain=bnb`);
    expect(coinPageUrl({ address: MINT, onPlatform: false })).toBe(`https://juststealthit.xyz/trending/${MINT}`);
    expect(coinPageUrl({ address: TOKEN, chain: "base", onPlatform: false }, "http://localhost:5173/")).toBe(`http://localhost:5173/trending/${TOKEN}?chain=base`);
  });
});

describe("candle intervals", () => {
  afterEach(() => vi.restoreAllMocks());

  it("has no 1s, and reads the gone 1s as 1m with one warning", () => {
    expect(CANDLE_INTERVALS).toEqual(["1m", "5m", "15m", "1h", "4h", "1D"]);
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    expect(normalizeCandleInterval("1s")).toBe("1m");
    expect(normalizeCandleInterval("1s")).toBe("1m");
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    expect(normalizeCandleInterval("1d")).toBe("1D");
    expect(normalizeCandleInterval(undefined)).toBeUndefined();
    expect(() => normalizeCandleInterval("2m")).toThrow(StealthInputError);
    expect(candleChannel(MINT, "1s" as never)).toBe(`candles:${MINT.toLowerCase()}:1m`);
  });

  it("maps between the launchpad's and the market route's names", () => {
    expect(toMarketCandleInterval("1D")).toBe("1d");
    expect(toMarketCandleInterval("5m")).toBe("5m");
    expect(fromMarketCandleInterval("1d")).toBe("1D");
  });

  it("asks the API for 1m when given 1s", async () => {
    vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const { stealth, calls } = client({ [`GET /sol/tokens/${MINT}/candles`]: [], [`GET /evm/chains/base/tokens/${TOKEN}/candles`]: [] });
    await stealth.sol.tokens.candles(MINT, { interval: "1s" as never });
    expect(last(calls)).toBe(`/sol/tokens/${MINT}/candles?interval=1m`);
    await stealth.evm.chain("base").getCandles(TOKEN, { interval: "1s" as never });
    expect(last(calls)).toBe(`/evm/chains/base/tokens/${TOKEN}/candles?interval=1m`);
  });
});

const row = (more: Partial<MarketToken>): MarketToken => ({ address: "A", ...more }) as MarketToken;

describe("cross-chain market", () => {
  it("tells coins launched here from external ones", () => {
    const outside = row({ outside: { chain: "bnb", launchpad: "fourmeme", trendRank: 3 } });
    expect(isOutsideToken(outside)).toBe(true);
    expect(tokenChain(outside)).toBe("bnb");
    expect(tokenChain(row({ evm: { chain: "base" } as never }))).toBe("base");
    expect(tokenChain(row({ sol: {} as never }))).toBe("solana");
    expect(isSolToken(row({ sol: {} as never }))).toBe(true);
    expect(isEvmToken(row({ evm: { chain: "base" } as never }))).toBe(true);
  });

  it("drops external coins with ownOnly, and keeps walking past a page of only those", async () => {
    const ours = row({ address: "ours", sol: {} as never });
    const theirs = row({ address: "theirs", outside: { chain: "solana", launchpad: null, trendRank: 1 } });
    const { stealth } = client({
      "GET /market/tokens?cursor=p2": { items: [ours], nextCursor: null, total: 3 },
      "GET /market/tokens": { items: [theirs, theirs], nextCursor: "p2", total: 3 },
    });
    expect((await stealth.market.list({ ownOnly: true })).items).toEqual([]);
    expect((await stealth.market.list()).items).toHaveLength(2);
    expect((await stealth.market.iterate({ ownOnly: true }).toArray()).map((t) => t.address)).toEqual(["ours"]);
  });

  it("reads Trending across chains", async () => {
    const { stealth, calls } = client({ "GET /market/trending": { coins: [{ chain: "bnb", onPlatform: false }], outside: true } });
    expect((await stealth.market.trending({ chains: ["solana", "bnb"] })).outside).toBe(true);
    expect(last(calls)).toBe("/market/trending?chains=solana%2Cbnb");
  });
});

describe("external coin pages", () => {
  it("opens an EVM coin with its chain, lower-cased, and tags the chain", async () => {
    const { stealth, calls } = client({ [`GET /sol/market/coins/${TOKEN}`]: { address: TOKEN, decimals: 18 }, [`GET /sol/market/coins/${MINT}`]: { address: MINT } });
    const coin = await stealth.sol.market.coin(getAddress(TOKEN), { chain: "BSC" });
    expect(last(calls)).toBe(`/sol/market/coins/${TOKEN}?chain=bnb`);
    expect(coin.chain).toBe("bnb");
    expect((await stealth.sol.market.coin(MINT)).chain).toBe("solana");
    expect(last(calls)).toBe(`/sol/market/coins/${MINT}`);
    // the 0.2 shape: request options second
    await stealth.sol.market.coin(MINT, { signal: new AbortController().signal } as never);
    expect(last(calls)).toBe(`/sol/market/coins/${MINT}`);
  });

  it("refuses a 0x address without a chain, or on a coming-soon chain", async () => {
    const { stealth } = client();
    await expect(stealth.sol.market.coin(TOKEN)).rejects.toThrow(/needs its chain/);
    await expect(stealth.sol.market.coin(TOKEN, { chain: "arbitrum" })).rejects.toBeInstanceOf(StealthUnsupportedError);
  });

  it("reads candles at 1m by default, with 1D read as 1d and `to` paging back", async () => {
    const { stealth, calls } = client({ [`GET /sol/market/coins/${MINT}/candles`]: [], [`GET /sol/market/coins/${TOKEN}/candles`]: [] });
    await stealth.sol.market.candles(MINT);
    expect(last(calls)).toBe(`/sol/market/coins/${MINT}/candles?interval=1m`);
    await stealth.sol.market.candles(TOKEN, "1D", { chain: "base", to: 1_700_000_000 });
    expect(last(calls)).toBe(`/sol/market/coins/${TOKEN}/candles?interval=1d&chain=base&to=1700000000`);
    await expect(stealth.sol.market.candles(MINT, "1m", { to: -1 })).rejects.toBeInstanceOf(StealthInputError);
  });
});

describe("new Solana reads", () => {
  it("reads the buy-back bot, marketing analytics and takeovers", async () => {
    const { stealth, calls } = client({
      "GET /sol/burn/bot": { mode: "buy_burn", status: "live" },
      "GET /sol/marketing/analytics": { raised30dUsd: 1 },
      [`GET /sol/tokens/${MINT}/cto/eligibility`]: { eligible: true, reason: "ok" },
      "GET /sol/cto/mine": [],
    });
    expect((await stealth.sol.burn.bot())?.mode).toBe("buy_burn");
    expect((await stealth.sol.marketing.analytics()).raised30dUsd).toBe(1);
    expect((await stealth.sol.tokens.ctoEligibility(MINT, WALLET)).eligible).toBe(true);
    expect(last(calls)).toBe(`/sol/tokens/${MINT}/cto/eligibility?wallet=${WALLET}`);
    expect(await stealth.sol.ctoApplications(WALLET)).toEqual([]);
    expect(last(calls)).toBe(`/sol/cto/mine?wallet=${WALLET}`);
  });

  it("is null when the server has no buy-back bot", async () => {
    expect(await client().stealth.sol.burn.bot()).toBeNull();
  });

  it("checks quote slippage the way the swap does", async () => {
    await expect(client().stealth.sol.quote(MINT, "buy", 1n, 5)).rejects.toBeInstanceOf(StealthInputError);
  });

  it("names a wallet's market figures neutrally", async () => {
    const wire = { wallet: WALLET, ["g" + "mg" + "n"]: { status: "ready", totalProfitUsd: 5 }, analysis: null };
    const { stealth } = client({ [`GET /sol/wallets/${WALLET}/analytics`]: wire });
    const profile = await stealth.sol.wallets.analytics(WALLET);
    expect(profile.market.totalProfitUsd).toBe(5);
    expect(Object.keys(profile)).not.toContain("g" + "mg" + "n");
  });
});

describe("staking status", () => {
  it("says not_open while staking is off, and open once a pool is there", async () => {
    expect((await client({ "GET /staking": { enabled: false, pools: [] } }).stealth.staking.status()).state).toBe("not_open");
    const open = await client({ "GET /staking": { enabled: true, network: "mainnet-beta", pools: [{ id: "stealth" }] } }).stealth.staking.status();
    expect(open).toMatchObject({ state: "open", network: "mainnet-beta" });
  });

  it("recognises the not-open answer, and refuses unknown pools up front", async () => {
    const { stealth } = client({ [`GET /staking/stealth/positions/${WALLET}`]: reply(503, { error: "not_configured", message: "Staking isn't open yet." }) });
    const e = await stealth.staking.position("stealth", WALLET).catch((x: unknown) => x);
    expect(isStakingNotOpenError(e)).toBe(true);
    expect(isStakingNotOpenError(new Error("x"))).toBe(false);
    await expect(stealth.staking.position("other", WALLET)).rejects.toBeInstanceOf(StealthInputError);
    await expect(stealth.staking.prepareStake("stealth", "0xabc", 1n)).rejects.toBeInstanceOf(StealthInputError);
  });
});

describe("EVM, platform and errors", () => {
  it("checksums a full address before searching, and checks quotes and owners", async () => {
    const { stealth, calls } = client({ "GET /evm/chains/base/tokens/search": [] });
    await stealth.evm.chain("base").searchTokens(TOKEN);
    expect(last(calls)).toBe(`/evm/chains/base/tokens/search?q=${getAddress(TOKEN)}&limit=8`);
    await expect(stealth.evm.chain("base").quote(TOKEN, "buy", 0n)).rejects.toBeInstanceOf(StealthInputError);
    await expect(stealth.evm.chain("base").quote(TOKEN, "buy", 1n, 6_000)).rejects.toBeInstanceOf(StealthInputError);
    await expect(stealth.evm.wallet("../x")).rejects.toBeInstanceOf(StealthInputError);
  });

  it("builds logo and IPFS URLs, refusing odd file names", () => {
    const { stealth } = client();
    expect(stealth.platform.logoUrl(`${"a".repeat(40)}.png`)).toBe(`https://juststealthit.xyz/api/uploads/logo/${"a".repeat(40)}.png`);
    expect(() => stealth.platform.logoUrl("../x.png")).toThrow(StealthInputError);
    expect(() => stealth.platform.ipfsUrl("Qm" + "a".repeat(44), "../etc")).toThrow(StealthInputError);
  });

  it("knows its errors from another copy of the SDK", () => {
    const foreign = Object.assign(new Error("x"), { code: "rate_limited", [Symbol.for("juststealthit.sdk.error")]: true });
    expect(isStealthError(foreign)).toBe(true);
    expect(isStealthError(foreign, "rate_limited")).toBe(true);
    expect(isStealthError(new Error("x"))).toBe(false);
    expect(isStealthError(new StealthApiError(404, "not_found", "x"), "not_found")).toBe(true);
  });
});

describe("formatting and maths fixes", () => {
  it("rolls a rounded value into the next unit", () => {
    expect(formatCompact(999_999)).toBe("1M");
    expect(formatCompact(999.999)).toBe("1K");
    expect(formatUsd(999.6)).toBe("$1K");
    expect(formatUsd(9.996)).toBe("$10.0");
    expect(formatUsd(42)).toBe("$42.0");
  });

  it("carries a rounded tiny price into one zero fewer", () => {
    expect(formatPrice(0.0000099999)).toBe("$0.0₄1");
    expect(formatPrice(0.00099999)).toBe("$0.0₂1");
    expect(formatPrice(0.00000123)).toBe("$0.0₅123");
  });

  it("parses numbers written in exponent form", () => {
    expect(parseUnits(1e-7, 9)).toBe(100n);
    expect(parseUnits(0.1, 9)).toBe(100_000_000n);
  });

  it("never pays a negative reward share", () => {
    expect(rewardShare(100n, -5n, 10n)).toBe(0n);
    expect(rewardShare(-100n, 5n, 10n)).toBe(0n);
    expect(rewardShare(100n, 5n, 10n)).toBe(50n);
  });
});

describe("Solana client fixes", () => {
  const setup = (routes: Parameters<typeof fakeApi>[0]) => {
    const api = fakeApi(routes);
    return { ...api, sol: createStealthSolana({ signer: keypairSigner(Keypair.generate()), fetch: api.fetch, pollMs: 1, confirmTimeoutMs: 5_000, bundleTimeoutMs: 5_000, retry: false, cache: true }) };
  };

  it("stops waiting on a signature the API refuses", async () => {
    const { sol, calls } = setup({ "GET /sol/tx/BAD": reply(400, { error: "bad_signature" }) });
    await expect(sol.confirm("BAD")).rejects.toBeInstanceOf(StealthApiError);
    expect(calls).toHaveLength(1);
  });

  it("doesn't resend a bundle to a server without bundles", async () => {
    const { sol, calls } = setup({ "POST /sol/send-bundle": reply(503, { error: "not_configured" }) });
    await expect((sol as unknown as { sendBundle(x: string[]): Promise<string[]> }).sendBundle(["x"])).rejects.toMatchObject({ code: "not_configured" });
    expect(calls).toHaveLength(1);
  });

  it("never serves a price or a status from the cache", async () => {
    let n = 0;
    const { sol } = setup({ [`GET /sol/tokens/${MINT}/price`]: () => ({ priceSol: ++n }) });
    expect((await sol.getPrice(MINT)).priceSol).toBe(1);
    expect((await sol.getPrice(MINT)).priceSol).toBe(2);
  });
});

/** A socket stand-in. `deaf` ones never fire onclose, like a dead connection. */
class Fake implements WebSocketLike {
  static all: Fake[] = [];
  static deaf = false;
  readyState = 0;
  sent: unknown[] = [];
  deaf = Fake.deaf;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {
    Fake.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    if (!this.deaf) this.onclose?.({ code: 1000 });
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
}
const newest = () => Fake.all[Fake.all.length - 1]!;
const quick = { WebSocket: Fake, reconnect: { minDelayMs: 20, maxDelayMs: 20 }, pingMs: 0, idleTimeoutMs: 0 };
const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const trade = (more: object = {}): TradeMessage => ({ ch: `token:${MINT.toLowerCase()}`, type: "trade", token: {} as never, trade: { id: "t", side: "buy", valueUsd: 50, ethAmount: 0.3, trader: WALLET, kind: "trade", isCreatorLaunchBuy: false, sniperTaxed: false, ...more } as never });

describe("live stream fixes", () => {
  afterEach(() => {
    Fake.all = [];
    Fake.deaf = false;
  });

  it("doesn't open a second socket when you subscribe while it waits to reconnect", async () => {
    const live = createStealthStream(quick);
    live.heads(() => {});
    newest().open();
    newest().drop();
    live.trades(MINT, () => {});
    expect(Fake.all).toHaveLength(1);
    await wait(40);
    expect(Fake.all).toHaveLength(2);
    live.close();
  });

  it("reconnects a silent socket even when its close never comes", async () => {
    Fake.deaf = true;
    const live = createStealthStream({ ...quick, reconnect: { minDelayMs: 1, maxDelayMs: 1 }, idleTimeoutMs: 10 });
    live.heads(() => {});
    newest().open();
    await wait(40);
    expect(Fake.all.length).toBeGreaterThan(1);
    // the old socket was detached: its messages no longer reach anyone
    const seen: number[] = [];
    live.heads((m) => seen.push(m.block));
    Fake.all[0]!.push({ ch: "head", type: "head", block: 1 });
    expect(seen).toEqual([]);
    live.close();
  });

  it("gives up on a connect that hangs, and tries again", async () => {
    const s = new ReconnectingSocket("ws://x", { onMessage: () => {} }, { WebSocket: Fake, connectTimeoutMs: 10, reconnect: { minDelayMs: 1, maxDelayMs: 1 } });
    s.connect();
    await wait(40);
    expect(Fake.all.length).toBeGreaterThan(1);
    s.close();
  });

  it("keeps backing off against a server that accepts and drops at once", () => {
    const errors: number[] = [];
    const s = new ReconnectingSocket("ws://x", { onMessage: () => {}, onError: () => errors.push(1) }, { WebSocket: Fake, reconnect: { maxAttempts: 2, minDelayMs: 1, maxDelayMs: 1 } });
    s.connect();
    newest().open();
    newest().drop();
    // never stable (no message), so the attempts add up instead of resetting on each open
    expect((s as unknown as { attempts: number }).attempts).toBe(1);
    s.close();
  });

  it("ends an iterator at once on return(), even while it waits", async () => {
    const live = createStealthStream(quick);
    const it = live.iterate("head");
    const pending = it.next();
    newest().open();
    await it.return!();
    await expect(pending).resolves.toEqual({ value: undefined, done: true });
    expect(live.channels).toEqual([]);
    expect(newest().sent).toContainEqual({ op: "unsub", ch: "head" });
    live.close();
  });

  it("filters trades, and tells you what the buffer dropped", async () => {
    const live = createStealthStream(quick);
    const got: number[] = [];
    live.trades(MINT, (m) => got.push(m.trade.valueUsd), { side: "buy", minValueUsd: 100 });
    const drops: number[] = [];
    const it = live.iterateTrades(MINT, { filter: { side: "sell" }, bufferSize: 1, onDrop: (n) => drops.push(n) });
    newest().open();
    newest().push(trade({ valueUsd: 50 }));
    newest().push(trade({ valueUsd: 500 }));
    newest().push(trade({ side: "sell", valueUsd: 1 }));
    newest().push(trade({ side: "sell", valueUsd: 2 }));
    expect(got).toEqual([500]);
    expect(drops).toEqual([1]);
    expect((await it.next()).value?.trade.valueUsd).toBe(2);
    await it.return!();
    live.close();
  });

  it("matches every trade field of a filter", () => {
    const t = trade().trade;
    expect(matchesTrade(t, undefined)).toBe(true);
    expect(matchesTrade(t, { traders: [WALLET] })).toBe(true);
    expect(matchesTrade(t, { excludeTraders: [WALLET] })).toBe(false);
    expect(matchesTrade({ ...t, kind: "dev_buy" }, { devBuys: false })).toBe(false);
    expect(matchesTrade(t, { minNative: 1 })).toBe(false);
    expect(matchesTrade(t, { sniperTaxed: true })).toBe(false);
  });

  it("refuses to subscribe on a closed stream, and past the channel cap", () => {
    const live = createStealthStream(quick);
    for (let i = 0; i < MAX_STREAM_CHANNELS; i++) live.subscribe(`token:x${i}` as never, () => {});
    expect(() => live.subscribe("head", () => {})).toThrow(StealthInputError);
    live.close();
    expect(() => live.heads(() => {})).toThrow(StealthWebSocketError);
  });

  it("calls no handler after polling stops", async () => {
    let resolve!: (v: { items: never[] }) => void;
    let n = 0;
    const got: string[] = [];
    const stop = pollTrades(
      () => (++n === 1 ? Promise.resolve({ items: [] }) : new Promise((r) => (resolve = r))),
      "0xT",
      (t) => got.push(t.id),
      { intervalMs: 1 },
    );
    await wait(10);
    stop();
    resolve({ items: [{ id: "late" }] as never[] });
    await wait(5);
    expect(got).toEqual([]);
  });
});
