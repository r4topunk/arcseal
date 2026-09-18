// Optional reference relayer (PRD 11, D9): one shot, "reveal every sealed vote of proposal N" with the SDK. Not
// hosted and not required: the site's "Reveal votes" button does the same in the browser. Anyone may reveal; the
// caller is credited the reveal bounty per revealed vote when the proposal met quorum and the treasury covers it (D6).
//
//   pnpm --filter @arcseal/scripts reveal --proposal 1                                  read-only: decrypt, print
//   pnpm --filter @arcseal/scripts reveal --proposal 1 --account arcseal-wallet-b       send revealBatch (keystore)
//   pnpm --filter @arcseal/scripts reveal --network mainnet --proposal 1 --account arcseal-wallet-b
//   pnpm --filter @arcseal/scripts reveal --network local --proposal 2 --from 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
//   ... --garbage-item   also send one item no commitment matches (PRD 10.2 negative proof: RevealSkipped)
//
// DAO address and deploy block come from deployments/arc-<network>.json (local: anvil-dry-run.json) unless --dao and
// --from-block are given. The keystore is decrypted by cast (see lib/signers.ts); raw keys are never accepted.
import {
  createLogger,
  getProposal,
  getStatus,
  roundTime,
  type WriteClient,
  waitForRound,
  waitForSuccess,
} from '@arcseal/sdk';
import { createPublicClient, createWalletClient, http } from 'viem';
import { parseRevealCli } from './lib/cli.js';
import { formatTime } from './lib/clock.js';
import {
  chainFor,
  DEPLOYMENT_FILES,
  httpWithGasMargin,
  LOCAL_CHAIN_ID,
  logLevel,
  NETWORKS,
  readDeployment,
  txUrl,
} from './lib/config.js';
import { formatInt, formatUsdc } from './lib/format.js';
import { describeBounty, planReveal, revealOutcome, sendRevealBatch, withGarbageItem } from './lib/reveal.js';
import { keystoreAccount } from './lib/signers.js';

const USAGE = `usage: pnpm --filter @arcseal/scripts reveal --proposal <id> [--network testnet|mainnet|local]
  [--rpc <url>] [--dao <address> --from-block <n>] [--account <keystore> [--password-file <file>]
  [--keystore-dir <dir>]] [--from <unlocked anvil account, local only>] [--beacon-timeout <seconds>]
  [--garbage-item]
Without --account (or --from) it only decrypts and prints what it would reveal.
--garbage-item appends one item that no commitment matches; the contract skips it (RevealSkipped).`;

async function main(): Promise<number> {
  const opts = parseRevealCli(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const recordFile = opts.network === 'local' ? DEPLOYMENT_FILES.dryRun : DEPLOYMENT_FILES[opts.network];
  const record = readDeployment(recordFile);
  const net = opts.network === 'local' ? undefined : NETWORKS[opts.network];
  const chainId = net?.chainId ?? LOCAL_CHAIN_ID;
  const rpcUrl = opts.rpc ?? net?.rpcUrl ?? 'http://127.0.0.1:8545';
  const explorer = net?.explorer ?? '';
  const chain = chainFor(chainId, rpcUrl, explorer);
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const actual = await client.getChainId();
  if (actual !== chainId)
    throw new Error(`${rpcUrl} is chain ${actual}, expected ${chainId} (${opts.network})`);

  const dao = opts.dao ?? record?.dao;
  const fromBlock = opts.fromBlock ?? record?.deployBlock;
  if (!dao || fromBlock === undefined) {
    throw new Error(`no DAO: pass --dao and --from-block, or record the deployment in ${recordFile}`);
  }
  const proposalId = opts.proposalId;
  const proposal = await getProposal(client, { dao, proposalId });
  const status = await getStatus(client, { dao, proposalId });
  const opens = formatTime(roundTime(proposal.closeRound));
  const closes = formatTime(roundTime(proposal.revealEndRound));
  console.log(`DAO ${dao} on chain ${chainId}, proposal ${proposalId}: ${status}`);
  console.log(
    `reveal window: round ${proposal.closeRound} (${opens}) to round ${proposal.revealEndRound} (${closes})`,
  );
  if (status === 'Voting') {
    console.log(`sealing is still open; the reveal window opens at ${opens}`);
    return 1;
  }
  if (status !== 'Revealing') {
    console.log('the reveal window is over: nothing can be revealed any more');
    return 1;
  }

  const logger = createLogger({ level: logLevel(), destination: process.stderr });
  const plan = await planReveal({
    client,
    dao,
    proposalId,
    fromBlock,
    logger,
    beaconSource: (round) =>
      waitForRound(round, { signal: AbortSignal.timeout(opts.beaconTimeoutSeconds * 1_000), logger }),
  });
  console.log(
    `sealed ${proposal.sealedCount}, already revealed ${proposal.revealedCount}; decrypted and revealable now: ` +
      `${plan.unsealed.items.length} [correlationId ${plan.unsealed.correlationId}]`,
  );
  for (const item of plan.unsealed.items) console.log(`  ${item.voter} ${item.choice}`);
  for (const s of plan.unsealed.skipReasons) console.log(`  ${s.voter} skipped: ${s.reason}`);
  const batches = opts.garbageItem ? withGarbageItem(plan.batches) : plan.batches;
  if (opts.garbageItem) console.log('  + 1 garbage item (no matching commitment; expect RevealSkipped)');
  if (batches.length === 0) {
    console.log('nothing to reveal');
    return 0;
  }

  let wallet: WriteClient;
  if (opts.account) {
    const account = await keystoreAccount(opts.account, {
      passwordFile: opts.passwordFile,
      keystoreDir: opts.keystoreDir,
    });
    wallet = createWalletClient({ account, chain, transport: httpWithGasMargin(rpcUrl) });
  } else if (opts.from) {
    wallet = createWalletClient({ account: opts.from, chain, transport: httpWithGasMargin(rpcUrl) });
  } else {
    console.log(
      `read-only: ${batches.length} revealBatch call(s) would be sent; pass --account to send them`,
    );
    return 0;
  }

  for (const [i, batch] of batches.entries()) {
    const hash = await sendRevealBatch(wallet, { dao, proposalId, batch });
    console.log(`revealBatch ${i + 1}/${batches.length} (${batch.voters.length} items): ${hash}`);
    const url = txUrl(explorer, hash);
    if (url) console.log(`  ${url}`);
    const receipt = await waitForSuccess(client, hash, 'revealBatch');
    const out = revealOutcome(receipt);
    console.log(
      `  gas ${formatInt(receipt.gasUsed)}; revealed ${out.revealed}, skipped ${out.skipped.length}; ` +
        describeBounty(out, formatUsdc, '(claimable)'),
    );
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`reveal: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);
