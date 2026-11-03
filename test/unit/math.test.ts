import { describe, expect, it } from "vitest";

import {
  boostAt,
  coinRateBps,
  curvePrice,
  curveProgress,
  effectiveAprBps,
  estimateStakingReward,
  feeTable,
  hasSniperWindow,
  initCurve,
  maxIn,
  minOut,
  nextBoost,
  priceFromSqrtPriceX96,
  quoteCurveBuy,
  quoteCurveBuyExactOut,
  quoteCurveSell,
  quoteToGraduate,
  rewardFor,
  rewardShare,
  sniperFeeBps,
  sniperFeePips,
  sniperSchedule,
  sniperSecondsLeft,
  splitEvmFee,
  splitPumpCreatorFee,
  splitTierFee,
  YEAR_SEC,
} from "../../src/math/index.js";
import { METEORA_TIERS, RAYDIUM_TIERS } from "../../src/solana/constants.js";

describe("anti-sniper line", () => {
  it("matches the docs' table on a 1.25% coin", () => {
    const table: [number, number][] = [
      [0, 90],
      [3, 72.25],
      [6, 54.5],
      [9, 36.75],
      [12, 19],
      [14, 7.17],
      [15, 1.25],
    ];
    for (const [s, pct] of table) expect(Math.round(sniperFeeBps(125, s)) / 100).toBeCloseTo(pct, 2);
  });

  it("steps once per whole second, and holds the tier after 15 s", () => {
    expect(sniperFeePips(125, 2.99)).toBe(sniperFeePips(125, 2));
    expect(sniperFeePips(575, 100)).toBe(57_500);
    expect(sniperFeePips(125, -1)).toBe(900_000);
  });

  it("reproduces the docs' self-snipe example at the top tier", () => {
    // the window's last second at 5.75%: pays 11.37%, gets 4.025% back
    expect(sniperFeeBps(575, 14) / 100).toBeCloseTo(11.37, 2);
    expect(coinRateBps("evm", 575) / 100).toBeCloseTo(4.025, 3);
  });

  it("schedules 16 seconds and counts down", () => {
    const s = sniperSchedule(225);
    expect(s).toHaveLength(16);
    expect(s[0]).toEqual({ second: 0, feeBps: 9_000 });
    expect(s[15]).toEqual({ second: 15, feeBps: 225 });
    expect(sniperSecondsLeft(100, 110)).toBe(5);
    expect(sniperSecondsLeft(100, 200)).toBe(0);
    expect(hasSniperWindow("meteora")).toBe(true);
    expect(hasSniperWindow("pump")).toBe(false);
  });
});

describe("fee splits", () => {
  it("splits an EVM fee 70 / 30, with the sniper surplus to the platform", () => {
    const amount = 1_000_000n;
    expect(splitEvmFee(amount, 125)).toEqual({ total: 12_500n, protocol: 0n, coin: 8_750n, platform: 3_750n });
    const sniped = splitEvmFee(amount, 125, 9_000);
    expect(sniped.total).toBe(900_000n);
    expect(sniped.coin).toBe(8_750n);
    expect(sniped.platform).toBe(891_250n);
  });

  it("splits Raydium and Meteora tiers with the venue's cut first", () => {
    const r = splitTierFee(1_000_000n, RAYDIUM_TIERS[0]!);
    expect(r).toEqual({ total: 12_500n, protocol: 2_500n, platform: 5_000n, coin: 5_000n });
    const m = splitTierFee(1_000_000n, METEORA_TIERS[4]!);
    expect(m.total).toBe(57_500n);
    expect(m.coin).toBe(32_200n);
  });

  it("splits a Pump creator fee 70 / 30", () => {
    expect(splitPumpCreatorFee(1_000n)).toEqual({ coin: 700n, platform: 300n });
  });

  it("builds the docs' fee table", () => {
    expect(feeTable()[0]).toEqual({ tierBps: 125, evm: 87.5, meteora: 70, raydium: 50 });
    expect(feeTable().every((r) => r.raydium === 50)).toBe(true);
    expect(() => coinRateBps("meteora", 999)).toThrow(RangeError);
  });

  it("applies slippage both ways", () => {
    expect(minOut(10_000n, 300)).toBe(9_700n);
    expect(maxIn(10_000n, 300)).toBe(10_300n);
    expect(maxIn(1n, 1)).toBe(2n);
    expect(() => minOut(1n, 10_000)).toThrow(RangeError);
  });
});

describe("constant-product curve", () => {
  const supply = 1_000_000_000n * 10n ** 6n;
  const totalSell = (supply * 7_931n) / 10_000n;
  const raise = 85n * 10n ** 9n;
  const fresh = () => initCurve({ supply, totalSell, raise });

  it("sells the whole curve for the raise", () => {
    const s = fresh();
    const need = quoteToGraduate(s, 0);
    expect(Number(need) / 1e9).toBeCloseTo(85, 3);
    expect(curveProgress(s)).toBe(0);
  });

  it("ends at the price the pool opens at", () => {
    const s = fresh();
    const done = { ...s, realToken: totalSell, realQuote: raise };
    const poolPrice = Number(raise) / Number(supply - totalSell);
    expect(curvePrice(done) / poolPrice).toBeCloseTo(1, 3);
    expect(curveProgress(done)).toBe(1);
  });

  it("quotes a buy with the fee taken first, and moves the price up", () => {
    const s = fresh();
    const q = quoteCurveBuy(s, 10n ** 9n, 125);
    expect(q.fee).toBe(12_500_000n);
    expect(q.amountIn).toBe(10n ** 9n);
    expect(q.amountOut).toBeGreaterThan(0n);
    expect(q.priceImpactPct).toBeGreaterThan(0);
    expect(q.after.realQuote).toBe(10n ** 9n - q.fee);
  });

  it("caps a buy at what's left, and charges less", () => {
    const q = quoteCurveBuy(fresh(), 1_000n * 10n ** 9n, 100);
    expect(q.amountOut).toBe(totalSell);
    expect(q.amountIn).toBeLessThan(1_000n * 10n ** 9n);
    expect(curveProgress(q.after)).toBe(1);
  });

  it("round-trips a buy and a sell, losing the fees", () => {
    const bought = quoteCurveBuy(fresh(), 10n ** 9n, 100);
    const sold = quoteCurveSell(bought.after, bought.amountOut, 100);
    expect(sold.amountOut).toBeLessThan(10n ** 9n);
    expect(Number(sold.amountOut) / 1e9).toBeCloseTo(0.98, 2);
    expect(sold.priceImpactPct).toBeLessThan(0);
  });

  it("exact-out costs at least what the same buy gets", () => {
    const s = fresh();
    const cost = quoteCurveBuyExactOut(s, 10n ** 12n, 125);
    expect(quoteCurveBuy(s, cost, 125).amountOut).toBeGreaterThanOrEqual(10n ** 12n);
  });

  it("refuses impossible inputs", () => {
    expect(() => initCurve({ supply, totalSell: supply, raise })).toThrow(RangeError);
    expect(() => quoteCurveBuy(fresh(), 0n, 100)).toThrow(RangeError);
    expect(() => quoteCurveSell(fresh(), 1n, 100)).toThrow(RangeError);
    expect(() => quoteCurveBuy(fresh(), 1n, 10_000)).toThrow(RangeError);
  });

  it("reads an EVM price from sqrtPriceX96", () => {
    // sqrtPriceX96 = 2^96 × sqrt(token per quote): 1e6 tokens per quote coin → 1e-6 quote per token
    const sqrt = 2n ** 96n * 1_000n;
    expect(priceFromSqrtPriceX96(sqrt)).toBeCloseTo(1e-6, 12);
    expect(priceFromSqrtPriceX96(0n)).toBe(0);
  });
});

describe("staking maths", () => {
  const boosts = [
    { days: 7, multBps: 12_500 },
    { days: 30, multBps: 15_000 },
    { days: 90, multBps: 20_000 },
  ];

  it("picks the highest step reached", () => {
    expect(boostAt(boosts, 0)).toBe(10_000);
    expect(boostAt(boosts, 7 * 86_400)).toBe(12_500);
    expect(boostAt(boosts, 100 * 86_400)).toBe(20_000);
    expect(boostAt([], 1e9)).toBe(10_000);
    expect(nextBoost(boosts, 0)).toEqual({ multBps: 12_500, inSec: 7 * 86_400 });
    expect(nextBoost(boosts, 91 * 86_400)).toBeNull();
  });

  it("accrues linearly and rounds down", () => {
    expect(rewardFor(1_000_000n, 1_000, 10_000, YEAR_SEC)).toBe(100_000n);
    expect(rewardFor(1_000_000n, 1_000, 20_000, YEAR_SEC / 2)).toBe(100_000n);
    expect(rewardFor(1n, 1, 10_000, 1)).toBe(0n);
    expect(rewardFor(0n, 1_000, 10_000, 1)).toBe(0n);
  });

  it("estimates piecewise through the boosts", () => {
    const amount = 365n * 10n ** 9n;
    // 7 days at 1×, 23 at 1.25×, at 10% APR
    const expected = rewardFor(amount, 1_000, 10_000, 7 * 86_400) + rewardFor(amount, 1_000, 12_500, 23 * 86_400);
    expect(estimateStakingReward(amount, 1_000, boosts, 30)).toBe(expected);
    expect(estimateStakingReward(amount, 1_000, boosts, 0)).toBe(0n);
    expect(effectiveAprBps(1_000, [], 365)).toBeCloseTo(1_000, 0);
    expect(effectiveAprBps(1_000, boosts, 365)).toBeGreaterThan(1_000);
  });

  it("moves a share of the reward with a partial unstake", () => {
    expect(rewardShare(100n, 25n, 100n)).toBe(25n);
    expect(rewardShare(100n, 200n, 100n)).toBe(100n);
    expect(rewardShare(100n, 1n, 0n)).toBe(0n);
  });
});
