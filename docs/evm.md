# EVM

```ts
import { createStealthEvm, EVM_CHAINS } from "@juststealthit/sdk/evm";

const stealth = createStealthEvm({ chain: "base", walletClient, rpcUrl });
```

Everything here goes straight to the chain through viem, with no API in between. It works in a browser as well. Reads need only `chain`; writes need a `walletClient` with an account. Before any write, the SDK checks that the RPC is on the right chain.

| Chain | Key | Id | Gas | DEX | Worth knowing |
| --- | --- | --- | --- | --- | --- |
| Robinhood Chain | `robinhood` | 4663 | ETH | Uniswap v4 | Transactions also pay for L1 data |
| BNB Chain | `bnb` | 56 | BNB | PancakeSwap Infinity | Different pool key, and settlement on a separate Vault |
| HyperEVM | `hyperevm` | 999 | HYPE | Uniswap v4 | Its own contract addresses |
| Base | `base` | 8453 | ETH | Uniswap v4 | |
| Arc | `arc` | 5042 | USDC | Uniswap v4 | Native USDC has 18 decimals |

Ethereum (`ethereum`), Arbitrum One (`arbitrum`) and Avalanche C-Chain (`avalanche`) are coming soon: the contracts are being deployed there, and the SDK carries no address for them until each deploy is checked on chain. X Layer (`xlayer`) is coming soon too. `createStealthEvm` refuses all four with a `StealthUnsupportedError` that says so. Aliases such as `bsc` work for the live chains.

## Reads

`getConfig()`, `getQuoteConfig(quote)`, `getCoin(token)` (terms, curve position and current fee), `getBalances(token)`, `claimable(token, wallet)`, `getTeam(token)`, `getPoolKey(token)` and `getLaunches({ fromBlock, toBlock })`.

## Quotes

`quoteBuy`, `quoteBuyExactOut`, `quoteSell` and `quoteSellExactOut` call the DEX's own quoter. That runs the hook, so the answer includes the tax and any sniper fee. `quoteFirstBuy` previews a launch's first buy.

## Launch

```ts
const prepared = await stealth.prepareLaunch({ name: "My Coin", symbol: "MINE", taxBps: 125, firstBuy: parseEther("0.001") });
console.log(prepared.predictedToken, prepared.expectedTokens);
const { token } = await stealth.launch(prepared);
```

| Option | Default | Rule |
| --- | --- | --- |
| `taxBps` | `125` | 125, 225, 325, 425 or 575. Locked at launch |
| `launchType` | `creator` | `creator`, `team`, `marketing`, `holders` or `buyback`. Locked |
| `team` | | `team` only: 2 to 10 wallets whose shares sum to 10,000. Fixed for good |
| `quote` | native | An ERC-20 the factory lists. The SDK sends the approval it needs |
| `target` | the factory's | Graduation target in raw quote units |
| `firstBuy` | `0` | Pays the tier, not the sniper fee. Stops at 5% of supply; anything over comes back |
| `maxWalletBps`, `maxBuyBps` | off | 50 to 500 and 10 to 500, for `limitsWindow` seconds, up to an hour |
| `firstBuyLock` | off | Seconds, up to 90 days |
| `creator` | the sender | Who a Creator coin pays |

`checkLaunchInput(input)` runs the contract's rules offline. A prepared launch names the factory's `configVersion`, and reverts with `StaleConfig` if a setting changed since.

**Pot is refused** on a direct launch. It follows a fee plan that only the site can store, so a coin launched directly would keep its fees in the vault with no way out. Wallet, Diamond Hands, Feed a Coin, Auto Liquidity, Mix and Social need that same stored plan, so on EVM they're available only through [multi-chain](multichain.md).

## Trade and claim

```ts
await stealth.buy({ token, amountIn: parseEther("0.01"), slippageBps: 300, maxFeeBps: 1_000 });
await stealth.sell({ token, amountIn });
await stealth.claim(token);              // Creator and Team coins
await stealth.claimTo(token, amount, to);
await stealth.offerCreator(token, to);   // the new creator then calls acceptCreator(token)
```

## ABIs and addresses

`EVM_DEPLOYMENTS` holds every contract address. ABIs for both builds are exported as `v4Abis`, `infinityAbis` and `abisFor(dex)`, and `quoterAbiFor(dex)` gives the quoter's.

## Through the API

To read a chain's indexed board, candles, trades and holders, use `createStealthClient().evm.chain(key)`; see [api.md](api.md#evm-stealthevm).
