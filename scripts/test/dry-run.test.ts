// The whole e2e dry run on a throwaway anvil, as `pnpm e2e:dry-run` runs it: Deploy.s.sol through the CREATE2
// deployer, record-deployment.mjs, the PRD 8.4 flow with the committed drand beacon (offline), and the resume check.
// Records go to a temp dir instead of deployments/anvil-dry-run.json and scripts/.state. Skipped without Foundry.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DRY_RUN_CLOSE_ROUND, type DryRunResult, runDryRun } from '../lib/dry-run.js';

const foundry = ['anvil', 'forge', 'cast'].every(
  (bin) => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0,
);
const built = existsSync(new URL('../../contracts/out/MockUSDC.sol/MockUSDC.json', import.meta.url));

describe.skipIf(!foundry || !built)('e2e dry run on local anvil (offline)', () => {
  let dir: string;
  let result: DryRunResult;
  const lines: string[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arcseal-dry-run-'));
    result = await runDryRun({
      deploymentsFile: join(dir, 'anvil-dry-run.json'),
      stateDir: join(dir, 'state'),
      say: (l) => lines.push(l),
      logLevel: 'silent',
    });
  }, 180_000);
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('deploys through Deploy.s.sol and the CREATE2 deployer, and records the deployment', () => {
    const record = JSON.parse(readFileSync(result.deploymentsFile, 'utf8'));
    expect(record.network).toBe('anvil-dry-run');
    expect(record.chainId).toBe(31337);
    expect(record.contracts.SealedDAO).toMatchObject({
      address: result.dao.toLowerCase(),
      salt: 'keccak256("arcseal.v1")',
      saltHash: '0xab625800dd8b6a1ec1cafaa199bb72f27c5482aec13bf092272907043180863e',
      constructorArgs: {
        usdc: '0x3600000000000000000000000000000000000000',
        initialMembers: result.members,
        quorumBps: 5000,
        revealBounty: 10000,
      },
    });
    expect(lines.some((l) => l.includes('deployed by Deploy.s.sol through the CREATE2 deployer'))).toBe(true);
  });

  it('runs propose, three sealed votes, reveal, finalize, execute and both claims', () => {
    expect(result.flow).toMatchObject({
      status: 'done',
      proposalId: 1n,
      tally: { sealed: 3, revealed: 3, for: 2, against: 1, abstain: 0, memberSnapshot: 3, passed: true },
    });
    const keys = Object.keys(result.proofTxs);
    expect(keys).toEqual([
      'mockUsdcMint',
      'fundTreasury',
      'transferPropose',
      'transferVotes',
      'transferRevealBatch',
      'transferFinalize',
      'transferExecute',
      'transferClaim',
      'transferBountyClaim',
    ]);
    expect(result.proofTxs.transferVotes).toHaveLength(3);
    for (const hash of Object.values(result.proofTxs).flat()) expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.state.proposal?.closeRound).toBe(DRY_RUN_CLOSE_ROUND.toString());
    expect(Object.keys(result.state.ballots)).toEqual(['1', '2', '3']);
    expect(lines).toContain('     revealed 3, skipped 0, bounty 0.030000 USDC to the revealer');
  });

  it('writes proofTxs and the run summary to the dry-run record only', () => {
    const record = JSON.parse(readFileSync(result.deploymentsFile, 'utf8'));
    expect(record.proofTxs).toEqual(result.proofTxs);
    expect(record.e2e).toMatchObject({ proposalId: 1, closeRound: 32_000_000, revealEndRound: 32_028_800 });
    expect(record.e2e.completedAt).toBeTruthy();
  });

  it('is idempotent: a second run from the state file sends nothing', () => {
    expect(result.resumeSent).toBe(0);
    expect(lines.some((l) => l.startsWith('resume check:') && l.endsWith('0 transactions sent'))).toBe(true);
    expect(result.anvil).toBeUndefined();
  });
});
