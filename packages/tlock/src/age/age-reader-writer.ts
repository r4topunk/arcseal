// Vendored from tlock-js 0.9.0 (commit 17d817ee259e79381111dd75009b0f022c39ace3, MIT), src/age/age-reader-writer.ts.
// ArcSeal changes: `writeAge` returns the raw age file as bytes; `readAge` decodes base64 strictly and turns the
// payload back into bytes without Buffer.
import {binaryToBytes, concatBytes, utf8ToBytes} from "../bytes"
import {chunked, unpaddedBase64, unpaddedBase64Decode} from "./utils"
import {createMacKey} from "./utils-crypto"

type Stanza = {
    type: string,
    args: Array<string>,
    body: Uint8Array
}

type AgeEncryptionInput = {
    fileKey: Uint8Array
    version: string
    recipients: Array<Stanza>
    body: Uint8Array
    headerMacMessage: string
}

type AgeEncryptionOutput = {
    header: {
        version: string
        recipients: Array<Stanza>
        mac: Uint8Array
    }
    body: Uint8Array
}

// takes the model to be encrypted and encodes everything to bytes
// inserting newlines, other tags and the hmac as per the spec
export function writeAge(input: AgeEncryptionInput): Uint8Array {
    const headerStr = header(input)
    const macKey = mac(createMacKey(input.fileKey, input.headerMacMessage, headerStr))

    return concatBytes(utf8ToBytes(`${headerStr} ${macKey}\n`), input.body)
}

// ends with a `---`, as this is included in the header when
// calculating the MAC
export function header(input: AgeEncryptionInput): string {
    return `${input.version}\n${recipients(input.recipients)}---`
}

const recipients = (stanzas: Array<Stanza>) =>
    stanzas.map(it => recipient(it) + "\n")

const recipient = (stanza: Stanza) => {
    const type = stanza.type
    const aggregatedArgs = stanza.args.join(" ")
    const encodedBody = unpaddedBase64(stanza.body)
    const chunkedEncodedBody = chunked(encodedBody, 64).join("\n")

    return `-> ${type} ${aggregatedArgs}\n` + chunkedEncodedBody
}

// The `---` preceding the MAC is technically part of the MAC-able text
// so it's included in the header instead
const mac = (macStr: Uint8Array) => unpaddedBase64(macStr)

// parses an AGE encrypted "binary" string (one char per byte) into a model object with all the
// relevant parts encoded correctly
// throws an error if things are missing, in the wrong place or cannot
// be parsed
export function readAge(input: string): AgeEncryptionOutput {
    const [version = "", ...lines] = input.split("\n")

    const recipients = parseRecipients(lines)

    const macStartingTag = "--- "
    const macLine = lines.shift()
    if (!macLine || !macLine.startsWith(macStartingTag)) {
        throw Error("Expected mac, but there were no more lines left!")
    }

    const mac = unpaddedBase64Decode(macLine.slice(macStartingTag.length, macLine.length))

    // any remaining newlines are actually part of the payload
    const ciphertext = binaryToBytes(lines.join("\n"))

    return {
        header: {version, recipients, mac},
        body: ciphertext
    }
}

// validates the code points of the characters of the args in line with the go implementation
// see: https://github.com/FiloSottile/age/blob/8e3f74c283b2e9b3cd0ec661fa4008504e536d20/internal/format/format.go#L301
function validateArguments(args: string[]) {
    args.forEach(arg => {
        for (let i = 0; i < arg.length; i++) {
            const charCode = arg.charCodeAt(i)
            if (charCode < 33 || charCode > 126) {
                throw Error(`Invalid character ${arg[i]} in argument ${arg}`)
            }
        }
    })
}

// parses all the recipient stanzas from `lines`
// modifies `lines`!!
function parseRecipients(lines: Array<string>): Array<Stanza> {
    const recipients: Array<Stanza> = []

    for (let current = peek(lines); current != null && current.startsWith("->"); current = peek(lines)) {
        const [type = "", ...args] = current.slice(3, current.length).split(" ")
        lines.shift()

        validateArguments(args)

        const body = parseRecipientBody(lines)
        if (!body) {
            throw Error(`expected stanza '${type} to have a body, but it didn't`)
        }

        recipients.push({type, args, body: unpaddedBase64Decode(body)})
    }

    if (recipients.length === 0) {
        throw Error("Expected at least one stanza! (beginning with -->)")
    }

    return recipients
}

function parseRecipientBody(lines: Array<string>): string {
    let body = ""
    for (let next = peek(lines); next != null; next = peek(lines)) {
        body += lines.shift()

        if (next.length < 64) {
            break
        }
    }
    return body
}

function peek<T>(arr: Array<T>): T | undefined {
    return arr[0]
}
