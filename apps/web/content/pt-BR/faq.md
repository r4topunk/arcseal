# Perguntas frequentes

## O que fica oculto, e até quando?

Só a **escolha** — A favor, Contra ou Abstenção — fica oculta, e só **durante a votação**. Selar um voto é uma
transação normal a partir da sua própria carteira: o fato de você ter votado, quando, e o seu endereço já ficam
públicos no momento em que a transação é incluída. O que ninguém consegue ler, nem mesmo o contrato, é qual
escolha você selou, até o drand publicar a rodada de fechamento daquele voto.

Assim que essa rodada se torna pública, qualquer pessoa pode descriptografar todos os votos selados e enviá-los
onchain. A partir desse momento, **cada voto fica público por endereço, para sempre** — isso não é anonimato, e
nunca foi. Veja o que o design não oferece no
[resumo técnico](/docs/spec/#garantias-que-este-design-nao-oferece).

## O que acontece se ninguém revelar um voto?

Um voto não revelado ainda conta para o quórum (ele foi selado), mas não conta para mais nada — nem a favor, nem
contra, nem abstenção. Se literalmente ninguém revelar uma proposta, ela é finalizada com zero votos dos dois
lados, e um empate faz a proposta falhar.

Na prática isso dificilmente é um problema real: revelar é permissionless, descriptografar e enviar todos os votos
é um clique no site ("Revelar votos") ou uma chamada do SDK, e, numa proposta que atingiu o quórum, quem enviar a
transação que revela os votos recebe um pequeno pagamento fixo por voto revelado, que cobre o gás daquela chamada
quando o tesouro tem saldo para isso. Qualquer pessoa interessada no resultado pode revelar todo mundo em uma única
transação.

## E se o drand estiver fora do ar quando a rodada de um voto fechar?

O drand quicknet é **unchained**: a assinatura de uma rodada não depende de nenhuma rodada anterior, então pode
ser buscada e verificada assim que a rede voltar. Uma queda só atrasa a revelação se o drand voltar dentro da
janela fixa de 24 horas. Se ficar fora do ar por mais tempo, todo voto que ninguém revelou conta só para o quórum.
O SDK também tenta três relays independentes em sequência antes de desistir.

Além disso, o app guarda o `{choice, salt}` do seu próprio voto no navegador no momento em que você o sela (e
oferece isso como um arquivo para baixar). Você já sabe o conteúdo do seu próprio voto, então você — ou qualquer
pessoa a quem você repasse o arquivo — pode revelá-lo sem depender do drand.

## O que acontece se um membro entra ou sai enquanto uma votação está aberta?

A condição de membro é verificada **no momento**, quando você sela um voto — não contra uma foto tirada quando a
proposta foi criada. Duas consequências, ambas intencionais:

- Um membro **removido** depois que uma proposta é aberta não pode mais selar um novo voto nela, mas um voto que
  ele já tinha selado antes da remoção não é apagado: continua contando em tudo o que já contaria.
- Um membro **adicionado** enquanto uma proposta ainda está aberta também pode selar um voto nela, mesmo sem ser
  membro no momento em que ela foi criada.

O limite de quórum em si é sempre medido contra a contagem de membros congelada no momento em que a proposta foi
criada, então isso nunca muda o que "votos suficientes" significa para aquela proposta.

## Quanto custa?

Tudo é pago em USDC, o mesmo ativo que o tesouro guarda — não existe um token de gás separado. Os números medidos
estão em [`docs/GAS.md`](https://github.com/r4topunk/arcseal/blob/main/docs/GAS.md); aproximadamente:

| Ação | Custo |
|---|---:|
| Selar um voto | ≈ 0,0014 USDC |
| Revelar um voto | ≈ 0,0003 – 0,002 USDC, dependendo do tamanho do lote (0,002 sozinho, 0,001 num lote de 3) |
| Finalizar | ≈ 0,0007 USDC |
| Executar uma proposta aprovada | ≈ 0,0014 USDC |
| Resgatar (claim) um pagamento | ≈ 0,001 USDC |

## Por que existe um pagamento por revelar votos?

Revelar é um trabalho que alguém precisa fazer onchain depois que a votação fecha: descriptografar cada voto e
enviar uma transação. O tesouro paga um valor pequeno e fixo por voto validamente revelado a quem chamar
`revealBatch`, definido no deploy para cobrir o gás daquela chamada com qualquer tamanho de lote. Ele só é pago
numa proposta que atingiu o quórum: abaixo do quórum a proposta não pode ser aprovada, então revelá-la não muda
nenhum resultado, e pagar por isso deixaria um único membro esvaziar o tesouro com propostas descartáveis. Se o
tesouro não conseguir cobrir o pagamento numa chamada, a revelação continua acontecendo normalmente e o pagamento
simplesmente é pulado naquela chamada. Não é uma compensação ligada ao resultado da votação de forma alguma: existe
só para que ninguém precise revelar votos no prejuízo.

## Por que não existe um token?

Não existe token, venda, rendimento, prêmio nem sorteio no ArcSeal. É um primitivo de votação e tesouraria:
carteiras de membros selam votos, uma proposta aprovada movimenta USDC ou muda a lista de membros, e a única outra
movimentação de fundos é o pequeno pagamento fixo por voto revelado, creditado pela tesouraria. Essa é uma
restrição de design deliberada, não um descuido: ela mantém o ArcSeal estritamente como uma ferramenta de
governança, sem nenhuma das questões legais e de confiança que um token, um prêmio, um jogo de azar ou a guarda do
dinheiro de outras pessoas trariam.

## O ArcSeal é auditado? Posso confiar nele com fundos reais?

O ArcSeal não foi auditado, e não tem histórico de uso real para mostrar. Trate-o como experimental e mantenha os
valores baixos, do mesmo jeito que faria com qualquer contrato novo e não auditado.

## Posso revelar só o meu próprio voto?

Sim. Use o comprovante que o app salvou (ou que você baixou) quando selou o seu voto:
`buildRevealBatch([seuComprovante])`, depois `revealBatch(...)` com o resultado. Isso revela só aquele voto, e o
mesmo pagamento pequeno e fixo por voto revelado se aplica se a proposta atingiu o quórum e o tesouro conseguir
cobri-lo.

## O que acontece com uma proposta que nunca atinge quórum?

Ela é finalizada como **reprovada**. O quórum é medido sobre os votos selados contra a contagem de membros no
momento em que a proposta foi criada; se poucos membros selaram um voto, a proposta não pode passar não importa
como os votos revelados se dividam. Os votos ainda podem ser revelados, mas o tesouro não credita pagamento por
revelação para eles. Nada é movimentado e nada mais acontece — o tesouro e a lista de membros continuam exatamente
como estavam.

## Este site me rastreia?

Nenhum analytics, rastreador ou cookie. O app só conversa com o RPC da Arc, a API HTTP do drand e a sua carteira,
e serve as próprias fontes. A página do projeto carrega a fonte do Google Fonts.
