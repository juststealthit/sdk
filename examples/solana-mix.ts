// A Mix on Meteora: 60% of creator fees buy back and burn, 40% go to holders.
import { Keypair } from "@solana/web3.js";

import { createStealthSolana, keypairSigner, METEORA_TIERS } from "@juststealthit/sdk/solana";

const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SOLANA_KEY!)));
const sol = createStealthSolana({ signer: keypairSigner(keypair) });

const { mint, signatures } = await sol.launch({
  venue: "meteora",
  taxTier: METEORA_TIERS.find((t) => t.default)!.id,
  name: "Mixed",
  symbol: "MIXD",
  feeMode: "mix",
  mix: [
    { kind: "buyback", bps: 6_000 },
    { kind: "holders", bps: 4_000 },
  ],
});
console.log(mint, signatures);
