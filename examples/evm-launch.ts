// Launches on Base, direct on chain, with a small first buy. PRIVATE_KEY pays. RPC_URL is optional.
import { parseEther } from "viem";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { createStealthEvm, EVM_CHAINS } from "@juststealthit/sdk/evm";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: EVM_CHAINS.base, transport: http(process.env.RPC_URL ?? EVM_CHAINS.base.rpcUrls.default.http[0]) });
const stealth = createStealthEvm({ chain: "base", walletClient, rpcUrl: process.env.RPC_URL });

const prepared = await stealth.prepareLaunch({
  name: "My Coin",
  symbol: "MINE",
  description: "Launched with the SDK.",
  logo: "https://example.com/logo.png",
  socials: { website: "https://example.com" },
  taxBps: 125,
  firstBuy: parseEther("0.001"),
});
console.log("It will land at", prepared.predictedToken, "and buy", prepared.expectedTokens, "tokens");

const { token, hash } = await stealth.launch(prepared);
console.log("Launched", token, "in", hash);
