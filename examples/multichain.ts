// One payment from Solana, a separate coin on each chain. Server-side: it needs the API's session cookie.
import { Keypair } from "@solana/web3.js";

import { createStealthMultichain, solanaMcWallet } from "@juststealthit/sdk/multichain";
import { createStealthSolana, keypairSigner } from "@juststealthit/sdk/solana";

const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SOLANA_KEY!)));
const sol = createStealthSolana({ signer: keypairSigner(keypair) });
const mc = createStealthMultichain();

const { limits, chains } = await mc.getConfig();
console.log("Open:", chains.filter((c) => c.available).map((c) => c.chain), "limits", limits);

await mc.signIn(solanaMcWallet(sol));

const simulation = await mc.simulate({ home: "solana", chains: ["solana", "base", "bnb"], venue: "pump", name: "Everywhere", symbol: "EVRY", feeMode: "creator" });
console.log("Total", simulation.total, "lamports, about $", simulation.usd);

const { orderId, payment } = await mc.place(simulation.quoteId);
await mc.paySolana(sol, payment, simulation.total);

const order = await mc.waitForOrder(orderId, { onUpdate: (o) => console.log(o.status, o.legs.map((l) => `${l.chain}:${l.status}`).join(" ")) });
for (const leg of order.legs) console.log(leg.chain, leg.token ?? leg.status);
