// Vendored from tlock-js 0.9.0 (commit 17d817ee259e79381111dd75009b0f022c39ace3, MIT), src/age/utils-crypto.ts.
// ArcSeal changes: no Buffer, and `random` uses Web Crypto `getRandomValues` (Node 22 and browsers) instead of the
// `window.crypto` check plus a CommonJS `require("crypto")` fallback that throws in ESM.
import {hkdf} from "@noble/hashes/hkdf"
import {sha256} from "@noble/hashes/sha256"
import {hmac} from "@noble/hashes/hmac"
import {randomBytes} from "@noble/hashes/utils"
import {utf8ToBytes} from "../bytes"

export function createMacKey(fileKey: Uint8Array, macMessage: string, headerText: string): Uint8Array {
    // empty string salt as per the spec!
    const hmacKey = hkdf(sha256, fileKey, "", utf8ToBytes(macMessage), 32)
    return hmac(sha256, hmacKey, utf8ToBytes(headerText))
}

// returns n bytes read from the platform CSPRNG (crypto.getRandomValues).
export async function random(n: number): Promise<Uint8Array> {
    return randomBytes(n)
}
