// Vendored from tlock-js 0.9.0 (commit 17d817ee259e79381111dd75009b0f022c39ace3, MIT), src/age/age-encrypt-decrypt.ts.
// ArcSeal changes: the age file is raw bytes in and out (no "binary" strings, no Buffer), the no-op default wrappers
// are gone, the MAC is compared in constant time, and failures throw TlockError with a stage-specific code.
import {hkdf} from "@noble/hashes/hkdf"
import {sha256} from "@noble/hashes/sha256"
import {equalBytes} from "@noble/curves/abstract/utils"
import {STREAM} from "./stream-cipher"
import {readAge, writeAge} from "./age-reader-writer"
import {sliceUntil} from "./utils"
import {createMacKey, random} from "./utils-crypto"
import {bytesToBinary, concatBytes, utf8ToBytes} from "../bytes"
import {isTlockError, TlockError} from "../errors"

type FileKey = Uint8Array
type EncryptionWrapper = (fileKey: FileKey) => Promise<Array<Stanza>>
type DecryptionWrapper = (recipients: Array<Stanza>) => Promise<FileKey>

// `Stanza` is a section of the age header that encapsulates the file key as
// encrypted to a specific recipient.
export type Stanza = {
    type: string,
    args: Array<string>,
    body: Uint8Array
}

const ageVersion = "age-encryption.org/v1"
const headerMacMessage = "header" // some plaintext used to generate the mac
const hkdfBodyMessage = "payload" // some plaintext used for generating the key for encrypting the body
const fileKeyLengthBytes = 16
const bodyHkdfNonceLengthBytes = 16
const hkdfKeyLengthBytes = 32

// encrypts a plaintext payload using AGE by generating a fileKey
// and passing the fileKey to another `EncryptionWrapper` for handling
export async function encryptAge(
    plaintext: Uint8Array,
    wrapFileKey: EncryptionWrapper
): Promise<Uint8Array> {
    const fileKey = await random(fileKeyLengthBytes)
    const recipients = await wrapFileKey(fileKey)
    const body = await encryptedPayload(fileKey, plaintext)

    return writeAge({
            fileKey,
            version: ageVersion,
            recipients,
            headerMacMessage,
            body
        }
    )
}

async function encryptedPayload(fileKey: Uint8Array, payload: Uint8Array): Promise<Uint8Array> {
    const nonce = await random(bodyHkdfNonceLengthBytes)
    const hkdfKey = hkdf(sha256, fileKey, nonce, utf8ToBytes(hkdfBodyMessage), hkdfKeyLengthBytes)
    const ciphertext = STREAM.seal(payload, hkdfKey)
    return concatBytes(nonce, ciphertext)
}

// decrypts a payload that has been encrypted using AGE can unwrap
// any internal encryption by passing a `DecryptionWrapper` that can
// provide the `fileKey` created during encryption
export async function decryptAge(
    payload: Uint8Array,
    unwrapFileKey: DecryptionWrapper
): Promise<Uint8Array> {
    const text = bytesToBinary(payload)
    const encryptedPayload = parseAge(text)

    const fileKey = await unwrapFileKey(encryptedPayload.header.recipients)
    const header = sliceUntil(text, "---")
    const expectedMac = createMacKey(fileKey, headerMacMessage, header)
    const actualMac = encryptedPayload.header.mac

    if (!equalBytes(actualMac, expectedMac)) {
        throw new TlockError("DECRYPTION_FAILED", "The MAC did not validate for the fileKey and payload!")
    }

    const nonce = encryptedPayload.body.slice(0, bodyHkdfNonceLengthBytes)
    const cipherText = encryptedPayload.body.slice(bodyHkdfNonceLengthBytes)
    if (nonce.length !== bodyHkdfNonceLengthBytes) {
        throw new TlockError("DECRYPTION_FAILED", "The payload is shorter than its nonce: the ciphertext is truncated")
    }
    const hkdfKey = hkdf(sha256, fileKey, nonce, utf8ToBytes(hkdfBodyMessage), hkdfKeyLengthBytes)

    try {
        return STREAM.open(cipherText, hkdfKey)
    } catch (err) {
        throw new TlockError("DECRYPTION_FAILED", `The payload did not authenticate: ${(err as Error).message}`, {cause: err})
    }
}

// parses the age header and checks the version, mapping every failure to MALFORMED_CIPHERTEXT
export function parseAge(text: string): ReturnType<typeof readAge> {
    let encryptedPayload: ReturnType<typeof readAge>
    try {
        encryptedPayload = readAge(text)
    } catch (err) {
        if (isTlockError(err)) throw err
        throw new TlockError("MALFORMED_CIPHERTEXT", `Not a valid age file: ${(err as Error).message}`, {cause: err})
    }
    const version = encryptedPayload.header.version
    if (version !== ageVersion) {
        throw new TlockError("MALFORMED_CIPHERTEXT", `The payload version ${version} is not supported, only ${ageVersion}`)
    }
    return encryptedPayload
}
