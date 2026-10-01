# Cidade

**Status:** parcial — protect zone com mapa, ponto de entrada e movimento (FUN-60, FUN-69),
**shard compartilhado** com entrada, saída e visibilidade entre jogadores (FUN-71),
**interest management por célula com teto de 200 por cópia** (FUN-33) e **a Thais real, com
andares e escadas, como mapa da Cidade** (FUN-120, ADR 0025); o custo do leque de saída está
medido (OW-07, #828); faltam loja, depósito e Market (E5, E13)
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
templo vazio entra no tile de entrada. A hunt não busca nada: o spawn é um `place` seco num ponto
aberto.

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

### O que "não credita" quer dizer no `sim` (OW-03, ADR 0060 d.10b)

Até aqui a Cidade não creditar era o mesmo que ser shard (`Ruleset.shared`), e o hospedeiro lia
um campo para as duas perguntas. O ADR 0060 torna a Cidade o primeiro mundo — um shard que
**credita** —, e o `sim` já separa as duas coisas, sem mudar o comportamento de ninguém:

- **`Ruleset.shared`** diz só "sair é `leave`".
- **`Ruleset.progress`** (`'none' | 'checkpointed'`) diz se a sessão credita. `progressOf(ruleset)`
  devolve o valor resolvido, que o hospedeiro passa a ler na OW-04: ausente, a sessão privada é
  `'at-end'` (credita no `end`) e a compartilhada é `'none'`. **A Cidade e a hunt não declaram o
  campo**, então nada muda para elas enquanto `OPEN_WORLD` não existe.
- **`Session.checkpoint(characterId, reason)`** emite o extrato de quem continua na sessão e
  recomeça a contar dele, com a semântica de delta do `leave`: o segundo checkpoint leva só o que
  rendeu desde o primeiro, o `seq` cresce, e o `leave`/`end` seguinte leva só o resto. Não zera a
  soma da sessão, não toca a janela de DPS, não sorteia nem agenda — o resultado é o mesmo com ou
  sem checkpoint, a 1 Hz ou a 10 Hz. Nenhum hospedeiro o chama ainda (OW-16).
- **Tetos por sessão**: `maxPendingDomainEvents` e `maxEventsPerAdvance` (default, as constantes
  de hoje) e `maxNotableEventsPerCharacter` (sem default — sem ele a lista cresce sem limite, como
  sempre cresceu). É o que permite ao mundo aparar a lista de eventos notáveis sem que a hunt
  perceba.

### Desconectar não tira ninguém da praça na hora

A carência de repouso (FUN-52) vale por **personagem**, não pela sessão: cinco minutos sem ninguém
olhando para ELE, e o personagem é recolhido. Contar por sessão diria o contrário do que a regra
quer — um jogador com o navegador aberto seguraria todo mundo na memória do nó.

Durante esses cinco minutos o personagem desconectado **fica de pé na praça**, visível para os
outros. É o mesmo comportamento de antes da praça compartilhada; a diferença é que agora há
testemunhas.

## Andar (FUN-122)

Setas e WASD andam, **só nas quatro cardeais** — com duas teclas presas vale a pressionada por
último, nunca a diagonal —, e a tecla presa repete o passo no ritmo do passo: 150 ms por tile na
Cidade, o que o Huntera faz (§14 do estudo). Soltar para no tile. Digitar num campo de texto —
o painel do bot, a entrada; o chat ainda não tem caixa — não anda, e perder o foco da janela
solta tudo. ↑ e W são duas teclas para o mesmo norte: soltar uma com a outra presa continua.

**A repetição é do cliente, e o ritmo é do servidor.** A Cidade é orientada a evento (`hz` 0) e
não tem relógio para repetir um `walk` até um `walk-stop`, então é o cliente que reenvia — um
`walk` por passo, quando o passo próprio acaba (`creature-move`) ou 150 ms depois se nenhum
chegou (parede à frente). Cada `walk` continua sendo a intenção de UM tile (invariante 4), e o
hospedeiro recusa em silêncio o que chega antes de o passo anterior acabar: um cliente que
mandasse mil por segundo continuaria andando a 150 ms por tile — e o mesmo vale na hunt, onde a
rajada antes furava a fórmula do Tibia. Escada é um `walk` como outro: o passo chega com `z`
diferente. Os 150 ms de reserva do cliente são uma cópia de `city.stepDurationMs`, presa por
teste; só decidem com que frequência se insiste contra uma parede.

## O mapa é a Thais real (FUN-120)

A Cidade é o recorte de Thais do `otservbr.otbm` (ADR 0025): `packages/content/data/maps/thais.json`,
184×139 tiles, andares 4 a 7, gerado por `pnpm map:import` (FUN-118) e conferido por `pnpm check`.
`city/city.json` aponta `mapId: "thais"`. O que é **autorado** no arquivo — e não gerado — são a
entrada e as escadas:

- **Nasce-se no templo**, em `(94, 88, 7)` — o `(32369, 32241, 7)` do mapa real, o mesmo tile
  em que o Huntera põe quem chega (§13 do estudo).
- **Cada escada é um par de `floorChanges`**, ida e volta: o degrau (aparência 1947, ou a
  variante 1958, que aparece uma vez) leva ao tile ao norte, um andar acima; o tile em cima do
  degrau leva ao tile ao sul do degrau, no andar do degrau. É o que o Huntera mostrou no depot —
  subir de `(75,73,7)` chega em `(75,72,6)`, descer de `(75,73,6)` chega em `(75,74,7)` — e vale
  para as 46 escadas do recorte, 92 entradas, todas com os quatro tiles andáveis. `load.test.ts`
  prende que toda escada tem a volta.
- **O templo não tem escada para cima**, e a do porão dele leva ao andar 8, que fica fora do
  recorte: pisar nela hoje é pisar num tile comum.

O servidor **diz qual mapa desenhar**: `instance-enter { instanceId, map }` sai no
`session-attach` e em toda transição, ANTES do `session-state`, e `session-state.world.mapId` é o
mesmo id. Era um opcode definido, tratado pelo cliente e nunca enviado. Desenhar a Thais é o
cliente (FUN-121): a pilha de itens por tile na ordem do Tibia, e **os andares de baixo sob um
véu** — na superfície vê-se do andar do jogador até o 7, cada nível abaixo deslocado um tile para
baixo e para a direita; nada acima dele, sem telhado. No subsolo, só o andar do jogador.

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

`MAP=square pnpm bench:city` (a praça sintética de antes da Thais), com as pessoas espalhadas pelo
mapa:

| jogadores | vizinhos por jogador | sem AOI | mensagens | sem AOI |
|---|---|---|---|---|
| 100 | 12,0 | 99 | 26 mil | 199 mil |
| 200 | 14,7 | 199 | 63 mil | 796 mil |
| 500 | **11,1** | 499 | **96 mil** | **4,96 milhões** |

Quintuplicar a população não mexeu em quantos recebem cada passo — é a propriedade que a issue
pede. Sem interest management, o total de mensagens cresce 25 vezes para 5 vezes mais gente.

**Na Thais real** (`pnpm bench:city`, hoje o padrão; FUN-120), com todo mundo chegando no templo — a
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
passo: mais que os 11 da praça sintética de 313×313, porque o andar 7 da Thais de 184×139 tem
15 mil tiles andáveis, dos quais 11 mil alcançáveis a pé do templo, e ruas estreitas que
concentram — e ainda assim onze vezes menos que a sessão inteira.

**O Huntera usa um raio fixo de 16 tiles** (§13 do estudo); a nossa célula de 10 com dois limiares
dá um alcance efetivo entre 10 e 30 tiles, conforme a posição dentro da célula. Não mudamos agora:
o número que decide é o de vizinhos por jogador, e na Thais espalhada ele fica na mesma ordem do
raio do Huntera; trocar a célula por um raio custaria uma consulta por par a cada passo, e a
faixa morta dos dois limiares é o que evita o `appear`/`disappear` a cada passo na fronteira.

**Na Cidade de hoje o ganho é pequeno, e isso é sobre a Cidade.** Com um ponto de entrada e mais
nada, todo mundo fica no mesmo punhado de tiles, e quem está ao alcance da vista É a praça inteira:
500 jogadores dão 374 vizinhos em vez de 499. A AOI não tem o que cortar enquanto ninguém se
espalha — o corte aparece quando a Cidade tiver loja, depósito e ruas.

**As duas tabelas de mensagens acima são anteriores ao FUN-122 e não se reproduzem mais.** O bench
de então fixava o relógio do hospedeiro em zero; desde que o hospedeiro recusa o `walk` adiantado
(um passo por vez, FUN-122) todo passo depois do primeiro era recusado, e a tabela continuava saindo
— 100 pessoas no templo davam 7,5 mil mensagens em vez das 35 mil publicadas, e a dispersão parava
na quarta rodada. O número que continua valendo é o de **vizinhos por jogador**, que a tabela nova
repete; os totais de mensagens passam a ser os dela.

### Custo do leque de saída (OW-07, #828)

Até aqui o bench só contava mensagem. O ADR 0060 aposta que o que cede primeiro quando o mundo
enche é o **leque de saída** — cada passo vira uma mensagem por vizinho, codificada uma vez por
destinatário em `viewer.ts` — e não a CPU do `sim`. O OW-22 vai mexer nesse leque, e precisa de um
antes para comparar: `pnpm bench:city` agora reporta, por cenário, a **CPU por ciclo** (p50 e p99),
os **bytes por visualizador por segundo** e a **fila máxima por flush**.

**Como se mede.**

- `SessionHost`, `CityShard` e `Viewer` de verdade, com o codec real (`encodeS2C` + `packBatch`).
  O socket só conta os bytes do frame; o uWS roda sem compressão (`server.ts` não configura
  `compression`), então o frame é o fio, mais 2 a 10 bytes de cabeçalho do WebSocket por quadro.
- Relógio simulado, no ritmo de produção: o passo da Cidade é de 150 ms (`city.json`) e o
  hospedeiro fecha um ciclo a cada 100 ms (`CYCLE_MS` em `host.ts`), com um frame por visualizador.
  Cada jogador pisa uma vez por período de passo, defasado dos outros. Um teste prende que o
  `CYCLE_MS` do bench é o do hospedeiro.
- CPU é `process.cpuUsage()` em volta dos `walk` do ciclo (enfileirar: movimento, AOI, montar a
  mensagem de cada destinatário) e do `host.cycle` (esvaziar: codificar e escrever). `p99 / ciclo` é
  o p99 de CPU como fração dos 100 ms.
- 200 passos medidos por jogador (300 ciclos) depois de 30 de aquecimento; no cenário espalhado,
  cada um caminha antes até o próprio alvo. Cada linha é a melhor de 2 rodadas (`REPEAT=2`, a de
  menor p50 de CPU).

**Máquina:** Apple M2, 8 núcleos (4 de desempenho e 4 de eficiência), `darwin arm64`, Node 24.14.1,
8 GiB — a máquina de desenvolvimento, **com outros processos rodando** (carga de 10 a 22 durante a
medição). O `cpuUsage` não conta o tempo em que o processo esteve preemptado, e a CPU do processo
ficou em 78 a 107 % da parede; mesmo assim um núcleo disputado é um núcleo mais lento: numa
execução anterior, com a carga de 17 a 25 e a CPU em 30 % da parede, as mesmas linhas deram de 1,5
a 2,6 vezes estes valores. **Leia as colunas de CPU como teto**, e compare antes e depois sempre na
mesma máquina, sob carga parecida. A medição no destino (ADR 0013) continua por fazer.

Todo mundo no templo, como na hora do login:

| jogadores | vizinhos | passos/s | CPU p50 µs | CPU p99 µs | flush p50 µs | p99 / ciclo | B/vis/s | msg/vis/s | fila máx | quedas |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 98,7 | 2,3 | 4.206 | 10.861 | 2.809 | 10,9 % | 21.735 | 228 | 32 | 0 |
| 200 | 181,5 | 1,0 | 8.749 | 25.871 | 5.260 | 25,9 % | 16.822 | 175 | 50 | 0 |
| 500 | 293,8 | 1,1 | 65.396 | 113.972 | 22.877 | 114,0 % | 26.547 | 275 | 77 | 0 |

As pessoas espalhadas pelas ruas:

| jogadores | vizinhos | passos/s | CPU p50 µs | CPU p99 µs | flush p50 µs | p99 / ciclo | B/vis/s | msg/vis/s | fila máx | quedas |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 7,8 | 6,4 | 1.016 | 4.170 | 666 | 4,2 % | 5.478 | 56 | 13 | 0 |
| 200 | 16,0 | 6,4 | 4.416 | 13.217 | 2.463 | 13,2 % | 10.552 | 109 | 23 | 0 |
| 500 | 37,9 | 6,3 | 53.179 | 98.825 | 17.703 | 98,8 % | 23.601 | 243 | 53 | 0 |

**Como ler.** `passos/s` são os passos *aceitos* por jogador por segundo; o ideal é 6,7 (1000 ÷ 150).
Espalhados chega perto. No templo fica em 1 a 2: tile é exclusivo, e quinhentas pessoas num salão só
andam quando alguém sai da frente — a linha mede uma multidão quase parada, que é o login. `CPU µs`
soma os `walk` do ciclo e o `host.cycle`; `flush` é só a parte que codifica e escreve. `fila máx` é a
maior fila de um visualizador no instante do flush, contra o teto de 512 do `Viewer`. `quedas` conta
os visualizadores derrubados por esse teto; diferente de zero, a linha não mede o jogo.

**O que a linha de base mostra.**

- **O ciclo de 500 pessoas está no limite dos 100 ms.** O p50 de CPU é de 53 ms (espalhados) e de
  65 ms (templo), e o p99 chega a 99 e 114 ms: sem folga, num nó em que o `sim` ainda nem roda
  monstro. Com 100 e 200 pessoas há folga larga — p99 de 4 a 26 ms.
- **O que cresce é enfileirar, e não codificar.** Dividindo a CPU p50 pelas mensagens entregues por
  ciclo (jogadores × msg/vis/s ÷ 10), o custo por mensagem entregue passa de 1,8–2,5 µs (100 e 200)
  para 4,4–4,8 µs (500). O `flush` (codificar e escrever) quase não se mexe — de 1,1 a 1,7 µs por
  mensagem —; o resto (CPU p50 menos `flush` p50, o `walk`) vai de 0,6 a 3,1 µs, quase na proporção
  dos visualizadores. É a assinatura de `#sendToViewersOf`, que percorre todos os visualizadores
  para achar os de cada destinatário: custo por passo de vizinhos × visualizadores. Um perfil
  anterior (`node --cpu-prof`, 500 no templo, processo inteiro, carregamento do conteúdo incluído)
  pôs no topo `buildFrame` do codec (11,7 %), a coleta de lixo (9,9 %), `#presentMoves` (9,1 %),
  `#sendToViewersOf` (6,3 %) e o `TextEncoder` (6,1 %).
- **Uma mensagem custa cerca de 96 bytes, em todas as linhas** (B/vis/s ÷ msg/vis/s dá de 95 a 98).
  `creature-move` é `[opcode, {id, from, to, durationMs}]` em JSON, com 5 bytes de cabeçalho próprio
  e 4 de prefixo no lote; e o lote nunca é comprimido — `packBatch` só marca `BATCH_FLAG`, e a
  compressão do `buildFrame` só vale por mensagem de 8 KiB ou mais. Com 500 espalhados são 24 KB/s
  por visualizador (cerca de 190 kbit/s) e 11,8 MB/s para a praça inteira; com 500 no templo, 13,3
  MB/s.
- **A fila não é o limite hoje.** O máximo foi de 77 mensagens (templo, 500) contra o teto de 512,
  com zero quedas em todas as linhas. Ela cresce com vizinhos × passos por ciclo, e o templo de 500
  anda a um sexto da velocidade: uma multidão que andasse inteira mediria bem mais.

**O que esta medição não cobre.**

- O passo é um zigue-zague de um tile (norte, leste, sul, oeste), então quase ninguém cruza a
  célula da AOI e `creature-appear` / `creature-disappear` ficam sub-representados.
- É só movimento de jogador na Thais pacífica: sem monstro, golpe, magia, chat nem os
  `player-stats` e inventário dos ciclos reais.
- Uma cópia só, com o teto alargado para caber todos; o teto de 200 por cópia do FUN-33 não vale
  aqui. Só o andar 7.
- `pnpm bench:city` com `AOI=both` roda também o grupo de controle (a sessão inteira); `MAP=square`
  roda a praça sintética; `FORMAT=markdown` imprime a tabela pronta para esta página.

## Regras

- Protect zone: nada causa dano, ninguém morre (ADR 0004, §37).
- Orientada a evento — `hz` é 0. Nenhum evento é agendado na Cidade, e receber um é bug de outro
  sistema: o ruleset falha alto em vez de queimar CPU no único espaço compartilhado do jogo.
- Voltar à Cidade cura HP e mana por completo (§26.1). Quem cura é a entrada, não a transição.
- Movimento passa pelo mesmo sistema da hunt e do bot (FUN-69): `movement.ts` é o único escritor
  de posição, e a Cidade não é exceção.
- O passo é FIXO — `city.stepDurationMs`, 150 ms — para todo mundo (FUN-119, ADR 0025); a
  fórmula do Tibia vale só na hunt. Escada é um passo com `z` diferente.
- Um passo por vez, por personagem: o hospedeiro recusa o `walk` que chega antes de o passo
  anterior acabar (FUN-122). O teclado repete no ritmo do passo; o ritmo é do servidor.
- Uma cópia por processo `game`; muitos personagens por cópia.
- Sair de um shard é `leave` — a sessão continua para quem ficou.
- A cópia vazia é descartada.
- Shard não tem extrato nem snapshot.
- Repouso é por personagem.
- Cada passo vai para quem tem o tile no campo de visão, nunca para a sessão inteira.
- O campo é simétrico e tem dois limiares: entra a uma célula, sai passando de três.
- Teto de 200 por cópia; encheu, abre a próxima. Ninguém é recusado.
- `say` de canal `local` alcança o campo de visão.

## Serviço de Cidade: aprender magia (#624, ADR 0058)

O modal Personagem tem a seção **Magias**: lista as magias da vocação e vende cada uma por
`learnPrice` (`learn-spell`, sem diálogo de NPC — tela de serviço, ADR 0042). É intenção C2S
tratada pela sessão dona (ADR 0052 d.2), nunca endpoint `api`, e o gold sai pelo ledger. **Vale
também na hunt** (não rola nada, ADR 0052 d.4). Ver `progression.md`, "Aprender magia".

## Conjurar na Cidade (#792, ADR 0044 d.2)

A conjuração é MAGIA, então exige o aprendizado como qualquer outra (`spell-not-learned` /
`not-learned` no slot) — só a runa em si, o item, dispensa (#624).

A Cidade tem `useSlot`: a barra de ações funciona ali, mas só para **conjuração**
(`effect.kind === 'conjure'`) — o resto do vocabulário fica de fora, e por duas razões
diferentes:

- **Magia agressiva** (`damage`/`damage-over-time`) é recusada por POLÍTICA — a Cidade é
  protect zone (ADR 0004, §37) — com a razão tipada `protection-zone`, nunca lançada.
- **O resto do vocabulário não-agressivo** (cura, haste, buff, mana shield, dano ao longo do
  tempo) devolve uma `ConditionState` que só o RULESET agenda — e a Cidade não tem fila de
  eventos (`hz` 0, `onEvent` falha alto de propósito). Fica de fora por `not-in-catalog`, a
  mesma degradação que `use-item`/`use-item-on` já dão a comida e poção (ADR 0049 decisão 8).
  Reabre quando a Cidade ganhar relógio — o que o ADR 0004 diz que não terá.

Conjuração é a única ação do vocabulário que não precisa de nada disso: `castSpell` credita as
cargas no estoque abstrato do próprio lançador (`supplyStock`/`ammunitionStock`) e termina no
mesmo instante, sem mira, sem alvo e sem sorteio (ADR 0044 decisão 1) — item e supply (poção,
runa de ataque) continuam recusados, como já eram.

**Regeneração de mana/alma na Cidade: nenhuma, e é o comportamento decidido, não uma lacuna.**
Voltar à Cidade já cura mana por completo na entrada (§26.1 acima); depois disso ela NÃO
regenera enquanto o personagem fica na praça — o ADR 0043 (emenda de 2026-09-25) decidiu, com
evidência direta do Huntera, que a regeneração de vida/mana é condicionada só a "estar em hunt
agora": zero na Cidade, sem condição de comida. Pontos de alma seguem a mesma lógica por outro
caminho: só sobem por uma condição disparada quando a XP recebida é ≥ level (ADR 0044 decisão
3), e a Cidade nunca concede XP — então também não há ganho de alma lá. Conjurar várias vezes
seguidas na praça, então, esgota mana e alma sem repor nada até a próxima hunt ou a próxima
entrada na Cidade (que os enche de novo).

Estado durável: `#saveDurableReceipt` (`packages/server/src/game/host.ts`) grava
`supplyStock`/`ammunitionStock` além do que já gravava (vocação, equipamento, alma, `goldDelta`
pelo mesmo ledger que a venda na praça usa, #724/ADR 0048 d.8) — `useSlot` marca o personagem
`dirty` no sucesso, a mesma marca de `equip`/`choose-vocation` (#154).

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora |
|---|---|---|
| Mapa e ponto de entrada | `thais`, entrada no templo `(94, 88, 7)` | `packages/content/data/city/city.json` (`mapId`), `packages/content/data/maps/thais.json` (`entryPoint`) |
| Escadas | 92 `floorChanges` (46 escadas, ida e volta) | `packages/content/data/maps/thais.json` — autorado; o resto do arquivo é gerado |
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

**Comer e beber poção na Cidade são recusados — o Tibia deixa** (#726, ADR 0049 decisão 8):
`use-item`/`use-item-on` respondem `not-in-hunt` para qualquer coisa que simule (comida,
suprimento) porque a Cidade não tem relógio (`hz` 0, ADR 0004/0023) para exaustão, condição nem
`fedMs` — não há fila de eventos para agendar o vencimento nem para drenar o contador. Reabre
quando a Cidade tiver relógio, o que o ADR 0004 diz que não terá.
