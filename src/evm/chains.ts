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

/** viem chains for the five EVM chains, with a public RPC each. */
export const EVM_CHAINS: Record<EvmChainKey, Chain> = {
  robinhood: chainFor("robinhood"),
  bnb: chainFor("bnb"),
  hyperevm: chainFor("hyperevm"),
  base: chainFor("base"),
  arc: chainFor("arc"),
};
