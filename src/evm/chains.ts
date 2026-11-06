import { defineChain, type Chain } from "viem";

import { EVM_DEPLOYMENTS, type EvmChainKey } from "./deployments.js";

const chainFor = (key: EvmChainKey): Chain => {
  const d = EVM_DEPLOYMENTS[key];
  return defineChain({
    id: d.chainId,
    name: d.name,
    // Arc's native USDC has 18 decimals on its native side
    nativeCurrency: { name: d.native, symbol: d.native, decimals: 18 },
    rpcUrls: { default: { http: [d.rpcUrl] } },
  });
};

/** viem chains for the live EVM chains, with a public RPC each. */
export const EVM_CHAINS = Object.fromEntries((Object.keys(EVM_DEPLOYMENTS) as EvmChainKey[]).map((k) => [k, chainFor(k)])) as Record<EvmChainKey, Chain>;
