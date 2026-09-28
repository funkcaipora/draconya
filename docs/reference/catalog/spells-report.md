# Relatório de importação — spells

Fonte: `canary` em `47dfd51f45280a59a1d3e50ba7edd573d7234446`.

73 entidade(s) geradas em 4 fatia(s):

- `druid.json`: 26
- `knight.json`: 13
- `paladin.json`: 11
- `sorcerer.json`: 23

## Fora do corte (4)

O pacote de arte 13.32 não desenha, ou o `sim` ainda não executa a mecânica (ADR 0038 decisão 5).
Reimportar recupera automaticamente o que um schema futuro passar a aceitar.

| id | nome | motivo | fonte |
|---|---|---|---|
| Energy Beam | Energy Beam | onGetFormulaValues: "return" com 1 valor(es), esperava 2 (min, max) | `data/scripts/spells/attack/energy_beam.lua` |
| Energy Wave | Energy Wave | onGetFormulaValues: "return" com 1 valor(es), esperava 2 (min, max) | `data/scripts/spells/attack/energy_wave.lua` |
| explosion rune | explosion rune | levelFactor difere entre min e max — forma não suportada | `data/scripts/runes/explosion.lua` |
| Great Energy Beam | Great Energy Beam | onGetFormulaValues: "return" com 1 valor(es), esperava 2 (min, max) | `data/scripts/spells/attack/great_energy_beam.lua` |
