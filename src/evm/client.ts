import {
  createPublicClient,
  http,
  parseEventLogs,
  zeroAddress,
  erc20Abi,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";

import { StealthError, StealthFeeTooHighError, StealthInputError } from "../shared/errors.js";
import { abisFor, quoterAbiFor } from "./abi/index.js";
import { EVM_CHAINS } from "./chains.js";
import {
  EVM_DEFAULT_TAX_BPS,
  EVM_LAUNCH_TYPES,
  EVM_TAX_TIERS,
  FIRST_BUY_MAX_TOKENS,
  LIMITS,
  TOTAL_SUPPLY,
  type EvmDirectLaunchType,
  type EvmLaunchType,
  type EvmTaxBps,
} from "./constants.js";
import { EVM_DEPLOYMENTS, type EvmChainKey, type EvmDeployment } from "./deployments.js";
import { requireLiveChain } from "../utils/chains.js";

export interface StealthEvmOptions {
  chain: EvmChainKey;
  /** For reads. Without it, one is made from `rpcUrl` or the chain's public RPC. */
  publicClient?: PublicClient;
  /** For writes. Its account pays and signs. */
  walletClient?: WalletClient;
  rpcUrl?: string;
}

export interface Socials {
  twitter: string;
  telegram: string;
  discord: string;
  website: string;
  farcaster: string;
}

export interface TeamMember {
  wallet: Address;
  /** Of the team's part. All members sum to 10,000. */
  bps: number;
}

export interface EvmLaunchInput {
  name: string;
  symbol: string;
  /** An https or ipfs URL. */
  logo?: string;
  description?: string;
  socials?: Partial<Socials>;
  /** Default 125 (1.25%). */
  taxBps?: EvmTaxBps;
  /** An ERC-20 the factory lists. Default: the native coin. */
  quote?: Address;
  /** Graduation target in raw quote units. Default: the factory's, or the quote's. */
  target?: bigint;
  /** The launcher's first buy in raw quote units, in the launch transaction. It pays the tier, not the sniper fee, and stops at 5% of supply. */
  firstBuy?: bigint;
  /** Off the expected first-buy tokens, unless `minTokensOut` is set. Default 100. */
  slippageBps?: number;
  minTokensOut?: bigint;
  /** Who the Creator type pays. Default: the launcher. */
  creator?: Address;
  /** Default `creator`. Locked at launch. */
  launchType?: EvmDirectLaunchType;
  /** Team type: 2 to 10 wallets, fixed for good. */
  team?: TeamMember[];
  /** 50-500: 0.5% to 5% of supply, for `limitsWindow`. */
  maxWalletBps?: number;
  /** 10-500: 0.1% to 5% of supply per transaction, for `limitsWindow`. */
  maxBuyBps?: number;
  /** Seconds the limits apply, 1 to 3,600. Required with a limit. */
  limitsWindow?: number;
  /** Seconds the first-buy tokens stay locked, up to 90 days. */
  firstBuyLock?: number;
}

export interface FactoryConfig {
  minTarget: bigint;
  maxTarget: bigint;
  defaultTarget: bigint;
  /** Native, whatever the quote. */
  launchFee: bigint;
  launchesPaused: boolean;
  unlistedQuotesAllowed: boolean;
  configVersion: bigint;
}

export interface PreparedEvmLaunch {
  /** `StealthFactory.launch`'s argument, as it will be sent. */
  params: LaunchParams;
  /** `msg.value`: the launch fee, plus a native first buy. */
  value: bigint;
  /** ERC-20 pairs: what the factory must be allowed to pull. */
  approval: { token: Address; spender: Address; amount: bigint } | null;
  /** Where the token will land, if this launcher launches nothing else first. */
  predictedToken: Address;
  /** First-buy tokens expected. */
  expectedTokens: bigint;
  /** Quote the first buy will use, tax included. Anything above it is refunded. */
  expectedQuoteUsed: bigint;
}

export interface LaunchResult {
  hash: Hash;
  receipt: TransactionReceipt;
  token: Address;
  poolId: Hex;
  creator: Address;
}

export interface SwapQuote {
  side: "buy" | "sell";
  /** The token paid in. Zero address: the native coin. */
  currencyIn: Address;
  currencyOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  /** What the pool charges right now: the tier, or the sniper fee inside the first 15 s. */
  feeBps: number;
}

export interface TradeOptions {
  token: Address;
  /** Default 300 (3%). */
  slippageBps?: number;
  /** Default the sender. */
  recipient?: Address;
  /** Seconds from the latest block. Default 300. */
  deadlineSec?: number;
  /** Refuses a trade charged above this. Default 1,000 (10%), which only the first seconds of a coin's sniper window reach. */
  maxFeeBps?: number;
}

export interface TradeResult {
  hash: Hash;
  receipt: TransactionReceipt;
  amountIn: bigint;
  amountOut: bigint;
}

export interface CoinInfo {
  token: Address;
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: Socials;
  launcher: Address;
  creator: Address;
  launchType: EvmLaunchType;
  /** Zero address: the native coin. */
  quote: Address;
  taxBps: number;
  target: bigint;
  launchTime: number;
  sqrtPriceX96: bigint;
  quoteRaised: bigint;
  tokensSold: bigint;
  graduated: boolean;
  /** What a trade pays now, in bps. */
  currentFeeBps: number;
  sniperWindowEnd: number;
}

/** A coin's books in its quote, raw units. */
export interface CoinBalances {
  /** Unpaid part of the coin: the creator's or team's balance, or a pot, by launch type. */
  coinUnpaid: bigint;
  marketingUnpaid: bigint;
  platformUnpaid: bigint;
  creatorPaidOut: bigint;
  marketingPaidOut: bigint;
  platformPaidOut: bigint;
}

export interface LaunchEvent {
  token: Address;
  creator: Address;
  poolId: Hex;
  launcher: Address;
  quote: Address;
  name: string;
  symbol: string;
  taxBps: number;
  launchType: EvmLaunchType;
  target: bigint;
  blockNumber: bigint;
  transactionHash: Hash;
}

export interface LaunchParams {
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: Socials;
  taxBps: number;
  quote: Address;
  target: bigint;
  quoteAmount: bigint;
  minTokensOut: bigint;
  configVersion: bigint;
  creator: Address;
  options: {
    launchType: number;
    team: readonly TeamMember[];
    maxWalletBps: number;
    maxBuyBps: number;
    limitsWindow: number;
    firstBuyLock: number;
  };
}

/** The pool key as the chain's DEX shapes it: read from the locker, handed back to the router and quoter unchanged. */
export type PoolKey = Record<string, unknown>;

const bytes = (s: string) => new TextEncoder().encode(s).length;
const bump = (amount: bigint, bps: number) => (amount * BigInt(10_000 + bps) + 9_999n) / 10_000n;
const trim = (amount: bigint, bps: number) => (amount * BigInt(10_000 - bps)) / 10_000n;

function checkBps(name: string, value: number | undefined, min: number, max: number) {
  if (value === undefined || value === 0) return;
  if (!Number.isInteger(value) || value < min || value > max) throw new StealthInputError(`${name} must be 0, or ${min} to ${max}.`);
}

/** The launch rules the contract checks, for a clear error before anything is sent. */
export function checkLaunchInput(input: EvmLaunchInput) {
  const nameBytes = bytes(input.name);
  if (nameBytes === 0 || nameBytes > LIMITS.nameBytes) throw new StealthInputError(`name must be 1 to ${LIMITS.nameBytes} bytes.`);
  const symbolBytes = bytes(input.symbol);
  if (symbolBytes === 0 || symbolBytes > LIMITS.symbolBytes) throw new StealthInputError(`symbol must be 1 to ${LIMITS.symbolBytes} bytes.`);
  if (bytes(input.logo ?? "") > LIMITS.logoBytes) throw new StealthInputError(`logo must be at most ${LIMITS.logoBytes} bytes.`);
  if (bytes(input.description ?? "") > LIMITS.descriptionBytes) throw new StealthInputError(`description must be at most ${LIMITS.descriptionBytes} bytes.`);
  for (const [k, v] of Object.entries(input.socials ?? {})) if (bytes(v ?? "") > LIMITS.socialBytes) throw new StealthInputError(`socials.${k} must be at most ${LIMITS.socialBytes} bytes.`);
  const tax = input.taxBps ?? EVM_DEFAULT_TAX_BPS;
  if (!(EVM_TAX_TIERS as readonly number[]).includes(tax)) throw new StealthInputError(`taxBps must be one of ${EVM_TAX_TIERS.join(", ")}.`);
  const type = input.launchType ?? "creator";
  if ((type as string) === "pot") throw new StealthInputError("A direct launch can't use the Pot type: it needs a fee plan only the site can store, and its fees would never be paid out.");
  if (!(EVM_LAUNCH_TYPES as readonly string[]).includes(type)) throw new StealthInputError(`Unknown launch type ${type}.`);
  const team = input.team ?? [];
  if (type === "team") {
    if (team.length < LIMITS.teamMin || team.length > LIMITS.teamMax) throw new StealthInputError(`A team has ${LIMITS.teamMin} to ${LIMITS.teamMax} wallets.`);
    if (team.some((m) => m.wallet === zeroAddress || !Number.isInteger(m.bps) || m.bps <= 0)) throw new StealthInputError("Each team wallet needs an address and a share above 0.");
    if (new Set(team.map((m) => m.wallet.toLowerCase())).size !== team.length) throw new StealthInputError("Each team wallet can appear once.");
    if (team.reduce((n, m) => n + m.bps, 0) !== 10_000) throw new StealthInputError("Team shares must add up to 10,000 bps.");
  } else if (team.length) throw new StealthInputError("Team wallets only go with the team launch type.");
  checkBps("maxWalletBps", input.maxWalletBps, LIMITS.maxWalletBps.min, LIMITS.maxWalletBps.max);
  checkBps("maxBuyBps", input.maxBuyBps, LIMITS.maxBuyBps.min, LIMITS.maxBuyBps.max);
  const limited = !!input.maxWalletBps || !!input.maxBuyBps;
  const window = input.limitsWindow ?? 0;
  if (!Number.isInteger(window) || (limited ? window < 1 || window > LIMITS.limitsWindowSec : window !== 0)) throw new StealthInputError(`limitsWindow is 1 to ${LIMITS.limitsWindowSec} seconds with a limit, and unset without one.`);
  const lock = input.firstBuyLock ?? 0;
  if (!Number.isInteger(lock) || lock < 0 || lock > LIMITS.firstBuyLockSec) throw new StealthInputError("firstBuyLock is a whole number of seconds, at most 90 days.");
  // 10,000 would make minTokensOut 0: no protection at all on the first buy
  const slippage = input.slippageBps ?? 0;
  if (!Number.isInteger(slippage) || slippage < 0 || slippage >= 10_000) throw new StealthInputError("slippageBps is 0 to 9,999.");
  if ((input.firstBuy ?? 0n) < 0n) throw new StealthInputError("firstBuy can't be negative.");
}

/** Most tokens a first buy can take with these limits: `StealthLocker.firstBuyAllowance`. */
export function firstBuyAllowance(maxWalletBps = 0, maxBuyBps = 0): bigint {
  let allowance = FIRST_BUY_MAX_TOKENS;
  for (const bps of [maxWalletBps, maxBuyBps]) {
    const cap = (TOTAL_SUPPLY * BigInt(bps)) / 10_000n;
    if (bps !== 0 && cap < allowance) allowance = cap;
  }
  return allowance;
}

/**
 * One chain's Stealth contracts: launches, trades through `StealthRouter`, claims and reads. Everything here is direct on chain, with no
 * API in between. Uniswap v4 and PancakeSwap Infinity differ only in their pool keys and ABIs, which this class picks by chain.
 */
export class StealthEvm {
  readonly deployment: EvmDeployment;
  readonly chain: Chain;
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient | undefined;
  private readonly abis;
  private readonly quoterAbi;

  constructor(opts: StealthEvmOptions) {
    // a coming-soon chain is refused with a clear message; aliases such as "bsc" are read as their key
    const key = requireLiveChain(String(opts.chain), "evm").key as EvmChainKey;
    const deployment = Object.prototype.hasOwnProperty.call(EVM_DEPLOYMENTS, key) ? EVM_DEPLOYMENTS[key] : undefined;
    if (!deployment) throw new StealthInputError(`Unknown chain ${String(opts.chain)}.`);
    this.deployment = deployment;
    this.chain = EVM_CHAINS[key];
    this.publicClient = opts.publicClient ?? (createPublicClient({ chain: this.chain, transport: http(opts.rpcUrl ?? deployment.rpcUrl) }) as PublicClient);
    this.walletClient = opts.walletClient;
    this.abis = abisFor(deployment.dex);
    this.quoterAbi = quoterAbiFor(deployment.dex);
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------

  /** What applies to the next launch. `configVersion` changes with any setting, and a launch that names an old one reverts. */
  async getConfig(): Promise<FactoryConfig> {
    const { factory } = this.deployment;
    const abi = this.abis.stealthFactoryAbi;
    const [cfg, configVersion] = await Promise.all([
      this.publicClient.readContract({ address: factory, abi, functionName: "config" }),
      this.publicClient.readContract({ address: factory, abi, functionName: "configVersion" }),
    ]);
    return { ...cfg, configVersion };
  }

  /** The admin's listing for an ERC-20 quote. `listed` is false if there's none. */
  getQuoteConfig(quote: Address) {
    return this.publicClient.readContract({ address: this.deployment.factory, abi: this.abis.stealthFactoryAbi, functionName: "quoteConfig", args: [quote] });
  }

  /** A coin's terms, curve position and current fee. */
  async getCoin(token: Address): Promise<CoinInfo> {
    const { locker, hook, feeVault } = this.deployment;
    const c = this.publicClient;
    const { stealthLockerAbi, stealthHookAbi, stealthFeeVaultAbi, stealthTokenAbi } = this.abis;
    const [pool, progress, fee, sniperEnd, creator, type, name, symbol, info] = await Promise.all([
      c.readContract({ address: locker, abi: stealthLockerAbi, functionName: "getPool", args: [token] }),
      c.readContract({ address: locker, abi: stealthLockerAbi, functionName: "progress", args: [token] }),
      c.readContract({ address: hook, abi: stealthHookAbi, functionName: "currentFee", args: [token] }),
      c.readContract({ address: hook, abi: stealthHookAbi, functionName: "sniperWindowEnd", args: [token] }),
      c.readContract({ address: feeVault, abi: stealthFeeVaultAbi, functionName: "creatorOf", args: [token] }),
      c.readContract({ address: feeVault, abi: stealthFeeVaultAbi, functionName: "launchTypeOf", args: [token] }),
      c.readContract({ address: token, abi: stealthTokenAbi, functionName: "name" }),
      c.readContract({ address: token, abi: stealthTokenAbi, functionName: "symbol" }),
      c.readContract({ address: token, abi: stealthTokenAbi, functionName: "getTokenInfo" }),
    ]);
    const [sqrtPriceX96, quoteRaised, tokensSold, graduated] = progress;
    const [launcher, logo, description, socials] = info;
    return {
      token,
      name,
      symbol,
      logo,
      description,
      socials: { ...socials },
      launcher,
      creator,
      launchType: EVM_LAUNCH_TYPES[type] ?? "creator",
      quote: pool.quote,
      taxBps: pool.taxBps,
      target: pool.target,
      launchTime: Number(pool.launchTime),
      sqrtPriceX96,
      quoteRaised,
      tokensSold,
      graduated,
      currentFeeBps: Number(fee) / 100,
      sniperWindowEnd: Number(sniperEnd),
    };
  }

  /** A coin's books in the fee vault. */
  async getBalances(token: Address): Promise<CoinBalances> {
    const [coinUnpaid, marketingUnpaid, platformUnpaid, creatorPaidOut, marketingPaidOut, platformPaidOut] = await this.publicClient.readContract({
      address: this.deployment.feeVault,
      abi: this.abis.stealthFeeVaultAbi,
      functionName: "balances",
      args: [token],
    });
    return { coinUnpaid, marketingUnpaid, platformUnpaid, creatorPaidOut, marketingPaidOut, platformPaidOut };
  }

  /** What `wallet` can claim on a Creator or Team coin. Always 0 on the other types. */
  claimable(token: Address, wallet: Address): Promise<bigint> {
    return this.publicClient.readContract({ address: this.deployment.feeVault, abi: this.abis.stealthFeeVaultAbi, functionName: "claimable", args: [token, wallet] });
  }

  /** A Team coin's wallets and shares. */
  async getTeam(token: Address): Promise<TeamMember[]> {
    const [wallets, bps] = await this.publicClient.readContract({ address: this.deployment.feeVault, abi: this.abis.stealthFeeVaultAbi, functionName: "team", args: [token] });
    return wallets.map((wallet, i) => ({ wallet, bps: bps[i]! }));
  }

  /** The coin's pool key, as this chain's DEX shapes it. */
  async getPoolKey(token: Address): Promise<PoolKey> {
    return (await this.publicClient.readContract({ address: this.deployment.locker, abi: this.abis.stealthLockerAbi, functionName: "poolKey", args: [token] })) as unknown as PoolKey;
  }

  /** `Launched` events in a block range. Public RPCs cap the range, so page it. Starts from `deployment.startBlock` at the earliest. */
  async getLaunches(range: { fromBlock: bigint; toBlock: bigint }): Promise<LaunchEvent[]> {
    const logs = await this.publicClient.getContractEvents({
      address: this.deployment.factory,
      abi: this.abis.stealthFactoryAbi,
      eventName: "Launched",
      fromBlock: range.fromBlock < this.deployment.startBlock ? this.deployment.startBlock : range.fromBlock,
      toBlock: range.toBlock,
    });
    return logs.map((l) => {
      const a = l.args as { token: Address; creator: Address; poolId: Hex; launcher: Address; quote: Address; name: string; symbol: string; taxBps: number; launchType: number; target: bigint };
      return { ...a, launchType: EVM_LAUNCH_TYPES[a.launchType] ?? "creator", blockNumber: l.blockNumber, transactionHash: l.transactionHash };
    });
  }

  // ---- quotes --------------------------------------------------------------------------------------------------------

  private async quote(token: Address, side: "buy" | "sell", exact: "in" | "out", amount: bigint): Promise<SwapQuote> {
    if (amount <= 0n) throw new StealthInputError("amount must be above 0.");
    const [poolKey, fee] = await Promise.all([
      this.getPoolKey(token),
      this.publicClient.readContract({ address: this.deployment.hook, abi: this.abis.stealthHookAbi, functionName: "currentFee", args: [token] }),
    ]);
    const quote = poolKey.currency0 as Address;
    const { result } = (await this.publicClient.simulateContract({
      address: this.deployment.quoter,
      abi: this.quoterAbi,
      functionName: exact === "in" ? "quoteExactInputSingle" : "quoteExactOutputSingle",
      args: [{ poolKey, zeroForOne: side === "buy", exactAmount: amount, hookData: "0x" }],
    } as never)) as unknown as { result: readonly [bigint, bigint] };
    return {
      side,
      currencyIn: side === "buy" ? quote : token,
      currencyOut: side === "buy" ? token : quote,
      amountIn: exact === "in" ? amount : result[0],
      amountOut: exact === "in" ? result[0] : amount,
      feeBps: Number(fee) / 100,
    };
  }

  /** Tokens for `amountIn` of the quote, right now, tax and any sniper fee taken. */
  quoteBuy(token: Address, amountIn: bigint) {
    return this.quote(token, "buy", "in", amountIn);
  }
  /** Quote needed for exactly `amountOut` tokens. */
  quoteBuyExactOut(token: Address, amountOut: bigint) {
    return this.quote(token, "buy", "out", amountOut);
  }
  /** Quote for selling `amountIn` tokens. */
  quoteSell(token: Address, amountIn: bigint) {
    return this.quote(token, "sell", "in", amountIn);
  }
  /** Tokens to sell for exactly `amountOut` of the quote. */
  quoteSellExactOut(token: Address, amountOut: bigint) {
    return this.quote(token, "sell", "out", amountOut);
  }

  /** The first buy's outcome on a fresh pool: `StealthLocker.quoteLaunchBuyCapped`. */
  async quoteFirstBuy(p: { target: bigint; taxBps?: EvmTaxBps; quoteIn: bigint; maxWalletBps?: number; maxBuyBps?: number }) {
    const [tokensOut, quoteUsed] = await this.publicClient.readContract({
      address: this.deployment.locker,
      abi: this.abis.stealthLockerAbi,
      functionName: "quoteLaunchBuyCapped",
      args: [p.target, p.taxBps ?? EVM_DEFAULT_TAX_BPS, p.quoteIn, firstBuyAllowance(p.maxWalletBps, p.maxBuyBps)],
    });
    return { tokensOut, quoteUsed };
  }

  // ---- launch --------------------------------------------------------------------------------------------------------

  /** Reads what a launch needs and builds it, without sending anything. `launcher` defaults to the wallet client's account. */
  async prepareLaunch(input: EvmLaunchInput, launcher?: Address): Promise<PreparedEvmLaunch> {
    checkLaunchInput(input);
    const from = launcher ?? this.account().address;
    const cfg = await this.getConfig();
    if (cfg.launchesPaused) throw new StealthError(`Launches are paused on ${this.deployment.name}.`);
    const quote = input.quote ?? zeroAddress;
    const native = quote === zeroAddress;
    const firstBuy = input.firstBuy ?? 0n;
    const taxBps = input.taxBps ?? EVM_DEFAULT_TAX_BPS;

    let target = input.target;
    let approvalAmount = 0n;
    if (native) {
      target ??= cfg.defaultTarget;
      if (target < cfg.minTarget || target > cfg.maxTarget) throw new StealthInputError(`target must be ${cfg.minTarget} to ${cfg.maxTarget} wei on ${this.deployment.name}.`);
    } else {
      const q = await this.getQuoteConfig(quote);
      if (q.listed) {
        target ??= q.defaultTarget;
        if (target < q.minTarget || target > q.maxTarget) throw new StealthInputError(`target must be ${q.minTarget} to ${q.maxTarget} for this quote.`);
      } else {
        if (!cfg.unlistedQuotesAllowed) throw new StealthInputError(`${quote} isn't a listed quote on ${this.deployment.name}.`);
        if (target === undefined) throw new StealthInputError("An unlisted quote needs an explicit target.");
      }
      const probe = await this.publicClient.readContract({ address: this.deployment.factory, abi: this.abis.stealthFactoryAbi, functionName: "quoteProbeAmount", args: [quote] });
      approvalAmount = firstBuy > probe ? firstBuy : probe;
    }

    const expected = firstBuy > 0n ? await this.quoteFirstBuy({ target, taxBps, quoteIn: firstBuy, maxWalletBps: input.maxWalletBps, maxBuyBps: input.maxBuyBps }) : { tokensOut: 0n, quoteUsed: 0n };
    const socials: Socials = { twitter: "", telegram: "", discord: "", website: "", farcaster: "", ...input.socials };
    const params: LaunchParams = {
      name: input.name,
      symbol: input.symbol,
      logo: input.logo ?? "",
      description: input.description ?? "",
      socials,
      taxBps,
      quote,
      target,
      quoteAmount: native ? 0n : firstBuy,
      minTokensOut: input.minTokensOut ?? trim(expected.tokensOut, input.slippageBps ?? 100),
      configVersion: cfg.configVersion,
      creator: input.creator ?? zeroAddress,
      options: {
        launchType: EVM_LAUNCH_TYPES.indexOf(input.launchType ?? "creator"),
        team: input.team ?? [],
        maxWalletBps: input.maxWalletBps ?? 0,
        maxBuyBps: input.maxBuyBps ?? 0,
        limitsWindow: input.limitsWindow ?? 0,
        firstBuyLock: input.firstBuyLock ?? 0,
      },
    };
    const predictedToken = await this.publicClient.readContract({
      address: this.deployment.factory,
      abi: this.abis.stealthFactoryAbi,
      functionName: "predictTokenAddress",
      args: [from, params as never],
    });
    return {
      params,
      value: cfg.launchFee + (native ? firstBuy : 0n),
      approval: native ? null : { token: quote, spender: this.deployment.factory, amount: approvalAmount },
      predictedToken,
      expectedTokens: expected.tokensOut,
      expectedQuoteUsed: expected.quoteUsed,
    };
  }

  /** Launches a coin: token, pool and first buy in one transaction. Approves an ERC-20 quote first when it has to. */
  async launch(input: EvmLaunchInput | PreparedEvmLaunch): Promise<LaunchResult> {
    const prepared = "params" in input ? input : await this.prepareLaunch(input);
    const account = this.account();
    await this.assertChain();
    if (prepared.approval) await this.ensureAllowance(prepared.approval.token, prepared.approval.spender, prepared.approval.amount);
    const { request } = await this.publicClient.simulateContract({
      account,
      address: this.deployment.factory,
      abi: this.abis.stealthFactoryAbi,
      functionName: "launch",
      args: [prepared.params as never],
      value: prepared.value,
      chain: this.chain,
    });
    const hash = await this.wallet().writeContract(request as never);
    const receipt = await this.settled(hash);
    const [event] = parseEventLogs({ abi: this.abis.stealthFactoryAbi, eventName: "Launched", logs: receipt.logs });
    if (!event) throw new StealthError(`The launch ${hash} left no Launched event.`);
    const a = event.args as unknown as { token: Address; poolId: Hex; creator: Address };
    return { hash, receipt, token: a.token, poolId: a.poolId, creator: a.creator };
  }

  // ---- trades --------------------------------------------------------------------------------------------------------

  /** Spends exactly `amountIn` of the quote. */
  async buy(o: TradeOptions & { amountIn: bigint; minAmountOut?: bigint }): Promise<TradeResult> {
    const q = await this.quoteBuy(o.token, o.amountIn);
    return this.swap(o, q, true, o.minAmountOut ?? trim(q.amountOut, slippage(o)));
  }

  /** Buys exactly `amountOut` tokens. An unused native amount comes back. */
  async buyExactOut(o: TradeOptions & { amountOut: bigint; maxAmountIn?: bigint }): Promise<TradeResult> {
    const q = await this.quoteBuyExactOut(o.token, o.amountOut);
    return this.swap(o, q, false, o.maxAmountIn ?? bump(q.amountIn, slippage(o)));
  }

  /** Sells exactly `amountIn` tokens. */
  async sell(o: TradeOptions & { amountIn: bigint; minAmountOut?: bigint }): Promise<TradeResult> {
    const q = await this.quoteSell(o.token, o.amountIn);
    return this.swap(o, q, true, o.minAmountOut ?? trim(q.amountOut, slippage(o)));
  }

  /** Sells what it takes to receive exactly `amountOut` of the quote. */
  async sellExactOut(o: TradeOptions & { amountOut: bigint; maxAmountIn?: bigint }): Promise<TradeResult> {
    const q = await this.quoteSellExactOut(o.token, o.amountOut);
    return this.swap(o, q, false, o.maxAmountIn ?? bump(q.amountIn, slippage(o)));
  }

  private async swap(o: TradeOptions, q: SwapQuote, exactInput: boolean, limit: bigint): Promise<TradeResult> {
    const max = o.maxFeeBps ?? 1_000;
    if (q.feeBps > max) throw new StealthFeeTooHighError(q.feeBps, max);
    const account = this.account();
    await this.assertChain();
    const spend = exactInput ? q.amountIn : limit;
    const native = q.currencyIn === zeroAddress;
    if (!native) await this.ensureAllowance(q.currencyIn, this.deployment.router, spend);
    const [key, block] = await Promise.all([this.getPoolKey(o.token), this.publicClient.getBlock({ blockTag: "latest" })]);
    const { request } = await this.publicClient.simulateContract({
      account,
      address: this.deployment.router,
      abi: this.abis.stealthRouterAbi,
      functionName: "swap",
      args: [
        {
          key: key as never,
          zeroForOne: q.side === "buy",
          exactInput,
          amount: exactInput ? q.amountIn : q.amountOut,
          limit,
          recipient: o.recipient ?? account.address,
          usePermit2: false,
          deadline: block.timestamp + BigInt(o.deadlineSec ?? 300),
        },
      ],
      value: native ? spend : 0n,
      chain: this.chain,
    });
    const hash = await this.wallet().writeContract(request as never);
    const receipt = await this.settled(hash);
    const [event] = parseEventLogs({ abi: this.abis.stealthRouterAbi, eventName: "Swapped", logs: receipt.logs });
    if (!event) throw new StealthError(`The swap ${hash} left no Swapped event.`);
    const a = event.args as unknown as { amountIn: bigint; amountOut: bigint };
    return { hash, receipt, amountIn: a.amountIn, amountOut: a.amountOut };
  }

  // ---- claims --------------------------------------------------------------------------------------------------------

  /** Pays the sender's whole balance on a Creator or Team coin, in the coin's quote. Other types pay through the ops bot or a sweep. */
  async claim(token: Address): Promise<{ hash: Hash; receipt: TransactionReceipt; amount: bigint }> {
    const account = this.account();
    await this.assertChain();
    const { request, result } = await this.publicClient.simulateContract({
      account,
      address: this.deployment.feeVault,
      abi: this.abis.stealthFeeVaultAbi,
      functionName: "claimCreator",
      args: [token],
      chain: this.chain,
    });
    const hash = await this.wallet().writeContract(request as never);
    return { hash, receipt: await this.settled(hash), amount: result as bigint };
  }

  /** Pays `amount` of the sender's balance to `to` and leaves the rest owed. */
  async claimTo(token: Address, amount: bigint, to: Address): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
    const hash = await this.writeVault("claimCreatorAmount", [token, amount, to]);
    return { hash, receipt: await this.settled(hash) };
  }

  /** Offers the creator role to `to`, who has to accept. Moves nothing already owed unless they accept. */
  async offerCreator(token: Address, to: Address): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
    const hash = await this.writeVault("offerCreator", [token, to]);
    return { hash, receipt: await this.settled(hash) };
  }

  /** Takes up a creator role offered to the sender. */
  async acceptCreator(token: Address): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
    const hash = await this.writeVault("acceptCreator", [token]);
    return { hash, receipt: await this.settled(hash) };
  }

  // ---- plumbing ------------------------------------------------------------------------------------------------------

  private async writeVault(functionName: string, args: readonly unknown[]): Promise<Hash> {
    const account = this.account();
    await this.assertChain();
    const { request } = await this.publicClient.simulateContract({ account, address: this.deployment.feeVault, abi: this.abis.stealthFeeVaultAbi, functionName, args, chain: this.chain } as never);
    return this.wallet().writeContract(request as never);
  }

  private wallet(): WalletClient {
    if (!this.walletClient) throw new StealthInputError("This needs a walletClient.");
    return this.walletClient;
  }

  private account(): Account {
    const account = this.wallet().account;
    if (!account) throw new StealthInputError("The walletClient has no account.");
    return account;
  }

  /** A wrong RPC must never take a transaction meant for another chain. */
  private async assertChain() {
    const read = await this.publicClient.getChainId();
    if (read !== this.deployment.chainId) throw new StealthError(`The public client is on chain ${read}, not ${this.deployment.name} (${this.deployment.chainId}).`);
  }

  private async ensureAllowance(token: Address, spender: Address, amount: bigint) {
    const owner = this.account().address;
    const allowed = await this.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
    if (allowed >= amount) return;
    const { request } = await this.publicClient.simulateContract({ account: this.account(), address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount], chain: this.chain });
    await this.settled(await this.wallet().writeContract(request as never));
  }

  private async settled(hash: Hash): Promise<TransactionReceipt> {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new StealthError(`Transaction ${hash} reverted.`);
    return receipt;
  }
}

const slippage = (o: TradeOptions) => {
  const bps = o.slippageBps ?? 300;
  if (!Number.isInteger(bps) || bps < 0 || bps >= 10_000) throw new StealthInputError("slippageBps is 0 to 9,999.");
  return bps;
};

export const createStealthEvm = (opts: StealthEvmOptions) => new StealthEvm(opts);
