# Cidade

**Status:** parcial — protect zone com mapa, ponto de entrada e movimento (FUN-60, FUN-69),
**shard compartilhado** com entrada, saída e visibilidade entre jogadores (FUN-71) e
**interest management por célula com teto de 200 por cópia** (FUN-33); faltam loja, depósito e
Market (E5, E13)
**PRD:** §6, §37
**Épico:** E1 (sessão e visualizador)
**Referência técnica:** [ADR 0004](../adr/0004-city-as-protect-zone.md) (Cidade como protect
zone), [ADR 0023](../adr/0023-the-city-is-a-shard.md) (a Cidade é um shard)

## Comportamento

A Cidade é onde o personagem está quando não está em outra coisa. Não é um menu nem um estado
"sem sessão": é uma sessão como qualquer outra, com mapa, tiles e movimento — só que **orientada
a evento**, sem laço de simulação. Ela custa perto de zero quando ninguém faz nada.

Entrar no jogo é entrar na Cidade. Morrer devolve para ela, com vida e mana cheias (§26.1). Sair
de uma hunt, por regra do bot ou por vontade do jogador, devolve para ela. É o invariante 8 em
comportamento: "a hunt acabou" nunca significa "ele ficou sem sessão".

**É protect zone:** nada causa dano, nada morre. Combate na Cidade não existe, e não porque foi
esquecido — é o ADR 0004.

## Uma cópia, muitos personagens (FUN-71)

A Cidade é o **shard**: uma cópia por processo `game`, com todo mundo daquele nó dentro. É a única
sessão do jogo assim — hunt, quest, boss e guild war são instanciadas por quem entra.

Até a FUN-71 ela era o contrário disso, e ninguém tinha notado: `createCitySessionFactory` criava
uma sessão **por personagem**, então a praça existia N vezes, vazia em todas. Dois jogadores no
mesmo lugar do mundo não se viam, e o `say` de alcance "sessão inteira" alcançava só o autor.

O que a cópia compartilhada dá:

- cada um vê os outros no `session-state` ao entrar;
- quem chega manda `creature-appear` para quem já estava, e quem sai manda `creature-disappear`
  para quem fica — esquecer o segundo deixa fantasma na tela, um boneco parado que não
  corresponde a ninguém;
- o passo de um chega aos outros como `creature-move`;
- o `say` alcança a praça, que é o que a FUN-58 sempre especificou.

**"Cidade 2" nasce de duas formas.** Dois processos `game` já são duas cópias, sem nada a mais; e
uma cópia que chega a **200 pessoas** abre a próxima no mesmo nó. Escolher em qual entrar — para
achar um amigo — ainda não existe.

### Chegar e sair

O ponto de entrada é **um tile**, e tile é exclusivo. Quem chega entra nele ou no **livre mais
próximo**, na mesma ordem fixa que o respawn da hunt usa. Sem isso, o segundo a chegar ficaria
fora do mapa — invisível, sem andar, com o log dizendo que entrou.

A busca vai até **16 tiles**, e o número vem do teto de população: com os 8 de antes seriam 289
tiles ao redor da entrada, e duzentas pessoas ali ficariam ombro a ombro, sem conseguir andar. Não
é um raio de espalhamento — a busca começa no centro, então quem chega numa praça vazia entra no
tile de entrada.

Sair é `Session.leave`, não `end`. Antes da FUN-71 sair só sabia ser encerrar, e um jogador
fechando o jogo na praça levaria a praça junto. Quando o **último** sai, a cópia é descartada; a
próxima entrada cria outra, já na versão de conteúdo do momento — uma praça que ninguém frequenta
e atravessa três deploys continuaria rodando a versão do primeiro (invariante 7).

### A praça não tem extrato nem snapshot

A Cidade não credita nada (§37): não há progresso a guardar. E um snapshot dela guardaria a praça
inteira, uma cópia por participante, a cada dez segundos. **Quem entra, entra do zero.**

Isso tem uma obrigação junto: ao voltar de uma hunt, o snapshot **da hunt** é apagado, não apenas
deixado de reescrever. Sem isso, quem morre volta para a praça, o snapshot da hunt já creditada
fica de pé no Redis, e a próxima conexão retoma uma hunt encerrada.

### Desconectar não tira ninguém da praça na hora

A carência de repouso (FUN-52) vale por **personagem**, não pela sessão: cinco minutos sem ninguém
olhando para ELE, e o personagem é recolhido. Contar por sessão diria o contrário do que a regra
quer — um jogador com o navegador aberto seguraria todo mundo na memória do nó.

Durante esses cinco minutos o personagem desconectado **fica de pé na praça**, visível para os
outros. É o mesmo comportamento de antes da praça compartilhada; a diferença é que agora há
testemunhas.

## Cada passo vai para quem está por perto (FUN-33)

Com a praça compartilhada, a transmissão passou a crescer com o **quadrado** da população: cada
passo de cada um ia para todos os outros. A conta que a issue usa — 2.000 jogadores × 2 passos por
segundo × 2.000 destinatários = 8 milhões de mensagens por segundo — é a projeção disso.

O campo de visão é por **célula de 10 tiles**, e o tamanho vem da câmera: a tela alcança 9,5 tiles
para os lados do personagem, e uma célula de distância cobre pelo menos 10 em qualquer direção. O
que o servidor manda e o que a tela mostra são a mesma coisa; menos que isso e aparece buraco onde
deveria haver criatura.

**A visibilidade é simétrica.** Se eu te enxergo, você me enxerga — assimetria seria alguém
aparecendo na sua tela sem você aparecer na dele, e a primeira consequência é combate contra quem
não se vê.

**Dois limiares, com faixa morta no meio.** O par passa a se enxergar a uma célula e só deixa de
se enxergar passando de três. Com um limiar só, dois jogadores oscilando em torno do limite geram
um `creature-appear` e um `creature-disappear` por passo — mais tráfego do que a AOI economizou. É
a mesma máquina do lure e do ring swap do bot (FUN-87), no eixo da distância.

O `say` de canal `local` tem o **mesmo alcance**. Numa praça de duzentos, "local" alcançando
duzentos é o canal global com outro nome.

### Medido

`pnpm bench:city`, com as pessoas espalhadas pelo mapa:

| jogadores | vizinhos por jogador | sem AOI | mensagens | sem AOI |
|---|---|---|---|---|
| 100 | 12,0 | 99 | 26 mil | 199 mil |
| 200 | 14,7 | 199 | 63 mil | 796 mil |
| 500 | **11,1** | 499 | **96 mil** | **4,96 milhões** |

Quintuplicar a população não mexeu em quantos recebem cada passo — é a propriedade que a issue
pede. Sem interest management, o total de mensagens cresce 25 vezes para 5 vezes mais gente.

**Na Cidade de hoje o ganho é pequeno, e isso é sobre a Cidade.** Com um ponto de entrada e mais
nada, todo mundo fica no mesmo punhado de tiles, e quem está ao alcance da vista É a praça inteira:
500 jogadores dão 374 vizinhos em vez de 499. A AOI não tem o que cortar enquanto ninguém se
espalha — o corte aparece quando a Cidade tiver loja, depósito e ruas.

## Regras

- Protect zone: nada causa dano, ninguém morre (ADR 0004, §37).
- Orientada a evento — `hz` é 0. Nenhum evento é agendado na Cidade, e receber um é bug de outro
  sistema: o ruleset falha alto em vez de queimar CPU no único espaço compartilhado do jogo.
- Voltar à Cidade cura HP e mana por completo (§26.1). Quem cura é a entrada, não a transição.
- Movimento passa pelo mesmo sistema da hunt e do bot (FUN-69): `movement.ts` é o único escritor
  de posição, e a Cidade não é exceção.
- Uma cópia por processo `game`; muitos personagens por cópia.
- Sair de um shard é `leave` — a sessão continua para quem ficou.
- A cópia vazia é descartada.
- Shard não tem extrato nem snapshot.
- Repouso é por personagem.
- Cada passo vai para quem tem o tile no campo de visão, nunca para a sessão inteira.
- O campo é simétrico e tem dois limiares: entra a uma célula, sai passando de três.
- Teto de 200 por cópia; encheu, abre a próxima. Ninguém é recusado.
- `say` de canal `local` alcança o campo de visão.

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora |
|---|---|---|
| Mapa e ponto de entrada | `city.mapId` e `entryPoint` do tilemap | `packages/content/data/maps` |
| Velocidade de passo | 500 ms por tile `[ABERTO — valor provisório: 500]` | `packages/content/data/progression/baseline.json` |
| Raio de busca de tile livre na chegada | 16 tiles | `packages/sim/src/rulesets/city.ts` — geometria, não balanceamento |
| Carência de repouso | 5 min | `packages/server/src/game/host.ts` |
| Teto de população por cópia | 200 | `CITY_SHARD_CAPACITY`, em `packages/server/src/game/sessions.ts` — configuração de nó, não conteúdo |
| Célula do campo de visão | 10 tiles | `packages/server/src/game/aoi.ts` — derivada da câmera, não escolhida |
| Limiares do campo | entra a 1 célula, sai passando de 3 | `packages/server/src/game/aoi.ts` |

## Em aberto

- Loja, depósito e Market na Cidade (E5, E13). São eles que fazem as pessoas se espalharem — e é
  espalhadas que o interest management corta o que veio cortar.
- Escolher em qual cópia entrar, para achar um amigo (§13). Hoje quem chega vai para a primeira
  com vaga.
- [ABERTO] O que mais a Cidade é — praça social, hub de navegação, ou as duas. O PRD não decide,
  e é o que trava o canal global do [chat](./chat.md).

## Divergências do PRD

**A Cidade é Thais, importada do mapa real** (ADR 0025, M11). O PRD descreve a Cidade como
praça social sem dizer de onde vem o mapa; a decisão é um recorte do `otservbr.otbm` com andares,
e o desenho é a pilha de itens do Tibia. Até a FUN-120 entrar, o mapa em vigor continua a praça
10×10.

**O passo na Cidade é fixo — 150 ms por tile, para todos** (decisão do usuário, 2026-09-11,
cópia do Huntera). A fórmula do Tibia (`chão × 1000 / speed`) vale só na hunt; o regime do PvP
se decide quando o PvP existir.
