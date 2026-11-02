import type { MixSliceKind, SocialProvider, SolanaLaunchType, SolanaVenue } from "./constants.js";

export interface SolanaSocials {
  twitter?: string;
  telegram?: string;
  website?: string;
  discord?: string;
  farcaster?: string;
}

export interface TeamShare {
  /** A Solana wallet. */
  wallet: string;
  bps: number;
}

/** A chain from Relay's list, and an address on it. */
export interface PayoutTarget {
  chainId: number;
  address: string;
}

export interface MixSlice {
  kind: MixSliceKind;
  /** Of the creator fees, at least 100. All slices sum to 10,000. */
  bps: number;
  team?: TeamShare[];
  payout?: PayoutTarget;
  feed?: { mint: string };
}

export type LaunchRecipient =
  | { kind: "wallet"; wallet: string }
  /** `accountId` from `lookupSocial`, so the coin binds to that account and no other holder of the handle. */
  | { kind: "social"; provider: SocialProvider; handle: string; accountId?: string; acknowledged?: boolean };

export interface SolanaLaunchInput {
  /** Default: Pump.fun, or Raydium while Pump is off. */
  venue?: SolanaVenue;
  /** A tier id from RAYDIUM_TIERS or METEORA_TIERS. Pump has none. */
  taxTier?: string;
  name: string;
  symbol: string;
  description?: string;
  /** ipfs:// or https. */
  logo?: string;
  socials?: SolanaSocials;
  /** Dev buy in lamports, in the launch. */
  firstBuyLamports?: bigint;
  /** The pair. Default SOL. See `getPairs`. */
  quoteMint?: string;
  /** Pump, on pairs that allow it: the coin's own creator fee. */
  creatorFeeBps?: number;
  /** Default `creator`. Locked at launch. */
  feeMode?: SolanaLaunchType;
  /** Meteora only, on servers that allow it. Locked. See GLOBAL_TAX_STOPS_BPS. */
  globalTaxBps?: number;
  team?: TeamShare[];
  /** `wallet`: where the fees go, on Solana or any chain Relay lists. */
  payout?: PayoutTarget;
  /** `feed`: the coin to buy and burn. */
  feed?: { mint: string };
  mix?: MixSlice[];
  /** Default: the launcher's wallet. */
  recipient?: LaunchRecipient;
}

export interface EncodedTransaction {
  transaction: string;
  version: "legacy" | "v0";
}

/** POST /sol/launch's answer. The API has simulated it, and signed for the mint. */
export interface PreparedSolanaLaunch extends EncodedTransaction {
  mint: string;
  pool: string;
  escrow: string;
  lastValidBlockHeight: number;
  firstBuyTokens: string;
  metadataUri: string;
  /** When a launch can't fit one transaction: the rest, in order. */
  followUps?: EncodedTransaction[];
  /** With `followUps`: they go out together as a Jito bundle. */
  bundle?: boolean;
  feeMode: string;
  venue: SolanaVenue;
  taxTier: string | null;
  globalTaxBps?: number;
  creatorFeeBps?: number;
  explorer?: string;
  computeUnits?: number;
  priorityMicroLamports?: number;
  bytes?: number;
  launchTable?: string;
  pair?: { mint: string; kind: string; symbol: string; name: string };
  feeShares?: { creatorBps: number; marketingBps: number };
  feePlan?: unknown;
}

export interface SolanaQuote {
  venue: "curve" | "amm";
  side: "buy" | "sell";
  /** Base units: lamports on a buy, token units on a sell. */
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  feeLamports: string;
  /** A Pump curve on a pair: what it trades in. */
  quoteMint?: string;
  feeQuote?: string;
  /** The rate right now: the tax, or the sniper fee in the launch window. */
  feeBps: number;
  priceImpactPct: number | null;
}

export interface BuiltSwap {
  transaction: string;
  quote: SolanaQuote;
  lastValidBlockHeight: number;
}

/** A coin as the API reports it. The common fields are typed; the rest come through as they are. */
export interface SolanaToken {
  address: string;
  name: string;
  symbol: string;
  description?: string;
  logoUrl?: string | null;
  creator?: string;
  launcher?: string;
  socials?: SolanaSocials;
  taxBps?: number;
  [field: string]: unknown;
}

export interface TokenPage {
  items: SolanaToken[];
  nextCursor: string | null;
  total: number;
}

export interface TokenListOptions {
  /** Comma-separated: new, graduating, migrated. */
  stages?: string;
  sort?: "age" | "price" | "marketCap" | "liquidity" | "volume" | "txns" | "holders" | "change5m" | "change1h" | "change24h" | "progress" | "tax";
  dir?: "asc" | "desc";
  cursor?: string;
  q?: string;
  creator?: string;
  /** Minimum market cap in USD. */
  mcap?: number;
  /** Minimum 24 h volume in USD. */
  vol?: number;
  socials?: boolean;
}

export interface LaunchPair {
  mint: string;
  kind: string;
  symbol: string;
  name: string;
  logo: string | null;
  decimals: number;
  tokenProgram: string;
  issuer?: string | null;
  creatorFeeConfigurable?: boolean;
  [field: string]: unknown;
}

export interface PairCatalog {
  pairs: LaunchPair[];
  customFees?: unknown;
  maxCreatorFeeBps?: number | null;
  maxDepth?: number | null;
  [field: string]: unknown;
}

export interface SocialLookup {
  provider: string;
  handle: string;
  accountId: string;
  avatarUrl: string | null;
  name: string | null;
  verified: boolean;
  hasVault: boolean;
  claimed: boolean;
}

export interface LaunchResultSolana {
  mint: string;
  pool: string;
  escrow: string;
  signatures: string[];
  prepared: PreparedSolanaLaunch;
}

export interface SwapResult {
  signature: string;
  quote: SolanaQuote;
}
