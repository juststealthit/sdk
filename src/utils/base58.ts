/**
 * Base58 and the Solana address check, with no dependencies, so light modules (the keystore's file helpers) can use them without
 * loading viem.
 *
 * @module
 */

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP = new Map([...BASE58].map((c, i) => [c, i] as const));

/** Decodes base58 (Bitcoin alphabet). Throws on a character outside it. */
export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const v = BASE58_MAP.get(c);
    if (v === undefined) throw new RangeError(`"${c}" isn't base58.`);
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** A Solana address: base58 that decodes to exactly 32 bytes. Wallets, mints and program ids all pass. */
export function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  try {
    return base58Decode(value).length === 32;
  } catch {
    return false;
  }
}
