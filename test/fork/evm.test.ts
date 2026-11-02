import { erc20Abi, parseEther, parseAbi, zeroAddress, type Address } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { abisFor, createStealthEvm, EVM_DEPLOYMENTS, StealthFeeTooHighError, StealthInputError, type EvmChainKey, type StealthEvm } from "../../src/evm/index.js";
import { accountAt, startFork, type Fork } from "./helpers.js";

/**
 * The SDK against the real, deployed contracts: anvil forks each chain locally, and every transaction stays in that local process. Nothing
 * here reaches a real chain. FORK_CHAINS=base,bnb picks chains; FORK_RPC_BASE=... swaps a public RPC for a better one.
 */
const ALL: EvmChainKey[] = ["base", "bnb", "robinhood", "arc", "hyperevm"];
const chains = (process.env.FORK_CHAINS?.split(",") as EvmChainKey[] | undefined) ?? ALL;
/** Wrapped natives: real ERC-20s to pair with, listed on the fork by the factory's admin read from the chain. */
const WRAPPED: Partial<Record<EvmChainKey, Address>> = {
  base: "0x4200000000000000000000000000000000000006",
  bnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
};
const wethAbi = parseAbi(["function deposit() payable"]);

describe.each(chains.map((c, i) => [c, 18_545 + i] as const))("%s, on a local fork", (chain, port) => {
  let fork: Fork;
  let sdk: StealthEvm;
  let buyer: StealthEvm;
  let unit: bigint;
  let target: bigint;
  let token: Address;
  const creator = accountAt(0).address;
  const trader = accountAt(1).address;

  beforeAll(async () => {
    fork = await startFork(chain, port);
    expect(fork.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
    sdk = createStealthEvm({ chain, publicClient: fork.publicClient, walletClient: fork.walletAt(0) });
    buyer = createStealthEvm({ chain, publicClient: fork.publicClient, walletClient: fork.walletAt(1) });
    await Promise.all([fork.test.setBalance({ address: creator, value: 10n ** 26n }), fork.test.setBalance({ address: trader, value: 10n ** 26n })]);
    const cfg = await sdk.getConfig();
    target = cfg.defaultTarget;
    // a thousandth of the target: a trade sized to the chain, in ETH, BNB, HYPE or Arc's USDC alike
    unit = target / 1_000n;
  });
  afterAll(() => fork?.stop());

  it("reads the live factory", async () => {
    const cfg = await sdk.getConfig();
    expect(cfg.configVersion).toBeGreaterThan(0n);
    expect(cfg.minTarget).toBeLessThanOrEqual(cfg.defaultTarget);
    expect(cfg.defaultTarget).toBeLessThanOrEqual(cfg.maxTarget);
    expect(cfg.launchesPaused).toBe(false);
  });

  it("launches with a first buy, at the predicted address, for the expected tokens", async () => {
    const firstBuy = unit * 10n;
    const prepared = await sdk.prepareLaunch({ name: "SDK Test", symbol: "SDKT", description: "A local fork launch.", logo: "https://juststealthit.xyz/brand/stealth-mark-512.png", socials: { website: "https://juststealthit.xyz" }, taxBps: 225, firstBuy });
    expect(prepared.approval).toBeNull();
    expect(prepared.expectedTokens).toBeGreaterThan(0n);
    expect(prepared.params.minTokensOut).toBeLessThan(prepared.expectedTokens);
    const out = await sdk.launch(prepared);
    token = out.token;
    expect(token).toBe(prepared.predictedToken);
    expect(out.creator).toBe(creator);
    const held = await fork.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [creator] });
    expect(held).toBe(prepared.expectedTokens);

    const coin = await sdk.getCoin(token);
    expect(coin).toMatchObject({ name: "SDK Test", symbol: "SDKT", description: "A local fork launch.", taxBps: 225, launchType: "creator", creator, launcher: creator, quote: zeroAddress, target, graduated: false });
    expect(coin.socials.website).toBe("https://juststealthit.xyz");
    expect(coin.tokensSold).toBeGreaterThan(0n);
  });

  it("refuses a trade inside the sniper window, and says why", async () => {
    await expect(buyer.buy({ token, amountIn: unit })).rejects.toBeInstanceOf(StealthFeeTooHighError);
    const q = await buyer.quoteBuy(token, unit);
    expect(q.feeBps).toBeGreaterThan(1_000);
  });

  it("buys and sells at what the quoter said, on all four swap modes", async () => {
    await fork.warp(20);
    const coin = await sdk.getCoin(token);
    expect(coin.currentFeeBps).toBe(225);

    const quote = await buyer.quoteBuy(token, unit);
    expect(quote.currencyIn).toBe(zeroAddress);
    expect(quote.feeBps).toBe(225);
    const bought = await buyer.buy({ token, amountIn: unit });
    expect(bought.amountIn).toBe(unit);
    expect(bought.amountOut).toBe(quote.amountOut);

    const want = quote.amountOut / 4n;
    const exactOut = await buyer.buyExactOut({ token, amountOut: want });
    expect(exactOut.amountOut).toBe(want);

    const sellIn = bought.amountOut / 2n;
    const sq = await buyer.quoteSell(token, sellIn);
    const sold = await buyer.sell({ token, amountIn: sellIn });
    expect(sold.amountIn).toBe(sellIn);
    expect(sold.amountOut).toBe(sq.amountOut);

    const back = sold.amountOut / 2n;
    const sellOut = await buyer.sellExactOut({ token, amountOut: back });
    expect(sellOut.amountOut).toBe(back);
  });

  it("books fees 70% of the tier to the coin, and pays the creator's claim in full", async () => {
    const balances = await sdk.getBalances(token);
    expect(balances.coinUnpaid).toBeGreaterThan(0n);
    expect(balances.platformUnpaid).toBeGreaterThan(0n);
    // outside the window the split is 70 / 30; the first buy's own share is included, and rounding goes to the platform
    const share = (balances.coinUnpaid * 10_000n) / (balances.coinUnpaid + balances.platformUnpaid);
    expect(share).toBeGreaterThanOrEqual(6_990n);
    expect(share).toBeLessThanOrEqual(7_000n);

    const owed = await sdk.claimable(token, creator);
    expect(owed).toBe(balances.coinUnpaid);
    expect(await sdk.claimable(token, trader)).toBe(0n);
    const before = await fork.publicClient.getBalance({ address: creator });
    const claimed = await sdk.claim(token);
    const after = await fork.publicClient.getBalance({ address: creator });
    expect(claimed.amount).toBe(owed);
    const gas = claimed.receipt.gasUsed * claimed.receipt.effectiveGasPrice;
    expect(after - before + gas).toBe(owed);
    expect(await sdk.claimable(token, creator)).toBe(0n);
  });

  it("pays part of a claim to another address", async () => {
    await buyer.buy({ token, amountIn: unit });
    const owed = await sdk.claimable(token, creator);
    await sdk.claimTo(token, owed / 2n, trader);
    expect(await sdk.claimable(token, creator)).toBe(owed - owed / 2n);
  });

  it("launches a team coin, and each wallet claims its own share", async () => {
    const team = [
      { wallet: accountAt(2).address, bps: 2_500 },
      { wallet: accountAt(3).address, bps: 7_500 },
    ];
    const { token: t } = await sdk.launch({ name: "Team", symbol: "TEAM", launchType: "team", team, taxBps: 575 });
    expect((await sdk.getCoin(t)).launchType).toBe("team");
    expect(await sdk.getTeam(t)).toEqual(team);
    await fork.warp(20);
    await buyer.buy({ token: t, amountIn: unit });
    const [a, b] = await Promise.all([sdk.claimable(t, team[0]!.wallet), sdk.claimable(t, team[1]!.wallet)]);
    expect(b).toBeGreaterThanOrEqual(a * 3n - 3n);
    await fork.test.setBalance({ address: team[0]!.wallet, value: 10n ** 24n });
    const member = createStealthEvm({ chain, publicClient: fork.publicClient, walletClient: fork.walletAt(2) });
    expect((await member.claim(t)).amount).toBe(a);
  });

  it("stores the other direct types, limits and a lock", async () => {
    for (const launchType of ["marketing", "holders", "buyback"] as const) {
      const { token: t } = await sdk.launch({ name: launchType, symbol: "T", launchType });
      expect((await sdk.getCoin(t)).launchType).toBe(launchType);
      expect(await sdk.claimable(t, creator)).toBe(0n);
    }
    const prepared = await sdk.prepareLaunch({ name: "Limited", symbol: "LIM", firstBuy: target, maxWalletBps: 100, maxBuyBps: 50, limitsWindow: 60, firstBuyLock: 3_600 });
    // both limits cap the first buy at 0.5% of supply, however much is offered
    expect(prepared.expectedTokens).toBeLessThanOrEqual(5_000_000n * 10n ** 18n);
    const out = await sdk.launch(prepared);
    const held = await fork.publicClient.readContract({ address: out.token, abi: erc20Abi, functionName: "balanceOf", args: [creator] });
    expect(held).toBe(prepared.expectedTokens);
  });

  it("finds launches in the logs", async () => {
    const head = await fork.publicClient.getBlockNumber();
    const events = await sdk.getLaunches({ fromBlock: head - 3n, toBlock: head });
    expect(events.at(-1)?.name).toBe("Limited");
    expect(events.at(-1)?.launcher).toBe(creator);
  });

  it("refuses bad input before anything is sent", async () => {
    await expect(sdk.prepareLaunch({ name: "x", symbol: "x", taxBps: 300 as never })).rejects.toBeInstanceOf(StealthInputError);
    await expect(sdk.prepareLaunch({ name: "x", symbol: "x", launchType: "pot" as never })).rejects.toThrow(/Pot/);
    await expect(sdk.prepareLaunch({ name: "x", symbol: "x", target: 1n })).rejects.toThrow(/target/);
  });

  it("fails loudly when the factory's config changed under a prepared launch", async () => {
    const prepared = await sdk.prepareLaunch({ name: "Stale", symbol: "STL" });
    const admin = (await fork.publicClient.readContract({ address: sdk.deployment.factory, abi: abisFor(sdk.deployment.dex).stealthFactoryAbi, functionName: "admin" })) as Address;
    const signer = await fork.impersonate(admin);
    await signer.writeContract({ address: sdk.deployment.factory, abi: abisFor(sdk.deployment.dex).stealthFactoryAbi, functionName: "setLaunchFee", args: [0n], chain: sdk.chain, account: admin });
    await fork.test.mine({ blocks: 1 });
    await expect(sdk.launch(prepared)).rejects.toThrow(/StaleConfig/);
  });

  it.runIf(!!WRAPPED[chain])("launches and trades on an ERC-20 pair", async () => {
    const quote = WRAPPED[chain]!;
    const { factory, dex } = sdk.deployment;
    const abi = abisFor(dex).stealthFactoryAbi;
    const admin = (await fork.publicClient.readContract({ address: factory, abi, functionName: "admin" })) as Address;
    const signer = await fork.impersonate(admin);
    const tenth = parseEther("0.1");
    await signer.writeContract({ address: factory, abi, functionName: "listQuote", args: [quote, tenth, parseEther("1"), parseEther("100")], chain: sdk.chain, account: admin });
    await fork.test.mine({ blocks: 1 });
    const wallet = fork.walletAt(0);
    await wallet.writeContract({ address: quote, abi: wethAbi, functionName: "deposit", value: parseEther("5"), chain: sdk.chain, account: wallet.account! });
    await fork.test.mine({ blocks: 1 });

    const firstBuy = parseEther("0.01");
    const prepared = await sdk.prepareLaunch({ name: "Pair", symbol: "PAIR", quote, firstBuy });
    expect(prepared.approval).toMatchObject({ token: quote, spender: factory });
    expect(prepared.value).toBe(0n);
    const out = await sdk.launch(prepared);
    expect(BigInt(out.token)).toBeGreaterThan(BigInt(quote));
    expect((await sdk.getCoin(out.token)).quote.toLowerCase()).toBe(quote.toLowerCase());
    await fork.warp(20);

    const bought = await sdk.buy({ token: out.token, amountIn: parseEther("0.01") });
    expect(bought.amountOut).toBeGreaterThan(0n);
    const sold = await sdk.sell({ token: out.token, amountIn: bought.amountOut / 2n });
    expect(sold.amountOut).toBeGreaterThan(0n);
    const before = await fork.publicClient.readContract({ address: quote, abi: erc20Abi, functionName: "balanceOf", args: [creator] });
    const claimed = await sdk.claim(out.token);
    const after = await fork.publicClient.readContract({ address: quote, abi: erc20Abi, functionName: "balanceOf", args: [creator] });
    expect(after - before).toBe(claimed.amount);
  });

  it("never touched a real chain", () => {
    expect(EVM_DEPLOYMENTS[chain].rpcUrl.startsWith("https://")).toBe(true);
    expect(fork.url.startsWith("http://127.0.0.1:")).toBe(true);
  });
});
