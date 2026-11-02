import { ComputeBudgetProgram, PublicKey, SystemInstruction, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import type { Address, Hash, WalletClient } from "viem";

import { EVM_CHAINS } from "../evm/chains.js";
import { ApiClient, type ApiOptions } from "../shared/api.js";
import { StealthError, StealthInputError, StealthTransactionMismatchError } from "../shared/errors.js";
import { type StealthSolana } from "../solana/client.js";
import type { MixSliceKind, SolanaVenue } from "../solana/constants.js";
import { base58Encode, decodeTransaction, encodeTransaction, feePayerOf } from "../solana/signer.js";
import type { PayoutTarget, SolanaSocials, TeamShare } from "../solana/types.js";

export const MULTICHAIN_CHAINS = ["solana", "robinhood", "bnb", "hyperevm", "base", "arc"] as const;
export type MultichainChain = (typeof MULTICHAIN_CHAINS)[number];

export interface McChainOffer {
  chain: MultichainChain;
  name: string;
  native: string;
  chainId: number;
  available: boolean;
  reason: string | null;
}

export interface McConfig {
  enabled: boolean;
  chains: McChainOffer[];
  limits?: { maxRequestUsd: number; maxDayUsd: number; perDay: number };
  bufferBps?: number;
  retries?: number;
}

export interface McMixSlice {
  kind: MixSliceKind;
  bps: number;
  team?: TeamShare[];
  payout?: PayoutTarget;
  feed?: { token: string };
}

/** POST /multichain/simulate's body. One launch makes a separate coin on each chain. */
export interface McLaunchInput {
  /** The chain that pays. A Solana wallet pays from Solana, an EVM wallet from its EVM chain. */
  home: MultichainChain;
  /** Default: every chain on offer. */
  chains?: MultichainChain[];
  name: string;
  symbol: string;
  description?: string;
  logo?: string;
  socials?: SolanaSocials;
  /** The Solana leg's venue and tier. */
  venue?: SolanaVenue;
  taxTier?: string;
  /** The EVM legs' tier. Default 125. */
  taxBps?: 125 | 225 | 325 | 425 | 575;
  feeMode?: "creator" | "social" | "team" | "marketing" | "holders" | "buyback" | "wallet" | "diamond" | "feed" | "liquidity" | "mix";
  team?: TeamShare[];
  payout?: PayoutTarget;
  feed?: { token: string };
  mix?: McMixSlice[];
  social?: { provider: string; handle: string; accountId?: string; acknowledged?: boolean };
  quoteMint?: string;
  stockSymbol?: string;
  globalTaxBps?: number;
  creatorFeeBps?: number;
  /** Dev buy on every chain, in the home coin's raw units. */
  devBuyRaw?: bigint;
  /** Dev buy chain by chain, in the home coin's raw units. A chain left out gets none. */
  devBuys?: Partial<Record<MultichainChain, bigint>>;
  /** An EVM payer's Solana dev buy goes here. */
  solTokensTo?: string;
}

/** Each amount is in that chain's own coin, except `share` and `relayFee`, which are in the home coin. */
export interface McSimChain {
  chain: MultichainChain;
  name: string;
  native: string;
  decimals: number;
  home: boolean;
  need: string;
  gas: string;
  launchCosts: string;
  devBuy: string;
  buffer: string;
  keep: string;
  share: string;
  relayFee: string;
  shareUsd: number;
  quote: string | null;
}

export interface McSimulation {
  quoteId: string;
  expiresAt: number;
  home: MultichainChain;
  native: string;
  decimals: number;
  /** What the launch costs, in the home coin's raw units. */
  total: string;
  usd: number;
  homeGas: string;
  chains: McSimChain[];
  notices: { chain: string; code: string; symbol?: string }[];
}

/** Solana: an unsigned transaction. EVM: a plain native transfer. */
export type McPayment = { chain: "solana"; to: string; amount: string; transaction: string } | { chain: string; chainId: number; to: string; amount: string };

export interface McOrderLeg {
  chain: MultichainChain;
  home: boolean;
  status: string;
  attempts: number;
  nextAt: number | null;
  share: string;
  refund: string | null;
  token: string | null;
  tx: string | null;
  error: string | null;
}

export interface McOrder {
  id: string;
  status: "quoted" | "running" | "done" | "partial" | "failed" | "expired";
  home: MultichainChain;
  name: string;
  symbol: string;
  total: string;
  depositAddress: string;
  expiresAt: number;
  retries: number;
  legs: McOrderLeg[];
}

export interface McGroup {
  id: string;
  name: string;
  symbol: string;
  home: string;
  coins: { chain: string; token: string; home: boolean }[];
}

const DONE = new Set(["done", "partial", "failed", "expired"]);
const raw = (v: bigint | undefined) => (v ?? 0n).toString();

/** A wallet that can sign the sign-in message. Smart-contract wallets can't sign in: the API accepts EOAs only. */
export interface McWallet {
  address: string;
  signMessage(message: string): Promise<string>;
}

/** The wallet behind a Solana client, for `signIn`. */
export function solanaMcWallet(sol: StealthSolana): McWallet {
  const signer = sol.wallet;
  return {
    address: signer.publicKey.toBase58(),
    signMessage: async (message) => {
      if (!signer.signMessage) throw new StealthInputError("This signer can't sign messages.");
      return base58Encode(await signer.signMessage(new TextEncoder().encode(message)));
    },
  };
}

/** An EVM wallet client's account, for `signIn`. */
export function evmMcWallet(wallet: WalletClient): McWallet {
  const account = wallet.account;
  if (!account) throw new StealthInputError("The walletClient has no account.");
  return { address: account.address, signMessage: (message) => wallet.signMessage({ account, message }) };
}

/**
 * Multi-chain launches through the API: one payment on a home chain, a separate coin on each chain. Writes need a session, which the API
 * sets as a cookie. This class carries the cookie on a server. A browser page on another site can't get one, so run this server-side.
 *
 * The total comes from `simulate`, on the server, with real Relay quotes. An order spends a simulation by id, and the API reads the payment
 * from the chain, so nothing here can change a price. What it can do is refuse to pay a transfer that isn't the simulated one.
 */
export class StealthMultichain {
  readonly api: ApiClient;
  private readonly pollMs: number;

  constructor(opts: ApiOptions & { pollMs?: number } = {}) {
    this.api = new ApiClient(opts);
    this.pollMs = opts.pollMs ?? 5_000;
  }

  /** Which chains are on offer, and the limits. */
  getConfig() {
    return this.api.get<McConfig>("/multichain/config");
  }

  /** Proves a wallet with a one-time message. The session lasts 8 hours. */
  async signIn(wallet: McWallet): Promise<{ wallet: string; vm: "svm" | "evm" }> {
    const { nonce, message } = await this.api.post<{ nonce: string; message: string; expiresAt: number }>("/multichain/session/nonce", { wallet: wallet.address });
    const signature = await wallet.signMessage(message);
    return this.api.post("/multichain/session", { wallet: wallet.address, nonce, signature });
  }

  /** Prices a launch from real quotes. Nothing moves and nothing is reserved. The answer holds for two minutes. */
  simulate(input: McLaunchInput): Promise<McSimulation> {
    const { devBuyRaw, devBuys, description, logo, socials, ...rest } = input;
    return this.api.post("/multichain/simulate", {
      ...rest,
      description: description ?? "",
      logo: logo ?? "",
      socials: socials ?? {},
      devBuyRaw: raw(devBuyRaw),
      ...(devBuys ? { devBuys: Object.fromEntries(Object.entries(devBuys).map(([chain, v]) => [chain, raw(v)])) } : {}),
    });
  }

  /** Opens an order on a simulation, and says where to pay. */
  place(quoteId: string) {
    return this.api.post<{ orderId: string; payment: McPayment }>("/multichain/orders", { quoteId });
  }

  getOrder(id: string) {
    return this.api.get<McOrder>(`/multichain/orders/${id}`);
  }

  /** Follows an order until it ends: `done`, `partial`, `failed` or `expired`. A landed coin stays whatever happens on the other chains. */
  async waitForOrder(id: string, opts: { timeoutMs?: number; onUpdate?: (order: McOrder) => void } = {}): Promise<McOrder> {
    const end = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
    for (;;) {
      const order = await this.getOrder(id);
      opts.onUpdate?.(order);
      if (DONE.has(order.status)) return order;
      if (Date.now() > end) throw new StealthError(`Order ${id} is still ${order.status}. Keep polling: it runs on the server.`);
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }

  retryLeg(id: string, chain: MultichainChain) {
    return this.api.post<{ ok: boolean }>(`/multichain/orders/${id}/legs/${chain}/retry`);
  }

  /** A fresh payment for an order whose last one ran out. */
  async newPayment(id: string): Promise<McPayment> {
    return (await this.api.post<{ payment: McPayment }>(`/multichain/orders/${id}/payment`)).payment;
  }

  /** Lets go of an unpaid order. */
  cancel(id: string) {
    return this.api.post<{ ok: boolean }>(`/multichain/orders/${id}/cancel`);
  }

  /** Which coins launched together. Public. */
  getGroup(id: string) {
    return this.api.get<McGroup>(`/multichain/groups/${id}`);
  }

  getGroupOfCoin(chain: MultichainChain, token: string) {
    return this.api.get<McGroup>(`/multichain/coins/${chain}/${token}`);
  }

  getGroups() {
    return this.api.get<{ coins: { groupId: string; chain: string; token: string; home: boolean }[] }>("/multichain/groups");
  }

  /** Pays a Solana-home order from the Solana client's wallet, after checking the transaction is exactly the simulated transfer. */
  async paySolana(sol: StealthSolana, payment: McPayment, expectedTotal: string): Promise<string> {
    if (!("transaction" in payment)) throw new StealthInputError("That payment isn't a Solana one.");
    if (payment.amount !== expectedTotal) throw new StealthTransactionMismatchError(`The payment is ${payment.amount}, not the simulated ${expectedTotal}.`);
    assertTransfer(payment.transaction, sol.wallet.publicKey, new PublicKey(payment.to), BigInt(expectedTotal));
    const tx = decodeTransaction(payment.transaction);
    const signature = await sol.send(encodeTransaction(await sol.wallet.signTransaction(tx)));
    await sol.confirm(signature);
    return signature;
  }

  /** Pays an EVM-home order with a plain native transfer. */
  async payEvm(wallet: WalletClient, payment: McPayment, expectedTotal: string): Promise<Hash> {
    if (!("chainId" in payment)) throw new StealthInputError("That payment isn't an EVM one.");
    if (payment.amount !== expectedTotal) throw new StealthTransactionMismatchError(`The payment is ${payment.amount}, not the simulated ${expectedTotal}.`);
    const chain = Object.values(EVM_CHAINS).find((c) => c.id === payment.chainId);
    const account = wallet.account;
    if (!chain || !account) throw new StealthInputError("This needs a wallet account on one of the five EVM chains.");
    return wallet.sendTransaction({ account, chain, to: payment.to as Address, value: BigInt(payment.amount) });
  }
}

/** A multi-chain payment is one transfer from the payer to the deposit address, optionally with compute-budget settings. Nothing else gets signed. */
function assertTransfer(base64: string, from: PublicKey, to: PublicKey, lamports: bigint) {
  const tx = decodeTransaction(base64);
  if (!feePayerOf(tx)?.equals(from)) throw new StealthTransactionMismatchError("The payment isn't paid by this wallet, so it wasn't signed.");
  const ixs = tx instanceof VersionedTransaction ? TransactionMessage.decompile(tx.message).instructions : (tx as Transaction).instructions;
  const rest = ixs.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  const ix = rest[0];
  if (rest.length !== 1 || !ix?.programId.equals(SystemProgram.programId)) throw new StealthTransactionMismatchError("The payment isn't one plain transfer, so it wasn't signed.");
  const t = SystemInstruction.decodeTransfer(ix);
  if (!t.fromPubkey.equals(from) || !t.toPubkey.equals(to) || t.lamports !== lamports) throw new StealthTransactionMismatchError("The payment's transfer doesn't match the order, so it wasn't signed.");
}

export const createStealthMultichain = (opts: ApiOptions & { pollMs?: number } = {}) => new StealthMultichain(opts);
export * from "../shared/errors.js";
