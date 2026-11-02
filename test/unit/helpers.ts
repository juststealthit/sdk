import { Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

export interface Call {
  method: string;
  path: string;
  body: unknown;
  cookie: string | null;
}

type Reply = unknown | ((call: Call) => unknown);
export const reply = (status: number, body: unknown, headers: [string, string][] = []) => ({ __reply: true, status, body, headers });

/** A stand-in for the API over `fetch`: answers by `METHOD /path`, keeps every call, refuses anything it wasn't told about. */
export function fakeApi(routes: Record<string, Reply>) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, "");
    const method = init?.method ?? "GET";
    const call: Call = { method, path: path + url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined, cookie: new Headers(init?.headers).get("cookie") };
    calls.push(call);
    const route = routes[`${method} ${path}`];
    if (route === undefined) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    const out = typeof route === "function" ? (route as (c: Call) => unknown)(call) : route;
    const r = (out && typeof out === "object" && "__reply" in out ? out : { status: 200, body: out, headers: [] }) as { status: number; body: unknown; headers: [string, string][] };
    const headers = new Headers();
    for (const [k, v] of r.headers) headers.append(k, v);
    return new Response(JSON.stringify(r.body), { status: r.status, headers });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const BLOCKHASH = "GfVcyD4kkTrj4bKc7WA9sZCin9JDbdT4Zkd3EittNR1W";

/** A v0 transaction paid by `payer` that `mint` has already signed, as a launch comes back from the API. */
export function launchTx(payer: PublicKey, mint: Keypair) {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: mint.publicKey, lamports: 1, space: 0, programId: SystemProgram.programId })],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([mint]);
  return Buffer.from(tx.serialize()).toString("base64");
}

/** An unsigned v0 transfer, optionally with other instructions. */
export function transferV0(from: PublicKey, to: PublicKey, lamports: bigint, extra: Parameters<typeof SystemProgram.transfer>[0][] = []) {
  const message = new TransactionMessage({ payerKey: from, recentBlockhash: BLOCKHASH, instructions: [SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }), ...extra.map((e) => SystemProgram.transfer(e))] }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

/** An unsigned legacy transaction, as a Raydium swap comes back. */
export function transferLegacy(from: PublicKey, to: PublicKey, lamports: bigint) {
  const tx = new Transaction({ feePayer: from, recentBlockhash: BLOCKHASH }).add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}
