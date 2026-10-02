# Mundo aberto

**Status:** parcial — existem o **mundo como conteúdo** (OW-08, #829: `data/worlds/main.json` com
tipo, mapa, cidade, templo e teto, validado no boot), a **regra de zona e de saída** do `sim`
(OW-10, #831: `zoneAt`, `hasZoneFlag` e `canLogout`), a **sessão do mundo** (OW-13, #834:
`createWorldSession`, a topologia de mundo e a entrada na posição salva ou no templo), a **saída do
Tibia no `sim`** (OW-14, #835: o `logout` por `canLogout` e a perda de conexão, que tenta sair aos
60 s), o **personagem em repouso** (OW-15, #836: as colunas de mundo e vitais em `characters`, o
ticket e o extrato que as levam) e a **liquidação do checkpoint no `jobs`** (OW-17, #838: o extrato
sem valor movido vira só estado absoluto, sem linha de ledger). Nada hospeda a sessão ainda — o
hospedeiro a constrói na OW-18, atrás de `OPEN_WORLD` — e a presença no hospedeiro, o checkpoint do
lado do `game` e a apresentação ainda não saíram do papel.
**PRD:** — (o PRD descreve a Cidade como praça social; o mundo aberto nasceu depois dele)
**Épico:** E19 · Mundo aberto (M47–M51)
**Referência técnica:** [ADR 0060](../adr/0060-tibia-open-world-without-pvp.md) (mundo aberto do
Tibia sem PvP), [`docs/open-world-plan.md`](../open-world-plan.md) (marcos e ordem das issues)

## Comportamento

O Draconya é o mundo aberto do Tibia, tipo `no-pvp`, e a hunt idle é o adicional instanciado (ADR
0060 d.1). Um **mundo** é, no Canary, o `Game` único: aqui, uma sessão compartilhada num processo
`game`, à qual o personagem pertence (`characters.world_id`, OW-15). Este documento cresce com
cada peça do plano que sai do papel; hoje existem seis: o que o mundo **é** como dado, a regra de
zona do `sim` — onde o personagem pode sair —, a sessão do mundo, que é o motor da hunt com a
topologia de mundo, a saída do Tibia, que usa a regra de zona para o `logout` e para o personagem
que perdeu a conexão, o personagem em repouso — o que a linha de `characters` guarda dele (OW-15) — e
a liquidação do checkpoint, que decide o que do extrato vira linha de ledger (OW-17).

## O personagem em repouso (OW-15, #836)

O Tibia guarda do jogador deslogado o `loginPosition`, a cidade, a vida, a mana e as condições
(`canary/src/creatures/players/player.cpp:4041, 12332-12336`). O Draconya os guarda na linha de
`characters` — é o que faz **deslogar a 10 HP voltar com 10 HP**, no mesmo tile. Hoje o ticket nasce
cheio (`game/sessions.ts`) e a linha não guarda nada disso. Tudo abaixo é atrás de `OPEN_WORLD`
([configuração](../runtime-configuration.md)): com a flag desligada — o default — o jogo é o de hoje.

### As colunas (migração `0029_836-world-vitals.sql`)

| Coluna | Tipo | Quer dizer | Nulo |
|---|---|---|---|
| `world_id` | `text`, default `'main'` | o mundo a que o personagem pertence, escolhido na criação (OW-50) | — |
| `world_x`, `world_y`, `world_z` | `integer`, `integer`, `smallint` | a posição **absoluta** do Tibia onde saiu; os três juntos ou nenhum (CHECK) | nasce no templo (o `0,0,0` do Canary) |
| `town_id` | `text`, default `'thais'` | a cidade: o templo para onde volta ao morrer | — |
| `health`, `mana` | `integer` | a vida e a mana com que saiu (CHECK não negativo) | cheio |
| `conditions` | `jsonb` | as condições ativas, como **prazo restante** | nenhuma |

A migração é aditiva (ADR 0014): nenhuma linha é reescrita, o `DEFAULT` preenche as duas `NOT NULL`
e o resto nasce nulo — `world-vitals-migration.postgres.test.ts` a aplica sobre um banco com
personagens em `'city'` e confere que nenhuma outra coluna muda. O `upgrade-existing-schema.sql` **não**
ganha as colunas: é o upgrade único do schema anterior à FUN-11, e uma coluna que ele criasse faria a
`0029` falhar ao rodar depois dele — o banco legado entra pela migração, como entrou a `durable_version`.

### O caminho: coluna → ticket → sessão → extrato → coluna

| Passo | O que acontece | Onde |
|---|---|---|
| Coluna → ticket | o `api` lê a linha e leva `worldPosition`, `townId`, `health`, `mana` e `conditions` — só o que existe e passa na conferência; vida zero é um morto, e o morto entra cheio | `api/tickets.ts`, `initialCharacterOf`; `api/party.ts` para cada membro |
| Ticket → sessão | a vida e a mana entram **limitadas pelo máximo do level** (e a vida nunca abaixo de 1); a âncora e a cidade vão para o `CharacterRuntime`; as condições entram e o ruleset as rearma como eventos no `onEnter` | `game/sessions.ts`, `characterFromTicket` |
| Sessão → extrato | todo extrato de estado absoluto inteiro — fim de hunt, estado da Cidade, snapshot irrestaurável — leva os cinco campos | `game/host.ts`, `#worldStateOf`; `snapshot-settlement.ts` |
| Extrato → coluna | o `jobs` os escreve como campos absolutos, **guardados por `durable_version`**: extrato atrasado nunca devolve a vida de ontem nem o tile de antes | `jobs/ledger.ts` |

- **Ticket sem posição cai no templo.** A coluna nula é o campo ausente no ticket; o personagem entra no
  mundo pelo `placeOnEnter` (a âncora, senão o templo). O mesmo vale para uma posição que o mapa não tem mais.
- **O mundo não cura na entrada.** A vida e a mana são as do ticket (a Cidade curava ao entrar,
  `city.ts:126-130`). A regeneração da hunt começa na entrada, em PZ ou fora dela (ADR 0060 d.14d).
- **Quem morreu volta ao templo, de vida e mana cheias, sem condição** (`player.cpp:4226-4252`): o
  extrato leva a posição `null`, a vida e a mana do máximo e `conditions: []`. A vida zero nunca chega à linha.
- **Nulo e ausente são coisas diferentes no extrato.** `worldPosition: null` zera as três colunas
  ("volta ao templo") e `conditions: []` grava nulo; omitir o campo deixa a coluna como estava.
- **A `townId` é a marca de que o `api` leu o mundo.** O ticket a leva sempre com a flag ligada, e sem ela o
  extrato **não leva nada**: um `api` anterior ou com a flag desligada emitiu um ticket sem o mundo, e
  gravar `worldPosition: null` apagaria a posição da linha enquanto a vida cheia desfaria a que ela guarda.

### As condições são prazo restante

`ConditionState.expiresAtMs` e `nextTickAtMs` são instantes do relógio **lógico da sessão**, e o repouso
não conta tempo: o Canary guarda os `ticks` que faltavam (`condition.cpp:300`), e o relógio de cada sessão
do Draconya nasce em zero. A linha guarda, então, **quanto faltava** — `CharacterRuntime.conditionsAsRemaining()`
subtrai o relógio a que o personagem está ligado, e a condição que já venceu não vai. A haste que faltava
8 s e o veneno que faltava 4 s correm de novo, pelo que faltava, na sessão que o recebe.

O caminho de volta tem uma armadilha: `Session.enter` **não** traduz o personagem que veio do ticket (sem
sessão anterior não há de onde vir), então uma sessão que já andou — o recém-chegado de uma party em curso,
a Cidade, o mundo — veria toda condição como vencida no instante da entrada, e o ruleset a apagaria.
`carryRestoredConditions` soma o relógio da sessão **antes** de `enter` (o hospedeiro o faz para o
recém-chegado e a Cidade; o `WorldShard` da OW-18 tem de fazer o mesmo).

### O repouso é `'offline'`

Com a flag ligada, a lista e a seleção de personagens (`api/characters.ts`) reportam o personagem **sem
sessão no diretório** como `'offline'` — o estado sem sessão do invariante 8 —, em vez do `'city'` que a
coluna `state` guarda por default. O diretório continua mandando: quem está numa hunt, ou no mundo, nunca é
`offline`. O cliente ainda mostra o texto cru (`STATE_TEXT` não conhece `offline`): é da OW-23.

### O que ainda não existe

- **Quem ESCREVE a âncora.** O extrato leva `owner.worldPosition` como está; quem a atualiza com a posição
  de agora é o dono da sessão, na saída e no checkpoint (`WorldRuleset#worldPositionOf`, OW-16/OW-20).
- **O checkpoint do mundo** (OW-16), do lado do `game`: quem emite o extrato a cada 60 s. A liquidação dele
  no `jobs` já existe (próxima seção) e é a mesma para o extrato de fim de hunt.
- **A sessão do mundo hospedada** (OW-18): com a flag ligada o login ainda cai na Cidade, que cura ao entrar
  — a vida do ticket só sobrevive numa hunt idle, e na praça é curada.
- **A escolha do mundo** (`world_id`, OW-50) e a **troca de cidade** (`town_id`): hoje só há `main` e `thais`.

## A liquidação do checkpoint no `jobs` (OW-17, #838)

O checkpoint do mundo grava, a cada 60 s e por personagem sujo, o estado absoluto inteiro — posição, cidade,
vida, mana, condições, estoque, equipamento, storages (ADR 0060 d.10.d). Quase toda linha dessas não moveu
nada: o jogador andou, tomou dano, curou. Uma linha de ledger por checkpoint seria só um log de posição que
cresce para sempre, e o ledger existe para registrar **valor** (invariante 10). Então o `jobs` separa os dois
casos pelo que o extrato carrega:

| Extrato | O que o `jobs` faz |
|---|---|
| **Versionado, sem valor movido** (com `OPEN_WORLD`) | aplica **só o estado absoluto**, guardado por `characters.durable_version`; **nenhuma linha de ledger** |
| **Versionado, com valor movido** | o caminho de hoje: linha de ledger e progressão na **mesma transação**, a chave `(session_id, seq)` fazendo o retry não duplicar |
| **Sem versão** (nó `game` anterior, deploy em rolagem) | o caminho de hoje, mesmo sem valor: sem a guarda de versão, a chave única é a única idempotência dele |
| **Flag desligada** (o default) | o caminho de hoje para todo extrato, byte a byte |

**"Sem valor movido"** é, exatamente: `xpGained`, `goldGained`, `goldSpent`, `kills` e `deaths` iguais a zero, e
`acquired` e `removedInstances` vazios (`movesValue`, `jobs/ledger.ts`). A XP negativa da penalidade de morte
conta como valor, e o gold que entra e sai na mesma sessão também — o ledger tem o que registrar nos dois. O que
não conta, de propósito: posição, vida, mana, condições, estoque, storages (estado, sem o que somar) e os
campos monotônicos (Bestiário, Bosstiary, magias aprendidas, vocação, promoção), que são idempotentes por si.

**A idempotência sem a chave única vem da versão.** Reprocessar o mesmo extrato, ou um mais velho que o aplicado,
encontra `durable_version` já igual ou maior e não escreve absoluto nenhum — é a "linha mais antiga é ignorada",
e vale também para o extrato que chega depois de uma queda entre gravar a coluna e apagá-lo do Redis. O que é
monotônico entra sempre, como no caminho com ledger (aplicar de novo não custa nada). O que **não** muda é a
trava de linha — é ela que serializa o `jobs` e o `api` (ADR 0024) — e a ordem: o personagem liquida completo e
em ordem de versão, e a liquidação do ticket (`settleCharacterProgress`, FUN-56) é o mesmo caminho, então
encontra as linhas do lote em ordem de versão e aplica, das 3, 1 e 2 gravadas, a do 3.

**Sem linha de ledger também não toca em XP, gold nem level**: não há delta a somar, e o level que
`levelForXp` derivaria de uma XP que não mudou seria uma escrita a mais numa coluna econômica. `gold`
continua sendo a projeção do ledger.

### O custo, por mundo com 200 personagens

| Cadência do checkpoint | Transações/s no `jobs` | Linhas de ledger por dia, no teto |
|---|---|---|
| 10 s | 20 | 1,73 M |
| **60 s** (`WORLD_CHECKPOINT_MS`, ADR 0060 d.10.d; o emissor é a OW-16) | **3,3** | **até 288 mil** |

A conta: 200 personagens × 1 extrato a cada 60 s = 3,33 transações/s; × 86.400 s = 288.000 por dia. O **teto** é
o de todo extrato ter valor — 200 personagens caçando sem parar —; com a OW-17 só as linhas **com** valor entram
no ledger, e quem só anda, trata ou espera não cria nenhuma. A transação por extrato continua (trava de linha,
leitura, `UPDATE`), mas sem a inserção e sem os três índices que a linha de ledger mexe.

**Medido** (nesta máquina, arm64, Postgres local; 20.000 linhas de ledger com o `ref` de um extrato sem eventos):
uma linha de ledger pesa **≈ 497 bytes** — 315 de heap e 179 de índices (`ledger_pkey`,
`ledger_session_seq_unique` e `ledger_by_character`) —, então o teto é **≈ 143 MB por dia por mundo** (≈ 52 GB
por ano), e `notableEvents` o aumenta. O que a OW-17 poupa é a fração dessas linhas que não move valor. **Não
medido, e fica para a OW-35** (`bench:world`, na arquitetura de destino, ADR 0013): a vazão da liquidação com as
hunts idle no mesmo processo, e a fração real de extratos com valor.

**Como se vê em produção:** `draconya_jobs_receipts_written_total` conta todo extrato liquidado e
`draconya_jobs_receipts_state_only_total` os que entraram sem linha de ledger — a diferença é o que de fato
cresceu o ledger. O resultado da varredura (`LedgerSweepResult.stateOnly`) só traz o campo quando é maior que
zero, para o resultado com a flag desligada ser o de antes.

**O limite do ticket.** A liquidação síncrona do ticket aplica no máximo os **50 extratos mais antigos** do
personagem por chamada (`SETTLE_LIMIT`). A 1 extrato por minuto isso são ~50 minutos de `jobs` parado; passado
isso, o ticket entra com a posição do 50º extrato e o resto sai no ciclo seguinte, em ordem — nada se perde (o
contador do hospedeiro já parte da maior versão pendente), mas o jogador entra num tile antigo. É o limite que
o login rápido paga desde a FUN-56, e não mudou.

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

Os spawns do Canary entram à parte (OW-25), e a topologia (OW-13) lê este arquivo. As colunas de
`characters` (OW-15) guardam coordenada **absoluta** — a mesma que o `temple` — e a cidade pelo `id`
de `towns[]`.

## Zona por tile e `canLogout` (OW-10, #831)

`packages/sim/src/zones.ts` lê a camada `zones` do mapa (OW-09, ver [a Cidade](city.md)) e a
transforma na regra do Tibia. São funções **puras e só de leitura**: a Cidade segue protect zone por
construção (ADR 0004) e as hunts não consultam zona. Quem as usa é a saída do mundo — o `logout` e o
x-log (OW-14, abaixo) —, e virão a entrada do mundo numa hunt idle (OW-20) e o portão de combate
no-pvp (OW-27).

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
  Quem age sobre o veredicto — emitir `departure-requested` ou `logout-refused`, reagendar o x-log
  para quando a janela de luta vence — é o ruleset do mundo (OW-14, abaixo).

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
| `onCharacterDied`, `onExitFinished` | **só quem saiu sai**, com o extrato dele (`member-left`, o mesmo caminho do membro de uma party); nunca `session.end` | a morte do Canary (vida e mana cheias, templo, tela de relogin, proteção de login) é a **OW-32**; a saída pelo `canLogout` (o `logout` e o x-log) não passa por estas perguntas: é a OW-14, abaixo |
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
- **Quem lê a saída.** `departure-requested` e `logout-refused` saem do `sim`, e o hospedeiro hoje os
  ignora (`#presentMoves` os descarta): ler o primeiro **sem visualizador** — gravar o checkpoint e
  soltar o personagem para o repouso — e traduzir o segundo na mensagem `logout-refused` é a OW-19, que
  também entrega `presence-lost` e `presence-restored`.
- **A fila estável.** O ADR 0060 d.5c quer a fila do mundo ordenada por `(dueAtMs, priority,
  subject, kind, seq)` (`tieBreak: 'stable'`, OW-06, #827). `createWorldSession` é onde ela se
  pede, e a OW-06 ainda não pousou: até lá a fila do mundo desempata por inserção, como a da
  instância, que é correto enquanto não há monstro dormente (a OW-30 é quem depende da ordem).
- **Monstro.** Sem pontos de spawn (OW-25) e sem semear o spawn na criação (OW-31), o mundo anda
  sem criatura nenhuma. O personagem ocioso ainda agenda um `PLAYER_STEP` por passo (o custo de
  quem fica parado, medido pelo `bench:world`, OW-35).
- **O evento notável.** A entrada grava `entered-world` (o dono no detalhe, como `entered-city`); o
  texto dele no cliente é da OW-23 — até lá ele sai cru, como todo tipo que o cliente não conhece.

## A saída do Tibia (OW-14, #835)

No Tibia não se foge de uma luta fechando o navegador: o `logout` só passa onde `canLogout` deixa, e o
personagem sem conexão não some — fica parado, vulnerável, e sai depois, **se `canLogout` deixar**.
A OW-14 põe isso no `sim`, em `WorldRuleset` (`packages/sim/src/rulesets/world.ts`) e em
`packages/sim/src/world-exit.ts`. O `sim` **decide e emite**; tirar o personagem da sessão com o
checkpoint e soltá-lo para o repouso é I/O, do hospedeiro (OW-19).

### O `logout`

`WorldRuleset#requestLogout(session, characterId)` passa o pedido por `canLogout` (a tabela de "Zona
por tile e `canLogout`", acima) e resulta em **um** de dois eventos de domínio — nunca nos dois, e
nunca em nenhum:

| Veredicto | Evento |
|---|---|
| `ok` (na PZ, ou fora dela e fora de luta) | `departure-requested { characterId, reason: 'logout', worldPosition }` |
| recusa | `logout-refused { characterId, reason }`, com `'no-logout-tile'` ou `'in-fight'` — os do `logout-refused` do protocolo (OW-11); o personagem não muda |

`worldPosition` é a coordenada **absoluta** do tile de agora — a âncora do próximo login
(`player.cpp:12332-12336`) —, lida no instante da decisão. Devolve o veredicto para quem quer
responder na hora, e `null` (sem evento) para quem não está na sessão ou já morreu: a morte tem a
saída dela (OW-32). O veredicto é o mesmo a 1 Hz e a 10 Hz, porque `canLogout` lê o relógio lógico.

**`departure-requested` é um pedido.** O personagem continua na sessão até o hospedeiro gravar o
checkpoint (`Session.checkpoint`) e chamar `Session.leave`: o extrato inteiro precisa existir antes de
ele sair. É **gameplay, não apresentação** — o hospedeiro o lê sem visualizador, como o `member-left`.

### A perda de conexão

`presenceLost(session, characterId)` e `presenceRestored(session, characterId)` são **intenções de
servidor** (ADR 0060 d.7): o protocolo não tem opcode para elas e o cliente nunca as manda
(invariante 4). Quem as entrega, no instante lógico em que a conexão caiu ou voltou, é o hospedeiro
(OW-19) — inclusive `presence-lost` na chegada de quem entra no mundo sem visualizador.

**`presence-lost`** deixa o personagem **só**, e não o tira (`Player::sendPing`,
`canary/src/creatures/players/player.cpp:2321-2338`):

1. **O alvo é solto na hora** (`setAttackedCreature(nullptr)`, `player.cpp:2323-2325`): o alvo que o
   jogador escolheu, o candidato do auto-target e a caminhada até um alvo.
2. **Toda automação para.** O bot (todos os grupos da barra de ações) e as automações da barra
   (`swap-ring` e as outras), a eleição de alvo da política, a caminhada manual, o follow e a
   postura `follow`/`keep-distance`. O herói **também deixa de bater no monstro ao lado**: o golpe automático no
   melhor ao alcance é o bot escolhendo, e a resposta do dono é que, sem o jogador, toda automação
   para. Nada para o que o jogo faz **com** o personagem: regeneração, condições, o medo que o faz
   andar e, claro, o que os monstros fazem com ele — ele fica vulnerável.
3. **Agenda a tentativa de saída em +60 s** (`XLOG_DELAY_MS`, o `noPongTime >= 60000` de
   `player.cpp:2327`), no relógio lógico.

**A tentativa de saída** (`xlog-attempt`) decide pelo estado de **agora**:

| Em `canLogout`, agora | O que acontece |
|---|---|
| passa (PZ, ou fora de luta) | `departure-requested { reason: 'xlog', worldPosition }` |
| `'in-fight'` | reagenda para `lastCombatActionAtMs + IN_FIGHT_WINDOW_MS` — o primeiro instante em que a luta deixa de valer. Se algum monstro bater de novo nesse meio tempo, o carimbo anda e a tentativa seguinte reagenda outra vez: **o personagem sai 60 s depois do último golpe**, e enquanto houver monstro em cima dele não sai |
| `'no-logout-tile'` | **desiste** e não reagenda: o Canary faz `shouldForceLogout = false` (`player.cpp:2335-2337`), e sem dono o personagem não anda, então o tile não muda. O teto é o idle kick (OW-47) |

É a combinação que o ADR 0060 d.7 escolheu: o Canary tenta **uma** vez e deixa o idle kick resolver,
o TFS derruba mesmo em luta; o Draconya fica com o `canLogout` do Canary e o "sai quando a luta
acaba" do Tibia. Um evento por vez, nunca uma varredura (invariante 2).

**`presence-restored`** cancela a tentativa e devolve o controle: reelege o alvo e acorda o bot e as
automações de onde estavam, no instante lógico atual. **Reanexar antes dos 60 s cancela a saída**; cair
de novo depois recomeça a contagem do zero. Os dois são idempotentes: um segundo `presence-lost` de
quem já está sem conexão **não** reinicia os 60 s (senão cada reconexão que falha empurraria a saída),
e um `presence-restored` de quem nunca caiu não faz nada.

### O motivo da saída

`WorldDepartureReason` é `'logout' | 'xlog' | 'death' | 'idle-kick'`: o motivo da **saída do mundo**,
que o hospedeiro traduz no `EndReason` do checkpoint que grava. A OW-14 emite os dois primeiros; a
morte (`'death'`, templo e tela de relogin) é a OW-32 e o `'idle-kick'` é a OW-47 — a união os traz
desde já para o hospedeiro tratar os quatro. A saída do mundo tira o personagem da party de mundo
quando ela existir (OW-43): é o `onLeave`, o mesmo de qualquer saída.

### O que prende a invariante 3

- Nenhum resultado depende de `attached`: o hospedeiro entrega a intenção, e a linha do tempo — os
  instantes de cada tentativa, os eventos de domínio, o estado final — é a **mesma a 1 Hz e a 10 Hz**
  (`world-presence.test.ts` compara o roteiro inteiro, com luta, nos dois ritmos).
- A suspensão **não** entra no snapshot: o mundo não tem snapshot (ADR 0060 d.10a). Quem chega ao
  mundo sem visualizador recebe `presence-lost` na chegada, e quem sai ou volta pelo mesmo id começa
  sem suspensão.
- A instância não muda: o conjunto de suspensos é `null` em toda hunt (só nasce na primeira queda de
  um mundo), lido pelas sete guardas do caminho quente (`HuntRuleset#isSuspended`).

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora |
|---|---|---|
| Tipo do mundo | `no-pvp` | `packages/content/data/worlds/main.json`, `worldType` (vocabulário em `WORLD_TYPES`, `packages/content/src/schemas.ts`) |
| Mapa do mundo | `thais` | `packages/content/data/worlds/main.json`, `map` |
| Templo de Thais | `(32369, 32241, 7)`, absoluto | `packages/content/data/worlds/main.json`, `towns[].temple` |
| Teto de gente | 200 | `packages/content/data/worlds/main.json`, `capacity` — o `CITY_SHARD_CAPACITY` (`packages/server/src/game/sessions.ts`) continua sendo o da Cidade até a admissão do mundo (OW-18) |
| Janela de luta que trava a saída | 60 s desde o último golpe dado ou recebido, fora da PZ | `packages/sim/src/combat/in-fight.ts`, `IN_FIGHT_WINDOW_MS` (o `pzLocked` do Canary) |
| Espera do x-log, desde a perda de conexão | 60 s, no relógio lógico (o `noPongTime >= 60000` do Canary) | `packages/sim/src/world-exit.ts`, `XLOG_DELAY_MS` |
| Taxa de atualização do mundo | 10 Hz, com ou sem visualizador | `packages/sim/src/rulesets/world.ts`, `WORLD_HZ` |
| Tetos da sessão do mundo | 65.536 eventos por avanço, 8.192 eventos de domínio pendentes, 64 notáveis por personagem (ponto de partida; o `bench:world` fixa) | `packages/sim/src/rulesets/world.ts`, `WORLD_SESSION_LIMITS` |
| Tiles visitados ao colocar quem entra | 1.089 (o quadrado de 33, o da Cidade) | `packages/sim/src/rulesets/topology.ts`, `WORLD_ENTRY_TILES` |
| A flag do mundo aberto | desligada (`OPEN_WORLD=0`) | `packages/server/src/config.ts`, `OPEN_WORLD`; [`docs/runtime-configuration.md`](../runtime-configuration.md) |
| Mundo e cidade de quem existia antes da migração 0029 | `'main'` e `'thais'`, cheio, sem posição nem condição | `packages/server/migrations/0029_836-world-vitals.sql` |
| Teto de condições por personagem na linha | 64 | `packages/server/src/world-state.ts`, `MAX_CONDITIONS` |

## Em aberto

- A presença no hospedeiro, o checkpoint e a apresentação (OW-16 a OW-20): ver o
  [plano](../open-world-plan.md). É aí que a sessão de mundo ganha quem a hospede, que a âncora é
  gravada, que o `departure-requested` vira checkpoint e repouso, e que o `logout-refused` chega ao
  cliente.
- O `requestExit` que o `WorldRuleset` herda da hunt (a OW-13 o testa) **não é a saída do mundo**:
  ele conclui por `onExitFinished` depois de `exitDelayMs` e da janela de luta, mas não olha o tile —
  um tile de no-logout não o recusa. O hospedeiro do mundo (OW-19) deve rotear o `logout` por
  `requestLogout`, e nunca por ele.
- O x-log num **tile de no-logout** não tem saída além do idle kick (OW-47): o personagem não anda
  sem dono. Se o dono quiser que o x-log insista, é uma decisão nova — o Canary desiste.
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
