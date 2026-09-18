/**
 * drand quicknet chain info, pinned so encryption never fetches it (PRD 5.1).
 * Fetched once from https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/info;
 * the response is committed as test/vectors/chain-info.json and a test keeps both in sync.
 * quicknet is unchained, signs on G1 (48-byte signatures) with a G2 public key (96 bytes), and hashes rounds
 * to G1 with the RFC 9380 domain separation tag.
 */
export const QUICKNET = {
  chainHash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  publicKey:
    '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  /** Unix seconds of round 1. */
  genesis: 1692803367,
  /** Seconds between rounds. */
  period: 3,
  scheme: 'bls-unchained-g1-rfc9380',
} as const;

/** Hash-to-curve domain separation tag of the `bls-unchained-g1-rfc9380` scheme (signatures on G1). */
export const QUICKNET_DST = 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_';
