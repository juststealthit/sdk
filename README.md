# @juststealthit/sdk

Launch, trade and read coins on [Just Stealth It](https://juststealthit.xyz) from your own code: Solana (Pump.fun, Raydium, Meteora), Robinhood Chain, BNB Chain, HyperEVM, Base and Arc.

```bash
npm install @juststealthit/sdk
```

Node 20 or newer. ESM only, with types. Import the part you use, so EVM code never loads Solana's library:

| Import | What it does | How it reaches the chain |
| --- | --- | --- |
| `@juststealthit/sdk/evm` | Launch, buy, sell, claim, read on five chains | **Direct on chain.** Your RPC, your wallet, no API |
| `@juststealthit/sdk/solana` | Launch, buy, sell, read, plus Solana's public setup | **Through the API.** It builds the transaction, you check, sign and send it |
| `@juststealthit/sdk/multichain` | One payment, a separate coin on each chain | **Through the API**, with a session, from a server |

> [!WARNING]
> **The EVM contracts are not audited.** Trades and launches cost real money and can't be undone. Start small, on a throwaway wallet. Nothing in this SDK is financial advice.

## EVM

```ts
import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createStealthEvm, EVM_CHAINS } from "@juststealthit/sdk/evm";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: EVM_CHAINS.base, transport: http(process.env.RPC_URL) });
const stealth = createStealthEvm({ chain: "base", walletClient, rpcUrl: process.env.RPC_URL });

// a launch: token, pool and first buy in one transaction
const { token } = await stealth.launch({
  name: "My Coin",
  symbol: "MINE",
  logo: "https://example.com/logo.png",
  taxBps: 125,
  firstBuy: parseEther("0.001"),
});

// trades
const quote = await stealth.quoteBuy(token, parseEther("0.01"));
const bought = await stealth.buy({ token, amountIn: parseEther("0.01"), slippageBps: 300 });
await stealth.sell({ token, amountIn: bought.amountOut / 2n });

// fees
await stealth.claimable(token, account.address);
await stealth.claim(token);
```

The chain keys are `robinhood`, `bnb`, `hyperevm`, `base` and `arc`. The class picks the right contracts, ABIs and pool key for each:

| Chain | Id | Gas | DEX | Worth knowing |
| --- | --- | --- | --- | --- |
| Robinhood Chain | 4663 | ETH | Uniswap v4 | |
| BNB Chain | 56 | BNB | PancakeSwap Infinity | Different pool key, and settlement on a separate Vault |
| HyperEVM | 999 | HYPE | Uniswap v4 | Its own contract addresses |
| Base | 8453 | ETH | Uniswap v4 | |
| Arc | 5042 | USDC | Uniswap v4 | Native USDC has 18 decimals, so amounts are 18-decimal units |

`EVM_DEPLOYMENTS` holds every contract address, and ABIs for both builds are exported as `v4Abis`, `infinityAbis` and `abisFor(dex)`.

### Launch options

| Option | Default | Rule |
| --- | --- | --- |
| `taxBps` | `125` | 125, 225, 325, 425 or 575. Locked at launch |
| `launchType` | `creator` | `creator`, `team`, `marketing`, `holders`, `buyback`. Locked |
| `team` | | `team` only: 2 to 10 wallets, shares sum to 10,000. They can't change later |
| `quote` | native | An ERC-20 the factory lists. Needs an approval, which the SDK sends |
| `target` | the factory's | Graduation target in raw quote units |
| `firstBuy` | `0` | Pays the tier, not the sniper fee. Stops at 5% of supply; the rest comes back |
| `maxWalletBps`, `maxBuyBps` | off | 50-500 and 10-500, for `limitsWindow` seconds, up to an hour |
| `firstBuyLock` | off | Seconds, up to 90 days |
| `creator` | the sender | Who a Creator coin pays |

`prepareLaunch()` shows you the predicted address, the value and the expected tokens before anything is sent. A prepared launch names the factory's `configVersion`, and reverts with `StaleConfig` if a setting changed since.

### What the launch types do on EVM

- **Creator and Team** wallets claim with `claim()`. No bot is involved.
- **Marketing, Holders and Buyback** coins pay through Just Stealth It's bots and a public sweep, so those payouts depend on them running.
- **Pot is refused.** It follows a fee plan that only the site can store, and a coin launched directly would keep its fees in the vault with no way out.
- **Wallet, Diamond Hands, Feed a Coin, Auto Liquidity, Mix and Social** need that same stored plan, so on EVM they're available through [multi-chain](#multi-chain), not direct.

## Solana

```ts
import { Keypair } from "@solana/web3.js";
import { createStealthSolana, keypairSigner } from "@juststealthit/sdk/solana";

const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SOLANA_KEY!)));
const sol = createStealthSolana({ signer: keypairSigner(keypair) });

const { mint, signatures } = await sol.launch({
  venue: "pump",
  name: "My Coin",
  symbol: "MINE",
  feeMode: "buyback",
  firstBuyLamports: 10_000_000n,
});

await sol.buy({ mint, amount: 10_000_000n, slippageBps: 300 });
```

`signer` takes a wallet adapter as it is, or `keypairSigner` for a key in your process.

**Why this goes through the API.** A coin's fees land in an escrow derived from a key the server holds, and that's what runs its launch type. So the server has to build the launch. It simulates it, signs for the mint, and returns a transaction. The SDK checks that your wallet is the fee payer, adds your signature, and sends it through the API or, with `connection`, through your own RPC. Your key never leaves your process, and fees are claimed for you by the server's bot.

| Venue | `venue` | Tiers |
| --- | --- | --- |
| Pump.fun | `pump` | None: Pump sets the fee. 70% of the creator part goes to the coin, 30% to the platform, locked on chain |
| Raydium LaunchLab | `raydium` | `RAYDIUM_TIERS`. The coin gets 0.5% on each tier: Raydium caps it there, so it isn't 70/30 |
| Meteora | `meteora` | `METEORA_TIERS`. Meteora keeps 20%, and the rest splits 70/30 |

`feeMode` picks where creator fees go, locked at launch:

| `feeMode` | Creator fees go to | Needs |
| --- | --- | --- |
| `creator` | The launcher, or `recipient` | |
| `social` | A social account's vault, claimed later | `recipient: { kind: "social", ... }` |
| `team` | 2 to 10 wallets | `team` |
| `wallet` | An address, on Solana or another chain Relay lists | `payout` |
| `marketing` | The coin's marketing | |
| `holders` | Holders, on a schedule | |
| `diamond` | Holders who never sold | |
| `buyback` | Buys the coin and burns it | |
| `feed` | Buys another coin and burns it | `feed` |
| `liquidity` | A pot that joins the pool after graduation | |
| `mix` | 2 to 5 of these, shares you set | `mix` |

What's switched on can change. `await sol.getConfig()` says what the server offers right now, and `getPairs(venue)` lists what a coin can pair with. Social launches are off in production as of this release.

The public setup is exported too: `LAUNCHLAB_PLATFORMS`, `LAUNCH_LOOKUP_TABLE`, `CPMM_CONFIGS`, and `METEORA_SHARED_CONFIGS`, the 20 shared configs by quote mint.

## Multi-chain

One payment from a home chain makes **a separate coin on each chain**. They're not bridged versions of one token.

```ts
import { createStealthMultichain, solanaMcWallet } from "@juststealthit/sdk/multichain";

const mc = createStealthMultichain();
await mc.signIn(solanaMcWallet(sol));

const simulation = await mc.simulate({ home: "solana", chains: ["solana", "base", "bnb"], venue: "pump", name: "Everywhere", symbol: "EVRY" });
console.log(simulation.total, simulation.usd);

const { orderId, payment } = await mc.place(simulation.quoteId);
await mc.paySolana(sol, payment, simulation.total); // or mc.payEvm(walletClient, payment, simulation.total)

const order = await mc.waitForOrder(orderId, { onUpdate: console.log });
```

`simulate` prices the launch from real Relay quotes on the server, and holds for two minutes. Before paying, the SDK checks that the payment is exactly the simulated transfer to the deposit address, and refuses anything else. A chain that fails is retried, then refunded; a coin that landed stays.

The home chain is the one that pays: a Solana wallet pays from Solana, an EVM wallet from its EVM chain. Sign-in takes EOAs only, so smart-contract wallets can't use this.

## Sniper fee

A coin's first 15 seconds cost up to 90%, stepping down each second to the tier, on Meteora and all EVM chains. `buy` and `sell` refuse a trade charged above `maxFeeBps` with a `StealthFeeTooHighError`. The default is 1,000 (10%), and raising it is your call.

## Errors

| Error | Meaning |
| --- | --- |
| `StealthInputError` | The SDK refused your input before sending |
| `StealthFeeTooHighError` | Over `maxFeeBps`: `feeBps` has the rate |
| `StealthTransactionMismatchError` | A transaction from the API wasn't what you asked for, so it wasn't signed |
| `StealthApiError` | The API said no: `status`, `code`, `issues`, `retryAfterSec` |
| `StealthBrowserWriteError` | See below |

EVM reverts come through viem with the contract's error name, such as `StaleConfig` or `MaxBuyExceeded`.

## Limits and access

No API key. Limits are per IP, and a 429 carries `retryAfterSec`.

| Path | Limit |
| --- | --- |
| Anything under `/api` | 1,200 a minute |
| `POST /sol/launch` | 10 per 10 minutes |
| `POST /sol/swap`, `POST /sol/send` | 60 a minute each |
| `POST /sol/send-bundle` | 40 a minute |
| `GET /sol/quote`, `/sol/tx`, `/sol/balance`, `/sol/portfolio` | 180 a minute, shared |
| `GET /sol/launch/pairs` and pair lookups | 60 a minute |
| `GET /sol/tokens/:mint/price` | 120 a minute |
| `POST /sol/tokens/:mint/payout` | 6 a minute, with a cooldown per coin |
| `GET /social-fees/lookup` | 20 a minute |
| `/multichain` writes, reads | 30 and 300 a minute |
| Multi-chain launches | Per paying wallet: see `mc.getConfig()` |

Solana launches and trades need no sign-in: the wallet's signature on the transaction is the authorisation. Multi-chain needs a session, which the API sets as a cookie after a signed message. The SDK carries it for you, and `mc.api.exportSession()` keeps it across restarts. Treat that value like a password for its 8 hours.

### Browsers

**Reads work anywhere. API writes don't work from a browser page on another site.** The API allows cross-origin requests only for reads, so `POST /sol/launch`, `/sol/swap` and `/multichain` are refused by the browser. The SDK raises `StealthBrowserWriteError` rather than a bare CORS failure.

Call those from a server, or give the SDK your own backend with `apiUrl`, forwarding to the official API. Rate limits then count against your server's IP, so plan for that. EVM needs none of this: it runs on your RPC, in a browser too.

## Development

```bash
npm test             # unit tests
npm run test:fork    # the real contracts, on local anvil forks of all five chains
npm run test:live    # reads against production: nothing written, nothing spent
npm run build
```

`test:fork` needs [Foundry](https://getfoundry.sh). It forks each chain locally and every transaction stays inside that process. `FORK_CHAINS=base,bnb` picks chains and `FORK_RPC_BASE=<url>` swaps an RPC.

ABIs are generated from the contracts' forge artifacts with `CONTRACTS_OUT=<out dir> npm run gen:abi`.

## Links

[Website](https://juststealthit.xyz) · [X](https://x.com/juststealthit) · [Telegram](https://t.me/juststealthit)

Just Stealth It is not affiliated with Pump.fun, Raydium, Meteora, Robinhood, BNB Chain, Hyperliquid, Base, Circle or Solana Foundation.

MIT License.
