# Relatório de promoção — items (#748)

Separa `packages/content/staging/items/generated/*.json` (a transcrição pura do Canary, #573/#574) em `data/items/generated/` + `data/appearances/baseline.json.items` — o mesmo movimento que `promote-monsters.ts` (#580) já fez para monstro. Duas exclusões, cada uma contada: id que colide com item AUTORAL (o autoral vence, ADR 0014) e `appearanceId` fora do inventário do pacote de assets conferido (FUN-21).

1644 item(ns) promovido(s) em 10 fatia(s):

- `amulets.json`: 80
- `armors.json`: 137
- `boots.json`: 51
- `creature-products.json`: 608
- `helmets.json`: 112
- `legs.json`: 51
- `rings.json`: 37
- `shields.json`: 100
- `valuables.json`: 151
- `weapons.json`: 317

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

## Excluídos por aparência fora do pacote (139)

| id | appearanceId | motivo |
|---|---|---|
| amber-axe | 47375 | appearanceId 47375 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| amber-bludgeon | 47370 | appearanceId 47370 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| amber-bow | 47371 | appearanceId 47371 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| amber-crossbow | 47377 | appearanceId 47377 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| amber-cudgel | 47376 | appearanceId 47376 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| amber-greataxe | 47369 | appearanceId 47369 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| amber-rod | 47373 | appearanceId 47373 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| amber-sabre | 47374 | appearanceId 47374 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| amber-slayer | 47368 | appearanceId 47368 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| amber-wand | 47372 | appearanceId 47372 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| arbaziloth-shoulder-piece | 50067 | appearanceId 50067 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| biscuit-barrier | 45643 | appearanceId 45643 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| bloodstained-scythe | 50101 | appearanceId 50101 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| boots-of-enlightenment | 50267 | appearanceId 50267 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| brinebrute-claw | 50056 | appearanceId 50056 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| broodrider-saddle | 50058 | appearanceId 50058 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| candy-necklace | 45641 | appearanceId 45641 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| charged-ethereal-ring | 50147 | appearanceId 50147 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| cocoa-grimoire | 45639 | appearanceId 45639 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| collar-of-orange-plasma | 50153 | appearanceId 50153 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| coned-hat-of-enlightenment | 50274 | appearanceId 50274 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| creamy-grimoire | 45640 | appearanceId 45640 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| dark-chocolate-coin | 48250 | appearanceId 48250 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| dark-vision-bandana | 50190 | appearanceId 50190 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| death-oyoroi | 50260 | appearanceId 50260 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| demon-claws | 50060 | appearanceId 50060 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| demon-mengu | 50189 | appearanceId 50189 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| demon-skull | 50061 | appearanceId 50061 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| demonfang-mask | 49534 | appearanceId 49534 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| draining-inferniarch-arbalest | 49862 | appearanceId 49862 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| draining-inferniarch-battleaxe | 49865 | appearanceId 49865 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| draining-inferniarch-blade | 49877 | appearanceId 49877 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| draining-inferniarch-bow | 49859 | appearanceId 49859 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| draining-inferniarch-flail | 49871 | appearanceId 49871 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| draining-inferniarch-greataxe | 49868 | appearanceId 49868 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| draining-inferniarch-rod | 49886 | appearanceId 49886 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| draining-inferniarch-slayer | 49880 | appearanceId 49880 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| draining-inferniarch-wand | 49883 | appearanceId 49883 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| draining-inferniarch-warhammer | 49874 | appearanceId 49874 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| dreadfire-headpiece | 49533 | appearanceId 49533 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| eldritch-monk-boots | 50266 | appearanceId 50266 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| enchanted-merudri-brooch | 50154 | appearanceId 50154 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| energy-robe | 50279 | appearanceId 50279 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| ethereal-coned-hat | 50188 | appearanceId 50188 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| ethereal-ring | 50149 | appearanceId 50149 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| fish-eye | 48517 | appearanceId 48517 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| genesis-serenity-armor | 51295 | appearanceId 51295 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| genesis-serenity-legs | 51299 | appearanceId 51299 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| ghazbaran-oyoroi | 50275 | appearanceId 50275 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| gnomish-cuirass | 50276 | appearanceId 50276 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| gnomish-footwraps | 50290 | appearanceId 50290 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| gorger-antlers | 50059 | appearanceId 50059 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| greater-spiritualist-gem | 49373 | appearanceId 49373 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| harmony-amulet | 50195 | appearanceId 50195 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| hellhunter-eye | 50055 | appearanceId 50055 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| hellstalker-visor | 49532 | appearanceId 49532 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| ice-robe | 50280 | appearanceId 50280 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| iks-footwraps | 50291 | appearanceId 50291 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| inferniarch-arbalest | 49522 | appearanceId 49522 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| inferniarch-battleaxe | 49523 | appearanceId 49523 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| inferniarch-blade | 49527 | appearanceId 49527 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| inferniarch-bow | 49520 | appearanceId 49520 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| inferniarch-flail | 49525 | appearanceId 49525 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| inferniarch-greataxe | 49524 | appearanceId 49524 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| inferniarch-rod | 49529 | appearanceId 49529 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| inferniarch-slayer | 49530 | appearanceId 49530 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| inferniarch-wand | 49528 | appearanceId 49528 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| inferniarch-warhammer | 49526 | appearanceId 49526 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| jade-conical-hat | 50193 | appearanceId 50193 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| jade-legs | 50185 | appearanceId 50185 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| jungle-survivor-legs | 50186 | appearanceId 50186 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| leaf-robe | 50277 | appearanceId 50277 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| legs-of-enlightenment | 50269 | appearanceId 50269 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| legs-of-wisdom | 50187 | appearanceId 50187 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| lesser-spiritualist-gem | 49371 | appearanceId 49371 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| light-bandana | 50194 | appearanceId 50194 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| magma-robe | 50278 | appearanceId 50278 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| maliceforged-helmet | 49531 | appearanceId 49531 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| merudri-battle-mail | 50264 | appearanceId 50264 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| merudri-brooch | 50156 | appearanceId 50156 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| merudri-nanbando | 50261 | appearanceId 50261 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| merudri-scale-mail | 50263 | appearanceId 50263 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| milk-chocolate-coin | 48249 | appearanceId 48249 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| monk-robe | 50258 | appearanceId 50258 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| mutant-hide-trousers | 50184 | appearanceId 50184 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| naga-tanko | 50262 | appearanceId 50262 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| norcferatu-bloodhide | 51263 | appearanceId 51263 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| norcferatu-bloodstrider | 51266 | appearanceId 51266 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| norcferatu-bonecloak | 51264 | appearanceId 51264 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| norcferatu-bonehood | 51261 | appearanceId 51261 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| norcferatu-fangstompers | 51269 | appearanceId 51269 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| norcferatu-fleshguards | 51267 | appearanceId 51267 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| norcferatu-goretrampers | 51268 | appearanceId 51268 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| norcferatu-skullguard | 51260 | appearanceId 51260 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| norcferatu-thornwraps | 51265 | appearanceId 51265 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| norcferatu-tuskplate | 51262 | appearanceId 51262 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| plain-monk-robe | 50257 | appearanceId 50257 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| preserved-dark-seed | 48505 | appearanceId 48505 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| preserved-light-blue-seed | 45654 | appearanceId 45654 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| preserved-pink-seed | 45652 | appearanceId 45652 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| preserved-purple-seed | 45656 | appearanceId 45656 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| preserved-red-seed | 45653 | appearanceId 45653 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| preserved-violet-seed | 45655 | appearanceId 45655 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| preserved-yellow-seed | 45657 | appearanceId 45657 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| reality-splinter | 51259 | appearanceId 51259 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| rending-inferniarch-arbalest | 49861 | appearanceId 49861 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| rending-inferniarch-battleaxe | 49864 | appearanceId 49864 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| rending-inferniarch-blade | 49876 | appearanceId 49876 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| rending-inferniarch-bow | 49858 | appearanceId 49858 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| rending-inferniarch-flail | 49870 | appearanceId 49870 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| rending-inferniarch-greataxe | 49867 | appearanceId 49867 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| rending-inferniarch-rod | 49885 | appearanceId 49885 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| rending-inferniarch-slayer | 49879 | appearanceId 49879 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| rending-inferniarch-wand | 49882 | appearanceId 49882 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| rending-inferniarch-warhammer | 49873 | appearanceId 49873 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| ring-of-orange-plasma | 50151 | appearanceId 50151 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| ring-of-temptation | 45642 | appearanceId 45642 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| robe-of-enlightenment | 50268 | appearanceId 50268 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| sanguine-trousers | 50146 | appearanceId 50146 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| sineater-wing | 50057 | appearanceId 50057 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| siphoning-inferniarch-arbalest | 49863 | appearanceId 49863 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| siphoning-inferniarch-battleaxe | 49866 | appearanceId 49866 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| siphoning-inferniarch-blade | 49878 | appearanceId 49878 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| siphoning-inferniarch-bow | 49860 | appearanceId 49860 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| siphoning-inferniarch-flail | 49872 | appearanceId 49872 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| siphoning-inferniarch-greataxe | 49869 | appearanceId 49869 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| siphoning-inferniarch-rod | 49887 | appearanceId 49887 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| siphoning-inferniarch-slayer | 49881 | appearanceId 49881 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| siphoning-inferniarch-wand | 49884 | appearanceId 49884 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| siphoning-inferniarch-warhammer | 49875 | appearanceId 49875 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| soulgarb | 50254 | appearanceId 50254 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| soulsoles | 50240 | appearanceId 50240 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| spellreaper-staff-totem | 50054 | appearanceId 50054 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| spirit-bind | 51294 | appearanceId 51294 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| spirited-soil | 51276 | appearanceId 51276 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| spiritualist-gem | 49372 | appearanceId 49372 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| stoic-iks-robe | 50255 | appearanceId 50255 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| yalahari-footwraps | 50289 | appearanceId 50289 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |
| zaoan-monk-robe | 50259 | appearanceId 50259 não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido |

## Excluídos por regra de conteúdo (105)

A mesma conferência que `buildContent` (`content.ts`) faria no boot — item de decoração/quest com `defense` residual do Canary fora de `kind: shield`, arma sem `slot` (a maioria das armas do Canary não declara `<attribute key="slot" value="hand">`) que também carrega `imbuementslot`, e arma de distância sem `ammoFamily` reconhecida. A linha inteira é excluída — nunca escrita quebrada, e nunca corrigida em silêncio.

| id | motivo |
|---|---|
| abyss-hammer | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| amber-staff | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| avenger | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| berserker | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| blacksteel-sword | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| bow-of-cataclysm | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| bow-of-destruction | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| broken-iks-spear | defense só vale em escudo ou arma corpo a corpo (content.ts) |
| broken-macuahuitl | defense só vale em escudo ou arma corpo a corpo (content.ts) |
| chain-bolter | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| chopper-of-destruction | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| cobra-crossbow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| composite-hornbow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| crossbow-of-destruction | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| demonrage-sword | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| demonwing-axe | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| devileye | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| dragon-lance | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| drakinata | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| eldritch-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| eldritch-claymore | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| eldritch-greataxe | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| eldritch-warmace | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| elvish-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| executioner | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| falcon-battleaxe | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| falcon-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| falcon-longsword | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| giant-sword | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| gilded-eldritch-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| gilded-eldritch-claymore | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| gilded-eldritch-greataxe | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| grand-sanguine-battleaxe | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| grand-sanguine-bludgeon | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| grand-sanguine-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| grand-sanguine-crossbow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| grand-sanguine-razor | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| great-axe | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| guardian-halberd | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| hammer-of-destruction | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| hammer-of-wrath | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| haunted-blade | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| havoc-blade | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| headchopper | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| heavily-rusted-shield | defense só vale em escudo ou arma corpo a corpo (content.ts) |
| heavy-mace | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| hive-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| icicle-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| ironworker | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| jungle-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| jungle-flail | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| lion-longbow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| living-vine-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| lunar-staff | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| modified-crossbow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| musicians-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| mycological-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| naga-crossbow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| orcish-maul | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| phantasmal-axe | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| ravagers-axe | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| resizer | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| rift-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| rift-crossbow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| rift-lance | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| rusted-shield | defense só vale em escudo ou arma corpo a corpo (content.ts) |
| ruthless-axe | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| sanguine-battleaxe | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| sanguine-bludgeon | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| sanguine-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| sanguine-crossbow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| sanguine-razor | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| silkweaver-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| skullcrusher | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| slayer-of-destruction | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| slightly-rusted-shield | defense só vale em escudo ou arma corpo a corpo (content.ts) |
| soulbleeder | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| souleater | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| soulmaimer | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| soulpiercer | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| soulshredder | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| spiked-squelcher | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| stomper | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| stonecutter-axe | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| tagralt-blade | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| thaian-sword | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| thorn-spitter | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| triple-bolt-crossbow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| twiceslicer | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| twin-axe | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| twin-hooks | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| umbral-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| umbral-chopper | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| umbral-crossbow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| umbral-hammer | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| umbral-master-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| umbral-master-chopper | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| umbral-master-crossbow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| umbral-master-hammer | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| umbral-master-slayer | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| umbral-slayer | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| war-axe | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| war-hammer | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| warsinger-bow | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
| zaoan-halberd | imbuementSlots só vale em item que se veste e não empilha (content.ts) |
