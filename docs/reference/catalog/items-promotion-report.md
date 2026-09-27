# Relatório de promoção — items (#748)

Separa `packages/content/staging/items/generated/*.json` (a transcrição pura do Canary, #573/#574) em `data/items/generated/` + `data/appearances/baseline.json.items` — o mesmo movimento que `promote-monsters.ts` (#580) já fez para monstro. Duas exclusões, cada uma contada: id que colide com item AUTORAL (o autoral vence, ADR 0014) e `appearanceId` fora do inventário do pacote de assets conferido (FUN-21).

1895 item(ns) promovido(s) em 10 fatia(s):

- `amulets.json`: 85
- `armors.json`: 159
- `boots.json`: 59
- `creature-products.json`: 626
- `helmets.json`: 124
- `legs.json`: 61
- `rings.json`: 41
- `shields.json`: 111
- `valuables.json`: 162
- `weapons.json`: 467

## Excluídos por colisão com item autoral (59)

| id | motivo |
|---|---|
| boots-of-haste | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| bow | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| broadsword | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| crossbow | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| crown-legs | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| crusader-helmet | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| double-axe | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| dragon-hammer | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| dragon-necklace | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| dragon-scale-mail | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| dragon-shield | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| dragon-slayer | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| dragonbone-staff | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| energy-ring | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| fire-sword | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| focus-cape | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| glacier-amulet | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| green-dragon-leather | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| green-dragon-scale | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| hailstorm-rod | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| hat-of-the-mad | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| knight-legs | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| leather-armor | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| leather-boots | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| leather-helmet | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| leather-legs | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| legion-helmet | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| life-ring | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| longsword | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| mace | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| machete | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| magic-plate-armor | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| mastermind-shield | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| might-ring | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| mystic-blade | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| paladin-armor | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| plate-legs | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| red-dragon-leather | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| red-dragon-scale | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| royal-crossbow | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| royal-helmet | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| serpent-sword | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| small-diamond | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| small-sapphire | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| snakebite-rod | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| spellbook-of-mind-control | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| spike-sword | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| steel-axe | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| steel-helmet | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| steel-shield | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| strange-helmet | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| sword | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| tower-shield | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| wand-of-inferno | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| wand-of-starstorm | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| wand-of-vortex | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| wooden-shield | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| worm | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
| zaoan-legs | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |

## Excluídos por aparência fora do pacote (0)

Nenhum.

## Excluídos por regra de conteúdo (0)

A mesma conferência que `buildContent` (`content.ts`) faria no boot — item de decoração/quest com `defense` residual do Canary fora de `kind: shield`, arma sem `slot` (a maioria das armas do Canary não declara `<attribute key="slot" value="hand">`) que também carrega `imbuementslot`, e arma de distância sem `ammoFamily` reconhecida. A linha inteira é excluída — nunca escrita quebrada, e nunca corrigida em silêncio.

Nenhum.
