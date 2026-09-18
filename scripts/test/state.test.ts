import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEPLOYMENT_FILES } from '../lib/config.js';
import { proofTxsFromState, summaryLines, writeRunRecord } from '../lib/deployments.js';
import { newState, type RunState, StateStore } from '../lib/state.js';

const DAO = '0x3ceecb211799413dd4f5316bec44e9d26268500f';
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arcseal-state-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('StateStore', () => {
  it('creates, updates and reloads the state file atomically', () => {
    const file = join(dir, 'nested', '5042002.json');
    const store = StateStore.open(file, () => newState(5042002, DAO, 'run-1'));
    expect(existsSync(file)).toBe(true);
    expect(store.get().dao).toBe('0x3ceEcB211799413dD4F5316bec44E9D26268500f');

    store.update((d) => {
      d.txs['transferVotes.1'] = { label: 'vote', hash: hash(1), status: 'pending' };
      d.members['1'] = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
    });
    expect(existsSync(`${file}.tmp`)).toBe(false);

    const reloaded = StateStore.open(file, () => {
      throw new Error('must not re-initialize an existing state');
    });
    expect(reloaded.get().runTag).toBe('run-1');
    expect(reloaded.get().txs['transferVotes.1']?.status).toBe('pending');
    expect(reloaded.get().members['1']).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });

  it('rejects an invalid update without touching the file', () => {
    const file = join(dir, 's.json');
    const store = StateStore.open(file, () => newState(31337, DAO, 'run-2'));
    const before = readFileSync(file, 'utf8');
    expect(() =>
      store.update((d) => {
        d.txs.bad = { label: 'x', hash: '0x1234', status: 'success' };
      }),
    ).toThrow();
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(store.get().txs.bad).toBeUndefined();
  });

  it('refuses a corrupted state file with a clear message', () => {
    const file = join(dir, 'bad.json');
    writeFileSync(file, JSON.stringify({ version: 2 }));
    expect(() => StateStore.open(file, () => newState(1, DAO, 'x'))).toThrow(/is not valid/);
  });
});

function sampleState(): RunState {
  const state = newState(5042002, DAO, 'run-3');
  const ok = (label: string, n: number) => ({
    label,
    hash: hash(n),
    status: 'success' as const,
    gasUsed: String(10_000 * n),
    costUsdc: String(200 * n),
  });
  state.txs = {
    transferClaim: ok('claim', 9),
    'transferVotes.3': ok('vote 3', 5),
    'transferVotes.1': ok('vote 1', 3),
    'transferVotes.2': ok('vote 2', 4),
    fundTreasury: ok('fund', 1),
    transferPropose: ok('propose', 2),
    'transferRevealBatch.0': ok('reveal', 6),
    transferFinalize: { label: 'finalize', hash: hash(7), status: 'pending' },
  };
  state.proposal = {
    id: '4',
    closeRound: '32000000',
    revealEndRound: '32028800',
    block: '10',
    target: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    amount: '1000000',
  };
  return state;
}

describe('proofTxs and the deployments record', () => {
  it('maps confirmed transactions to proof keys: votes as an array, a single reveal as a string', () => {
    expect(proofTxsFromState(sampleState())).toEqual({
      fundTreasury: hash(1),
      transferPropose: hash(2),
      transferVotes: [hash(3), hash(4), hash(5)],
      transferRevealBatch: hash(6),
      transferClaim: hash(9),
    });
    const two = sampleState();
    two.txs['transferRevealBatch.1'] = { label: 'reveal 2', hash: hash(8), status: 'success' };
    expect(proofTxsFromState(two).transferRevealBatch).toEqual([hash(6), hash(8)]);
  });

  it('merges proofTxs and an e2e summary into the record, keeping every other field', () => {
    const file = join(dir, 'arc-testnet.json');
    copyFileSync(DEPLOYMENT_FILES.testnet, file);
    const template = JSON.parse(readFileSync(file, 'utf8'));
    writeRunRecord(file, sampleState());
    const record = JSON.parse(readFileSync(file, 'utf8'));
    expect(record.contracts).toEqual(template.contracts);
    expect(record.proofTxs.transferVotes).toEqual([hash(3), hash(4), hash(5)]);
    expect(record.proofTxs.transferFinalize).toBeNull();
    expect(record.proofTxs.addMemberPropose).toBeNull();
    expect(record.e2e).toMatchObject({ runTag: 'run-3', proposalId: 4, closeRound: 32_000_000 });
    expect(record.e2e.gasUsed).toMatchObject({ transferPropose: 20_000, 'transferVotes.2': 40_000 });
  });

  it('never writes the mainnet record and needs an existing file', () => {
    expect(() => writeRunRecord(DEPLOYMENT_FILES.mainnet, sampleState())).toThrow(/arc-mainnet/);
    expect(() => writeRunRecord(join(dir, 'missing.json'), sampleState())).toThrow(/record the deployment/);
  });

  it('prints confirmed transactions in flow order with gas, fee and explorer link', () => {
    const lines = summaryLines(sampleState(), 'https://explorer.testnet.arc.io');
    expect(lines.map((l) => l.trim().split(/\s+/)[0])).toEqual([
      'fund',
      'propose',
      'vote',
      'vote',
      'vote',
      'reveal',
      'claim',
    ]);
    expect(lines[2]).toContain('vote 1');
    expect(lines[0]).toContain(
      `gas 10,000, fee 0.000200 USDC  https://explorer.testnet.arc.io/tx/${hash(1)}`,
    );
  });
});
