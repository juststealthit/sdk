# Maths

```ts
import { sniperFeeBps, splitEvmFee, quoteCurveBuy, estimateStakingReward } from "@juststealthit/sdk/math";
```

Pure functions, with no network. They follow the public docs and the contracts. The chain's state at the moment you trade, and the server's figures, have the last word.

## Fees and the anti-sniper line

| Function | What it gives |
| --- | --- |
| `sniperFeePips(tierBps, seconds)` | The rate in pips (1/1,000,000), exactly as the EVM hook computes it |
| `sniperFeeBps(tierBps, seconds)` | The same in bps. `sniperFeeBps(125, 14)` is 716.67 (7.17%) |
| `sniperSchedule(tierBps)` | One row per second, 0 to 15 |
| `sniperSecondsLeft(launchTimeSec, nowSec?)` | Time left in the window |
| `hasSniperWindow(venue)` | `true` on Meteora and EVM; Pump.fun and Raydium LaunchLab have no window |
| `splitEvmFee(amount, tierBps, chargedBps?)` | The coin gets 70% of the tier, and the platform gets the rest, including any surplus above the tier |
| `splitTierFee(amount, tier, chargedBps?)` | A Raydium or Meteora tier's split, with the venue's cut first |
| `splitPumpCreatorFee(fee)` | 70% to the coin's escrow, 30% to the platform |
| `coinRateBps(venue, tierBps)`, `feeTable()` | What a coin earns of each trade, per venue and tier |
| `minOut(amount, slippageBps)`, `maxIn(amount, slippageBps)` | Slippage bounds |

The line: `rate = 90% − (90% − tier) × floor(seconds) / 15`, then the tier from 15 seconds on.

## Bonding curves

A constant-product curve with virtual reserves: the model Pump.fun and Raydium LaunchLab curves follow. Meteora's curve is piecewise concentrated liquidity, so use the API's quote there.

| Function | What it gives |
| --- | --- |
| `initCurve({ supply, totalSell, raise, locked?, migrateFee? })` | Virtual reserves for a curve that sells `totalSell` for `raise` |
| `quoteCurveBuy(state, quoteIn, feeBps)` | Tokens out, fee, price after, price impact and the new state. Caps at what's left |
| `quoteCurveSell(state, tokensIn, feeBps)` | Quote out after the fee |
| `quoteCurveBuyExactOut(state, tokensOut, feeBps)` | What exactly `tokensOut` costs |
| `quoteToGraduate(state, feeBps)` | What it takes to sell out the curve |
| `curvePrice`, `curvePriceUnits`, `curveProgress`, `curveMarketCap` | Spot figures |
| `priceFromSqrtPriceX96(sqrt)`, `evmMarketCap(sqrt)` | An EVM pool's price. The quote is currency0 |

## Staking rewards

The same formulas the staking server accrues with:

```
reward = staked × apr × boost × seconds / (10,000 × 10,000 × 365 days)
```

| Function | What it gives |
| --- | --- |
| `boostAt(boosts, ageSec)` | The highest step reached, never below 1× |
| `nextBoost(boosts, ageSec)` | The next step, and how long until it |
| `rewardFor(staked, aprBps, multBps, seconds)` | One stretch, rounded down |
| `estimateStakingReward(amount, aprBps, boosts, days)` | A fresh stake over `days`, stepping through the boosts |
| `effectiveAprBps(aprBps, boosts, days)` | The yearly rate, counting boosts |
| `rewardShare(accrued, amount, staked)` | What leaves with a partial unstake |

Take the rate and boosts from `stealth.staking.pool()`. An estimate assumes they hold for the whole period, which they may not, and payouts are capped by what the reward pool holds. **Nothing here is a promise of any return.**
