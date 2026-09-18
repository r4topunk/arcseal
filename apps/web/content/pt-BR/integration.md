# Guia de integração

> O ArcSeal é **experimental e não auditado**. Leia a [declaração de privacidade](/docs/faq/#o-que-fica-oculto-e-ate-quando)
> e a [spec completa](/docs/spec/) antes de depender dele para qualquer coisa real.

O ArcSeal tem duas superfícies de integração: um módulo Solidity abstrato, `Sealed.sol`, que qualquer contrato pode
herdar para obter compromissos (commitments) selados por tempo; e um SDK em TypeScript, `@arcseal/sdk`, que sela
votos, descriptografa-os assim que a rodada se torna pública e conversa com o app de referência, `SealedDAO`. Os
dois são construídos sobre o [drand quicknet](https://drand.love) como relógio e o [tlock](https://github.com/drand/tlock)
como cifra — sem relayer, sem oráculo, sem verificação BLS onchain (D7, D9, D12).

| Item | Valor |
|---|---|
| Rede | Arc mainnet, chain id `5042`, RPC `https://rpc.mainnet.arc.io` |
| `SealedDAO` (app de referência deste repositório) | `deployments/arc-mainnet.json` (também no [app](/app/)) |
| USDC (ERC-20, 6 casas decimais) | `0x3600000000000000000000000000000000000000` |
| Beacon | drand quicknet, BLS12-381 G1, unchained, período de 3 s |

## 1. Herdando `Sealed.sol`

O `Sealed` faz só três coisas: abre um "grupo" com uma rodada de fechamento e uma janela de revelação de 24 h,
guarda um compromisso `bytes32` por par `(grupo, selador)`, e permite checar uma revelação por hash. Ele nunca
inspeciona um ciphertext, nunca lida com BLS, e nunca é implantado sozinho (D7) — o seu contrato decide o que um
grupo significa e o que "revelado" deve fazer.

```sh
forge install r4topunk/arcseal
```

```text
# remappings.txt
arcseal/=lib/arcseal/contracts/src/
```

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Sealed} from "arcseal/Sealed.sol";

/// @notice Um leilão de lances selados usando o mesmo primitivo que o SealedDAO usa para votos.
contract SealedBid is Sealed {
    uint256 public auctionCount;
    mapping(uint256 auctionId => mapping(address bidder => bool)) public hasBid;

    /// @dev Os ids vêm de um contador, como no SealedDAO.propose: nunca deixe quem chama escolher (veja a nota abaixo).
    function openAuction(uint32 biddingSeconds) external returns (uint256 auctionId, uint64 closeRound) {
        auctionId = ++auctionCount;
        closeRound = _openGroup(auctionId, biddingSeconds); // o id do grupo é seu; o SealedDAO usa o proposalId
    }

    function bid(uint256 auctionId, bytes32 commitment, bytes calldata ciphertext) external {
        _seal(auctionId, msg.sender, commitment, ciphertext); // reverte SealingClosed / AlreadySealed / BadCommitment / BadCiphertextLength
        hasBid[auctionId][msg.sender] = true;
    }

    /// @dev Qualquer pessoa pode chamar isso depois de descriptografar um lance offchain, como o SealedDAO.revealBatch.
    function revealBid(uint256 auctionId, address bidder, uint256 amount, bytes32 salt) external returns (bool ok) {
        bytes32 expected = keccak256(abi.encode(auctionId, bidder, amount, salt)); // seu próprio hash, com domain separation
        ok = _verifyReveal(auctionId, bidder, expected); // comparação pura, nunca reverte em caso de mismatch
        if (ok) _consumeReveal(auctionId, bidder); // marca como REVEALED, emite Revealed
    }
}
```

Isso é ilustrativo, não um contrato implantado. `contracts/src/SealedDAO.sol` neste repositório é a implementação
de referência completa do mesmo padrão, com suíte de testes completa, e é o único deploy que o ArcSeal publica (D1).

Os ids dos grupos vêm de um contador de propósito. Com um id escolhido por quem chama, qualquer pessoa poderia abrir
antes o id que você pretendia usar, com a própria duração, e o `GroupAlreadyOpen` bloquearia a sua abertura de
verdade. Se os ids precisarem ser previsíveis, vincule-os a quem abre, por exemplo
`uint256(keccak256(abi.encode(msg.sender, nonce)))`.

### Regras para o seu próprio contrato baseado em `Sealed`

1. **Escolha sua própria fórmula de compromisso e faça o hash você mesmo.** O `Sealed` nunca calcula um hash;
   separe por domínio o que varia entre seus grupos e seladores (`SealedDAO.hashVote` vincula `proposalId` e
   `voter`, D11).
2. **O ciphertext é calldata mais um evento, nunca storage** (D10). Leia-o de volta pelo evento `Sealed`, não por
   um getter — não existe um.
3. **`_verifyReveal` nunca reverte em caso de mismatch.** Monte sua função de revelação (ou lote) para pular um
   resultado `false`, como faz o `SealedDAO.revealBatch`, para que um item ruim nunca bloqueie os demais.
4. **Chame `_requireRevealOpen` uma vez por lote, não por item**, se aceitar várias revelações em uma transação —
   é isso que faz um lote fora da janela falhar rápido em vez de simplesmente pular tudo em silêncio.
5. **O comprimento do ciphertext é limitado, mas não verificado de outra forma**: `[359, 1024]` bytes cobre
   qualquer payload cifrado com tlock de até algumas centenas de bytes de texto claro. Lixo dentro desse intervalo
   é problema seu de detectar na hora da revelação, por hash, nunca onchain.

## 2. Usando o `@arcseal/sdk` com o `SealedDAO`

```sh
pnpm add @arcseal/sdk viem
```

O SDK nunca inventa comportamento de contrato: cada ação exportada é um wrapper fino e tipado sobre uma função ou
view do `SealedDAO`, gerado e verificado contra o ABI do Foundry (`pnpm sdk:check-abi`).

### Selar um voto

```ts
import { sealAndVote, serializeVoteReceipt } from '@arcseal/sdk';
import { createWalletClient, custom } from 'viem';
import { arc } from 'viem/chains';

const wallet = createWalletClient({ account, chain: arc, transport: custom(window.ethereum) });

const ballot = await sealAndVote(wallet, {
  dao,
  proposalId: 1n,
  choice: 'for', // 'abstain' | 'for' | 'against'
  // Roda depois de selar, antes de a transação existir: é aqui que o app salva o comprovante local.
  onSealed: (b) =>
    localStorage.setItem(
      `arcseal:${arc.id}:${dao}:${b.proposalId}:${b.voter}`,
      serializeVoteReceipt({ version: 1, chainId: arc.id, dao, ...b, createdAt: new Date().toISOString() }),
    ),
});
```

`sealAndVote` lê o `closeRound` da proposta, gera um salt de 32 bytes via CSPRNG, cifra a escolha para aquela
rodada com `@arcseal/tlock` e envia `vote(id, commitment, ciphertext)`. Nada sobre a escolha sai do navegador em
texto claro.

### Descriptografar um único voto

```ts
import { unsealVote } from '@arcseal/sdk';

// Só funciona a partir de roundTime(closeRound). Sem `beacon`, um é buscado no drand.
const vote = await unsealVote({ ciphertext, closeRound });
// { choice: 'for', salt: '0x…' }, ou null para lixo, payload truncado, outra rodada ou beacon errado
```

### Revelar todos os votos de uma proposta

```ts
import { buildRevealBatch, revealBatch, unsealProposal, waitForSuccess } from '@arcseal/sdk';
import { createPublicClient, http } from 'viem';

const client = createPublicClient({ chain: arc, transport: http() });

const { items, skipped, skipReasons } = await unsealProposal({
  client,
  dao,
  proposalId: 1n,
  fromBlock: DAO_DEPLOY_BLOCK, // lê os eventos Sealed em janelas de 9.999 blocos (o eth_getLogs da Arc limita em 10.000)
});
// items: votos cujo hash bate com o commitment vigente onchain. skipped: lixo, mismatch, já revelado.

for (const batch of buildRevealBatch(items)) {
  // no máximo 256 itens por transação
  await waitForSuccess(client, await revealBatch(wallet, { dao, proposalId: 1n, ...batch }), 'revealBatch');
}
```

É exatamente isso que o botão "Revelar votos" do site faz (D9): descriptografar tudo no navegador de quem está
visitando, e então enviar uma transação a cada 256 votos. Não existe relayer, e nada exige o site — qualquer script
com o SDK pode revelar uma proposta. Numa proposta que atingiu o quórum, quem tiver a transação que revela os votos
recebe o mesmo pagamento fixo e pequeno por voto revelado que o tesouro paga para cobrir o próprio gás de quem
chamou; abaixo do quórum a proposta não pode ser aprovada, e as revelações dela não são pagas.

Para revelar só o seu próprio voto a partir de um comprovante baixado: `buildRevealBatch([receipt])` e depois
`revealBatch(...)`.

### Ler propostas e status

```ts
import { getProposal, getStatus, listProposals } from '@arcseal/sdk';

const { proposals, nextFromBlock } = await listProposals(client, { dao, fromBlock: DAO_DEPLOY_BLOCK });
const status = await getStatus(client, { dao, proposalId: 1n }); // 'Voting' | 'Revealing' | 'Ready' | 'Passed' | 'Failed' | 'Executed' | 'Expired'
const proposal = await getProposal(client, { dao, proposalId: 1n });
```

## 3. Tempo

Toda janela é medida em rodadas do drand, não em blocos. `closeRoundFor`, `roundTime`, `votingOpen` e `revealOpen`
espelham exatamente a matemática de rodadas do `Sealed.sol` (testadas contra os mesmos 20 vetores compartilhados
com o contrato):

```ts
import { closeRoundFor, roundTime, votingOpen } from '@arcseal/sdk';

const now = Math.floor(Date.now() / 1000);
const closeRound = closeRoundFor(now, 600); // o que propose(..., 600) grava onchain
const closesAt = roundTime(closeRound);     // segundos unix, mostre ao lado do número da rodada
votingOpen(closeRound, now);                // true até closesAt
```

A janela de revelação é fixa em 24 h a partir da rodada de fechamento, não importa quanto tempo a votação durou —
então o mais cedo que qualquer proposta pode ser finalizada é 24 h depois de fechar. Veja
[a spec](/docs/spec/#tempo) para a linha do tempo completa.

## 4. Erros

As escritas são simuladas antes de serem enviadas, então a maioria dos reverts lança `ContractRevertError` antes de
qualquer envio. Uma transação ainda pode reverter onchain se o estado mudar entre a simulação e a inclusão (por
exemplo, a janela de votação fechando); nesse caso o `waitForSuccess` lança `TransactionRevertedError`. Transações
assinadas por uma conta local (uma chave ou keystore no mesmo processo) recebem uma margem de 20% de gás sobre a
estimativa do nó:

```ts
import { ContractRevertError } from '@arcseal/sdk';

try {
  await revealBatch(wallet, { dao, proposalId, voters, choices, salts });
} catch (err) {
  if (err instanceof ContractRevertError) {
    // err.errorName: 'NotMember' | 'SealingClosed' | 'RevealNotOpen' | 'NotPassed' | 'AlreadyExecuted' | ... | 'Error' | 'Panic' | 'Unknown'
    // 'Error' carrega a string de revert do próprio token, ex.: "Blacklistable: account is blacklisted" da USDC
  }
}
```

Outros erros do SDK (`DrandFetchError`, `InvalidBeaconError`, `InvalidInputError`, `WalletRequiredError`,
`ProposalNotFoundError`) estendem `ArcSealError` e devem ser tratados pelo `.code`, nunca pela mensagem. A lista
completa está no [README do SDK](https://github.com/r4topunk/arcseal/blob/main/packages/sdk/README.md#errors).

## 5. Leitura adicional

- [FAQ](/docs/faq/) — o que fica oculto, o que acontece se ninguém revelar ou o drand cair, e por que não há token.
- [Resumo da spec](/docs/spec/) — a spec técnica completa é
  [`docs/SPEC.md`](https://github.com/r4topunk/arcseal/blob/main/docs/SPEC.md) no GitHub.
- [`packages/sdk/README.md`](https://github.com/r4topunk/arcseal/blob/main/packages/sdk/README.md) — a referência
  completa da API do SDK.
