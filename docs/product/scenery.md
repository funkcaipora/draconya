# Cenário usável

**Status:** parcial — o importador **classifica** porta, capim, stone pile, rope spot, ladder,
alavanca, baú, placa e teleporte a partir do OTBM real (#727, ADR 0050 d.1); o mecanismo que muda
de estado por sessão (`TileOverrides`, #728, ADR 0050 d.2-d.5, d.8) existe para o T1 (porta comum,
capim, stone pile, alavanca) e para a METADE do T2 — porta de level e porta de chave (#732, ADR
0050 d.6); o JOGADOR já pode acionar isso e ver o resultado — `use-on-map`, `look` e `tile-update`
(#729, ADR 0050 d.7) — e não só o walker automático. Rope spot/ladder como passo de andar, e o
resto do T2/T3 (porta de quest, baú com storage, teleporte, placa de pressão) continuam em aberto.
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

**Porta de level e porta de chave (T2, #732, ADR 0050 d.6).** As duas usam o MESMO
`#useInteractable`/`useOnMap` do T1 — nenhuma bifurcação por `kind`. A de level bloqueia
**fechada** e confere `character.level >= requires.level` no MOMENTO de usar (o `player:getLevel()
>= item.actionid - 1000` de `level_door.lua`); insuficiente recusa `level-too-low`, sem tocar o
overlay. A de chave nasce **trancada** — bloqueia em `locked` E `closed` — e só sai de `locked`
DIRETO para `open` (nunca passa por `closed`, como `key_door.lua`) com uma chave cujo
`use.keyId` bate com o `requires.keyId` do conteúdo; sem ela, `missing-tool` (a mesma recusa da
ferramenta comum — uma chave É uma ferramenta, `use.tool: 'key'`). Destrancada, ela alterna
`closed`↔`open` livremente, sem chave nenhuma — o key_door.lua do Canary só confere a chave
contra o estado TRANCADO, nunca contra os outros dois. As duas fecham sozinhas ao esvaziar
(`TileOverrides.closeDoorIfVacant`), como a porta comum — sem prazo próprio. Porta de quest e
baú com storage (o resto do T2) continuam fora: sem storage por personagem satisfazível ainda
para elas na hunt (`character-storage.ts`, #731, existe mas nenhum conteúdo usa `storageKey` de
porta ainda), classificá-las como bloqueantes as prenderia para sempre — pior que hoje.

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
`kind` fora do T1/T2 (`quest-door`/`chest`/`sign`/… — a mesma decisão de `isToggleable`, "não
invente" requisito que o T3 ainda não tem), level insuficiente numa porta de level
(`level-too-low`, #732) e ferramenta ausente (`missing-tool`) — inclusive a chave certa de uma
porta trancada: o catálogo real não tem NENHUM item com `use.tool` até a #573/#754 (paralela,
catálogo de itens do Canary) landing, então toda porta de chave real recusa por essa razão hoje.

`appearances.scenery` — gerado em `data/appearances/generated/scenery.json`, nunca à mão — guarda
só as `appearanceKey` que algum mapa importado realmente usa (não a tabela do Canary inteira, que
tem centenas de portas fora dos quatro recortes do Draconya e fora do inventário do pacote
conferido).

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

- ~~`[ABERTO]` T2: porta de level e porta de chave.~~ → **Resolvido (#732):** ver "Porta de level
  e porta de chave" acima. Nenhum dos quatro mapas importados tem hoje uma `level-door` (zero
  instâncias nos quatro recortes) nem um `locked-door` com `aid` (as 84 de Thais e as 2 de Rat
  Cellars nasceram sem `ATTR_ACTION_ID` no OTBM — provavelmente portas de casa, cujo mecanismo
  real do Tibia é posse de casa, não chave de catálogo) — o mecanismo está coberto por teste
  sintético (ADR 0019), mas nenhum mapa real o exercita ainda. O importador (`scripts/scenery.ts`/
  `scripts/import-map.ts`) também não foi estendido para preencher `requires.level`/
  `requires.tool: 'key'`/`requires.keyId` automaticamente: regenerar os mapas exigiria o OTBM de
  origem (`otservbr.otbm`, conferido pelo `sha256` do `source`), que não está neste checkout —
  fica para quando um recorte novo com portas desse tipo for importado, ou como issue própria de
  wiring do importador.
- `[ABERTO]` Porta de quest e baú com `uid` (o resto do T2) — ADR 0050 grupo 3, #733.
- `[ABERTO]` T3 (teleporte de fato, placa de pressão, livro com texto por página) — ADR 0050,
  escopo três camadas.
- `[ABERTO]` Rope spot e ladder como passo de andar (o walker atravessando, `floorChange` por
  `use`) — o plano original das W8-W10 os lista no T1, mas o pedido desta issue (#728) restringiu
  o escopo a porta/capim/stone-pile/alavanca; ficou para uma issue de acompanhamento.
- ~~`[ABERTO]` `use-on-map`/`look`/`tile-update` (protocolo e cliente) — #729.~~ → **Resolvido
  (#729):** ver "O jogador usa e olha" acima. `look` cobre só posição (placa/descrição de
  `kind`) — `creatureId`/`instanceId` do ADR 0050 d.7 ficam para quando o menu de contexto de
  criatura/item existir (sem gatilho de UI hoje).
