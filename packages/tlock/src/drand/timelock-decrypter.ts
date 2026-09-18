// Vendored from tlock-js 0.9.0 (commit 17d817ee259e79381111dd75009b0f022c39ace3, MIT), src/drand/timelock-decrypter.ts.
// ArcSeal changes: the beacon is an argument (upstream fetched it over HTTP inside decrypt and logged it), so there is
// no ChainClient, no "too early" clock check and no console output. quicknet only: the stanza's chain hash must be
// quicknet's (upstream left this as a TODO), the round is a strict uint64 and must equal the beacon's, and the body
// must be exactly U (96-byte G2 point) || V (16 bytes) || W (16 bytes). Failures throw TlockError. No Buffer.
import {bls12_381} from "@noble/curves/bls12-381"
import type {Stanza} from "../age/age-encrypt-decrypt"
import * as ibe from "../crypto/ibe"
import type {Ciphertext} from "../crypto/ibe"
import {TlockError} from "../errors"
import {QUICKNET} from "../quicknet"

// quicknet ciphertext: U is a compressed G2 point, V and W are as long as the 16-byte age file key
const pointLength = 96
const fileKeyLength = 16
const maxUint64 = (1n << 64n) - 1n

export type TlockBeacon = {
    round: bigint
    signature: Uint8Array
}

export function createTimelockDecrypter(beacon: TlockBeacon) {
    return async (recipients: Array<Stanza>): Promise<Uint8Array> => {
        const {roundNumber, body} = parseTlockStanza(recipients)

        if (roundNumber !== beacon.round) {
            throw new TlockError(
                "ROUND_MISMATCH",
                `The ciphertext is locked to round ${roundNumber} but the beacon is for round ${beacon.round}`
            )
        }

        const ciphertext = parseCiphertext(body)
        try {
            bls12_381.G1.ProjectivePoint.fromHex(beacon.signature)
        } catch (err) {
            throw new TlockError("WRONG_BEACON", "The beacon signature is not a valid G1 point", {cause: err})
        }
        try {
            return await ibe.decryptOnG2(beacon.signature, ciphertext)
        } catch (err) {
            throw new TlockError(
                "WRONG_BEACON",
                `The beacon for round ${roundNumber} does not open this ciphertext (wrong signature or tampered stanza)`,
                {cause: err}
            )
        }
    }
}

// finds the tlock stanza and validates it against the pinned quicknet chain
export function parseTlockStanza(recipients: Array<Stanza>): {roundNumber: bigint, body: Uint8Array} {
    const tlockStanza = recipients.find(it => it.type === "tlock")

    if (!tlockStanza) {
        throw new TlockError("MALFORMED_CIPHERTEXT", "You must pass a timelock stanza!")
    }
    const {args, body} = tlockStanza

    if (args.length !== 2) {
        throw new TlockError(
            "MALFORMED_CIPHERTEXT",
            `Timelock stanza expected 2 args: roundNumber and chainHash. Only received ${args.length}`
        )
    }

    const roundNumber = parseRoundNumber(args)
    const [, chainHash] = args
    if (chainHash !== QUICKNET.chainHash) {
        throw new TlockError("WRONG_CHAIN", `The ciphertext targets drand chain ${chainHash}, not quicknet`)
    }

    return {roundNumber, body}
}

function parseRoundNumber(args: Array<string>): bigint {
    const [roundNumber = ""] = args

    // decimal digits only, like Go's strconv.ParseUint(round, 10, 64) in tlock
    if (!/^[0-9]{1,20}$/.test(roundNumber)) {
        throw new TlockError("MALFORMED_CIPHERTEXT", `Expected the roundNumber arg to be a number, but it was ${roundNumber}!`)
    }
    const roundNumberParsed = BigInt(roundNumber)
    if (roundNumberParsed < 1n || roundNumberParsed > maxUint64) {
        throw new TlockError("MALFORMED_CIPHERTEXT", `The roundNumber arg ${roundNumber} is outside 1..2^64-1`)
    }

    return roundNumberParsed
}

function parseCiphertext(body: Uint8Array): Ciphertext {
    if (body.length !== pointLength + 2 * fileKeyLength) {
        throw new TlockError(
            "MALFORMED_CIPHERTEXT",
            `The tlock stanza body must be ${pointLength + 2 * fileKeyLength} bytes, got ${body.length}`
        )
    }
    const pointBytes = body.subarray(0, pointLength)
    const theRest = body.subarray(pointLength)
    const eachHalf = theRest.length / 2

    const U = pointBytes
    const V = theRest.subarray(0, eachHalf)
    const W = theRest.subarray(eachHalf)

    try {
        bls12_381.G2.ProjectivePoint.fromHex(U)
    } catch (err) {
        throw new TlockError("MALFORMED_CIPHERTEXT", "The tlock stanza U is not a valid G2 point", {cause: err})
    }

    return {U, V, W}
}
