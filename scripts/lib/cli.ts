// Command-line flags of e2e-testnet.ts and reveal-cli.ts.
import { parseArgs } from 'node:util';
import { type Address, getAddress, isAddress } from 'viem';

export interface CliOptions {
  help: boolean;
  dryRun: boolean;
  online: boolean;
  keepAlive: boolean;
  port: number | undefined;
  wait: boolean;
  reset: boolean;
}

/** Parses e2e-testnet.ts flags; throws on unknown flags and on flags that do not apply to the chosen mode. */
export function parseCli(argv: string[]): CliOptions {
  const { values } = parseArgs({
    // pnpm may forward a literal "--" separator
    args: argv.filter((a) => a !== '--'),
    options: {
      'dry-run': { type: 'boolean', default: false },
      online: { type: 'boolean', default: false },
      'keep-alive': { type: 'boolean', default: false },
      port: { type: 'string' },
      wait: { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const dryRun = values['dry-run'];
  if (!dryRun && (values.online || values['keep-alive'] || values.port !== undefined)) {
    throw new Error('--online, --keep-alive and --port only apply to the dry run (--dry-run)');
  }
  if (dryRun && (values.wait || values.reset))
    throw new Error('--wait and --reset only apply to the testnet run');
  let port: number | undefined;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535)
      throw new Error(`invalid --port ${values.port}`);
  }
  return {
    help: values.help,
    dryRun,
    online: values.online,
    keepAlive: values['keep-alive'],
    port,
    wait: values.wait,
    reset: values.reset,
  };
}

export interface RevealCliOptions {
  help: boolean;
  network: 'testnet' | 'mainnet' | 'local';
  proposalId: bigint;
  rpc: string | undefined;
  dao: Address | undefined;
  fromBlock: bigint | undefined;
  /** Foundry keystore that signs revealBatch; without it (and without --from) the run is read-only. */
  account: string | undefined;
  passwordFile: string | undefined;
  keystoreDir: string | undefined;
  /** Local anvil only: an unlocked dev account that sends revealBatch. */
  from: Address | undefined;
  beaconTimeoutSeconds: number;
  /** Appends one item that no commitment matches, so the batch shows a RevealSkipped (PRD 10.2 negative proof). */
  garbageItem: boolean;
}

/** Parses reveal-cli.ts flags. */
export function parseRevealCli(argv: string[]): RevealCliOptions {
  const { values } = parseArgs({
    args: argv.filter((a) => a !== '--'),
    options: {
      network: { type: 'string', default: 'testnet' },
      proposal: { type: 'string' },
      rpc: { type: 'string' },
      dao: { type: 'string' },
      'from-block': { type: 'string' },
      account: { type: 'string' },
      'password-file': { type: 'string' },
      'keystore-dir': { type: 'string' },
      from: { type: 'string' },
      'beacon-timeout': { type: 'string', default: '60' },
      'garbage-item': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const network = values.network;
  if (network !== 'testnet' && network !== 'mainnet' && network !== 'local') {
    throw new Error(`--network must be testnet, mainnet or local, got ${network}`);
  }
  const address = (flag: string, value: string | undefined) => {
    if (value === undefined) return undefined;
    if (!isAddress(value, { strict: false })) throw new Error(`${flag} is not an address: ${value}`);
    return getAddress(value);
  };
  const uint = (flag: string, value: string | undefined) => {
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer, got ${value}`);
    return BigInt(value);
  };
  if (!values.help && values.proposal === undefined) throw new Error('--proposal <id> is required');
  const proposalId = uint('--proposal', values.proposal) ?? 0n;
  if (!values.help && proposalId === 0n) throw new Error('--proposal must be >= 1');
  if (values.from !== undefined && network !== 'local')
    throw new Error('--from (unlocked account) is for --network local');
  if (values.from !== undefined && values.account !== undefined)
    throw new Error('pass --account or --from, not both');
  const timeout = Number(values['beacon-timeout']);
  if (!Number.isInteger(timeout) || timeout < 1)
    throw new Error('--beacon-timeout must be a positive integer');
  return {
    help: values.help,
    network,
    proposalId,
    rpc: values.rpc,
    dao: address('--dao', values.dao),
    fromBlock: uint('--from-block', values['from-block']),
    account: values.account,
    passwordFile: values['password-file'],
    keystoreDir: values['keystore-dir'],
    from: address('--from', values.from),
    beaconTimeoutSeconds: timeout,
    garbageItem: values['garbage-item'],
  };
}
