# Multi-chain

One payment from a home chain makes **a separate coin on each chain**. They're not bridged versions of one token.

```ts
import { createStealthMultichain, solanaMcWallet } from "@juststealthit/sdk/multichain";

const mc = createStealthMultichain();
const { chains } = await mc.getConfig();                 // which chains are on offer
await mc.signIn(solanaMcWallet(sol));                    // or evmMcWallet(walletClient)

const sim = await mc.simulate({ home: "solana", chains: ["solana", "base", "bnb"], venue: "pump", name: "Everywhere", symbol: "EVRY" });
const { orderId, payment } = await mc.place(sim.quoteId);
await mc.paySolana(sol, payment, sim.total);             // or mc.payEvm(walletClient, payment, sim.total)
const order = await mc.waitForOrder(orderId, { onUpdate: console.log });
```

- `simulate` prices the launch from real Relay quotes, on the server. The answer holds for two minutes, and nothing is reserved.
- Before paying, the SDK checks that the payment is exactly the simulated transfer to the deposit address. It refuses anything else.
- A chain that fails is retried, then refunded. A coin that landed stays.
- The home chain is the one that pays. Sign-in takes plain wallets only (EOAs), so smart-contract wallets can't use this.

**Run this from a server.** The writes need the API's session cookie, which a browser page on another site can't get. `mc.api.exportSession()` keeps a session across restarts; treat that value like a password for its 8 hours.

To see which coins launched together, without a session, use `getGroup(id)`, `getGroupOfCoin(chain, token)` and `getGroups()`, or `createStealthClient().multichain`.
