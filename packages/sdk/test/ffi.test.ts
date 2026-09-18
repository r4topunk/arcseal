import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// scripts/ffi-hash-vote.mjs imports the BUILT SDK (dist/). The root `pnpm test` builds it first.
const script = fileURLToPath(new URL('../scripts/ffi-hash-vote.mjs', import.meta.url));
const built = existsSync(fileURLToPath(new URL('../dist/index.js', import.meta.url)));
const { vectors } = JSON.parse(
  readFileSync(new URL('../../../contracts/test/vectors/hashvote.json', import.meta.url), 'utf8'),
) as { vectors: { proposalId: string; voter: string; choice: number; salt: string; commitment: string }[] };

const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

describe.skipIf(!built)('FFI script for the Foundry hashVote test (needs `pnpm build`)', () => {
  it('prints exactly 0x + 64 hex (no newline) for every hashvote.json vector', () => {
    for (const v of vectors) {
      const res = run(v.proposalId, v.voter, String(v.choice), v.salt);
      expect(res.status).toBe(0);
      expect(res.stderr).toBe('');
      expect(res.stdout).toBe(v.commitment);
    }
  });

  it('fails with exit 1, empty stdout and a message on bad arguments', () => {
    const v = vectors[2]!;
    for (const args of [
      [v.proposalId, v.voter, String(v.choice)],
      [v.proposalId, v.voter, '3', v.salt],
      ['-1', v.voter, '1', v.salt],
      [v.proposalId, v.voter, '1', v.salt.slice(0, -2)],
    ]) {
      const res = run(...args);
      expect(res.status).toBe(1);
      expect(res.stdout).toBe('');
      expect(res.stderr).toMatch(/^ffi-hash-vote: /);
    }
  });
});
