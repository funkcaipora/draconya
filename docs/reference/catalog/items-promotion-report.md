# Relatório de promoção — items (#748)

Separa `packages/content/staging/items/generated/*.json` (a transcrição pura do Canary, #573/#574) em `data/items/generated/` + `data/appearances/baseline.json.items` — o mesmo movimento que `promote-monsters.ts` (#580) já fez para monstro. Exclusões, cada uma contada: id que colide com item AUTORAL (o autoral vence, ADR 0014), `appearanceId` fora do inventário do pacote de assets conferido (FUN-21), regra de conteúdo que `buildContent` reprovaria no boot, e item exclusivo da vocação Monk (fora do escopo do Draconya).

1879 item(ns) promovido(s) em 11 fatia(s):

- `amulets.json`: 81
- `armors.json`: 140
- `boots.json`: 53
- `creature-products.json`: 626
- `exercise-weapons.json`: 21
- `helmets.json`: 117
- `legs.json`: 53
- `rings.json`: 38
- `shields.json`: 111
- `valuables.json`: 162
- `weapons.json`: 477

## Excluídos por colisão com item autoral (60)

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
| royal-spear | id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014) |
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

## Excluídos por vocação Monk (47)

A vocação Monk não existe no Draconya (fora do escopo, decisão de produto) — item EXCLUSIVO de Monk sai inteiro; item cuja lista de vocações inclui Monk e outra(s) perde só o Monk da lista, promovido normalmente para quem o Draconya de fato tem.

| id | motivo |
|---|---|
| boots-of-enlightenment | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| charged-ethereal-ring | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| collar-of-orange-plasma | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| coned-hat-of-enlightenment | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| dark-vision-bandana | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| death-oyoroi | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| demon-mengu | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| eldritch-monk-boots | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| enchanted-merudri-brooch | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| energy-robe | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| ethereal-coned-hat | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| ethereal-ring | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| genesis-serenity-armor | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| genesis-serenity-legs | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| ghazbaran-oyoroi | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| gnomish-cuirass | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| gnomish-footwraps | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| harmony-amulet | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| ice-robe | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| iks-footwraps | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| jade-conical-hat | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| jade-legs | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| jungle-survivor-legs | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| leaf-robe | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| legs-of-enlightenment | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| legs-of-wisdom | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| light-bandana | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| magma-robe | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| merudri-battle-mail | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| merudri-brooch | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| merudri-nanbando | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| merudri-scale-mail | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| monk-robe | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| mutant-hide-trousers | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| naga-tanko | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| norcferatu-bonehood | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| norcferatu-fleshguards | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| plain-monk-robe | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| ring-of-orange-plasma | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| robe-of-enlightenment | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| sanguine-trousers | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| soulgarb | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| soulsoles | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| spirit-bind | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| stoic-iks-robe | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| yalahari-footwraps | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
| zaoan-monk-robe | exclusivo da vocação Monk (fora do escopo do Draconya, ADR — ver PRD) |
