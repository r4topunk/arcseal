// Every error the app can hit, mapped to one plain sentence in the active language: SealedDAO custom errors (PRD 4.4
// plus the extra ones in the ABI), USDC revert strings, wallet rejection, RPC failures and the SDK's own errors.
import {
  ArcSealError,
  ContractRevertError,
  DrandFetchError,
  InvalidInputError,
  roundTime,
  type SealedDaoErrorName,
  toContractRevertError,
} from '@arcseal/sdk';
import {
  BaseError,
  ChainMismatchError,
  HttpRequestError,
  InsufficientFundsError,
  TimeoutError,
  UserRejectedRequestError,
} from 'viem';
import { config } from './config';
import { formatDateTime } from './format';
import { type Locale, type MessageKey, translate, type Vars } from './i18n';

/** Every custom error of the SealedDAO ABI, with its message key. Typed, so a new ABI error fails typecheck here. */
export const CONTRACT_ERROR_KEYS: Record<SealedDaoErrorName, MessageKey> = {
  AlreadyExecuted: 'error.contract.AlreadyExecuted',
  AlreadyFinalized: 'error.contract.AlreadyFinalized',
  AlreadySealed: 'error.contract.AlreadySealed',
  BadAmount: 'error.contract.BadAmount',
  BadCiphertextLength: 'error.contract.BadCiphertextLength',
  BadCommitment: 'error.contract.BadCommitment',
  BadDuration: 'error.contract.BadDuration',
  BadMember: 'error.contract.BadMember',
  BadQuorum: 'error.contract.BadQuorum',
  BadReveal: 'error.contract.BadReveal',
  BadTarget: 'error.contract.BadTarget',
  BadUSDC: 'error.contract.BadUSDC',
  DescriptionTooLong: 'error.contract.DescriptionTooLong',
  DescriptionURITooLong: 'error.contract.DescriptionURITooLong',
  DuplicateMember: 'error.contract.DuplicateMember',
  Expired: 'error.contract.Expired',
  GroupAlreadyOpen: 'error.contract.GroupAlreadyOpen',
  InsufficientTreasury: 'error.contract.InsufficientTreasury',
  LastMember: 'error.contract.LastMember',
  LengthMismatch: 'error.contract.LengthMismatch',
  NoMembers: 'error.contract.NoMembers',
  NoOp: 'error.contract.NoOp',
  NotMember: 'error.contract.NotMember',
  NotPassed: 'error.contract.NotPassed',
  NotReady: 'error.contract.NotReady',
  NothingSealed: 'error.contract.NothingSealed',
  NothingToClaim: 'error.contract.NothingToClaim',
  Reentrancy: 'error.contract.Reentrancy',
  RevealClosed: 'error.contract.RevealClosed',
  RevealNotOpen: 'error.contract.RevealNotOpen',
  RoundOverflow: 'error.contract.RoundOverflow',
  SealingClosed: 'error.contract.SealingClosed',
  TooManyItems: 'error.contract.TooManyItems',
  TransferFailed: 'error.contract.TransferFailed',
  UnknownProposal: 'error.contract.UnknownProposal',
};

export interface ErrorDescription {
  key: MessageKey;
  vars?: Vars;
}

/** FiatToken (USDC) revert strings to messages. */
function describeRevertString(reason: string): ErrorDescription {
  const r = reason.toLowerCase();
  if (r.includes('blacklisted') || r.includes('blocklisted')) return { key: 'error.usdc.blocklisted' };
  if (r.includes('exceeds balance')) return { key: 'error.usdc.balance' };
  if (r.includes('paused')) return { key: 'error.usdc.paused' };
  return { key: 'error.revertReason', vars: { reason } };
}

function describeRevert(err: ContractRevertError): ErrorDescription {
  const key = CONTRACT_ERROR_KEYS[err.errorName as SealedDaoErrorName];
  if (key) return { key };
  if (err.errorName === 'Error') return describeRevertString(String(err.args[0] ?? ''));
  if (err.errorName === 'Panic') return { key: 'error.panic', vars: { code: String(err.args[0] ?? '?') } };
  return { key: 'error.unknownRevert' };
}

const REJECTED = /user rejected|user denied|rejected the request|request rejected|denied transaction/i;
const UNREACHABLE = /http request failed|fetch failed|failed to fetch|networkerror|timed? ?out|load failed/i;

/** Classifies any thrown value. `functionName` labels contract reverts that were not decoded yet. */
export function describeError(err: unknown, functionName = 'call'): ErrorDescription {
  const e = toContractRevertError(err, functionName);
  if (e instanceof ContractRevertError) return describeRevert(e);
  if (e instanceof DrandFetchError) {
    if (e.early) return { key: 'error.drand.early', vars: { round: e.round.toString(), time: '' } };
    return { key: 'error.drand.unreachable' };
  }
  if (e instanceof InvalidInputError)
    return { key: 'error.invalidInput', vars: { details: e.issues.join('; ') } };
  if (e instanceof ArcSealError) {
    switch (e.code) {
      case 'INVALID_BEACON':
        return { key: 'error.drand.invalidBeacon' };
      case 'WALLET_REQUIRED':
        return { key: 'error.wallet.notConnected' };
      case 'PROPOSAL_NOT_FOUND':
        return { key: 'error.proposalNotFound' };
      case 'TX_REVERTED':
        return { key: 'error.txReverted' };
      case 'EVENT_NOT_FOUND':
        return { key: 'error.eventNotFound' };
      default:
        return { key: 'error.generic', vars: { message: e.message } };
    }
  }
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return { key: 'error.wallet.rejected' };
    if (e.walk((x) => x instanceof InsufficientFundsError)) return { key: 'error.wallet.insufficientFunds' };
    if (e.walk((x) => x instanceof ChainMismatchError))
      return { key: 'error.wallet.wrongChain', vars: { chain: config.chainLabel, chainId: config.chainId } };
    if (e.walk((x) => x instanceof HttpRequestError || x instanceof TimeoutError))
      return { key: 'error.rpc.unreachable' };
    const msg = `${e.shortMessage} ${e.message}`;
    if (REJECTED.test(msg)) return { key: 'error.wallet.rejected' };
    if (UNREACHABLE.test(msg)) return { key: 'error.rpc.unreachable' };
    return { key: 'error.generic', vars: { message: e.shortMessage || e.message } };
  }
  // wagmi throws its own BaseError (not viem's) for connector state.
  if (err instanceof Error && /^Connector(NotConnected|AccountNotFound)Error$/.test(err.name))
    return { key: 'error.wallet.notConnected' };
  // A raw EIP-1193 error object from an injected wallet.
  if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 4001)
    return { key: 'error.wallet.rejected' };
  if (err instanceof Error) {
    if (REJECTED.test(err.message)) return { key: 'error.wallet.rejected' };
    if (err.name === 'ProviderNotFoundError' || /provider not found/i.test(err.message))
      return { key: 'wallet.noProvider' };
    if (UNREACHABLE.test(err.message)) return { key: 'error.rpc.unreachable' };
    return { key: 'error.generic', vars: { message: err.message } };
  }
  return { key: 'error.generic', vars: { message: String(err) } };
}

/** One sentence for `err` in `locale`. drand "too early" errors name the wall-clock time the round is published. */
export function errorMessage(err: unknown, locale: Locale, functionName?: string): string {
  const d = describeError(err, functionName);
  if (d.key === 'error.drand.early' && err instanceof DrandFetchError) {
    return translate(locale, d.key, {
      round: err.round.toString(),
      time: formatDateTime(roundTime(err.round), locale),
    });
  }
  return translate(locale, d.key, d.vars);
}
