// From the deployment records. Public contract addresses only.
//
// This is the one place contract addresses live. A chain gets an entry here once its deploy is checked on chain, never before.
// Ethereum, Arbitrum One and Avalanche C-Chain are deploying now and have none yet: they are `coming_soon` in utils/chains.ts.
// To add one, set its status to "live" in utils/chains.ts; `EvmChainKey` then includes it and this record won't compile until
// its entry (addresses, RPC, start block) is here. EVM_CHAINS, EVM_API_CHAINS and MULTICHAIN_CHAINS follow on their own.
import type { Address } from "viem";

import type { LiveEvmChainKey } from "../utils/chains.js";

/** The live EVM chains: the ones with contracts below. */
export type EvmChainKey = LiveEvmChainKey;
export type EvmDex = "v4" | "infinity";

export interface EvmDeployment {
  key: EvmChainKey;
  chainId: number;
  name: string;
  /** The gas coin. On Arc that is USDC with 18 decimals. */
  native: string;
  dex: EvmDex;
  /** A public RPC. Bring your own for anything serious. */
  rpcUrl: string;
  /** Earliest block to read launches from. */
  startBlock: bigint;
  confirmations: number;
  factory: Address;
  router: Address;
  feeVault: Address;
  hook: Address;
  locker: Address;
  tokenDeployer: Address;
  tokenImplementation: Address;
  poolManager: Address;
  /** Where funds and claims live. On Uniswap v4 that is the pool manager; on Infinity the Vault. */
  settlement: Address;
  quoter: Address;
}

export const EVM_DEPLOYMENTS: Record<EvmChainKey, EvmDeployment> = {
  robinhood: {
    key: "robinhood",
    chainId: 4663,
    name: "Robinhood Chain",
    native: "ETH",
    dex: "v4",
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    startBlock: 103854733n,
    confirmations: 20,
    factory: "0xF828FD2DB63E3aF84f950eFcF601dE1B679B567d",
    router: "0x887724eBE323e7C4aBF4a240DDBa6828Bc89F6a6",
    feeVault: "0x5F15d599BA849554A40975333a7e39F537c37e61",
    hook: "0xa12B34E4a5968163A2FBa4cdE85656dDAe5078Ec",
    locker: "0x6e0C6a185ACd0b5CB8050823aB570A5565Bebf34",
    tokenDeployer: "0x5d30FE70B12ABB4728741A7fF38295e5Dab0ed27",
    tokenImplementation: "0x005BDc162F7bCF6D5fEbB30a845698061F8AE3af",
    poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    settlement: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    quoter: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
  },
  bnb: {
    key: "bnb",
    chainId: 56,
    name: "BNB Chain",
    native: "BNB",
    dex: "infinity",
    rpcUrl: "https://bsc-dataseed.bnbchain.org",
    startBlock: 131157534n,
    confirmations: 5,
    factory: "0xF828FD2DB63E3aF84f950eFcF601dE1B679B567d",
    router: "0x887724eBE323e7C4aBF4a240DDBa6828Bc89F6a6",
    feeVault: "0x5F15d599BA849554A40975333a7e39F537c37e61",
    hook: "0x4bE4973112a5e053B790Fa99dF2012F96bcD0e1a",
    locker: "0x6e0C6a185ACd0b5CB8050823aB570A5565Bebf34",
    tokenDeployer: "0x5d30FE70B12ABB4728741A7fF38295e5Dab0ed27",
    tokenImplementation: "0x005BDc162F7bCF6D5fEbB30a845698061F8AE3af",
    poolManager: "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b",
    settlement: "0x238a358808379702088667322f80aC48bAd5e6c4",
    quoter: "0xd0737C9762912dD34c3271197E362Aa736Df0926",
  },
  hyperevm: {
    key: "hyperevm",
    chainId: 999,
    name: "HyperEVM",
    native: "HYPE",
    dex: "v4",
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    startBlock: 50149000n,
    confirmations: 2,
    factory: "0xB138Cb32B62e23eb148Ccbd94f089396c09D24e7",
    router: "0x5F15d599BA849554A40975333a7e39F537c37e61",
    feeVault: "0x5d30FE70B12ABB4728741A7fF38295e5Dab0ed27",
    hook: "0x12772A9DeeD523527172452e1Ed2d12154ECF8Ec",
    locker: "0xF828FD2DB63E3aF84f950eFcF601dE1B679B567d",
    tokenDeployer: "0x6e0C6a185ACd0b5CB8050823aB570A5565Bebf34",
    tokenImplementation: "0x15D2eA82F366581BB472A5243C1f6a7cC0373Da1",
    poolManager: "0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F",
    settlement: "0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F",
    quoter: "0x108Bfe38532C98f8Cd8D7Ab49c9dDAa3675a1c5e",
  },
  base: {
    key: "base",
    chainId: 8453,
    name: "Base",
    native: "ETH",
    dex: "v4",
    rpcUrl: "https://mainnet.base.org",
    startBlock: 53398031n,
    confirmations: 5,
    factory: "0xF828FD2DB63E3aF84f950eFcF601dE1B679B567d",
    router: "0x887724eBE323e7C4aBF4a240DDBa6828Bc89F6a6",
    feeVault: "0x5F15d599BA849554A40975333a7e39F537c37e61",
    hook: "0x485155E2160A62EECc33fC86fB6fA01C6c9FF8ec",
    locker: "0x6e0C6a185ACd0b5CB8050823aB570A5565Bebf34",
    tokenDeployer: "0x5d30FE70B12ABB4728741A7fF38295e5Dab0ed27",
    tokenImplementation: "0x005BDc162F7bCF6D5fEbB30a845698061F8AE3af",
    poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
    settlement: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
    quoter: "0x0d5e0F971ED27FBfF6c2837bf31316121532048D",
  },
  arc: {
    key: "arc",
    chainId: 5042,
    name: "Arc",
    native: "USDC",
    dex: "v4",
    rpcUrl: "https://rpc.mainnet.arc.io",
    startBlock: 29084721n,
    confirmations: 2,
    factory: "0xF828FD2DB63E3aF84f950eFcF601dE1B679B567d",
    router: "0x887724eBE323e7C4aBF4a240DDBa6828Bc89F6a6",
    feeVault: "0x5F15d599BA849554A40975333a7e39F537c37e61",
    hook: "0xa12B34E4a5968163A2FBa4cdE85656dDAe5078Ec",
    locker: "0x6e0C6a185ACd0b5CB8050823aB570A5565Bebf34",
    tokenDeployer: "0x5d30FE70B12ABB4728741A7fF38295e5Dab0ed27",
    tokenImplementation: "0x005BDc162F7bCF6D5fEbB30a845698061F8AE3af",
    poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    settlement: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    quoter: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
  },
};
