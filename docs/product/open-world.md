# Mundo aberto

**Status:** parcial — existem o **mundo como conteúdo** (OW-08, #829: `data/worlds/main.json` com
tipo, mapa, cidade, templo e teto, validado no boot), a **regra de zona e de saída** do `sim`
(OW-10, #831: `zoneAt`, `hasZoneFlag` e `canLogout`) e a **sessão do mundo** (OW-13, #834:
`createWorldSession`, a topologia de mundo e a entrada na posição salva ou no templo). Nada hospeda
a sessão ainda — o hospedeiro a constrói na OW-18, atrás de `OPEN_WORLD` — e a presença, a
durabilidade e a apresentação ainda não saíram do papel.
**PRD:** — (o PRD descreve a Cidade como praça social; o mundo aberto nasceu depois dele)
**Épico:** E19 · Mundo aberto (M47–M51)
**Referência técnica:** [ADR 0060](../adr/0060-tibia-open-world-without-pvp.md) (mundo aberto do
Tibia sem PvP), [`docs/open-world-plan.md`](../open-world-plan.md) (marcos e ordem das issues)

## Comportamento

O Draconya é o mundo aberto do Tibia, tipo `no-pvp`, e a hunt idle é o adicional instanciado (ADR
0060 d.1). Um **mundo** é, no Canary, o `Game` único: aqui, uma sessão compartilhada num processo
`game`, à qual o personagem pertence (`characters.world_id`, OW-15). Este documento cresce com
cada peça do plano que sai do papel; hoje existem três: o que o mundo **é** como dado, a regra de
zona do `sim` — onde o personagem pode sair — e a sessão do mundo, que é o motor da hunt com a
topologia de mundo.

## O mundo como conteúdo (OW-08, #829)

`packages/content/data/worlds/<id>.json`, um arquivo por mundo, na forma:

```json
{
  "id": "main",
  "name": "Draconya",
  "worldType": "no-pvp",
  "map": "thais",
  "towns": [{ "id": "thais", "name": "Thais", "temple": { "x": 32369, "y": 32241, "z": 7 } }],
  "capacity": 200
}
```

- **`worldType`** é o `worldType` do Canary (`canary/config.lua.dist:28-33`), no conteúdo e não no
  código. O vocabulário é **fechado** (`WORLD_TYPES`, em `schemas.ts`) e hoje é só `no-pvp`: o
  Canary aceita também `retro-pvp`, `pvp`, `expert-pvp` e `pvp-enforced`, mas o `sim` não tem dano
  entre jogadores, e um arquivo que prometesse PvP derruba o boot em vez de subir um mundo que
  mente. Um tipo novo entra por ADR.
- **`map`** é o id de um mapa **importado do OTBM** (`pnpm map:import`): é o `source.region` dele
  que dá a origem para traduzir coordenada absoluta em tile. Mapa autorado à mão não serve a um
  mundo, e o boot recusa.
- **`towns`** são cidades — id, nome e templo (`canary/src/map/town.hpp`, `Town`). O id é o slug,
  como todo id de conteúdo; o Canary usa um número. Ao menos uma por mundo: o templo é para onde o
  personagem volta ao morrer e onde nasce sem posição salva (ADR 0060 d.4 e d.9).
- **`temple`** é coordenada **absoluta** do Tibia, a do `otservbr.otbm` — a mesma que
  `characters.world_x/y/z` guardará (ADR 0060 d.3.b), para que crescer o mundo não custe migração.
  Os mapas do conteúdo são recortes, com coordenada local; `absoluteToLocal` e `localToAbsolute`
  (`packages/content/src/map.ts`) traduzem pela origem de `source.region` — `x` e `y` perdem ou
  ganham a origem e o andar `z` não muda, porque os andares do recorte são chaveados pelo `z`
  absoluto.
- **`capacity`** é o teto de gente, e vale só na entrada, vindo do repouso: quem volta de uma
  instância sempre entra (ADR 0060 d.2.b). Começa em 200, o `CITY_SHARD_CAPACITY` de hoje, e o
  `bench:world` o fixa. Esta issue só **guarda** o número; quem o lê é a admissão (OW-18/OW-20).
- Sem arte (invariante 6): o schema é `strictObject`, e `appearanceId` ou qualquer chave que
  ninguém lê derruba o boot.

### O que o boot confere

`buildContent` confere o que o schema, que só vê um arquivo, não vê:

- o `map` existe e tem `source.region`;
- cada templo cai **dentro** do recorte, nos três eixos (bordas de dentro valem);
- o tile local do templo **não é parede** nem andar sem chão — a mesma regra do `entryPoint` da
  Cidade (`isBlocked`);
- o id de cidade é único dentro do mundo, e o de mundo é único no conteúdo.

Mapa que não monta reporta só a causa dele, não também "mundo sem mapa".

O mundo entra em `computeVersion` como todo conteúdo: mudar o teto muda a versão, e a sessão a
congela na criação (invariante 7). `Content.worlds` é um mapa por id, **vazio** no conteúdo de teste
que não fala de mundo aberto — o conteúdo real tem o `main`, e `load.test.ts` prende.

### O primeiro mundo

`main`: tipo `no-pvp`, mapa `thais`, cidade `thais` com o templo em `(32369, 32241, 7)` e teto 200.
O templo é o `entryPoint` que a Cidade já usa — `(94, 88, 7)` somado à origem `(32275, 32153)` do
recorte —, e um teste prende a igualdade. O mundo e o shard da Cidade rodam sobre o mesmo mapa
(ADR 0060 d.3.a): o shard vira o primeiro mundo atrás de `OPEN_WORLD`.

Os spawns do Canary entram à parte (OW-25), e a topologia (OW-13) e as colunas de `characters`
(OW-15) leem este arquivo.

## Zona por tile e `canLogout` (OW-10, #831)

`packages/sim/src/zones.ts` lê a camada `zones` do mapa (OW-09, ver [a Cidade](city.md)) e a
transforma na regra do Tibia. São funções **puras e só de leitura**: nada do `sim` as chama hoje, a
Cidade segue protect zone por construção (ADR 0004) e as hunts não consultam zona. Quem as usa vem
depois — o `logout` e o x-log (OW-14), a entrada do mundo numa hunt idle (OW-20) e o portão de
combate no-pvp (OW-27).

- **`zoneAt(map, point)`** devolve o tipo da zona do tile — `'protection'`, `'nopvp'`, `'pvp'`,
  `'nologout'` ou `'normal'` — com a precedência de `Tile::getZoneType`: PZ, depois no-pvp, depois
  arena, depois no-logout (`canary/src/items/tile.hpp:188-199`). `'pvp'` é o tile de arena como o
  Canary o chama; tratá-lo como no-pvp (ADR 0060 d.8) é do portão de combate, e `zoneAt` só diz o
  que o mapa diz. O vocabulário é o do `sim`, sem hífen: o `ZoneKind` do protocolo (`'no-pvp'`,
  `'no-logout'`, OW-11) é o do fio, e quem emite `player-stats.zone` traduz de um para o outro.
- **`hasZoneFlag(map, point, flag)`** lê UMA marca (`protection`, `noPvp`, `pvpZone` ou
  `noLogout`), sem a precedência: os bits somam, e o no-logout vale por cima de qualquer zona.
- **`canLogout(character, map, nowMs)`** devolve `{ ok: true }` ou `{ ok: false, reason }`, com os
  motivos do `logout-refused` do protocolo (OW-11) — um teste prende a igualdade dos dois
  vocabulários. É `Player::canLogout` (`canary/src/creatures/players/player.cpp:6960-6979`), na
  ordem do Canary:

  | Tile em que o personagem pisa | Resultado |
  |---|---|
  | no-logout (inclusive PZ + no-logout) | recusa, `'no-logout-tile'` — em luta ou não |
  | PZ | `ok` — em luta ou não |
  | qualquer outro (normal, no-pvp, arena) | `ok` fora de luta; recusa, `'in-fight'`, em luta |

- **A recusa por tile vence a por luta**, e a PZ isenta da luta mas nunca do tile. Por isso
  `canLogout` lê os bits e não o tipo: num tile `P` (PZ + no-logout) o tipo é `'protection'`, e
  decidir a saída por ele abriria um logout que o Canary fecha. A Thais tem 14 desses tiles (z5 a
  z7) e dois de no-logout sozinho, e `tile-zones-real.test.ts` prende os dois casos sobre o dado
  real.
- **"Em luta" é `isInFight`** (`packages/sim/src/combat/in-fight.ts`, #625), a janela de 60 s do
  `pzLocked` do Canary (`canary/config.lua.dist:36`) desde o último golpe dado ou recebido, no
  relógio lógico da sessão. O pz-lock do Canary (`isPzLocked`) vem de agredir jogador, e o mundo é
  `no-pvp`: monstro só dá `INFIGHT` (`player.cpp:4487-4503`), então sempre se pode fugir para a PZ.
  A aproximação de `isInFight` — o carimbo só nasce onde um golpe é aplicado — vale aqui como vale
  para a saída da hunt, e está documentada lá.
- **A coordenada é a do mapa** (local ao recorte, a de `isBlocked` e de `CharacterRuntime.position`),
  não a absoluta que `characters.world_x/y/z` persiste: quem tem a absoluta traduz com
  `absoluteToLocal`.
- **Sem dado, sem restrição.** Mapa sem a camada `zones` no andar — todo recorte de hunt de hoje —,
  andar que o mapa não tem e ponto fora da grade são tile **normal**; só a luta decide a saída. O
  Canary recusa o logout de quem não está num tile (`player.cpp:6967-6970`); aqui isso não existe,
  porque o personagem sempre pisa num tile da sessão, e recusar por posição fora da grade prenderia
  quem caiu numa posição inválida sem saída.
- **Pura de verdade**: recebe `nowMs` como parâmetro, não lê relógio de parede, não escreve no
  personagem (invariante 9) nem sorteia. O mesmo estado dá o mesmo veredicto a 1 Hz e a 10 Hz.
  Quem age sobre o veredicto — encerrar a sessão, mandar `logout-refused` (OW-11), reagendar o
  x-log para quando a janela de luta vence — é o ruleset do mundo.

## A sessão do mundo (OW-13, #834)

`createWorldSession({ id, map, world, content, seed, createdAtMs })`
(`packages/sim/src/rulesets/world.ts`) monta a sessão de um mundo: **o `HuntRuleset` — o motor do
Tibia que a hunt já usa, com combate, IA, campos, movimento por tile e regeneração — com a
topologia de mundo** (`worldTopology`, em `topology.ts`). Não é um ruleset novo: o ADR 0060
descartou reescrever as 11.794 linhas do `HuntRuleset` antes de haver algo jogável. A classe
`WorldRuleset` é um `HuntRuleset` que só acrescenta a **identidade** que o hospedeiro lê:

| | Instância (a hunt) | Mundo (`WorldRuleset`) |
|---|---|---|
| `type` | `'hunt'` | `'world'` (novo valor de `SessionType`) |
| `shared` ("sair é `leave`") | ausente | `true` |
| `progress` (credita?) | ausente: credita no `end` | `'checkpointed'`: credita em extratos parciais (`Session.checkpoint`, OW-03) |
| `hz` | 10 anexada, 1 desanexada | **10 sempre**: o mundo é conteúdo em que o personagem é vulnerável (ADR 0003) |
| acaba quando | esvazia, ou o solo morre ou conclui a saída | **nunca**: quem sai, morre ou conclui a saída deixa só a participação dele |

A identidade casa com os predicados do hospedeiro (`game/ruleset-traits.ts`, OW-04): o mundo
`leavesOnExit`, `creditsAggregates`, não `keepsSnapshot` e `usesAreaOfInterest`. O `id` é o da
**encarnação** do mundo — único por sessão criada, porque o ledger é `UNIQUE (session_id, seq)` e o
`seq` recomeça em zero a cada sessão —, e a versão de conteúdo é congelada na criação (invariante
7). A sessão **não tem snapshot** (ADR 0060 d.10a): monstros, cadáveres e campos são efêmeros e
renascem dos spawns.

### O que a topologia de mundo responde

Cada pergunta da `SessionTopology` (a tabela da instância está em
[`session-topology-audit.md`](../session-topology-audit.md)), do ponto de vista do mundo:

| Pergunta | No mundo | Estado |
|---|---|---|
| `onEmpty` | nada: o mundo existe antes de haver alguém nele | final |
| `onCharacterDied`, `onExitFinished` | **só quem saiu sai**, com o extrato dele (`member-left`, o mesmo caminho do membro de uma party); nunca `session.end` | a morte do Canary (vida e mana cheias, templo, tela de relogin, proteção de login) é a **OW-32**; a saída pelo `canLogout`, a OW-14 |
| `leaderOf`, `onLeaderGone` | **não há líder**: `undefined` e nada a trocar | final |
| `runsRouteWalker`, `runsExitRules` | não: o personagem anda quando o jogador pede e fica onde está quando ninguém pede; a regra de saída do bot é da hunt idle | final |
| `startsInstanceSchedules` | não: o spawn do mundo nasce com o mundo, sem ninguém — nunca com o primeiro a entrar | o spawn é da **OW-25/OW-31** |
| `burnsStaminaByTime` | não: a stamina queima ao ganhar XP, como o Canary (a comida continua drenando) | a regra é da **OW-46** |
| `namesOwnerInEvents` | sempre: o número de presentes não pode decidir o que vai para o ledger | final |
| `namesOwnerInItemIds` | sempre: o id de todo item novo é `${session.id}:${character.id}:${lootSeq}` (a instância solo fica em `${session.id}:${lootSeq}`) | final; ver "A sessão que não acaba" |
| `scopesEventsToOwner` | sempre: cada evento de personagem leva o dono, e o extrato e o analisador de cada um filtram por ele | final; ver "A sessão que não acaba" |
| `creditKill`, `rewardEligible`, `lootRecipient` | **só o dono do golpe final**, vivo e com stamina; sem sorteio (o `session.rng` não é tocado) | **provisório**: o mínimo seguro até o crédito do Canary (**OW-28**), em que a XP é a fatia de dano de cada um |
| `placeOnEnter` | ver abaixo | final |

### A sessão que não acaba: o que a instância nunca precisou

O mundo é a primeira sessão em que **o mesmo id volta à mesma sessão**, e em que **estranhos dividem
uma lista só** — duas coisas que a instância (que acaba) e a Cidade (que não simula) nunca
exercitaram. A revisão da OW-13 achou quatro defeitos que nascem daí, e os quatro têm teste em
`world.test.ts`:

- **Quem entra começa sem fila.** `onLeave` não cancela os eventos de quem saiu — eles "vencem, não
  encontram o personagem" —, e isso só vale até o mesmo id voltar: o passo, a vida e a mana que
  ficaram na fila achavam o `CharacterRuntime` novo por id e se reagendavam, uma cadeia a mais por
  relogue rápido (a regeneração a 2×, 3×…). `onEnter` faz `cancelEvents(character.id)` antes de
  agendar a fila da entrada — na instância é um no-op, porque o id de quem entra nunca esteve nela.
- **O relógio do mundo anda sem ninguém.** A âncora do tempo cobrado (`#staminaAnchorMs`) é a do
  último evento, e o mundo vazio não tem evento: o primeiro a entrar depois de uma hora pagaria a
  hora de comida (`fedMs`, persistida) que não viveu. `onEnter` do mundo cobra o intervalo dos que
  **já estavam**, e leva a âncora para agora antes de o entrante contar. A instância não muda (o
  relógio nunca corre nela sem ninguém, e o entrante tardio de uma party paga como sempre pagou).
- **O id de item novo leva o dono.** `lootSeq` nasce em zero em todo `CharacterRuntime` de ticket, e
  o id sem dono (`world-1:0`) é a chave primária de `item_instance` com `ON CONFLICT DO NOTHING`:
  o segundo item era descartado em silêncio e o ledger creditava assim mesmo (invariante 10). O
  critério deixou de ser "há party" (`SessionTopology.namesOwnerInItemIds`) e mora num ponto só,
  `#newInstanceId` (loot de cadáver, baú de quest e bolsa de reposição da morte). E o personagem
  que sai e volta continua o `lootSeq` de onde parou — o ruleset o guarda por id enquanto ele está
  fora (`#lootSeqOfDeparted`, em memória: o mundo não tem snapshot).
- **Estranhos não leem a lista uns dos outros.** `namesOwnerInEvents` só põe o dono no `detail` de
  quatro eventos de progresso; a morte, a perda de XP e de nível, a skill, as bênçãos e os itens
  perdidos não têm dono, e o extrato de um mostrava os de outro como se fossem dele.
  `NotableEvent.characterId` (opcional) é gravado por `Session.record` só onde o ruleset declara
  `scopesEventsToOwner` — a instância nunca o grava, e a lista dela é a de sempre byte a byte —, e
  `Receipt` (`#receiptFor`), o `session-state` e o analisador (`Session.notableEventsFor`) levam os
  eventos sem dono e os do próprio personagem. O evento da sessão (`advance-truncated`) continua de
  todos. **Fica para a OW-18**: o cursor do analisador no hospedeiro ainda é a posição absoluta na
  lista, que o teto (`maxNotableEventsPerCharacter`) desloca (`Session.notableEventsDropped`), e um
  evento de outro personagem ainda muda a contagem e provoca um `analyzer` sem evento novo para
  quem o recebe.

### A entrada: onde se saiu, senão o templo

`placeOnEnter` coloca o personagem pela **mesma legalidade de um passo** (`placeReachable`, a busca
a pé da Cidade — nunca o anel geométrico, que atravessa o muro do templo):

1. **A âncora** (`CharacterRuntime.worldPosition`, coordenada absoluta do Tibia): o login volta ao
   tile onde se saiu (`canary/src/creatures/players/player.cpp:12332-12336`). Em qualquer andar do
   recorte. Se o tile está ocupado, entra no livre mais próximo **dele**, a pé — e não no templo.
2. **O templo**, quando a âncora não existe, é o `0,0,0` do Canary
   (`iologindata_load_player.cpp:207-210`), cai fora do recorte, num andar que o recorte não tem ou
   num tile que virou parede (`protocolgame.cpp:1056`). É um caminho **esperado**, não um erro: o
   jogador não tem culpa de o tile onde saiu ter deixado de existir. Com o templo lotado, os outros
   entram no livre mais próximo a pé (até 1.089 tiles, `WORLD_ENTRY_TILES`, o número da Cidade).
3. **Não cura.** A vida e a mana são as do ticket (a Cidade curava ao entrar, `city.ts:126-130`), e
   a regeneração da hunt começa na entrada: um pulso por vocação, **sem comida, em PZ ou fora dela**
   (a regra do dono, ADR 0060 d.14d).

A âncora é uma **âncora, não uma posição ao vivo**: ninguém a reescreve a cada passo (seria uma
escrita por passo). `WorldRuleset#worldPositionOf(character)` traduz o tile de agora para a
coordenada absoluta, e quem grava a âncora é o dono da sessão — na saída e no checkpoint (OW-16,
OW-20). **Tem que ser lida antes de o personagem ser movido**: numa transição o hospedeiro constrói
o destino antes de encerrar a origem, e a essa altura o `position` já é o do destino (o defeito que
`onLeave` da Cidade explica).

### O portão de serviço de Cidade por PZ

`Ruleset.acceptsCityServices(session, characterId)` (opcional na interface; só o mundo a declara)
responde se o personagem pode usar **agora** loja, depósito, promoção, aprender magia ou o livro do
treino (ADR 0052 d.2): **só em tile PZ**. Lê o **bit** da PZ (`hasZoneFlag`), não o tipo — o tile
`P` (PZ + no-logout, o de z6 sobre o templo) aceita serviço e recusa a saída, as duas leituras do
mesmo tile. Mapa sem a camada `zones`, andar sem ela, personagem morto e quem não está na sessão
respondem `false`: sem dado, sem serviço, ao contrário de `canLogout`, que sem dado não prende
ninguém. É a pergunta; **quem recusa a intenção e avisa o jogador é o hospedeiro** (OW-18), que
hoje confere `ruleset.type === 'city'`.

### Os tetos da sessão

`WORLD_SESSION_LIMITS` (ADR 0060 d.5): `maxEventsPerAdvance` 65.536, `maxPendingDomainEvents` 8.192
e `maxNotableEventsPerCharacter` 64. São **ponto de partida, não medida**: os defaults da hunt,
medidos para um personagem, multiplicados por dezesseis, e o `bench:world` (OW-35) os fixa na
máquina de destino. `createWorldSession({ limits })` os troca campo a campo.

### O que ainda não existe

- **Quem hospeda.** Nada cria o mundo: o `WorldShard` atrás de `OPEN_WORLD` é a OW-18, e a tabela
  de transições (`game/transitions.ts`) tem a entrada `world: []` só porque o `Record<SessionType,
  …>` o exige. Com a flag desligada — o default — o hospedeiro é o de hoje.
- **A fila estável.** O ADR 0060 d.5c quer a fila do mundo ordenada por `(dueAtMs, priority,
  subject, kind, seq)` (`tieBreak: 'stable'`, OW-06, #827). `createWorldSession` é onde ela se
  pede, e a OW-06 ainda não pousou: até lá a fila do mundo desempata por inserção, como a da
  instância, que é correto enquanto não há monstro dormente (a OW-30 é quem depende da ordem).
- **Monstro.** Sem pontos de spawn (OW-25) e sem semear o spawn na criação (OW-31), o mundo anda
  sem criatura nenhuma. O personagem ocioso ainda agenda um `PLAYER_STEP` por passo (o custo de
  quem fica parado, medido pelo `bench:world`, OW-35).
- **O evento notável.** A entrada grava `entered-world` (o dono no detalhe, como `entered-city`); o
  texto dele no cliente é da OW-23 — até lá ele sai cru, como todo tipo que o cliente não conhece.

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora |
|---|---|---|
| Tipo do mundo | `no-pvp` | `packages/content/data/worlds/main.json`, `worldType` (vocabulário em `WORLD_TYPES`, `packages/content/src/schemas.ts`) |
| Mapa do mundo | `thais` | `packages/content/data/worlds/main.json`, `map` |
| Templo de Thais | `(32369, 32241, 7)`, absoluto | `packages/content/data/worlds/main.json`, `towns[].temple` |
| Teto de gente | 200 | `packages/content/data/worlds/main.json`, `capacity` — o `CITY_SHARD_CAPACITY` (`packages/server/src/game/sessions.ts`) continua sendo o da Cidade até a admissão do mundo (OW-18) |
| Janela de luta que trava a saída | 60 s desde o último golpe dado ou recebido, fora da PZ | `packages/sim/src/combat/in-fight.ts`, `IN_FIGHT_WINDOW_MS` (o `pzLocked` do Canary) |
| Taxa de atualização do mundo | 10 Hz, com ou sem visualizador | `packages/sim/src/rulesets/world.ts`, `WORLD_HZ` |
| Tetos da sessão do mundo | 65.536 eventos por avanço, 8.192 eventos de domínio pendentes, 64 notáveis por personagem (ponto de partida; o `bench:world` fixa) | `packages/sim/src/rulesets/world.ts`, `WORLD_SESSION_LIMITS` |
| Tiles visitados ao colocar quem entra | 1.089 (o quadrado de 33, o da Cidade) | `packages/sim/src/rulesets/topology.ts`, `WORLD_ENTRY_TILES` |

## Em aberto

- A presença, a durabilidade e a apresentação (OW-14 a OW-20): ver o
  [plano](../open-world-plan.md). É aí que `canLogout` ganha chamador, e que a sessão de mundo
  ganha quem a hospede.
- O teto de 200 é o ponto de partida; o `bench:world` o fixa (ADR 0060 d.11).
- O leque de saída barato (OW-22) saiu: codificar uma vez, visualizadores por personagem e AOI com
  andar — ver [Cidade](city.md#o-leque-barato-ow-22-845). Falta a AOI v2 para criaturas (OW-33) e
  para combate, efeitos, campos, cadáveres e tiles (OW-34): hoje a AOI só conhece jogador.

## Divergências do PRD

**O mundo é um arquivo de conteúdo, e o Canary o espalha entre `config.lua` e o mapa.** O
`worldType` mora no `config.lua` (`canary/config.lua.dist:33`); as cidades moram no próprio OTBM,
nos nós `OTBM_TOWN` (`canary/src/io/iomap.cpp:262-285`: id, nome e posição do templo). Aqui os dois
vivem em `data/worlds/<id>.json`, porque o Draconya pode ter mais de um mundo (ADR 0060 d.2.a) e
porque conteúdo se edita e se revisa. O templo de Thais, `(32369, 32241, 7)`, foi conferido contra
o nó de cidades do `otservbr.otbm` real (Thais é a cidade 8): é o que `readOtbmTownsAndWaypoints`
(`scripts/otbm.ts`) lê de lá.

**A tradução de coordenada tem outro nome.** A issue da OW-13 pedia `toWorldPoint`/`fromWorldPoint`
em `packages/content/src/map.ts`; a OW-08 já entregou o par, como `absoluteToLocal` e
`localToAbsolute`, e a topologia os usa. Duas funções com o mesmo trabalho seriam dois lugares para
errar a origem do recorte.

**O mundo é uma subclasse do `HuntRuleset`.** O plano diz "o mundo é o `HuntRuleset` com uma
`SessionTopology`"; a topologia sozinha não declara `type`, `shared`, `progress` nem `hz`, e a
identidade da sessão fica na classe `WorldRuleset` (um `type` de campo largo em `HuntRuleset` e
mais nada na hunt). A topologia continua sendo o que a hunt pergunta; a classe, o que o hospedeiro
lê.
