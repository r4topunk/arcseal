// Keystore signers through `cast wallet private-key`, against a throwaway keystore created here for the test (a
// fresh random key in a temp dir, deleted afterwards). No real keystore is touched.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keystoreAccount, lazy } from '../lib/signers.js';

const castAvailable = spawnSync('cast', ['--version'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!castAvailable)('keystoreAccount (cast)', () => {
  let dir: string;
  let address: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'arcseal-ks-'));
    writeFileSync(join(dir, 'password'), 'test-password');
    writeFileSync(join(dir, 'wrong'), 'not-the-password');
    const created = spawnSync(
      'cast',
      ['wallet', 'new', dir, 'e2e-test', '--unsafe-password', 'test-password'],
      {
        encoding: 'utf8',
      },
    );
    const match = /Address:\s+(0x[0-9a-fA-F]{40})/.exec(created.stdout);
    if (!match?.[1]) throw new Error(`cast wallet new failed: ${created.stderr}`);
    address = match[1];
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('decrypts a keystore with a password file into a viem account', async () => {
    const account = await keystoreAccount('e2e-test', {
      keystoreDir: dir,
      passwordFile: join(dir, 'password'),
    });
    expect(account.address).toBe(address);
    expect(account.type).toBe('local');
  });

  it('fails without leaking anything on a wrong password or an unknown keystore', async () => {
    const wrong = await keystoreAccount('e2e-test', {
      keystoreDir: dir,
      passwordFile: join(dir, 'wrong'),
    }).catch((e: unknown) => e as Error);
    expect(wrong).toBeInstanceOf(Error);
    expect((wrong as Error).message).toMatch(/could not decrypt keystore "e2e-test"/);
    expect((wrong as Error).message).not.toMatch(/0x[0-9a-fA-F]{64}/);
    await expect(
      keystoreAccount('missing', { keystoreDir: dir, passwordFile: join(dir, 'password') }),
    ).rejects.toThrow(/could not decrypt keystore "missing"/);
  });

  it('refuses names that are not plain keystore file names', async () => {
    await expect(keystoreAccount('../escape')).rejects.toThrow(/invalid keystore name/);
    await expect(keystoreAccount('0xabc --private-key')).rejects.toThrow(/invalid keystore name/);
  });
});

describe('lazy', () => {
  it('loads each key once and retries after a failure', async () => {
    let calls = 0;
    const load = lazy(async (k: number) => {
      calls++;
      if (k === 0 && calls === 1) throw new Error('first try fails');
      return k * 10;
    });
    await expect(load(0)).rejects.toThrow('first try fails');
    expect(await load(0)).toBe(0);
    expect(await load(2)).toBe(20);
    expect(await load(2)).toBe(20);
    expect(calls).toBe(3);
  });
});
