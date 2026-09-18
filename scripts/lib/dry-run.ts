// Anvil dry run of the testnet e2e (PRD 12 phase 3 gate). Starts its own anvil (--hardfork prague) with a genesis
// time in the past, etches MockUSDC at 0x3600...0000, deploys SealedDAO through contracts/script/Deploy.s.sol, and
// runs the same flow as the testnet with time jumps instead of waits. Offline by default: the proposal is created at
// roundTime(32,000,000) - 10 min, so its close round has a quicknet beacon committed in
// packages/tlock/test/vectors/beacons.json. `online` fetches that beacon from drand instead. Then it re-runs the flow
// from the state file and checks that nothing is sent twice. Writes deployments/anvil-dry-run.json (gitignored).
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type BeaconSource,
  createLogger,
  type LogLevel,
  newCorrelationId,
  roundTime,
  SEALED_DAO_CREATE2_SALT,
  sealedDaoAbi,
  sealedDaoBytecode,
  waitForRound,
} from '@arcseal/sdk';
import {
  type Address,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeDeployData,
  getContractAddress,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  parseAbi,
  toBytes,
} from 'viem';
import { type Anvil, deployWithForgeScript, etchMockUsdc, freePort, startAnvil } from './anvil.js';
import { AnvilClock, formatTime } from './clock.js';
import {
  chainFor,
  DEPLOYMENT_FILES,
  httpWithGasMargin,
  LOCAL_CHAIN_ID,
  REPO_DIR,
  STATE_DIR,
} from './config.js';
import { proofTxsFromState, writeRunRecord } from './deployments.js';
import {
  type FlowContext,
  type FlowResult,
  type MemberIndex,
  runTransferFlow,
  usdcBalance,
  type Wallet,
} from './flow.js';
import { formatUsdc } from './format.js';
import { newState, type RunState, StateStore } from './state.js';

/** Close round of the dry-run proposal: a round whose beacon is committed (the latest of the three). */
export const DRY_RUN_CLOSE_ROUND = 32_000_000n;
/** 10-minute voting, as in the mainnet demo. */
export const DRY_RUN_VOTING_SECONDS = 600;
const CREATE2_DEPLOYER: Address = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const mockUsdcAbi = parseAbi(['function mint(address to, uint256 value)']);

export interface DryRunOptions {
  /** Fetch the close-round beacon from drand instead of the committed one. */
  online?: boolean | undefined;
  /** Leave anvil running afterwards (the caller stops it); defaults the port to 8545. */
  keepAlive?: boolean | undefined;
  port?: number | undefined;
  /** Default deployments/anvil-dry-run.json. */
  deploymentsFile?: string | undefined;
  /** Default scripts/.state. */
  stateDir?: string | undefined;
  say?: ((line: string) => void) | undefined;
  logLevel?: LogLevel | undefined;
}

export interface DryRunResult {
  flow: FlowResult;
  /** Transactions sent by the second, resumed run: 0 when the flow is idempotent. */
  resumeSent: number;
  url: string;
  chainTime: number;
  dao: Address;
  deployBlock: bigint;
  members: Address[];
  deploymentsFile: string;
  stateFile: string;
  state: Readonly<RunState>;
  proofTxs: Record<string, string | string[]>;
  /** Set only with keepAlive: stop it when done. */
  anvil?: Anvil | undefined;
}

/** The committed quicknet beacon for `round` (packages/tlock/test/vectors/beacons.json, BLS-verified there). */
export function committedBeacon(round: bigint): { round: bigint; signature: Hex } {
  const file = resolve(REPO_DIR, 'packages/tlock/test/vectors/beacons.json');
  const { beacons } = JSON.parse(readFileSync(file, 'utf8')) as {
    beacons: { round: number; signature: string }[];
  };
  const beacon = beacons.find((b) => BigInt(b.round) === round);
  if (!beacon) throw new Error(`no committed beacon for round ${round} in ${file}`);
  return { round, signature: `0x${beacon.signature}` };
}

/** A deployed dry-run chain plus a ready flow context. The caller stops `anvil`. */
export interface DryRunSetup {
  anvil: Anvil;
  client: PublicClient;
  members: Address[];
  dao: Address;
  deployBlock: bigint;
  deploymentsFile: string;
  stateFile: string;
  /** Re-opens the state file from disk (what a new process would see). */
  open: () => StateStore;
  ctx: FlowContext;
  /** Anvil dev-account wallet (padded gas, like the testnet run). */
  wallet: (account: Address) => Wallet;
}

/**
 * Starts anvil, etches MockUSDC, deploys through Deploy.s.sol, checks the address against the SDK bytecode and builds
 * the flow context (fresh state file). Stops anvil itself only when the setup fails.
 */
export async function setupDryRun(options: DryRunOptions = {}): Promise<DryRunSetup> {
  const say = options.say ?? ((line: string) => console.log(line));
  const deploymentsFile = options.deploymentsFile ?? DEPLOYMENT_FILES.dryRun;
  const stateFile = resolve(options.stateDir ?? STATE_DIR, `${LOCAL_CHAIN_ID}.json`);
  const proposeAt = roundTime(DRY_RUN_CLOSE_ROUND) - DRY_RUN_VOTING_SECONDS;
  const genesis = proposeAt - 3_600;
  const port = options.port ?? (options.keepAlive ? 8545 : await freePort());

  say(
    `ArcSeal e2e dry run: local anvil, chain ${LOCAL_CHAIN_ID}, ${options.online ? 'online (drand)' : 'offline'}`,
  );
  const anvil = await startAnvil({ port, timestamp: genesis });
  try {
    say(`anvil ${anvil.url} --hardfork prague, genesis ${formatTime(genesis)}`);
    const chain = chainFor(LOCAL_CHAIN_ID, anvil.url);
    const transport = http(anvil.url);
    const client = createPublicClient({ chain, transport, pollingInterval: 50 });
    const test = createTestClient({ chain, mode: 'anvil', transport });
    const accounts = await createWalletClient({ chain, transport }).getAddresses();
    const members = accounts.slice(0, 3);
    // Wallets pad gas estimates like the testnet run does (see httpWithGasMargin).
    const walletTransport = httpWithGasMargin(anvil.url);
    const wallet = (account: Address): Wallet =>
      createWalletClient({ account, chain, transport: walletTransport, pollingInterval: 50 }) as Wallet;

    const usdc = await etchMockUsdc(anvil.url);
    say(`MockUSDC etched at ${usdc} (Arc's USDC address, 6 decimals)`);
    const deployed = await deployWithForgeScript({
      url: anvil.url,
      sender: members[0] as Address,
      members,
      deploymentsFile,
    });
    // Cross-check: the SDK's bundled bytecode must give the same CREATE2 address as the forge artifact.
    const sdkPredicted = getContractAddress({
      opcode: 'CREATE2',
      from: CREATE2_DEPLOYER,
      salt: keccak256(toBytes(SEALED_DAO_CREATE2_SALT)),
      bytecode: encodeDeployData({
        abi: sealedDaoAbi,
        bytecode: sealedDaoBytecode,
        args: [usdc, members, 5_000, 10_000n],
      }),
    });
    if (deployed.dao !== deployed.predicted || deployed.dao !== sdkPredicted) {
      throw new Error(
        `address mismatch: recorded ${deployed.dao}, Deploy.s.sol predicted ${deployed.predicted}, SDK ` +
          `bytecode gives ${sdkPredicted} (stale SDK ABI? run pnpm contracts:abi)`,
      );
    }
    say(
      `SealedDAO ${deployed.dao} deployed by Deploy.s.sol through the CREATE2 deployer ` +
        `(salt keccak256("${SEALED_DAO_CREATE2_SALT}"), block ${deployed.deployBlock}); recorded in ${deploymentsFile}`,
    );

    rmSync(stateFile, { force: true });
    const open = () =>
      StateStore.open(stateFile, () => newState(LOCAL_CHAIN_ID, deployed.dao, newCorrelationId()));
    const store = open();
    const logger = createLogger({
      level: options.logLevel ?? 'warn',
      destination: process.stderr,
      bindings: { runTag: store.get().runTag },
    });
    const beaconSource: BeaconSource = options.online
      ? (round) => waitForRound(round, { signal: AbortSignal.timeout(60_000), logger })
      : committedBeacon(DRY_RUN_CLOSE_ROUND);

    const ctx: FlowContext = {
      chainId: LOCAL_CHAIN_ID,
      client,
      explorer: '',
      dao: deployed.dao,
      usdc,
      signer: async (m: MemberIndex) => wallet(members[m - 1] as Address),
      clock: new AnvilClock(client, test),
      beaconSource,
      votingSeconds: DRY_RUN_VOTING_SECONDS,
      payout: 1_000_000n,
      store,
      logger,
      say,
      onTx: (state) =>
        writeRunRecord(deploymentsFile, state, { network: 'anvil-dry-run', rpcUrl: anvil.url }),
      proposeAt,
      expectedCloseRound: DRY_RUN_CLOSE_ROUND,
      beforeFund: async (runner) => {
        await runner.tx('mockUsdcMint', 'mint 10 MockUSDC to member 1 (dry run only)', {
          check: async () => {
            if (runner.ctx.store.get().proposal) return { skip: 'the proposal already exists' };
            const balance = await usdcBalance(runner.ctx, members[0] as Address);
            return balance >= 10_000_000n ? { skip: `member 1 holds ${formatUsdc(balance)}` } : null;
          },
          send: () =>
            wallet(members[0] as Address).writeContract({
              address: usdc,
              abi: mockUsdcAbi,
              functionName: 'mint',
              args: [members[0] as Address, 10_000_000n],
            }),
        });
      },
    };
    say(`run ${store.get().runTag}, state ${stateFile}`);
    return {
      anvil,
      client,
      members,
      dao: deployed.dao,
      deployBlock: deployed.deployBlock,
      deploymentsFile,
      stateFile,
      open,
      ctx,
      wallet,
    };
  } catch (err) {
    await anvil.stop();
    throw err;
  }
}

export async function runDryRun(options: DryRunOptions = {}): Promise<DryRunResult> {
  const say = options.say ?? ((line: string) => console.log(line));
  const setup = await setupDryRun({ ...options, say });
  const { anvil, client, ctx, members, wallet, deploymentsFile } = setup;
  let keep = false;
  try {
    const flow = await runTransferFlow(ctx);
    writeRunRecord(deploymentsFile, ctx.store.get(), { network: 'anvil-dry-run', rpcUrl: anvil.url });

    // Idempotency: a second run from the state file on disk must find every step done and send nothing.
    const blockBefore = await client.getBlockNumber();
    const quiet: string[] = [];
    const again = await runTransferFlow({
      ...ctx,
      store: setup.open(),
      say: (l) => quiet.push(l),
      onTx: undefined,
    });
    const blockAfter = await client.getBlockNumber();
    if (again.status !== flow.status || again.sent !== 0 || blockAfter !== blockBefore) {
      throw new Error(
        `resume check failed: second run ${again.status}, sent ${again.sent}, blocks ${blockBefore} -> ${blockAfter}`,
      );
    }
    say(
      `resume check: re-ran the flow from the state file, ${quiet.length} steps reported done, 0 transactions sent`,
    );

    if (options.keepAlive) {
      for (const m of members) {
        await wallet(m).writeContract({
          address: ctx.usdc,
          abi: mockUsdcAbi,
          functionName: 'mint',
          args: [m, 100_000_000n],
        });
      }
      say('minted 100 MockUSDC to each member for the web app (Fund treasury, gas is anvil ETH)');
      keep = true;
    }
    return {
      flow,
      resumeSent: again.sent,
      url: anvil.url,
      chainTime: Number((await client.getBlock()).timestamp),
      dao: setup.dao,
      deployBlock: setup.deployBlock,
      members,
      deploymentsFile,
      stateFile: setup.stateFile,
      state: ctx.store.get(),
      proofTxs: proofTxsFromState(ctx.store.get()),
      anvil: keep ? anvil : undefined,
    };
  } finally {
    if (!keep) await anvil.stop();
  }
}
