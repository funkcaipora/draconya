# Relatório de importação — imbuements

Fonte: `canary` em `47dfd51f45280a59a1d3e50ba7edd573d7234446`.

95 entidade(s) geradas em 3 fatia(s):

- `bases.json`: 3
- `categories.json`: 20
- `imbuements.json`: 72

## Notas

- 3 base(s), 20 categoria(s), 72 imbuement(s) gerado(s); 0 entrada(s) descartada(s) por efeito fora do vocabulário conhecido.
- 22 material(is) sem correspondente no catálogo real de itens (`packages/content/data/appearances/baseline.json.items` invertido) — a entidade é gerada do mesmo jeito, só o material fica de fora (ver linhas abaixo).
- 46 scroll(s) — sempre fora da entidade gerada, item da Loja (M22).
- `iconid` (aparência do imbuement) e `storage` (chave de conquista do Canary) nunca entram na entidade gerada — invariante 6 e "só dado" desta issue, respectivamente.

## Fora do corte (68)

O pacote de arte 13.32 não desenha, ou o `sim` ainda não executa a mecânica (ADR 0038 decisão 5).
Reimportar recupera automaticamente o que um schema futuro passar a aceitar.

| id | nome | motivo | fonte |
|---|---|---|---|
| bash-2:scroll:51724 | Bash (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| bash-3:item:10405 | Bash (tier 3) — material | material ausente do catálogo de itens (id do Canary 10405, count 10) | `data/XML/imbuements.xml` |
| bash-3:scroll:51444 | Bash (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| blockade-1:item:9641 | Blockade (tier 1) — material | material ausente do catálogo de itens (id do Canary 9641, count 20) | `data/XML/imbuements.xml` |
| blockade-2:item:9641 | Blockade (tier 2) — material | material ausente do catálogo de itens (id do Canary 9641, count 20) | `data/XML/imbuements.xml` |
| blockade-2:scroll:51725 | Blockade (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| blockade-3:item:9641 | Blockade (tier 3) — material | material ausente do catálogo de itens (id do Canary 9641, count 20) | `data/XML/imbuements.xml` |
| blockade-3:scroll:51445 | Blockade (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| chop-2:scroll:51726 | Chop (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| chop-3:scroll:51446 | Chop (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| cloud-fabric-2:scroll:51727 | Cloud Fabric (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| cloud-fabric-3:scroll:51447 | Cloud Fabric (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| demon-presence-2:scroll:51728 | Demon Presence (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| demon-presence-3:scroll:51448 | Demon Presence (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| dragon-hide-2:scroll:51729 | Dragon Hide (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| dragon-hide-3:scroll:51449 | Dragon Hide (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| electrify-2:scroll:51730 | Electrify (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| electrify-3:scroll:51450 | Electrify (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| epiphany-2:scroll:51731 | Epiphany (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| epiphany-3:item:10309 | Epiphany (tier 3) — material | material ausente do catálogo de itens (id do Canary 10309, count 15) | `data/XML/imbuements.xml` |
| epiphany-3:scroll:51451 | Epiphany (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| featherweight-2:item:25702 | Featherweight (tier 2) — material | material ausente do catálogo de itens (id do Canary 25702, count 10) | `data/XML/imbuements.xml` |
| featherweight-2:scroll:51732 | Featherweight (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| featherweight-3:item:25702 | Featherweight (tier 3) — material | material ausente do catálogo de itens (id do Canary 25702, count 10) | `data/XML/imbuements.xml` |
| featherweight-3:scroll:51452 | Featherweight (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| frost-2:scroll:51733 | Frost (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| frost-3:scroll:51453 | Frost (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| lich-shroud-1:item:11466 | Lich Shroud (tier 1) — material | material ausente do catálogo de itens (id do Canary 11466, count 25) | `data/XML/imbuements.xml` |
| lich-shroud-2:item:11466 | Lich Shroud (tier 2) — material | material ausente do catálogo de itens (id do Canary 11466, count 25) | `data/XML/imbuements.xml` |
| lich-shroud-2:scroll:51734 | Lich Shroud (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| lich-shroud-3:item:11466 | Lich Shroud (tier 3) — material | material ausente do catálogo de itens (id do Canary 11466, count 25) | `data/XML/imbuements.xml` |
| lich-shroud-3:scroll:51454 | Lich Shroud (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| precision-2:scroll:51735 | Precision (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| precision-3:scroll:51455 | Precision (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| punch-2:scroll:51736 | Punch (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| punch-3:scroll:51456 | Punch (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| quara-scale-2:scroll:51737 | Quara Scale (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| quara-scale-3:scroll:51457 | Quara Scale (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| reap-1:item:11484 | Reap (tier 1) — material | material ausente do catálogo de itens (id do Canary 11484, count 25) | `data/XML/imbuements.xml` |
| reap-2:item:11484 | Reap (tier 2) — material | material ausente do catálogo de itens (id do Canary 11484, count 25) | `data/XML/imbuements.xml` |
| reap-2:scroll:51738 | Reap (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| reap-3:item:11484 | Reap (tier 3) — material | material ausente do catálogo de itens (id do Canary 11484, count 25) | `data/XML/imbuements.xml` |
| reap-3:scroll:51458 | Reap (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| scorch-2:scroll:51739 | Scorch (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| scorch-3:scroll:51459 | Scorch (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| slash-1:item:9691 | Slash (tier 1) — material | material ausente do catálogo de itens (id do Canary 9691, count 25) | `data/XML/imbuements.xml` |
| slash-2:item:21202 | Slash (tier 2) — material | material ausente do catálogo de itens (id do Canary 21202, count 25) | `data/XML/imbuements.xml` |
| slash-2:item:9691 | Slash (tier 2) — material | material ausente do catálogo de itens (id do Canary 9691, count 25) | `data/XML/imbuements.xml` |
| slash-2:scroll:51740 | Slash (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| slash-3:item:21202 | Slash (tier 3) — material | material ausente do catálogo de itens (id do Canary 21202, count 25) | `data/XML/imbuements.xml` |
| slash-3:item:9691 | Slash (tier 3) — material | material ausente do catálogo de itens (id do Canary 9691, count 25) | `data/XML/imbuements.xml` |
| slash-3:scroll:51460 | Slash (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| snake-skin-1:item:17823 | Snake Skin (tier 1) — material | material ausente do catálogo de itens (id do Canary 17823, count 25) | `data/XML/imbuements.xml` |
| snake-skin-2:item:17823 | Snake Skin (tier 2) — material | material ausente do catálogo de itens (id do Canary 17823, count 25) | `data/XML/imbuements.xml` |
| snake-skin-2:scroll:51741 | Snake Skin (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| snake-skin-3:item:17823 | Snake Skin (tier 3) — material | material ausente do catálogo de itens (id do Canary 17823, count 25) | `data/XML/imbuements.xml` |
| snake-skin-3:scroll:51461 | Snake Skin (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| strike-2:scroll:51742 | Strike (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| strike-3:scroll:51462 | Strike (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| swiftness-2:scroll:51743 | Swiftness (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| swiftness-3:scroll:51463 | Swiftness (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| vampirism-2:scroll:51744 | Vampirism (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| vampirism-3:item:9663 | Vampirism (tier 3) — material | material ausente do catálogo de itens (id do Canary 9663, count 5) | `data/XML/imbuements.xml` |
| vampirism-3:scroll:51464 | Vampirism (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| venom-2:scroll:51745 | Venom (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| venom-3:scroll:51465 | Venom (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| void-2:scroll:51747 | Void (tier 2) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
| void-3:scroll:51467 | Void (tier 3) — scroll | scroll — fora do catálogo (item da Loja, M22) | `data/XML/imbuements.xml` |
