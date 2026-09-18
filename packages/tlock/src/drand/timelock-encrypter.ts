// Vendored from tlock-js 0.9.0 (commit 17d817ee259e79381111dd75009b0f022c39ace3, MIT), src/drand/timelock-encrypter.ts.
// ArcSeal changes: no ChainClient and no network. The quicknet chain info is the pinned QUICKNET constant, so only
// the `bls-unchained-g1-rfc9380` branch remains. Rounds are bigint (uint64). No Buffer.
import {sha256} from "@noble/hashes/sha256"
import * as ibe from "../crypto/ibe"
import type {Stanza} from "../age/age-encrypt-decrypt"
import type {Ciphertext} from "../crypto/ibe"
import {concatBytes, hexToBytes, uint64BE} from "../bytes"
import {QUICKNET} from "../quicknet"

export function createTimelockEncrypter(roundNumber: bigint) {
    if (roundNumber < 1n) {
        throw Error("You cannot encrypt for a roundNumber less than 1 (genesis = 0)")
    }

    return async (fileKey: Uint8Array): Promise<Array<Stanza>> => {
        const pk = hexToBytes(QUICKNET.publicKey)
        const id = hashedRoundNumber(roundNumber)
        const ciphertext: Ciphertext = await ibe.encryptOnG2RFC9380(pk, id, fileKey)
        return [{
            type: "tlock",
            args: [`${roundNumber}`, QUICKNET.chainHash],
            body: serialisedCiphertext(ciphertext)
        }]
    }
}


export function hashedRoundNumber(round: bigint): Uint8Array {
    return sha256(uint64BE(round))
}

function serialisedCiphertext(ciphertext: Ciphertext): Uint8Array {
    return concatBytes(ciphertext.U, ciphertext.V, ciphertext.W)
}
