# Bestiário

**Status:** não implementado
**PRD:** §18
**Épico:** E7

## Comportamento

A Bestiário recompensa o jogador por abater grandes quantidades de uma mesma criatura, criando uma progressão permanente organizada por família de monstro. Cada monstro pode ter cinco marcos de contagem de kills. Na maioria das criaturas, cada marco alcançado concede +1% de XP PvE permanente. Alguns monstros substituem um ou mais desses bônus de XP por recompensas especiais — bônus de loot PvE, Dodge PvE, resistência física PvE, resistência elemental PvE, redução de penalidade de morte, ou outros bônus aprovados por conteúdo —, sempre individuais ao personagem que os conquistou.

Os bônus de Bestiário valem exclusivamente em PvE; não geram vantagem automática em Guild War (ver `guild-war.md`, §18.5). Abates realizados com stamina em zero não contam para o progresso da Bestiário (ver `stamina.md`).

## Regras

- Cinco marcos de kills por monstro: 10.000 / 25.000 / 50.000 / 100.000 / 200.000.
- Recompensa padrão por marco: +1% de XP PvE permanente.
- Marcos especiais (por monstro) podem substituir o bônus de XP por: bônus de loot PvE, Dodge PvE, resistência física PvE, resistência elemental PvE, redução de penalidade de morte, ou outro bônus aprovado por conteúdo.
- Todos os bônus de Bestiário são individuais ao personagem.
- Bônus de Bestiário valem apenas em PvE.
- Abates com stamina zero não contam para a Bestiário.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Marco 1 | 10.000 kills | caminho previsto: `packages/content/bestiário` |
| Marco 2 | 25.000 kills | caminho previsto: `packages/content/bestiário` |
| Marco 3 | 50.000 kills | caminho previsto: `packages/content/bestiário` |
| Marco 4 | 100.000 kills | caminho previsto: `packages/content/bestiário` |
| Marco 5 | 200.000 kills | caminho previsto: `packages/content/bestiário` |
| Recompensa padrão por marco | +1% XP PvE permanente | caminho previsto: `packages/content/bestiário` |
| Recompensas especiais por monstro (quando aplicável) | variável — loot PvE, Dodge PvE, resistência física/elemental PvE, redução de penalidade de morte, outros | caminho previsto: `packages/content/bestiário` |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema.

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
