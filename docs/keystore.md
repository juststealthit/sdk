# Keystore

```ts
import { stealthPaths, readKeystore, pickWallet, unlockSolanaWallet } from "@juststealthit/sdk/keystore";
```

Node only. The config directory and the encrypted keystore that the Stealth CLI and the Stealth MCP server share, in one place, so both read and write the same files the same way. Importing it is light: Solana's and viem's libraries load only when a key is opened or sealed.

## Where the files are

| Platform | Directory |
| --- | --- |
| Windows | `%APPDATA%\stealth` |
| Everywhere else | `$XDG_CONFIG_HOME/stealth` when it's an absolute path, else `~/.config/stealth` |

If that directory has neither `config.json` nor `keystore.json` but `$XDG_CONFIG_HOME/stealth` does (where the 0.1 CLI looked on every platform), that one is used, so no file written by an older tool is lost. `stealthConfigDir()` picks it, `configDirCandidates()` lists the candidates, and `stealthPaths()` returns `{ dir, config, keystore }`.

## The format

`keystore.json`, version 1:

```json
{ "version": 1, "wallets": [{ "name": "main", "kind": "solana", "address": "…",
  "crypto": { "kdf": "scrypt", "kdfparams": { "n": 131072, "r": 8, "p": 1, "salt": "<hex>" },
              "cipher": "aes-256-gcm", "iv": "<hex>", "tag": "<hex>", "ciphertext": "<hex>" } }] }
```

- The key is `scrypt(passphrase, salt, 32)` over the passphrase's UTF-8 bytes, and the secret is sealed with AES-256-GCM.
- Hex may carry `0x`. Reading accepts a 12 to 16 byte iv, a 16 to 64 byte salt, and `n` a power of two from 2^14 to 2^20. Writing uses `n = 2^17`, a 12 byte iv and a 32 byte salt.
- A Solana secret is the 64-byte secret key (or a 32-byte seed); an EVM secret is the 32-byte private key. A secret stored as text (a JSON byte array, base58 or hex) is read too.
- Keys this module doesn't know, at the top or on a wallet, are kept when the file is rewritten.
- The file is written atomically with mode 0600 (a temporary file in the same directory, flushed, then renamed), in a 0700 directory.

Every decrypted key is checked against its wallet's `address` before it is used.

## Functions

| Function | Does |
| --- | --- |
| `readKeystore(dir)` | `{ file, wallets, warnings }`, with a warning when other users can read the file. Throws `not_found` when there's none |
| `loadKeystore(file, { missing })`, `saveKeystore(file, ks)` | Read (missing means empty, or `not_found` with `missing: "throw"`) and write |
| `parseKeystore(json)`, `emptyKeystore()` | Check a parsed file |
| `pickWallet(ks, { name, preferred, kind })` | The named wallet, else the preferred one, else the first of that kind |
| `addWallet`, `removeWallet`, `replaceWallet`, `findWallet` | Edit the list. A name is 1 to 32 letters, digits, dots, dashes or underscores |
| `unlockSolanaWallet(w, pass)`, `unlockEvmWallet(w, pass)` | A `Keypair` or a viem account, checked against the address |
| `sealSolanaWallet(name, keypair, pass)`, `sealEvmWallet(name, key, pass)` | A new entry |
| `encryptSecret`, `decryptSecret`, `deriveKey`, `secretBytes` | The parts, for tools of your own |

Errors are `KeystoreError`s with a `code`: `wrong_passphrase`, `bad_keystore`, `not_found`, `exists`, `invalid_name`, `address_mismatch` or `unsupported`.

Keep the passphrase out of shell history and logs. Nothing here sends a key anywhere.
