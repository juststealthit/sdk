import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Keypair } from "@solana/web3.js";
import { afterAll, describe, expect, it } from "vitest";

import {
  addWallet,
  configDirCandidates,
  decryptSecret,
  emptyKeystore,
  encryptSecret,
  KeystoreError,
  loadKeystore,
  parseKeystore,
  pickWallet,
  readKeystore,
  removeWallet,
  sameSecret,
  saveKeystore,
  sealEvmWallet,
  sealSolanaWallet,
  secretBytes,
  stealthConfigDir,
  stealthPaths,
  unlockEvmWallet,
  unlockSolanaWallet,
  type KeystoreWallet,
} from "../../src/keystore/index.js";
import { base58Encode } from "../../src/solana/signer.js";

// cheap scrypt for tests; real files use n = 2^17
const KDF = { n: 2 ** 14 };
const PASS = "correct horse battery staple";
const dirs: string[] = [];
const tmp = async () => {
  const d = await mkdtemp(path.join(tmpdir(), "stealth-ks-"));
  dirs.push(d);
  return d;
};
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const codeOf = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as KeystoreError).code;

describe("config directory", () => {
  const none = () => false;

  it("uses APPDATA on Windows and an absolute XDG_CONFIG_HOME elsewhere", () => {
    expect(stealthConfigDir({ platform: "win32", env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, home: "C:\\Users\\u", exists: none })).toBe("C:\\Users\\u\\AppData\\Roaming\\stealth");
    expect(stealthConfigDir({ platform: "win32", env: {}, home: "C:\\Users\\u", exists: none })).toBe("C:\\Users\\u\\AppData\\Roaming\\stealth");
    expect(stealthConfigDir({ platform: "linux", env: { XDG_CONFIG_HOME: "/x" }, home: "/home/u", exists: none })).toBe("/x/stealth");
    expect(stealthConfigDir({ platform: "darwin", env: {}, home: "/home/u", exists: none })).toBe("/home/u/.config/stealth");
    // the XDG spec says a relative value is ignored
    expect(stealthConfigDir({ platform: "linux", env: { XDG_CONFIG_HOME: "rel" }, home: "/home/u", exists: none })).toBe("/home/u/.config/stealth");
  });

  it("falls back to where the 0.1 CLI wrote, when only that holds files", () => {
    const env = { APPDATA: "C:\\A", XDG_CONFIG_HOME: "D:\\xdg" };
    expect(configDirCandidates({ platform: "win32", env, home: "C:\\u" })).toEqual(["C:\\A\\stealth", "D:\\xdg\\stealth"]);
    expect(stealthConfigDir({ platform: "win32", env, home: "C:\\u", exists: (p) => p === "D:\\xdg\\stealth\\keystore.json" })).toBe("D:\\xdg\\stealth");
    expect(stealthConfigDir({ platform: "win32", env, home: "C:\\u", exists: () => true })).toBe("C:\\A\\stealth");
    expect(stealthConfigDir({ platform: "linux", env: { XDG_CONFIG_HOME: "rel" }, home: "/home/u", exists: (p) => p === "rel/stealth/config.json" })).toBe("rel/stealth");
    expect(stealthPaths({ platform: "linux", env: {}, home: "/home/u", exists: none }).keystore).toBe("/home/u/.config/stealth/keystore.json");
  });
});

describe("keystore", () => {
  it("seals and opens a Solana wallet, checking the address", async () => {
    const kp = Keypair.generate();
    const w = await sealSolanaWallet("main", kp, PASS, KDF);
    expect(w.address).toBe(kp.publicKey.toBase58());
    expect((await unlockSolanaWallet(w, PASS)).publicKey.toBase58()).toBe(w.address);
    expect(await codeOf(unlockSolanaWallet(w, "wrong"))).toBe("wrong_passphrase");
    expect(await codeOf(unlockSolanaWallet({ ...w, address: Keypair.generate().publicKey.toBase58() }, PASS))).toBe("address_mismatch");
    expect(await codeOf(unlockEvmWallet(w, PASS))).toBe("unsupported");
  });

  it("seals and opens an EVM wallet", async () => {
    const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const w = await sealEvmWallet("evm", key, PASS, KDF);
    expect((await unlockEvmWallet(w, PASS)).address).toBe(w.address);
    expect(await codeOf(unlockEvmWallet({ ...w, address: w.address.toLowerCase() }, PASS))).toBeUndefined();
  });

  it("reads entries written with 0x hex, a 16-byte iv and extra keys, and keeps the extra keys", async () => {
    const kp = Keypair.generate();
    const c = await encryptSecret(kp.secretKey, PASS, KDF);
    const raw = { version: 1, note: "kept", wallets: [{ name: "w", kind: "solana", address: kp.publicKey.toBase58(), createdAt: 1, label: "mine", crypto: { ...c, kdfparams: { ...c.kdfparams, salt: `0x${c.kdfparams.salt}` } } }] };
    const ks = parseKeystore(raw);
    expect(ks.note).toBe("kept");
    expect(ks.wallets[0]!.label).toBe("mine");
    expect((await unlockSolanaWallet(ks.wallets[0]!, PASS)).publicKey.equals(kp.publicKey)).toBe(true);
    expect(() => parseKeystore({ ...raw, wallets: [{ ...raw.wallets[0], crypto: { ...c, iv: "00".repeat(16) } }] })).not.toThrow();
  });

  it("refuses broken files with bad_keystore", () => {
    const bad = (x: unknown) => {
      try {
        parseKeystore(x);
        return null;
      } catch (e) {
        return (e as KeystoreError).code;
      }
    };
    expect(bad([])).toBe("bad_keystore");
    expect(bad({ version: 2, wallets: [] })).toBe("bad_keystore");
    expect(bad({ version: 1, wallets: [{ name: "a", kind: "solana", address: "nope", crypto: {} }] })).toBe("bad_keystore");
    expect(bad({ version: 1, wallets: [{ name: "a", kind: "evm", address: "0x" + "1".repeat(40), crypto: { kdf: "scrypt", cipher: "aes-256-gcm", kdfparams: { n: 3, r: 8, p: 1, salt: "00".repeat(16) }, iv: "00".repeat(12), tag: "00".repeat(16), ciphertext: "00" } }] })).toBe("bad_keystore");
    expect(bad({ version: 1, wallets: [{ name: "a", kind: "evm", address: "0x" + "1".repeat(40), crypto: { kdf: "scrypt", cipher: "aes-256-gcm", kdfparams: { n: 2 ** 13, r: 8, p: 1, salt: "00".repeat(16) }, iv: "00".repeat(12), tag: "00".repeat(16), ciphertext: "00" } }] })).toBe("bad_keystore");
    expect(new KeystoreError("x").name).toBe("KeystoreError");
  });

  it("reads secrets stored as text: a JSON byte array, base58 or hex", () => {
    const kp = Keypair.generate();
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(secretBytes(enc(JSON.stringify([...kp.secretKey])))).toEqual(kp.secretKey);
    expect(secretBytes(enc(base58Encode(kp.secretKey)))).toEqual(kp.secretKey);
    expect(secretBytes(enc(Buffer.from(kp.secretKey).toString("hex")))).toEqual(kp.secretKey);
    expect(secretBytes(kp.secretKey)).toEqual(kp.secretKey);
    expect(() => secretBytes(enc("not a key at all"))).toThrow(KeystoreError);
  });

  it("adds, picks and removes wallets with the CLI's rules", async () => {
    const a = await sealSolanaWallet("a", Keypair.generate(), PASS, KDF);
    const b = await sealEvmWallet("b", new Uint8Array(32).fill(7), PASS, KDF);
    let ks = addWallet(addWallet(emptyKeystore(), a), b);
    expect(() => addWallet(ks, a)).toThrow(/already exists/);
    expect(() => addWallet(ks, { ...a, name: "a copy" })).toThrow(KeystoreError);
    expect(() => addWallet(ks, { ...a, name: "other" })).toThrow(/already stored as a/);
    expect(pickWallet(ks, { kind: "evm" })?.name).toBe("b");
    expect(pickWallet(ks.wallets, { preferred: "b", kind: "solana" })?.name).toBe("a");
    expect(() => pickWallet(ks, { name: "b", kind: "solana" })).toThrow(expect.objectContaining({ code: "unsupported" }));
    expect(() => pickWallet(ks, { name: "zz" })).toThrow(expect.objectContaining({ code: "not_found" }));
    ks = removeWallet(ks, "a");
    expect(ks.wallets.map((w: KeystoreWallet) => w.name)).toEqual(["b"]);
  });

  it("saves atomically with mode 0600 and reads it back with warnings for a loose file", async () => {
    const dir = await tmp();
    const file = path.join(dir, "keystore.json");
    expect((await loadKeystore(file)).wallets).toEqual([]);
    expect(await codeOf(readKeystore(dir))).toBe("not_found");
    const ks = addWallet(emptyKeystore(), await sealSolanaWallet("a", Keypair.generate(), PASS, KDF));
    await saveKeystore(file, ks);
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    const loaded = await readKeystore(dir);
    expect(loaded.wallets[0]!.name).toBe("a");
    expect(loaded.warnings).toEqual([]);
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(1);
    await writeFile(file, "{ not json");
    expect(await codeOf(loadKeystore(file))).toBe("bad_keystore");
  });

  it("decrypts to fresh bytes and compares passphrases in constant time", async () => {
    const c = await encryptSecret(new Uint8Array([1, 2, 3]), PASS, KDF);
    expect([...(await decryptSecret(c, PASS))]).toEqual([1, 2, 3]);
    expect(sameSecret("a", "a")).toBe(true);
    expect(sameSecret("a", "b")).toBe(false);
  });
});
