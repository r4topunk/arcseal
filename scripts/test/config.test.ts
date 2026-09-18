import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicClient } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  chainFor,
  DEPLOYMENT_FILES,
  httpWithGasMargin,
  parseEnv,
  readDeployment,
  testnetEnvSchema,
  txUrl,
} from '../lib/config.js';

describe('testnet env', () => {
  it('defaults follow .env.example and treat placeholders as unset', () => {
    const env = parseEnv(testnetEnvSchema, {
      SEALED_DAO_ADDRESS: '[ADDRESS]',
      SEALED_DAO_DEPLOY_BLOCK: '[DEPLOY_BLOCK]',
      KEYSTORE_PASSWORD_FILE: '',
    });
    expect(env).toMatchObject({
      ARC_TESTNET_RPC: 'https://rpc.testnet.arc.io',
      SEALED_DAO_ADDRESS: undefined,
      SEALED_DAO_DEPLOY_BLOCK: undefined,
      MEMBER1_ACCOUNT: 'arcseal-deployer',
      MEMBER2_ACCOUNT: 'arcseal-wallet-b',
      MEMBER3_ACCOUNT: 'arcseal-wallet-c',
      KEYSTORE_PASSWORD_FILE: undefined,
      E2E_VOTING_SECONDS: 600,
      E2E_PAYOUT: 1_000_000n,
      E2E_MAX_WAIT_SECONDS: 900,
    });
  });

  it('parses overrides and lists every bad variable', () => {
    const env = parseEnv(testnetEnvSchema, {
      SEALED_DAO_ADDRESS: '0x3ceecb211799413dd4f5316bec44e9d26268500f',
      SEALED_DAO_DEPLOY_BLOCK: '123',
      E2E_VOTING_SECONDS: '3600',
      E2E_PAYOUT: '250000',
    });
    expect(env.SEALED_DAO_ADDRESS).toBe('0x3ceEcB211799413dD4F5316bec44E9D26268500f');
    expect(env.SEALED_DAO_DEPLOY_BLOCK).toBe(123n);
    expect(env.E2E_VOTING_SECONDS).toBe(3_600);
    expect(env.E2E_PAYOUT).toBe(250_000n);
    expect(() =>
      parseEnv(testnetEnvSchema, { SEALED_DAO_ADDRESS: '0x12', E2E_VOTING_SECONDS: '60', E2E_PAYOUT: '0' }),
    ).toThrow(/SEALED_DAO_ADDRESS[\s\S]*E2E_VOTING_SECONDS[\s\S]*E2E_PAYOUT/);
  });
});

describe('deployment records and chains', () => {
  it('reads null from an unfilled template and the address once recorded', () => {
    expect(readDeployment(DEPLOYMENT_FILES.testnet)).toBeNull();
    expect(readDeployment(DEPLOYMENT_FILES.mainnet)).toEqual({
      chainId: 5042,
      dao: '0x789f7689eFb75a1696C5A25d5aE97Ac2cF6A2c44',
      deployBlock: 21_508_506n,
    });
    const dir = mkdtempSync(join(tmpdir(), 'arcseal-dep-'));
    try {
      const file = join(dir, 'd.json');
      writeFileSync(
        file,
        JSON.stringify({
          chainId: 5042002,
          contracts: {
            SealedDAO: { address: '0x3ceecb211799413dd4f5316bec44e9d26268500f', deployBlock: 42 },
          },
        }),
      );
      expect(readDeployment(file)).toEqual({
        chainId: 5042002,
        dao: '0x3ceEcB211799413dD4F5316bec44E9D26268500f',
        deployBlock: 42n,
      });
      expect(readDeployment(join(dir, 'missing.json'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds Arc chains with the PRD RPC and explorer, and explorer links', () => {
    const testnet = chainFor(5042002, 'https://rpc.testnet.arc.io', 'https://explorer.testnet.arc.io');
    expect(testnet.id).toBe(5042002);
    expect(testnet.rpcUrls.default.http).toEqual(['https://rpc.testnet.arc.io']);
    expect(testnet.blockExplorers?.default.url).toBe('https://explorer.testnet.arc.io');
    expect(testnet.nativeCurrency.symbol).toBe('USDC');
    expect(chainFor(31337, 'http://127.0.0.1:8545').blockExplorers).toBeUndefined();
    expect(() => chainFor(1, 'http://x')).toThrow(/unsupported chain/);
    expect(txUrl('https://explorer.arc.io/', '0xab')).toBe('https://explorer.arc.io/tx/0xab');
    expect(txUrl('', '0xab')).toBe('');
  });
});

describe('httpWithGasMargin', () => {
  let server: Server;
  let url: string;
  const seen: { method: string; params: unknown[] }[] = [];

  beforeAll(async () => {
    // A minimal JSON-RPC node: exact gas figures, and it records what reaches it.
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        const { id, method, params } = JSON.parse(body) as { id: number; method: string; params: unknown[] };
        seen.push({ method, params });
        const result =
          method === 'eth_estimateGas'
            ? '0x2c258' // 180,824
            : method === 'eth_fillTransaction'
              ? { raw: '0x', tx: { gas: '0x2c258', nonce: '0x0' } }
              : method === 'eth_sendTransaction'
                ? `0x${'ab'.repeat(32)}`
                : '0x1';
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('adds 20 % to eth_estimateGas and eth_fillTransaction gas', async () => {
    const client = createPublicClient({ transport: httpWithGasMargin(url) });
    expect(await client.request({ method: 'eth_estimateGas', params: [{}] } as never)).toBe('0x34f9c'); // 216,988
    const filled = (await client.request({ method: 'eth_fillTransaction', params: [{}] } as never)) as {
      tx: { gas: string; nonce: string };
    };
    expect(filled.tx).toEqual({ gas: '0x34f9c', nonce: '0x0' });
    expect(await client.request({ method: 'eth_chainId' } as never)).toBe('0x1');
  });

  it('fills a padded gas limit into eth_sendTransaction without one, and keeps an explicit one', async () => {
    const client = createPublicClient({ transport: httpWithGasMargin(url) });
    seen.length = 0;
    await client.request({ method: 'eth_sendTransaction', params: [{ from: '0x01', data: '0x' }] } as never);
    expect(seen.map((s) => s.method)).toEqual(['eth_estimateGas', 'eth_sendTransaction']);
    expect(seen[1]?.params[0]).toEqual({ from: '0x01', data: '0x', gas: '0x34f9c' });

    seen.length = 0;
    await client.request({
      method: 'eth_sendTransaction',
      params: [{ from: '0x01', gas: '0x5208' }],
    } as never);
    expect(seen.map((s) => s.method)).toEqual(['eth_sendTransaction']);
    expect(seen[0]?.params[0]).toEqual({ from: '0x01', gas: '0x5208' });
  });
});
