import { Connection, PublicKey } from "@solana/web3.js";

import { ApiClient, type ApiOptions } from "../shared/api.js";
import { StealthApiError, StealthError, StealthFeeTooHighError, StealthInputError, StealthTransactionMismatchError } from "../shared/errors.js";
import { MIX_LIMITS, TEAM_LIMITS, type SolanaVenue } from "./constants.js";
import { decodeTransaction, encodeTransaction, feePayerOf, type AnyTransaction, type SolanaSigner } from "./signer.js";
import type {
  BuiltSwap,
  EncodedTransaction,
  LaunchResultSolana,
  PairCatalog,
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
  private readonly signer: SolanaSigner | undefined;
  private readonly connection: Connection | undefined;
  private readonly pollMs: number;
  private readonly confirmTimeoutMs: number;
  private readonly bundleTimeoutMs: number;

  constructor(opts: StealthSolanaOptions = {}) {
    this.api = new ApiClient(opts);
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
  /** What a coin can pair with on `venue`. Limit: 60 a minute per IP. */
  getPairs(venue: SolanaVenue = "raydium") {
    return this.api.get<PairCatalog>("/sol/launch/pairs", { venue });
  }
  /** Any token by name, ticker or address, and whether `venue` can pair with it. Limit: 60 a minute. */
  searchPairs(q: string, venue: SolanaVenue = "raydium") {
    return this.api.get<{ [k: string]: unknown }>("/sol/launch/pairs/search", { q, venue });
  }
  /** One pair: its first-buy cap, what its curve raises and what a launch on it pays. Limit: 60 a minute. */
  getPair(mint: string, opts: { venue?: SolanaVenue; taxTier?: string; globalTaxBps?: number } = {}) {
    return this.api.get<{ [k: string]: unknown }>(`/sol/launch/pairs/${mint}`, opts);
  }
  /** A wallet launch's address against its chain, the same check the launch makes. Limit: 60 a minute. */
  checkPayout(chainId: number, address: string) {
    return this.api.get<{ ok: boolean; chainId: number; vmType: string; displayName: string | null }>("/sol/launch/payout-check", { chainId, address });
  }
  /** A social account's permanent id, for a social launch. Limit: 20 a minute. Off while the server has social fees off. */
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
    return this.api.get<SolanaToken>(`/sol/tokens/${mint}`);
  }
  /** Read from the pool now, when it can be. Limit: 120 a minute. */
  getPrice(mint: string) {
    return this.api.get<{ priceSol: number; priceUsd: number; marketCapUsd: number; solUsd: number; at: number; live: boolean }>(`/sol/tokens/${mint}/price`);
  }
  getTrades(mint: string, cursor?: string) {
    return this.api.get<unknown>(`/sol/tokens/${mint}/trades`, { cursor });
  }
  getHolders(mint: string) {
    return this.api.get<unknown>(`/sol/tokens/${mint}/holders`);
  }
  /** A coin's locked launch type and slices. */
  getFeePlan(mint: string) {
    return this.api.get<unknown>(`/sol/tokens/${mint}/fee-plan`);
  }
  getBuybacks(mint: string) {
    return this.api.get<unknown>(`/sol/tokens/${mint}/buybacks`);
  }
  getRewards(mint: string) {
    return this.api.get<unknown>(`/sol/tokens/${mint}/rewards`);
  }
  getPortfolio(owner: string) {
    return this.api.get<unknown>(`/sol/portfolio/${owner}`);
  }
  getBalance(owner: string, mint?: string) {
    return this.api.get<{ lamports: string; tokenBaseUnits: string | null }>(`/sol/balance/${owner}`, { mint });
  }
  /** Fees are claimed by the server's bot. This says when it next runs. */
  getPayoutStatus(mint: string) {
    return this.api.get<{ enabled: boolean; nextAt: number | null; minLamports: string }>(`/sol/tokens/${mint}/payout`);
  }
  /** Runs a coin's payout now instead of waiting for the bot. Anyone may ask. Limit: 6 a minute, with a cooldown per coin. */
  requestPayout(mint: string) {
    return this.api.post<{ txs: string[]; retryAt: number | null; paid: boolean }>(`/sol/tokens/${mint}/payout`);
  }

  // ---- launch --------------------------------------------------------------------------------------------------------

  /** Asks the API to build a launch. Nothing lands until it's signed and sent. Limit: 10 per 10 minutes, per IP. */
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
    return this.api.get<SolanaQuote>("/sol/quote", { mint, side, amount: amount.toString(), slippageBps });
  }

  /** The API's unsigned swap. Limit: 60 a minute. */
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

  /** Sends one signed transaction. Limit through the API: 60 a minute. */
  async send(base64: string): Promise<string> {
    if (this.connection) return this.connection.sendEncodedTransaction(base64, { preflightCommitment: "confirmed", maxRetries: 5 });
    return (await this.api.post<{ signature: string }>("/sol/send", { transaction: base64 })).signature;
  }

  /** Waits until a signature is confirmed, or throws. */
  async confirm(signature: string): Promise<void> {
    const end = Date.now() + this.confirmTimeoutMs;
    while (Date.now() < end) {
      const s = await this.status(signature).catch(() => null);
      if (s?.status === "confirmed") return;
      if (s?.status === "failed") throw new StealthError(`Transaction ${signature} failed: ${s.error ?? "on chain"}.`);
      await sleep(this.pollMs);
    }
    throw new StealthError(`Transaction ${signature} wasn't confirmed in time. It may still land: check it before sending again.`);
  }

  /** `pending`, `confirmed` or `failed`. */
  async status(signature: string): Promise<{ status: "pending" | "confirmed" | "failed"; error: string | null }> {
    if (!this.connection) return this.api.get(`/sol/tx/${signature}`);
    const st = (await this.connection.getSignatureStatuses([signature])).value[0];
    if (!st) return { status: "pending", error: null };
    if (st.err) return { status: "failed", error: JSON.stringify(st.err).slice(0, 200) };
    return { status: st.confirmationStatus === "processed" ? "pending" : "confirmed", error: null };
  }

  /** A bundle lands whole or not at all, and Jito drops duplicates, so it's resent until the first transaction confirms. Limit: 40 a minute. */
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
          if (error instanceof StealthApiError && error.status === 400) throw error;
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      if (signatures.length) {
        const s = await this.status(signatures[0]!).catch(() => null);
        if (s?.status === "confirmed") {
          for (const sig of signatures.slice(1)) {
            const t = await this.status(sig).catch(() => null);
            if (t?.status === "failed") throw new StealthError(`Transaction ${sig} failed: ${t.error ?? "on chain"}.`);
          }
          return signatures;
        }
        if (s?.status === "failed") throw new StealthError(`Transaction ${signatures[0]} failed: ${s.error ?? "on chain"}.`);
        if (bundleId) {
          const b = await this.api.get<{ status: string }>(`/sol/bundle/${bundleId}`).catch(() => null);
          if (b?.status === "failed") throw new StealthError("Jito rejected the launch bundle.");
        }
      }
      await sleep(this.pollMs);
    }
    throw new StealthError(`The bundle didn't land before its blockhash expired${lastError ? `: ${lastError}` : ""}.`);
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

export const createStealthSolana = (opts: StealthSolanaOptions = {}) => new StealthSolana(opts);

