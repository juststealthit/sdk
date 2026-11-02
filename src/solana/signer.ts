import { ed25519 } from "@noble/curves/ed25519";
import { Transaction, VersionedTransaction, type Keypair, type PublicKey } from "@solana/web3.js";

export type AnyTransaction = Transaction | VersionedTransaction;

/** A wallet. The shape matches Solana wallet adapters, so one can be passed as it is. */
export interface SolanaSigner {
  publicKey: PublicKey;
  signTransaction<T extends AnyTransaction>(tx: T): Promise<T>;
  signAllTransactions?<T extends AnyTransaction>(txs: T[]): Promise<T[]>;
  /** Only a multi-chain sign-in needs this. */
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
}

/** A signer from a keypair held in this process. A signature the API already added, like a launch's mint, stays. */
export function keypairSigner(keypair: Keypair): SolanaSigner {
  const sign = <T extends AnyTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([keypair]);
    else tx.partialSign(keypair);
    return tx;
  };
  return {
    publicKey: keypair.publicKey,
    signTransaction: async (tx) => sign(tx),
    signAllTransactions: async (txs) => txs.map(sign),
    signMessage: async (message) => ed25519.sign(message, keypair.secretKey.slice(0, 32)),
  };
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)]! + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Legacy or v0, from the wire format: the swap route doesn't say which it built. Signatures come first, then the message's first byte. */
export function decodeTransaction(base64: string): AnyTransaction {
  const raw = fromBase64(base64);
  let count = 0;
  let at = 0;
  for (let shift = 0; ; shift += 7) {
    const byte = raw[at++] ?? 0;
    count |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
  }
  const first = raw[at + count * 64] ?? 0;
  return first & 0x80 ? VersionedTransaction.deserialize(raw) : Transaction.from(raw);
}

export const encodeTransaction = (tx: AnyTransaction) => toBase64(tx instanceof VersionedTransaction ? tx.serialize() : tx.serialize({ requireAllSignatures: true, verifySignatures: false }));

export const feePayerOf = (tx: AnyTransaction): PublicKey | null => (tx instanceof VersionedTransaction ? (tx.message.staticAccountKeys[0] ?? null) : (tx.feePayer ?? null));
