// Writes a run's confirmed transaction hashes into a deployments JSON (`proofTxs`, plus an `e2e` summary), keeping
// every other field. The testnet run writes deployments/arc-testnet.json; the dry run writes
// deployments/anvil-dry-run.json (gitignored). Nothing here ever touches deployments/arc-mainnet.json.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { DEPLOYMENT_FILES, txUrl } from './config.js';
import { formatInt, formatUsdc, pad } from './format.js';
import type { RunState } from './state.js';

/** Step keys of the flow, in order. Multi-transaction steps are stored as "<key>.<n>" in the state. */
export const PROOF_KEYS = [
  'mockUsdcMint',
  'fundTreasury',
  'transferPropose',
  'transferVotes',
  'transferRevealBatch',
  'transferFinalize',
  'transferExecute',
  'transferClaim',
  'transferBountyClaim',
] as const;

/** Confirmed hashes by proof key: a string for one transaction, an array for votes and several reveal batches. */
export function proofTxsFromState(state: Readonly<RunState>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const confirmed = Object.entries(state.txs).filter(([, tx]) => tx.status === 'success');
  for (const key of PROOF_KEYS) {
    const single = confirmed.find(([k]) => k === key);
    if (single) {
      out[key] = single[1].hash;
      continue;
    }
    const many = confirmed
      .filter(([k]) => k.startsWith(`${key}.`))
      .sort(([a], [b]) => Number(a.split('.')[1]) - Number(b.split('.')[1]))
      .map(([, tx]) => tx.hash);
    if (many.length === 0) continue;
    out[key] = key === 'transferVotes' || many.length > 1 ? many : (many[0] as string);
  }
  return out;
}

/** Merges the run's proof hashes and summary into `file` (atomic write). Refuses the mainnet record. */
export function writeRunRecord(
  file: string,
  state: Readonly<RunState>,
  extra: Record<string, unknown> = {},
): void {
  if (file === DEPLOYMENT_FILES.mainnet) throw new Error('refusing to write deployments/arc-mainnet.json');
  if (!existsSync(file)) throw new Error(`missing ${file}: record the deployment first`);
  const record = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const proofTxs = { ...((record.proofTxs as Record<string, unknown> | undefined) ?? {}) };
  Object.assign(proofTxs, proofTxsFromState(state));
  const gasUsed: Record<string, number> = {};
  for (const [key, tx] of Object.entries(state.txs)) {
    if (tx.status === 'success' && tx.gasUsed) gasUsed[key] = Number(tx.gasUsed);
  }
  const updated = {
    ...record,
    ...extra,
    proofTxs,
    e2e: {
      runTag: state.runTag,
      proposalId: state.proposal ? Number(state.proposal.id) : null,
      closeRound: state.proposal ? Number(state.proposal.closeRound) : null,
      revealEndRound: state.proposal ? Number(state.proposal.revealEndRound) : null,
      startedAt: state.startedAt,
      completedAt: state.completedAt ?? null,
      gasUsed,
    },
  };
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(updated, null, 2)}\n`);
  renameSync(tmp, file);
}

/** One line per confirmed transaction, in flow order: label, hash, gas (and fee on Arc), explorer link. */
export function summaryLines(state: Readonly<RunState>, explorer: string): string[] {
  const order = (key: string) => {
    const [base = '', n = '0'] = key.split('.');
    return PROOF_KEYS.indexOf(base as (typeof PROOF_KEYS)[number]) * 1_000 + Number(n);
  };
  return Object.entries(state.txs)
    .filter(([, tx]) => tx.status === 'success')
    .sort(([a], [b]) => order(a) - order(b))
    .map(([, tx]) => {
      const gas = tx.gasUsed ? `gas ${formatInt(BigInt(tx.gasUsed))}` : '';
      const fee = tx.costUsdc ? `, fee ${formatUsdc(BigInt(tx.costUsdc))}` : '';
      const url = explorer ? `  ${txUrl(explorer, tx.hash)}` : '';
      return `  ${pad(tx.label, 48)} ${tx.hash}  ${gas}${fee}${url}`;
    });
}
