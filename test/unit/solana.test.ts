import { ed25519 } from "@noble/curves/ed25519";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  base58Encode,
  checkSolanaLaunch,
  createStealthSolana,
  decodeTransaction,
  fromBase64,
  keypairSigner,
  StealthApiError,
  StealthFeeTooHighError,
  StealthInputError,
  StealthTransactionMismatchError,
} from "../../src/solana/index.js";
import { fakeApi, launchTx, reply, transferLegacy, transferV0 } from "./helpers.js";

const fast = { pollMs: 1, confirmTimeoutMs: 200, bundleTimeoutMs: 300 };
const setup = (routes: Parameters<typeof fakeApi>[0]) => {
  const kp = Keypair.generate();
  const api = fakeApi(routes);
  return { kp, ...api, sol: createStealthSolana({ signer: keypairSigner(kp), fetch: api.fetch, ...fast }) };
};
const prepared = (tx: string, more: object = {}) => ({ mint: "M", pool: "P", escrow: "E", transaction: tx, version: "v0", lastValidBlockHeight: 1, firstBuyTokens: "0", metadataUri: "u", feeMode: "creator", venue: "pump", taxTier: null, ...more });
const sentTx = (body: unknown) => VersionedTransaction.deserialize(fromBase64((body as { transaction: string }).transaction));

describe("launch", () => {
  it("builds on the API, keeps the mint's signature, adds the wallet's and sends it", async () => {
    const mint = Keypair.generate();
    let tx = "";
    const { kp, sol, calls } = setup({
      "POST /sol/launch": () => prepared(tx),
      "POST /sol/send": { signature: "SIG" },
      "GET /sol/tx/SIG": { status: "confirmed", error: null },
    });
    tx = launchTx(kp.publicKey, mint);
    const out = await sol.launch({ name: " Stealth ", symbol: "STLH", venue: "meteora", taxTier: "m100", firstBuyLamports: 1_000_000_000n, socials: { website: "https://juststealthit.xyz" } });
    expect(out).toMatchObject({ mint: "M", pool: "P", escrow: "E", signatures: ["SIG"] });

    const launch = calls[0]!;
    expect(launch.path).toBe("/sol/launch");
    expect(launch.body).toEqual({
      venue: "meteora",
      taxTier: "m100",
      name: "Stealth",
      symbol: "STLH",
      description: "",
      logo: "",
      socials: { website: "https://juststealthit.xyz" },
      firstBuyLamports: "1000000000",
      launcher: kp.publicKey.toBase58(),
      recipient: { kind: "wallet", wallet: kp.publicKey.toBase58() },
    });

    const sent = sentTx(calls[1]!.body);
    const message = sent.message.serialize();
    const keys = sent.message.staticAccountKeys;
    expect(sent.signatures).toHaveLength(2);
    expect(ed25519.verify(sent.signatures[keys.findIndex((k) => k.equals(kp.publicKey))]!, message, kp.publicKey.toBytes())).toBe(true);
    expect(ed25519.verify(sent.signatures[keys.findIndex((k) => k.equals(mint.publicKey))]!, message, mint.publicKey.toBytes())).toBe(true);
  });

  it("sends follow-ups one at a time, each after the last confirms", async () => {
    const mint = Keypair.generate();
    let tx = "";
    let n = 0;
    const order: string[] = [];
    const { kp, sol, calls } = setup({
      "POST /sol/launch": () => prepared(tx, { followUps: [{ transaction: tx2, version: "v0" }] }),
      "POST /sol/send": () => ({ signature: `S${++n}` }),
      "GET /sol/tx/S1": () => (order.push("confirm1"), { status: "confirmed", error: null }),
      "GET /sol/tx/S2": () => (order.push("confirm2"), { status: "confirmed", error: null }),
    });
    tx = launchTx(kp.publicKey, mint);
    const tx2 = transferV0(kp.publicKey, Keypair.generate().publicKey, 5n);
    const out = await sol.launch({ name: "A", symbol: "A" });
    expect(out.signatures).toEqual(["S1", "S2"]);
    expect(order).toEqual(["confirm1", "confirm2"]);
    expect(calls.filter((c) => c.path === "/sol/send")).toHaveLength(2);
  });

  it("sends a bundle whole, and resends nothing once it confirms", async () => {
    const mint = Keypair.generate();
    let tx = "";
    const { kp, sol, calls } = setup({
      "POST /sol/launch": () => prepared(tx, { bundle: true, followUps: [{ transaction: tx2, version: "v0" }] }),
      "POST /sol/send-bundle": { bundleId: "ab".repeat(32), signatures: ["B1", "B2"] },
      "GET /sol/tx/B1": { status: "confirmed", error: null },
      "GET /sol/tx/B2": { status: "confirmed", error: null },
    });
    tx = launchTx(kp.publicKey, mint);
    const tx2 = transferV0(kp.publicKey, Keypair.generate().publicKey, 5n);
    const out = await sol.launch({ name: "A", symbol: "A" });
    expect(out.signatures).toEqual(["B1", "B2"]);
    const bundle = calls.filter((c) => c.path === "/sol/send-bundle");
    expect(bundle).toHaveLength(1);
    expect((bundle[0]!.body as { transactions: string[] }).transactions).toHaveLength(2);
    expect(calls.some((c) => c.path === "/sol/send")).toBe(false);
  });

  it("stops at a bundle the API refuses", async () => {
    const mint = Keypair.generate();
    let tx = "";
    const { kp, sol } = setup({
      "POST /sol/launch": () => prepared(tx, { bundle: true, followUps: [{ transaction: tx2, version: "v0" }] }),
      "POST /sol/send-bundle": reply(400, { error: "no_tip", message: "The last transaction must tip Jito." }),
    });
    tx = launchTx(kp.publicKey, mint);
    const tx2 = transferV0(kp.publicKey, Keypair.generate().publicKey, 5n);
    await expect(sol.launch({ name: "A", symbol: "A" })).rejects.toMatchObject({ code: "no_tip" });
  });

  it("won't sign a transaction another wallet pays for", async () => {
    const someoneElse = Keypair.generate();
    const { sol, calls } = setup({ "POST /sol/launch": () => prepared(launchTx(someoneElse.publicKey, Keypair.generate())) });
    await expect(sol.launch({ name: "A", symbol: "A" })).rejects.toBeInstanceOf(StealthTransactionMismatchError);
    expect(calls.some((c) => c.path === "/sol/send")).toBe(false);
  });

  it("reports a transaction that failed on chain", async () => {
    const { kp, sol } = setup({
      "POST /sol/send": { signature: "F" },
      "GET /sol/tx/F": { status: "failed", error: "custom program error" },
    });
    await expect(sol.submit([{ transaction: transferV0(kp.publicKey, Keypair.generate().publicKey, 1n), version: "v0" }])).rejects.toThrow(/custom program error/);
  });

  it("says a slow transaction may still land", async () => {
    const { kp, sol } = setup({ "POST /sol/send": { signature: "P" }, "GET /sol/tx/P": { status: "pending", error: null } });
    await expect(sol.submit([{ transaction: transferV0(kp.publicKey, Keypair.generate().publicKey, 1n), version: "v0" }])).rejects.toThrow(/may still land/);
  });

  it("passes the API's refusal through", async () => {
    const { sol } = setup({ "POST /sol/launch": reply(503, { error: "social_off", message: "Fees to a social account aren't available on this server." }) });
    await expect(sol.launch({ name: "A", symbol: "A", feeMode: "social", recipient: { kind: "social", provider: "x", handle: "a" } })).rejects.toBeInstanceOf(StealthApiError);
  });
});

describe("launch input", () => {
  const ok = { name: "A", symbol: "A" };
  it.each([
    ["a long name", { name: "x".repeat(33), symbol: "A" }, /name/],
    ["a long symbol", { name: "A", symbol: "x".repeat(11) }, /symbol/],
    ["a short team", { ...ok, feeMode: "team" as const, team: [{ wallet: "w", bps: 10_000 }] }, /team/i],
    ["team shares that don't add up", { ...ok, feeMode: "team" as const, team: [{ wallet: "a", bps: 1 }, { wallet: "b", bps: 1 }] }, /10,000/],
    ["a wallet launch with no payout", { ...ok, feeMode: "wallet" as const }, /payout/],
    ["a payout on another type", { ...ok, payout: { chainId: 1, address: "0x" } }, /payout/],
    ["Feed a Coin with no coin", { ...ok, feeMode: "feed" as const }, /feed/],
    ["a social launch with no account", { ...ok, feeMode: "social" as const }, /social/],
    ["a Mix of one", { ...ok, feeMode: "mix" as const, mix: [{ kind: "creator" as const, bps: 10_000 }] }, /Mix/],
    ["a repeated slice", { ...ok, feeMode: "mix" as const, mix: [{ kind: "creator" as const, bps: 5_000 }, { kind: "creator" as const, bps: 5_000 }] }, /once/],
    ["a dust slice", { ...ok, feeMode: "mix" as const, mix: [{ kind: "creator" as const, bps: 9_950 }, { kind: "holders" as const, bps: 50 }] }, /at least/],
    ["slices that don't add up", { ...ok, feeMode: "mix" as const, mix: [{ kind: "creator" as const, bps: 5_000 }, { kind: "holders" as const, bps: 4_000 }] }, /10,000/],
    ["Jackpot", { ...ok, feeMode: "jackpot" as never }, /jackpot/],
  ])("refuses %s", (_name, input, match) => {
    expect(() => checkSolanaLaunch(input)).toThrow(StealthInputError);
    expect(() => checkSolanaLaunch(input)).toThrow(match);
  });

  it("takes a good Mix", () => {
    expect(() => checkSolanaLaunch({ ...ok, feeMode: "mix", mix: [{ kind: "buyback", bps: 6_000 }, { kind: "holders", bps: 4_000 }] })).not.toThrow();
  });

  it("needs a signer to launch, not to read", async () => {
    const { fetch } = fakeApi({ "GET /sol/config": { venues: [], feeModes: [] } });
    const sol = createStealthSolana({ fetch });
    await expect(sol.getConfig()).resolves.toMatchObject({ venues: [] });
    await expect(sol.launch({ name: "A", symbol: "A" })).rejects.toThrow(/signer/);
  });
});

describe("trades", () => {
  const quote = (feeBps: number) => ({ venue: "curve", side: "buy", amountIn: "1", amountOut: "2", minAmountOut: "1", feeLamports: "0", feeBps, priceImpactPct: null });

  it("signs a legacy swap, which the API doesn't label", async () => {
    let tx = "";
    const { kp, sol, calls } = setup({
      "POST /sol/swap": () => ({ transaction: tx, quote: quote(125), lastValidBlockHeight: 1 }),
      "POST /sol/send": { signature: "T" },
      "GET /sol/tx/T": { status: "confirmed", error: null },
    });
    tx = transferLegacy(kp.publicKey, Keypair.generate().publicKey, 9n);
    const out = await sol.buy({ mint: "M", amount: 1_000n });
    expect(out.signature).toBe("T");
    expect(calls[0]!.body).toEqual({ mint: "M", owner: kp.publicKey.toBase58(), side: "buy", amount: "1000", slippageBps: 300 });
    const sent = Transaction.from(fromBase64((calls[1]!.body as { transaction: string }).transaction));
    expect(sent.verifySignatures()).toBe(true);
  });

  it("refuses a sniper-window fee, and sends nothing", async () => {
    let tx = "";
    const { kp, sol, calls } = setup({ "POST /sol/swap": () => ({ transaction: tx, quote: quote(8_000), lastValidBlockHeight: 1 }) });
    tx = transferV0(kp.publicKey, Keypair.generate().publicKey, 1n);
    await expect(sol.sell({ mint: "M", amount: 1n })).rejects.toBeInstanceOf(StealthFeeTooHighError);
    expect(calls.map((c) => c.path)).toEqual(["/sol/swap"]);
  });

  it("takes that fee when asked to", async () => {
    let tx = "";
    const { kp, sol } = setup({
      "POST /sol/swap": () => ({ transaction: tx, quote: quote(8_000), lastValidBlockHeight: 1 }),
      "POST /sol/send": { signature: "T" },
      "GET /sol/tx/T": { status: "confirmed", error: null },
    });
    tx = transferV0(kp.publicKey, Keypair.generate().publicKey, 1n);
    await expect(sol.buy({ mint: "M", amount: 1n, maxFeeBps: 9_000 })).resolves.toMatchObject({ signature: "T" });
  });

  it("sends and confirms through your own RPC when given one", async () => {
    const seen: string[] = [];
    const connection = {
      sendEncodedTransaction: async (t: string) => (seen.push(t), "RPCSIG"),
      getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
    };
    const kp = Keypair.generate();
    const { fetch, calls } = fakeApi({});
    const sol = createStealthSolana({ signer: keypairSigner(kp), fetch, connection: connection as never, ...fast });
    const out = await sol.submit([{ transaction: transferV0(kp.publicKey, Keypair.generate().publicKey, 1n), version: "v0" }]);
    expect(out).toEqual(["RPCSIG"]);
    expect(seen).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });
});

describe("wire helpers", () => {
  it("tells v0 from legacy by the bytes", () => {
    const a = Keypair.generate().publicKey;
    const b = Keypair.generate().publicKey;
    expect(decodeTransaction(transferV0(a, b, 1n))).toBeInstanceOf(VersionedTransaction);
    expect(decodeTransaction(transferLegacy(a, b, 1n))).toBeInstanceOf(Transaction);
  });

  it("encodes base58 like Solana does", () => {
    const k = new PublicKey("11111111111111111111111111111111");
    expect(base58Encode(k.toBytes())).toBe("11111111111111111111111111111111");
    const kp = Keypair.generate();
    expect(base58Encode(kp.publicKey.toBytes())).toBe(kp.publicKey.toBase58());
  });

  it("signs messages a wallet would", async () => {
    const kp = Keypair.generate();
    const msg = new TextEncoder().encode("Just Stealth It");
    const sig = await keypairSigner(kp).signMessage!(msg);
    expect(ed25519.verify(sig, msg, kp.publicKey.toBytes())).toBe(true);
  });
});
