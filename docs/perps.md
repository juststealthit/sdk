# Perps (read-only)

```ts
import { createPerpsClient } from "@juststealthit/sdk/perps";
const perps = createPerpsClient();
```

Public market data from each venue's own API, grouped by coin the way the site's perps page shows it. **This module only reads.** It has no orders and no account access, and it needs nothing signed.

| Venue | Markets | Funding |
| --- | --- | --- |
| Hyperliquid | Perps, and spot pairs with volume | Hourly |
| Aster | USDT perpetuals, including stocks and commodities | Every 8 hours |
| Jupiter Perps | SOL, ETH, BTC | None (borrow fees instead) |

## Methods

| Method | Returns |
| --- | --- |
| `markets({ venues?, spot? })` | `{ markets, failed }`. A venue that fails is listed in `failed`, and the rest still load |
| `groups({ venues?, spot? })` | Markets grouped by coin, by summed 24 h volume |
| `hyperliquidPerps()`, `hyperliquidSpot()`, `asterPerps()`, `jupiterPerps()` | One venue |
| `candles(market, interval?, { from, to })` | Oldest first. A Jupiter market reads Hyperliquid's candles for the same coin, as the site's chart does |
| `allMids()` | Hyperliquid's mid prices, once |
| `watchMids(fn)` | Hyperliquid's live mids over its public WebSocket. Returns a function that stops it |

Intervals are `1m`, `5m`, `15m`, `1h`, `4h`, `1d` and `1w`.

## The market shape

Each `PerpMarket` has `venue`, `kind` (`perp` or `spot`), `coin`, `symbol`, `name`, `price`, `change24hPct`, `volume24hUsd`, `openInterestUsd`, `funding`, `fundingIntervalHours`, `maxLeverage`, `sizeDecimals` and `assetClass`. `maxLeverage` is `null` where the venue doesn't publish one without a key.

**Thousand-unit markets.** `kPEPE` on Hyperliquid and `1000PEPE` on Aster both have `coin: "PEPE"` and `unitMultiplier: 1000`, so they group together; `price / unitMultiplier` is the price per coin. `normalizePerpCoin(base)` does the same for any name.

## Pure helpers

`hyperliquidPerpMarkets`, `hyperliquidSpotMarkets` and `asterMarkets` turn the venues' raw answers into markets. `groupPerpMarkets(markets)` and `filterPerpGroups(groups, { kind, assetClass, q })` group and filter them. All are pure functions, so you can feed them data you fetched yourself.
