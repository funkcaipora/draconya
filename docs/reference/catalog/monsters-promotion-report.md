# Relatório de promoção — monsters (#580)

Separa `packages/content/staging/monsters/generated/*.json` (a transcrição pura do Canary, #578/#579) em `data/monsters/generated/` + `data/bestiary/baseline.json` + `data/appearances/baseline.json`, e valida `loot.items` contra o catálogo de itens REAL (`packages/content/data/items`, autoral + `generated/` — o que `loadContent` de fato carrega hoje; a promoção de itens é `promote-items.ts`, #748).

1033 monstro(s) promovido(s) em 27 fatia(s):

- `amphibics.json`: 11
- `aquatics.json`: 33
- `birds.json`: 15
- `bosses.json`: 62
- `constructs.json`: 20
- `dawnport.json`: 18
- `demons.json`: 21
- `dragons.json`: 6
- `elementals.json`: 5
- `event_creatures.json`: 30
- `extra_dimensional.json`: 2
- `familiars.json`: 4
- `fey.json`: 15
- `giants.json`: 15
- `humanoids.json`: 69
- `humans.json`: 55
- `lycanthropes.json`: 8
- `magicals.json`: 37
- `mammals.json`: 69
- `nostalgia.json`: 8
- `plants.json`: 7
- `quests.json`: 369
- `raids.json`: 32
- `reptiles.json`: 21
- `slimes.json`: 7
- `undeads.json`: 48
- `vermins.json`: 46

## Não promovidos (7)

| id | motivo |
|---|---|
| dragon | hand-authored — regenerado só pelo #581, nunca por esta promoção (a apresentação, #620, é renovada) |
| dragon-lord | hand-authored — regenerado só pelo #581, nunca por esta promoção (a apresentação, #620, é renovada) |
| dragon-lord-hatchling | hand-authored — regenerado só pelo #581, nunca por esta promoção (a apresentação, #620, é renovada) |
| eshtaba-the-conjurer | summons.entries repete o mesmo monsterId com chances diferentes — o sim só aceita uma entrada por id (content.ts) |
| leiden | summons.entries repete o mesmo monsterId com chances diferentes — o sim só aceita uma entrada por id (content.ts) |
| rat | hand-authored — regenerado só pelo #581, nunca por esta promoção (a apresentação, #620, é renovada) |
| rotworm | hand-authored — regenerado só pelo #581, nunca por esta promoção (a apresentação, #620, é renovada) |

## Linhas de loot removidas (2788)

Item referenciado por `loot.items` que não existe no catálogo real, ou que excede a pilha de um item que não empilha. A linha inteira é removida — nunca creditada como item fantasma (§"Loot" de `packages/content/CLAUDE.md`).

600 item(ns) distinto(s) referenciado(s) e ausente(s) do catálogo real.

| item | ocorrências | motivo (da primeira ocorrência) |
|---|---|---|
| abominations-eye | 1 | item ausente do catálogo (packages/content/data/items) |
| abominations-tail | 1 | item ausente do catálogo (packages/content/data/items) |
| abominations-tongue | 1 | item ausente do catálogo (packages/content/data/items) |
| afflicted-strider-worms | 1 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| amber | 5 | item ausente do catálogo (packages/content/data/items) |
| amber-kusarigama | 1 | item ausente do catálogo (packages/content/data/items) |
| amber-with-a-bug | 2 | item ausente do catálogo (packages/content/data/items) |
| amber-with-a-dragonfly | 7 | item ausente do catálogo (packages/content/data/items) |
| amphora | 1 | item ausente do catálogo (packages/content/data/items) |
| ancient-rune | 1 | item ausente do catálogo (packages/content/data/items) |
| ankh | 5 | item ausente do catálogo (packages/content/data/items) |
| anniversary-cake | 1 | item ausente do catálogo (packages/content/data/items) |
| arrow | 12 | item ausente do catálogo (packages/content/data/items) |
| assassin-star | 25 | max 10 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| bag-of-apple-slices | 2 | item ausente do catálogo (packages/content/data/items) |
| bag-with-stolen-gold | 4 | item ausente do catálogo (packages/content/data/items) |
| banana | 4 | item ausente do catálogo (packages/content/data/items) |
| bar-of-chocolate | 2 | item ausente do catálogo (packages/content/data/items) |
| bar-of-gold | 1 | item ausente do catálogo (packages/content/data/items) |
| bashmu-feather | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| bashmu-tongue | 1 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| bat-decoration | 1 | item ausente do catálogo (packages/content/data/items) |
| bat-wing | 2 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| bear-paw | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| bed-of-nails | 2 | item ausente do catálogo (packages/content/data/items) |
| beetroot | 2 | item ausente do catálogo (packages/content/data/items) |
| behemoth-trophy | 1 | item ausente do catálogo (packages/content/data/items) |
| beijinho | 1 | item ausente do catálogo (packages/content/data/items) |
| berserk-potion | 30 | item ausente do catálogo (packages/content/data/items) |
| big-bone | 10 | item ausente do catálogo (packages/content/data/items) |
| black-pearl | 19 | max 15 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| black-skull | 2 | item ausente do catálogo (packages/content/data/items) |
| blank-parchment | 1 | item ausente do catálogo (packages/content/data/items) |
| blank-rune | 16 | item ausente do catálogo (packages/content/data/items) |
| blue-crystal-shard | 9 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| blue-crystal-splinter | 2 | max 4 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| blue-ectoplasm | 1 | item ausente do catálogo (packages/content/data/items) |
| blue-gem | 5 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| blue-glass-plate | 1 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| blue-goanna-scale | 1 | max 6 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| blue-memory-shard | 1 | item ausente do catálogo (packages/content/data/items) |
| blue-note | 1 | item ausente do catálogo (packages/content/data/items) |
| blue-piece-of-cloth | 4 | item ausente do catálogo (packages/content/data/items) |
| blue-rose | 1 | item ausente do catálogo (packages/content/data/items) |
| boar-man-hoof | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| bolt | 7 | item ausente do catálogo (packages/content/data/items) |
| bone | 23 | item ausente do catálogo (packages/content/data/items) |
| book | 12 | item ausente do catálogo (packages/content/data/items) |
| book-backpack | 1 | item ausente do catálogo (packages/content/data/items) |
| book-of-necromantic-rituals | 4 | item ausente do catálogo (packages/content/data/items) |
| book-of-prayers | 3 | item ausente do catálogo (packages/content/data/items) |
| book-page | 7 | max 4 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| bottle-of-champagne | 7 | item ausente do catálogo (packages/content/data/items) |
| bracelet-of-strengthening | 1 | item ausente do catálogo (packages/content/data/items) |
| brainstealers-brain | 1 | item ausente do catálogo (packages/content/data/items) |
| brainstealers-brainwave | 1 | item ausente do catálogo (packages/content/data/items) |
| brainstealers-tissue | 1 | item ausente do catálogo (packages/content/data/items) |
| brigadeiro | 2 | item ausente do catálogo (packages/content/data/items) |
| broccoli | 1 | item ausente do catálogo (packages/content/data/items) |
| broken-bell | 2 | item ausente do catálogo (packages/content/data/items) |
| broken-iks-spear | 1 | item ausente do catálogo (packages/content/data/items) |
| broken-ring-of-ending | 2 | item ausente do catálogo (packages/content/data/items) |
| brooch-of-embracement | 1 | item ausente do catálogo (packages/content/data/items) |
| broom | 1 | item ausente do catálogo (packages/content/data/items) |
| brown-bread | 3 | item ausente do catálogo (packages/content/data/items) |
| brown-crystal-splinter | 4 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| brown-flask | 4 | item ausente do catálogo (packages/content/data/items) |
| brown-mushroom | 23 | item ausente do catálogo (packages/content/data/items) |
| brown-piece-of-cloth | 7 | item ausente do catálogo (packages/content/data/items) |
| brutus-bloodbeards-hat | 1 | item ausente do catálogo (packages/content/data/items) |
| bug-meat | 3 | item ausente do catálogo (packages/content/data/items) |
| buggy-backpack | 1 | item ausente do catálogo (packages/content/data/items) |
| bulb-of-garlic | 2 | item ausente do catálogo (packages/content/data/items) |
| bullseye-potion | 24 | item ausente do catálogo (packages/content/data/items) |
| bunch-of-ripe-rice | 4 | item ausente do catálogo (packages/content/data/items) |
| bunch-of-troll-hair | 4 | item ausente do catálogo (packages/content/data/items) |
| burnt-scroll | 1 | item ausente do catálogo (packages/content/data/items) |
| burst-arrow | 3 | item ausente do catálogo (packages/content/data/items) |
| candlestick | 5 | item ausente do catálogo (packages/content/data/items) |
| candy | 1 | item ausente do catálogo (packages/content/data/items) |
| candy-cane | 2 | item ausente do catálogo (packages/content/data/items) |
| candy-floss | 6 | item ausente do catálogo (packages/content/data/items) |
| carnisylvan-bark | 1 | max 5 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| carnisylvan-finger | 2 | max 4 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| carrot | 6 | item ausente do catálogo (packages/content/data/items) |
| carrot-on-a-stick | 3 | item ausente do catálogo (packages/content/data/items) |
| cave-turnip | 5 | item ausente do catálogo (packages/content/data/items) |
| chayennes-magical-key | 1 | item ausente do catálogo (packages/content/data/items) |
| cherry | 4 | item ausente do catálogo (packages/content/data/items) |
| chicken-feather | 1 | max 5 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| chitinous-mouth | 2 | item ausente do catálogo (packages/content/data/items) |
| christmas-present-bag | 1 | item ausente do catálogo (packages/content/data/items) |
| churro-heart | 2 | item ausente do catálogo (packages/content/data/items) |
| clay-lump | 7 | item ausente do catálogo (packages/content/data/items) |
| cleaver | 2 | item ausente do catálogo (packages/content/data/items) |
| closed-trap | 3 | item ausente do catálogo (packages/content/data/items) |
| cluster-of-solace | 3 | item ausente do catálogo (packages/content/data/items) |
| coal | 1 | max 5 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| cobra-axe | 2 | item ausente do catálogo (packages/content/data/items) |
| cobra-bo | 1 | item ausente do catálogo (packages/content/data/items) |
| cobra-club | 2 | item ausente do catálogo (packages/content/data/items) |
| cobra-sword | 2 | item ausente do catálogo (packages/content/data/items) |
| coconut | 1 | item ausente do catálogo (packages/content/data/items) |
| cookie | 14 | item ausente do catálogo (packages/content/data/items) |
| corncob | 3 | item ausente do catálogo (packages/content/data/items) |
| cornucopia | 1 | item ausente do catálogo (packages/content/data/items) |
| crab-man-claws | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| crawlers-essence | 1 | item ausente do catálogo (packages/content/data/items) |
| cream-cake | 1 | item ausente do catálogo (packages/content/data/items) |
| crystal-arrow | 1 | item ausente do catálogo (packages/content/data/items) |
| crystal-ball | 2 | item ausente do catálogo (packages/content/data/items) |
| crystal-of-focus | 2 | item ausente do catálogo (packages/content/data/items) |
| crystal-of-power | 1 | item ausente do catálogo (packages/content/data/items) |
| crystal-pedestal | 2 | item ausente do catálogo (packages/content/data/items) |
| crystalline-arrow | 4 | item ausente do catálogo (packages/content/data/items) |
| cucumber | 1 | item ausente do catálogo (packages/content/data/items) |
| cursed-bone | 1 | max 10 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| cyan-crystal-fragment | 3 | max 4 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| cyclops-trophy | 4 | item ausente do catálogo (packages/content/data/items) |
| damaged-armor-plates | 2 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| dark-chocolate-coin | 4 | max 11 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| dark-mushroom | 8 | item ausente do catálogo (packages/content/data/items) |
| death-oyoroi | 1 | item ausente do catálogo (packages/content/data/items) |
| death-toll | 9 | item ausente do catálogo (packages/content/data/items) |
| deathstrikes-snippet | 1 | item ausente do catálogo (packages/content/data/items) |
| decorative-ribbon | 1 | item ausente do catálogo (packages/content/data/items) |
| deepling-backpack | 2 | item ausente do catálogo (packages/content/data/items) |
| deepling-filet | 4 | item ausente do catálogo (packages/content/data/items) |
| deepworm-spike-roots | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| deer-trophy | 2 | item ausente do catálogo (packages/content/data/items) |
| demon-horn | 5 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| demon-trophy | 3 | item ausente do catálogo (packages/content/data/items) |
| demonic-core-essence | 4 | item ausente do catálogo (packages/content/data/items) |
| demonic-essence | 5 | max 5 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| demonic-matter | 4 | item ausente do catálogo (packages/content/data/items) |
| demonic-tapestry | 1 | item ausente do catálogo (packages/content/data/items) |
| depth-claws | 1 | item ausente do catálogo (packages/content/data/items) |
| didgeridoo | 3 | item ausente do catálogo (packages/content/data/items) |
| die | 7 | item ausente do catálogo (packages/content/data/items) |
| dirty-cape | 2 | item ausente do catálogo (packages/content/data/items) |
| dirty-fur | 2 | item ausente do catálogo (packages/content/data/items) |
| disgusting-trophy | 1 | item ausente do catálogo (packages/content/data/items) |
| doll | 1 | item ausente do catálogo (packages/content/data/items) |
| dracolas-eye | 1 | item ausente do catálogo (packages/content/data/items) |
| dragon-blood | 3 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| drill-bolt | 4 | item ausente do catálogo (packages/content/data/items) |
| dry-piece-of-wood | 1 | item ausente do catálogo (packages/content/data/items) |
| dubious-piece-of-cloth | 1 | item ausente do catálogo (packages/content/data/items) |
| earth-arrow | 4 | item ausente do catálogo (packages/content/data/items) |
| egg | 5 | item ausente do catálogo (packages/content/data/items) |
| egg-of-the-many | 1 | item ausente do catálogo (packages/content/data/items) |
| eggs-of-a-sacred-snake | 1 | item ausente do catálogo (packages/content/data/items) |
| eldritch-crescent-moon-spade | 1 | item ausente do catálogo (packages/content/data/items) |
| eldritch-monk-boots | 1 | item ausente do catálogo (packages/content/data/items) |
| emerald-bangle | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| empty-goldfish-bowl | 1 | item ausente do catálogo (packages/content/data/items) |
| energy-ball | 2 | max 4 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| energy-bar | 11 | item ausente do catálogo (packages/content/data/items) |
| energy-drink | 1 | item ausente do catálogo (packages/content/data/items) |
| envenomed-arrow | 3 | item ausente do catálogo (packages/content/data/items) |
| epaulette | 1 | item ausente do catálogo (packages/content/data/items) |
| essence-of-a-bad-dream | 4 | item ausente do catálogo (packages/content/data/items) |
| explorer-brooch | 3 | item ausente do catálogo (packages/content/data/items) |
| eye-of-a-deepling | 10 | item ausente do catálogo (packages/content/data/items) |
| eye-of-a-weeper | 1 | item ausente do catálogo (packages/content/data/items) |
| eye-of-the-storm | 1 | item ausente do catálogo (packages/content/data/items) |
| eye-pod | 1 | item ausente do catálogo (packages/content/data/items) |
| eyeless-devourer-legs | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| falcon-crest | 1 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| falcon-sai | 1 | item ausente do catálogo (packages/content/data/items) |
| fan-club-membership-card | 1 | item ausente do catálogo (packages/content/data/items) |
| fern | 1 | item ausente do catálogo (packages/content/data/items) |
| fiery-horseshoe | 1 | item ausente do catálogo (packages/content/data/items) |
| figurine-of-malice | 1 | item ausente do catálogo (packages/content/data/items) |
| final-judgement | 3 | item ausente do catálogo (packages/content/data/items) |
| fire-mushroom | 5 | item ausente do catálogo (packages/content/data/items) |
| fireproof-horn | 2 | item ausente do catálogo (packages/content/data/items) |
| fish | 39 | item ausente do catálogo (packages/content/data/items) |
| fishbone | 1 | item ausente do catálogo (packages/content/data/items) |
| fishing-rod | 4 | item ausente do catálogo (packages/content/data/items) |
| fist-on-a-stick | 2 | item ausente do catálogo (packages/content/data/items) |
| flaming-arrow | 7 | item ausente do catálogo (packages/content/data/items) |
| flash-arrow | 4 | item ausente do catálogo (packages/content/data/items) |
| flask-of-demonic-blood | 24 | item ausente do catálogo (packages/content/data/items) |
| flask-of-embalming-fluid | 3 | item ausente do catálogo (packages/content/data/items) |
| flask-of-rust-remover | 1 | item ausente do catálogo (packages/content/data/items) |
| flask-of-warriors-sweat | 3 | item ausente do catálogo (packages/content/data/items) |
| flask-with-beaver-bait | 1 | item ausente do catálogo (packages/content/data/items) |
| flour | 1 | item ausente do catálogo (packages/content/data/items) |
| flower-bouquet | 1 | item ausente do catálogo (packages/content/data/items) |
| flower-bowl | 1 | item ausente do catálogo (packages/content/data/items) |
| forbidden-fruit | 1 | item ausente do catálogo (packages/content/data/items) |
| fox-paw | 2 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| foxtail | 3 | item ausente do catálogo (packages/content/data/items) |
| fresh-fruit | 3 | item ausente do catálogo (packages/content/data/items) |
| frosty-ear-of-a-troll | 2 | item ausente do catálogo (packages/content/data/items) |
| frosty-heart | 2 | max 8 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| frozen-lightning | 1 | max 4 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| fur-bag | 1 | item ausente do catálogo (packages/content/data/items) |
| geomancers-robe | 1 | item ausente do catálogo (packages/content/data/items) |
| geomancers-staff | 1 | item ausente do catálogo (packages/content/data/items) |
| ghost-backpack | 1 | item ausente do catálogo (packages/content/data/items) |
| ghost-claw | 3 | item ausente do catálogo (packages/content/data/items) |
| giant-crab-pincer | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| giant-shimmering-pearl | 48 | item ausente do catálogo (packages/content/data/items) |
| giant-shrimp | 4 | item ausente do catálogo (packages/content/data/items) |
| gilded-eldritch-crescent-moon-spade | 1 | item ausente do catálogo (packages/content/data/items) |
| gingerbreadman | 1 | item ausente do catálogo (packages/content/data/items) |
| glob-of-acid-slime | 1 | item ausente do catálogo (packages/content/data/items) |
| glob-of-mercury | 1 | item ausente do catálogo (packages/content/data/items) |
| glooth-capsule | 2 | item ausente do catálogo (packages/content/data/items) |
| glooth-glider-gear-wheel | 1 | item ausente do catálogo (packages/content/data/items) |
| glooth-glider-tubes-and-wires | 1 | item ausente do catálogo (packages/content/data/items) |
| glooth-sandwich | 2 | item ausente do catálogo (packages/content/data/items) |
| glooth-steak | 2 | item ausente do catálogo (packages/content/data/items) |
| glowing-rune | 8 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| gnomevils-hat | 1 | item ausente do catálogo (packages/content/data/items) |
| gnomish-cuirass | 1 | item ausente do catálogo (packages/content/data/items) |
| goat-grass | 5 | item ausente do catálogo (packages/content/data/items) |
| goblet-of-gloom | 1 | item ausente do catálogo (packages/content/data/items) |
| gold-ingot | 11 | max 4 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| gold-token | 5 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| golden-backpack | 1 | item ausente do catálogo (packages/content/data/items) |
| golden-bag | 1 | item ausente do catálogo (packages/content/data/items) |
| golden-brush | 1 | item ausente do catálogo (packages/content/data/items) |
| golden-can-of-oil | 2 | item ausente do catálogo (packages/content/data/items) |
| golden-idol-of-tukh | 1 | item ausente do catálogo (packages/content/data/items) |
| golden-mask | 1 | item ausente do catálogo (packages/content/data/items) |
| gore-horn | 1 | item ausente do catálogo (packages/content/data/items) |
| grant-of-arms | 1 | item ausente do catálogo (packages/content/data/items) |
| grave-flower | 5 | item ausente do catálogo (packages/content/data/items) |
| great-health-potion | 95 | item ausente do catálogo (packages/content/data/items) |
| great-mana-potion | 96 | item ausente do catálogo (packages/content/data/items) |
| great-spirit-potion | 47 | item ausente do catálogo (packages/content/data/items) |
| green-crystal-shard | 10 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| green-crystal-splinter | 2 | max 5 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| green-ectoplasm | 1 | item ausente do catálogo (packages/content/data/items) |
| green-gem | 4 | max 4 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| green-glass-plate | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| green-memory-shard | 1 | item ausente do catálogo (packages/content/data/items) |
| green-perch | 5 | item ausente do catálogo (packages/content/data/items) |
| green-piece-of-cloth | 4 | item ausente do catálogo (packages/content/data/items) |
| gummy-rotworm | 4 | item ausente do catálogo (packages/content/data/items) |
| hair-of-a-banshee | 1 | item ausente do catálogo (packages/content/data/items) |
| half-digested-piece-of-meat | 2 | item ausente do catálogo (packages/content/data/items) |
| handmaidens-protector | 1 | item ausente do catálogo (packages/content/data/items) |
| hardened-bone | 4 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| harpoon-of-a-giant-snail | 1 | item ausente do catálogo (packages/content/data/items) |
| haunch-of-boar | 1 | item ausente do catálogo (packages/content/data/items) |
| haunted-piece-of-wood | 1 | item ausente do catálogo (packages/content/data/items) |
| head | 1 | item ausente do catálogo (packages/content/data/items) |
| health-potion | 50 | item ausente do catálogo (packages/content/data/items) |
| heart-of-the-mountain | 1 | item ausente do catálogo (packages/content/data/items) |
| heavy-crystal-fragment | 3 | item ausente do catálogo (packages/content/data/items) |
| heavy-old-tome | 11 | item ausente do catálogo (packages/content/data/items) |
| hieroglyph-banner | 2 | item ausente do catálogo (packages/content/data/items) |
| honeycomb | 2 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| horn-of-kalyassa | 1 | item ausente do catálogo (packages/content/data/items) |
| huge-chunk-of-crude-iron | 9 | item ausente do catálogo (packages/content/data/items) |
| hunters-quiver | 1 | item ausente do catálogo (packages/content/data/items) |
| hunting-spear | 2 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| ice-cube | 13 | item ausente do catálogo (packages/content/data/items) |
| ice-flower | 2 | item ausente do catálogo (packages/content/data/items) |
| incantation-fragment | 1 | item ausente do catálogo (packages/content/data/items) |
| infernal-bolt | 1 | item ausente do catálogo (packages/content/data/items) |
| inkwell | 6 | item ausente do catálogo (packages/content/data/items) |
| insectoid-eggs | 1 | item ausente do catálogo (packages/content/data/items) |
| instable-proto-matter | 1 | max 4 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| iron-ore | 2 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| ivory-comb | 5 | item ausente do catálogo (packages/content/data/items) |
| izcandars-snow-globe | 3 | item ausente do catálogo (packages/content/data/items) |
| izcandars-sundial | 1 | item ausente do catálogo (packages/content/data/items) |
| jade-legs | 1 | item ausente do catálogo (packages/content/data/items) |
| jalapeno-pepper | 3 | item ausente do catálogo (packages/content/data/items) |
| jewel-case | 2 | item ausente do catálogo (packages/content/data/items) |
| jewelled-backpack | 4 | item ausente do catálogo (packages/content/data/items) |
| jungle-moa-feather | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| jungle-survivor-legs | 1 | item ausente do catálogo (packages/content/data/items) |
| knowledgeable-book | 1 | item ausente do catálogo (packages/content/data/items) |
| kongras-shoulderpad | 2 | item ausente do catálogo (packages/content/data/items) |
| lamassu-horn | 1 | max 5 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| lamp | 6 | item ausente do catálogo (packages/content/data/items) |
| lavaworm-spike-roots | 1 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| leaf-star | 7 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| leather-whip | 1 | item ausente do catálogo (packages/content/data/items) |
| lethal-lissys-shirt | 1 | item ausente do catálogo (packages/content/data/items) |
| letter | 2 | item ausente do catálogo (packages/content/data/items) |
| light-bandana | 1 | item ausente do catálogo (packages/content/data/items) |
| light-shovel | 1 | item ausente do catálogo (packages/content/data/items) |
| lime-tart | 1 | item ausente do catálogo (packages/content/data/items) |
| liodile-fang | 1 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| lion-trophy | 1 | item ausente do catálogo (packages/content/data/items) |
| lions-mane | 6 | item ausente do catálogo (packages/content/data/items) |
| little-bowl-of-myrrh | 1 | item ausente do catálogo (packages/content/data/items) |
| lizard-scale | 1 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| lizard-trophy | 1 | item ausente do catálogo (packages/content/data/items) |
| lost-bashers-spike | 2 | item ausente do catálogo (packages/content/data/items) |
| lost-hushers-staff | 1 | item ausente do catálogo (packages/content/data/items) |
| lost-soul | 3 | item ausente do catálogo (packages/content/data/items) |
| ludicrous-piece-of-cloth | 1 | item ausente do catálogo (packages/content/data/items) |
| luminous-piece-of-cloth | 1 | item ausente do catálogo (packages/content/data/items) |
| lump-of-cake-dough | 1 | item ausente do catálogo (packages/content/data/items) |
| lump-of-earth | 4 | item ausente do catálogo (packages/content/data/items) |
| lute | 4 | item ausente do catálogo (packages/content/data/items) |
| lyre | 3 | item ausente do catálogo (packages/content/data/items) |
| magic-light-wand | 14 | item ausente do catálogo (packages/content/data/items) |
| magic-sulphur | 2 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| malices-horn | 1 | item ausente do catálogo (packages/content/data/items) |
| malices-spine | 1 | item ausente do catálogo (packages/content/data/items) |
| mammoth-tusk | 3 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| mana-potion | 24 | item ausente do catálogo (packages/content/data/items) |
| mandrake | 5 | item ausente do catálogo (packages/content/data/items) |
| mango | 1 | item ausente do catálogo (packages/content/data/items) |
| marlin | 1 | item ausente do catálogo (packages/content/data/items) |
| mastermind-potion | 34 | item ausente do catálogo (packages/content/data/items) |
| medal-of-valiance | 1 | item ausente do catálogo (packages/content/data/items) |
| medicine-pouch | 1 | item ausente do catálogo (packages/content/data/items) |
| melon | 5 | item ausente do catálogo (packages/content/data/items) |
| midnight-shard | 6 | item ausente do catálogo (packages/content/data/items) |
| might-ring | 4 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| milk-chocolate-coin | 3 | max 12 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| mind-stone | 13 | item ausente do catálogo (packages/content/data/items) |
| mini-mummy | 3 | item ausente do catálogo (packages/content/data/items) |
| minotaur-horn | 15 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| minotaur-trophy | 9 | item ausente do catálogo (packages/content/data/items) |
| mirror | 1 | item ausente do catálogo (packages/content/data/items) |
| moohtant-horn | 3 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| moon-backpack | 2 | item ausente do catálogo (packages/content/data/items) |
| moonstone | 4 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| moriks-helmet | 1 | item ausente do catálogo (packages/content/data/items) |
| morshabaals-brain | 1 | item ausente do catálogo (packages/content/data/items) |
| morshabaals-extract | 1 | item ausente do catálogo (packages/content/data/items) |
| morshabaals-mask | 1 | item ausente do catálogo (packages/content/data/items) |
| mouldy-cheese | 9 | item ausente do catálogo (packages/content/data/items) |
| mr-punishs-handcuffs | 1 | item ausente do catálogo (packages/content/data/items) |
| mummified-demon-finger | 4 | item ausente do catálogo (packages/content/data/items) |
| music-sheet | 8 | item ausente do catálogo (packages/content/data/items) |
| mysterious-fetish | 6 | item ausente do catálogo (packages/content/data/items) |
| mysterious-voodoo-skull | 5 | item ausente do catálogo (packages/content/data/items) |
| nail | 2 | item ausente do catálogo (packages/content/data/items) |
| nightmare-horn | 1 | item ausente do catálogo (packages/content/data/items) |
| nomad-parchment | 3 | item ausente do catálogo (packages/content/data/items) |
| northern-pike | 4 | item ausente do catálogo (packages/content/data/items) |
| obvious-piece-of-cloth | 1 | item ausente do catálogo (packages/content/data/items) |
| odd-organ | 1 | max 4 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| old-and-used-backpack | 1 | item ausente do catálogo (packages/content/data/items) |
| old-parchment | 1 | item ausente do catálogo (packages/content/data/items) |
| old-twig | 1 | item ausente do catálogo (packages/content/data/items) |
| ominous-book | 1 | item ausente do catálogo (packages/content/data/items) |
| ominous-piece-of-cloth | 1 | item ausente do catálogo (packages/content/data/items) |
| onion | 1 | item ausente do catálogo (packages/content/data/items) |
| onyx-arrow | 9 | item ausente do catálogo (packages/content/data/items) |
| onyx-chip | 9 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| opal | 13 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| orange | 4 | item ausente do catálogo (packages/content/data/items) |
| orange-mushroom | 2 | item ausente do catálogo (packages/content/data/items) |
| orb | 9 | item ausente do catálogo (packages/content/data/items) |
| orc-trophy | 5 | item ausente do catálogo (packages/content/data/items) |
| orc-tusk | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| orichalcum-pearl | 6 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| ornamented-ankh | 1 | item ausente do catálogo (packages/content/data/items) |
| orshabaals-brain | 1 | item ausente do catálogo (packages/content/data/items) |
| pair-of-iron-fists | 5 | item ausente do catálogo (packages/content/data/items) |
| pale-worms-scalp | 1 | item ausente do catálogo (packages/content/data/items) |
| panpipes | 5 | item ausente do catálogo (packages/content/data/items) |
| parder-tooth | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| part-of-a-rune | 1 | item ausente do catálogo (packages/content/data/items) |
| pastry-dragon | 1 | item ausente do catálogo (packages/content/data/items) |
| patch-of-fine-cloth | 4 | item ausente do catálogo (packages/content/data/items) |
| peanut | 3 | item ausente do catálogo (packages/content/data/items) |
| pear | 1 | item ausente do catálogo (packages/content/data/items) |
| pelvis-bone | 1 | max 10 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| peppermint-backpack | 1 | item ausente do catálogo (packages/content/data/items) |
| pharaoh-banner | 3 | item ausente do catálogo (packages/content/data/items) |
| pick | 8 | item ausente do catálogo (packages/content/data/items) |
| picture | 1 | item ausente do catálogo (packages/content/data/items) |
| piece-of-archer-armor | 1 | item ausente do catálogo (packages/content/data/items) |
| piece-of-crocodile-leather | 3 | item ausente do catálogo (packages/content/data/items) |
| piece-of-dead-brain | 4 | item ausente do catálogo (packages/content/data/items) |
| piece-of-draconian-steel | 2 | item ausente do catálogo (packages/content/data/items) |
| piece-of-hell-steel | 1 | item ausente do catálogo (packages/content/data/items) |
| piece-of-hellfire-armor | 1 | item ausente do catálogo (packages/content/data/items) |
| piece-of-marble-rock | 4 | item ausente do catálogo (packages/content/data/items) |
| piece-of-massacres-shell | 1 | item ausente do catálogo (packages/content/data/items) |
| piece-of-royal-steel | 3 | item ausente do catálogo (packages/content/data/items) |
| piece-of-swampling-wood | 1 | item ausente do catálogo (packages/content/data/items) |
| piece-of-warrior-armor | 3 | item ausente do catálogo (packages/content/data/items) |
| pieces-of-magic-chalk | 1 | item ausente do catálogo (packages/content/data/items) |
| piercing-bolt | 5 | item ausente do catálogo (packages/content/data/items) |
| piggy-bank | 14 | item ausente do catálogo (packages/content/data/items) |
| pile-of-grave-earth | 2 | item ausente do catálogo (packages/content/data/items) |
| pirate-backpack | 4 | item ausente do catálogo (packages/content/data/items) |
| pirate-bag | 2 | item ausente do catálogo (packages/content/data/items) |
| pirate-coin | 3 | max 10 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| pirate-voodoo-doll | 4 | item ausente do catálogo (packages/content/data/items) |
| pirats-tail | 2 | item ausente do catálogo (packages/content/data/items) |
| plum | 1 | item ausente do catálogo (packages/content/data/items) |
| poison-arrow | 11 | item ausente do catálogo (packages/content/data/items) |
| pomegranate | 4 | item ausente do catálogo (packages/content/data/items) |
| pot | 2 | item ausente do catálogo (packages/content/data/items) |
| potato | 4 | item ausente do catálogo (packages/content/data/items) |
| powder-herb | 2 | item ausente do catálogo (packages/content/data/items) |
| power-bolt | 11 | item ausente do catálogo (packages/content/data/items) |
| prehemoth-claw | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| prickly-pear | 2 | item ausente do catálogo (packages/content/data/items) |
| primal-bag | 1 | item ausente do catálogo (packages/content/data/items) |
| prismatic-bolt | 1 | item ausente do catálogo (packages/content/data/items) |
| psychedelic-tapestry | 1 | item ausente do catálogo (packages/content/data/items) |
| pumpkin | 1 | item ausente do catálogo (packages/content/data/items) |
| pumpkinhead | 1 | item ausente do catálogo (packages/content/data/items) |
| pure-energy | 1 | item ausente do catálogo (packages/content/data/items) |
| purple-robe | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| purple-tome | 5 | item ausente do catálogo (packages/content/data/items) |
| quill | 1 | max 8 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| rainbow-quartz | 7 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| rainbow-trout | 4 | item ausente do catálogo (packages/content/data/items) |
| raspberry | 4 | item ausente do catálogo (packages/content/data/items) |
| rat-cheese | 3 | item ausente do catálogo (packages/content/data/items) |
| rat-god-doll | 1 | item ausente do catálogo (packages/content/data/items) |
| ratmirals-hat | 1 | item ausente do catálogo (packages/content/data/items) |
| red-crystal-fragment | 4 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| red-ectoplasm | 1 | item ausente do catálogo (packages/content/data/items) |
| red-gem | 8 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| red-mushroom | 4 | item ausente do catálogo (packages/content/data/items) |
| red-piece-of-cloth | 23 | item ausente do catálogo (packages/content/data/items) |
| red-rose | 4 | item ausente do catálogo (packages/content/data/items) |
| red-silk-flower | 1 | item ausente do catálogo (packages/content/data/items) |
| red-tome | 2 | item ausente do catálogo (packages/content/data/items) |
| reins | 2 | item ausente do catálogo (packages/content/data/items) |
| reinvigorating-seeds | 1 | item ausente do catálogo (packages/content/data/items) |
| ring-of-the-count | 2 | item ausente do catálogo (packages/content/data/items) |
| ring-of-the-sky | 8 | item ausente do catálogo (packages/content/data/items) |
| rolling-pin | 1 | item ausente do catálogo (packages/content/data/items) |
| root-tentacle | 1 | item ausente do catálogo (packages/content/data/items) |
| rope | 19 | item ausente do catálogo (packages/content/data/items) |
| rotten-meat | 2 | item ausente do catálogo (packages/content/data/items) |
| rotten-piece-of-cloth | 1 | item ausente do catálogo (packages/content/data/items) |
| royal-star | 9 | item ausente do catálogo (packages/content/data/items) |
| royal-tapestry | 1 | item ausente do catálogo (packages/content/data/items) |
| rum-flask | 4 | item ausente do catálogo (packages/content/data/items) |
| sample-of-monster-blood | 1 | item ausente do catálogo (packages/content/data/items) |
| scale-of-gelidrazah | 1 | item ausente do catálogo (packages/content/data/items) |
| scarab-coin | 6 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| scared-frog | 2 | item ausente do catálogo (packages/content/data/items) |
| scorpion-sceptre | 1 | item ausente do catálogo (packages/content/data/items) |
| scroll | 10 | item ausente do catálogo (packages/content/data/items) |
| scroll-of-heroic-deeds | 2 | item ausente do catálogo (packages/content/data/items) |
| sea-serpent-trophy | 1 | item ausente do catálogo (packages/content/data/items) |
| shadow-cowl | 1 | item ausente do catálogo (packages/content/data/items) |
| shadow-herb | 5 | item ausente do catálogo (packages/content/data/items) |
| shard | 1 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| shiver-arrow | 3 | item ausente do catálogo (packages/content/data/items) |
| shovel | 5 | item ausente do catálogo (packages/content/data/items) |
| shrimp | 14 | item ausente do catálogo (packages/content/data/items) |
| silken-bookmark | 5 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| silky-tapestry | 1 | item ausente do catálogo (packages/content/data/items) |
| silver-goblet | 1 | item ausente do catálogo (packages/content/data/items) |
| silver-hand-mirror | 7 | item ausente do catálogo (packages/content/data/items) |
| silver-token | 11 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| simple-arrow | 3 | item ausente do catálogo (packages/content/data/items) |
| simple-jo-staff | 2 | item ausente do catálogo (packages/content/data/items) |
| sinister-book | 1 | item ausente do catálogo (packages/content/data/items) |
| skeleton-decoration | 4 | item ausente do catálogo (packages/content/data/items) |
| skull | 24 | item ausente do catálogo (packages/content/data/items) |
| skull-coin | 3 | item ausente do catálogo (packages/content/data/items) |
| slime-heart | 2 | max 4 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| sling-herb | 7 | item ausente do catálogo (packages/content/data/items) |
| slingshot | 1 | item ausente do catálogo (packages/content/data/items) |
| small-amethyst | 36 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| small-axe | 8 | item ausente do catálogo (packages/content/data/items) |
| small-blue-pillow | 1 | item ausente do catálogo (packages/content/data/items) |
| small-emerald | 50 | max 12 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| small-enchanted-amethyst | 5 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| small-enchanted-emerald | 4 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| small-enchanted-ruby | 6 | max 5 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| small-enchanted-sapphire | 11 | max 8 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| small-flask-of-eyedrops | 3 | item ausente do catálogo (packages/content/data/items) |
| small-ruby | 50 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| small-stone | 20 | max 10 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| small-topaz | 39 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| small-tortoise | 2 | item ausente do catálogo (packages/content/data/items) |
| sniper-arrow | 7 | item ausente do catálogo (packages/content/data/items) |
| snowball | 3 | item ausente do catálogo (packages/content/data/items) |
| soft-cheese | 3 | item ausente do catálogo (packages/content/data/items) |
| soul-orb | 26 | item ausente do catálogo (packages/content/data/items) |
| soulforged-lantern | 3 | item ausente do catálogo (packages/content/data/items) |
| spatial-warp-almanac | 1 | item ausente do catálogo (packages/content/data/items) |
| spear | 5 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| special-fx-box | 3 | item ausente do catálogo (packages/content/data/items) |
| spectral-scrap-of-cloth | 1 | item ausente do catálogo (packages/content/data/items) |
| spectral-silver-nugget | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| spectral-stone | 1 | item ausente do catálogo (packages/content/data/items) |
| spiderwebs | 1 | item ausente do catálogo (packages/content/data/items) |
| spirit-container | 2 | item ausente do catálogo (packages/content/data/items) |
| spool-of-yarn | 1 | item ausente do catálogo (packages/content/data/items) |
| strand-of-medusa-hair | 2 | item ausente do catálogo (packages/content/data/items) |
| strange-inedible-fruit | 1 | item ausente do catálogo (packages/content/data/items) |
| strawberry | 2 | item ausente do catálogo (packages/content/data/items) |
| strong-health-potion | 62 | item ausente do catálogo (packages/content/data/items) |
| strong-mana-potion | 46 | item ausente do catálogo (packages/content/data/items) |
| stuffed-toad | 1 | item ausente do catálogo (packages/content/data/items) |
| sudden-death-rune | 2 | item ausente do catálogo (packages/content/data/items) |
| sun-fruit | 1 | item ausente do catálogo (packages/content/data/items) |
| supreme-health-potion | 19 | item ausente do catálogo (packages/content/data/items) |
| surprise-bag | 13 | item ausente do catálogo (packages/content/data/items) |
| sweet-smelling-bait | 3 | item ausente do catálogo (packages/content/data/items) |
| sword-hilt | 1 | item ausente do catálogo (packages/content/data/items) |
| tainted-glooth-capsule | 2 | item ausente do catálogo (packages/content/data/items) |
| taiyaki-ice-cream | 1 | item ausente do catálogo (packages/content/data/items) |
| talon | 11 | item ausente do catálogo (packages/content/data/items) |
| tarsal-arrow | 1 | item ausente do catálogo (packages/content/data/items) |
| tattered-piece-of-robe | 1 | item ausente do catálogo (packages/content/data/items) |
| teddy-bear | 1 | item ausente do catálogo (packages/content/data/items) |
| terramite-eggs | 1 | item ausente do catálogo (packages/content/data/items) |
| the-skull-of-a-beast | 1 | item ausente do catálogo (packages/content/data/items) |
| throwing-knife | 5 | max 4 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| throwing-star | 13 | max 18 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| tinged-pot | 1 | item ausente do catálogo (packages/content/data/items) |
| tomato | 1 | item ausente do catálogo (packages/content/data/items) |
| tooth-of-tazhadur | 1 | item ausente do catálogo (packages/content/data/items) |
| torch | 27 | item ausente do catálogo (packages/content/data/items) |
| tortoise-egg | 2 | item ausente do catálogo (packages/content/data/items) |
| toy-spider | 1 | item ausente do catálogo (packages/content/data/items) |
| traditional-sai | 3 | item ausente do catálogo (packages/content/data/items) |
| transcendence-potion | 8 | item ausente do catálogo (packages/content/data/items) |
| trapped-lightning | 1 | item ausente do catálogo (packages/content/data/items) |
| treasure-map | 3 | item ausente do catálogo (packages/content/data/items) |
| troll-green | 4 | item ausente do catálogo (packages/content/data/items) |
| true-book-of-death | 1 | item ausente do catálogo (packages/content/data/items) |
| tusk | 2 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| twigs | 4 | item ausente do catálogo (packages/content/data/items) |
| ultimate-health-potion | 63 | item ausente do catálogo (packages/content/data/items) |
| ultimate-mana-potion | 28 | item ausente do catálogo (packages/content/data/items) |
| ultimate-spirit-potion | 22 | item ausente do catálogo (packages/content/data/items) |
| unholy-bone | 1 | max 5 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| unholy-book | 1 | item ausente do catálogo (packages/content/data/items) |
| unliving-demonbone | 1 | item ausente do catálogo (packages/content/data/items) |
| unrealized-dream | 2 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| valentines-cake | 1 | item ausente do catálogo (packages/content/data/items) |
| vampire-counts-medal | 1 | item ausente do catálogo (packages/content/data/items) |
| vampires-cape-chain | 1 | item ausente do catálogo (packages/content/data/items) |
| vampires-signet-ring | 1 | item ausente do catálogo (packages/content/data/items) |
| varnished-diremaw-legs | 1 | max 4 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| vein-of-ore | 1 | item ausente do catálogo (packages/content/data/items) |
| velvet-tapestry | 1 | item ausente do catálogo (packages/content/data/items) |
| vemiaths-infused-basalt | 1 | item ausente do catálogo (packages/content/data/items) |
| very-noble-looking-watch | 1 | item ausente do catálogo (packages/content/data/items) |
| very-old-piece-of-paper | 1 | item ausente do catálogo (packages/content/data/items) |
| violet-crystal-shard | 12 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| violet-gem | 2 | max 4 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| violet-memory-shard | 1 | item ausente do catálogo (packages/content/data/items) |
| viper-star | 4 | item ausente do catálogo (packages/content/data/items) |
| voluminous-piece-of-cloth | 1 | item ausente do catálogo (packages/content/data/items) |
| voodoo-doll | 4 | item ausente do catálogo (packages/content/data/items) |
| vortex-bolt | 6 | item ausente do catálogo (packages/content/data/items) |
| wad-of-fairy-floss | 1 | item ausente do catálogo (packages/content/data/items) |
| wailing-widows-necklace | 1 | item ausente do catálogo (packages/content/data/items) |
| walnut | 3 | item ausente do catálogo (packages/content/data/items) |
| wand-of-starstorm | 1 | max 10 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| war-drum | 2 | item ausente do catálogo (packages/content/data/items) |
| war-horn | 1 | item ausente do catálogo (packages/content/data/items) |
| warmasters-wristguards | 1 | item ausente do catálogo (packages/content/data/items) |
| watermelon-tourmaline | 2 | item ausente do catálogo (packages/content/data/items) |
| waterskin | 4 | item ausente do catálogo (packages/content/data/items) |
| werebadger-trophy | 1 | item ausente do catálogo (packages/content/data/items) |
| werebear-fur | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| werebear-skull | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| werebear-trophy | 2 | item ausente do catálogo (packages/content/data/items) |
| wereboar-hooves | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| wereboar-loincloth | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| wereboar-trophy | 2 | item ausente do catálogo (packages/content/data/items) |
| wereboar-tusks | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| werecrocodile-trophy | 1 | item ausente do catálogo (packages/content/data/items) |
| werefox-tail | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| werefox-trophy | 2 | item ausente do catálogo (packages/content/data/items) |
| werepanther-claw | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| werepanther-trophy | 2 | item ausente do catálogo (packages/content/data/items) |
| white-gem | 7 | max 3 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| white-knight | 1 | item ausente do catálogo (packages/content/data/items) |
| white-mushroom | 15 | item ausente do catálogo (packages/content/data/items) |
| white-pearl | 14 | max 15 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| white-piece-of-cloth | 8 | item ausente do catálogo (packages/content/data/items) |
| white-silk-flower | 1 | item ausente do catálogo (packages/content/data/items) |
| widows-mandibles | 1 | item ausente do catálogo (packages/content/data/items) |
| wild-flowers | 1 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| witchesbroom | 1 | item ausente do catálogo (packages/content/data/items) |
| wolf-backpack | 3 | item ausente do catálogo (packages/content/data/items) |
| wolf-trophy | 1 | item ausente do catálogo (packages/content/data/items) |
| wood-mushroom | 2 | item ausente do catálogo (packages/content/data/items) |
| wooden-flute | 3 | item ausente do catálogo (packages/content/data/items) |
| wooden-hammer | 1 | item ausente do catálogo (packages/content/data/items) |
| wooden-spoon | 1 | item ausente do catálogo (packages/content/data/items) |
| wooden-trash | 2 | item ausente do catálogo (packages/content/data/items) |
| wooden-whistle | 1 | item ausente do catálogo (packages/content/data/items) |
| worn-leather-boots | 3 | item ausente do catálogo (packages/content/data/items) |
| yellow-darklight-matter | 1 | item ausente do catálogo (packages/content/data/items) |
| yellow-gem | 8 | max 2 pede pilha, e o item não empilha (rollModel "canary" daria 1) |
| yellow-piece-of-cloth | 6 | item ausente do catálogo (packages/content/data/items) |
| yummy-gummy-worm | 1 | item ausente do catálogo (packages/content/data/items) |
| zaoan-monk-robe | 1 | item ausente do catálogo (packages/content/data/items) |
