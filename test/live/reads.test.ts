import { describe, expect, it } from "vitest";

import { createStealthEvm, EVM_DEPLOYMENTS, type EvmChainKey } from "../../src/evm/index.js";
import { createStealthMultichain } from "../../src/multichain/index.js";
import { createStealthSolana, LAUNCHLAB_PLATFORMS, METEORA_SHARED_CONFIGS, METEORA_TIERS, RAYDIUM_TIERS, SOLANA_PROGRAMS, LAUNCH_LOOKUP_TABLE } from "../../src/solana/index.js";

/** Reads against production. Nothing here writes, signs or spends. */
const sol = createStealthSolana();

describe("the live API agrees with the SDK", () => {
  it("has the same venues and tiers", async () => {
    const cfg = await sol.getConfig();
    const venues = cfg.venues as { id: string; taxTiers: { id: string; totalBps: number; platformBps: number; creatorBps: number; protocolBps: number; afterGraduation: object; default: boolean }[] }[];
    const tiers = (id: string) => venues.find((v) => v.id === id)!.taxTiers;
    const shape = (t: (typeof RAYDIUM_TIERS)[number]) => ({ id: t.id, totalBps: t.totalBps, platformBps: t.platformBps, creatorBps: t.creatorBps, protocolBps: t.protocolBps, afterGraduation: t.afterGraduation, default: t.default });
    expect(tiers("raydium").map((t) => ({ id: t.id, totalBps: t.totalBps, platformBps: t.platformBps, creatorBps: t.creatorBps, protocolBps: t.protocolBps, afterGraduation: t.afterGraduation, default: t.default }))).toEqual(RAYDIUM_TIERS.map(shape));
    expect(tiers("meteora").map((t) => ({ id: t.id, totalBps: t.totalBps, platformBps: t.platformBps, creatorBps: t.creatorBps, protocolBps: t.protocolBps, afterGraduation: t.afterGraduation, default: t.default }))).toEqual(METEORA_TIERS.map(shape));
  });

  it("has the same launch types", async () => {
    const cfg = await sol.getConfig();
    const ids = (cfg.feeModes as { id: string }[]).map((m) => m.id).sort();
    expect(ids).toEqual(["buyback", "creator", "diamond", "feed", "holders", "liquidity", "marketing", "mix", "social", "team", "wallet"]);
  });

  it("offers the 20 Meteora pairs", async () => {
    const { pairs } = await sol.getPairs("meteora");
    expect(pairs.map((p) => p.mint).sort()).toEqual(Object.keys(METEORA_SHARED_CONFIGS).sort());
    for (const p of pairs) expect(METEORA_SHARED_CONFIGS[p.mint]!.symbol).toBe(p.symbol);
  });

  it("lists coins and multi-chain's offer", async () => {
    const page = await sol.getTokens({ stages: "new,graduating,migrated" });
    expect(Array.isArray(page.items)).toBe(true);
    const mc = await createStealthMultichain().getConfig();
    expect(mc.chains.map((c) => c.chain).sort()).toEqual(["arc", "base", "bnb", "hyperevm", "robinhood", "solana"]);
  });
});

describe("every Solana account is what the SDK says", () => {
  it("is owned by the right program", async () => {
    const rpc = async (addrs: string[]) => {
      const res = await fetch("https://api.mainnet-beta.solana.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [addrs, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }] }),
      });
      return ((await res.json()) as { result: { value: ({ owner: string } | null)[] } }).result.value;
    };
    for (const [addrs, owner] of [
      [Object.values(LAUNCHLAB_PLATFORMS), SOLANA_PROGRAMS.raydiumLaunchLab],
      [Object.values(METEORA_SHARED_CONFIGS).map((c) => c.config), SOLANA_PROGRAMS.meteoraDbc],
      [[LAUNCH_LOOKUP_TABLE], SOLANA_PROGRAMS.addressLookupTable],
    ] as const) {
      for (const a of await rpc([...addrs])) expect(a?.owner).toBe(owner);
    }
  });
});

describe.each(Object.keys(EVM_DEPLOYMENTS) as EvmChainKey[])("%s, read from its public RPC", (chain) => {
  it("answers the SDK's reads", async () => {
    const cfg = await createStealthEvm({ chain }).getConfig();
    expect(cfg.launchesPaused).toBe(false);
    expect(cfg.configVersion).toBeGreaterThan(0n);
    expect(cfg.launchFee).toBe(0n);
  });
});
