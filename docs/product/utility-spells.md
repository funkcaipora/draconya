# Magias utilitárias

**Status:** implementado, com as aproximações do mapa listadas em "Divergências" (#623, M44-05,
[ADR 0037](../adr/0037-tfs-canary-fidelity-except-action-bar-and-automation.md) — o Canary `main`
manda em magia).
**PRD:** M44 · Periféricos do Tibia (`docs/endgame-plan.md` §2.7 e §3, "#623 — Utilitárias")
**Épico:** E2 · Combate e progressão base

## Comportamento

São as magias do grupo `support` do Canary que não dão dano nem cura: Light, Great Light e
Ultimate Light, Levitate (subir e descer), Magic Rope, Find Person, Find Fiend e Food. Todas saem
pelo mesmo caminho das demais — `castSpell` (`packages/sim/src/casting.ts`) paga a mana, a alma e
o cooldown, e o `HuntRuleset#castSpell` aplica o efeito —, do bot ou do disparo manual (`use-slot`).

- **Luz (Light, Great Light, Ultimate Light).** Uma condição `light` de APRESENTAÇÃO no
  lançador: o `sim` a guarda com nível, cor e prazo total, vence a condição na fila
  (`CONDITION_EXPIRE`) e mais nada — nenhuma regra de jogo a lê (o resultado da hunt é o mesmo com
  e sem luz, teste em `rulesets/utility-spells.test.ts`). O cliente ajusta a escuridão: o
  `active-conditions` leva `light: { level, color, durationMs }` e o pintor clareia o `ambience:
  'cavern'` na proporção do nível de AGORA (`packages/client/src/world/light.ts`). O raio decai 1 a
  cada `durationMs / level`, como o `ConditionLight` do Canary; o nível de agora é `ceil(level ×
  restante / total)`, conta local do cliente. Recastar segue o `Condition::updateCondition`: uma luz
  de prazo MAIS CURTO não substitui a que ainda dura mais (a mana é gasta), prazo igual ou maior
  renova por inteiro.
- **Levitate.** Sobe ou desce UM andar para o tile da FRENTE do lançador (a direção que ele
  encara), pelas regras de `levitateDestination` (`packages/sim/src/utility-spells.ts`):
  fronteira de andar (`up` recusa em z=8, `down` em z=7); tile-sonda vazio (em CIMA do lançador no
  `up`, à FRENTE no `down`); pouso com chão, sem bloqueio e sem escada. O parâmetro de texto do
  Canary (`exani hur up`/`down`) viraram DUAS magias do catálogo, `levitate-up` e `levitate-down`
  — a barra de ações é do Draconya (ADR 0037 d.2) e dois ids dão o mesmo resultado. Recusa sem
  custo e sem cooldown (`not-possible`).
- **Magic Rope.** Quem está sobre um rope spot (`interactables` `kind: 'rope-spot'`, ADR 0050
  d.1) sobe um andar pela `Position:moveUpstairs`: o tile ao SUL do rope spot no andar de cima; se
  ele não for andável, o primeiro andável de norte, leste, oeste, sudoeste, sudeste, noroeste e
  nordeste (o `WEST` do script é tentado duas vezes — inócuo). Tile ocupado por outra criatura é
  PULADO, como inandável (ver "Divergências": tile é exclusivo). Fora de um rope spot:
  `not-possible`; sem onde pousar (nenhum andável livre): `not-enough-room`; nos dois casos sem
  custo — a pré-conferência e o salto escolhem o MESMO destino, então o que a magia aprova ela
  aplica, e o salto recusado depois de pagar é erro de programação (falha alto).
- **Find Person.** Diz distância e direção de um personagem da sessão. O NOME do Canary é o
  personagem que o jogador MIRA no `use-slot` (o catálogo publica `aim: 'character'` só para ela —
  campo SEPARADO de `targets`, que também abriria o seletor de alvo do editor de slot do bot, e a
  validação do bot recusa alvo que não seja de cura/mana —, e a barra de ação arma a mira);
  qualquer outra mira, ou nenhuma, é `person-not-found` ("A player with this name is not online"),
  que no Canary é a recusa de `InstantSpell::playerCastInstant` e **inicia o cooldown da magia e o
  do grupo `support`** (2 s), sem mana nem alma. O `sim` emite o evento `find-result` com a relação em DADO
  (`distance`, `level`, `direction` — a bússola inteira do `find_person.lua`, tangentes 0,4142 e
  2,4142, faixas 5/101/275) e o host escreve a frase em português como `system-message` só para
  quem lançou (`packages/server/src/game/find-text.ts`).
- **Find Fiend.** A mesma bússola aplicada ao monstro fiendish mais próximo. O monstro fiendish é
  do Exaltation Forge, que o dono deixou fora por ora (2026-09-29): nenhum monstro é fiendish, e o
  Canary sem fiendish devolve "No creatures around" — a magia recusa (`no-creatures-around`) sem
  custo. Quando o Forge pousar, `HuntRuleset#utilityRefusalOf` é o único ponto a ligar; a parte da
  mensagem que depende dele (a dificuldade pelo Bestiário e o tempo até a troca do monstro) entra
  com ele.
- **Food.** Cria comida na mochila, como o `food.lua`: um `math.random(0, 1) == 1` decide um
  segundo item, e cada item é sorteado uniforme da lista de sete comidas, NA ORDEM do script (o
  índice do sorteio é a posição). A ordem de consumo do `Rng` é bônus, [índice do extra], índice
  do garantido (`rollFoods`). Cria ITEM — quem o come soma `fedMs` (`use-item`, ADR 0049 d.5), não
  a magia. O item nasce com `instanceId` da sessão e atravessa o extrato como qualquer item
  adquirido (invariante 10); o `equipment-changed` reenvia o inventário.
- **Disintegrate Rune.** Sem efeito e FORA do catálogo de suprimentos: o `desintegrate_rune.lua`
  só remove item movível do chão (não-cadáver) e sempre termina com "Sorry, not possible", e neste
  jogo não há item no chão além do cadáver, que é só visual (ADR 0048 d.8). Uma runa que gasta gold
  e nunca faz nada só poluiria o catálogo do bot; ela entra junto do primeiro item de chão. Registrado
  aqui a pedido da issue.

**O salto (Levitate e Magic Rope)** é o `HuntRuleset#relocateCharacter` — o outro único ponto, ao
lado de `#step`, que escreve posição (`movement.ts#relocate`): libera a origem, ocupa o destino,
emite `creature-moved`, aplica campo e placa de pressão, e aplica a condição `pacified` (a trava de ataque
do stairhop, #622) por `stairhopDelayMs` sob o `combat-v3` (o `Player::onCreatureMove` do Canary trata `teleport || oldPos.z != newPos.z` do
mesmo jeito para escada, magia e teleporte). NÃO vira o personagem: o Canary não passa direção. O
salto também CANCELA a caminhada manual em curso (`walk-to`, #763) e a janela de espera dela — o
`stopEventWalk()` que o `Creature::onCreatureMove` chama nesses mesmos casos —; sem isso o
`path[0]` do andar antigo era tentado para sempre e a hunt idle congelava.

**A ordem das recusas** é a do Canary (`Spell::playerSpellCheck`, depois o nome e o script):
cooldown e grupo, level, mana, alma — e só então o destino/alvo, ANTES de pagar. São DUAS famílias
de recusa, com custo diferente:

- **O script recusa** (Levitate sem destino, Magic Rope fora do rope spot ou sem onde pousar, Find
  Fiend sem fiendish): não gasta mana e NÃO inicia cooldown — o `postCastSpell` só roda com `true`.
- **O nome não acha ninguém** (Find Person: `hasPlayerNameParam` → `getPlayerByNameWildcard`, em
  `InstantSpell::playerCastInstant`): também não gasta mana nem alma, mas roda
  `applyCooldownConditions` ANTES de cancelar — o cooldown da magia e o do grupo `support` correm
  (Light, Haste e Levitate travam 2 s). O `if not target` do `find_person.lua` é inalcançável,
  porque o `playerCastInstant` já resolveu o jogador. No `sim` é `castSpell` quem inicia os livros
  nesse caso (`preflight === 'person-not-found'`).

## Regras

- A condição `light` mora em `ConditionState.light` (`packages/sim/src/conditions.ts`), opcional e
  sem bump de `SNAPSHOT_FORMAT_VERSION`; atravessa o snapshot (teste de restore em
  `rulesets/utility-spells.test.ts`).
- O `active-conditions` filtra por `ACTIVE_CONDITION_KINDS` (`packages/protocol`): `light` entrou
  no vocabulário, e a luz sem os dados de desenho NÃO vira badge. A luz aparece na `BuffBar` como
  "Luz" e no mundo só clareia o `cavern` — na superfície não há escuridão a clarear, como no Tibia
  de dia.
- Levitate e Magic Rope pedem o cast do JOGADOR: a rota do bot não usa nenhuma das duas, e um
  personagem que salta de andar sai da rota (o walker o reconduz como a qualquer deslocado).
- Find Person e Find Fiend só falam com o lançador; o alvo não fica sabendo que foi procurado.
- Na Cidade, todas recusam `not-in-catalog` (a Cidade só aceita conjuração, ADR 0049 d.8).

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora |
|---|---|---|
| Light | level 8, mana 20, luz 6/cor 215, 370 s | `packages/content/data/spells/light.json` |
| Great Light | level 13, mana 60, luz 8/cor 215, 695 s | `great-light.json` |
| Ultimate Light | level 26, mana 140, luz 8/cor 215 (8 no Canary; o TFS usa 9), 1990 s; druid e sorcerer | `ultimate-light-druid.json`, `ultimate-light-sorcerer.json` |
| Levitate | level 12, mana 50; `up` e `down` | `levitate-up.json`, `levitate-down.json` |
| Magic Rope | level 9, mana 20 | `magic-rope.json` |
| Find Person | level 8, mana 20 | `find-person.json` |
| Find Fiend | level 25, mana 20 | `find-fiend.json` |
| Food | level 14, mana 120, alma 1; druid; sete comidas | `food.json` |
| Comidas (`durationMs` = valor × 12 s) | meat 180 s, ham 360 s, grapes 108 s, red apple 72 s, bread 120 s, roll 36 s, cheese 108 s | `packages/content/data/items/{meat,ham,grapes,red-apple,bread,roll,cheese}.json` |
| Cooldown e grupo | 2000 ms, grupo `support` de 2000 ms — todas | cada `data/spells/*.json` |
| Bússola do Find | ao lado < 5, perto < 101, longe < 275; tangentes 0,4142 e 2,4142 | `packages/sim/src/utility-spells.ts` (mecanismo do `find_person.lua`, não balanceamento) |
| Fronteira de andar do Levitate | up recusa em z=8, down recusa em z=7 | `packages/sim/src/utility-spells.ts` |

## Divergências

Onde o Draconya não é o Canary, e por quê. Nenhuma é regra de caça (ADR 0037 d.6): são o
modelo de mapa, a estrutura de sessão ou o escopo que o dono fixou.

- **O `Tilemap` não separa "sem chão" de "parede".** Um bit por tile e andar (`#` = parede OU tile
  inexistente). O Levitate, que no Canary confere `Tile:getGround()`, `TILESTATE_BLOCKSOLID`,
  `TILESTATE_IMMOVABLEBLOCKSOLID` e `TILESTATE_FLOORCHANGE`, trata tile bloqueado ou fora do mapa
  como "vazio": uma parede COM chão na sonda deixa passar o que o Canary recusa, e o pouso com
  `FLOORCHANGE` só é reconhecido para escada listada do mapa e buraco do overlay. O Magic Rope
  usa `!blockedAt && !blocksSight` como o `isWalkable(..., proj)`, e sem nenhum vizinho andável
  recusa em vez de teleportar para um tile que talvez nem exista (o Canary gasta a mana). `[ABERTO]`
  — a correção é uma camada `ground` no importador (`scripts/import-map.ts`), que só se regera com o
  pacote de arte 1533 na máquina (`pnpm map:import --check` pula sem ele).
- **Tile é exclusivo neste motor.** O `FLAG_IGNOREBLOCKCREATURE` do Levitate deixaria o jogador
  pousar em cima de outra criatura; aqui o destino ocupado recusa. O mesmo vale para o Magic Rope:
  o `moveUpstairs` ignora criatura e o `internalTeleport` pousa com `FLAG_NOLIMIT` (empilharia o
  lançador no ocupante), e aqui o tile ocupado é pulado na ordem do `moveUpstairs` — sem nenhum
  livre, `not-enough-room` antes de pagar. É a estrutura de `TileOccupancy`, não uma regra escrita
  para estas magias. A ocupação é remontada na entrada do cast (`#occupancyStale`), para o
  `use-slot` que chega entre a retomada de um snapshot e o primeiro evento ver a ocupação real.
- **O Magic Rope hoje não sobe em nenhum rope spot do catálogo.** Os três da Rotworm Caves estão no
  andar 8 e o recorte só tem o 8 — o andar de cima não existe no mapa, então a magia reconhece o rope
  spot e recusa `not-enough-room` (teste com o conteúdo real em `utility-spells-real.test.ts`).
  Ganha pouso de verdade quando o recorte incluir o z=7. O uso da CORDA (item, ADR 0050) como passo
  de andar continua em aberto e é assunto do cenário, não desta magia.
- **Find Person só acha quem está na sessão.** A hunt hospeda os personagens da própria sessão
  (invariante 8); o `Player(name)` do Canary acha qualquer um online. Procurar a si mesmo não é
  oferecido. Find Fiend: ver acima (Forge).
- **Food larga no chão o que não cabe** no Canary (`canDropOnMap`); aqui não há item no chão além do
  cadáver, e o que não coube por peso SE PERDE, registrado como `food-not-carried` no extrato (o cliente o escreve em palavras, "Comida perdida, sem espaço", em `shell/event-text.ts`).
- **Premium.** `isPremium(true)` de Ultimate Light, Levitate e Magic Rope não é modelado — nenhuma
  magia do catálogo o modela (o mesmo que as de party e as de conjuração).
- **Rooted.** O `internalMoveCreature` do Canary recusa o Levitate de quem está `CONDITION_ROOTED`; a
  condição é a #622 e ainda não existe. Quando pousar, `#utilityRefusalOf` passa a recusá-lo.

## Em aberto

- `[ABERTO]` A camada `ground` do mapa (acima) e o z=7 no recorte da Rotworm Caves, para o Magic
  Rope subir de verdade.
- `[ABERTO]` Find Fiend completo — depende do Exaltation Forge (#616/#617), fora do escopo atual.
- `[ABERTO]` O tint do cliente é uma aproximação (clareia o `cavern` inteiro na proporção do nível);
  o Tibia abre um círculo de luz em volta do jogador. A camada de luz por tile já existe no explorador
  do mundo (`WorldLightLayer`) e é o caminho se a apresentação da hunt pedir o mesmo.
