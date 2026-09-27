# 0050 — Cenário usável: um overlay de estado de tile por sessão sobre o `Tilemap` imutável

**Status:** proposto — decorre do [ADR 0037](0037-tfs-canary-fidelity-except-action-bar-and-automation.md)
d.1; estende o [ADR 0025](0025-real-map-from-otbm.md) (o importador passa a
preservar `aid`/`uid`/`text`; a decisão 4 "bloqueio deriva das flags uma vez" ganha a exceção do
tile interativo) e o [ADR 0009](0009-fixed-hunt-route-without-pathfinding.md)
(a rota autorada pode atravessar tile usável); usa a forma do [ADR 0041](0041-tibia-conditions-and-fields.md)
d.4 (campo bloqueante) para uma pergunta só: "dá para pisar aqui agora?"
**Data:** 2026-09-26
**Contexto técnico:** `packages/tools`/`scripts` (`otbm.ts`, `import-map.ts`, `trace-route.ts`),
`packages/content` (`tilemapSchema.interactables`, `data/scenery/`, `appearances.scenery`,
`itemSchema.use.tool`, `validateRoute`), `packages/sim` (`TileOverrides` novo, `movement.ts`,
`route/pathfind.ts`, `monster/step.ts`, `RouteWalker`, `rulesets/hunt.ts`, `rulesets/city.ts`),
`packages/protocol` (`use-on-map`, `tile-update`, `look`, `look-result`), `packages/server`
(mapa estado → aparência), `packages/client` (patch da pilha por tile, clique no tile)
**Issues:** novas — ver `PLAN.md` W8–W10 e o grupo 3

## Contexto

O dono pediu *"cenário, itens usáveis do cenário como alavancas, portas, matos... tudo 100%"*. O mapa
é estático em toda a pilha (auditoria de 2026-09-26, §3): `Tilemap` é imutável e compartilhado entre
sessões (invariante 7); o bloqueio é derivado **uma vez**, no importador, de `unpass` — uma porta
fechada é `#` para sempre; o cliente desenha a pilha estática de `things/<versão>/maps/<id>.json`;
`scripts/otbm.ts` lê `ATTR_ACTION_ID`/`ATTR_UNIQUE_ID`/`ATTR_TEXT`/`ATTR_TELE_DEST` e os descarta. O
único estado de tile mutável é `Fields` (`packages/sim/src/fields.ts`): índice pequeno do ruleset,
chave numérica por tile, entra no snapshot, e hoje não bloqueia movimento. Nos recortes: Thais tem
51 portas de chave, 59 baús, 2 alavancas e 2 stone piles; Rat Cellars 2 alavancas; Rotworm Caves 3
rope spots; a Dragon Lair nada.

O que o Tibia faz (Canary, só mecanismo e número — ADR 0019/0037):

- **Portas** são triplas de ids (`data/libs/tables/doors.lua`: `lockedDoor`/`closedDoor`/`openDoor`,
  em `KeyDoorTable`, `LevelDoorTable`, `QuestDoorTable`); usar transforma `closed → open`
  (`item:transform`) e teleporta quem usou para o tile da porta; a porta **de level** exige
  `player:getLevel() >= item.actionid - 1000` ("Only the worthy may pass."); a **de quest** exige
  `player:getStorageValue(item.actionid) ~= -1`; `closing_door.lua` barra no `onStepIn` quem não tem
  o requisito (teleporta de volta) e a porta comum fecha quando o tile esvazia
  (`Creature.checkCreatureInsideDoor` impede fechar com alguém dentro).
- **Machete** (`register_actions.lua:838`): capim da selva → `transform(itemid − 1)` e `decay()`
  (volta sozinho pelo `duration` do `items.xml`); wild growth → `remove()`.
- **Shovel**: stone pile → buraco aberto (`floorchange down`) que decai de volta; **rope**: rope spot
  → `teleportTo(toPosition:moveUpstairs())`, e puxa do buraco quem/o que está embaixo; **ladder** é
  usada; **pick** abre a rachadura (372 → 394).
- **Alavanca**: script por `aid`, alterna 2772 ↔ 2773 e faz o que o script mandar (abrir parede,
  porta, teleporte). **Baú**: `uid` + storage do jogador. **Placa**: atributo `text`, lido no Look.
- **Alcance**: `Actions::canUse` — mesmo andar e adjacente (`areInRange<1,1>`); `canUseFar` 7×5 com
  linha de visão é só para "usar com" à distância (runa).

Quatro coisas precisam de dono: onde mora o estado que muda (sem mutar o `Tilemap`), quem decide
"dá para pisar aqui agora" (movimento, BFS do follow, passo do monstro, `placeReachable`), como a
volta (`decay`) acontece sem tique (invariante 2), e como o cliente — que desenha a pilha a partir de
`things/` — descobre que a porta abriu sem o `content/` virar arte (invariante 6).

## Decisão

1. **O importador preserva os atributos e classifica o tile interativo como CONTEÚDO.**
   `tilemapSchema` ganha `interactables: [{ at: Point, kind, initialState, appearanceKey, aid?,
   uid?, text?, requires?: { tool?: 'machete'|'rope'|'shovel'|'pick'|'key', level?, storageKey?,
   keyId? }, links?: string[], revertMs?, target?: Point }]`, com `kind ∈ { door, locked-door,
   level-door, quest-door, grass, stone-pile, hole, rope-spot, ladder, lever, chest, sign,
   teleport }`. O reconhecimento é por **tabelas de ids do Canary transcritas como dado** em
   `packages/content/data/scenery/*.json` (as triplas de porta, `jungleGrass`, `holes`,
   `ropeSpots`, as escadas com `floorchange` do `items.xml`, o `duration` de cada estágio) — os
   mesmos números que o ADR 0025 já cruza à mão para escadas, agora gerados. O tile de uma porta
   fechada é `.` na grade de bloqueio (não mais `#`) e o interativo diz `blocking` por estado. A
   pilha de aparências continua em `things/`; o que muda por estado mora em
   `appearances.scenery[appearanceKey] = { closed: id, open: id }` (gerado, ao lado de
   `corpses`/`equippedItems`) — o `content/` sabe que existe uma porta, nunca qual sprite ela tem.

2. **`TileOverrides`: o estado que muda mora no ruleset, como `Fields`.** Um índice por sessão,
   chave numérica de tile (`fieldTileKey`), com `{ interactableId, state, blocked, floorChange:
   Point | null, revertAtMs? }`. `MovementWorld` ganha `blockedAt(x, y, z)` e `floorChangeAt(x, y,
   z)` que combinam `Tilemap` + overlay (+ os campos bloqueantes do ADR 0041 d.4, quando pousarem);
   `tileAdmits`, `canOccupy`, `placeReachable`, `route/pathfind.ts` e `monster/step.ts` deixam de
   chamar `isBlocked(map, …)` direto e perguntam ao mundo. **Uma função responde "dá para pisar aqui
   agora"** para humano, bot, monstro e follow — a regra do §17 da referência (a mesma razão para
   humano, bot e monstro) estendida ao cenário. Monstro não abre porta (Tibia), então porta fechada
   é parede para ele por construção. O overlay entra no snapshot (`tileOverrides?`, opcional, sem
   bump); `Tilemap` continua imutável e compartilhado.

3. **A volta é evento da fila; a porta fecha no `vacate`.** `TILE_REVERT` (prioridade
   `Housekeeping`, `subject = interactableId`) agendado em `revertMs` do conteúdo — o `duration` do
   `items.xml` do item transformado (capim cortado, buraco aberto), importado junto. Porta comum
   fecha quando o tile esvazia e ninguém está nele (`checkCreatureInsideDoor`), no mesmo `move()` que
   a libera; porta de level/quest além disso barra no passo de entrada de quem não cumpre o requisito
   (`closing_door`). Nada por tique (invariante 2): 1 Hz desanexada e 10 Hz anexada abrem e fecham nos
   mesmos instantes.

4. **A rota do bot atravessa tile usável: o walker usa e depois pisa.** `route:trace` e
   `validateRoute` aceitam um passo sobre interativo (a rota registra o tile da porta/capim, como já
   registra o degrau). `RouteWalker.step()` devolve `{ use: at }` quando o próximo tile está em
   estado bloqueante e o personagem pode usá-lo (ferramenta na mochila, level, storage); o ruleset
   executa `#useOnMap` e só então pisa — com a exaustão de ação do Canary quando a ferramenta a tem.
   Quando não pode (sem rope, sem level), o walker espera e o extrato registra `route-blocked` uma
   vez; não existe desvio (ADR 0009 continua). O passo guloso do FOLLOW e o BFS limitado (ADR 0009
   emenda) enxergam a porta fechada como parede — o seguidor atravessa quando o líder a abriu, o que é
   exatamente o comportamento do Tibia. É automação nossa (ADR 0037 d.2, invariante 11).

5. **Ferramenta é item, exigida e não consumida.** Machete já nasce no kit (ADR 0026 d.2); rope,
   shovel, pick e chaves entram pelo importador (#573) com `use.tool`. O bot e o `use-on-map` usam
   qualquer ferramenta compatível que esteja na mochila ou na mão — o Tibia exige que o jogador
   arraste a ferramenta no alvo; aqui o servidor escolhe a ferramenta sozinho quando o interativo a
   exige (conveniência registrada; `use-item-on { instanceId, position }` do ADR 0049 continua
   valendo para quem quer o gesto do Tibia). Não é suprimento abstrato: ferramenta não acaba, não
   tem preço por uso, e o modelo do ADR 0032 d.6 existe para o que se gasta.

6. **Escopo em três camadas.**
   - **T1 (entrega):** porta comum (abre/fecha/bloqueia; `locked-door` fica "It is locked"), capim
     + machete, stone pile + shovel → buraco (descer) + rope (subir), rope spot + rope, ladder,
     alavanca por `aid` com `links` declarados no conteúdo (alterna o estado dos interativos
     ligados — parede, porta), placa (`look`). Cobre os 3 rope spots da Rotworm Caves, as 2
     alavancas da Rat Cellars e as 2 stone piles de Thais.
   - **T2 (grupo 3 do plano):** porta de level (`aid − 1000`), porta de chave (chave é item com
     `aid`), porta de quest e baú com `uid` — exigem **storages por personagem**
     (`character_storage`, `storageKey → value`, aditiva; a semente do motor de quest que
     `docs/product/quests.md` ainda não tem). As 51 portas e os 59 baús de Thais são T2.
   - **T3:** teleporte (`ATTR_TELE_DEST`), placa de pressão, livro com `text`.

7. **Protocolo.** C2S `use-on-map { position, seq }` — usar o que está no tile (porta, alavanca,
   ladder, rope spot, capim, pile, baú, placa); o servidor confere adjacência no mesmo andar
   (`canUse`), estado, requisito e ferramenta. C2S `look { position | creatureId | instanceId }` →
   S2C `look-result { text }` — o "You see …" do Tibia, para placa, item e criatura (o texto vem do
   catálogo/conteúdo, nunca do cliente). S2C `tile-update { position, replace: [{ from, to }] }`
   com **ids de aparência** resolvidos pelo hospedeiro de `appearances.scenery` (invariante 6 no
   mesmo lugar em que `ground-item-appear` resolve `corpses`); o cliente troca o id na pilha do
   tile e redesenha. `session-state.world.tileUpdates[]` leva o overlay inteiro para quem
   reanexa. Recusas: `use-result` do ADR 0049, em palavras ("Only the worthy may pass.", "It is
   locked.", "You need a rope.").

8. **Cidade: o overlay é da cópia, sem relógio.** No shard (ADR 0023) o `TileOverrides` é
   compartilhado por todos da cópia — a porta que um abriu está aberta para todos, como no Tibia. A
   Cidade não agenda evento (`hz` 0, ADR 0004): interativo com `revertMs` é **recusado** lá ("nada
   decai na Cidade"), e o que resta são portas (fecham no `vacate`), alavancas, placas, ladder e —
   com T2 — chaves e baús. Na hunt instanciada tudo vale, com snapshot.

## Alternativas

- **Mutar o `Tilemap` da sessão (uma cópia por sessão).** Descartada: viola a letra do invariante 7
  (o mapa fixado é o compartilhado), multiplica memória por sessão (a Dragon Lair são 17.848 tiles ×
  3 andares) e mistura geometria autorada com estado transiente — o mesmo erro que `Fields` existe
  para evitar.
- **Estender `Fields` para portas e capim.** Descartada: campo tem condição, dono e sobreposição;
  porta tem estado discreto, requisito e ligação por `aid`. Compartilham a **pergunta** ("dá para
  pisar?"), não a estrutura — por isso a decisão 2 unifica a consulta e mantém os dois índices.
- **Servidor lê `items.xml`/flags em runtime para saber o que uma porta é.** Descartada pelo ADR
  0025 (o servidor não carrega pacote de arte) e pelo ADR 0038 (o importador escreve JSON gerado;
  runtime lê conteúdo).
- **Abstrair ferramenta como suprimento (gold por uso) ou dispensar ferramenta.** Descartada: o
  Tibia exige rope/shovel/machete e eles não acabam; abstrair seria inventar um preço que não
  existe, e dispensar seria divergência sem ganho — o kit já dá a machete.
- **Path-finding da rota em torno de porta fechada.** Descartada pelo ADR 0009: a rota é dado; o
  autor da rota decide se ela passa pela porta, e o walker usa a porta.
- **Client desenha o estado a partir de um id de conteúdo (`door: open`) resolvendo a arte
  localmente.** Descartada: o cliente já recebe ids de aparência em toda mensagem de mundo; um
  segundo vocabulário só para cenário duplicaria a tabela `appearances` no cliente.
- **T2 (storages) na entrega.** Descartada: storages é o começo do motor de quest — decisão de
  produto própria, com persistência nova; não bloqueia nenhuma das três hunts e nada do fluxo
  pedido.

## Consequências

- `scripts/otbm.ts` passa a devolver `aid`/`uid`/`text`/`teleport` por item; `import-map.ts` escreve
  `interactables` e `appearances/generated/scenery.json`; `pnpm map:import --check` cobre os dois.
- `packages/content`: schema novo no mapa, `data/scenery/canary-tables.json` (portas, capim,
  buracos, rope spots, escadas, durações), `itemSchema.use.tool`; `validateRoute` aceita interativo.
- `packages/sim`: `tile-overrides.ts` (puro, como `fields.ts`), `MovementWorld.blockedAt/
  floorChangeAt`, `RouteWalker` com `use`, `TILE_REVERT`, porta no `vacate`, `#useOnMap`; snapshot
  opcional, sem bump. `CityRuleset` ganha o subconjunto sem relógio.
- `packages/protocol`: `use-on-map`, `look` (C2S), `tile-update`, `look-result` (S2C),
  `session-state.world.tileUpdates`.
- `packages/server`: estado → aparência via `appearances.scenery`; `look` de item lê o catálogo.
- `packages/client`: `world-scene` aceita patch de pilha por tile; clique/contexto no tile manda
  `use-on-map`/`look`; sem nenhuma regra de cenário no cliente (invariante 4).
- Documentação: `docs/product/scenery.md` (novo), `hunt.md` (rota através de porta),
  `city.md` (overlay da cópia, sem decay), `items.md` (ferramentas), ADR 0025 e 0009 emendados.
- O que piora: mais um índice consultado por passo (O(1), mas por passo de cada criatura — medir
  em `pnpm bench:hunts`); e o conteúdo gerado do mapa cresce com os interativos (Thais: ~115
  entradas).

## Invariantes afetados

Nenhum muda de texto. **7** — o `Tilemap` continua imutável e fixado; o overlay é estado de sessão
derivado de conteúdo fixado na mesma versão. **6** — `content/` ganha `kind`/`appearanceKey`, nunca
id de sprite; a tabela `appearances.scenery` é quem sabe a arte. **2** — a volta é evento
(`TILE_REVERT`), a porta fecha no `vacate`, nada por tique. **4** — `use-on-map`/`look` são
intenções; alcance, requisito, ferramenta e estado são do servidor. **9** — o overlay é escrito só
pela sessão dona (na Cidade, a cópia). **11** — o walker usar porta e capim sozinho é a automação
legítima.
