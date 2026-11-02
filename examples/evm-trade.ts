// Buys, sells and claims on any of the five chains. CHAIN defaults to base. TOKEN is the coin.
import { createWalletClient, http, parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { createStealthEvm, EVM_CHAINS, StealthFeeTooHighError, type EvmChainKey } from "@juststealthit/sdk/evm";

const chain = (process.env.CHAIN ?? "base") as EvmChainKey;
const token = process.env.TOKEN as Address;
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: EVM_CHAINS[chain], transport: http(process.env.RPC_URL ?? EVM_CHAINS[chain].rpcUrls.default.http[0]) });
const stealth = createStealthEvm({ chain, walletClient, rpcUrl: process.env.RPC_URL });

const quote = await stealth.quoteBuy(token, parseEther("0.001"));
console.log("Buying gets", quote.amountOut, "tokens, charged at", quote.feeBps / 100, "%");

try {
  const bought = await stealth.buy({ token, amountIn: parseEther("0.001"), slippageBps: 300 });
  console.log("Bought", bought.amountOut, "in", bought.hash);
  const sold = await stealth.sell({ token, amountIn: bought.amountOut / 2n });
  console.log("Sold half for", sold.amountOut);
} catch (error) {
  // the first 15 seconds of a coin can cost up to 90%
  if (error instanceof StealthFeeTooHighError) console.log(error.message);
  else throw error;
}

const owed = await stealth.claimable(token, account.address);
if (owed > 0n) console.log("Claimed", (await stealth.claim(token)).amount);
