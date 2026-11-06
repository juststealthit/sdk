/**
 * Every chain Just Stealth It runs on, or has announced. `status` says which: `live` chains have contracts or programs you can use
 * today; `coming_soon` chains are listed on the site but have nothing deployed, and the SDK refuses them. `deploying` marks the
 * coming-soon chains whose contracts are being deployed right now (Ethereum, Arbitrum One, Avalanche C-Chain): they still have no
 * addresses here until each deploy is checked on chain.
 *
 * Whether a live EVM chain is switched on right now is the API's call: `stealth.evm.config()` lists the ones that are.
 *
 * Turning a chain on is two edits, and the type checker holds them together: set its `status` to `"live"` here, then add its
 * addresses to `EVM_DEPLOYMENTS` in `evm/deployments.ts` (which then refuses to compile without them). Every other list of chains in
 * the SDK (`EVM_CHAINS`, `EVM_API_CHAINS`, `MULTICHAIN_CHAINS`, `MarketChain`) follows from these two.
 *
 * @module
 */
import { StealthInputError, StealthUnsupportedError } from "../shared/errors.js";

export type ChainFamily = "svm" | "evm";
export type ChainStatus = "live" | "coming_soon";

export interface ChainInfo {
  /** The key the API and SDK use. */
  key: string;
  name: string;
  family: ChainFamily;
  status: ChainStatus;
  /** A coming-soon chain whose contracts are being deployed now. `false` on live chains. */
  deploying: boolean;
  /** EVM chain id. `null` on Solana. */
  chainId: number | null;
  /** The gas coin. */
  native: string | null;
  nativeDecimals: number | null;
  /** Where coins trade. `null` until the chain is live. */
  dex: string | null;
  /** Public block explorer. */
  explorer: string | null;
}

export const CHAINS = {
  solana: { key: "solana", name: "Solana", family: "svm", status: "live", deploying: false, chainId: null, native: "SOL", nativeDecimals: 9, dex: "Pump.fun, Raydium LaunchLab, Meteora", explorer: "https://solscan.io" },
  robinhood: { key: "robinhood", name: "Robinhood Chain", family: "evm", status: "live", deploying: false, chainId: 4663, native: "ETH", nativeDecimals: 18, dex: "Uniswap v4", explorer: "https://explorer.chain.robinhood.com" },
  bnb: { key: "bnb", name: "BNB Chain", family: "evm", status: "live", deploying: false, chainId: 56, native: "BNB", nativeDecimals: 18, dex: "PancakeSwap Infinity", explorer: "https://bscscan.com" },
  hyperevm: { key: "hyperevm", name: "HyperEVM", family: "evm", status: "live", deploying: false, chainId: 999, native: "HYPE", nativeDecimals: 18, dex: "Uniswap v4", explorer: "https://hyperevmscan.io" },
  base: { key: "base", name: "Base", family: "evm", status: "live", deploying: false, chainId: 8453, native: "ETH", nativeDecimals: 18, dex: "Uniswap v4", explorer: "https://basescan.org" },
  arc: { key: "arc", name: "Arc", family: "evm", status: "live", deploying: false, chainId: 5042, native: "USDC", nativeDecimals: 18, dex: "Uniswap v4", explorer: "https://explorer.arc.io" },
  ethereum: { key: "ethereum", name: "Ethereum", family: "evm", status: "coming_soon", deploying: true, chainId: 1, native: "ETH", nativeDecimals: 18, dex: null, explorer: "https://etherscan.io" },
  arbitrum: { key: "arbitrum", name: "Arbitrum One", family: "evm", status: "coming_soon", deploying: true, chainId: 42161, native: "ETH", nativeDecimals: 18, dex: null, explorer: "https://arbiscan.io" },
  avalanche: { key: "avalanche", name: "Avalanche C-Chain", family: "evm", status: "coming_soon", deploying: true, chainId: 43114, native: "AVAX", nativeDecimals: 18, dex: null, explorer: "https://snowtrace.io" },
  xlayer: { key: "xlayer", name: "X Layer", family: "evm", status: "coming_soon", deploying: false, chainId: 196, native: "OKB", nativeDecimals: 18, dex: null, explorer: "https://www.oklink.com/xlayer" },
} as const satisfies Record<string, ChainInfo>;

export type ChainKey = keyof typeof CHAINS;
export type LiveChainKey = { [K in ChainKey]: (typeof CHAINS)[K]["status"] extends "live" ? K : never }[ChainKey];
export type ComingSoonChainKey = Exclude<ChainKey, LiveChainKey>;
/** Live EVM chains: the ones with contracts in `EVM_DEPLOYMENTS`. */
export type LiveEvmChainKey = { [K in LiveChainKey]: (typeof CHAINS)[K]["family"] extends "evm" ? K : never }[LiveChainKey];
/** Coming-soon chains whose contracts are being deployed now. */
export type DeployingChainKey = { [K in ChainKey]: (typeof CHAINS)[K]["deploying"] extends true ? K : never }[ChainKey];

/** The keys of every live chain (Solana first), in the registry's order. Handy for an enum of chains a tool accepts. */
export const LIVE_CHAIN_KEYS = (Object.values(CHAINS) as ChainInfo[]).filter((c) => c.status === "live").map((c) => c.key) as LiveChainKey[];

/** The keys of the coming-soon chains, in the registry's order. */
export const COMING_SOON_CHAIN_KEYS = (Object.values(CHAINS) as ChainInfo[]).filter((c) => c.status === "coming_soon").map((c) => c.key) as ComingSoonChainKey[];

/** The keys of the live EVM chains, in the registry's order. */
export const LIVE_EVM_CHAIN_KEYS = (Object.values(CHAINS) as ChainInfo[]).filter((c) => c.family === "evm" && c.status === "live").map((c) => c.key) as LiveEvmChainKey[];

/** Every chain, live ones first. */
export const listChains = (): ChainInfo[] => Object.values(CHAINS).sort((a, b) => (a.status === b.status ? 0 : a.status === "live" ? -1 : 1));

/** Live chains only. */
export const liveChains = (): ChainInfo[] => listChains().filter((c) => c.status === "live");

/** Announced chains with nothing deployed yet. */
export const comingSoonChains = (): ChainInfo[] => listChains().filter((c) => c.status === "coming_soon");

/** A chain by key, or `undefined`. Keys are lower case; `"bsc"` and `"eth"` are read as `bnb` and `ethereum`. */
export const getChain = (key: string): ChainInfo | undefined => {
  const k = typeof key === "string" ? key.trim().toLowerCase() : "";
  return Object.prototype.hasOwnProperty.call(CHAINS, k) ? (CHAINS as Record<string, ChainInfo>)[k] : CHAIN_ALIASES[k] ? (CHAINS as Record<string, ChainInfo>)[CHAIN_ALIASES[k]] : undefined;
};

/** Other names people type for a chain. */
export const CHAIN_ALIASES: Readonly<Record<string, ChainKey>> = { sol: "solana", bsc: "bnb", eth: "ethereum", arb: "arbitrum", avax: "avalanche" };

/** A chain by EVM chain id, or `undefined`. */
export const chainById = (chainId: number): ChainInfo | undefined => Object.values(CHAINS).find((c) => c.chainId === chainId);

const exact = (key: string): ChainInfo | undefined => (Object.prototype.hasOwnProperty.call(CHAINS, key) ? (CHAINS as Record<string, ChainInfo>)[key] : undefined);

/** Whether `key` is exactly a live chain's key (no aliases, so the type guard holds). */
export const isLiveChain = (key: string): key is LiveChainKey => exact(key)?.status === "live";

/** Whether `key` is exactly a live EVM chain's key. */
export const isLiveEvmChain = (key: string): key is LiveEvmChainKey => exact(key)?.status === "live" && exact(key)?.family === "evm";

/** Whether `key` is a known chain that is announced but not live yet. */
export const isComingSoonChain = (key: string): key is ComingSoonChainKey => exact(key)?.status === "coming_soon";

/** The canonical key for a key or alias (`"BSC"` → `"bnb"`), or `null` for an unknown chain. */
export const chainKeyOf = (key: string): ChainKey | null => (getChain(key)?.key as ChainKey | undefined) ?? null;

/**
 * The chain for `key` (or an alias), if it is live and of `family`. A coming-soon chain throws a {@link StealthUnsupportedError}
 * that says so (code `unsupported`); an unknown key, or one of the other family, a {@link StealthInputError}.
 */
export function requireLiveChain(key: string, family?: ChainFamily): ChainInfo {
  const c = getChain(key);
  const want = family === "evm" ? "EVM " : family === "svm" ? "Solana " : "";
  const options = () => liveChains().filter((x) => !family || x.family === family).map((x) => x.key).join(", ");
  if (!c || (family && c.family !== family)) throw new StealthInputError(`Unknown ${want}chain ${JSON.stringify(key)}. Use one of ${options()}.`);
  if (c.status !== "live") {
    throw new StealthUnsupportedError(`${c.name} is coming soon${c.deploying ? ": its contracts are being deployed and have no addresses yet" : ""}. Nothing launches or trades there yet. Live ${want}chains: ${options()}.`);
  }
  return c;
}

/** Coming-soon chains whose contracts are being deployed now. */
export const deployingChains = (): ChainInfo[] => listChains().filter((c) => c.deploying);

/** Explorer links. `null` for a chain without an explorer. */
export function explorerUrl(chain: string, kind: "tx" | "address" | "token", value: string): string | null {
  const c = getChain(chain);
  if (!c?.explorer) return null;
  const path = c.family === "svm" && kind === "address" ? "account" : kind;
  return `${c.explorer}/${path}/${value}`;
}
