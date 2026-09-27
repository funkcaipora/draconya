# Cenário usável

**Status:** parcial — o importador **classifica** porta, capim, stone pile, rope spot, ladder,
alavanca, baú, placa e teleporte a partir do OTBM real (#727, ADR 0050 d.1); o mecanismo que muda
de estado por sessão (`TileOverrides`, abrir/fechar, cortar/crescer, o walker usando e pisando) é
a #728, que ainda não existe — hoje o `sim` não lê `interactables` nenhum.
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
interativo, e essa pergunta só ganha resposta de verdade quando a #728 (`TileOverrides`) existir.
Até lá, o comportamento observável é: **nenhum interativo bloqueia**, nem os T2 (porta de chave,
de level, de quest) que ainda não têm mecanismo de destrancar. É a troca deliberada — a
alternativa (manter `#` para sempre) prendia o bot atrás de toda porta de Thais sem meio de abrir
nenhum dia.

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

- `[ABERTO]` T2 (porta de chave/level/quest, baú com storage) precisa do motor de storage por
  personagem, que `docs/product/quests.md` ainda não tem — ADR 0050 grupo 3.
- `[ABERTO]` T3 (teleporte de fato, placa de pressão, livro com texto por página) — ADR 0050,
  escopo três camadas.
- `[ABERTO]` O mecanismo (`TileOverrides`, abrir/fechar, walker usando e pisando) é a #728.
