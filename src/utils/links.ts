/**
 * Links to the site, built the way the site routes them, so every tool links a coin the same way.
 *
 * @module
 */
import { getChain } from "./chains.js";

/** The site. */
export const SITE_URL = "https://juststealthit.xyz";

export interface CoinLinkInput {
  address: string;
  /** A chain key (or alias). Default `solana`. */
  chain?: string | null;
  /**
   * Whether the coin launched on Just Stealth It. `false` (an external trending coin) opens its `/trending` page, since `/token`
   * has no page for it. Default true. A row with `outside` set, or a trending entry's `onPlatform: false`, is external.
   */
  onPlatform?: boolean;
}

/**
 * The site's page for a coin. A coin launched here is `/token/{address}`, with `?chain=` for an EVM one (two chains can give
 * sibling multi-chain coins the same 0x address); an external coin is `/trending/{address}`, with `?chain=` off Solana.
 *
 * ```ts
 * coinPageUrl({ address: mint });                                    // https://juststealthit.xyz/token/<mint>
 * coinPageUrl({ address: "0x…", chain: "bnb", onPlatform: false });  // https://juststealthit.xyz/trending/0x…?chain=bnb
 * ```
 */
export function coinPageUrl(coin: CoinLinkInput, siteUrl: string = SITE_URL): string {
  const chain = coin.chain ? (getChain(coin.chain)?.key ?? coin.chain) : "solana";
  const base = siteUrl.replace(/\/+$/, "");
  const page = coin.onPlatform === false ? "trending" : "token";
  const query = chain === "solana" ? "" : `?chain=${encodeURIComponent(chain)}`;
  return `${base}/${page}/${encodeURIComponent(coin.address)}${query}`;
}
