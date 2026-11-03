import { afterEach, describe, expect, it, vi } from "vitest";

import { ReconnectingSocket, type WebSocketLike } from "../../src/live/socket.js";
import { candleChannel, createStealthStream, pollTrades, streamUrlFor, tokenChannel } from "../../src/live/stream.js";
import { StealthInputError, StealthUnsupportedError } from "../../src/shared/errors.js";

const MINT = "So11111111111111111111111111111111111111112";

/** A WebSocket stand-in: records what's sent, and lets the test open, close and push messages. */
class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = [];
  static failNext = false;
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {
    if (FakeSocket.failNext) {
      FakeSocket.failNext = false;
      throw new Error("refused");
    }
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(msg: unknown) {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const latest = () => FakeSocket.all[FakeSocket.all.length - 1]!;
const fast = { WebSocket: FakeSocket, reconnect: { minDelayMs: 1, maxDelayMs: 2 }, pingMs: 0, idleTimeoutMs: 0 };
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  FakeSocket.all = [];
  vi.useRealTimers();
});

describe("channels and URLs", () => {
  it("derives the stream URL from the API URL", () => {
    expect(streamUrlFor()).toBe("wss://juststealthit.xyz/api/sol/ws");
    expect(streamUrlFor("http://localhost:3000/api/")).toBe("ws://localhost:3000/api/sol/ws");
  });

  it("names channels in lowercase, and keeps 1D", () => {
    expect(tokenChannel(MINT)).toBe(`token:${MINT.toLowerCase()}`);
    expect(candleChannel(MINT, "1D")).toBe(`candles:${MINT.toLowerCase()}:1D`);
    expect(() => tokenChannel("0xabc")).toThrow(StealthInputError);
    expect(() => candleChannel(MINT, "2m" as never)).toThrow(StealthInputError);
  });
});

describe("StealthStream", () => {
  it("connects lazily, subscribes on open and routes messages by channel", async () => {
    const live = createStealthStream(fast);
    expect(FakeSocket.all).toHaveLength(0);
    const trades: string[] = [];
    const tokens: string[] = [];
    live.trades(MINT, (m) => trades.push(m.trade.id));
    live.token(MINT, (m) => tokens.push(m.type));
    expect(FakeSocket.all).toHaveLength(1);
    const ws = latest();
    ws.open();
    expect(ws.sent).toEqual([{ op: "sub", ch: tokenChannel(MINT) }]);
    // the server echoes the channel in lowercase; a message for another channel is ignored
    ws.push({ ch: tokenChannel(MINT), type: "trade", trade: { id: "t1" }, token: {} });
    ws.push({ ch: tokenChannel(MINT), type: "token", token: {} });
    ws.push({ ch: "token:other", type: "trade", trade: { id: "x" }, token: {} });
    ws.push({ type: "hello" });
    ws.push("not json");
    expect(trades).toEqual(["t1"]);
    expect(tokens).toEqual(["trade", "token"]);
    live.close();
  });

  it("counts subscribers per channel and unsubscribes with the last", () => {
    const live = createStealthStream(fast);
    const a = live.launches(() => {});
    const b = live.allTokens(() => {});
    const ws = latest();
    ws.open();
    expect(ws.sent).toEqual([{ op: "sub", ch: "tokens" }]);
    a();
    expect(ws.sent).toHaveLength(1);
    b();
    b();
    expect(ws.sent).toEqual([{ op: "sub", ch: "tokens" }, { op: "unsub", ch: "tokens" }]);
    expect(live.channels).toEqual([]);
    live.close();
  });

  it("filters message types per helper", () => {
    const live = createStealthStream(fast);
    const seen: string[] = [];
    live.launches((m) => seen.push(`launch:${m.type}`));
    live.trades(null, (m) => seen.push(`trade:${m.type}`));
    live.candles(MINT, "1m", (m) => seen.push(`candle:${m.candle.close}`));
    live.heads((m) => seen.push(`head:${m.block}`));
    const ws = latest();
    ws.open();
    ws.push({ ch: "tokens", type: "launch", token: {} });
    ws.push({ ch: "tokens", type: "trade", trade: {}, token: {} });
    ws.push({ ch: "tokens", type: "token", token: {} });
    ws.push({ ch: candleChannel(MINT, "1m"), type: "candle", candle: { close: 2 } });
    ws.push({ ch: "head", type: "head", block: 99, timestamp: 0, indexed: 99, lag: 0, indexer: "online" });
    expect(seen).toEqual(["launch:launch", "trade:trade", "candle:2", "head:99"]);
    expect(live.head?.block).toBe(99);
    live.close();
  });

  it("reconnects with backoff, re-subscribes every channel and tells you", async () => {
    const live = createStealthStream(fast);
    const states: string[] = [];
    const reconnects: number[] = [];
    live.onStateChange((s) => states.push(s));
    live.onReconnect(() => reconnects.push(1));
    live.heads(() => {});
    live.trades(MINT, () => {});
    latest().open();
    latest().drop();
    expect(live.state).toBe("reconnecting");
    await tick();
    expect(FakeSocket.all).toHaveLength(2);
    latest().open();
    expect(latest().sent).toEqual([
      { op: "sub", ch: "head" },
      { op: "sub", ch: tokenChannel(MINT) },
    ]);
    expect(reconnects).toEqual([1]);
    expect(states).toContain("open");
    live.close();
    expect(live.state).toBe("closed");
  });

  it("keeps retrying when the constructor throws, and reports errors", async () => {
    const errors: string[] = [];
    FakeSocket.failNext = true;
    const live = createStealthStream(fast);
    live.onError((e) => errors.push(e.code));
    live.heads(() => {});
    await tick();
    expect(errors[0]).toBe("websocket_error");
    expect(FakeSocket.all.length).toBeGreaterThanOrEqual(1);
    live.close();
  });

  it("stops after maxAttempts", async () => {
    const live = createStealthStream({ ...fast, reconnect: { minDelayMs: 1, maxDelayMs: 1, maxAttempts: 1 } });
    live.heads(() => {});
    latest().drop();
    await tick();
    latest().drop();
    await tick();
    expect(live.state).toBe("closed");
  });

  it("a throwing handler doesn't stop the others", () => {
    const live = createStealthStream(fast);
    const seen: number[] = [];
    live.heads(() => {
      throw new Error("boom");
    });
    live.heads((m) => seen.push(m.block));
    latest().open();
    latest().push({ ch: "head", type: "head", block: 1 });
    expect(seen).toEqual([1]);
    live.close();
  });

  it("sends an application ping on its interval", async () => {
    const live = createStealthStream({ ...fast, pingMs: 5 });
    live.heads(() => {});
    latest().open();
    await tick(20);
    expect(latest().sent).toContainEqual({ op: "ping" });
    live.close();
  });

  it("reopens a socket that goes silent", async () => {
    const live = createStealthStream({ ...fast, idleTimeoutMs: 5 });
    live.heads(() => {});
    latest().open();
    await tick(30);
    expect(FakeSocket.all.length).toBeGreaterThan(1);
    live.close();
  });

  it("iterates a channel and unsubscribes when the loop ends", async () => {
    const live = createStealthStream(fast);
    const got: number[] = [];
    const loop = (async () => {
      for await (const m of live.iterate("head")) {
        got.push((m as { block: number }).block);
        if (got.length === 2) break;
      }
    })();
    const ws = latest();
    ws.open();
    ws.push({ ch: "head", type: "head", block: 1 });
    ws.push({ ch: "head", type: "head", block: 2 });
    await loop;
    expect(got).toEqual([1, 2]);
    expect(ws.sent).toContainEqual({ op: "unsub", ch: "head" });
    live.close();
  });

  it("ends an iterator when the stream closes", async () => {
    const live = createStealthStream(fast);
    const loop = (async () => {
      for await (const _ of live.iterate("head")) void _;
      return "done";
    })();
    await tick(1);
    live.close();
    await expect(loop).resolves.toBe("done");
  });

  it("says what to do without a WebSocket", () => {
    const g = globalThis as { WebSocket?: unknown };
    const saved = g.WebSocket;
    g.WebSocket = undefined;
    try {
      expect(() => createStealthStream()).toThrow(StealthUnsupportedError);
    } finally {
      g.WebSocket = saved;
    }
  });

  it("queues sends made before the socket opens", () => {
    const s = new ReconnectingSocket("ws://x", { onMessage: () => {} }, { WebSocket: FakeSocket });
    s.connect();
    s.send({ a: 1 });
    expect(latest().sent).toEqual([]);
    latest().open();
    expect(latest().sent).toEqual([{ a: 1 }]);
    s.close();
  });
});

describe("pollTrades", () => {
  it("reports only trades it hasn't seen, oldest first, after the first poll", async () => {
    let page = [{ id: "b" }, { id: "a" }];
    const read = vi.fn(async () => ({ items: page as never[] }));
    const got: string[] = [];
    const stop = pollTrades(read, "0xT", (t) => got.push(t.id), { intervalMs: 5 });
    await tick(2);
    page = [{ id: "d" }, { id: "c" }, { id: "b" }, { id: "a" }];
    await tick(15);
    stop();
    expect(got).toEqual(["c", "d"]);
  });

  it("passes errors to onError and keeps polling", async () => {
    let n = 0;
    const errors: unknown[] = [];
    const stop = pollTrades(
      async () => {
        if (++n === 1) throw new Error("down");
        return { items: [] };
      },
      "0xT",
      () => {},
      { intervalMs: 2, onError: (e) => errors.push(e) },
    );
    await tick(15);
    stop();
    expect(errors).toHaveLength(1);
    expect(n).toBeGreaterThan(1);
  });
});
