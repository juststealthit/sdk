// Buys and sells a launchpad coin. MINT is the coin.
import { Keypair } from "@solana/web3.js";

import { createStealthSolana, keypairSigner } from "@juststealthit/sdk/solana";

const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SOLANA_KEY!)));
const sol = createStealthSolana({ signer: keypairSigner(keypair) });
const mint = process.env.MINT!;

const quote = await sol.quote(mint, "buy", 10_000_000n);
console.log("Buying gets", quote.amountOut, "at", quote.feeBps / 100, "%");

const { signature } = await sol.buy({ mint, amount: 10_000_000n, slippageBps: 300 });
console.log("Bought", signature);
