// Launches on Pump.fun through the API, from a server. SOLANA_KEY is a JSON array of the keypair's bytes.
import { Keypair } from "@solana/web3.js";

import { createStealthSolana, keypairSigner } from "@juststealthit/sdk/solana";

const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SOLANA_KEY!)));
const sol = createStealthSolana({ signer: keypairSigner(keypair) });

const prepared = await sol.prepareLaunch({
  venue: "pump",
  name: "My Coin",
  symbol: "MINE",
  description: "Launched with the SDK.",
  logo: "https://example.com/logo.png",
  socials: { website: "https://example.com" },
  feeMode: "buyback",
  firstBuyLamports: 10_000_000n,
});
console.log("Mint", prepared.mint, "escrow", prepared.escrow);

const { signatures } = await sol.launch(prepared);
console.log("Live on", prepared.venue, signatures);
