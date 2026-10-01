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
  existe caminho guardado. Ver ADR 0009. **A exceção é a VOLTA AO SPAWN** (#655): empacar numa
  concavidade é o comportamento certo de quem persegue, mas não de quem volta para casa — quando
  o guloso empaca fora do `home`, a volta usa a busca de caminho limitada (`walkBackPathStep`)
  até chegar. Ver a emenda de 2026-09-29 do ADR 0009.
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
  ponto flutuante dá `0,9999…` e some uma unidade a cada dez. Já foi tentado e revertido. Onde o
  Tibia guarda PULSO, guarde o pulso: a regeneração é `amount` a cada `ticksMs` inteiro (#678),
  sem virar taxa e sem `1000 / taxa`.
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
- **A perda de item na morte é `item-loss.ts` (#571, ADR 0042 d.4), DESLIGADA no conteúdo real
  (`deathPenalty.itemLoss.enabled: false` — decisão do dono em aberto), e a ORDEM é contrato.**
  `HuntRuleset#onCharacterDied` chama `loseItemsOnDeath` ANTES de `applyDeathPenalty` e do consumo
  das bênçãos (o Canary roda `dropCorpse` antes de `death()`: a chance lê a contagem de bênçãos de
  ANTES, e o Amulet of Loss protege antes de ser gasto) e `consumeLossAmulet` DEPOIS (lê o level já
  rebaixado). Cada slot vestido consome UM sorteio na ordem de `CANARY_SLOT_ORDER` (`head, neck,
  back, chest, shield, hand, legs, feet, finger, ammo` — o `RIGHT` do Canary, o escudo, antes do
  `LEFT`, a arma) — inclusive o que não cai, e nenhum se o colar ou as bênçãos protegem: trocar a
  ordem, ou parar na primeira perda, muda quem perde o quê com a mesma semente (e a absorção por
  item de `equipmentAbsorb`, que usa a mesma constante). **Sem vocação (`vocationId === null`) não
  há perda nem bag**, e **abaixo do level do Adventurer's Blessing com vocação
  (`hasAdventurersBlessing`) vale cinco bênçãos** — o Canary/TFS devolvem antes da perda para o
  Dawnport/`VOCATION_NONE` e concedem as bênçãos 2 a 6 no login; quem mexer nas proteções lê
  `docs/product/death.md`. O item é DESTRUÍDO (`removedInstances`, o mesmo caminho de
  `sell-items`): não há cadáver de jogador, então nada aqui devolve o item a lugar nenhum. A
  mochila perdida leva o vetor inteiro (`Inventory.loseEquipped`), **a bolsa nunca — um abrigo que o
  Tibia não tem, e decisão do dono em aberto** (`docs/product/death.md`, "Em aberto"). Container
  para a regra é `kind: 'container'` OU `quiver` — a flag `container` do cliente. Sem estado novo:
  nada disto entra no snapshot.
- **Loot sorteia com o `Rng` da sessão, gold antes de item, e `chance: 0` não consome
  sorteio.** Ordem e semente são contrato: mudar qualquer um dos dois muda o que toda hunt
  retomada rende. `Math.random` continua proibido, e `grep -rn "Math.random" src` é vazio.
- **Instante do relógio da sessão NÃO atravessa a troca de sessão como está** (#812, #550). O
  relógio de cada sessão nasce em zero (ADR 0020), mas o `CharacterRuntime` é o MESMO objeto na
  transição (Cidade → hunt, hunt → Cidade, saída da party): um instante de 57 700 ms gravado pela
  hunt anterior é "no futuro" da nova, e o combate passa a depender de por onde o objeto andou, não
  do estado e da semente. São duas espécies, e cada campo novo que guarde um instante (`…AtMs`,
  `…Until`, `until`, `expiresAtMs`, `anchorMs`) escolhe UMA:
  - **Carimbo** ("quando foi a última vez que…": `lastAttackAtMs`, `lastCombatActionAtMs`,
    o banco de bloqueio, a ação manual adiada) **zera** em
    `CharacterRuntime.resetSessionClockState`, que `Session.enter` chama DEPOIS de o `onEnter`
    aceitar. A janela é curta e já venceu na saída normal.
  - **Prazo** ("quanto ainda falta": cooldown de magia/poção, condição, imunidade do Cleanse)
    **traduz**, nunca zera: `Session.enter` chama `moveToClock` ANTES do `onEnter` e o restante
    atravessa (`Cooldowns.rebase`, `Conditions.rebase`) — o cooldown de 10 minutos não volta pronto
    por uma ida à Cidade, como no Canary (condição `CONDITIONID_DEFAULT` persistente) e como o anel
    de duração (`#parkEquipment`, #689). A Cidade não simula: o prazo fica pausado nela. Zerar um
    prazo "por segurança" é renovar de graça e é divergência de regra de caça (ADR 0037 d.6). Uma
    condição trazida não tem evento na fila nova: `HuntRuleset#armConditions` o agenda no `onEnter`,
    e `onLeave` cancela os eventos sem remover a condição.
  - A origem da tradução é o instante EXATO da saída: `Session.leave`/`end` o gravam no personagem
    (`markDeparture`), e o `#runTransition` do host constrói o destino ANTES de encerrar a origem
    (nesse caso vale o `nowMs` vivo dela). Nunca leia o relógio de uma origem que continuou andando —
    o restante passaria a depender da frequência do hospedeiro (invariante 2). O vínculo com o relógio
    é transiente (fora de `getState`) e o restore de snapshot o religa com `bindClock`, SEM traduzir:
    o relógio é o mesmo, e a janela quente atravessa. A entrada recusada desfaz a tradução.
  - O teste que força a escolha é a tabela `SESSION_CLOCK_POLICY` de `session.test.ts`, um
    `Record<keyof CharacterState, 'stamp' | 'duration' | 'none'>`: o campo novo não compila até ser
    classificado. Duração sem âncora num relógio (`fedMs`, `durationRemainingMs`) é `none` e atravessa.
  - Um cinto de leitura nunca substitui isto. `attackedRecently` lê carimbo no futuro como "nunca
    bateu" (`false`), mas só até o relógio novo alcançar o valor velho; `isInFight` lê o MESMO
    carimbo como "em combate" por até 60 s. Cada um cobre só metade do defeito.
- **A esfola de cadáver (#626, `skinning.ts`) é o ÚLTIMO sorteio do abate, e só existe com
  ferramenta.** `#onMonsterDied` rola loot, credita supply/munição e SÓ ENTÃO rola a esfola — um
  sorteio, no `combat-v4`, quando quem coleta tem a ferramenta do monstro. Sem ferramenta, sem
  entrada em `content.skinning` ou fora do v4 o `session.rng` não é tocado (`rulesets/skinning.
  test.ts` prende); pôr qualquer sorteio DEPOIS dele, ou antes dele por um caminho que nem todo
  abate percorre, desloca a sequência de quem tem faca. A janela é por ESTÁGIO do cadáver
  (`Skinning.stages`), não a vida inteira (`corpseTtlMs`), e `CorpseState.diedAtMs` é o que dá a
  idade — um snapshot anterior sem ele não se esfola à mão. O Scavenge encolhe o intervalo, e no tier
  3 é PIOR que sem charm (a fórmula do Canary, decisão a rever em `docs/product/items.md`). **A
  tentativa — a do bot e a manual, com ou sem sucesso — reagenda o evento `CORPSE`**
  (`#retimeCorpse`, `Skinning.stages[].afterTtlMs`): o `transform(skin.after)` do Canary reinicia o
  decaimento, e o cadáver esfolado vive 360 s da tentativa, não o que faltava dos 670 s. Quem
  esfola um cadáver por um caminho novo tem que passar por `#retimeCorpse`, senão o loot que
  sobrou no cadáver vive mais que no Canary. **O alcance manual é o `canUse` adjacente (1×1, sem
  linha de visão), NÃO o `canUseFar` 7×5**: o `skinning.lua` não chama `allowFarUse`, e herdar o
  7×5 das runas por ser "um tile" foi o erro que a revisão do #626 pegou (ADR 0049, emenda).
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
- **Loyalty é LEITURA do nível, nunca escrita** (`loyalty.ts`, #628, ADR 0052 d.5). O bônus da
  idade da conta chega no ticket como um percentual inteiro, fica em `CharacterRuntime.
  loyaltyBonusPercent` (fixado como a versão de conteúdo, e no snapshot) e vira NÍVEIS extras por
  `LoyaltyLevels.levelOf` — a conta de `getLoyaltySkill`/`getLoyaltyMagicLevel` do Canary, sobre
  TRIES e na curva real da vocação, não `nível × (1 + p)`. **Toda leitura que ESCALA algo (golpe,
  magia, defesa, cura, requisito de runa) passa por `HuntRuleset#loyaltyLevelOf` /
  `#magicLevelOf`; ganhar tries, o estágio de rate, a penalidade de morte, o extrato e o
  snapshot continuam no nível BASE** (`skills.levelOf`) — misturar os dois faria o bônus
  acelerar (ou travar) a própria curva. Skill nova que escale algo lê pelo helper, não por
  `character.skills.levelOf`. Sem bônus o helper devolve o nível base sem custo nenhum. O `sim`
  nunca conta dias de conta nem lê relógio: quem calcula o percentual é a `api` (`server/src/
  loyalty.ts`), com `loyaltyPointsOf`/`loyaltyBonusPercentOf` daqui (aritmética pura). O cache de
  tries acumulados por skill é derivado, por personagem, e nunca vai ao snapshot.
- **Bestiário é acumulador de ABATE, pelo mesmo argumento** (`bestiary.ts`, FUN-113, §18).
  Abate é a morte que `resolveDeath` resolve no instante em que vence — evento na fila, não
  grandeza por tick —, e o módulo é aritmética pura sobre um `Map`. `CharacterState.bestiary`
  é OPCIONAL, como `skills`: ausente é `{}`, sem bump de `SNAPSHOT_FORMAT_VERSION`. O
  contador sobe DENTRO do `if` de recompensa de `#onMonsterDied`, e não fora: stamina zero
  não conta abate (§18.6) pela MESMA condição que não paga XP nem loot — duas condições
  divergem na primeira mudança em uma delas. `Bestiary.merge` fica com o maior por monstro,
  pela razão de `Skills.merge`.
- **O Bosstiary é o irmão do Bestiário, e o boss conta em UM dos dois** (`bosstiary.ts`, #629,
  ADR 0052 emenda de 2026-09-29). Mesmo evento (`#onMonsterDied`) e mesma fusão por máximo
  (`Bosstiary.merge`) — mas **NÃO a mesma elegibilidade**: o Bestiário ainda corre dentro do
  `for (const member of eligible)` de `#grantPartyXp` (vivo e com stamina), e o Bosstiary roda
  FORA dele, em `#creditBosstiary`, sobre os `killers` do Canary (`#killersOf`: todo jogador com
  dano no monstro, mais o roster inteiro com a XP compartilhada ativa). `Player::onKilledMonster`
  não tem portão de stamina nem de vida — só `Player::gainExperience` tem —, então um herói
  exausto conta o boss, e quem não bateu (sem XP compartilhada) não. Os `killers` saem ANTES da
  XP do abate: o level up dele não pode mexer na régua de nível de `canShareExperience`. Mover o
  Bosstiary de volta para dentro do `eligible` "para ficar igual ao Bestiário" reabre a
  divergência — o que está desalinhado é o Bestiário (ADR 0043 d.1 / 0053 d.1), não o Bosstiary.
  O contador é chaveado pelo `raceId` do boss (em TEXTO: objeto JSON só tem chave de texto), e não
  pelo id de conteúdo, porque variantes do mesmo boss compartilham o `raceId` no Canary.
  **`definition.boss` decide a porta:** boss não soma no `Bestiary` (`Player::addBestiaryKill`
  devolve cedo para `isBoss()`) — esquecer o `if` faria o boss entrar nos marcos de XP. Os pontos
  são os do PRÓPRIO nível alcançado, somados ao total; nível fechado é o evento notável
  `bosstiary-level`.
- **A party é aritmética pura em `party.ts` (#189, ADR 0027; fórmula e elegibilidade emendadas
  pelo #525 em 2026-09-24/25, fidelidade CANARY do ADR 0037 d.4 — não TFS: as duas engines
  divergem no multiplicador, e é o Canary que manda em fórmula), e o ruleset só chama.**
  `uniqueVocations` conta `null` (sem vocação) como uma vocação DISTINTA, capada em 4
  (`Party::getUniqueVocationsCount` do Canary não exclui `VOCATION_NONE` — o TFS exclui, mas
  perde a decisão 4). `sharedExperiencePercent` é a fórmula do Canary em INTEIRO —
  `10n² − 20n + 130`, menos 10 se o TAMANHO do roster (não `n`) for ≥ 4 — reproduzida do CÓDIGO
  do Canary, não do comentário dele (que fala em "vocações", mas testa tamanho). `xpShare`
  (cota ARREDONDADA PARA CIMA — `ceil`, não `floor` —, dividida pelo TAMANHO TOTAL do roster,
  não por elegíveis; é a ÚNICA conta deste arquivo que NÃO descarta resto, porque não é escolha
  de quem leva o resto, é "todos levam um pouco mais"), `canShareExperience` (o TUDO OU NADA do
  `Party::canUseSharedExperience`, avaliado sobre o ROSTER inteiro — não só elegíveis: nível ≥
  2/3 do maior de TODO o roster, alcance/andar do LÍDER, atividade em `activityWindowMs` — falhar
  qualquer um desliga a cota igual do abate INTEIRO), `xpByDamage` (o rateio por dano quando a
  regra acima desliga — `floor(dano/total × xp)`, igual ao `Creature::getGainedExperience`, SEM
  o teto da cota compartilhada — quem causa 100 % do dano leva o XP inteiro do monstro; quem não
  bateu não recebe) e `settleEntries` (vende a bolsa ENTRADA por entrada, cada uma dividida só
  entre `eligible ∩ presentes` com `splitEqually` — resto UM a UM nos primeiros, porque gold
  descartado é valor que o ledger não vê; `value: 0` vai em `unsold`, para o líder, não para o
  gold), além de `autoSellLimit` (o limite de tipos do líder lê o Premium do PERSONAGEM). Nada
  aqui sabe o que é sessão — a atividade chega como `lastActionAtMs` já resolvido, não como
  `Runner`/relógio —; é o que permite testar por tabela. Duas populações, nomes DIFERENTES de
  propósito: `allMembers` (o roster inteiro — decide `n`, tamanho e quem `canShareExperience`
  confere) e `eligible` (vivo + stamina — decide só quem RECEBE a cota calculada).
- **A atividade de `canShareExperience` é `Runner.lastCombatActionAtMs`, escrita só por
  `#markCombatActive`** (`hunt.ts`, #525), nos MESMOS pontos que já creditam dano/cura para o
  DPS/HPS (#431): `#land` (golpe corpo a corpo/distância/wand) e `#applyHits` (magia em área)
  sempre; `#emitHealed` só quando o RECIPIENTE da cura é DIFERENTE do healer — curar A SI MESMO
  não conta (`Player::isPartner`, TFS e Canary, exclui `player == this` antes de registrar
  atividade por cura; o HPS continua contando o self-heal, só esta atividade não). Um ponto de
  escrita a mais divergiria do que já é creditado em algum lugar. `null` é "nunca agiu" — o mesmo
  efeito conservador de um `ticksMap` vazio no TFS/Canary logo após a entrada ou uma retomada de
  snapshot (o campo é opcional no `RunnerState`, ausente quando `null`). Consequência OBSERVADA
  (ou, no self-heal do Canary, INTENCIONADA e confirmada pelo TFS funcional — o código do Canary
  para esse caminho específico tem uma variável não resolvida antes do uso, o que o torna inerte
  na versão observada), não defeito: o abate que acontece no instante 0 de uma hunt cai sempre no
  rateio por dano — ninguém teve tempo de agir ainda —, e um membro que nunca ataca nem cura
  OUTRO (sem bot configurado, por exemplo) desliga a cota igual para a party inteira pelo resto
  da hunt, não só para ele.
- **Agregados são POR PARTICIPANTE desde o #187, e `session.aggregates` é a SOMA.** Escreva
  com `session.credit(id, key, delta)` — nunca `session.aggregates.x += n`: `credit` escreve
  no participante e na soma no mesmo passo, e trata `best*Hit` como máximo. `end()` devolve
  um `Receipt` por participante, cada um com `seq` próprio (o ledger é `UNIQUE (session_id,
  seq)`); `leave(id, reason)` vale em qualquer sessão e devolve quem saiu com o extrato dele,
  emitido DEPOIS do `onLeave` — é o que faz o settlement da bolsa entrar no extrato de quem sai.
- **No modo compartilhado a bolsa é da SESSÃO, e a capacidade dela é derivada** (#192, ADR
  0027). `#bag` guarda gold e itens; a capacidade é `Σ capacity` dos presentes calculada na
  hora — guardar e somar/subtrair divergia no primeiro level up, que reescreve `capacity`
  pela tabela. O excedente força a entrada na mochila do líder, peso ignorado (`forceAdd`, ADR
  0048 decisão 7 — sem a Caixa de Loot da Sessão, não há mais para onde mandar); `itemsLooted`
  conta para todo presente.
Desde o #395 a lista de `collect` filtra DEPOIS do `rollLoot` (item fora fica no cadáver) e
  `autoSell` vira gold no drop, cortado pelo `autoSellLimit` do líder; cada `BagEntry`/
  `GoldEntry` guarda `eligible` = presentes no abate (§16.1), e `#settle` vende por entrada —
  na saída (com quem sai), no fim e ao desligar `splitLoot`, com `reason` no evento.
  O settlement (`#settle`) roda no `onLeave` COM quem sai, no `onEnd` e no `toggle`, antes de a
  `Session` emitir os extratos — é o que põe o gold neles. O supply do vocabulário v2 é
  **abstrato**: usar debita o `price` do gold no ato (`useSupply`, `casting.ts`), sem pilha e
  sem reposição. O rateio do supply é uma `Purse` (`casting.ts`): `useSupply` confere
  `canAfford` antes de qualquer efeito e chama `pay` depois, e a bolsa de um (`ownPurse`) é o
  solo de sempre; a compartilhada (`#sharedPurse`) debita `floor(c/n)` de cada um, o resto do
  usuário, cobre quem não tem e credita `goldSpent` a cada um pelo que pagou — o extrato de cada
  membro sai equalizado.
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
  seria uma segunda regra que ninguém escreveu. E `xpBonusPercent` é lido antes de `record` (DT-04)
  porque a ordem inversa faria o abate 10 000 ser o único da vida do personagem a render
  diferente dos vizinhos. **Os bônus SOMAM entre si** (#563): Bestiário + faixa de level + os que
  vierem (VIP, evento), e a multiplicação acontece UMA vez (`applyExperienceBonus`, em INTEIRO —
  `floor(xp × (100 + soma) / 100)`), nunca `floor(xp × 1,13)`: `100 × 1.13` é `112.99999999999999`,
  e um abate em cada setenta perderia um ponto sem ninguém saber por quê. Encadear um `floor` por
  bônus perde ponto na borda de cada um. Por isso o conteúdo exige percentuais inteiros, e
  `Bestiary.xpBonusPercent` devolve o percentual, nunca um multiplicador em ponto flutuante: quem
  mostra o bônus soma os marcos e multiplica por `p` (é o que o cliente faz).
- **Regra de saída é compilada em `hunt.ts`, não em `bot.ts`** (FUN-86). O predicado lê a
  `HuntView`, e `bot.ts` não conhece ruleset nenhum — o mesmo bot vai valer para quest e boss.
  `CompiledBot.exit` sai cru de propósito; quem tem a view é quem fecha a closure.
- **`out-of-gold` olha o SALDO, nunca o delta.** Delta negativo é qualquer um que gastou uma
  poção; saldo zero é quem não consegue comprar a próxima. E `hp-below` compara ESTRITO: com
  `<=`, "sair abaixo de 100%" encerraria a hunt de quem entrou de vida cheia.
- **"Em combate" tem UMA definição, `isInFight` (`combat/in-fight.ts`, #625), e é ela que
  conclui a saída da hunt.** Último ataque DADO ou RECEBIDO há menos de `IN_FIGHT_WINDOW_MS`
  (60 000 ms — a janela do `pzLocked`/`CONDITION_INFIGHT` do Canary; o carimbo é por dano
  APLICADO e não cobre tudo o que o Canary conta, ver o cabeçalho de `in-fight.ts`), lido de
  `CharacterRuntime.lastCombatActionAtMs`. **Não confundir com `Runner.lastCombatActionAtMs`**
  (a atividade de `canShareExperience`, §16 acima): aquele é só DADO e exclui self-heal, porque
  o que ele mede é engajamento com a party; este soma o RECEBIDO e não exclui nada, porque
  apanhar também deveria travar a saída no Tibia — dois campos com o mesmo nome, em classes
  diferentes, por propósitos genuinamente diferentes. Escrito em `#land`/`#applyHits` (dado, ao
  monstro) e `#applyMonsterHit` (recebido, do monstro — básico e ability declarada passam os
  dois por ali); NÃO em `#reflectOntoMonster`/`#reflectOntoCharacter` (a segunda resolução do
  reflexo já acontece no MESMO golpe já marcado) nem em cura (curar não é atacar,
  `Player::onAttacked`/`onAttackedCreature` do Canary também não contam). `#beginExit`/
  `#finishExit` (saída manual via `requestExit` E saída por regra do bot via
  `#applyExitRules` — as duas passam pelas duas) continuam iniciando com `exitDelayMs`, a
  contagem VISUAL de sempre; a trava de combate é uma SEGUNDA barreira, por cima: se
  `#finishExit` encontra o personagem em combate, ela NÃO conclui — reagenda `EXIT_COUNTDOWN`
  para o instante exato em que a janela do carimbo MAIS RECENTE vence (`lastCombatActionAtMs +
  IN_FIGHT_WINDOW_MS`), e `pendingExit` continua marcado, então nenhum `#beginExit` novo se
  soma por cima enquanto ela espera. Um ataque NOVO durante a espera não é observado até o
  evento agendado vencer — é aí que `#finishExit` relê o carimbo mais recente e, se ele
  avançou, reagenda de novo a partir dele; é assim que "o último" continua sendo o último, sem
  polling. `party-member-lost` (saída em cascata quando outro membro sai/morre) CONTINUA
  imediata, sem exitDelayMs nem esta trava — ela nunca passa por `#beginExit`/`#finishExit`,
  chama `#depart` direto, e não é a INTENÇÃO de sair que o invariante 3 protege. Alimenta
  também o decaimento de imbuement fora de combate (#606): uma segunda fórmula de "em combate"
  em outro lugar seria a mesma divergência que `Skills.merge`/`Bestiary.merge` evitam vivendo
  cada um num arquivo só.
- **A saída que o jogador pede tem três pontos de entrada no ruleset (#802).** `requestExit` é o
  pedido (o `leave-hunt` do socket chama ESTE, e não mais `session.end`/`session.leave`);
  `cancelExit` desfaz a saída MANUAL pendente (devolve `false` sem mexer em nada se não há uma, ou
  se a pendente é a de uma regra do bot — que dispararia de novo no ciclo seguinte) e **cancela o
  evento `EXIT_COUNTDOWN` agendado**, porque só zerar `pendingExit` deixaria o evento velho vencer
  depois de um pedido novo e concluir a saída antes da hora dele; `exitStatus` é a leitura pura do
  que o hospedeiro apresenta (`{ reason, phase, untilMs }`): a fase é `in-combat` quando o carimbo
  de combate está dentro da janela, e `untilMs` é o MAIS TARDIO entre o `EXIT_COUNTDOWN` agendado
  (`session.dueAtOf`) e o fim da janela — o evento só relê um golpe novo quando vence, mas o que o
  jogador precisa ver já é o prazo empurrado. `exitStatus` não guarda estado nenhum (nada novo no
  snapshot) e só varre a fila enquanto há saída pendente.
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
  como lista plana sem bump) e pelo host no `move`. O lugar NUNCA recusa loot: só o peso recusa
  (`add`) — o que não coube por capacidade fica no cadáver do monstro (ADR 0048 decisão 7);
  `forceAdd` ignora o peso de propósito, para os dois casos sem cadáver à mão (grant de
  vocação/kit, sobra da bolsa de party). `move` é transação — valida tudo, depois escreve; a
  recusa não muta. A mochila só sai vazia.
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
  `Ruleset.shared` diz SÓ "sair é `leave`"; quem diz se a sessão credita é `Ruleset.progress`
  (`'none' | 'checkpointed'`, OW-03, ADR 0060 d.10b), e `progressOf(ruleset)` o resolve — ausente,
  a privada é `'at-end'` (credita no `end`) e a compartilhada é `'none'`. Cidade e hunt NÃO
  declaram o campo, de propósito: declarar mudaria o que o hospedeiro lê.
- **`Session.checkpoint(id, reason)` é o extrato parcial, com a semântica de delta de `leave`**
  (OW-03): emite o extrato (`seq` novo), zera os agregados DAQUELE personagem e o deixa na sessão.
  Três armadilhas. (1) A SOMA `session.aggregates` NÃO é zerada — segue o acumulado da sessão,
  como depois de um `leave` —, então `Σ aggregatesOf(p) ≠ aggregates` numa sessão que já
  checkpointou. (2) O marco dos eventos notáveis é uma POSIÇÃO na lista (`#notableCursor`), e
  não só `joinedAtMs` (que o checkpoint também move): o tempo sozinho repete ou perde os eventos
  do instante exato do checkpoint, e os de instante lógico igual chegam depois dele quando uma
  intenção cai entre dois `advanceBy`. O cursor não entra no snapshot — a sessão `checkpointed`
  não tem snapshot (ADR 0060 d.10a). (3) Depois do `end` devolve `null`: os agregados dele
  continuam na sessão e um extrato novo os creditaria de novo.
- **Os tetos são por sessão** (OW-03): `SessionOptions` (e o 4º argumento de `fromSnapshot`)
  aceita `maxPendingDomainEvents`, `maxEventsPerAdvance` — com as constantes de sempre como
  default — e `maxNotableEventsPerCharacter`, sem default. O evento notável não tem dono, então o
  teto é da LISTA (`× max(1, participantes)`), e quem indexa `notableEvents` por posição — o
  analisador do hospedeiro — precisa somar `session.notableEventsDropped`.
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
- **Fim do pull por dificuldade: `Spawner` tem UM slot por ponto de spawn da rota, e todos
  nascem juntos, na entrada** (#583, ADR 0039 — revoga o `monsterCount`/espalhamento por laço
  da FUN-123, cópia do Huntera de 2/5/8 no bueiro). Cada ponto declara o próprio `monsterId`
  (ou `monsters`, com peso, para o caso raro do #582) e o próprio `respawnDelayMs` — não existe
  mais composição de dificuldade para cair como fallback. O tile livre é procurado até o
  `radius` DO PONTO, que a rota autora. Rota sem ponto de spawn é hunt sem monstro.
  **A população INICIAL usa um evento próprio, `SPAWN_INITIAL`/`#onSpawnInitial`, que
  BYPASSA `blockable`/janela de visão/telegraph inteiramente** — é o `startup(bool delayed)`
  do Canary (`spawn_monster.cpp`), que chama `scheduleSpawn` direto, sem passar por
  `checkSpawnMonster`. Só o RESPAWN pós-morte (`SPAWN`/`#onSpawn`) passa pela gating abaixo.
  Parede/tile ocupado adia (`SPAWN_RETRY_MS`), nunca cancela — mecanismo de sempre.
- **O cadáver é um evento de presença, e é só visual** (`ground-item-appeared` /
  `ground-item-vanished`, FUN-123). O `sim` diz QUAL monstro morreu e ONDE; a arte é da tabela,
  resolvida no hospedeiro (invariante 6). O prazo é o evento `CORPSE` na fila, com
  `corpseTtlMs` do MONSTRO (#585, era da hunt) — monstro sem o campo não deixa cadáver, e **invocação
  nunca deixa** (#600, `Creature::dropCorpse`). Os cadáveres entram no snapshot
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
- **A IA do TFS é entrada independente, evento na fila — nunca um "pensamento" por tick**
  (#518, referência §15-19). `ability.chance` AUSENTE é sempre passa e NÃO consome sorteio (o
  mesmo argumento do `blockChance`/CMB-04 e do `modifiers.critical`/CMB-08 — preserva rato e
  rotworm bit a bit); declarada, consome UMA rolagem por vencimento mesmo em 1.
  `#onMonsterAttack`/`#onMonsterAbility` REAGENDAM antes de rolar a chance, para o intervalo
  correr mesmo quando a rolagem falha. `wave`/`beam` de ability saem na direção do ALVO,
  recalculada a cada golpe por `facingDirection` (`area.ts`, eixo de maior deslocamento, empate
  decide horizontal) — DIFERENTE de `directionOf`, que é do PASSO e sempre prioriza horizontal.
  `monster.defenses` (cura própria) é evento POR DEFESA, subject derivado `m:<id>:<defenseId>`,
  `scheduledDefenses` (opcional no snapshot); não depende de alvo, e de vida cheia não emite
  `creature-healed` — a mesma regra de `#emitHealed`. `monster.targetChange` (#645, ADR 0037
  d.6) NUNCA consulta `targetStrategy` — o `targetDistance` do TIPO (`definition.
  targetDistance`, #542 — o mesmo `info.targetDistance` que o Canary lê) decide sozinho entre
  `TARGETSEARCH_RANDOM` (`targetDistance <= 1`: um alvo ao acaso DIFERENTE do atual dentro do
  `aggroRadius`) e `TARGETSEARCH_NEAREST` fixo (`targetDistance > 1`, via `nearestPrey`, o mesmo
  desempate estrito da aquisição). A estratégia ponderada do Canary só entra no ramo estreito de
  `chooseTarget` equivalente a `TARGETSEARCH_DEFAULT`: um alvo JÁ retido, o monstro FUGINDO
  (`isMonsterFleeing`) e sem conseguir atacá-lo agora (`rankTarget`, `target-strategy.ts`) — e
  esse ramo reavalia no máximo uma vez por 1000 ms por monstro (`monster.cooldowns`, chave
  `target-think`), a mesma cadência de `EVENT_CREATURE_THINK_INTERVAL`: os três eventos que
  chamam `chooseTarget` (passo, ataque básico, ability declarada) não podem reentrar nele a cada
  vencimento, achado da revisão do #654 — ver "Seleção ponderada de alvo" em
  `docs/product/combat.md`.
  `isMonsterFleeing` (`monster.ts`) é PURA — `health <= runOnHealth`, recalculada
  a cada decisão, nunca um booleano guardado; fugindo, o passo é SEMPRE `fleeStep` (nunca
  aproxima) e as abilities CORPO A CORPO (`isMeleeAbility`) nem armam nem executam — as de
  alcance continuam, porque passo e ataque são decisões independentes.
- **A dança de alvo (`staticAttack`, #543, TFS `Monster::getDanceStep`) é um evento PRÓPRIO,
  armado e DESARMADO — não uma varredura da vida inteira do monstro, como `MONSTER_TARGET_CHANGE`
  e as defesas.** `MONSTER_DANCE` (subject `m:<id>` exato, cancelado de graça por `resolveDeath`
  como `MONSTER_TARGET_CHANGE`) só existe agendado enquanto `decideMonsterAction` devolve
  `'attack'` (colado, sem passo a dar): `#onMonsterStep` arma quando essa condição nasce e
  DESARMA ativamente (`session.cancelEvent`) quando ela cai, em vez de deixar o timer rodando à
  toa — o custo de um monstro fora de combate importa em escala (ver "custo" no topo deste
  arquivo). `#onMonsterDance` reavalia a MESMA condição a cada vencimento (a condição pode ter
  caído entre o armamento e o vencimento) e só reagenda a si mesmo enquanto ela se mantém — a
  outra metade do "cancelado". `MonsterRuntime.danceArmed` é o que impede armar duas vezes o
  mesmo evento (`scheduleIn` não deduplica por `(kind, subject)`) e precisa sobreviver ao
  snapshot pela mesma razão de `lastStepBlocked`. `danceStep` (`monster/step.ts`) só tenta as
  QUATRO direções CARDINAIS — nunca diagonal, diferente do guloso/fuga — e só aceita a
  candidata que preserva EXATAMENTE a distância Chebyshev ao alvo: é o que garante, de graça,
  que a dança nunca aproxima, nunca afasta e nunca perde a capacidade de atacar (o `keepAttack`
  do Canary vira identidade sob essa restrição). Ausente `staticAttack`, o monstro nunca arma o
  evento e não sorteia nada de novo — rato e rotworm continuam bit a bit. **Não toca o resolver
  de combate** (`resolveDamage`/`resolveDefense`): os sorteios da dança são de uma fila
  totalmente separada da sequência de combate, o mesmo argumento que já vale para `chooseTarget`
  — por isso não exige perfil `combat-v1`/`v2`/`v3` novo (ADR 0031/0040).
- **Sem passo de perseguição o monstro volta ao spawn, fica ocioso ou anda ao acaso — e tudo isso
  mora em `decideUnengagedMove`, não em `decideMonsterAction`** (#655, Canary
  `Monster::updateIdleStatus` + `getNextStep`). `decideMonsterAction` continua decidindo só a
  PERSEGUIÇÃO e devolvendo `idle` quando não há passo; é `HuntRuleset#onMonsterStep` quem, nesse
  caso, chama a outra. A "lista de alvos" do Canary é quem está na área de visão (`canSeePoint`,
  `monster/step.ts`, com as regras de andar do `Creature::canSee`; o raio é o `aggroRadius`): vazia,
  no `home` e sem condição nenhuma é OCIOSO (nenhum passo; `Contribution.clear()`); vazia e fora do
  `home`, LIGA `walkingBack` e volta pelo guloso (`walkBackStep`); com passo aleatório é
  `shuffledCardinals` (3 `rng.integer` por tentativa) e a primeira direção livre de `canWalkTo`
  (`#randomStepBlocked`), no máximo uma por `RANDOM_STEP_INTERVAL_MS` desde
  `MonsterRuntime.lastMoveAtMs`. Armadilhas: (1) **`walkingBack` e `randomStepping` PERSISTEM** — a
  primeira só `doWalkBack` a desliga, a segunda só a perseguição —, e são o quirk do Canary, não
  descuido: um alvo que aparece no meio da volta não a desliga, e `randomStepping` velho arma o
  bypass de campo ao tomar dano (`MonsterRuntime.noteDamageTaken`, o ponto único dos cinco caminhos
  de dano a monstro; só a perseguição e a volta o consomem — o passo aleatório e o ocioso o deixam
  armado). (2) **`lastMoveAtMs` só é escrito por `#step`** — qualquer código novo que
  mude `monster.position` por fora dele (como os testes) deixa o passo aleatório contando de um
  instante velho. (3) **A retenção do alvo exige a área de visão** (`chooseTarget`): sem isso, com
  `leashRadius` 0 o monstro persegue para sempre e a volta nunca liga. (4) **`aggroRadius: 0` já não
  "congela" um monstro reposicionado à mão**: sem ninguém à vista e fora do `home` ele VOLTA; o
  teste que planta um monstro precisa plantar o `home` junto (`plant` em `hunt.test.ts`) — e o que
  conta `rng.integer` precisa isolar os três sorteios do passo aleatório. (5) Invocação nunca volta
  nem fica ociosa (`masterId`), e sem alvo a de PERSONAGEM segue o mestre (`summonFollowStep`, #599 —
  a de outro monstro continua parada; sem mestre à vista ou sem caminho a de personagem vagueia). (6) **O
  ocioso CALA defesa, troca de alvo e invocação** (o Canary tira o monstro do `onThink`):
  `MonsterRuntime.idle` é escrito por `#onMonsterStep` a cada decisão (liga no `idle`, desliga em
  qualquer outra) e `#onMonsterDefense`/`#onMonsterTargetChange`/`#onMonsterSummon` REAGENDAM e
  voltam antes de rolar — a fila continua dirigida por evento, e a semente não é tocada. Sem o
  corte, um Doom Deer ocioso se dá haste, a condição impede o ocioso e ele passeia pelo spawn.
  (7) **A provocação (`CHALLENGE_CONDITION_KEY`) mora em `conditions` mas NÃO é `Condition` do
  Canary** (é o `challengeFocusDuration`): qualquer teste de "tem condição?" para o ocioso e a
  volta usa `hasActiveCondition`, nunca `conditions.size`. (8) **A busca de caminho da volta tem
  predicado PRÓPRIO** (`HuntRuleset#walkBackPathBlocked`): o `blocked` do guloso passa por
  `canOccupy`, que recusa como `not-adjacent` todo tile que não é vizinho do monstro — passado
  à busca, ela nunca acharia caminho (só um teste em sessão de verdade pega isso, e um predicado
  estático nos testes unitários o esconde). (9) `walkBackByPath` é estado, não otimização: sem ele
  o guloso volta a entrar na bolsa que a busca acabou de tirar o monstro.

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
  impacto ainda pratica — em `combat-v1`/`v2`; no `combat-v3` (#686) quantos tries o golpe rende
  vem do tipo de bloqueio (`combat/attack-practice.ts`, estado em
  `CharacterRuntime.attackPractice`). O tiro emite `shot` ANTES do `creature-hit`; o projétil é da tabela,
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
  nunca em elemental. No `combat-v3` (#686), só quando o golpe recebido foi BLOQUEADO, com escudo
  na mão (`afterShieldBlock`). Não há fight mode, opcode nem UI (DT-03).
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
- **Crítico e leech de item/monstro têm fonte e ordem PRÓPRIAS no `combat-v3`** (M30-04, #551).
  A rolagem do crítico se MOVEU: em `combat-v3` ela agora acontece na GERAÇÃO do dano, ANTES do
  `blockHit` (`resolveBlockHitProfile`, `combat/damage.ts`) — a mesma posição do Canary
  (`Combat::applyExtensions`, chamado antes de `Creature::blockHit`), diferente de `combat-v1`/
  `v2`, onde continua a ÚLTIMA (bit a bit, intocado). A FONTE deixou de ser só o
  `combat.modifiers` estático: `Inventory.combatModifiers` (`inventory.ts`) soma o
  `ItemCombatModifiers` do que está vestido, em pontos-base (×10000, a escala do Canary);
  `monsterCriticalModifiers` (`combat/modifiers.ts`) lê `Monster.critChance` (percentual, não
  pontos-base — a MESMA escala do Lua) para o ataque de monstro; `HuntRuleset#attackerModifiers`
  soma as duas fontes com `combat.modifiers` (`combineCombatModifiers`) e alimenta `#strike`,
  `castSpell` E `useSupply` (magia e runa também criticam, como no Canary — só ataque de monstro
  nunca soma `combat.modifiers`, nem leecha: leech é mecanismo exclusivo do atacante JOGADOR).
  **O leech NÃO é uma fração direta nem uma divisão simples por `targetsAffected`** —
  `calculateLeechAmount` (`combat/modifiers.ts`) é `Game::calculateLeechAmount` do Canary:
  `realDamage × leechFraction × (0,1n + 0,9) / n`, arredondada (não truncada) e limitada ao
  `realDamage`. Para `n = 1` o fator é `1` (identidade); para `n = 5` é `0,28`, não `0,2` — quem
  escrever "divide por targetsAffected" de novo em algum lugar está reintroduzindo a
  simplificação errada. `applyLeech` (mesmo arquivo) é a peça COMPARTILHADA entre o golpe único
  (`applyDamageOutcome`) e a magia em área (`HuntRuleset#applyHits`, que NÃO passava por
  `applyDamageOutcome` — o leech ali é aplicado directo sobre o `healthDamage` de cada alvo, com
  o MESMO `targetsAffected` para todos os alvos da mira).
- **Absorção de item, reflexo e cleave são do `combat-v3` e ficam fora de `resolveMitigation`**
  (M30-05, #552). A resistência do ITEM, sob v3, é absorção ITEM A ITEM depois da armadura
  (`equipmentAbsorb`, ordem de slot do Canary) — `#playerDefender` passa `immunitiesOnly` como
  `mitigation`; somar a resistência de novo ali a aplicaria duas vezes. O reflexo é calculado no
  resolver (`DamageOutcome.reflected`) e a SEGUNDA resolução é do ruleset
  (`#reflectOntoMonster`), com `reflectedDamageIntent` marcado `extension` — é essa marca, e não
  um contador, que impede reflexo sobre reflexo. O mecanismo é por fonte (`DefenderReflect.
  reflector`): o reflexo de monstro (#683) reusa `resolveReflect`, não escreve outro — a segunda
  resolução contra o personagem é `#reflectOntoCharacter`. A cura por elemento do monstro (#683)
  é calculada no resolver (`DamageOutcome.elementHealing`, opcional) e aplicada pelo ruleset em
  `#healMonsterByElement`; `#afterMonsterHit` é o ponto ÚNICO de `#land` e `#applyHits` para as
  duas — um terceiro caminho de dano no monstro precisa chamá-lo, ou golpe e magia divergem. O
  `attacker` do intent só existe quando o monstro reflete: sem isso, cada golpe alocaria um objeto
  à toa. O cleave rola
  o poder de CADA vítima antes do golpe principal — a rolagem extra só existe com `cleavePercent`
  vestido, o que mantém o resto bit a bit.
- **A conformance de combate é ORÁCULO explícito, nunca snapshot da implementação** (CMB-10,
  #336). `combat/conformance.test.ts` prende fórmula, ordem de RNG e arredondamento com dados
  escritos à mão, cada caso a 100 ms, a 1000 ms e com snapshot/retomada; o `RngState` é
  comparado entre as três, nunca copiado para o oráculo — ele não é número que se lê, é
  propriedade de equivalência. `combat/conformance.ts` é a comparação PURA; o cenário misto do
  benchmark vive em `tools` e a interpretação da linha de base em
  `docs/product/combat-conformance.md`.
- **`circle` tem DOIS mecanismos de raio, e o parâmetro `source` de `areaTiles` (#523) escolhe
  qual** — a magia usa as `AREA_CIRCLEnXn` nomeadas do Canary (raio 1-3 com bônus de
  achatamento, raio ≥ 4 diamante puro, SEM o bônus — uma descontinuidade real da autoria, não um
  erro de leitura), a ability de monstro usa a tabela de anéis de `AreaCombat::setupArea(radius)`
  (mecanismo diferente, escala de raio diferente: raio de monstro 5 e raio de magia 3 dão a
  MESMA forma por coincidência, não porque sejam o mesmo raio). O default é `'spell'` — quem
  escreve uma ability de monstro em área precisa passar `'monster'` explicitamente (só
  `monster/ability.ts` faz isso hoje); esquecer faz a ability usar a tabela errada em silêncio,
  sem erro de tipo nenhum para pegar.
- **Hunt multiandar (#519): o monstro carrega `z` para achar o PRÓPRIO andar, nunca para trocar
  de andar sozinho.** `MonsterRuntime.position`/`.home` passaram a ser `FloorPoint` (`z`
  opcional — ausente é snapshot anterior a esta issue, ou hunt de andar único). Isso faz `zOf`
  (`movement.ts`) resolver o andar CERTO para ele em `canOccupy`/`move`/ocupação — sem isso, todo
  monstro de um mapa multiandar seria tratado como se estivesse no andar padrão do mapa. O
  `crossesFloors: false` de `MonsterRuntime` é o que impede esse `z` novo de virar permissão de
  usar escada: antes desta issue, "não carrega `z`" e "não sobe escada" eram a MESMA checagem
  (`'z' in from`); agora são duas, porque o monstro passou a satisfazer a primeira sem poder
  satisfazer a segunda. Mexer nessa dupla checagem sem entender as duas metades quebra uma das
  duas invisivelmente.
- **Todo lugar que compara alvo por distância confere o ANDAR primeiro** (#519,
  `sameFloor`/`FloorPoint` em `monster/step.ts`): `chooseTarget`, `selectTarget`/`countTargets`/
  `countAreaTargets` (`targeting.ts`), `abilityTargets` (`monster/ability.ts`) e
  `#spawnBlockedFor`/`#liveTargetOf`/`#holdFollow` (`hunt.ts`). `sameFloor(a, b)` é NO-OP quando
  QUALQUER lado é `undefined` — é o que mantém bit a bit toda hunt de andar único e todo
  snapshot anterior a esta issue, onde `z` nunca era escrito. Antes desta issue,
  `abilityTargets` FORÇAVA `z: caster.z` em todo candidato antes de montar a chave — parecia
  reforçar "mesmo andar", mas na verdade fazia o oposto: aceitava QUALQUER andar do candidato,
  porque a chave comparada era sempre a do lançador. Ver #519 no ADR 0025 (emenda).
- **`Blocked` (`monster/step.ts`) ganhou dois parâmetros opcionais, `z` e `monsterId` — nesta
  ordem, e os dois só importam para o spawner.** O passo guloso de personagem e monstro continua
  chamando com dois argumentos; `Spawner.#freeTile` é quem passa os quatro, porque só ele
  precisa saber EM QUE andar e PARA QUAL monstro a checagem vale — o campo da hunt que fazia
  isso (`spawnClearRadius`, #236) foi REMOVIDO no #583; quem decide hoje é `blockable` DO
  MONSTRO (#519, o `isBlockable` do TFS/Canary, onde NÃO esperar é o padrão de 1.640/1.656 do
  bestiário, não a exceção) — e só no RESPAWN pós-morte, nunca na população inicial (ver acima).
- **A condição `speed` (CMB-11, #556) sempre nasce com a chave RESERVADA `SPEED_CONDITION_KEY`
  (`'speed'`, exportada de `@draconya/content`), e `conditionFromSpec` confia nisso — não a
  reescreve.** É o CONTEÚDO (`conditionSpecSchema`) quem recusa `key` diferente para
  `effect.kind === 'speed'`, no boot; o `sim` não confere de novo em runtime. É essa chave
  compartilhada — não uma lógica de exclusão mútua nova — que faz haste e paralyze de fontes
  DIFERENTES (ability de ataque, defesa self-haste) se substituírem inteiro, como
  `Creature::onAddCondition` do Canary/TFS faz com dois `ConditionType_t`. Um `ConditionSpec` de
  `speed` fora desses dois caminhos (`ability.condition`/`defense.condition`) — um campo, por
  exemplo — também precisa da mesma chave, ou o boot recusa.
- **`resolveSpeedPercent` (`conditions.ts`) exige `SpeedContext` (`baseSpeed`, `rng`) para
  `effect.kind === 'speed'`, e `conditionFromSpec` LANÇA sem ele** — nenhum default silencioso
  que deixaria a velocidade em 1. Todo call site de `conditionFromSpec` no `hunt.ts` (ability,
  defesa, campo) já passa `{ baseSpeed: target.speed, rng: session.rng }`; um call site NOVO
  para uma condição que pode ser `speed` precisa do mesmo. `min`/`max` da fórmula são TRUNCADOS
  (`Math.trunc`, como o C++ trunca `float` → `int32_t`), nunca arredondados, e `min === max` NÃO
  consome sorteio — a mesma regra do `uniform_random` do Canary quando os limites coincidem.
- **Imunidade de condição e invisibilidade (#559, ADR 0041 d.2) têm UM portão cada, e a
  invisibilidade tem um TIMING que é evento, não checagem.** (a) `#applyConditionTo` recusa a
  condição de um combate para o monstro imune (`conditionImmunityOf`, `conditions.ts`: `paralyze`
  = o sinal NEGATIVO de `speed`, `drunk`, e a DOT pelo `damageType` do tique) — **mas só quando o
  chamador passa `fromCombat = true`** (o DOT de `#castSpell`, a Paralyze Rune de `#useSupply`, a
  ability de monstro): no Canary só `Combat::CombatConditionFunc` bloqueia uma condição por
  imunidade, e o que entra por `addCondition` direto (campo de tile, defesa própria, os charms
  Cripple/Numb) não a consulta. Um chamador novo e não combativo (um charm) nasce SEM o portão;
  ligá-lo por padrão a tudo que tem origem estrangeira paralisa Dragon Lord com Cripple. A
  auto-aplicação (`condition.sourceId === target.subject`) pula o portão até dentro do combate, e
  campo de tile NÃO passa por ele — `FIELD_TICK` tiqueta direto. `invisible` NUNCA entra: a
  imunidade é `seesInvisible` (`monster.ts`), "enxerga o invisível". (b) **`#drainMonster` é o
  `Monster::drainHealth`, o cano ÚNICO do dano de vida num `MonsterRuntime`** — golpe, magia/runa,
  tique de DOT e de campo, reflexo, golpe de invocação: aplica o `applyDamageOutcome`, e com dano
  REAL (`applied.healthDamage > 0`) arma o bypass de campo e revela o monstro invisível. Todo ponto
  novo que tire vida de um monstro (os charms de dano, por exemplo) chama ELE, nunca o
  `applyDamageOutcome` direto: um ponto que pule o cano esconde os dois efeitos sem teste nenhum
  que o aponte. Só o monstro perde a invisibilidade por dano; a do JOGADOR não. (c) **Largar o
  alvo que ficou invisível é o `Creature::onThink`, uma vez por 1000 ms numa fase por criatura — no
  sim é o evento `visibility-think`** (`#scheduleVisibilityThinks`, agendado em `#applyConditionTo`
  quando a invisibilidade COMEÇA, não quando é renovada): cada monstro que perseguia o invisível e
  não o enxerga pensa uma vez em `[0, 1000)` ms (sorteio da sessão) e larga o alvo se ele ainda
  estiver invisível. `chooseTarget` NÃO larga sozinho — largaria antes do Canary, porque roda a
  cada passo — e só filtra a AQUISIÇÃO (aquisição, ramo estreito de fuga, `targetChange`,
  `#applyChallenge`). Do lado do jogador, o alvo ELEITO pelo bot cai na hora (`selectTarget` nunca
  escolhe invisível, targeting do bot é do Draconya, ADR 0037 d.2) e o FIXADO pelo jogador segue
  até o think — e o golpe dele nesse intervalo revela o monstro. **O campo do alvo eleito é
  limpo NO EVENTO em que a invisibilidade começa (`#scheduleVisibilityThinks`), nunca por um
  leitor**: `#attackTargetOfRunner`/`#botCandidateOf` são alcançáveis da apresentação
  (`slotStates` → `#targetInRange`, só com visualizador anexado), então para o invisível não
  fixado eles devolvem `null` SEM escrever — escrever ali faz o snapshot depender de haver alguém
  assistindo (invariante 3). Toda invisibilidade que entra sem passar por `#applyConditionTo` (um
  teste que faz `conditions.apply` direto) não agenda think nem limpa o campo, e o monstro que a
  persegue nunca a larga: use a magia ou a defesa de verdade. (d) **A recusa de monstro invisível
  como alvo MANUAL (`setAttackTarget`, o `target-cancel` do host, `use-slot`/`use-item-on` de
  efeito de alvo único) é um substituto de apresentação, não uma regra do Canary**: lá o cliente
  nem recebe a criatura (`ProtocolGame::canSee`), e o servidor só decide o tile
  (`Spell::playerRuneSpellCheck`, `needTarget`). O efeito de ÁREA/campo mirado no monstro invisível
  sai no tile dele (`#resolveManualTarget`) — recusá-lo divergiria do Canary. (e) **Cancel
  Invisibility dispensa só os MONSTROS da forma (círculo de raio 3, `AREA_CIRCLE3X3`)**: o `combat`
  do script é agressivo por default e `CombatFunc` exclui o lançador; a invisibilidade do
  próprio Paladin sobrevive a ele.
- **A haste do JOGADOR (as quatro magias de vocação, Swift Foot) continua em `casting.ts`, à
  parte de `conditionFromSpec`.** `spellEffectSchema`'s `kind: 'haste'` (percentual FLAT, sem
  fórmula) não mudou nesta issue — as duas mecânicas escrevem o MESMO campo de runtime
  (`ConditionState.speedPercent`), mas por conteúdo e código diferentes; ver
  `docs/product/combat.md` (CMB-11) para o porquê de não terem sido unificadas.
- **`playerDefense`/`playerMitigation` (`combat/player-defense.ts`, #549, M30-02) conferem
  escudo e arma em SEQUÊNCIA, não em exclusão mútua** — a arma pode SOBRESCREVER o que o escudo
  já escreveu (`defenseValue`/`shieldFactor`/`distanceFactor`), na ordem exata do Canary
  (`Player::getDefense`/`PlayerWheel::calculateMitigation`): trocar a ordem das duas checagens
  muda o resultado do Knight com Mystic Blade + Mastermind Shield (as duas contribuem juntas).
  **`fightMode` é o estado do PERSONAGEM** (`CharacterRuntime.fightMode`, M30-03, #550), lido por
  `hunt.ts#playerDefenseV3`/`#playerMitigationV3` — nunca um `'attack'` fixo, e a constante
  `combat.weaponDamage.attackFactor` saiu do conteúdo. O fator de DEFESA é o dinâmico
  (`Player::getDefenseFactor(false)`): `playerDefense` recebe `recentlyAttacked`, que o CHAMADOR
  calcula com `attackedRecently(character.lastAttackAtMs, session.nowMs, attackIntervalMs)` —
  relógio LÓGICO da sessão, nunca de parede (invariante 2). `lastAttackAtMs` só é escrito por
  `#onPlayerAttack`, DEPOIS de `#strike` devolver `true` (a arma foi usada, como o `result` de
  `Player::doAttacking`) e só no `combat-v3`; `#strike` devolve `false` para o tiro que não saiu
  (sem visão, sem munição) — não copie o carimbo para um caminho que não é golpe de arma
  (magia/runa não escrevem `lastAttack` no Canary). **O carimbo é do relógio da sessão que o
  gravou**: `Session.enter` o zera (o `CharacterRuntime` atravessa a transição como o MESMO
  objeto e o relógio da sessão nova nasce em zero — sem isso um carimbo de 57 700 ms ficaria no
  futuro da hunt seguinte), e `attackedRecently` trata carimbo futuro como "nunca bateu"; o
  restore de snapshot não passa por `enter`, então a janela quente atravessa. **O empate exato**
  (`agora − lastAttack == attackIntervalMs`) só conta como janela aberta quando o golpe do herói
  está agendado para ESTE ms (`session.dueAtOf(PLAYER_ATTACK, id) === session.nowMs`, lido só no
  empate): monstro e herói que chegaram juntos batem no mesmo ms para sempre, e sem isso a ordem
  da fila decidiria a defesa — o Canary nunca fecha a janela de quem bate sem parar. O reflexo do
  próprio golpe roda com o evento do golpe já fora da fila e o `+ attackIntervalMs` reagendado,
  então enxerga a janela fechada, como o Canary (o carimbo só é reescrito depois dele). O fator de ATAQUE entra por
  `resolveWeaponPower`/`resolveWeaponHit` e é gated por perfil dentro delas (`attackFactorOf`):
  `combat-v1`/`v2` ignoram a postura — é o que mantém o resultado do perfil publicado bit a bit.
  **`#playerDefender` bifurca por
  `compatibilityProfile`**: `combat-v1`/`v2` continuam com os números antigos
  (`combat.player.armor` + equipado; `#defenseSourceOf`), só `combat-v3` usa as três funções
  novas — mexer nas duas sem entender a bifurcação quebra uma sessão v1/v2 congelada (ADR 0031).
  **A skill da arma para `playerDefense` NÃO é `#skillLevelOf` cru quando a família é `wand`**
  (achado de revisão, #549): a família `wand`/`rod` aponta `skillId: 'magic'` — usado para o
  DANO (DT-02) —, mas `Player::getWeaponSkill` do Canary devolve `0` para `WEAPON_WAND`
  (`default: attackSkill = 0`); `hunt.ts#playerDefenseV3` zera a skill nesse caso ANTES de
  montar o input, senão um Sorcerer/Druid sem escudo cai na fórmula cheia com `defenseValue` 0
  (wand/rod nunca declaram `defense`/`extraDefense`) em vez do piso fixo do Canary. **A skill de
  escudo (`#shieldSkillLevelOf`) soma o bônus de equipamento** (`Inventory.skillBonus`) como
  `#skillLevelOf` já fazia para arma/punho — `getSkillLevel` do Canary não abre exceção para
  `SKILL_SHIELD`.
- **Stairhop (#554, M30-07, ADR 0040 decisão 1; a condição `pacified` desde o #622): `#step` é quem
  detecta a travessia, não um booleano "é escada?" separado.** Escada e teleporte (#734) são os DOIS
  únicos jeitos de `move()` pousar num tile que não é o adjacente pedido — `z` diferente, ou
  distância — e é ESSE sinal, lido do `MoveResult`, que APLICA `pacified` por `stairhopDelayMs`
  (`#lockAfterJump` → `#applyConditionTo`, `merge: 'longest'`; Levitate e Magic Rope também o
  chamam, #623). Um passo comum nunca bate essa condição. Só sob
  `combat-v3` (`#isV3`) e com `combat.stairhopDelayMs` declarado (ausente é identidade, como
  `defense`/`modifiers`); v1/v2 nunca aplicam a trava de escada. **O portão lê a CONDIÇÃO, em
  qualquer perfil** (`Conditions.isActive`, o PRAZO — não o evento `condition-expire`, que vence
  depois do ataque do mesmo instante): `#onPlayerAttack` ESTACIONA o golpe (`#parkAttack`) — o
  Canary não re-arma o ataque quando `pacified` acaba, e o golpe sai no primeiro gatilho depois: o
  pensamento do personagem (`ATTACK_THINK`, na grade de 1000 ms dele) ou um passo do personagem ou
  do alvo (`#releaseParkedAttacks`, o `onCreatureMove` do Canary) — NUNCA no instante exato do
  vencimento nem no intervalo normal de ataque. E `castSpell`/`useSupply` (`casting.ts`) recusam a
  magia e a runa AGRESSIVAS com `attack-locked` — dano, DOT, a invocação (`summon_creature.lua` não
  chama `isAggressive(false)`), as runas de dano/campo, a Paralyze Rune e as duas de invocação
  (Convince Creature e Animate Dead, #600: `isAggressiveSupply` em `casting.ts` — os scripts
  também não o desligam); cura e o resto do vocabulário continuam liberados, a mesma exceção do `Spell::aggressive` do Canary.
  **Enquanto o golpe está estacionado (`Runner.attackParked`), `#armPlayerAttack` o ignora**: um
  personagem parado não reacende a cadeia por conta própria, e liberar no passo de combate-stop
  traria o golpe antes do pensamento. `attackLockedUntil` deixou de
  existir no runtime: o construtor de `CharacterRuntime` converte o campo de um snapshot antigo
  num `pacified` que vence no mesmo instante, e `getState` nunca mais o escreve.
- **As condições de controle (#622, M44-04, ADR 0041): `rooted`, `feared` e `pacified`.** Mesmo
  desenho do drunk — chave RESERVADA, sem campo próprio, lida por `Conditions.isActive(key, nowMs)`
  — mais `merge: 'longest'` (`Condition::updateCondition`: prazo menor não encurta o que já corre).
  Nada de `hasRooted()`/`hasFeared()`: seriam três nomes para a mesma leitura.
  - **`#step` é o portão dos três** (o único lugar que escreve posição). Sem `forced`, recusa a
    caminhada PRÓPRIA antes de qualquer sorteio (`rooted`/`feared`, razões novas em `MoveRejection`);
    sob `feared`, o passo de lista do PERSONAGEM (`forced` com `rollDrunk`) para um campo que causa
    dano volta ANTES do sorteio do drunk (`Player::onWalk`: sem sorteio e sem desvio); depois do
    desvio, recusa `rooted` sempre e, sob `feared`, o campo que causa dano no tile desviado
    (`internalMoveCreature`). O parâmetro `forced` marca o que NÃO é a caminhada própria — a fuga do
    medo, o passo de um `walk-to` já guardado e o empurrão (`#pushAside`). Esquecer `forced` num passo
    forçado o faria recusar sob `feared`; passá-lo num passo próprio o faria fugir do medo.
  - **O medo de PERSONAGEM não tem `condition-expire`.** Quem o encerra é o `FEAR_THINK` (o primeiro
    pensamento DEPOIS do prazo) — porque o Canary só limpa a condição nesse pensamento, e a fuga do
    último pensamento sai ANTES dele. Um `condition-expire` agendado limparia a condição antes desse
    pensamento e a lista final nunca sairia; por isso `#applyConditionTo` retorna cedo para o medo
    de personagem, e monstro (que não foge) segue com o `condition-expire` de sempre. Toda remoção
    por fora (`#dispelConditions`, o Cleanse) passa por `#endFear`, e a morte/saída por
    `#cancelConditionEvents` — se uma remoção nova esquecer os dois, o `FEAR_THINK` fica órfão na
    fila e a `fearWalk` continua andando. **A condição atravessa a troca de sessão** (#812, como todas:
    `onLeave` só tira os eventos, não a condição) e `#armConditions` a REARMA no `onEnter` — para o
    medo de personagem agenda um `FEAR_THINK` na grade da sessão nova, nunca um `condition-expire`
    (que fecharia o medo no instante do prazo, antes da última fuga). `rooted` e `pacified` usam o
    `condition-expire` genérico; o golpe estacionado (`attackParked`) e a `fearWalk` são do runner e
    morrem com a sessão — a nova decide de novo, pela condição.
  - **`Runner.fearWalk` tem prioridade absoluta em `#playerStep`** (acima do `walk-to`, do
    combate-stop, do follow e da rota) e persiste no snapshot (`RunnerState.fearWalk`). A lista guarda
    valores do enum `Direction` do Canary (`fear.ts`), não `Direction` do `sim` — a fuga anda em
    diagonal. `requestMove` a zera (um `startAutoWalk` novo limpa `listWalkDir`) e recusa antes de
    guardar caminho quando a criatura está presa ou com medo.
  - **A lista de passos do Canary é UMA, e aqui mora em dois lugares: `Runner.fearWalk` e o
    `walk-to` distante (`Runner.manualWalkTo`).** Os dois nunca coexistem (`#startFleeWalk` e
    `requestMove` limpam um ao pôr o outro), e três regras dependem de tratá-los como a mesma lista:
    o pensamento do medo só foge com `getWalkSize() < 2` (`#onFearThink` soma o comprimento do
    `walk-to`); o passo de um `walk-to` JÁ guardado é `forced` (continua a lista, o que o
    `startAutoWalk` recusou foi só o INÍCIO) e portanto segue andando sob `feared`; e sob `rooted`
    o passo recusado derruba o `walk-to` (`resetMovementState`, `creature.cpp:503`) — sem isso ele
    retomava sozinho ao fim da raiz.
  - **A grade de pensamento do personagem (`Runner.thinkPhaseMs`).** `Game::checkCreatures` roda o
    `onAttacking` e o `executeConditions` de cada criatura a cada 1000 ms numa fase própria; o `sim`
    a sorteia UMA vez por personagem (`#thinkDelayMs`, preguiçosa, persistida no snapshot) e agenda
    quem depende do pensamento — o `FEAR_THINK` e o `ATTACK_THINK` — para o próximo instante da
    grade. Nunca um evento por segundo (invariante 2). O `VISIBILITY_THINK` do #559 ainda sorteia a
    fase dele por evento, e vale a pena unificar quando alguém mexer ali.
  - **`fear.ts` é PURO e transcreve números e comportamento, não código** (ADR 0019): as cinco
    regiões, o vetor de direções, o lado do ponto sintético por direção, as distâncias
    `{15, 9, 3, 1}`, o raio 7 e o custo 10/35. A BUSCA de caminho é original — uma varredura de
    custo mínimo na caixa mais a escolha do destino mais distante do ponto —, NÃO o A* do
    `getPathMatchingCond`: o limite de licença proíbe a tradução linha a linha, e uma versão
    anterior deste arquivo a tinha feito (retirada na revisão do #622). Os testes fixam o QUE sai,
    nunca como o Canary chega lá. As esquisitices da fonte estão PRESERVADAS de propósito (o ponto
    sintético do `SOUTH` cai do lado do `NORTH`; o sorteio grava o valor do enum como índice) e
    fixadas em `fear.test.ts` — "corrigi" uma delas e o teste que a nomeia falha por desenho. O
    desempate entre destinos e caminhos de mesmo custo é uma escolha declarada (`STEP_ORDER`), que
    reproduz o do Canary em campo aberto.
  - **Nunca `Math.random`/`Date.now` na fuga**: o `Rng` da sessão entra em DOIS lugares só — a
    fase de pensamento do personagem (`[0, 1000)` ms, uma vez) e o sorteio do tile do próprio
    lançador.
- **Campo bloqueante é PAREDE, não desvio de dano** (#560). `Fields.blockedAt`/
  `TileOccupancy.blockedAt` bloqueiam para QUALQUER criatura, e valem em `canOccupy`/`move`
  sem checagem extra em `hunt.ts` — ao contrário do desvio de dano do M29-05
  (`canMonsterEnterField`), que só o MONSTRO respeita e só quando o campo declara
  `damageType`. Um campo com `blocksMovement: true` e SEM condição (Magic Wall, Wild Growth)
  ainda passa pelo pipeline de tique normalmente — `#onFieldTick`/`#enterField` só saem cedo
  quando `field.condition === undefined`, o mesmo `undefined` que o estágio mudo de uma cadeia
  também usa. **Uma exceção desde a OW-05 (#826): a parede de PERSONAGEM cede a quem é
  personagem — ver o item do campo com dono, logo abaixo.**
- **O campo tem DONO, e quem o lançou decide em quem ele pega** (OW-05, #826, ADR 0060 d.8 — o
  no-pvp do Canary aplicado ao campo, `combat.cpp:1207-1218`/`2594-2640`,
  `condition.cpp:2015-2020`). `TileFieldState.owner?: { kind: 'character' | 'monster', id }`,
  gravado por `applyField` (o sexto parâmetro, opcional). Quatro armadilhas. (1) **Sem `owner` é
  campo de MAPA e pega todo mundo** — é o que todo snapshot anterior restaura, sem subir
  `SNAPSHOT_FORMAT_VERSION`, e o que o teste que planta campo direto sempre foi; um call site
  novo de `applyField` que esquecer o `owner` cria campo que fere a party inteira, em silêncio.
  (2) **Invocação de personagem é PERSONAGEM, dos dois lados**: o campo lançado por ela grava o
  MESTRE (`#fieldOwnerOf`, `kind: 'character'`), e ela mesma é protegida do campo de personagem
  (`#fieldHarms` confere `typeof masterId === 'string'`, como o `canDoCombat` do Canary recusa
  `target->isSummon() && targetMasterPlayer` num mundo no-pvp). Monstro que não é invocação de
  personagem segue levando o campo de personagem — o que o teste da party confere. (3) **O
  portão roda ANTES de montar a condição**, no tique (`#onFieldTick`) e na entrada (`#enterField`):
  `conditionFromSpec` pode consumir `session.rng`, e quem o campo não fere não gasta sorteio
  (a sequência dos outros alvos é a mesma de antes). (4) **A parede de personagem é a variante
  SEGURA**: segue barrando monstro e invocação, mas `Movable.dissolvesSafeWalls` (só
  `CharacterRuntime` declara) faz `canOccupy`/`move` a admitirem, e `HuntRuleset#step` a remove
  depois do passo aceito (`#dissolveSafeWall` → `#removeField`, que cancela os três eventos do
  campo) — ANTES de `#enterField`, porque `Fields.at` devolve só o campo mais recente e o que
  estava embaixo da parede é o que o passo encontra. Qualquer PERSONAGEM a dissolve, não só o
  lançador (o Canary confere `creature->getPlayer()`, nunca o dono). O BFS do follow passa o
  quarto argumento de `blockedAt` pelo mesmo motivo; um predicado novo de caminho de PERSONAGEM
  que chame `blockedAt` de três argumentos trata a parede dele como intransponível, em desacordo
  com o passo. O dono também atravessa os estágios (`#onFieldStageAdvance` o repassa) e o
  relançamento do mesmo id o troca. **NÃO muda o crédito do dano do campo**: a condição do
  campo segue com `sourceId` = id do campo, e o abate por campo de personagem não credita XP ao
  dono (no Canary o dono vai no `CONDITION_PARAM_OWNER`) — divergência registrada, pendente do
  crédito do Canary (OW-28).
- **`isSightClear`'s atalho "sem camada de sight, sempre livre" escondia um bug de LIMITE, e
  isso só apareceu ao tentar ligar o predicado de campo (#560).** Antes, mapa sem `sight`
  devolvia `true` ANTES de percorrer a linha — nunca chegava a conferir `x/y` contra
  `map.width`/`map.height`. Um teste que mira um monstro DELIBERADAMENTE fora do mapa (para
  testar `out-of-range` sem se importar com LOS) passava por acidente. Dar ao parâmetro
  `blocksProjectileAt` um valor não-`undefined` desliga esse atalho e faz o passeio rodar de
  verdade — e a conferência de limite, agora executada, reprova a mira fora do mapa como
  bloqueada, quebrando três testes que dependiam do atalho sem saber. **Por isso os call sites
  de combate em `hunt.ts` continuam passando só três argumentos para `isSightClear`** (o
  parâmetro existe e tem teste próprio em `line-of-sight.test.ts`, mas não está fiado à
  produção): ligá-lo de verdade é trabalho do M30-06, com mapa e conteúdo reais para testar
  contra, não desta issue.
- **Runa de campo mira o CHÃO, e a mira de chão é uma busca SEPARADA de `#aimFor`** (#591).
  `#groundAimFor` não colhe criatura nenhuma (`#collect`/`#spellHits` ficam de fora) — um campo
  nasce num tile vazio, e a antiga exigência "pelo menos um alvo colhido" de `#aimFor` faria
  toda runa de campo mirada em chão vazio recusar `no-target` por engano. `#needsTarget` precisa
  reconhecer os `kind`s `field`/`destroy-field` como "sempre exige alvo" — sem isso,
  `#resolveManualTarget` descarta `target.position` como "não se aplica" ANTES de a mira de chão
  rodar, e a runa nunca recebe o tile que o jogador apontou.
- **`Fields` indexa por id de CONTEÚDO, e uma runa de jogador cast duas vezes em tiles
  diferentes não pode reusar o `spec.id` cru** (#591) — faria o segundo cast MOVER o campo do
  primeiro (`Fields.apply` substitui pelo id), não abrir um segundo independente, ao contrário
  do Tibia real (várias Fire Field lado a lado). `fieldInstanceId(specId, at)` deriva o id pelo
  TILE (`"<specId>@x,y,z"`) — determinístico, sem contador para persistir no snapshot —, e é só
  o `sim` (`HuntRuleset#useSupply`) quem reescreve o id antes de chamar `applyField`; `useSupply`
  (`casting.ts`) devolve o `FieldSpec` do CONTEÚDO, cru. Relançar a MESMA runa no MESMO tile
  ainda reinicia — o mesmo tile produz o mesmo id.
- **`applyField` recebeu um `direction` opcional (default `'south'`) só para a forma `wall`
  (#591) — o único chamador de antes desta issue (a ability de monstro) sempre usa `circle`, que
  ignora direção, e por isso continua preservado bit a bit sem passar o parâmetro novo.** Quem
  planta uma parede de jogador precisa calcular `directionOf(character.position, at)` e passar
  explicitamente — esquecer faz a parede sempre se orientar como se o lançador estivesse ao SUL
  do alvo, silenciosamente errado em qualquer outra direção.
- **A invocação do PERSONAGEM (#598, M38-01, ADR 0057) estende `masterId` a `characterId` — a
  DISTINÇÃO DE TIPO (número é monstro, #546; string é personagem) decide o comportamento, sem
  campo `masterKind` à parte.** `HuntRuleset#chooseMonsterTarget` bifurca por isso: invocação de
  personagem NUNCA roda `chooseTarget` própria — herda o alvo do mestre (`attackTargetOf`) a
  cada passo/ataque/ability; invocação de monstro continua igual ao #546. **O dano dela credita
  o MESTRE, nunca o `subject` dela** (`#applyMonsterHitOnMonster`, ex-`...OnSummon`, achado da implementação: sem o
  redirecionamento, `xpByDamage` não reconhece um `m:<id>` como participante e o abate renderia
  ZERO XP para quem invocou). **`#hostileMonsters()` é o outro lado da mesma moeda — proteção
  contra FOGO AMIGO.** Estender a lista de presas de um monstro hostil (`#playerSummonPrey`) para
  incluir invocações de personagem tem uma consequência que NÃO é óbvia: o auto-target do
  PRÓPRIO jogador (#444) usa `this.#monsters` sem saber "isto é minha invocação" — sem o filtro,
  o personagem mataria a própria invocação (ou a de um companheiro de party) no primeiro golpe
  engatilhado. Foi reproduzido em teste real durante esta issue antes de existir o filtro; todo
  call site de `selectTarget`/`countTargets`/`countAreaTargets` que serve um PERSONAGEM (nunca os
  que servem um MONSTRO escolhendo alvo) usa `#hostileMonsters()`, não `this.#monsters` cru — e
  `chooseTarget`/`#resolveManualTarget` recusam `monster.masterId === character.id` mesmo com o
  subject certo, como cinto e suspensório contra o cliente pedindo por fora do auto-target. Ver
  "Invocação do PERSONAGEM" em `docs/product/combat.md` para o resto do contrato (teto de 2,
  mana do MONSTRO via `manaCostOverride`, `combat-v4`).
- **Facções de monstro (#619, M44-01) são o `Faction_t` do Canary, e a regra é ANTES de tudo "sem
  facção na hunt, nada muda".** `monster/faction.ts` (puro) tem os valores (`FACTION_PLAYER` = 1, o
  peso `× 100` na distância e `× 100 000` na vida/dano) e a tabela; o `HuntRuleset` guarda
  `#factions`/`#hasFactions` e TODO caminho novo sai por `#hasFactions` falso, devolvendo a MESMA
  lista de antes — sem alocar e sem sortear. Cinco armadilhas. (1) **A tabela é do ALCANÇÁVEL, não do
  conteúdo**: `options.monsters` traz o catálogo inteiro em toda hunt, então "existe algum monstro
  com facção?" seria sempre sim; `reachableMonsterIds` segue os pontos de spawn e, transitivamente,
  as invocações. (2) **Oponente não é alvo** (`isOpponent` × `isTarget`): `#opponentOthersOf` (mais
  `session.participants`) é a `targetList` — o que segura a volta ao spawn e impede o ocioso —, e
  `#targetPreyOf` é o que `chooseTarget` recebe. A Lion tem o herói na lista e não o mira. Trocar
  uma pela outra some com a Lion ou faz ela caçar o herói. (3) **`Prey.faction` ausente vale PLAYER**
  (personagem e invocação de personagem não dizem nada) — o desempate `d + faction × 100` é
  constante para uma lista só deles, e é isso que preserva toda hunt sem facção; o jogador (1) ganha
  de qualquer monstro inimigo (2+) na aquisição, por mais longe que esteja. Em "mais dano" o
  Canary inverte (a facção MAIOR ganha) e `rankTarget` reproduz. (4) **`#mayAttack` vale para o alvo
  principal e para cada criatura da área**, e a área de um monstro de facção soma os inimigos com
  `#withFactionEnemies` — a lista de área de um monstro comum continua só personagens e
  invocações de personagem. A invocação de monstro herda facção e inimigas do mestre
  (`#factionProfileOf` recursivo); a de PERSONAGEM não usa a tabela (`null`). (5) **A morte por
  monstro é decidida pelo `credit`, não pelo golpe final** (`#onMonsterDied`): `lastHitBy` que é
  um `m:<id>` sem participante entre os que bateram = sem XP, sem abate (a invocação de monstro
  também), cadáver sem dono e sem loot; com dano de participante a XP é `floor(dano ÷ total × XP)`
  (`#experiencePool`, o dano de monstro entra no total) e, havendo dano de monstro no mapa, o dono do
  cadáver é o maior causador ENTRE OS QUE AINDA EXISTEM (`#corpseOwnerOf`), participante ou monstro
  vivo — mesmo quando o herói deu o último golpe —, o dano de campo não entra. **O dano de quem saiu
  NUNCA se apaga do mapa de outro monstro** (o Canary só zera o `damageMap` inteiro, em
  `onIdleStatus`): `#forgetInMonsters` o funde no balde `DEPARTED_ACTOR` (`m:departed`,
  `Contribution.fold`), que conta no total, mantém o prefixo `m:` e nunca é dono nem `mostDamageBy`;
  trocar a fusão por `forget` paga ao jogador a XP que o Deepling morto já tirou. O tique de condição
  de um dono monstro que já saiu não é atribuído a ninguém. **A invocação de monstro de facção
  persegue o alvo do MESTRE** (`#followMasterTarget`, `updateSummonTarget`), nunca `chooseTarget`
  — a lista de alvos dela inclui o jogador por causa do offset de facção, e é isso que ela NÃO usa.
  **O laço de alvos de `#executeMonsterAbility` pula o monstro que saiu dos índices** no meio dele
  (a morte do mestre cascateia em `#removeSummon`, que não zera `alive`) — o mesmo guarda de
  `#applyHits`/`#carnage`; sem ele a invocação leva um golpe fantasma e morre duas vezes. **A "atividade sem jogador" do `updateIdleStatus` do `47dfd51` só
  alcança a INVOCAÇÃO de um monstro de facção** (`master->totalPlayersOnScreen == 0`, sob um `else if
  (master)`): `#isFactionSummonIdle` lê a posição dos participantes — estado da sessão, nunca de quem
  olha — e o monstro de facção comum com inimigo à vista brigando sem jogador NÃO fica ocioso. Testes
  de facção precisam posicionar o herói ANTES do primeiro `advanceBy`: o monstro retém o alvo que
  escolheu, e corrigir a posição depois testa a escolha de um herói na rota (`arena` em
  `rulesets/factions.test.ts`). Ver "Facções de monstro" em `docs/product/combat.md`.
- **O familiar de vocação (#599, M38-02, ADR 0057 d.3 e a emenda de 2026-09-29) é uma invocação de
  PERSONAGEM com três coisas a mais, e cada uma tem uma armadilha.** (1) **Os dois carimbos
  (`CharacterRuntime.familiar`) são de relógio de PAREDE, e o "agora" é `session.createdAtMs +
  session.nowMs`** (`HuntRuleset#wallNowMs`, fracionário: serve para COMPARAR; o que se GRAVA passa
  por `#wallStampMs`, que arredonda para cima — os consumidores validam inteiro seguro e trocam o
  carimbo torto pelo vazio em silêncio — e o piso da morte; o servidor soma o intervalo descartado
  da retomada ao `createdAtMs`) — nunca o `Cooldowns` do personagem, que guarda instante
  LÓGICO da sessão que o gravou (o relógio de cada sessão nasce em zero, e o objeto do personagem
  atravessa as transições): um cooldown de 30 min ali seria lido na hunt seguinte como "daqui a 30
  min de ZERO", ou, se a hunt anterior durou uma hora, como "daqui a uma hora e meia". O
  `summonUntilMs` DESCE quando o familiar morre (`#onMonsterDied` grava o agora), por isso o ledger
  o escreve por última-escrita-vence e nunca por máximo. (2) **A recusa por cooldown de parede
  devolve `retryInMs: 0`, de propósito**: o bot reagenda o grupo pelo MAIOR prazo entre as recusas, e
  30 min de sono trancariam a haste, que vive no grupo `support`. Quem precisa do prazo real
  (`slotStates`, `useSlot`) o lê de `#cooldownWaitOf`, que soma `#familiarWaitOf`. (3) **A ordem da
  recusa é a do Canary — level/cooldown/mana e SÓ ENTÃO `precondition` (teto de zero invocações,
  sala), antes de qualquer débito** — por isso `castSpell` ganhou o parâmetro `precondition`; um
  `castSpell` que debitasse a mana e deixasse a invocação sem tile perderia mana por nada. O
  tile é escolhido pela `precondition` (10 sorteios do `Rng` da sessão, sempre) e usado depois de
  `ok`: nada roda evento entre os dois. **A duração é o evento `familiar-expire`** com o subject
  `m:<id>` do familiar — a morte (`resolveDeath`) e `#removeSummon` já o cancelam por esse subject.
  **Três lacunas do primitivo do #598 que o familiar expôs**: a ability em ÁREA de uma invocação de
  personagem usa `#hostileMonsters()` como presas (senão acertaria a party); o alvo herdado é o
  SELECIONADO do mestre e não o que a arma alcança; e o jogador atravessa o familiar por TROCA de
  tiles em `#step` (`#moverBlocked` e `#occupiedForPlayer` — o `world.occupied` das buscas de caminho do follow e do `walk-to` — deixam o caminho passar por ele) — sem isso um familiar parado
  num corredor tranca a party inteira. **O familiar RECOLOCADO** (o teleporte ao mestre e a troca cujo
  tile de origem fechou — a porta comum fecha no `vacate`) sai como `creature-vanished` +
  `creature-appeared`, NUNCA como `creature-moved` de duração zero: o hospedeiro descarta duração ≤ 0
  (`#placeFamiliarNear`). **E `onEnter` remonta a ocupação COM os monstros** — o familiar recriado
  para o membro anterior de uma party já é um monstro vivo no mundo, e remontar só com os
  participantes liberava o tile dele. `#familiarIds` (vazio na hunt de sempre) existe para o custo:
  o teleporte ao mestre e a travessia consultam-no a cada passo. **A invocação de personagem SEM alvo
  segue o mestre** (`#onMonsterStep` → `summonFollowStep`): a busca é `cheapestPath` (Dijkstra,
  cardinal 10, diagonal 35 — o A* do Canary), e não o BFS de `boundedPath` nem o guloso — o BFS de
  custo igual anda de viés na diagonal, e o passo diagonal dura o triplo; o guloso oscila na boca de
  uma concavidade. Só enxerga quem está a ≤ `aggroRadius` no mesmo andar, e o objetivo é um tile a
  EXATAMENTE 2 do mestre com linha de visão livre — a 1 tile é só o "melhor até agora" que o Canary
  guarda enquanto procura (`cheapestPath` aceita um `fallback`): a invocação encostada se afasta até a
  2 (`getPathSearchParams`, `FrozenPathingConditionCall`). `summonFollowStep` devolve `step`/`stay`/
  `wander`: sem mestre à vista ou sem caminho é `wander` (o `getNextStep` cai no `doRandomStep`, e
  `decideUnengagedMove` só deixa a invocação de PERSONAGEM passear), mestre invisível que a comum não
  enxerga é `stay` (`canFollowMaster`; o familiar segue sempre). Um teste que quer o familiar PARADO ou atrasado precisa de um
  jeito de o herói deixá-lo para trás (a velocidade do familiar é a do mestre no lançamento: acelere o
  herói DEPOIS de lançar), porque um familiar que enxerga o mestre o acompanha.
- **Convince Creature e Animate Dead (#600, M38-03, ADR 0057 d.5–d.6) são supply (`effect.kind`
  `convince` / `animate-dead`), e o que o script do Canary recusa entra em `useSupply` como a
  PRECONDIÇÃO `summonRune?.check`** (`HuntRuleset#summonRunePrecondition`) — depois de requisitos, mira e
  alcance, ANTES do gold: a carga só sai quando o script devolve `true`. Cinco armadilhas. (1)
  **`MonsterRuntime.masterId` é mutável só pelo Convince** (`#convertToSummon`, o ÚNICO escritor): o
  monstro do Spawner vira invocação no meio da vida, e o que uma invocação nunca tem precisa ser
  desarmado ali (lista de invocação própria, alvo antigo, "voltando ao spawn"). (2) **O convencido
  MANTÉM o lugar no Spawner**: o Canary só o libera quando o monstro é removido, então o respawn NÃO
  começa ao convencer — `#releaseSpawnSlot` (usado por `#onMonsterDied` E por `#removeSummon`) agenda o
  respawn quando ele morre ou some com o mestre; esquecer o segundo deixa o ponto vazio para sempre.
  (3) **`#inSightOf` recusa invocação de personagem** — é o que faz quem tinha o monstro na mira (o
  mestre, o candidato do bot, um companheiro de party) largá-lo na leitura seguinte; sem isso o
  convencido herdaria o PRÓPRIO subject como alvo do mestre. (4) **O cadáver animável é uma JANELA da
  cadeia `decayTo`, não um booleano** (`monster.corpseAnimatable`): o estágio recém-abatido é `unmove`.
  O tempo desde a morte sai de `session.dueAtOf('corpse', id)` menos `corpseTtlMs` — nunca de um
  carimbo novo —, e o "topo da pilha" é o cadáver de MAIOR id do tile. (5) **Invocação nunca deixa
  cadáver** (`#onMonsterDied` zera `corpseTtlMs` para `isSummon`, sem gastar `#nextGroundItemId`):
  senão o Skeleton animado seria animável de novo. Nos testes (`summon-runes.test.ts`): a rota PRECISA
  fechar o laço (`buildContent` recusa), `radius` do ponto de spawn é `> 0` (o centro vem primeiro na
  busca), a capacidade do herói é recomputada da progressão ao entrar (o loot que "não cabe" pede um
  item mais pesado que ela), e o respawn de quem não é `blockable` leva 4,2 s a mais que o
  `respawnDelayMs` (o aviso de `SpawnMonster::scheduleSpawn`). **Duas regras do mundo no-pvp que só
  aparecem com invocação de jogador de verdade** (revisão do #600): (a) **o personagem ATRAVESSA a
  invocação de jogador** — o passo para o tile dela vira TROCA de lugar (`swapPlaces` em
  `movement.ts`, chamada pelo `HuntRuleset#step`; a ocupação continua exclusiva), e sem isso a
  invocação em cima do próximo tile da rota trava o herói pelo resto da hunt; a troca NÃO passa por
  `vacate`/`occupy` (porta não fecha, placa não solta). **O familiar (#599) NÃO passa por esse
  `swapPlaces`**: ele é atravessado ANTES do `move`, pelo `vacate` + recolocação descritos no item
  dele, e o ramo do #600 só enxerga a invocação comum — um passo que o familiar já liberou nunca
  chega a ser recusado por ocupação; (b) **toda colheita de ÁREA do personagem
  pula `typeof masterId === 'string'`** — as duas formas de `#aimFor` e o `#cleave` varrem
  `#monsters` direto, e quem esquecer o corte mata a invocação no primeiro Great Fireball.
- **Os Charms em combate (#603, M39-03, ADR 0053 d.5) vivem em `combat/charms.ts` (puro) e nos
  métodos `#charm*`/`#roll*` do `HuntRuleset`, e SÓ rolam no `combat-v4` (`hasCharmStage`).** Três
  armadilhas custam caro. (1) **O índice do tier é `tier − 1`**: o Canary guarda um `0` na frente do
  vetor de chance, então o tier 1 lê o PRIMEIRO valor do Lua (`charmChance`); `points` continua
  indexado pelo tier ANTES de desbloquear. (2) **A rolagem certa em cada ponto é o mecanismo**:
  defensivos usam `normal_random(1, 10000)/100` (~1,4 % a 4,3 % reais, não os 5–12 % nominais),
  Cleanse a normal em `0..10000`, Void Inversion/Fatal Hold a normal em `0..100`, ofensivos a
  uniforme `1..100` — trocar uma por outra "que dá o mesmo número" muda a probabilidade. (3) **O
  crítico é decidido por AÇÃO, antes do `blockHit`** (`ActionCritical`): o crítico base rola uma vez
  para todos os alvos da magia, e o Low Blow só rola se o base falhou, com `base + charm` e UM
  sorteio por monstro-alvo do charm. `castSpell`/`useSupply` ganharam `SpellTarget.charm` por isso;
  um caminho novo em que o jogador acerta um monstro precisa passar por `#hitModifiers` (golpe único)
  ou por `SpellTarget.charm` (mira) E chamar `#applyCharmsAfterHit` depois de aplicar o dano — o
  mesmo ponto único que `#afterMonsterHit` já é para reflexo e cura por elemento. O dano do charm é
  EXTENSÃO (`source: 'charm'`, `extension: true`, neutro em Overpower/Overflux/Carnage/Parry): não
  crítica, não faz leech, não reflete, e nunca dispara outro charm ofensivo. O Dodge do PRD NÃO
  existe no `combat-v4` — `resolveBlockHitProfile` nem sorteia. `cleanseImmunity` é estado do
  personagem e viaja no snapshot; o Fatal Hold é a condição `'fatal-hold'` do monstro (permanente,
  `Number.MAX_SAFE_INTEGER`, quando ele foge e não tem `targetChange` — o Canary só drena o prazo
  em quem troca de alvo). O Cripple e o Numb chamam `#applyConditionTo(..., true)` (`ignoreImmunity`):
  o Canary os aplica com `target->addCondition`, sem o `Monster::isImmune` que só o
  `CombatConditionFunc` confere — uma paralisia nova que passe pelo caminho de combate normal NÃO
  usa esse parâmetro. O Carnage roda também para o monstro invocado (`Monster::death` não confere
  `isSummon()`). Os defeitos do `47dfd51` que ficaram de fora estão listados em
  `docs/product/combat-conformance.md`.
- **As utilitárias (#623, M44-05: Light, Levitate, Magic Rope, Find, Food) têm UM portão de
  recusa e UM ponto de aplicação, e quebrar qualquer dos dois desincroniza a barra.**
  (a) `HuntRuleset#utilityRefusalOf` é PURA e alimenta DOIS lugares — o `preflight` de `castSpell`
  e o espelho `#naturalStateOf` (`slotStates`): um motivo novo entra nos dois ou o slot promete o
  que o cast recusa (DT-08). O `preflight` vem DEPOIS de level, cooldown, mana e alma e ANTES de
  pagar — a ordem do Canary, onde só o `onCastSpell` recusa o destino (sem custo, sem cooldown).
  **A exceção é `person-not-found` (Find Person):** não é recusa de script, é a de
  `InstantSpell::playerCastInstant` (`getPlayerByNameWildcard`), que roda `applyCooldownConditions`
  antes de cancelar — o `castSpell` inicia os livros de cooldown (magia e grupo) nesse caso, sem
  mana nem alma; as recusas de Levitate, Magic Rope e Find Fiend NÃO iniciam nada. O destino que o
  `preflight` aprova é o que o salto aplica (`#jumpToApproved` falha alto se o `relocate` recusar),
  então `ropeDestination` também confere a ocupação — tile é exclusivo, como no Levitate. `rooted`
  (#622) recusa o Levitate com `not-possible` (o `creature:move` cai em `internalMoveCreature`) e
  NÃO o Magic Rope (`teleportTo` não confere a condição) — por isso `#utilityRefusalOf` recebe o
  `nowMs`. Toda utilitária é magia nova e precisa de `learnPrice` (`pnpm catalog:spell-prices`; as que
  o leitor não liga por NOME, como `levitate-up`/`levitate-down`, têm o preço curado à mão), senão
  ninguém a compra (`not-for-sale`).
  (b) O salto (`#relocateCharacter`, `movement.ts#relocate`) é o OUTRO escritor de posição e NÃO vira
  o personagem (o Canary não passa direção); todo salto novo passa por `#lockAfterJump` (o stairhop
  de `teleport || oldPos.z != newPos.z`, que `#step` também usa) e emite `creature-moved`. Ele
  CANCELA a caminhada manual (`manualWalkTo` e `manualWalkHoldUntilMs`, o `stopEventWalk()` do
  Canary): `#playerStep` dá prioridade máxima ao caminho manual, e o `path[0]` do andar antigo
  seria recusado para sempre — e o `use-slot` chega entre eventos, por isso `#castSpell` remonta a
  ocupação se `#occupancyStale` (a mesma guarda de `requestMove`).
  (c) `levitateDestination` julga a sonda pela grade ESTÁTICA (`isBlocked`), nunca por `blockedAt`:
  uma porta fechada tem chão por baixo, e o overlay a tomaria por vazio. O mapa não separa "sem
  chão" de "parede" — a aproximação está marcada `[APROXIMAÇÃO]` no arquivo e em
  `docs/product/utility-spells.md`. (d) No Find Person o alvo viaja como `recipient`, e
  `recipient === character` é "ninguém nomeado" (`person-not-found`) — o mesmo canal da cura de
  amigo, sem campo novo; a mira que não acha ninguém NÃO é recusada em `#resolveManualTarget`
  (viria antes de level/mana e sem o cooldown), segue até o `castSpell`. No catálogo a mira é o
  campo `aim: 'character'`, e não `targets: 'friend'` (que abriria o seletor de alvo do editor do
  bot, e `validateBotConfigV2` recusa salvar esse alvo num efeito que não é cura/mana). (e) A ordem de consumo do `Rng` da Food é contrato, como a do loot: bônus
  `[0,1]`, índice do extra (se houve), índice do garantido (`rollFoods`). (f) A luz é condição de
  APRESENTAÇÃO (`ConditionState.light`): nenhuma regra a lê, e o `Condition::updateCondition` a
  governa — o `castSpell` NÃO devolve condição para uma luz de prazo MAIS CURTO que a vigente, e a
  mana é gasta do mesmo jeito.
- **O cast confere o APRENDIZADO (#624, ADR 0058): `castSpell` recusa `spell-not-learned` (sem prazo)
  logo depois de level e vocação, e SÓ a magia — a runa (`useSupply`) exige level e magic level.**
  Quatro armadilhas. (1) **Todo teste que lança magia precisa de um herói que a saiba** —
  `new CharacterRuntime({ ..., learnedSpells: learnedSpellsStateOf(ids) })` ou `hero.learnedSpells
  .grant(id)`; um `CharacterRuntime` sem o registro não lança nada, como um personagem novo. Foi o
  que quebrou 160 testes na issue, e por isso o `harness.ts` dos traces concede as magias que a cena
  lança e o `hunt.test.ts` tem `knowsEverythingIn(hero, content)`. (2) **`getState()` só devolve
  `learnedSpells` quando `LearnedSpells#recorded`** (veio no estado, ou houve compra/concessão): um
  snapshot antigo não ganha a chave sozinho, e o extrato do servidor a OMITE — escrever o vazio
  apagaria a concessão da migração (ADR 0014). (3) **`slotStates` espelha a recusa** (`#naturalStateOf`
  devolve `not-learned` na MESMA posição de `castSpell`, DT-08), e `refusalOf` traduz
  `spell-not-learned → not-learned`: um `CastRefusal` novo precisa dos dois lados, e o `switch`
  exaustivo do `refusalOf` é quem avisa. (4) **`CharacterRuntime.learnSpell` é a compra inteira**
  (vocação, level, saldo, `goldDelta -= price`, marca aprendida) e é idempotente porque recusa
  `already-learned` ANTES do débito; o `HuntRuleset#rearmBot` acorda o bot depois, porque a recusa
  sem prazo o deixou engatilhado e aprender não muda o mundo. `LearnedSpells#grant` (sem preço) é o
  `learnInstantSpell` puro do Canary — para o dia em que o Wheel of Destiny conceder a Great Death
  Beam.
- **O Treino é um ruleset de eventos, e o offline training é PURO (#631, ADR 0059).** `TrainingRuleset`
  (`rulesets/training.ts`): um evento `TRAIN_STRIKE` por golpe, o primeiro no instante da entrada e
  os seguintes a cada `combat.player.attackIntervalMs`; cada golpe credita `7 × rate` tries (`600 ×
  rate` de mana gasta para wand/rod) ANTES de descontar a carga (a última também rende), a arma
  esgotada é destruída (`removedInstances`) e as cargas restantes vivem no overlay da instância
  (`ItemInstanceOverlay.charges`, "ausente é cheia"). Nada aqui sorteia, e o resultado é idêntico a
  10 Hz, a 1 Hz e depois de um snapshot. `settleOfflineTraining` (`offline-training.ts`) é a função
  PURA do gasto do banco — `min(fora, banco, teto da conta)`, carência de 10 min, melee `/ 2`,
  distância `/ 4`, magic level pela mana, escudo `/ 4` junto —: recebe o tempo fora COMO DADO
  (`awayMs`), porque o `sim` não lê relógio; quem sabe a hora é a `api`, no ticket. O banco cresce
  1:1 com `session.inSessionMsOf(id)` no fim da participação (`onEnd`/`onLeave` de hunt e de treino),
  nunca por tick — e NÃO com `aggregatesOf(id).durationMs`: `advanceBy` soma a janela INTEIRA ao
  `durationMs` antes de despachar os eventos, então uma sessão que acaba por evento no meio da janela
  (arma esgotada, morte) contaria o resto dela e o banco dependeria de como o host fatiou o tempo;
  `inSessionMsOf` lê o relógio lógico (`nowMs` menos o instante de entrada), exato dentro do evento.
  O escudo do offline training segue o `sendUpdate` do Canary — `Skill.percent` é um `double` de 2
  casas comparado com o percentual novo TRUNCADO (`uint8_t`) —, não "o inteiro mudou" (`floor` dos dois
  lados). O cooldown entre dois Treinos (`training-exhaustion`, 10 s) é um carimbo de parede no
  registro (`exerciseExhaustedUntilMs`), comparado com o `nowMs` que o servidor passa. `buyItem` (`purchase.ts`) é a compra mínima do `buy-item`: confere
  TUDO antes de mexer em `goldDelta` ou na mochila. `holdStamina` (`stamina.ts`) avança o marco sem
  recuperar — o que o Treino faz ao sair (ADR 0060 d.14c).
