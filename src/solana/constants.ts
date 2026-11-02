/** The Solana side's public setup: venues, tiers, launch types and the shared on-chain configs. */

export const SOLANA_VENUES = ["pump", "raydium", "meteora"] as const;
export type SolanaVenue = (typeof SOLANA_VENUES)[number];

export interface SolanaTier {
  id: string;
  /** What a trader pays per trade on the curve, in bps. */
  totalBps: number;
  /** The venue's own cut. */
  protocolBps: number;
  /** Just Stealth It's part. */
  platformBps: number;
  /** The coin's part: it lands in the coin's escrow, and the launch type spends it. */
  creatorBps: number;
  afterGraduation: { totalBps: number; lpBps: number; creatorBps: number };
  default: boolean;
}

const after = (totalBps: number, lpBps: number, creatorBps: number) => ({ totalBps, lpBps, creatorBps });

/**
 * Raydium LaunchLab. Raydium caps the creator fee at 0.5% on the curve, so higher tiers only add to the platform part: the coin gets 0.5%
 * on every tier, which is 50/50 at 1.25% and about 9% at 5.75%, and not the 70/30 of the other venues.
 */
export const RAYDIUM_TIERS: readonly SolanaTier[] = [
  { id: "t125", totalBps: 125, protocolBps: 25, platformBps: 50, creatorBps: 50, afterGraduation: after(125, 75, 50), default: true },
  { id: "t225", totalBps: 225, protocolBps: 25, platformBps: 150, creatorBps: 50, afterGraduation: after(150, 70, 80), default: false },
  { id: "t325", totalBps: 325, protocolBps: 25, platformBps: 250, creatorBps: 50, afterGraduation: after(150, 70, 80), default: false },
  { id: "t425", totalBps: 425, protocolBps: 25, platformBps: 350, creatorBps: 50, afterGraduation: after(150, 70, 80), default: false },
  { id: "t575", totalBps: 575, protocolBps: 25, platformBps: 500, creatorBps: 50, afterGraduation: after(150, 70, 80), default: false },
];

/** Meteora DBC. Meteora keeps 20% of the pool fee, and the rest splits 70 / 30 between the coin and the platform. After graduation the fee goes to the locked LP. */
export const METEORA_TIERS: readonly SolanaTier[] = [
  { id: "m100", totalBps: 125, protocolBps: 25, platformBps: 30, creatorBps: 70, afterGraduation: after(125, 125, 0), default: true },
  { id: "m180", totalBps: 225, protocolBps: 45, platformBps: 54, creatorBps: 126, afterGraduation: after(225, 225, 0), default: false },
  { id: "m260", totalBps: 325, protocolBps: 65, platformBps: 78, creatorBps: 182, afterGraduation: after(325, 325, 0), default: false },
  { id: "m340", totalBps: 425, protocolBps: 85, platformBps: 102, creatorBps: 238, afterGraduation: after(425, 425, 0), default: false },
  { id: "m460", totalBps: 575, protocolBps: 115, platformBps: 138, creatorBps: 322, afterGraduation: after(575, 575, 0), default: false },
];

/** Pump.fun sets its own fee. Of the creator part, 70% goes to the coin's escrow and 30% to the platform, locked on chain at launch. */
export const PUMP_SHARES = { escrowBps: 7_000, platformBps: 3_000 } as const;

/** Meteora launches: 90% at launch, stepping down every second to the tier after 15 seconds. */
export const METEORA_SNIPER = { startBps: 9_000, seconds: 15 } as const;
/** Global tax stops on Meteora: a Token-2022 transfer fee, locked at launch, on SOL pairs. Off unless the server enables it. */
export const GLOBAL_TAX_STOPS_BPS = [50, 100, 200, 300, 500] as const;
/** Rent a Meteora launch pays for its own config, on any rate but 1.25% or a pair without a shared config. */
export const METEORA_OWN_CONFIG_RENT_LAMPORTS = 5_974_080n;

/** Where creator fees go, picked at launch and locked. `social` is `creator` with a social account as recipient. */
export const SOLANA_LAUNCH_TYPES = ["creator", "social", "team", "wallet", "marketing", "holders", "diamond", "buyback", "feed", "liquidity", "mix"] as const;
export type SolanaLaunchType = (typeof SOLANA_LAUNCH_TYPES)[number];

/** What a Mix can hold. */
export const MIX_SLICES = ["creator", "team", "wallet", "social", "marketing", "holders", "diamond", "buyback", "feed", "liquidity"] as const;
export type MixSliceKind = (typeof MIX_SLICES)[number];

export const TEAM_LIMITS = { min: 2, max: 10 } as const;
export const MIX_LIMITS = { minSlices: 2, maxSlices: 5, minBps: 100, teamMax: 5 } as const;
export const HOLDER_RULES = { minTokens: 10_000, maxTokens: 40_000_000 } as const;
export const SOLANA_TOKEN_DECIMALS = 6;
export const SOLANA_TOTAL_SUPPLY = 1_000_000_000;
export const SOCIAL_PROVIDERS = ["x", "twitch", "github", "tiktok"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

/** The programs a launch runs on. No program of our own: Just Stealth It runs on the venues' programs. */
export const SOLANA_PROGRAMS = {
  raydiumLaunchLab: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
  meteoraDbc: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
  addressLookupTable: "AddressLookupTab1e1111111111111111111111111",
} as const;

/** One Raydium LaunchLab platform per tax tier. */
export const LAUNCHLAB_PLATFORMS = {
  t125: "HHq1qkhbC7G76nJtZmxcjnGZ6UTstbNcDQMa6NCmW1BE",
  t225: "7hw8EGKe28zZdNovJNWmBz8fPcZGitBLDrcDuGsZ9Efo",
  t325: "AHxKtoiVuCJgBrDzBDiakt5BeitFvuLA2hmSsdF1B9XX",
  t425: "2cUNMwy4hcQAFfEYafGwCbiTtCW44hNRhb7Gy1qj6h4j",
  t575: "AqUUNbiMdn4aLLnRPvYQG1KsbPZRHpwBjYRT1ZQ9mwt9",
} as const;

/** The Raydium CPMM amm configs a graduated coin lands on: t125 the first, every other tier the second. */
export const CPMM_CONFIGS = {
  default: "52MZUkNsRYzP4gn2mCaLTVtJQy2tpoF79hp5K1HhAxxX",
  higher: "EwJc3KbDCfJyvCtTpLd58PMPkNBUMHnPioRLKHL3sQh1",
} as const;

/** The accounts Raydium and Pump launches share. */
export const LAUNCH_LOOKUP_TABLE = "6NmfmPKtzReAK1gbjaqog9mTGzFB6MCyvAgX79LWvnn";

export interface MeteoraSharedConfig {
  symbol: string;
  config: string;
  /** The raise in whole quote units. */
  targetUnits: number;
}

/** The shared Meteora DBC configs at the 1.25% rate, by quote mint. Each config's quote mint was read back from its account on chain. */
export const METEORA_SHARED_CONFIGS: Readonly<Record<string, MeteoraSharedConfig>> = {
  So11111111111111111111111111111111111111112: { symbol: "SOL", config: "D28DJbYAeZGQfdiTEa8L4Bso71RmYJ4STmE8o47P6XCE", targetUnits: 85 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", config: "57HfLa2MPz3YLV4UN7QFqMtgZ5aUQkTAVgP3BETXknGv", targetUnits: 8000 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", config: "J9MjcaNQ2rUm9eLaG8MtWsgXJFFrupASN8fz5c9YjuhR", targetUnits: 8000 },
  USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB: { symbol: "USD1", config: "321scyzh41gkLjz5JfAdLsBCxHq8FSZ2nyGiWWmDCbXG", targetUnits: 8000 },
  "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump": { symbol: "ANSEM", config: "H1wDK29QH1g3nP64soScyYhutNRxJY1Fm4RGLHC8dGEF", targetUnits: 165300 },
  ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82: { symbol: "BOME", config: "EJ3Aq5xhHJbvwoPRB55QRH7ediniArsinXCg4xY1NP8", targetUnits: 13190000 },
  GbbesPbaYh5uiAZSYNXTc7w9jty1rpg3P9L4JeN4LkKc: { symbol: "TRX", config: "CpJFWM1psGp687MdV9fmLyB79owmVcTn52JrJ8pz6sDE", targetUnits: 23790 },
  cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: { symbol: "cbBTC", config: "5icjeHGxLJdpMMoneL2TD59YPiVgGfKHuhyUoaYrhFRh", targetUnits: 0.1063 },
  A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS: { symbol: "ZEC", config: "FBZXKhaGMWU5E4BkUVUtphRVAg9noVxzTMcEFPRM5b39", targetUnits: 6.613 },
  "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump": { symbol: "Fartcoin", config: "2MGA8HooQtJJiJXgL7ijBrMjDGvvRgMrDtWJdBW3siG7", targetUnits: 69410 },
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": { symbol: "ETH", config: "BUy7gA9geY9fhzDo2N43PamvbYc7vPv8WjCLvoLfy7AS", targetUnits: 3.675 },
  BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy: { symbol: "BP", config: "2MdixPMBNGPWAWXqpJj3G5pZcuQjerBahiPB2KH4CbeR", targetUnits: 8788 },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: { symbol: "$WIF", config: "6BLgHmjxZZp6cnWdhiMgnzAYVQD5RHfCoHKtbCeSEJY7", targetUnits: 47140 },
  "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN": { symbol: "TRUMP", config: "6qRWMt1Vr9XCgn7XCF9kBNKu7vfxTkZULprE4GmFuySa", targetUnits: 5275 },
  METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL: { symbol: "MET", config: "9qRzjsurZACkCVQv6MVR53QDsRZRx8BTMH8TSc9FWZWF", targetUnits: 29210 },
  CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp: { symbol: "CARDS", config: "HTQZ4ScSvQmHYdCYHZVFancysJLm3o3bLo5ENCgx25Xk", targetUnits: 30430 },
  "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv": { symbol: "PENGU", config: "2cKt1S8bH49V12mnCVWefJP9wtP31a7DiKBcAvuPsbUE", targetUnits: 1130000 },
  "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx": { symbol: "STONK", config: "AVgGoZaazMtbddEae7KM2EiQdUjX1u1BvHLnjqUB391H", targetUnits: 61320 },
  Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk: { symbol: "USELESS", config: "38Ff3PnZ69jWJXJABbLCTqvwapzM8mbtvrsVfVaZiL9t", targetUnits: 61500 },
  "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g": { symbol: "HYPE", config: "FKpBSS8yieuY3hHH4LPFbcMXdRkErUxM4VYDuDsggsTH", targetUnits: 89.78 },
};
