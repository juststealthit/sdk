import { spawn, type ChildProcess } from "node:child_process";

import { createPublicClient, createTestClient, createWalletClient, http, publicActions, type Address, type PublicClient, type WalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { EVM_CHAINS, EVM_DEPLOYMENTS, type EvmChainKey } from "../../src/evm/index.js";

/**
 * Fresh keys for each run, funded inside the fork only. Anvil's default accounts won't do on a fork: their public keys carry EIP-7702
 * delegations to sweeper contracts on live chains, so native coin sent to them is forwarded away and a claim looks like it paid nothing.
 */
const accounts = Array.from({ length: 4 }, () => privateKeyToAccount(generatePrivateKey()));
export const accountAt = (index: number) => accounts[index]!;

export interface Fork {
  url: string;
  publicClient: PublicClient;
  walletAt: (index: number) => WalletClient;
  test: ReturnType<typeof createTestClient>;
  /** Moves the fork's clock on and mines. */
  warp: (seconds: number) => Promise<void>;
  /** Sends as any address, inside the fork only. */
  impersonate: (address: Address) => Promise<WalletClient>;
  stop: () => void;
}

export async function startFork(chain: EvmChainKey, port: number): Promise<Fork> {
  const d = EVM_DEPLOYMENTS[chain];
  const rpc = process.env[`FORK_RPC_${chain.toUpperCase()}`] ?? d.rpcUrl;
  const child: ChildProcess = spawn("anvil", ["--fork-url", rpc, "--port", String(port), "--host", "127.0.0.1", "--silent", "--retries", "8", "--timeout", "45000", "--no-storage-caching"], { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  // the only guard that matters here: everything below talks to this local process, never to a real chain
  if (!url.startsWith("http://127.0.0.1:")) throw new Error("Forks must be local.");
  const transport = http(url, { timeout: 60_000, retryCount: 2 });
  const viemChain = EVM_CHAINS[chain];
  const publicClient = createPublicClient({ chain: viemChain, transport, pollingInterval: 200 }) as PublicClient;
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      if ((await publicClient.getChainId()) === d.chainId) break;
    } catch {
      /* still starting */
    }
    if (child.exitCode !== null) throw new Error(`anvil exited on ${chain}`);
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`anvil didn't fork ${chain} in time`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const test = createTestClient({ mode: "anvil", chain: viemChain, transport });
  return {
    url,
    publicClient,
    test,
    walletAt: (index) => createWalletClient({ account: accountAt(index), chain: viemChain, transport }).extend(publicActions) as unknown as WalletClient,
    warp: async (seconds) => {
      await test.increaseTime({ seconds });
      await test.mine({ blocks: 1 });
    },
    impersonate: async (address) => {
      await test.impersonateAccount({ address });
      await test.setBalance({ address, value: 10n ** 21n });
      return createWalletClient({ account: address, chain: viemChain, transport });
    },
    stop: () => void child.kill("SIGKILL"),
  };
}
