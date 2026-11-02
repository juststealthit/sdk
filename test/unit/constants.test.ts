import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";

import { CPMM_CONFIGS, LAUNCH_LOOKUP_TABLE, LAUNCHLAB_PLATFORMS, METEORA_SHARED_CONFIGS, METEORA_TIERS, MIX_SLICES, PUMP_SHARES, RAYDIUM_TIERS, SOLANA_LAUNCH_TYPES, SOLANA_PROGRAMS } from "../../src/solana/index.js";

describe("Solana setup", () => {
  it("adds every tier up to what a trader pays", () => {
    for (const t of [...RAYDIUM_TIERS, ...METEORA_TIERS]) expect(t.protocolBps + t.platformBps + t.creatorBps).toBe(t.totalBps);
    expect(RAYDIUM_TIERS.map((t) => t.totalBps)).toEqual([125, 225, 325, 425, 575]);
    expect(METEORA_TIERS.map((t) => t.totalBps)).toEqual([125, 225, 325, 425, 575]);
    for (const t of [...RAYDIUM_TIERS, ...METEORA_TIERS]) expect(t.afterGraduation.lpBps + t.afterGraduation.creatorBps).toBe(t.afterGraduation.totalBps);
  });

  it("states what the coin really gets on each venue", () => {
    expect(RAYDIUM_TIERS.every((t) => t.creatorBps === 50)).toBe(true);
    for (const t of METEORA_TIERS) expect(t.creatorBps / (t.creatorBps + t.platformBps)).toBeCloseTo(0.7, 5);
    for (const t of METEORA_TIERS) expect(t.protocolBps / t.totalBps).toBeCloseTo(0.2, 5);
    expect(PUMP_SHARES.escrowBps + PUMP_SHARES.platformBps).toBe(10_000);
  });

  it("marks one default tier per venue", () => {
    expect(RAYDIUM_TIERS.filter((t) => t.default).map((t) => t.id)).toEqual(["t125"]);
    expect(METEORA_TIERS.filter((t) => t.default).map((t) => t.id)).toEqual(["m100"]);
  });

  it("holds valid addresses only", () => {
    const all = [...Object.values(LAUNCHLAB_PLATFORMS), ...Object.values(CPMM_CONFIGS), ...Object.values(SOLANA_PROGRAMS), LAUNCH_LOOKUP_TABLE, ...Object.keys(METEORA_SHARED_CONFIGS), ...Object.values(METEORA_SHARED_CONFIGS).map((c) => c.config)];
    for (const a of all) expect(() => new PublicKey(a)).not.toThrow();
    expect(Object.keys(METEORA_SHARED_CONFIGS)).toHaveLength(20);
    expect(new Set(Object.values(METEORA_SHARED_CONFIGS).map((c) => c.config)).size).toBe(20);
  });

  it("has one platform per Raydium tier", () => {
    expect(Object.keys(LAUNCHLAB_PLATFORMS).sort()).toEqual(RAYDIUM_TIERS.map((t) => t.id).sort());
  });

  it("leaves Jackpot out", () => {
    expect(SOLANA_LAUNCH_TYPES).not.toContain("jackpot" as never);
    expect(MIX_SLICES).not.toContain("jackpot" as never);
  });
});
