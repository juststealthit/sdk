/**
 * The platform's live stream: trades, launches, token updates, candles and the chain head for Solana coins, over one WebSocket that
 * reconnects by itself and re-subscribes every channel after a reconnect.
 *
 * ```ts
 * const live = createStealthStream();
 * const off = live.trades(mint, ({ trade }) => console.log(trade.side, trade.valueUsd));
 * live.candles(mint, "1m", ({ candle }) => chart.update(candle));
 * live.onReconnect(() => refetchEverything()); // you may have missed messages while it was down
 * // later
 * off();
 * live.close();
 * ```
 *
 * EVM chains have no stream; see {@link pollTrades} for a polling equivalent.
 *
 * @module
 */
import { DEFAULT_API_URL } from "../shared/api.js";
import { StealthInputError, type StealthWebSocketError } from "../shared/errors.js";
import type { ApiCandle, ApiTrade, CandleInterval, SolApiToken } from "../api/common.js";
import { CANDLE_INTERVALS } from "../api/common.js";
import { isSolanaAddress } from "../utils/address.js";
import { ReconnectingSocket, type ReconnectOptions, type SocketState, type WebSocketConstructor } from "./socket.js";

/** A trade, with the coin as it stands after it. */
export interface TradeMessage {
  ch: string;
  type: "trade";
  trade: ApiTrade;
  token: SolApiToken;
}
/** A new coin. */
export interface LaunchMessage {
  ch: "tokens";
  type: "launch";
  token: SolApiToken;
}
/** A coin's state changed: graduation, metadata, stats. */
export interface TokenMessage {
  ch: string;
  type: "token";
  token: SolApiToken;
}
/** The latest candle, possibly still open, after each trade. */
export interface CandleMessage {
  ch: string;
  type: "candle";
  candle: ApiCandle;
}
/** The chain head and how far behind the indexer is. Pushed every few seconds; a new subscriber gets the last one at once. */
export interface HeadMessage {
  ch: "head";
  type: "head";
  /** Chain slot. */
  block: number;
  /** Server time, unix ms. */
  timestamp: number;
  /** Indexed slot; `null` while the indexer is offline or starting. */
  indexed: number | null;
  lag: number | null;
  indexer: "online" | "offline" | "error" | "starting";
}

export type StreamMessage = TradeMessage | LaunchMessage | TokenMessage | CandleMessage | HeadMessage;

/** A channel the stream accepts. */
export type StreamChannel = "head" | "tokens" | "system" | `token:${string}` | `candles:${string}:${CandleInterval}`;

export interface StreamOptions {
  /** The API's base URL; the stream lives at `<apiUrl>/sol/ws` with `http` swapped for `ws`. Default: the official API. */
  apiUrl?: string;
  /** The stream's own URL, if it isn't under `apiUrl`. */
  url?: string;
  /** A WebSocket constructor. Default: the global one (browsers, Node 22+). On older Node pass the `ws` package's. */
  WebSocket?: WebSocketConstructor;
  reconnect?: ReconnectOptions;
  /** How often to send an application ping. Default 25 s. `0` turns it off. */
  pingMs?: number;
  /** Reopen a socket silent for this long. Default 90 s: the head channel or a pong should arrive well within it. */
  idleTimeoutMs?: number;
  /** Open the socket at once rather than on the first subscription. Default false. */
  eager?: boolean;
}

export type StreamHandler = (msg: StreamMessage) => void;
export type Unsubscribe = () => void;

/** `https://juststealthit.xyz/api` → `wss://juststealthit.xyz/api/sol/ws`. */
export function streamUrlFor(apiUrl: string = DEFAULT_API_URL): string {
  return `${apiUrl.replace(/\/+$/, "").replace(/^http/, "ws")}/sol/ws`;
}

/** The channel name for a coin. Channels are case-insensitive on the server, so the SDK keys them in lowercase. */
export function tokenChannel(mint: string): `token:${string}` {
  if (!isSolanaAddress(mint)) throw new StealthInputError(`${mint} isn't a Solana address.`);
  return `token:${mint.toLowerCase()}`;
}

/** The channel name for a coin's candles. */
export function candleChannel(mint: string, interval: CandleInterval): `candles:${string}:${CandleInterval}` {
  if (!isSolanaAddress(mint)) throw new StealthInputError(`${mint} isn't a Solana address.`);
  if (!(CANDLE_INTERVALS as readonly string[]).includes(interval)) throw new StealthInputError(`interval is one of ${CANDLE_INTERVALS.join(", ")}.`);
  return `candles:${mint.toLowerCase()}:${interval}`;
}

const normalize = (ch: string) => ch.toLowerCase().replace(/:1d$/, ":1D");

/** The live stream. One socket, any number of subscriptions, counted per channel. */
export class StealthStream {
  readonly url: string;
  private readonly socket: ReconnectingSocket;
  private readonly handlers = new Map<string, Set<StreamHandler>>();
  private readonly reconnectListeners = new Set<() => void>();
  private readonly stateListeners = new Set<(s: SocketState) => void>();
  private readonly errorListeners = new Set<(e: StealthWebSocketError) => void>();
  private lastHead: HeadMessage | null = null;

  constructor(opts: StreamOptions = {}) {
    this.url = opts.url ?? streamUrlFor(opts.apiUrl);
    const pingMs = opts.pingMs ?? 25_000;
    this.socket = new ReconnectingSocket(
      this.url,
      {
        onMessage: (data) => this.dispatch(data),
        onOpen: ({ reconnect }) => {
          for (const ch of this.handlers.keys()) this.socket.sendIfOpen({ op: "sub", ch });
          if (reconnect) for (const fn of this.reconnectListeners) fn();
        },
        onStateChange: (s) => {
          for (const fn of this.stateListeners) fn(s);
        },
        onError: (e) => {
          for (const fn of this.errorListeners) fn(e);
        },
      },
      {
        WebSocket: opts.WebSocket,
        reconnect: opts.reconnect,
        heartbeat: pingMs > 0 ? { intervalMs: pingMs, message: JSON.stringify({ op: "ping" }) } : undefined,
        idleTimeoutMs: opts.idleTimeoutMs ?? 90_000,
      },
    );
    if (opts.eager) this.socket.connect();
  }

  /** `idle`, `connecting`, `open`, `reconnecting` or `closed`. */
  get state(): SocketState {
    return this.socket.status;
  }

  /** The last head message seen, if any. */
  get head(): HeadMessage | null {
    return this.lastHead;
  }

  /** Subscribes `handler` to a raw channel. Returns a function that unsubscribes it. */
  subscribe(channel: StreamChannel, handler: StreamHandler): Unsubscribe {
    const ch = normalize(channel);
    let set = this.handlers.get(ch);
    if (!set) {
      set = new Set();
      this.handlers.set(ch, set);
      this.socket.connect();
      this.socket.sendIfOpen({ op: "sub", ch });
    }
    set.add(handler);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const s = this.handlers.get(ch);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) {
        this.handlers.delete(ch);
        this.socket.sendIfOpen({ op: "unsub", ch });
      }
    };
  }

  /** Trades on one coin, or on every coin when `mint` is `null`. */
  trades(mint: string | null, handler: (msg: TradeMessage) => void): Unsubscribe {
    return this.subscribe(mint === null ? "tokens" : tokenChannel(mint), (m) => {
      if (m.type === "trade") handler(m);
    });
  }

  /** Every new coin, as it launches. */
  launches(handler: (msg: LaunchMessage) => void): Unsubscribe {
    return this.subscribe("tokens", (m) => {
      if (m.type === "launch") handler(m);
    });
  }

  /** One coin's trades and state changes. */
  token(mint: string, handler: (msg: TradeMessage | TokenMessage) => void): Unsubscribe {
    return this.subscribe(tokenChannel(mint), (m) => {
      if (m.type === "trade" || m.type === "token") handler(m);
    });
  }

  /** Every coin's launches, trades and state changes. */
  allTokens(handler: (msg: TradeMessage | LaunchMessage | TokenMessage) => void): Unsubscribe {
    return this.subscribe("tokens", (m) => {
      if (m.type === "trade" || m.type === "launch" || m.type === "token") handler(m);
    });
  }

  /** The latest candle of one interval, after each trade. */
  candles(mint: string, interval: CandleInterval, handler: (msg: CandleMessage) => void): Unsubscribe {
    return this.subscribe(candleChannel(mint, interval), (m) => {
      if (m.type === "candle") handler(m);
    });
  }

  /** The chain head and indexer lag. */
  heads(handler: (msg: HeadMessage) => void): Unsubscribe {
    return this.subscribe("head", (m) => {
      if (m.type === "head") handler(m);
    });
  }

  /**
   * A channel as an async iterator. Messages queue while you're busy (up to `bufferSize`, oldest dropped); breaking out of the loop
   * unsubscribes.
   */
  async *iterate(channel: StreamChannel, opts: { bufferSize?: number; signal?: AbortSignal } = {}): AsyncGenerator<StreamMessage, void, undefined> {
    const max = opts.bufferSize ?? 1_000;
    const queue: StreamMessage[] = [];
    let wake: (() => void) | null = null;
    const off = this.subscribe(channel, (m) => {
      queue.push(m);
      if (queue.length > max) queue.shift();
      wake?.();
    });
    const onAbort = () => wake?.();
    opts.signal?.addEventListener("abort", onAbort);
    const offState = this.onStateChange(() => wake?.());
    try {
      while (!opts.signal?.aborted && this.state !== "closed") {
        if (!queue.length) await new Promise<void>((r) => (wake = r));
        wake = null;
        while (queue.length) yield queue.shift()!;
      }
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
      offState();
      off();
    }
  }

  /** Called after every reconnect. Messages sent while the socket was down are gone: refetch what you show. */
  onReconnect(fn: () => void): Unsubscribe {
    this.reconnectListeners.add(fn);
    return () => this.reconnectListeners.delete(fn);
  }

  onStateChange(fn: (state: SocketState) => void): Unsubscribe {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  /** Every close and failed connect, with the reason. Reconnects carry on unless they've been turned off. */
  onError(fn: (error: StealthWebSocketError) => void): Unsubscribe {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  /** Channels with at least one handler. */
  get channels(): string[] {
    return [...this.handlers.keys()];
  }

  /** Closes the socket for good and drops every handler. */
  close(): void {
    this.handlers.clear();
    this.socket.close();
  }

  private dispatch(data: unknown) {
    if (!data || typeof data !== "object") return;
    const msg = data as { ch?: unknown; type?: unknown };
    if (msg.type === "head") this.lastHead = msg as HeadMessage;
    if (typeof msg.ch !== "string") return;
    const set = this.handlers.get(normalize(msg.ch));
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(msg as StreamMessage);
      } catch {
        /* one handler's error must not stop the others */
      }
    }
  }
}

export const createStealthStream = (opts: StreamOptions = {}) => new StealthStream(opts);

/** What {@link pollTrades} polls: any `trades(token, cursor)` page reader, such as `stealth.evm.chain("base").getTrades`. */
export type TradePageReader = (token: string) => Promise<{ items: ApiTrade[] }>;

/**
 * Polls a coin's newest trades and calls `handler` once per trade it hasn't seen, oldest first. The EVM equivalent of the stream.
 * The first poll only records what's there, so you get trades from now on.
 */
export function pollTrades(read: TradePageReader, token: string, handler: (trade: ApiTrade) => void, opts: { intervalMs?: number; onError?: (e: unknown) => void } = {}): Unsubscribe {
  const seen = new Set<string>();
  let first = true;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    try {
      const { items } = await read(token);
      const fresh = items.filter((t) => !seen.has(t.id)).reverse();
      for (const t of items) seen.add(t.id);
      if (seen.size > 5_000) for (const id of [...seen].slice(0, seen.size - 2_000)) seen.delete(id);
      if (!first) for (const t of fresh) handler(t);
      first = false;
    } catch (e) {
      opts.onError?.(e);
    }
    if (!stopped) timer = setTimeout(tick, opts.intervalMs ?? 4_000);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
