# @draconya/sim

## Propósito

O motor de simulação: sessão, tick, combate, movimento por tile, IA de monstro, motor de bot,
rulesets de hunt/treino/quest/boss/guild war. É onde o jogo acontece.

## Fronteiras

**Pode importar:** `protocol`, `content`.
**Não pode importar:** `server`, `client`, `tools`, e **nenhum I/O** — `node:*`, `fs`, `net`,
`http`, `pg`, `redis`, `uWebSockets.js`, `express`.

Esta é a fronteira mais importante do repositório, e o lint a impõe. Ver `docs/boundaries.md`.

## Invariantes locais

- **Pureza** (invariante 1). Sem I/O, sem framework, sem rede, sem banco, **sem relógio global**.
  Tempo entra como parâmetro; `Date.now()` dentro daqui é bug. É o que permite testar sem
  infraestrutura, rodar no cliente sintético de carga, e reescrever o núcleo em Rust ou Go depois
  sem tocar no protocolo. Ver ADR 0001 e 0005.
- **Nada é escrito "por tick"** (invariante 2). Quem recebe `dtMs` é `Session.advanceBy`, e mais
  ninguém: cada cálculo é um evento da fila e roda no instante EXATO em que vence. É o que faz a
  hunt desanexada a 1 Hz produzir o mesmo estado que a anexada a 10 Hz — não parecido, o mesmo.
  Ver ADR 0003 e ADR 0020.
- **O resultado não depende de haver alguém assistindo** (invariante 3). Cai a apresentação, nunca
  a matemática.
- **Estado quente só é escrito pela sessão dona** (invariante 9). Aqui isso é absoluto e não tem
  a nuance do ADR 0024: `sim` não conhece Postgres, então tudo que ele toca É estado quente.
- **Todo personagem está sempre em exatamente uma sessão** (invariante 8), e daqui de dentro isso
  também é absoluto: um personagem em repouso não tem sessão, e por isso não existe em `sim`.

## Como testar

```
pnpm vitest run packages/sim
```

O teste que mais importa: **rodar o mesmo cenário a 10 Hz e a 1 Hz produz o mesmo resultado.**
Se divergir, alguém pôs decisão de jogo fora da fila de eventos — porque dentro dela a
equivalência não depende de fórmula nenhuma estar escrita com cuidado.

## Armadilhas conhecidas

- Monstro usa **passo guloso, não A\***: tenta o tile que aproxima, bloqueado tenta o adjacente,
  senão espera. Consequência barata: campo bloqueante não invalida caminho nenhum, porque não
  existe caminho guardado. Ver ADR 0009.
- **A escolha entre os dois desvios é fixa** (horário antes de anti-horário). Alternar exigiria
  guardar estado por monstro, e um viés estável é preferível a um que depende de quantas vezes o
  monstro já tentou — esse último produz movimento errático que ninguém reproduz.
- **Custo medido: 0,069 µs por monstro por decisão** (`pnpm bench:monster`). É a linha de base que
  a FUN-46 cobra em escala; uma regressão de ordem de grandeza aqui vira conta de servidor.
- **Alocação por evento é o que custa caro aqui**, e não a conta em si: com 5.000 instâncias, uma
  closure ou uma string por vencimento é o coletor rodando o tempo todo. Foi medido — índice de
  monstro por subject, predicado de bloqueio reaproveitado, chave de tile numérica e busca sem
  closure valeram de 35,4 para 18,8 µs por tick no `pnpm bench:hunts`. Antes de "otimizar a
  lógica", conte as alocações.
- A hunt **não faz pathfinding** — a rota é uma lista fixa de tiles vinda de `content`. O
  personagem também não persegue: ele percorre a rota e deixa o monstro vir.
- **A equivalência entre taxas vale para TUDO desde a FUN-68** — abates, XP e dano sofrido. Era
  verdade só para a recompensa: quem rodava a 1 Hz apanhava 1,51× mais, por granularidade de
  espaço. Ver ADR 0020 e `docs/product/hunt.md`.
- **Cadência de jogo é EVENTO na fila, nunca cálculo por intervalo.** Passo de rota, passo e
  ataque de monstro, ataque do jogador, regeneração e respawn são todos eventos que se
  reagendam. O acumulador de duração (`timesThatFit`) foi removido: ele devolvia N aplicações e
  deixava quem chamava decidir o que fazer com o N, que é a forma exata do defeito da FUN-67.
- **Grandeza contínua é evento periódico**: uma taxa de `r` por segundo é um evento a cada
  `1000 / r` ms. Não some `r * dtMs / 1000` num acumulador fracionário — somar `0,1` dez vezes em
  ponto flutuante dá `0,9999…` e some uma unidade a cada dez. Já foi tentado e revertido.
- **Cooldown de ataque não corre no vazio.** Quem passa o intervalo inteiro sem alvo fica
  ENGATILHADO e bate no instante do contato, não no próximo múltiplo de um relógio. A invariante
  é "engatilhado OU agendado, nunca os dois", e ela mora em `#schedulePlayerAttack` /
  `#scheduleMonsterAttack` — os dois ao mesmo tempo é o dobro do dano, e já aconteceu.
- **Morte é pipeline, e a consequência é do ruleset** (FUN-63). `resolveDeath` em `death.ts`
  congela a criatura, resolve o crédito (`lastHitBy`, `mostDamageBy`) e chama
  `Ruleset.onCreatureDied`; nenhum ruleset cancela evento de morto por conta própria, e
  nenhuma criatura decide o que a própria morte significa. `Contribution` é um `Map` mutado a
  cada golpe — um `Record` com chave dinâmica e `delete` cai em modo dicionário — e mesmo assim
  a atribuição custa ~2 µs por tick por instância no `pnpm bench:hunts` (18 → 21). É o preço
  de saber quem matou; não o pague duas vezes registrando de novo em outro lugar.
- **Loot sorteia com o `Rng` da sessão, gold antes de item, e `chance: 0` não consome
  sorteio.** Ordem e semente são contrato: mudar qualquer um dos dois muda o que toda hunt
  retomada rende. `Math.random` continua proibido, e `grep -rn "Math.random" src` é vazio.
- **Um evento que se reagenda usa `session.nowMs + intervalo`**, e é exato porque `nowMs` durante
  o despacho É o instante do vencimento. Não há erro a herdar, e por isso não há acumulador.
- **`pnpm source-policy` reprova nome de contador de tick** (`remainingTicks`, `cooldownTicks`, …)
  dentro deste pacote. É a verificação do invariante 2 que não depende de alguém lembrar.
- **Este pacote compila sem `@types/node`.** Desde o TypeScript 6 (FUN-61) o `types` padrão é
  vazio, e só os pacotes que usam Node o pedem no `tsconfig.json`; o `sim` não pede. `process`,
  `setTimeout`, `Buffer` e `node:*` não existem aqui nem como tipo — é o invariante 1 imposto
  pelo compilador, antes do lint. Se um erro "Cannot find name 'process'" aparecer neste
  pacote, a resposta é tirar o `process`, nunca adicionar o `types`.
- O adaptador `systemClock` vive em `server/`. Aqui ficam apenas o contrato `Clock` e o
  relógio controlado de teste. O lint recusa os globais `Date` e `performance`, inclusive via
  `globalThis`, para impedir que tempo real volte a entrar no núcleo.
- O motor de bot é compilado ao entrar na sessão, para um vetor de predicados. Interpretar JSON a
  cada avaliação é o caminho fácil e errado. Ver ADR 0002.
- **Escolher alvo e alcançar alvo são buscas SEPARADAS** (`targeting.ts`, FUN-85). `#attackTarget`
  usa o alcance da arma; `#approachTarget` usa o raio de visão do conteúdo. Enquanto as duas eram
  a mesma busca — o antigo `#nearestMonster` —, a postura "seguir o alvo" era impossível de
  expressar: quem já está ao alcance não precisa ser seguido.
- **O desempate de alvo é CONTRATO.** Priorizado antes da política, política antes da ordem de
  nascimento, e a comparação é estrita — o campeão só cai para quem ganha de verdade. Trocar por
  `<=` faz duas execuções da mesma semente divergirem assim que dois monstros empatarem, que é o
  caso comum: monstro recém-nascido tem sempre a vida cheia.
- **Skill é acumulador de USO, e isso não briga com o invariante 2** (FUN-75). O que a regra
  proíbe é grandeza dependente do TEMPO somada por tick; o que se soma aqui é uso, e uso é
  evento na fila — um golpe que vence, uma magia que sai. A 1 Hz e a 10 Hz acontecem os mesmos
  usos nos mesmos instantes lógicos.
- **O custo de um nível de skill é INTEIRO** (`Math.round` em `pointsForLevel`). `50 * 1.1` é
  `55.000000000000007`, e o resto que sobra ao fechar um nível carregaria esse lixo para o
  próximo — a mesma armadilha do acumulador fracionário registrada acima, por outra porta.
- **Skill nunca desce, e `Skills.merge` depende disso.** Ficar com o maior de cada uma é o que
  torna a fusão de extratos comutativa: um extrato antigo processado fora de ordem não rebaixa
  nada, e não é preciso guardar instante como a stamina guarda.
- **Bestiário é acumulador de ABATE, pelo mesmo argumento** (`bestiary.ts`, FUN-113, §18).
  Abate é a morte que `resolveDeath` resolve no instante em que vence — evento na fila, não
  grandeza por tick —, e o módulo é aritmética pura sobre um `Map`. `CharacterState.bestiary`
  é OPCIONAL, como `skills`: ausente é `{}`, sem bump de `SNAPSHOT_FORMAT_VERSION`. O
  contador sobe DENTRO do `if` de recompensa de `#onMonsterDied`, e não fora: stamina zero
  não conta abate (§18.6) pela MESMA condição que não paga XP nem loot — duas condições
  divergem na primeira mudança em uma delas. `Bestiary.merge` fica com o maior por monstro,
  pela razão de `Skills.merge`.
- **A party é aritmética pura em `party.ts` (#189, ADR 0027), e o ruleset só chama.** Quatro
  contas em inteiro, sem RNG: `uniqueVocations` (`null` CONTA como uma vocação), `xpPool`
  (`floor(xp × tabela[únicas] / 100)`; um elegível só devolve `xp` sem ler a tabela — solo é
  100 %, e a linha `"1"` é da party de vocações iguais), `xpShare` (cota igual, resto
  DESCARTADO — dar o resto a alguém seria prioridade por golpe, §15.5) e `settleBag`
  (vende a bolsa por `item.value`, divide com `splitEqually` — resto UM a UM nos primeiros,
  porque gold descartado é valor que o ledger não vê; `value: 0` vai em `unsold`, para o
  líder, não para o gold). Nada aqui sabe o que é sessão; é o que permite testar por tabela.
- **Agregados são POR PARTICIPANTE desde o #187, e `session.aggregates` é a SOMA.** Escreva
  com `session.credit(id, key, delta)` — nunca `session.aggregates.x += n`: `credit` escreve
  no participante e na soma no mesmo passo, e trata `best*Hit` como máximo. `end()` devolve
  um `Receipt` por participante, cada um com `seq` próprio (o ledger é `UNIQUE (session_id,
  seq)`); `leave(id, reason)` vale em qualquer sessão e devolve quem saiu com o extrato dele,
  emitido DEPOIS do `onLeave` — é o que faz o settlement da bolsa entrar no extrato de quem sai.
- **No modo compartilhado a bolsa é da SESSÃO, e a capacidade dela é derivada** (#192, ADR
  0027). `#bag` guarda gold e itens; a capacidade é `Σ capacity` dos presentes calculada na
  hora — guardar e somar/subtrair divergia no primeiro level up, que reescreve `capacity`
  pela tabela. O excedente vai para a caixa do líder; `itemsLooted` conta para todo presente.
  O settlement (`#settle`) roda no `onLeave` COM quem sai e no `onEnd`, antes de a `Session`
  emitir os extratos — é o que põe o gold neles. O supply do vocabulário v2 é **abstrato**: usar
  debita o `price` do gold no ato (`useSupply`, `casting.ts`), sem pilha e sem reposição. Em solo
  a `Purse` é o saldo do próprio usuário; no modo compartilhado é o rateio entre os presentes, e a
  bolsa credita `goldSpent` a cada um pelo que pagou — o extrato de cada membro sai equalizado.
- **Em party, morrer e disparar regra de saída são `leave`, e a cascata roda DEPOIS do extrato
  de quem saiu** (#193). `#depart` chama `session.leave` — que roda `onLeave` (settlement) e SÓ
  ENTÃO emite o extrato — e emite `member-left` com o extrato e o personagem, porque o
  hospedeiro não chamou. A cascata de `party-member-lost` (`#onMemberLost`) fica PENDENTE no
  `onLeave` e roda em `#flushLoss`: logo depois em `#depart`, ou no primeiro evento seguinte
  quando a saída veio do socket. Rodá-la dentro do `onLeave` emitia os extratos dos outros
  antes do de quem saiu — `seq` fora de ordem e `member-left` invertido; foi assim que o
  primeiro teste reprovou. O último a sair encerra, com o motivo dele; solo continua `end`.
- **O bônus do Bestiário é GLOBAL, e o abate que fecha o marco é pago pela regra de ANTES.**
  Global (DT-01) porque o PRD diz "XP PvE permanente", não "XP daquele monstro" — por monstro
  seria uma segunda regra que ninguém escreveu. E `applyXpBonus` vem antes de `record` (DT-04)
  porque a ordem inversa faria o abate 10 000 ser o único da vida do personagem a render
  diferente dos vizinhos. A XP com bônus é calculada em INTEIRO — `floor(xp × (100 + p × n) /
  100)` —, nunca `floor(xp × 1,13)`: `100 × 1.13` é `112.99999999999999`, e um abate em cada
  setenta perderia um ponto sem ninguém saber por quê. Por isso o conteúdo exige `p` inteiro,
  e não existe método que devolva o multiplicador em ponto flutuante: quem mostra o bônus soma
  os marcos e multiplica por `p` (é o que o cliente faz).
- **Regra de saída é compilada em `hunt.ts`, não em `bot.ts`** (FUN-86). O predicado lê a
  `HuntView`, e `bot.ts` não conhece ruleset nenhum — o mesmo bot vai valer para quest e boss.
  `CompiledBot.exit` sai cru de propósito; quem tem a view é quem fecha a closure.
- **`out-of-gold` olha o SALDO, nunca o delta.** Delta negativo é qualquer um que gastou uma
  poção; saldo zero é quem não consegue comprar a próxima. E `hp-below` compara ESTRITO: com
  `<=`, "sair abaixo de 100%" encerraria a hunt de quem entrou de vida cheia.
- **A postura anda pelo `#step`, como todo mundo.** `movement.ts` segue sendo o único escritor de
  posição (FUN-69) e `pnpm source-policy` reprova o contrário. Recuar é `fleeStep`, que é o passo
  guloso com a ameaça espelhada — não um segundo algoritmo de desvio.
- **Magia e supply RECUSAM, nunca lançam** (`casting.ts`). Sem mana, sem gold, em cooldown, fora
  de alcance: a ação não acontece e a sessão segue. Uma exceção aqui derrubaria a hunt por uma
  regra que o jogador escreveu certa. A recusa é tipada, e só a de cooldown carrega prazo — é o
  que faz o grupo do bot voltar no vencimento em vez de engatilhar e dormir para sempre.
- **A mana sai por ÚLTIMO.** Level, cooldown, alvo e alcance são conferidos antes de descontar.
  Descontar primeiro é como se perde mana sem lançar nada.
- **Inventário é POSICIONAL, e `Inventory` não conhece conteúdo** (`inventory.ts`, #160). Mochila
  (o item em `back`, `initialSlots`) e bolsa (`progression.satchelInitialSlots`) são vetores com
  `null`; os tamanhos e a linha chegam por `ContainerRules` — `containerRulesFor` é a única
  ponte com o conteúdo, chamada em `onEnter`, em `onResume` (snapshot anterior ao formato, lido
  como lista plana sem bump) e pelo host no `move`. O lugar NUNCA recusa loot: só o peso recusa,
  e a Caixa segura. `move` é transação — valida tudo, depois escreve; a recusa não muta. A
  mochila só sai vazia.
- **Capacidade é PESO, e o equipado conta** (`inventory.ts`, FUN-82). Sem contar o equipado, a
  estratégia ótima é vestir tudo para carregar o dobro. E `weaponAttack` devolve `null` sem
  arma, nunca zero: zero faria o personagem desarmado não machucar nada, e desarmado é como
  todo mundo começa — quem sabe quanto o punho bate é o conteúdo.
- **Agregado é escrito onde o FATO acontece** (FUN-78), pela sessão dona: o maior hit no golpe,
  o loot no abate, o supply no uso. Reconstruir por varredura é contar de novo o que já foi
  contado, e é assim que dois números que deveriam bater param de bater. E `Receipt.aggregates`
  é o MESMO objeto da sessão — duas cópias divergiriam.
- **O maior hit guarda o dano RESOLVIDO, não o aplicado.** `receiveDamage` devolve
  `min(dano, vida)`, então o aplicado faria o recorde depender de quão morto o alvo já estava.
- **A sessão NUNCA escreve `item_instance`.** Ela registra o layout; o extrato leva e o `jobs`
  aplica (invariante 10). O mesmo caminho de XP, gold e skill.
- **Magia em área colhe TODOS os alvos antes de aplicar dano nenhum** (FUN-92). Resolver morte
  no meio da varredura é varrer um array que está sendo trocado — `#onMonsterDied` substitui
  `#monsters` por um filtrado —, e os alvos depois do que morreu ficariam de fora.
- **A ordem dos alvos de uma área é contrato**, como semente e ordem de sorteio do loot: cada
  alvo consome uma rolagem, e trocar a ordem troca qual sorteio cai em quem.
- **O alcance de uma magia é o DELA, não o da arma.** A mira usa `selectTarget` com
  `spell.effect.range`; usar `#attackTarget` fazia uma magia de alcance 3 se comportar como uma
  de alcance 1, porque a seleção mordia antes da conferência. Foi um defeito real da FUN-74.
- **`castSpell` devolve o dano RESOLVIDO, não aplicado.** Quem aplica é quem tem o alvo, porque
  aplicar é também `recordDamage` e `resolveDeath` — e a atribuição não pode ser paga duas vezes.
- **O cooldown de magia é `Cooldowns`, com instante ABSOLUTO no relógio lógico.** Não é
  acumulador e não é evento próprio na fila: a categoria do bot já é o evento, e um segundo
  evento por magia seria a mesma cadência escrita duas vezes. Absoluto é o que o mantém correto
  do outro lado de um snapshot.
- **Gold gasto é `goldDelta` no personagem E `aggregates.goldSpent` na sessão**, como o loot é
  `goldDelta` e `goldGained`. O extrato leva os dois ao ledger; escrever só um faz a conta do
  jogador divergir da linha do banco. O saldo é `gold + goldDelta`, e nunca fica negativo —
  o débito é recusado antes, não corrigido depois.
- **Lure e ring swap são MÁQUINAS DE DOIS LIMIARES, e a faixa morta é o produto** (FUN-87). Um
  limiar só faz a decisão oscilar em cima do número: o personagem alterna entre correr e parar a
  cada monstro que morre, e o anel troca a cada golpe. `botRingSwapSchema` recusa `removeAbove <=
  equipBelow` na entrada porque limiares iguais apagam justamente a faixa em que nada acontece.
- **O lure decide PARAR, não atacar.** Ele entra em `#onPlayerStep` na condição de parar para
  lutar; `#armPlayerAttack` continua no fim do passo. Um personagem que corre sem atacar junta um
  bando que nunca começa a limpar.
- **O `min` do lure só é reavaliado com alguém ao alcance.** `#luring` fica atrás do `&&` de
  `#attackTarget`, então a volta para "correndo" acontece no instante em que a contagem cai com
  um monstro ainda colado — e, se todos morrerem de uma vez, no primeiro contato seguinte. Tirar
  o curto-circuito custaria uma contagem por passo em toda hunt que nunca configurou lure.
- **`manaFloor` desativa o ring swap INTEIRO, e derruba o anel já equipado.** Desativar pela
  metade — não equipar, mas manter o que está — gastaria mana exatamente quando ela é escassa.
- **`luring` e `ringReplaced` viajam no snapshot.** Sem o primeiro, a hunt retomada volta
  correndo e junta por cima do bando que já estava junto; sem o segundo, ela esquece qual anel
  era do jogador e termina com o dedo vazio.
- **`Session.leave` vale em qualquer sessão com mais de um dono** (FUN-71, ADR 0023; #187, ADR
  0027): o shard da Cidade e a party de hunt. Numa sessão de um dono só sair é encerrar.
  `Ruleset.shared` continua dizendo se é shard — o que muda é ter extrato e snapshot.
- **A hunt hospeda N participantes, e o que é de um vive num `Runner`** (#203). Caminhante da
  rota, bot compilado, grupos engatilhados, lure, anel, golpe engatilhado e os três avisos
  são POR PARTICIPANTE, num `Map` por id; todo evento de personagem já carrega `subject`, e
  `#runnerOf` encontra o seu. Spawn e regras de saída são da INSTÂNCIA e entram na fila com o
  primeiro a entrar — o segundo não os dobra. O segundo entra por `placeNear` (tile é
  exclusivo) e `rejoinNearest` o traz à rota; um companheiro PARADO na rota é contornado com
  o passo guloso rumo ao tile seguinte (`walker.ahead()`), não esperado — esperar era ficar
  atrás dele a hunt inteira, e foi o primeiro defeito da party. O snapshot leva `runners` por
  id E os campos soltos do primeiro (um nó anterior continua lendo o solo); `restore` guarda o
  que leu e `onResume` casa com os participantes, que só existem depois.
- **`onLeave` da Cidade REMONTA a ocupação, não libera o tile de quem saiu.** Quando a saída
  acontece numa transição, quem sai já foi colocado no mapa da hunt para onde vai, e
  `TileOccupancy` guarda coordenada, não dono: liberar por `character.position` liberaria um tile
  da praça usando coordenada de outro mapa, em cima de quem estivesse parado ali. É o defeito da
  FUN-72 entrando pela mesma porta.
- **Chegar na Cidade é `placeReachable`, não `place` nem `placeNear`** (FUN-120). O ponto de
  entrada é um tile só e tile é exclusivo; um `place` seco deixaria o segundo a chegar fora do
  mapa — invisível, sem andar, com o log dizendo que ele entrou. E o anel geométrico de
  `placeNear` atravessa parede: no templo de Thais lotado, ele punha quem chega do lado de fora
  do prédio. A busca é em largura pelos tiles andáveis, quatro vizinhos, no andar da entrada,
  sem entrar em escada; o teto de 1.089 tiles visitados (o quadrado do anel de 16 de antes) vem
  do TETO DE POPULAÇÃO por cópia (200, na FUN-33): com 289, duzentas pessoas ficariam ombro a
  ombro. A hunt não passa por nenhum dos dois: o spawn é um `place` seco num ponto aberto, e
  `placeNear` fica como a busca em anel para quem tiver um lugar sem paredes.
- **`Ruleset.mapId` é o mapa que o cliente desenha** (FUN-120): a hunt devolve o do
  `TileOccupancy`, a Cidade o de `options.map`. Ausente é sessão sem mapa — só fixture. O
  hospedeiro o manda em `instance-enter` antes do `session-state`, e em `world.mapId`.
- **A duração do passo é do tile de DESTINO, e a diagonal custa 3× ANTES do arredondamento**
  (FUN-119, ADR 0025). `movementDuration(world, mover, from, to)` é `ceil50(chão × 1000 /
  speed)`; arredondar e depois triplicar dá 3.600 onde o Tibia dá 3.500. Quem parou volta a
  olhar em volta no ritmo de um passo dali (`from === to`). A Cidade passa `fixedStepMs` no
  `TileOccupancy` e nada disso vale lá.
- **Escada é um passo com `z` diferente, e só para quem carrega `z`.** `canOccupy` julga o
  DESTINO da escada (`floorChangeAt`), não o degrau; o monstro — posição sem `z` — vê o degrau
  como parede, como no Tibia. A ocupação é por andar (`tileKey(x, y, z)`), e `occupied(x, y)`
  sem `z` é o andar padrão do mapa.
- **`monsterCount` é o TOTAL da instância, e o `Spawner` o ESPALHA pelo laço** (FUN-123, cópia
  do Huntera: 2/5/8 no bueiro). O lugar `i` fica no ponto `⌊i × pontos / total⌋` — com menos
  monstros que pontos eles cobrem o laço em intervalos iguais (o rodízio `i % pontos` deixava
  seis dos catorze pontos do bueiro sem monstro em qualquer pull), com mais cada ponto recebe
  o mesmo tanto; determinístico, igual em dois servidores com o mesmo conteúdo. O tile livre é
  procurado até o `radius` DO PONTO, que a rota autora. Rota sem ponto de spawn é hunt sem
  monstro. Com `spawnClearRadius` da hunt (#236), tile a menos disso de um participante vivo
  conta como bloqueado: o spawn ADIA (`SPAWN_RETRY_MS`), nunca cancela — a densidade é a da
  dificuldade, e é o que a referência §29 pede ao mandar não copiar a supressão do TFS.
- **O cadáver é um evento de presença, e é só visual** (`ground-item-appeared` /
  `ground-item-vanished`, FUN-123). O `sim` diz QUAL monstro morreu e ONDE; a arte é da tabela,
  resolvida no hospedeiro (invariante 6). O prazo é o evento `CORPSE` na fila, com
  `corpseTtlMs` da hunt — hunt sem o campo não deixa cadáver. Os cadáveres entram no snapshot
  (`corpses`, `nextGroundItemId`), e o evento de apodrecer volta com a fila. O loot NUNCA passa
  pelo cadáver: já foi para a caixa antes de ele cair.
- **O ataque do monstro é uma faixa sorteada com o `Rng` da sessão** (`attackRange`, FUN-123):
  o rato bate de 0 a 8, e a mesma semente dá o mesmo golpe — o contrato do loot vale para o
  dano. Um número no JSON é a faixa de um valor só.
- **A ability do monstro é conteúdo declarativo, normalizado no BOOT** (CMB-06, DT-01/DT-02).
  `monster.abilities` ausente vira UMA básica montada de `attack`/`attackIntervalMs`/
  `attackRange`/`damageType`, e é isso que preserva o rato bit a bit — mesmo sorteio, mesma
  ordem de evento. A básica usa o subject `m:<id>` e o kind `monster-attack` de sempre; as
  declaradas usam subject derivado `m:<id>:<abilityId>` e kind `monster-ability`, e a morte as
  cancela pelos ids que o conteúdo conhece (sem varrer a fila). A distância emite
  `monster-ability-cast` ANTES dos `creature-hit`; o golpe de ability não-corpo-a-corpo é
  `spell`. A ordem dos alvos de uma área é a de ENTRADA e é contrato; morto é pulado. O estado
  "engatilhada OU agendada" é POR ABILITY: a básica em `attackReady`, as declaradas em
  `scheduledAbilities` (opcional no snapshot, sem bump).
- **O alcance é da ARMA, e cada tipo bate do seu jeito** (#152, ADR 0026; perfis no CMB-05;
  munição abstrata desde #420). `Inventory.weapon()` é a definição da arma na mão; `#attackRangeOf`
  lê `weapon.range` dela, e só sem arma vale o alcance do perfil `fist` (`content.unarmed`).
  `#strike` despacha pelo `weapon.kind`: `melee` como sempre; `distance` atira a munição
  ESCOLHIDA da família (ADR 0032 decisão 7): `#ammoFor` devolve a `Ammunition` do `character.ammo`
  (ou a básica da família, a primeira em ordem de id), e o `attack`/`damageType` do tiro são os
  dela pela skill `distance`. **Não existe munição grátis:** sem saldo que cubra o `price`, o tiro
  NÃO sai — nem `shot`, nem dano. Resolvido o golpe, `#strike` debita o `price` no personagem e em
  `aggregates.goldSpent`, e emite `shot` com o `ammoId`. A escolha é por família, via
  `CharacterRuntime.selectAmmo`, que valida `requires.level`; o `select-ammo` do host a leva a
  `player-stats.ammo`. `wand` gasta
  `manaPerHit`, causa dano MÁGICO por faixa (`rng.integer(min, max)`, uma
  rolagem por golpe — contrato como o loot) e rende `spell-cast` pela mana. **O poder sai de
  `resolveWeaponPower` com o PERFIL da arma** (`WeaponProfile`: família, tipo, alcance, `power` ou
  `fixedDamage`): a família aponta a skill e a prática no conteúdo, e o ruleset não conhece nome de
  item nem vocação (DT-01). Corpo a corpo e distância recebem a postura; wand/rod não, porque o
  perfil delas não tem `power` — e por isso não ganham multiplicador de weapon skill (DT-02).
  **Wand sem mana não bate**: o golpe fica agendado para o intervalo seguinte, sem gastar mana nem
  praticar. A prática é UMA por golpe e não depende do dano final: imune, resistente ou morto no
  impacto ainda pratica. O tiro emite `shot` ANTES do `creature-hit`; o projétil é da tabela,
  resolvido no hospedeiro (invariante 6). `hands-full`: bow com escudo, ou escudo com bow, é
  recusado — nunca trocado.
- **A defesa é da PEÇA, e a fonte é do `Inventory`** (CMB-04, emenda do ADR 0031).
  `Inventory.defenseSource` escolhe escudo → arma corpo a corpo de uma mão → nenhuma (DT-01/02),
  reusando a mesma verdade de slot que já recusa bow com escudo; o ruleset não repete a regra.
  `resolveDefense` (`combat/defense.ts`) é o estágio entre o Dodge e a armadura: sem fonte, ou
  com tipo fora de `blockTypes`, é IDENTIDADE e **não consome sorteio** — é o que mantém o v1 bit
  a bit. Com fonte e físico, é o SEGUNDO sorteio (o Dodge continua o primeiro), e ele é
  consumido mesmo com `defense` 0, para a sequência não depender do valor da peça. O piso é
  calculado sobre o poder BRUTO: o bloqueio nunca zera o golpe. Shielding sobe uma vez por
  ataque físico elegível RECEBIDO (`#onMonsterAttack`), nunca por tick, nunca por HP perdido e
  nunca em elemental. Não há fight mode, opcode nem UI (DT-03).
- **Condição é evento, não acumulador; a direção é do `#step`; cooldown tem três livros** (#155).
  Haste, postura, magic shield e cura ao longo do tempo são `ConditionState` no personagem
  (`conditions.ts`, uma por tipo, relançar substitui) com `expiresAtMs` LÓGICO, e o vencimento
  é `CONDITION_EXPIRE` na fila — um `remainingMs -= dtMs` em qualquer lugar quebra a
  equivalência de taxas. `castSpell` DEVOLVE a condição; quem agenda é o ruleset, que tem a
  fila. O haste é `Movable.speedScale`, lido por `movementDuration` à parte de `speed`, porque
  `retarget` e a entrada reescrevem `speed` pela tabela. A direção do personagem é gravada só
  em `#step` (diagonal: a horizontal decide) e é de onde saem onda, cleave e feixe
  (`area.ts`, puro: forma → tiles; a mira colhe quem está nos tiles por `Set` de chaves, uma
  alocação do tamanho da forma). `Cooldowns` guarda `spell:`, `group:` e `secondary:` no mesmo
  mapa; `group-cooldown` carrega o prazo do livro que trancou. Uma magia de `basePower` não
  passa pelo `powerMultiplier` das skills por uso — a skill já entrou na conversão.
- **`tilesAround` mora em `movement.ts`, não no spawner.** Tem dois donos desde a FUN-71 — o
  respawn da hunt e a chegada na praça —, e geometria de tile não é assunto de hunt.
- **Evento de combate carrega o APLICADO, e a ordem é contrato** (`combat-events.ts`,
  FUN-109). `creature-hit`/`creature-healed` saem ANTES do `creature-health-changed` que
  explicam, e `spell-cast` antes dos golpes dele — o número flutuante acompanha a barra, não o
  contrário. A vida do personagem é anunciada de TODO lugar que a escreve (golpe, cura, poção,
  regeneração, level up e penalidade de morte); um caminho novo que mude `character.health`
  ou `character.maxHealth` sem `#emitCharacterHealth` é a barra do jogador parando até a
  reanexação. O máximo entra na lista porque `retarget` (`progression.ts`) reescreve os dois
  de uma vez, e de vida cheia a regeneração não anuncia nada — o level up que não anuncia
  fica com o máximo velho na barra até a reanexação. `targets` do `spell-cast` é vetor NOVO de
  propósito: `#spellHits` é reaproveitado, e o evento é drenado depois.
- **Outcome avançado é etapa explícita, e a ausência de modificador preserva o v1** (CMB-08,
  emenda do ADR 0031). `resolveDamage` continua PURO e decide o resolvido e o crítico;
  `applyDamageOutcome` (`combat/outcome.ts`) é a ÚNICA etapa que escreve recurso — mana shield,
  HP efetivamente removido e leech —, e opera só os runtimes da sessão dona. O mana shield saiu
  de `CharacterRuntime.receiveDamage`, que voltou a ser só vida; o escudo absorve até onde a
  mana alcança e segue ativo até vencer mesmo com mana zero. A ordem do RNG é contrato: Dodge
  (1º, sempre), defesa (2º, se elegível), crítico (3º, **só quando `intent.modifiers.critical`
  é declarado** — declarado com chance 0 ainda consome). `combat.modifiers` ausente NÃO consome
  sorteio nenhum, e é o que mantém bit a bit o CMB-02/03/04; por isso o conteúdo real não o
  declara ainda. O leech usa o HP APLICADO (`healthDamage`), nunca o resolvido — overkill e
  absorção total não rendem leech — e o que de fato repõe é clampado no teto do atacante. O
  `creature-hit` e a contribuição usam `healthDamage`; `bestBasicHit`/`bestSpellHit` continuam
  com o RESOLVIDO. O `AppliedDamageOutcome` é efêmero: não entra no snapshot nem no S2C, e não
  há campo de protocolo nem UI de breakdown (DT-03).
- **A conformance de combate é ORÁCULO explícito, nunca snapshot da implementação** (CMB-10,
  #336). `combat/conformance.test.ts` prende fórmula, ordem de RNG e arredondamento com dados
  escritos à mão, cada caso a 100 ms, a 1000 ms e com snapshot/retomada; o `RngState` é
  comparado entre as três, nunca copiado para o oráculo — ele não é número que se lê, é
  propriedade de equivalência. `combat/conformance.ts` é a comparação PURA; o cenário misto do
  benchmark vive em `tools` e a interpretação da linha de base em
  `docs/product/combat-conformance.md`.
