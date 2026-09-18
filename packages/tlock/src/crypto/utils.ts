// Vendored from tlock-js 0.9.0 (commit 17d817ee259e79381111dd75009b0f022c39ace3, MIT), src/crypto/utils.ts.
// ArcSeal changes: no Buffer (hexToBytes and concatBytes from @noble/hashes), non-null index reads for strict TS.
import {concatBytes, hexToBytes} from "../bytes"
import type {Fp, Fp12, Fp2, Fp6} from "./fp"

// returns a new array with the xor of a ^ b
export function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
    if (a.length !== b.length) {
        throw new Error("Error: incompatible sizes")
    }

    const ret = new Uint8Array(a.length)

    for (let i = 0; i < a.length; i++) {
        ret[i] = a[i]! ^ b[i]!
    }

    return ret
}

////// code from Noble:
////// https://github.com/paulmillr/noble-bls12-381/blob/6380415f1b7e5078c8883a5d8d687f2dd3bff6c2/index.ts#L132-L145
export function bytesToNumberBE(uint8a: Uint8Array): bigint {
    return BigInt('0x' + bytesToHex(Uint8Array.from(uint8a)))
}

const hexes = Array.from({length: 256}, (_v, i) => i.toString(16).padStart(2, '0'))

export function bytesToHex(uint8a: Uint8Array): string {
// pre-caching chars could speed this up 6x.
    let hex = ''
    for (let i = 0; i < uint8a.length; i++) {
        hex += hexes[uint8a[i]!]
    }
    return hex
}

////// end of code from Noble.

// Function to convert Noble's FPs to byte arrays compatible with Kilic library.
// weirdly all the child FPs have to be reversed when serialising to bytes
export function fpToBytes(fp: Fp): Uint8Array {
    // 48 bytes = 96 hex bytes
    const hex = fp.toString(16).padStart(96, "0")
    return hexToBytes(hex)
}

export function fp2ToBytes(fp2: Fp2): Uint8Array {
    return concatBytes(...[fp2.c1, fp2.c0].map(fpToBytes))
}

// fp6 isn't exported by noble... let's take off the guard rails
export function fp6ToBytes(fp6: Fp6): Uint8Array {
    return concatBytes(...[fp6.c2, fp6.c1, fp6.c0].map(fp2ToBytes))
}

export function fp12ToBytes(fp12: Fp12): Uint8Array {
    return concatBytes(...[fp12.c1, fp12.c0].map(fp6ToBytes))
}
