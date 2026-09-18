import { type Address, type Chain, defineChain, getAddress, isAddress, zeroAddress } from 'viem';
import { anvil, arc, arcTestnet } from 'viem/chains';

/** Chains the app can be built for: Arc mainnet, Arc testnet and a local anvil for development and review. */
export const SUPPORTED_CHAIN_IDS = [5042, 5042002, 31337] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

const DEFAULTS: Record<
  SupportedChainId,
  { base: Chain; rpc: string; explorer: string | null; label: string }
> = {
  5042: { base: arc, rpc: 'https://rpc.mainnet.arc.io', explorer: 'https://explorer.arc.io', label: 'Arc' },
  5042002: {
    base: arcTestnet,
    rpc: 'https://rpc.testnet.arc.io',
    explorer: 'https://explorer.testnet.arc.io',
    label: 'Arc Testnet',
  },
  31337: { base: anvil, rpc: 'http://127.0.0.1:8545', explorer: null, label: 'Local anvil' },
};

/** The NEXT_PUBLIC_* values the app reads. Every field is optional; defaults target Arc mainnet. */
export interface PublicEnv {
  NEXT_PUBLIC_CHAIN_ID?: string | undefined;
  NEXT_PUBLIC_RPC_URL?: string | undefined;
  NEXT_PUBLIC_DAO_ADDRESS?: string | undefined;
  NEXT_PUBLIC_DAO_DEPLOY_BLOCK?: string | undefined;
  NEXT_PUBLIC_EXPLORER_URL?: string | undefined;
  NEXT_PUBLIC_SITE_URL?: string | undefined;
  NEXT_PUBLIC_REPO_URL?: string | undefined;
  NEXT_PUBLIC_BASE_PATH?: string | undefined;
}

export interface AppConfig {
  chainId: SupportedChainId;
  chain: Chain;
  chainLabel: string;
  rpcUrl: string;
  /** Block explorer base URL without a trailing slash, or null (local anvil has none). */
  explorerUrl: string | null;
  /** SealedDAO address, or null when NEXT_PUBLIC_DAO_ADDRESS is unset or a placeholder. */
  dao: Address | null;
  /** First block scanned for DAO logs. 0 when unset: set it, or scans walk the whole chain. */
  deployBlock: bigint;
  siteUrl: string;
  repoUrl: string;
  /** Next basePath ('' locally, '/arcseal' on GitHub Pages). Needed for raw <a href> in rendered markdown. */
  basePath: string;
  /** Human-readable problems with the build configuration, shown in a banner. */
  problems: string[];
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');
const httpUrl = (v: string | undefined) =>
  v && /^https?:\/\/\S+$/.test(v.trim()) ? trimSlash(v.trim()) : null;

/** Parses the public build-time environment. Pure, so it is unit-tested; placeholders such as `[ADDRESS]` count as unset. */
export function parseConfig(env: PublicEnv): AppConfig {
  const problems: string[] = [];
  const rawChain = env.NEXT_PUBLIC_CHAIN_ID?.trim();
  let chainId: SupportedChainId = 5042;
  if (rawChain) {
    const n = Number(rawChain);
    if ((SUPPORTED_CHAIN_IDS as readonly number[]).includes(n)) chainId = n as SupportedChainId;
    else problems.push(`NEXT_PUBLIC_CHAIN_ID=${rawChain} is not supported (use 5042, 5042002 or 31337).`);
  }
  const d = DEFAULTS[chainId];
  const rpcUrl = httpUrl(env.NEXT_PUBLIC_RPC_URL) ?? d.rpc;
  const explorerUrl = httpUrl(env.NEXT_PUBLIC_EXPLORER_URL) ?? d.explorer;

  const rawDao = env.NEXT_PUBLIC_DAO_ADDRESS?.trim();
  const dao = rawDao && isAddress(rawDao) && rawDao !== zeroAddress ? getAddress(rawDao) : null;
  const rawBlock = env.NEXT_PUBLIC_DAO_DEPLOY_BLOCK?.trim();
  const deployBlock = rawBlock && /^\d+$/.test(rawBlock) ? BigInt(rawBlock) : 0n;

  if (dao && deployBlock === 0n && chainId !== 31337)
    problems.push('NEXT_PUBLIC_DAO_DEPLOY_BLOCK is unset, so event scans start at block 0 and are slow.');

  const chain = defineChain({
    ...d.base,
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: explorerUrl ? { default: { name: `${d.label} explorer`, url: explorerUrl } } : undefined,
  });

  return {
    chainId,
    chain,
    chainLabel: d.label,
    rpcUrl,
    explorerUrl,
    dao,
    deployBlock,
    siteUrl: httpUrl(env.NEXT_PUBLIC_SITE_URL) ?? 'https://r4topunk.github.io/arcseal',
    repoUrl: httpUrl(env.NEXT_PUBLIC_REPO_URL) ?? 'https://github.com/r4topunk/arcseal',
    basePath: trimSlash(env.NEXT_PUBLIC_BASE_PATH?.trim() ?? ''),
    problems,
  };
}

// Next inlines NEXT_PUBLIC_* only for literal `process.env.NAME` references, so each one is spelled out here.
export const config = parseConfig({
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  NEXT_PUBLIC_DAO_ADDRESS: process.env.NEXT_PUBLIC_DAO_ADDRESS,
  NEXT_PUBLIC_DAO_DEPLOY_BLOCK: process.env.NEXT_PUBLIC_DAO_DEPLOY_BLOCK,
  NEXT_PUBLIC_EXPLORER_URL: process.env.NEXT_PUBLIC_EXPLORER_URL,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_REPO_URL: process.env.NEXT_PUBLIC_REPO_URL,
  NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH,
});

export const CHAIN_ID = config.chainId;
export const chain = config.chain;

export const explorerTx = (hash: string) => (config.explorerUrl ? `${config.explorerUrl}/tx/${hash}` : null);
export const explorerAddress = (address: string) =>
  config.explorerUrl ? `${config.explorerUrl}/address/${address}` : null;
export const repoFile = (p: string) => `${config.repoUrl}/blob/main/${p.replace(/^\/+/, '')}`;
