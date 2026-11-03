import { describe, expect, it } from "vitest";

import {
  addressFamily,
  base58Decode,
  chainById,
  CHAINS,
  checksumEvmAddress,
  comingSoonChains,
  explorerUrl,
  formatAge,
  formatBps,
  formatCompact,
  formatDuration,
  formatPercent,
  formatPrice,
  formatTokens,
  formatUnits,
  formatUsd,
  getChain,
  isAddressFor,
  isEvmAddress,
  isLiveChain,
  isSolanaAddress,
  lamportsToSol,
  listChains,
  liveChains,
  parseSubscriptPrice,
  parseUnits,
  sameAddress,
  shortAddress,
  solToLamports,
} from "../../src/utils/index.js";
import { base58Encode } from "../../src/solana/signer.js";
import { EVM_DEPLOYMENTS } from "../../src/evm/deployments.js";

describe("formatting", () => {
  it("writes tiny prices with a subscript zero count", () => {
    expect(formatPrice(0.00000123)).toBe("$0.0₅123");
    expect(formatPrice(0.0000000042, "")).toBe("0.0₈42");
    expect(formatPrice(0.0123)).toBe("$0.0123");
    expect(formatPrice(1.5)).toBe("$1.500");
    expect(formatPrice(150)).toBe("$150.00");
    expect(formatPrice(12_345)).toBe("$12.3K");
    expect(formatPrice(0)).toBe("$0");
    expect(formatPrice(-0.5)).toBe("−$0.5");
    expect(formatPrice(NaN)).toBe("—");
    expect(formatPrice(null, "$", { empty: "n/a" })).toBe("n/a");
  });

  it("reads a subscript price back", () => {
    expect(parseSubscriptPrice("$0.0₅123")).toBeCloseTo(0.00000123, 14);
    expect(parseSubscriptPrice("0.0₁₂5")).toBeCloseTo(5e-13, 20);
    expect(parseSubscriptPrice("1.25")).toBe(1.25);
    expect(parseSubscriptPrice(formatPrice(0.000000777, ""))).toBeCloseTo(0.000000777, 14);
  });

  it("writes dollars, compacts and percents", () => {
    expect(formatUsd(0.42)).toBe("$0.42");
    expect(formatUsd(0.001)).toBe("<$0.01");
    expect(formatUsd(1_234_567)).toBe("$1.23M");
    expect(formatUsd(-50, { minus: "-" })).toBe("-$50.0");
    expect(formatCompact(2.5e12)).toBe("2.5T");
    expect(formatCompact(999)).toBe("999");
    expect(formatPercent(12.34)).toBe("+12.3%");
    expect(formatPercent(-4.5)).toBe("−4.5%");
    expect(formatPercent(12_000)).toBe("+12K%");
    expect(formatPercent(3, { sign: false, digits: 2 })).toBe("3.00%");
    expect(formatBps(125)).toBe("1.25%");
    expect(formatBps(50)).toBe("0.5%");
    expect(formatBps(87.5)).toBe("0.875%");
    expect(formatTokens(12_300_000)).toBe("12.3M");
    expect(formatTokens(0.0042)).toBe("0.0042");
  });

  it("converts base units exactly", () => {
    expect(formatUnits(1_500_000n, 6)).toBe("1.5");
    expect(formatUnits("-1000000000", 9)).toBe("-1");
    expect(formatUnits(123_456_789n, 6, 2)).toBe("123.45");
    expect(formatUnits(5n, 0)).toBe("5");
    expect(parseUnits("1.5", 6)).toBe(1_500_000n);
    expect(parseUnits("-0.000001", 6)).toBe(-1n);
    expect(parseUnits(".5", 1)).toBe(5n);
    expect(() => parseUnits("1.0000001", 6)).toThrow(RangeError);
    expect(() => parseUnits("abc", 6)).toThrow(RangeError);
    expect(lamportsToSol(1_250_000_000n)).toBe("1.25");
    expect(solToLamports("0.01")).toBe(10_000_000n);
  });

  it("shortens addresses and writes ages and durations", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(shortAddress("So11111111111111111111111111111111111111112")).toBe("So11…1112");
    expect(shortAddress(null)).toBe("—");
    expect(formatAge(0, 8_000)).toBe("8s");
    expect(formatAge(0, 3 * 3_600_000)).toBe("3h");
    expect(formatAge(0, 90 * 86_400_000)).toBe("3mo");
    expect(formatDuration(5)).toBe("5s");
    expect(formatDuration(725)).toBe("12m 05s");
    expect(formatDuration(2 * 86_400 + 4 * 3_600 + 12 * 60)).toBe("2d 4h 12m");
  });
});

describe("addresses", () => {
  it("checks Solana addresses by decoding them", () => {
    expect(isSolanaAddress("So11111111111111111111111111111111111111112")).toBe(true);
    expect(isSolanaAddress("11111111111111111111111111111111")).toBe(true);
    expect(isSolanaAddress("So1111111111111111111111111111111111111111O")).toBe(false);
    expect(isSolanaAddress("0x1234")).toBe(false);
    expect(isSolanaAddress(42)).toBe(false);
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
  });

  it("checks EVM addresses, with the checksum when mixed case", () => {
    const factory = EVM_DEPLOYMENTS.base.factory;
    expect(isEvmAddress(factory)).toBe(true);
    expect(isEvmAddress(factory.toLowerCase())).toBe(true);
    const bad = factory.slice(0, -1) + (factory.endsWith("d") ? "D" : "d");
    expect(isEvmAddress(bad)).toBe(false);
    expect(checksumEvmAddress(factory.toLowerCase())).toBe(factory);
    expect(() => checksumEvmAddress("0x12")).toThrow(RangeError);
  });

  it("tells the families apart and compares addresses", () => {
    expect(addressFamily("So11111111111111111111111111111111111111112")).toBe("svm");
    expect(addressFamily(EVM_DEPLOYMENTS.bnb.router)).toBe("evm");
    expect(addressFamily("hello")).toBeNull();
    expect(sameAddress("0xAbC", "0xabc")).toBe(true);
    expect(sameAddress("Abc", "abc")).toBe(false);
    expect(isAddressFor("solana", "So11111111111111111111111111111111111111112")).toBe(true);
    expect(isAddressFor("base", "So11111111111111111111111111111111111111112")).toBe(false);
  });
});

describe("chain registry", () => {
  it("agrees with the EVM deployments", () => {
    for (const d of Object.values(EVM_DEPLOYMENTS)) {
      const c = getChain(d.key)!;
      expect(c.chainId).toBe(d.chainId);
      expect(c.native).toBe(d.native);
      expect(c.status).toBe("live");
      expect(chainById(d.chainId)?.key).toBe(d.key);
    }
  });

  it("marks announced chains as coming soon, after the live ones", () => {
    expect(comingSoonChains().map((c) => c.key)).toEqual(["avalanche", "arbitrum", "xlayer"]);
    expect(liveChains().map((c) => c.key)).toEqual(["solana", "robinhood", "bnb", "hyperevm", "base", "arc"]);
    expect(listChains().at(-1)!.status).toBe("coming_soon");
    expect(isLiveChain("arbitrum")).toBe(false);
    expect(isLiveChain("base")).toBe(true);
    expect(Object.keys(CHAINS)).toHaveLength(9);
  });

  it("builds explorer links", () => {
    expect(explorerUrl("base", "tx", "0xabc")).toBe("https://basescan.org/tx/0xabc");
    expect(explorerUrl("solana", "address", "W")).toBe("https://solscan.io/account/W");
    expect(explorerUrl("solana", "token", "M")).toBe("https://solscan.io/token/M");
    expect(explorerUrl("xlayer", "tx", "0x1")).toBeNull();
  });
});
