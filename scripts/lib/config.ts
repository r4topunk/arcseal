// Network constants, env parsing and deployment records shared by e2e-testnet.ts and reveal-cli.ts.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Address,
  type Chain,
  defineChain,
  getAddress,
  type Hex,
  http,
  isAddress,
  type Transport,
  toHex,
} from 'viem';
import { arc, arcTestnet, foundry } from 'viem/chains';
import { z } from 'zod';

/** Repository root (scripts/lib/ is two levels down). */
export const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CONTRACTS_DIR = resolve(REPO_DIR, 'contracts');
export const DEPLOYMENTS_DIR = resolve(REPO_DIR, 'deployments');
/** Resumable run state, one file per chain id (gitignored). */
export const STATE_DIR = resolve(REPO_DIR, 'scripts/.state');

/** Arc USDC, ERC-20 view (6 decimals). The native balance is an 18-decimal view of the same funds. */
export const ARC_USDC: Address = '0x3600000000000000000000000000000000000000';
export const USDC_DECIMALS = 6;

export const ARC_MAINNET_ID = 5042;
export const ARC_TESTNET_ID = 5042002;
export const LOCAL_CHAIN_ID = 31337;

/** Where each network's deployment record lives. The dry run never writes the testnet or mainnet files. */
export const DEPLOYMENT_FILES = {
  mainnet: resolve(DEPLOYMENTS_DIR, 'arc-mainnet.json'),
  testnet: resolve(DEPLOYMENTS_DIR, 'arc-testnet.json'),
  dryRun: resolve(DEPLOYMENTS_DIR, 'anvil-dry-run.json'),
} as const;

export interface NetworkInfo {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorer: string;
}

/** PRD 9 network facts. viem ships `arc` and `arcTestnet`; the PRD's RPC and explorer URLs win over viem's defaults. */
export const NETWORKS: Record<'mainnet' | 'testnet', NetworkInfo> = {
  mainnet: {
    chainId: ARC_MAINNET_ID,
    name: 'arc-mainnet',
    rpcUrl: 'https://rpc.mainnet.arc.io',
    explorer: 'https://explorer.arc.io',
  },
  testnet: {
    chainId: ARC_TESTNET_ID,
    name: 'arc-testnet',
    rpcUrl: 'https://rpc.testnet.arc.io',
    explorer: 'https://explorer.testnet.arc.io',
  },
};

/** viem chain for `chainId` with the given RPC (and explorer, when there is one). */
export function chainFor(chainId: number, rpcUrl: string, explorer = ''): Chain {
  const base = chainId === ARC_MAINNET_ID ? arc : chainId === ARC_TESTNET_ID ? arcTestnet : foundry;
  if (base.id !== chainId) throw new Error(`unsupported chain id ${chainId}`);
  return defineChain({
    ...base,
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: explorer ? { default: { name: 'Explorer', url: explorer } } : undefined,
  });
}

/**
 * HTTP transport for signing wallets that adds a 20 % gas margin, as a browser wallet does. Without it the gas limit
 * is the node's exact figure: viem uses eth_fillTransaction or eth_estimateGas for local accounts, and the node fills
 * gas itself for an eth_sendTransaction without one (anvil's unlocked accounts). Gas can depend on state that moves
 * between the estimate and inclusion (a revealBatch that credits the bounty costs more than one that skips it; before
 * roundAfter became branch-free, propose cost 70 gas more off a drand round boundary), and an exact estimate then runs
 * out of gas onchain although the simulation passed. @arcseal/sdk applies the same margin to local accounts; this
 * transport also covers anvil's unlocked accounts. Unused gas is not charged.
 */
export function httpWithGasMargin(url: string): Transport {
  const base = http(url);
  const pad = (gas: Hex) => toHex((BigInt(gas) * 120n) / 100n);
  return ((options) => {
    const transport = base(options);
    const send = transport.request as (args: { method: string; params?: unknown }) => Promise<unknown>;
    const request = (async (args: { method: string; params?: unknown }) => {
      if (args.method === 'eth_sendTransaction') {
        const [tx] = args.params as [Record<string, unknown>];
        if (tx.gas === undefined) {
          const gas = (await send({ method: 'eth_estimateGas', params: [tx] })) as Hex;
          return send({ method: args.method, params: [{ ...tx, gas: pad(gas) }] });
        }
      }
      const result = await send(args);
      if (args.method === 'eth_estimateGas') return pad(result as Hex);
      if (args.method === 'eth_fillTransaction') {
        const filled = result as { tx?: { gas?: Hex } };
        if (filled.tx?.gas) return { ...filled, tx: { ...filled.tx, gas: pad(filled.tx.gas) } };
      }
      return result;
    }) as typeof transport.request;
    return { ...transport, request };
  }) as Transport;
}

/** `<explorer>/tx/<hash>`, or '' on a chain without an explorer (anvil). */
export function txUrl(explorer: string, hash: string): string {
  return explorer ? `${explorer.replace(/\/+$/, '')}/tx/${hash}` : '';
}

// ------------------------------------------------------------------------------------------------ env

/** .env.example ships placeholders such as `[ADDRESS]`; a value that is still a placeholder counts as unset. */
const unsetIfPlaceholder = (value: unknown) =>
  typeof value === 'string' && (value.trim() === '' || /^\[.*\]$/.test(value.trim())) ? undefined : value;

const optionalString = z.preprocess(unsetIfPlaceholder, z.string().optional());
const optionalAddress = z.preprocess(
  unsetIfPlaceholder,
  z
    .string()
    .refine((s) => isAddress(s, { strict: false }), { error: 'not an address' })
    .transform((s) => getAddress(s))
    .optional(),
);
const optionalUint = (fallback?: number) =>
  z.preprocess(
    unsetIfPlaceholder,
    z.coerce
      .number()
      .int()
      .nonnegative()
      .optional()
      .default(fallback as number),
  );

/** Env of the testnet e2e run (all optional; defaults follow .env.example). */
export const testnetEnvSchema = z.object({
  ARC_TESTNET_RPC: z.preprocess(unsetIfPlaceholder, z.url().default(NETWORKS.testnet.rpcUrl)),
  SEALED_DAO_ADDRESS: optionalAddress,
  SEALED_DAO_DEPLOY_BLOCK: z.preprocess(unsetIfPlaceholder, z.coerce.bigint().nonnegative().optional()),
  MEMBER1_ACCOUNT: z.preprocess(unsetIfPlaceholder, z.string().default('arcseal-deployer')),
  MEMBER2_ACCOUNT: z.preprocess(unsetIfPlaceholder, z.string().default('arcseal-wallet-b')),
  MEMBER3_ACCOUNT: z.preprocess(unsetIfPlaceholder, z.string().default('arcseal-wallet-c')),
  KEYSTORE_DIR: optionalString,
  KEYSTORE_PASSWORD_FILE: optionalString,
  MEMBER1_PASSWORD_FILE: optionalString,
  MEMBER2_PASSWORD_FILE: optionalString,
  MEMBER3_PASSWORD_FILE: optionalString,
  E2E_VOTING_SECONDS: optionalUint(600).pipe(z.number().min(600).max(604_800)),
  E2E_PAYOUT: z.preprocess(unsetIfPlaceholder, z.coerce.bigint().positive().default(1_000_000n)),
  E2E_MAX_WAIT_SECONDS: optionalUint(900),
});
export type TestnetEnv = z.output<typeof testnetEnvSchema>;

/** Parses `env` or throws one error that lists every bad variable. */
export function parseEnv<S extends z.ZodType>(schema: S, env: NodeJS.ProcessEnv = process.env): z.output<S> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  throw new Error(`invalid environment:\n${lines.join('\n')}`);
}

/** LOG_LEVEL for the SDK's pino logger (stderr). CLIs default to 'warn' so the human-readable output stays clean. */
export function logLevel(env: NodeJS.ProcessEnv = process.env) {
  const levels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
  const value = env.LOG_LEVEL as (typeof levels)[number] | undefined;
  return value && levels.includes(value) ? value : 'warn';
}

// ------------------------------------------------------------------------------------------------ deployments

const deploymentSchema = z.object({
  chainId: z.number().int(),
  contracts: z.object({
    SealedDAO: z.object({
      address: z.string().nullable(),
      deployBlock: z.number().int().nonnegative().nullable(),
    }),
  }),
});

/** The SealedDAO address and deploy block recorded in a deployments JSON, or null while it is still a template. */
export function readDeployment(file: string): { chainId: number; dao: Address; deployBlock: bigint } | null {
  if (!existsSync(file)) return null;
  const parsed = deploymentSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const { address, deployBlock } = parsed.contracts.SealedDAO;
  if (!address || deployBlock === null || !isAddress(address, { strict: false })) return null;
  return { chainId: parsed.chainId, dao: getAddress(address), deployBlock: BigInt(deployBlock) };
}
