import { describe, expect, it } from 'vitest';
import { parseConfig } from '@/lib/config';

describe('parseConfig (NEXT_PUBLIC_* at build time)', () => {
  it('defaults to Arc mainnet with no DAO', () => {
    const c = parseConfig({});
    expect(c.chainId).toBe(5042);
    expect(c.rpcUrl).toBe('https://rpc.mainnet.arc.io');
    expect(c.explorerUrl).toBe('https://explorer.arc.io');
    expect(c.dao).toBeNull();
    expect(c.basePath).toBe('');
    expect(c.problems).toEqual([]);
  });

  it('supports Arc testnet and a local anvil without an explorer', () => {
    const testnet = parseConfig({ NEXT_PUBLIC_CHAIN_ID: '5042002' });
    expect(testnet.chain.id).toBe(5042002);
    expect(testnet.rpcUrl).toBe('https://rpc.testnet.arc.io');
    expect(testnet.explorerUrl).toBe('https://explorer.testnet.arc.io');
    const local = parseConfig({
      NEXT_PUBLIC_CHAIN_ID: '31337',
      NEXT_PUBLIC_RPC_URL: 'http://127.0.0.1:8545/',
    });
    expect(local.chain.id).toBe(31337);
    expect(local.rpcUrl).toBe('http://127.0.0.1:8545');
    expect(local.explorerUrl).toBeNull();
  });

  it('checksums the DAO, treats placeholders as unset and reads the deploy block and basePath', () => {
    const c = parseConfig({
      NEXT_PUBLIC_DAO_ADDRESS: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
      NEXT_PUBLIC_DAO_DEPLOY_BLOCK: '1234',
      NEXT_PUBLIC_BASE_PATH: '/arcseal/',
    });
    expect(c.dao).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3');
    expect(c.deployBlock).toBe(1234n);
    expect(c.basePath).toBe('/arcseal');
    expect(parseConfig({ NEXT_PUBLIC_DAO_ADDRESS: '[ADDRESS]' }).dao).toBeNull();
    expect(parseConfig({ NEXT_PUBLIC_DAO_DEPLOY_BLOCK: '[DEPLOY_BLOCK]' }).deployBlock).toBe(0n);
  });

  it('reports an unsupported chain and a missing deploy block', () => {
    expect(parseConfig({ NEXT_PUBLIC_CHAIN_ID: '1' }).problems[0]).toContain('NEXT_PUBLIC_CHAIN_ID=1');
    const noBlock = parseConfig({ NEXT_PUBLIC_DAO_ADDRESS: '0x5fbdb2315678afecb367f032d93f642f64180aa3' });
    expect(noBlock.problems.join(' ')).toContain('NEXT_PUBLIC_DAO_DEPLOY_BLOCK');
  });
});
