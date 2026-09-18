// Create-proposal form validation (PRD 6 page 4). Mirrors what SealedDAO.propose checks (BadTarget, BadAmount,
// DescriptionTooLong, DescriptionURITooLong, BadDuration) so the user sees an inline error instead of a revert, plus
// UI-only rules (a description is required, the link must be an https://, http:// or ipfs:// URL). Messages are i18n
// keys.
import type { ActionKind } from '@arcseal/sdk';
import { type Address, getAddress, isAddress, zeroAddress } from 'viem';
import { z } from 'zod';
import { parseUsdc, utf8Length } from './format';
import type { MessageKey, Vars } from './i18n';

export const DURATION_PRESETS = [600, 3_600, 86_400, 604_800] as const;
export type DurationPreset = (typeof DURATION_PRESETS)[number];
export const MAX_DESCRIPTION_BYTES = 256;
/** SealedDAO.MAX_DESCRIPTION_URI_LENGTH, in UTF-8 bytes. */
export const MAX_URI_BYTES = 2_048;
const LINKABLE_URI = /^(https?:\/\/[^\s/$.?#][^\s]*|ipfs:\/\/[^\s]+)$/i;

/**
 * Whether a descriptionURI may be rendered as a link: https://, http:// or ipfs:// only. The contract stores any
 * scheme (only the length is bounded), and a proposal can be created without this form, so every link the app renders
 * from chain data goes through this check (audit F8: no javascript:, data: or other schemes).
 */
export function isLinkableUri(uri: string): boolean {
  return LINKABLE_URI.test(uri.trim());
}

export interface ProposalFormInput {
  kind: ActionKind;
  target: string;
  /** USDC as typed, for TransferUSDC. */
  amount: string;
  /** SetMember: add or remove. */
  flag: 'add' | 'remove';
  description: string;
  descriptionURI: string;
  votingSeconds: number;
}

export interface ProposalParams {
  kind: ActionKind;
  target: Address;
  amount: bigint;
  flag: boolean;
  description: string;
  descriptionURI: string;
  votingSeconds: DurationPreset;
}

export type FormField = 'target' | 'amount' | 'description' | 'descriptionURI' | 'votingSeconds';
export type FormErrors = Partial<Record<FormField, { key: MessageKey; vars?: Vars }>>;

const shape = z.object({
  kind: z.enum(['TransferUSDC', 'SetMember']),
  target: z.string(),
  amount: z.string(),
  flag: z.enum(['add', 'remove']),
  description: z.string(),
  descriptionURI: z.string(),
  votingSeconds: z.number(),
});

export const EMPTY_FORM: ProposalFormInput = {
  kind: 'TransferUSDC',
  target: '',
  amount: '',
  flag: 'add',
  description: '',
  descriptionURI: '',
  votingSeconds: 3_600,
};

/**
 * Validates the form. Returns the exact `propose` arguments, or one error per invalid field. `forbiddenTargets` are
 * addresses the contract refuses as a target besides zero: the DAO itself and its USDC token (BadTarget).
 */
export function validateProposalForm(
  input: ProposalFormInput,
  forbiddenTargets: readonly string[] = [],
): { ok: true; value: ProposalParams } | { ok: false; errors: FormErrors } {
  const parsed = shape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { target: { key: 'form.error.targetRequired' } } };
  const f = parsed.data;
  const errors: FormErrors = {};

  const target = f.target.trim();
  if (target === '') errors.target = { key: 'form.error.targetRequired' };
  else if (!isAddress(target)) errors.target = { key: 'form.error.targetInvalid' };
  else if (target.toLowerCase() === zeroAddress) errors.target = { key: 'form.error.targetZero' };
  else if (forbiddenTargets.some((a) => a.toLowerCase() === target.toLowerCase()))
    errors.target = { key: 'form.error.targetSelf' };

  let amount = 0n;
  if (f.kind === 'TransferUSDC') {
    const r = parseUsdc(f.amount);
    if (!r.ok) errors.amount = { key: `form.error.amount.${r.error}` };
    else if (r.value === 0n) errors.amount = { key: 'form.error.amount.zero' };
    else amount = r.value;
  }

  const description = f.description.trim();
  const bytes = utf8Length(description);
  if (description === '') errors.description = { key: 'form.error.descriptionEmpty' };
  else if (bytes > MAX_DESCRIPTION_BYTES)
    errors.description = { key: 'form.error.descriptionTooLong', vars: { bytes } };

  const uri = f.descriptionURI.trim();
  if (uri !== '') {
    if (utf8Length(uri) > MAX_URI_BYTES) errors.descriptionURI = { key: 'form.error.uriTooLong' };
    else if (!isLinkableUri(uri)) errors.descriptionURI = { key: 'form.error.uriInvalid' };
  }

  if (!(DURATION_PRESETS as readonly number[]).includes(f.votingSeconds))
    errors.votingSeconds = { key: 'form.error.duration' };

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      kind: f.kind,
      target: getAddress(target),
      amount,
      flag: f.kind === 'SetMember' ? f.flag === 'add' : false,
      description,
      descriptionURI: uri,
      votingSeconds: f.votingSeconds as DurationPreset,
    },
  };
}
