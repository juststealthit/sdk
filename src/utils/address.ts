/**
 * Address checks per chain family. They check the format only, not that anything lives at the address.
 *
 * @module
 */
import { getAddress, isAddress } from "viem";

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

/** An EVM address: 0x and 40 hex digits. Mixed case must be a valid EIP-55 checksum; all-lower or all-upper passes. */
export function isEvmAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && isAddress(value, { strict: true });
}

/** An EVM address in its EIP-55 checksum form. Throws on an invalid one. */
export function checksumEvmAddress(value: string): `0x${string}` {
  if (!isEvmAddress(value)) throw new RangeError(`${value} isn't an EVM address.`);
  return getAddress(value);
}

/** Which family an address belongs to, or `null`. */
export function addressFamily(value: unknown): "svm" | "evm" | null {
  if (isEvmAddress(value)) return "evm";
  if (isSolanaAddress(value)) return "svm";
  return null;
}

/** Whether two addresses are the same: EVM case-insensitively, Solana exactly. */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.startsWith("0x") && b.startsWith("0x")) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/** Whether `address` fits a chain key: `solana` takes base58, every other known chain an EVM address. */
export function isAddressFor(chain: string, address: unknown): boolean {
  return chain === "solana" ? isSolanaAddress(address) : isEvmAddress(address);
}
