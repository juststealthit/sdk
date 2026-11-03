import { describe, expect, it } from "vitest";

import { asterMarkets, createPerpsClient, filterPerpGroups, groupPerpMarkets, hyperliquidPerpMarkets, hyperliquidSpotMarkets, normalizePerpCoin } from "../../src/perps/index.js";

const hlMeta = {
  universe: [
    { name: "BTC", szDecimals: 5, maxLeverage: 40 },
    { name: "kPEPE", szDecimals: 0, maxLeverage: 10 },
    { name: "OLD", szDecimals: 1, maxLeverage: 3, isDelisted: true },
  ],
};
const hlCtx = [
  { funding: "0.0000125", openInterest: "100", prevDayPx: "60000", dayNtlVlm: "5000000", markPx: "66000", midPx: "66001", oraclePx: "65990" },
  { funding: "-0.0001", openInterest: "1000000", prevDayPx: "0.01", dayNtlVlm: "200000", markPx: "0.011", midPx: null, oraclePx: "0.011" },
  { funding: "0", openInterest: "0", prevDayPx: "0", dayNtlVlm: "0", markPx: "1", midPx: null, oraclePx: "1" },
];
const spotMeta = {
  universe: [
    { name: "@107", tokens: [150, 0] as [number, number], index: 107 },
    { name: "@9", tokens: [9, 0] as [number, number], index: 9 },
  ],
  tokens: [
    { name: "USDC", szDecimals: 8, index: 0 },
    { name: "HYPE", szDecimals: 2, index: 150 },
    { name: "DEAD", szDecimals: 2, index: 9 },
  ],
};
const spotCtx = [
  { coin: "@107", prevDayPx: "20", dayNtlVlm: "900000", markPx: "22", midPx: "22" },
  { coin: "@9", prevDayPx: "1", dayNtlVlm: "0", markPx: "1", midPx: null },
];
const asterInfo = {
  symbols: [
    { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", contractType: "PERPETUAL", quantityPrecision: 3 },
    { symbol: "1000PEPEUSDT", baseAsset: "1000PEPE", quoteAsset: "USDT", status: "TRADING", contractType: "PERPETUAL", quantityPrecision: 0 },
    { symbol: "TSLAUSDT", baseAsset: "TSLA", quoteAsset: "USDT", status: "TRADING", contractType: "PERPETUAL", quantityPrecision: 2, underlyingSubType: ["STOCK"] },
    { symbol: "BTCUSDC", baseAsset: "BTC", quoteAsset: "USDC", status: "TRADING", contractType: "PERPETUAL", quantityPrecision: 3 },
    { symbol: "XYZUSDT", baseAsset: "XYZ", quoteAsset: "USDT", status: "SETTLING", contractType: "PERPETUAL", quantityPrecision: 3 },
  ],
};
const asterTickers = [
  { symbol: "BTCUSDT", lastPrice: "66010", priceChangePercent: "2.5", quoteVolume: "3000000" },
  { symbol: "1000PEPEUSDT", lastPrice: "11", priceChangePercent: "-1", quoteVolume: "100000" },
  { symbol: "TSLAUSDT", lastPrice: "250", priceChangePercent: "0.4", quoteVolume: "50000" },
  { symbol: "BTCUSDC", lastPrice: "66000", priceChangePercent: "2", quoteVolume: "999" },
];
const asterPremium = [{ symbol: "BTCUSDT", markPrice: "66000", lastFundingRate: "0.0001" }];

describe("normalising", () => {
  it("unwraps thousand-unit names", () => {
    expect(normalizePerpCoin("kPEPE")).toEqual({ coin: "PEPE", unitMultiplier: 1_000 });
    expect(normalizePerpCoin("1000BONK")).toEqual({ coin: "BONK", unitMultiplier: 1_000 });
    expect(normalizePerpCoin("BTC")).toEqual({ coin: "BTC", unitMultiplier: 1 });
    expect(normalizePerpCoin("kaito")).toEqual({ coin: "kaito", unitMultiplier: 1 });
  });

  it("maps Hyperliquid perps, skipping delisted ones", () => {
    const m = hyperliquidPerpMarkets([hlMeta, hlCtx]);
    expect(m.map((x) => x.id)).toEqual(["hyperliquid:BTC", "hyperliquid:kPEPE"]);
    expect(m[0]).toMatchObject({ coin: "BTC", price: 66001, volume24hUsd: 5_000_000, openInterestUsd: 6_599_000, funding: 0.0000125, fundingIntervalHours: 1, maxLeverage: 40, name: "BTC-PERP" });
    expect(m[0]!.change24hPct).toBeCloseTo(10.0017, 3);
    expect(m[1]).toMatchObject({ coin: "PEPE", base: "kPEPE", unitMultiplier: 1_000, price: 0.011 });
  });

  it("maps Hyperliquid spot pairs with volume", () => {
    const m = hyperliquidSpotMarkets([spotMeta, spotCtx]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: "spot", coin: "HYPE", symbol: "@107", name: "HYPE/USDC", funding: null, maxLeverage: 1 });
  });

  it("maps Aster USDT perps, with asset classes and no made-up leverage", () => {
    const m = asterMarkets(asterInfo, asterTickers, asterPremium);
    expect(m.map((x) => x.symbol)).toEqual(["BTCUSDT", "1000PEPEUSDT", "TSLAUSDT"]);
    expect(m[0]).toMatchObject({ coin: "BTC", funding: 0.0001, fundingIntervalHours: 8, maxLeverage: null, change24hPct: 2.5 });
    expect(m[1]).toMatchObject({ coin: "PEPE", unitMultiplier: 1_000, funding: null });
    expect(m[2]!.assetClass).toBe("stock");
  });
});

describe("grouping", () => {
  const all = [...hyperliquidPerpMarkets([hlMeta, hlCtx]), ...hyperliquidSpotMarkets([spotMeta, spotCtx]), ...asterMarkets(asterInfo, asterTickers, asterPremium)];

  it("groups perps by coin across venues, biggest volume first", () => {
    const groups = groupPerpMarkets(all);
    expect(groups[0]).toMatchObject({ key: "perp:BTC", volume24hUsd: 8_000_000, maxLeverage: 40 });
    expect(groups[0]!.markets.map((m) => m.venue)).toEqual(["hyperliquid", "aster"]);
    const pepe = groups.find((g) => g.coin === "PEPE")!;
    expect(pepe.markets.map((m) => m.base)).toEqual(["kPEPE", "1000PEPE"]);
    expect(groups.find((g) => g.key === "spot:HYPE/USDC")).toBeDefined();
  });

  it("filters by kind, asset class and search", () => {
    const groups = groupPerpMarkets(all);
    expect(filterPerpGroups(groups, { kind: "spot" }).map((g) => g.coin)).toEqual(["HYPE"]);
    expect(filterPerpGroups(groups, { assetClass: "stock" }).map((g) => g.coin)).toEqual(["TSLA"]);
    expect(filterPerpGroups(groups, { q: "pep" }).map((g) => g.coin)).toEqual(["PEPE"]);
  });
});

describe("PerpsClient", () => {
  /** Answers each venue's public endpoints from fixtures. */
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const json = (v: unknown) => new Response(JSON.stringify(v));
    if (url.host === "api.hyperliquid.xyz") {
      const body = JSON.parse(String(init?.body));
      if (body.type === "metaAndAssetCtxs") return json([hlMeta, hlCtx]);
      if (body.type === "spotMetaAndAssetCtxs") return json([spotMeta, spotCtx]);
      if (body.type === "candleSnapshot") return json([{ t: 60_000, o: "1", h: "2", l: "0.5", c: "1.5", v: "10", coin: body.req.coin }]);
      if (body.type === "allMids") return json({ BTC: "66000" });
    }
    if (url.host === "fapi.asterdex.com") {
      if (url.pathname.endsWith("exchangeInfo")) return json(asterInfo);
      if (url.pathname.endsWith("24hr")) return json(asterTickers);
      if (url.pathname.endsWith("premiumIndex")) return json(asterPremium);
      if (url.pathname.endsWith("klines")) return json([[120_000, "1", "2", "0.5", "1.5", "10", 0]]);
    }
    if (url.host === "perps-api.jup.ag") return json({ price: "150", priceChange24H: "1.5", volume: "1000" });
    return new Response("{}", { status: 404 });
  }) as typeof globalThis.fetch;

  it("loads every venue and groups them", async () => {
    const perps = createPerpsClient({ fetch });
    const { markets, failed } = await perps.markets();
    expect(failed).toEqual([]);
    expect(markets.filter((m) => m.venue === "jupiter").map((m) => m.coin)).toEqual(["SOL", "ETH", "BTC"]);
    const groups = await perps.groups({ spot: false });
    expect(groups.find((g) => g.coin === "BTC")!.markets.map((m) => m.venue)).toEqual(["hyperliquid", "aster", "jupiter"]);
  });

  it("reports a failing venue and keeps the others", async () => {
    const broken = (async (input: RequestInfo | URL, init?: RequestInit) => (String(input).includes("asterdex") ? new Response("down", { status: 502 }) : fetch(input, init))) as typeof globalThis.fetch;
    const { markets, failed } = await createPerpsClient({ fetch: broken }).markets({ venues: ["hyperliquid", "aster"], spot: false });
    expect(failed.map((f) => f.venue)).toEqual(["aster"]);
    expect(markets.every((m) => m.venue === "hyperliquid")).toBe(true);
  });

  it("reads candles per venue, Jupiter through Hyperliquid's", async () => {
    const perps = createPerpsClient({ fetch });
    expect(await perps.candles({ venue: "hyperliquid", symbol: "BTC", coin: "BTC" }, "1h", { from: 0, to: 3_600 })).toEqual([{ time: 60, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
    expect((await perps.candles({ venue: "aster", symbol: "BTCUSDT", coin: "BTC" }))[0]!.time).toBe(120);
    expect((await perps.candles({ venue: "jupiter", symbol: "SOL", coin: "SOL" }))[0]!.close).toBe(1.5);
    await expect(perps.candles({ venue: "aster", symbol: "X", coin: "X" }, "2m" as never)).rejects.toThrow(/interval/);
    expect(await perps.allMids()).toEqual({ BTC: "66000" });
  });
});
