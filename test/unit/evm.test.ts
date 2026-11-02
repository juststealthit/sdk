import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";

import {
  abisFor,
  checkLaunchInput,
  createStealthEvm,
  EVM_CHAINS,
  EVM_COIN_SHARE_BPS,
  EVM_DEPLOYMENTS,
  EVM_LAUNCH_TYPES,
  EVM_TAX_TIERS,
  firstBuyAllowance,
  infinityAbis,
  quoterAbiFor,
  StealthInputError,
  v4Abis,
  type EvmChainKey,
} from "../../src/evm/index.js";

const ok = { name: "Stealth", symbol: "STLH" };
const A = "0x0000000000000000000000000000000000000001" as Address;
const B = "0x0000000000000000000000000000000000000002" as Address;

describe("deployments", () => {
  it("covers the five chains, with checksummed addresses", () => {
    expect(Object.keys(EVM_DEPLOYMENTS).sort()).toEqual(["arc", "base", "bnb", "hyperevm", "robinhood"]);
    for (const d of Object.values(EVM_DEPLOYMENTS)) {
      for (const k of ["factory", "router", "feeVault", "hook", "locker", "tokenDeployer", "tokenImplementation", "poolManager", "settlement", "quoter"] as const) expect(getAddress(d[k])).toBe(d[k]);
      expect(EVM_CHAINS[d.key].id).toBe(d.chainId);
    }
  });

  it("knows the chains that differ", () => {
    const { bnb, hyperevm, base, robinhood, arc } = EVM_DEPLOYMENTS;
    expect(bnb.dex).toBe("infinity");
    expect(bnb.settlement).not.toBe(bnb.poolManager);
    expect(base.settlement).toBe(base.poolManager);
    expect(hyperevm.factory).not.toBe(base.factory);
    expect(new Set([base.hook, bnb.hook, hyperevm.hook, robinhood.hook]).size).toBe(4);
    expect(arc.native).toBe("USDC");
    expect(EVM_CHAINS.arc.nativeCurrency.decimals).toBe(18);
  });

  it("picks ABIs by build: the pool keys have different fields", () => {
    expect(abisFor("v4")).toBe(v4Abis);
    expect(abisFor("infinity")).toBe(infinityAbis);
    const keyOf = (abi: readonly { type: string; name?: string }[]) => JSON.stringify(abi.find((f) => f.name === "swap"));
    expect(keyOf(v4Abis.stealthRouterAbi)).toContain("tickSpacing");
    expect(keyOf(infinityAbis.stealthRouterAbi)).toContain("parameters");
    expect(JSON.stringify(quoterAbiFor("v4"))).toContain("tickSpacing");
    expect(JSON.stringify(quoterAbiFor("infinity"))).toContain("parameters");
  });

  it("refuses a chain it doesn't know", () => {
    expect(() => createStealthEvm({ chain: "ethereum" as EvmChainKey })).toThrow(/Unknown chain/);
  });

  it("needs a wallet to write, not to read", async () => {
    await expect(createStealthEvm({ chain: "base" }).claim(A)).rejects.toThrow(/walletClient/);
  });
});

describe("fee model", () => {
  it("has the five tiers, and 70% of each to the coin", () => {
    expect(EVM_TAX_TIERS).toEqual([125, 225, 325, 425, 575]);
    expect(EVM_TAX_TIERS.map((t) => (t * EVM_COIN_SHARE_BPS) / 10_000)).toEqual([87.5, 157.5, 227.5, 297.5, 402.5]);
  });

  it("keeps the on-chain order of launch types", () => {
    expect(EVM_LAUNCH_TYPES).toEqual(["creator", "team", "marketing", "holders", "buyback", "pot"]);
  });
});

describe("first buy cap", () => {
  const M = 10n ** 24n;
  it("is 5% of supply by default", () => expect(firstBuyAllowance()).toBe(50n * M));
  it("drops to a max wallet", () => expect(firstBuyAllowance(100)).toBe(10n * M));
  it("drops to a max buy", () => expect(firstBuyAllowance(100, 50)).toBe(5n * M));
  it("isn't raised by a limit above 5%", () => expect(firstBuyAllowance(500, 500)).toBe(50n * M));
});

describe("launch input", () => {
  it.each([
    ["no name", { name: "", symbol: "A" }, /name/],
    ["a name over 64 bytes, in bytes", { name: "é".repeat(33), symbol: "A" }, /name/],
    ["a long symbol", { name: "A", symbol: "x".repeat(33) }, /symbol/],
    ["a long logo", { ...ok, logo: "x".repeat(513) }, /logo/],
    ["a long description", { ...ok, description: "x".repeat(1025) }, /description/],
    ["a long social", { ...ok, socials: { twitter: "x".repeat(257) } }, /twitter/],
    ["another tax", { ...ok, taxBps: 300 as never }, /taxBps/],
    ["the Pot type", { ...ok, launchType: "pot" as never }, /Pot/],
    ["a type that doesn't exist", { ...ok, launchType: "jackpot" as never }, /Unknown/],
    ["a team of one", { ...ok, launchType: "team" as const, team: [{ wallet: A, bps: 10_000 }] }, /team/i],
    ["a team of eleven", { ...ok, launchType: "team" as const, team: Array.from({ length: 11 }, () => ({ wallet: A, bps: 909 })) }, /team/i],
    ["a repeated wallet", { ...ok, launchType: "team" as const, team: [{ wallet: A, bps: 5_000 }, { wallet: A, bps: 5_000 }] }, /once/],
    ["shares that don't add up", { ...ok, launchType: "team" as const, team: [{ wallet: A, bps: 5_000 }, { wallet: B, bps: 4_000 }] }, /10,000/],
    ["a team on another type", { ...ok, team: [{ wallet: A, bps: 10_000 }] }, /team/i],
    ["a max wallet below 0.5%", { ...ok, maxWalletBps: 49, limitsWindow: 60 }, /maxWalletBps/],
    ["a max buy above 5%", { ...ok, maxBuyBps: 501, limitsWindow: 60 }, /maxBuyBps/],
    ["a limit with no window", { ...ok, maxWalletBps: 100 }, /limitsWindow/],
    ["a window past an hour", { ...ok, maxWalletBps: 100, limitsWindow: 3_601 }, /limitsWindow/],
    ["a window with no limit", { ...ok, limitsWindow: 60 }, /limitsWindow/],
    ["a lock past 90 days", { ...ok, firstBuyLock: 90 * 86_400 + 1 }, /firstBuyLock/],
    ["silly slippage", { ...ok, slippageBps: 10_001 }, /slippage/],
    ["a negative first buy", { ...ok, firstBuy: -1n }, /firstBuy/],
  ])("refuses %s", (_name, input, match) => {
    expect(() => checkLaunchInput(input)).toThrow(StealthInputError);
    expect(() => checkLaunchInput(input)).toThrow(match);
  });

  it("takes the limits at their edges", () => {
    expect(() => checkLaunchInput({ ...ok, maxWalletBps: 50, maxBuyBps: 500, limitsWindow: 3_600, firstBuyLock: 90 * 86_400 })).not.toThrow();
    expect(() => checkLaunchInput({ ...ok, launchType: "team", team: [{ wallet: A, bps: 1 }, { wallet: B, bps: 9_999 }] })).not.toThrow();
  });
});
