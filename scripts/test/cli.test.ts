import { describe, expect, it } from 'vitest';
import { parseCli, parseRevealCli } from '../lib/cli.js';

describe('parseCli (e2e-testnet.ts)', () => {
  it('defaults to the testnet run', () => {
    expect(parseCli([])).toEqual({
      help: false,
      dryRun: false,
      online: false,
      keepAlive: false,
      port: undefined,
      wait: false,
      reset: false,
    });
  });

  it('reads the dry-run flags and ignores a forwarded "--"', () => {
    expect(parseCli(['--dry-run', '--', '--online', '--keep-alive', '--port', '8600'])).toMatchObject({
      dryRun: true,
      online: true,
      keepAlive: true,
      port: 8600,
    });
  });

  it('refuses flags of the other mode, unknown flags and bad ports', () => {
    expect(() => parseCli(['--online'])).toThrow(/only apply to the dry run/);
    expect(() => parseCli(['--keep-alive'])).toThrow(/only apply to the dry run/);
    expect(() => parseCli(['--dry-run', '--wait'])).toThrow(/only apply to the testnet run/);
    expect(() => parseCli(['--dry-run', '--reset'])).toThrow(/only apply to the testnet run/);
    expect(() => parseCli(['--dry-run', '--port', '70000'])).toThrow(/invalid --port/);
    expect(() => parseCli(['--private-key', '0x01'])).toThrow();
  });
});

describe('parseRevealCli (reveal-cli.ts)', () => {
  it('requires a proposal id and defaults to testnet, read-only', () => {
    expect(() => parseRevealCli([])).toThrow(/--proposal <id> is required/);
    expect(() => parseRevealCli(['--proposal', '0'])).toThrow(/>= 1/);
    expect(parseRevealCli(['--proposal', '7'])).toMatchObject({
      network: 'testnet',
      proposalId: 7n,
      account: undefined,
      from: undefined,
      beaconTimeoutSeconds: 60,
    });
  });

  it('parses the network, DAO, block, keystore and unlocked account flags', () => {
    const opts = parseRevealCli([
      '--network',
      'local',
      '--proposal',
      '2',
      '--dao',
      '0x3ceecb211799413dd4f5316bec44e9d26268500f',
      '--from-block',
      '12',
      '--from',
      '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    ]);
    expect(opts).toMatchObject({
      network: 'local',
      proposalId: 2n,
      dao: '0x3ceEcB211799413dD4F5316bec44E9D26268500f',
      fromBlock: 12n,
      from: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    });
    expect(parseRevealCli(['--proposal', '1', '--account', 'arcseal-wallet-b']).account).toBe(
      'arcseal-wallet-b',
    );
    expect(parseRevealCli(['--proposal', '1']).garbageItem).toBe(false);
    expect(parseRevealCli(['--proposal', '1', '--garbage-item']).garbageItem).toBe(true);
  });

  it('keeps unlocked accounts local and rejects bad values', () => {
    const from = ['--from', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'];
    expect(() => parseRevealCli(['--proposal', '1', ...from])).toThrow(/--network local/);
    expect(() =>
      parseRevealCli(['--network', 'local', '--proposal', '1', ...from, '--account', 'x']),
    ).toThrow(/not both/);
    expect(() => parseRevealCli(['--network', 'goerli', '--proposal', '1'])).toThrow(/--network must be/);
    expect(() => parseRevealCli(['--proposal', '1', '--dao', '0x1234'])).toThrow(/not an address/);
    expect(() => parseRevealCli(['--proposal', '1', '--from-block', '12x'])).toThrow(/non-negative integer/);
    expect(() => parseRevealCli(['--proposal', '1', '--beacon-timeout', '0'])).toThrow(/positive integer/);
  });
});
