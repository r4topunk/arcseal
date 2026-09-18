/**
 * Uint8Array helpers that replace every Node `Buffer` call in the vendored tlock-js code, so the package runs in
 * browsers without a Buffer polyfill (PRD 14, README "Browser support"). Only web-platform globals are used
 * (`btoa`, `atob`, `DataView`), which Node 22 also provides.
 */
export { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

const CHUNK = 0x8000;
const UNPADDED_BASE64 = /^[A-Za-z0-9+/]*$/;

/** Bytes to a "binary" string (one char per byte, code 0-255): what upstream got from `buf.toString('binary')`. */
export function bytesToBinary(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/** Inverse of `bytesToBinary`, same as `Buffer.from(s, 'binary')` (keeps the low byte of each char code). */
export function binaryToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** RFC 4648 section 4 base64 without `=` padding, as age uses in stanza bodies and the header MAC. */
export function base64EncodeUnpadded(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes)).replace(/=+$/, '');
}

/**
 * Strict unpadded base64 decoder. Rejects padding, whitespace, foreign characters and non-canonical trailing bits,
 * matching Go's `base64.RawStdEncoding.Strict()` used by age (Buffer's decoder silently skipped bad input).
 */
export function base64DecodeUnpadded(s: string): Uint8Array {
  if (!UNPADDED_BASE64.test(s) || s.length % 4 === 1) throw new Error('invalid unpadded base64');
  const bytes = binaryToBytes(atob(s));
  if (base64EncodeUnpadded(bytes) !== s) throw new Error('non-canonical base64');
  return bytes;
}

/** Big-endian unsigned 64-bit encoding (replaces `Buffer.writeBigUInt64BE`). */
export function uint64BE(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, false);
  return out;
}
