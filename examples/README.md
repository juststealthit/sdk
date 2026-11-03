# Examples

Each file runs with `npx tsx examples/<file>.ts`. Run `npm run build` first. Anything that writes needs a key in the environment and spends real money on mainnet, so start with a small amount and a throwaway wallet.

## Reads (no key needed)

| File | What it shows |
| --- | --- |
| [read-only.ts](read-only.ts) | An EVM chain's factory config, and the Solana board |
| [board.ts](board.ts) | The cross-chain board: counts, top coins, and walking every page |
| [coin-report.ts](coin-report.ts) | One Solana coin: price, risk, holders, top traders, launch type (`MINT`) |
| [candles-csv.ts](candles-csv.ts) | A day of 5-minute candles as CSV (`MINT`) |
| [wallet-report.ts](wallet-report.ts) | A wallet's PnL, trades, rewards and profile (`WALLET`) |
| [evm-board.ts](evm-board.ts) | An EVM chain through the API, plus polling for new trades (`CHAIN`) |
| [feed.ts](feed.ts) | The Feed, and fees paid out by type |
| [burn-tracker.ts](burn-tracker.ts) | The $STEALTH buy back and burn |
| [live-trades.ts](live-trades.ts) | Every trade and launch as it happens, over the live stream |
| [perps-markets.ts](perps-markets.ts) | Perps markets grouped by coin, and candles. Read-only |
| [fees-math.ts](fees-math.ts) | The anti-sniper line, fee table and a curve preview, offline |
| [robust-client.ts](robust-client.ts) | Retries, cache, hooks, cancellation and typed errors |

## Writes (need a key)

| File | What it shows |
| --- | --- |
| [solana-launch.ts](solana-launch.ts) | A Pump.fun launch (`SOLANA_KEY`) |
| [solana-mix.ts](solana-mix.ts) | A Mix on Meteora: buy back and burn plus holders |
| [solana-trade.ts](solana-trade.ts) | Buy a launchpad coin (`MINT`) |
| [jupiter-swap.ts](jupiter-swap.ts) | Buy and sell any Solana token through Jupiter, and auto-routing |
| [staking.ts](staking.ts) | Estimate, then stake $STEALTH (estimates only without `SOLANA_KEY`) |
| [evm-launch.ts](evm-launch.ts) | A direct launch on Base (`PRIVATE_KEY`) |
| [evm-trade.ts](evm-trade.ts) | Buy, sell and claim on any EVM chain |
| [multichain.ts](multichain.ts) | One payment, a coin on each chain |
