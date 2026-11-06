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

`CHAINS` lists every chain, each with `key`, `name`, `family`, `status`, `deploying`, `chainId`, `native`, `nativeDecimals`, `dex` and `explorer`.

| Key | Name | Status |
| --- | --- | --- |
| `solana`, `robinhood`, `bnb`, `hyperevm`, `base`, `arc` | Solana, Robinhood Chain, BNB Chain, HyperEVM, Base, Arc | `live` |
| `ethereum`, `arbitrum`, `avalanche` | Ethereum, Arbitrum One, Avalanche C-Chain | `coming_soon`, `deploying: true`: the contracts are being deployed, and have no addresses until each deploy is checked on chain |
| `xlayer` | X Layer | `coming_soon`: announced, nothing deployed |

A coming-soon chain has no contract address anywhere in the SDK, and everything that would act on one (`StealthEvm`, `stealth.evm.chain()`, the market's `{ chain }`) throws a `StealthUnsupportedError` (code `unsupported`) that says it's coming soon.

| Read it with | Gives |
| --- | --- |
| `listChains()`, `liveChains()`, `comingSoonChains()`, `deployingChains()` | Lists of `ChainInfo`, live ones first |
| `LIVE_CHAIN_KEYS`, `LIVE_EVM_CHAIN_KEYS`, `COMING_SOON_CHAIN_KEYS` | Key arrays, for an enum of chains a tool accepts |
| `getChain(key)`, `chainKeyOf(key)` | A chain by key, in any case, or by an alias (`sol`, `bsc`, `eth`, `arb`, `avax`) |
| `chainById(id)` | A chain by EVM chain id |
| `isLiveChain(key)`, `isLiveEvmChain(key)`, `isComingSoonChain(key)` | Exact-key checks |
| `requireLiveChain(key, family?)` | The chain, or the error a coming-soon or unknown chain gets |
| `explorerUrl(chain, "tx" \| "address" \| "token", value)` | An explorer link |

Whether a live EVM chain is switched on right now is the API's call: see `stealth.evm.config()`.

Turning a chain on takes two edits that the type checker holds together: its `status` in `src/utils/chains.ts`, and its addresses in `src/evm/deployments.ts`, the one place contract addresses live. Every other list of chains in the SDK follows from those.

## Site links

`coinPageUrl({ address, chain, onPlatform }, siteUrl?)` is the site's page for a coin: `/token/<address>` for a coin launched here (with `?chain=` off Solana), `/trending/<address>` for an external one (`onPlatform: false`). `SITE_URL` is the site.
