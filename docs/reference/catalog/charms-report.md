# Relatório de importação — charms

Fonte: `canary` em `47dfd51f45280a59a1d3e50ba7edd573d7234446`.

25 entidade(s) geradas em 1 fatia(s):

- `charms.json`: 25

## Notas

- 25 charms lidos de `data/scripts/systems/bestiary_charms.lua`; 0 fora do corte.
- A issue #602 previa 20 charms; o arquivo real do Canary `main` declara 25 — o número que saiu daqui é o do arquivo, não o da premissa original.
- `damageType` usa um vocabulário próprio deste catálogo, incluindo `neutral` (Carnage/Overpower/Overflux) — ausente do vocabulário de dano do resto do conteúdo (`DAMAGE_TYPES`); a resolução em combate fica para o `combat-v4` (#603).
- `effect`/`messageCancel`/`messageServerLog`/`description` do Canary não saem aqui (invariante 6 e a Direção da issue, que só pede os sete campos mecânicos).

Nada foi deixado de fora nesta importação — todo id do corte considerado virou entidade.
