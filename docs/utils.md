# Utils

```ts
import { formatPrice, isSolanaAddress, CHAINS } from "@juststealthit/sdk/utils";
```

## Formatting

The site's number style. Output doesn't depend on the locale.

| Function | Example |
| --- | --- |
| `formatPrice(p, prefix?)` | `0.00000123` → `$0.0₅123` (a subscript count of zeros); `1.5` → `$1.500` |
| `parseSubscriptPrice(s)` | `"$0.0₅123"` → `0.00000123` |
| `formatUsd(n)` | `$0.42`, `$123`, `$1.23M`, `<$0.01` |
| `formatCompact(n)` | `1.23K`, `4.5M`, `2.5T` |
| `formatPercent(n, { sign, digits })` | `+12.3%`, `−4.5%` |
| `formatBps(bps)` | `125` → `1.25%`, `87.5` → `0.875%` |
| `formatTokens(n)` | `12.3M`, `0.0042` |
| `formatUnits(value, decimals, maxDecimals?)` | Exact base units to a decimal string: `1_500_000n, 6` → `"1.5"` |
| `parseUnits(value, decimals)` | Back to base units, exactly. Throws if there are more decimals than the token has |
| `lamportsToSol`, `solToLamports` | 9 decimals |
| `shortAddress(a)` | `0x1234…5678`, `So11…1112` |
| `formatAge(ms)`, `formatDuration(sec)` | `5m`, `3h`; `12m 05s`, `2d 4h 12m` |

Negative numbers use the typographic minus (U+2212) so columns line up. Pass `{ minus: "-" }` for the ASCII one, or `{ empty: "n/a" }` to change how a missing value prints.

## Addresses

| Function | What it checks |
| --- | --- |
| `isSolanaAddress(v)` | Base58 that decodes to exactly 32 bytes |
| `isEvmAddress(v)` | `0x` and 40 hex digits; a mixed-case address must carry a valid EIP-55 checksum |
| `checksumEvmAddress(v)` | The EIP-55 form |
| `addressFamily(v)` | `"svm"`, `"evm"` or `null` |
| `isAddressFor(chain, v)` | The right family for a chain key |
| `sameAddress(a, b)` | EVM addresses compared case-insensitively, Solana addresses exactly |
| `base58Decode(s)` | Bytes |

These check the format only, not whether anything lives at the address.

## Chain registry

`CHAINS` lists every chain, each with `key`, `name`, `family`, `status`, `chainId`, `native`, `nativeDecimals`, `dex` and `explorer`.

| Key | Status |
| --- | --- |
| `solana`, `robinhood`, `bnb`, `hyperevm`, `base`, `arc` | `live` |
| `avalanche`, `arbitrum`, `xlayer` | `coming_soon`: announced, nothing deployed |

`listChains()`, `liveChains()`, `comingSoonChains()`, `getChain(key)`, `chainById(id)`, `isLiveChain(key)` and `explorerUrl(chain, "tx" | "address" | "token", value)` read it. Whether a live EVM chain is switched on right now is the API's call: see `stealth.evm.config()`.
