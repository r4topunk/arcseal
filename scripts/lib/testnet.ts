// Arc testnet (chain 5042002) e2e run, PRD 8.4. Signers are three Foundry keystores, decrypted with cast on first
// use. The flow spans at least 24 h: 10 minutes of voting, then the fixed 24 h reveal window (PRD D5) before
// finalize. Waits up to E2E_MAX_WAIT_SECONDS (default 15 min) inline; a longer wait pauses the run, and a re-run
// resumes from scripts/.state/5042002.json. `wait` sleeps through every wait instead.
import { existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createLogger,
  newCorrelationId,
  readIsMember,
  readQuorumBps,
  readRevealBounty,
  readUsdc,
  waitForRound,
} from '@arcseal/sdk';
import { createPublicClient, createWalletClient, http } from 'viem';
import { RealClock } from './clock.js';
import {
  ARC_TESTNET_ID,
  ARC_USDC,
  chainFor,
  DEPLOYMENT_FILES,
  httpWithGasMargin,
  logLevel,
  NETWORKS,
  parseEnv,
  readDeployment,
  STATE_DIR,
  testnetEnvSchema,
} from './config.js';
import { writeRunRecord } from './deployments.js';
import { type FlowResult, type MemberIndex, runTransferFlow, usdcBalance, type Wallet } from './flow.js';
import { formatUsdc } from './format.js';
import { keystoreAccount, lazy } from './signers.js';
import { newState, type RunState, StateStore } from './state.js';

export interface TestnetOptions {
  /** Sleep through every wait (including the 24 h reveal window) instead of pausing. */
  wait?: boolean | undefined;
  /** Archive the state file and start a new run (a new proposal). */
  reset?: boolean | undefined;
  say?: ((line: string) => void) | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  /** Where proofTxs go. Default deployments/arc-testnet.json (a local rehearsal passes a scratch copy). */
  deploymentsFile?: string | undefined;
  /** Default scripts/.state. */
  stateDir?: string | undefined;
}

/** Below this USDC balance a member probably cannot pay gas for the run (gas is paid in USDC on Arc). */
const LOW_GAS_BALANCE = 50_000n; // 0.05 USDC

export async function runTestnet(
  options: TestnetOptions = {},
): Promise<FlowResult & { stateFile: string; deploymentsFile: string; state: Readonly<RunState> }> {
  const say = options.say ?? ((line: string) => console.log(line));
  const env = parseEnv(testnetEnvSchema, options.env ?? process.env);
  const net = NETWORKS.testnet;
  const rpcUrl = env.ARC_TESTNET_RPC;
  const chain = chainFor(ARC_TESTNET_ID, rpcUrl, net.explorer);
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  const chainId = await client.getChainId();
  if (chainId !== ARC_TESTNET_ID) {
    throw new Error(
      `refusing: ${rpcUrl} is chain ${chainId}; this run is for Arc testnet (${ARC_TESTNET_ID}) only`,
    );
  }
  const deploymentsFile = options.deploymentsFile ?? DEPLOYMENT_FILES.testnet;
  const recorded = readDeployment(deploymentsFile);
  const dao = env.SEALED_DAO_ADDRESS ?? recorded?.dao;
  const deployBlock = env.SEALED_DAO_DEPLOY_BLOCK ?? recorded?.deployBlock;
  if (!dao || deployBlock === undefined) {
    throw new Error(
      'no SealedDAO on testnet: deploy it and run `node script/record-deployment.mjs 5042002` (DEPLOY.md), ' +
        'or set SEALED_DAO_ADDRESS and SEALED_DAO_DEPLOY_BLOCK',
    );
  }
  if ((await client.getCode({ address: dao })) === undefined)
    throw new Error(`no contract at ${dao} on testnet`);
  const usdc = await readUsdc(client, { dao });
  if (usdc !== ARC_USDC) throw new Error(`DAO ${dao} uses token ${usdc}, expected Arc USDC ${ARC_USDC}`);

  const stateFile = resolve(options.stateDir ?? STATE_DIR, `${ARC_TESTNET_ID}.json`);
  if (options.reset && existsSync(stateFile)) {
    const archived = stateFile.replace(/\.json$/, `.${Date.now()}.json`);
    renameSync(stateFile, archived);
    say(`archived the previous run state to ${archived}`);
  }
  const store = StateStore.open(stateFile, () => newState(ARC_TESTNET_ID, dao, newCorrelationId()));
  if (store.get().dao !== dao) {
    throw new Error(
      `${stateFile} belongs to DAO ${store.get().dao}, not ${dao}; run with --reset to start over`,
    );
  }
  const logger = createLogger({
    level: logLevel(options.env ?? process.env),
    destination: process.stderr,
    bindings: { runTag: store.get().runTag },
  });

  say(`ArcSeal e2e on Arc testnet (chain ${ARC_TESTNET_ID}), DAO ${dao} (deploy block ${deployBlock})`);
  say(
    `quorum ${await readQuorumBps(client, { dao })} bps, reveal bounty ` +
      `${formatUsdc(await readRevealBounty(client, { dao }))}, run ${store.get().runTag}, state ${stateFile}`,
  );
  say(
    'This run spans at least 24 h: 10 min of sealed voting, then the fixed 24 h reveal window before finalize ' +
      '(PRD D5). It pauses at long waits; re-run the same command to resume.',
  );

  const accounts = { 1: env.MEMBER1_ACCOUNT, 2: env.MEMBER2_ACCOUNT, 3: env.MEMBER3_ACCOUNT } as const;
  const passwords = {
    1: env.MEMBER1_PASSWORD_FILE ?? env.KEYSTORE_PASSWORD_FILE,
    2: env.MEMBER2_PASSWORD_FILE ?? env.KEYSTORE_PASSWORD_FILE,
    3: env.MEMBER3_PASSWORD_FILE ?? env.KEYSTORE_PASSWORD_FILE,
  } as const;
  const signer = lazy(async (m: MemberIndex): Promise<Wallet> => {
    say(
      `decrypting keystore "${accounts[m]}" (member ${m}) with cast${passwords[m] ? '' : '; enter its password'}`,
    );
    const account = await keystoreAccount(accounts[m], {
      passwordFile: passwords[m],
      keystoreDir: env.KEYSTORE_DIR,
    });
    if (!(await readIsMember(client, { dao, account: account.address }))) {
      throw new Error(`keystore "${accounts[m]}" is ${account.address}, which is not a member of ${dao}`);
    }
    const balance = await usdcBalance({ client, usdc }, account.address);
    say(`member ${m}: ${account.address}, ${formatUsdc(balance)}`);
    if (balance < LOW_GAS_BALANCE) say(`  low balance: get testnet USDC at https://faucet.circle.com`);
    return createWalletClient({ account, chain, transport: httpWithGasMargin(rpcUrl) }) as Wallet;
  });

  const result = await runTransferFlow({
    chainId: ARC_TESTNET_ID,
    client,
    explorer: net.explorer,
    dao,
    usdc,
    signer,
    clock: new RealClock(client, {
      maxWaitSeconds: options.wait ? Number.POSITIVE_INFINITY : env.E2E_MAX_WAIT_SECONDS,
      say,
    }),
    beaconSource: (round) => waitForRound(round, { signal: AbortSignal.timeout(15 * 60_000), logger }),
    votingSeconds: env.E2E_VOTING_SECONDS,
    payout: env.E2E_PAYOUT,
    store,
    logger,
    say,
    onTx: (state) => writeRunRecord(deploymentsFile, state),
  });
  writeRunRecord(deploymentsFile, store.get());
  return { ...result, stateFile, deploymentsFile, state: store.get() };
}
