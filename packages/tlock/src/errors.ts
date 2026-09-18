export type TlockErrorCode =
  /** A caller argument has the wrong type or range (round, plaintext, ciphertext or beacon shape). */
  | 'INVALID_INPUT'
  /** The bytes are not an age v1 file with one well-formed quicknet tlock stanza. */
  | 'MALFORMED_CIPHERTEXT'
  /** The tlock stanza names a drand chain other than quicknet. */
  | 'WRONG_CHAIN'
  /** The beacon is for a different round than the one the ciphertext is locked to. */
  | 'ROUND_MISMATCH'
  /** The beacon signature does not open the stanza: not quicknet's signature for that round, or a tampered stanza. */
  | 'WRONG_BEACON'
  /** The file key was recovered but the header MAC or the payload failed authentication (tampered or truncated). */
  | 'DECRYPTION_FAILED';

/** Every error thrown by this package. Switch on `code`, not on the message. */
export class TlockError extends Error {
  readonly code: TlockErrorCode;
  constructor(code: TlockErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TlockError';
    this.code = code;
  }
}

/** True for a TlockError, also across duplicated module instances where `instanceof` fails. */
export function isTlockError(err: unknown): err is TlockError {
  return err instanceof TlockError || (err instanceof Error && err.name === 'TlockError' && 'code' in err);
}
