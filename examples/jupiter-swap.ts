// Buys any Solana token with SOL through the Jupiter route, then sells half. SOLANA_KEY is a JSON array of the keypair's bytes, MINT the token.
// The transaction is built by the API, checked and signed here; the key never leaves this process.
import { Keypair } from "@solana/web3.js";

import { createStealthSolana, keypairSigner } from "@juststealthit/sdk/solana";

const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SOLANA_KEY!)));
const sol = createStealthSolana({ signer: keypairSigner(keypair) });
const mint = process.env.MINT!;

const quote = await sol.marketQuote(mint, "buy", 5_000_000n);
console.log("0.005 SOL buys", quote.amountOut, "via", quote.route.join(" → "), "impact", quote.priceImpactPct, "%");

const bought = await sol.marketBuy({ mint, amount: 5_000_000n, slippageBps: 300, maxPriceImpactPct: 5 });
console.log("Bought in", bought.signature);

const half = BigInt(bought.quote.amountOut) / 2n;
const sold = await sol.marketSell({ mint, amount: half });
console.log("Sold half in", sold.signature);

// or let the SDK pick: the coin's own venue for a launchpad coin, Jupiter for anything else
const auto = await sol.swap({ mint, side: "buy", amount: 1_000_000n });
console.log("Auto-routed through", auto.route);
