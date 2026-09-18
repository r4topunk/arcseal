// Vendored from tlock-js 0.9.0 (commit 17d817ee259e79381111dd75009b0f022c39ace3, MIT), src/age/utils.ts.
// ArcSeal changes: base64 goes through the Buffer-free helpers in ../bytes, and decoding is strict.
import {base64DecodeUnpadded, base64EncodeUnpadded} from "../bytes"

// as per the spec:
// RFC 4648, Section 4
// without = padding characters (sometimes referred to as "raw" or "unpadded" base64)
export function unpaddedBase64(buf: Uint8Array): string {
    return base64EncodeUnpadded(buf)
}

export function unpaddedBase64Decode(input: string): Uint8Array {
    return base64DecodeUnpadded(input)
}

/*
    e.g. chunked("hello world", 2, ".") returns
    ["he.", "ll.", "o .", "wo.", "rl.", "d."]
 */
export function chunked(input: string, chunkSize: number, suffix = ""): Array<string> {
    const output = []
    let currentChunk = ""
    for (let i = 0, chunks = 0; i < input.length; i++) {
        currentChunk += input[i]

        const posInChunk = i - (chunks * chunkSize)

        if (posInChunk === chunkSize - 1) {
            output.push(currentChunk + suffix)
            currentChunk = ""
            chunks++
        } else if (i === input.length - 1) {
            output.push(currentChunk + suffix)
        }
    }

    return output
}

// slices the input string up to and including the first
// occurrence of the string provided in `searchTerm`
// returns the whole string if it's not found
// e.g. sliceUntil("hello world", "ll") will return "hell"
export function sliceUntil(input: string, searchTerm: string) {
    let lettersMatched = 0
    let inputPointer = 0

    while (inputPointer < input.length && lettersMatched < searchTerm.length) {
        if (input[inputPointer] === searchTerm[lettersMatched]) {
            ++lettersMatched
        } else if (input[inputPointer] === searchTerm[0]) {
            lettersMatched = 1
        } else {
            lettersMatched = 0
        }

        ++inputPointer
    }

    return input.slice(0, inputPointer)
}
