// Resumable run state (scripts/.state/<chainId>.json, gitignored). Every step writes here before and after its
// transaction, so a re-run resumes where the last one stopped instead of repeating anything. Bigints are stored as
// decimal strings. Writes are atomic (temp file + rename).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getAddress, isAddress, isHex } from 'viem';
import { z } from 'zod';

const address = z
  .string()
  .refine((s) => isAddress(s, { strict: false }), { error: 'not an address' })
  .transform((s) => getAddress(s));
const hex32 = z.string().refine((s) => isHex(s) && s.length === 66, { error: 'not 32 bytes of hex' });
const decimal = z.string().regex(/^\d+$/, { error: 'not a decimal integer' });

/** One transaction of the run. `pending` = sent, receipt not seen yet (checked again on resume). */
export const txRecordSchema = z.object({
  label: z.string(),
  hash: hex32,
  status: z.enum(['pending', 'success']),
  blockNumber: decimal.optional(),
  gasUsed: decimal.optional(),
  /** gasUsed x effectiveGasPrice in USDC base units (6 decimals); gas is paid in USDC on Arc. */
  costUsdc: decimal.optional(),
});
export type TxRecord = z.output<typeof txRecordSchema>;

/** A sealed ballot, stored before its `vote` transaction is sent (the local receipt of PRD 6). */
export const ballotSchema = z.object({
  voter: address,
  choice: z.enum(['abstain', 'for', 'against']),
  salt: hex32,
  commitment: hex32,
  ciphertext: z.string().refine((s) => isHex(s), { error: 'not hex' }),
  closeRound: decimal,
});
export type Ballot = z.output<typeof ballotSchema>;

export const stateSchema = z.object({
  version: z.literal(1),
  chainId: z.number().int(),
  dao: address,
  /** Correlation id of this run: printed, written into the proposal description and the SDK log lines. */
  runTag: z.string().min(1),
  startedAt: z.string(),
  /** Member index ("1".."3") to address, filled when a signer is first loaded. */
  members: z.record(z.string(), address).default({}),
  /** Block before the propose transaction: where a resumed run looks for its ProposalCreated event. */
  proposeFromBlock: decimal.optional(),
  proposal: z
    .object({
      id: decimal,
      closeRound: decimal,
      revealEndRound: decimal,
      block: decimal,
      target: address,
      amount: decimal,
    })
    .optional(),
  /** Member index to sealed ballot. */
  ballots: z.record(z.string(), ballotSchema).default({}),
  /** Step key (for example "transferVotes.2") to transaction. */
  txs: z.record(z.string(), txRecordSchema).default({}),
  completedAt: z.string().optional(),
});
export type RunState = z.output<typeof stateSchema>;

/** Loads, updates and atomically saves one state file. */
export class StateStore {
  private constructor(
    readonly file: string,
    private state: RunState,
  ) {}

  /** Opens `file`, or starts a fresh state from `init()` when it does not exist. */
  static open(file: string, init: () => RunState): StateStore {
    if (!existsSync(file)) {
      const store = new StateStore(file, stateSchema.parse(init()));
      store.save();
      return store;
    }
    const parsed = stateSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`state file ${file} is not valid (${issues}); move it away to start a new run`);
    }
    return new StateStore(file, parsed.data);
  }

  get(): Readonly<RunState> {
    return this.state;
  }

  /** Applies `fn` to a copy of the state, validates it and writes it to disk before returning. */
  update(fn: (draft: RunState) => void): Readonly<RunState> {
    const draft = structuredClone(this.state);
    fn(draft);
    this.state = stateSchema.parse(draft);
    this.save();
    return this.state;
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`);
    renameSync(tmp, this.file);
  }
}

/** Fresh state for a run against `dao` on `chainId`. */
export function newState(chainId: number, dao: string, runTag: string): RunState {
  return stateSchema.parse({
    version: 1,
    chainId,
    dao,
    runTag,
    startedAt: new Date().toISOString(),
    members: {},
    ballots: {},
    txs: {},
  });
}
