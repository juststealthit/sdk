import { ed25519 } from "@noble/curves/ed25519";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { createWalletClient, custom, verifyMessage, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { createStealthMultichain, evmMcWallet, solanaMcWallet, StealthTransactionMismatchError } from "../../src/multichain/index.js";
import { EVM_CHAINS } from "../../src/evm/index.js";
import { base58Encode, createStealthSolana, fromBase64, keypairSigner } from "../../src/solana/index.js";
import { fakeApi, reply, transferV0 } from "./helpers.js";

const session = (wallet: string, vm: string) => ({
  "POST /multichain/session/nonce": { nonce: "a".repeat(32), message: "Sign in to Just Stealth It", expiresAt: 1 },
  "POST /multichain/session": reply(200, { wallet, vm }, [["set-cookie", "fp_multichain=tok; Path=/api; HttpOnly; Secure; SameSite=Lax"]]),
});

describe("sign-in", () => {
  it("proves a Solana wallet, then carries the cookie", async () => {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const { fetch, calls } = fakeApi({ ...session(wallet, "svm"), "POST /multichain/simulate": { quoteId: "q" } });
    const sol = createStealthSolana({ signer: keypairSigner(kp), fetch });
    const mc = createStealthMultichain({ fetch });
    await expect(mc.signIn(solanaMcWallet(sol))).resolves.toEqual({ wallet, vm: "svm" });
    const body = calls[1]!.body as { signature: string; nonce: string; wallet: string };
    expect(body).toMatchObject({ wallet, nonce: "a".repeat(32) });
    const sigBytes = body.signature;
    const raw = await keypairSigner(kp).signMessage!(new TextEncoder().encode("Sign in to Just Stealth It"));
    expect(sigBytes).toBe(base58Encode(raw));
    expect(ed25519.verify(raw, new TextEncoder().encode("Sign in to Just Stealth It"), kp.publicKey.toBytes())).toBe(true);
    await mc.simulate({ home: "solana", name: "A", symbol: "A" });
    expect(calls[2]!.cookie).toBe("fp_multichain=tok");
  });

  it("proves an EVM wallet", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { fetch, calls } = fakeApi(session(account.address, "evm"));
    const wallet = createWalletClient({ account, chain: EVM_CHAINS.base, transport: custom({ request: async () => null }) });
    await createStealthMultichain({ fetch }).signIn(evmMcWallet(wallet));
    const body = calls[1]!.body as { signature: `0x${string}` };
    expect(await verifyMessage({ address: account.address, message: "Sign in to Just Stealth It", signature: body.signature })).toBe(true);
  });
});

describe("simulate", () => {
  it("sends amounts as the API wants them", async () => {
    const { fetch, calls } = fakeApi({ "POST /multichain/simulate": { quoteId: "q" } });
    await createStealthMultichain({ fetch }).simulate({ home: "base", chains: ["base", "bnb"], name: "A", symbol: "A", devBuys: { base: 5n, bnb: 7n }, feeMode: "creator" });
    expect(calls[0]!.body).toEqual({ home: "base", chains: ["base", "bnb"], name: "A", symbol: "A", feeMode: "creator", description: "", logo: "", socials: {}, devBuyRaw: "0", devBuys: { base: "5", bnb: "7" } });
  });
});

describe("paying", () => {
  const payer = Keypair.generate();
  const deposit = Keypair.generate().publicKey;
  const pay = (tx: string, to = deposit.toBase58(), amount = "1000") => ({ chain: "solana" as const, to, amount, transaction: tx });
  const client = (routes: Parameters<typeof fakeApi>[0]) => {
    const api = fakeApi(routes);
    return { ...api, sol: createStealthSolana({ signer: keypairSigner(payer), fetch: api.fetch, pollMs: 1 }), mc: createStealthMultichain({ fetch: api.fetch }) };
  };

  it("pays exactly the simulated transfer", async () => {
    const { sol, mc, calls } = client({ "POST /sol/send": { signature: "PAY" }, "GET /sol/tx/PAY": { status: "confirmed", error: null } });
    await expect(mc.paySolana(sol, pay(transferV0(payer.publicKey, deposit, 1000n)), "1000")).resolves.toBe("PAY");
    const sent = VersionedTransaction.deserialize(fromBase64((calls[0]!.body as { transaction: string }).transaction));
    expect(ed25519.verify(sent.signatures[0]!, sent.message.serialize(), payer.publicKey.toBytes())).toBe(true);
  });

  it.each([
    ["an amount above the simulation", () => pay(transferV0(payer.publicKey, deposit, 1000n), undefined, "2000"), "1000"],
    ["a transfer bigger than it says", () => pay(transferV0(payer.publicKey, deposit, 9000n)), "1000"],
    ["a transfer to somewhere else", () => pay(transferV0(payer.publicKey, Keypair.generate().publicKey, 1000n)), "1000"],
    ["a second transfer tucked in", () => pay(transferV0(payer.publicKey, deposit, 1000n, [{ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 5n }])), "1000"],
    ["a transaction another wallet pays", () => pay(transferV0(Keypair.generate().publicKey, deposit, 1000n)), "1000"],
  ])("refuses %s, and sends nothing", async (_name, payment, total) => {
    const { sol, mc, calls } = client({});
    await expect(mc.paySolana(sol, payment(), total)).rejects.toBeInstanceOf(StealthTransactionMismatchError);
    expect(calls).toHaveLength(0);
  });

  it("pays an EVM order as a plain transfer on its chain", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const seen: { method: string; params: unknown }[] = [];
    const wallet = createWalletClient({
      account,
      chain: EVM_CHAINS.base,
      transport: custom({
        request: async ({ method, params }) => {
          seen.push({ method, params });
          if (method === "eth_chainId") return "0x2105";
          if (method === "eth_getTransactionCount") return "0x0";
          if (method === "eth_estimateGas") return "0x5208";
          if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") return "0x1";
          if (method === "eth_getBlockByNumber") return { baseFeePerGas: "0x1", number: "0x1", timestamp: "0x1" };
          if (method === "eth_sendRawTransaction") return `0x${"ab".repeat(32)}`;
          return null;
        },
      }),
    });
    const { mc } = client({});
    const to = "0x000000000000000000000000000000000000dEaD" as Address;
    await expect(mc.payEvm(wallet, { chain: "base", chainId: 8453, to, amount: "1000" }, "1000")).resolves.toBe(`0x${"ab".repeat(32)}`);
    expect(seen.some((s) => s.method === "eth_sendRawTransaction")).toBe(true);
    await expect(mc.payEvm(wallet, { chain: "base", chainId: 8453, to, amount: "2000" }, "1000")).rejects.toBeInstanceOf(StealthTransactionMismatchError);
  });
});

describe("following an order", () => {
  it("polls until it ends", async () => {
    const statuses = ["quoted", "running", "partial"];
    const { fetch } = fakeApi({ "GET /multichain/orders/x": () => ({ id: "x", status: statuses.shift(), legs: [] }) });
    const seen: string[] = [];
    const out = await createStealthMultichain({ fetch, pollMs: 1 }).waitForOrder("x", { onUpdate: (o) => seen.push(o.status) });
    expect(out.status).toBe("partial");
    expect(seen).toEqual(["quoted", "running", "partial"]);
  });
});
