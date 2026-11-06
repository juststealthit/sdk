/**
 * `@juststealthit/sdk/keystore` (Node only): the config directory and the encrypted keystore the Stealth CLI and the Stealth MCP
 * server share. One implementation, so both tools read and write the same files the same way.
 *
 * The file is `keystore.json` in the config directory:
 *
 * ```json
 * { "version": 1, "wallets": [{ "name": "main", "kind": "solana", "address": "…",
 *   "crypto": { "kdf": "scrypt", "kdfparams": { "n": 131072, "r": 8, "p": 1, "salt": "<hex>" },
 *               "cipher": "aes-256-gcm", "iv": "<hex>", "tag": "<hex>", "ciphertext": "<hex>" } }] }
 * ```
 *
 * The key is `scrypt(passphrase as UTF-8, salt, 32)` and the secret is sealed with AES-256-GCM. Every decrypted key is checked
 * against the wallet's `address` before it is used, so a wrong file, passphrase or entry can never sign as somebody else. Addresses
 * are public and readable without the passphrase. Keys this module doesn't know, at the top or on a wallet, are kept on a rewrite.
 *
 * ```ts
 * import { readKeystore, pickWallet, unlockSolanaWallet, stealthConfigDir } from "@juststealthit/sdk/keystore";
 *
 * const { wallets, warnings } = await readKeystore(stealthConfigDir());
 * const wallet = pickWallet(wallets, { kind: "solana" });
 * const keypair = await unlockSolanaWallet(wallet!, passphrase);
 * ```
 *
 * @module
 */
import { constants, existsSync } from "node:fs";
import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

// Solana's and viem's libraries load only when a key is opened or sealed: the paths and file helpers stay light, so a CLI command
// that only needs the config directory doesn't pay for them.
import type { Keypair } from "@solana/web3.js";
import type { PrivateKeyAccount } from "viem/accounts";

import { base58Decode, isSolanaAddress } from "../utils/base58.js";

const web3 = () => import("@solana/web3.js");
const viemAccounts = () => import("viem/accounts");
const hex0x = (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}` as `0x${string}`;

// ---- the config directory --------------------------------------------------------------------------------------------

export const CONFIG_FILE = "config.json";
export const KEYSTORE_FILE = "keystore.json";
/** Owner-only, for files that hold secrets. */
export const FILE_MODE = 0o600;
export const DIR_MODE = 0o700;

export interface ConfigDirInputs {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
  /** For tests: whether a path exists. Default `fs.existsSync`. */
  exists?: (p: string) => boolean;
}

/**
 * Where the config directory can be, best first:
 *
 *  1. Windows: `%APPDATA%\stealth` (an absolute APPDATA, else `~\AppData\Roaming`). Elsewhere: `$XDG_CONFIG_HOME/stealth` when it is
 *     an absolute path (the XDG spec says to ignore a relative one), else `~/.config/stealth`.
 *  2. Where the 0.1 CLI looked: `$XDG_CONFIG_HOME/stealth` whenever it was set, on any platform, relative or not.
 *
 * Duplicates are removed.
 */
export function configDirCandidates({ env = process.env, platform = process.platform, home = homedir() }: ConfigDirInputs = {}): string[] {
  const out: string[] = [];
  if (platform === "win32") {
    const appData = env.APPDATA && path.win32.isAbsolute(env.APPDATA) ? env.APPDATA : path.win32.join(home, "AppData", "Roaming");
    out.push(path.win32.join(appData, "stealth"));
    if (env.XDG_CONFIG_HOME) out.push(path.win32.join(env.XDG_CONFIG_HOME, "stealth"));
  } else {
    const xdg = env.XDG_CONFIG_HOME;
    out.push(path.posix.join(xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(home, ".config"), "stealth"));
    if (xdg) out.push(path.posix.join(xdg, "stealth"));
  }
  return [...new Set(out)];
}

/**
 * The config directory the CLI and the MCP server share. The first candidate of {@link configDirCandidates}, unless only a later one
 * already holds a `config.json` or `keystore.json` (files a 0.1 tool wrote there), in which case that one, so no file is lost.
 */
export function stealthConfigDir(inputs: ConfigDirInputs = {}): string {
  const all = configDirCandidates(inputs);
  const exists = inputs.exists ?? existsSync;
  const join = (inputs.platform ?? process.platform) === "win32" ? path.win32.join : path.posix.join;
  const has = (dir: string) => exists(join(dir, CONFIG_FILE)) || exists(join(dir, KEYSTORE_FILE));
  if (has(all[0]!)) return all[0]!;
  return all.find(has) ?? all[0]!;
}

export interface StealthPaths {
  dir: string;
  config: string;
  keystore: string;
}

/** The directory and the two shared files in it. */
export function stealthPaths(inputs: ConfigDirInputs = {}): StealthPaths {
  const dir = stealthConfigDir(inputs);
  const join = (inputs.platform ?? process.platform) === "win32" ? path.win32.join : path.posix.join;
  return { dir, config: join(dir, CONFIG_FILE), keystore: join(dir, KEYSTORE_FILE) };
}

/** Writes a file atomically, owner-only: a temporary file in the same directory (created exclusively), flushed, then renamed over. */
export async function writeFileSecure(file: string, data: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: DIR_MODE });
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  const handle = await open(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, FILE_MODE);
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  // rename keeps the temp file's mode; this also tightens a file another tool created loosely
  await chmod(file, FILE_MODE).catch(() => undefined);
}

// ---- the format ------------------------------------------------------------------------------------------------------

export type WalletKind = "solana" | "evm";

export interface KdfParams {
  n: number;
  r: number;
  p: number;
  /** Hex, at least 16 bytes (32 when written here). */
  salt: string;
}

export interface CryptoBlock {
  kdf: "scrypt";
  kdfparams: KdfParams;
  cipher: "aes-256-gcm";
  /** Hex, 12 bytes when written here (12 to 16 read). */
  iv: string;
  /** Hex, 16 bytes: the GCM tag. */
  tag: string;
  ciphertext: string;
}

export interface KeystoreWallet {
  name: string;
  kind: WalletKind;
  /** Solana: base58. EVM: the 0x address. */
  address: string;
  crypto: CryptoBlock;
  /** Unix ms, when known. */
  createdAt?: number;
  [key: string]: unknown;
}

export interface Keystore {
  version: 1;
  wallets: KeystoreWallet[];
  [key: string]: unknown;
}

export type KeystoreErrorCode = "wrong_passphrase" | "bad_keystore" | "not_found" | "exists" | "invalid_name" | "address_mismatch" | "unsupported";

/** Everything this module throws on purpose. `name` is always `"KeystoreError"`. */
export class KeystoreError extends Error {
  override name = "KeystoreError";
  constructor(
    message: string,
    readonly code: KeystoreErrorCode = "bad_keystore",
  ) {
    super(message);
  }
}

/** The scrypt settings this module writes. */
export const KDF_DEFAULTS = { n: 131_072, r: 8, p: 1 } as const;
/** Refuse parameters that would take minutes or gigabytes, from a file someone else wrote. */
export const KDF_MAX_N = 1 << 20;
/** Refuse entries sealed too weakly to be worth a passphrase. Tests seal at this; real files use {@link KDF_DEFAULTS}. */
export const KDF_MIN_N = 1 << 14;
/** A name the tools give a wallet: 1 to 32 letters, digits, dots, dashes or underscores. */
export const WALLET_NAME = /^[A-Za-z0-9._-]{1,32}$/;

const stripHex = (s: string) => s.replace(/^0x/i, "");
const isHex = (s: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): s is string => {
  if (typeof s !== "string") return false;
  const h = stripHex(s);
  return /^[0-9a-fA-F]*$/.test(h) && h.length % 2 === 0 && h.length / 2 >= min && h.length / 2 <= max;
};
const fromHex = (s: string) => Buffer.from(stripHex(s), "hex");

/** Checks a crypto block. Throws `bad_keystore` on anything this version can't safely use. */
export function assertCryptoBlock(c: unknown): asserts c is CryptoBlock {
  const b = c as Partial<CryptoBlock> | null;
  if (!b || typeof b !== "object") throw new KeystoreError("A wallet has no crypto block.");
  if (b.kdf !== "scrypt") throw new KeystoreError(`Unsupported kdf ${String(b.kdf)}.`);
  if (b.cipher !== "aes-256-gcm") throw new KeystoreError(`Unsupported cipher ${String(b.cipher)}.`);
  const k = b.kdfparams as Partial<KdfParams> | undefined;
  if (!k || typeof k !== "object") throw new KeystoreError("Missing kdfparams.");
  if (!Number.isInteger(k.n) || k.n! < KDF_MIN_N || k.n! > KDF_MAX_N || (k.n! & (k.n! - 1)) !== 0) throw new KeystoreError(`Unsupported scrypt n ${String(k.n)}.`);
  if (!Number.isInteger(k.r) || k.r! < 1 || k.r! > 32 || !Number.isInteger(k.p) || k.p! < 1 || k.p! > 16) throw new KeystoreError("Unsupported scrypt r or p.");
  if (!isHex(k.salt, 16, 64)) throw new KeystoreError("The salt must be 16 to 64 bytes of hex.");
  if (!isHex(b.iv, 12, 16)) throw new KeystoreError("iv must be 12 to 16 bytes of hex.");
  if (!isHex(b.tag, 16, 16)) throw new KeystoreError("tag must be 16 bytes of hex.");
  if (!isHex(b.ciphertext, 1)) throw new KeystoreError("ciphertext must be hex.");
}

const addressFits = (kind: WalletKind, address: string) => (kind === "solana" ? isSolanaAddress(address) : /^0x[0-9a-fA-F]{40}$/.test(address));

/** Checks a parsed `keystore.json`. Unknown keys are kept. Throws `bad_keystore`. */
export function parseKeystore(raw: unknown): Keystore {
  const k = raw as Partial<Keystore> | null;
  if (!k || typeof k !== "object" || Array.isArray(k)) throw new KeystoreError("keystore.json isn't an object.");
  if (k.version !== 1) throw new KeystoreError(`keystore.json is version ${String(k.version)}; this reads version 1.`);
  if (!Array.isArray(k.wallets)) throw new KeystoreError("keystore.json has no wallets list.");
  const names = new Set<string>();
  for (const w of k.wallets as Partial<KeystoreWallet>[]) {
    if (!w || typeof w !== "object") throw new KeystoreError("A wallet entry isn't an object.");
    if (typeof w.name !== "string" || w.name.length < 1 || w.name.length > 64) throw new KeystoreError(`Bad wallet name ${JSON.stringify(w.name)}.`);
    if (names.has(w.name)) throw new KeystoreError(`Two wallets are called ${w.name}.`);
    names.add(w.name);
    if (w.kind !== "solana" && w.kind !== "evm") throw new KeystoreError(`Wallet ${w.name} has unknown kind ${String(w.kind)}.`);
    if (typeof w.address !== "string" || !addressFits(w.kind, w.address)) throw new KeystoreError(`Wallet ${w.name} has an address that isn't a ${w.kind === "evm" ? "EVM" : "Solana"} address.`);
    assertCryptoBlock(w.crypto);
  }
  return k as Keystore;
}

export const emptyKeystore = (): Keystore => ({ version: 1, wallets: [] });

/**
 * Reads `keystore.json` at `file`. A missing file is an empty keystore, or a `not_found` error with `{ missing: "throw" }`.
 * Broken JSON or a bad entry throws `bad_keystore`, and the file is left alone.
 */
export async function loadKeystore(file: string, opts: { missing?: "empty" | "throw" } = {}): Promise<Keystore> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (opts.missing === "throw") throw new KeystoreError(`No keystore at ${file}.`, "not_found");
      return emptyKeystore();
    }
    throw new KeystoreError(`Couldn't read the keystore: ${(error as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new KeystoreError("keystore.json isn't valid JSON. It hasn't been changed; fix or move it before adding a wallet.");
  }
  return parseKeystore(json);
}

/** Writes a keystore atomically with mode 0600, after checking it. */
export async function saveKeystore(file: string, keystore: Keystore): Promise<void> {
  parseKeystore(keystore);
  await writeFileSecure(file, `${JSON.stringify(keystore, null, 2)}\n`);
}

export interface LoadedKeystore {
  file: string;
  wallets: KeystoreWallet[];
  /** Problems worth telling the user, such as a keystore other users can read. */
  warnings: string[];
}

/** File-mode warnings for a keystore, without the passphrase. None on Windows. */
export async function keystoreWarnings(file: string, platform: NodeJS.Platform = process.platform): Promise<string[]> {
  if (platform === "win32") return [];
  try {
    const mode = (await stat(file)).mode & 0o777;
    return mode & 0o077 ? [`The keystore is readable by other users (mode ${mode.toString(8)}). Run: chmod 600 "${file}"`] : [];
  } catch {
    return [];
  }
}

/** Reads `keystore.json` in `dir`, with file-mode warnings. Throws `not_found` when there's none. */
export async function readKeystore(dir: string): Promise<LoadedKeystore> {
  const file = path.join(dir, KEYSTORE_FILE);
  const ks = await loadKeystore(file, { missing: "throw" });
  return { file, wallets: ks.wallets, warnings: await keystoreWarnings(file) };
}

export function findWallet(keystore: Keystore | readonly KeystoreWallet[], name: string): KeystoreWallet | undefined {
  return walletsOf(keystore).find((w) => w.name === name);
}

const walletsOf = (k: Keystore | readonly KeystoreWallet[]): readonly KeystoreWallet[] => (Array.isArray(k) ? k : (k as Keystore).wallets);
const kindName = (k: WalletKind) => (k === "evm" ? "EVM" : "Solana");

/**
 * The wallet a command uses: the one named (a `not_found` error if there's none, `unsupported` if it's the wrong kind), else the
 * `preferred` one if it fits, else the first of the right kind, else `undefined`.
 */
export function pickWallet(keystore: Keystore | readonly KeystoreWallet[], o: { name?: string; preferred?: string; kind?: WalletKind } = {}): KeystoreWallet | undefined {
  const wallets = walletsOf(keystore);
  const fits = (w: KeystoreWallet | undefined) => (w && (!o.kind || w.kind === o.kind) ? w : undefined);
  if (o.name) {
    const w = wallets.find((x) => x.name === o.name);
    if (!w) throw new KeystoreError(`No wallet called ${o.name}.`, "not_found");
    if (o.kind && w.kind !== o.kind) throw new KeystoreError(`${o.name} is an ${kindName(w.kind)} wallet; this needs a ${kindName(o.kind)} one.`, "unsupported");
    return w;
  }
  return fits(o.preferred ? wallets.find((x) => x.name === o.preferred) : undefined) ?? wallets.find((w) => !o.kind || w.kind === o.kind);
}

/** Adds an entry. Refuses a bad or taken name, and the same address twice. */
export function addWallet(keystore: Keystore, entry: KeystoreWallet): Keystore {
  if (!WALLET_NAME.test(entry.name)) throw new KeystoreError("A wallet name is 1 to 32 letters, digits, dots, dashes or underscores.", "invalid_name");
  if (findWallet(keystore, entry.name)) throw new KeystoreError(`A wallet called ${entry.name} already exists.`, "exists");
  const same = keystore.wallets.find((w) => w.kind === entry.kind && w.address.toLowerCase() === entry.address.toLowerCase());
  if (same) throw new KeystoreError(`That key is already stored as ${same.name}.`, "exists");
  return { ...keystore, wallets: [...keystore.wallets, entry] };
}

export function removeWallet(keystore: Keystore, name: string): Keystore {
  if (!findWallet(keystore, name)) throw new KeystoreError(`No wallet called ${name}.`, "not_found");
  return { ...keystore, wallets: keystore.wallets.filter((w) => w.name !== name) };
}

export function replaceWallet(keystore: Keystore, entry: KeystoreWallet): Keystore {
  if (!findWallet(keystore, entry.name)) throw new KeystoreError(`No wallet called ${entry.name}.`, "not_found");
  return { ...keystore, wallets: keystore.wallets.map((w) => (w.name === entry.name ? entry : w)) };
}

// ---- sealing ---------------------------------------------------------------------------------------------------------

/** scrypt over the passphrase's plain UTF-8 bytes, with no normalisation, as every tool reading this file does. */
export function deriveKey(passphrase: string, params: KdfParams): Promise<Buffer> {
  try {
    assertCryptoBlock({ kdf: "scrypt", cipher: "aes-256-gcm", kdfparams: params, iv: "00".repeat(12), tag: "00".repeat(16), ciphertext: "00" });
  } catch (error) {
    return Promise.reject(error);
  }
  const { n, r, p } = params;
  // scrypt needs 128 × n × r × p bytes; leave headroom over Node's 32 MB default
  const maxmem = 128 * n * r * p + 64 * 1024 * 1024;
  return new Promise((resolve, reject) => scrypt(Buffer.from(passphrase, "utf8"), fromHex(params.salt), 32, { N: n, r, p, maxmem }, (error, key) => (error ? reject(error) : resolve(key))));
}

/** Seals a secret. `kdf` lets tests use a cheaper n (2^14 and up); tools writing real files use the defaults. */
export async function encryptSecret(secret: Uint8Array, passphrase: string, kdf: Partial<Omit<KdfParams, "salt">> = {}): Promise<CryptoBlock> {
  const kdfparams: KdfParams = { n: kdf.n ?? KDF_DEFAULTS.n, r: kdf.r ?? KDF_DEFAULTS.r, p: kdf.p ?? KDF_DEFAULTS.p, salt: randomBytes(32).toString("hex") };
  const key = await deriveKey(passphrase, kdfparams);
  const iv = randomBytes(12);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
    return { kdf: "scrypt", kdfparams, cipher: "aes-256-gcm", iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("hex") };
  } finally {
    key.fill(0);
  }
}

/** Opens a sealed secret. A wrong passphrase (or a damaged entry) fails the GCM tag and throws `wrong_passphrase`. Wipe the result after use. */
export async function decryptSecret(block: CryptoBlock, passphrase: string): Promise<Uint8Array> {
  assertCryptoBlock(block);
  const key = await deriveKey(passphrase, block.kdfparams);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, fromHex(block.iv), { authTagLength: 16 });
    decipher.setAuthTag(fromHex(block.tag));
    try {
      return new Uint8Array(Buffer.concat([decipher.update(fromHex(block.ciphertext)), decipher.final()]));
    } catch {
      throw new KeystoreError("Wrong passphrase, or the keystore entry is damaged.", "wrong_passphrase");
    }
  } finally {
    key.fill(0);
  }
}

const printable = (b: Uint8Array) => b.every((c) => c >= 0x20 && c < 0x7f);

function decodeText(text: string): Uint8Array | null {
  const t = text.trim();
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      if (Array.isArray(arr) && (arr.length === 32 || arr.length === 64) && arr.every((x) => Number.isInteger(x) && x >= 0 && x < 256)) return Uint8Array.from(arr as number[]);
    } catch {
      /* not JSON */
    }
    return null;
  }
  const h = stripHex(t);
  if (/^[0-9a-fA-F]+$/.test(h) && (h.length === 64 || h.length === 128)) return Uint8Array.from(Buffer.from(h, "hex"));
  try {
    const b = base58Decode(t);
    if (b.length === 32 || b.length === 64) return b;
  } catch {
    /* not base58 */
  }
  return null;
}

/**
 * The raw key bytes in a decrypted secret. Raw bytes are the canonical form; a text secret (a JSON byte array as Solana's tools write
 * it, base58, or hex) is read too, so a keystore made from an exported key still works.
 */
export function secretBytes(plain: Uint8Array): Uint8Array {
  if (plain.length === 32 || plain.length === 64) {
    // could still be text that happens to be 32 or 64 bytes long: only read it as text if it's printable and decodes
    const asText = printable(plain) ? decodeText(Buffer.from(plain).toString("utf8")) : null;
    return asText ?? plain;
  }
  const decoded = decodeText(Buffer.from(plain).toString("utf8"));
  if (!decoded) throw new KeystoreError("The decrypted secret isn't a key this tool understands.", "unsupported");
  return decoded;
}

/** A Solana keypair from a decrypted secret (a 64-byte secret key or a 32-byte seed), checked against `expectedAddress`. */
export async function solanaKeypairFrom(plain: Uint8Array, expectedAddress: string): Promise<Keypair> {
  const { Keypair } = await web3();
  // a copy: Keypair keeps a reference to what it's given, and the caller wipes the plaintext afterwards
  const bytes = Uint8Array.from(secretBytes(plain));
  let kp: Keypair;
  try {
    kp = bytes.length === 64 ? Keypair.fromSecretKey(bytes) : Keypair.fromSeed(bytes);
  } catch {
    throw new KeystoreError("The decrypted secret isn't a valid Solana key.", "unsupported");
  }
  if (kp.publicKey.toBase58() !== expectedAddress) throw new KeystoreError("The decrypted key doesn't match the wallet's address.", "address_mismatch");
  return kp;
}

/** An EVM account from a decrypted 32-byte private key, checked against `expectedAddress` in any case. */
export async function evmAccountFrom(plain: Uint8Array, expectedAddress: string): Promise<PrivateKeyAccount> {
  const { privateKeyToAccount } = await viemAccounts();
  const bytes = secretBytes(plain);
  if (bytes.length !== 32) throw new KeystoreError("An EVM wallet's secret must be a 32-byte private key.", "unsupported");
  let account: PrivateKeyAccount;
  try {
    account = privateKeyToAccount(hex0x(bytes));
  } catch {
    throw new KeystoreError("The decrypted secret isn't a valid EVM key.", "unsupported");
  }
  if (account.address.toLowerCase() !== expectedAddress.toLowerCase()) throw new KeystoreError("The decrypted key doesn't match the wallet's address.", "address_mismatch");
  return account;
}

/** Decrypts a Solana wallet and checks it. The plaintext is wiped once the keypair holds the key. */
export async function unlockSolanaWallet(wallet: KeystoreWallet, passphrase: string): Promise<Keypair> {
  if (wallet.kind !== "solana") throw new KeystoreError(`Wallet ${wallet.name} isn't a Solana wallet.`, "unsupported");
  const plain = await decryptSecret(wallet.crypto, passphrase);
  try {
    return await solanaKeypairFrom(plain, wallet.address);
  } finally {
    plain.fill(0);
  }
}

/** Decrypts an EVM wallet and checks it. The plaintext is wiped once the account holds the key. */
export async function unlockEvmWallet(wallet: KeystoreWallet, passphrase: string): Promise<PrivateKeyAccount> {
  if (wallet.kind !== "evm") throw new KeystoreError(`Wallet ${wallet.name} isn't an EVM wallet.`, "unsupported");
  const plain = await decryptSecret(wallet.crypto, passphrase);
  try {
    return await evmAccountFrom(plain, wallet.address);
  } finally {
    plain.fill(0);
  }
}

/** A sealed entry for a Solana keypair, ready for {@link addWallet}. */
export async function sealSolanaWallet(name: string, keypair: Keypair, passphrase: string, kdf?: Partial<Omit<KdfParams, "salt">>): Promise<KeystoreWallet> {
  return { name, kind: "solana", address: keypair.publicKey.toBase58(), crypto: await encryptSecret(keypair.secretKey, passphrase, kdf), createdAt: Date.now() };
}

/** A sealed entry for an EVM private key (32 bytes), ready for {@link addWallet}. */
export async function sealEvmWallet(name: string, privateKey: Uint8Array, passphrase: string, kdf?: Partial<Omit<KdfParams, "salt">>): Promise<KeystoreWallet> {
  if (privateKey.length !== 32) throw new KeystoreError("An EVM private key is 32 bytes.", "unsupported");
  const { privateKeyToAccount } = await viemAccounts();
  const address = privateKeyToAccount(hex0x(privateKey)).address;
  return { name, kind: "evm", address, crypto: await encryptSecret(privateKey, passphrase, kdf), createdAt: Date.now() };
}

/** Constant-time comparison, for confirming a passphrase. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}
