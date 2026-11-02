/** The contracts' constants (StealthConstants.sol). Tiers, the split and the sniper line are compiled in: no admin can move them. */

/** A launch's tax tier in bps, picked at launch and locked. */
export type EvmTaxBps = 125 | 225 | 325 | 425 | 575;
export const EVM_TAX_TIERS = [125, 225, 325, 425, 575] as const satisfies readonly EvmTaxBps[];
export const EVM_DEFAULT_TAX_BPS: EvmTaxBps = 125;

/** The coin's share of its tier, in bps of the tier. The platform gets the rest of the tax. */
export const EVM_COIN_SHARE_BPS = 7_000;

export const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
export const TOKEN_DECIMALS = 18;
/** The first buy stops at 5% of supply, or less with a max wallet or max buy. */
export const FIRST_BUY_MAX_TOKENS = 50_000_000n * 10n ** 18n;

/** 90% in the launch's own second, then a straight line down, one step per second, to the tier at 15 s. Buys and sells pay it alike. */
export const SNIPER_START_BPS = 9_000;
export const SNIPER_WINDOW_SEC = 15;

export const LIMITS = {
  nameBytes: 64,
  symbolBytes: 32,
  logoBytes: 512,
  descriptionBytes: 1024,
  socialBytes: 256,
  teamMin: 2,
  teamMax: 10,
  maxWalletBps: { min: 50, max: 500 },
  maxBuyBps: { min: 10, max: 500 },
  limitsWindowSec: 3_600,
  firstBuyLockSec: 90 * 86_400,
} as const;

/** The on-chain launch types, in ABI order. */
export const EVM_LAUNCH_TYPES = ["creator", "team", "marketing", "holders", "buyback", "pot"] as const;
export type EvmLaunchType = (typeof EVM_LAUNCH_TYPES)[number];

/**
 * What a direct launch can pick. `pot` isn't here: its pot follows a fee plan stored by the site when it launches a coin, and a coin
 * launched directly has none, so its fees would wait in the vault with no way out.
 */
export type EvmDirectLaunchType = Exclude<EvmLaunchType, "pot">;
