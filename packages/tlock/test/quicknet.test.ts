import { bls12_381 } from '@noble/curves/bls12-381';
import { describe, expect, it } from 'vitest';
import { QUICKNET, QUICKNET_DST } from '../src/index.js';
import chainInfo from './vectors/chain-info.json';

describe('QUICKNET', () => {
  it('pins the quicknet clock and key sizes from the PRD', () => {
    expect(QUICKNET.period).toBe(3);
    expect(QUICKNET.genesis).toBe(1692803367);
    expect(QUICKNET.scheme).toBe('bls-unchained-g1-rfc9380');
    expect(QUICKNET.chainHash).toBe('52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971');
    expect(QUICKNET.publicKey).toHaveLength(96 * 2);
  });

  it('matches the chain info fetched from api.drand.sh and committed with the vectors', () => {
    expect(chainInfo.info.hash).toBe(QUICKNET.chainHash);
    expect(chainInfo.info.public_key).toBe(QUICKNET.publicKey);
    expect(chainInfo.info.genesis_time).toBe(QUICKNET.genesis);
    expect(chainInfo.info.period).toBe(QUICKNET.period);
    expect(chainInfo.info.schemeID).toBe(QUICKNET.scheme);
  });

  it('holds a valid compressed G2 public key and the RFC 9380 G1 tag', () => {
    expect(() => bls12_381.G2.ProjectivePoint.fromHex(QUICKNET.publicKey)).not.toThrow();
    expect(QUICKNET_DST).toBe('BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_');
  });
});
