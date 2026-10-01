# Mundo aberto

**Status:** parcial — existem o **mundo como conteúdo** (OW-08, #829: `data/worlds/main.json` com
tipo, mapa, cidade, templo e teto, validado no boot) e a **regra de zona e de saída** do `sim`
(OW-10, #831: `zoneAt`, `hasZoneFlag` e `canLogout`, funções puras que nada ainda chama). A sessão
de mundo, a presença e o resto do plano ainda não saíram do papel.
**PRD:** — (o PRD descreve a Cidade como praça social; o mundo aberto nasceu depois dele)
**Épico:** E19 · Mundo aberto (M47–M51)
**Referência técnica:** [ADR 0060](../adr/0060-tibia-open-world-without-pvp.md) (mundo aberto do
Tibia sem PvP), [`docs/open-world-plan.md`](../open-world-plan.md) (marcos e ordem das issues)

## Comportamento

O Draconya é o mundo aberto do Tibia, tipo `no-pvp`, e a hunt idle é o adicional instanciado (ADR
0060 d.1). Um **mundo** é, no Canary, o `Game` único: aqui, uma sessão compartilhada num processo
`game`, à qual o personagem pertence (`characters.world_id`, OW-15). Este documento cresce com
cada peça do plano que sai do papel; hoje existem duas: o que o mundo **é** como dado, e a regra
de zona do `sim` — onde o personagem pode sair.

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

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora |
|---|---|---|
| Tipo do mundo | `no-pvp` | `packages/content/data/worlds/main.json`, `worldType` (vocabulário em `WORLD_TYPES`, `packages/content/src/schemas.ts`) |
| Mapa do mundo | `thais` | `packages/content/data/worlds/main.json`, `map` |
| Templo de Thais | `(32369, 32241, 7)`, absoluto | `packages/content/data/worlds/main.json`, `towns[].temple` |
| Teto de gente | 200 | `packages/content/data/worlds/main.json`, `capacity` — o `CITY_SHARD_CAPACITY` (`packages/server/src/game/sessions.ts`) continua sendo o da Cidade até a admissão do mundo (OW-18) |
| Janela de luta que trava a saída | 60 s desde o último golpe dado ou recebido, fora da PZ | `packages/sim/src/combat/in-fight.ts`, `IN_FIGHT_WINDOW_MS` (o `pzLocked` do Canary) |

## Em aberto

- A sessão de mundo, a presença, a durabilidade e a apresentação (OW-13 a OW-20): ver o
  [plano](../open-world-plan.md). É aí que `canLogout` ganha chamador.
- O teto de 200 é o ponto de partida; o `bench:world` o fixa (ADR 0060 d.11).

## Divergências do PRD

**O mundo é um arquivo de conteúdo, e o Canary o espalha entre `config.lua` e o mapa.** O
`worldType` mora no `config.lua` (`canary/config.lua.dist:33`); as cidades moram no próprio OTBM,
nos nós `OTBM_TOWN` (`canary/src/io/iomap.cpp:262-285`: id, nome e posição do templo). Aqui os dois
vivem em `data/worlds/<id>.json`, porque o Draconya pode ter mais de um mundo (ADR 0060 d.2.a) e
porque conteúdo se edita e se revisa. O templo de Thais, `(32369, 32241, 7)`, foi conferido contra
o nó de cidades do `otservbr.otbm` real (Thais é a cidade 8): é o que `readOtbmTownsAndWaypoints`
(`scripts/otbm.ts`) lê de lá.
