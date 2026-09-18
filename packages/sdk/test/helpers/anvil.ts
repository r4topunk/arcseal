// Throwaway local anvil for the integration test (same pattern as ArcPull's SDK tests). Unlocked dev accounts sign
// through eth_sendTransaction, so the tests never handle key material. Local chain only.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { Abi, Hex } from 'viem';

export const anvilAvailable = spawnSync('anvil', ['--version'], { stdio: 'ignore' }).status === 0;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Starts anvil on a free port with its genesis block at `timestamp` (unix seconds).
 *
 * `--hardfork cancun`: on anvil 1.7's default (prague) each mined block costs time proportional to the chain height,
 * so the 21,000 empty blocks of the log-cursor test take minutes; on cancun they take well under a second. The
 * contracts only need cancun opcodes (transient storage, mcopy). `--prune-history`: no historical states, so anvil
 * never writes its per-block state cache to ~/.foundry/anvil/tmp (gigabytes for 21,000 blocks otherwise).
 */
export async function startAnvil(options: {
  timestamp: number;
  accounts?: number;
}): Promise<{ url: string; stop: () => Promise<void> }> {
  const port = await freePort();
  const args = ['--port', String(port), '--silent', '--accounts', String(options.accounts ?? 10)];
  args.push('--timestamp', String(options.timestamp), '--hardfork', 'cancun', '--prune-history');
  const proc: ChildProcess = spawn('anvil', args, { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      proc.kill('SIGKILL');
      throw new Error('anvil did not start within 15 s');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url,
    stop: () =>
      new Promise((resolve) => {
        if (proc.exitCode !== null) return resolve();
        proc.once('exit', () => resolve());
        proc.kill('SIGTERM');
      }),
  };
}

/** ABI and creation bytecode of a contract compiled by Foundry (contracts/out, written by `forge build`). */
export function foundryArtifact(file: string, name: string): { abi: Abi; bytecode: Hex } {
  const path = fileURLToPath(new URL(`../../../../contracts/out/${file}/${name}.json`, import.meta.url));
  if (!existsSync(path)) {
    throw new Error(`missing Foundry artifact ${path}: run \`pnpm contracts:build\` (forge build) first`);
  }
  const artifact = JSON.parse(readFileSync(path, 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: artifact.abi, bytecode: artifact.bytecode.object };
}
