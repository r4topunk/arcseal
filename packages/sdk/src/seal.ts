// Vote commitment codec (PRD D11) and tlock sealing (PRD 5). The hash is the authority onchain: SealedDAO.hashVote
// must return exactly hashVote() for every input (checked by contracts/test/vectors/hashvote.json and the Foundry FFI
// test). The ciphertext is only a delivery vehicle: whatever it decrypts to must still match the commitment.
import { decrypt, encrypt, isTlockError, roundOf } from '@arcseal/tlock';
import { bytesToHex, encodeAbiParameters, type Hex, hexToBytes, isHex, keccak256 } from 'viem';
import { type GetBeaconOptions, getBeacon } from './drand.js';
import {
  type Beacon,
  CHOICES,
  type Choice,
  choiceSchema,
  type HashVoteInput,
  hashVoteInputSchema,
  parseInput,
  SALT_BYTES,
  type SealVoteInput,
  saltSchema,
  sealVoteInputSchema,
  type UnsealVoteInput,
  unsealVoteInputSchema,
} from './schemas.js';

/** uint8 value of a Choice in the Solidity enum. */
export type ChoiceIndex = 0 | 1 | 2;

/** Byte length of a vote plaintext: `abi.encode(uint8 choice, bytes32 salt)`. */
export const VOTE_PLAINTEXT_BYTES = 64;

const HASH_VOTE_PARAMS = [
  { name: 'proposalId', type: 'uint256' },
  { name: 'voter', type: 'address' },
  { name: 'choice', type: 'uint8' },
  { name: 'salt', type: 'bytes32' },
] as const;

const PLAINTEXT_PARAMS = [
  { name: 'choice', type: 'uint8' },
  { name: 'salt', type: 'bytes32' },
] as const;

/** A decoded vote plaintext. */
export interface VotePlaintext {
  choice: Choice;
  salt: Hex;
}

/** Output of `sealVote`: send `commitment` and `ciphertext` to `vote`; keep `salt` in the local receipt. */
export interface SealedVote {
  commitment: Hex;
  ciphertext: Hex;
  salt: Hex;
  plaintext: Hex;
}

/** 'abstain' -> 0, 'for' -> 1, 'against' -> 2. */
export function choiceToIndex(choice: Choice): ChoiceIndex {
  return CHOICES.indexOf(parseInput(choiceSchema, choice, 'choice')) as ChoiceIndex;
}

/** 0 -> 'abstain', 1 -> 'for', 2 -> 'against'. Throws RangeError for anything else. */
export function choiceFromIndex(index: number | bigint): Choice {
  const i = typeof index === 'bigint' ? index : Number.isInteger(index) ? BigInt(index) : -1n;
  if (i < 0n || i > 2n) {
    throw new RangeError(`choice index must be 0 (abstain), 1 (for) or 2 (against), got ${index}`);
  }
  return CHOICES[Number(i)]!;
}

/** Fresh 32-byte salt from the platform CSPRNG (`crypto.getRandomValues`), as 0x-hex. */
export function generateSalt(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

/**
 * Vote commitment: `keccak256(abi.encode(uint256 proposalId, address voter, uint8 choice, bytes32 salt))`.
 * Binding proposalId and voter prevents replaying a reveal across proposals or voters.
 */
export function hashVote(input: HashVoteInput): Hex {
  const { proposalId, voter, choice, salt } = parseInput(hashVoteInputSchema, input, 'hashVote input');
  return keccak256(encodeAbiParameters(HASH_VOTE_PARAMS, [proposalId, voter, choiceToIndex(choice), salt]));
}

/** Plaintext sealed for the close round: `abi.encode(uint8 choice, bytes32 salt)`, 64 bytes. */
export function encodeVotePlaintext(choice: Choice, salt: Hex): Hex {
  const index = choiceToIndex(choice);
  return encodeAbiParameters(PLAINTEXT_PARAMS, [index, parseInput(saltSchema, salt, 'salt')]);
}

/**
 * Inverse of `encodeVotePlaintext`. Returns null unless the input is exactly 64 bytes, the first word is a clean
 * uint8 (31 zero bytes, as `abi.decode` requires) and the choice is 0..2. An all-zero plaintext decodes to abstain.
 */
export function decodeVotePlaintext(plaintext: Hex | Uint8Array): VotePlaintext | null {
  const bytes = plaintextBytes(plaintext);
  if (bytes?.length !== VOTE_PLAINTEXT_BYTES) return null;
  for (let i = 0; i < 31; i++) if (bytes[i] !== 0) return null;
  const index = bytes[31]!;
  if (index > 2) return null;
  return { choice: CHOICES[index]!, salt: bytesToHex(bytes.subarray(32)) };
}

function plaintextBytes(value: Hex | Uint8Array): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== 'string' || !isHex(value, { strict: true }) || value.length % 2 !== 0) return null;
  return hexToBytes(value);
}

/**
 * Seals a vote to `closeRound`: plaintext = `encodeVotePlaintext(choice, salt)` (64 bytes), ciphertext = raw tlock
 * output for that round (423 bytes, not armored), commitment = `hashVote(...)`. Without `salt`, a fresh 32-byte CSPRNG
 * salt is drawn. Send `commitment` and `ciphertext` to `vote`; keep `salt` and `choice` in the local receipt.
 */
export async function sealVote(input: SealVoteInput): Promise<SealedVote> {
  const { proposalId, voter, choice, closeRound, salt } = parseInput(
    sealVoteInputSchema,
    input,
    'sealVote input',
  );
  const voteSalt = salt ?? generateSalt();
  const plaintext = encodeVotePlaintext(choice, voteSalt);
  const ciphertext = bytesToHex(await encrypt(closeRound, hexToBytes(plaintext)));
  const commitment = hashVote({ proposalId, voter, choice, salt: voteSalt });
  return { commitment, ciphertext, salt: voteSalt, plaintext };
}

/** Options of `unsealVote`, used only when no beacon is passed and it is fetched from drand. */
export type UnsealVoteOptions = GetBeaconOptions;

/**
 * Opens a sealed vote once `closeRound` is published. Resolves null when the ciphertext is not a tlock ciphertext
 * locked to `closeRound` (garbage, truncated, another round), when the beacon is wrong or for another round, when
 * decryption fails, and when the plaintext is not a 64-byte `abi.encode(uint8 choice <= 2, bytes32 salt)`.
 *
 * Without `beacon`, the beacon for `closeRound` is fetched with `getBeacon` (after the round check, so a hostile
 * ciphertext never picks the round that is fetched); a drand outage then throws `DrandFetchError`, not null.
 * A non-null result is only a candidate: the reveal counts only if `hashVote` of it equals the onchain commitment.
 */
export async function unsealVote(
  input: UnsealVoteInput,
  options: UnsealVoteOptions = {},
): Promise<VotePlaintext | null> {
  const { ciphertext, closeRound, beacon } = parseInput(unsealVoteInputSchema, input, 'unsealVote input');
  const bytes = hexToBytes(ciphertext);
  if (lockedRound(bytes) !== closeRound) return null;
  if (beacon && beacon.round !== closeRound) return null;
  return openSealedVote(bytes, beacon ?? (await getBeacon(closeRound, options)));
}

/**
 * The round a raw tlock ciphertext is locked to, or null when the bytes are not a quicknet tlock age file.
 * Internal helper shared with unsealProposal.
 */
export function lockedRound(ciphertext: Uint8Array): bigint | null {
  try {
    return roundOf(ciphertext);
  } catch (err) {
    if (isTlockError(err)) return null;
    throw err;
  }
}

/** Decrypts and decodes one vote with a known beacon; null on any tlock failure or bad plaintext. Internal helper. */
export async function openSealedVote(ciphertext: Uint8Array, beacon: Beacon): Promise<VotePlaintext | null> {
  let plaintext: Uint8Array;
  try {
    plaintext = await decrypt(ciphertext, beacon);
  } catch (err) {
    if (isTlockError(err)) return null;
    throw err;
  }
  return decodeVotePlaintext(plaintext);
}
