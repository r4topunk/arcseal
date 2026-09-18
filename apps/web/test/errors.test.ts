import {
  ContractRevertError,
  DrandFetchError,
  InvalidBeaconError,
  InvalidInputError,
  ProposalNotFoundError,
  roundTime,
  sealedDaoAbi,
} from '@arcseal/sdk';
import {
  ContractFunctionRevertedError,
  encodeErrorResult,
  HttpRequestError,
  InsufficientFundsError,
  UserRejectedRequestError,
} from 'viem';
import { describe, expect, it } from 'vitest';
import { CONTRACT_ERROR_KEYS, describeError, errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { MESSAGES } from '@/lib/i18n';

const abiErrors = sealedDaoAbi.filter((x) => x.type === 'error').map((x) => x.name);
const revert = (name: string, args: unknown[] = []) => new ContractRevertError('fn', name, args);

describe('contract error mapping', () => {
  it('maps every custom error in the SealedDAO ABI (PRD 4.4 and the extra ones) to its own sentence', () => {
    expect(abiErrors.length).toBeGreaterThanOrEqual(33);
    for (const name of abiErrors) {
      const d = describeError(revert(name));
      expect(d.key, name).toBe(CONTRACT_ERROR_KEYS[name as keyof typeof CONTRACT_ERROR_KEYS]);
      expect(MESSAGES.en[d.key].length, name).toBeGreaterThan(10);
      expect(MESSAGES['pt-BR'][d.key], name).not.toBe(MESSAGES.en[d.key]);
    }
  });

  it('writes the same revert in English and Portuguese', () => {
    expect(errorMessage(revert('NotMember'), 'en')).toBe(
      'Only members can do this, and the connected wallet is not a member.',
    );
    expect(errorMessage(revert('NotMember'), 'pt-BR')).toBe(
      'Só membros podem fazer isto, e a carteira conectada não é membro.',
    );
    expect(errorMessage(revert('SealingClosed'), 'en')).toBe('Voting is closed for this proposal.');
    expect(errorMessage(revert('SealingClosed'), 'pt-BR')).toBe('A votação desta proposta está fechada.');
  });

  it('decodes a raw viem revert with SealedDAO error data', () => {
    const data = encodeErrorResult({ abi: sealedDaoAbi, errorName: 'AlreadySealed' });
    const err = new ContractFunctionRevertedError({ abi: sealedDaoAbi, data, functionName: 'vote' });
    expect(describeError(err, 'vote').key).toBe('error.contract.AlreadySealed');
  });

  it('maps the USDC blocklist string bubbled by claim, and other revert strings', () => {
    const blocked = revert('Error', ['Blacklistable: account is blacklisted']);
    expect(errorMessage(blocked, 'en')).toContain('blocks this address');
    expect(errorMessage(blocked, 'pt-BR')).toContain('bloqueia este endereço');
    expect(describeError(revert('Error', ['ERC20: transfer amount exceeds balance'])).key).toBe(
      'error.usdc.balance',
    );
    expect(errorMessage(revert('Error', ['weird']), 'en')).toBe('The transaction would revert: weird');
    expect(errorMessage(revert('Panic', [17n]), 'en')).toContain('panic code 17');
    expect(describeError(revert('Unknown')).key).toBe('error.unknownRevert');
  });
});

describe('wallet, network and SDK errors', () => {
  it('maps a wallet rejection (viem error or raw EIP-1193 4001) in both languages', () => {
    const viemErr = new UserRejectedRequestError(new Error('User rejected the request.'));
    expect(errorMessage(viemErr, 'en')).toBe('You rejected the request in your wallet.');
    expect(errorMessage(viemErr, 'pt-BR')).toBe('Você recusou o pedido na sua carteira.');
    expect(describeError({ code: 4001, message: 'denied' }).key).toBe('error.wallet.rejected');
  });

  it('maps gas shortfalls and an unreachable RPC', () => {
    expect(describeError(new InsufficientFundsError()).key).toBe('error.wallet.insufficientFunds');
    expect(describeError(new HttpRequestError({ url: 'https://rpc.mainnet.arc.io' })).key).toBe(
      'error.rpc.unreachable',
    );
    expect(describeError(new TypeError('Failed to fetch')).key).toBe('error.rpc.unreachable');
  });

  it('explains a drand round that is not published yet with its wall-clock time', () => {
    const round = 32_000_000n;
    const msg = errorMessage(new DrandFetchError(round, [], true), 'en');
    expect(msg).toContain('32000000');
    expect(msg).toContain(formatDateTime(roundTime(round), 'en'));
    expect(describeError(new DrandFetchError(round, [{ url: 'x', error: 'timeout' }], false)).key).toBe(
      'error.drand.unreachable',
    );
  });

  it('maps the SDK error codes', () => {
    expect(describeError(new InvalidBeaconError(1n, 'bad')).key).toBe('error.drand.invalidBeacon');
    expect(describeError(new ProposalNotFoundError(9n)).key).toBe('error.proposalNotFound');
    const input = new InvalidInputError('x', ['salt: too short']);
    expect(errorMessage(input, 'en')).toBe('Invalid input: salt: too short');
  });
});
