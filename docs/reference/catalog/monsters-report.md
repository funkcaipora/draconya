# Relatório de importação — monsters

Fonte: `canary` em `47dfd51f45280a59a1d3e50ba7edd573d7234446`.

204 entidade(s) geradas em 19 fatia(s):

- `amphibics.json`: 6
- `aquatics.json`: 12
- `birds.json`: 10
- `bosses.json`: 6
- `constructs.json`: 4
- `dawnport.json`: 6
- `event_creatures.json`: 5
- `giants.json`: 1
- `humanoids.json`: 21
- `humans.json`: 7
- `mammals.json`: 44
- `nostalgia.json`: 5
- `plants.json`: 1
- `quests.json`: 51
- `raids.json`: 7
- `reptiles.json`: 4
- `slimes.json`: 1
- `undeads.json`: 2
- `vermins.json`: 11

## Notas

- Velocidade (ADR 0037 d.4): 0 gerado(s) com o speed do TFS, 204 com Canary × 2 — o checkout do TFS não estava nesta máquina, então todo monstro caiu no × 2.
- Moeda: 387 arquivo(s) lido(s) têm mais de uma linha de moeda; o Draconya tem um `loot.gold` por tabela e fica a de gold coin (senão a primeira). Entre os gerados: 8 — `crustacea-gigantica` (descartado: gold coin 1–75 @ 0.56), `quara-predator-scout` (descartado: gold coin 1–72 @ 0.48), `shark` (descartado: gold coin 1–38 @ 0.41), `eternal-guardian` (descartado: platinum coin 1–4 @ 0.9954), `roaring-lion` (descartado: platinum coin 1–1 @ 0.1), `the-bloodtusk` (descartado: platinum coin 1–5 @ 1), `zomba` (descartado: platinum coin 1–1 @ 0.25), `spidris-elite` (descartado: gold coin 1–100 @ 0.5; platinum coin 1–6 @ 0.45).
- Fraqueza abaixo de −100 % recortada em −100 % (TODO #683): `poor-soul` (drown -300%).
- Elemento ≥ 100 % virou imunidade em 48 monstro(s) gerado(s).
- Campos lidos e ignorados nesta issue (arquivos gerados): corpse (sem campo no schema) (204), flags.canPushCreatures (sem campo no schema) (204), flags.canPushItems (sem campo no schema) (204), flags.pushable (sem campo no schema) (204), light (M44) (204), voices (M44) (201), immunities.condition (sem imunidade de condição no schema) (93), bosstiary (sem sistema de Bosstiary) (11), events (M44) (9), enemyFactions (sem facção) (1), faction (sem facção) (1), heals (#683) (1), reflects (#683) (1).
- Pastas fora do catálogo: `familiars/`, `trainers/`, `traps/`.

## Fora do corte (1433)

O pacote de arte 13.32 não desenha, ou o `sim` ainda não executa a mecânica (ADR 0038 decisão 5).
Reimportar recupera automaticamente o que um schema futuro passar a aceitar.

| id | nome | motivo | fonte |
|---|---|---|---|
| a-carved-stone-tile | a carved stone tile | aparência por item (lookTypeEx 516) — só outfit é resolvido; invocação (M35-02); speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_inquisition/a_carved_stone_tile.lua` |
| a-greedy-eye | A Greedy Eye | ataque sem mapeador (M35-02): greedy eye beam; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/soul_war/normal_monsters/furious_crater/a_greedy_eye.lua` |
| a-shielded-astral-glyph | A Shielded Astral Glyph | aparência por item (lookTypeEx 24226) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/kilmaresh/a_shielded_astral_glyph.lua` |
| abyssador | Abyssador | ataque sem mapeador (M35-02): abyssador poison wave, combat, condition; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/quests/bigfoots_burden/bosses/abyssador.lua` |
| acid-blob | Acid Blob | ataque sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/slimes/acid_blob.lua` |
| acolyte-of-darkness | Acolyte of Darkness | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/acolyte_of_darkness.lua` |
| acolyte-of-the-cult | Acolyte of the Cult | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/humans/acolyte_of_the_cult.lua` |
| adept-of-the-cult | Adept of the Cult | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/humans/adept_of_the_cult.lua` |
| adult-goanna | Adult Goanna | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/reptiles/adult_goanna.lua` |
| afflicted-strider | Afflicted Strider | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/vermins/afflicted_strider.lua` |
| aftershock | Aftershock | ataque sem mapeador (M35-02): aftershock wave, anomaly break, combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/aftershock.lua` |
| aggressive-lava | Aggressive Lava | ataque sem mapeador (M35-02): aggressivelavawave | `data-otservbr-global/monster/quests/dangerous_depth/aggressive_lava.lua` |
| aggressive-matter | Aggressive Matter | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), rot elemental paralyze; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/dangerous_depth/aggressive_matter.lua` |
| agrestic-chicken | Agrestic Chicken | Bestiário sem race | `data-otservbr-global/monster/birds/agrestic_chicken.lua` |
| ahau | Ahau | ataque sem mapeador (M35-02): boulder ring, combat | `data-otservbr-global/monster/undeads/ahau.lua` |
| alchemist-container | Alchemist Container | aparência por item (lookTypeEx 39952) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/bosses/alchemist_container.lua` |
| alptramun | Alptramun | ataque sem mapeador (M35-02): combat, stone shower rune | `data-otservbr-global/monster/quests/the_dream_courts/bosses/alptramun.lua` |
| amazon | Amazon | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/amazon.lua` |
| amenef-the-burning | Amenef the Burning | ataque sem mapeador (M35-02): combat, firering, firex | `data-otservbr-global/monster/quests/kilmaresh/amenef_the_burning.lua` |
| an-astral-glyph | An Astral Glyph | aparência por item (lookTypeEx 24225) — só outfit é resolvido; ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/kilmaresh/an_astral_glyph.lua` |
| an-observer-eye | An Observer Eye | ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/mysterious_ornate_chest/an_observer_eye.lua` |
| an-observer-eye-imune | An Observer Eye | ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/mysterious_ornate_chest/an_observer_eye_(imune).lua` |
| ancient-lion-archer | Ancient Lion Archer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_order_of_lion/bosses/ancient_lion_archer.lua` |
| ancient-lion-knight | Ancient Lion Knight | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/the_order_of_lion/bosses/ancient_lion_knight.lua` |
| ancient-lion-warlock | Ancient Lion Warlock | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_order_of_lion/bosses/ancient_lion_warlock.lua` |
| ancient-scarab | Ancient Scarab | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): speed; invocação (M35-02) | `data-otservbr-global/monster/vermins/ancient_scarab.lua` |
| ancient-spawn-of-morgathla | Ancient Spawn of Morgathla | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/dangerous_depth/bosses/ancient_spawn_of_morgathla.lua` |
| angry-demon | Angry Demon | ataque sem mapeador (M35-02): combat, firefield, speed; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/annihilator/angry_demon.lua` |
| angry-plant | Angry Plant | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/the_first_dragon/angry_plant.lua` |
| angry-sugar-fairy | Angry Sugar Fairy | outfit 1747 fora do pacote 13.32; ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/fey/angry_sugar_fairy.lua` |
| animated-clomp | Animated Clomp | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/animated_clomp.lua` |
| animated-feather | Animated Feather | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/animated_feather.lua` |
| animated-guzzlemaw | Animated Guzzlemaw | ataque sem mapeador (M35-02): combat, condition, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/animated_guzzlemaw.lua` |
| animated-moohtant | Animated Moohtant | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/animated_moohtant.lua` |
| animated-mummy | Animated Mummy | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed | `data-otservbr-global/monster/quests/cults_of_tibia/animated_mummy.lua` |
| animated-ogre-brute | Animated Ogre Brute | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/animated_ogre_brute.lua` |
| animated-ogre-savage | Animated Ogre Savage | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/animated_ogre_savage.lua` |
| animated-ogre-shaman | Animated Ogre Shaman | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), outfit; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/cults_of_tibia/animated_ogre_shaman.lua` |
| animated-skunk | Animated Skunk | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/animated_skunk.lua` |
| animated-snowman | Animated Snowman | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/constructs/animated_snowman.lua` |
| animated-stone-rhino | Animated Stone Rhino | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/animated_rhino.lua` |
| animated-sword | Animated Sword | aparência por item (lookTypeEx 24227) — só outfit é resolvido; ataque sem mapeador (M35-02): berserk, combat | `data-otservbr-global/monster/quests/forgotten_knowledge/animated_sword.lua` |
| annihilon | Annihilon | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/the_inquisition/annihilon.lua` |
| anomaly | Anomaly | ataque sem mapeador (M35-02): anomaly break, anomaly wave, combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/anomaly.lua` |
| antenna | Antenna | aparência por item (lookTypeEx 850) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/bosses/antenna.lua` |
| apocalypse | Apocalypse | ataque sem mapeador (M35-02): combat, condition, speed, strength; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/bosses/apocalypse.lua` |
| apprentice-sheng | Apprentice Sheng | ataque sem mapeador (M35-02): combat, energyfield; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/bosses/apprentice_sheng.lua` |
| arachir-the-ancient-one | Arachir the Ancient One | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible, outfit; invocação (M35-02) | `data-otservbr-global/monster/raids/arachir_the_ancient_one.lua` |
| arachnophobica | Arachnophobica | ataque sem mapeador (M35-02): arachnophobicawavedice, arachnophobicawaveenergy, combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/arachnophobica.lua` |
| arbaziloth | Arbaziloth | outfit 1802 fora do pacote 13.32; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/no_rest_for_the_wicked/bosses/arbaziloth.lua` |
| arctic-faun | Arctic Faun | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/fey/arctic_faun.lua` |
| armadile | Armadile | ataque sem mapeador (M35-02): condition, drunk | `data-otservbr-global/monster/magicals/armadile.lua` |
| armenius-creature | Armenius (Creature) | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, outfit, speed | `data-otservbr-global/monster/bosses/armenius.lua` |
| ascending-ferumbras | Ascending Ferumbras | ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/ascending_ferumbras.lua` |
| ashes-of-burning-hatred | Ashes of Burning Hatred | aparência por item (lookTypeEx 34009) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/soul_war/normal_monsters/burning_hatred/ashes_of_burning_hatred.lua` |
| ashmunrah | Ashmunrah | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat, invisible, outfit; invocação (M35-02) | `data-otservbr-global/monster/quests/ancient_tombs/ashmunrah.lua` |
| askarak-demon | Askarak Demon | ataque sem mapeador (M35-02): askarak wave, combat, speed | `data-otservbr-global/monster/demons/askarak_demon.lua` |
| askarak-lord | Askarak Lord | ataque sem mapeador (M35-02): askarak wave, combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/askarak_lord.lua` |
| askarak-prince | Askarak Prince | ataque sem mapeador (M35-02): askarak wave, combat, speed | `data-otservbr-global/monster/demons/askarak_prince.lua` |
| aspect-of-power | Aspect of Power | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): outfit | `data-otservbr-global/monster/quests/soul_war/aspect_of_power.lua` |
| assassin | Assassin | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/humans/assassin.lua` |
| avalanche | Avalanche | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/svargrond_arena/scrapper/avalanche.lua` |
| axeitus-headbanger | Axeitus Headbanger | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/svargrond_arena/greenhorn/axeitus_headbanger.lua` |
| azerus | Azerus | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/in_service_of_yalahar/azerus.lua` |
| azerus2 | Azerus | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/in_service_of_yalahar/azerus2.lua` |
| bad-dream | Bad Dream | aparência por item (lookTypeEx 20110) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/roshamuul/bad_dream.lua` |
| bakragore | Bakragore | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/bosses/bakragore.lua` |
| baleful-bunny | Baleful Bunny | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_percht_queens_island/baleful_bunny.lua` |
| bane-of-light | Bane of Light | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, outfit, speed | `data-otservbr-global/monster/undeads/bane_of_light.lua` |
| banshee | Banshee | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/banshee.lua` |
| barbaria | Barbaria | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/raids/barbaria.lua` |
| barbarian-bloodwalker | Barbarian Bloodwalker | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/humans/barbarian_bloodwalker.lua` |
| barbarian-brutetamer | Barbarian Brutetamer | ataque sem mapeador (M35-02): barbarian brutetamer skill reducer, combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/humans/barbarian_brutetamer.lua` |
| barbarian-headsplitter | Barbarian Headsplitter | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/barbarian_headsplitter.lua` |
| barkless-devotee | Barkless Devotee | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/barkless_devotee.lua` |
| barkless-fanatic | Barkless Fanatic | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/barkless_fanatic.lua` |
| bashmu | Bashmu | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/magicals/bashmu.lua` |
| battlemaster-zunzu | Battlemaster Zunzu | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/raids/battlemaster_zunzu.lua` |
| bazir | Bazir | ataque sem mapeador (M35-02): combat, drunk, outfit, speed, strength; defesa com magia sem mapeador (M35-02): combat, invisible, outfit, speed; invocação (M35-02) | `data-otservbr-global/monster/bosses/bazir.lua` |
| beast-hulking-prehemoth | Beast Hulking Prehemoth | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/giants/beast_hulking_prehemoth.lua` |
| behemoth | Behemoth | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/giants/behemoth.lua` |
| berserker-chicken | Berserker Chicken | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/birds/berserker_chicken.lua` |
| betrayed-wraith | Betrayed Wraith | ataque sem mapeador (M35-02): betrayed wraith skill reducer, speed; defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/undeads/betrayed_wraith.lua` |
| bibby-bloodbath | Bibby Bloodbath | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/bosses/bibby_bloodbath.lua` |
| big-boss-trolliver | Big Boss Trolliver | invocação (M35-02) | `data-otservbr-global/monster/bosses/big_boss_trolliver.lua` |
| biting-book | Biting Book | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/constructs/biting_book.lua` |
| biting-cold | Biting Cold | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/biting_cold.lua` |
| black-cobra | Black Cobra | ataque sem mapeador (M35-02): condition, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/grave_danger/black_cobra.lua` |
| black-knight | Black Knight | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/black_knight.lua` |
| black-sphinx-acolyte | Black Sphinx Acolyte | ataque sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/humans/black_sphinx_acolyte.lua` |
| black-vixen | Black Vixen | ataque sem mapeador (M35-02): combat, outfit, speed; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/quests/the_curse_spreads/black_vixen.lua` |
| blaze-of-burning-hatred | Blaze of Burning Hatred | aparência por item (lookTypeEx 34013) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/soul_war/normal_monsters/burning_hatred/blaze_of_burning_hatred.lua` |
| blazing-fire-elemental | Blazing Fire Elemental | ataque sem mapeador (M35-02): combat, firefield | `data-otservbr-global/monster/quests/the_elemental_spheres/blazing_fire_elemental.lua` |
| blemished-spawn | Blemished Spawn | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/vermins/blemished_spawn.lua` |
| blightwalker | Blightwalker | ataque sem mapeador (M35-02): blightwalker curse, combat, speed | `data-otservbr-global/monster/undeads/blightwalker.lua` |
| blistering-fire-elemental | Blistering Fire Elemental | ataque sem mapeador (M35-02): combat, condition, firefield | `data-otservbr-global/monster/quests/the_elemental_spheres/blistering_fire_elemental.lua` |
| bloated-man-maggot | Bloated Man-Maggot | ataque sem mapeador (M35-02): combat, largefirering | `data-otservbr-global/monster/quests/rotten_blood/bloated_man-maggot.lua` |
| blood-beast | Blood Beast | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/undeads/blood_beast.lua` |
| blood-hand | Blood Hand | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat, effect | `data-otservbr-global/monster/humans/blood_hand.lua` |
| blood-priest | Blood Priest | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/blood_priest.lua` |
| bloodback | Bloodback | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/the_curse_spreads/bloodback.lua` |
| blue-djinn | Blue Djinn | ataque sem mapeador (M35-02): combat, djinn cancel invisibility, djinn electrify, drunk, outfit | `data-otservbr-global/monster/magicals/blue_djinn.lua` |
| boar-man | Boar Man | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/reptiles/boar_man.lua` |
| bog-raider | Bog Raider | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/bog_raider.lua` |
| bone-capsule | Bone Capsule | speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/ferumbras_ascension/traps/bone_capsule.lua` |
| bone-jaw | Bone Jaw | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/bone_jaw.lua` |
| bonebeast | Bonebeast | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/bonebeast.lua` |
| bonelord | Bonelord | ataque sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/magicals/bonelord.lua` |
| bones | Bones | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/bones.lua` |
| bonny-bunny | Bonny Bunny | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_percht_queens_island/bonny_bunny.lua` |
| bony-sea-devil | Bony Sea Devil | ataque sem mapeador (M35-02): combat, destroy magic walls, ice chain, soulwars fear | `data-otservbr-global/monster/quests/soul_war/normal_monsters/bony_sea_devil.lua` |
| boogey | Boogey | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/isle_of_evil/boogey.lua` |
| boogy | Boogy | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/fey/boogy.lua` |
| bound-astral-power | Bound Astral Power | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/forgotten_knowledge/bound_astral_power.lua` |
| brachiodemon | Brachiodemon | ataque sem mapeador (M35-02): combat, destroy magic walls | `data-otservbr-global/monster/quests/soul_war/normal_monsters/brachiodemon.lua` |
| bragrumol | Bragrumol | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/kilmaresh/bragrumol.lua` |
| brain-head | Brain Head | aparência por item (lookTypeEx 32418) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/bosses/brain_head.lua` |
| brain-parasite | Brain Parasite | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/brain_parasite.lua` |
| brain-squid | Brain Squid | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/brain_squid.lua` |
| braindeath | Braindeath | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/magicals/braindeath.lua` |
| branchy-crawler | Branchy Crawler | ataque sem mapeador (M35-02): combat, root | `data-otservbr-global/monster/quests/soul_war/normal_monsters/branchy_crawler.lua` |
| breach-brood | Breach Brood | ataque sem mapeador (M35-02): breach brood reducer, combat | `data-otservbr-global/monster/extra_dimensional/breach_brood.lua` |
| bretzecutioner | Bretzecutioner | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/killing_in_the_name_of/bretzecutioner.lua` |
| bright-percht-sleigh | Bright Percht Sleigh | speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_percht_queens_island/bright_percht_sleigh.lua` |
| brimstone-bug | Brimstone Bug | ataque sem mapeador (M35-02): brimstone bug wave, combat, melee (condição/tipo/chance/duplicado), speed | `data-otservbr-global/monster/vermins/brimstone_bug.lua` |
| brinebrute-inferniarch | Brinebrute Inferniarch | outfit 1794 fora do pacote 13.32; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/brinebrute_inferniarch.lua` |
| brittle-skeleton | Brittle Skeleton | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/dawnport/brittle_skeleton.lua` |
| broken-shaper | Broken Shaper | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/humanoids/broken_shaper.lua` |
| brokul | Brokul | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/the_secret_library/bosses/brokul.lua` |
| broodrider-inferniarch | Broodrider Inferniarch | outfit 1796 fora do pacote 13.32; ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/broodrider_inferniarch.lua` |
| brother-chill | Brother Chill | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/brother_chill.lua` |
| brother-freeze | Brother Freeze | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/brother_freeze.lua` |
| brother-worm | Brother Worm | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/feaster_of_souls/brother_worm.lua` |
| bruise-payne | Bruise Payne | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), mutated bat curse; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/killing_in_the_name_of/bruise_payne.lua` |
| brutus-bloodbeard | Brutus Bloodbeard | ataque sem mapeador (M35-02): combat, drunk | `data-otservbr-global/monster/raids/brutus_bloodbeard.lua` |
| bulltaur-alchemist | Bulltaur Alchemist | ataque sem mapeador (M35-02): bulltaur avalanche, combat; loot sem nome resolvível (id 44736); loot sem nome resolvível (id 44739); loot sem nome resolvível (id 44740) | `data-otservbr-global/monster/humanoids/bulltaur_alchemist.lua` |
| bulltaur-brute | Bulltaur Brute | ataque sem mapeador (M35-02): combat; loot sem nome resolvível (id 44736); loot sem nome resolvível (id 44738); loot sem nome resolvível (id 44737) | `data-otservbr-global/monster/humanoids/bulltaur_brute.lua` |
| bulltaur-forgepriest | Bulltaur Forgepriest | ataque sem mapeador (M35-02): bulltaur explosion, bulltaurewave, combat; loot sem nome resolvível (id 44736); loot sem nome resolvível (id 44741); loot sem nome resolvível (id 44742) | `data-otservbr-global/monster/humanoids/bulltaur_forgepriest.lua` |
| bullwark | Bullwark | ataque sem mapeador (M35-02): bullwark paralyze, combat, condition; defesa com magia sem mapeador (M35-02): bullwark summon, combat, speed | `data-otservbr-global/monster/bosses/bullwark.lua` |
| burning-book | Burning Book | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/burning_book.lua` |
| burning-gladiator | Burning Gladiator | ataque sem mapeador (M35-02): combat, firering, firex | `data-otservbr-global/monster/humans/burning_gladiator.lua` |
| burrowing-beetle | Burrowing Beetle | ataque sem mapeador (M35-02): combat, poisonfield; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/vermins/burrowing_beetle.lua` |
| burster-spectre | Burster Spectre | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/burster_spectre.lua` |
| candy-floss-elemental | Candy Floss Elemental | outfit 1749 fora do pacote 13.32; ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/elementals/candy_floss_elemental.lua` |
| candy-horror | Candy Horror | outfit 1739 fora do pacote 13.32; ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/candy_horror.lua` |
| canopic-jar | Canopic Jar | defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/dark_trails/canopic_jar.lua` |
| capricious-phantom | Capricious Phantom | ataque sem mapeador (M35-02): combat, ice chain | `data-otservbr-global/monster/quests/soul_war/normal_monsters/capricious_phantom.lua` |
| captain-jones | Captain Jones | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), outfit; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/raids/captain_jones.lua` |
| carniphila | Carniphila | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed | `data-otservbr-global/monster/plants/carniphila.lua` |
| carnisylvan-sapling | Carnisylvan Sapling | ataque sem mapeador (M35-02): sapling explode | `data-otservbr-global/monster/humans/carnisylvan_sapling.lua` |
| carnivostrich | Carnivostrich | ataque sem mapeador (M35-02): combat, energy chain, melee (condição/tipo/chance/duplicado), thunderstorm ring | `data-otservbr-global/monster/reptiles/carnivostrich.lua` |
| cart-packed-with-gold | Cart Packed with Gold | speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/grave_danger/cart_packed_with_gold.lua` |
| cave-chimera | Cave Chimera | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/vermins/cave_chimera.lua` |
| cave-devourer | Cave Devourer | ataque sem mapeador (M35-02): combat, stalagmite rune, stone shower rune | `data-otservbr-global/monster/vermins/cave_devourer.lua` |
| cave-spider | Cave Spider | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), poisonfield; defesa com magia sem mapeador (M35-02): speed; invocação (M35-02) | `data-otservbr-global/monster/quests/hidden_threats/cave_spider.lua` |
| centipede | Centipede | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/vermins/centipede.lua` |
| cerebellum | Cerebellum | aparência por item (lookTypeEx 32572) — só outfit é resolvido; ataque sem mapeador (M35-02): combat, heal brain head; defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/bosses/cerebellum.lua` |
| chagorz | Chagorz | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/chagorz.lua` |
| chakoya-toolshaper | Chakoya Toolshaper | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/chakoya_toolshaper.lua` |
| chakoya-windcaller | Chakoya Windcaller | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/humanoids/chakoya_windcaller.lua` |
| charged-anomaly | Charged Anomaly | ataque sem mapeador (M35-02): anomaly break, charge vortex, combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/charged_anomaly.lua` |
| charged-disruption | Charged Disruption | aparência por item (lookTypeEx 1949) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/charged_disruption.lua` |
| charged-energy-elemental | Charged Energy Elemental | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_elemental_spheres/charged_energy_elemental.lua` |
| charger | Charger | ataque sem mapeador (M35-02): combat, condition | `data-otservbr-global/monster/quests/heart_of_destruction/charger.lua` |
| charging-outburst | Charging Outburst | ataque sem mapeador (M35-02): anomaly break, combat, outburst explode | `data-otservbr-global/monster/quests/heart_of_destruction/charging_outburst.lua` |
| chasm-spawn | Chasm Spawn | ataque sem mapeador (M35-02): combat, explosion rune, stone shower rune | `data-otservbr-global/monster/vermins/chasm_spawn.lua` |
| chayenne | Chayenne | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, outfit | `data-otservbr-global/monster/raids/chayenne.lua` |
| cheese-thief | Cheese Thief | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/cheese_thief.lua` |
| chikhaton | Chikhaton | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/chikhaton.lua` |
| chizzoron-the-distorter | Chizzoron the Distorter | ataque sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/raids/chizzoron_the_distorter.lua` |
| chocolate-blob | Chocolate Blob | outfit 1732 fora do pacote 13.32 | `data-otservbr-global/monster/slimes/chocolate_blob.lua` |
| choking-fear | Choking Fear | ataque sem mapeador (M35-02): choking fear drown, combat, condition, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/choking_fear.lua` |
| clay-guardian | Clay Guardian | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/constructs/clay_guardian.lua` |
| cliff-strider | Cliff Strider | ataque sem mapeador (M35-02): cliff strider electrify, cliff strider skill reducer, combat | `data-otservbr-global/monster/elementals/cliff_strider.lua` |
| cloak-of-terror | Cloak of Terror | ataque sem mapeador (M35-02): combat, destroy magic walls | `data-otservbr-global/monster/quests/soul_war/normal_monsters/furious_crater/cloak_of_terror.lua` |
| clomp | Clomp | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/mammals/clomp.lua` |
| clubarc-the-plunderer | Clubarc The Plunderer | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/bosses/clubarc_the_plunderer.lua` |
| cobra | Cobra | ataque sem mapeador (M35-02): condition, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/reptiles/cobra.lua` |
| cobra-assassin | Cobra Assassin | ataque sem mapeador (M35-02): combat, wave t | `data-otservbr-global/monster/humans/cobra_assassin.lua` |
| cobra-scout | Cobra Scout | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/cobra_scout.lua` |
| cobra-vizier | Cobra Vizier | ataque sem mapeador (M35-02): combat, death chain, explosion wave; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/humans/cobra_vizier.lua` |
| cold-percht-sleigh | Cold Percht Sleigh | speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_percht_queens_island/cold_percht_sleigh.lua` |
| coldheart | Coldheart | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_new_frontier/coldheart.lua` |
| colerian-the-barbarian | Colerian the Barbarian | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/svargrond_arena/greenhorn/colerian_the_barbarian.lua` |
| concentrated-death | Concentrated Death | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/concentrated_death.lua` |
| condensed-sin | Condensed Sin | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/condensed_sin.lua` |
| condensed-sins | Condensed Sins | ataque sem mapeador (M35-02): combat, death blob curse | `data-otservbr-global/monster/quests/grave_danger/condensed_sins.lua` |
| containment-crystal | Containment Crystal | aparência por item (lookTypeEx 7805) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/pillars/containment_crystal.lua` |
| containment-machine | Containment Machine | aparência por item (lookTypeEx 8988) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/containment_machine.lua` |
| control-tower | Control Tower | aparência por item (lookTypeEx 20894) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/raids/control_tower.lua` |
| converter | Converter | ataque sem mapeador (M35-02): combat, energy chain, largeholyring | `data-otservbr-global/monster/quests/rotten_blood/converter.lua` |
| corrupt-naga | Corrupt Naga | ataque sem mapeador (M35-02): combat, nagadeathattack | `data-otservbr-global/monster/reptiles/corrupt_naga.lua` |
| corrupted-soul | Corrupted Soul | ataque sem mapeador (M35-02): combat, souleater drown, souleater wave; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/quests/forgotten_knowledge/corrupted_soul.lua` |
| corym-skirmisher | Corym Skirmisher | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/corym_skirmisher.lua` |
| corym-vanguard | Corym Vanguard | ataque sem mapeador (M35-02): combat, corym vanguard wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/corym_vanguard.lua` |
| cosmic-energy-prism-a | Cosmic Energy Prism A | aparência por item (lookTypeEx 2187) — só outfit é resolvido; defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/forgotten_knowledge/cosmic_energy_prism_a.lua` |
| cosmic-energy-prism-a-invu | Cosmic Energy Prism A | aparência por item (lookTypeEx 2187) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/forgotten_knowledge/cosmic_energy_prism_a_invu.lua` |
| cosmic-energy-prism-b | Cosmic Energy Prism B | aparência por item (lookTypeEx 2187) — só outfit é resolvido; defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/forgotten_knowledge/cosmic_energy_prism_b.lua` |
| cosmic-energy-prism-b-invu | Cosmic Energy Prism B | aparência por item (lookTypeEx 2187) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/forgotten_knowledge/cosmic_energy_prism_b_invu.lua` |
| cosmic-energy-prism-c | Cosmic Energy Prism C | aparência por item (lookTypeEx 2187) — só outfit é resolvido; defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/forgotten_knowledge/cosmic_energy_prism_c.lua` |
| cosmic-energy-prism-c-invu | Cosmic Energy Prism C | aparência por item (lookTypeEx 2187) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/forgotten_knowledge/cosmic_energy_prism_c_invu.lua` |
| cosmic-energy-prism-d | Cosmic Energy Prism D | aparência por item (lookTypeEx 2187) — só outfit é resolvido; defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/forgotten_knowledge/cosmic_energy_prism_d.lua` |
| cosmic-energy-prism-d-invu | Cosmic Energy Prism D | aparência por item (lookTypeEx 2187) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/forgotten_knowledge/cosmic_energy_prism_d_invu.lua` |
| count-vlarkorth | Count Vlarkorth | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/grave_danger/bosses/count_vlarkorth.lua` |
| countess-sorrow | Countess Sorrow | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado), phantasm drown; defesa com magia sem mapeador (M35-02): combat, invisible, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/pits_of_inferno/countess_sorrow.lua` |
| courage-leech | Courage Leech | ataque sem mapeador (M35-02): combat, energy chain | `data-otservbr-global/monster/quests/soul_war/normal_monsters/furious_crater/courage_leech.lua` |
| crackler | Crackler | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/crackler.lua` |
| crape-man | Crape Man | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/reptiles/crape_man.lua` |
| crawler | Crawler | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/vermins/crawler.lua` |
| crazed-summer-rearguard | Crazed Summer Rearguard | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/crazed_summer_rearguard.lua` |
| crazed-summer-vanguard | Crazed Summer Vanguard | ataque sem mapeador (M35-02): combat, sparks chain | `data-otservbr-global/monster/humanoids/crazed_summer_vanguard.lua` |
| crazed-winter-rearguard | Crazed Winter Rearguard | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/crazed_winter_rearguard.lua` |
| crazed-winter-vanguard | Crazed Winter Vanguard | Lua não avaliável como dado: erro de sintaxe Lua: [77:43] code unit U+2026 is not allowed in the current encoding mode | `data-otservbr-global/monster/humanoids/crazed_winter_vanguard.lua` |
| cream-blob | Cream Blob | outfit 1757 fora do pacote 13.32 | `data-otservbr-global/monster/fey/cream_blob.lua` |
| crypt-defiler | Crypt Defiler | Lua não avaliável como dado: identificador "dafasdfasdfsadfasdfasd" sem constante conhecida (linha 19) | `data-otservbr-global/monster/humans/crypt_defiler.lua` |
| crypt-shambler | Crypt Shambler | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/crypt_shambler.lua` |
| crypt-warden | Crypt Warden | ataque sem mapeador (M35-02): combat, warden ring, warden x | `data-otservbr-global/monster/magicals/crypt_warden.lua` |
| crypt-warrior | Crypt Warrior | ataque sem mapeador (M35-02): combat; Bestiário sem race | `data-otservbr-global/monster/undeads/crypt_warrior.lua` |
| crystal-spider | Crystal Spider | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/vermins/crystal_spider.lua` |
| crystal-wolf | Crystal Wolf | ataque sem mapeador (M35-02): combat, crystal wolf wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/mammals/crystal_wolf.lua` |
| crystalcrusher | Crystalcrusher | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/crystalcrusher.lua` |
| cult-believer | Cult Believer | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/cult_believer.lua` |
| cult-enforcer | Cult Enforcer | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/cult_enforcer.lua` |
| cult-scholar | Cult Scholar | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/cult_scholar.lua` |
| cunning-werepanther | Cunning Werepanther | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/lycanthropes/cunning_werepanther.lua` |
| cursed-ape | Cursed Ape | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/cursed_ape.lua` |
| cursed-book | Cursed Book | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/cursed_book.lua` |
| cursed-gladiator | Cursed Gladiator | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/svargrond_arena/greenhorn/cursed_gladiator.lua` |
| cursed-prospector | Cursed Prospector | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/cursed_prospector.lua` |
| custodian | Custodian | ataque sem mapeador (M35-02): combat, explosion wave | `data-otservbr-global/monster/bosses/custodian.lua` |
| cyclops-drone | Cyclops Drone | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/giants/cyclops_drone.lua` |
| cyclops-smith | Cyclops Smith | ataque sem mapeador (M35-02): combat, drunk | `data-otservbr-global/monster/giants/cyclops_smith.lua` |
| damage-resonance | Damage Resonance | aparência por item (lookTypeEx 22761) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/damage_resonance.lua` |
| damaged-worker-golem | Damaged Worker Golem | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/constructs/damaged_worker_golem.lua` |
| darakan-the-executioner | Darakan the Executioner | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/svargrond_arena/warlord/darakan_the_executioner.lua` |
| dark-apprentice | Dark Apprentice | ataque sem mapeador (M35-02): combat, outfit; defesa com magia sem mapeador (M35-02): combat, outfit | `data-otservbr-global/monster/humans/dark_apprentice.lua` |
| dark-carnisylvan | Dark Carnisylvan | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/humans/dark_carnisylvan.lua` |
| dark-druid | Dark Druid | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/dark_druid.lua` |
| dark-faun | Dark Faun | ataque sem mapeador (M35-02): combat, drunk; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/fey/dark_faun.lua` |
| dark-knight | Dark Knight | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/dark_knight.lua` |
| dark-knowledge | Dark Knowledge | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/the_secret_library/dark_knowledge.lua` |
| dark-magician | Dark Magician | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/humans/dark_magician.lua` |
| dark-monk | Dark Monk | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/humans/dark_monk.lua` |
| dark-paladin | Dark Paladin | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/dark_paladin.lua` |
| dark-percht-sleigh | Dark Percht Sleigh | speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_percht_queens_island/dark_percht_sleigh.lua` |
| dark-sorcerer | Dark Sorcerer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/dark_sorcerer.lua` |
| dark-soul | Dark Soul | defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/summons/dark_soul.lua` |
| dark-torturer | Dark Torturer | ataque sem mapeador (M35-02): combat, dark torturer skill reducer; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/dark_torturer.lua` |
| darkfang | Darkfang | ataque sem mapeador (M35-02): combat, speed, werewolf skill reducer; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/the_curse_spreads/darkfang.lua` |
| darklight-construct | Darklight Construct | ataque sem mapeador (M35-02): combat, extended fire chain, largefirering | `data-otservbr-global/monster/quests/rotten_blood/darklight_construct.lua` |
| darklight-emitter | Darklight Emitter | ataque sem mapeador (M35-02): combat, largefirering | `data-otservbr-global/monster/quests/rotten_blood/darklight_emitter.lua` |
| darklight-matter | Darklight Matter | ataque sem mapeador (M35-02): combat, largeredring | `data-otservbr-global/monster/quests/rotten_blood/darklight_matter.lua` |
| darklight-source | Darklight Source | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/rotten_blood/darklight_source.lua` |
| darklight-striker | Darklight Striker | ataque sem mapeador (M35-02): combat, extended holy chain, largepinkring | `data-otservbr-global/monster/quests/rotten_blood/darklight_striker.lua` |
| dawn-scorpion | Dawn Scorpion | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/dawnport/dawn_scorpion.lua` |
| dawnfire-asura | Dawnfire Asura | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/demons/dawnfire_asura.lua` |
| dawnfly | Dawnfly | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/dawnport/dawnfly.lua` |
| dazed-leaf-golem | Dazed Leaf Golem | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/dazed_leaf_golem.lua` |
| deadeye-devious | Deadeye Devious | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/raids/deadeye_devious.lua` |
| death-blob | Death Blob | ataque sem mapeador (M35-02): combat, death blob curse; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/slimes/death_blob.lua` |
| death-dragon | Death Dragon | ataque sem mapeador (M35-02): combat, undead dragon curse; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/death_dragon.lua` |
| death-priest | Death Priest | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/death_priest.lua` |
| death-priest-shargon | Death Priest Shargon | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/dark_trails/death_priest_shargon.lua` |
| deathbine | Deathbine | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed | `data-otservbr-global/monster/quests/killing_in_the_name_of/deathbine.lua` |
| deathbringer | Deathbringer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/svargrond_arena/warlord/deathbringer.lua` |
| deathling-scout | Deathling Scout | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/deathling_scout.lua` |
| deathling-spellsinger | Deathling Spellsinger | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/deathling_spellsinger.lua` |
| deathspawn | Deathspawn | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/amphibics/deathspawn.lua` |
| deathstrike | Deathstrike | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/bigfoots_burden/bosses/deathstrike.lua` |
| deep-terror | Deep Terror | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/hero_of_rathleton/deep_terror.lua` |
| deepling-brawler | Deepling Brawler | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/deepling_brawler.lua` |
| deepling-elite | Deepling Elite | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/deepling_elite.lua` |
| deepling-guard | Deepling Guard | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/deepling_guard.lua` |
| deepling-master-librarian | Deepling Master Librarian | ataque sem mapeador (M35-02): combat, deepling spellsinger skill reducer; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/deepling_master_librarian.lua` |
| deepling-scout | Deepling Scout | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/deepling_scout.lua` |
| deepling-spellsinger | Deepling Spellsinger | ataque sem mapeador (M35-02): combat, deepling spellsinger skill reducer | `data-otservbr-global/monster/aquatics/deepling_spellsinger.lua` |
| deepling-tyrant | Deepling Tyrant | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/deepling_tyrant.lua` |
| deepling-warrior | Deepling Warrior | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/deepling_warrior.lua` |
| deepworm | Deepworm | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/vermins/deepworm.lua` |
| defiler | Defiler | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/slimes/defiler.lua` |
| demodras | Demodras | ataque sem mapeador (M35-02): combat, firefield; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/killing_in_the_name_of/demodras.lua` |
| demon | Demon | ataque sem mapeador (M35-02): combat, firefield, speed; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/demons/demon.lua` |
| demon-blood | Demon Blood | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/demon_blood.lua` |
| demon-goblin | Demon Goblin | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/pits_of_inferno/demon_goblin.lua` |
| demon-outcast | Demon Outcast | ataque sem mapeador (M35-02): combat, demon outcast skill reducer; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/demons/demon_outcast.lua` |
| demon-parrot | Demon Parrot | ataque sem mapeador (M35-02): combat, drunk | `data-otservbr-global/monster/birds/demon_parrot.lua` |
| demon-skeleton | Demon Skeleton | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/demon_skeleton.lua` |
| demon-slave | Demon Slave | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/demon_slave.lua` |
| depolarized-crackler | Depolarized Crackler | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/depolarized_crackler.lua` |
| depowered-minotaur | Depowered Minotaur | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/dark_trails/depowered_minotaur.lua` |
| despair | Despair | aparência por item (lookTypeEx 20052) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/ferumbras_ascension/traps/despair.lua` |
| desperate-soul | Desperate Soul | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/ferumbras_ascension/desperate_soul.lua` |
| desperate-white-deer | Desperate White Deer | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/mammals/desperate_white_deer.lua` |
| destabilized-ferumbras | Destabilized Ferumbras | ataque sem mapeador (M35-02): combat, condition, ferumbras electrify, ferumbras soulfire; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02); speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/destabilized_ferumbras.lua` |
| destroyed-pillar | Destroyed Pillar | aparência por item (lookTypeEx 7811) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/pillars/destroyed_pillar.lua` |
| destroyer | Destroyer | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/demons/destroyer.lua` |
| devourer | Devourer | ataque sem mapeador (M35-02): combat, devourer paralyze, devourer wave, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/slimes/devourer.lua` |
| dharalion | Dharalion | ataque sem mapeador (M35-02): combat, effect; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/bosses/dharalion.lua` |
| diabolic-imp | Diabolic Imp | ataque sem mapeador (M35-02): combat, diabolic imp skill reducer, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/demons/diabolic_imp.lua` |
| diamond-servant | Diamond Servant | ataque sem mapeador (M35-02): combat, drunk | `data-otservbr-global/monster/constructs/diamond_servant.lua` |
| diamond-servant-replica | Diamond Servant Replica | ataque sem mapeador (M35-02): combat, wyrm wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/constructs/diamond_servant_replica.lua` |
| diblis-the-fair | Diblis the Fair | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/bosses/diblis_the_fair.lua` |
| dipthrah | Dipthrah | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/ancient_tombs/dipthrah.lua` |
| dire-penguin | Dire Penguin | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/birds/dire_penguin.lua` |
| diremaw | Diremaw | ataque sem mapeador (M35-02): combat, condition | `data-otservbr-global/monster/vermins/diremaw.lua` |
| dirtbeard | Dirtbeard | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), pirate corsair skill reducer; invocação (M35-02) | `data-otservbr-global/monster/quests/isle_of_evil/dirtbeard.lua` |
| diseased-bill | Diseased Bill | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/bosses/diseased_bill.lua` |
| diseased-dan | Diseased Dan | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/bosses/diseased_dan.lua` |
| diseased-fred | Diseased Fred | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/bosses/diseased_fred.lua` |
| disgusting-ooze | Disgusting Ooze | ataque sem mapeador (M35-02): combat, condition, defiler paralyze 1, defiler paralyze 2, defiler paralyze 3, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/ferumbras_ascension/disgusting_ooze.lua` |
| disruption | Disruption | aparência por item (lookTypeEx 22761) — só outfit é resolvido; ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/disruption.lua` |
| distorted-phantom | Distorted Phantom | ataque sem mapeador (M35-02): combat, extended holy chain, ice chain | `data-otservbr-global/monster/quests/soul_war/normal_monsters/distorted_phantom.lua` |
| doctor-marrow | Doctor Marrow | ataque sem mapeador (M35-02): combat, doctor marrow explosion, fear, root; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/doctor_marrow.lua` |
| doctor-perhaps | Doctor Perhaps | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/isle_of_evil/doctor_perhaps.lua` |
| doom-deer | Doom Deer | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/mammals/doom_deer.lua` |
| doomhowl | Doomhowl | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/the_new_frontier/doomhowl.lua` |
| dorokoll-the-mystic | Dorokoll the Mystic | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/dorokoll_the_mystic.lua` |
| dorokoll-the-mystic-stop | Dorokoll The Mystic | ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/dorokoll_the_mystic_stop.lua` |
| dracola | Dracola | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/pits_of_inferno/dracola.lua` |
| dragolisk | Dragolisk | ataque sem mapeador (M35-02): combat, death chain | `data-otservbr-global/monster/dragons/dragolisk.lua` |
| dragon | Dragon | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/dragons/dragon.lua` |
| dragon-egg | Dragon Egg | aparência por item (lookTypeEx 25077) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/forgotten_knowledge/dragon_egg.lua` |
| dragon-essence | Dragon Essence | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/the_first_dragon/dragon_essence.lua` |
| dragon-hatchling | Dragon Hatchling | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/dragons/dragon_hatchling.lua` |
| dragon-hoard | Dragon Hoard | aparência por item (lookTypeEx 5674) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/twenty_years_a_cook/bosses/dragon_hoard.lua` |
| dragon-lord | Dragon Lord | ataque sem mapeador (M35-02): combat, firefield; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/dragons/dragon_lord.lua` |
| dragon-lord-hatchling | Dragon Lord Hatchling | ataque sem mapeador (M35-02): combat, firefield; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/dragons/dragon_lord_hatchling.lua` |
| dragon-servant | Dragon Servant | ataque sem mapeador (M35-02): combat, firefield, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/forgotten_knowledge/dragon_servant.lua` |
| dragon-warden | Dragon Warden | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_first_dragon/dragon_warden.lua` |
| dragon-wrath | Dragon Wrath | ataque sem mapeador (M35-02): combat, condition, ghastly dragon curse, ghastly dragon paralyze, ghastly dragon wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_first_dragon/dragon_wrath.lua` |
| dragonking-zyrtarch | Dragonking Zyrtarch | ataque sem mapeador (M35-02): combat, condition | `data-otservbr-global/monster/quests/forgotten_knowledge/bosses/dragonking_zyrtarch.lua` |
| dragonling | Dragonling | ataque sem mapeador (M35-02): combat, dragonling wave, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/dragonling.lua` |
| draken-abomination | Draken Abomination | ataque sem mapeador (M35-02): combat, draken abomination curse, drunk; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/dragons/draken_abomination.lua` |
| draken-elite | Draken Elite | ataque sem mapeador (M35-02): combat, condition, soulfire rune; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/dragons/draken_elite.lua` |
| draken-spellweaver | Draken Spellweaver | ataque sem mapeador (M35-02): combat, condition, soulfire rune; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/dragons/draken_spellweaver.lua` |
| draken-warmaster | Draken Warmaster | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/dragons/draken_warmaster.lua` |
| draptor | Draptor | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/raids/draptor.lua` |
| drasilla | Drasilla | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/svargrond_arena/scrapper/drasilla.lua` |
| dread-intruder | Dread Intruder | ataque sem mapeador (M35-02): combat, condition, dread intruder wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/extra_dimensional/dread_intruder.lua` |
| dread-minion | Dread Minion | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/summons/dread_minion.lua` |
| dreadbeast | Dreadbeast | ataque sem mapeador (M35-02): combat, dreadbeast skill reducer; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_inquisition/dreadbeast.lua` |
| dreadful-disruptor | Dreadful Disruptor | ataque sem mapeador (M35-02): combat, dread intruder wave | `data-otservbr-global/monster/quests/soul_war/dreadful_disruptor.lua` |
| dreadful-harvester | Dreadful Harvester | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/soul_war/dreadful_harvester.lua` |
| dreadwing | Dreadwing | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), mutated bat curse; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_new_frontier/dreadwing.lua` |
| drillworm | Drillworm | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed | `data-otservbr-global/monster/vermins/drillworm.lua` |
| dromedary | Dromedary | ataque sem mapeador (M35-02): drunk | `data-otservbr-global/monster/mammals/dromedary.lua` |
| druids-apparition | Druid's Apparition | ataque sem mapeador (M35-02): combat, ice chain; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/soul_war/normal_monsters/druid's_apparition.lua` |
| drume | Drume | ataque sem mapeador (M35-02): combat, singlecloudchain; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/the_order_of_lion/bosses/drume.lua` |
| dryad | Dryad | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/fey/dryad.lua` |
| duke-krule | Duke Krule | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/grave_danger/bosses/duke_krule.lua` |
| duskbringer | Duskbringer | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/demons/duskbringer.lua` |
| dwarf-geomancer | Dwarf Geomancer | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/dwarf_geomancer.lua` |
| dwarf-soldier | Dwarf Soldier | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/dwarf_soldier.lua` |
| dworc-fleshhunter | Dworc Fleshhunter | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/humanoids/dworc_fleshhunter.lua` |
| dworc-venomsniper | Dworc Venomsniper | ataque sem mapeador (M35-02): condition | `data-otservbr-global/monster/humanoids/dworc_venomsniper.lua` |
| dworc-voodoomaster | Dworc Voodoomaster | ataque sem mapeador (M35-02): combat, drunk, outfit, poisonfield, speed; defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/humanoids/dworc_voodoomaster.lua` |
| earl-osam | Earl Osam | ataque sem mapeador (M35-02): combat, ice chain; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/grave_danger/bosses/earl_osam.lua` |
| earth-elemental | Earth Elemental | ataque sem mapeador (M35-02): combat, condition, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/elementals/earth_elemental.lua` |
| earth-overlord | Earth Overlord | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/the_elemental_spheres/earth_overlord.lua` |
| earworm | Earworm | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/kilmaresh/earworm.lua` |
| echo-of-chagorz | Echo Of Chagorz | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/rotten_blood/echo_of_chagorz.lua` |
| echo-of-ichgahal | Echo Of Ichgahal | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/rotten_blood/echo_of_ichgahal.lua` |
| echo-of-murcion | Echo Of Murcion | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/rotten_blood/echo_of_murcion.lua` |
| echo-of-vemiath | Echo Of Vemiath | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/rotten_blood/echo_of_vemiath.lua` |
| eclipse-knight | Eclipse Knight | ataque sem mapeador (M35-02): combat, dark torturer skill reducer; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/eclipse_knight.lua` |
| efreet | Efreet | ataque sem mapeador (M35-02): combat, djinn electrify, drunk, outfit, speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/magicals/efreet.lua` |
| egg | Egg | aparência por item (lookTypeEx 4839) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/raids/egg_the_welter.lua` |
| ekatrix | Ekatrix | ataque sem mapeador (M35-02): combat, firefield | `data-otservbr-global/monster/bosses/ekatrix.lua` |
| elder-bloodjaw | Elder Bloodjaw | ataque sem mapeador (M35-02): blightwalker curse, combat, drunk, speed | `data-otservbr-global/monster/quests/rotten_blood/elder_bloodjaw.lua` |
| elder-bonelord | Elder Bonelord | ataque sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/magicals/elder_bonelord.lua` |
| elder-mummy | Elder Mummy | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed | `data-otservbr-global/monster/undeads/elder_mummy.lua` |
| elder-wyrm | Elder Wyrm | ataque sem mapeador (M35-02): combat, elder wyrm wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/dragons/elder_wyrm.lua` |
| electric-sparks | Electric Sparks | aparência por item (lookTypeEx 470) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/ferumbras_ascension/traps/electric_sparks.lua` |
| elf | Elf | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/elf.lua` |
| elf-arcanist | Elf Arcanist | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/elf_arcanist.lua` |
| elf-overseer | Elf Overseer | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/elf_overseer.lua` |
| elf-scout | Elf Scout | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/elf_scout.lua` |
| elite-pirat | Elite Pirat | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/elite_pirat.lua` |
| eliz-the-unyielding | Eliz the Unyielding | defesa com magia sem mapeador (M35-02): cults of tibia armor buff | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/eliz_the_unyielding.lua` |
| eliz-the-unyielding-stop | Eliz The Unyielding | defesa com magia sem mapeador (M35-02): cults of tibia armor buff; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/eliz_the_unyielding_stop.lua` |
| ember-beast | Ember Beast | ataque sem mapeador (M35-02): emberbeastarea, emberbeasthur | `data-otservbr-global/monster/quests/dangerous_depth/ember_beast.lua` |
| emerald-damselfly | Emerald Damselfly | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/vermins/emerald_damselfly.lua` |
| emerald-tortoise | Emerald Tortoise | ataque sem mapeador (M35-02): combat, emerald tortoise large ring, emerald tortoise small explosion, emerald tortoise small ring, energy chain | `data-otservbr-global/monster/reptiles/emerald_tortoise.lua` |
| empowered-glooth-horror | Empowered Glooth Horror | ataque sem mapeador (M35-02): combat, condition, drunk; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/hero_of_rathleton/empowered_glooth_horror.lua` |
| energetic-book | Energetic Book | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/energetic_book.lua` |
| energized-raging-mage | Energized Raging Mage | ataque sem mapeador (M35-02): combat, energized raging mage skill reducer, energyfield, thunderstorm rune; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/bosses/energized_raging_mage.lua` |
| energuardian-of-tales | Energuardian of Tales | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/energuardian_of_tales.lua` |
| energy-elemental | Energy Elemental | ataque sem mapeador (M35-02): combat, energy elemental electrify; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/elementals/energy_elemental.lua` |
| energy-overlord | Energy Overlord | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_elemental_spheres/energy_overlord.lua` |
| energy-pulse | Energy Pulse | ataque sem mapeador (M35-02): energy pulse explosion; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/hero_of_rathleton/energy_pulse.lua` |
| enfeebled-silencer | Enfeebled Silencer | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), silencer skill reducer; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/magicals/enfeebled_silencer.lua` |
| enlightened-of-the-cult | Enlightened of the Cult | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/humans/enlightened_of_the_cult.lua` |
| enraged-sand-brood | Enraged Sand Brood | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/summons/enraged_sand_brood.lua` |
| enraged-soul | Enraged Soul | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/enraged_soul.lua` |
| enraged-white-deer | Enraged White Deer | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/mammals/enraged_white_deer.lua` |
| enslaved-dwarf | Enslaved Dwarf | ataque sem mapeador (M35-02): combat, drunk, enslaved dwarf skill reducer 1, enslaved dwarf skill reducer 2; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/enslaved_dwarf.lua` |
| enthralled-demon | Enthralled Demon | ataque sem mapeador (M35-02): combat, demon paralyze, firefield; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/ferumbras_ascension/summons/enthralled_demon.lua` |
| eradicator | Eradicator | ataque sem mapeador (M35-02): anomaly break, big energy wave, combat | `data-otservbr-global/monster/quests/heart_of_destruction/eradicator.lua` |
| eradicator2 | Eradicator | ataque sem mapeador (M35-02): anomaly break, big lifedrain wave, combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/eradicator2.lua` |
| eruption-of-destruction | Eruption of Destruction | aparência por item (lookTypeEx 391) — só outfit é resolvido; ataque sem mapeador (M35-02): eruption of destruction explosion, speed | `data-otservbr-global/monster/quests/ferumbras_ascension/traps/eruption_of_destruction.lua` |
| eshtaba-the-conjurer | Eshtaba the Conjurer | invocação (M35-02) | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/eshtaba_the_conjurer.lua` |
| eshtaba-the-conjurer-stop | Eshtaba The Conjurer | invocação (M35-02); speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/eshtaba_the_conjurer_stop.lua` |
| esmeralda | Esmeralda | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/killing_in_the_name_of/esmeralda.lua` |
| essence-of-malice | Essence of Malice | ataque sem mapeador (M35-02): combat, condition, ghastly dragon curse, speed | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/essence_of_malice.lua` |
| ethershreck | Ethershreck | ataque sem mapeador (M35-02): combat, condition, ghastly dragon curse; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/killing_in_the_name_of/ethershreck.lua` |
| evil-mastermind | Evil Mastermind | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/isle_of_evil/evil_mastermind.lua` |
| evil-prospector | Evil Prospector | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/evil_prospector.lua` |
| evil-sheep | Evil Sheep | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/mammals/evil_sheep.lua` |
| evil-sheep-lord | Evil Sheep Lord | ataque sem mapeador (M35-02): outfit; defesa com magia sem mapeador (M35-02): combat, outfit; invocação (M35-02) | `data-otservbr-global/monster/mammals/evil_sheep_lord.lua` |
| execowtioner | Execowtioner | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/execowtioner.lua` |
| exotic-bat | Exotic Bat | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/mammals/exotic_bat.lua` |
| exotic-cave-spider | Exotic Cave Spider | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/vermins/exotic_cave_spider.lua` |
| eye-of-the-seven | Eye of the Seven | ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_inquisition/eye_of_the_seven.lua` |
| eyeless-devourer | Eyeless Devourer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/vermins/eyeless_devourer.lua` |
| faceless-bane | Faceless Bane | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/the_dream_courts/bosses/faceless_bane.lua` |
| fahim-the-wise | Fahim the Wise | ataque sem mapeador (M35-02): combat, djinn electrify, drunk, outfit, speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/magicals/fahim_the_wise.lua` |
| falcon-knight | Falcon Knight | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/falcon_knight.lua` |
| falcon-paladin | Falcon Paladin | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/falcon_paladin.lua` |
| fallen-challenger | Fallen Challenger | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_first_dragon/bosses/fallen_challenger.lua` |
| fallen-moohtah-master-ghar | Fallen Mooh'tah Master Ghar | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/svargrond_arena/warlord/fallen_mooh'tah_master_ghar.lua` |
| faun | Faun | ataque sem mapeador (M35-02): combat, drunk; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/fey/faun.lua` |
| fazzrah | Fazzrah | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/killing_in_the_name_of/fazzrah.lua` |
| feeble-glooth-horror | Feeble Glooth Horror | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/hero_of_rathleton/feeble_glooth_horror.lua` |
| feral-sphinx | Feral Sphinx | ataque sem mapeador (M35-02): combat, fire wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/feral_sphinx.lua` |
| feral-werecrocodile | Feral Werecrocodile | ataque sem mapeador (M35-02): combat, werecrocodile fire ring; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/lycanthropes/feral_werecrocodile.lua` |
| fernfang | Fernfang | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, outfit, speed; invocação (M35-02) | `data-otservbr-global/monster/raids/fernfang.lua` |
| feroxa | Feroxa | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): feroxa summon, speed | `data-otservbr-global/monster/quests/the_curse_spreads/feroxa.lua` |
| feroxa2 | Feroxa | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): feroxa summon, outfit, speed | `data-otservbr-global/monster/quests/the_curse_spreads/feroxa2.lua` |
| feroxa3 | Feroxa | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): feroxa summon, speed | `data-otservbr-global/monster/quests/the_curse_spreads/feroxa3.lua` |
| feroxa4 | Feroxa | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): feroxa summon, speed | `data-otservbr-global/monster/quests/the_curse_spreads/feroxa4.lua` |
| feroxa5 | Feroxa | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): feroxa summon, speed | `data-otservbr-global/monster/quests/the_curse_spreads/feroxa5.lua` |
| ferumbras | Ferumbras | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/raids/ferumbras.lua` |
| ferumbras-essence | Ferumbras Essence | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/ferumbras_ascension/ferumbras_essence.lua` |
| ferumbras-mortal-shell | Ferumbras Mortal Shell | ataque sem mapeador (M35-02): combat, condition, ferumbras electrify, ferumbras soulfire; defesa com magia sem mapeador (M35-02): combat, invisible, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/ferumbras_mortal_shell.lua` |
| ferumbras-soul-splinter | Ferumbras Soul Splinter | ataque sem mapeador (M35-02): combat, condition, ferumbras electrify, ferumbras soulfire; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/ferumbras_soul_splinter.lua` |
| fetter | Fetter | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado), spectre drown; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/grave_danger/fetter.lua` |
| feverish-citizen | Feverish Citizen | ataque sem mapeador (M35-02): drunk; defesa com magia sem mapeador (M35-02): outfit | `data-otservbr-global/monster/humans/feverish_citizen.lua` |
| feversleep | Feversleep | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/magicals/feversleep.lua` |
| fiery-blood | Fiery Blood | ataque sem mapeador (M35-02): aggressivelavawave, firefield | `data-otservbr-global/monster/quests/dangerous_depth/fiery_blood.lua` |
| fiery-heart | Fiery Heart | aparência por item (lookTypeEx 391) — só outfit é resolvido; ataque sem mapeador (M35-02): aggressivelavawave; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/dangerous_depth/fiery_heart.lua` |
| filth-toad | Filth Toad | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/amphibics/filth_toad.lua` |
| fire-devil | Fire Devil | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/fire_devil.lua` |
| fire-elemental | Fire Elemental | ataque sem mapeador (M35-02): combat, firefield | `data-otservbr-global/monster/elementals/fire_elemental.lua` |
| fire-overlord | Fire Overlord | ataque sem mapeador (M35-02): combat, firefield, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/the_elemental_spheres/fire_overlord.lua` |
| firestarter | Firestarter | ataque sem mapeador (M35-02): combat, firefield | `data-otservbr-global/monster/humanoids/firestarter.lua` |
| flame-of-burning-hatred | Flame of Burning Hatred | aparência por item (lookTypeEx 34011) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/soul_war/normal_monsters/burning_hatred/flame_of_burning_hatred.lua` |
| flame-of-omrafir | Flame of Omrafir | ataque sem mapeador (M35-02): combat, firefield | `data-otservbr-global/monster/quests/roshamuul/flame_of_omrafir.lua` |
| flameborn | Flameborn | ataque sem mapeador (M35-02): fireball rune, hellspawn soulfire; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/killing_in_the_name_of/flameborn.lua` |
| flamethrower | Flamethrower | aparência por item (lookTypeEx 2190) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/pits_of_inferno/flamethrower.lua` |
| fleshcrawler | Fleshcrawler | ataque sem mapeador (M35-02): combat, condition, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/killing_in_the_name_of/fleshcrawler.lua` |
| flickering-spirit-elemental | Flickering Spirit Elemental | outfit 1840 fora do pacote 13.32 | `data-otservbr-global/monster/quests/the_elemental_spheres/flickering_spirit_elemental.lua` |
| flimsy-lost-soul | Flimsy Lost Soul | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/flimsy_lost_soul.lua` |
| floating-savant | Floating Savant | ataque sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/demons/floating_savant.lua` |
| fluffy | Fluffy | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/fluffy.lua` |
| flying-book | Flying Book | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/flying_book.lua` |
| foam-stalker | Foam Stalker | ataque sem mapeador (M35-02): combat, foamsplash; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/elementals/foam_stalker.lua` |
| force-field | Force Field | aparência por item (lookTypeEx 2128) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_secret_library/force_field.lua` |
| foreshock | Foreshock | ataque sem mapeador (M35-02): anomaly break, combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/foreshock.lua` |
| forest-fury | Forest Fury | ataque sem mapeador (M35-02): combat, forest fury skill reducer | `data-otservbr-global/monster/magicals/forest_fury.lua` |
| frazzlemaw | Frazzlemaw | ataque sem mapeador (M35-02): combat, condition, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/frazzlemaw.lua` |
| freakish-lost-soul | Freakish Lost Soul | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/freakish_lost_soul.lua` |
| freed-soul | Freed Soul | ataque sem mapeador (M35-02): freed soul spell | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/summons/freed_soul.lua` |
| freegoiz | Freegoiz | ataque sem mapeador (M35-02): combat, condition, speed, strength; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/bosses/freegoiz.lua` |
| frenzy | Frenzy | ataque sem mapeador (M35-02): big energy purple wave2, combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/frenzy.lua` |
| frost-dragon | Frost Dragon | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/dragons/frost_dragon.lua` |
| frost-dragon-hatchling | Frost Dragon Hatchling | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/dragons/frost_dragon_hatchling.lua` |
| frost-flower-asura | Frost Flower Asura | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/frost_flower_asura.lua` |
| frost-giant | Frost Giant | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/giants/frost_giant.lua` |
| frost-giantess | Frost Giantess | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/giants/frost_giantess.lua` |
| frost-servant | Frost Servant | defesa com magia sem mapeador (M35-02): hirintror summon | `data-otservbr-global/monster/raids/frost_servant.lua` |
| frozen-man | Frozen Man | aparência por item (lookTypeEx 7311) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/forgotten_knowledge/frozen_man.lua` |
| frozen-minion | Frozen Minion | ataque sem mapeador (M35-02): combat, frozen minion beam, frozen minion wave; defesa com magia sem mapeador (M35-02): frozen minion heal | `data-otservbr-global/monster/quests/forgotten_knowledge/frozen_minion.lua` |
| frozen-soul | Frozen Soul | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/frozen_soul.lua` |
| fruit-drop | Fruit Drop | outfit 1754 fora do pacote 13.32 | `data-otservbr-global/monster/fey/fruit_drop.lua` |
| fungosaurus | Fungosaurus | ataque sem mapeador (M35-02): combat, fear, root | `data-otservbr-global/monster/reptiles/fungosaurus.lua` |
| furious-scorpion | Furious Scorpion | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/furious_scorpion.lua` |
| furious-troll | Furious Troll | invocação (M35-02) | `data-otservbr-global/monster/humanoids/furious_troll.lua` |
| fury | Fury | ataque sem mapeador (M35-02): combat, fury skill reducer, speed; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/demons/fury.lua` |
| fury-of-the-emperor | Fury of the Emperor | ataque sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/wrath_of_the_emperor/fury_of_the_emperor.lua` |
| furyosa | Furyosa | ataque sem mapeador (M35-02): combat, fury skill reducer; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/raids/furyosa.lua` |
| gaffir | Gaffir | ataque sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/bosses/gaffir.lua` |
| gargoyle | Gargoyle | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/gargoyle.lua` |
| gazer | Gazer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/gazer.lua` |
| gazer-spectre | Gazer Spectre | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/gazer_spectre.lua` |
| gazharagoth | Gaz'Haragoth | ataque sem mapeador (M35-02): combat, gaz'haragoth death, gaz'haragoth iceball, gaz'haragoth paralyze, gaz'haragoth summon, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/roshamuul/gaz'haragoth.lua` |
| gelidrazah-the-frozen | Gelidrazah the Frozen | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_first_dragon/bosses/gelidrazah_the_frozen.lua` |
| general-murius | General Murius | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/bosses/general_murius.lua` |
| generator | Generator | aparência por item (lookTypeEx 20710) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_dream_courts/generator.lua` |
| ghastly-dragon | Ghastly Dragon | ataque sem mapeador (M35-02): combat, condition, ghastly dragon curse, ghastly dragon wave, speed | `data-otservbr-global/monster/dragons/ghastly_dragon.lua` |
| ghazbaran | Ghazbaran | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/raids/ghazbaran.lua` |
| ghost | Ghost | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/ghost.lua` |
| ghoul | Ghoul | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/ghoul.lua` |
| ghoulish-hyaena | Ghoulish Hyaena | ataque sem mapeador (M35-02): ghoulish hyaena wave, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/mammals/ghoulish_hyaena.lua` |
| ghulosh | Ghulosh | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/bosses/ghulosh.lua` |
| ghulosh-deathgaze | Ghulosh' Deathgaze | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/ghulosh'_deathgaze.lua` |
| giant-spider | Giant Spider | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), poisonfield; defesa com magia sem mapeador (M35-02): speed; invocação (M35-02) | `data-otservbr-global/monster/vermins/giant_spider.lua` |
| gingerbread-man | Gingerbread Man | outfit 1738 fora do pacote 13.32 | `data-otservbr-global/monster/constructs/gingerbread_men.lua` |
| girtablilu-warrior | Girtablilu Warrior | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/girtablilu_warrior.lua` |
| gladiator | Gladiator | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/humans/gladiator.lua` |
| glitterscale | Glitterscale | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/glitterscale.lua` |
| glooth-anemone | Glooth Anemone | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, glooth anemone summon | `data-otservbr-global/monster/plants/glooth_anemone.lua` |
| glooth-bandit | Glooth Bandit | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/glooth_bandit.lua` |
| glooth-battery | Glooth Battery | aparência por item (lookTypeEx 20710) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/raids/glooth_battery.lua` |
| glooth-blob | Glooth Blob | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado); invocação (M35-02) | `data-otservbr-global/monster/slimes/glooth_blob.lua` |
| glooth-bomb | Glooth Bomb | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/raids/glooth_bomb.lua` |
| glooth-brigand | Glooth Brigand | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/glooth_brigand.lua` |
| glooth-fairy | Glooth Fairy | ataque sem mapeador (M35-02): combat, glooth fairy skill reducer, speed, war golem skill reducer; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/raids/glooth_fairy.lua` |
| glooth-generator | Glooth-Generator | aparência por item (lookTypeEx 20710) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): glooth-generator summon; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/hero_of_rathleton/glooth-generator.lua` |
| glooth-golem | Glooth Golem | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), war golem electrify, war golem skill reducer; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/constructs/glooth_golem.lua` |
| glooth-horror | Glooth Horror | ataque sem mapeador (M35-02): combat, drunk; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/hero_of_rathleton/glooth_horror.lua` |
| glooth-masher | Glooth Masher | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), war golem electrify, war golem skill reducer; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/hero_of_rathleton/glooth_masher.lua` |
| glooth-powered-minotaur | Glooth Powered Minotaur | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/glooth_powered_minotaur.lua` |
| glooth-slasher | Glooth Slasher | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), war golem electrify, war golem skill reducer; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/hero_of_rathleton/glooth_slasher.lua` |
| glooth-trasher | Glooth Trasher | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), war golem electrify, war golem skill reducer; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/hero_of_rathleton/glooth_trasher.lua` |
| gnomevil | Gnomevil | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/bigfoots_burden/bosses/gnomevil.lua` |
| gnorre-chyllson | Gnorre Chyllson | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/svargrond_arena/warlord/gnorre_chyllson.lua` |
| goblin | Goblin | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/goblin.lua` |
| goblin-assassin | Goblin Assassin | ataque sem mapeador (M35-02): combat, drunk; defesa com magia sem mapeador (M35-02): invisible, speed | `data-otservbr-global/monster/humanoids/goblin_assassin.lua` |
| goblin-leader | Goblin Leader | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/goblin_leader.lua` |
| goblin-scavenger | Goblin Scavenger | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/goblin_scavenger.lua` |
| goggle-cake | Goggle Cake | outfit 1740 fora do pacote 13.32; ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/constructs/goggle_cake.lua` |
| golden-servant | Golden Servant | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/constructs/golden_servant.lua` |
| golden-servant-replica | Golden Servant Replica | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/constructs/golden_servant_replica.lua` |
| goldhanded-cultist | Goldhanded Cultist | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/cults_of_tibia/goldhanded_cultist.lua` |
| golgordan | Golgordan | ataque sem mapeador (M35-02): combat, condition | `data-otservbr-global/monster/quests/the_inquisition/golgordan.lua` |
| gore-horn | Gore Horn | ataque sem mapeador (M35-02): combat, root | `data-otservbr-global/monster/mammals/gore_horn.lua` |
| gorerilla | Gorerilla | ataque sem mapeador (M35-02): combat, gorerilla large ring, gorerilla small ring | `data-otservbr-global/monster/mammals/gorerilla.lua` |
| gorger-inferniarch | Gorger Inferniarch | outfit 1797 fora do pacote 13.32; ataque sem mapeador (M35-02): combat, extended fire chain; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/gorger_inferniarch.lua` |
| gorgo | Gorgo | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), outfit, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/killing_in_the_name_of/gorgo.lua` |
| gorzindel | Gorzindel | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/the_secret_library/bosses/gorzindel.lua` |
| goshnars-cruelty | Goshnar's Cruelty | Lua não avaliável como dado: "SoulWarQuest.goshnarsCrueltyWaveInterval" sem valor conhecido (auto-referência não resolvida) (linha 107) | `data-otservbr-global/monster/quests/soul_war/goshnars_cruelty.lua` |
| goshnars-greed | Goshnar's Greed | ataque sem mapeador (M35-02): combat, singlecloudchain; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/soul_war/goshnars_greed.lua` |
| goshnars-hatred | Goshnar's Hatred | ataque sem mapeador (M35-02): combat, singlecloudchain; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/soul_war/goshnars_hatred.lua` |
| goshnars-malice | Goshnar's Malice | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/soul_war/goshnars_malice.lua` |
| goshnars-megalomania-blue | Goshnar's Megalomania | ataque sem mapeador (M35-02): combat, megalomania blue; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/soul_war/goshnar's_megalomania_blue.lua` |
| goshnars-megalomania-green | Goshnar's Megalomania Green | Lua não avaliável como dado: "SoulWarQuest.goshnarsCrueltyWaveInterval" sem valor conhecido (auto-referência não resolvida) (linha 112) | `data-otservbr-global/monster/quests/soul_war/goshnar's_megalomania_green.lua` |
| goshnars-megalomania-purple | Goshnar's Megalomania Purple | Lua não avaliável como dado: "SoulWarQuest.goshnarsCrueltyWaveInterval" sem valor conhecido (auto-referência não resolvida) (linha 71) | `data-otservbr-global/monster/quests/soul_war/goshnar's_megalomania_purple.lua` |
| goshnars-spite | Goshnar's Spite | ataque sem mapeador (M35-02): combat, singlecloudchain, soulwars fear; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/soul_war/goshnars_spite.lua` |
| gozzler | Gozzler | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/demons/gozzler.lua` |
| grand-canon-dominus | Grand Canon Dominus | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/the_secret_library/bosses/grand_canon_dominus.lua` |
| grand-chaplain-gaunder | Grand Chaplain Gaunder | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/the_secret_library/bosses/grand_chaplain_gaunder.lua` |
| grand-commander-soeren | Grand Commander Soeren | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/bosses/grand_commander_soeren.lua` |
| grand-master-oberon | Grand Master Oberon | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/the_secret_library/bosses/grand_master_oberon.lua` |
| grand-master-oberon-functions | grand-master-oberon-functions | sem Game.createMonsterType("…") | `data-otservbr-global/monster/quests/the_secret_library/bosses/grand_master_oberon_functions.lua` |
| grand-mother-foulscale | Grand Mother Foulscale | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/raids/grand_mother_foulscale.lua` |
| grandfather-tridian | Grandfather Tridian | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/bosses/grandfather_tridian.lua` |
| grave-guard | Grave Guard | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/grave_guard.lua` |
| grave-robber | Grave Robber | ataque sem mapeador (M35-02): condition | `data-otservbr-global/monster/humans/grave_robber.lua` |
| gravedigger | Gravedigger | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/undeads/gravedigger.lua` |
| gravelord-oshuran | Gravelord Oshuran | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/bosses/gravelord_oshuran.lua` |
| greater-canopic-jar | Greater Canopic Jar | defesa com magia sem mapeador (M35-02): combat; invocação (M35-02); speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/dark_trails/greater_canopic_jar.lua` |
| greater-splinter-of-madness | Greater Splinter of Madness | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/soul_war/normal_monsters/megalomania_room/greater_splinter_of_madness.lua` |
| greed | Greed | ataque sem mapeador (M35-02): anomaly break, combat | `data-otservbr-global/monster/quests/heart_of_destruction/greed.lua` |
| greedbeast | Greedbeast | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/soul_war/greedbeast.lua` |
| green-djinn | Green Djinn | ataque sem mapeador (M35-02): combat, djinn cancel invisibility, djinn electrify, drunk, outfit | `data-otservbr-global/monster/magicals/green_djinn.lua` |
| grim-reaper | Grim Reaper | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/undeads/grim_reaper.lua` |
| grimeleech | Grimeleech | Lua não avaliável como dado: identificador "COMBAT_LIFEDRAINDAMAGE" sem constante conhecida (linha 116) | `data-otservbr-global/monster/demons/grimeleech.lua` |
| grimgor-guteater | Grimgor Guteater | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/svargrond_arena/scrapper/grimgor_guteater.lua` |
| groam | Groam | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/groam.lua` |
| grorlam | Grorlam | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/raids/grorlam.lua` |
| grynch-clan-goblin | Grynch Clan Goblin | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/event_creatures/grynch_clan_goblin.lua` |
| gryphon | Gryphon | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/gryphon.lua` |
| guard-captain-quaid | Guard Captain Quaid | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/guard_captain_quaid.lua` |
| guardian-of-tales | Guardian of Tales | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/guardian_of_tales.lua` |
| guilt | Guilt | ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/ferumbras_ascension/traps/guilt.lua` |
| guzzlemaw | Guzzlemaw | ataque sem mapeador (M35-02): combat, condition, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/guzzlemaw.lua` |
| hacker | Hacker | defesa com magia sem mapeador (M35-02): outfit, speed | `data-otservbr-global/monster/event_creatures/hacker.lua` |
| hairman-the-huge | Hairman the Huge | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/bosses/hairman_the_huge.lua` |
| hand-of-cursed-fate | Hand of Cursed Fate | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/undeads/hand_of_cursed_fate.lua` |
| hardened-usurper-archer | Hardened Usurper Archer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/hardened_usurper_archer.lua` |
| hardened-usurper-knight | Hardened Usurper Knight | ataque sem mapeador (M35-02): combat, singlecloudchain; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/hardened_usurper_knight.lua` |
| hardened-usurper-warlock | Hardened Usurper Warlock | ataque sem mapeador (M35-02): combat, singledeathchain, singleicechain | `data-otservbr-global/monster/humans/hardened_usurper_warlock.lua` |
| harpy | Harpy | ataque sem mapeador (M35-02): combat, energy chain, energy ring | `data-otservbr-global/monster/reptiles/harpy.lua` |
| hateful-soul | Hateful Soul | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/soul_war/normal_monsters/hateful_soul.lua` |
| haunted-dragon | Haunted Dragon | ataque sem mapeador (M35-02): combat, undead dragon curse; defesa com magia sem mapeador (M35-02): combat; Bestiário sem race | `data-otservbr-global/monster/quests/the_first_dragon/haunted_dragon.lua` |
| haunted-treeling | Haunted Treeling | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/plants/haunted_treeling.lua` |
| haunter | Haunter | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/the_new_frontier/haunter.lua` |
| hazardous-phantom | Hazardous Phantom | ataque sem mapeador (M35-02): combat, ice chain, soulwars fear | `data-otservbr-global/monster/undeads/hazardous_phantom.lua` |
| headpecker | Headpecker | ataque sem mapeador (M35-02): combat, headpecker explosion | `data-otservbr-global/monster/birds/headpecker.lua` |
| hellfire-fighter | Hellfire Fighter | ataque sem mapeador (M35-02): combat, firefield, hellfire fighter soulfire | `data-otservbr-global/monster/demons/hellfire_fighter.lua` |
| hellflayer | Hellflayer | ataque sem mapeador (M35-02): choking fear drown, combat, melee (condição/tipo/chance/duplicado), warlock skill reducer; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/hellflayer.lua` |
| hellgorak | Hellgorak | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_inquisition/hellgorak.lua` |
| hellhound | Hellhound | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/demons/hellhound.lua` |
| hellhunter-inferniarch | Hellhunter Inferniarch | outfit 1793 fora do pacote 13.32; ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/hellhunter_inferniarch.lua` |
| hellspawn | Hellspawn | ataque sem mapeador (M35-02): combat, hellspawn soulfire; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/demons/hellspawn.lua` |
| hemming | Hemming | ataque sem mapeador (M35-02): combat, outfit, werewolf skill reducer; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/killing_in_the_name_of/hemming.lua` |
| heoni | Heoni | ataque sem mapeador (M35-02): condition, drunk, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/bosses/heoni.lua` |
| herald-of-gloom | Herald of Gloom | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): invisible, outfit, speed | `data-otservbr-global/monster/demons/herald_of_gloom.lua` |
| hero | Hero | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/hero.lua` |
| hide | Hide | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/killing_in_the_name_of/hide.lua` |
| hideous-fungus | Hideous Fungus | ataque sem mapeador (M35-02): combat, condition, drunk; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/plants/hideous_fungus.lua` |
| high-voltage-elemental | High Voltage Elemental | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/elementals/high_voltage_elemental.lua` |
| hirintror | Hirintror | ataque sem mapeador (M35-02): combat, hirintror freeze, hirintror skill reducer, ice golem paralyze; defesa com magia sem mapeador (M35-02): hirintror summon | `data-otservbr-global/monster/raids/hirintror.lua` |
| hive-overseer | Hive Overseer | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/vermins/hive_overseer.lua` |
| honey-elemental | Honey Elemental | outfit 1733 fora do pacote 13.32; ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/elementals/honey_elemental.lua` |
| honour-guard | Honour Guard | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/honour_guard.lua` |
| horadron | Horadron | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/roshamuul/horadron.lua` |
| horestis | Horestis | ataque sem mapeador (M35-02): combat, condition, drunk, speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/ancient_tombs/horestis.lua` |
| horrible-dream | Horrible Dream | ataque sem mapeador (M35-02): combat, death blob curse; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/the_dream_courts/horrible_dream.lua` |
| hot-dog | Hot Dog | ataque sem mapeador (M35-02): combat, hot dog wave | `data-otservbr-global/monster/mammals/hot_dog.lua` |
| hulking-carnisylvan | Hulking Carnisylvan | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/hulking_carnisylvan.lua` |
| hulking-prehemoth | Hulking Prehemoth | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/giants/hulking_prehemoth.lua` |
| humongous-fungus | Humongous Fungus | ataque sem mapeador (M35-02): combat, condition, poisonfield; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/plants/humongous_fungus.lua` |
| humorless-fungus | Humorless Fungus | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/quests/bigfoots_burden/humorless_fungus.lua` |
| hunter | Hunter | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/hunter.lua` |
| hydra | Hydra | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/dragons/hydra.lua` |
| ice-dragon | Ice Dragon | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_first_dragon/ice_dragon.lua` |
| ice-golem | Ice Golem | ataque sem mapeador (M35-02): combat, ice golem skill reducer, speed | `data-otservbr-global/monster/constructs/ice_golem.lua` |
| ice-overlord | Ice Overlord | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_elemental_spheres/ice_overlord.lua` |
| ice-witch | Ice Witch | ataque sem mapeador (M35-02): combat, outfit, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/ice_witch.lua` |
| icecold-book | Icecold Book | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/icecold_book.lua` |
| ichgahal | Ichgahal | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/bosses/ichgahal.lua` |
| icicle | Icicle | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): icicle heal; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/forgotten_knowledge/icicle.lua` |
| iks-ahpututu | Iks Ahpututu | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/iks_ahpututu.lua` |
| iks-aucar | Iks Aucar | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/iks_aucar.lua` |
| iks-chuka | Iks Chuka | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/iks_chuka.lua` |
| iks-churrascan | Iks Churrascan | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/iks_churrascan.lua` |
| iks-pututu | Iks Pututu | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/iks_pututu.lua` |
| iks-yapunac | Iks Yapunac | ataque sem mapeador (M35-02): combat, iksyapunacwave | `data-otservbr-global/monster/undeads/iks_yapunac.lua` |
| imp-intruder | Imp Intruder | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/imp_intruder.lua` |
| incineron | Incineron | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_new_frontier/incineron.lua` |
| incredibly-old-witch | Incredibly Old Witch | ataque sem mapeador (M35-02): outfit | `data-otservbr-global/monster/bosses/incredibly_old_witch.lua` |
| infected-weeper | Infected Weeper | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): invisible; invocação (M35-02) | `data-otservbr-global/monster/constructs/infected_weeper.lua` |
| infernal-demon | Infernal Demon | ataque sem mapeador (M35-02): combat, death chain | `data-otservbr-global/monster/quests/soul_war/normal_monsters/infernal_demon.lua` |
| infernal-frog | Infernal Frog | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/amphibics/infernal_frog.lua` |
| infernal-phantom | Infernal Phantom | ataque sem mapeador (M35-02): combat, extended fire chain | `data-otservbr-global/monster/quests/soul_war/normal_monsters/infernal_phantom.lua` |
| infernalist | Infernalist | ataque sem mapeador (M35-02): combat, firefield; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/humans/infernalist.lua` |
| infernatil | Infernatil | ataque sem mapeador (M35-02): combat, condition, firefield; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/bosses/infernatil.lua` |
| ink-blob | Ink Blob | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/slimes/ink_blob.lua` |
| inky | Inky | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), quara constrictor electrify | `data-otservbr-global/monster/quests/in_service_of_yalahar/inky.lua` |
| insane-siren | Insane Siren | ataque sem mapeador (M35-02): combat, sparks chain | `data-otservbr-global/monster/humanoids/insane_siren.lua` |
| insect-swarm | Insect Swarm | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/vermins/insect_swarm.lua` |
| insectoid-scout | Insectoid Scout | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/vermins/insectoid_scout.lua` |
| insectoid-worker | Insectoid Worker | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/vermins/insectoid_worker.lua` |
| instable-breach-brood | Instable Breach Brood | ataque sem mapeador (M35-02): breach brood reducer, combat | `data-otservbr-global/monster/extra_dimensional/instable_breach_brood.lua` |
| instable-sparkion | Instable Sparkion | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/extra_dimensional/instable_sparkion.lua` |
| invading-demon | Invading Demon | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/invading_demon.lua` |
| irgix-the-flimsy | Irgix The Flimsy | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/feaster_of_souls/irgix_the_flimsy.lua` |
| iron-servant | Iron Servant | ataque sem mapeador (M35-02): combat, drunk | `data-otservbr-global/monster/constructs/iron_servant.lua` |
| iron-servant-replica | Iron Servant Replica | ataque sem mapeador (M35-02): combat, drunk | `data-otservbr-global/monster/constructs/iron_servant_replica.lua` |
| ironblight | Ironblight | ataque sem mapeador (M35-02): combat, condition, speed; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/elementals/ironblight.lua` |
| izcandar-champion-of-summer | Izcandar Champion of Summer | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/izcandar_champion_of_summer.lua` |
| izcandar-champion-of-winter | Izcandar Champion of Winter | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/izcandar_champion_of_winter.lua` |
| izcandar-the-banished | Izcandar the Banished | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/the_dream_courts/bosses/izcandar_the_banished.lua` |
| jagged-earth-elemental | Jagged Earth Elemental | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_elemental_spheres/jagged_earth_elemental.lua` |
| jailer | Jailer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/jailer.lua` |
| jaul | Jaul | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/liquid_black/jaul.lua` |
| jellyfish | Jellyfish | defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/aquatics/jellyfish.lua` |
| juggernaut | Juggernaut | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/demons/juggernaut.lua` |
| jungle-moa | Jungle Moa | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/birds/jungle_moa.lua` |
| juvenile-bashmu | Juvenile Bashmu | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/juvenile_bashmu.lua` |
| juvenile-cyclops | Juvenile Cyclops | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/dawnport/juvenile_cyclops.lua` |
| kalyassa | Kalyassa | ataque sem mapeador (M35-02): combat, firefield; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/the_first_dragon/bosses/kalyassa.lua` |
| katex-blood-tongue | Katex Blood Tongue | ataque sem mapeador (M35-02): combat, katex deathT, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): speed; invocação (M35-02) | `data-otservbr-global/monster/quests/ancient_feud/katex_blood_tongue.lua` |
| kerberos | Kerberos | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/killing_in_the_name_of/kerberos.lua` |
| kesar | Kesar | ataque sem mapeador (M35-02): combat, singlecloudchain, singledeathchain, singleicechain; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_order_of_lion/bosses/kesar.lua` |
| killer-caiman | Killer Caiman | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/reptiles/killer_caiman.lua` |
| killer-rabbit | Killer Rabbit | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): invisible, speed; invocação (M35-02) | `data-otservbr-global/monster/mammals/killer_rabbit.lua` |
| king-zelos | King Zelos | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/bosses/king_zelos.lua` |
| knights-apparition | Knight's Apparition | ataque sem mapeador (M35-02): combat, ice chain | `data-otservbr-global/monster/quests/soul_war/normal_monsters/knight's_apparition.lua` |
| knowledge-elemental | Knowledge Elemental | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/elementals/knowledge_elemental.lua` |
| knowledge-raider | Knowledge Raider | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/the_secret_library/knowledge_raider.lua` |
| kollos | Kollos | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/vermins/kollos.lua` |
| kongra | Kongra | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/mammals/kongra.lua` |
| koshei-the-deathless | Koshei the Deathless | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/bosses/koshei_the_deathless.lua` |
| kraknaknork | Kraknaknork | ataque sem mapeador (M35-02): combat, kraknaknork explosion wave, kraknaknork ice wave, kraknaknork poison wave, melee (condição/tipo/chance/duplicado), outfit, speed; invocação (M35-02) | `data-otservbr-global/monster/bosses/kraknaknork.lua` |
| kraknaknorks-demon | Kraknaknork's Demon | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/kraknaknork's_demon.lua` |
| kreebosh-the-exile | Kreebosh the Exile | ataque sem mapeador (M35-02): combat, drunk, outfit, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/svargrond_arena/scrapper/kreebosh_the_exile.lua` |
| kroazur | Kroazur | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/bosses/kroazur.lua` |
| lady-tenebris | Lady Tenebris | ataque sem mapeador (M35-02): combat, tenebris summon, tenebris ultimate; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/forgotten_knowledge/bosses/lady_tenebris.lua` |
| ladybug | Ladybug | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/vermins/ladybug.lua` |
| lamassu | Lamassu | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/lamassu.lua` |
| lancer-beetle | Lancer Beetle | ataque sem mapeador (M35-02): combat, condition, lancer beetle curse, poisonfield; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/vermins/lancer_beetle.lua` |
| larva | Larva | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/vermins/larva.lua` |
| latrivan | Latrivan | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_inquisition/latrivan.lua` |
| lava-creature | Lava Creature | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/primal_ordeal_quest/lava_creature.lua` |
| lava-golem | Lava Golem | ataque sem mapeador (M35-02): combat, lava golem soulfire, speed | `data-otservbr-global/monster/constructs/lava_golem.lua` |
| lava-lurker | Lava Lurker | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/elementals/lava_lurker.lua` |
| lava-lurker-attendant | Lava Lurker Attendant | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/dangerous_depth/lava_lurker_attendant.lua` |
| lavafungus | Lavafungus | ataque sem mapeador (M35-02): combat, lavafungus ring, lavafungus x wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/vermins/lavafungus.lua` |
| lavaworm | Lavaworm | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/vermins/lavaworm.lua` |
| leaf-golem | Leaf Golem | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/plants/leaf_golem.lua` |
| leiden | Leiden | invocação (M35-02) | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/leiden.lua` |
| lesser-fire-devil | Lesser Fire Devil | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/dawnport/lesser_fire_devil.lua` |
| lesser-splinter-of-madness | Lesser Splinter of Madness | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/soul_war/normal_monsters/megalomania_room/lesser_splinter_of_madness.lua` |
| lesser-swarmer | Lesser Swarmer | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/vermins/lesser_swarmer.lua` |
| lethal-lissy | Lethal Lissy | defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/raids/lethal_lissy.lua` |
| leviathan | Leviathan | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/killing_in_the_name_of/leviathan.lua` |
| librarian | Librarian | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/librarian.lua` |
| lich | Lich | ataque sem mapeador (M35-02): combat, condition, speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/undeads/lich.lua` |
| liodile | Liodile | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/reptiles/liodile.lua` |
| lion-archer | Lion Archer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/lion_archer.lua` |
| lion-commander | Lion Commander | ataque sem mapeador (M35-02): combat, singlecloudchain, singledeathchain; invocação (M35-02) | `data-otservbr-global/monster/quests/the_order_of_lion/lion_commander.lua` |
| lion-knight | Lion Knight | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/lion_knight.lua` |
| lion-warlock | Lion Warlock | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/lion_warlock.lua` |
| lisa | Lisa | ataque sem mapeador (M35-02): combat, effect, lisa paralyze, lisa skill reducer, lisa wave, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): lisa heal, lisa summon | `data-otservbr-global/monster/bosses/lisa.lua` |
| lizard-abomination | Lizard Abomination | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/wrath_of_the_emperor/lizard_abomination.lua` |
| lizard-chosen | Lizard Chosen | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/reptiles/lizard_chosen.lua` |
| lizard-dragon-priest | Lizard Dragon Priest | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/reptiles/lizard_dragon_priest.lua` |
| lizard-high-guard | Lizard High Guard | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/reptiles/lizard_high_guard.lua` |
| lizard-legionnaire | Lizard Legionnaire | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/reptiles/lizard_legionnaire.lua` |
| lizard-magistratus | Lizard Magistratus | ataque sem mapeador (M35-02): lizard magistratus curse; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/reptiles/lizard_magistratus.lua` |
| lizard-noble | Lizard Noble | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/reptiles/lizard_noble.lua` |
| lizard-sentinel | Lizard Sentinel | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/reptiles/lizard_sentinel.lua` |
| lizard-snakecharmer | Lizard Snakecharmer | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/reptiles/lizard_snakecharmer.lua` |
| lizard-zaogun | Lizard Zaogun | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/reptiles/lizard_zaogun.lua` |
| lloyd | Lloyd | ataque sem mapeador (M35-02): combat, lloyd wave, lloyd wave2, lloyd wave3; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/forgotten_knowledge/bosses/lloyd.lua` |
| lokathmor | Lokathmor | ataque sem mapeador (M35-02): combat, condition; invocação (M35-02) | `data-otservbr-global/monster/quests/the_secret_library/bosses/lokathmor.lua` |
| lokathmor-stuck | Lokathmor Stuck | ataque sem mapeador (M35-02): combat, condition; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_secret_library/lokathmor_stuck.lua` |
| lord-azaram | Lord Azaram | ataque sem mapeador (M35-02): combat, lord azaram wave; invocação (M35-02) | `data-otservbr-global/monster/quests/grave_danger/bosses/lord_azaram.lua` |
| lord-of-the-elements | Lord of the Elements | defesa com magia sem mapeador (M35-02): combat, outfit; invocação (M35-02) | `data-otservbr-global/monster/quests/the_elemental_spheres/lord_of_the_elements.lua` |
| lost-basher | Lost Basher | ataque sem mapeador (M35-02): combat, drunk, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/lost_basher.lua` |
| lost-berserker | Lost Berserker | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/humanoids/lost_berserker.lua` |
| lost-exile | Lost Exile | ataque sem mapeador (M35-02): combat, drunk, sudden death rune; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/lost_exile.lua` |
| lost-husher | Lost Husher | ataque sem mapeador (M35-02): combat, drunk; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/humanoids/lost_husher.lua` |
| lost-soul | Lost Soul | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/undeads/lost_soul.lua` |
| lost-thrower | Lost Thrower | ataque sem mapeador (M35-02): combat, drunk; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/humanoids/lost_thrower.lua` |
| lost-time | Lost Time | aparência por item (lookTypeEx 24963) — só outfit é resolvido; ataque sem mapeador (M35-02): white shade paralyze | `data-otservbr-global/monster/quests/forgotten_knowledge/lost_time.lua` |
| lovely-frazzlemaw | Lovely Frazzlemaw | ataque sem mapeador (M35-02): combat, condition, frazzlemaw paralyze; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/ferumbras_ascension/lovely/lovely_frazzlemaw.lua` |
| lovely-scorpion | Lovely Scorpion | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/ferumbras_ascension/lovely/lovely_scorpion.lua` |
| lovely-snake | Lovely Snake | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/ferumbras_ascension/lovely/lovely_snake.lua` |
| lovely-souleater | Lovely Souleater | ataque sem mapeador (M35-02): combat, souleater drown, souleater wave; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/quests/ferumbras_ascension/lovely/lovely_souleater.lua` |
| lovely-yielothax | Lovely Yielothax | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/ferumbras_ascension/lovely/lovely_yielothax.lua` |
| lucifuga-aranea | Lucifuga Aranea | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/the_dream_courts/lucifuga_aranea.lua` |
| lumbering-carnivor | Lumbering Carnivor | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/lumbering_carnivor.lua` |
| mad-mage | Mad Mage | ataque sem mapeador (M35-02): combat, firefield; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/bosses/mad_mage.lua` |
| mad-scientist | Mad Scientist | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/mad_scientist.lua` |
| mad-technomancer | Mad Technomancer | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/mad_technomancer.lua` |
| madareth | Madareth | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_inquisition/madareth.lua` |
| magical-sphere | Magical Sphere | speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/grave_danger/magical_sphere.lua` |
| magma-bubble | Magma Bubble | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/primal_ordeal_quest/magma_bubble.lua` |
| magma-crawler | Magma Crawler | ataque sem mapeador (M35-02): combat, magma crawler soulfire, magma crawler wave, soulfire rune, speed; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/constructs/magma_crawler.lua` |
| magma-crystal | Magma Crystal | aparência por item (lookTypeEx 21572) — só outfit é resolvido; defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/primal_ordeal_quest/magma_crystal.lua` |
| magnor-mournbringer | Magnor Mournbringer | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/magnor_mournbringer.lua` |
| mahrdis | Mahrdis | ataque sem mapeador (M35-02): combat, condition, firefield, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/ancient_tombs/mahrdis.lua` |
| makara | Makara | ataque sem mapeador (M35-02): combat, makarawatersplash | `data-otservbr-global/monster/amphibics/makara.lua` |
| makeshift-home | Makeshift Home | aparência por item (lookTypeEx 27366) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/dangerous_depth/makeshift_home.lua` |
| malicious-minion | Malicious Minion | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/malicious_minion.lua` |
| malicious-soul | Malicious Soul | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/soul_war/malicious_soul.lua` |
| malkhar-deathbringer | Malkhar Deathbringer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/malkhar_deathbringer.lua` |
| malkhar-deathbringer-stop | Malkhar Deathbringer | ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/malkhar_deathbringer_stop.lua` |
| malofur-mangrinder | Malofur Mangrinder | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_dream_courts/bosses/malofur_mangrinder.lua` |
| man-in-the-cave | Man in the Cave | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/raids/man_in_the_cave.lua` |
| manta-ray | Manta Ray | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/aquatics/manta_ray.lua` |
| manticore | Manticore | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/manticore.lua` |
| mantosaurus | Mantosaurus | ataque sem mapeador (M35-02): combat, mantosaurus ring | `data-otservbr-global/monster/reptiles/mantosaurus.lua` |
| many-faces | Many Faces | ataque sem mapeador (M35-02): combat, destroy magic walls, extended holy chain | `data-otservbr-global/monster/quests/soul_war/normal_monsters/many_faces.lua` |
| marid | Marid | ataque sem mapeador (M35-02): combat, djinn electrify, drunk, outfit, speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/magicals/marid.lua` |
| marsh-stalker | Marsh Stalker | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/birds/marsh_stalker.lua` |
| massacre | Massacre | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/pits_of_inferno/massacre.lua` |
| massive-earth-elemental | Massive Earth Elemental | ataque sem mapeador (M35-02): combat, condition, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/elementals/massive_earth_elemental.lua` |
| massive-energy-elemental | Massive Energy Elemental | ataque sem mapeador (M35-02): combat, massive energy elemental electrify; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/elementals/massive_energy_elemental.lua` |
| massive-fire-elemental | Massive Fire Elemental | ataque sem mapeador (M35-02): combat, firefield, massive fire elemental soulfire | `data-otservbr-global/monster/elementals/massive_fire_elemental.lua` |
| massive-water-elemental | Massive Water Elemental | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/elementals/massive_water_elemental.lua` |
| mawhawk | Mawhawk | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/raids/mawhawk.lua` |
| maxxenius | Maxxenius | ataque sem mapeador (M35-02): energy beam, energy wave | `data-otservbr-global/monster/quests/the_dream_courts/bosses/maxxenius.lua` |
| mazoran | Mazoran | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, mazoran fire, speed | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/mazoran.lua` |
| mazzinor | Mazzinor | ataque sem mapeador (M35-02): berserk, combat, divine missile | `data-otservbr-global/monster/quests/the_secret_library/bosses/mazzinor.lua` |
| meadow-strider | Meadow Strider | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/dawnport/meadow_strider.lua` |
| mean-lost-soul | Mean Lost Soul | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/mean_lost_soul.lua` |
| mean-maw | Mean Maw | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/soul_war/mean_maw.lua` |
| mean-minion | Mean Minion | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/mean_minion.lua` |
| meandering-mushroom | Meandering Mushroom | ataque sem mapeador (M35-02): combat, largeblackring | `data-otservbr-global/monster/quests/rotten_blood/meandering_mushroom.lua` |
| medusa | Medusa | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), outfit, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/medusa.lua` |
| mega-dragon | Mega Dragon | ataque sem mapeador (M35-02): combat, death chain | `data-otservbr-global/monster/dragons/mega_dragon.lua` |
| megasylvan-yselda | Megasylvan Yselda | aparência por item (lookTypeEx 36928) — só outfit é resolvido; ataque sem mapeador (M35-02): combat, earth beamMY, mana leechMY; invocação (M35-02); speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/adventures_of_galthen/megasylvan_yselda.lua` |
| melting-frozen-horror | Melting Frozen Horror | ataque sem mapeador (M35-02): combat, hirintror freeze, hirintror skill reducer, ice golem paralyze; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/forgotten_knowledge/bosses/melting_frozen_horror.lua` |
| memory-of-a-banshee | Memory of a Banshee | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_banshee.lua` |
| memory-of-a-book | Memory of a Book | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_book.lua` |
| memory-of-a-carnisylvan | Memory of a Carnisylvan | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_carnisylvan.lua` |
| memory-of-a-faun | Memory of a Faun | ataque sem mapeador (M35-02): combat, drunk; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_faun.lua` |
| memory-of-a-frazzlemaw | Memory of a Frazzlemaw | ataque sem mapeador (M35-02): combat, condition, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_frazzlemaw.lua` |
| memory-of-a-fungus | Memory of a Fungus | ataque sem mapeador (M35-02): combat, condition, poisonfield; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_fungus.lua` |
| memory-of-a-golem | Memory of a Golem | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), war golem skill reducer; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_golem.lua` |
| memory-of-a-hero | Memory of a Hero | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_hero.lua` |
| memory-of-a-hydra | Memory of a Hydra | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_hydra.lua` |
| memory-of-a-lizard | Memory of a Lizard | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_lizard.lua` |
| memory-of-a-manticore | Memory of a Manticore | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_manticore.lua` |
| memory-of-a-pirate | Memory of a Pirate | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_pirate.lua` |
| memory-of-a-scarab | Memory of a Scarab | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): speed; invocação (M35-02) | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_scarab.lua` |
| memory-of-a-shaper | Memory of a Shaper | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_shaper.lua` |
| memory-of-a-vampire | Memory of a Vampire | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, outfit, speed | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_vampire.lua` |
| memory-of-a-werelion | Memory of a Werelion | ataque sem mapeador (M35-02): combat, werelion wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_a_werelion.lua` |
| memory-of-an-amazon | Memory of an Amazon | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_an_amazon.lua` |
| memory-of-an-elf | Memory of an Elf | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_an_elf.lua` |
| memory-of-an-insectoid | Memory of an Insectoid | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_an_insectoid.lua` |
| memory-of-an-ogre | Memory of an Ogre | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/memory_creatures/memory_of_an_ogre.lua` |
| menacing-carnivor | Menacing Carnivor | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/menacing_carnivor.lua` |
| mephiles | Mephiles | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): invisible, speed | `data-otservbr-global/monster/quests/isle_of_evil/mephiles.lua` |
| mercurial-menace | Mercurial Menace | ataque sem mapeador (M35-02): combat, mercurial menace ring | `data-otservbr-global/monster/reptiles/mercurial_menace.lua` |
| mercury-blob | Mercury Blob | ataque sem mapeador (M35-02): combat, drunk; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/slimes/mercury_blob.lua` |
| merikh-the-slaughterer | Merikh the Slaughterer | defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/magicals/merikh_the_slaughterer.lua` |
| merlkin | Merlkin | ataque sem mapeador (M35-02): combat, poisonfield; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/mammals/merlkin.lua` |
| metal-gargoyle | Metal Gargoyle | ataque sem mapeador (M35-02): combat, metal gargoyle curse | `data-otservbr-global/monster/constructs/metal_gargoyle.lua` |
| mezlon-the-defiler | Mezlon the Defiler | defesa com magia sem mapeador (M35-02): heal monster 9x9 | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/mezlon_the_defiler.lua` |
| mezlon-the-defiler-stop | Mezlon The Defiler | defesa com magia sem mapeador (M35-02): heal monster 9x9; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/mezlon_the_defiler_stop.lua` |
| midnight-asura | Midnight Asura | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/demons/midnight_asura.lua` |
| midnight-panther | Midnight Panther | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/magicals/midnight_panther.lua` |
| mighty-splinter-of-madness | Mighty Splinter of Madness | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/soul_war/normal_monsters/megalomania_room/mighty_splinter_of_madness.lua` |
| mind-wrecking-dream | Mind-Wrecking Dream | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/the_dream_courts/mind-wrecking_dream.lua` |
| minion-of-gazharagoth | Minion of Gaz'haragoth | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/roshamuul/minion_of_gaz'haragoth.lua` |
| minion-of-versperoth | Minion of Versperoth | ataque sem mapeador (M35-02): combat, lava golem soulfire, speed | `data-otservbr-global/monster/quests/bigfoots_burden/minion_of_versperoth.lua` |
| minishabaal | Minishabaal | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible, speed; invocação (M35-02) | `data-otservbr-global/monster/event_creatures/minishabaal.lua` |
| minotaur-amazon | Minotaur Amazon | ataque sem mapeador (M35-02): combat, condition, minotaur amazon paralyze | `data-otservbr-global/monster/humanoids/minotaur_amazon.lua` |
| minotaur-archer | Minotaur Archer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/minotaur_archer.lua` |
| minotaur-cult-follower | Minotaur Cult Follower | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/minotaur_cult_follower.lua` |
| minotaur-cult-prophet | Minotaur Cult Prophet | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): Minotaur Cult Prophet Mass Healing | `data-otservbr-global/monster/humanoids/minotaur_cult_prophet.lua` |
| minotaur-cult-zealot | Minotaur Cult Zealot | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/minotaur_cult_zealot.lua` |
| minotaur-hunter | Minotaur Hunter | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/humanoids/minotaur_hunter.lua` |
| minotaur-idol | Minotaur Idol | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/minotaur_idol.lua` |
| minotaur-mage | Minotaur Mage | ataque sem mapeador (M35-02): combat, energyfield | `data-otservbr-global/monster/humanoids/minotaur_mage.lua` |
| minotaur-occultist | Minotaur Occultist | ataque sem mapeador (M35-02): combat, energyfield | `data-otservbr-global/monster/humanoids/minotaur_occultist.lua` |
| minotaur-poacher | Minotaur Poacher | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/minotaur_poacher.lua` |
| minotaur-totem | Minotaur Totem | aparência por item (lookTypeEx 2299) — só outfit é resolvido; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/minotaur_totem.lua` |
| mirror-image | Mirror Image | ataque sem mapeador (M35-02): combat, ice chain | `data-otservbr-global/monster/quests/soul_war/mirror_image.lua` |
| misguided-bully | Misguided Bully | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): heal monster | `data-otservbr-global/monster/quests/cults_of_tibia/misguided_bully.lua` |
| misguided-shadow | Misguided Shadow | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/misguided_shadow.lua` |
| misguided-thief | Misguided Thief | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/misguided_thief.lua` |
| mitmah-scout | Mitmah Scout | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/extra_dimensional/mitmah_scout.lua` |
| mitmah-seer | Mitmah Seer | ataque sem mapeador (M35-02): combat, mitmahseekwave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/extra_dimensional/mitmah_seer.lua` |
| mitmah-vanguard | Mitmah Vanguard | ataque sem mapeador (M35-02): boulder ring, combat, root; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/mitmah_vanguard.lua` |
| monk | Monk | defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/humans/monk.lua` |
| monk-of-the-order | Monk of the Order | defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/humans/monk_of_the_order.lua` |
| monks-apparition | Monk's Apparition | outfit 1824 fora do pacote 13.32; ataque sem mapeador (M35-02): combat, ice chain | `data-otservbr-global/monster/quests/soul_war/normal_monsters/monk's_apparition.lua` |
| monstor | Monstor | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/isle_of_evil/monstor.lua` |
| moohtah-master | Mooh'Tah Master | ataque sem mapeador (M35-02): berserk, energy beam | `data-otservbr-global/monster/quests/the_new_frontier/mooh'tah_master.lua` |
| moohtah-warrior | Mooh'Tah Warrior | ataque sem mapeador (M35-02): combat, mooh'tah master skill reducer; defesa com magia sem mapeador (M35-02): combat, haste | `data-otservbr-global/monster/humanoids/mooh'tah_warrior.lua` |
| moohtant | Moohtant | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/moohtant.lua` |
| morgaroth | Morgaroth | ataque sem mapeador (M35-02): combat, dark torturer skill reducer, speed; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/raids/morgaroth.lua` |
| morguthis | Morguthis | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat, invisible, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/ancient_tombs/morguthis.lua` |
| morik-the-gladiator | Morik the Gladiator | ataque sem mapeador (M35-02): combat, drunk; invocação (M35-02) | `data-otservbr-global/monster/bosses/morik_the_gladiator.lua` |
| mornenion | Mornenion | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/mornenion.lua` |
| morshabaal | Morshabaal | ataque sem mapeador (M35-02): combat, drunk, outfit, speed, strength; defesa com magia sem mapeador (M35-02): combat, invisible, outfit, speed | `data-otservbr-global/monster/bosses/morshabaal.lua` |
| mould-phantom | Mould Phantom | ataque sem mapeador (M35-02): combat, extended holy chain, poison chain | `data-otservbr-global/monster/quests/soul_war/normal_monsters/mould_phantom.lua` |
| mounted-thorn-knight | Mounted Thorn Knight | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed, thorn summon | `data-otservbr-global/monster/quests/forgotten_knowledge/bosses/mounted_thorn_knight.lua` |
| mozradek | Mozradek | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/kilmaresh/mozradek.lua` |
| muddy-earth-elemental | Muddy Earth Elemental | ataque sem mapeador (M35-02): combat, condition | `data-otservbr-global/monster/quests/the_elemental_spheres/muddy_earth_elemental.lua` |
| muglex-clan-assassin | Muglex Clan Assassin | ataque sem mapeador (M35-02): combat, drunk; defesa com magia sem mapeador (M35-02): invisible, speed | `data-otservbr-global/monster/dawnport/muglex_clan_assassin.lua` |
| muglex-clan-footman | Muglex Clan Footman | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/dawnport/muglex_clan_footman.lua` |
| muglex-clan-scavenger | Muglex Clan Scavenger | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/dawnport/muglex_clan_scavenger.lua` |
| mummy | Mummy | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed | `data-otservbr-global/monster/undeads/mummy.lua` |
| munster | Munster | invocação (M35-02) | `data-otservbr-global/monster/bosses/munster.lua` |
| murcion | Murcion | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/bosses/murcion.lua` |
| mushroom | Mushroom | outfit 1773 fora do pacote 13.32; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/rotten_blood/mushroom.lua` |
| mutated-bat | Mutated Bat | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), mutated bat curse; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/mammals/mutated_bat.lua` |
| mutated-human | Mutated Human | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/humans/mutated_human.lua` |
| mutated-rat | Mutated Rat | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/mammals/mutated_rat.lua` |
| mutated-tiger | Mutated Tiger | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/mammals/mutated_tiger.lua` |
| mutated-visco | Mutated Visco | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/visco.lua` |
| mutated-zalamon | Mutated Zalamon | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, outfit | `data-otservbr-global/monster/quests/wrath_of_the_emperor/mutated_zalamon.lua` |
| mycobiontic-beetle | Mycobiontic Beetle | ataque sem mapeador (M35-02): combat, largepoisonring | `data-otservbr-global/monster/quests/rotten_blood/mycobiontic_beetle.lua` |
| naga-archer | Naga Archer | ataque sem mapeador (M35-02): combat, death chain, nagadeath, nagadeathattack | `data-otservbr-global/monster/reptiles/naga_archer.lua` |
| naga-warrior | Naga Warrior | ataque sem mapeador (M35-02): combat, nagadeathattack | `data-otservbr-global/monster/reptiles/naga_warrior.lua` |
| nargol-the-impaler | Nargol The Impaler | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/nargol_the_impaler.lua` |
| necromancer | Necromancer | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/humans/necromancer.lua` |
| necromancer-servant | Necromancer Servant | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/necromancer_servant.lua` |
| necromantic-focus | Necromantic Focus | aparência por item (lookTypeEx 7059) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/soul_war/normal_monsters/megalomania_room/necromantic_focus.lua` |
| necropharus | Necropharus | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/raids/necropharus.lua` |
| neferi-the-spy | Neferi the Spy | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/kilmaresh/neferi_the_spy.lua` |
| neutral-deepling-warrior | Neutral Deepling Warrior | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/neutral_deepling_warrior.lua` |
| nibblemaw | Nibblemaw | outfit 1737 fora do pacote 13.32; ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/nibblemaw.lua` |
| nightfiend | Nightfiend | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/nightfiend.lua` |
| nighthunter | Nighthunter | ataque sem mapeador (M35-02): combat, nighthunter wave | `data-otservbr-global/monster/mammals/nighthunter.lua` |
| nightmare | Nightmare | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/magicals/nightmare.lua` |
| nightmare-of-gazharagoth | Nightmare of Gaz'haragoth | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/roshamuul/nightmare_of_gaz'haragoth.lua` |
| nightmare-scion | Nightmare Scion | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/nightmare_scion.lua` |
| nightmare-tendril | Nightmare Tendril | ataque sem mapeador (M35-02): drunk, speed | `data-otservbr-global/monster/quests/the_dream_courts/nightmare_tendril.lua` |
| nightmarish-dream | Nightmarish Dream | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_dream_courts/nightmarish_dream.lua` |
| nightstalker | Nightstalker | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), nightstalker paralyze; defesa com magia sem mapeador (M35-02): invisible, outfit, speed | `data-otservbr-global/monster/magicals/nightstalker.lua` |
| noble-lion | Noble Lion | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/mammals/noble_lion.lua` |
| nomad | Nomad | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/nomad.lua` |
| nomad-blue | Nomad | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/nomad_blue.lua` |
| nomad-female | Nomad | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/nomad_female.lua` |
| novice-of-the-cult | Novice of the Cult | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/humans/novice_of_the_cult.lua` |
| noxious-ripptor | Noxious Ripptor | ataque sem mapeador (M35-02): combat, noxious ripptor wave | `data-otservbr-global/monster/reptiles/noxious_ripptor.lua` |
| nymph | Nymph | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/fey/nymph.lua` |
| oberons-bile | Oberon's Bile | aparência por item (lookTypeEx 10980) — só outfit é resolvido; defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_secret_library/oberons_bile.lua` |
| oberons-hate | Oberon's Hate | aparência por item (lookTypeEx 10980) — só outfit é resolvido; defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_secret_library/oberons_hate.lua` |
| oberons-ire | Oberon's Ire | aparência por item (lookTypeEx 11211) — só outfit é resolvido; defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_secret_library/oberons_ire.lua` |
| oberons-spite | Oberon's Spite | aparência por item (lookTypeEx 11212) — só outfit é resolvido; defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_secret_library/oberons_spite.lua` |
| obujos | Obujos | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/liquid_black/obujos.lua` |
| ocyakao | Ocyakao | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/raids/ocyakao.lua` |
| ogre-brute | Ogre Brute | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/giants/ogre_brute.lua` |
| ogre-rowdy | Ogre Rowdy | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/giants/ogre_rowdy.lua` |
| ogre-ruffian | Ogre Ruffian | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/giants/ogre_ruffian.lua` |
| ogre-sage | Ogre Sage | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed; invocação (M35-02) | `data-otservbr-global/monster/giants/ogre_sage.lua` |
| ogre-savage | Ogre Savage | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/giants/ogre_savage.lua` |
| ogre-shaman | Ogre Shaman | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), outfit; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/giants/ogre_shaman.lua` |
| old-beholder | Beholder | ataque sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/nostalgia/old_bonelord.lua` |
| old-giant-spider | Giant Spider | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), poisonfield; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/nostalgia/old_giant_spider.lua` |
| old-wasp | Wasp | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/nostalgia/old_wasp.lua` |
| omnivora | Omnivora | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/plants/omnivora.lua` |
| omrafir | Omrafir | ataque sem mapeador (M35-02): combat, firefield, omrafir beam, omrafir wave; defesa com magia sem mapeador (M35-02): combat, omrafir healing 2, omrafir summon | `data-otservbr-global/monster/quests/roshamuul/omrafir.lua` |
| omruc | Omruc | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/quests/ancient_tombs/omruc.lua` |
| oozing-carcass | Oozing Carcass | ataque sem mapeador (M35-02): combat, energy chain, largedeathring | `data-otservbr-global/monster/quests/rotten_blood/oozing_carcass.lua` |
| oozing-corpus | Oozing Corpus | ataque sem mapeador (M35-02): combat, death chain | `data-otservbr-global/monster/quests/rotten_blood/oozing_corpus.lua` |
| orc-armor | Orc Warlord | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/raids/orc_armor.lua` |
| orc-berserker | Orc Berserker | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/humanoids/orc_berserker.lua` |
| orc-cult-fanatic | Orc Cult Fanatic | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/orc_cult_fanatic.lua` |
| orc-cult-inquisitor | Orc Cult Inquisitor | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/cults_of_tibia/orc_cult_inquisitor.lua` |
| orc-cult-minion | Orc Cult Minion | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/orc_cult_minion.lua` |
| orc-cult-priest | Orc Cult Priest | ataque sem mapeador (M35-02): combat, outfit; defesa com magia sem mapeador (M35-02): heal monster | `data-otservbr-global/monster/quests/cults_of_tibia/orc_cult_priest.lua` |
| orc-helmet | Orc Warlord | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/raids/orc_helmet.lua` |
| orc-leader | Orc Leader | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/orc_leader.lua` |
| orc-marauder | Orc Marauder | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/humanoids/orc_marauder.lua` |
| orc-rider | Orc Rider | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/humanoids/orc_rider.lua` |
| orc-shaman | Orc Shaman | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/humanoids/orc_shaman.lua` |
| orc-shield | Orc Warlord | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/raids/orc_shield.lua` |
| orc-spearman | Orc Spearman | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/orc_spearman.lua` |
| orc-warlord | Orc Warlord | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/humanoids/orc_warlord.lua` |
| orclops-doomhauler | Orclops Doomhauler | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/giants/orclops_doomhauler.lua` |
| orclops-ravager | Orclops Ravager | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/giants/orclops_ravager.lua` |
| orcus-the-cruel | Orcus the Cruel | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/svargrond_arena/greenhorn/orcus_the_cruel.lua` |
| orewalker | Orewalker | ataque sem mapeador (M35-02): combat, condition, orewalker wave, speed | `data-otservbr-global/monster/constructs/orewalker.lua` |
| organic-matter | Organic Matter | speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/dangerous_depth/organic_matter.lua` |
| orshabaal | Orshabaal | ataque sem mapeador (M35-02): combat, effect, firefield; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/raids/orshabaal.lua` |
| outburst | Outburst | ataque sem mapeador (M35-02): anomaly break, big energy purple wave, big skill reducer, combat | `data-otservbr-global/monster/quests/heart_of_destruction/outburst.lua` |
| overcharge | Overcharge | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/overcharge.lua` |
| overcharged-demon | Overcharged Demon | ataque sem mapeador (M35-02): combat, demon paralyze, firefield; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/no_rest_for_the_wicked/summons/overcharged_demon.lua` |
| overcharged-disruption | Overcharged Disruption | aparência por item (lookTypeEx 1959) — só outfit é resolvido; ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/overcharged_disruption.lua` |
| overcharged-energy-elemental | Overcharged Energy Elemental | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_elemental_spheres/overcharged_energy_elemental.lua` |
| paiz-the-pauperizer | Paiz the Pauperizer | ataque sem mapeador (M35-02): combat, condition, soulfire rune; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/killing_in_the_name_of/paiz_the_pauperizer.lua` |
| paladins-apparition | Paladin's Apparition | ataque sem mapeador (M35-02): combat, ice chain | `data-otservbr-global/monster/quests/soul_war/normal_monsters/paladin's_apparition.lua` |
| parasite | Parasite | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/vermins/parasite.lua` |
| parder | Parder | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/mammals/parder.lua` |
| party-skeleton | Party Skeleton | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/party_skeleton.lua` |
| percht | Percht | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_percht_queens_island/percht.lua` |
| phantasm | Phantasm | ataque sem mapeador (M35-02): combat, drunk, phantasm drown; defesa com magia sem mapeador (M35-02): combat, invisible, speed; invocação (M35-02) | `data-otservbr-global/monster/magicals/phantasm.lua` |
| phantasm-summon | Phantasm | ataque sem mapeador (M35-02): combat, drunk, phantasm drown; defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/magicals/phantasm_summon.lua` |
| pillar-of-death | Pillar of Death | aparência por item (lookTypeEx 11427) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/pillars/pillar_of_death.lua` |
| pillar-of-draining | Pillar of Draining | aparência por item (lookTypeEx 11427) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/pillars/pillar_of_draining.lua` |
| pillar-of-healing | Pillar of Healing | aparência por item (lookTypeEx 11427) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/pillars/pillar_of_healing.lua` |
| pillar-of-protection | Pillar of Protection | aparência por item (lookTypeEx 11427) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/pillars/pillar_of_protection.lua` |
| pillar-of-summoning | Pillar of Summoning | aparência por item (lookTypeEx 11427) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/pillars/pillar_of_summoning.lua` |
| pinata-dragon | Pinata Dragon | aparência por item (lookTypeEx 25062) — só outfit é resolvido; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02); speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/event_creatures/pinata_dragon.lua` |
| pirat-artillerist | Pirat Artillerist | ataque sem mapeador (M35-02): combat, corym vanguard wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/pirat_artillerist.lua` |
| pirat-bombardier | Pirat Bombardier | ataque sem mapeador (M35-02): energy beam, energy wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/pirat_bombardier.lua` |
| pirat-cutthroat | Pirat Cutthroat | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/pirat_cutthroat.lua` |
| pirat-mate | Pirat Mate | ataque sem mapeador (M35-02): energy beam, energy wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/pirat_mate.lua` |
| pirat-scoundrel | Pirat Scoundrel | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/pirat_scoundrel.lua` |
| pirate-buccaneer | Pirate Buccaneer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/pirate_buccaneer.lua` |
| pirate-corsair | Pirate Corsair | ataque sem mapeador (M35-02): combat, pirate corsair skill reducer | `data-otservbr-global/monster/humans/pirate_corsair.lua` |
| pirate-cutthroat | Pirate Cutthroat | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/humans/pirate_cutthroat.lua` |
| pirate-ghost | Pirate Ghost | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/pirate_ghost.lua` |
| pirate-marauder | Pirate Marauder | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/pirate_marauder.lua` |
| pixie | Pixie | ataque sem mapeador (M35-02): combat, pixie skill reducer, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/fey/pixie.lua` |
| plagirath | Plagirath | ataque sem mapeador (M35-02): combat, plagirath bog, speed; defesa com magia sem mapeador (M35-02): combat, plagirath heal, plagirath summon, speed | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/plagirath.lua` |
| plagueroot | Plagueroot | ataque sem mapeador (M35-02): combat, condition, firefield; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/the_dream_courts/bosses/plagueroot.lua` |
| plaguesmith | Plaguesmith | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), plaguesmith wave, speed; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/demons/plaguesmith.lua` |
| plant-abomination | Plant Abomination | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/the_dream_courts/plant_abomination.lua` |
| plant-attendant | Plant Attendant | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/the_dream_courts/plant_attendant.lua` |
| plunder-patriarch | Plunder Patriarch | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/primal_ordeal_quest/plunder_patriarch.lua` |
| poacher | Poacher | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/poacher.lua` |
| poison-spider | Poison Spider | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/vermins/poison_spider.lua` |
| poisonous-carnisylvan | Poisonous Carnisylvan | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed; invocação (M35-02) | `data-otservbr-global/monster/humans/poisonous_carnisylvan.lua` |
| pooka | Pooka | ataque sem mapeador (M35-02): combat, drunk; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/fey/pooka.lua` |
| possessed-tree | Possessed Tree | ataque sem mapeador (M35-02): combat, haunted treeling paralyze; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/forgotten_knowledge/possessed_tree.lua` |
| powerful-soul | Powerful Soul | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/soul_war/powerful_soul.lua` |
| preceptor-lazare | Preceptor Lazare | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/bosses/preceptor_lazare.lua` |
| priestess | Priestess | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/humans/priestess.lua` |
| priestess-of-the-wild-sun | Priestess of the Wild Sun | ataque sem mapeador (M35-02): combat, targetfirering | `data-otservbr-global/monster/humans/priestess_of_the_wild_sun.lua` |
| primitive | Primitive | ataque sem mapeador (M35-02): combat, drunk, outfit | `data-otservbr-global/monster/event_creatures/primitive.lua` |
| prince-drazzak | Prince Drazzak | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/roshamuul/prince_drazzak.lua` |
| professor-maxxen | Professor Maxxen | ataque sem mapeador (M35-02): combat, glooth fairy paralyze, glooth fairy skill reducer, war golem electrify, war golem skill reducer; defesa com magia sem mapeador (M35-02): combat, generator, glooth fairy healing, maxxenteleport, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/hero_of_rathleton/professor_maxxen.lua` |
| psychic-spirit-elemental | Psychic Spirit Elemental | outfit 1840 fora do pacote 13.32; ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_elemental_spheres/psychic_spirit_elemental.lua` |
| putrid-mummy | Putrid Mummy | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/putrid_mummy.lua` |
| pythius-the-rotten | Pythius The Rotten | ataque sem mapeador (M35-02): combat, condition, speed; invocação (M35-02) | `data-otservbr-global/monster/bosses/pythius_the_rotten.lua` |
| quara-constrictor | Quara Constrictor | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), quara constrictor electrify, quara constrictor freeze | `data-otservbr-global/monster/aquatics/quara_constrictor.lua` |
| quara-constrictor-scout | Quara Constrictor Scout | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/quara_constrictor_scout.lua` |
| quara-hydromancer | Quara Hydromancer | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/quara_hydromancer.lua` |
| quara-hydromancer-scout | Quara Hydromancer Scout | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/quara_hydromancer_scout.lua` |
| quara-looter | Quara Looter | outfit 1741 fora do pacote 13.32; ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), podzillaphyschain, quarasmallicering; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/quara_looter.lua` |
| quara-mantassin | Quara Mantassin | defesa com magia sem mapeador (M35-02): invisible, speed | `data-otservbr-global/monster/aquatics/quara_mantassin.lua` |
| quara-pincher | Quara Pincher | ataque sem mapeador (M35-02): speed | `data-otservbr-global/monster/aquatics/quara_pincher.lua` |
| quara-pincher-scout | Quara Pincher Scout | ataque sem mapeador (M35-02): speed | `data-otservbr-global/monster/aquatics/quara_pincher_scout.lua` |
| quara-plunderer | Quara Plunderer | outfit 1758 fora do pacote 13.32; ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), quaracrossdeath, quarasmokedeath | `data-otservbr-global/monster/aquatics/quara_plunderer.lua` |
| quara-predator | Quara Predator | defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/aquatics/quara_predator.lua` |
| quara-raider | Quara Raider | outfit 1759 fora do pacote 13.32; ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado), quaralargeicering, quararaidershoot, quaraseamonster, quarawatersplash; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/quara_raider.lua` |
| rage-of-mazoran | Rage of Mazoran | ataque sem mapeador (M35-02): combat, firefield, hellfire fighter soulfire | `data-otservbr-global/monster/quests/ferumbras_ascension/rage_of_mazoran.lua` |
| rage-squid | Rage Squid | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/rage_squid.lua` |
| ragiaz | Ragiaz | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, ragiaz transform, speed | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/ragiaz.lua` |
| raging-fire | Raging Fire | ataque sem mapeador (M35-02): combat, firefield, massive fire elemental soulfire | `data-otservbr-global/monster/elementals/raging_fire.lua` |
| raging-mage | Raging mage | ataque sem mapeador (M35-02): combat, energyfield, thunderstorm rune; invocação (M35-02) | `data-otservbr-global/monster/bosses/raging_mage.lua` |
| rahemos | Rahemos | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado), outfit, speed; defesa com magia sem mapeador (M35-02): combat, outfit; invocação (M35-02) | `data-otservbr-global/monster/quests/ancient_tombs/rahemos.lua` |
| ratmiral-blackwhiskers | Ratmiral Blackwhiskers | ataque sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/a_pirates_tail_quest/ratmiral_blackwhiskers.lua` |
| ravenous-beyondling | Ravenous Beyondling | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/ravenous_beyondling.lua` |
| ravenous-hunger | Ravenous Hunger | invocação (M35-02) | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/ravenous_hunger.lua` |
| ravenous-lava-lurker | Ravenous Lava Lurker | ataque sem mapeador (M35-02): ravennouslavalurkertarget, ravennouslavalurkerwave | `data-otservbr-global/monster/elementals/ravenous_lava_lurker.lua` |
| raxias | Raxias | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/raxias.lua` |
| razzagorn | Razzagorn | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, razzagorn summon, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/razzagorn.lua` |
| reality-reaver | Reality Reaver | ataque sem mapeador (M35-02): combat, condition, reality reaver wave; defesa com magia sem mapeador (M35-02): invisible, speed | `data-otservbr-global/monster/extra_dimensional/reality_reaver.lua` |
| realityquake | Realityquake | aparência por item (lookTypeEx 1949) — só outfit é resolvido; ataque sem mapeador (M35-02): anomaly break, combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/realityquake.lua` |
| redeemed-soul | Redeemed Soul | defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/redeemed_soul.lua` |
| reflection-of-mawhawk | Reflection of Mawhawk | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/mysterious_ornate_chest/reflection_of_mawhawk.lua` |
| reflection-of-obujos | Reflection of Obujos | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/mysterious_ornate_chest/reflection_of_obujos.lua` |
| regenerating-mass | Regenerating Mass | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/regenerating_mass.lua` |
| renegade-knight | Renegade Knight | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/renegade_knight.lua` |
| renegade-orc | Renegade Orc | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/renegade_orc.lua` |
| renegade-quara-constrictor | Renegade Quara Constrictor | ataque sem mapeador (M35-02): quara constrictor electrify, quara constrictor freeze; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/renegade_quara_constrictor.lua` |
| renegade-quara-hydromancer | Renegade Quara Hydromancer | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/aquatics/renegade_quara_hydromancer.lua` |
| renegade-quara-mantassin | Renegade Quara Mantassin | defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/aquatics/renegade_quara_mantassin.lua` |
| renegade-quara-pincher | Renegade Quara Pincher | ataque sem mapeador (M35-02): speed | `data-otservbr-global/monster/aquatics/renegade_quara_pincher.lua` |
| renegade-quara-predator | Renegade Quara Predator | defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/aquatics/renegade_quara_predator.lua` |
| retainer-of-baeloc | Retainer of Baeloc | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/retainer_of_baeloc.lua` |
| retching-horror | Retching Horror | ataque sem mapeador (M35-02): combat, drunk, speed | `data-otservbr-global/monster/magicals/retching_horror.lua` |
| rewar-the-bloody | Rewar The Bloody | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/rewar_the_bloody.lua` |
| rewar-the-bloody-inv | Rewar The Bloody | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/rewar_the_bloody_inv.lua` |
| rhindeer | Rhindeer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/reptiles/rhindeer.lua` |
| ribstride | Ribstride | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/killing_in_the_name_of/ribstride.lua` |
| rift-breacher | Rift Breacher | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/rift_breacher.lua` |
| rift-brood | Rift Brood | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/in_service_of_yalahar/rift_brood.lua` |
| rift-fragment | Rift Fragment | aparência por item (lookTypeEx 2122) — só outfit é resolvido; ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/ferumbras_ascension/summons/rift_fragment.lua` |
| rift-invader | Rift Invader | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/ferumbras_ascension/summons/rift_invader.lua` |
| rift-minion | Rift Minion | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/rift_minion.lua` |
| rift-scythe | Rift Scythe | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/in_service_of_yalahar/rift_scythe.lua` |
| rift-spawn | Rift Spawn | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/rift_spawn.lua` |
| rift-worm | Rift Worm | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/quests/in_service_of_yalahar/rift_worm.lua` |
| ripper-spectre | Ripper Spectre | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/ripper_spectre.lua` |
| risen-soldier | Risen Soldier | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/quests/grave_danger/risen_soldier.lua` |
| roaring-water-elemental | Roaring Water Elemental | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_elemental_spheres/roaring_water_elemental.lua` |
| rocko | Rocko | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_new_frontier/rocko.lua` |
| rocky | Rocky | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/svargrond_arena/greenhorn/rocky.lua` |
| rogue-naga | Rogue Naga | ataque sem mapeador (M35-02): combat, death chain, nagadeath, nagadeathattack | `data-otservbr-global/monster/reptiles/rogue_naga.lua` |
| ron-the-ripper | Ron the Ripper | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/raids/ron_the_ripper.lua` |
| rootthing-amber-shaper | Rootthing Amber Shaper | outfit 1762 fora do pacote 13.32; ataque sem mapeador (M35-02): combat, poison chain, rotthingshaper; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/plants/rootthing_amber_shaper.lua` |
| rootthing-bug-tracker | Rootthing Bug Tracker | outfit 1763 fora do pacote 13.32; ataque sem mapeador (M35-02): combat, podzillaphyschain, rotthligexplo, rotthligholyulus | `data-otservbr-global/monster/plants/rootthing_bug_tracker.lua` |
| rootthing-nutshell | Rootthing Nutshell | outfit 1760 fora do pacote 13.32; ataque sem mapeador (M35-02): combat, rotthingwave, rotthligulus | `data-otservbr-global/monster/plants/rootthing_nutshell.lua` |
| rorc | Rorc | defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/magicals/rorc.lua` |
| rot-elemental | Rot Elemental | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), rot elemental paralyze; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/undeads/rot_elemental.lua` |
| rotten-golem | Rotten Golem | ataque sem mapeador (M35-02): combat, poison chain, root | `data-otservbr-global/monster/quests/soul_war/normal_monsters/rotten_golem.lua` |
| rotten-man-maggot | Rotten Man-Maggot | ataque sem mapeador (M35-02): combat, largeicering | `data-otservbr-global/monster/quests/rotten_blood/rotten_man-maggot.lua` |
| rukor-zad | Rukor Zad | ataque sem mapeador (M35-02): combat, condition, drunk; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/bosses/rukor_zad.lua` |
| rupture | Rupture | ataque sem mapeador (M35-02): anomaly break, combat, rupture wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/rupture.lua` |
| rustheap-golem | Rustheap Golem | ataque sem mapeador (M35-02): frazzlemaw paralyze, rustheap golem electrify, rustheap golem wave; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/constructs/rustheap_golem.lua` |
| sabretooth | Sabretooth | ataque sem mapeador (M35-02): combat, sabretooth wave | `data-otservbr-global/monster/mammals/sabretooth.lua` |
| sacred-snake | Sacred Snake | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/dawnport/sacred_snake.lua` |
| sacred-spider | Sacred Spider | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/vermins/sacred_spider.lua` |
| salamander | Salamander | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/amphibics/salamander.lua` |
| salamander-trainer | Salamander Trainer | defesa com magia sem mapeador (M35-02): combat, salamander trainer summon | `data-otservbr-global/monster/dawnport/salamander_trainer.lua` |
| sand-brood | Sand Brood | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/summons/sand_brood.lua` |
| sand-vortex | Sand Vortex | aparência por item (lookTypeEx 23482) — só outfit é resolvido; ataque sem mapeador (M35-02): combat, drunk, speed | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/summons/sand_vortex.lua` |
| sandstone-scorpion | Sandstone Scorpion | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/constructs/sandstone_scorpion.lua` |
| scar-tribe-shaman | Scar Tribe Shaman | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/dawnport/scar_tribe_shaman.lua` |
| scarab | Scarab | ataque sem mapeador (M35-02): combat, poisonfield; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/vermins/scarab.lua` |
| scarlett-etzel | Scarlett Etzel | ataque sem mapeador (M35-02): combat, sudden death rune | `data-otservbr-global/monster/quests/grave_danger/bosses/scarlett_etzel.lua` |
| schiach | Schiach | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_percht_queens_island/schiach.lua` |
| scorn-of-the-emperor | Scorn of the Emperor | ataque sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/wrath_of_the_emperor/scorn_of_the_emperor.lua` |
| scorpion | Scorpion | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/vermins/scorpion.lua` |
| sea-serpent | Sea Serpent | ataque sem mapeador (M35-02): combat, sea serpent drown; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/reptiles/sea_serpent.lua` |
| seacrest-serpent | Seacrest Serpent | ataque sem mapeador (M35-02): combat, seacrest serpent wave; defesa com magia sem mapeador (M35-02): combat, melee | `data-otservbr-global/monster/reptiles/seacrest_serpent.lua` |
| security-golem | Security Golem | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/summons/security_golem.lua` |
| serpent-spawn | Serpent Spawn | ataque sem mapeador (M35-02): combat, outfit, speed; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/reptiles/serpent_spawn.lua` |
| shaburak-demon | Shaburak Demon | ataque sem mapeador (M35-02): combat, shaburak wave, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/shaburak_demon.lua` |
| shaburak-lord | Shaburak Lord | ataque sem mapeador (M35-02): combat, shaburak wave, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/shaburak_lord.lua` |
| shaburak-prince | Shaburak Prince | ataque sem mapeador (M35-02): combat, shaburak wave, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/shaburak_prince.lua` |
| shadow-fiend | Shadow Fiend | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), nightstalker paralyze; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/forgotten_knowledge/shadow_fiend.lua` |
| shadow-hound | Shadow Hound | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/shadow_hound.lua` |
| shadow-pupil | Shadow Pupil | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); invocação (M35-02) | `data-otservbr-global/monster/humans/shadow_pupil.lua` |
| shadow-tentacle | Shadow Tentacle | ataque sem mapeador (M35-02): blightwalker curse, combat, drunk; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/forgotten_knowledge/shadow_tentacle.lua` |
| shadowpelt | Shadowpelt | ataque sem mapeador (M35-02): combat, outfit; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/the_curse_spreads/shadowpelt.lua` |
| shaper-matriarch | Shaper Matriarch | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/shaper_matriarch.lua` |
| shard-of-corruption | Shard of Corruption | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_new_frontier/shard_of_corruption.lua` |
| shard-of-magnor | Shard of Magnor | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/shard_of_magnor.lua` |
| shardhead | Shardhead | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/killing_in_the_name_of/shardhead.lua` |
| sharpclaw | Sharpclaw | ataque sem mapeador (M35-02): combat, ghastly dragon curse, outfit, speed; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/quests/the_curse_spreads/sharpclaw.lua` |
| sharptooth | Sharptooth | defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/in_service_of_yalahar/sharptooth.lua` |
| shiversleep | Shiversleep | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/shiversleep.lua` |
| shock-head | Shock Head | ataque sem mapeador (M35-02): combat, shock head skill reducer 1, shock head skill reducer 2, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/shock_head.lua` |
| shredderthrower | Shredderthrower | aparência por item (lookTypeEx 2190) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/ancient_tombs/shredderthrower.lua` |
| shrieking-cry-stal | Shrieking Cry-Stal | ataque sem mapeador (M35-02): combat, energy chain, fear | `data-otservbr-global/monster/constructs/shrieking_cry-stal.lua` |
| shulgrax | Shulgrax | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, shulgrax summon, speed | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/shulgrax.lua` |
| sibang | Sibang | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/mammals/sibang.lua` |
| sight-of-surrender | Sight of Surrender | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/magicals/sight_of_surrender.lua` |
| silencer | Silencer | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), silencer skill reducer; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/magicals/silencer.lua` |
| sin-devourer | Sin Devourer | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), nightstalker paralyze, silencer skill reducer, speed; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/sin_devourer.lua` |
| sineater-inferniarch | Sineater Inferniarch | outfit 1795 fora do pacote 13.32; ataque sem mapeador (M35-02): big death wave, combat, firefield; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/sineater_inferniarch.lua` |
| sir-baeloc | Sir Baeloc | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/grave_danger/bosses/sir_baeloc.lua` |
| sir-nictros | Sir Nictros | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/grave_danger/bosses/sir_nictros.lua` |
| sir-valorcrest | Sir Valorcrest | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/raids/sir_valorcrest.lua` |
| sister-hetai | Sister Hetai | ataque sem mapeador (M35-02): combat, targetfirering | `data-otservbr-global/monster/quests/kilmaresh/sister_hetai.lua` |
| skeleton | Skeleton | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/skeleton.lua` |
| skeleton-elite-warrior | Skeleton Elite Warrior | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/skeleton_elite_warrior.lua` |
| skeleton-warrior | Skeleton Warrior | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/skeleton_warrior.lua` |
| skunk | Skunk | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/mammals/skunk.lua` |
| slick-water-elemental | Slick Water Elemental | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_elemental_spheres/slick_water_elemental.lua` |
| slim | Slim | ataque sem mapeador (M35-02): combat, poisonfield | `data-otservbr-global/monster/quests/svargrond_arena/scrapper/slim.lua` |
| slime | Slime | invocação (M35-02) | `data-otservbr-global/monster/slimes/slime.lua` |
| slug | Slug | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/vermins/slug.lua` |
| smuggler-baron-silvertoe | Smuggler Baron Silvertoe | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/bosses/smuggler_baron_silvertoe.lua` |
| snake | Snake | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/reptiles/snake.lua` |
| snake-god-essence | Snake God Essence | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/wrath_of_the_emperor/snake_god_essence.lua` |
| snake-thing | Snake Thing | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/wrath_of_the_emperor/snake_thing.lua` |
| solid-frozen-horror | Solid Frozen Horror | ataque sem mapeador (M35-02): combat, hirintror freeze, hirintror skill reducer, ice golem paralyze, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/forgotten_knowledge/bosses/solid_frozen_horror.lua` |
| somewhat-beatable | Somewhat Beatable | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_first_dragon/somewhat_beatable.lua` |
| son-of-verminor | Son of Verminor | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, outfit | `data-otservbr-global/monster/slimes/son_of_verminor.lua` |
| sopping-carcass | Sopping Carcass | ataque sem mapeador (M35-02): combat, ice chain | `data-otservbr-global/monster/quests/rotten_blood/sopping_carcass.lua` |
| sopping-corpus | Sopping Corpus | ataque sem mapeador (M35-02): combat, largepoisonring | `data-otservbr-global/monster/quests/rotten_blood/sopping_corpus.lua` |
| sorcerers-apparition | Sorcerer's Apparition | ataque sem mapeador (M35-02): combat, ice chain | `data-otservbr-global/monster/quests/soul_war/normal_monsters/sorcerer's_apparition.lua` |
| soul-broken-harbinger | Soul-Broken Harbinger | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/soul-broken_harbinger.lua` |
| soul-cage | Soul Cage | defesa com magia sem mapeador (M35-02): Heal Malice; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/soul_war/soul_cage.lua` |
| soul-of-dragonking-zyrtarch | Soul of Dragonking Zyrtarch | ataque sem mapeador (M35-02): charged energy elemental electrify, combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/forgotten_knowledge/bosses/soul_of_dragonking_zyrtarch.lua` |
| soul-reaper | Soul Reaper | ataque sem mapeador (M35-02): breach brood reducer, combat | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/summons/soul_reaper.lua` |
| soul-scourge | Soul Scourge | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/grave_danger/soul_scourge.lua` |
| soul-sphere | Soul Sphere | speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/soul_war/soul_sphere.lua` |
| soulcatcher | Soulcatcher | aparência por item (lookTypeEx 11053) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, soulcatcher summon; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/forgotten_knowledge/soulcatcher.lua` |
| souleater | Souleater | ataque sem mapeador (M35-02): combat, souleater drown, souleater wave; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/undeads/souleater.lua` |
| soulless-minion | Soulless Minion | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, outfit | `data-otservbr-global/monster/quests/grave_danger/soulless_minion.lua` |
| soulsnatcher | Soulsnatcher | ataque sem mapeador (M35-02): soulsnatcher-lifedrain-beam, soulsnatcher-lifedrain-missile, soulsnatcher-manadrain-ball | `data-otservbr-global/monster/quests/soul_war/soulsnatcher.lua` |
| spark-of-burning-hatred | Spark of Burning Hatred | aparência por item (lookTypeEx 34010) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/soul_war/normal_monsters/burning_hatred/spark_of_burning_hatred.lua` |
| spark-of-destruction | Spark of Destruction | ataque sem mapeador (M35-02): combat, condition, reality reaver wave | `data-otservbr-global/monster/quests/heart_of_destruction/spark_of_destruction.lua` |
| sparkion | Sparkion | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/extra_dimensional/sparkion.lua` |
| spawn-of-havoc | Spawn of Havoc | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/spawn_of_havoc.lua` |
| spawn-of-the-welter | Spawn of the Welter | ataque sem mapeador (M35-02): poisonfield; defesa com magia sem mapeador (M35-02): combat, spawn of the welter heal | `data-otservbr-global/monster/raids/spawn_of_the_welter.lua` |
| spectral-scum | Spectral Scum | ataque sem mapeador (M35-02): drunk | `data-otservbr-global/monster/event_creatures/spectral_scum.lua` |
| spectre | Spectre | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado), spectre drown; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/undeads/spectre.lua` |
| spellreaper-inferniarch | Spellreaper Inferniarch | outfit 1792 fora do pacote 13.32; ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/demons/spellreaper_inferniarch.lua` |
| sphere-of-wrath | Sphere of Wrath | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/summons/sphere_of_wrath.lua` |
| sphinx | Sphinx | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/sphinx.lua` |
| spider-queen | Spider Queen | ataque sem mapeador (M35-02): spider queen wrap; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/bosses/spider_queen.lua` |
| spidris | Spidris | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/vermins/spidris.lua` |
| spiky-carnivor | Spiky Carnivor | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/spiky_carnivor.lua` |
| spirit-of-fertility | Spirit of Fertility | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_first_dragon/spirit_of_fertility.lua` |
| spirit-of-fire | Spirit of Fire | ataque sem mapeador (M35-02): combat, firefield | `data-otservbr-global/monster/quests/svargrond_arena/scrapper/spirit_of_fire.lua` |
| spirit-of-water | Spirit of Water | ataque sem mapeador (M35-02): combat, poisonfield | `data-otservbr-global/monster/quests/svargrond_arena/scrapper/spirit_of_water.lua` |
| spirit-overlord | Spirit Overlord | outfit 1840 fora do pacote 13.32; ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/the_elemental_spheres/spirit_overlord.lua` |
| spit-nettle | Spit Nettle | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/plants/spit_nettle.lua` |
| spite-of-the-emperor | Spite of the Emperor | ataque sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/wrath_of_the_emperor/spite_of_the_emperor.lua` |
| spiteful-spitter | Spiteful Spitter | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/soul_war/spiteful_spitter.lua` |
| spitter | Spitter | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/vermins/spitter.lua` |
| splasher | Splasher | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/splasher.lua` |
| spyrat-east | Spyrat | aparência por item (lookTypeEx 30375) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/raids/spyrat_facing_east.lua` |
| spyrat-north | Spyrat | aparência por item (lookTypeEx 30376) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/raids/spyrat_facing_north.lua` |
| spyrat-south | Spyrat | aparência por item (lookTypeEx 30377) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/raids/spyrat_facing_south.lua` |
| spyrat-west | Spyrat | aparência por item (lookTypeEx 30378) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/raids/spyrat_facing_west.lua` |
| squid-warden | Squid Warden | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/squid_warden.lua` |
| squidgy-slime | Squidgy Slime | invocação (M35-02) | `data-otservbr-global/monster/slimes/squidgy_slime.lua` |
| squire-of-nictros | Squire of Nictros | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/quests/grave_danger/squire_of_nictros.lua` |
| srezz-yellow-eyes | Srezz Yellow Eyes | ataque sem mapeador (M35-02): combat, lleech waveT; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/ancient_feud/srezz_yellow_eyes.lua` |
| stabilizing-dread-intruder | Stabilizing Dread Intruder | ataque sem mapeador (M35-02): combat, dread intruder wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/extra_dimensional/stabilizing_dread_intruder.lua` |
| stabilizing-reality-reaver | Stabilizing Reality Reaver | ataque sem mapeador (M35-02): combat, reality reaver wave; defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/extra_dimensional/stabilizing_reality_reaver.lua` |
| stalker | Stalker | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/humans/stalker.lua` |
| stalking-stalk | Stalking Stalk | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/plants/stalking_stalk.lua` |
| stampor | Stampor | ataque sem mapeador (M35-02): combat, stampor skill reducer; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/reptiles/stampor.lua` |
| starving-wolf | Starving Wolf | defesa com magia sem mapeador (M35-02): effect | `data-otservbr-global/monster/mammals/starving_wolf.lua` |
| stolen-knowledge-of-armor | Stolen Knowledge of Armor | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/stolen_knowledge_of_armor.lua` |
| stolen-knowledge-of-healing | Stolen Knowledge of Healing | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/stolen_knowledge_of_healing.lua` |
| stolen-knowledge-of-lifesteal | Stolen Knowledge of Lifesteal | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/stolen_knowledge_of_lifesteal.lua` |
| stolen-knowledge-of-spells | Stolen Knowledge of Spells | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/stolen_knowledge_of_spells.lua` |
| stolen-knowledge-of-summoning | Stolen Knowledge of Summoning | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/stolen_knowledge_of_summoning.lua` |
| stolen-tome-of-portals | Stolen Tome of Portals | aparência por item (lookTypeEx 23985) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_secret_library/stolen_tome_of_portals.lua` |
| stone-devourer | Stone Devourer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/constructs/stone_devourer.lua` |
| stone-rhino | Stone Rhino | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/mammals/stone_rhino.lua` |
| stonecracker | Stonecracker | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/killing_in_the_name_of/stonecracker.lua` |
| stonerefiner | Stonerefiner | ataque sem mapeador (M35-02): berserk, stone shower rune | `data-otservbr-global/monster/reptiles/stonerefiner.lua` |
| strange-slime | Strange Slime | speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/bigfoots_burden/strange_slime.lua` |
| streaked-devourer | Streaked Devourer | ataque sem mapeador (M35-02): combat, devourer death wave | `data-otservbr-global/monster/vermins/streaked_devourer.lua` |
| strong-glooth-horror | Strong Glooth Horror | ataque sem mapeador (M35-02): combat, condition, drunk; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/hero_of_rathleton/strong_glooth_horror.lua` |
| strong-soul | Strong Soul | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/soul_war/strong_soul.lua` |
| sugar-cube | Sugar Cube | outfit 1753 fora do pacote 13.32 | `data-otservbr-global/monster/fey/sugar_cube.lua` |
| sugar-cube-worker | Sugar Cube Worker | outfit 1756 fora do pacote 13.32 | `data-otservbr-global/monster/fey/sugar_cube_worker.lua` |
| sugar-daddy | Sugar Daddy | outfit 1764 fora do pacote 13.32; ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/bosses/sugar_daddy.lua` |
| sugar-mommy | Sugar Mommy | outfit 1764 fora do pacote 13.32; ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/sugar_mommy.lua` |
| sulphider | Sulphider | ataque sem mapeador (M35-02): blast ring, combat | `data-otservbr-global/monster/vermins/sulphider.lua` |
| sulphur-scuttler | Sulphur Scuttler | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/killing_in_the_name_of/sulphur_scuttler.lua` |
| sulphur-spouter | Sulphur Spouter | ataque sem mapeador (M35-02): combat, sulphur spouter wave | `data-otservbr-global/monster/elementals/sulphur_spouter.lua` |
| sun-marked-goanna | Sun-Marked Goanna | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), wave t; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/kilmaresh/sun-marked_goanna.lua` |
| svoren-the-mad | Svoren the Mad | ataque sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/svargrond_arena/warlord/svoren_the_mad.lua` |
| swamp-troll | Swamp Troll | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/humanoids/swamp_troll.lua` |
| swampling | Swampling | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/plants/swampling.lua` |
| swan-maiden | Swan Maiden | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/fey/swan_maiden.lua` |
| swarmer | Swarmer | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/vermins/swarmer.lua` |
| swarmer-hatchling | Swarmer Hatchling | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/vermins/swarmer_hatchling.lua` |
| sword-of-vengeance | Sword of Vengeance | aparência por item (lookTypeEx 24227) — só outfit é resolvido; ataque sem mapeador (M35-02): berserk, combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/forgotten_knowledge/sword_of_vengeance.lua` |
| symbol-of-hatred | Symbol of Hatred | aparência por item (lookTypeEx 11427) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/soul_war/normal_monsters/burning_hatred/symbol_of_hatred.lua` |
| tainted-soul | Tainted Soul | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/fey/tainted_soul.lua` |
| tanjis | Tanjis | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/liquid_black/tanjis.lua` |
| tarantula | Tarantula | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/vermins/tarantula.lua` |
| tarbaz | Tarbaz | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/tarbaz.lua` |
| tarnished-spirit | Tarnished Spirit | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/tarnished_spirit.lua` |
| tazhadur | Tazhadur | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_first_dragon/bosses/tazhadur.lua` |
| tentacle-of-the-deep-terror | Tentacle of the Deep Terror | ataque sem mapeador (M35-02): blightwalker curse, combat, drunk; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/hero_of_rathleton/tentacle_of_the_deep_terror.lua` |
| tentuglys-head | Tentugly's Head | aparência por item (lookTypeEx 35105) — só outfit é resolvido; ataque sem mapeador (M35-02): combat, energy waveT; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/a_pirates_tail_quest/tentuglys_head.lua` |
| terofar | Terofar | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/roshamuul/terofar.lua` |
| terramite | Terramite | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/vermins/terramite.lua` |
| terrified-elephant | Terrified Elephant | defesa com magia sem mapeador (M35-02): speed; Bestiário sem race | `data-otservbr-global/monster/mammals/terrified_elephant.lua` |
| terrorsleep | Terrorsleep | ataque sem mapeador (M35-02): combat, condition, feversleep skill reducer; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/magicals/terrorsleep.lua` |
| thalas | Thalas | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/ancient_tombs/thalas.lua` |
| thanatursus | Thanatursus | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/thanatursus.lua` |
| thawing-dragon-lord | Thawing Dragon Lord | ataque sem mapeador (M35-02): fire wave, firefield, ice crystal bomb, speed | `data-otservbr-global/monster/quests/the_secret_library/bosses/thawing_dragon_lord.lua` |
| the-abomination | The Abomination | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/the_abomination.lua` |
| the-armored-voidborn | The Armored Voidborn | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/the_armored_voidborn.lua` |
| the-astral-source | The Astral Source | aparência por item (lookTypeEx 24228) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/bosses/the_astral_source.lua` |
| the-axeorcist | The Axeorcist | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/the_new_frontier/the_axeorcist.lua` |
| the-baron-from-below | The Baron from Below | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/dangerous_depth/bosses/the_baron_from_below.lua` |
| the-blazing-rose | The Blazing Rose | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/the_blazing_rose.lua` |
| the-blazing-time-guardian | The Blazing Time Guardian | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): time guardian lost time; invocação (M35-02) | `data-otservbr-global/monster/quests/forgotten_knowledge/bosses/the_blazing_time_guardian.lua` |
| the-blightfather | The Blightfather | defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/bosses/the_blightfather.lua` |
| the-bloodweb | The Bloodweb | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/killing_in_the_name_of/the_bloodweb.lua` |
| the-book-of-death | The Book of Death | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/the_book_of_death.lua` |
| the-book-of-secrets | The Book of Secrets | aparência por item (lookTypeEx 22755) — só outfit é resolvido; ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/the_book_of_secrets.lua` |
| the-brainstealer | The Brainstealer | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/bosses/the_brainstealer.lua` |
| the-collector | The Collector | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed | `data-otservbr-global/monster/bosses/the_collector.lua` |
| the-corruptor-of-souls | The Corruptor of Souls | ataque sem mapeador (M35-02): combat, remorseless wave | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/the_corruptor_of_souls.lua` |
| the-count | The Count | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/quests/the_inquisition/the_count.lua` |
| the-count-of-the-core | The Count of the Core | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/dangerous_depth/bosses/the_count_of_the_core.lua` |
| the-dark-dancer | The Dark Dancer | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/quests/svargrond_arena/scrapper/the_dark_dancer.lua` |
| the-destruction | The Destruction | ataque sem mapeador (M35-02): anomaly break, combat, destruction summon; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/the_destruction.lua` |
| the-devourer-of-secrets | The Devourer of Secrets | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/the_devourer_of_secrets.lua` |
| the-diamond-blossom | The Diamond Blossom | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/the_diamond_blossom.lua` |
| the-distorted-astral-source | The Distorted Astral Source | aparência por item (lookTypeEx 24229) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/forgotten_knowledge/the_distorted_astral_source.lua` |
| the-dread-maiden | The Dread Maiden | ataque sem mapeador (M35-02): combat, dread rcircle, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/feaster_of_souls/the_dread_maiden.lua` |
| the-dreadorian | The Dreadorian | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_new_frontier/the_dreadorian.lua` |
| the-duke-of-the-depths | The Duke of the Depths | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/dangerous_depth/bosses/the_duke_of_the_depths.lua` |
| the-end-of-days | The End of Days | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/primal_ordeal_quest/the_end_of_days.lua` |
| the-enraged-thorn-knight | The Enraged Thorn Knight | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/forgotten_knowledge/bosses/the_enraged_thorn_knight.lua` |
| the-evil-eye | The Evil Eye | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/bosses/the_evil_eye.lua` |
| the-false-god | The False God | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/the_false_god.lua` |
| the-fear-feaster | The Fear Feaster | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado), speed, strength; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/feaster_of_souls/the_fear_feaster.lua` |
| the-fire-empowered-duke | The Fire Empowered Duke | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/dangerous_depth/bosses/the_duke_of_the_depths_immortal.lua` |
| the-first-dragon | The First Dragon | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/the_first_dragon.lua` |
| the-flaming-orchid | The Flaming Orchid | ataque sem mapeador (M35-02): Ignite, aggressivelavawave, big death wave, combat; defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/bosses/the_flaming_orchid.lua` |
| the-freezing-time-guardian | The Freezing Time Guardian | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): time guardian lost time | `data-otservbr-global/monster/quests/forgotten_knowledge/bosses/the_freezing_time_guardian.lua` |
| the-hag | The Hag | ataque sem mapeador (M35-02): drunk, speed; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/quests/svargrond_arena/scrapper/the_hag.lua` |
| the-halloween-hare | The Halloween Hare | ataque sem mapeador (M35-02): outfit; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/the_halloween_hare.lua` |
| the-handmaiden | The Handmaiden | ataque sem mapeador (M35-02): combat, drunk; defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/quests/pits_of_inferno/the_handmaiden.lua` |
| the-heat-of-summer | The Heat of Summer | ataque sem mapeador (M35-02): combat, firefield | `data-otservbr-global/monster/quests/the_dream_courts/the_heat_of_summer.lua` |
| the-horned-fox | The Horned Fox | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/raids/the_horned_fox.lua` |
| the-hunger | The Hunger | ataque sem mapeador (M35-02): anomaly break, combat, hunger summon, practise fire wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/the_hunger.lua` |
| the-hungry-baron-from-below | The Hungry Baron from Below | ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/dangerous_depth/bosses/the_hungry_baron_from_below.lua` |
| the-imperor | The Imperor | ataque sem mapeador (M35-02): combat, diabolic imp skill reducer, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, invisible, speed, the imperor summon | `data-otservbr-global/monster/quests/pits_of_inferno/the_imperor.lua` |
| the-keeper | The Keeper | ataque sem mapeador (M35-02): combat, outfit, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/wrath_of_the_emperor/the_keeper.lua` |
| the-last-lore-keeper | The Last Lore Keeper | ataque sem mapeador (M35-02): combat, medusa paralyze; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/forgotten_knowledge/bosses/the_last_lore_keeper.lua` |
| the-lily-of-night | The Lily of Night | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/the_lily_of_night.lua` |
| the-lord-of-the-lice | The Lord of the Lice | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), mutated rat paralyze; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/the_lord_of_the_lice.lua` |
| the-many | The Many | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/killing_in_the_name_of/the_many.lua` |
| the-masked-marauder | The Masked Marauder | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/svargrond_arena/warlord/the_masked_marauder.lua` |
| the-monster | The Monster | ataque sem mapeador (M35-02): combat, destroy magic walls; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/the_monster.lua` |
| the-mutated-pumpkin | The Mutated Pumpkin | ataque sem mapeador (M35-02): combat, outfit; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/the_mutated_pumpkin.lua` |
| the-nightmare-beast | The Nightmare Beast | ataque sem mapeador (M35-02): big death wave, combat, death beam | `data-otservbr-global/monster/quests/the_dream_courts/bosses/the_nightmare_beast.lua` |
| the-noxious-spawn | The Noxious Spawn | ataque sem mapeador (M35-02): combat, outfit, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/killing_in_the_name_of/the_noxious_spawn.lua` |
| the-obliverator | The Obliverator | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/svargrond_arena/warlord/the_obliverator.lua` |
| the-old-widow | The Old Widow | ataque sem mapeador (M35-02): combat, poisonfield, speed; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/killing_in_the_name_of/the_old_widow.lua` |
| the-pale-count | The Pale Count | ataque sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/raids/the_pale_count.lua` |
| the-pale-worm | The Pale Worm | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado), speed, strength; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/feaster_of_souls/the_pale_worm.lua` |
| the-percht-queen | The Percht Queen | aparência por item (lookTypeEx 30340) — só outfit é resolvido; ataque sem mapeador (M35-02): combat; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/the_percht_queens_island/the_percht_queen.lua` |
| the-pit-lord | The Pit Lord | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/svargrond_arena/warlord/the_pit_lord.lua` |
| the-plasmother | The Plasmother | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/pits_of_inferno/the_plasmother.lua` |
| the-primal-menace | The Primal Menace | ataque sem mapeador (M35-02): big death wave, combat | `data-otservbr-global/monster/quests/primal_ordeal_quest/the_primal_menace.lua` |
| the-rage | The Rage | ataque sem mapeador (M35-02): anomaly break, big death wave, big explosion wave, combat, rage summon | `data-otservbr-global/monster/quests/heart_of_destruction/the_rage.lua` |
| the-ravager | The Ravager | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/dark_trails/the_ravager.lua` |
| the-red-knight | The Red Knight | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/the_red_knight.lua` |
| the-remorseless-corruptor | The Remorseless Corruptor | ataque sem mapeador (M35-02): combat, remorseless wave | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/the_remorseless_corruptor.lua` |
| the-rootkraken | The Rootkraken | outfit 1765 fora do pacote 13.32; ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/the_rootkraken.lua` |
| the-sandking | The Sandking | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/the_sandking.lua` |
| the-sandking-fake | The Sandking | ataque sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/the_sandking_fake.lua` |
| the-scion-of-havoc | The Scion of Havoc | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/the_scion_of_havoc.lua` |
| the-scourge-of-oblivion | The Scourge of Oblivion | ataque sem mapeador (M35-02): choking fear drown, combat, drunk, energy strike, speed, strength; defesa com magia sem mapeador (M35-02): combat, invisible, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/the_secret_library/bosses/the_scourge_of_oblivion.lua` |
| the-shatterer | The Shatterer | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/the_shatterer.lua` |
| the-shielded-thorn-knight | The Shielded Thorn Knight | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/forgotten_knowledge/bosses/the_shielded_thorn_knight.lua` |
| the-sinister-hermit | The Sinister Hermit | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, shock head skill reducer 2; invocação (M35-02) | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/the_sinister_hermit_clean.lua` |
| the-sinister-hermit-dirty | The Sinister Hermit | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, shock head skill reducer 2; invocação (M35-02) | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/the_sinister_hermit_dirty.lua` |
| the-souldespoiler | The Souldespoiler | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/the_souldespoiler.lua` |
| the-source-of-corruption | The Source of Corruption | ataque sem mapeador (M35-02): source of corruption wave | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/the_source_of_corruption.lua` |
| the-spellstealer | The Spellstealer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/the_spellstealer.lua` |
| the-time-guardian | The Time Guardian | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): time guardian, time guardiann | `data-otservbr-global/monster/quests/forgotten_knowledge/bosses/the_time_guardian.lua` |
| the-unarmored-voidborn | The Unarmored Voidborn | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/the_unarmored_voidborn.lua` |
| the-unwelcome | The Unwelcome | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado), speed, strength; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/feaster_of_souls/the_unwelcome.lua` |
| the-voice-of-ruin | The Voice of Ruin | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/raids/the_voice_of_ruin.lua` |
| the-weakened-count | The Weakened Count | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/quests/the_inquisition/the_weakened_count.lua` |
| the-welter | The Welter | ataque sem mapeador (M35-02): combat, condition, the welter paralyze; defesa com magia sem mapeador (M35-02): combat, the welter heal, the welter summon2; invocação (M35-02) | `data-otservbr-global/monster/raids/the_welter.lua` |
| thieving-squirrel | Thieving Squirrel | defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/mammals/thieving_squirrel.lua` |
| thorn-minion | Thorn Minion | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/forgotten_knowledge/thorn_minion.lua` |
| thornback-tortoise | Thornback Tortoise | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/reptiles/thornback_tortoise.lua` |
| thornfire-wolf | Thornfire Wolf | ataque sem mapeador (M35-02): combat, firefield; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/mammals/thornfire_wolf.lua` |
| thul | Thul | ataque sem mapeador (M35-02): combat, poisonfield, speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/killing_in_the_name_of/thul.lua` |
| tiger | Tiger | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/mammals/tiger.lua` |
| time-keeper | Time Keeper | ataque sem mapeador (M35-02): combat, white shade paralyze | `data-otservbr-global/monster/quests/forgotten_knowledge/time_keeper.lua` |
| time-waster | Time Waster | aparência por item (lookTypeEx 23729) — só outfit é resolvido; ataque sem mapeador (M35-02): combat, white shade paralyze | `data-otservbr-global/monster/quests/forgotten_knowledge/time_waster.lua` |
| timira-the-many-headed | Timira The Many-Headed | ataque sem mapeador (M35-02): combat, death chain, mana drain chain, timira explosion, timira fire ring | `data-otservbr-global/monster/quests/marapur/timira_the_many-headed.lua` |
| tiquandas-revenge | Tiquandas Revenge | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): ultimate healing | `data-otservbr-global/monster/quests/killing_in_the_name_of/tiquandas_revenge.lua` |
| tirecz | Tirecz | ataque sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/quests/the_new_frontier/tirecz.lua` |
| toad | Toad | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/amphibics/toad.lua` |
| tomb-servant | Tomb Servant | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/tomb_servant.lua` |
| tormented-ghost | Tormented Ghost | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/in_service_of_yalahar/tormented_ghost.lua` |
| tormentor | Tormentor | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/killing_in_the_name_of/tormentor.lua` |
| travelling-merchant | Travelling Merchant | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/rottin_wood_and_the_married_men_quest/travelling_merchant.lua` |
| tremendous-tyrant | Tremendous Tyrant | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/vermins/tremendous_tyrant.lua` |
| tremorak | Tremorak | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_new_frontier/tremorak.lua` |
| troll-legionnaire | Troll Legionnaire | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/humanoids/troll_legionnaire.lua` |
| troll-trained-salamander | Troll-Trained Salamander | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/dawnport/troll-trained_salamander.lua` |
| tromphonyte | Tromphonyte | ataque sem mapeador (M35-02): combat, stampor skill reducer; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/killing_in_the_name_of/tromphonyte.lua` |
| true-dawnfire-asura | True Dawnfire Asura | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/demons/true_dawnfire_asura.lua` |
| true-frost-flower-asura | True Frost Flower Asura | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/demons/true_frost_flower_asura.lua` |
| true-midnight-asura | True Midnight Asura | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/demons/true_midnight_asura.lua` |
| truffle | Truffle | outfit 1750 fora do pacote 13.32 | `data-otservbr-global/monster/fey/truffle.lua` |
| truffle-cook | Truffle Cook | outfit 1751 fora do pacote 13.32 | `data-otservbr-global/monster/fey/truffle_cook.lua` |
| tunnel-tyrant | Tunnel Tyrant | ataque sem mapeador (M35-02): combat, stalagmite rune, stone shower rune | `data-otservbr-global/monster/vermins/tunnel_tyrant.lua` |
| turbulent-elemental | Turbulent Elemental | ataque sem mapeador (M35-02): combat, soulwars fear | `data-otservbr-global/monster/quests/soul_war/normal_monsters/turbulent_elemental.lua` |
| twisted-pooka | Twisted Pooka | ataque sem mapeador (M35-02): combat, condition, drunk; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/fey/twisted_pooka.lua` |
| twisted-shaper | Twisted Shaper | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humanoids/twisted_shaper.lua` |
| two-headed-turtle | Two-Headed Turtle | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/reptiles/two-headed_turtle.lua` |
| tyrn | Tyrn | ataque sem mapeador (M35-02): combat, drunk, tyrn electrify, tyrn skill reducer; defesa com magia sem mapeador (M35-02): combat, invisible, tyrn heal | `data-otservbr-global/monster/raids/tyrn.lua` |
| ugly-monster | Ugly Monster | ataque sem mapeador (M35-02): drunk, outfit; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/quests/mysterious_ornate_chest/ugly_monster.lua` |
| unaz-the-mean | Unaz the Mean | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/feaster_of_souls/unaz_the_mean.lua` |
| unbeatable-dragon | Unbeatable Dragon | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_first_dragon/unbeatable_dragon.lua` |
| unbound-blightwalker | Unbound Blightwalker | ataque sem mapeador (M35-02): blightwalker curse, combat, drunk, speed | `data-otservbr-global/monster/quests/forgotten_knowledge/unbound_blightwalker.lua` |
| unbound-defiler | Unbound Defiler | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/forgotten_knowledge/unbound_defiler.lua` |
| unbound-demon | Unbound Demon | ataque sem mapeador (M35-02): combat, firefield, speed; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/forgotten_knowledge/unbound_demon.lua` |
| unbound-demon-outcast | Unbound Demon Outcast | ataque sem mapeador (M35-02): combat, demon outcast skill reducer; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/quests/forgotten_knowledge/unbound_demon_outcast.lua` |
| unchained-fire | Unchained Fire | ataque sem mapeador (M35-02): unchained fire beam, unchained fire explosion | `data-otservbr-global/monster/quests/primal_ordeal_quest/unchained_fire.lua` |
| undead-dragon | Undead Dragon | ataque sem mapeador (M35-02): combat, undead dragon curse; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/undead_dragon.lua` |
| undead-elite-gladiator | Undead Elite Gladiator | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/undeads/undead_elite_gladiator.lua` |
| undead-gladiator | Undead Gladiator | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/undeads/undead_gladiator.lua` |
| undead-mine-worker | Undead Mine Worker | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/undead_mine_worker.lua` |
| undead-minion | Undead Minion | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/event_creatures/undead_minion.lua` |
| undead-prospector | Undead Prospector | defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/undead_prospector.lua` |
| undertaker | Undertaker | ataque sem mapeador (M35-02): combat, root wave, undertaker square explosion | `data-otservbr-global/monster/vermins/undertaker.lua` |
| ungreez | Ungreez | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_inquisition/ungreez.lua` |
| unpleasant-dream | Unpleasant Dream | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/the_dream_courts/unpleasant_dream.lua` |
| unstable-spark | Unstable Spark | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/heart_of_destruction/unstable_spark.lua` |
| urmahlullu-the-immaculate | Urmahlullu the Immaculate | ataque sem mapeador (M35-02): combat, urmahlulluring | `data-otservbr-global/monster/quests/kilmaresh/urmahlullu_the_immaculate.lua` |
| urmahlullu-the-tamed | Urmahlullu the Tamed | ataque sem mapeador (M35-02): combat, urmahlulluring | `data-otservbr-global/monster/quests/kilmaresh/urmahlullu_the_tamed.lua` |
| urmahlullu-the-weakened | Urmahlullu the Weakened | ataque sem mapeador (M35-02): combat, urmahlulluring | `data-otservbr-global/monster/quests/kilmaresh/urmahlullu_the_weakened.lua` |
| ushuriel | Ushuriel | ataque sem mapeador (M35-02): combat, condition, drunk; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/quests/the_inquisition/ushuriel.lua` |
| usurper-archer | Usurper Archer | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/usurper_archer.lua` |
| usurper-commander | Usurper Commander | ataque sem mapeador (M35-02): combat, singlecloudchain, singledeathchain; invocação (M35-02) | `data-otservbr-global/monster/quests/the_order_of_lion/usurper_commander.lua` |
| usurper-knight | Usurper Knight | ataque sem mapeador (M35-02): combat, singlecloudchain; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/usurper_knight.lua` |
| usurper-warlock | Usurper Warlock | ataque sem mapeador (M35-02): combat, singledeathchain, singleicechain | `data-otservbr-global/monster/humans/usurper_warlock.lua` |
| utua-stone-sting | Utua Stone Sting | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/ancient_feud/utua_stone_sting.lua` |
| valkyrie | Valkyrie | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/valkyrie.lua` |
| vampire | Vampire | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, outfit, speed | `data-otservbr-global/monster/undeads/vampire.lua` |
| vampire-bride | Vampire Bride | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/vampire_bride.lua` |
| vampire-pig | Vampire Pig | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): outfit | `data-otservbr-global/monster/mammals/vampire_pig.lua` |
| vampire-viscount | Vampire Viscount | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): outfit, speed | `data-otservbr-global/monster/undeads/vampire_viscount.lua` |
| vampiric-blood | Vampiric Blood | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/grave_danger/vampiric_blood.lua` |
| varnished-diremaw | Varnished Diremaw | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/vermins/varnished_diremaw.lua` |
| vashresamun | Vashresamun | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/ancient_tombs/vashresamun.lua` |
| vemiath | Vemiath | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/vemiath.lua` |
| venerable-girtablilu | Venerable Girtablilu | ataque sem mapeador (M35-02): combat, girtablilu poison wave; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/magicals/venerable_girtablilu.lua` |
| vermin-swarm | Vermin Swarm | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/summons/vermin_swarm.lua` |
| verminor | Verminor | ataque sem mapeador (M35-02): combat, condition, speed, strength; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/bosses/verminor.lua` |
| versperoth | Versperoth | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/bigfoots_burden/versperoth.lua` |
| vexclaw | Vexclaw | ataque sem mapeador (M35-02): choking fear drown, combat, energy strike, firefield, speed; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/demons/vexclaw.lua` |
| vibrant-phantom | Vibrant Phantom | ataque sem mapeador (M35-02): combat, extended energy chain, extended holy chain | `data-otservbr-global/monster/quests/soul_war/normal_monsters/furious_crater/vibrant_phantom.lua` |
| vicious-manbat | Vicious Manbat | ataque sem mapeador (M35-02): combat, condition, speed | `data-otservbr-global/monster/undeads/vicious_manbat.lua` |
| vicious-squire | Vicious Squire | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/vicious_squire.lua` |
| vile-grandmaster | Vile Grandmaster | ataque sem mapeador (M35-02): condition; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/humans/vile_grandmaster.lua` |
| void | Void | aparência por item (lookTypeEx 470) — só outfit é resolvido; invocação (M35-02); speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/ferumbras_ascension/traps/void.lua` |
| voidshard | Voidshard | ataque sem mapeador (M35-02): combat, condition, energy strike | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/summons/voidshard.lua` |
| vok-the-freakish | Vok the Freakish | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/feaster_of_souls/vok_the_freakish.lua` |
| vulcongra | Vulcongra | ataque sem mapeador (M35-02): combat, vulcongra soulfire | `data-otservbr-global/monster/mammals/vulcongra.lua` |
| wailing-widow | Wailing Widow | ataque sem mapeador (M35-02): combat, drunk, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/vermins/wailing_widow.lua` |
| walker | Walker | ataque sem mapeador (M35-02): combat, walker skill reducer | `data-otservbr-global/monster/constructs/walker.lua` |
| walking-pillar | Walking Pillar | ataque sem mapeador (M35-02): combat, extended energy chain, largepinkring | `data-otservbr-global/monster/quests/rotten_blood/walking_pillar.lua` |
| wandering-pillar | Wandering Pillar | ataque sem mapeador (M35-02): combat, largeholyring | `data-otservbr-global/monster/quests/rotten_blood/wandering_pillar.lua` |
| war-golem | War Golem | ataque sem mapeador (M35-02): combat, outfit, war golem electrify, war golem skill reducer; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/constructs/war_golem.lua` |
| war-servant | War Servant | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/war_servant.lua` |
| wardragon | Wardragon | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/dragons/war_dragon.lua` |
| warlock | Warlock | ataque sem mapeador (M35-02): combat, firefield, speed, warlock skill reducer; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/humans/warlock.lua` |
| warlord-ruzad | Warlord Ruzad | invocação (M35-02) | `data-otservbr-global/monster/bosses/warlord_ruzad.lua` |
| wasp | Wasp | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/vermins/wasp.lua` |
| waspoid | Waspoid | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/vermins/waspoid.lua` |
| water-elemental | Water Elemental | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/elementals/water_elemental.lua` |
| weak-soul | Weak Soul | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/soul_war/weak_soul.lua` |
| weakened-demon | Weakened Demon | defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/bosses/weakened_demon.lua` |
| weakened-frazzlemaw | Weakened Frazzlemaw | ataque sem mapeador (M35-02): combat, condition, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/magicals/weakened_frazzlemaw.lua` |
| weakened-glooth-horror | Weakened Glooth Horror | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/hero_of_rathleton/weakened_glooth_horror.lua` |
| weakened-shlorg | Weakened Shlorg | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), shlorg paralyze; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/weakened_shlorg.lua` |
| webster | Webster | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/svargrond_arena/warlord/webster.lua` |
| weeper | Weeper | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/constructs/weeper.lua` |
| werebadger | Werebadger | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/lycanthropes/werebadger.lua` |
| werebear | Werebear | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/lycanthropes/werebear.lua` |
| wereboar | Wereboar | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/lycanthropes/wereboar.lua` |
| werecrocodile | Werecrocodile | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/lycanthropes/werecrocodile.lua` |
| werefox | Werefox | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/lycanthropes/werefox.lua` |
| werehyaena | Werehyaena | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/lycanthropes/werehyaena.lua` |
| werehyaena-shaman | Werehyaena Shaman | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/lycanthropes/werehyaena_shaman.lua` |
| werelion | Werelion | ataque sem mapeador (M35-02): combat, werelion wave; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/lycanthropes/werelion.lua` |
| werelioness | Werelioness | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/lycanthropes/werelioness.lua` |
| werepanther | Werepanther | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/lycanthropes/werepanther.lua` |
| weretiger | Weretiger | ataque sem mapeador (M35-02): combat, energy chain; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/lycanthropes/weretiger.lua` |
| werewolf | Werewolf | ataque sem mapeador (M35-02): combat, outfit, werewolf skill reducer; defesa com magia sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/lycanthropes/werewolf.lua` |
| whirling-blades | Whirling Blades | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_dream_courts/whirling_blades.lua` |
| white-lion | White Lion | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/mammals/white_lion.lua` |
| white-pale | White Pale | ataque sem mapeador (M35-02): combat, condition, white pale paralyze; defesa com magia sem mapeador (M35-02): white pale summon | `data-otservbr-global/monster/raids/white_pale.lua` |
| white-shade | White Shade | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): invisible | `data-otservbr-global/monster/undeads/white_shade.lua` |
| white-tiger | White Tiger | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/mammals/white_tiger.lua` |
| white-weretiger | White Weretiger | ataque sem mapeador (M35-02): combat, energy ring, white weretiger ice ring; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/lycanthropes/white_weretiger.lua` |
| wiggler | Wiggler | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), speed; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/vermins/wiggler.lua` |
| wild-fire-magic | Wild Fire Magic | sem aparência (lookType 0); defesa com magia sem mapeador (M35-02): effect | `data-otservbr-global/monster/wild_magics/wild_fire_magic.lua` |
| wild-fury-magic | Wild Fury Magic | sem aparência (lookType 0); defesa com magia sem mapeador (M35-02): effect | `data-otservbr-global/monster/wild_magics/wild_fury_magic.lua` |
| wild-knowledge | Wild Knowledge | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/wild_knowledge.lua` |
| wild-nature-magic | Wild Nature Magic | sem aparência (lookType 0); defesa com magia sem mapeador (M35-02): effect | `data-otservbr-global/monster/wild_magics/wild_nature_magic.lua` |
| wild-warrior | Wild Warrior | defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/humans/wild_warrior.lua` |
| wild-water-magic | Wild Water Magic | sem aparência (lookType 0); defesa com magia sem mapeador (M35-02): effect | `data-otservbr-global/monster/wild_magics/wild_water_magic.lua` |
| wildness-of-urmahlullu | Wildness of Urmahlullu | ataque sem mapeador (M35-02): combat, urmahlulluring | `data-otservbr-global/monster/quests/kilmaresh/wildness_of_urmahlullu.lua` |
| willi-wasp | Willi Wasp | ataque sem mapeador (M35-02): melee (condição/tipo/chance/duplicado) | `data-otservbr-global/monster/bosses/williwasp.lua` |
| wilting-leaf-golem | Wilting Leaf Golem | ataque sem mapeador (M35-02): combat, condition, melee (condição/tipo/chance/duplicado), speed | `data-otservbr-global/monster/plants/wilting_leaf_golem.lua` |
| wine-cask | Wine Cask | aparência por item (lookTypeEx 2521) — só outfit é resolvido; speed 0 (monstro imóvel) — o schema exige velocidade positiva | `data-otservbr-global/monster/quests/cults_of_tibia/bosses/wine_cask.lua` |
| wisdom-of-urmahlullu | Wisdom of Urmahlullu | ataque sem mapeador (M35-02): combat, urmahlulluring | `data-otservbr-global/monster/quests/kilmaresh/wisdom_of_urmahlullu.lua` |
| wisp | Wisp | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible, speed | `data-otservbr-global/monster/fey/wisp.lua` |
| witch | Witch | ataque sem mapeador (M35-02): combat, firefield, outfit | `data-otservbr-global/monster/humans/witch.lua` |
| woodling | Woodling | ataque sem mapeador (M35-02): combat, woodling paralyze | `data-otservbr-global/monster/dawnport/woodling.lua` |
| worker-golem | Worker Golem | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/constructs/worker_golem.lua` |
| world-devourer | World Devourer | ataque sem mapeador (M35-02): anomaly break, combat, devourer summon | `data-otservbr-global/monster/quests/heart_of_destruction/world_devourer.lua` |
| worm-priestess | Worm Priestess | ataque sem mapeador (M35-02): combat, worm priestess paralyze; defesa com magia sem mapeador (M35-02): combat, haste | `data-otservbr-global/monster/humanoids/worm_priestess.lua` |
| wormling | Wormling | ataque sem mapeador (M35-02): combat, drunk; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/feaster_of_souls/wormling.lua` |
| wrath-of-the-emperor | Wrath of the Emperor | ataque sem mapeador (M35-02): combat, speed; invocação (M35-02) | `data-otservbr-global/monster/quests/wrath_of_the_emperor/wrath_of_the_emperor.lua` |
| wyrm | Wyrm | ataque sem mapeador (M35-02): combat, wyrm wave; defesa com magia sem mapeador (M35-02): combat, effect | `data-otservbr-global/monster/dragons/wyrm.lua` |
| wyvern | Wyvern | ataque sem mapeador (M35-02): condition, drunk, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/reptiles/wyvern.lua` |
| xenia | Xenia | ataque sem mapeador (M35-02): drunk; defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/raids/xenia.lua` |
| xogixath | Xogixath | ataque sem mapeador (M35-02): combat, sudden death rune | `data-otservbr-global/monster/quests/kilmaresh/xogixath.lua` |
| yaga-the-crone | Yaga the Crone | ataque sem mapeador (M35-02): combat, condition, firefield; defesa com magia sem mapeador (M35-02): invisible, outfit | `data-otservbr-global/monster/bosses/yaga_the_crone.lua` |
| yakchal | Yakchal | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat; invocação (M35-02) | `data-otservbr-global/monster/raids/yakchal.lua` |
| yalahari-despoiler | Yalahari Despoiler | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_secret_library/yalahari_despoiler.lua` |
| yeti | Yeti | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/mammals/yeti.lua` |
| yielothax | Yielothax | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/extra_dimensional/yielothax.lua` |
| yirkas-blue-scales | Yirkas Blue Scales | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/ancient_feud/yirkas_blue_scales.lua` |
| young-goanna | Young Goanna | ataque sem mapeador (M35-02): combat, melee (condição/tipo/chance/duplicado); defesa com magia sem mapeador (M35-02): speed | `data-otservbr-global/monster/reptiles/young_goanna.lua` |
| young-sea-serpent | Young Sea Serpent | ataque sem mapeador (M35-02): combat, young sea serpent drown; defesa com magia sem mapeador (M35-02): combat, speed | `data-otservbr-global/monster/reptiles/young_sea_serpent.lua` |
| zamulosh | Zamulosh | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, zamulosh invisible, zamulosh tp; invocação (M35-02) | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/zamulosh.lua` |
| zamulosh2 | Zamulosh | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/zamulosh2.lua` |
| zamulosh3 | Zamulosh | ataque sem mapeador (M35-02): speed | `data-otservbr-global/monster/quests/ferumbras_ascension/bosses/zamulosh3.lua` |
| zanakeph | Zanakeph | ataque sem mapeador (M35-02): combat, undead dragon curse; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/killing_in_the_name_of/zanakeph.lua` |
| zarabustor | Zarabustor | ataque sem mapeador (M35-02): combat, firefield, speed, warlock skill reducer; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/bosses/zarabustor.lua` |
| zavarash | Zavarash | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, invisible, speed; invocação (M35-02) | `data-otservbr-global/monster/bosses/zavarash.lua` |
| zevelon-duskbringer | Zevelon Duskbringer | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat, invisible; invocação (M35-02) | `data-otservbr-global/monster/bosses/zevelon_duskbringer.lua` |
| zombie | Zombie | ataque sem mapeador (M35-02): combat | `data-otservbr-global/monster/undeads/zombie.lua` |
| zoralurk | Zoralurk | ataque sem mapeador (M35-02): combat; defesa com magia sem mapeador (M35-02): combat, outfit, speed; invocação (M35-02) | `data-otservbr-global/monster/bosses/zoralurk.lua` |
| zorvorax | Zorvorax | ataque sem mapeador (M35-02): combat, undead dragon curse; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/quests/the_first_dragon/bosses/zorvorax.lua` |
| zugurosh | Zugurosh | ataque sem mapeador (M35-02): combat, condition; defesa com magia sem mapeador (M35-02): combat, invisible | `data-otservbr-global/monster/quests/the_inquisition/zugurosh.lua` |
| zulazza-the-corruptor | Zulazza the Corruptor | ataque sem mapeador (M35-02): combat, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/raids/zulazza_the_corruptor.lua` |
| zushuka | Zushuka | ataque sem mapeador (M35-02): combat, outfit, speed; defesa com magia sem mapeador (M35-02): combat | `data-otservbr-global/monster/bosses/zushuka.lua` |
