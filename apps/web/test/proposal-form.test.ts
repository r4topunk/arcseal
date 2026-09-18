import { describe, expect, it } from 'vitest';
import { EMPTY_FORM, isLinkableUri, type ProposalFormInput, validateProposalForm } from '@/lib/proposal-form';

const ALICE = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const valid: ProposalFormInput = {
  ...EMPTY_FORM,
  kind: 'TransferUSDC',
  target: ALICE.toLowerCase(),
  amount: '1.5',
  description: 'Pay 1.5 USDC to Alice',
  votingSeconds: 600,
};

const errorsOf = (input: Partial<ProposalFormInput>) => {
  const r = validateProposalForm({ ...valid, ...input });
  return r.ok ? {} : r.errors;
};

describe('targets the contract refuses (audit F6) and the link bound (audit F8)', () => {
  const DAO = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  const USDC = '0x3600000000000000000000000000000000000000';

  it('refuses the DAO itself and its USDC token as a target, for both kinds', () => {
    for (const target of [DAO, DAO.toLowerCase(), USDC]) {
      for (const kind of ['TransferUSDC', 'SetMember'] as const) {
        const r = validateProposalForm({ ...valid, kind, target }, [DAO, USDC]);
        expect(r.ok ? {} : r.errors, `${kind} ${target}`).toEqual({
          target: { key: 'form.error.targetSelf' },
        });
      }
    }
    expect(validateProposalForm({ ...valid, target: ALICE }, [DAO, USDC]).ok).toBe(true);
  });

  it('bounds the link in UTF-8 bytes, like the contract', () => {
    const uri = (bytes: number) => `https://${'a'.repeat(bytes - 8)}`;
    expect(errorsOf({ descriptionURI: uri(2_048) })).toEqual({});
    expect(errorsOf({ descriptionURI: uri(2_049) })).toEqual({
      descriptionURI: { key: 'form.error.uriTooLong' },
    });
    // 1,021 two-byte characters: 1,029 characters but 2,050 bytes
    expect(errorsOf({ descriptionURI: `https://${'é'.repeat(1_021)}` })).toEqual({
      descriptionURI: { key: 'form.error.uriTooLong' },
    });
  });

  it('links only https://, http:// and ipfs:// URIs read from the chain', () => {
    for (const ok of ['https://example.org/p/1', 'http://example.org', 'ipfs://bafy', ' https://x.io '])
      expect(isLinkableUri(ok), ok).toBe(true);
    for (const bad of [
      'javascript:alert(document.domain)//',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example',
      'https://',
      '',
    ])
      expect(isLinkableUri(bad), bad).toBe(false);
  });
});

describe('validateProposalForm', () => {
  it('returns the exact propose arguments for a valid transfer', () => {
    const r = validateProposalForm(valid);
    expect(r).toEqual({
      ok: true,
      value: {
        kind: 'TransferUSDC',
        target: ALICE,
        amount: 1_500_000n,
        flag: false,
        description: 'Pay 1.5 USDC to Alice',
        descriptionURI: '',
        votingSeconds: 600,
      },
    });
  });

  it('accepts SetMember without an amount and maps add/remove to the flag', () => {
    const add = validateProposalForm({ ...valid, kind: 'SetMember', amount: '', flag: 'add' });
    const remove = validateProposalForm({ ...valid, kind: 'SetMember', amount: 'garbage', flag: 'remove' });
    expect(add.ok && add.value.flag).toBe(true);
    expect(add.ok && add.value.amount).toBe(0n);
    expect(remove.ok && remove.value.flag).toBe(false);
  });

  it('rejects a missing, malformed, badly checksummed or zero target', () => {
    expect(errorsOf({ target: ' ' }).target?.key).toBe('form.error.targetRequired');
    expect(errorsOf({ target: '0x1234' }).target?.key).toBe('form.error.targetInvalid');
    // Mixed case with one flipped letter: fails EIP-55.
    expect(errorsOf({ target: ALICE.replace('C51812dc', 'C51812Dc') }).target?.key).toBe(
      'form.error.targetInvalid',
    );
    expect(errorsOf({ target: `0x${'0'.repeat(40)}` }).target?.key).toBe('form.error.targetZero');
  });

  it('rejects zero, over-precise and comma amounts for a transfer', () => {
    expect(errorsOf({ amount: '0' }).amount?.key).toBe('form.error.amount.zero');
    expect(errorsOf({ amount: '' }).amount?.key).toBe('form.error.amount.empty');
    expect(errorsOf({ amount: '0.0000001' }).amount?.key).toBe('form.error.amount.decimals');
    expect(errorsOf({ amount: '1,5' }).amount?.key).toBe('form.error.amount.comma');
  });

  it('limits the description to 256 UTF-8 bytes, not characters', () => {
    expect(errorsOf({ description: '   ' }).description?.key).toBe('form.error.descriptionEmpty');
    expect(errorsOf({ description: 'a'.repeat(256) }).description).toBeUndefined();
    // 129 two-byte characters = 258 bytes, although only 129 characters.
    const tooLong = errorsOf({ description: 'é'.repeat(129) }).description;
    expect(tooLong).toEqual({ key: 'form.error.descriptionTooLong', vars: { bytes: 258 } });
  });

  it('accepts an empty, https or ipfs link and rejects anything else', () => {
    expect(errorsOf({ descriptionURI: '' }).descriptionURI).toBeUndefined();
    expect(errorsOf({ descriptionURI: 'https://example.org/p/1' }).descriptionURI).toBeUndefined();
    expect(errorsOf({ descriptionURI: 'ipfs://bafybeigdyrzt' }).descriptionURI).toBeUndefined();
    expect(errorsOf({ descriptionURI: 'javascript:alert(1)' }).descriptionURI?.key).toBe(
      'form.error.uriInvalid',
    );
    expect(errorsOf({ descriptionURI: 'not a url' }).descriptionURI?.key).toBe('form.error.uriInvalid');
  });

  it('only accepts the four duration presets', () => {
    for (const s of [600, 3_600, 86_400, 604_800])
      expect(errorsOf({ votingSeconds: s }).votingSeconds).toBeUndefined();
    expect(errorsOf({ votingSeconds: 599 }).votingSeconds?.key).toBe('form.error.duration');
    expect(errorsOf({ votingSeconds: 1_000 }).votingSeconds?.key).toBe('form.error.duration');
  });

  it('reports every invalid field at once', () => {
    const r = validateProposalForm({ ...EMPTY_FORM });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['amount', 'description', 'target']);
  });
});
