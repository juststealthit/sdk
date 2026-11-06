/**
 * Address checks per chain family. They check the format only, not that anything lives at the address.
 *
 * @module
 */
import { getAddress, isAddress } from "viem";

import { base58Decode, isSolanaAddress } from "./base58.js";

export { base58Decode, isSolanaAddress };

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
