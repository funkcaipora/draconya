# Relatório de importação — skinning

Fonte: `canary` em `47dfd51f45280a59a1d3e50ba7edd573d7234446`.

62 entidade(s) geradas em 1 fatia(s):

- `skinning.json`: 62

## Notas

- 84 monstros do Canary têm cadáver esfolável (o `monster.corpse` ou um estágio da cadeia de decaimento dele é chave do `config`); 62 estão no catálogo do Draconya e saem como entidade, 22 ficam fora do corte.
- A issue #626 fala em "87 mapeamentos": é a contagem da palavra `newItem` no arquivo (87), que inclui o código da função e os prêmios de quest. A tabela declara 62 chaves simples (57 são estágio do cadáver de algum monstro do Canary) e 2 listas de prêmio.
- `chanceRange` do Lua: 100000 (confere com `SKINNING_CHANCE_SCALE`).
- Chaves do `config` que nenhum monstro do Canary tem como estágio de cadáver (5): 4173 (dead rabbit, obsidian-knife), 7441 (ice cube, obsidian-knife), 7442 (ice cube, obsidian-knife), 7444 (ice cube, obsidian-knife), 7445 (ice cube, obsidian-knife). São ids de item de mapa que nenhum `monster.corpse` nem estágio da cadeia dele alcança (o cadáver decorativo, os cubos de gelo da escultura) — ficam de fora, sem monstro.
- Entradas que são LISTA de prêmios, não um material só (2): 10426 (piece of marble rock), 12816 (unknown item) — o boss da abóbora (armazenamento de quest de 4 h) e o mármore (escultura de item de mapa) não são caça.
- O ramo `target.itemid == 4301` da faca (quest Rottin Wood and the Married Men: o segundo estágio do cadáver do coelho rende o item 12172 sem sorteio e sem consumir o cadáver, sem conferir a quest) fica fora — é objetivo de quest, não caça, e o `sim` não tem quest. A esfola de coelho aqui é só a da tabela (a janela de 10 s do `6017`).

## Fora do corte (22)

O pacote de arte 13.32 não desenha, ou o `sim` ainda não executa a mecânica (ADR 0038 decisão 5).
Reimportar recupera automaticamente o que um schema futuro passar a aceitar.

| id | nome | motivo | fonte |
|---|---|---|---|
| a-greedy-eye | A Greedy Eye | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/quests/soul_war/normal_monsters/furious_crater/a_greedy_eye.lua` |
| an-observer-eye | An Observer Eye | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/quests/mysterious_ornate_chest/an_observer_eye.lua` |
| arachir-the-ancient-one | Arachir the Ancient One | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/raids/arachir_the_ancient_one.lua` |
| bonebeast | Bonebeast | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/undeads/bonebeast.lua` |
| bullwark | Bullwark | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/bosses/bullwark.lua` |
| dreadbeast | Dreadbeast | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/quests/the_inquisition/dreadbeast.lua` |
| fallen-moohtah-master-ghar | Fallen Mooh'tah Master Ghar | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/quests/svargrond_arena/warlord/fallen_mooh'tah_master_ghar.lua` |
| grand-mother-foulscale | Grand Mother Foulscale | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/raids/grand_mother_foulscale.lua` |
| infernatil | Infernatil | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/bosses/infernatil.lua` |
| lizard-chosen | Lizard Chosen | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/reptiles/lizard_chosen.lua` |
| lizard-dragon-priest | Lizard Dragon Priest | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/reptiles/lizard_dragon_priest.lua` |
| lizard-magistratus | Lizard Magistratus | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/reptiles/lizard_magistratus.lua` |
| lizard-snakecharmer | Lizard Snakecharmer | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/reptiles/lizard_snakecharmer.lua` |
| minotaur-amazon | Minotaur Amazon | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/humanoids/minotaur_amazon.lua` |
| minotaur-cult-prophet | Minotaur Cult Prophet | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/humanoids/minotaur_cult_prophet.lua` |
| minotaur-hunter | Minotaur Hunter | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/humanoids/minotaur_hunter.lua` |
| moohtah-master | Mooh'Tah Master | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/quests/the_new_frontier/mooh'tah_master.lua` |
| moohtah-warrior | Mooh'Tah Warrior | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/humanoids/mooh'tah_warrior.lua` |
| ribstride | Ribstride | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/quests/killing_in_the_name_of/ribstride.lua` |
| the-voice-of-ruin | The Voice of Ruin | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/raids/the_voice_of_ruin.lua` |
| vampire-viscount | Vampire Viscount | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/undeads/vampire_viscount.lua` |
| worm-priestess | Worm Priestess | monstro fora do catálogo do Draconya | `data-otservbr-global/monster/humanoids/worm_priestess.lua` |
