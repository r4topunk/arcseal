// Vendored from tlock-js 0.9.0 (commit 17d817ee259e79381111dd75009b0f022c39ace3, MIT), src/crypto/fp.ts.
// ArcSeal changes: types only. The unused tuple converters and the `declare const` field objects are gone, and the
// export list is `export type` (upstream's mixed value/type export fails verbatimModuleSyntax with TS1205).

// these are all some helpers around the field elements used in the BLS lib that got abstracted away
// when migrating from @noble/bls12-381 -> @noble/curves
type Fp = bigint;
type Fp2 = {
    c0: bigint;
    c1: bigint;
};
type Fp6 = {
    c0: Fp2;
    c1: Fp2;
    c2: Fp2;
};
type Fp12 = {
    c0: Fp6;
    c1: Fp6;
};

export type {Fp, Fp2, Fp6, Fp12}
