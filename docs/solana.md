# Solana

```ts
import { createStealthSolana, keypairSigner } from "@juststealthit/sdk/solana";

const sol = createStealthSolana({ signer: keypairSigner(keypair) });
```

`signer` takes a wallet adapter as it is (`publicKey`, `signTransaction`, optionally `signAllTransactions` and `signMessage`), or `keypairSigner(keypair)` for a key held in your process. Reads need no signer.

| Option | Default | What it does |
| --- | --- | --- |
| `signer` | none | Signs launches, trades and stakes |
| `connection` | none | Send and confirm through your own RPC rather than the API. Bundles always go through the API |
| `pollMs` | 1,200 ms | Time between confirmation checks |
| `confirmTimeoutMs` | 90 s | How long to wait for a confirmation |
| `bundleTimeoutMs` | 70 s | How long to keep resubmitting a bundle |
| plus every [HTTP option](errors-and-http.md) | | |

## Why the API builds transactions

A coin's fees land in an escrow derived from a key the server holds, and that escrow is what runs its launch type. So the server builds the launch. It simulates it, signs for the mint, and returns a transaction. The SDK then:

1. decodes it (legacy or v0),
2. **refuses it unless your wallet is the fee payer**,
3. adds your signature, keeping any the API already added,
4. sends it and waits for confirmation.

Your key never leaves your process.

## Launch

```ts
const prepared = await sol.prepareLaunch({ venue: "meteora", taxTier: "m100", name: "My Coin", symbol: "MINE", feeMode: "holders", firstBuyLamports: 10_000_000n });
const { mint, signatures } = await sol.launch(prepared);
```

`checkSolanaLaunch(input)` runs the same checks offline. When a launch needs more than one transaction, they go out in order, or together as a Jito bundle.

| `feeMode` | Creator fees go to | Needs |
| --- | --- | --- |
| `creator` | The launcher, or `recipient` | |
| `social` | A social account's vault, claimed later | `recipient: { kind: "social", provider, handle, accountId }` |
| `team` | 2 to 10 wallets | `team` |
| `wallet` | An address, on Solana or another chain Relay lists | `payout` |
| `marketing` | The coin's marketing ladder | |
| `holders` | Holders, on a schedule | |
| `diamond` | Holders who never sold | |
| `buyback` | Buys the coin and burns it | |
| `feed` | Buys another coin and burns it | `feed` |
| `liquidity` | A pot that joins the pool after graduation | |
| `mix` | 2 to 5 of these, in shares you set | `mix` |

## Trade a launchpad coin

```ts
const q = await sol.quote(mint, "buy", 10_000_000n);
await sol.buy({ mint, amount: 10_000_000n, slippageBps: 300, maxFeeBps: 1_000 });
await sol.sell({ mint, amount: tokens });
```

This route covers coins still on their own venue: `token.sol.swapVia === "app"`. `maxFeeBps` (default 1,000) refuses a trade inside the anti-sniper window.

## Trade any token through Jupiter

```ts
await sol.marketBuy({ mint, amount: 5_000_000n, slippageBps: 300, maxPriceImpactPct: 5 });
await sol.marketSell({ mint, amount: baseUnits });
```

The API asks Jupiter for a route (paid in SOL) and returns an unsigned v0 transaction that only your wallet pays and signs. The SDK refuses one paid by anyone else, and one that would accept nothing back. `maxPriceImpactPct` refuses a route that moves the price too far.

`sol.swap({ mint, side, amount })` picks the route for you: the coin's own venue for a launchpad coin still there, Jupiter for everything else. It returns which one it took.

## Stake $STEALTH

```ts
const pool = await sol.staking.pool();        // rate, boosts, cooldown, minimum
await sol.stake(100n * 10n ** 6n);            // prepare → check → sign → submit
const pos = await sol.staking.position("stealth", owner);
await sol.unstake(50n * 10n ** 6n);           // released with its reward after the cooldown
```

The staking wallet co-signs the exact transaction it prepared, so the SDK signs it exactly as it came and never rebuilds it. A result of `status: "sent"` means confirmation took too long; the server settles it later.

## Reads

`sol.data` is the full Solana read client (the same as `createStealthClient().sol`), sharing this client's HTTP settings. The older `getTokens`, `getToken`, `getTrades`, `getHolders` and so on still work, and now return typed results.

## Public setup

`RAYDIUM_TIERS`, `METEORA_TIERS`, `PUMP_SHARES`, `METEORA_SNIPER`, `GLOBAL_TAX_STOPS_BPS`, `SOLANA_LAUNCH_TYPES`, `MIX_SLICES`, `TEAM_LIMITS`, `MIX_LIMITS`, `HOLDER_RULES`, `SOLANA_PROGRAMS`, `LAUNCHLAB_PLATFORMS`, `CPMM_CONFIGS`, `LAUNCH_LOOKUP_TABLE` and `METEORA_SHARED_CONFIGS` (the 20 shared configs, by quote mint).
