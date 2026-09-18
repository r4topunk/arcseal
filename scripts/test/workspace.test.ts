import { describe, expect, it } from 'vitest';

describe('workspace dependencies', () => {
  it('resolve the built @arcseal/sdk and @arcseal/tlock packages', async () => {
    const [sdk, tlock] = await Promise.all([import('@arcseal/sdk'), import('@arcseal/tlock')]);
    expect(Object.keys(sdk).length).toBeGreaterThan(0);
    expect(Object.keys(tlock).length).toBeGreaterThan(0);
  });
});
