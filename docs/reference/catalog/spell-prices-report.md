# Relatório de importação — preço de magia por NPC (M44-06/#624)

Fonte: `canary` em `47dfd51f45280a59a1d3e50ba7edd573d7234446`.

1036 arquivo(s) de NPC lidos, 51 ensinam magia, 1841 chamada(s) `StdModule.learnSpell` coletadas, 0 não resolvida(s).

O preço de `learnPrice` é o MENOR entre os NPCs que ensinam a magia à vocação dela (ADR 0038 decisão 6, ADR 0058 d.3); a ligação é o nome da magia sem diferenciar caixa, e a vocação do NPC vira a vocação base (Master Sorcerer → Sorcerer). `premium` não entra.

## Magias

| magia | vocação | learnPrice | fonte | NPCs | preços vistos |
|---|---|---|---|---|---|
| `annihilation` | knight | 20000 | `graham.lua` | 8 | 20000 |
| `apprentices-strike-druid` | druid | 0 | `azalea.lua` | 23 | 0 |
| `apprentices-strike-sorcerer` | sorcerer | 0 | `azalea.lua` | 23 | 0 |
| `berserk` | knight | 2500 | `graham.lua` | 8 | 2500 |
| `blood-rage` | knight | 8000 | `zoltan.lua` | 1 | 8000 |
| `bruise-bane` | knight | 0 | `asrak.lua` | 11 | 0 |
| `brutal-strike` | knight | 1000 | `graham.lua` | 9 | 1000 |
| `buzz` | sorcerer | 0 | `barnabas_dee.lua` | 12 | 0 |
| `cancel-invisibility` | paladin | 1600 | `dario.lua` | 8 | 1600 |
| `cancel-magic-shield-druid` | druid | 450 | `azalea.lua` | 14 | 450 |
| `cancel-magic-shield-sorcerer` | sorcerer | 450 | `azalea.lua` | 14 | 450 |
| `challenge` | knight | 2000 | sem NPC | 0 | — |
| `charge` | knight | 1300 | `graham.lua` | 8 | 1300 |
| `chill-out` | druid | 0 | `azalea.lua` | 12 | 0 |
| `chivalrous-challenge` | knight | 250000 | `graham.lua` | 8 | 250000 |
| `conjure-arrow` | paladin | 450 | `asrak.lua` | 13 | 450 |
| `conjure-avalanche-rune` | druid | 1200 | `azalea.lua` | 11 | 1200 |
| `conjure-explosion-rune-druid` | druid | 1800 | `azalea.lua` | 21 | 1800 |
| `conjure-explosion-rune-sorcerer` | sorcerer | 1800 | `azalea.lua` | 21 | 1800 |
| `conjure-great-fireball-rune` | sorcerer | 1200 | `barnabas_dee.lua` | 12 | 1200 |
| `conjure-heavy-magic-missile-rune-druid` | druid | 1500 | `azalea.lua` | 21 | 1500 |
| `conjure-heavy-magic-missile-rune-sorcerer` | sorcerer | 1500 | `azalea.lua` | 21 | 1500 |
| `conjure-intense-healing-rune` | druid | 600 | `azalea.lua` | 12 | 600 |
| `conjure-power-bolt` | paladin | 2200 | sem NPC | 0 | — |
| `conjure-sniper-arrow` | paladin | 800 | sem NPC | 0 | — |
| `conjure-stone-shower-rune` | druid | 1100 | `azalea.lua` | 8 | 1100 |
| `conjure-sudden-death-rune` | sorcerer | 3000 | `barnabas_dee.lua` | 12 | 3000 |
| `conjure-thunderstorm-rune` | sorcerer | 1100 | `barnabas_dee.lua` | 8 | 1100 |
| `conjure-ultimate-healing-rune` | druid | 1500 | `azalea.lua` | 12 | 1500 |
| `cure-bleeding-druid` | druid | 2500 | `azalea.lua` | 14 | 2500 |
| `cure-bleeding-knight` | knight | 2500 | `azalea.lua` | 15 | 2500 |
| `cure-burning` | druid | 2000 | `azalea.lua` | 8 | 2000 |
| `cure-curse` | paladin | 6000 | `dario.lua` | 8 | 6000 |
| `cure-electrification` | druid | 1000 | `azalea.lua` | 8 | 1000 |
| `cure-poison` | — | 150 | `asrak.lua` | 46 | 150 |
| `death-strike` | sorcerer | 800 | `barnabas_dee.lua` | 9 | 800 |
| `divine-caldera` | paladin | 3000 | `dario.lua` | 8 | 3000 |
| `divine-healing` | paladin | 3000 | `asrak.lua` | 12 | 3000 |
| `divine-missile` | paladin | 1800 | `dario.lua` | 8 | 1800 |
| `electrify` | sorcerer | 2500 | `barnabas_dee.lua` | 8 | 2500 |
| `enchant-party` | sorcerer | 4000 | `eliza.lua` | 1 | 4000 |
| `energy-beam` | sorcerer | 1000 | `barnabas_dee.lua` | 12 | 1000 |
| `energy-strike-druid` | druid | 800 | `azalea.lua` | 15 | 800 |
| `energy-strike-sorcerer` | sorcerer | 800 | `azalea.lua` | 15 | 800 |
| `energy-wave` | sorcerer | 2500 | `barnabas_dee.lua` | 12 | 2500 |
| `envenom` | druid | 6000 | `azalea.lua` | 8 | 6000 |
| `eternal-winter` | druid | 8000 | `zoltan.lua` | 1 | 8000 |
| `ethereal-spear` | paladin | 1100 | `dario.lua` | 8 | 1100 |
| `fierce-berserk` | knight | 7500 | `graham.lua` | 8 | 7500 |
| `fire-wave` | sorcerer | 850 | `barnabas_dee.lua` | 12 | 850 |
| `flame-strike-druid` | druid | 800 | `azalea.lua` | 15 | 800 |
| `flame-strike-sorcerer` | sorcerer | 800 | `azalea.lua` | 15 | 800 |
| `front-sweep` | knight | 4000 | `graham.lua` | 8 | 4000 |
| `great-death-beam` | sorcerer | — | sem NPC | 0 | — |
| `great-energy-beam` | sorcerer | 1800 | `barnabas_dee.lua` | 12 | 1800 |
| `great-fire-wave` | sorcerer | 25000 | `barnabas_dee.lua` | 8 | 25000 |
| `groundshaker` | knight | 1500 | `graham.lua` | 8 | 1500 |
| `haste-druid` | druid | 600 | `azalea.lua` | 30 | 600 |
| `haste-knight` | knight | 600 | `azalea.lua` | 30 | 600 |
| `haste-paladin` | paladin | 600 | `azalea.lua` | 31 | 600 |
| `haste-sorcerer` | sorcerer | 600 | `azalea.lua` | 30 | 600 |
| `heal-friend-druid` | druid | 800 | `azalea.lua` | 8 | 800 |
| `heal-party` | druid | 4000 | `eliza.lua` | 1 | 4000 |
| `hells-core` | sorcerer | 8000 | `zoltan.lua` | 1 | 8000 |
| `holy-flash` | paladin | 7500 | `dario.lua` | 8 | 7500 |
| `ice-strike-druid` | druid | 800 | `azalea.lua` | 15 | 800 |
| `ice-strike-sorcerer` | sorcerer | 800 | `azalea.lua` | 15 | 800 |
| `ice-wave` | druid | 850 | `azalea.lua` | 12 | 850 |
| `ignite` | sorcerer | 1500 | `barnabas_dee.lua` | 8 | 1500 |
| `inflict-wound` | knight | 2500 | `graham.lua` | 8 | 2500 |
| `intense-healing-druid` | druid | 350 | `asrak.lua` | 33 | 350 |
| `intense-healing-paladin` | paladin | 350 | `asrak.lua` | 33 | 350 |
| `intense-wound-cleansing` | knight | 6000 | `graham.lua` | 8 | 6000 |
| `invisibility-druid` | druid | 2000 | `azalea.lua` | 22 | 2000 |
| `invisibility-sorcerer` | sorcerer | 2000 | `azalea.lua` | 22 | 2000 |
| `lesser-ethereal-spear` | paladin | 0 | `asrak.lua` | 5 | 0 |
| `lesser-front-sweep` | knight | 0 | `asrak.lua` | 11 | 0 |
| `light-healing-druid` | druid | 0 | `asrak.lua` | 35 | 0 |
| `light-healing-paladin` | paladin | 0 | `asrak.lua` | 35 | 0 |
| `lightning` | sorcerer | 5000 | `barnabas_dee.lua` | 8 | 5000 |
| `magic-patch-druid` | druid | 0 | `asrak.lua` | 32 | 0 |
| `magic-patch-sorcerer` | sorcerer | 0 | `asrak.lua` | 29 | 0 |
| `magic-shield-druid` | druid | 450 | `azalea.lua` | 22 | 450 |
| `magic-shield-sorcerer` | sorcerer | 450 | `azalea.lua` | 22 | 450 |
| `mass-healing` | druid | 2200 | `azalea.lua` | 8 | 2200 |
| `mud-attack` | druid | 0 | `azalea.lua` | 12 | 0 |
| `physical-strike` | druid | 800 | `azalea.lua` | 9 | 800 |
| `protect-party` | paladin | 4000 | `eliza.lua` | 1 | 4000 |
| `protector` | knight | 6000 | `zoltan.lua` | 1 | 6000 |
| `rage-of-the-skies` | sorcerer | 6000 | `zoltan.lua` | 1 | 6000 |
| `recovery-knight` | knight | 4000 | `dario.lua` | 14 | 4000 |
| `recovery-paladin` | paladin | 4000 | `dario.lua` | 15 | 4000 |
| `salvation` | paladin | 8000 | `dario.lua` | 8 | 8000 |
| `scorch` | sorcerer | 0 | `barnabas_dee.lua` | 12 | 0 |
| `sharpshooter` | paladin | 8000 | `zoltan.lua` | 1 | 8000 |
| `strong-energy-strike` | sorcerer | 7500 | `barnabas_dee.lua` | 8 | 7500 |
| `strong-ethereal-spear` | paladin | 10000 | `dario.lua` | 8 | 10000 |
| `strong-flame-strike` | sorcerer | 6000 | `barnabas_dee.lua` | 8 | 6000 |
| `strong-haste-druid` | druid | 1300 | `azalea.lua` | 15 | 1300 |
| `strong-haste-sorcerer` | sorcerer | 1300 | `azalea.lua` | 15 | 1300 |
| `strong-ice-strike` | druid | 6000 | `azalea.lua` | 8 | 6000 |
| `strong-ice-wave` | druid | 7500 | `azalea.lua` | 8 | 7500 |
| `strong-terra-strike` | druid | 6000 | `azalea.lua` | 8 | 6000 |
| `summon-creature-druid` | druid | 2000 | `azalea.lua` | 22 | 2000 |
| `summon-creature-sorcerer` | sorcerer | 2000 | `azalea.lua` | 18 | 2000 |
| `swift-foot` | paladin | 6000 | `dario.lua` | 8 | 6000 |
| `terra-strike-druid` | druid | 800 | `azalea.lua` | 15 | 800 |
| `terra-strike-sorcerer` | sorcerer | 800 | `azalea.lua` | 15 | 800 |
| `terra-wave` | druid | 2500 | `azalea.lua` | 11 | 2500 |
| `train-party` | knight | 4000 | `eliza.lua` | 1 | 4000 |
| `ultimate-energy-strike` | sorcerer | 15000 | `zoltan.lua` | 1 | 15000 |
| `ultimate-flame-strike` | sorcerer | 15000 | `zoltan.lua` | 1 | 15000 |
| `ultimate-healing-druid` | druid | 1000 | `azalea.lua` | 22 | 1000 |
| `ultimate-healing-sorcerer` | sorcerer | 1000 | `azalea.lua` | 22 | 1000 |
| `ultimate-ice-strike` | druid | 15000 | `zoltan.lua` | 1 | 15000 |
| `ultimate-terra-strike` | druid | 15000 | `zoltan.lua` | 1 | 15000 |
| `whirlwind-throw` | knight | 1500 | `graham.lua` | 8 | 1500 |
| `wound-cleansing` | knight | 0 | `asrak.lua` | 13 | 0 |
| `wrath-of-nature` | druid | 6000 | `zoltan.lua` | 1 | 6000 |

## Sem NPC que ensine

Nenhum NPC importado ensina estas magias (no Canary elas vêm de outro caminho — quest, Wheel of Destiny, conta premium). O `learnPrice` é curado à mão, com a fonte no `_open` do próprio arquivo (fallback do ADR 0058 d.3).

| magia | vocação | learnPrice atual |
|---|---|---|
| `challenge` | knight | 2000 |
| `conjure-power-bolt` | paladin | 2200 |
| `conjure-sniper-arrow` | paladin | 800 |
| `great-death-beam` | sorcerer | AUSENTE |

## Mudanças nesta importação

Nenhuma — o dado commitado já confere com o Canary.
