# Cidade

**Status:** parcial — protect zone com mapa, ponto de entrada e movimento (FUN-60, FUN-69),
**shard compartilhado** com entrada, saída e visibilidade entre jogadores (FUN-71),
**interest management por célula com teto de 200 por cópia** (FUN-33) e **a Thais real, com
andares e escadas, como mapa da Cidade** (FUN-120, ADR 0025); faltam loja, depósito e Market
(E5, E13)
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
próximo a pé** — busca em largura pelos tiles andáveis, no andar da entrada (`placeReachable`,
FUN-120). Sem isso, o segundo a chegar ficaria fora do mapa — invisível, sem andar, com o log
dizendo que entrou.

Era um anel geométrico de 16 tiles até a Thais chegar, e num templo com paredes o anel atravessa
a parede: o vigésimo a chegar apareceria do lado de fora do prédio, ou numa sala sem porta. A pé,
o lotado transborda pela porta. A busca visita até **1 089 tiles** (o quadrado do anel de 16), e o
número vem do teto de população: com os 289 de antes, duzentas pessoas ficariam ombro a ombro, sem
conseguir andar. Não é um raio de espalhamento — a busca começa na entrada, então quem chega num
templo vazio entra no tile de entrada. A hunt continua com o anel: ponto de spawn é lugar aberto.

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

## O mapa é a Thais real (FUN-120)

A Cidade é o recorte de Thais do `otservbr.otbm` (ADR 0025): `packages/content/data/maps/thais.json`,
184×139 tiles, andares 4 a 7, gerado por `pnpm map:import` (FUN-118) e conferido por `pnpm check`.
`city/city.json` aponta `mapId: "thais"`. O que é **autorado** no arquivo — e não gerado — são a
entrada e as escadas:

- **Nasce-se no templo**, em `(94, 88, 7)` — o `(32369, 32241, 7)` do mapa real, o mesmo tile
  em que o Huntera põe quem chega (§13 do estudo).
- **Cada escada é um par de `floorChanges`**, ida e volta: o degrau (aparência 1947) leva ao tile
  ao norte, um andar acima; o tile em cima do degrau leva ao tile ao sul do degrau, no andar do
  degrau. É o que o Huntera mostrou no depot — subir de `(75,73,7)` chega em `(75,72,6)`, descer
  de `(75,73,6)` chega em `(75,74,7)` — e vale para as 45 escadas do recorte, 90 entradas, todas
  com o destino andável. `load.test.ts` prende que toda escada tem a volta.
- **O templo não tem escada para cima**, e a do porão dele leva ao andar 8, que fica fora do
  recorte: pisar nela hoje é pisar num tile comum.

O servidor **diz qual mapa desenhar**: `instance-enter { instanceId, map }` sai no
`session-attach` e em toda transição, ANTES do `session-state`, e `session-state.world.mapId` é o
mesmo id. Era um opcode definido, tratado pelo cliente e nunca enviado. Desenhar a Thais — a pilha
de itens por tile, os andares de baixo sob um véu — é o cliente que faz (FUN-121); até lá ele
continua abrindo, com o mapa de teste na tela.

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

**Na Thais real** (`MAP=thais pnpm bench:city`, FUN-120), com todo mundo chegando no templo — a
hora do login — e depois espalhados pelas ruas, cada um num alvo a pé a intervalos iguais da
entrada:

| jogadores | onde | vizinhos por jogador | sem AOI | mensagens | sem AOI |
|---|---|---|---|---|---|
| 100 | todos no templo | 98,5 | 99 | 35 mil | 36 mil |
| 200 | todos no templo | 181,5 | 199 | 42 mil | 48 mil |
| 500 | todos no templo | 291,3 | 499 | 171 mil | 349 mil |
| 100 | espalhados | 9,1 | 99 | 19 mil | 191 mil |
| 200 | espalhados | 14,8 | 199 | 59 mil | 744 mil |
| 500 | espalhados | **44,2** | 499 | **376 mil** | **4,33 milhões** |

Na hora do login a AOI corta pouco — quinhentas pessoas no templo é uma multidão, e quem está ao
alcance da vista É a multidão. Espalhadas pelas ruas, quinhentas pessoas custam 44 vizinhos por
passo: mais que os 11 da praça sintética de 316×316, porque a Thais de 184×139 tem 21 mil tiles
andáveis e ruas estreitas que concentram, e ainda assim onze vezes menos que a sessão inteira.

**O Huntera usa um raio fixo de 16 tiles** (§13 do estudo); a nossa célula de 10 com dois limiares
dá um alcance efetivo entre 10 e 30 tiles, conforme a posição dentro da célula. Não mudamos agora:
o número que decide é o de vizinhos por jogador, e na Thais espalhada ele fica na mesma ordem do
raio do Huntera; trocar a célula por um raio custaria uma consulta por par a cada passo, e a
faixa morta dos dois limiares é o que evita o `appear`/`disappear` a cada passo na fronteira.

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
- O passo é FIXO — `city.stepDurationMs`, 150 ms — para todo mundo (FUN-119, ADR 0025); a
  fórmula do Tibia vale só na hunt. Escada é um passo com `z` diferente.
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
| Mapa e ponto de entrada | `thais`, entrada no templo `(94, 88, 7)` | `packages/content/data/city/city.json` (`mapId`), `packages/content/data/maps/thais.json` (`entryPoint`) |
| Escadas | 90 `floorChanges` (45 escadas, ida e volta) | `packages/content/data/maps/thais.json` — autorado; o resto do arquivo é gerado |
| Velocidade de passo | 150 ms por tile, fixo para todos (cópia do Huntera) | `packages/content/data/city/city.json`, `stepDurationMs` |
| Tiles visitados na busca de lugar na chegada | 1 089, a pé | `packages/sim/src/rulesets/city.ts` — geometria, não balanceamento |
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

**A Cidade é Thais, importada do mapa real** (ADR 0025, M11, em vigor desde a FUN-120). O PRD
descreve a Cidade como praça social sem dizer de onde vem o mapa; a decisão é um recorte do
`otservbr.otbm` com andares, e o desenho é a pilha de itens do Tibia. A praça 10×10 sobrevive só
como fixture de teste (`packages/server/src/testing/content.ts`).

**O passo na Cidade é fixo — 150 ms por tile, para todos** (decisão do usuário, 2026-09-11,
cópia do Huntera). A fórmula do Tibia (`chão × 1000 / speed`) vale só na hunt; o regime do PvP
se decide quando o PvP existir.
