# Relatório de importação — items

Fonte: `canary` em `47dfd51f45280a59a1d3e50ba7edd573d7234446`.

1965 entidade(s) geradas em 10 fatia(s):

- `amulets.json`: 87
- `armors.json`: 164
- `boots.json`: 61
- `creature-products.json`: 631
- `helmets.json`: 131
- `legs.json`: 66
- `rings.json`: 44
- `shields.json`: 117
- `valuables.json`: 164
- `weapons.json`: 500

## Notas

- 7420 `<item>` lidos das categorias de caça; 5455 fora do corte, 75 por slug duplicado (nome repetido — desambiguação de id fica para quando o primeiro conflito real aparecer).
- Reconciliação (ADR 0014): 37 item(ns) autoral(is) com override gravado em `packages/content/data/items/overrides/` — o id nunca muda, só a correção.
- Preço (`value`, M34-03/#574): o maior `sell` de `data-otservbr-global/npc/*.lua` por `id` do Canary (exceto o Nah'Bob, ver `npc-prices.ts`); `0` quando nenhum NPC vende, ou quando o importador rodou sem `prices`.
- `stackable` nunca declarado (sempre o default `false`): a pilha é um flag de `items.otb`, binário, que este leitor não abre — só `items.xml`.
- Campos lidos e ignorados (sem campo no schema desta base ou fora do escopo): showCount (115), showAttributes (91), shootType (79), augments (75), showduration (73), decayTo (64), loottype (47), mantra (38), transformdeequipto (28), stopduration (27), showattributes (24), showCharges (22), transformequipto (18), lifeleechchance (16), manaleechchance (16), maxhitchance (11), transformDeEquipTo (11), transformEquipTo (10), maxtextlen (6), writeable (6), magicshieldCapacityflat (4), magicshieldCapacitypercent (4), decayto (2), fluidsource (2), fieldabsorbpercentfire (1), invisible (1), manashield (1), perfectShotDamage (1), wrapableto (1).

## Fora do corte (5455)

O pacote de arte 13.32 não desenha, ou o `sim` ainda não executa a mecânica (ADR 0038 decisão 5).
Reimportar recupera automaticamente o que um schema futuro passar a aceitar.

| id | nome | motivo | fonte |
|---|---|---|---|
| 200-theons | 200 Theons | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| 25-years-backpack | 25 years backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| 50-theons | 50 Theons | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| 7197-theons | 7197 Theons | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| abacus | abacus | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| abacus | abacus | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| abyssal-calamary-soul-core | abyssal calamary soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| acid-blob-soul-core | acid blob soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| acid-resistant-fishing-rod | acid resistant fishing rod | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| acolyte-of-darkness-soul-core | acolyte of darkness soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| acolyte-of-the-cult-soul-core | acolyte of the cult soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| adamant-shield | adamant shield | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| adamant-shield | adamant shield | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| adamant-shield | adamant shield | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| adept-of-the-cult-soul-core | adept of the cult soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| adult-goanna-soul-core | adult goanna soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| adventurer-soul-core | adventurer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| advertisement-sign | advertisement sign | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| advertisement-sign | advertisement sign | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| afflicted-strider-soul-core | afflicted strider soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| agave | agave | sem categoria de caça (primarytype "flora and minerals") | `data/items/items.xml` |
| aggressive-fluid | aggressive fluid | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| agrestic-chicken-soul-core | agrestic chicken soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| airtight-cloth | airtight cloth | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| albino-dragon-soul-core | albino dragon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| alchemistic-bookstand | alchemistic bookstand | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| alchemistic-bookstand | alchemistic bookstand | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| alchemistic-bookstand | alchemistic bookstand | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| alchemistic-bookstand | alchemistic bookstand | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| alchemistic-cabinet | alchemistic cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| alchemistic-cabinet | alchemistic cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| alchemistic-chair | alchemistic chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| alchemistic-chair | alchemistic chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| alchemistic-cupboard | alchemistic cupboard | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| alchemistic-scales | alchemistic scales | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| alchemistic-scales | alchemistic scales | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| alchemistic-scales | alchemistic scales | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| alchemistic-scales | alchemistic scales | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| alchemistic-table | alchemistic table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| alchemistic-table | alchemistic table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| alga | alga | sem categoria de caça (primarytype "flora and minerals") | `data/items/items.xml` |
| alga | alga | sem categoria de caça (primarytype "flora and minerals") | `data/items/items.xml` |
| all-knowing-sausages | all knowing sausages | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| all-seeing-tapestry | all-seeing tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| amazon-disguise-kit | amazon disguise kit | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| amazon-soul-core | amazon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| amber-kusarigama | amber kusarigama | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| amber-sickle | amber sickle | sem categoria de caça (primarytype "other items") | `data/items/items.xml` |
| amber-souvenir | amber souvenir | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| amphora | amphora | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| amphora | amphora | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| anatomy-book | anatomy book | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| anchor | anchor | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| anchor | anchor | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| ancient-amulet | ancient amulet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| ancient-dream | ancient dream | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ancient-map | ancient map | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ancient-rune | ancient rune | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ancient-scarab-soul-core | ancient scarab soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ancient-sundial | ancient sundial | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| angel-statue | angel statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| angry-sugar-fairy-soul-core | angry sugar fairy soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| animal-cure | animal cure | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| animal-fetish | animal fetish | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| animate-dead-rune | animate dead rune | sem categoria de caça (primarytype "support runes") | `data/items/items.xml` |
| animated-feather-soul-core | animated feather soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| animated-snowman-soul-core | animated snowman soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| animated-sword | animated sword | sem categoria de caça (primarytype "astral shapers") | `data/items/items.xml` |
| ankh | ankh | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| annihilation-bear | annihilation bear | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| anniversary-backpack | anniversary backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| anniversary-cake | anniversary cake | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| another-yellow-present-kit | another yellow present kit | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| ant-hill | ant-hill | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| ant-trail | ant trail | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| ant-trail | ant trail | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| antidote-potion | antidote potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| antler-talisman | antler talisman | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| anvil | anvil | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| anvil | anvil | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| apocalypse-mushroom | apocalypse mushroom | sem categoria de caça (primarytype "flora and minerals") | `data/items/items.xml` |
| apples | apples | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| arachnophobica-soul-core | arachnophobica soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| arbaziloth-santa | arbaziloth santa | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| arcane-insignia | arcane insignia | sem categoria de caça (primarytype "contest prizes") | `data/items/items.xml` |
| arcane-staff | arcane staff | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| archway | archway | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| archway | archway | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| archway | archway | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| archway | archway | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| archway | archway | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| archway | archway | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| archway | archway | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| arctic-faun-soul-core | arctic faun soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| areca-palm | areca palm | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| arena-banner | arena banner | sem categoria de caça (primarytype "flags") | `data/items/items.xml` |
| armadile-soul-core | armadile soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| armageddon-plans | armageddon plans | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| armillary-sphere | armillary sphere | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| armillary-sphere | armillary sphere | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| armillary-sphere | armillary sphere | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| armillary-sphere | armillary sphere | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| armillary-sphere | armillary sphere | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| armor-rack | armor rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| armor-rack | armor rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| armor-rack-kit | armor rack kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| arrow | arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| arrow-pointing-left | arrow pointing left | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| arrow-pointing-up | arrow pointing up | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| artefact-box | artefact box | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| artist-chest | artist chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| artist-chest | artist chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| artist-chest | artist chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| artist-chest | artist chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| ashes | ashes | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| ashes | ashes | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| ashes | ashes | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| ashes | ashes | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| askarak-demon-soul-core | askarak demon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| askarak-lord-soul-core | askarak lord soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| askarak-prince-soul-core | askarak prince soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| assassin | assassin | sem categoria de caça (primarytype "outlaws") | `data/items/items.xml` |
| assassin-doll | assassin doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| assassin-doll | assassin doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| assassin-doll | assassin doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| assassin-soul-core | assassin soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| astral-glyph | astral glyph | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| astral-shaper-rune | astral shaper rune | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| astral-source | astral source | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| astro-clock | astro clock | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| asuri-talisman | asuri talisman | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| atlas | atlas | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| aubergine | aubergine | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| autumn-sparkle-blossom | autumn sparkle blossom | sem categoria de caça (primarytype "flora and minerals") | `data/items/items.xml` |
| avalanche-rune | avalanche rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| axe-ring | axe ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| azure-carpet | azure carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| azure-frog-soul-core | azure frog soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| baby-bonelord | baby bonelord | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-bonelord | baby bonelord | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-bonelord | baby bonelord | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-bonelord | baby bonelord | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-brain-squid | Baby Brain Squid | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-brain-squid | Baby Brain Squid | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-dragon | baby dragon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-dragon | baby dragon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-elephant | baby elephant | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-elephant | baby elephant | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-hedgehog | baby hedgehog | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-hedgehog | baby hedgehog | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-hedgehog | baby hedgehog | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-munster | baby Munster | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| baby-munster | baby Munster | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| baby-polar-bear | baby polar bear | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-polar-bear | baby polar bear | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-polar-bear | baby polar bear | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-polar-bear | baby polar bear | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-rotworm | baby rotworm | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| baby-rotworm | baby rotworm | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| baby-rotworm | baby rotworm | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| baby-rotworm | baby rotworm | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| baby-rotworm | baby rotworm | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| baby-seal | baby seal | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-seal | baby seal | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-seal | baby seal | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-seal | baby seal | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-seal-doll | baby seal doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| baby-seal-doll | baby seal doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| baby-unicorn | baby unicorn | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-unicorn | baby unicorn | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-vulcongra | Baby Vulcongra | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| baby-vulcongra | Baby Vulcongra | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| back-basket | back basket | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| backpack | backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| bad-dream | bad dream | sem categoria de caça (primarytype "dreamhaunters") | `data/items/items.xml` |
| badbara | Badbara | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| badbara | Badbara | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| badger-fur | badger fur | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| badger-fur | badger fur | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| badger-soul-core | badger soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bag | bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| bag | bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| bait | bait | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| baking-tray | baking tray | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| baking-tray | baking tray | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| baking-tray | baking tray | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| baking-tray | baking tray | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| baleful-bunny-soul-core | baleful bunny soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ballistic-boulder | ballistic boulder | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| balloon-box | balloon box | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-cloth | balloon cloth | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| balloon-no-0 | balloon no.0 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-0 | balloon no.0 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-1 | balloon no.1 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-1 | balloon no.1 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-2 | balloon no.2 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-2 | balloon no.2 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-3 | balloon no.3 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-3 | balloon no.3 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-4 | balloon no.4 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-4 | balloon no.4 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-5 | balloon no.5 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-5 | balloon no.5 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-6 | balloon no.6 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-6 | balloon no.6 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-7 | balloon no.7 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-7 | balloon no.7 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-8 | balloon no.8 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-8 | balloon no.8 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-9 | balloon no.9 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| balloon-no-9 | balloon no.9 | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| bamboo-drawer | bamboo drawer | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bamboo-drawer | bamboo drawer | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bamboo-drawer | bamboo drawer | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bamboo-drawer | bamboo drawer | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bamboo-drawer | bamboo drawer | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bamboo-drawer-kit | bamboo drawer kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bamboo-lamp | bamboo lamp | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| bamboo-lamp | bamboo lamp | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| bamboo-leaves | bamboo leaves | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| bamboo-mat | bamboo mat | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| bamboo-palisade | bamboo palisade | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bamboo-table | bamboo table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bamboo-table | bamboo table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bamboo-table-kit | bamboo table kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bamboo-wall-window | bamboo wall window | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bamboo-wall-window | bamboo wall window | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bambus-jo | bambus jo | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| banana | banana | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| banana-chocolate-shake | banana chocolate shake | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| banana-skin | banana skin | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| bandit-soul-core | bandit soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bane-bringer-soul-core | bane bringer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bane-of-light-soul-core | bane of light soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| banor-doll | banor doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| banor-doll | banor doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| banor-doll | banor doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| banor-doll | banor doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| banshee-soul-core | banshee soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| barbarian-bloodwalker-soul-core | barbarian bloodwalker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| barbarian-brutetamer-soul-core | barbarian brutetamer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| barbarian-headsplitter-soul-core | barbarian headsplitter soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| barbarian-skullhunter-soul-core | barbarian skullhunter soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| barbecue | barbecue | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| bard-doll | bard doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| bard-doll | bard doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| bard-doll | bard doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| bard-doll | bard doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| bard-doll | bard doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| bard-doll | bard doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| bark-peeler | bark peeler | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| barkless-devotee-soul-core | barkless devotee soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| barkless-fanatic-soul-core | barkless fanatic soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| barrel | barrel | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| barrel | barrel | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| barrel-kit | barrel kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| basalt-floor | basalt floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| basalt-wall | basalt wall | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| basalt-wall | basalt wall | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| basalt-wall | basalt wall | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| basalt-wall | basalt wall | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| basalt-wall | basalt wall | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bashmu-soul-core | bashmu soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| basket | basket | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| bass | bass | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| bat | bat | sem categoria de caça (primarytype "bats") | `data/items/items.xml` |
| bat | bat | sem categoria de caça (primarytype "bats") | `data/items/items.xml` |
| bat | bat | sem categoria de caça (primarytype "bats") | `data/items/items.xml` |
| bat | bat | sem categoria de caça (primarytype "bats") | `data/items/items.xml` |
| bat-decoration | bat decoration | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| bat-decoration | bat decoration | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| bat-decoration | bat decoration | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| bat-soul-core | bat soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bath-tub | bath tub | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| bath-tub | bath tub | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| beach-backpack | beach backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| beach-bag | beach bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| bear | bear | sem categoria de caça (primarytype "bears") | `data/items/items.xml` |
| bear | bear | sem categoria de caça (primarytype "bears") | `data/items/items.xml` |
| bear-doll | bear doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| bear-soul-core | bear soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| beautiful-marble-statue | beautiful marble statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| bed | bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| beech | beech | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| beer-barrel | beer barrel | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| beer-barrel | beer barrel | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| beer-barrel | beer barrel | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| beer-barrel | beer barrel | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| beer-bottle | beer bottle | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| beer-cask | beer cask | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| beer-mug | beer mug | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| beer-tap | beer tap | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| bees-ballroom | bees ballroom | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| beetroot | beetroot | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| behemoth-soul-core | behemoth soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| behemoth-taming-stone | behemoth taming stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| behemoth-trophy | behemoth trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| beijinho | beijinho | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| bell | bell | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| bellflower | bellflower | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| bellicose-orger-soul-core | bellicose orger soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bench | bench | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| berrypest-soul-core | berrypest soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| berserk-potion | berserk potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| berserker-chicken-soul-core | berserker chicken soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bestiary-betterment | bestiary betterment | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| betrayed-wraith-soul-core | betrayed wraith soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| big-bone | big bone | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| big-fern | big fern | sem categoria de caça (primarytype "ferns") | `data/items/items.xml` |
| big-reward-box | big reward box | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| big-table-kit | big table kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bill | bill | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| birch | birch | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| bird-nest | bird nest | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| birdcage | birdcage | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| birdcage | birdcage | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| birdcage | birdcage | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| birdcage-kit | birdcage kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| birthday-backpack | birthday backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| birthday-cake | birthday cake | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| birthday-card | birthday card | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| birthday-cup | birthday cup | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| birthday-layer-cake | birthday layer cake | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| biting-book-soul-core | biting book soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bitter-smack-leaf | bitter-smack leaf | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| black-crystal-shards | black crystal shards | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| black-jade-cobra | black jade cobra | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| black-knight | black knight | sem categoria de caça (primarytype "outlaws") | `data/items/items.xml` |
| black-knight-doll | black knight doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| black-knight-doll | black knight doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| black-marble-floor | black marble floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| black-marble-floor | black marble floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| black-marble-floor | black marble floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| black-marble-floor | black marble floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| black-marble-floor | black marble floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| black-marble-floor | black marble floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| black-pit-demon | black pit demon | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| black-raven | black raven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| black-raven | black raven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| black-raven-kit | black raven kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| black-sheep-soul-core | black sheep soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| black-sphinx-acolyte-soul-core | black sphinx acolyte soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| black-token | black token | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| blackboard | blackboard | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| blackboard | blackboard | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| blackboard | blackboard | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| blackboard | blackboard | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| blades | blades | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| bladespark-figurine | bladespark figurine | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blank-imbuement-scroll | blank imbuement scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| blank-paper | blank paper | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| blank-parchment | blank parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| blank-poetry-parchment | blank poetry parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| blank-rune | blank rune | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| blank-zaoan-panel | blank Zaoan panel | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blazing-bonfire | blazing bonfire | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| blazing-bonfire | blazing bonfire | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| blemished-spawn-soul-core | blemished spawn soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| blessed-acorn | blessed acorn | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| blessed-ankh | blessed ankh | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| blessed-steak | blessed steak | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| blessed-wooden-stake | blessed wooden stake | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| blightwalker-dummy | blightwalker dummy | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| blightwalker-soul-core | blightwalker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| blister-egg-plant | blister egg plant | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| blister-egg-plant | blister egg plant | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| bloated-man-maggot-soul-core | bloated man-maggot soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| blob-bomb | blob bomb | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| blood | blood | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| blood-basin | blood basin | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| blood-beast-soul-core | blood beast soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| blood-crab-soul-core | blood crab soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| blood-crystal | blood crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| blood-crystal | blood crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| blood-hand-soul-core | blood hand soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| blood-herb | blood herb | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| blood-herb | blood herb | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| blood-orb | blood orb | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| blood-pagoda | blood pagoda | sem categoria de caça (primarytype "shrines and altars") | `data/items/items.xml` |
| blood-pagoda | blood pagoda | sem categoria de caça (primarytype "shrines and altars") | `data/items/items.xml` |
| blood-priest-soul-core | blood priest soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| blood-skull | blood skull | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blood-vial | blood vial | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| blood-vial | blood vial | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| blood-vial | blood vial | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| bloodkiss-flower | bloodkiss flower | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| bloodstained-crystal | bloodstained crystal | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| blooming-birch | blooming birch | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| blooming-cactus | blooming cactus | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blooming-griffinclaw | blooming griffinclaw | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| blooming-purple-nightshade | blooming purple nightshade | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| blooming-tendrils | blooming tendrils | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blossom-bag | blossom bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| blue-25-years-balloon | blue 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blue-25-years-balloon | blue 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blue-backpack | blue backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| blue-bag | blue bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| blue-balloon | blue balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blue-balloon | blue balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blue-balloon | blue balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blue-bed-kit | blue bed kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-cake-carpet | blue cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| blue-cake-carpet | blue cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| blue-christmas-bundle | blue christmas bundle | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blue-christmas-garland | blue christmas garland | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blue-crystal | blue crystal | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| blue-crystal-rods | blue crystal rods | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| blue-crystals | blue crystals | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| blue-djinn-soul-core | blue djinn soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| blue-ectoplasm | blue ectoplasm | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| blue-ectoplasm | blue ectoplasm | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| blue-ectoplasmic-residue | blue ectoplasmic residue | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| blue-fireworks-powder | blue fireworks powder | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| blue-fireworks-rocket | blue fireworks rocket | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| blue-footboard | blue footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-footboard | blue footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-footboard | blue footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-footboard | blue footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-gingerbread-heart | blue gingerbread heart | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| blue-glowing-mushroom | blue glowing mushroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| blue-headboard | blue headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-headboard | blue headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-headboard | blue headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-headboard | blue headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-headboard | blue headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-headboard | blue headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-marble | blue marble | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| blue-memory-shard | blue memory shard | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| blue-note | blue note | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| blue-pillow | blue pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blue-pit-demon | blue pit demon | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| blue-pollen | blue pollen | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| blue-powder | blue powder | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| blue-present-kit | blue present kit | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blue-rose | blue rose | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| blue-round-cushion | blue round cushion | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blue-shark-trophy | blue shark trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| blue-shrine-stone | blue shrine stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| blue-snail | blue snail | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| blue-sphere | blue sphere | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| blue-spores | blue spores | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| blue-square-cushion | blue square cushion | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blue-tapestry | blue tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blue-tapestry | blue tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blue-tibia-carpet | blue Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| blue-tibia-carpet | blue Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| blue-tome | blue tome | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| blue-traditional-chair | blue traditional chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-traditional-chair | blue traditional chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-traditional-chair | blue traditional chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-traditional-chair | blue traditional chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-traditional-rack | blue traditional rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-traditional-rack | blue traditional rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-traditional-table | blue traditional table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-wall-hangings | blue wall hangings | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| blue-wallpaper | blue wallpaper | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| blue-wooden-candelabra | blue wooden candelabra | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-wooden-candelabra | blue wooden candelabra | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-wooden-candelabra | blue wooden candelabra | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| blue-wooden-candelabra | blue wooden candelabra | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bluebeak-soul-core | bluebeak soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| blueberry | blueberry | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| blueberry-bush | blueberry bush | sem categoria de caça (primarytype "bushes") | `data/items/items.xml` |
| blueberry-bush | blueberry bush | sem categoria de caça (primarytype "bushes") | `data/items/items.xml` |
| blueberry-cupcake | blueberry cupcake | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| blurred-transcript | blurred transcript | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| boar-man-soul-core | boar man soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| boar-soul-core | boar soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bog-fingers-plant | bog fingers plant | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| bog-frog-soul-core | bog frog soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bog-raider-soul-core | bog raider soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bog-water | bog water | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| bollard | bollard | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| bolt | bolt | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| bone | bone | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| bone | bone | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| bone | bone | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| bone-bed | bone bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bone-bed | bone bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bone-bed | bone bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bone-bed | bone bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bone-bed | bone bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bone-bed | bone bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bone-fiddle | bone fiddle | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| bone-flute | bone flute | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| bone-key | bone key | sem categoria de caça (primarytype "keys") | `data/items/items.xml` |
| bone-meal | bone meal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| bone-pile | bone pile | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| bone-spiked-club | bone spiked club | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| bone-spiked-club | bone spiked club | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| bone-totem | bone totem | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| bonebeast-soul-core | bonebeast soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bonebeast-trophy | bonebeast trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| bonelord-balloon | bonelord balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| bonelord-balloon | bonelord balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| bonelord-balloon | bonelord balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| bonelord-soul-core | bonelord soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bongo-drum | bongo drum | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| bony-rod | bony rod | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| bony-rod | bony rod | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| bony-sea-devil-soul-core | bony sea devil soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| boogy-soul-core | boogy soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| book-backpack | book backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| bookcase | bookcase | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bookcase | bookcase | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bookcase | bookcase | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bookcase | bookcase | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bookcase | bookcase | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bookcase | bookcase | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bookcase-kit | bookcase kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| bookworm-doll | bookworm doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| boots-of-homecoming | boots of homecoming | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| botany-almanach | botany almanach | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| bottle | bottle | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| bounty-talisman | bounty talisman | sem categoria de caça (primarytype "extra slot") | `data/items/items.xml` |
| bowl | bowl | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| box | box | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| box | box | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| box | box | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| brachiodemon-soul-core | brachiodemon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| brachiodemon-trophy | brachiodemon trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| brain-squid-soul-core | brain squid soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| braindeath-soul-core | braindeath soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bramble-wyrmling-soul-core | bramble wyrmling soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| branch | branch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| branch | branch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| branch | branch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| branch | branch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| branch | branch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| branch | branch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| branch | branch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| branch | branch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| branches | branches | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| branches | branches | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| branches | branches | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| branchy-crawler-soul-core | branchy crawler soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| brass-shod-chest | brass-shod chest | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| brass-shod-chest | brass-shod chest | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| breach-brood-soul-core | breach brood soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bread | bread | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| brick-wall | brick wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| bricklayers-kit | bricklayers' kit | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| bride-of-night-soul-core | bride of night soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| brigadeiro | brigadeiro | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| brimstone-bug-soul-core | brimstone bug soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| brinebrute-inferniarch-soul-core | brinebrute inferniarch soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| brocade-backpack | brocade backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| brocade-bag | brocade bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| brocade-tapestry | brocade tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| broccoli | broccoli | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| broken-bell | broken bell | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| broken-bottle | broken bottle | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| broken-brown-glass | broken brown glass | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| broken-brown-glass | broken brown glass | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| broken-compass | broken compass | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| broken-dream | broken dream | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| broken-flask | broken flask | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| broken-flask | broken flask | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| broken-green-glass | broken green glass | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| broken-iks-spear | broken Iks spear | arremessável/munição sem lançador (M34-04, fora do escopo) | `data/items/items.xml` |
| broken-machine | broken machine | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| broken-machine | broken machine | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| broken-machine | broken machine | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| broken-machine | broken machine | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| broken-nacre-altar | broken nacre altar | sem categoria de caça (primarytype "shrines and altars") | `data/items/items.xml` |
| broken-obelisk | broken obelisk | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| broken-opticorder-forge | broken opticorder forge | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| broken-opticording-sphere | broken opticording sphere | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| broken-piggy-bank | broken piggy bank | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| broken-pottery | broken pottery | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| broken-pottery | broken pottery | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| broken-shaper-soul-core | broken shaper soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| broken-stone-pillar | broken stone pillar | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| broken-stone-pillar | broken stone pillar | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| broken-stone-pillar | broken stone pillar | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| broken-sword | broken sword | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| broken-wooden-shield | broken wooden shield | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| bronze-cup | bronze cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| bronze-cup | bronze cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| bronze-cup | bronze cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| bronze-cup | bronze cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| bronze-cup | bronze cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| bronze-deed | bronze deed | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| bronze-gear-wheel | bronze gear wheel | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| bronze-goblet | bronze goblet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| bronze-goblet | bronze goblet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| bronze-hunter-trophy | bronze hunter trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| bronze-prison-key | bronze prison key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| bronze-warrior-trophy | bronze warrior trophy | sem categoria de caça (primarytype "contest prizes") | `data/items/items.xml` |
| broodrider-inferniarch-soul-core | broodrider inferniarch soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| broom | broom | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| brown-bread | brown bread | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| brown-flask | brown flask | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| brown-mushroom | brown mushroom | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| brown-pavement | brown pavement | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| brown-pit-demon | brown pit demon | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| brown-shark-trophy | brown shark trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| brush | brush | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| bubbles | bubbles | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| bucket | bucket | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| bucket | bucket | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| bucket | bucket | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| bug-meat | bug meat | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| bug-soul-core | bug soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| buggy-backpack | buggy backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| bullseye-potion | bullseye potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| bulltaur-alchemist-soul-core | bulltaur alchemist soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bulltaur-brute-soul-core | bulltaur brute soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bulltaur-forgepriest-soul-core | bulltaur forgepriest soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bunting | bunting | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| buoy | buoy | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| burn-out-bonfire | burn out bonfire | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| burning-book-soul-core | burning book soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| burning-gladiator-soul-core | burning gladiator soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| burning-heart | burning heart | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| burning-sugar-cane | burning sugar cane | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| burning-wall | burning wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| burning-wall | burning wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| burning-wall | burning wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| burning-wall | burning wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| burnt-down-firewood | burnt down firewood | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| burnt-down-rainbow-torch | burnt down rainbow torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| burnt-down-torch | burnt down torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| burnt-out-devourer-core | burnt out devourer core | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| burnt-scroll | burnt scroll | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| burst-arrow | burst arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| burst-arrow | burst arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| burster-spectre-soul-core | burster spectre soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| bush | bush | sem categoria de caça (primarytype "bushes") | `data/items/items.xml` |
| butterfly-soul-core-blue | butterfly soul core (blue) | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| butterfly-soul-core-purple | butterfly soul core (purple) | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| butterfly-soul-core-red | butterfly soul core (red) | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cabinet | cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cabinet | cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cabinet | cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cabinet | cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cake | cake | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| cake | cake | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| cake-backpack | cake backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| cake-cabinet | cake cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cake-cabinet | cake cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cake-cabinet-kit | cake cabinet kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cake-golem-soul-core | cake golem soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cake-tapestry | cake tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| calamary | calamary | sem categoria de caça (primarytype "mollusks") | `data/items/items.xml` |
| calamary-soul-core | calamary soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| calibrated-indicator-gauge | calibrated indicator gauge | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| camouflage-backpack | camouflage backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| camouflage-bag | camouflage bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| can | can | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| candelabrum | candelabrum | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| candied-fruit | candied fruit | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| candied-fruit | candied fruit | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| candle-stump | candle stump | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| candlestick | candlestick | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| candy | candy | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| candy-cane | candy cane | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| candy-canes | candy canes | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| candy-floss | candy floss | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| candy-floss | candy floss | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| candy-floss-elemental-soul-core | candy floss elemental soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| candy-horror-soul-core | candy horror soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| candy-lure | candy lure | sem categoria de caça (primarytype "other items") | `data/items/items.xml` |
| canopic-jar | canopic jar | sem categoria de caça (primarytype "traps") | `data/items/items.xml` |
| canopy-bed | canopy bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| canopy-bed | canopy bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| canopy-bed | canopy bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| canopy-bed | canopy bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| canopy-bed | canopy bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| canopy-bed | canopy bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| canopy-bed | canopy bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| canopy-bed | canopy bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| canopy-bed | canopy bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| canopy-bed | canopy bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| canopy-bed | canopy bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| canopy-bed | canopy bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| canopy-bed-kit | canopy bed kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| canopy-footboard | canopy footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| canopy-footboard | canopy footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| canopy-footboard | canopy footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| canopy-footboard | canopy footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| canopy-headboard | canopy headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| canopy-headboard | canopy headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| canopy-headboard | canopy headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| canopy-headboard | canopy headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| canopy-headboard | canopy headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| canopy-headboard | canopy headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| capricious-phantom-soul-core | capricious phantom soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| captured-merchant | captured merchant | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| captured-wolf | captured wolf | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| carlin-banner | Carlin banner | sem categoria de caça (primarytype "flags") | `data/items/items.xml` |
| carniphila-dummy | carniphila dummy | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| carniphila-soul-core | carniphila soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| carnivorous-plant | carnivorous plant | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| carnivorous-plant | carnivorous plant | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| carnivostrich-soul-core | carnivostrich soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| carpet-box | carpet box | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| carrion-casserole | carrion casserole | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| carrion-worm | carrion worm | sem categoria de caça (primarytype "annelids") | `data/items/items.xml` |
| carrion-worm-soul-core | carrion worm soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| carrot | carrot | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| carrot | carrot | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| carrot-cake | carrot cake | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| carrot-pie | carrot pie | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| carrots | carrots | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| carrying-device | carrying device | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| cart | cart | sem categoria de caça (primarytype "transportation") | `data/items/items.xml` |
| carved-stone-table | carved stone table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| castle-flag | castle flag | sem categoria de caça (primarytype "flags") | `data/items/items.xml` |
| cat-basket | cat basket | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| cat-soul-core | cat soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cauliflower | cauliflower | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| cave-chimera-soul-core | cave chimera soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cave-devourer-soul-core | cave devourer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cave-entrance | cave entrance | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| cave-entrance | cave entrance | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| cave-parrot-soul-core | cave parrot soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cave-rat | cave rat | sem categoria de caça (primarytype "glires") | `data/items/items.xml` |
| cave-rat-soul-core | cave rat soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cave-turnip | cave turnip | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| centipede-soul-core | centipede soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cerberus-champion-puppy | cerberus champion puppy | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| cerberus-champion-puppy | cerberus champion puppy | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| ceremonial-ankh | ceremonial ankh | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| certificate | certificate | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| chakoya-toolshaper-soul-core | chakoya toolshaper soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| chakoya-tribewarden-soul-core | chakoya tribewarden soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| chakoya-windcaller-soul-core | chakoya windcaller soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| chalk | chalk | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| chameleon-rune | chameleon rune | sem categoria de caça (primarytype "support runes") | `data/items/items.xml` |
| changing-backpack | changing backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| chaos-critical-dice | chaos critical dice | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| chaos-critical-dice | chaos critical dice | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| chaos-matter | chaos matter | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| chargeable-compass | chargeable compass | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| charged-alicorn-ring | charged alicorn ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| charged-arboreal-ring | charged arboreal ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| charged-arcanomancer-sigil | charged arcanomancer sigil | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| charged-ethereal-ring | charged ethereal ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| charged-flame | charged flame | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| charged-flame | charged flame | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| charged-ghost-charm | charged ghost charm | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| charged-ghost-pacifier | charged ghost pacifier | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| charged-spiritthorn-ring | charged spiritthorn ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| charm-upgrade | charm upgrade | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| chasm-spawn-soul-core | chasm spawn soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cheese | cheese | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| cheese-cookie | cheese cookie | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| cheesy-key | cheesy key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| cherry | cherry | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| cherry-blossom-tree | cherry blossom tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| chest | chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| chest | chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| chest | chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| chest | chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| chest | chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| chest | chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| chest | chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| chest | chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| chest | chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| chicken-soul-core | chicken soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| chill-nettle | chill nettle | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| chilli-con-carniphila | chilli con carniphila | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| chimney | chimney | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| chimney | chimney | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| chimney | chimney | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| chimney | chimney | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| chimney | chimney | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| chimney-kit | chimney kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| chisel | chisel | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| chocolate-blob-soul-core | chocolate blob soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| chocolate-cake | chocolate cake | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| choking-fear-soul-core | choking fear soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| chopped-lion-mane-petals | chopped lion mane petals | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| christmas-card | christmas card | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| christmas-cookie-tray | christmas cookie tray | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| christmas-garland | christmas garland | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| christmas-present-bag | christmas present bag | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| christmas-tree | christmas tree | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| christmas-tree-package | christmas tree package | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| christmas-wreath | christmas wreath | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| christmas-wreath | christmas wreath | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| christmas-wreath | christmas wreath | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| churned-ground | churned ground | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| churro-heart | churro heart | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| cigar | cigar | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| cinder-wyrmling-soul-core | cinder wyrmling soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| clay-guardian-soul-core | clay guardian soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| clay-lump | clay lump | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| clay-pot | clay pot | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| clay-statue | clay statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| cleansed-soul-splinter | cleansed soul splinter | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| cleaver | cleaver | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| cliff-strider-soul-core | cliff strider soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cloak-of-terror-soul-core | cloak of terror soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| clomp-soul-core | clomp soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| closed-fence-gate | closed fence gate | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| closed-fence-gate | closed fence gate | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| closed-gate | closed gate | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| closed-gate | closed gate | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| closed-gate | closed gate | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| closed-gate | closed gate | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| closed-gate | closed gate | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| closed-silvered-trap | closed silvered trap | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| closed-trap | closed trap | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| closed-trap | closed trap | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| closed-trapdoor | closed trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| closed-trapdoor | closed trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| closed-trapdoor | closed trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| club-ring | club ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| coal-basin-kit | coal basin kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cobbled-pavement | cobbled pavement | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| cobbled-pavement | cobbled pavement | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| cobra-assassin-soul-core | cobra assassin soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cobra-axe | cobra axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| cobra-bo | cobra bo | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| cobra-club | cobra club | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| cobra-scout-soul-core | cobra scout soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cobra-soul-core | cobra soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cobra-statue | cobra statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| cobra-statue | cobra statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| cobra-sword | cobra sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| cobra-vizier-soul-core | cobra vizier soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cobrafang-dagger | cobrafang dagger | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| cocktail-glass | cocktail glass | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| coconut | coconut | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| coconut-palm | coconut palm | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| coconut-palm | coconut palm | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| coconut-shrimp-bake | coconut shrimp bake | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| colourful-balloons | colourful balloons | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| colourful-balloons | colourful balloons | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| colourful-balloons | colourful balloons | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| colourful-carpet | colourful carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| colourful-fireworks-rocket | colourful fireworks rocket | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| colourful-mushroom | colourful mushroom | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| colourful-water-lily | colourful water lily | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| comb | comb | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| comfy-cabinet | comfy cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| comfy-cabinet | comfy cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| comfy-chair | comfy chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| comfy-chair | comfy chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| comfy-chair | comfy chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| comfy-chair | comfy chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| comfy-chest | comfy chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| comfy-chest | comfy chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| comfy-chest | comfy chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| comfy-chest | comfy chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| comfy-table | comfy table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| comfy-table | comfy table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| complete-opticording-sphere | complete opticording sphere | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| compromising-letter | compromising letter | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| conch-shell-horn | conch shell horn | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| consecrated-beef | consecrated beef | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| contract | contract | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| control-unit | control unit | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| converter-soul-core | converter soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| convince-creature-rune | convince creature rune | sem categoria de caça (primarytype "support runes") | `data/items/items.xml` |
| cookbook | cookbook | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| cookie | cookie | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| cool-gloothy-mixture | cool gloothy mixture | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| copper-key | copper key | sem categoria de caça (primarytype "keys") | `data/items/items.xml` |
| copper-prison-key | copper prison key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| copper-roof | copper roof | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| copper-valve | copper valve | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| copper-valve | copper valve | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| coral-comb | coral comb | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| coral-frog-soul-core | coral frog soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| core-dispenser | core dispenser | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| core-dispenser | core dispenser | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| corkscrew-stairs | corkscrew stairs | sem categoria de caça (primarytype "stairs") | `data/items/items.xml` |
| corkscrew-stairs | corkscrew stairs | sem categoria de caça (primarytype "stairs") | `data/items/items.xml` |
| corkscrew-stairs | corkscrew stairs | sem categoria de caça (primarytype "stairs") | `data/items/items.xml` |
| cormo-dementi | cormo dementi | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| cormo-dementi | cormo dementi | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| cormo-dementi | cormo dementi | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| corms | corms | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| corncob | corncob | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| corned-fish | corned fish | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| cornucopia | cornucopia | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| cornucopia | cornucopia | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| corym-charlatan-soul-core | corym charlatan soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| corym-skirmisher-soul-core | corym skirmisher soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| corym-vanguard-soul-core | corym vanguard soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cot | cot | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| cot | cot | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| cot | cot | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| cot | cot | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| cot | cot | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| cot | cot | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| cot | cot | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| cot | cot | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| cot | cot | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| cot | cot | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| cot | cot | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| cot | cot | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| cot-footboard | cot footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cot-footboard | cot footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cot-footboard | cot footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cot-footboard | cot footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cot-headboard | cot headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cot-headboard | cot headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cot-headboard | cot headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cot-headboard | cot headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cot-headboard | cot headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| cot-headboard | cot headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| counter | counter | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| counter | counter | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| courage-leech-soul-core | courage leech soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cow-soul-core | cow soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crab-soul-core | crab soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cracked-stone | cracked stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| crackling-egg | crackling egg | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| crane-plant | crane plant | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| crape-man-soul-core | crape man soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crate | crate | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| crate | crate | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| crate | crate | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| crate | crate | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| crate | crate | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| crate | crate | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| crate | crate | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| crate | crate | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| crate | crate | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| crawler-soul-core | crawler soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crazed-beggar-soul-core | crazed beggar soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crazed-summer-rearguard-soul-core | crazed summer rearguard soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crazed-summer-vanguard-soul-core | crazed summer vanguard soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crazed-winter-rearguard-soul-core | crazed winter rearguard soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crazed-winter-vanguard-soul-core | crazed winter vanguard soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cream-blob-soul-core | cream blob soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cream-cake | cream cake | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| crimson-carpet | crimson carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| crimson-crest-mushroom | crimson crest mushroom | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| crimson-crest-mushroom | crimson crest mushroom | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| crimson-fin | crimson fin | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| crimson-fin | crimson fin | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| crimson-fin | crimson fin | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| crimson-frog-soul-core | crimson frog soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crimson-nightshade-blossoms | crimson nightshade blossoms | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| crimson-rose | crimson rose | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| crimson-sword | crimson sword | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| crocodile-soul-core | crocodile soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crocodile-steak | crocodile steak | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| crown | crown | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| crown-backpack | crown backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| crucible | crucible | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| crucible | crucible | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| crucible | crucible | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| crucible | crucible | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| crude-lava-pump | crude lava pump | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| crude-primitive-printout | crude primitive printout | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| crude-treadmill | crude treadmill | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| crude-treadmill | crude treadmill | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| crude-umbral-katar | crude umbral katar | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| crude-wood-planks | crude wood planks | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| crumpled-paper | crumpled paper | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| crusader-soul-core | crusader soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crusher | crusher | sem categoria de caça (primarytype "nenhum") | `data/items/items.xml` |
| crustacea-gigantica-soul-core | crustacea gigantica soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cryana | Cryana | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| cryana | Cryana | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| crypt-defiler-soul-core | crypt defiler soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crypt-shambler-soul-core | crypt shambler soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crypt-warden-soul-core | crypt warden soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crypt-warrior-soul-core | crypt warrior soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crystal | crystal | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| crystal-arrow | crystal arrow | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| crystal-backpack | crystal backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| crystal-ball | crystal ball | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| crystal-ball | crystal ball | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| crystal-ball | crystal ball | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| crystal-cannon | crystal cannon | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| crystal-cannon | crystal cannon | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| crystal-column | crystal column | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| crystal-column | crystal column | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| crystal-column | crystal column | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| crystal-column | crystal column | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| crystal-column | crystal column | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| crystal-column | crystal column | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| crystal-column | crystal column | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| crystal-column | crystal column | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| crystal-column | crystal column | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| crystal-column | crystal column | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| crystal-glass-floor | crystal glass floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| crystal-key | crystal key | sem categoria de caça (primarytype "keys") | `data/items/items.xml` |
| crystal-lamp | crystal lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| crystal-ring | crystal ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| crystal-rubbish | crystal rubbish | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| crystal-spider-soul-core | crystal spider soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crystal-table | crystal table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| crystal-table-kit | crystal table kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| crystal-trail | crystal trail | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| crystal-wall | crystal wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| crystal-wolf-soul-core | crystal wolf soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crystalcrusher-soul-core | crystalcrusher soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| crystalline-arrow | crystalline arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| crystallized-salt | crystallized salt | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| crystals | crystals | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| crystals | crystals | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| cuckoo-clock | cuckoo clock | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| cuckoo-clock | cuckoo clock | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| cuckoo-clock | cuckoo clock | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| cuckoo-clock | cuckoo clock | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| cuckoo-clock | cuckoo clock | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| cuckoo-clock | cuckoo clock | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| cucumber | cucumber | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| cult-believer-soul-core | cult believer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cult-enforcer-soul-core | cult enforcer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cult-object | cult object | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| cult-object | cult object | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| cult-scholar-soul-core | cult scholar soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cunning-werepanther-soul-core | cunning werepanther soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cup | cup | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| cupboard | cupboard | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| cupboard | cupboard | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| cure-poison-rune | cure poison rune | sem categoria de caça (primarytype "nenhum") | `data/items/items.xml` |
| cursed-ape-soul-core | cursed ape soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cursed-book-soul-core | cursed book soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cursed-gold | cursed gold | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| cursed-prospector-soul-core | cursed prospector soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cyclops-balloon | cyclops balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| cyclops-balloon | cyclops balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| cyclops-balloon | cyclops balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| cyclops-drone-soul-core | cyclops drone soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cyclops-head-balloon | cyclops head balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| cyclops-head-balloon | cyclops head balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| cyclops-head-balloon | cyclops head balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| cyclops-smith-soul-core | cyclops smith soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cyclops-soul-core | cyclops soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| cyclops-trophy | cyclops trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| damaged-crystal | damaged crystal | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| damaged-crystal | damaged crystal | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| damaged-crystal-golem-soul-core | damaged crystal golem soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| damaged-logbook | damaged logbook | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| damaged-steel-helmet | damaged steel helmet | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| damaged-worker-golem-soul-core | damaged worker golem soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| damselfly-eye | damselfly eye | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| damselfly-wing | damselfly wing | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| dancing-dawn-maiden | dancing dawn maiden | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| dark-apprentice-soul-core | dark apprentice soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dark-bell | dark bell | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| dark-blue-mushroom | dark blue mushroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| dark-carnisylvan-soul-core | dark carnisylvan soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dark-cypress | dark cypress | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| dark-cypress | dark cypress | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| dark-essence | dark essence | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| dark-faun-soul-core | dark faun soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dark-mage-statue | dark mage statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| dark-magician-soul-core | dark magician soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dark-monk-soul-core | dark monk soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dark-moon-mirror | dark moon mirror | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| dark-mushroom | dark mushroom | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| dark-parquet | dark parquet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| dark-parquet-planks | dark parquet planks | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| dark-sun-catcher | dark sun catcher | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| dark-torturer-soul-core | dark torturer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dark-wall | dark wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| dark-wall | dark wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| darklight-construct-soul-core | darklight construct soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| darklight-emitter-soul-core | darklight emitter soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| darklight-matter-soul-core | darklight matter soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| darklight-source-soul-core | darklight source soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| darklight-striker-soul-core | darklight striker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dawn-singer | dawn singer | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| dawnfire-asura-soul-core | dawnfire asura soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dead-explorer | dead explorer | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| dead-holy-bog-frog | dead holy bog frog | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| dead-tree | dead tree | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| dead-tree | dead tree | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| dead-tree | dead tree | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| dead-tree | dead tree | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| death-amplification | death amplification | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| death-blob-soul-core | death blob soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| death-knell | death knell | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| death-priest-soul-core | death priest soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| death-resilience | death resilience | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| death-ring | death ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| death-toll | death toll | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| deathling-scout-soul-core | deathling scout soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| deathling-spellsinger-soul-core | deathling spellsinger soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| debris | debris | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| debris | debris | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| decoration-kit | decoration kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| decorative-blue-sheet | decorative blue sheet | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| decorative-green-sheet | decorative green sheet | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| decorative-red-sheet | decorative red sheet | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| decorative-ribbon | decorative ribbon | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| deep-crystal | deep crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| deepling-backpack | deepling backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| deepling-brawler-soul-core | deepling brawler soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| deepling-elite-soul-core | deepling elite soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| deepling-filet | deepling filet | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| deepling-guard-soul-core | deepling guard soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| deepling-master-librarian-soul-core | deepling master librarian soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| deepling-scout-soul-core | deepling scout soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| deepling-spawn | deepling spawn | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| deepling-spellsinger-soul-core | deepling spellsinger soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| deepling-tyrant-soul-core | deepling tyrant soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| deepling-warrior-soul-core | deepling warrior soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| deepling-worker-soul-core | deepling worker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| deepsea-blood-crab-soul-core | deepsea blood crab soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| deepworm-soul-core | deepworm soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| deer-soul-core | deer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| deer-trophy | deer trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| defiler-soul-core | defiler soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| delicate-pan | delicate pan | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| delicate-vase | delicate vase | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| delicate-vase | delicate vase | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| delicatessen-salad | delicatessen salad | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| demon | demon | sem categoria de caça (primarytype "demons") | `data/items/items.xml` |
| demon | demon | sem categoria de caça (primarytype "demons") | `data/items/items.xml` |
| demon | demon | sem categoria de caça (primarytype "demons") | `data/items/items.xml` |
| demon | demon | sem categoria de caça (primarytype "demons") | `data/items/items.xml` |
| demon | demon | sem categoria de caça (primarytype "demons") | `data/items/items.xml` |
| demon | demon | sem categoria de caça (primarytype "demons") | `data/items/items.xml` |
| demon-backpack | demon backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| demon-baller | demon baller | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| demon-baller | demon baller | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| demon-baller | demon baller | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| demon-baller | demon baller | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| demon-doll | Demon Doll | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| demon-dust | demon dust | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| demon-dust | demon dust | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| demon-dust | demon dust | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| demon-exercise-dummy | demon exercise dummy | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| demon-exercise-dummy | demon exercise dummy | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| demon-in-a-green-box | demon in a green box | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| demon-infant | demon infant | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| demon-infant | demon infant | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| demon-infant | demon infant | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| demon-infant | demon infant | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| demon-infant | demon infant | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| demon-oak-wood | demon oak wood | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| demon-outcast-soul-core | demon outcast soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| demon-parrot-soul-core | demon parrot soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| demon-root | demon root | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| demon-skeleton-soul-core | demon skeleton soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| demon-skull | demon skull | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| demon-skull | demon skull | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| demon-soul-core | demon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| demon-statue | demon statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| demon-statue | demon statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| demon-trophy | demon trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| demon-trophy | demon trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| demonic-candy-ball | demonic candy ball | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| demonic-tapestry | demonic tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| depot-box-i | depot box I | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| depot-box-v | depot box V | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| depot-box-x | depot box X | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| depot-chest | depot chest | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| depth-claws | depth claws | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| depth-galea | depth galea | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| destroy-field-rune | destroy field rune | sem categoria de caça (primarytype "support runes") | `data/items/items.xml` |
| destroyer-soul-core | destroyer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| devourer-core | devourer core | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| devourer-soul-core | devourer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| diabolic-imp-soul-core | diabolic imp soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| diamond-arrow | diamond arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| diamond-arrow | diamond arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| diamond-carpet | diamond carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| diamond-servant-replica-soul-core | diamond servant replica soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| diamond-servant-soul-core | diamond servant soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| diapason | diapason | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| didgeridoo | didgeridoo | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| dinky-moss-floret | dinky moss floret | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| dinky-moss-floret-garland | dinky moss floret garland | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| dire-penguin-soul-core | dire penguin soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| diremaw-soul-core | diremaw soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dirt-wall | dirt wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| dirt-wall | dirt wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| dirt-wall | dirt wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| dirty-cape | dirty cape | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| dirty-fur | dirty fur | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| disgusting-trophy | disgusting trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| disintegrate-rune | disintegrate rune | sem categoria de caça (primarytype "support runes") | `data/items/items.xml` |
| distilling-machine | distilling machine | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| distilling-machine | distilling machine | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| distorted-phantom-soul-core | distorted phantom soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| document | document | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| document | document | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| document | document | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| document | document | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| document | document | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| document | document | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| dog-collar | dog collar | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| dog-house | dog house | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dog-house | dog house | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dog-house | dog house | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dog-house | dog house | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dog-soul-core | dog soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| doll | doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| doll | doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| doom-deer-soul-core | doom deer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| doomsday-cultist-soul-core | doomsday cultist soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| drachaku | drachaku | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| dracoyle-statue | dracoyle statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dracoyle-statue | dracoyle statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dracoyle-statue | dracoyle statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dracoyle-statue | dracoyle statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dragolisk-soul-core | dragolisk soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dragon-backpack | dragon backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| dragon-carpet | dragon carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| dragon-carpet | dragon carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| dragon-chest | dragon chest | sem categoria de caça (primarytype "closets") | `data/items/items.xml` |
| dragon-chest | dragon chest | sem categoria de caça (primarytype "closets") | `data/items/items.xml` |
| dragon-claw | dragon claw | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| dragon-egg-shells | dragon egg shells | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| dragon-eye | dragon eye | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| dragon-flag | dragon flag | sem categoria de caça (primarytype "flags") | `data/items/items.xml` |
| dragon-goblet | dragon goblet | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| dragon-goblet | dragon goblet | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| dragon-goblet | dragon goblet | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| dragon-ham | dragon ham | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| dragon-hatchling-soul-core | dragon hatchling soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dragon-lord-carpet | dragon lord carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| dragon-lord-carpet | dragon lord carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| dragon-lord-hatchling-soul-core | dragon lord hatchling soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dragon-lord-soul-core | dragon lord soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dragon-lord-trophy | dragon lord trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| dragon-pinata-kit | dragon pinata kit | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dragon-plant | dragon plant | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dragon-plant | dragon plant | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dragon-soul-core | dragon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dragon-statue | dragon statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| dragon-statue | dragon statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| dragon-statue | dragon statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| dragon-statue | dragon statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| dragon-statue | dragon statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| dragon-statue | dragon statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| dragon-statue-kit | dragon statue kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| dragon-tapestry | dragon tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dragon-throne | dragon throne | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| dragon-throne | dragon throne | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| dragon-throne-kit | dragon throne kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| dragonbone-tree | dragonbone tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| dragonfetish | dragonfetish | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| dragonfruit | dragonfruit | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| dragonfruit-tree | dragonfruit tree | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| dragonling-soul-core | dragonling soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dragons-nest-tree | dragons nest tree | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| draining-inferniarch-claws | draining inferniarch claws | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| draken-abomination-soul-core | draken abomination soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| draken-doll | draken doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| draken-elite-soul-core | draken elite soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| draken-spellweaver-soul-core | draken spellweaver soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| draken-trophy | draken trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| draken-warmaster-soul-core | draken warmaster soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| draptor-doll | draptor doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| draptor-doll | draptor doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| draptor-doll | draptor doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| draptor-doll | draptor doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| draptor-soul-core | draptor soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| drawbridge | drawbridge | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| drawer | drawer | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| drawer | drawer | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| drawer | drawer | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| drawer | drawer | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| drawer-kit | drawer kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| drawing-board | drawing board | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| drawing-board | drawing board | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dread-doll | dread doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| dread-doll | dread doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| dread-intruder-soul-core | dread intruder soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dreadcoil | dreadcoil | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| dream-catcher | dream catcher | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| dream-nebuliser | dream nebuliser | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| dream-sand | dream sand | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| dream-talisman | dream talisman | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| dresser | dresser | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| dresser | dresser | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| dresser | dresser | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| dresser | dresser | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| dresser-kit | dresser kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| drill-bolt | drill bolt | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| drillworm-soul-core | drillworm soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dromedary-soul-core | dromedary soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| druid-pedestal | druid pedestal | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| druid-statue | druid statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| druids-apparition-soul-core | druid's apparition soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| drum | drum | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| drum | drum | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| dry-bush | dry bush | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| dry-floor | dry floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| dry-flower | dry flower | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| dry-grass | dry grass | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| dry-mangrove | dry mangrove | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| dry-mangrove | dry mangrove | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| dry-mangrove | dry mangrove | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| dry-solstice-tree | dry solstice tree | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| dryad-soul-core | dryad soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dung-ball | dung ball | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| durable-exercise-axe | durable exercise axe | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| durable-exercise-bow | durable exercise bow | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| durable-exercise-club | durable exercise club | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| durable-exercise-rod | durable exercise rod | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| durable-exercise-shield | durable exercise shield | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| durable-exercise-sword | durable exercise sword | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| durable-exercise-wand | durable exercise wand | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| durable-exercise-wraps | durable exercise wraps | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| dusk-catcher | dusk catcher | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| duskbringer-soul-core | duskbringer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dustbin | dustbin | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| dusty-amphora | dusty amphora | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| dusty-box | dusty box | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| dwarf-balloon | dwarf balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dwarf-balloon | dwarf balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dwarf-balloon | dwarf balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| dwarf-disguise-kit | dwarf disguise kit | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| dwarf-geomancer-soul-core | dwarf geomancer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dwarf-guard-soul-core | dwarf guard soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dwarf-henchman-soul-core | dwarf henchman soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dwarf-soldier-soul-core | dwarf soldier soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dwarf-soul-core | dwarf soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dwarf-tree | dwarf tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| dwarven-pickaxe | dwarven pickaxe | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| dwarven-ring | dwarven ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| dwarven-stone-cabinet | dwarven stone cabinet | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| dwarven-stone-cabinet | dwarven stone cabinet | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| dwarven-stone-chest | dwarven stone chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| dwarven-stone-chest | dwarven stone chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| dwarven-stone-chest | dwarven stone chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| dwarven-stone-chest | dwarven stone chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| dwarven-stone-table | dwarven stone table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| dworc-fleshhunter-soul-core | dworc fleshhunter soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dworc-shadowstalker-soul-core | dworc shadowstalker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dworc-venomsniper-soul-core | dworc venomsniper soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| dworc-voodoomaster-soul-core | dworc voodoomaster soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| earth-amplification | earth amplification | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| earth-arrow | earth arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| earth-barbarian-axe | earth barbarian axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| earth-blacksteel-sword | earth blacksteel sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| earth-clerical-mace | earth clerical mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| earth-cranial-basher | earth cranial basher | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| earth-crystal-mace | earth crystal mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| earth-dragon-slayer | earth dragon slayer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| earth-elemental-soul-core | earth elemental soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| earth-ground | earth ground | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| earth-ground | earth ground | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| earth-ground | earth ground | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| earth-ground | earth ground | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| earth-headchopper | earth headchopper | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| earth-heroic-axe | earth heroic axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| earth-knight-axe | earth knight axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| earth-mystic-blade | earth mystic blade | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| earth-orcish-maul | earth orcish maul | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| earth-relic-sword | earth relic sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| earth-resilience | earth resilience | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| earth-spike-sword | earth spike sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| earth-war-axe | earth war axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| earth-war-hammer | earth war hammer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| easel-kit | easel kit | sem categoria de caça (primarytype "painting equipment") | `data/items/items.xml` |
| easily-inflammable-sulphur | easily inflammable sulphur | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| easter-egg | easter egg | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| eclesius-sandals | Eclesius' sandals | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ectoplasm-container | ectoplasm container | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ectoplasm-container | ectoplasm container | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ectoplasm-container | ectoplasm container | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ectoplasmic-sushi | ectoplasmic sushi | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| efreet-soul-core | efreet soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| egg | egg | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| egg | egg | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| egg | egg | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| eight-cans | eight cans | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| elder-bonelord-soul-core | elder bonelord soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| elder-forest-fury-soul-core | elder forest fury soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| elder-mummy-soul-core | elder mummy soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| elder-wyrm-soul-core | elder wyrm soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| eldritch-crescent-moon-spade | eldritch crescent moon spade | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| elemental-carpet | elemental carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| elemental-carpet | elemental carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| elemental-crystal | elemental crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| elephant-soul-core | elephant soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| elf-arcanist-soul-core | elf arcanist soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| elf-overseer-soul-core | elf overseer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| elf-scout-soul-core | elf scout soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| elf-soul-core | elf soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| elite-orc-guard | elite orc guard | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| eloise-balloon | Eloise balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| eloise-balloon | Eloise balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| eloise-balloon | Eloise balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| elven-brooch | elven brooch | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| elven-poetry-book | elven poetry book | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| elven-trophy | elven trophy | sem categoria de caça (primarytype "contest prizes") | `data/items/items.xml` |
| elven-vase | elven vase | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| elven-vial | elven vial | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| elvenhair-rope | elvenhair rope | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| emblems | emblems | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| emblems | emblems | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| embroidered-box | embroidered box | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| emerald-carpet | emerald carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| emerald-damselfly-soul-core | emerald damselfly soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| emerald-tortoise-soul-core | emerald tortoise soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| emergency-kit | Emergency kit | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| empty-barrel | empty barrel | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| empty-beer-bottle | empty beer bottle | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| empty-beer-mug | empty beer mug | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| empty-birdcage | empty birdcage | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| empty-cask | empty cask | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| empty-coal-basin | empty coal basin | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| empty-coal-basin | empty coal basin | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| empty-coal-basin | empty coal basin | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| empty-flower-pot | empty flower pot | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| empty-goldfish-bowl | empty goldfish bowl | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| empty-jug | empty jug | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| empty-kraken-shelf | empty kraken shelf | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| empty-kraken-shelf | empty kraken shelf | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| empty-receptacle | empty receptacle | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| empty-ritual-flask | empty ritual flask | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| empty-starlight-vial | empty starlight vial | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| empty-storage-flask | empty storage flask | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| enchanted-blister-ring | enchanted blister ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| enchanted-merudri-brooch | enchanted merudri brooch | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| enchanted-pendulet | enchanted pendulet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| enchanted-sleep-shawl | enchanted sleep shawl | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| enchanted-theurgic-amulet | enchanted theurgic amulet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| enchanted-turtle-amulet | enchanted turtle amulet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| enchanted-werewolf-amulet | enchanted werewolf amulet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| enchanted-werewolf-helmet | enchanted werewolf helmet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| enchanted-werewolf-helmet | enchanted werewolf helmet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| enchanted-werewolf-helmet | enchanted werewolf helmet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| enchanted-werewolf-helmet | enchanted werewolf helmet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| enchanted-werewolf-helmet | enchanted werewolf helmet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| energetic-backpack | energetic backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| energetic-book-soul-core | energetic book soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| energized-demonbone | energized demonbone | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energuardian-of-tales-soul-core | energuardian of tales soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| energy-amplification | energy amplification | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| energy-bar | energy bar | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| energy-barbarian-axe | energy barbarian axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energy-blacksteel-sword | energy blacksteel sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energy-bomb-rune | energy bomb rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| energy-clerical-mace | energy clerical mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energy-cranial-basher | energy cranial basher | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energy-crystal-mace | energy crystal mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energy-dragon-slayer | energy dragon slayer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energy-drink | energy drink | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| energy-elemental-soul-core | energy elemental soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| energy-field-rune | energy field rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| energy-generator | energy generator | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| energy-headchopper | energy headchopper | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energy-heroic-axe | energy heroic axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energy-knight-axe | energy knight axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energy-mystic-blade | energy mystic blade | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energy-net | energy net | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| energy-orcish-maul | energy orcish maul | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energy-portal | energy portal | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| energy-portal | energy portal | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| energy-relic-sword | energy relic sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energy-resilience | energy resilience | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| energy-ring | energy ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| energy-spike-sword | energy spike sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energy-vein | energy vein | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| energy-wall-rune | energy wall rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| energy-war-axe | energy war axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| energy-war-hammer | energy war hammer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| enfeebled-silencer-soul-core | enfeebled silencer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| enigmatic-voodoo-skull | enigmatic voodoo skull | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| enlightened-of-the-cult-soul-core | enlightened of the cult soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| enormous-tree | enormous tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| enormous-tree | enormous tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| enraged-crystal-golem-soul-core | enraged crystal golem soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| enslaved-dwarf-soul-core | enslaved dwarf soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| envenomed-arrow | envenomed arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| epaulette | epaulette | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| etcher | etcher | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| eternal-guardian-soul-core | eternal guardian soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ether-captor | ether captor | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| ether-captor | ether captor | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| ether-captor | ether captor | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| evil-prospector-soul-core | evil prospector soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| evil-sheep-lord-soul-core | evil sheep lord soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| evil-sheep-soul-core | evil sheep soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| evilina | Evilina | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| evilina | Evilina | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| evora | Evora | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| evora | Evora | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| evora | Evora | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| evora | Evora | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| exaltation-chest | exaltation chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| execowtioner-soul-core | execowtioner soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| exercise-axe | exercise axe | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| exercise-bow | exercise bow | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| exercise-club | exercise club | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| exercise-dummy | exercise dummy | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| exercise-dummy | exercise dummy | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| exercise-rod | exercise rod | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| exercise-shield | exercise shield | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| exercise-sword | exercise sword | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| exercise-wand | exercise wand | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| exercise-wraps | exercise wraps | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| exotic-bat-soul-core | exotic bat soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| exotic-cave-spider-soul-core | exotic cave spider soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| exotic-flowers | exotic flowers | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| exotic-flowers | exotic flowers | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| expedition-backpack | expedition backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| expedition-bag | expedition bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| exploding-cookie | exploding cookie | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| explorer-brooch | explorer brooch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| explosion-rune | explosion rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| explosive-barrel | explosive barrel | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| explosive-barrel | explosive barrel | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| explosive-barrel | explosive barrel | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| explosive-barrel | explosive barrel | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| exquisite-silk | exquisite silk | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| exquisite-wood | exquisite wood | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| exultant-ritual-figurine | exultant ritual figurine | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| eye-key | eye key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| eye-pod | eye pod | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| eyeless-devourer-soul-core | eyeless devourer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| faded-last-will | faded last will | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| fae-talisman | fae talisman | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| fairy-queen | fairy queen | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| fake-dwarven-beard | fake dwarven beard | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| faked-label | faked label | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| falcon-knight-soul-core | falcon knight soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| falcon-order-flag | falcon order flag | sem categoria de caça (primarytype "flags") | `data/items/items.xml` |
| falcon-paladin-soul-core | falcon paladin soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| falcon-pet | falcon pet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| falcon-pet | falcon pet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| falcon-pet | falcon pet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| falcon-pet | falcon pet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| falcon-pet | falcon pet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| falcon-pet | falcon pet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| falcon-sai | falcon sai | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| family-banner | family banner | sem categoria de caça (primarytype "flags") | `data/items/items.xml` |
| family-brooch | family brooch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| family-brooch | family brooch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| fan-club-membership-card | fan club membership card | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| fanfare | fanfare | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| faun-soul-core | faun soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| feedbag | feedbag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| fence | fence | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| fennec | fennec | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| fennec | fennec | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| fennec | fennec | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| feral-sphinx-soul-core | feral sphinx soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| feral-werecrocodile-soul-core | feral werecrocodile soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| fern | fern | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| ferocious-cabinet | ferocious cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferocious-cabinet | ferocious cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferocious-chair | ferocious chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferocious-chair | ferocious chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferocious-chair | ferocious chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferocious-chair | ferocious chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferocious-table | ferocious table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferocious-table | ferocious table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferocious-trunk | ferocious trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferocious-trunk | ferocious trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferocious-trunk | ferocious trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferocious-trunk | ferocious trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| fertile-soil | fertile soil | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| ferumbras-amulet | Ferumbras' amulet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| ferumbras-bust | ferumbras bust | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferumbras-bust | ferumbras bust | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferumbras-bust | ferumbras bust | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferumbras-bust | ferumbras bust | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferumbras-doll | ferumbras doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| ferumbras-doll | ferumbras doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| ferumbras-exercise-dummy | ferumbras exercise dummy | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferumbras-exercise-dummy | ferumbras exercise dummy | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ferumbras-mana-keg | Ferumbras' mana keg | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| ferumbras-portrait | Ferumbras Portrait | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| ferumbras-puppet | Ferumbras puppet | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| ferumbras-staff | Ferumbras' staff | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| ferumbras-staff | Ferumbras' staff | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| ferumbras-teddy | Ferumbras' teddy | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| ferumbras-teddy-santa | ferumbras' teddy santa | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| festival-cake | festival cake | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| festive-backpack | festive backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| festive-filled-shoes | festive filled shoes | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-filled-shoes | festive filled shoes | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-fireplace | festive fireplace | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-fireplace | festive fireplace | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-fireplace | festive fireplace | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-fireplace | festive fireplace | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-pyramide | festive pyramide | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-pyramide | festive pyramide | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-rocking-chair | festive rocking chair | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-rocking-chair | festive rocking chair | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-rocking-chair | festive rocking chair | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-rocking-chair | festive rocking chair | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-sleigh | festive sleigh | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-sleigh | festive sleigh | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-table | festive table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| festive-table | festive table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| festive-table | festive table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| festive-table | festive table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| festive-tree | festive tree | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| festive-tree | festive tree | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| feverish-citizen-soul-core | feverish citizen soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| feversleep-soul-core | feversleep soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ficus-benjamina | ficus benjamina | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| fiery-barbarian-axe | fiery barbarian axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| fiery-blacksteel-sword | fiery blacksteel sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| fiery-clerical-mace | fiery clerical mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| fiery-cranial-basher | fiery cranial basher | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| fiery-crystal-mace | fiery crystal mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| fiery-dragon-slayer | fiery dragon slayer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| fiery-gnomish-stonesmasher | fiery gnomish stonesmasher | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| fiery-headchopper | fiery headchopper | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| fiery-heroic-axe | fiery heroic axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| fiery-knight-axe | fiery knight axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| fiery-mystic-blade | fiery mystic blade | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| fiery-orcish-maul | fiery orcish maul | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| fiery-relic-sword | fiery relic sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| fiery-spike-sword | fiery spike sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| fiery-war-axe | fiery war axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| fiery-war-hammer | fiery war hammer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| filled-carrying-device | filled carrying device | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| filled-cup | filled cup | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| filled-elven-vial | filled elven vial | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| filled-glooth-converter | filled glooth converter | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| filled-jalapeno-peppers | filled jalapeno peppers | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| filled-kraken-shelf | filled kraken shelf | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| filled-kraken-shelf | filled kraken shelf | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| filled-milk-churn | filled milk churn | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| filled-receptacle | filled receptacle | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| filth-toad-soul-core | filth toad soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| final-judgement | final judgement | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| fine-sulphur | fine sulphur | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| fine-vase | fine vase | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| fine-vase | fine vase | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| fir-tree | fir tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| fire-amplification | fire amplification | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| fire-basin | fire basin | sem categoria de caça (primarytype "illumination") | `data/items/items.xml` |
| fire-bomb-rune | fire bomb rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| fire-bug | fire bug | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| fire-devil-soul-core | fire devil soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| fire-elemental-soul-core | fire elemental soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| fire-field-rune | fire field rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| fire-mushroom | fire mushroom | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| fire-resilience | fire resilience | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| fire-wall-rune | fire wall rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| fireball-rune | fireball rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| firecatcher-urn | firecatcher urn | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| fireproof-horn | fireproof horn | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| firestarter-soul-core | firestarter soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| firewalker-boots | firewalker boots | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| firework-rockets | firework rockets | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| fireworks-rocket | fireworks rocket | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| firlefanz | Firlefanz | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| fish | fish | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| fish | fish | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| fish-flakes | fish flakes | sem categoria de caça (primarytype "enchanted items") | `data/items/items.xml` |
| fish-hook-board | fish hook board | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| fish-soul-core | fish soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| fish-swarm | fish swarm | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| fish-tail | fish tail | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| fish-tail | fish tail | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| fishbone | fishbone | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| fishing-rod | fishing rod | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| fishnapped-goldfish | fishnapped goldfish | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| fists-of-enlightenment | fists of enlightenment | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| five-cans | five cans | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| flaming-arrow | flaming arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| flamingo-feather | flamingo feather | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| flamingo-soul-core | flamingo soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| flash-arrow | flash arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| flat-roof | flat roof | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| fleshy-bone | fleshy bone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| flexible-dragon-scale | flexible dragon scale | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| flimsy-lost-soul-soul-core | flimsy lost soul soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| flitter | flitter | sem categoria de caça (primarytype "portals") | `data/items/items.xml` |
| flitter | flitter | sem categoria de caça (primarytype "portals") | `data/items/items.xml` |
| flitter | flitter | sem categoria de caça (primarytype "portals") | `data/items/items.xml` |
| flitter | flitter | sem categoria de caça (primarytype "portals") | `data/items/items.xml` |
| floating-bone | floating bone | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| floating-bucket | floating bucket | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| floating-cask | floating cask | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| floating-crate | floating crate | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| floating-glass | floating glass | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| floating-green-flask | floating green flask | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| floating-savant-soul-core | floating savant soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| floating-stone | floating stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| floating-table | floating table | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| floating-wood | floating wood | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| flour | flour | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| flower-adorned-statue | flower-adorned statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| flower-bed | flower bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-bed | flower bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-bed | flower bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-bed | flower bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-bed | flower bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-bed | flower bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-bed | flower bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-bed | flower bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-bed | flower bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-bed | flower bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-bed | flower bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-bed | flower bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-bouquet | flower bouquet | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| flower-bouquet | flower bouquet | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| flower-bowl | flower bowl | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| flower-bowl | flower bowl | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| flower-cabinet | flower cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-cabinet | flower cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-chair | flower chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-chair | flower chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-chair | flower chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-chair | flower chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-chest | flower chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-chest | flower chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-chest | flower chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-chest | flower chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-table | flower table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-table | flower table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flower-table | flower table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| flowering-wall-leaves | flowering wall leaves | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| flowery-carpet | flowery carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| fly-agaric | fly agaric | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| fly-agaric | fly agaric | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| flying-book-soul-core | flying book soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| foam-stalker-soul-core | foam stalker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| folded-artefact-carpet-i | folded artefact carpet I | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| folded-artefact-carpet-v | folded artefact carpet V | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| folded-blue-cake-carpet | folded blue cake carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-blue-tibia-carpet | folded blue Tibia carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-dragon-carpet | folded dragon carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-dragon-lord-carpet | folded dragon lord carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-eldritch-carpet | folded eldritch carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-elemental-carpet | folded elemental carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-ghazbaran-carpet | folded Ghazbaran carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-green-cake-carpet | folded green cake carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-green-tibia-carpet | folded green Tibia carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-morgaroth-carpet | folded Morgaroth carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-orange-cake-carpet | folded orange cake carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-orange-tibia-carpet | folded orange Tibia carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-orshabaal-carpet | folded Orshabaal carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-pink-cake-carpet | folded pink cake carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-pink-tibia-carpet | folded pink Tibia carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-purple-cake-carpet | folded purple cake carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-purple-tibia-carpet | folded purple Tibia carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-red-cake-carpet | folded red cake carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-red-tibia-carpet | folded red Tibia carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-rift-carpet | folded rift carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| folded-sky-cake-carpet | folded sky cake carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-sky-tibia-carpet | folded sky Tibia carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-void-carpet | folded void carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| folded-yellow-cake-carpet | folded yellow cake carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| folded-yellow-tibia-carpet | folded yellow Tibia carpet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| food-crate | food crate | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| food-matrix-crystal | food matrix crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| football | football | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| football | football | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| forbidden-fruit | forbidden fruit | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| forest-fury-soul-core | forest fury soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| forest-pincer | forest pincer | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| forged-key | forged key | sem categoria de caça (primarytype "keys") | `data/items/items.xml` |
| forget-me-not | forget-me-not | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| fork | fork | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| forlorn-shovel | forlorn shovel | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| fossilised-bones | fossilised bones | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| fossilised-bones | fossilised bones | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| fossilised-bones | fossilised bones | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| fossilised-coral | fossilised coral | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| fountain | fountain | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| fountain | fountain | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| four-cans | four cans | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| four-leaf-clover | four-leaf clover | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| fox-soul-core | fox soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| foxtail | foxtail | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| fragile-torch-bearer | fragile torch bearer | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| framed-birthday-card | framed birthday card | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| framework-wall | framework wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| frayed-snake-maw | frayed snake maw | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| frayed-veldt-flowers | frayed veldt flowers | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| frayed-wild-desert-rose | frayed wild desert rose | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| frazzlemaw-santa | frazzlemaw santa | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| frazzlemaw-soul-core | frazzlemaw soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| freakish-lost-soul-soul-core | freakish lost soul soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| fresh-fruit | fresh fruit | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| fresh-mushroom-beer | fresh mushroom beer | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| friendship-amulet | friendship amulet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| friendship-amulet | friendship amulet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| frog-leaf | frog leaf | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| frost-charm | frost charm | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| frost-dragon-hatchling-soul-core | frost dragon hatchling soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| frost-dragon-soul-core | frost dragon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| frost-flower-asura-soul-core | frost flower asura soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| frost-giant-soul-core | frost giant soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| frost-giantess-soul-core | frost giantess soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| frost-troll-soul-core | frost troll soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| frostbite-herb | frostbite herb | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| frostbite-herb | frostbite herb | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| frozen-carrot | frozen carrot | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| frozen-chest | frozen chest | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| frozen-heart | frozen heart | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| frozen-starlight | frozen starlight | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| frozen-wall | frozen wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| fruit-drop-soul-core | fruit drop soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| full-gas-bag | full gas bag | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| full-storage-flask | full storage flask | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| funeral-urn | funeral urn | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| fungus-powder | fungus powder | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| fur-backpack | fur backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| fur-bag | fur bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| fur-carpet | fur carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| furious-fire-elemental-soul-core | furious fire elemental soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| furious-troll-soul-core | furious troll soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| furniture-kit | furniture kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| fury-gate | fury gate | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| fury-soul-core | fury soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gamemaster-doll | gamemaster doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| gang-member-soul-core | gang member soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gargoyle-soul-core | gargoyle soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| garlic-bread | garlic bread | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| garlic-cookie | garlic cookie | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gas-bag | gas bag | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gazer-soul-core | gazer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gazer-spectre-soul-core | gazer spectre soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gem-holder | gem holder | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gemmed-lamp | gemmed lamp | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gemmed-lamp | gemmed lamp | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gemmed-lamp | gemmed lamp | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ghastly-dragon-soul-core | ghastly dragon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ghazbaran-carpet | Ghazbaran carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| ghazbaran-carpet | Ghazbaran carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| ghost-backpack | ghost backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| ghost-claw | ghost claw | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ghost-detector | ghost detector | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ghost-duster | ghost duster | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ghost-pacifier | ghost pacifier | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| ghost-residue | ghost residue | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ghost-soul-core | ghost soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ghost-wolf-soul-core | ghost wolf soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ghostly-water | ghostly water | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| ghostsilver-lantern | ghostsilver lantern | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| ghostsilver-lantern | ghostsilver lantern | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| ghoul-soul-core | ghoul soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ghoulish-hyaena-soul-core | ghoulish hyaena soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| giant-carrot | giant carrot | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| giant-glimmer-cap-mushroom | giant glimmer cap mushroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| giant-jungle-rose | giant jungle rose | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| giant-screwdriver | giant screwdriver | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| giant-shrimp | giant shrimp | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| giant-spider-soul-core | giant spider soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| giggle-mushroom | giggle mushroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| giggle-mushrooms | giggle mushrooms | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| gilded-birthday-cup | gilded birthday cup | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| gilded-blessed-shield | gilded blessed shield | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| gilded-crown | gilded crown | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| gilded-eldritch-crescent-moon-spade | gilded eldritch crescent moon spade | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| gilded-horned-helmet | gilded horned helmet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| gilded-imbuing-shrine | gilded imbuing shrine | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| gilded-imbuing-shrine | gilded imbuing shrine | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| gilded-magic-longsword | gilded magic longsword | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| gilded-warlord-sword | gilded warlord sword | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| gingerbread-man-soul-core | gingerbread man soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gingerbread-recipe | gingerbread recipe | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| gingerbreadman | gingerbreadman | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| girtablilu-warrior-soul-core | girtablilu warrior soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gladiator-soul-core | gladiator soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| glass-tube | glass tube | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gleaming-starlight-vial | gleaming starlight vial | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| glimmer-cap-mushroom | glimmer cap mushroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| glimmer-cap-mushrooms | glimmer cap mushrooms | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| glittering-yarn | glittering yarn | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| globe | globe | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| globe | globe | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| globe-kit | globe kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| gloom-maw-soul-core | gloom maw soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gloom-wolf-soul-core | gloom wolf soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| glooth-anemone-soul-core | glooth anemone soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| glooth-backpack | glooth backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| glooth-bandit-soul-core | glooth bandit soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| glooth-blob-soul-core | glooth blob soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| glooth-brigand-soul-core | glooth brigand soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| glooth-capsule | glooth capsule | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| glooth-converter | glooth converter | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| glooth-extractor | glooth extractor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| glooth-farina | glooth farina | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| glooth-glider-blueprint | glooth glider blueprint | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| glooth-glider-casing | glooth glider casing | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| glooth-glider-crank | glooth glider crank | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| glooth-glider-gear-wheel | glooth glider gear wheel | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| glooth-glider-hinge | glooth glider hinge | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| glooth-golem-soul-core | glooth golem soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| glooth-plasma | glooth plasma | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| glooth-potion | glooth potion | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| glooth-sandwich | glooth sandwich | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| glooth-steak | glooth steak | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| glooth-vinegar | glooth vinegar | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| glow-wine | glow wine | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| glowing-mushroom | glowing mushroom | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| glowing-skull-pillar | glowing skull pillar | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| glue-dispenser | glue dispenser | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| gnarlhound-soul-core | gnarlhound soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gnome-chart | gnome chart | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gnome-pick | gnome pick | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| gnome-trignometre | gnome trignometre | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gnomish-crystal-package | gnomish crystal package | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gnomish-extraction-crystal | gnomish extraction crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gnomish-pesticides | gnomish pesticides | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gnomish-repair-crystal | gnomish repair crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gnomish-resonance-crystal | gnomish resonance crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gnomish-stonesmasher | gnomish stonesmasher | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| gnomish-supplies | gnomish supplies | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| goat-grass | goat grass | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| goblin-assassin-soul-core | goblin assassin soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| goblin-bone-key | goblin bone key | sem categoria de caça (primarytype "keys") | `data/items/items.xml` |
| goblin-leader-soul-core | goblin leader soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| goblin-scavenger-soul-core | goblin scavenger soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| goblin-soul-core | goblin soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| goblin-statue | goblin statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| goblin-statue | goblin statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| goblin-statue | goblin statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| goblin-statue | goblin statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| goblin-statue-kit | goblin statue kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| god-flowers | god flowers | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| god-flowers | god flowers | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| goggle-cake-soul-core | goggle cake soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gold-converter | gold converter | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| gold-cup | gold cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| gold-cup | gold cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| gold-cup | gold cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| gold-cup | gold cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| gold-cup | gold cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| gold-deed | gold deed | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| gold-dust | gold dust | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gold-hunter-trophy | gold hunter trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| gold-nugget | gold nugget | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| gold-nuggets | gold nuggets | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| golden-backpack | golden backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| golden-bag | golden bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| golden-brush | golden brush | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| golden-demon-skull | golden demon skull | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| golden-demon-skull | golden demon skull | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| golden-dragon-tapestry | golden dragon tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| golden-falcon | golden falcon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| golden-falcon | golden falcon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| golden-falcon | golden falcon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| golden-figurine | golden figurine | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| golden-fir-cone | golden fir cone | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| golden-goblet | golden goblet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| golden-goblet | golden goblet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| golden-goblet | golden goblet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| golden-key | golden key | sem categoria de caça (primarytype "keys") | `data/items/items.xml` |
| golden-magic-longsword | golden magic longsword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| golden-marble | golden marble | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| golden-mask | golden mask | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| golden-minotaur-skull | golden minotaur skull | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| golden-minotaur-skull | golden minotaur skull | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| golden-mug | golden mug | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| golden-newspaper | golden newspaper | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| golden-newspaper | golden newspaper | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| golden-newspaper | golden newspaper | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| golden-prison-key | golden prison key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| golden-quartz-powder | golden quartz powder | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| golden-quartzes | golden quartzes | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| golden-sea-horse-figurine | golden sea horse figurine | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| golden-servant-replica-soul-core | golden servant replica soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| golden-servant-soul-core | golden servant soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| golden-shark-trophy | golden shark trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| golden-wallpaper | golden wallpaper | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| golden-warlord-sword | golden warlord sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| golden-warrior-trophy | golden warrior trophy | sem categoria de caça (primarytype "contest prizes") | `data/items/items.xml` |
| goldfish-bowl | goldfish bowl | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| goldfish-bowl | goldfish bowl | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| goldhanded-cultist-bride-soul-core | goldhanded cultist bride soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| goldhanded-cultist-soul-core | goldhanded cultist soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| golem-blueprint | golem blueprint | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| golem-disassembler | golem disassembler | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| golem-head | golem head | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| golem-part | golem part | sem categoria de caça (primarytype "metals") | `data/items/items.xml` |
| golem-wrench | golem wrench | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| gooey-substance | gooey substance | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| gore-horn | gore horn | sem categoria de caça (primarytype "ungulates") | `data/items/items.xml` |
| gore-horn-soul-core | gore horn soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gorerilla-soul-core | gorerilla soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gorger-inferniarch-soul-core | gorger inferniarch soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| goromaphone | goromaphone | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| gozzler-soul-core | gozzler soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gozzler-trophy | gozzler trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| grainy-fireworks-powder | grainy fireworks powder | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| grand-sanguine-claws | grand sanguine claws | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| grandiose-carpet | grandiose carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| grandiose-carpet | grandiose carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| grandiose-chair | grandiose chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| grandiose-chair | grandiose chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| grandiose-chair | grandiose chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| grandiose-chair | grandiose chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| grandiose-cupboard | grandiose cupboard | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| grandiose-cupboard | grandiose cupboard | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| grandiose-gilded-chest | grandiose gilded chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| grandiose-gilded-chest | grandiose gilded chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| grandiose-gilded-chest | grandiose gilded chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| grandiose-gilded-chest | grandiose gilded chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| grandiose-painting | grandiose painting | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| grandiose-refined-chest | grandiose refined chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| grandiose-refined-chest | grandiose refined chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| grandiose-refined-chest | grandiose refined chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| grandiose-refined-chest | grandiose refined chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| grandiose-table | grandiose table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| grandiose-table | grandiose table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| grapes | grapes | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| grappling-hook | grappling hook | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| grass-wall | grass wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| grass-wall-window | grass wall window | sem categoria de caça (primarytype "windows") | `data/items/items.xml` |
| grass-wall-window | grass wall window | sem categoria de caça (primarytype "windows") | `data/items/items.xml` |
| grave-flower | grave flower | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| grave-flower-extract | grave flower extract | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| grave-guard-soul-core | grave guard soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| grave-robber-soul-core | grave robber soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gravedigger-soul-core | gravedigger soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gravel | gravel | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| greasy-stone | greasy stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| greasy-stone | greasy stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| greasy-stone | greasy stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| greasy-stone | greasy stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| great-fireball-rune | great fireball rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| great-health-cask | great health cask | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| great-health-keg | great health keg | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| great-health-potion | great health potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| great-mana-cask | great mana cask | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| great-mana-keg | great mana keg | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| great-mana-potion | great mana potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| great-spirit-cask | great spirit cask | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| great-spirit-potion | great spirit potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| great-spririt-keg | great spririt keg | sem categoria de caça (primarytype "nenhum") | `data/items/items.xml` |
| greater-proficiency-catalyst | greater proficiency catalyst | sem categoria de caça (primarytype "other items") | `data/items/items.xml` |
| green-25-years-balloon | green 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| green-25-years-balloon | green 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| green-25-years-balloon | green 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| green-backpack | green backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| green-bag | green bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| green-balloon | green balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| green-balloon | green balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| green-balloon | green balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| green-balloons | green balloons | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| green-bed-kit | green bed kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-cake-carpet | green cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| green-cake-carpet | green cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| green-christmas-bundle | green christmas bundle | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| green-crystal | green crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| green-crystal-rods | green crystal rods | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| green-crystal-stalagmite | green crystal stalagmite | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| green-crystal-stalagmite | green crystal stalagmite | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| green-crystals | green crystals | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| green-cushioned-chair | green cushioned chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-cushioned-chair | green cushioned chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-cushioned-chair | green cushioned chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-cushioned-chair | green cushioned chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-cushioned-chair-kit | green cushioned chair kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-djinn-soul-core | green djinn soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| green-ectoplasm | green ectoplasm | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| green-ectoplasm | green ectoplasm | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| green-energy-ball | green energy ball | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| green-fireworks-powder | green fireworks powder | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| green-fireworks-rocket | green fireworks rocket | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| green-flask | green flask | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| green-footboard | green footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-footboard | green footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-footboard | green footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-footboard | green footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-fountain-bush | green fountain bush | sem categoria de caça (primarytype "bushes") | `data/items/items.xml` |
| green-frog-soul-core | green frog soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| green-gingerbread-heart | green gingerbread heart | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| green-headboard | green headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-headboard | green headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-headboard | green headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-headboard | green headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-headboard | green headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-headboard | green headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-lever | green lever | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| green-light | green light | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| green-marble | green marble | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| green-memory-shard | green memory shard | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| green-mushroom | green mushroom | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| green-perch | green perch | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| green-pillow | green pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| green-pit-demon | green pit demon | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| green-powder | green powder | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| green-power-core | green power core | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| green-round-cushion | green round cushion | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| green-spores | green spores | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| green-square-cushion | green square cushion | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| green-tapestry | green tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| green-tibia-carpet | green Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| green-tibia-carpet | green Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| green-tome | green tome | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| green-traditional-chair | green traditional chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-traditional-chair | green traditional chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-traditional-chair | green traditional chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-traditional-chair | green traditional chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-traditional-rack | green traditional rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-traditional-rack | green traditional rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-traditional-table | green traditional table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-wall-hangings | green wall hangings | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| green-wallpaper | green wallpaper | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| green-wig-bush | green wig bush | sem categoria de caça (primarytype "bushes") | `data/items/items.xml` |
| green-wooden-candelabra | green wooden candelabra | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-wooden-candelabra | green wooden candelabra | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-wooden-candelabra | green wooden candelabra | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| green-wooden-candelabra | green wooden candelabra | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| greenish-flintstone | greenish flintstone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| greeting-card | greeting card | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| grey-backpack | grey backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| grey-bag | grey bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| grey-blue-powder | grey-blue powder | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| grey-raven | grey raven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| grey-raven | grey raven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| grey-raven-kit | grey raven kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| grey-tome | grey tome | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| griffinclaw-container | griffinclaw container | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| grille | grille | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| grim-reaper-soul-core | grim reaper soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| grimeleech-soul-core | grimeleech soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| grimy-wooden-plank | grimy wooden plank | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| grind-stone | grind stone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ground-reed | ground reed | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| growing-birch | growing birch | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| grynch-clan-goblin-soul-core | grynch clan goblin soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| gryphon-soul-core | gryphon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| guardcatcher | guardcatcher | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| guardian-of-tales-soul-core | guardian of tales soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| guilt | guilt | sem categoria de caça (primarytype "dreamhaunters") | `data/items/items.xml` |
| gummy-rotworm | gummy rotworm | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| guzzlemaw-grub | Guzzlemaw Grub | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| guzzlemaw-grub | Guzzlemaw Grub | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| guzzlemaw-soul-core | guzzlemaw soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| half-burnt-scroll | half burnt scroll | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| hallowed-axe | hallowed axe | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| hallowed-bone | hallowed bone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ham | ham | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| hammer | hammer | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| hammerhead-trophy | hammerhead trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| hammock | hammock | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| hammock | hammock | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| hammock | hammock | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| hammock | hammock | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| hammock | hammock | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| hammock | hammock | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| hammock | hammock | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| hammock | hammock | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| hammock | hammock | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| hammock | hammock | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| hammock | hammock | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| hammock | hammock | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| hammock-foot-section | hammock foot section | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hammock-foot-section | hammock foot section | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hammock-foot-section | hammock foot section | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hammock-foot-section | hammock foot section | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hammock-head-section | hammock head section | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hammock-head-section | hammock head section | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hammock-head-section | hammock head section | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hammock-head-section | hammock head section | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hammock-head-section | hammock head section | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hammock-head-section | hammock head section | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hand-auger | hand auger | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| hand-of-cursed-fate-soul-core | hand of cursed fate soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hand-puppets | hand puppets | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| hand-puppets | hand puppets | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| hand-puppets | hand puppets | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| handcrafted-ribbon | handcrafted ribbon | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| harness | harness | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| harp | harp | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| harp | harp | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| harp-kit | harp kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| harpy-soul-core | harpy soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hastily-scribbled-note | hastily scribbled note | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| haunted-dragon-soul-core | haunted dragon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| haunted-treeling-soul-core | haunted treeling soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hawk-hopper-soul-core | hawk hopper soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hawser | hawser | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| hawser | hawser | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| headache-pill | headache pill | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| headpecker-soul-core | headpecker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| headwalker-soul-core | headwalker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| health-cask | health cask | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| health-keg | health keg | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| health-potion | health potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| heart-backpack | heart backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| heart-cabinet | heart cabinet | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| heart-cabinet | heart cabinet | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| heart-chest | heart chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| heart-chest | heart chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| heart-chest | heart chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| heart-chest | heart chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| heart-lamp | heart lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| heart-lamp | heart lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| heart-lamp | heart lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| heart-pillow | heart pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| heart-table | heart table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| heart-table | heart table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| heated-worm-punisher | heated worm punisher | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| heaven-blossom | heaven blossom | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| heavily-bound-book | heavily bound book | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| heavy-ball | heavy ball | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| heavy-crystal-fragment | heavy crystal fragment | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| heavy-crystal-fragment | heavy crystal fragment | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| heavy-magic-missile-rune | heavy magic missile rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| heavy-medal | heavy medal | sem categoria de caça (primarytype "contest prizes") | `data/items/items.xml` |
| heavy-old-tome | heavy old tome | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| heavy-package | heavy package | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| heavy-stone | heavy stone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| heavy-stone | heavy stone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| heavy-stone-hammer | heavy stone hammer | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| hedge | hedge | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| hellfire-fighter-soul-core | hellfire fighter soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hellflayer-soul-core | hellflayer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hellflayer-trophy | hellflayer trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| hellhound-soul-core | hellhound soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hellhunter-inferniarch-soul-core | hellhunter inferniarch soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hellspawn-soul-core | hellspawn soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| helmet-adornment | helmet adornment | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| helmet-of-the-deep | helmet of the deep | sem categoria de caça (primarytype "nenhum") | `data/items/items.xml` |
| helmet-ornament | helmet ornament | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| helmet-piece | helmet piece | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| herald-of-gloom-soul-core | herald of gloom soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hero-soul-core | hero soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hero-statue | hero statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| hibernal-moth-soul-core | hibernal moth soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hideous-fungus-soul-core | hideous fungus soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hieroglyph-banner | hieroglyph banner | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| high-grass | high grass | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| high-grass | high grass | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| high-grass | high grass | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| high-grass | high grass | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| high-voltage-elemental-soul-core | high voltage elemental soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| highly-charged-lodestone | highly charged lodestone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| hireling-lamp | hireling lamp | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| hive-overseer-soul-core | hive overseer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hive-pore | hive pore | sem categoria de caça (primarytype "hive born") | `data/items/items.xml` |
| hive-pore | hive pore | sem categoria de caça (primarytype "hive born") | `data/items/items.xml` |
| hoe | hoe | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| hollow-geode | hollow geode | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| holy-amplification | holy amplification | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| holy-falcon | holy falcon | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| holy-icon | holy icon | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| holy-missile-rune | holy missile rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| holy-resilience | holy resilience | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| holy-soil | holy soil | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| honey-elemental-soul-core | honey elemental soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| honey-flower | honey flower | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| honey-flower | honey flower | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| honey-palm | honey palm | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| honey-palm-bark | honey palm bark | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| honour-guard-soul-core | honour guard soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| horn | horn | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| horse-soul-core-brown | horse soul core (brown) | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| horse-soul-core-gray | horse soul core (gray) | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| horse-soul-core-taupe | horse soul core (taupe) | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hot-dog-soul-core | hot dog soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hot-firecatcher-urn | hot firecatcher urn | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| hot-geyser | hot geyser | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| hourglass | hourglass | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| hrodmiran-chair | hrodmiran chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hrodmiran-chair | hrodmiran chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hrodmiran-chair | hrodmiran chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hrodmiran-chair | hrodmiran chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hrodmiran-chest | hrodmiran chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hrodmiran-chest | hrodmiran chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hrodmiran-chest | hrodmiran chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hrodmiran-chest | hrodmiran chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hrodmiran-cupboard | hrodmiran cupboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hrodmiran-cupboard | hrodmiran cupboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hrodmiran-table | hrodmiran table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hrodmiran-weapons-rack | hrodmiran weapons rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hrodmiran-weapons-rack | hrodmiran weapons rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hrodmiran-weapons-rack | hrodmiran weapons rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| hrodmiran-weapons-rack | hrodmiran weapons rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| huge-cauldron | huge cauldron | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| huge-cauldron | huge cauldron | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| huge-telescope | huge telescope | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| hulking-carnisylvan-soul-core | hulking carnisylvan soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hulking-prehemoth-soul-core | hulking prehemoth soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| humongous-fungus-soul-core | humongous fungus soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hunter-soul-core | hunter soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hunting-horn | hunting horn | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| husky-soul-core | husky soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hyaena-soul-core | hyaena soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hyaena-trap | hyaena trap | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| hydra-balloon | hydra balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| hydra-balloon | hydra balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| hydra-balloon | hydra balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| hydra-soul-core | hydra soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| hydra-tongue | hydra tongue | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| hydra-tongue-salad | hydra tongue salad | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| hydromancer-dummy | hydromancer dummy | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| ice-amplification | ice amplification | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| ice-cabinet | ice cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ice-cabinet | ice cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ice-chandelier | ice chandelier | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| ice-chandelier | ice chandelier | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| ice-chest | ice chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ice-chest | ice chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ice-chest | ice chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ice-chest | ice chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ice-cube | ice cube | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| ice-cube | ice cube | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| ice-cube | ice cube | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| ice-cube | ice cube | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| ice-cube | ice cube | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| ice-dragon-soul-core | ice dragon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ice-floor | ice floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| ice-flower | ice flower | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| ice-flower-seeds | ice flower seeds | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| ice-golem-soul-core | ice golem soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ice-hatchet | ice hatchet | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ice-mammoth | ice mammoth | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| ice-pick | ice pick | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ice-resilience | ice resilience | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| ice-shield | ice shield | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ice-stone-floor | ice stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| ice-stool | ice stool | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ice-stool | ice stool | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ice-table | ice table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ice-witch-soul-core | ice witch soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| icecold-book-soul-core | icecold book soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ichor-thistle | ichor thistle | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| icicle-rune | icicle rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| icicles | icicles | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| icy-barbarian-axe | icy barbarian axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| icy-blacksteel-sword | icy blacksteel sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| icy-clerical-mace | icy clerical mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| icy-cranial-basher | icy cranial basher | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| icy-crystal-mace | icy crystal mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| icy-dragon-slayer | icy dragon slayer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| icy-headchopper | icy headchopper | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| icy-heroic-axe | icy heroic axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| icy-knight-axe | icy knight axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| icy-mystic-blade | icy mystic blade | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| icy-orcish-maul | icy orcish maul | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| icy-relic-sword | icy relic sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| icy-spike-sword | icy spike sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| icy-war-axe | icy war axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| icy-war-hammer | icy war hammer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| idol-lamp | idol lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| idol-lamp | idol lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| idol-lamp | idol lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| idol-lamp | idol lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| iks-ahpututu-soul-core | iks ahpututu soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| iks-aucar-soul-core | iks aucar soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| iks-chuka-soul-core | iks chuka soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| iks-churrascan-soul-core | iks churrascan soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| iks-pututu-soul-core | iks pututu soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| iks-yapunac-soul-core | iks yapunac soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| imbuing-crystal | imbuing crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| imbuing-shrine | imbuing shrine | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| imbuing-shrine | imbuing shrine | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| imbuing-shrine | imbuing shrine | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| imbuing-shrine | imbuing shrine | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| imortus | imortus | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| imported-water-pipe | imported water pipe | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| impward | Impward | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| impward | Impward | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| inactive-geyser | inactive geyser | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| incantation-fragment | incantation fragment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| incantation-scroll | incantation scroll | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| incomprehensible-riches | incomprehensible riches | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| incomprehensible-riches | incomprehensible riches | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| indoor-plant | indoor plant | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| indoor-plant-kit | indoor plant kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| inert-astral-shaper-rune | inert astral shaper rune | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| infected-throne | infected throne | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| infected-weeper-soul-core | infected weeper soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| infernal-bolt | infernal bolt | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| infernal-demon-soul-core | infernal demon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| infernal-frog-soul-core | infernal frog soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| infernal-phantom-soul-core | infernal phantom soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| infernalist-soul-core | infernalist soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| inferniarch-claws | inferniarch claws | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| ink-blob-soul-core | ink blob soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ink-splash-soul-core | ink splash soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| inkwell | inkwell | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| inkwell | inkwell | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| innocent-target | innocent target | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| inoperative-tin-lizzard | inoperative tin lizzard | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| inoperative-uniwheel | inoperative uniwheel | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| insane-siren-soul-core | insane siren soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| inscribed-blue-heart | inscribed blue heart | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| inscribed-green-heart | inscribed green heart | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| inscribed-red-heart | inscribed red heart | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| insect-swarm-soul-core | insect swarm soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| insectoid-eggs | insectoid eggs | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| insectoid-pore | insectoid pore | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| insectoid-scout-soul-core | insectoid scout soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| insectoid-worker-soul-core | insectoid worker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| instable-breach-brood-soul-core | instable breach brood soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| instable-sparkion-soul-core | instable sparkion soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| instable-vortex | instable vortex | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| intelligence-reports | intelligence reports | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| intense-healing-rune | intense healing rune | sem categoria de caça (primarytype "nenhum") | `data/items/items.xml` |
| interdimensional-potion | interdimensional potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| interwoven-moss-florets | interwoven moss florets | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| intricate-bash-scroll | intricate bash scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-blockade-scroll | intricate blockade scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-cage-key | intricate cage key | sem categoria de caça (primarytype "keys") | `data/items/items.xml` |
| intricate-chop-scroll | intricate chop scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-cloud-fabric-scroll | intricate cloud fabric scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-cobra-shrine | intricate cobra shrine | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| intricate-demon-presence-scroll | intricate demon presence scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-dragon-hide-scroll | intricate dragon hide scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-electrify-scroll | intricate electrify scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-epiphany-scroll | intricate epiphany scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-featherweight-scroll | intricate featherweight scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-frost-scroll | intricate frost scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-lich-shroud-scroll | intricate lich shroud scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-precision-scroll | intricate precision scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-punch-scroll | intricate punch scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-quara-scale-scroll | intricate quara scale scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-reap-scroll | intricate reap scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-scorch-scroll | intricate scorch scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-slash-scroll | intricate slash scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-snake-skin-scroll | intricate snake skin scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-strike-scroll | intricate strike scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-swiftness-scroll | intricate swiftness scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-vampirism-scroll | intricate vampirism scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-venom-scroll | intricate venom scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-vibrancy-scroll | intricate vibrancy scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| intricate-void-scroll | intricate void scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| invitation | invitation | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| iron-construction | iron construction | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| iron-floor | iron floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| iron-loadstone | iron loadstone | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| iron-pillar | iron pillar | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| iron-servant-replica-soul-core | iron servant replica soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| iron-servant-soul-core | iron servant soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| iron-wall | iron wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| iron-wall | iron wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| ironblight-soul-core | ironblight soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| irrigation-funnel | irrigation funnel | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| island-troll-soul-core | island troll soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ivory-chair | ivory chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ivory-chair | ivory chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ivory-chair | ivory chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ivory-chair | ivory chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ivory-chair-kit | ivory chair kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ivory-comb | ivory comb | sem categoria de caça (primarytype "clothing accessories") | `data/items/items.xml` |
| ivory-lyre | ivory lyre | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ivory-mask | ivory mask | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| jade-amulet | jade amulet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| jade-ornament | jade ornament | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| jade-spike-plant | jade spike plant | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| jade-zaoan-bishop | jade Zaoan bishop | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| jade-zaoan-bishop | jade Zaoan bishop | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| jade-zaoan-king | jade Zaoan king | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| jade-zaoan-king | jade Zaoan king | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| jade-zaoan-knight | jade Zaoan knight | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| jade-zaoan-knight | jade Zaoan knight | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| jade-zaoan-pawn | jade Zaoan pawn | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| jade-zaoan-pawn | jade Zaoan pawn | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| jade-zaoan-queen | jade Zaoan queen | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| jade-zaoan-queen | jade Zaoan queen | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| jade-zaoan-rook | jade Zaoan rook | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| jade-zaoan-rook | jade Zaoan rook | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| jagged-stones | jagged stones | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| jagged-stones | jagged stones | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| jalapeno-pepper | jalapeno pepper | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| jammed-sewer-grate | jammed sewer grate | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| jellyfish-soul-core | jellyfish soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| jester-doll | jester doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| jester-staff | jester staff | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| jewel-case | jewel case | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| jewel-case | jewel case | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| jewelled-backpack | jewelled backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| jo-staff | jo staff | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| jousting-eagle-baby | jousting eagle baby | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| jousting-eagle-baby | jousting eagle baby | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| jug | jug | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| jug | jug | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| juggernaut-soul-core | juggernaut soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| juice-squeezer | juice squeezer | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| juicy-roots | juicy roots | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| julius-map | Julius' map | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| jungle-crown-plant | jungle crown plant | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| jungle-dweller-bush | jungle dweller bush | sem categoria de caça (primarytype "bushes") | `data/items/items.xml` |
| jungle-grass | jungle grass | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| jungle-grass | jungle grass | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| jungle-grass | jungle grass | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| jungle-grass | jungle grass | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| jungle-grass | jungle grass | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| jungle-grass | jungle grass | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| jungle-grass | jungle grass | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| jungle-moa-nest | jungle moa nest | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| jungle-moa-soul-core | jungle moa soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| jungle-rose | jungle rose | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| juniper-tree | juniper tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| juvenile-bashmu-soul-core | juvenile bashmu soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| katana-display | katana display | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| katana-display | katana display | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| kelp | kelp | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| kidney-table | kidney table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| killer-caiman-soul-core | killer caiman soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| killer-rabbit-soul-core | killer rabbit soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| king-tibianus-bust | King Tibianus bust | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| king-tibianus-bust | King Tibianus bust | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| kitchen-chest | kitchen chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| kitchen-chest | kitchen chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| kitchen-chest | kitchen chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| kitchen-chest | kitchen chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| kitchen-clock | kitchen clock | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| kitchen-knife | kitchen knife | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| kitchen-shelf | kitchen shelf | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| kitchen-table | kitchen table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| kitchen-table | kitchen table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| kitchen-table | kitchen table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| kitchen-table | kitchen table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| kitchen-table | kitchen table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| kitchen-table | kitchen table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| kitchen-table | kitchen table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| kitchen-table | kitchen table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| knight-pedestal | knight pedestal | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| knight-statue-kit | knight statue kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bed | knightly bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bed | knightly bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bed | knightly bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bed | knightly bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bed | knightly bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bed | knightly bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bed | knightly bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bed | knightly bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bed | knightly bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bed | knightly bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bed | knightly bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bed | knightly bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bench | knightly bench | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bench | knightly bench | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bench | knightly bench | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bench | knightly bench | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bench | knightly bench | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bench | knightly bench | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bench | knightly bench | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bench | knightly bench | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bench | knightly bench | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-bench | knightly bench | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-cabinet | knightly cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-cabinet | knightly cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-candelabra | knightly candelabra | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-candelabra | knightly candelabra | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-candle-holder | knightly candle holder | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-candle-holder | knightly candle holder | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-chair | knightly chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-chair | knightly chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-chair | knightly chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-chair | knightly chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-chess-table | knightly chess table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-chess-table | knightly chess table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-chest | knightly chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-chest | knightly chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-chest | knightly chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-chest | knightly chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-decorative-shield | knightly decorative shield | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-fire-bowl | knightly fire bowl | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-fire-bowl | knightly fire bowl | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-fire-bowl | knightly fire bowl | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-guard | knightly guard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-guard | knightly guard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-guard | knightly guard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-guard | knightly guard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-sword-lamp | knightly sword lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-sword-lamp | knightly sword lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-table | knightly table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-table | knightly table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-wall-lamp | knightly wall lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knightly-wall-lamp | knightly wall lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| knights-apparition-soul-core | knight's apparition soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| knowledge-elemental-soul-core | knowledge elemental soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| knowledgeable-book | knowledgeable book | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| kollos-soul-core | kollos soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| kongra-soul-core | kongra soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| kooldown-aid | kooldown-aid | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| kraken-cabinet | kraken cabinet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| kraken-cabinet | kraken cabinet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| kraken-chair | kraken chair | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| kraken-chair | kraken chair | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| kraken-chair | kraken chair | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| kraken-chair | kraken chair | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| kraken-chest | kraken chest | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| kraken-chest | kraken chest | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| kraken-chest | kraken chest | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| kraken-chest | kraken chest | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| kraken-table | kraken table | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| label | label | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| label | label | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| lace-trimmed-handkerchief | lace-trimmed handkerchief | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| lacewing-moth-soul-core | lacewing moth soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ladybug-soul-core | ladybug soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lamassu-soul-core | lamassu soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lamp | lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lamp | lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lamp | lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lamp | lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lampions | lampions | sem categoria de caça (primarytype "portals") | `data/items/items.xml` |
| lancer-beetle-soul-core | lancer beetle soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lapis-crested-vase | lapis-crested vase | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| lapis-crested-vase | lapis-crested vase | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| large-amphora | large amphora | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| large-amphora | large amphora | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| large-amphora | large amphora | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| large-amphora-kit | large amphora kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| large-blue-crystal | large blue crystal | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| large-blue-crystal | large blue crystal | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| large-blue-crystal | large blue crystal | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| large-blue-crystal | large blue crystal | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| large-blue-crystal | large blue crystal | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| large-candelabrum | large candelabrum | sem categoria de caça (primarytype "illumination") | `data/items/items.xml` |
| large-coral | large coral | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| large-coral | large coral | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| large-crystal-teleporter | large crystal teleporter | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| large-crystal-teleporter | large crystal teleporter | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| large-crystal-teleporter | large crystal teleporter | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| large-glowing-amethyst | large glowing amethyst | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| large-glowing-emerald | large glowing emerald | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| large-glowing-ruby | large glowing ruby | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| large-glowing-sapphire | large glowing sapphire | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| large-hallowed-bone | large hallowed bone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| large-hole | large hole | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| large-hole | large hole | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| large-hole | large hole | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| large-hole | large hole | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| large-obelisk | large obelisk | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| large-obelisk | large obelisk | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| large-pliers | large pliers | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| large-snowball | large snowball | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| large-spongy-mushroom | large spongy mushroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| large-sticky-mushroom | large sticky mushroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| large-sticky-mushroom | large sticky mushroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| large-trunk | large trunk | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| large-trunk | large trunk | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| large-trunk | large trunk | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| large-trunk | large trunk | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| large-trunk | large trunk | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| large-used-amphora-kit | large used amphora kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| large-vortex | large vortex | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| large-yellowed-bone | large yellowed bone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| larva-soul-core | larva soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| larvae | larvae | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| last-planegazer | Last Planegazer | sem categoria de caça (primarytype "undead humanoids") | `data/items/items.xml` |
| lasting-exercise-axe | lasting exercise axe | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| lasting-exercise-bow | lasting exercise bow | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| lasting-exercise-club | lasting exercise club | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| lasting-exercise-rod | lasting exercise rod | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| lasting-exercise-shield | lasting exercise shield | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| lasting-exercise-sword | lasting exercise sword | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| lasting-exercise-wand | lasting exercise wand | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| lasting-exercise-wraps | lasting exercise wraps | sem categoria de caça (primarytype "exercise weapons") | `data/items/items.xml` |
| lava | lava | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| lava | lava | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| lava | lava | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| lava | lava | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| lava | lava | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| lava | lava | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| lava-golem-soul-core | lava golem soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lava-lurker-soul-core | lava lurker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lavafungus-soul-core | lavafungus soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lavahole | lavahole | sem categoria de caça (primarytype "traps") | `data/items/items.xml` |
| lavaworm-soul-core | lavaworm soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lazyfairy | lazyfairy | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| leaf-basket | leaf basket | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| leaf-chair | leaf chair | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| leaf-chair | leaf chair | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| leaf-chair | leaf chair | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| leaf-chair | leaf chair | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| leaf-golem-santa | leaf golem santa | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| leaf-golem-soul-core | leaf golem soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| leather-whip | leather whip | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| leaves | leaves | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| leberkassemmel | leberkassemmel | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| leech | leech | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| leechbloom | leechbloom | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| left-horn | left horn | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| lemon | lemon | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| lemon-cupcake | lemon cupcake | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| lemonade-cask | lemonade cask | sem categoria de caça (primarytype "casks") | `data/items/items.xml` |
| letter | letter | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| letterbag | letterbag | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| lever | lever | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| lever | lever | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| lever | lever | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| lever | lever | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| lever | lever | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| lever | lever | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| library-ticket | library ticket | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| lich-soul-core | lich soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| life-buoy | life buoy | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| life-crystal | life crystal | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| life-ring | life ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| light-magic-missile-rune | light magic missile rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| light-parquet | light parquet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| light-parquet-planks | light parquet planks | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| light-rapier | light rapier | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| light-shovel | light shovel | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| light-stone-shower-rune | light stone shower rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| light-stone-shower-rune | light stone shower rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| lightest-magic-missile-rune | lightest magic missile rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| lightest-missile-rune | lightest missile rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| lightest-missile-rune | lightest missile rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| lightsphere | lightsphere | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| lilypad-backpack | lilypad backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| lime-tart | lime tart | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| limestone-pedestal | limestone pedestal | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| limestone-railing | limestone railing | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| limestone-railing | limestone railing | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| limestone-railing | limestone railing | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| linen | linen | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| liodile-soul-core | liodile soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lion-claws | lion claws | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| lion-hydra-soul-core | lion hydra soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lion-soul-core | lion soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lion-trophy | lion trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| lit-candelabrum | lit candelabrum | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lit-candelabrum | lit candelabrum | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lit-crystal-lamp | lit crystal lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lit-glowing-mushroom | lit glowing mushroom | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lit-lightsphere | lit lightsphere | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| lit-moon-mirror | lit moon mirror | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| lit-predator-lamp | lit predator lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| lit-predator-lamp | lit predator lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| lit-protectress-lamp | lit protectress lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| lit-protectress-lamp | lit protectress lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| lit-rainbow-torch | lit rainbow torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lit-rainbow-torch | lit rainbow torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lit-rainbow-torch | lit rainbow torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lit-rift-lamp | lit rift lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lit-skull-lamp | lit skull lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| lit-skull-lamp | lit skull lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| lit-small-lamp | lit small lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lit-torch | lit torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lit-torch | lit torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lit-torch | lit torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lit-torch | lit torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lit-torch | lit torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| lit-torch-bearer | lit torch bearer | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| lit-torch-bearer | lit torch bearer | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| lit-torch-bearer | lit torch bearer | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| lit-torch-bearer | lit torch bearer | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| lit-vengothic-lamp | lit vengothic lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| little-adventurer-doll | little adventurer doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| little-corym-charlatan-soul-core | little corym charlatan soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| little-pig | little pig | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| little-pig | little pig | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| lizard-chosen-soul-core | lizard chosen soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lizard-dragon-priest-soul-core | lizard dragon priest soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lizard-high-guard-soul-core | lizard high guard soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lizard-legionnaire-soul-core | lizard legionnaire soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lizard-magistratus-soul-core | lizard magistratus soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lizard-noble-soul-core | lizard noble soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lizard-sentinel-soul-core | lizard sentinel soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lizard-snakecharmer-soul-core | lizard snakecharmer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lizard-templar-soul-core | lizard templar soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lizard-trophy | lizard trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| lizard-weapon-rack | lizard weapon rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| lizard-weapon-rack | lizard weapon rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| lizard-weapon-rack-kit | lizard weapon rack kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| lizard-zaogun-soul-core | lizard zaogun soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lizards-tongue-bush | lizards tongue bush | sem categoria de caça (primarytype "bushes") | `data/items/items.xml` |
| lock-pick | lock pick | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| locker | locker | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| locker | locker | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| locker | locker | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| locker | locker | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| locker-kit | locker kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| lodestone | lodestone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| log-chest | log chest | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| log-chest | log chest | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| log-chest | log chest | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| log-chest | log chest | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| lonely-crystal | lonely crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| loom | loom | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| loose-opulent-floor-intarsia | loose opulent floor intarsia | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| loose-stone-pile | loose stone pile | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| loose-stone-pile | loose stone pile | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| loose-stone-pile | loose stone pile | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| loose-stone-pile | loose stone pile | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| lordly-tapestry | lordly tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| loremaster-doll | loremaster doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| loricate-orger-soul-core | loricate orger soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lost-basher-soul-core | lost basher soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lost-berserker-soul-core | lost berserker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lost-exile-soul-core | lost exile soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lost-husher-soul-core | lost husher soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lost-rope | lost rope | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| lost-soul | lost soul | sem categoria de caça (primarytype "skeletons") | `data/items/items.xml` |
| lost-soul-dummy | lost soul dummy | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| lost-soul-soul-core | lost soul soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lost-thrower-soul-core | lost thrower soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| lost-time | lost time | sem categoria de caça (primarytype "machines") | `data/items/items.xml` |
| lots | lots | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| lottery-ticket | lottery ticket | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| lottery-ticket | lottery ticket | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| lotus-key | lotus key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| loupe | loupe | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| love-elixir | love elixir | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| love-elixir | love elixir | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| love-flower | love flower | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| love-potion | love potion | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| lucky-clover-amulet | lucky clover amulet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| lucky-dragon | lucky dragon | sem categoria de caça (primarytype "dragons") | `data/items/items.xml` |
| lucky-dragon | lucky dragon | sem categoria de caça (primarytype "dragons") | `data/items/items.xml` |
| lucky-dragon-kit | lucky dragon kit | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| lumbering-carnivor-soul-core | lumbering carnivor soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| luminescent-crystal | luminescent crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| luminescent-crystal | luminescent crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| luminescent-crystal-pickaxe | luminescent crystal pickaxe | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| luminous-box | luminous box | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| lurking-tree | lurking tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| lush-grass | lush grass | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| lute | lute | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| lute | lute | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| lyre | lyre | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| lyre | lyre | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| machine-crate | machine crate | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| mad-scientist-soul-core | mad scientist soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| magic-crystal | magic crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| magic-forcefield | magic forcefield | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| magic-forcefield | magic forcefield | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| magic-forcefield | magic forcefield | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| magic-forcefield | magic forcefield | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| magic-forcefield | magic forcefield | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| magic-forcefield | magic forcefield | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| magic-gold-converter | magic gold converter | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| magic-gold-converter | magic gold converter | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| magic-gold-converter | magic gold converter | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| magic-light-wand | magic light wand | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| magic-light-wand | magic light wand | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| magic-portal | magic portal | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| magic-shield-potion | magic shield potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| magic-wall-rune | magic wall rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| magic-wolf-trap | magic wolf trap | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| magical-blending-device | magical blending device | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| magical-cage-key | magical cage key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| magical-inkwell | magical inkwell | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| magical-key | magical key | sem categoria de caça (primarytype "keys") | `data/items/items.xml` |
| magical-measurement-device | magical measurement device | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| magical-music-notes | magical music notes | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| magical-paint | magical paint | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| magical-torch | magical torch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| magical-watch | magical watch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| magical-water-orb | magical water orb | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| magma-chunk | magma chunk | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| magma-crawler-soul-core | magma crawler soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| magnificent-cabinet | magnificent cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| magnificent-cabinet | magnificent cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| magnificent-chair | magnificent chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| magnificent-chair | magnificent chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| magnificent-chair | magnificent chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| magnificent-chair | magnificent chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| magnificent-table | magnificent table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| magnificent-table | magnificent table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| magnificent-trunk | magnificent trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| magnificent-trunk | magnificent trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| magnificent-trunk | magnificent trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| magnificent-trunk | magnificent trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| mago-mechanic-core | mago mechanic core | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| mailbox | mailbox | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| mailbox | mailbox | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| mailbox | mailbox | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| mailbox | mailbox | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| makara-soul-core | makara soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| makeshift-home | makeshift home | sem categoria de caça (primarytype "traps") | `data/items/items.xml` |
| mallet-head | mallet head | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| mallet-pommel | mallet pommel | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| mammoth | mammoth | sem categoria de caça (primarytype "ungulates") | `data/items/items.xml` |
| mammoth | mammoth | sem categoria de caça (primarytype "ungulates") | `data/items/items.xml` |
| mammoth-soul-core | mammoth soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mammoth-totem | mammoth totem | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| mana-cask | mana cask | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| mana-keg | mana keg | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| mana-potion | mana potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| mandrake | mandrake | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| mango | mango | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| manta-ray-soul-core | manta ray soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| manticore-soul-core | manticore soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mantosaurus-soul-core | mantosaurus soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| many-faces-soul-core | many faces soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| many-faces-trophy | many faces trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| map | map | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| map | map | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| marble-floor | marble floor | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| marble-floor | marble floor | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| marble-floor | marble floor | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| marble-floor | marble floor | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| marble-floor | marble floor | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| marble-floor | marble floor | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| marble-pillar | marble pillar | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| marble-statue | marble statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| marble-tiles | marble tiles | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| marid-soul-core | marid soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| marked-crate | marked crate | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| marked-crate | marked crate | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| marlin | marlin | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| marlin-trophy | marlin trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| marsh-stalker-soul-core | marsh stalker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| massive-earth-elemental-soul-core | massive earth elemental soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| massive-energy-elemental-soul-core | massive energy elemental soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| massive-fire-elemental-soul-core | massive fire elemental soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| massive-water-elemental-soul-core | massive water elemental soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mast | mast | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| mastermind-potion | mastermind potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| maxilla-maximus | maxilla maximus | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| maxxen-santa | maxxen santa | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| mead-horn | mead horn | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| mead-horn | mead horn | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| mean-knight-sword | mean knight sword | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| mean-lost-soul-soul-core | mean lost soul soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| meandering-mushroom-soul-core | meandering mushroom soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| meandi | Meandi | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| meandi | Meandi | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| meat | meat | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| meaty-vortex | meaty vortex | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| mechanical-fish | mechanical fish | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| mechanical-fishing-rod | mechanical fishing rod | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| mechanism | mechanism | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| mechanism | mechanism | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| medicine-pouch | medicine pouch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| medusa-skull | medusa skull | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| medusa-soul-core | medusa soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mega-dragon-soul-core | mega dragon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| megasylvan-plant | megasylvan plant | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| melon | melon | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| melting-horn | melting horn | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| memory-crystal | memory crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| memory-stone | memory stone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| menacing-carnivor-soul-core | menacing carnivor soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| menacing-egg | menacing egg | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| menacing-tapestry | menacing tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| menhir | menhir | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| menhir | menhir | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| menhir | menhir | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| merchant-portrait | merchant portrait | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| mercurial-menace-soul-core | mercurial menace soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mercury-blob-soul-core | mercury blob soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| meringue-cake | meringue cake | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| merlkin-soul-core | merlkin soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mermaid-figure-head | mermaid figure head | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| mermaid-figure-head | mermaid figure head | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| metal-file | metal file | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| metal-fitting | metal fitting | sem categoria de caça (primarytype "metals") | `data/items/items.xml` |
| metal-gargoyle-soul-core | metal gargoyle soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| metal-grate | metal grate | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| metal-grate | metal grate | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| metal-locker | metal locker | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| midnight-asura-soul-core | midnight asura soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| midnight-panther-soul-core | midnight panther soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| midnight-shard | midnight shard | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| midnight-spawn-soul-core | midnight spawn soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| midnight-warrior-soul-core | midnight warrior soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| milk-tooth | milk tooth | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| milking-fork | milking fork | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| mind-stone | mind stone | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| mini-mummy | mini mummy | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| mining-helmet | mining helmet | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| minotaur-amazon-soul-core | minotaur amazon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| minotaur-archer-soul-core | minotaur archer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| minotaur-backpack | minotaur backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| minotaur-cult-follower-soul-core | minotaur cult follower soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| minotaur-cult-prophet-soul-core | minotaur cult prophet soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| minotaur-cult-zealot-soul-core | minotaur cult zealot soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| minotaur-guard-soul-core | minotaur guard soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| minotaur-hunter-soul-core | minotaur hunter soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| minotaur-invader-soul-core | minotaur invader soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| minotaur-mage-soul-core | minotaur mage soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| minotaur-skull | minotaur skull | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| minotaur-skull | minotaur skull | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| minotaur-skull | minotaur skull | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| minotaur-soul-core | minotaur soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| minotaur-statue | minotaur statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| minotaur-statue | minotaur statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| minotaur-statue | minotaur statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| minotaur-statue | minotaur statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| minotaur-statue-kit | minotaur statue kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| minotaur-trophy | minotaur trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| mire-sprout | mire sprout | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| mirror | mirror | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| mirror | mirror | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| mirror | mirror | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| mirror | mirror | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| mirror-mask | mirror mask | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| misguided-bully-soul-core | misguided bully soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| misguided-thief-soul-core | misguided thief soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mitmah-scout-soul-core | mitmah scout soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mitmah-seer-soul-core | mitmah seer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| model-ship | model ship | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| model-ship-lamp | model ship lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| model-ship-lamp | model ship lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| model-ship-lamp | model ship lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| model-ship-lamp | model ship lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| modified-gnarlhound-soul-core | modified gnarlhound soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| moist-stones | moist stones | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| moist-wall | moist wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| mold-floor | mold floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| mole-soul-core | mole soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| molten-wax | molten wax | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| monk-exercise-dummy | monk exercise dummy | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| monk-exercise-dummy | monk exercise dummy | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| monk-pedestal | monk pedestal | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| monk-soul-core | monk soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| monkey | monkey | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| monkey | monkey | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| monkey-statue-hear-kit | monkey statue 'hear' kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| monkey-statue-see-kit | monkey statue 'see' kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| monkey-statue-speak-kit | monkey statue 'speak' kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| monkey-tail | monkey tail | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| monks-apparition-soul-core | monk's apparition soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mono-detector | mono detector | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| monument | monument | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| monument | monument | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| monument | monument | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| moohtah-warrior-soul-core | mooh'tah warrior soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| moohtant-soul-core | moohtant soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| moon-backpack | moon backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| moon-flower | moon flower | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| moon-flower | moon flower | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| moon-flowers | moon flowers | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| moon-herb | moon herb | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| moon-mirror | moon mirror | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| moonshine-bells | moonshine bells | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| morbid-tapestry | morbid tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| morgaroth-carpet | Morgaroth carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| morgaroth-carpet | Morgaroth carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| mossmasher-figurine | mossmasher figurine | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| mould-phantom-soul-core | mould phantom soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mouldy-cheese | mouldy cheese | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| mountain | mountain | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| mourning-mushroom | mourning mushroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| muck-remover | muck remover | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| mud | mud | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| mud | mud | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| mud-whip | mud whip | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| muddy-brick-wall | muddy brick wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| muddy-floor | muddy floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| muddy-floor | muddy floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| muddy-water | muddy water | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| mug | mug | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| mummy-disguise | mummy disguise | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| mummy-soul-core | mummy soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mushroom-backpack | mushroom backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| mushroom-corkscrew-stairs | mushroom corkscrew stairs | sem categoria de caça (primarytype "stairs") | `data/items/items.xml` |
| mushroom-house | mushroom house | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| mushroom-house | mushroom house | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| mushroom-pie | mushroom pie | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| mushroom-sniffer-soul-core | mushroom sniffer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mushroom-spores | mushroom spores | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| mushroom-table | mushroom table | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| music-box | music box | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| music-box | music box | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| mutated-bat-soul-core | mutated bat soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mutated-human-soul-core | mutated human soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mutated-rat-dummy | mutated rat dummy | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| mutated-rat-soul-core | mutated rat soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mutated-tiger-soul-core | mutated tiger soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mycobiontic-beetle-soul-core | mycobiontic beetle soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| mysterious-fetish | mysterious fetish | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| mysterious-metal-egg | mysterious metal egg | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| mysterious-metal-egg | mysterious metal egg | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| mysterious-ornate-chest | mysterious ornate chest | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| mysterious-voodoo-skull | mysterious voodoo skull | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| mystery-box | mystery box | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| mystic-carpet | mystic carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| mystic-flame | mystic flame | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| mystic-flame | mystic flame | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| mystic-flame | mystic flame | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| mystic-flame | mystic flame | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| mystic-root | mystic root | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| nacre-altar | nacre altar | sem categoria de caça (primarytype "shrines and altars") | `data/items/items.xml` |
| nacre-altar | nacre altar | sem categoria de caça (primarytype "shrines and altars") | `data/items/items.xml` |
| naga-archer-soul-core | naga archer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| naga-basin | naga basin | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| naga-katar | naga katar | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| naga-warrior-soul-core | naga warrior soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| nail | nail | sem categoria de caça (primarytype "metals") | `data/items/items.xml` |
| nail-case | nail case | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| nature-magic-spellbook | nature magic spellbook | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| nautical-map | nautical map | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| necromancer-soul-core | necromancer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| necrometer | necrometer | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| net | net | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| nibblemaw-soul-core | nibblemaw soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| night-sky-carpet | night sky carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| nightfiend-soul-core | nightfiend soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| nighthunter-soul-core | nighthunter soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| nightmare-beast-santa | nightmare beast santa | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| nightmare-doll | nightmare doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| nightmare-hook | nightmare hook | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| nightmare-horn | nightmare horn | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| nightmare-scion-soul-core | nightmare scion soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| nightmare-soul-core | nightmare soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| nightmare-teddy | nightmare teddy | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| nightshade-distillate | nightshade distillate | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| nightslayer-soul-core | nightslayer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| nightstalker-dummy | nightstalker dummy | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| nightstalker-soul-core | nightstalker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| nine-cans | nine cans | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| noble-lion-soul-core | noble lion soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| nomad-parchment | nomad parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| nomad-soul-core-basic | nomad soul core (basic) | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| nomad-soul-core-blue | nomad soul core (blue) | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| nomad-soul-core-female | nomad soul core (female) | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| norcferatu-heartless-soul-core | norcferatu heartless soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| norcferatu-nightweaver-soul-core | norcferatu nightweaver soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| norseman-doll | norseman doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| norseman-doll | norseman doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| norseman-doll | norseman doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| northern-fishburger | northern fishburger | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| northern-pike | northern pike | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| northern-pike-soul-core | northern pike soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| nothing | nothing | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| nothing-special | nothing special | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| nothing-special | nothing special | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| novice-of-the-cult-soul-core | novice of the cult soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| noxious-ripptor-soul-core | noxious ripptor soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| nunchaku | nunchaku | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| nunchaku-of-destruction | nunchaku of destruction | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| nunchaku-of-enlightenment | nunchaku of enlightenment | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| nymph-soul-core | nymph soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| obelisk | obelisk | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| observer-tapestry | observer tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| obsidian-knife | obsidian knife | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| obsidian-statue | obsidian statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| obsidian-zaoan-bishop | obsidian Zaoan bishop | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| obsidian-zaoan-bishop | obsidian Zaoan bishop | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| obsidian-zaoan-king | obsidian Zaoan king | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| obsidian-zaoan-king | obsidian Zaoan king | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| obsidian-zaoan-knight | obsidian Zaoan knight | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| obsidian-zaoan-knight | obsidian Zaoan knight | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| obsidian-zaoan-pawn | obsidian Zaoan pawn | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| obsidian-zaoan-pawn | obsidian Zaoan pawn | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| obsidian-zaoan-queen | obsidian Zaoan queen | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| obsidian-zaoan-queen | obsidian Zaoan queen | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| obsidian-zaoan-rook | obsidian Zaoan rook | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| obsidian-zaoan-rook | obsidian Zaoan rook | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| occupied-birdcage | occupied birdcage | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ocean-floor | ocean floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| ocean-floor | ocean floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| octoputz | octoputz | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| octoputz | octoputz | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| ogre-beer | Ogre beer | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ogre-brute-soul-core | ogre brute soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ogre-rowdy-doll | Ogre Rowdy Doll | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| ogre-rowdy-soul-core | ogre rowdy soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ogre-ruffian-soul-core | ogre ruffian soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ogre-sage-soul-core | ogre sage soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ogre-savage-soul-core | ogre savage soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ogre-shaman-soul-core | ogre shaman soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| oil-lamp | oil lamp | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| old-crate | old crate | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| old-desk | old desk | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| old-encrypted-text | old encrypted text | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| old-fanfare | old fanfare | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| old-flying-carpet | old flying carpet | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| old-iron | old iron | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| old-letter | old letter | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| old-letter | old letter | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| old-lock | old lock | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| old-lute | old lute | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| old-map | old map | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| old-nasty | Old Nasty | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| old-note | old note | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| old-parchment | old parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| old-parchment | old parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| old-parchment | old parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| old-parchment | old parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| old-pirate-poem | old pirate poem | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| old-power-core | old power core | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| old-radio | old radio | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| old-rag | old rag | sem categoria de caça (primarytype "clothing accessories") | `data/items/items.xml` |
| old-rush-wood | old rush wood | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| old-silver-key | old silver key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| old-steering-wheel | old steering wheel | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| old-tome | old tome | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| old-tree | old tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| old-twig | old twig | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| ominous-book | ominous book | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| ominous-mound | Ominous mound | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| ominous-soul-core | ominous soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ominously-glowing-pill | ominously glowing pill | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| omniscient-owl | omniscient owl | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| omniscient-owl | omniscient owl | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| omnivora-soul-core | omnivora soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| omrabas-bone-key | Omrabas' bone key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| omrabas-copper-key | Omrabas' copper key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| omrabas-heart | Omrabas' heart | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| omrabas-talking-skull | Omrabas' talking skull | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| onion | onion | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| onyx | onyx | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| onyx-arrow | onyx arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| onyx-marble | onyx marble | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| oozing-carcass-soul-core | oozing carcass soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| oozing-corpus-soul-core | oozing corpus soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| open-fence-gate | open fence gate | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| open-fence-gate | open fence gate | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| open-gate | open gate | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| open-gate | open gate | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| open-gate | open gate | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| open-gate | open gate | sem categoria de caça (primarytype "doors") | `data/items/items.xml` |
| open-metal-egg | open metal egg | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| opticompass-sphere | Opticompass sphere | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| opticorder-analyser | opticorder analyser | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| opticorder-analyser | opticorder analyser | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| opticorder-rectifier | opticorder rectifier | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| opticorder-rectifier | opticorder rectifier | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| opticording-sphere | opticording sphere | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| opticording-sphere | opticording sphere | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| opulent-book-case | opulent book case | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| opulent-book-case | opulent book case | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| opulent-carpet | opulent carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| opulent-chair | opulent chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| opulent-chair | opulent chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| opulent-chair | opulent chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| opulent-chair | opulent chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| opulent-chest | opulent chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| opulent-chest | opulent chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| opulent-chest | opulent chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| opulent-chest | opulent chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| opulent-floor-intarsia | opulent floor intarsia | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| opulent-item-stand | opulent item stand | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| opulent-spice-rack | opulent spice rack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| opulent-spice-rack | opulent spice rack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| opulent-table | opulent table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| opulent-table | opulent table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| opulent-table | opulent table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| opulent-table | opulent table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| opulent-wood-floor-planks | opulent wood floor planks | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| oracle-figurine | oracle figurine | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| oracle-figurine | oracle figurine | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| orange | orange | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| orange-25-years-balloon | orange 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| orange-25-years-balloon | orange 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| orange-25-years-balloon | orange 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| orange-backpack | orange backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| orange-bag | orange bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| orange-balloon | orange balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| orange-balloon | orange balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| orange-balloon | orange balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| orange-cake-carpet | orange cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| orange-cake-carpet | orange cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| orange-dankshroom | orange dankshroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| orange-fireworks-powder | orange fireworks powder | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| orange-fireworks-rocket | orange fireworks rocket | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| orange-maple | orange maple | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| orange-marble | orange marble | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| orange-mushroom | orange mushroom | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| orange-shade | orange shade | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| orange-star | orange star | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| orange-tapestry | orange tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| orange-tibia-carpet | orange Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| orange-tibia-carpet | orange Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| orange-tree | orange tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| orb | orb | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| orc-balloon | orc balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| orc-balloon | orc balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| orc-balloon | orc balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| orc-berserker-soul-core | orc berserker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orc-cult-fanatic-soul-core | orc cult fanatic soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orc-cult-inquisitor-soul-core | orc cult inquisitor soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orc-cult-minion-soul-core | orc cult minion soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orc-cult-priest-soul-core | orc cult priest soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orc-cultist-soul-core | orc cultist soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orc-hammer | orc hammer | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| orc-head-balloon | orc head balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| orc-head-balloon | orc head balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| orc-head-balloon | orc head balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| orc-leader-soul-core | orc leader soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orc-marauder-soul-core | orc marauder soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orc-rider-soul-core | orc rider soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orc-shaman-soul-core | orc shaman soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orc-skull | orc skull | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| orc-soul-core | orc soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orc-spearman-soul-core | orc spearman soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orc-trophy | orc trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| orc-warlord-soul-core | orc warlord soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orc-warrior-soul-core | orc warrior soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orchid | orchid | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| orchid-frog-soul-core | orchid frog soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orcish-pole | orcish pole | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| orcish-totem-pole | orcish totem pole | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| orclops-bloodbreaker-soul-core | orclops bloodbreaker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orclops-doomhauler-soul-core | orclops doomhauler soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orclops-ravager-soul-core | orclops ravager soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orclops-santa | orclops santa | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| orewalker-soul-core | orewalker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| orger-soul-core | orger soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| oriental-pillar | oriental pillar | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| ornamented-ankh | ornamented ankh | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ornamented-chest | ornamented chest | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| ornamented-chest | ornamented chest | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| ornamented-fountain | ornamented fountain | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| ornamented-scorpion-table | ornamented scorpion table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| ornamented-scorpion-table | ornamented scorpion table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| ornamented-stone-pedestal | ornamented stone pedestal | sem categoria de caça (primarytype "shrines and altars") | `data/items/items.xml` |
| ornamented-stone-table | ornamented stone table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ornamented-wall | ornamented wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| ornamented-wall | ornamented wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| ornate-cabinet | ornate cabinet | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| ornate-cabinet | ornate cabinet | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| ornate-canopic-jar | ornate canopic jar | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| ornate-canopic-jar | ornate canopic jar | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| ornate-carving-axe | ornate carving axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-carving-blade | ornate carving blade | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-carving-bow | ornate carving bow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| ornate-carving-chopper | ornate carving chopper | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-carving-crossbow | ornate carving crossbow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| ornate-carving-hammer | ornate carving hammer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-carving-mace | ornate carving mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-carving-rod | ornate carving rod | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-carving-slayer | ornate carving slayer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-carving-wand | ornate carving wand | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-chest | ornate chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| ornate-chest | ornate chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| ornate-chest | ornate chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| ornate-chest | ornate chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| ornate-mailbox | ornate mailbox | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ornate-mailbox | ornate mailbox | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ornate-mayhem-axe | ornate mayhem axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-mayhem-blade | ornate mayhem blade | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-mayhem-bow | ornate mayhem bow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| ornate-mayhem-chopper | ornate mayhem chopper | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-mayhem-crossbow | ornate mayhem crossbow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| ornate-mayhem-hammer | ornate mayhem hammer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-mayhem-mace | ornate mayhem mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-mayhem-rod | ornate mayhem rod | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-mayhem-slayer | ornate mayhem slayer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-mayhem-wand | ornate mayhem wand | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-remedy-axe | ornate remedy axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-remedy-blade | ornate remedy blade | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-remedy-bow | ornate remedy bow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| ornate-remedy-chopper | ornate remedy chopper | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-remedy-crossbow | ornate remedy crossbow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| ornate-remedy-hammer | ornate remedy hammer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-remedy-mace | ornate remedy mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-remedy-rod | ornate remedy rod | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-remedy-slayer | ornate remedy slayer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-remedy-wand | ornate remedy wand | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| ornate-table | ornate table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| ornate-table | ornate table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| ornate-tome | ornate tome | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| ornate-tome | ornate tome | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| orshabaal-carpet | Orshabaal carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| orshabaal-carpet | Orshabaal carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| oven | oven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven | oven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven | oven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven | oven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven | oven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven | oven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven | oven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven | oven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven | oven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven | oven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven | oven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven | oven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven | oven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven | oven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven-kit | oven kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| oven-spatula | oven spatula | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| overcooked-noodles | overcooked noodles | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| painting | painting | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| painting | painting | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| pair-of-iron-fists | pair of iron fists | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| pair-of-monk-fists | pair of monk fists | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| paladin-pedestal | paladin pedestal | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| paladins-apparition-soul-core | paladin's apparition soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| palisade | palisade | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| palm | palm | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| palm-lettuce-coral | palm lettuce coral | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| palm-lettuce-coral | palm lettuce coral | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| pan | pan | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| panda-soul-core | panda soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| panda-teddy | panda teddy | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| panda-teddy | panda teddy | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| pannier-backpack | pannier backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| panpipes | panpipes | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| paper-streamers | paper streamers | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| papyrus-deed | papyrus deed | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| paralyse-rune | paralyse rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| parcel | parcel | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| parcel | parcel | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| parchment | parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| parchment | parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| parchment | parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| parchment | parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| parchment | parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| parchment | parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| parchment | parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| parchment | parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| parchment | parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| parchment | parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| parchment | parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| parchment | parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| parchment | parchment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| parder-soul-core | parder soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| parquet-floor | parquet floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| parquet-floor | parquet floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| parrot-soul-core | parrot soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| partially-charged-lodestone | partially charged lodestone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| particle-accelerator | particle accelerator | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| party-cake | party cake | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| party-trumpet | party trumpet | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| party-trumpet | party trumpet | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| party-wall-snake | party wall snake | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| party-wall-tinsel | party wall tinsel | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| pastry-dragon | pastry dragon | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| pathfinder-kit | pathfinder kit | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| patterned-carpet | patterned carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| peacock-feather | peacock feather | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| peanut | peanut | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| pear | pear | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| pear-tree | pear tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| peas | peas | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| pedestal | pedestal | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| pedestal | pedestal | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| pedestal | pedestal | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| pedestal | pedestal | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| pedestal | pedestal | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| peeing-orc | peeing orc | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| pegasus-feather | pegasus feather | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| pendulum | pendulum | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| pendulum-clock | pendulum clock | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| pendulum-clock | pendulum clock | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| pendulum-clock | pendulum clock | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| pendulum-clock | pendulum clock | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| pendulum-clock | pendulum clock | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| pendulum-clock-kit | pendulum clock kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| penguin-soul-core | penguin soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| peppermint-backpack | peppermint backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| peppermoon-bells | peppermoon bells | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| percht-soul-core | percht soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| percht-warding-torch | percht-warding torch | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| perfume-flacon | perfume flacon | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| pestbringer | pestbringer | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| pester-maws | pester maws | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| pester-maws | pester maws | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| pester-maws | pester maws | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| pester-maws | pester maws | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| pestilent-fern | pestilent fern | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| pet-pig | pet pig | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| phantasm-soul-core | phantasm soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| pharaoh-banner | pharaoh banner | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pharaoh-dummy | pharaoh dummy | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| phoenix-charm | phoenix charm | sem categoria de caça (primarytype "blessing charms") | `data/items/items.xml` |
| phoenix-egg | phoenix egg | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| phoenix-statue | phoenix statue | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| phoenix-statue | phoenix statue | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| phoenix-statue | phoenix statue | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| physical-amplification | physical amplification | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| physical-resilience | physical resilience | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| piano | piano | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| piano | piano | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| piano | piano | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| piano | piano | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| piano | piano | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| piano | piano | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| piano-kit | piano kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| pick | pick | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| pick | pick | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| pick | pick | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| picture-album | picture album | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| piercing-bolt | piercing bolt | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| pig-soul-core | pig soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| pigeon-soul-core | pigeon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| pigeon-trophy | pigeon trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| pigeon-trophy | pigeon trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| piggy-bank | piggy bank | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pillar | pillar | sem categoria de caça (primarytype "traps") | `data/items/items.xml` |
| pillar | pillar | sem categoria de caça (primarytype "traps") | `data/items/items.xml` |
| pillar | pillar | sem categoria de caça (primarytype "traps") | `data/items/items.xml` |
| pillar | pillar | sem categoria de caça (primarytype "traps") | `data/items/items.xml` |
| pillar | pillar | sem categoria de caça (primarytype "traps") | `data/items/items.xml` |
| pillar | pillar | sem categoria de caça (primarytype "traps") | `data/items/items.xml` |
| pillar-railing | pillar railing | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| pillar-railing | pillar railing | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| pillar-vine | pillar vine | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| pillow-backpack | pillow backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| pinata | pinata | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pinata-dragon | Pinata Dragon | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| pine | pine | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| pine | pine | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| pineapple | pineapple | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| pink-25-years-balloon | pink 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pink-25-years-balloon | pink 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pink-25-years-balloon | pink 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pink-balloon | pink balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pink-balloon | pink balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pink-balloon | pink balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pink-cake-carpet | pink cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| pink-cake-carpet | pink cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| pink-fluid | pink fluid | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| pink-gloud-essence | pink gloud essence | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| pink-roses | pink roses | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pink-tibia-carpet | pink Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| pink-tibia-carpet | pink Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| pirat-bombardier-soul-core | pirat bombardier soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| pirat-cutthroat-soul-core | pirat cutthroat soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| pirat-mate-soul-core | pirat mate soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| pirat-scoundrel-soul-core | pirat scoundrel soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| pirate-backpack | pirate backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| pirate-bag | pirate bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| pirate-buccaneer-soul-core | pirate buccaneer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| pirate-corsair-soul-core | pirate corsair soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| pirate-cutthroat-soul-core | pirate cutthroat soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| pirate-flag | pirate flag | sem categoria de caça (primarytype "flags") | `data/items/items.xml` |
| pirate-flag | pirate flag | sem categoria de caça (primarytype "flags") | `data/items/items.xml` |
| pirate-ghost-soul-core | pirate ghost soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| pirate-marauder-soul-core | pirate marauder soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| pirate-ship-ballista | pirate ship ballista | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pirate-ship-ballista | pirate ship ballista | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pirate-ship-ballista | pirate ship ballista | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pirate-ship-ballista | pirate ship ballista | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pirate-skeleton-soul-core | pirate skeleton soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| pirate-tapestry | pirate tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pirate-treasure-chest | pirate treasure chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| pirate-treasure-chest | pirate treasure chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| pirate-treasure-map | pirate treasure map | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| pirate-voodoo-doll | pirate voodoo doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| pitch-black-gap | pitch black gap | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| pitchfork | pitchfork | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| pitfall | pitfall | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| pitfall | pitfall | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| pitfall | pitfall | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| pitfall | pitfall | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| pitfall | pitfall | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| pitfall | pitfall | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| pixie-soul-core | pixie soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| plague-bell | plague bell | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| plague-mask | plague mask | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| plaguesmith-soul-core | plaguesmith soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| plain-carving-axe | plain carving axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-carving-blade | plain carving blade | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-carving-bow | plain carving bow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| plain-carving-chopper | plain carving chopper | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-carving-crossbow | plain carving crossbow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| plain-carving-hammer | plain carving hammer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-carving-mace | plain carving mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-carving-rod | plain carving rod | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-carving-slayer | plain carving slayer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-carving-wand | plain carving wand | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-mayhem-axe | plain mayhem axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-mayhem-blade | plain mayhem blade | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-mayhem-bow | plain mayhem bow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| plain-mayhem-chopper | plain mayhem chopper | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-mayhem-crossbow | plain mayhem crossbow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| plain-mayhem-hammer | plain mayhem hammer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-mayhem-mace | plain mayhem mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-mayhem-rod | plain mayhem rod | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-mayhem-slayer | plain mayhem slayer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-mayhem-wand | plain mayhem wand | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-remedy-axe | plain remedy axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-remedy-blade | plain remedy blade | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-remedy-bow | plain remedy bow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| plain-remedy-chopper | plain remedy chopper | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-remedy-crossbow | plain remedy crossbow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| plain-remedy-hammer | plain remedy hammer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-remedy-mace | plain remedy mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-remedy-rod | plain remedy rod | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-remedy-slayer | plain remedy slayer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plain-remedy-wand | plain remedy wand | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| plate | plate | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| plum | plum | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| plum-tree | plum tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| poacher-soul-core | poacher soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| poem-scroll | poem scroll | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| poem-scroll | poem scroll | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| poison-arrow | poison arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| poison-bomb-rune | poison bomb rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| poison-field-rune | poison field rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| poison-gas | poison gas | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| poison-gas | poison gas | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| poison-salt-crystal | poison salt crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| poison-spider-soul-core | poison spider soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| poison-wall-rune | poison wall rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| poisonous-carnisylvan-soul-core | poisonous carnisylvan soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| polar-bear-soul-core | polar bear soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| pomegranate | pomegranate | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| pooka-soul-core | pooka soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| poplar | poplar | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| portable-aqueduct | portable aqueduct | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| portable-aqueduct | portable aqueduct | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| portable-aqueduct | portable aqueduct | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| portable-aqueduct | portable aqueduct | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| portable-aqueduct | portable aqueduct | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| portable-aqueduct | portable aqueduct | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| portable-aqueduct | portable aqueduct | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| portable-aqueduct | portable aqueduct | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| portable-hole | portable hole | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| post-horn | post horn | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| pot | pot | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| potato | potato | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| potion-stand | potion stand | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| potion-stand | potion stand | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| potted-flower | potted flower | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| potted-flower | potted flower | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| potted-flower | potted flower | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| powder-herb | powder herb | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| power-bolt | power bolt | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| power-ring | power ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| powerful-bash-scroll | powerful bash scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-blockade-scroll | powerful blockade scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-chop-scroll | powerful chop scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-cloud-fabric-scroll | powerful cloud fabric scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-demon-presence-scroll | powerful demon presence scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-dragon-hide-scroll | powerful dragon hide scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-electrify-scroll | powerful electrify scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-epiphany-scroll | powerful epiphany scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-featherweight-scroll | powerful featherweight scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-frost-scroll | powerful frost scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-lich-shroud-scroll | powerful lich shroud scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-precision-scroll | powerful precision scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-punch-scroll | powerful punch scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-quara-scale-scroll | powerful quara scale scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-reap-scroll | powerful reap scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-scorch-scroll | powerful scorch scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-slash-scroll | powerful slash scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-snake-skin-scroll | powerful snake skin scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-strike-scroll | powerful strike scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-swiftness-scroll | powerful swiftness scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-vampirism-scroll | powerful vampirism scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-venom-scroll | powerful venom scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-vibrancy-scroll | powerful vibrancy scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| powerful-void-scroll | powerful void scroll | sem categoria de caça (primarytype "imbuement scrolls") | `data/items/items.xml` |
| precious-necklace | precious necklace | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| predator-lamp | predator lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| predator-lamp | predator lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| premium-scroll | premium scroll | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| prepared-bucket | prepared bucket | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| present | present | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| present | present | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| present | present | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| present | present | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| pretty-clay-statue | pretty clay statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| prickly-pear | prickly pear | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| priestess-of-the-wild-sun-soul-core | priestess of the wild sun soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| priestess-soul-core | priestess soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| prismatic-bolt | prismatic bolt | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| prismatic-ring | prismatic ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| prison-cell-key | prison cell key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| proficiency-catalyst | proficiency catalyst | sem categoria de caça (primarytype "other items") | `data/items/items.xml` |
| protectress-lamp | protectress lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| protectress-lamp | protectress lamp | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| psychedelic-marble | psychedelic marble | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| psychedelic-tapestry | psychedelic tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| puffball-mushroom | puffball mushroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| puffball-mushroom | puffball mushroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| pumpkin | pumpkin | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| pumpkinhead | pumpkinhead | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pumpkinhead | pumpkinhead | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| pure-energy | pure energy | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| purified-soul | purified soul | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| purified-soul | purified soul | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| purple-25-years-balloon | purple 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| purple-25-years-balloon | purple 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| purple-backpack | purple backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| purple-bag | purple bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| purple-balloon | purple balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| purple-balloon | purple balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| purple-balloon | purple balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| purple-cake-carpet | purple cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| purple-cake-carpet | purple cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| purple-cardinal | purple cardinal | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| purple-fireworks-powder | purple fireworks powder | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| purple-fireworks-rocket | purple fireworks rocket | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| purple-kiss-blossom | purple kiss blossom | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| purple-kiss-bush | purple kiss bush | sem categoria de caça (primarytype "bushes") | `data/items/items.xml` |
| purple-nightshade | purple nightshade | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| purple-nightshade-blossoms | purple nightshade blossoms | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| purple-powder | purple powder | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| purple-tapestry | purple tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| purple-tendril-lantern | purple tendril lantern | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| purple-tibia-carpet | purple Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| purple-tibia-carpet | purple Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| purple-tome | purple tome | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| purse | purse | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| putrid-mummy-soul-core | putrid mummy soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| quagmire-moss | quagmire moss | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| quara-constrictor-scout-soul-core | quara constrictor scout soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| quara-constrictor-soul-core | quara constrictor soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| quara-hydromancer-scout-soul-core | quara hydromancer scout soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| quara-hydromancer-soul-core | quara hydromancer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| quara-looter-soul-core | quara looter soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| quara-mantassin-scout-soul-core | quara mantassin scout soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| quara-mantassin-soul-core | quara mantassin soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| quara-pincher-scout-soul-core | quara pincher scout soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| quara-pincher-soul-core | quara pincher soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| quara-plunderer-soul-core | quara plunderer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| quara-predator-scout-soul-core | quara predator scout soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| quara-predator-soul-core | quara predator soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| quara-raider-soul-core | quara raider soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| queen-eloise-bust | Queen Eloise bust | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| queen-eloise-bust | Queen Eloise bust | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| rabbit-soul-core | rabbit soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| rabid-wolf-soul-core | rabid wolf soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| raccoon-backpack | raccoon backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| raccoon-santa | raccoon santa | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| rage-squid-soul-core | rage squid soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ragged-rabid-wolf-soul-core | ragged rabid wolf soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| raging-fire-soul-core | raging fire soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| rain-coat | rain coat | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| rainbow-torch | rainbow torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| rainbow-torch | rainbow torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| rainbow-torch | rainbow torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| rainbow-trout | rainbow trout | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| rake | rake | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| rare-crystal | rare crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| rare-crystal | rare crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| rascoohan-rat-revealer | rascoohan rat revealer | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| raspberry | raspberry | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| rat-cheese | rat cheese | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| rat-god-doll | rat god doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| rat-soul-core | rat soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| raven-herb | raven herb | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| ravenous-lava-lurker-soul-core | ravenous lava lurker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| reagent-flask | reagent flask | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| reality-reaver-soul-core | reality reaver soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| recharging-tarantula-trap | recharging tarantula trap | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| recipe | recipe | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| red-25-years-balloon | red 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| red-25-years-balloon | red 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| red-25-years-balloon | red 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| red-apple | red apple | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| red-backpack | red backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| red-bag | red bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| red-balloon | red balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| red-balloon | red balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| red-balloon | red balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| red-balloons | red balloons | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| red-bed-kit | red bed kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-cake-carpet | red cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| red-cake-carpet | red cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| red-christmas-bundle | red christmas bundle | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| red-christmas-garland | red christmas garland | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| red-crystal-rods | red crystal rods | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| red-crystals | red crystals | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| red-crystals | red crystals | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| red-cushioned-chair | red cushioned chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-cushioned-chair | red cushioned chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-cushioned-chair | red cushioned chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-cushioned-chair | red cushioned chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-cushioned-chair-kit | red cushioned chair kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-ectoplasm | red ectoplasm | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| red-ectoplasm | red ectoplasm | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| red-ectoplasmic-residue | red ectoplasmic residue | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| red-energy-ball | red energy ball | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| red-fireworks-powder | red fireworks powder | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| red-fireworks-rocket | red fireworks rocket | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| red-footboard | red footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-footboard | red footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-footboard | red footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-footboard | red footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-gem | red gem | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| red-geranium | red geranium | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| red-gingerbread-heart | red gingerbread heart | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| red-headboard | red headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-headboard | red headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-headboard | red headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-headboard | red headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-headboard | red headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-headboard | red headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-lever | red lever | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| red-maple | red maple | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| red-marble | red marble | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| red-mushroom | red mushroom | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| red-paint | red paint | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| red-pillow | red pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| red-pit-demon | red pit demon | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| red-powder | red powder | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| red-power-core | red power core | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| red-present-kit | red present kit | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| red-rose | red rose | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| red-roses | red roses | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| red-shrine-stone | red shrine stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| red-silk-flower | red silk flower | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| red-spores | red spores | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| red-tapestry | red tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| red-teleport-crystal | red teleport crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| red-tibia-carpet | red Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| red-tibia-carpet | red Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| red-tome | red tome | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| red-traditional-chair | red traditional chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-traditional-chair | red traditional chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-traditional-chair | red traditional chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-traditional-chair | red traditional chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-traditional-rack | red traditional rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-traditional-rack | red traditional rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-traditional-table | red traditional table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-wall-hangings | red wall hangings | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| red-wooden-candelabra | red wooden candelabra | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-wooden-candelabra | red wooden candelabra | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-wooden-candelabra | red wooden candelabra | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| red-wooden-candelabra | red wooden candelabra | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| redeemed-soul-soul-core | redeemed soul soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| reed-balls | reed balls | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| reins | reins | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| reinvigorating-seeds | reinvigorating seeds | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| rending-inferniarch-claws | rending inferniarch claws | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| renegade-knight-soul-core | renegade knight soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| renegade-quara-constrictor-soul-core | renegade quara constrictor soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| renegade-quara-hydromancer-soul-core | renegade quara hydromancer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| renegade-quara-mantassin-soul-core | renegade quara mantassin soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| renegade-quara-pincher-soul-core | renegade quara pincher soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| renegade-quara-predator-soul-core | renegade quara predator soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| research-notes | research notes | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| resin-parasite | resin parasite | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| resinous-fish-fin | resinous fish fin | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| resonance-crystal | resonance crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| resonance-crystal | resonance crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| retching-horror-doll | Retching Horror Doll | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| retching-horror-soul-core | retching horror soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| reward-box | reward box | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| reward-box | reward box | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| reward-chest | reward chest | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| reward-container | reward container | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| reward-shrine | reward shrine | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| reward-shrine | reward shrine | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| rhindeer-soul-core | rhindeer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| rice-ball | rice ball | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| rift-carpet | rift carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rift-floor | rift floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rift-floor | rift floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rift-floor | rift floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rift-floor | rift floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rift-floor | rift floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rift-floor | rift floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rift-floor | rift floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rift-floor | rift floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rift-floor | rift floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rift-floor | rift floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rift-floor | rift floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rift-floor | rift floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rift-floor | rift floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rift-lamp | rift lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| rift-lamp | rift lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| rift-tapestry | rift tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| right-horn | right horn | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ripper-spectre-soul-core | ripper spectre soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| ritual-figurine | ritual figurine | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ritual-scissors | ritual scissors | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| ritual-stone-tablet | ritual stone tablet | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ritual-sword | ritual sword | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| roaring-lion-soul-core | roaring lion soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| roast-pork-soul-core | roast pork soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| roasted-dragon-wings | roasted dragon wings | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| roasted-meat | roasted meat | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| roasted-meat | roasted meat | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| roasted-wyvern-wings | roasted wyvern wings | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| roc-feather | roc feather | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| rock | rock | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rock-soil | rock soil | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rock-soil | rock soil | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rock-soil | rock soil | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rock-soil | rock soil | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| rocking-chair | rocking chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rocking-chair | rocking chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rocking-chair | rocking chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rocking-chair | rocking chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rocking-chair-kit | rocking chair kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rocking-horse | rocking horse | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rocking-horse | rocking horse | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rocking-horse | rocking horse | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rocking-horse | rocking horse | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rocking-horse-kit | rocking horse kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| roll | roll | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| rolled-up-azure-carpet | rolled-up azure carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-bamboo-mat | rolled-up bamboo mat | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-colourful-carpet | rolled-up colourful carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-crimson-carpet | rolled-up crimson carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-diamond-carpet | rolled-up diamond carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-emerald-carpet | rolled-up emerald carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-flowery-carpet | rolled-up flowery carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-fur-carpet | rolled-up fur carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-mystic-carpet | rolled-up mystic carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-night-sky-carpet | rolled-up night sky carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-opulent-carpet | rolled-up opulent carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-patterned-carpet | rolled-up patterned carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-shaggy-carpet | rolled-up shaggy carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-star-carpet | rolled-up star carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-striped-carpet | rolled-up striped carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-verdant-carpet | rolled-up verdant carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolled-up-wheat-carpet | rolled-up wheat carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| rolling-pin | rolling pin | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| rolling-pin | rolling pin | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| roof | roof | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| roof | roof | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| roof | roof | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| roof | roof | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| roof | roof | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| roof | roof | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| roof | roof | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| roof | roof | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| roof | roof | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| root-tentacle | root tentacle | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| root-vegetable-dish | root vegetable dish | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| rooted-evil | rooted evil | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| rooted-evil | rooted evil | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| rooted-evil | rooted evil | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| rootthing-amber-shaper-soul-core | rootthing amber shaper soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| rootthing-bug-tracker-soul-core | rootthing bug tracker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| rootthing-nutshell-soul-core | rootthing nutshell soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| rope | rope | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| rope | rope | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| rope | rope | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| rope | rope | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| rope-ladder | rope-ladder | sem categoria de caça (primarytype "ladders") | `data/items/items.xml` |
| rorc-soul-core | rorc soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| rosebush | rosebush | sem categoria de caça (primarytype "bushes") | `data/items/items.xml` |
| rot-elemental-soul-core | rot elemental soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| rotten-golem-soul-core | rotten golem soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| rotten-man-maggot-soul-core | rotten man-maggot soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| rotten-meat | rotten meat | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| rotten-witches-cauldron-seed | rotten witches' cauldron seed | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| rotworm-balloon | rotworm balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| rotworm-balloon | rotworm balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| rotworm-balloon | rotworm balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| rotworm-head-balloon | rotworm head balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| rotworm-head-balloon | rotworm head balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| rotworm-head-balloon | rotworm head balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| rotworm-soul-core | rotworm soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| rotworm-stew | rotworm stew | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| rough-clay-statue | rough clay statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| rough-marble-statue | rough marble statue | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| rough-red-gem | rough red gem | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| round-blue-pillow | round blue pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| round-purple-pillow | round purple pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| round-red-pillow | round red pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| round-side-table | round side table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| round-table-kit | round table kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| round-turquoise-pillow | round turquoise pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| royal-emblems | royal emblems | sem categoria de caça (primarytype "portals") | `data/items/items.xml` |
| royal-emblems | royal emblems | sem categoria de caça (primarytype "portals") | `data/items/items.xml` |
| royal-fanfare | royal fanfare | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| royal-medal | royal medal | sem categoria de caça (primarytype "contest prizes") | `data/items/items.xml` |
| royal-star | royal star | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| royal-tapestry | royal tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| rubble | rubble | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| ruby-fire-stone | ruby fire stone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| ruined-dark-wall | ruined dark wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| ruined-sculpture | ruined sculpture | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| rum-cask | rum cask | sem categoria de caça (primarytype "casks") | `data/items/items.xml` |
| rum-flask | rum flask | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| rush-wood | rush wood | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| rush-wood | rush wood | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| rush-wood | rush wood | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| rustheap-golem-soul-core | rustheap golem soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| rustic-cabinet | rustic cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rustic-cabinet | rustic cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rustic-chair | rustic chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rustic-chair | rustic chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rustic-chair | rustic chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rustic-chair | rustic chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rustic-table | rustic table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rustic-table | rustic table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rustic-trunk | rustic trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rustic-trunk | rustic trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rustic-trunk | rustic trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rustic-trunk | rustic trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| rusty-anchor | rusty anchor | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| sabretooth-skull | sabretooth skull | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| sabretooth-skull | sabretooth skull | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| sabretooth-soul-core | sabretooth soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sacred-antler-talisman | sacred antler talisman | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| sacred-bowl | sacred bowl | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| sacred-coal | sacred coal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| sacred-earth | sacred earth | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| sacred-spider-soul-core | sacred spider soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sacrificial-plate | sacrificial plate | sem categoria de caça (primarytype "shrines and altars") | `data/items/items.xml` |
| sai-of-enlightenment | sai of enlightenment | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| sais | sais | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| salamander-soul-core | salamander soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| salmon | salmon | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| salt | salt | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| salted-cave-rat | salted cave rat | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| sand | sand | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sand | sand | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sand | sand | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sand | sand | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sand | sand | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sand | sand | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sand | sand | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sand | sand | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sand | sand | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sand | sand | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sand | sand | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sand | sand | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sand | sand | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sandcrawler-soul-core | sandcrawler soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sandfish | sandfish | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| sandscourge-figurine | sandscourge figurine | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| sandstone-floor | sandstone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| sandstone-floor | sandstone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| sandstone-pillar | sandstone pillar | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| sandstone-scorpion-soul-core | sandstone scorpion soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sandstone-statue | sandstone statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| sandstone-statue | sandstone statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| sandstone-statue | sandstone statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| sandstone-wall | sandstone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| sandstone-wall | sandstone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| sanguine-claws | sanguine claws | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| santa-backpack | santa backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| santa-doll | santa doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| santa-doll | santa doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| santa-fox | santa fox | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| santa-leech | santa leech | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| santa-teddy | santa teddy | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| sapphire-dust | sapphire dust | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| sapphire-stand | sapphire stand | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| sarcophagus | sarcophagus | sem categoria de caça (primarytype "coffins") | `data/items/items.xml` |
| sarcophagus | sarcophagus | sem categoria de caça (primarytype "coffins") | `data/items/items.xml` |
| sarcophagus | sarcophagus | sem categoria de caça (primarytype "coffins") | `data/items/items.xml` |
| sarcophagus | sarcophagus | sem categoria de caça (primarytype "coffins") | `data/items/items.xml` |
| saw | saw | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| scalpel | scalpel | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| scarab-cheese | scarab cheese | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| scarab-ocarina | scarab ocarina | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| scarab-soul-core | scarab soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| scared-frog | scared frog | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| schiach-soul-core | schiach soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| scorpion | scorpion | sem categoria de caça (primarytype "arachnids") | `data/items/items.xml` |
| scorpion-pillar | scorpion pillar | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| scorpion-sceptre | scorpion sceptre | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| scorpion-soul-core | scorpion soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| screaming-cherry | screaming cherry | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| screwdriver-holder | screwdriver holder | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| scribbled-notes | scribbled notes | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| scribbled-notes | scribbled notes | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| scroll | scroll | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| scroll | scroll | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| scroll | scroll | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| scroll | scroll | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| scrying-ball | scrying ball | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| sculptor-chest | sculptor chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| sculptor-chest | sculptor chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| sculptor-chest | sculptor chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| sculptor-chest | sculptor chest | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| sculptor-shelf | sculptor shelf | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| sculptor-shelf | sculptor shelf | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| sculptor-shelf | sculptor shelf | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| sculptor-shelf | sculptor shelf | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| scum-bag | scum bag | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| sea-anemone | sea anemone | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| sea-ear | sea ear | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| sea-serpent-soul-core | sea serpent soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sea-serpent-trophy | sea serpent trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| sea-serpent-trophy | sea serpent trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| seacrest-serpent-soul-core | seacrest serpent soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| seafarer-bed | seafarer bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-bed | seafarer bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-bed | seafarer bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-bed | seafarer bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-bed | seafarer bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-bed | seafarer bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-bed | seafarer bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-bed | seafarer bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-bed | seafarer bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-bed | seafarer bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-bed | seafarer bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-bed | seafarer bed | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-cabinet | seafarer cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-cabinet | seafarer cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-chair | seafarer chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-chair | seafarer chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-chair | seafarer chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-chair | seafarer chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-chest | seafarer chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-chest | seafarer chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-chest | seafarer chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-chest | seafarer chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-table | seafarer table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seafarer-table | seafarer table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| seagull-soul-core | seagull soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sealed-scroll | sealed scroll | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| searing-fire | searing fire | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| searing-fire | searing fire | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| seashell | seashell | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| seashell | seashell | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| seashell-lamp | seashell lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| seashell-lamp | seashell lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| seashell-lamp | seashell lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| seashell-lamp | seashell lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| seaweed | seaweed | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| seaweed | seaweed | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| secret-letter | secret letter | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| secret-map | secret map | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| sequoia-trunk | sequoia trunk | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| serpent-crest | serpent crest | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| serpent-spawn-soul-core | serpent spawn soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| seven-cans | seven cans | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| several-oxalis | several oxalis | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| sewer-grate | sewer grate | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| sewer-grate | sewer grate | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| sewer-grate | sewer grate | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| sewing-table | sewing table | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| sewing-table | sewing table | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| shaburak-demon-soul-core | shaburak demon soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| shaburak-lord-soul-core | shaburak lord soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| shaburak-prince-soul-core | shaburak prince soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| shadow-ashes | shadow ashes | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| shadow-bite-berries | shadow bite berries | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| shadow-bite-plant | shadow bite plant | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| shadow-cowl | shadow cowl | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| shadow-herb | shadow herb | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| shadow-hound-soul-core | shadow hound soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| shadow-orb | shadow orb | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| shadow-plant | shadow plant | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| shadow-pupil-soul-core | shadow pupil soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| shadowy-statue | shadowy statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| shaggy-carpet | shaggy carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| shallow-water | shallow water | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| shallow-water | shallow water | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| shallow-water | shallow water | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| shallow-water | shallow water | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| shallow-water | shallow water | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| shallow-water | shallow water | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| shallow-water | shallow water | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| shallow-water | shallow water | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| shapechanger | shapechanger | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| shaper-matriarch-soul-core | shaper matriarch soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| shapeshifter-ring | shapeshifter ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| shark-fin | shark fin | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| shark-jaws | shark jaws | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| shark-soul-core | shark soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| shark-teeth | shark teeth | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| sheep-soul-core | sheep soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| shell | shell | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| shell | shell | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| shell-drake-soul-core | shell drake soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| shield-nevermourn | shield Nevermourn | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| shimmer-ball | shimmer ball | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| shimmer-ball | shimmer ball | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| shimmer-glower | shimmer glower | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| shimmer-swimmer | shimmer swimmer | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| shining-sun-catcher | shining sun catcher | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| shiny-reward-shrine | shiny reward shrine | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| shiny-reward-shrine | shiny reward shrine | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| ship-bell | ship bell | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| ship-cabin-wall | ship cabin wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| ship-cabin-wall | ship cabin wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| ship-cabin-wall | ship cabin wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| ship-rudder-hole | ship rudder hole | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| shiver-arrow | shiver arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| shock-head-soul-core | shock head soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| shopping-bag | shopping bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| shovel | shovel | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| shovel | shovel | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| shovel | shovel | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| shovel | shovel | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| shrieking-cry-stal-soul-core | shrieking cry-stal soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| shrimp | shrimp | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| shroom-cupboard | shroom cupboard | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| shroom-cupboard | shroom cupboard | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| sibang-soul-core | sibang soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sight-of-surrender-soul-core | sight of surrender soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| signed-contract | signed contract | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| silencer-excretion | silencer excretion | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| silencer-soul-core | silencer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| silky-tapestry | silky tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| silver-cup | silver cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| silver-cup | silver cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| silver-cup | silver cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| silver-cup | silver cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| silver-cup | silver cup | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| silver-deed | silver deed | sem categoria de caça (primarytype "tournament rewards") | `data/items/items.xml` |
| silver-dust | silver dust | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| silver-goblet | silver goblet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| silver-goblet | silver goblet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| silver-hand-mirror | silver hand mirror | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| silver-hunter-trophy | silver hunter trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| silver-key | silver key | sem categoria de caça (primarytype "keys") | `data/items/items.xml` |
| silver-key | silver key | sem categoria de caça (primarytype "keys") | `data/items/items.xml` |
| silver-nuggets | silver nuggets | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| silver-prison-key | silver prison key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| silver-rabbit-soul-core | silver rabbit soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| silver-vein | silver vein | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| silver-warrior-trophy | silver warrior trophy | sem categoria de caça (primarytype "contest prizes") | `data/items/items.xml` |
| silvered-trap | silvered trap | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| simple-arrow | simple arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| simple-bed | simple bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| simple-bed | simple bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| simple-bed | simple bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| simple-bed | simple bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| simple-bed | simple bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| simple-bed | simple bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| simple-bed | simple bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| simple-bed | simple bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| simple-bed | simple bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| simple-bed | simple bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| simple-bed | simple bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| simple-bed | simple bed | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| simple-fanfare | simple fanfare | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| simple-fanfare | simple fanfare | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| simple-footboard | simple footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| simple-footboard | simple footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| simple-footboard | simple footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| simple-footboard | simple footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| simple-headboard | simple headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| simple-headboard | simple headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| simple-headboard | simple headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| simple-headboard | simple headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| simple-headboard | simple headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| simple-headboard | simple headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| simple-jo-staff | simple jo staff | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| sineater-inferniarch-soul-core | sineater inferniarch soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| single-oxalis | single oxalis | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| sinister-book | sinister book | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| siphoning-inferniarch-claws | siphoning inferniarch claws | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| six-cans | six cans | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| skeletal-cabinet | skeletal cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| skeletal-cabinet | skeletal cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| skeletal-chair | skeletal chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| skeletal-chair | skeletal chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| skeletal-chair | skeletal chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| skeletal-chair | skeletal chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| skeletal-chest | skeletal chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| skeletal-chest | skeletal chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| skeletal-chest | skeletal chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| skeletal-chest | skeletal chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| skeletal-table | skeletal table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| skeletal-table | skeletal table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| skeleton | skeleton | sem categoria de caça (primarytype "skeletons") | `data/items/items.xml` |
| skeleton | skeleton | sem categoria de caça (primarytype "skeletons") | `data/items/items.xml` |
| skeleton | skeleton | sem categoria de caça (primarytype "skeletons") | `data/items/items.xml` |
| skeleton | skeleton | sem categoria de caça (primarytype "skeletons") | `data/items/items.xml` |
| skeleton-decoration | skeleton decoration | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| skeleton-elite-warrior-soul-core | skeleton elite warrior soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| skeleton-soul-core | skeleton soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| skeleton-warrior-soul-core | skeleton warrior soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| skinning-knife | skinning knife | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| skull-candle | skull candle | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| skull-candle | skull candle | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| skull-candle | skull candle | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| skull-coin | skull coin | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| skull-orchid | skull orchid | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| skull-pillar | skull pillar | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| skull-pillar | skull pillar | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| skunk-soul-core | skunk soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sky-cake-carpet | sky cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| sky-cake-carpet | sky cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| sky-tibia-carpet | sky Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| sky-tibia-carpet | sky Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| slate-floor | slate floor | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sleeping-hyaena | sleeping hyaena | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| sleeping-mat | sleeping mat | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sleeping-mat | sleeping mat | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sleeping-mat | sleeping mat | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sleeping-mat | sleeping mat | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sleeping-mat | sleeping mat | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sleeping-mat | sleeping mat | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sleeping-mat | sleeping mat | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sleeping-mat | sleeping mat | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sleeping-mat | sleeping mat | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sleeping-mat | sleeping mat | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sleeping-mat | sleeping mat | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sleeping-mat | sleeping mat | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| slightly-feline-statue | slightly feline statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| slime-fungus | slime fungus | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| slime-gobbler | slime gobbler | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| slime-soul-core | slime soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| slime-table-mushrooms | slime table mushrooms | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| sling-herb | sling herb | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| slingshot | slingshot | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| sludge-fern | sludge fern | sem categoria de caça (primarytype "ferns") | `data/items/items.xml` |
| slug-drug | slug drug | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| slug-soul-core | slug soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| slumbering-tree | slumbering tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| small-axe | small axe | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| small-bass | small bass | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| small-birch | small birch | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| small-blue-crystals | small blue crystals | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| small-blue-pillow | small blue pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| small-blue-present-kit | small blue present kit | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| small-boat | small boat | sem categoria de caça (primarytype "transportation") | `data/items/items.xml` |
| small-boat | small boat | sem categoria de caça (primarytype "transportation") | `data/items/items.xml` |
| small-cask | small cask | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| small-coral | small coral | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| small-coral | small coral | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| small-coral | small coral | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| small-crystal-bell | small crystal bell | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| small-dragon-tear | small dragon tear | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| small-fern | small fern | sem categoria de caça (primarytype "ferns") | `data/items/items.xml` |
| small-fir-tree | small fir tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| small-fir-tree | small fir tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| small-fish | small fish | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| small-golden-anchor | small golden anchor | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| small-golden-taboret | small golden taboret | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| small-gomphidius-mushroom | small gomphidius mushroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| small-green-crystals | small green crystals | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| small-green-pillow | small green pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| small-health-potion | small health potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| small-juniper-tree | small juniper tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| small-lamp | small lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| small-lit-pagoda | small lit pagoda | sem categoria de caça (primarytype "shrines and altars") | `data/items/items.xml` |
| small-lit-pagoda | small lit pagoda | sem categoria de caça (primarytype "shrines and altars") | `data/items/items.xml` |
| small-menhir | small menhir | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| small-orange-pillow | small orange pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| small-pagoda | small pagoda | sem categoria de caça (primarytype "shrines and altars") | `data/items/items.xml` |
| small-pearl-flower | small pearl flower | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| small-petrified-tortoise | small petrified tortoise | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| small-purple-pillow | small purple pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| small-red-crystals | small red crystals | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| small-red-pillow | small red pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| small-reward-box | small reward box | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| small-round-table | small round table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| small-snake-head | small snake head | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| small-snake-head | small snake head | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| small-snake-head | small snake head | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| small-snake-head | small snake head | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| small-table | small table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| small-table-kit | small table kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| small-tortoise | small tortoise | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| small-totem-pole | small totem pole | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| small-trunk | small trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| small-tuft-palm | small tuft palm | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| small-turquoise-pillow | small turquoise pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| small-whistle | small whistle | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| small-white-beech-mushrooms | small white beech mushrooms | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| small-white-pillow | small white pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| small-window | small window | sem categoria de caça (primarytype "windows") | `data/items/items.xml` |
| small-window | small window | sem categoria de caça (primarytype "windows") | `data/items/items.xml` |
| smashed-stone-head | smashed stone head | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| smelly-leather-legs | smelly leather legs | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| smoke | smoke | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| smoke | smoke | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| smoke | smoke | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| smoking-coal | smoking coal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| smoldering-bonfire | smoldering bonfire | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| smuggler-soul-core | smuggler soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| snake-destroyer | snake destroyer | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| snake-god-trophy | snake god trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| snake-maw | snake maw | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| snake-maw | snake maw | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| snake-nest-bush | snake nest bush | sem categoria de caça (primarytype "bushes") | `data/items/items.xml` |
| snake-sceptre | snake sceptre | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| snake-soul-core | snake soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sneeze-blossom | sneeze blossom | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| sniper-arrow | sniper arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow | snow | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| snow-flake-tapestry | snow flake tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| snow-globe | snow globe | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| snow-heap | snow heap | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| snowball | snowball | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| snowbash-figurine | snowbash figurine | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| snowman | snowman | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| snowman | snowman | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| snowman-doll | snowman doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| snowman-package | snowman package | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| snowy-fir-tree | snowy fir tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| snowy-pine-tree | snowy pine tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| sofa-chair | sofa chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sofa-chair | sofa chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sofa-chair | sofa chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sofa-chair | sofa chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sofa-chair-kit | sofa chair kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| soft-cheese | soft cheese | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| soft-green-chair | soft green chair | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| soft-hammer | soft hammer | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| solitude-charm | solitude charm | sem categoria de caça (primarytype "blessing charms") | `data/items/items.xml` |
| solstice-tree | solstice tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| solstice-tree | solstice tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| some-cracks | some cracks | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| some-golden-fruits | some golden fruits | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| some-leaves | some leaves | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| some-mushroom-fertilizer | some mushroom fertilizer | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| some-special-leaves | some special leaves | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| some-sunflowers | some sunflowers | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| some-truffels | some truffels | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| some-wood | some wood | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| something-crawling | something crawling | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| something-crawling | something crawling | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| something-crawling | something crawling | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| something-crawling | something crawling | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| son-of-verminor-soul-core | son of verminor soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| soothe-bloom | soothe bloom | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| sopping-carcass-soul-core | sopping carcass soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sopping-corpus-soul-core | sopping corpus soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sorcerer-pedestal | sorcerer pedestal | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| sorcerer-test-weapon-test | sorcerer test weapon TEST | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| sorcerers-apparition-soul-core | sorcerer's apparition soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sorrow | sorrow | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| soul-broken-harbinger-soul-core | soul-broken harbinger soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| soul-contract | soul contract | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| soul-net | soul net | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| soul-orb | soul orb | sem categoria de caça (primarytype "metals") | `data/items/items.xml` |
| souleater-soul-core | souleater soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| souleater-trophy | souleater trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| soulfire-rune | soulfire rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| soulforged-lantern | soulforged lantern | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| soulkamas | soulkamas | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| soup-kettle | soup kettle | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| spare-part | spare part | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| sparkion-soul-core | sparkion soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| special-balloon-box | special balloon box | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| special-carpet-box | special carpet box | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| special-fx-box | special fx box | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| special-polish | special polish | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| spectral-bolt | spectral bolt | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| spectral-bolt | spectral bolt | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| spectral-cloth | spectral cloth | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| spectral-stone | spectral stone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| spectre-soul-core | spectre soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| spell-rune | spell rune | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| spell-rune | spell rune | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| spell-rune | spell rune | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| spell-rune | spell rune | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| spell-rune | spell rune | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| spell-rune | spell rune | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| spell-rune | spell rune | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| spell-rune | spell rune | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| spellbook | spellbook | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| spellreaper-inferniarch-soul-core | spellreaper inferniarch soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| spellwand | spellwand | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| sphinx-soul-core | sphinx soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| spider | spider | sem categoria de caça (primarytype "arachnids") | `data/items/items.xml` |
| spider-egg | spider egg | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| spider-egg | spider egg | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| spider-soul-core | spider soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| spider-web | spider web | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| spiderwebs | spiderwebs | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| spidris-elite-soul-core | spidris elite soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| spidris-soul-core | spidris soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| spikes | spikes | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| spiky-carnivor-soul-core | spiky carnivor soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| spiral-shell | spiral shell | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| spirit-cage | spirit cage | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| spirit-container | spirit container | sem categoria de caça (primarytype "enchanted items") | `data/items/items.xml` |
| spirit-shovel | spirit shovel | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| spiritual-charm | spiritual charm | sem categoria de caça (primarytype "blessing charms") | `data/items/items.xml` |
| spit-nettle-soul-core | spit nettle soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| spitter-soul-core | spitter soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| spoon | spoon | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| sprocketwhip-cone | sprocketwhip cone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| spyreport | spyreport | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| square-side-table | square side table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| square-table | square table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| square-table-kit | square table kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| squid-warden-soul-core | squid warden soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| squidgy-slime-soul-core | squidgy slime soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| squirrel-soul-core | squirrel soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| stabilizer | stabilizer | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| stabilizing-dread-intruder-soul-core | stabilizing dread intruder soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| stabilizing-reality-reaver-soul-core | stabilizing reality reaver soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| staff | staff | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| stair | stair | sem categoria de caça (primarytype "stairs") | `data/items/items.xml` |
| stairs | stairs | sem categoria de caça (primarytype "stairs") | `data/items/items.xml` |
| stalagmite-rune | stalagmite rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| stalagmites | stalagmites | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| stalagmites | stalagmites | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| stalagmites | stalagmites | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| stale-mushroom-beer | stale mushroom beer | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| stalker-soul-core | stalker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| stalking-stalk-soul-core | stalking stalk soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| stamina-extension | stamina extension | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| stamped-letter | stamped letter | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| stamped-parcel | stamped parcel | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| stampor-soul-core | stampor soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| stand | stand | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| standing-mirror | standing mirror | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| standing-mirror | standing mirror | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| star-carpet | star carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| star-ring | star ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| starfish | starfish | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| starfish | starfish | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| starlight-buttercup | starlight buttercup | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| starlight-vial | starlight vial | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| starving-wolf-soul-core | starving wolf soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| stealth-ring | stealth ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| steel-spider-silk | steel spider silk | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| stimulated-brain | stimulated brain | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| stockfish | Stockfish | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| stolen-golden-goblet | stolen golden goblet | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| stone-archway | stone archway | sem categoria de caça (primarytype "portals") | `data/items/items.xml` |
| stone-archway | stone archway | sem categoria de caça (primarytype "portals") | `data/items/items.xml` |
| stone-archway | stone archway | sem categoria de caça (primarytype "portals") | `data/items/items.xml` |
| stone-coal-basin | stone coal basin | sem categoria de caça (primarytype "illumination") | `data/items/items.xml` |
| stone-coffin | stone coffin | sem categoria de caça (primarytype "coffins") | `data/items/items.xml` |
| stone-coffin | stone coffin | sem categoria de caça (primarytype "coffins") | `data/items/items.xml` |
| stone-devourer-soul-core | stone devourer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-floor | stone floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-golem-soul-core | stone golem soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| stone-ledge | stone ledge | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-pedestal | stone pedestal | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-pedestal | stone pedestal | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-pile | stone pile | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| stone-pile | stone pile | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| stone-pile | stone pile | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| stone-pile | stone pile | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| stone-pile | stone pile | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| stone-pile | stone pile | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| stone-pile | stone pile | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| stone-pile | stone pile | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| stone-pillar | stone pillar | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| stone-pillar | stone pillar | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| stone-pillar | stone pillar | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| stone-pillar | stone pillar | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| stone-pillar | stone pillar | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| stone-railing | stone railing | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-rhino-soul-core | stone rhino soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| stone-rubbish | stone rubbish | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| stone-rubbish | stone rubbish | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| stone-shelf | stone shelf | sem categoria de caça (primarytype "closets") | `data/items/items.xml` |
| stone-shelf | stone shelf | sem categoria de caça (primarytype "closets") | `data/items/items.xml` |
| stone-shower-rune | stone shower rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| stone-snake-pagoda | stone snake pagoda | sem categoria de caça (primarytype "shrines and altars") | `data/items/items.xml` |
| stone-spiked-club | stone spiked club | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| stone-spiked-club | stone spiked club | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| stone-stairs | stone stairs | sem categoria de caça (primarytype "stairs") | `data/items/items.xml` |
| stone-stairs | stone stairs | sem categoria de caça (primarytype "stairs") | `data/items/items.xml` |
| stone-stairs | stone stairs | sem categoria de caça (primarytype "stairs") | `data/items/items.xml` |
| stone-stairs | stone stairs | sem categoria de caça (primarytype "stairs") | `data/items/items.xml` |
| stone-stairs | stone stairs | sem categoria de caça (primarytype "stairs") | `data/items/items.xml` |
| stone-stairs | stone stairs | sem categoria de caça (primarytype "stairs") | `data/items/items.xml` |
| stone-table-kit | stone table kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| stone-tablet | stone tablet | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| stone-tile | stone tile | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-tile | stone tile | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-tile | stone tile | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-tile | stone tile | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-tile | stone tile | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-tile | stone tile | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-tile | stone tile | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-tile | stone tile | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stone-tiles | stone tiles | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall | stone wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| stone-wall-window | stone wall window | sem categoria de caça (primarytype "windows") | `data/items/items.xml` |
| stone-wall-window | stone wall window | sem categoria de caça (primarytype "windows") | `data/items/items.xml` |
| stone-wall-window | stone wall window | sem categoria de caça (primarytype "windows") | `data/items/items.xml` |
| stone-wall-window | stone wall window | sem categoria de caça (primarytype "windows") | `data/items/items.xml` |
| stonerefiner-soul-core | stonerefiner soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| stony-floor | stony floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stony-floor | stony floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| stool | stool | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| stool | stool | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| stool | stool | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| stool | stool | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| storage-box | storage box | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| storage-chest | storage chest | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| strange-blue-powder | strange blue powder | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| strange-blue-powder | strange blue powder | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| strange-bonepile | strange bonepile | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| strange-device | strange device | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| strange-empty-bucket | strange empty bucket | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| strange-fire | strange fire | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| strange-fire | strange fire | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| strange-fire | strange fire | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| strange-green-powder | strange green powder | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| strange-holes | strange holes | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| strange-idol | strange idol | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| strange-idol | strange idol | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| strange-idol | strange idol | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| strange-machine | strange machine | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| strange-machine | strange machine | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| strange-orange-powder | strange orange powder | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| strange-powder | strange powder | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| strange-powder | strange powder | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| strange-probing-device | strange probing device | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| strange-red-powder | strange red powder | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| strange-red-powder | strange red powder | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| strange-statue | strange statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| strange-statue | strange statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| strange-statue | strange statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| strange-statue | strange statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| strange-statue | strange statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| strange-statue | strange statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| strange-stone | strange stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| strange-stone | strange stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| strange-stone | strange stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| strange-stone | strange stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| strange-violet-powder | strange violet powder | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| strange-vortex | strange vortex | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| strange-vortex | strange vortex | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| strange-whirl | strange whirl | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| strange-yellow-powder | strange yellow powder | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| strange-yellow-powder | strange yellow powder | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| strangely-coloured-glooth | strangely coloured glooth | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| strangely-ornamented-key | strangely ornamented key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| strangely-shaped-block | strangely shaped block | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| strangely-shaped-menhir | strangely shaped menhir | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| straw-mat | straw mat | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| straw-mat | straw mat | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| straw-mat | straw mat | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| straw-mat | straw mat | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| straw-mat | straw mat | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| straw-mat | straw mat | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| straw-mat | straw mat | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| straw-mat | straw mat | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| straw-mat | straw mat | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| straw-mat | straw mat | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| straw-mat | straw mat | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| straw-mat | straw mat | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| straw-mat-head-section | straw mat head section | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| straw-mat-head-section | straw mat head section | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| straw-mat-head-section | straw mat head section | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| straw-mat-head-section | straw mat head section | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| strawberry | strawberry | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| strawberry-cupcake | strawberry cupcake | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| streaked-devourer-soul-core | streaked devourer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| strike-enhancement | strike enhancement | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| striped-carpet | striped carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| striped-shark-trophy | striped shark trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| strong-cloth | strong cloth | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| strong-health-cask | strong health cask | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| strong-health-keg | strong health keg | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| strong-health-potion | strong health potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| strong-mana-cask | strong mana cask | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| strong-mana-keg | strong mana keg | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| strong-mana-potion | strong mana potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| strong-sinew | strong sinew | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| strong-water-vortex | strong water vortex | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| stuffed-bear-display | stuffed bear display | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| stuffed-bear-display | stuffed bear display | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| stuffed-bunny | stuffed bunny | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| stuffed-dragon | stuffed dragon | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| stuffed-dragon | stuffed dragon | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| stuffed-teddy-display | stuffed teddy display | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| stuffed-teddy-display | stuffed teddy display | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| stuffed-toad | stuffed toad | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| stump-table | stump table | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| stunned-bunny | stunned bunny | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| sturdy-book | sturdy book | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| sturdy-chest | sturdy chest | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| sturdy-chest | sturdy chest | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| sublime-tournament-carpet | sublime tournament carpet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| sudden-death-rune | sudden death rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| sugar | sugar | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| sugar-cane | sugar cane | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| sugar-cane | sugar cane | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| sugar-cane | sugar cane | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| sugar-cane | sugar cane | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| sugar-cube-soul-core | sugar cube soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sugar-cube-worker-soul-core | sugar cube worker soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sugar-oat | sugar oat | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| sulphider-soul-core | sulphider soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sulphur | sulphur | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| sulphur-puddle | sulphur puddle | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| sulphur-spouter-soul-core | sulphur spouter soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sulphurous-demonbone | sulphurous demonbone | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| sun-adorer-cactus | sun adorer cactus | sem categoria de caça (primarytype "cactuses") | `data/items/items.xml` |
| sun-catcher | sun catcher | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| sun-fruit | sun fruit | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| sun-mirror | sun mirror | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| sundial | sundial | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| sundial | sundial | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| sunflower | sunflower | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| supernatural-box | supernatural box | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| supply-crate | supply crate | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| supply-crate | supply crate | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| supply-crate | supply crate | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| supreme-health-cask | supreme health cask | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| supreme-health-keg | supreme health keg | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| supreme-health-potion | supreme health potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| supreme-mana-cask | supreme mana cask | sem categoria de caça (primarytype "nenhum") | `data/items/items.xml` |
| supreme-mana-keg | supreme mana keg | sem categoria de caça (primarytype "nenhum") | `data/items/items.xml` |
| surprise-nest | surprise nest | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| surprise-nest | surprise nest | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| suspicious-documents | suspicious documents | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| suspicious-surprise-bag | suspicious surprise bag | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| svargrond-salmon-filet | svargrond salmon filet | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| swamp | swamp | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| swamp | swamp | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| swamp | swamp | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| swamp-lichen | swamp lichen | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| swamp-lichen | swamp lichen | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| swamp-lilly | swamp lilly | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| swamp-reed | swamp reed | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| swamp-tentacles | swamp tentacles | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| swamp-troll-soul-core | swamp troll soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| swampling-soul-core | swampling soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| swan | swan | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| swan-feather | swan feather | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| swan-feather | swan feather | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| swan-feathers | swan feathers | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| swan-maiden-soul-core | swan maiden soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| swarmer-drum | swarmer drum | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| swarmer-drum | swarmer drum | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| swarmer-soul-core | swarmer soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| sweet-mangonaise-elixir | sweet mangonaise elixir | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| sweet-smelling-bait | sweet smelling bait | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| sword-hilt | sword hilt | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| sword-ring | sword ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| sword-tapestry | sword tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| sycamore | sycamore | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| table | table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| table | table | sem categoria de caça (primarytype "tables") | `data/items/items.xml` |
| table-lamp | table lamp | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| table-lamp-kit | table lamp kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| taboret | taboret | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| tactical-map | tactical map | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| tagralt-nugget | tagralt nugget | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| tainted-blood-essence | tainted blood essence | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| tainted-glooth-capsule | tainted glooth capsule | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| tainted-soul-soul-core | tainted soul soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| taiyaki-ice-cream | taiyaki ice cream | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| tall-dusky-cypress | tall dusky cypress | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| tall-dusky-cypress | tall dusky cypress | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| tall-dusky-cypress | tall dusky cypress | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| tall-dusky-cypress | tall dusky cypress | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| tall-gloomy-cypress | tall gloomy cypress | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| tall-gloomy-cypress | tall gloomy cypress | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| tall-gloomy-cypress | tall gloomy cypress | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| talon | talon | sem categoria de caça (primarytype "magical items") | `data/items/items.xml` |
| tap | tap | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| tar | tar | sem categoria de caça (primarytype "natural tiles") | `data/items/items.xml` |
| tarantula-soul-core | tarantula soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| tarantula-trap | tarantula trap | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| target-dummy | target dummy | sem categoria de caça (primarytype "machines") | `data/items/items.xml` |
| tarnished-spirit-soul-core | tarnished spirit soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| tarsal-arrow | tarsal arrow | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| tattered-swan-feather | tattered swan feather | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| tea-cup | tea cup | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| tea-spoon | tea spoon | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| teal-25-years-balloon | teal 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| teal-25-years-balloon | teal 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| teal-25-years-balloon | teal 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| teal-balloon | teal balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| teal-balloon | teal balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| teal-balloon | teal balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| tearesa | Tearesa | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| tearesa | Tearesa | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| teddy-bear | teddy bear | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| teleport-crystal | teleport crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| teleportation-rod | teleportation rod | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| telescope | telescope | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| telescope | telescope | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| telescope | telescope | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| telescope | telescope | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| telescope | telescope | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| telescope | telescope | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| telescope-kit | telescope kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| temple-teleport-scroll | temple teleport scroll | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| temporary-gold-converter | temporary gold converter | sem categoria de caça (primarytype "nenhum") | `data/items/items.xml` |
| ten-cans | ten cans | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| tendrils | tendrils | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| tentacle-lamp | tentacle lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| tentacle-lamp | tentacle lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| tentacle-lamp | tentacle lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| tentacle-lamp | tentacle lamp | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| terramite-eggs | terramite eggs | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| terrarium | terrarium | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| terrarium | terrarium | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| test-tube-holder | test-tube holder | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| test-voodoo-doll | test voodoo doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| thawing-ice-pick | thawing ice pick | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| the-ban-hammer | the ban hammer | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| the-cobra-amulet-carpet | the cobra amulet carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| the-gods-twilight-doll | the gods' twilight doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| the-gods-twilight-doll | the gods' twilight doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| the-gods-twilight-doll | the gods' twilight doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| the-gods-twilight-doll | the gods' twilight doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| the-living-idol-of-tukh | the living idol of tukh | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| the-spatial-almanach-carpet | the spatial almanach carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| the-spatial-warp-almanac | the spatial warp almanac | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| the-supreme-cube | the supreme cube | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| the-supreme-cube-carpet | the supreme cube carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| the-sylvan-sapling-carpet | the sylvan sapling carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| the-time-compass | the time compass | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| theatre-script | theatre script | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| theodore-loveless-key | Theodore Loveless' key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| thermometer | thermometer | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| thick-trunk | thick trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| thornpeak-grass | thornpeak grass | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| thread-tree | thread tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| thread-tree | thread tree | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| three-cans | three cans | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| throatslitter | throatslitter | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| throwing-cake | throwing cake | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| throwing-star-of-sula | throwing star of Sula | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| thunderstorm-rune | thunderstorm rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| tibiacity-encyclopedia | Tibiacity Encyclopedia | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| tibiacity-encyclopedia | Tibiacity Encyclopedia | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| tibianus-balloon | Tibianus balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| tibianus-balloon | Tibianus balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| tibianus-balloon | Tibianus balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| tibiapedia | Tibiapedia | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| tibiapedia | Tibiapedia | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| tibiapedia | Tibiapedia | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| tibiapedia | Tibiapedia | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| timber-archway | timber archway | sem categoria de caça (primarytype "portals") | `data/items/items.xml` |
| timber-archway | timber archway | sem categoria de caça (primarytype "portals") | `data/items/items.xml` |
| timber-chair | timber chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| timber-chair | timber chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| timber-chair | timber chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| timber-chair | timber chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| timber-floor | timber floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| timber-wall | timber wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| timber-wall | timber wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| timber-wall | timber wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| timber-wall | timber wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| timber-wall | timber wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| timber-wall | timber wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| timber-wall | timber wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| timber-wall | timber wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| time-ring | time ring | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| tin-key | tin key | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| tinder-box | tinder box | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| tinged-pot | tinged pot | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| tiny-bass | tiny bass | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| tiny-healing-rune | tiny healing rune | sem categoria de caça (primarytype "healing runes") | `data/items/items.xml` |
| tiny-vortex | tiny vortex | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| tomato | tomato | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| tomb-wall | tomb wall | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| tomb-wall | tomb wall | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| tonguefruit | tonguefruit | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| toolbox | toolbox | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| toolbox | toolbox | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| toolbox | toolbox | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| toolbox | toolbox | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| toolbox | toolbox | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| torch | torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| torch | torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| torch | torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| torch | torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| torch | torch | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| torch-bearer | torch bearer | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| torch-bearer | torch bearer | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| torch-bearer | torch bearer | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| torch-bearer | torch bearer | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| torch-bearer | torch bearer | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| torn-book | torn book | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| torn-book | torn book | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| torn-book | torn book | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| torn-incantation-fragment | torn incantation fragment | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| torn-log-book | torn log book | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| torn-magic-cape | torn magic cape | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| torn-teddy | torn teddy | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| tortoise-egg | tortoise egg | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| totem-pole | totem pole | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| tournament-carpet | tournament carpet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| tower-fern | tower fern | sem categoria de caça (primarytype "ferns") | `data/items/items.xml` |
| toxic-tulip-seed | toxic tulip seed | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| toy-mouse | toy mouse | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| toy-spider | toy spider | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| toy-spider | toy spider | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| traditional-sai | traditional sai | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| trained-fire-bug | trained fire bug | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| training-axe | training axe | sem categoria de caça (primarytype "training weapons") | `data/items/items.xml` |
| training-bow | training bow | sem categoria de caça (primarytype "training weapons") | `data/items/items.xml` |
| training-club | training club | sem categoria de caça (primarytype "training weapons") | `data/items/items.xml` |
| training-rod | training rod | sem categoria de caça (primarytype "training weapons") | `data/items/items.xml` |
| training-shield | training shield | sem categoria de caça (primarytype "training weapons") | `data/items/items.xml` |
| training-sword | training sword | sem categoria de caça (primarytype "training weapons") | `data/items/items.xml` |
| training-wand | training wand | sem categoria de caça (primarytype "training weapons") | `data/items/items.xml` |
| training-wraps | training wraps | sem categoria de caça (primarytype "training weapons") | `data/items/items.xml` |
| transcendence-potion | transcendence potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| transcendence-potion | transcendence potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| transcendent-bo | transcendent bo | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| transcendent-footwraps | transcendent footwraps | sem categoria de caça (primarytype "nenhum") | `data/items/items.xml` |
| transcendent-headband | transcendent headband | sem categoria de caça (primarytype "nenhum") | `data/items/items.xml` |
| transcendent-robe | transcendent robe | sem categoria de caça (primarytype "nenhum") | `data/items/items.xml` |
| transcendent-trousers | transcendent trousers | sem categoria de caça (primarytype "nenhum") | `data/items/items.xml` |
| translation-scroll | translation scroll | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| translation-scroll | translation scroll | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| trap | trap | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| trap | trap | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| trap | trap | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapdoor | trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| trapped-hyaena | trapped hyaena | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| trapped-lightning | trapped lightning | sem categoria de caça (primarytype "light sources") | `data/items/items.xml` |
| trashed-draken-boots | trashed draken boots | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| treasure-chest | treasure chest | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| treasure-chest | treasure chest | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| treasure-chest | treasure chest | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| treasure-chest | treasure chest | sem categoria de caça (primarytype "constructions") | `data/items/items.xml` |
| treasure-map | treasure map | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| treasure-map | treasure map | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| treasure-map | treasure map | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| treasure-map | treasure map | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| tree-coral | tree coral | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| tree-coral | tree coral | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| tree-stump | tree stump | sem categoria de caça (primarytype "remains") | `data/items/items.xml` |
| tribal-crest | tribal crest | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| troll-green | troll green | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| troll-mushroom | troll mushroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| troll-skull | troll skull | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| trophy-stand | trophy stand | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| tropical-fried-terrorbird | tropical fried terrorbird | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| tropical-marinated-tiger | tropical marinated tiger | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| trough | trough | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| trough-kit | trough kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| truelove-teddy | truelove teddy | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| trunk-chair-kit | trunk chair kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| trunk-kit | trunk kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| trunk-table-kit | trunk table kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| trunkhammer | trunkhammer | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| tulip | tulip | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| tuning-fork | tuning fork | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| turquoise-fireworks-powder | turquoise fireworks powder | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| turquoise-fireworks-rocket | turquoise fireworks rocket | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| turquoise-marble | turquoise marble | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| turquoise-tendril-lantern | turquoise tendril lantern | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| turtle | turtle | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| turtle | turtle | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| turtle-sprouter | turtle sprouter | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| tusk-chair | tusk chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| tusk-chair | tusk chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| tusk-chair | tusk chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| tusk-chair | tusk chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| tusk-chair-kit | tusk chair kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| tusk-table | tusk table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| tusk-table | tusk table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| tusk-table-kit | tusk table kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| twigs | twigs | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| twin-sun-charm | twin sun charm | sem categoria de caça (primarytype "blessing charms") | `data/items/items.xml` |
| two-cans | two cans | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| ultimate-healing-rune | ultimate healing rune | sem categoria de caça (primarytype "nenhum") | `data/items/items.xml` |
| ultimate-health-cask | ultimate health cask | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| ultimate-health-keg | ultimate health keg | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| ultimate-health-potion | ultimate health potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| ultimate-mana-cask | ultimate mana cask | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| ultimate-mana-keg | ultimate mana keg | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| ultimate-mana-potion | ultimate mana potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| ultimate-spirit-cask | ultimate spirit cask | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| ultimate-spirit-keg | ultimate spirit keg | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| ultimate-spirit-potion | ultimate spirit potion | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| umbral-katar | umbral katar | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| umbral-master-bow-test | umbral master bow TEST | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| umbral-master-katar | umbral master katar | família "fist" não é declarável (fallback do motor, DT-01) | `data/items/items.xml` |
| unholy-book | unholy book | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| unicorn-weisswurst | unicorn weisswurst | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| unity-charm | unity charm | sem categoria de caça (primarytype "blessing charms") | `data/items/items.xml` |
| universal-tool | universal tool | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| unlit-campfire | unlit campfire | sem categoria de caça (primarytype "illumination") | `data/items/items.xml` |
| unliving-demonbone | unliving demonbone | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| unremarkable-hammer | unremarkable hammer | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| unworked-sacred-wood | unworked sacred wood | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| used-candelabrum | used candelabrum | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| used-candlestick | used candlestick | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| used-globe-kit | used globe kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| used-red-chair-kit | used red chair kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| used-rocking-horse-kit | used rocking horse kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| used-telescope-kit | used telescope kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| v-belt | v-belt | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| valuable-carving-axe | valuable carving axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-carving-blade | valuable carving blade | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-carving-bow | valuable carving bow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| valuable-carving-chopper | valuable carving chopper | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-carving-crossbow | valuable carving crossbow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| valuable-carving-hammer | valuable carving hammer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-carving-mace | valuable carving mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-carving-rod | valuable carving rod | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-carving-slayer | valuable carving slayer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-carving-wand | valuable carving wand | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-mayhem-axe | valuable mayhem axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-mayhem-blade | valuable mayhem blade | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-mayhem-bow | valuable mayhem bow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| valuable-mayhem-chopper | valuable mayhem chopper | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-mayhem-crossbow | valuable mayhem crossbow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| valuable-mayhem-hammer | valuable mayhem hammer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-mayhem-mace | valuable mayhem mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-mayhem-rod | valuable mayhem rod | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-mayhem-slayer | valuable mayhem slayer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-mayhem-wand | valuable mayhem wand | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-remedy-axe | valuable remedy axe | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-remedy-blade | valuable remedy blade | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-remedy-bow | valuable remedy bow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| valuable-remedy-chopper | valuable remedy chopper | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-remedy-crossbow | valuable remedy crossbow | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| valuable-remedy-hammer | valuable remedy hammer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-remedy-mace | valuable remedy mace | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-remedy-rod | valuable remedy rod | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-remedy-slayer | valuable remedy slayer | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-remedy-wand | valuable remedy wand | wand/rod sem mana ou faixa de dano completa (script;weapon incompleto) | `data/items/items.xml` |
| valuable-vase | valuable vase | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| vampire-doll | vampire doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| vampire-lord | vampire lord | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| vampire-lord-statue | vampire lord statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| vampiric-crest | vampiric crest | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| varg-soul-core | varg soul core | sem categoria de caça (primarytype "soul cores") | `data/items/items.xml` |
| vase | vase | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| veal | veal | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| vegetable-basket | vegetable basket | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| vegetable-basket | vegetable basket | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| veggie-casserole | veggie casserole | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| veldt-flowers | veldt flowers | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| veldt-flowers | veldt flowers | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| velvet-tapestry | velvet tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| vengothic-cabinet | vengothic cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| vengothic-cabinet | vengothic cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| vengothic-chair | vengothic chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| vengothic-chair | vengothic chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| vengothic-chair | vengothic chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| vengothic-chair | vengothic chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| vengothic-chest | vengothic chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| vengothic-chest | vengothic chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| vengothic-chest | vengothic chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| vengothic-chest | vengothic chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| vengothic-table | vengothic table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| vengothic-table | vengothic table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| venorean-cabinet-kit | venorean cabinet kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| venorean-chair | venorean chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| venorean-chair | venorean chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| venorean-chair | venorean chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| venorean-chair | venorean chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| venorean-drawer-kit | venorean drawer kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| venorean-spice | venorean spice | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| venorean-stool | venorean stool | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| venorean-stool | venorean stool | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| venorean-stool | venorean stool | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| venorean-stool | venorean stool | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| venorean-table-clock | venorean table clock | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| venorean-table-clock | venorean table clock | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| venorean-wardrobe-kit | venorean wardrobe kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| ventilation-grille | ventilation grille | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| ventilation-grille | ventilation grille | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| ventilation-grille | ventilation grille | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| verdant-cabinet | verdant cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| verdant-cabinet | verdant cabinet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| verdant-carpet | verdant carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| verdant-chair | verdant chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| verdant-chair | verdant chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| verdant-chair | verdant chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| verdant-chair | verdant chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| verdant-table | verdant table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| verdant-trunk | verdant trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| verdant-trunk | verdant trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| verdant-trunk | verdant trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| verdant-trunk | verdant trunk | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| verocious-bat | verocious bat | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| versicoloured-marble | versicoloured marble | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| very-noble-looking-watch | very noble-looking watch | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| very-noble-looking-watch | very noble-looking watch | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| vexclaw-doll | Vexclaw Doll | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| vial | vial | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| vibrant-egg | vibrant egg | sem categoria de caça (primarytype "taming items") | `data/items/items.xml` |
| violet-crystal | violet crystal | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| violet-lever | violet lever | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| violet-memory-shard | violet memory shard | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| violet-round-cushion | violet round cushion | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| violet-square-cushion | violet square cushion | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| viper-star | viper star | arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável) | `data/items/items.xml` |
| void-boots | void boots | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| void-carpet | void carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| volcanic-chair | volcanic chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-chair | volcanic chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-chair | volcanic chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-chair | volcanic chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-chest | volcanic chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-chest | volcanic chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-chest | volcanic chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-chest | volcanic chest | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-mirror | volcanic mirror | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-mirror | volcanic mirror | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-mirror | volcanic mirror | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-mirror | volcanic mirror | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-shelf | volcanic shelf | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-shelf | volcanic shelf | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-shelf | volcanic shelf | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-shelf | volcanic shelf | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-shelf | volcanic shelf | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| volcanic-shelf | volcanic shelf | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| voodoo-doll | voodoo doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| voodoo-doll | voodoo doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| voodoo-doll | voodoo doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| voodoo-doll | voodoo doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| voodoo-doll | voodoo doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| voodoo-lily | voodoo lily | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| voodoo-lily-pollen | voodoo lily pollen | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| vortex | vortex | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| vortex-bolt | vortex bolt | sem categoria de caça (primarytype "ammunition") | `data/items/items.xml` |
| wad-of-fairy-floss | wad of fairy floss | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| wafer-paper-flower | wafer paper flower | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| wall-fern | wall fern | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| wall-flowers | wall flowers | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| wall-leaves | wall leaves | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| wall-mirror | wall mirror | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| wall-mirror | wall mirror | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| wall-mirror | wall mirror | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| wall-mirror | wall mirror | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| wall-mirror | wall mirror | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| wall-mirror | wall mirror | sem categoria de caça (primarytype "wall hangings") | `data/items/items.xml` |
| walnut | walnut | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| war-backpack | war backpack | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| war-drum | war drum | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| war-horn | war horn | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| war-wolf-skin | war wolf skin | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| wardrobe | wardrobe | sem categoria de caça (primarytype "closets") | `data/items/items.xml` |
| wardrobe | wardrobe | sem categoria de caça (primarytype "closets") | `data/items/items.xml` |
| wardrobe | wardrobe | sem categoria de caça (primarytype "closets") | `data/items/items.xml` |
| wardrobe | wardrobe | sem categoria de caça (primarytype "closets") | `data/items/items.xml` |
| wasted-time | wasted time | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| watch | watch | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| watchdog-statue | watchdog statue | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
| water-cask | water cask | sem categoria de caça (primarytype "casks") | `data/items/items.xml` |
| water-nymph | water nymph | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| water-nymph | water nymph | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| water-nymph | water nymph | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| water-nymph | water nymph | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| water-nymph | water nymph | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| water-nymph | water nymph | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| water-pipe | water pipe | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| water-pipe | water pipe | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| water-trapdoor | water trapdoor | sem categoria de caça (primarytype "dropdowns") | `data/items/items.xml` |
| water-vortex | water vortex | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| water-vortex | water vortex | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| water-vortex | water vortex | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| water-vortex | water vortex | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| water-vortex | water vortex | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| water-vortex | water vortex | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| water-vortex | water vortex | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| water-vortex | water vortex | sem categoria de caça (primarytype "teleporters") | `data/items/items.xml` |
| water-wheel | water wheel | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| waterball | waterball | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| waterball | waterball | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| waterfall | waterfall | sem categoria de caça (primarytype "fields") | `data/items/items.xml` |
| watering-can | watering can | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| waterskin | waterskin | sem categoria de caça (primarytype "fluid containers") | `data/items/items.xml` |
| wealth-duplex | wealth duplex | sem categoria de caça (primarytype "liquids") | `data/items/items.xml` |
| weapon-rack | weapon rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| weapon-rack | weapon rack | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| weapon-rack-kit | weapon rack kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| weapons-crate | weapons crate | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| weapons-crate | weapons crate | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| weeping-stone | weeping stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| weeping-stone | weeping stone | sem categoria de caça (primarytype "rocks") | `data/items/items.xml` |
| well-laid-knightly-table | well-laid knightly table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| well-laid-knightly-table | well-laid knightly table | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| werebadger-trophy | werebadger trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| werebear-trophy | werebear trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| wereboar-trophy | wereboar trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| werecrocodile-trophy | werecrocodile trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| werefox-trophy | werefox trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| werehyaena-trophy | werehyaena trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| werepanther-trophy | werepanther trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| weretiger-trophy | weretiger trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| wheat | wheat | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| wheat | wheat | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| wheat | wheat | sem categoria de caça (primarytype "grass") | `data/items/items.xml` |
| wheat-carpet | wheat carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| wheel-oil | wheel oil | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| whetstone | whetstone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| whinona | Whinona | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| whinona | Whinona | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| whisper-moss | whisper moss | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| white-coral | white coral | sem categoria de caça (primarytype "animals") | `data/items/items.xml` |
| white-flag | white flag | sem categoria de caça (primarytype "flags") | `data/items/items.xml` |
| white-flower | white flower | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| white-flower | white flower | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| white-fur-carpet | white fur carpet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| white-lion-doll | white lion doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| white-lion-doll | white lion doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| white-marble-floor | white marble floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| white-marble-floor | white marble floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| white-marble-floor | white marble floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| white-marble-floor | white marble floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| white-marble-floor | white marble floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| white-marble-floor | white marble floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| white-mushroom | white mushroom | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| white-raven | white raven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| white-raven | white raven | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| white-raven-kit | white raven kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| white-shark-trophy | white shark trophy | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| white-silk-flower | white silk flower | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| white-stone-pillar | white stone pillar | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| white-stone-tile | white stone tile | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| white-tapestry | white tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| white-token | white token | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| whoopee-cushion | whoopee cushion | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| wicked-witch | wicked witch | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| wicked-witch | wicked witch | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| wicker-basket | wicker basket | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| wild-desert-rose | wild desert rose | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| wild-desert-roses | wild desert roses | sem categoria de caça (primarytype "plants") | `data/items/items.xml` |
| wild-growth-rune | wild growth rune | sem categoria de caça (primarytype "attack runes") | `data/items/items.xml` |
| wild-roses | wild roses | sem categoria de caça (primarytype "flowers") | `data/items/items.xml` |
| willow | willow | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| window | window | sem categoria de caça (primarytype "windows") | `data/items/items.xml` |
| window | window | sem categoria de caça (primarytype "windows") | `data/items/items.xml` |
| window | window | sem categoria de caça (primarytype "windows") | `data/items/items.xml` |
| window | window | sem categoria de caça (primarytype "windows") | `data/items/items.xml` |
| window | window | sem categoria de caça (primarytype "windows") | `data/items/items.xml` |
| window | window | sem categoria de caça (primarytype "windows") | `data/items/items.xml` |
| window | window | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| window | window | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| wine-cask | wine cask | sem categoria de caça (primarytype "casks") | `data/items/items.xml` |
| winged-backpack | winged backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| winning-lottery-ticket | winning lottery ticket | sem categoria de caça (primarytype "documents and papers") | `data/items/items.xml` |
| winterberry-liquor | winterberry liquor | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| witches-cap-spot | witches' cap spot | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| witches-cap-spot | witches' cap spot | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| witchesbroom | witchesbroom | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| witherblossom | witherblossom | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| withered-plant | withered plant | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| withered-plant | withered plant | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| withered-plant | withered plant | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| withered-plant | withered plant | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| withered-plant | withered plant | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| withered-plant | withered plant | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| withered-plant | withered plant | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| wolf-backpack | wolf backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| wolf-tooth-chain | wolf tooth chain | id duplicado (outro item já gerou este slug) | `data/items/items.xml` |
| wolf-trophy | wolf trophy | sem categoria de caça (primarytype "trophies") | `data/items/items.xml` |
| wonder-glue | wonder glue | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| wood-mushroom | wood mushroom | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| wooden-bookcase | wooden bookcase | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| wooden-bookcase | wooden bookcase | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| wooden-cabinet | wooden cabinet | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| wooden-cabinet | wooden cabinet | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| wooden-cage-key | wooden cage key | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| wooden-chair | wooden chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| wooden-chair | wooden chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| wooden-chair | wooden chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| wooden-chair | wooden chair | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| wooden-chair-kit | wooden chair kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| wooden-coffin | wooden coffin | sem categoria de caça (primarytype "coffins") | `data/items/items.xml` |
| wooden-coffin | wooden coffin | sem categoria de caça (primarytype "coffins") | `data/items/items.xml` |
| wooden-coffin | wooden coffin | sem categoria de caça (primarytype "coffins") | `data/items/items.xml` |
| wooden-coffin | wooden coffin | sem categoria de caça (primarytype "coffins") | `data/items/items.xml` |
| wooden-coffin | wooden coffin | sem categoria de caça (primarytype "coffins") | `data/items/items.xml` |
| wooden-coffin | wooden coffin | sem categoria de caça (primarytype "coffins") | `data/items/items.xml` |
| wooden-column | wooden column | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| wooden-doll | wooden doll | sem categoria de caça (primarytype "dolls and bears") | `data/items/items.xml` |
| wooden-floor | wooden floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| wooden-floor | wooden floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| wooden-floor | wooden floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| wooden-floor | wooden floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| wooden-floor | wooden floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| wooden-floor | wooden floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| wooden-floor | wooden floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| wooden-floor | wooden floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| wooden-floor | wooden floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| wooden-floor | wooden floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| wooden-floor | wooden floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| wooden-floor | wooden floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| wooden-floor | wooden floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| wooden-floor | wooden floor | sem categoria de caça (primarytype "artificial tiles") | `data/items/items.xml` |
| wooden-flute | wooden flute | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| wooden-flute | wooden flute | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| wooden-grinder | wooden grinder | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| wooden-hammer | wooden hammer | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| wooden-key | wooden key | sem categoria de caça (primarytype "keys") | `data/items/items.xml` |
| wooden-plank | wooden plank | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| wooden-plank | wooden plank | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| wooden-plank | wooden plank | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| wooden-planks | wooden planks | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| wooden-planks | wooden planks | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| wooden-planks | wooden planks | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| wooden-planks | wooden planks | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| wooden-planks | wooden planks | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| wooden-planks | wooden planks | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| wooden-planks | wooden planks | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| wooden-planks | wooden planks | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| wooden-pole | wooden pole | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| wooden-railing | wooden railing | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| wooden-sandals | wooden sandals | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| wooden-sandals | wooden sandals | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| wooden-scaffolding | wooden scaffolding | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| wooden-scaffolding | wooden scaffolding | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| wooden-scaffolding | wooden scaffolding | sem categoria de caça (primarytype "pillars") | `data/items/items.xml` |
| wooden-spoon | wooden spoon | sem categoria de caça (primarytype "kitchen tools") | `data/items/items.xml` |
| wooden-stake | wooden stake | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| wooden-ties | wooden ties | sem categoria de caça (primarytype "tools") | `data/items/items.xml` |
| wooden-trash | wooden trash | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| wooden-trash | wooden trash | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| wooden-trash | wooden trash | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| wooden-treadmill | wooden treadmill | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| wooden-treadmill | wooden treadmill | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| wooden-treadmill | wooden treadmill | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| wooden-treadmill | wooden treadmill | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| wooden-wall | wooden wall | sem categoria de caça (primarytype "walls") | `data/items/items.xml` |
| wooden-whistle | wooden whistle | sem categoria de caça (primarytype "musical instruments") | `data/items/items.xml` |
| worm-punisher | worm punisher | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| worm-queen-tooth | worm queen tooth | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| worn-dress | worn dress | sem categoria de caça (primarytype "tools (objects)") | `data/items/items.xml` |
| worn-firewalker-boots | worn firewalker boots | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| worn-leather-boots | worn leather boots | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| worn-soft-boots | worn soft boots | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| wrecked-opticorder-forge | wrecked opticorder forge | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| wrecked-ship-cabin-wall | wrecked ship cabin wall | sem categoria de caça (primarytype "refuse") | `data/items/items.xml` |
| wrinkled-parchment | wrinkled parchment | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| yalahari-figurine | yalahari figurine | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| yalahari-folio | yalahari folio | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| yalahari-gear-wheel | yalahari gear wheel | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| yalahari-inkwell | yalahari inkwell | sem categoria de caça (primarytype "quest objects") | `data/items/items.xml` |
| yalaharian-carpet | Yalaharian carpet | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| yarn | yarn | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| yellow-25-years-balloon | yellow 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| yellow-25-years-balloon | yellow 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| yellow-25-years-balloon | yellow 25 years balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| yellow-backpack | yellow backpack | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| yellow-bag | yellow bag | sem categoria de caça (primarytype "containers") | `data/items/items.xml` |
| yellow-balloon | yellow balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| yellow-balloon | yellow balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| yellow-balloon | yellow balloon | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| yellow-bed-kit | yellow bed kit | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| yellow-cake-carpet | yellow cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| yellow-cake-carpet | yellow cake carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| yellow-energy-ball | yellow energy ball | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| yellow-fireworks-powder | yellow fireworks powder | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| yellow-fireworks-rocket | yellow fireworks rocket | sem categoria de caça (primarytype "party items") | `data/items/items.xml` |
| yellow-footboard | yellow footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| yellow-footboard | yellow footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| yellow-footboard | yellow footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| yellow-footboard | yellow footboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| yellow-glowing-mushroom | yellow glowing mushroom | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| yellow-headboard | yellow headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| yellow-headboard | yellow headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| yellow-headboard | yellow headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| yellow-headboard | yellow headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| yellow-headboard | yellow headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| yellow-headboard | yellow headboard | sem categoria de caça (primarytype "furniture") | `data/items/items.xml` |
| yellow-lever | yellow lever | sem categoria de caça (primarytype "machines (objects)") | `data/items/items.xml` |
| yellow-maple | yellow maple | sem categoria de caça (primarytype "trees") | `data/items/items.xml` |
| yellow-pillow | yellow pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| yellow-pillow | yellow pillow | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| yellow-powder | yellow powder | sem categoria de caça (primarytype "rubbish") | `data/items/items.xml` |
| yellow-present-kit | yellow present kit | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| yellow-rose | yellow rose | sem categoria de caça (primarytype "plants and herbs") | `data/items/items.xml` |
| yellow-roses | yellow roses | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| yellow-spores | yellow spores | sem categoria de caça (primarytype "natural products") | `data/items/items.xml` |
| yellow-tapestry | yellow tapestry | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| yellow-tibia-carpet | yellow Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| yellow-tibia-carpet | yellow Tibia carpet | sem categoria de caça (primarytype "floor decorations") | `data/items/items.xml` |
| yellowed-bone | yellowed bone | sem categoria de caça (primarytype "quest items") | `data/items/items.xml` |
| yeti-doll | yeti doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| yeti-doll | yeti doll | sem categoria de caça (primarytype "fansite items") | `data/items/items.xml` |
| young-fraelofingu | young fraelofingu | sem categoria de caça (primarytype "mushrooms") | `data/items/items.xml` |
| your-inbox | your inbox | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| your-store-inbox | your store inbox | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| your-student-book | your student book | sem categoria de caça (primarytype "books") | `data/items/items.xml` |
| your-supply-stash | your supply stash | sem categoria de caça (primarytype "utilities") | `data/items/items.xml` |
| yummy-gummy-worm | yummy gummy worm | sem categoria de caça (primarytype "food") | `data/items/items.xml` |
| zaoan-bonsai | Zaoan bonsai | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-cabinet | Zaoan cabinet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-cabinet | Zaoan cabinet | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-chess-box | Zaoan chess box | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| zaoan-chess-box | Zaoan chess box | sem categoria de caça (primarytype "game tokens") | `data/items/items.xml` |
| zaoan-divider | Zaoan divider | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-divider | Zaoan divider | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-drawing | Zaoan drawing | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-hassock | Zaoan hassock | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-hassock | Zaoan hassock | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-hassock | Zaoan hassock | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-hassock | Zaoan hassock | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-panel | Zaoan panel | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-panel-base | Zaoan panel base | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-paravent | Zaoan paravent | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-paravent | Zaoan paravent | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-pot-bamboo | Zaoan pot bamboo | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zaoan-side-table | Zaoan side table | sem categoria de caça (primarytype "decoration") | `data/items/items.xml` |
| zombie-dummy | zombie dummy | sem categoria de caça (primarytype "statues") | `data/items/items.xml` |
