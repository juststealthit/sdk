import { ed25519 } from "@noble/curves/ed25519";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { createStealthSolana, fromBase64, keypairSigner, StealthInputError, StealthTransactionError, StealthTransactionMismatchError } from "../../src/solana/index.js";
import { fakeApi, reply, transferV0 } from "./helpers.js";

const MINT = "So11111111111111111111111111111111111111112";
const fast = { pollMs: 1, confirmTimeoutMs: 100, bundleTimeoutMs: 100, retry: false as const };
const setup = (routes: Parameters<typeof fakeApi>[0]) => {
  const kp = Keypair.generate();
  const api = fakeApi(routes);
  return { kp, ...api, sol: createStealthSolana({ signer: keypairSigner(kp), fetch: api.fetch, ...fast }) };
};
const quote = (more: object = {}) => ({ side: "buy", amountIn: "1000", amountOut: "5000", minAmountOut: "4850", priceImpactPct: 0.2, route: ["Raydium"], ...more });

/** A legacy transaction paid by `payer` that `cosigner` has already partly signed, as a prepared stake comes back. */
function cosigned(payer: Keypair, cosigner: Keypair) {
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: "GfVcyD4kkTrj4bKc7WA9sZCin9JDbdT4Zkd3EittNR1W" });
  tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: cosigner.publicKey, lamports: 1 }));
  tx.add(SystemProgram.transfer({ fromPubkey: cosigner.publicKey, toPubkey: payer.publicKey, lamports: 1 }));
  tx.partialSign(cosigner);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

describe("market trades through Jupiter", () => {
  it("builds on the API, signs the v0 transaction and sends it", async () => {
    let tx = "";
    const { kp, sol, calls } = setup({
      "POST /sol/market/swap": () => ({ transaction: tx, quote: quote(), lastValidBlockHeight: 1 }),
      "POST /sol/send": { signature: "SIG" },
      "GET /sol/tx/SIG": { status: "confirmed", error: null },
    });
    tx = transferV0(kp.publicKey, Keypair.generate().publicKey, 1n);
    const out = await sol.marketBuy({ mint: MINT, amount: 1_000n, slippageBps: 200 });
    expect(out).toMatchObject({ signature: "SIG", quote: { amountOut: "5000" } });
    expect(calls[0]!.body).toEqual({ mint: MINT, owner: kp.publicKey.toBase58(), side: "buy", amount: "1000", slippageBps: 200 });
    expect(calls[1]!.path).toBe("/sol/send");
  });

  it("sells too", async () => {
    let tx = "";
    const { kp, sol, calls } = setup({
      "POST /sol/market/swap": () => ({ transaction: tx, quote: quote({ side: "sell" }), lastValidBlockHeight: 1 }),
      "POST /sol/send": { signature: "S2" },
      "GET /sol/tx/S2": { status: "confirmed", error: null },
    });
    tx = transferV0(kp.publicKey, Keypair.generate().publicKey, 1n);
    await sol.marketSell({ mint: MINT, amount: 42n });
    expect((calls[0]!.body as { side: string }).side).toBe("sell");
  });

  it("refuses a route over maxPriceImpactPct, without signing", async () => {
    let tx = "";
    const { kp, sol, calls } = setup({ "POST /sol/market/swap": () => ({ transaction: tx, quote: quote({ priceImpactPct: 12 }), lastValidBlockHeight: 1 }) });
    tx = transferV0(kp.publicKey, Keypair.generate().publicKey, 1n);
    await expect(sol.marketBuy({ mint: MINT, amount: 1n, maxPriceImpactPct: 5 })).rejects.toBeInstanceOf(StealthInputError);
    expect(calls).toHaveLength(1);
  });

  it("refuses a swap that accepts nothing back", async () => {
    let tx = "";
    const { kp, sol } = setup({ "POST /sol/market/swap": () => ({ transaction: tx, quote: quote({ minAmountOut: "0" }), lastValidBlockHeight: 1 }) });
    tx = transferV0(kp.publicKey, Keypair.generate().publicKey, 1n);
    await expect(sol.marketBuy({ mint: MINT, amount: 1n })).rejects.toBeInstanceOf(StealthTransactionMismatchError);
  });

  it("refuses a swap paid by another wallet", async () => {
    const other = Keypair.generate();
    const { sol, calls } = setup({ "POST /sol/market/swap": { transaction: transferV0(other.publicKey, Keypair.generate().publicKey, 1n), quote: quote(), lastValidBlockHeight: 1 } });
    await expect(sol.marketBuy({ mint: MINT, amount: 1n })).rejects.toBeInstanceOf(StealthTransactionMismatchError);
    expect(calls.filter((c) => c.path === "/sol/send")).toHaveLength(0);
  });
});

describe("swap picks the route", () => {
  it("uses the coin's own venue when it says app", async () => {
    let tx = "";
    const { kp, sol, calls } = setup({
      [`GET /sol/tokens/${MINT}`]: { address: MINT, sol: { swapVia: "app" } },
      "POST /sol/swap": () => ({ transaction: tx, quote: { feeBps: 125 }, lastValidBlockHeight: 1 }),
      "POST /sol/send": { signature: "A" },
      "GET /sol/tx/A": { status: "confirmed", error: null },
    });
    tx = transferV0(kp.publicKey, Keypair.generate().publicKey, 1n);
    expect((await sol.swap({ mint: MINT, side: "buy", amount: 1n })).route).toBe("app");
    expect(calls.map((c) => c.path)).toContain("/sol/swap");
  });

  it("uses Jupiter for a coin the launchpad doesn't know", async () => {
    let tx = "";
    const { kp, sol } = setup({
      [`GET /sol/tokens/${MINT}`]: reply(404, { error: "not_found" }),
      "POST /sol/market/swap": () => ({ transaction: tx, quote: quote(), lastValidBlockHeight: 1 }),
      "POST /sol/send": { signature: "J" },
      "GET /sol/tx/J": { status: "confirmed", error: null },
    });
    tx = transferV0(kp.publicKey, Keypair.generate().publicKey, 1n);
    expect((await sol.swap({ mint: MINT, side: "buy", amount: 1n })).route).toBe("jupiter");
  });
});

describe("staking", () => {
  it("signs the co-signed stake as it came, keeping the staking wallet's signature, and submits it", async () => {
    const pool = Keypair.generate();
    let tx = "";
    const { kp, sol, calls } = setup({
      "POST /staking/stealth/stake": () => ({ actionId: 7, transaction: tx, depositLamports: 0, escrow: "E" }),
      "POST /staking/actions/7/submit": { signature: "STK", status: "confirmed" },
    });
    tx = cosigned(kp, pool);
    const out = await sol.stake(1_000_000n);
    expect(out).toEqual({ signature: "STK", status: "confirmed", actionId: 7 });
    expect(calls[0]!.body).toEqual({ owner: kp.publicKey.toBase58(), amount: "1000000" });
    const sent = Transaction.from(fromBase64((calls[1]!.body as { transaction: string }).transaction));
    const message = sent.serializeMessage();
    for (const key of [kp.publicKey, pool.publicKey]) {
      const sig = sent.signatures.find((s) => s.publicKey.equals(key))!.signature!;
      expect(ed25519.verify(sig, message, key.toBytes())).toBe(true);
    }
  });

  it("unstakes and says when it unlocks", async () => {
    const pool = Keypair.generate();
    let tx = "";
    const { kp, sol } = setup({
      "POST /staking/stealth/unstake": () => ({ actionId: 8, transaction: tx, unlockInSec: 21_600 }),
      "POST /staking/actions/8/submit": { signature: "U", status: "sent" },
    });
    tx = cosigned(kp, pool);
    expect(await sol.unstake(5n)).toEqual({ signature: "U", status: "sent", actionId: 8, unlockInSec: 21_600 });
  });

  it("refuses a staking transaction paid by someone else", async () => {
    const other = Keypair.generate();
    const { sol, calls } = setup({ "POST /staking/stealth/stake": { actionId: 1, transaction: cosigned(other, Keypair.generate()), depositLamports: 0, escrow: "E" } });
    await expect(sol.stake(1n)).rejects.toBeInstanceOf(StealthTransactionMismatchError);
    expect(calls).toHaveLength(1);
  });
});

describe("typed failures", () => {
  it("a failed transaction is a StealthTransactionError with its signature", async () => {
    let tx = "";
    const { kp, sol } = setup({
      "POST /sol/market/swap": () => ({ transaction: tx, quote: quote(), lastValidBlockHeight: 1 }),
      "POST /sol/send": { signature: "BAD" },
      "GET /sol/tx/BAD": { status: "failed", error: "{\"InstructionError\":[0,1]}" },
    });
    tx = transferV0(kp.publicKey, Keypair.generate().publicKey, 1n);
    const err = await sol.marketBuy({ mint: MINT, amount: 1n }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StealthTransactionError);
    expect(err).toMatchObject({ signature: "BAD", code: "transaction_failed" });
  });

  it("a confirmation timeout says so", async () => {
    let tx = "";
    const { kp, sol } = setup({
      "POST /sol/market/swap": () => ({ transaction: tx, quote: quote(), lastValidBlockHeight: 1 }),
      "POST /sol/send": { signature: "SLOW" },
      "GET /sol/tx/SLOW": { status: "pending", error: null },
    });
    tx = transferV0(kp.publicKey, Keypair.generate().publicKey, 1n);
    await expect(sol.marketBuy({ mint: MINT, amount: 1n })).rejects.toMatchObject({ code: "confirmation_timeout", signature: "SLOW" });
  });

  it("the typed reads hang off `data`", async () => {
    const { sol, calls } = setup({ [`GET /sol/tokens/${MINT}/holders`]: [{ address: "a", balance: 1, pctOfSupply: 1, valueUsd: 1 }] });
    expect((await sol.data.tokens.holders(MINT))[0]!.address).toBe("a");
    expect(calls[0]!.path).toBe(`/sol/tokens/${MINT}/holders`);
  });
});
