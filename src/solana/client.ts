import { Connection, PublicKey } from "@solana/web3.js";

import { SolApi, type SolHolder, type TokenBuybacks, type TokenFeePlan, type TokenRewards } from "../api/sol.js";
import type { CursorPage, ApiTrade } from "../api/common.js";
import type { MarketQuote } from "../api/sol-market.js";
import type { Portfolio } from "../api/wallets.js";
import { StakingApi, type StakeSubmitResult } from "../api/staking.js";
import { ApiClient, type ApiOptions } from "../shared/api.js";
import { StealthApiError, StealthError, StealthFeeTooHighError, StealthInputError, StealthTransactionError, StealthTransactionMismatchError } from "../shared/errors.js";
import { MIX_LIMITS, TEAM_LIMITS, type SolanaVenue } from "./constants.js";
import { decodeTransaction, encodeTransaction, feePayerOf, type AnyTransaction, type SolanaSigner } from "./signer.js";
import type {
  BuiltSwap,
  EncodedTransaction,
  LaunchResultSolana,
  PairCatalog,
  PairDetail,
  PairSearch,
  PreparedSolanaLaunch,
  SocialLookup,
  SolanaLaunchInput,
  SolanaQuote,
  SolanaToken,
  SwapResult,
  TokenListOptions,
  TokenPage,
} from "./types.js";

export interface StealthSolanaOptions extends ApiOptions {
  /** Signs launches and trades. Reads don't need one. */
  signer?: SolanaSigner;
  /** Send and confirm through your own RPC. Default: through the API. Bundles always go through the API. */
  connection?: Connection;
  /** Between confirmation checks. Default 1,200 ms. */
  pollMs?: number;
  /** How long to wait for a confirmation. Default 90 s. */
  confirmTimeoutMs?: number;
  /** How long to keep resubmitting a bundle. Default 70 s, past which its blockhash has expired. */
  bundleTimeoutMs?: number;
}

export interface SolanaTradeOptions {
  mint: string;
  /** Buy: lamports (or the pair's base units on a Pump pair). Sell: token base units, 6 decimals. */
  amount: bigint;
  /** 10 to 5,000. Default 300. */
  slippageBps?: number;
  /** Refuses a trade charged above this. Default 1,000 (10%), which only a coin's first seconds reach. */
  maxFeeBps?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A path segment: an address, signature or id, never a path of its own. */
const seg = (v: string) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw new StealthInputError(`${String(v)} isn't an address, signature or id.`);
  return v;
};
const text = (v: string) => v.trim();

/** Mirrors the API's request schema (launch-request.ts), to fail early. The API has the last word. */
export function checkSolanaLaunch(input: SolanaLaunchInput) {
  const name = text(input.name);
  const symbol = text(input.symbol);
  if (name.length < 1 || name.length > 32) throw new StealthInputError("name must be 1 to 32 characters.");
  if (symbol.length < 1 || symbol.length > 10) throw new StealthInputError("symbol must be 1 to 10 characters.");
  if ((input.description ?? "").length > 1000) throw new StealthInputError("description must be at most 1,000 characters.");
  if ((input.firstBuyLamports ?? 0n) < 0n) throw new StealthInputError("firstBuyLamports can't be negative.");
  const mode = input.feeMode ?? "creator";
  if ((mode as string) === "jackpot") throw new StealthInputError("Unknown launch type jackpot.");
  if (mode === "team") {
    const team = input.team ?? [];
    if (team.length < TEAM_LIMITS.min || team.length > TEAM_LIMITS.max) throw new StealthInputError(`A team has ${TEAM_LIMITS.min} to ${TEAM_LIMITS.max} wallets.`);
    if (team.reduce((n, m) => n + m.bps, 0) !== 10_000) throw new StealthInputError("Team shares must add up to 10,000 bps.");
  }
  if (mode === "wallet" ? !input.payout : !!input.payout) throw new StealthInputError(mode === "wallet" ? "A wallet launch needs `payout`." : "`payout` only goes with a wallet launch.");
  if (mode === "feed" ? !input.feed : !!input.feed) throw new StealthInputError(mode === "feed" ? "Feed a Coin needs `feed`." : "`feed` only goes with Feed a Coin.");
  if (mode === "social" && input.recipient?.kind !== "social") throw new StealthInputError("A social launch needs a social `recipient`.");
  if (mode === "mix") {
    const mix = input.mix ?? [];
    if (mix.length < MIX_LIMITS.minSlices || mix.length > MIX_LIMITS.maxSlices) throw new StealthInputError(`A Mix has ${MIX_LIMITS.minSlices} to ${MIX_LIMITS.maxSlices} slices.`);
    if (new Set(mix.map((s) => s.kind)).size !== mix.length) throw new StealthInputError("Each kind of slice can appear once.");
    if (mix.some((s) => s.bps < MIX_LIMITS.minBps)) throw new StealthInputError(`Each slice needs at least ${MIX_LIMITS.minBps} bps.`);
    if (mix.reduce((n, s) => n + s.bps, 0) !== 10_000) throw new StealthInputError("The slices must add up to 10,000 bps.");
  } else if (input.mix?.length) throw new StealthInputError("Slices only go with a Mix.");
}

/**
 * Solana through the Just Stealth It API. A launch can't be built off the API: the coin's escrow comes from a key the server holds, and the
 * mint is the server's to sign. So launches and trades are built there, checked and signed here, and sent. The API never sees a key.
 */
export class StealthSolana {
  readonly api: ApiClient;
  /** Every Solana read, typed: tokens, burns, marketing, the Jupiter market and wallets. Shares this client's HTTP settings. */
  readonly data: SolApi;
  /** $STEALTH staking reads and raw calls. {@link stake} / {@link unstake} sign and submit for you. */
  readonly staking: StakingApi;
  private readonly signer: SolanaSigner | undefined;
  private readonly connection: Connection | undefined;
  private readonly pollMs: number;
  private readonly confirmTimeoutMs: number;
  private readonly bundleTimeoutMs: number;

  constructor(opts: StealthSolanaOptions = {}) {
    this.api = new ApiClient(opts);
    this.data = new SolApi(this.api);
    this.staking = new StakingApi(this.api);
    this.signer = opts.signer;
    this.connection = opts.connection;
    this.pollMs = opts.pollMs ?? 1_200;
    this.confirmTimeoutMs = opts.confirmTimeoutMs ?? 90_000;
    this.bundleTimeoutMs = opts.bundleTimeoutMs ?? 70_000;
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------

  /** Whether the site is open, and its public settings. */
  getAppConfig() {
    return this.api.get<{ comingSoon: boolean; comingSoonUntil: string | null; officialCa: string; [k: string]: unknown }>("/app-config");
  }
  /** Venues, tiers and launch types as this server has them right now. */
  getConfig() {
    return this.api.get<{ venues: unknown[]; feeModes: unknown[]; [k: string]: unknown }>("/sol/config");
  }
  /** What a coin can pair with on `venue`. */
  getPairs(venue: SolanaVenue = "raydium") {
    return this.api.get<PairCatalog>("/sol/launch/pairs", { venue });
  }
  /** Any token by name, ticker or address, and whether `venue` can pair with it. */
  searchPairs(q: string, venue: SolanaVenue = "raydium") {
    return this.api.get<PairSearch>("/sol/launch/pairs/search", { q, venue });
  }
  /** One pair: its first-buy cap, what its curve raises and what a launch on it pays. */
  getPair(mint: string, opts: { venue?: SolanaVenue; taxTier?: string; globalTaxBps?: number } = {}) {
    return this.api.get<PairDetail>(`/sol/launch/pairs/${seg(mint)}`, opts);
  }
  /** A wallet launch's address against its chain, the same check the launch makes. */
  checkPayout(chainId: number, address: string) {
    return this.api.get<{ ok: boolean; chainId: number; vmType: string; displayName: string | null }>("/sol/launch/payout-check", { chainId, address });
  }
  /** A social account's permanent id, for a social launch. Off while the server has social fees off. */
  lookupSocial(provider: string, handle: string) {
    return this.api.get<SocialLookup>("/social-fees/lookup", { provider, handle });
  }
  getTokens(opts: TokenListOptions = {}) {
    return this.api.get<TokenPage>("/sol/tokens", { ...opts, socials: opts.socials ? 1 : undefined });
  }
  searchTokens(q: string, limit = 8) {
    return this.api.get<SolanaToken[]>("/sol/tokens/search", { q, limit });
  }
  getToken(mint: string) {
    return this.api.get<SolanaToken>(`/sol/tokens/${seg(mint)}`);
  }
  /** Read from the pool now, when it can be. */
  getPrice(mint: string) {
    return this.api.get<{ priceSol: number; priceUsd: number; marketCapUsd: number; solUsd: number; at: number; live: boolean }>(`/sol/tokens/${seg(mint)}/price`, undefined, { cache: false });
  }
  /** One page of a coin's trades, newest first. For every page, use `data.tokens.iterateTrades(mint)`. */
  getTrades(mint: string, cursor?: string) {
    return this.api.get<CursorPage<ApiTrade>>(`/sol/tokens/${seg(mint)}/trades`, { cursor });
  }
  getHolders(mint: string) {
    return this.api.get<SolHolder[]>(`/sol/tokens/${seg(mint)}/holders`);
  }
  /** A coin's locked launch type and slices. */
  getFeePlan(mint: string) {
    return this.api.get<TokenFeePlan>(`/sol/tokens/${seg(mint)}/fee-plan`);
  }
  getBuybacks(mint: string) {
    return this.api.get<TokenBuybacks>(`/sol/tokens/${seg(mint)}/buybacks`);
  }
  getRewards(mint: string) {
    return this.api.get<TokenRewards>(`/sol/tokens/${seg(mint)}/rewards`);
  }
  getPortfolio(owner: string) {
    return this.api.get<Portfolio>(`/sol/portfolio/${seg(owner)}`);
  }
  getBalance(owner: string, mint?: string) {
    return this.api.get<{ lamports: string; tokenBaseUnits: string | null }>(`/sol/balance/${seg(owner)}`, { mint });
  }
  /** Fees are claimed by the server's bot. This says when it next runs. */
  getPayoutStatus(mint: string) {
    return this.api.get<{ enabled: boolean; nextAt: number | null; minLamports: string }>(`/sol/tokens/${seg(mint)}/payout`);
  }
  /** Runs a coin's payout now instead of waiting for the bot. Anyone may ask. */
  requestPayout(mint: string) {
    return this.api.post<{ txs: string[]; retryAt: number | null; paid: boolean }>(`/sol/tokens/${seg(mint)}/payout`);
  }

  // ---- launch --------------------------------------------------------------------------------------------------------

  /** Asks the API to build a launch. Nothing lands until it's signed and sent. */
  async prepareLaunch(input: SolanaLaunchInput): Promise<PreparedSolanaLaunch> {
    checkSolanaLaunch(input);
    const launcher = this.requireSigner().publicKey.toBase58();
    const { firstBuyLamports, recipient, socials, description, logo, ...rest } = input;
    return this.api.post<PreparedSolanaLaunch>("/sol/launch", {
      ...rest,
      name: text(input.name),
      symbol: text(input.symbol),
      description: description ?? "",
      logo: logo ?? "",
      socials: socials ?? {},
      firstBuyLamports: (firstBuyLamports ?? 0n).toString(),
      launcher,
      recipient: recipient ?? { kind: "wallet", wallet: launcher },
    });
  }

  /** Builds, signs and sends a launch, and waits until it's confirmed. */
  async launch(input: SolanaLaunchInput | PreparedSolanaLaunch): Promise<LaunchResultSolana> {
    const prepared = "transaction" in input ? input : await this.prepareLaunch(input);
    const signatures = await this.submit([{ transaction: prepared.transaction, version: prepared.version }, ...(prepared.followUps ?? [])], { bundle: prepared.bundle });
    return { mint: prepared.mint, pool: prepared.pool, escrow: prepared.escrow, signatures, prepared };
  }

  // ---- trades --------------------------------------------------------------------------------------------------------

  quote(mint: string, side: "buy" | "sell", amount: bigint, slippageBps = 300) {
    if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 5_000) throw new StealthInputError("slippageBps is 10 to 5,000.");
    return this.api.get<SolanaQuote>("/sol/quote", { mint, side, amount: amount.toString(), slippageBps }, { cache: false });
  }

  /** The API's unsigned swap. */
  buildSwap(o: SolanaTradeOptions & { side: "buy" | "sell" }) {
    return this.api.post<BuiltSwap>("/sol/swap", { mint: o.mint, owner: this.requireSigner().publicKey.toBase58(), side: o.side, amount: o.amount.toString(), slippageBps: o.slippageBps ?? 300 });
  }

  buy(o: SolanaTradeOptions) {
    return this.trade({ ...o, side: "buy" });
  }

  sell(o: SolanaTradeOptions) {
    return this.trade({ ...o, side: "sell" });
  }

  private async trade(o: SolanaTradeOptions & { side: "buy" | "sell" }): Promise<SwapResult> {
    const built = await this.buildSwap(o);
    const max = o.maxFeeBps ?? 1_000;
    if (built.quote.feeBps > max) throw new StealthFeeTooHighError(built.quote.feeBps, max);
    const [signature] = await this.submit([{ transaction: built.transaction, version: "v0" }]);
    return { signature: signature!, quote: built.quote };
  }

  // ---- any token, through Jupiter -----------------------------------------------------------------------------------

  /** A Jupiter-routed quote for any Solana token. Buy: lamports in. Sell: the token's base units in. */
  marketQuote(mint: string, side: "buy" | "sell", amount: bigint, slippageBps = 300) {
    return this.data.market.quote(mint, side, amount, slippageBps);
  }

  /** Buys any Solana token with SOL through Jupiter: built by the API, checked, signed here, sent and confirmed. */
  marketBuy(o: MarketTradeOptions) {
    return this.marketTrade({ ...o, side: "buy" });
  }

  /** Sells any Solana token for SOL through Jupiter. */
  marketSell(o: MarketTradeOptions) {
    return this.marketTrade({ ...o, side: "sell" });
  }

  private async marketTrade(o: MarketTradeOptions & { side: "buy" | "sell" }): Promise<MarketSwapResult> {
    const owner = this.requireSigner().publicKey.toBase58();
    const built = await this.data.market.buildSwap({ mint: o.mint, owner, side: o.side, amount: o.amount, slippageBps: o.slippageBps });
    const max = o.maxPriceImpactPct;
    if (max !== undefined && built.quote.priceImpactPct !== null && built.quote.priceImpactPct > max) {
      throw new StealthInputError(`This trade moves the price ${built.quote.priceImpactPct.toFixed(2)}%, above the ${max}% limit.`);
    }
    if (BigInt(built.quote.minAmountOut) <= 0n) throw new StealthTransactionMismatchError("The swap would accept nothing back, so it wasn't signed.");
    const [signature] = await this.submit([{ transaction: built.transaction, version: "v0" }]);
    return { signature: signature!, quote: built.quote };
  }

  /**
   * Buys or sells by whichever route trades the coin: its own venue for a launchpad coin still there (`sol.swapVia === "app"`),
   * Jupiter for everything else. Returns the route it took.
   */
  async swap(o: SolanaTradeOptions & { side: "buy" | "sell"; maxPriceImpactPct?: number }): Promise<(SwapResult & { route: "app" }) | (MarketSwapResult & { route: "jupiter" })> {
    const token = await this.data.tokens.find(o.mint);
    if (token?.sol.swapVia === "app") return { ...(await this.trade(o)), route: "app" };
    return { ...(await this.marketTrade(o)), route: "jupiter" };
  }

  // ---- staking -------------------------------------------------------------------------------------------------------

  /** Stakes `amount` base units of the pool's coin: prepares, checks the payer, signs and submits. Default pool `stealth`. */
  async stake(amount: bigint, pool = "stealth"): Promise<StakeSubmitResult & { actionId: number }> {
    const owner = this.requireSigner().publicKey.toBase58();
    const prepared = await this.staking.prepareStake(pool, owner, amount);
    return { ...(await this.signAndSubmitStaking(prepared.actionId, prepared.transaction)), actionId: prepared.actionId };
  }

  /** Unstakes `amount` base units of receipts. The coins and reward are released after the pool's cooldown. */
  async unstake(amount: bigint, pool = "stealth"): Promise<StakeSubmitResult & { actionId: number; unlockInSec: number }> {
    const owner = this.requireSigner().publicKey.toBase58();
    const prepared = await this.staking.prepareUnstake(pool, owner, amount);
    return { ...(await this.signAndSubmitStaking(prepared.actionId, prepared.transaction)), actionId: prepared.actionId, unlockInSec: prepared.unlockInSec };
  }

  /** The staking wallet has co-signed the exact bytes, so the transaction is signed as it came, never rebuilt. */
  private async signAndSubmitStaking(actionId: number, transaction: string): Promise<StakeSubmitResult> {
    const signer = this.requireSigner();
    const tx = decodeTransaction(transaction);
    this.assertPaidBy(tx, signer.publicKey);
    const signed = await signer.signTransaction(tx);
    return this.staking.submit(actionId, encodeTransaction(signed));
  }

  // ---- sending -------------------------------------------------------------------------------------------------------

  /** Checks, signs and sends API-built transactions, in order, or as one Jito bundle, and waits for them. Returns their signatures. */
  async submit(txs: EncodedTransaction[], opts: { bundle?: boolean } = {}): Promise<string[]> {
    const signer = this.requireSigner();
    const decoded = txs.map((t) => decodeTransaction(t.transaction));
    for (const tx of decoded) this.assertPaidBy(tx, signer.publicKey);
    const signed = await this.signAll(signer, decoded);
    const encoded = signed.map(encodeTransaction);
    if (encoded.length > 1 && opts.bundle) return this.sendBundle(encoded);
    const signatures: string[] = [];
    for (const tx of encoded) {
      const signature = await this.send(tx);
      await this.confirm(signature);
      signatures.push(signature);
    }
    return signatures;
  }

  /** Sends one signed transaction. */
  async send(base64: string): Promise<string> {
    if (this.connection) return this.connection.sendEncodedTransaction(base64, { preflightCommitment: "confirmed", maxRetries: 5 });
    return (await this.api.post<{ signature: string }>("/sol/send", { transaction: base64 })).signature;
  }

  /** Waits until a signature is confirmed, or throws. */
  async confirm(signature: string): Promise<void> {
    const end = Date.now() + this.confirmTimeoutMs;
    while (Date.now() < end) {
      const s = await this.status(signature).catch((error: unknown) => {
        // a refusal (a malformed signature, say) won't change by waiting; outages and rate limits might
        if (error instanceof StealthInputError) throw error;
        if (error instanceof StealthApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) throw error;
        return null;
      });
      if (s?.status === "confirmed") return;
      if (s?.status === "failed") throw new StealthTransactionError(`Transaction ${signature} failed: ${s.error ?? "on chain"}.`, signature);
      await sleep(this.pollMs);
    }
    throw new StealthTransactionError(`Transaction ${signature} wasn't confirmed in time. It may still land: check it before sending again.`, signature, { code: "confirmation_timeout" });
  }

  /** `pending`, `confirmed` or `failed`. */
  async status(signature: string): Promise<{ status: "pending" | "confirmed" | "failed"; error: string | null }> {
    if (!this.connection) return this.api.get(`/sol/tx/${seg(signature)}`, undefined, { cache: false });
    const st = (await this.connection.getSignatureStatuses([signature])).value[0];
    if (!st) return { status: "pending", error: null };
    if (st.err) return { status: "failed", error: JSON.stringify(st.err).slice(0, 200) };
    return { status: st.confirmationStatus === "processed" ? "pending" : "confirmed", error: null };
  }

  /** A bundle lands whole or not at all, and Jito drops duplicates, so it's resent until the first transaction confirms. */
  private async sendBundle(encoded: string[]): Promise<string[]> {
    const end = Date.now() + this.bundleTimeoutMs;
    let signatures: string[] = [];
    let bundleId: string | null = null;
    let lastSubmit = 0;
    let lastError = "";
    while (Date.now() < end) {
      if (Date.now() - lastSubmit > 4_000) {
        lastSubmit = Date.now();
        try {
          const r = await this.api.post<{ bundleId: string; signatures: string[] }>("/sol/send-bundle", { transactions: encoded });
          signatures = r.signatures;
          bundleId = r.bundleId;
        } catch (error) {
          // a malformed bundle, or a server without bundles, won't get better by resending
          if (error instanceof StealthApiError && (error.status === 400 || (error.status === 503 && error.code === "not_configured"))) throw error;
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      if (signatures.length) {
        const s = await this.status(signatures[0]!).catch(() => null);
        if (s?.status === "confirmed") {
          for (const sig of signatures.slice(1)) {
            const t = await this.status(sig).catch(() => null);
            if (t?.status === "failed") throw new StealthTransactionError(`Transaction ${sig} failed: ${t.error ?? "on chain"}.`, sig);
          }
          return signatures;
        }
        if (s?.status === "failed") throw new StealthTransactionError(`Transaction ${signatures[0]} failed: ${s.error ?? "on chain"}.`, signatures[0] ?? null);
        if (bundleId) {
          const b = await this.api.get<{ status: string }>(`/sol/bundle/${seg(bundleId)}`, undefined, { cache: false }).catch(() => null);
          if (b?.status === "failed") throw new StealthTransactionError("Jito rejected the launch bundle.", signatures[0] ?? null, { code: "bundle_rejected" });
        }
      }
      await sleep(this.pollMs);
    }
    throw new StealthTransactionError(`The bundle didn't land before its blockhash expired${lastError ? `: ${lastError}` : ""}.`, signatures[0] ?? null, { code: "bundle_expired" });
  }

  private async signAll(signer: SolanaSigner, txs: AnyTransaction[]): Promise<AnyTransaction[]> {
    if (txs.length > 1 && signer.signAllTransactions) return signer.signAllTransactions(txs);
    const out: AnyTransaction[] = [];
    for (const tx of txs) out.push(await signer.signTransaction(tx));
    return out;
  }

  /** Whoever pays a transaction authorises it: a transaction that names another payer isn't what this wallet asked for. */
  private assertPaidBy(tx: AnyTransaction, wallet: PublicKey) {
    if (!feePayerOf(tx)?.equals(wallet)) throw new StealthTransactionMismatchError("The API's transaction isn't paid by this wallet, so it wasn't signed.");
  }

  private requireSigner(): SolanaSigner {
    if (!this.signer) throw new StealthInputError("This needs a signer.");
    return this.signer;
  }

  /** The signer, for a multi-chain sign-in or payment. */
  get wallet(): SolanaSigner {
    return this.requireSigner();
  }
}

export interface MarketTradeOptions {
  mint: string;
  /** Buy: lamports of SOL. Sell: the token's base units. */
  amount: bigint;
  /** 10 to 5,000. Default 300. */
  slippageBps?: number;
  /** Refuses a route that moves the price more than this, in percent. Default: no limit. */
  maxPriceImpactPct?: number;
}

export interface MarketSwapResult {
  signature: string;
  quote: MarketQuote;
}

export const createStealthSolana = (opts: StealthSolanaOptions = {}) => new StealthSolana(opts);

