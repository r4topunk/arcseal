// Mid-flow resume, as the testnet run does it across processes: the first run pauses at the 24 h reveal window,
// a crash leaves the confirmed reveal marked "pending" in the state file, and a second run started from disk settles
// it without resending and finishes with exactly finalize, execute and the two claims. Skipped without Foundry.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Clock } from '../lib/clock.js';
import { type DryRunSetup, setupDryRun } from '../lib/dry-run.js';
import { type FlowResult, runTransferFlow } from '../lib/flow.js';

const foundry = ['anvil', 'forge', 'cast'].every(
  (bin) => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0,
);
const built = existsSync(new URL('../../contracts/out/MockUSDC.sol/MockUSDC.json', import.meta.url));

describe.skipIf(!foundry || !built)('resume after a pause at the reveal window', () => {
  let dir: string;
  let setup: DryRunSetup;
  let first: FlowResult;
  let second: FlowResult;
  const lines: string[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arcseal-resume-'));
    setup = await setupDryRun({
      deploymentsFile: join(dir, 'anvil-dry-run.json'),
      stateDir: join(dir, 'state'),
      say: (l) => lines.push(l),
      logLevel: 'silent',
    });
    const base = setup.ctx.clock;
    // Like RealClock with the default 15-minute limit: the 24 h wait pauses the run.
    const pausing: Clock = {
      chainNow: () => base.chainNow(),
      pinNextBlock: (t) => base.pinNextBlock?.(t) ?? Promise.resolve(),
      waitUntil: (t, what) =>
        what.includes('reveal window')
          ? Promise.resolve({ ready: false, resumeAt: t })
          : base.waitUntil(t, what),
    };
    first = await runTransferFlow({ ...setup.ctx, clock: pausing });

    // A crash between sending the reveal and saving its receipt leaves it "pending".
    const raw = JSON.parse(readFileSync(setup.stateFile, 'utf8'));
    raw.txs['transferRevealBatch.0'] = { ...raw.txs['transferRevealBatch.0'], status: 'pending' };
    delete raw.txs['transferRevealBatch.0'].gasUsed;
    writeFileSync(setup.stateFile, JSON.stringify(raw));

    lines.length = 0;
    second = await runTransferFlow({ ...setup.ctx, store: setup.open() });
  }, 180_000);
  afterAll(async () => {
    await setup?.anvil.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('pauses after the reveal, at the end of the 24 h window', () => {
    expect(first).toMatchObject({
      status: 'paused',
      proposalId: 1n,
      what: 'the end of the 24 h reveal window',
    });
    // mint, fund, propose, 3 votes, 1 revealBatch
    expect(first.sent).toBe(7);
  });

  it('resumes from the state file: settles the pending reveal and sends only the remaining four', () => {
    expect(second).toMatchObject({
      status: 'done',
      proposalId: 1n,
      tally: { for: 2, against: 1, passed: true },
    });
    expect(second.sent).toBe(4);
    const state = setup.open().get();
    expect(state.txs['transferRevealBatch.0']).toMatchObject({ status: 'success' });
    expect(state.txs['transferRevealBatch.0']?.gasUsed).toBeDefined();
    expect(Object.keys(state.txs).filter((k) => k.startsWith('transferRevealBatch.'))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith('[done]')).length).toBeGreaterThanOrEqual(6);
    expect(lines.some((l) => l.startsWith('[skip] revealBatch: no sealed vote left to reveal'))).toBe(true);
    for (const key of ['transferFinalize', 'transferExecute', 'transferClaim', 'transferBountyClaim']) {
      expect(state.txs[key]?.status).toBe('success');
    }
  });
});
