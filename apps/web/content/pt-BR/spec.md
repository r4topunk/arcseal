# Resumo técnico

> Este é um resumo em linguagem simples. O documento normativo é o
> [`docs/SPEC.md`](https://github.com/r4topunk/arcseal/blob/main/docs/SPEC.md) no GitHub, que os contratos precisam
> seguir exatamente — leia-o para as pré-condições, efeitos, reverts e as tabelas completas de erros e eventos.

## O primitivo: `Sealed`

Um contrato abstrato, nunca implantado sozinho. Ele só entende "grupos": um grupo tem uma rodada de fechamento e
uma janela de revelação de 24 horas, e cada endereço pode selar exatamente um compromisso hash `bytes32` por grupo
antes do fechamento. Ele nunca olha dentro de um ciphertext e nunca verifica uma assinatura do drand — só compara
hashes depois que algo é descriptografado offchain e revelado. O tempo é medido em rodadas do drand quicknet:

```
roundTime(r) = QUICKNET_GENESIS + (r - 1) × QUICKNET_PERIOD    (genesis 2023-08-23T15:09:27Z, período de 3 s)
```

## O app: `SealedDAO`

Uma DAO com lista de membros (1 endereço = 1 voto) e um tesouro em USDC, com dois tipos de proposta:
**transferir USDC** para um endereço, ou **adicionar/remover um membro**. Cada proposta abre o seu próprio grupo
de selagem. O ciclo completo:

```
propose          rodada de fechamento         fim da janela de revelação        prazo de execução
   |     selagem       |       revelação              |    pronta/aprovada/reprovada   |
   |  (10 min – 7 d)    |     (fixa em 24 h)           |         (carência de 7 d)      |
   v                    v                              v                                v
 vote()              revealBatch()                finalize()                       execute()
```

- **Selagem.** Um membro chama `vote(id, commitment, ciphertext)` uma vez por proposta. O compromisso é
  `keccak256(abi.encode(proposalId, voter, choice, salt))` — um salt de 32 bytes gerado por CSPRNG o torna
  impossível de adivinhar, e vincular `proposalId` e `voter` impede replay entre propostas ou entre eleitores. O
  ciphertext (saída bruta do tlock, 423 bytes para um voto) vai só para calldata e um evento, nunca para o storage
  do contrato.
- **Revelação.** Depois da rodada de fechamento, qualquer pessoa descriptografa todos os ciphertexts offchain e
  chama `revealBatch(id, voters, choices, salts)`. Cada item só é aceito se seu hash bater com o compromisso
  vigente; qualquer outro caso é pulado, nunca causa revert. O tesouro paga a quem chamou um valor fixo e pequeno
  por voto validamente revelado, definido no deploy para cobrir o gás da chamada, sempre que a proposta atingiu o
  quórum e o tesouro consegue cobrir. Abaixo do quórum a proposta não pode ser aprovada, então as revelações dela não
  recebem pagamento: um membro sozinho não consegue esvaziar o tesouro com propostas descartáveis.
- **Quórum e resultado.** O quórum é medido sobre os votos **selados**, contra a contagem de membros congelada no
  momento em que a proposta foi criada. Se ela passa é medido só sobre os votos **revelados**: `forCount >
  againstCount`, e um empate faz a proposta falhar. Um voto que foi selado mas nunca revelado conta para o quórum
  e para mais nada.
- **Finalizar, executar, resgatar.** `finalize()` (qualquer pessoa, depois da janela de revelação de 24 h) fixa
  aprovação ou reprovação. `execute()` (qualquer pessoa, em até 7 dias após o fim da janela de revelação) aplica
  uma proposta aprovada. Todo pagamento — uma transferência executada ou um pagamento de revelação — só credita um
  saldo interno; **`claim()` é a única função que movimenta USDC**, e sempre paga a própria pessoa que a chama.
  Isso significa que um destinatário bloqueado ou que não reage nunca consegue travar a transferência, a
  revelação ou o resgate de mais ninguém.

## Tempo

A janela de revelação é **fixa em 24 horas** a partir da rodada de fechamento, qualquer que tenha sido a duração
da votação — mesmo uma proposta de 10 minutos não pode ser finalizada antes de sua janela de revelação se
encerrar. Ou seja, o mais rápido que qualquer proposta pode ir do fechamento até a finalização é exatamente 24
horas; o que pode ser rápido é do fechamento até a **revelação** (o beacon do drand da rodada de fechamento é
publicado no próprio fechamento, e um único `revealBatch` já pode ser enviado em seguida). Uma proposta aprovada ainda tem mais 7
dias para ser executada antes de expirar sem execução.

## Imutabilidade

Sem dono (owner), sem upgrade, sem pausa, sem nenhuma função administrativa. O token do tesouro, o quórum e o
valor do pagamento por revelação são fixados para sempre no deploy. A lista de membros só muda através de uma
proposta aprovada e executada — nada mais pode adicionar ou remover um membro, e o último membro nunca pode ser
removido. Uma proposta nunca pode pagar nem adicionar a própria DAO ou o token USDC, que jamais conseguiriam
resgatar ou votar.

## Garantias que este design **não** oferece

- **Anonimato.** Votar é uma transação a partir do seu próprio endereço; selar oculta a escolha, não quem votou.
- **Resistência à coerção.** Um eleitor sempre pode provar o próprio voto a um terceiro entregando o seu
  comprovante.
- **Proteção contra a maioria dos membros em conluio.** Membros que atingem o quórum e detêm a maioria dos votos
  revelados podem aprovar e executar qualquer proposta, incluindo uma que pague o tesouro inteiro para si mesmos.

Nenhuma dessas é uma falha a ser corrigida depois — são o modelo de confiança aceito de um tesouro pequeno,
votado pelos próprios membros. Veja o
[modelo de ameaças completo](https://github.com/r4topunk/arcseal/blob/main/docs/THREATS.md) para cada ameaça
considerada e como ela é tratada.

## De onde vêm os números

A criptografia com trava de tempo (timelock) usa o [drand](https://drand.love) quicknet como relógio e uma versão
vendorizada, só para quicknet, do [tlock](https://github.com/drand/tlock) como cifra — sem verificação BLS
onchain, sem relayer, sem contrato singleton. Toda constante, as pré-condições e efeitos exatos de cada função,
todo evento e erro, e as medições completas de gás estão em:

- [`docs/SPEC.md`](https://github.com/r4topunk/arcseal/blob/main/docs/SPEC.md) — a spec técnica normativa
- [`docs/THREATS.md`](https://github.com/r4topunk/arcseal/blob/main/docs/THREATS.md) — o modelo de ameaças completo
- [`docs/GAS.md`](https://github.com/r4topunk/arcseal/blob/main/docs/GAS.md) — gás medido e custo em USDC por chamada
