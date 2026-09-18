import { describe, expect, it } from 'vitest';
import { USDC_ADDRESS, USDC_DECIMALS } from '../src/index.js';

describe('USDC constants', () => {
  it('point at the Arc USDC predeploy in its 6-decimal ERC-20 view', () => {
    expect(USDC_ADDRESS).toBe('0x3600000000000000000000000000000000000000');
    expect(USDC_DECIMALS).toBe(6);
  });
});
