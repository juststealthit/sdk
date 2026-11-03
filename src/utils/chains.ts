/**
 * Every chain Just Stealth It runs on, or has announced. `status` says which: `live` chains have contracts or programs you can use
 * today; `coming_soon` chains are listed on the site but have nothing deployed, and the SDK refuses them.
 *
 * Whether a live EVM chain is switched on right now is the API's call: `stealth.evm.config()` lists the ones that are.
 *
 * @module
 */

export type ChainFamily = "svm" | "evm";
export type ChainStatus = "live" | "coming_soon";

export interface ChainInfo {
  /** The key the API and SDK use. */
  key: string;
  name: string;
  family: ChainFamily;
  status: ChainStatus;
  /** EVM chain id. `null` on Solana and on chains not yet announced with one. */
  chainId: number | null;
  /** The gas coin. */
  native: string | null;
  nativeDecimals: number | null;
  /** Where coins trade. */
  dex: string | null;
  /** Public block explorer. */
  explorer: string | null;
}

export const CHAINS = {
  solana: { key: "solana", name: "Solana", family: "svm", status: "live", chainId: null, native: "SOL", nativeDecimals: 9, dex: "Pump.fun, Raydium LaunchLab, Meteora", explorer: "https://solscan.io" },
  robinhood: { key: "robinhood", name: "Robinhood Chain", family: "evm", status: "live", chainId: 4663, native: "ETH", nativeDecimals: 18, dex: "Uniswap v4", explorer: "https://explorer.chain.robinhood.com" },
  bnb: { key: "bnb", name: "BNB Chain", family: "evm", status: "live", chainId: 56, native: "BNB", nativeDecimals: 18, dex: "PancakeSwap Infinity", explorer: "https://bscscan.com" },
  hyperevm: { key: "hyperevm", name: "HyperEVM", family: "evm", status: "live", chainId: 999, native: "HYPE", nativeDecimals: 18, dex: "Uniswap v4", explorer: "https://hyperevmscan.io" },
  base: { key: "base", name: "Base", family: "evm", status: "live", chainId: 8453, native: "ETH", nativeDecimals: 18, dex: "Uniswap v4", explorer: "https://basescan.org" },
  arc: { key: "arc", name: "Arc", family: "evm", status: "live", chainId: 5042, native: "USDC", nativeDecimals: 18, dex: "Uniswap v4", explorer: "https://explorer.arc.io" },
  avalanche: { key: "avalanche", name: "Avalanche", family: "evm", status: "coming_soon", chainId: null, native: null, nativeDecimals: null, dex: null, explorer: null },
  arbitrum: { key: "arbitrum", name: "Arbitrum", family: "evm", status: "coming_soon", chainId: null, native: null, nativeDecimals: null, dex: null, explorer: null },
  xlayer: { key: "xlayer", name: "X Layer", family: "evm", status: "coming_soon", chainId: null, native: null, nativeDecimals: null, dex: null, explorer: null },
} as const satisfies Record<string, ChainInfo>;

export type ChainKey = keyof typeof CHAINS;
export type LiveChainKey = { [K in ChainKey]: (typeof CHAINS)[K]["status"] extends "live" ? K : never }[ChainKey];
export type ComingSoonChainKey = Exclude<ChainKey, LiveChainKey>;

/** Every chain, live ones first. */
export const listChains = (): ChainInfo[] => Object.values(CHAINS).sort((a, b) => (a.status === b.status ? 0 : a.status === "live" ? -1 : 1));

/** Live chains only. */
export const liveChains = (): ChainInfo[] => listChains().filter((c) => c.status === "live");

/** Announced chains with nothing deployed yet. */
export const comingSoonChains = (): ChainInfo[] => listChains().filter((c) => c.status === "coming_soon");

/** A chain by key, or `undefined`. */
export const getChain = (key: string): ChainInfo | undefined => (CHAINS as Record<string, ChainInfo>)[key];

/** A chain by EVM chain id, or `undefined`. */
export const chainById = (chainId: number): ChainInfo | undefined => Object.values(CHAINS).find((c) => c.chainId === chainId);

export const isLiveChain = (key: string): key is LiveChainKey => getChain(key)?.status === "live";

/** Explorer links. `null` for a chain without an explorer. */
export function explorerUrl(chain: string, kind: "tx" | "address" | "token", value: string): string | null {
  const c = getChain(chain);
  if (!c?.explorer) return null;
  const path = c.family === "svm" && kind === "address" ? "account" : kind;
  return `${c.explorer}/${path}/${value}`;
}
