# Contributing

Thanks for helping. Issues and pull requests are welcome at [github.com/juststealthit/sdk](https://github.com/juststealthit/sdk).

## Setup

```bash
npm install
npm run typecheck
npm test
npm run build
```

Node 20 or newer. Unit tests use a fake `fetch` and a fake WebSocket, so they never touch the network.

| Script | What it runs |
| --- | --- |
| `npm test` | Unit tests (`test/unit`). Must pass on every pull request |
| `npm run typecheck` | `tsc` over `src`, `test` and `examples` |
| `npm run build` | Compiles to `dist/` |
| `npm run docs` | The API reference, into `docs/api/` |
| `npm run test:live` | Reads against production. Opt-in: nothing written, nothing spent |
| `npm run test:fork` | The real contracts on local anvil forks. Needs [Foundry](https://getfoundry.sh) |

## Guidelines

- **Use only public routes.** The SDK wraps the API's public reads and the public write flows (Solana launches, swaps, sends and staking, and the multi-chain session flow). Nothing internal or privileged belongs here.
- **Keys stay with the caller.** The SDK never holds, derives or sends a private key. A transaction built by the API is checked before it's signed (at least its fee payer), and anything unexpected is refused with `StealthTransactionMismatchError`.
- **Assume no server limits.** Don't hard-code rate limits; honour `Retry-After`.
- **Keep it lean.** The runtime dependencies are `viem`, `@solana/web3.js` and `@noble/curves`. A new one needs a strong reason. `/api`, `/math`, `/utils` and `/perps` must not import `@solana/web3.js`.
- **Test every module with a mocked `fetch`.** Use `test/unit/helpers.ts` (`fakeApi`, `reply`) and assert on the exact path and body sent.
- **Write JSDoc** on everything exported: what it does, and its units (base units or whole units, seconds or milliseconds).
- **Stay compatible.** Don't break an exported name or signature in a minor version. Deprecate it with `@deprecated` and a pointer to the replacement, and list it in the CHANGELOG.
- **Make no promises.** Docs and examples must never suggest returns or price outcomes.

## Pull requests

1. Branch from `main`.
2. Add or update tests and docs alongside the code.
3. Run `npm run typecheck && npm test && npm run build`.
4. Describe the change in `CHANGELOG.md`.

## Security

Please don't open a public issue for a vulnerability. Report it privately through the contacts on [juststealthit.xyz](https://juststealthit.xyz).
