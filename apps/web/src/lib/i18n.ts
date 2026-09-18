// UI strings in English (source of truth) and Brazilian Portuguese. PT-BR is typed against the EN keys, so a missing
// translation fails typecheck, and test/i18n.test.ts checks keys and placeholders at runtime too.
// Placeholders are {name}; `translate` fills them.

export const LOCALES = ['en', 'pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

const en = {
  'app.name': 'ArcSeal',
  'app.tagline': 'Sealed voting on Arc',

  'nav.main': 'Main',
  'nav.skip': 'Skip to content',
  'nav.proposals': 'Proposals',
  'nav.new': 'New proposal',
  'nav.treasury': 'Treasury',
  'nav.docs': 'Docs',
  'nav.project': 'Project page',
  'nav.github': 'GitHub',
  'nav.home': 'ArcSeal home',

  'locale.label': 'Language',
  'locale.en': 'EN',
  'locale.pt-BR': 'PT-BR',

  'wallet.connect': 'Connect wallet',
  'wallet.connecting': 'Connecting…',
  'wallet.disconnect': 'Disconnect wallet',
  'wallet.loading': 'Loading wallet state',
  'wallet.noProvider': 'No browser wallet found. Install an EVM wallet extension to continue.',
  'wallet.switch': 'Switch to {chain}',
  'wallet.connected': 'Connected as {address}',
  'wallet.you': 'you',

  'banner.wrongNetwork': 'Your wallet is on chain {current}. This app runs on {chain} (chain {chainId}).',
  'banner.switch': 'Switch network',
  'banner.config': 'Build configuration problem:',

  'state.notConfigured.title': 'No DAO configured',
  'state.notConfigured.body':
    'This build has no SealedDAO address, so nothing is read from the chain. Set NEXT_PUBLIC_DAO_ADDRESS and NEXT_PUBLIC_DAO_DEPLOY_BLOCK at build time and rebuild.',
  'state.notConfigured.link': 'How deployment works',
  'state.rpcError.title': 'Cannot reach the network',
  'state.rpcError.body': 'The RPC at {rpc} did not answer. Check your connection, then retry.',
  'state.retry': 'Retry',
  'state.loading': 'Loading…',
  'state.readOnly': 'Read-only mode: connect a wallet to act.',
  'state.connect.title': 'Connect a wallet',
  'state.switch.title': 'Switch to {chain}',

  'status.Voting': 'Voting',
  'status.Revealing': 'Revealing',
  'status.Ready': 'Ready to finalize',
  'status.Passed': 'Passed',
  'status.Failed': 'Failed',
  'status.Executed': 'Executed',
  'status.Expired': 'Expired',
  'status.hint.Voting': 'Votes are being sealed. Nobody can read them yet.',
  'status.hint.Revealing': 'Voting closed. Anyone can decrypt and reveal the votes.',
  'status.hint.Ready': 'The reveal window ended. Anyone can finalize.',
  'status.hint.Passed': 'Finalized as passed. Anyone can execute it.',
  'status.hint.Failed': 'Finalized as failed.',
  'status.hint.Executed': 'Passed and executed.',
  'status.hint.Expired': 'Passed, but not executed in time.',

  'deadline.votingCloses': 'Voting closes',
  'deadline.votingClosed': 'Voting closed',
  'deadline.revealEnds': 'Reveal window ends',
  'deadline.revealEnded': 'Reveal window ended',
  'deadline.executeBy': 'Execute by',
  'deadline.executeEnded': 'Execution window ended',
  'deadline.round': 'drand round {round}',
  'deadline.in': 'in {time}',
  'deadline.passed': 'passed',

  'tally.sealed': 'Sealed',
  'tally.revealed': 'Revealed',
  'tally.for': 'For',
  'tally.against': 'Against',
  'tally.abstain': 'Abstain',
  'tally.quorum': 'Quorum',
  'tally.quorumLine': '{sealed} of {snapshot} members sealed a vote. Quorum needs {needed}.',
  'tally.quorumMet': 'Quorum met',
  'tally.quorumNotMet': 'Quorum not met yet',
  'tally.hidden': 'Votes stay encrypted until the close round. There is no running tally.',
  'tally.unrevealed': '{count} sealed but not revealed: they count toward quorum only.',
  'tally.revealedOf': '{revealed} of {sealed} sealed votes revealed',

  'kind.TransferUSDC': 'Transfer USDC',
  'kind.SetMember': 'Set member',
  'kind.transferSummary': 'Pay {amount} USDC to {target}',
  'kind.addSummary': 'Add {target} as a member',
  'kind.removeSummary': 'Remove member {target}',

  'dao.members': 'Members',
  'dao.quorum': 'Quorum',
  'dao.quorumSub': 'of members must seal a vote',
  'dao.bounty': 'Reveal payment',
  'dao.bountySub': 'USDC per revealed vote, on proposals that met quorum',
  'dao.proposals': 'Proposals',
  'dao.contract': 'DAO contract',
  'dao.nonGoals':
    'No token, no sale, no yield, no prize, no chance. Membership changes and treasury transfers happen only through approved proposals.',

  'proposals.eyebrow': 'SealedDAO',
  'proposals.title': 'Proposals',
  'proposals.lead':
    'Every vote is timelock-encrypted to a drand round. Nobody can read a vote, and there is no tally, until voting closes. Then anyone can reveal them all at once.',
  'proposals.empty.title': 'No proposals yet',
  'proposals.empty.body': 'Members can create the first one.',
  'proposals.item': 'Proposal #{id}',
  'proposals.open': 'Open proposal #{id}',
  'proposals.noDescription': '(no description)',
  'proposals.showing': 'Showing the latest {shown} of {total}.',

  'detail.back': 'All proposals',
  'detail.missingId': 'This page needs a proposal id in the address, for example ?id=1.',
  'detail.notFound': 'Proposal #{id} does not exist on this DAO.',
  'detail.action': 'Action',
  'detail.proposer': 'Proposer',
  'detail.target': 'Target',
  'detail.amount': 'Amount',
  'detail.change': 'Change',
  'detail.add': 'Add member',
  'detail.remove': 'Remove member',
  'detail.descriptionUri': 'Full description',
  'detail.descriptionUriBlocked': 'Link not opened from here (only https://, http:// and ipfs:// links are):',
  'detail.deadlines': 'Deadlines',
  'detail.tally': 'Tally',
  'detail.timeline': 'Event timeline',
  'detail.timelineEmpty': 'No events found yet.',
  'detail.timelineLoading': 'Reading events…',
  'detail.timelineError': 'Could not read the events.',

  'privacy.title': 'Secret only while voting',
  'privacy.body':
    'Your vote is secret while voting is open: it is encrypted to drand round {round}, and nobody, the DAO included, can read it before that round. From that round on, anyone can decrypt it from the chain, whether or not it is revealed onchain; after the reveal it is public next to the voter address. This is not anonymity.',

  'vote.title': 'Seal your vote',
  'vote.legend': 'Your choice',
  'vote.submit': 'Seal vote',
  'vote.step.encrypting': 'Encrypting your vote to round {round}…',
  'vote.step.wallet': 'Confirm the transaction in your wallet.',
  'vote.done': 'Vote sealed. Keep your receipt.',
  'vote.notMember':
    'This wallet is not a member, so it cannot vote. Members change only through executed proposals.',
  'vote.already': 'This wallet already sealed a vote on this proposal. Votes cannot be changed.',
  'vote.receiptStored':
    'A receipt is saved in this browser. It lets you reveal your own vote even if drand is unreachable.',
  'vote.receiptMissing': 'No receipt for this vote in this browser. If you downloaded it, keep the file.',
  'vote.receiptForced':
    'This browser blocked local storage, so the receipt was downloaded instead. Keep the file: it lets you reveal your own vote without drand.',
  'vote.downloadReceipt': 'Download receipt (JSON)',
  'vote.connect': 'Connect a member wallet to vote.',

  'reveal.title': 'Reveal the votes',
  'reveal.lead':
    'Voting closed at drand round {round}. That round’s beacon decrypts every sealed vote, in your browser. Anyone can reveal.',
  'reveal.payment':
    'This proposal met quorum, so the treasury credits {bounty} USDC per revealed vote to whoever sends the transaction, to cover its gas, when it has enough free USDC.',
  'reveal.noPayment':
    'This proposal did not meet quorum, so it cannot pass, and the treasury credits no reveal payment for it. Revealing still records the votes.',
  'reveal.button': 'Reveal votes',
  'reveal.scanning': 'Reading sealed votes ({windows} block windows) and fetching the drand beacon…',
  'reveal.resultTitle': 'Decrypted in your browser',
  'reveal.voter': 'Voter',
  'reveal.result': 'Result',
  'reveal.decrypted': 'Decrypted: {choice}',
  'reveal.reason.undecryptable': 'Skipped: not a vote for this round',
  'reveal.reason.commitment-mismatch': 'Skipped: does not match the sealed commitment',
  'reveal.reason.already-revealed': 'Already revealed',
  'reveal.nothing': 'Nothing left to reveal.',
  'reveal.send': 'Submit {count} reveals',
  'reveal.batch': 'Batch {n} of {total}',
  'reveal.connectToSend':
    'Connect a wallet to submit these reveals. When the proposal met quorum, the treasury credits a small fixed payment per revealed vote to cover the gas.',
  'reveal.sent': 'All reveals submitted.',
  'reveal.logId': 'Log id {id}',
  'reveal.mineTitle': 'Reveal only mine',
  'reveal.mineLead': 'Uses your vote receipt instead of drand, so it works even when drand is unreachable.',
  'reveal.mineLocal': 'Reveal my vote ({choice}) from this browser’s receipt',
  'reveal.mineNoLocal': 'No receipt for the connected wallet in this browser.',
  'reveal.mineUpload': 'Or upload a receipt file (JSON)',
  'reveal.mineUploaded': 'Receipt for {voter}: {choice}',
  'reveal.mineSubmit': 'Reveal this vote',
  'reveal.receipt.invalid': 'This file is not a valid ArcSeal vote receipt.',
  'reveal.receipt.wrongChain': 'This receipt is for chain {chainId}, not the chain of this DAO.',
  'reveal.receipt.wrongDao': 'This receipt is for another DAO ({dao}).',
  'reveal.receipt.wrongProposal': 'This receipt is for proposal #{id}.',

  'finalize.title': 'Finalize',
  'finalize.lead':
    'The reveal window ended at round {round} ({time}). Finalizing records whether the proposal passed. Anyone can do it.',
  'finalize.button': 'Finalize',
  'execute.title': 'Execute',
  'execute.lead.transfer':
    'Passed. Executing credits {amount} USDC to {target}, who withdraws it with Claim on the Treasury page. Anyone can execute until {deadline} (drand round {round}).',
  'execute.lead.member':
    'Passed. Executing applies the membership change. Anyone can execute until {deadline} (drand round {round}).',
  'execute.button': 'Execute',
  'result.title': 'Result',
  'result.executed.transfer':
    'Executed: {amount} USDC was credited to {target}. The payee withdraws it with Claim on the Treasury page.',
  'result.executed.member': 'Executed: the membership change is applied.',
  'result.failed.quorum':
    'Failed: quorum not met. {sealed} of {snapshot} members sealed a vote; {needed} were needed.',
  'result.failed.majority': 'Failed: For ({for}) did not beat Against ({against}). Ties fail.',
  'result.expired':
    'Expired: the proposal passed but was not executed within 7 days after the reveal window. It can no longer be executed.',

  'fee.label': 'est. network fee',
  'fee.value': '≈ {amount} {symbol}',

  'tx.title': 'Transactions this session',
  'tx.pending': 'pending',
  'tx.success': 'confirmed',
  'tx.reverted': 'reverted',
  'tx.confirmWallet': '{label}: confirm in your wallet',
  'tx.waiting': '{label}: waiting for the network',
  'tx.failed': '{label} failed',
  'tx.view': 'View on explorer',
  'tx.label.vote': 'Seal vote',
  'tx.label.reveal': 'Reveal votes',
  'tx.label.revealMine': 'Reveal my vote',
  'tx.label.finalize': 'Finalize',
  'tx.label.execute': 'Execute',
  'tx.label.propose': 'Create proposal',
  'tx.label.claim': 'Claim',
  'tx.label.fund': 'Fund treasury',

  'event.ProposalCreated': 'Proposal created',
  'event.Sealed': 'Vote sealed',
  'event.VoteRevealed': 'Vote revealed',
  'event.RevealSkipped': 'Reveal skipped',
  'event.BountyCredited': 'Reveal payment credited',
  'event.BountySkipped': 'Reveal payment skipped: treasury short',
  'event.Finalized': 'Finalized',
  'event.Executed': 'Executed',
  'event.by': 'by {address}',
  'event.revealed': '{voter} voted {choice}',
  'event.bounty': '{amount} USDC to {revealer}',
  'event.finalized':
    '{result} · For {for} · Against {against} · Abstain {abstain} · {revealed} of {sealed} revealed',
  'event.block': 'block {block}',

  'new.eyebrow': 'SealedDAO',
  'new.title': 'New proposal',
  'new.lead':
    'Members propose. Every member then seals one vote until the close round, and the 24-hour reveal window starts there.',
  'new.kind': 'Action',
  'new.kind.transfer': 'Transfer USDC from the treasury',
  'new.kind.member': 'Add or remove a member',
  'new.target.transfer': 'Recipient address',
  'new.target.member': 'Member address',
  'new.target.hint.transfer':
    'After execution, this address withdraws the USDC with Claim on the Treasury page.',
  'new.target.hint.member':
    'One address, one vote. Adding a current member, removing a non-member or removing the last member fails at execute.',
  'new.amount': 'Amount (USDC)',
  'new.amount.hint': 'Up to 6 decimals, with a dot as the decimal separator.',
  'new.amount.free': 'Free treasury now: {free} USDC.',
  'new.flag': 'Change',
  'new.flag.add': 'Add as a member',
  'new.flag.remove': 'Remove from the members',
  'new.description': 'Description',
  'new.description.counter': '{used} / 256 bytes',
  'new.description.hint': 'A short summary stored onchain.',
  'new.uri': 'Link to the full text (optional)',
  'new.uri.hint': 'An https:// or ipfs:// link, for text longer than 256 bytes.',
  'new.duration': 'Voting duration',
  'new.duration.600': '10 minutes',
  'new.duration.3600': '1 hour',
  'new.duration.86400': '24 hours',
  'new.duration.604800': '7 days',
  'new.preview':
    'If sent now, voting closes at drand round {round} ({time}); then the reveal window stays open for 24 hours.',
  'new.submit': 'Create proposal',
  'new.notMember': 'Only members can create proposals, and the connected wallet is not a member.',
  'new.connect': 'Connect a member wallet to create a proposal.',
  'new.created': 'Proposal #{id} created.',
  'new.open': 'Open proposal #{id}',

  'form.error.targetRequired': 'Enter an address.',
  'form.error.targetInvalid': 'This is not a valid address (0x followed by 40 hex characters).',
  'form.error.targetZero': 'The zero address cannot be a target.',
  'form.error.targetSelf':
    'This is the DAO itself or the USDC token. Neither can ever claim a payout or vote, so it cannot be a target.',
  'form.error.amount.empty': 'Enter an amount.',
  'form.error.amount.format': 'Enter a number such as 1.5.',
  'form.error.amount.comma': 'Use a dot as the decimal separator.',
  'form.error.amount.decimals': 'USDC has at most 6 decimals.',
  'form.error.amount.tooLarge': 'This amount is too large.',
  'form.error.amount.zero': 'The amount must be greater than zero.',
  'form.error.descriptionEmpty': 'Describe the proposal.',
  'form.error.descriptionTooLong':
    'The description is {bytes} bytes and the limit is 256. Put longer text behind the link.',
  'form.error.uriInvalid': 'Use an https://, http:// or ipfs:// link.',
  'form.error.uriTooLong': 'Keep the link to 2,048 bytes or less.',
  'form.error.duration': 'Pick one of the durations.',

  'treasury.eyebrow': 'SealedDAO',
  'treasury.title': 'Treasury and members',
  'treasury.lead':
    'USDC held by the DAO. Payouts are pull-based: an executed transfer or a reveal payment becomes claimable, and the payee withdraws it with Claim.',
  'treasury.balance': 'Treasury balance',
  'treasury.balanceSub': 'USDC, ERC-20 view (6 decimals)',
  'treasury.owed': 'Owed to claimers',
  'treasury.owedSub': 'reserved, not spendable',
  'treasury.free': 'Free to spend',
  'treasury.freeSub': 'balance minus what is owed',
  'treasury.claim.title': 'Your claimable balance',
  'treasury.claim.button': 'Claim',
  'treasury.claim.nothing': 'Nothing to claim for this wallet.',
  'treasury.claim.connect': 'Connect a wallet to see and claim what the DAO owes it.',
  'treasury.fund.title': 'Fund the treasury',
  'treasury.fund.lead':
    'A plain USDC transfer to the DAO address. Anyone can fund it; only passed proposals and reveal payments spend it.',
  'treasury.fund.amount': 'Amount (USDC)',
  'treasury.fund.balance': 'Your USDC balance: {amount}',
  'treasury.fund.submit': 'Send USDC to the treasury',
  'treasury.fund.insufficient': 'This is more than your USDC balance.',
  'treasury.members.title': 'Members',
  'treasury.members.lead':
    '{count} members. One address, one vote. Members change only through executed SetMember proposals.',
  'treasury.members.empty': 'No member events found from block {block}.',
  'treasury.params.title': 'Parameters',
  'treasury.params.lead': 'Fixed at deploy. The contract has no owner, no upgrade and no pause.',
  'treasury.params.usdc': 'USDC token',

  'docs.eyebrow': 'Documentation',
  'docs.title': 'Docs',
  'docs.lead': 'Integration guide, FAQ and the specification summary.',
  'docs.source': 'Source: {file}',
  'docs.fallback': 'This page is not translated yet, so it is shown in English.',
  'docs.onThisPage': 'On this page',
  'docs.nav.integration': 'Integration guide',
  'docs.nav.faq': 'FAQ',
  'docs.nav.spec': 'Spec summary',

  'home.lead':
    'Sealed voting for a member DAO on Arc. Votes are timelock-encrypted to a drand round and anyone can open them after it.',
  'home.openApp': 'Open the app',
  'home.docs': 'Read the docs',

  'footer.tagline':
    'Timelock-encrypted sealed voting on Arc. MIT licensed. Unaudited and experimental: keep amounts small.',
  'footer.noBackend':
    'No analytics, no backend: this site reads the chain from your browser and decrypts votes locally with drand.',
  'footer.source': 'Source code',
  'footer.license': 'MIT license',
  'footer.arcDocs': 'Arc docs',
  'footer.product': 'App',
  'footer.docs': 'Docs',
  'footer.open': 'Open source',

  'error.contract.AlreadyExecuted': 'This proposal was already executed.',
  'error.contract.AlreadyFinalized': 'This proposal was already finalized.',
  'error.contract.AlreadySealed':
    'This wallet already sealed a vote on this proposal. Votes cannot be changed.',
  'error.contract.BadAmount': 'The amount must be greater than zero.',
  'error.contract.BadCiphertextLength': 'The sealed vote has an invalid size: it must be 359 to 1,024 bytes.',
  'error.contract.BadCommitment': 'The vote commitment is empty. Seal the vote again.',
  'error.contract.BadDuration': 'The voting duration must be between 10 minutes and 7 days.',
  'error.contract.BadMember': 'The zero address cannot be a member.',
  'error.contract.BadQuorum': 'The quorum must be between 0.01% and 100%.',
  'error.contract.BadReveal': 'The reveal does not match the sealed vote.',
  'error.contract.BadTarget':
    'The target address is not valid: it cannot be the zero address, the DAO itself or the USDC token.',
  'error.contract.BadUSDC': 'The DAO was given an empty USDC address.',
  'error.contract.DescriptionTooLong': 'The description is over 256 bytes. Put longer text behind the link.',
  'error.contract.DescriptionURITooLong': 'The link is over 2,048 bytes. Use a shorter link.',
  'error.contract.DuplicateMember': 'The same address is listed twice as a member.',
  'error.contract.Expired':
    'The execution window has closed: a passed proposal must be executed within 7 days after the reveal window.',
  'error.contract.GroupAlreadyOpen': 'A voting round already exists for this proposal id.',
  'error.contract.InsufficientTreasury':
    'The treasury does not hold enough free USDC for this. USDC already owed to claimers is reserved.',
  'error.contract.LastMember':
    'This change would remove the last member, and then nobody could ever propose again.',
  'error.contract.LengthMismatch': 'The reveal lists have different lengths.',
  'error.contract.NoMembers': 'A DAO needs at least one member.',
  'error.contract.NoOp': 'This membership change does nothing: the address is already in that state.',
  'error.contract.NotMember': 'Only members can do this, and the connected wallet is not a member.',
  'error.contract.NotPassed': 'This proposal did not pass, so it cannot be executed.',
  'error.contract.NotReady':
    'Not yet. Finalize opens after the reveal window ends, and execute opens after finalize.',
  'error.contract.NothingSealed': 'Nobody sealed a vote here.',
  'error.contract.NothingToClaim': 'This wallet has nothing to claim.',
  'error.contract.Reentrancy': 'The call was blocked by the reentrancy guard.',
  'error.contract.RevealClosed': 'The reveal window has closed.',
  'error.contract.RevealNotOpen': 'The reveal window is not open yet: it opens at the close round.',
  'error.contract.RoundOverflow': 'The requested drand round is out of range.',
  'error.contract.SealingClosed': 'Voting is closed for this proposal.',
  'error.contract.TooManyItems': 'A reveal batch holds at most 256 votes.',
  'error.contract.TransferFailed': 'The USDC transfer did not succeed.',
  'error.contract.UnknownProposal': 'This proposal does not exist.',
  'error.usdc.blocklisted':
    'The USDC issuer blocks this address, so the transfer reverted. Anything the DAO owes it stays claimable.',
  'error.usdc.balance': 'Not enough USDC in this wallet.',
  'error.usdc.paused': 'USDC transfers are paused by the issuer.',
  'error.revertReason': 'The transaction would revert: {reason}',
  'error.panic': 'The contract hit an internal error (panic code {code}).',
  'error.unknownRevert': 'The transaction would revert without a reason.',
  'error.wallet.rejected': 'You rejected the request in your wallet.',
  'error.wallet.insufficientFunds':
    'Not enough USDC in this wallet to pay for gas. On Arc, gas is paid in USDC.',
  'error.wallet.wrongChain': 'Switch your wallet to {chain} (chain {chainId}).',
  'error.wallet.notConnected': 'Connect a wallet first.',
  'error.rpc.unreachable': 'The network RPC did not respond. Check your connection and try again.',
  'error.drand.early': 'drand has not published round {round} yet. Try again after {time}.',
  'error.drand.unreachable':
    'No drand relay answered. Retry later, or reveal your own vote from your receipt, which does not need drand.',
  'error.drand.invalidBeacon': 'The drand beacon did not verify, so nothing was decrypted.',
  'error.invalidInput': 'Invalid input: {details}',
  'error.proposalNotFound': 'This proposal does not exist.',
  'error.txReverted':
    'The transaction was included but reverted, usually because the state changed in between or it ran out of gas. Reload and retry.',
  'error.eventNotFound': 'The transaction succeeded, but its result event was not found. Reload the page.',
  'error.noDao': 'No DAO is configured for this build.',
  'error.generic': 'Something went wrong: {message}',

  'notFound.title': 'Page not found',
  'notFound.body': 'This page does not exist. Proposal pages use an id in the address: /app/proposal/?id=1.',
} satisfies Record<string, string>;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

const ptBR: Messages = {
  'app.name': 'ArcSeal',
  'app.tagline': 'Votação selada na Arc',

  'nav.main': 'Principal',
  'nav.skip': 'Pular para o conteúdo',
  'nav.proposals': 'Propostas',
  'nav.new': 'Nova proposta',
  'nav.treasury': 'Tesouraria',
  'nav.docs': 'Docs',
  'nav.project': 'Página do projeto',
  'nav.github': 'GitHub',
  'nav.home': 'Início do ArcSeal',

  'locale.label': 'Idioma',
  'locale.en': 'EN',
  'locale.pt-BR': 'PT-BR',

  'wallet.connect': 'Conectar carteira',
  'wallet.connecting': 'Conectando…',
  'wallet.disconnect': 'Desconectar carteira',
  'wallet.loading': 'Carregando estado da carteira',
  'wallet.noProvider':
    'Nenhuma carteira encontrada no navegador. Instale uma extensão de carteira EVM para continuar.',
  'wallet.switch': 'Trocar para {chain}',
  'wallet.connected': 'Conectado como {address}',
  'wallet.you': 'você',

  'banner.wrongNetwork': 'Sua carteira está na chain {current}. Este app roda na {chain} (chain {chainId}).',
  'banner.switch': 'Trocar de rede',
  'banner.config': 'Problema na configuração do build:',

  'state.notConfigured.title': 'Nenhuma DAO configurada',
  'state.notConfigured.body':
    'Este build não tem endereço de SealedDAO, então nada é lido da chain. Defina NEXT_PUBLIC_DAO_ADDRESS e NEXT_PUBLIC_DAO_DEPLOY_BLOCK no build e gere o site de novo.',
  'state.notConfigured.link': 'Como funciona o deploy',
  'state.rpcError.title': 'Sem acesso à rede',
  'state.rpcError.body': 'O RPC em {rpc} não respondeu. Verifique sua conexão e tente de novo.',
  'state.retry': 'Tentar de novo',
  'state.loading': 'Carregando…',
  'state.readOnly': 'Modo somente leitura: conecte uma carteira para agir.',
  'state.connect.title': 'Conecte uma carteira',
  'state.switch.title': 'Troque para {chain}',

  'status.Voting': 'Em votação',
  'status.Revealing': 'Revelando',
  'status.Ready': 'Pronta para finalizar',
  'status.Passed': 'Aprovada',
  'status.Failed': 'Reprovada',
  'status.Executed': 'Executada',
  'status.Expired': 'Expirada',
  'status.hint.Voting': 'Os votos estão sendo selados. Ninguém consegue lê-los ainda.',
  'status.hint.Revealing': 'A votação fechou. Qualquer pessoa pode decifrar e revelar os votos.',
  'status.hint.Ready': 'A janela de revelação acabou. Qualquer pessoa pode finalizar.',
  'status.hint.Passed': 'Finalizada como aprovada. Qualquer pessoa pode executá-la.',
  'status.hint.Failed': 'Finalizada como reprovada.',
  'status.hint.Executed': 'Aprovada e executada.',
  'status.hint.Expired': 'Aprovada, mas não executada a tempo.',

  'deadline.votingCloses': 'Votação fecha',
  'deadline.votingClosed': 'Votação fechou',
  'deadline.revealEnds': 'Janela de revelação fecha',
  'deadline.revealEnded': 'Janela de revelação fechou',
  'deadline.executeBy': 'Executar até',
  'deadline.executeEnded': 'Janela de execução fechou',
  'deadline.round': 'rodada drand {round}',
  'deadline.in': 'em {time}',
  'deadline.passed': 'encerrado',

  'tally.sealed': 'Selados',
  'tally.revealed': 'Revelados',
  'tally.for': 'A favor',
  'tally.against': 'Contra',
  'tally.abstain': 'Abstenção',
  'tally.quorum': 'Quórum',
  'tally.quorumLine': '{sealed} de {snapshot} membros selaram um voto. O quórum exige {needed}.',
  'tally.quorumMet': 'Quórum atingido',
  'tally.quorumNotMet': 'Quórum ainda não atingido',
  'tally.hidden': 'Os votos ficam cifrados até a rodada de fechamento. Não existe contagem parcial.',
  'tally.unrevealed': '{count} selados e não revelados: contam só para o quórum.',
  'tally.revealedOf': '{revealed} de {sealed} votos selados revelados',

  'kind.TransferUSDC': 'Transferir USDC',
  'kind.SetMember': 'Alterar membro',
  'kind.transferSummary': 'Pagar {amount} USDC para {target}',
  'kind.addSummary': 'Adicionar {target} como membro',
  'kind.removeSummary': 'Remover o membro {target}',

  'dao.members': 'Membros',
  'dao.quorum': 'Quórum',
  'dao.quorumSub': 'dos membros precisam selar um voto',
  'dao.bounty': 'Pagamento por revelação',
  'dao.bountySub': 'USDC por voto revelado, em propostas que atingiram o quórum',
  'dao.proposals': 'Propostas',
  'dao.contract': 'Contrato da DAO',
  'dao.nonGoals':
    'Sem token, sem venda, sem rendimento, sem prêmio, sem sorteio. Mudanças de membros e transferências da tesouraria só acontecem por propostas aprovadas.',

  'proposals.eyebrow': 'SealedDAO',
  'proposals.title': 'Propostas',
  'proposals.lead':
    'Cada voto é cifrado com timelock para uma rodada do drand. Ninguém lê um voto, e não existe contagem, até a votação fechar. Depois disso qualquer pessoa revela todos de uma vez.',
  'proposals.empty.title': 'Nenhuma proposta ainda',
  'proposals.empty.body': 'Os membros podem criar a primeira.',
  'proposals.item': 'Proposta #{id}',
  'proposals.open': 'Abrir a proposta #{id}',
  'proposals.noDescription': '(sem descrição)',
  'proposals.showing': 'Mostrando as {shown} mais recentes de {total}.',

  'detail.back': 'Todas as propostas',
  'detail.missingId': 'Esta página precisa do id da proposta no endereço, por exemplo ?id=1.',
  'detail.notFound': 'A proposta #{id} não existe nesta DAO.',
  'detail.action': 'Ação',
  'detail.proposer': 'Proponente',
  'detail.target': 'Alvo',
  'detail.amount': 'Valor',
  'detail.change': 'Mudança',
  'detail.add': 'Adicionar membro',
  'detail.remove': 'Remover membro',
  'detail.descriptionUri': 'Descrição completa',
  'detail.descriptionUriBlocked': 'Link não aberto daqui (só links https://, http:// e ipfs:// abrem):',
  'detail.deadlines': 'Prazos',
  'detail.tally': 'Apuração',
  'detail.timeline': 'Linha do tempo de eventos',
  'detail.timelineEmpty': 'Nenhum evento encontrado ainda.',
  'detail.timelineLoading': 'Lendo eventos…',
  'detail.timelineError': 'Não foi possível ler os eventos.',

  'privacy.title': 'Sigilo só durante a votação',
  'privacy.body':
    'Seu voto é secreto enquanto a votação está aberta: ele é cifrado para a rodada drand {round}, e ninguém, nem a DAO, consegue lê-lo antes dessa rodada. A partir dessa rodada, qualquer pessoa pode decifrá-lo a partir da chain, revelado onchain ou não; depois da revelação ele fica público ao lado do endereço de quem votou. Isto não é anonimato.',

  'vote.title': 'Sele seu voto',
  'vote.legend': 'Sua escolha',
  'vote.submit': 'Selar voto',
  'vote.step.encrypting': 'Cifrando seu voto para a rodada {round}…',
  'vote.step.wallet': 'Confirme a transação na sua carteira.',
  'vote.done': 'Voto selado. Guarde seu comprovante.',
  'vote.notMember':
    'Esta carteira não é membro, então não pode votar. Os membros só mudam por propostas executadas.',
  'vote.already': 'Esta carteira já selou um voto nesta proposta. Votos não podem ser alterados.',
  'vote.receiptStored':
    'Há um comprovante salvo neste navegador. Com ele você revela o próprio voto mesmo sem acesso ao drand.',
  'vote.receiptMissing': 'Nenhum comprovante deste voto neste navegador. Se você baixou o arquivo, guarde-o.',
  'vote.receiptForced':
    'Este navegador bloqueou o armazenamento local, então o comprovante foi baixado. Guarde o arquivo: com ele você revela o próprio voto sem o drand.',
  'vote.downloadReceipt': 'Baixar comprovante (JSON)',
  'vote.connect': 'Conecte a carteira de um membro para votar.',

  'reveal.title': 'Revelar os votos',
  'reveal.lead':
    'A votação fechou na rodada drand {round}. O beacon dessa rodada decifra todos os votos selados, no seu navegador. Qualquer pessoa pode revelar.',
  'reveal.payment':
    'Esta proposta atingiu o quórum, então a tesouraria credita {bounty} USDC por voto revelado a quem enviar a transação, para cobrir o gas, quando tem saldo livre suficiente.',
  'reveal.noPayment':
    'Esta proposta não atingiu o quórum, então não pode ser aprovada, e a tesouraria não credita pagamento por revelação para ela. Revelar ainda registra os votos.',
  'reveal.button': 'Revelar votos',
  'reveal.scanning': 'Lendo os votos selados ({windows} janelas de blocos) e buscando o beacon do drand…',
  'reveal.resultTitle': 'Decifrados no seu navegador',
  'reveal.voter': 'Votante',
  'reveal.result': 'Resultado',
  'reveal.decrypted': 'Decifrado: {choice}',
  'reveal.reason.undecryptable': 'Ignorado: não é um voto para esta rodada',
  'reveal.reason.commitment-mismatch': 'Ignorado: não confere com o compromisso selado',
  'reveal.reason.already-revealed': 'Já revelado',
  'reveal.nothing': 'Não há mais nada para revelar.',
  'reveal.send': 'Enviar {count} revelações',
  'reveal.batch': 'Lote {n} de {total}',
  'reveal.connectToSend':
    'Conecte uma carteira para enviar estas revelações. Quando a proposta atingiu o quórum, a tesouraria credita um pequeno pagamento fixo por voto revelado para cobrir o gas.',
  'reveal.sent': 'Todas as revelações foram enviadas.',
  'reveal.logId': 'Id de log {id}',
  'reveal.mineTitle': 'Revelar só o meu',
  'reveal.mineLead':
    'Usa o comprovante do seu voto em vez do drand, então funciona mesmo com o drand fora do ar.',
  'reveal.mineLocal': 'Revelar meu voto ({choice}) pelo comprovante deste navegador',
  'reveal.mineNoLocal': 'Nenhum comprovante da carteira conectada neste navegador.',
  'reveal.mineUpload': 'Ou envie um arquivo de comprovante (JSON)',
  'reveal.mineUploaded': 'Comprovante de {voter}: {choice}',
  'reveal.mineSubmit': 'Revelar este voto',
  'reveal.receipt.invalid': 'Este arquivo não é um comprovante de voto ArcSeal válido.',
  'reveal.receipt.wrongChain': 'Este comprovante é da chain {chainId}, não da chain desta DAO.',
  'reveal.receipt.wrongDao': 'Este comprovante é de outra DAO ({dao}).',
  'reveal.receipt.wrongProposal': 'Este comprovante é da proposta #{id}.',

  'finalize.title': 'Finalizar',
  'finalize.lead':
    'A janela de revelação fechou na rodada {round} ({time}). Finalizar registra se a proposta foi aprovada. Qualquer pessoa pode fazer isso.',
  'finalize.button': 'Finalizar',
  'execute.title': 'Executar',
  'execute.lead.transfer':
    'Aprovada. Executar credita {amount} USDC para {target}, que saca com Resgatar na página da Tesouraria. Qualquer pessoa pode executar até {deadline} (rodada drand {round}).',
  'execute.lead.member':
    'Aprovada. Executar aplica a mudança de membros. Qualquer pessoa pode executar até {deadline} (rodada drand {round}).',
  'execute.button': 'Executar',
  'result.title': 'Resultado',
  'result.executed.transfer':
    'Executada: {amount} USDC foram creditados para {target}. O beneficiário saca com Resgatar na página da Tesouraria.',
  'result.executed.member': 'Executada: a mudança de membros foi aplicada.',
  'result.failed.quorum':
    'Reprovada: quórum não atingido. {sealed} de {snapshot} membros selaram um voto; eram necessários {needed}.',
  'result.failed.majority': 'Reprovada: A favor ({for}) não superou Contra ({against}). Empate reprova.',
  'result.expired':
    'Expirada: a proposta foi aprovada, mas não foi executada em até 7 dias após a janela de revelação. Ela não pode mais ser executada.',

  'fee.label': 'taxa de rede estimada',
  'fee.value': '≈ {amount} {symbol}',

  'tx.title': 'Transações nesta sessão',
  'tx.pending': 'pendente',
  'tx.success': 'confirmada',
  'tx.reverted': 'revertida',
  'tx.confirmWallet': '{label}: confirme na sua carteira',
  'tx.waiting': '{label}: aguardando a rede',
  'tx.failed': '{label} falhou',
  'tx.view': 'Ver no explorer',
  'tx.label.vote': 'Selar voto',
  'tx.label.reveal': 'Revelar votos',
  'tx.label.revealMine': 'Revelar meu voto',
  'tx.label.finalize': 'Finalizar',
  'tx.label.execute': 'Executar',
  'tx.label.propose': 'Criar proposta',
  'tx.label.claim': 'Resgatar',
  'tx.label.fund': 'Depositar na tesouraria',

  'event.ProposalCreated': 'Proposta criada',
  'event.Sealed': 'Voto selado',
  'event.VoteRevealed': 'Voto revelado',
  'event.RevealSkipped': 'Revelação ignorada',
  'event.BountyCredited': 'Pagamento por revelação creditado',
  'event.BountySkipped': 'Pagamento por revelação não creditado: tesouraria sem saldo livre',
  'event.Finalized': 'Finalizada',
  'event.Executed': 'Executada',
  'event.by': 'por {address}',
  'event.revealed': '{voter} votou {choice}',
  'event.bounty': '{amount} USDC para {revealer}',
  'event.finalized':
    '{result} · A favor {for} · Contra {against} · Abstenção {abstain} · {revealed} de {sealed} revelados',
  'event.block': 'bloco {block}',

  'new.eyebrow': 'SealedDAO',
  'new.title': 'Nova proposta',
  'new.lead':
    'Membros propõem. Depois cada membro sela um voto até a rodada de fechamento, e a janela de revelação de 24 horas começa ali.',
  'new.kind': 'Ação',
  'new.kind.transfer': 'Transferir USDC da tesouraria',
  'new.kind.member': 'Adicionar ou remover um membro',
  'new.target.transfer': 'Endereço do destinatário',
  'new.target.member': 'Endereço do membro',
  'new.target.hint.transfer':
    'Depois da execução, este endereço saca o USDC com Resgatar na página da Tesouraria.',
  'new.target.hint.member':
    'Um endereço, um voto. Adicionar quem já é membro, remover quem não é ou remover o último membro falha na execução.',
  'new.amount': 'Valor (USDC)',
  'new.amount.hint': 'Até 6 casas decimais. Use ponto como separador decimal (ex.: 1.5), não vírgula.',
  'new.amount.free': 'Tesouraria livre agora: {free} USDC.',
  'new.flag': 'Mudança',
  'new.flag.add': 'Adicionar como membro',
  'new.flag.remove': 'Remover dos membros',
  'new.description': 'Descrição',
  'new.description.counter': '{used} / 256 bytes',
  'new.description.hint': 'Um resumo curto gravado onchain.',
  'new.uri': 'Link para o texto completo (opcional)',
  'new.uri.hint': 'Um link https:// ou ipfs://, para textos com mais de 256 bytes.',
  'new.duration': 'Duração da votação',
  'new.duration.600': '10 minutos',
  'new.duration.3600': '1 hora',
  'new.duration.86400': '24 horas',
  'new.duration.604800': '7 dias',
  'new.preview':
    'Se enviada agora, a votação fecha na rodada drand {round} ({time}); depois a janela de revelação fica aberta por 24 horas.',
  'new.submit': 'Criar proposta',
  'new.notMember': 'Só membros podem criar propostas, e a carteira conectada não é membro.',
  'new.connect': 'Conecte a carteira de um membro para criar uma proposta.',
  'new.created': 'Proposta #{id} criada.',
  'new.open': 'Abrir a proposta #{id}',

  'form.error.targetRequired': 'Informe um endereço.',
  'form.error.targetInvalid': 'Este endereço não é válido (0x seguido de 40 caracteres hexadecimais).',
  'form.error.targetZero': 'O endereço zero não pode ser o alvo.',
  'form.error.targetSelf':
    'Este é o endereço da própria DAO ou do token USDC. Nenhum dos dois consegue resgatar um pagamento nem votar, então não pode ser o alvo.',
  'form.error.amount.empty': 'Informe um valor.',
  'form.error.amount.format': 'Informe um número como 1.5.',
  'form.error.amount.comma': 'Use ponto como separador decimal.',
  'form.error.amount.decimals': 'O USDC tem no máximo 6 casas decimais.',
  'form.error.amount.tooLarge': 'Este valor é grande demais.',
  'form.error.amount.zero': 'O valor precisa ser maior que zero.',
  'form.error.descriptionEmpty': 'Descreva a proposta.',
  'form.error.descriptionTooLong':
    'A descrição tem {bytes} bytes e o limite é 256. Coloque o texto longo no link.',
  'form.error.uriInvalid': 'Use um link https://, http:// ou ipfs://.',
  'form.error.uriTooLong': 'Mantenha o link com até 2.048 bytes.',
  'form.error.duration': 'Escolha uma das durações.',

  'treasury.eyebrow': 'SealedDAO',
  'treasury.title': 'Tesouraria e membros',
  'treasury.lead':
    'USDC guardado pela DAO. Os pagamentos são por saque: uma transferência executada ou um pagamento por revelação vira saldo a resgatar, e o beneficiário saca com Resgatar.',
  'treasury.balance': 'Saldo da tesouraria',
  'treasury.balanceSub': 'USDC, visão ERC-20 (6 casas decimais)',
  'treasury.owed': 'Devido a resgatar',
  'treasury.owedSub': 'reservado, não pode ser gasto',
  'treasury.free': 'Livre para gastar',
  'treasury.freeSub': 'saldo menos o que é devido',
  'treasury.claim.title': 'Seu saldo a resgatar',
  'treasury.claim.button': 'Resgatar',
  'treasury.claim.nothing': 'Nada a resgatar para esta carteira.',
  'treasury.claim.connect': 'Conecte uma carteira para ver e resgatar o que a DAO deve a ela.',
  'treasury.fund.title': 'Depositar na tesouraria',
  'treasury.fund.lead':
    'Uma transferência simples de USDC para o endereço da DAO. Qualquer pessoa pode depositar; só propostas aprovadas e pagamentos por revelação gastam.',
  'treasury.fund.amount': 'Valor (USDC)',
  'treasury.fund.balance': 'Seu saldo de USDC: {amount}',
  'treasury.fund.submit': 'Enviar USDC para a tesouraria',
  'treasury.fund.insufficient': 'Isto é mais do que o seu saldo de USDC.',
  'treasury.members.title': 'Membros',
  'treasury.members.lead':
    '{count} membros. Um endereço, um voto. Os membros só mudam por propostas SetMember executadas.',
  'treasury.members.empty': 'Nenhum evento de membro encontrado a partir do bloco {block}.',
  'treasury.params.title': 'Parâmetros',
  'treasury.params.lead': 'Fixados no deploy. O contrato não tem dono, upgrade nem pausa.',
  'treasury.params.usdc': 'Token USDC',

  'docs.eyebrow': 'Documentação',
  'docs.title': 'Docs',
  'docs.lead': 'Guia de integração, FAQ e o resumo da especificação.',
  'docs.source': 'Fonte: {file}',
  'docs.fallback': 'Esta página ainda não foi traduzida, então aparece em inglês.',
  'docs.onThisPage': 'Nesta página',
  'docs.nav.integration': 'Guia de integração',
  'docs.nav.faq': 'Perguntas frequentes',
  'docs.nav.spec': 'Resumo da especificação',

  'home.lead':
    'Votação selada para uma DAO de membros na Arc. Os votos são cifrados com timelock para uma rodada do drand e qualquer pessoa pode abri-los depois dela.',
  'home.openApp': 'Abrir o app',
  'home.docs': 'Ler a documentação',

  'footer.tagline':
    'Votação selada com cifra timelock na Arc. Licença MIT. Sem auditoria e experimental: use valores pequenos.',
  'footer.noBackend':
    'Sem analytics e sem backend: este site lê a chain pelo seu navegador e decifra os votos localmente com o drand.',
  'footer.source': 'Código-fonte',
  'footer.license': 'Licença MIT',
  'footer.arcDocs': 'Docs da Arc',
  'footer.product': 'App',
  'footer.docs': 'Docs',
  'footer.open': 'Código aberto',

  'error.contract.AlreadyExecuted': 'Esta proposta já foi executada.',
  'error.contract.AlreadyFinalized': 'Esta proposta já foi finalizada.',
  'error.contract.AlreadySealed':
    'Esta carteira já selou um voto nesta proposta. Votos não podem ser alterados.',
  'error.contract.BadAmount': 'O valor precisa ser maior que zero.',
  'error.contract.BadCiphertextLength':
    'O voto selado tem tamanho inválido: precisa ter de 359 a 1.024 bytes.',
  'error.contract.BadCommitment': 'O compromisso do voto está vazio. Sele o voto de novo.',
  'error.contract.BadDuration': 'A duração da votação precisa ficar entre 10 minutos e 7 dias.',
  'error.contract.BadMember': 'O endereço zero não pode ser membro.',
  'error.contract.BadQuorum': 'O quórum precisa ficar entre 0,01% e 100%.',
  'error.contract.BadReveal': 'A revelação não confere com o voto selado.',
  'error.contract.BadTarget':
    'O endereço alvo não é válido: não pode ser o endereço zero, a própria DAO nem o token USDC.',
  'error.contract.BadUSDC': 'A DAO recebeu um endereço de USDC vazio.',
  'error.contract.DescriptionTooLong': 'A descrição passa de 256 bytes. Coloque o texto longo no link.',
  'error.contract.DescriptionURITooLong': 'O link passa de 2.048 bytes. Use um link mais curto.',
  'error.contract.DuplicateMember': 'O mesmo endereço aparece duas vezes como membro.',
  'error.contract.Expired':
    'A janela de execução fechou: uma proposta aprovada precisa ser executada em até 7 dias após a janela de revelação.',
  'error.contract.GroupAlreadyOpen': 'Já existe uma rodada de votação para este id de proposta.',
  'error.contract.InsufficientTreasury':
    'A tesouraria não tem USDC livre suficiente para isto. O USDC já devido a resgates fica reservado.',
  'error.contract.LastMember':
    'Esta mudança removeria o último membro, e depois ninguém mais conseguiria propor.',
  'error.contract.LengthMismatch': 'As listas da revelação têm tamanhos diferentes.',
  'error.contract.NoMembers': 'Uma DAO precisa de pelo menos um membro.',
  'error.contract.NoOp': 'Esta mudança de membros não altera nada: o endereço já está nesse estado.',
  'error.contract.NotMember': 'Só membros podem fazer isto, e a carteira conectada não é membro.',
  'error.contract.NotPassed': 'Esta proposta não foi aprovada, então não pode ser executada.',
  'error.contract.NotReady':
    'Ainda não. Finalizar abre depois que a janela de revelação fecha, e executar abre depois de finalizar.',
  'error.contract.NothingSealed': 'Ninguém selou um voto aqui.',
  'error.contract.NothingToClaim': 'Esta carteira não tem nada a resgatar.',
  'error.contract.Reentrancy': 'A chamada foi bloqueada pela proteção contra reentrância.',
  'error.contract.RevealClosed': 'A janela de revelação já fechou.',
  'error.contract.RevealNotOpen': 'A janela de revelação ainda não abriu: ela abre na rodada de fechamento.',
  'error.contract.RoundOverflow': 'A rodada do drand pedida está fora do intervalo válido.',
  'error.contract.SealingClosed': 'A votação desta proposta está fechada.',
  'error.contract.TooManyItems': 'Um lote de revelação aceita no máximo 256 votos.',
  'error.contract.TransferFailed': 'A transferência de USDC não deu certo.',
  'error.contract.UnknownProposal': 'Esta proposta não existe.',
  'error.usdc.blocklisted':
    'O emissor do USDC bloqueia este endereço, então a transferência foi revertida. O que a DAO deve a ele continua disponível para resgate.',
  'error.usdc.balance': 'Saldo de USDC insuficiente nesta carteira.',
  'error.usdc.paused': 'As transferências de USDC estão pausadas pelo emissor.',
  'error.revertReason': 'A transação seria revertida: {reason}',
  'error.panic': 'O contrato encontrou um erro interno (código de panic {code}).',
  'error.unknownRevert': 'A transação seria revertida sem motivo informado.',
  'error.wallet.rejected': 'Você recusou o pedido na sua carteira.',
  'error.wallet.insufficientFunds':
    'Saldo de USDC insuficiente nesta carteira para pagar o gas. Na Arc, o gas é pago em USDC.',
  'error.wallet.wrongChain': 'Troque sua carteira para {chain} (chain {chainId}).',
  'error.wallet.notConnected': 'Conecte uma carteira primeiro.',
  'error.rpc.unreachable': 'O RPC da rede não respondeu. Verifique sua conexão e tente de novo.',
  'error.drand.early': 'O drand ainda não publicou a rodada {round}. Tente de novo depois de {time}.',
  'error.drand.unreachable':
    'Nenhum relay do drand respondeu. Tente mais tarde, ou revele o próprio voto pelo comprovante, que não precisa do drand.',
  'error.drand.invalidBeacon': 'O beacon do drand não passou na verificação, então nada foi decifrado.',
  'error.invalidInput': 'Entrada inválida: {details}',
  'error.proposalNotFound': 'Esta proposta não existe.',
  'error.txReverted':
    'A transação entrou no bloco, mas foi revertida, em geral porque o estado mudou no meio do caminho ou o gas acabou. Recarregue e tente de novo.',
  'error.eventNotFound':
    'A transação deu certo, mas o evento de resultado não foi encontrado. Recarregue a página.',
  'error.noDao': 'Nenhuma DAO está configurada neste build.',
  'error.generic': 'Algo deu errado: {message}',

  'notFound.title': 'Página não encontrada',
  'notFound.body':
    'Esta página não existe. As páginas de proposta usam um id no endereço: /app/proposal/?id=1.',
};

export const MESSAGES: Record<Locale, Messages> = { en, 'pt-BR': ptBR };

export type Vars = Record<string, string | number | bigint>;

/** The message for `key` in `locale` with {placeholders} filled. Unknown placeholders are left as written. */
export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const template = MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Choice labels in the tally and reveal lists reuse the tally keys. */
export const CHOICE_KEY = { for: 'tally.for', against: 'tally.against', abstain: 'tally.abstain' } as const;
