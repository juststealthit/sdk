/**
 * A WebSocket that reconnects with exponential backoff and jitter, re-sends its subscriptions after every reconnect, and never throws
 * from a callback. Used by the platform's live stream and the perps venues' public feeds. Works with the global `WebSocket`
 * (browsers, Node 22+, Deno, Bun) or any constructor you pass, such as the `ws` package on older Node.
 *
 * @module
 */
import { StealthUnsupportedError, StealthWebSocketError } from "../shared/errors.js";
import { backoffDelay } from "../shared/retry.js";

/** The part of the WebSocket API the SDK uses. Both the browser's and the `ws` package's fit it. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export type SocketState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface ReconnectOptions {
  /** Default true. */
  enabled?: boolean;
  /** First wait. Default 500 ms. */
  minDelayMs?: number;
  /** Longest wait. Default 30 s. */
  maxDelayMs?: number;
  /** Give up after this many failed tries in a row. Default: never. */
  maxAttempts?: number;
}

export interface SocketOptions {
  /** A WebSocket constructor. Default: `globalThis.WebSocket`. */
  WebSocket?: WebSocketConstructor;
  reconnect?: ReconnectOptions;
  /** Sends this every `intervalMs` while open, to keep proxies from dropping an idle socket. */
  heartbeat?: { intervalMs: number; message: string };
  /** A socket silent this long is treated as dead and reopened. Default: off. */
  idleTimeoutMs?: number;
  /** A connect that hasn't opened after this long is dropped and retried. Default: `idleTimeoutMs`, or 30 s without one. */
  connectTimeoutMs?: number;
  /** Sends queued while closed, kept for the next open. The oldest go first past this. Default 1,000. */
  maxQueue?: number;
}

export interface SocketHandlers {
  /** Every parsed JSON message. Non-JSON messages are passed as the raw string. */
  onMessage(data: unknown): void;
  /** Called after each (re)connect, before anything else is sent: re-subscribe here. */
  onOpen?(info: { reconnect: boolean }): void;
  onStateChange?(state: SocketState): void;
  onError?(error: StealthWebSocketError): void;
}

const OPEN = 1;

/** Resolves the WebSocket constructor, or throws a clear error. */
export function resolveWebSocket(ctor?: WebSocketConstructor): WebSocketConstructor {
  const found = ctor ?? (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (!found) throw new StealthUnsupportedError("No WebSocket here. Pass one: `{ WebSocket: (await import('ws')).WebSocket }`, or use Node 22+.");
  return found;
}

/** A self-healing WebSocket. Call {@link connect} to start and {@link close} to stop for good. */
export class ReconnectingSocket {
  private ws: WebSocketLike | null = null;
  private state: SocketState = "idle";
  private attempts = 0;
  private everOpened = false;
  private stable = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private readonly Ctor: WebSocketConstructor;
  private readonly queue: string[] = [];

  constructor(
    readonly url: string,
    private readonly handlers: SocketHandlers,
    private readonly opts: SocketOptions = {},
  ) {
    this.Ctor = resolveWebSocket(opts.WebSocket);
  }

  get status(): SocketState {
    return this.state;
  }

  connect(): void {
    if (this.state === "closed") return;
    // a socket on its way, or a reconnect already scheduled: opening another would leave two sockets delivering every message
    if (this.ws || this.timer) return;
    this.open();
  }

  /** Sends now if open, else queues it for the next open. */
  send(message: unknown): void {
    const data = typeof message === "string" ? message : JSON.stringify(message);
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(data);
    else {
      this.queue.push(data);
      const max = Math.max(1, this.opts.maxQueue ?? 1_000);
      if (this.queue.length > max) this.queue.splice(0, this.queue.length - max);
    }
  }

  /** Sends only if open. Returns whether it was sent. Subscriptions use this, since `onOpen` re-sends them anyway. */
  sendIfOpen(message: unknown): boolean {
    if (!this.ws || this.ws.readyState !== OPEN) return false;
    this.ws.send(typeof message === "string" ? message : JSON.stringify(message));
    return true;
  }

  /** Closes for good. No more reconnects. */
  close(): void {
    this.setState("closed");
    this.clearTimers();
    this.queue.length = 0;
    this.discard(1000, "closed by client");
  }

  /** Detaches the current socket and closes it, without waiting for its close event (a dead connection may never send one). */
  private discard(code: number, reason: string) {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  private open() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.ws) this.discard(1000, "replaced");
    this.setState(this.everOpened || this.attempts > 0 ? "reconnecting" : "connecting");
    let ws: WebSocketLike;
    try {
      ws = new this.Ctor(this.url);
    } catch (error) {
      this.fail(new StealthWebSocketError(`Couldn't open ${this.url}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));
      return;
    }
    this.ws = ws;
    this.armConnectTimeout(ws);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      if (this.idle) clearTimeout(this.idle);
      this.idle = null;
      const reconnect = this.everOpened;
      this.everOpened = true;
      // the backoff resets on the first message, not on open: a server that accepts and drops at once mustn't be hammered
      this.stable = false;
      this.setState("open");
      this.safe(() => this.handlers.onOpen?.({ reconnect }));
      while (this.queue.length && ws.readyState === OPEN) ws.send(this.queue.shift()!);
      this.startTimers();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      if (!this.stable) {
        this.stable = true;
        this.attempts = 0;
      }
      this.touch();
      const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
      let data: unknown = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        /* not JSON: pass the string */
      }
      this.safe(() => this.handlers.onMessage(data));
    };
    ws.onerror = () => {
      /* onclose follows and decides */
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      if (this.state === "closed") return;
      this.fail(new StealthWebSocketError(`The stream closed${ev?.code ? ` (${ev.code}${ev.reason ? `: ${ev.reason}` : ""})` : ""}.`));
    };
  }

  private fail(error: StealthWebSocketError) {
    // only the options actually set: `{ minDelayMs: undefined }` keeps the default instead of making the delay NaN
    const set = Object.fromEntries(Object.entries(this.opts.reconnect ?? {}).filter(([, v]) => v !== undefined)) as ReconnectOptions;
    const r = { enabled: true, minDelayMs: 500, maxDelayMs: 30_000, ...set };
    this.safe(() => this.handlers.onError?.(error));
    // an error handler may have closed the socket for good
    if (this.state === "closed") return;
    if (!r.enabled || (r.maxAttempts !== undefined && this.attempts >= r.maxAttempts)) {
      this.setState("closed");
      return;
    }
    const delay = Math.max(r.minDelayMs, backoffDelay(this.attempts, r));
    this.attempts++;
    this.setState("reconnecting");
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.state !== "closed") this.open();
    }, delay);
  }

  /** A connect that never opens nor closes (a black-holed network) is dropped and retried. */
  private armConnectTimeout(ws: WebSocketLike) {
    const ms = this.opts.connectTimeoutMs ?? (this.opts.idleTimeoutMs || 30_000);
    if (!(ms > 0)) return;
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.idle = null;
      if (this.ws !== ws || ws.readyState === OPEN) return;
      this.drop(new StealthWebSocketError(`The stream didn't open within ${ms} ms.`), 4001, "connect timeout");
    }, ms);
  }

  /** Gives up on the current socket now and schedules a reconnect. */
  private drop(error: StealthWebSocketError, code: number, reason: string) {
    if (this.state === "closed") return;
    this.clearTimers();
    this.discard(code, reason);
    this.fail(error);
  }

  private startTimers() {
    const hb = this.opts.heartbeat;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (hb && hb.intervalMs > 0) this.heartbeat = setInterval(() => this.sendIfOpen(hb.message), hb.intervalMs);
    this.touch();
  }

  private touch() {
    if (!this.opts.idleTimeoutMs) return;
    if (this.idle) clearTimeout(this.idle);
    const ms = this.opts.idleTimeoutMs;
    this.idle = setTimeout(() => {
      this.idle = null;
      // a silent socket is reopened now: on a dead connection its close event can take minutes, or never come
      this.drop(new StealthWebSocketError(`The stream was silent for ${ms} ms; reconnecting.`), 4000, "idle");
    }, ms);
  }

  private clearTimers() {
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.idle) clearTimeout(this.idle);
    this.timer = this.heartbeat = this.idle = null;
  }

  private setState(s: SocketState) {
    if (this.state === s) return;
    this.state = s;
    this.safe(() => this.handlers.onStateChange?.(s));
  }

  private safe(fn: () => void) {
    try {
      fn();
    } catch {
      /* a caller's callback must not break the socket */
    }
  }
}
