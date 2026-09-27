# Cenário usável

**Status:** parcial — o importador **classifica** porta, capim, stone pile, rope spot, ladder,
alavanca, baú, placa e teleporte a partir do OTBM real (#727, ADR 0050 d.1); o mecanismo que muda
de estado por sessão (`TileOverrides`, #728, ADR 0050 d.2-d.5, d.8) existe para o T1 (porta comum,
capim, stone pile, alavanca); o JOGADOR já pode acionar isso e ver o resultado — `use-on-map`,
`look` e `tile-update` (#729, ADR 0050 d.7) — e não só o walker automático. **T3 entrou pela
#734**: teleporte de fato (pisar redireciona, gated por alavanca por `revertMs`) e placa de
pressão (step-in/step-out, com o mesmo `links`/cascade da alavanca) — ver "Teleporte e placa de
pressão (T3, #734)" abaixo. Livro com texto já estava resolvido pelo mecanismo genérico de `look`
do #729 (qualquer `kind` com `text` no conteúdo é lido — nenhum código novo precisou). Rope
spot/ladder como passo de andar, e T2 (porta de chave/level/quest, baú com storage) continuam em
aberto.
**PRD:** cenário e uso de item no mapa (não numerado no PRD original; nasceu do pedido "cenário,
itens usáveis do cenário como alavancas, portas, matos... tudo 100%")
**Épico:** E18 (Jogável ponta a ponta)
**Referência técnica:** ADR 0050 — overlay de estado de tile por sessão (PR #719, ainda não
mesclada nesta branch; `docs/adr/0050-session-tile-overrides-for-usable-scenery.md` em
`origin/docs/adr-0048-0051-playable`) —, que estende o
[ADR 0025](../adr/0025-real-map-from-otbm.md) (o mapa real vem de um OTBM)

## Comportamento

O importador (`pnpm map:import`) lê `aid`/`uid`/`text` de cada item do OTBM — antes descartados —
e classifica o tile em `tilemapSchema.interactables[]`: `kind` (o que é), `initialState` (o
estado no instante da importação), `appearanceKey` (a chave em `appearances.scenery` que resolve
o estado para um id de aparência), e, quando existem, `aid`/`uid`/`text`/`requires.tool`/
`revertMs`/`target`.

O reconhecimento vem de duas fontes:

- **Tabelas do Canary transcritas como DADO** (`packages/content/data/scenery/canary-tables.json`
  — `things/sources/canary`, ADR 0019: só números e pares de id, nunca o script): as triplas de
  porta de `doors.lua` (`KeyDoorTable`/`CustomDoorTable`/`QuestDoorTable`/`LevelDoorTable`), o
  capim (`jungleGrass` de `register_actions.lua`, com o `duration`/`decayTo` de `items.xml`), a
  stone pile (`holes` de `register_actions.lua`, idem), o rope spot (`ropeSpots`/
  `specialRopeSpots` de `global.lua`) e a ladder (`type="ladder"` de `items.xml`, transcrita à
  mão pelos ids observados). A alavanca é o par físico único do Tibia, `2772`↔`2773`.
- **Atributos do item**, quando nenhuma tabela casa: `uid` → baú; `text` → placa;
  `ATTR_TELE_DEST` → teleporte. `aid` sozinho NÃO classifica nada — só as tabelas decidem
  alavanca, porque um action id pode ser gatilho de quest sem ser cenário nenhum, e chutar seria
  falso positivo sobre o que ninguém revisou.

**O tile de um interativo nunca é `#` na grade de bloqueio**, mesmo fechado ou trancado — a troca
central do ADR 0050 decisão 1. Antes, uma porta comum fechada virava parede permanente porque o
importador derivava bloqueio das flags UMA vez; agora quem sabe "dá para pisar aqui agora?" é o
`TileOverrides` da sessão (`packages/sim/src/tile-overrides.ts`, #728): um overlay pequeno, por
tile, que combina com o `Tilemap` imutável em `MovementWorld.blockedAt`/`floorChangeAt` — nenhuma
cópia do mapa por sessão (invariante 7). Porta comum (T1) bloqueia **fechada** e o walker a abre
sozinho, sem ferramenta, quando ela está no caminho da rota (ADR 0050 d.4); capim e stone pile
bloqueiam **intactos**, exigem ferramenta (`use.tool` do item — hoje só um item de teste declara,
a machete/pá reais são a #573) e decaem sozinhos de volta em `revertMs` (evento `TILE_REVERT` na
fila, invariante 2 — nada por tique); a stone pile virada buraco desce um andar
(`floorChange`). Alavanca nunca bloqueia — o walker não a aciona sozinho, só o jogador, por
`HuntRuleset.useOnMap` (#729) —, mas já alterna `down`↔`up` e liga interativos por `aid`
(`links`) quando usada. Porta comum FECHA sozinha quando o tile esvazia e ninguém está nele
(`TileOccupancy.vacate` → `TileOverrides.closeDoorIfVacant`), nunca por prazo. O overlay entra no
snapshot (`HuntRulesetState.tileOverrides`, opcional, sem bump de `SNAPSHOT_FORMAT_VERSION`).
T2 (porta de chave/level/quest, baú) continua fora: sem requisito satisfazível (level/storage por
personagem), classificá-las como bloqueantes as prenderia para sempre — pior que hoje.

## O jogador usa e olha (#729, ADR 0050 d.7)

Antes desta issue, o único caminho para acionar um interativo era o WALKER automático, dentro do
passo da rota — o jogador não tinha como pedir o mesmo de propósito, e o cliente não desenhava a
mudança. `HuntRuleset.useOnMap(session, characterId, position)` (`packages/sim/src/rulesets/
hunt.ts`) é o caminho do jogador: confere alcance (`canUse` do Canary — mesmo andar, adjacente,
`|dx| <= 1` e `|dy| <= 1`) e delega para o MESMO `#useInteractable` que o walker usa, para as duas
portas nunca divergirem em requisito ou ferramenta. `HuntRuleset.look(position)` devolve o `text`
de uma placa, ou uma descrição padrão por `kind`, ou o texto genérico sem interativo nenhum ali —
sem conferir alcance (o AOI do servidor já limita o que a tela mostra).

No fio: C2S `use-on-map { position, seq? }` (27) e `look { position }` (28); S2C `tile-update
{ position, replace: [{ from, to }] }` (38, BROADCAST para todos os viewers da sessão — cenário é
compartilhado, não por personagem) e `look-result { text }` (39, só para quem pediu).
`session-state.world.tileUpdates[]` leva o overlay INTEIRO (todo interativo cujo estado difere do
inicial do conteúdo) para quem reanexa, no mesmo contrato de `tile-update` — o servidor resolve os
dois lados (`from`/`to`) pela tabela `appearances.scenery`, nunca inventando substituição sem os
dois ids resolvidos (conteúdo em versão divergente vira SEM mensagem, não erro).

No cliente: clique/duplo-clique num tile manda `use-on-map`, andando até lá primeiro se não
estiver adjacente (o mesmo padrão de `corpse-approach.ts`, #722/#749 — `shell/tile-approach.ts`,
`world/tile-approach.ts`); clique direito manda `look`, sem aproximação. `state/world.ts` guarda o
overlay ativo (`tileOverrides`, por `"x,y,z"`) como um overlay DINÂMICO sobre a pilha estática de
`things/` — a mesma forma de `groundItems`/`groundItemsVersion` para os cadáveres —, e
`world/viewport.ts` aplica o `replace` no próprio pintor de tile, sem esperar `session-state`.

Recusas de `use-on-map` (`system-message`, em português, seguindo a convenção já em vigor no
`host.ts` — não o inglês que o ADR 0050 cita como referência do Tibia): fora de alcance, nada ali,
`kind` fora do T1 (`locked-door`/`chest`/`sign`/… — a mesma decisão de `isToggleable`, "não
invente" requisito que o T2/T3 ainda não tem) e ferramenta ausente (o catálogo real não tem NENHUM
item com `use.tool` até a #573 — a recusa é sempre `missing-tool` até lá).

`appearances.scenery` — gerado em `data/appearances/generated/scenery.json`, nunca à mão — guarda
só as `appearanceKey` que algum mapa importado realmente usa (não a tabela do Canary inteira, que
tem centenas de portas fora dos quatro recortes do Draconya e fora do inventário do pacote
conferido).

## Teleporte e placa de pressão (T3, #734, ADR 0050 d.6)

**Teleporte é pisar, não clicar.** `MovementWorld.teleportAt`/`move()` (`packages/sim/src/
movement.ts`) tratam o teleporte como uma escada de destino arbitrário: o passo para o tile do
teleporte é legal por si só (o tile nunca bloqueia), e SÓ ENTÃO, se o `target` do conteúdo resolve
para um tile alcançável (dentro do mapa, sem parede, sem ninguém — `tileAdmits`), a criatura é
redirecionada no MESMO passo — o cliente nunca a vê parada em cima do teleporte. Sem destino
alcançável, ela simplesmente FICA no tile do teleporte, sem erro nenhum: a mesma degradação de
`Teleport::addThing` do Canary para `destPos` inválido ou tile de destino ausente (things/sources/
canary, ADR 0019 — só o mecanismo, nunca o script). `useOnMap` recusa `not-usable` num teleporte —
ele reage só a pisar.

Um teleporte pode ser **gated por alavanca** ("abrir teleporte por N s", o pedido original da
#734): `initialState: 'closed'` mais `links` de uma alavanca fazem `HuntRuleset.useOnMap` da
alavanca ligar o MESMO `#useInteractable`/cascade que já liga uma porta linkada — sem código novo
por `kind` —, e `revertMs` no teleporte agenda o fechamento sozinho pelo `TILE_REVERT` de sempre
(capim/stone pile). "Remover parede" do mesmo pedido já estava coberto: uma alavanca ligando um
`door` é exatamente isso, sem mecanismo adicional.

**Placa de pressão** (`kind: 'pressure-plate'`, novo neste schema — sem tabela do Canary
correspondente nos quatro recortes; é conteúdo AUTORADO à mão, como `floorChanges`/`entryPoint`)
reage a step-in/step-out pelo MESMO choke point de movimento que a rota do bot usa
(`HuntRuleset#step`, "o único lugar que escreve posição"): pisar pressiona (`up`→`down`) e solta
ao sair (`down`→`up`), com o MESMO `links`/`TILE_REVERT` da alavanca — vale para jogador E monstro
(`character` é `null` no `#useInteractable` de um monstro; ferramenta exigida simplesmente nunca
casa, e nenhum conteúdo real declara uma). Nunca bloqueia, em nenhum dos dois estados. `useOnMap`
recusa `not-usable` — placa reage só a pisar, nunca a clique. **Limite aceito:** o release só
dispara pelo passo NORMAL de saída; uma criatura removida do tile por outro caminho (morte, saída
da sessão) não solta a placa sozinha — content que precise da garantia declara `revertMs` na
própria placa como rede de segurança. Nenhum dos quatro mapas usa placa hoje.

**`tile-update` passivo** (#734): antes desta issue, só `useOnMap` explícito broadcastava
`tile-update` — o walker abrindo porta/capim sozinho (#728), o `TILE_REVERT` do capim/stone
pile/teleporte-gated e a placa de pressão nunca tinham mensagem nenhuma além do resync completo
de `session-attach`. `HuntRuleset.tileOverrideAppearances` (leitura de TODO interativo, não só
quem difere do `initialState` como `tileAppearanceChanges`) mais `HostedSession.
sentTileOverrides`/`#presentTileOverrides` (`packages/server/src/game/host.ts`) fecham essa
lacuna a cada ciclo com visualizador — o mesmo mecanismo de `sentBestiary`/`sentStats`.

**Os quatro teleportes de Thais (#727) nunca redirecionam hoje.** `target` só entra em
`interactables[]` quando cai DENTRO do recorte importado (`scripts/import-map.ts`, convertido
para coordenada local, como `at`); os quatro de Thais apontam para fora dele (dois com `destPos`
(0,0,0) — o "inválido" do próprio Canary — e dois para outra área nunca trazida para este corte),
então nenhum tem `target` no conteúdo versionado. Comportamento correto e esperado, não um defeito
desta issue: pisar neles simplesmente não faz nada, como o Canary faz para um `destPos` sem tile.

## Os quatro mapas (medido em 2026-09-27, pacote 1533, `otservbr.otbm` v3.6.1)

| Mapa | Interativos | Contagem por `kind` |
|---|---|---|
| Thais | 421 | `door` 196, `locked-door` 84, `sign` 127, `teleport` 4, `quest-door` 3, `chest` 3, `stone-pile` 2, `lever` 2 |
| Rat Cellars | 20 | `sign` 14, `locked-door` 2, `lever` 2, `quest-door` 1, `chest` 1 |
| Rotworm Caves | 3 | `rope-spot` 3 |
| Darashia Dragon Lair | 0 | — |

Zero aparência desconhecida no pacote nos quatro recortes.

`[ABERTO — a spec original estimava por inspeção visual "51 portas de chave" e "59 baús" em
Thais; a medida contra o OTBM real deu 84 `locked-door` e 3 `chest`]` — a diferença mais provável
é que a maioria dos baús de Thais é loot comum, sem `uid` nenhum (só o baú com storage de
personagem carrega `uid`, e é isso que o importador classifica como `chest`); as portas de chave
contam TODAS as três formas do estado (`locked`/`closed`/`open`) como um `locked-door` só — 84 é o
número de TILES com essa classificação, não de portas fisicamente distintas.

## Casos de borda

- **Porta comum (`door`) sem par completo.** `CustomDoorTable` do Canary tem `closedDoor` sem
  `openDoor` correspondente em alguns pares comentados (conflito de id documentado no próprio
  `doors.lua`) — o importador os EXCLUI da tabela transcrita, e um tile com esse id vira scenery
  não classificado (não aparece em `interactables`, e a grade decide o bloqueio pelas flags do
  pacote, como antes).
- **Alavanca sem `aid`.** Um item `2772`/`2773` sem action id ainda classifica como `lever` —
  `aid` é OPCIONAL no schema; sem ele, a #728 não saberá o que a alavanca liga, mas a
  classificação em si não depende disso.
- **Chest/sign/teleport que só existem observados.** Ao contrário de porta/capim/pile/rope
  spot/ladder/lever (a tabela do Canary já fecha os dois lados), `appearances.scenery` só ganha
  uma entrada para esses três quando ALGUM mapa importado carrega o id — reimportar um mapa que
  não usa mais mesmo id não some com a entrada de OUTRO mapa que ainda usa (o merge é aditivo,
  por `pnpm map:import`).

## Em aberto

- `[ABERTO]` T2 (porta de chave/level/quest, baú com storage) precisa do motor de storage por
  personagem, que `docs/product/quests.md` ainda não tem — ADR 0050 grupo 3.
- ~~`[ABERTO]` T3 (teleporte de fato, placa de pressão, livro com texto por página) — ADR 0050,
  escopo três camadas.~~ → **Resolvido (#734):** ver "Teleporte e placa de pressão (T3, #734)"
  acima. Livro já estava coberto pelo `look` genérico do #729. Nenhum dos quatro mapas tem placa
  de pressão real, e nenhum dos quatro teleportes de Thais tem destino dentro do recorte
  importado — o mecanismo é validado por teste, não por conteúdo real ainda.
- `[ABERTO]` Livro com PÁGINAS (mais de um `text`, navegação entre elas) — a #734 confirmou que o
  esquema atual (um `text` por interativo) cobre placa e livro de página única; um livro com mais
  de uma página exigiria um campo novo (`pages: string[]`) e um protocolo de "virar página" que
  nenhum dos quatro mapas precisa hoje.
- `[ABERTO]` Rope spot e ladder como passo de andar (o walker atravessando, `floorChange` por
  `use`) — o plano original das W8-W10 os lista no T1, mas o pedido desta issue (#728) restringiu
  o escopo a porta/capim/stone-pile/alavanca; ficou para uma issue de acompanhamento.
- ~~`[ABERTO]` `use-on-map`/`look`/`tile-update` (protocolo e cliente) — #729.~~ → **Resolvido
  (#729):** ver "O jogador usa e olha" acima. `look` cobre só posição (placa/descrição de
  `kind`) — `creatureId`/`instanceId` do ADR 0050 d.7 ficam para quando o menu de contexto de
  criatura/item existir (sem gatilho de UI hoje).
