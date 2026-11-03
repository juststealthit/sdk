/**
 * Bonding-curve maths for offline previews. A constant-product curve with virtual reserves (the model Pump.fun and Raydium LaunchLab
 * curves follow), plus the EVM pool's price from `sqrtPriceX96`.
 *
 * These are previews. Meteora's curve is piecewise concentrated liquidity, so on Meteora use the API's quote (`sol.quote`) for anything
 * you'd act on; and on every venue the chain's state at the moment you trade has the last word.
 *
 * @module
 */

/** Rates here are parts per million, as Raydium's program counts them. 1 bps = 100. */
export const RATE_DENOMINATOR = 1_000_000n;

/** A constant-product curve: `(virtualToken − realToken) × (virtualQuote + realQuote)` stays constant. All in base units. */
export interface CurveState {
  /** Virtual token reserve at launch. */
  virtualToken: bigint;
  /** Virtual quote reserve at launch. */
  virtualQuote: bigint;
  /** Tokens sold so far. */
  realToken: bigint;
  /** Quote raised so far. */
  realQuote: bigint;
  /** Tokens the curve sells before it graduates. */
  totalSellToken: bigint;
}

export interface CurveQuote {
  /** Tokens out on a buy; quote out after the fee on a sell. */
  amountOut: bigint;
  /** What's actually spent: on a buy that sells out the curve, less than asked. */
  amountIn: bigint;
  /** The fee taken, in quote base units. */
  fee: bigint;
  /** Spot price after the trade, quote base units per token base unit. */
  priceAfter: number;
  /** How far the trade moved the price, in percent. */
  priceImpactPct: number;
  /** The curve after the trade. */
  after: CurveState;
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const ratePpm = (feeBps: number) => {
  if (!(feeBps >= 0) || feeBps >= 10_000) throw new RangeError("feeBps is 0 to 9,999.");
  return BigInt(Math.round(feeBps * 100));
};

/**
 * Virtual reserves of a new curve that sells `totalSell` tokens for `raise` quote and ends at the price the graduated pool opens at,
 * `raise / (supply − totalSell − locked)`. The same parameters Raydium LaunchLab derives at launch.
 */
export function initCurve(p: { supply: bigint; totalSell: bigint; raise: bigint; locked?: bigint; migrateFee?: bigint }): CurveState {
  const left = p.supply - p.totalSell - (p.locked ?? 0n);
  const net = p.raise - (p.migrateFee ?? 0n);
  if (left <= 0n || net <= 0n || p.totalSell <= 0n) throw new RangeError("Invalid curve parameters.");
  const numerator = (net * p.totalSell * p.totalSell) / left;
  const denominator = (net * p.totalSell) / left - p.raise;
  if (denominator <= 0n) throw new RangeError("The curve must sell more than the pool keeps.");
  return { virtualToken: numerator / denominator, virtualQuote: (p.raise * p.raise) / denominator, realToken: 0n, realQuote: 0n, totalSellToken: p.totalSell };
}

/** Spot price, quote base units per token base unit. Multiply by `10 ** (tokenDecimals − quoteDecimals)` for whole units. */
export function curvePrice(s: Pick<CurveState, "virtualToken" | "virtualQuote" | "realToken" | "realQuote">): number {
  const tokens = s.virtualToken - s.realToken;
  return tokens > 0n ? Number(s.virtualQuote + s.realQuote) / Number(tokens) : 0;
}

/** Spot price in whole quote units per whole token. */
export function curvePriceUnits(s: CurveState, tokenDecimals: number, quoteDecimals: number): number {
  return curvePrice(s) * 10 ** (tokenDecimals - quoteDecimals);
}

/** How much of the curve has sold, 0 to 1. Graduation is at 1. */
export function curveProgress(s: Pick<CurveState, "realToken" | "totalSellToken">): number {
  if (s.totalSellToken <= 0n) return 0;
  const p = Number((s.realToken * 1_000_000n) / s.totalSellToken) / 1_000_000;
  return Math.min(1, Math.max(0, p));
}

/** Tokens a buy of `quoteIn` (fee included) gets right now, capped at what's left on the curve. Mirrors `buy_exact_in`. */
export function quoteCurveBuy(s: CurveState, quoteIn: bigint, feeBps: number): CurveQuote {
  if (quoteIn <= 0n) throw new RangeError("quoteIn must be above 0.");
  const rate = ratePpm(feeBps);
  const before = curvePrice(s);
  const inRes = s.virtualQuote + s.realQuote;
  const outRes = s.virtualToken - s.realToken;
  let fee = ceilDiv(quoteIn * rate, RATE_DENOMINATOR);
  let net = quoteIn - fee;
  let spent = quoteIn;
  let out = (net * outRes) / (inRes + net);
  const left = s.totalSellToken - s.realToken;
  if (out > left) {
    out = left;
    net = ceilDiv(inRes * out, outRes - out);
    spent = ceilDiv(net * RATE_DENOMINATOR, RATE_DENOMINATOR - rate);
    fee = spent - net;
  }
  const after: CurveState = { ...s, realToken: s.realToken + out, realQuote: s.realQuote + net };
  const priceAfter = curvePrice(after);
  return { amountOut: out, amountIn: spent, fee, priceAfter, priceImpactPct: before > 0 ? ((priceAfter - before) / before) * 100 : 0, after };
}

/** Quote a sell of `tokensIn` gets right now, after the fee. Mirrors `sell_exact_in`. */
export function quoteCurveSell(s: CurveState, tokensIn: bigint, feeBps: number): CurveQuote {
  if (tokensIn <= 0n) throw new RangeError("tokensIn must be above 0.");
  if (tokensIn > s.realToken) throw new RangeError("The curve can't buy back more than it sold.");
  const rate = ratePpm(feeBps);
  const before = curvePrice(s);
  const inRes = s.virtualToken - s.realToken;
  const outRes = s.virtualQuote + s.realQuote;
  const gross = (tokensIn * outRes) / (inRes + tokensIn);
  const fee = ceilDiv(gross * rate, RATE_DENOMINATOR);
  const after: CurveState = { ...s, realToken: s.realToken - tokensIn, realQuote: s.realQuote - gross };
  const priceAfter = curvePrice(after);
  return { amountOut: gross - fee, amountIn: tokensIn, fee, priceAfter, priceImpactPct: before > 0 ? ((priceAfter - before) / before) * 100 : 0, after };
}

/** Quote (fee included) it takes to buy exactly `tokensOut`. Throws past what's left on the curve. */
export function quoteCurveBuyExactOut(s: CurveState, tokensOut: bigint, feeBps: number): bigint {
  const left = s.totalSellToken - s.realToken;
  if (tokensOut <= 0n || tokensOut > left) throw new RangeError(`tokensOut must be 1 to ${left}.`);
  const rate = ratePpm(feeBps);
  const inRes = s.virtualQuote + s.realQuote;
  const outRes = s.virtualToken - s.realToken;
  const net = ceilDiv(inRes * tokensOut, outRes - tokensOut);
  return ceilDiv(net * RATE_DENOMINATOR, RATE_DENOMINATOR - rate);
}

/** Quote still needed to sell out the curve and graduate, fee included. */
export function quoteToGraduate(s: CurveState, feeBps: number): bigint {
  const left = s.totalSellToken - s.realToken;
  return left > 0n ? quoteCurveBuyExactOut(s, left, feeBps) : 0n;
}

/** Market cap at the spot price, in quote base units, for a supply in token base units. */
export function curveMarketCap(s: CurveState, supply: bigint): number {
  return curvePrice(s) * Number(supply);
}

/**
 * The EVM pool's price: quote per token, both 18 decimals, from a Uniswap v4 or PancakeSwap Infinity `sqrtPriceX96`. The quote is
 * currency0 on every Stealth pool, so the price is the inverse of the pool's.
 */
export function priceFromSqrtPriceX96(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 <= 0n) return 0;
  const root = Number(sqrtPriceX96) / 2 ** 96;
  return 1 / (root * root);
}

/** EVM market cap in the quote, whole units: price × 1,000,000,000 tokens. */
export const evmMarketCap = (sqrtPriceX96: bigint) => priceFromSqrtPriceX96(sqrtPriceX96) * 1_000_000_000;
