/**
 * Read-only perps market data, from each venue's own public API, grouped by coin the way the site's perps page shows it:
 * Hyperliquid (perps and spot), Aster (USDT perps, including stocks and commodities) and Jupiter Perps (SOL, ETH, BTC).
 *
 * This module only reads public market data. It has no orders, no accounts and nothing to sign.
 *
 * ```ts
 * import { createPerpsClient } from "@juststealthit/sdk/perps";
 * const perps = createPerpsClient();
 * const groups = await perps.groups();            // every venue, grouped by coin, biggest volume first
 * const btc = groups.find((g) => g.coin === "BTC");
 * const candles = await perps.candles(btc!.markets[0]!, "15m");
 * ```
 *
 * @module
 */
import { ApiClient, type RequestOptions } from "../shared/api.js";
import { StealthInputError } from "../shared/errors.js";
import { ReconnectingSocket, type ReconnectOptions, type WebSocketConstructor } from "../live/socket.js";

export type PerpVenue = "hyperliquid" | "aster" | "jupiter";
export const PERP_VENUES = ["hyperliquid", "aster", "jupiter"] as const satisfies readonly PerpVenue[];
export const PERP_VENUE_LABELS: Record<PerpVenue, string> = { hyperliquid: "Hyperliquid", aster: "Aster", jupiter: "Jupiter Perps" };
export type PerpMarketKind = "perp" | "spot";
export type PerpAssetClass = "crypto" | "stock" | "commodity";

/** Public endpoints. Override any with `PerpsClientOptions.endpoints`. */
export const PERP_ENDPOINTS = {
  hyperliquid: "https://api.hyperliquid.xyz",
  hyperliquidWs: "wss://api.hyperliquid.xyz/ws",
  aster: "https://fapi.asterdex.com",
  jupiter: "https://perps-api.jup.ag/v1",
} as const;

/** The three markets Jupiter Perps lists, by custody mint. */
export const JUPITER_PERP_MARKETS = [
  { base: "SOL", mint: "So11111111111111111111111111111111111111112", maxLeverage: 100 },
  { base: "ETH", mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", maxLeverage: 100 },
  { base: "BTC", mint: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", maxLeverage: 100 },
] as const;

/** One market on one venue, normalised. */
export interface PerpMarket {
  /** `${venue}:${symbol}`. */
  id: string;
  venue: PerpVenue;
  kind: PerpMarketKind;
  /** The coin, normalised across venues: `kPEPE` and `1000PEPE` are both `PEPE`. */
  coin: string;
  /** The venue's own base name: `kPEPE`, `1000PEPE`, `BTC`. */
  base: string;
  /** What the venue calls the market: `BTC` (Hyperliquid perp), `@107` (Hyperliquid spot), `BTCUSDT` (Aster), `SOL` (Jupiter). */
  symbol: string;
  /** Display name: `BTC-PERP`, `PURR/USDC`. */
  name: string;
  /** How many coins one contract unit is: 1,000 for `kPEPE` or `1000PEPE`, else 1. `price / unitMultiplier` is per coin. */
  unitMultiplier: number;
  price: number;
  /** Percent over 24 h, `null` if unknown. */
  change24hPct: number | null;
  volume24hUsd: number;
  openInterestUsd: number | null;
  /** Funding as a fraction per interval. */
  funding: number | null;
  fundingIntervalHours: number | null;
  /** The venue's published max, where it publishes one. */
  maxLeverage: number | null;
  sizeDecimals: number;
  assetClass: PerpAssetClass;
  /** Jupiter only. */
  mint?: string;
}

/** One coin's markets across venues. */
export interface PerpMarketGroup {
  /** `perp:<coin>` or `spot:<name>`. */
  key: string;
  coin: string;
  kind: PerpMarketKind;
  /** Hyperliquid, then Aster, then Jupiter. */
  markets: PerpMarket[];
  /** Summed across venues. */
  volume24hUsd: number;
  /** The highest across venues. */
  maxLeverage: number | null;
}

export type PerpCandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";
export const PERP_CANDLE_SECONDS: Record<PerpCandleInterval, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3_600, "4h": 14_400, "1d": 86_400, "1w": 604_800 };

/** A candle. `time` in unix seconds. */
export interface PerpCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PerpsClientOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  endpoints?: Partial<Record<keyof typeof PERP_ENDPOINTS, string>>;
  /** For live mids. Default: the global WebSocket. */
  WebSocket?: WebSocketConstructor;
}

// ---- normalisation -----------------------------------------------------------------------------------------------------------

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** `kPEPE` → `{ coin: "PEPE", unit: 1000 }`, `1000BONK` → `{ coin: "BONK", unit: 1000 }`, `BTC` → `{ coin: "BTC", unit: 1 }`. */
export function normalizePerpCoin(base: string): { coin: string; unitMultiplier: number } {
  const k = /^k([A-Z0-9]{2,})$/.exec(base);
  if (k) return { coin: k[1]!, unitMultiplier: 1_000 };
  const t = /^1000([A-Z0-9]{2,})$/.exec(base);
  if (t) return { coin: t[1]!, unitMultiplier: 1_000 };
  return { coin: base, unitMultiplier: 1 };
}

export interface HlMeta {
  universe: { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean; onlyIsolated?: boolean }[];
}
export interface HlCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  markPx: string;
  midPx: string | null;
  oraclePx: string;
}
export interface HlSpotMeta {
  universe: { name: string; tokens: [number, number]; index: number }[];
  tokens: { name: string; szDecimals: number; index: number }[];
}
export interface HlSpotCtx {
  coin: string;
  prevDayPx: string;
  dayNtlVlm: string;
  markPx: string;
  midPx: string | null;
}
export interface HlCandle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
}
export interface AsterSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  contractType: string;
  quantityPrecision: number;
  underlyingSubType?: string[];
}
export interface AsterTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}
export interface AsterPremium {
  symbol: string;
  markPrice: string;
  lastFundingRate: string;
}
export type AsterKline = [number, string, string, string, string, string, ...unknown[]];

const change = (price: number, prev: number) => (prev > 0 ? ((price - prev) / prev) * 100 : null);

/** Hyperliquid perps from `metaAndAssetCtxs`. Delisted markets are skipped. */
export function hyperliquidPerpMarkets([meta, ctxs]: [HlMeta, HlCtx[]]): PerpMarket[] {
  const out: PerpMarket[] = [];
  meta.universe.forEach((u, i) => {
    const c = ctxs[i];
    if (!c || u.isDelisted) return;
    const price = num(c.midPx ?? c.markPx);
    const { coin, unitMultiplier } = normalizePerpCoin(u.name);
    out.push({
      id: `hyperliquid:${u.name}`,
      venue: "hyperliquid",
      kind: "perp",
      coin,
      base: u.name,
      symbol: u.name,
      name: `${u.name}-PERP`,
      unitMultiplier,
      price,
      change24hPct: change(price, num(c.prevDayPx)),
      volume24hUsd: num(c.dayNtlVlm),
      openInterestUsd: num(c.openInterest) * num(c.oraclePx),
      funding: num(c.funding),
      fundingIntervalHours: 1,
      maxLeverage: u.maxLeverage,
      sizeDecimals: u.szDecimals,
      assetClass: "crypto",
    });
  });
  return out;
}

/** Hyperliquid spot pairs from `spotMetaAndAssetCtxs`. Pairs with no 24 h volume are skipped. */
export function hyperliquidSpotMarkets([meta, ctxs]: [HlSpotMeta, HlSpotCtx[]]): PerpMarket[] {
  const byCoin = new Map(ctxs.map((c) => [c.coin, c]));
  const tokens = new Map(meta.tokens.map((t) => [t.index, t]));
  const out: PerpMarket[] = [];
  for (const u of meta.universe) {
    const c = byCoin.get(u.name);
    const baseTok = tokens.get(u.tokens[0]);
    const quoteTok = tokens.get(u.tokens[1]);
    if (!c || !baseTok || num(c.dayNtlVlm) <= 0) continue;
    const price = num(c.midPx ?? c.markPx);
    out.push({
      id: `hyperliquid:${u.name}`,
      venue: "hyperliquid",
      kind: "spot",
      coin: baseTok.name,
      base: baseTok.name,
      symbol: u.name,
      name: `${baseTok.name}/${quoteTok?.name ?? "USDC"}`,
      unitMultiplier: 1,
      price,
      change24hPct: change(price, num(c.prevDayPx)),
      volume24hUsd: num(c.dayNtlVlm),
      openInterestUsd: null,
      funding: null,
      fundingIntervalHours: null,
      maxLeverage: 1,
      sizeDecimals: baseTok.szDecimals,
      assetClass: "crypto",
    });
  }
  return out;
}

const assetClassOf = (sub: string[] | undefined): PerpAssetClass => {
  const s = (sub ?? []).map((x) => x.toUpperCase());
  if (s.includes("STOCK") || s.includes("ETF")) return "stock";
  if (s.includes("COMMODITIES")) return "commodity";
  return "crypto";
};

/** Aster USDT perpetuals that are trading and have volume. Aster doesn't publish leverage brackets without a key, so `maxLeverage` is `null`. */
export function asterMarkets(info: { symbols: AsterSymbol[] }, tickers: AsterTicker[], premium: AsterPremium[]): PerpMarket[] {
  const t = new Map(tickers.map((x) => [x.symbol, x]));
  const p = new Map(premium.map((x) => [x.symbol, x]));
  const out: PerpMarket[] = [];
  for (const s of info.symbols) {
    if (s.status !== "TRADING" || s.contractType !== "PERPETUAL" || s.quoteAsset !== "USDT") continue;
    const tick = t.get(s.symbol);
    if (!tick || num(tick.quoteVolume) <= 0) continue;
    const { coin, unitMultiplier } = normalizePerpCoin(s.baseAsset);
    const prem = p.get(s.symbol);
    out.push({
      id: `aster:${s.symbol}`,
      venue: "aster",
      kind: "perp",
      coin,
      base: s.baseAsset,
      symbol: s.symbol,
      name: `${coin}-PERP`,
      unitMultiplier,
      price: num(tick.lastPrice),
      change24hPct: Number.isFinite(Number(tick.priceChangePercent)) ? Number(tick.priceChangePercent) : null,
      volume24hUsd: num(tick.quoteVolume),
      openInterestUsd: null,
      funding: prem ? num(prem.lastFundingRate) : null,
      fundingIntervalHours: prem ? 8 : null,
      maxLeverage: null,
      sizeDecimals: s.quantityPrecision,
      assetClass: assetClassOf(s.underlyingSubType),
    });
  }
  return out;
}

const VENUE_ORDER: Record<PerpVenue, number> = { hyperliquid: 0, aster: 1, jupiter: 2 };

/**
 * Groups markets by coin, as the site does: perps by normalised coin (so `kPEPE` and `1000PEPE` sit together), each spot pair on its
 * own row. Venues inside a group go Hyperliquid, Aster, Jupiter; groups go by summed volume, biggest first.
 */
export function groupPerpMarkets(markets: readonly PerpMarket[]): PerpMarketGroup[] {
  const groups = new Map<string, PerpMarketGroup>();
  for (const m of markets) {
    const key = m.kind === "perp" ? `perp:${m.coin}` : `spot:${m.name}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, coin: m.coin, kind: m.kind, markets: [], volume24hUsd: 0, maxLeverage: null }));
    g.markets.push(m);
    g.volume24hUsd += m.volume24hUsd;
    if (m.maxLeverage !== null && (g.maxLeverage === null || m.maxLeverage > g.maxLeverage)) g.maxLeverage = m.maxLeverage;
  }
  for (const g of groups.values()) g.markets.sort((a, b) => VENUE_ORDER[a.venue] - VENUE_ORDER[b.venue]);
  return [...groups.values()].sort((a, b) => b.volume24hUsd - a.volume24hUsd);
}

/** Filters groups by kind, asset class and a search string matched against coin and market names. */
export function filterPerpGroups(groups: readonly PerpMarketGroup[], f: { kind?: PerpMarketKind; assetClass?: PerpAssetClass; q?: string } = {}): PerpMarketGroup[] {
  const q = f.q?.trim().toUpperCase();
  return groups.filter(
    (g) =>
      (!f.kind || g.kind === f.kind) &&
      (!f.assetClass || g.markets.some((m) => m.assetClass === f.assetClass)) &&
      (!q || g.coin.toUpperCase().includes(q) || g.markets.some((m) => m.name.toUpperCase().includes(q))),
  );
}

// ---- client ------------------------------------------------------------------------------------------------------------------

export interface PerpMarketsResult {
  markets: PerpMarket[];
  /** Venues that failed this time; the others still load. */
  failed: { venue: PerpVenue; error: unknown }[];
}

/** Reads the three venues' public market data. Holds no keys and signs nothing. */
export class PerpsClient {
  private readonly hl: ApiClient;
  private readonly aster: ApiClient;
  private readonly jup: ApiClient;
  private readonly wsUrl: string;
  private readonly WebSocketCtor: WebSocketConstructor | undefined;

  constructor(opts: PerpsClientOptions = {}) {
    const e = { ...PERP_ENDPOINTS, ...opts.endpoints };
    const common = { fetch: opts.fetch, timeoutMs: opts.timeoutMs ?? 15_000, requestId: false as const };
    this.hl = new ApiClient({ ...common, apiUrl: e.hyperliquid });
    this.aster = new ApiClient({ ...common, apiUrl: e.aster });
    this.jup = new ApiClient({ ...common, apiUrl: e.jupiter });
    this.wsUrl = e.hyperliquidWs;
    this.WebSocketCtor = opts.WebSocket;
  }

  private info<T>(body: unknown, opts?: RequestOptions) {
    return this.hl.post<T>("/info", body, { retry: { writes: true }, ...opts });
  }

  /** Hyperliquid perps. */
  async hyperliquidPerps(opts?: RequestOptions): Promise<PerpMarket[]> {
    return hyperliquidPerpMarkets(await this.info<[HlMeta, HlCtx[]]>({ type: "metaAndAssetCtxs" }, opts));
  }

  /** Hyperliquid spot pairs. */
  async hyperliquidSpot(opts?: RequestOptions): Promise<PerpMarket[]> {
    return hyperliquidSpotMarkets(await this.info<[HlSpotMeta, HlSpotCtx[]]>({ type: "spotMetaAndAssetCtxs" }, opts));
  }

  /** Aster USDT perps. */
  async asterPerps(opts?: RequestOptions): Promise<PerpMarket[]> {
    const [info, tickers, premium] = await Promise.all([
      this.aster.get<{ symbols: AsterSymbol[] }>("/fapi/v1/exchangeInfo", undefined, opts),
      this.aster.get<AsterTicker[]>("/fapi/v1/ticker/24hr", undefined, opts),
      this.aster.get<AsterPremium[]>("/fapi/v1/premiumIndex", undefined, opts),
    ]);
    return asterMarkets(info, tickers, premium);
  }

  /** Jupiter Perps' three markets. Jupiter charges borrow fees rather than funding, so `funding` is `null`. */
  async jupiterPerps(opts?: RequestOptions): Promise<PerpMarket[]> {
    return Promise.all(
      JUPITER_PERP_MARKETS.map(async (m) => {
        const s = await this.jup.get<{ price: string; priceChange24H: string; volume: string }>("/market-stats", { mint: m.mint }, opts);
        return {
          id: `jupiter:${m.base}`,
          venue: "jupiter",
          kind: "perp",
          coin: m.base,
          base: m.base,
          symbol: m.base,
          name: `${m.base}-PERP`,
          unitMultiplier: 1,
          price: num(s.price),
          change24hPct: Number.isFinite(Number(s.priceChange24H)) ? Number(s.priceChange24H) : null,
          volume24hUsd: num(s.volume),
          openInterestUsd: null,
          funding: null,
          fundingIntervalHours: null,
          maxLeverage: m.maxLeverage,
          sizeDecimals: 2,
          assetClass: "crypto",
          mint: m.mint,
        } satisfies PerpMarket;
      }),
    );
  }

  /** Every venue at once. A venue that fails is reported in `failed` and left out. */
  async markets(o: { venues?: PerpVenue[]; spot?: boolean } & RequestOptions = {}): Promise<PerpMarketsResult> {
    const venues = o.venues ?? [...PERP_VENUES];
    const jobs: [PerpVenue, Promise<PerpMarket[]>][] = [];
    if (venues.includes("hyperliquid")) {
      jobs.push(["hyperliquid", this.hyperliquidPerps(o)]);
      if (o.spot !== false) jobs.push(["hyperliquid", this.hyperliquidSpot(o)]);
    }
    if (venues.includes("aster")) jobs.push(["aster", this.asterPerps(o)]);
    if (venues.includes("jupiter")) jobs.push(["jupiter", this.jupiterPerps(o)]);
    const settled = await Promise.allSettled(jobs.map(([, p]) => p));
    const markets: PerpMarket[] = [];
    const failed: PerpMarketsResult["failed"] = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") markets.push(...r.value);
      else failed.push({ venue: jobs[i]![0], error: r.reason });
    });
    return { markets, failed };
  }

  /** Every venue's markets, grouped by coin. */
  async groups(o: { venues?: PerpVenue[]; spot?: boolean } & RequestOptions = {}): Promise<PerpMarketGroup[]> {
    return groupPerpMarkets((await this.markets(o)).markets);
  }

  /**
   * Candles for a market, oldest first. Jupiter has no candle feed, so a Jupiter market reads Hyperliquid's candles for the same coin,
   * as the site's chart does. Default: about 1,000 bars up to now.
   */
  async candles(market: Pick<PerpMarket, "venue" | "symbol" | "coin">, interval: PerpCandleInterval = "15m", range: { from?: number; to?: number } = {}, opts?: RequestOptions): Promise<PerpCandle[]> {
    const secs = PERP_CANDLE_SECONDS[interval];
    if (!secs) throw new StealthInputError(`interval is one of ${Object.keys(PERP_CANDLE_SECONDS).join(", ")}.`);
    const endMs = (range.to ?? Math.floor(Date.now() / 1000)) * 1000;
    const startMs = range.from !== undefined ? range.from * 1000 : endMs - secs * 1000 * 1000;
    if (market.venue === "aster") {
      const rows = await this.aster.get<AsterKline[]>("/fapi/v1/klines", { symbol: market.symbol, interval, startTime: startMs, endTime: endMs, limit: 1500 }, opts);
      return rows.map((k) => ({ time: Math.floor(k[0] / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), volume: num(k[5]) }));
    }
    const coin = market.venue === "jupiter" ? market.coin : market.symbol;
    const rows = await this.info<HlCandle[]>({ type: "candleSnapshot", req: { coin, interval, startTime: startMs, endTime: endMs } }, opts);
    return rows.map((c) => ({ time: Math.floor(c.t / 1000), open: num(c.o), high: num(c.h), low: num(c.l), close: num(c.c), volume: num(c.v) }));
  }

  /** Hyperliquid's mid prices for every market, once. */
  allMids(opts?: RequestOptions) {
    return this.info<Record<string, string>>({ type: "allMids" }, opts);
  }

  /**
   * Hyperliquid's live mids over its public WebSocket: `handler` gets every market's mid on each tick. Reconnects by itself.
   * Returns a function that closes the socket.
   */
  watchMids(handler: (mids: Record<string, number>) => void, opts: { reconnect?: ReconnectOptions } = {}): () => void {
    const socket = new ReconnectingSocket(
      this.wsUrl,
      {
        onOpen: () => socket.sendIfOpen({ method: "subscribe", subscription: { type: "allMids" } }),
        onMessage: (data) => {
          const m = data as { channel?: string; data?: { mids?: Record<string, string> } };
          if (m?.channel !== "allMids" || !m.data?.mids) return;
          const out: Record<string, number> = {};
          for (const [k, v] of Object.entries(m.data.mids)) out[k] = num(v);
          handler(out);
        },
      },
      { WebSocket: this.WebSocketCtor, reconnect: { minDelayMs: 1_000, ...opts.reconnect }, heartbeat: { intervalMs: 30_000, message: JSON.stringify({ method: "ping" }) } },
    );
    socket.connect();
    return () => socket.close();
  }
}

export const createPerpsClient = (opts: PerpsClientOptions = {}) => new PerpsClient(opts);
