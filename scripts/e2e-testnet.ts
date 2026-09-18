// End-to-end run of SealedDAO (PRD 8.4) on Arc testnet, and its local anvil dry run. See DEPLOY.md.
//
//   pnpm e2e:testnet                 Arc testnet with three Foundry keystores. Spans >= 24 h (the reveal window):
//                                    it pauses at long waits; run it again to resume from scripts/.state/5042002.json
//   pnpm e2e:testnet --wait          same, but sleeps through every wait (keep the terminal open for a day)
//   pnpm e2e:testnet --reset         archive the state file and start over with a new proposal
//   pnpm e2e:dry-run                 own anvil, offline (committed drand beacon), time jumps, prints every tx hash
//   pnpm e2e:dry-run --online        fetch the close-round beacon from drand instead
//   pnpm e2e:dry-run --keep-alive    leave anvil running on port 8545 and print NEXT_PUBLIC_* for apps/web
//   pnpm e2e:dry-run --port 8600     use another port
import { type CliOptions, parseCli } from './lib/cli.js';
import { formatDuration, formatTime } from './lib/clock.js';
import { LOCAL_CHAIN_ID, NETWORKS } from './lib/config.js';
import { summaryLines } from './lib/deployments.js';
import { runDryRun } from './lib/dry-run.js';
import type { FlowResult } from './lib/flow.js';
import { runTestnet } from './lib/testnet.js';

const USAGE = `usage:
  pnpm e2e:testnet [--wait] [--reset]
  pnpm e2e:dry-run [--online] [--keep-alive] [--port <n>]

The testnet run needs the DAO deployed and recorded (DEPLOY.md) and three keystores (MEMBER1_ACCOUNT,
MEMBER2_ACCOUNT, MEMBER3_ACCOUNT; password from KEYSTORE_PASSWORD_FILE / MEMBERn_PASSWORD_FILE, or a prompt).`;

function tallyLine(flow: FlowResult): string {
  if (flow.status !== 'done') return '';
  const t = flow.tally;
  return (
    `proposal ${flow.proposalId}: ${t.for} for / ${t.against} against / ${t.abstain} abstain, ` +
    `${t.revealed} of ${t.sealed} sealed votes revealed, ${t.passed ? 'passed' : 'failed'}, executed, claimed`
  );
}

async function dryRun(opts: CliOptions): Promise<number> {
  const r = await runDryRun({ online: opts.online, keepAlive: opts.keepAlive, port: opts.port });
  console.log(`\nTransactions (local anvil, chain ${LOCAL_CHAIN_ID}):`);
  for (const line of summaryLines(r.state, '')) console.log(line);
  console.log(`\n${tallyLine(r.flow) || `flow ${r.flow.status}`}`);
  console.log(`proofTxs written to ${r.deploymentsFile} (gitignored; never the testnet or mainnet file)`);
  console.log(
    'On Arc testnet the same flow waits 10 min for the close round and then the 24 h reveal window, so ' +
      '`pnpm e2e:testnet` spans at least 24 h (DEPLOY.md).',
  );
  if (r.anvil) {
    const anvil = r.anvil;
    const env = [
      `NEXT_PUBLIC_CHAIN_ID=${LOCAL_CHAIN_ID}`,
      `NEXT_PUBLIC_RPC_URL=${r.url}`,
      `NEXT_PUBLIC_DAO_ADDRESS=${r.dao}`,
      `NEXT_PUBLIC_DAO_DEPLOY_BLOCK=${r.deployBlock}`,
      'NEXT_PUBLIC_EXPLORER_URL=',
    ];
    console.log(
      `\nanvil keeps running at ${r.url} (chain ${LOCAL_CHAIN_ID}) with DAO ${r.dao}. Ctrl-C stops it.`,
    );
    console.log('Web app values (apps/web/.env.local, or inline in fish):');
    for (const line of env) console.log(`  ${line}`);
    console.log(`  env ${env.join(' ')} pnpm --filter @arcseal/web dev`);
    console.log(
      `Members: ${r.members.join(', ')} (anvil's public default dev accounts #0-#2; local only, never fund them).`,
    );
    console.log(
      `Chain time is ${formatTime(r.chainTime)}, behind the wall clock. Skip ahead 10 minutes (fish):`,
    );
    console.log(`  cast rpc evm_increaseTime 600 --rpc-url ${r.url}`);
    console.log(`  cast rpc evm_mine --rpc-url ${r.url}`);
    await new Promise<void>((resolve) => {
      process.once('SIGINT', () => resolve());
      process.once('SIGTERM', () => resolve());
    });
    await anvil.stop();
    console.log('anvil stopped');
  }
  if (r.resumeSent !== 0) return 1;
  return r.flow.status === 'done' ? 0 : 1;
}

async function testnet(opts: CliOptions): Promise<number> {
  const r = await runTestnet({ wait: opts.wait, reset: opts.reset });
  const lines = summaryLines(r.state, NETWORKS.testnet.explorer);
  if (lines.length) {
    console.log('\nTransactions so far:');
    for (const line of lines) console.log(line);
  }
  console.log(`\nproofTxs recorded in ${r.deploymentsFile}; run state in ${r.stateFile}`);
  if (r.status === 'paused') {
    console.log(
      `\nPAUSED at proposal ${r.proposalId}: ${r.what} is at ${formatTime(r.resumeAt)} ` +
        `(in ${formatDuration(r.waitSeconds)}).`,
    );
    console.log(
      'The testnet e2e spans at least 24 h because of the reveal window (PRD D5). Resume after that time:',
    );
    console.log('  pnpm e2e:testnet');
    console.log('or keep a terminal waiting through it:');
    console.log('  pnpm e2e:testnet --wait');
    return 0;
  }
  if (r.status === 'failed') {
    console.error(`\nFAILED: ${r.reason}`);
    return 1;
  }
  console.log(`\nDONE: ${tallyLine(r)}`);
  return 0;
}

async function main(): Promise<number> {
  const opts = parseCli(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  return opts.dryRun ? dryRun(opts) : testnet(opts);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`e2e: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);
