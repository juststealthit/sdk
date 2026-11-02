import type { EvmDex } from "../deployments.js";
import * as infinity from "./infinity/index.js";
import * as v4 from "./v4/index.js";

export * as v4Abis from "./v4/index.js";
export * as infinityAbis from "./infinity/index.js";

/**
 * The contracts' ABIs for a build. Uniswap v4 and PancakeSwap Infinity pool keys have different fields, so the vault, hook, locker and
 * router differ. Typed as the v4 build: code that touches a pool key itself goes through `PoolKey` (client.ts).
 */
export const abisFor = (dex: EvmDex): typeof v4 => (dex === "infinity" ? (infinity as unknown as typeof v4) : v4);

const KEY_V4 = {
  type: "tuple",
  name: "poolKey",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

const KEY_INFINITY = {
  type: "tuple",
  name: "poolKey",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "hooks", type: "address" },
    { name: "poolManager", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "parameters", type: "bytes32" },
  ],
} as const;

const quoteFn = (name: string, key: typeof KEY_V4 | typeof KEY_INFINITY, out: string) => ({
  type: "function",
  name,
  stateMutability: "nonpayable",
  inputs: [
    {
      name: "params",
      type: "tuple",
      components: [key, { name: "zeroForOne", type: "bool" }, { name: "exactAmount", type: "uint128" }, { name: "hookData", type: "bytes" }],
    },
  ],
  outputs: [
    { name: out, type: "uint256" },
    { name: "gasEstimate", type: "uint256" },
  ],
});

/** The DEX's own quoter, called with `eth_call`. It runs the hook, so its answer includes the tax and any sniper fee. */
export const quoterAbiFor = (dex: EvmDex) => {
  const key = dex === "infinity" ? KEY_INFINITY : KEY_V4;
  return [quoteFn("quoteExactInputSingle", key, "amountOut"), quoteFn("quoteExactOutputSingle", key, "amountIn")] as const;
};
