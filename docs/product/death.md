# Morte

**Status:** não implementado
**PRD:** §26
**Épico:** E2

## Comportamento

Na morte em PvE normal, a hunt é encerrada, o personagem volta para a área inicial/PZ com HP e Mana totalmente restaurados, sem debuff temporário, sem sistema de bless, e sem perder item ou equipamento algum — morte no Draconya nunca é uma perda material.

O que a morte de fato custa é XP: a penalidade base é 60% da quantidade de XP necessária para completar o level atual, reduzida para 54% em personagens Premium. Essa penalidade pode causar perda de level, mas o personagem nunca cai abaixo do level 8 por conta dela — esse piso é uma proteção fixa.

## Regras

- Morte encerra a hunt e devolve o personagem à PZ.
- HP e Mana são restaurados totalmente.
- Sem debuff temporário, sem perda de item/equipamento, sem sistema de bless.
- Penalidade de XP: 60% da XP necessária para completar o level atual (Free).
- Penalidade de XP reduzida: 54% (Premium).
- A penalidade pode causar perda de level, mas nunca abaixo do level 8.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Penalidade de XP — Free | 60% da XP necessária para o level atual | caminho previsto: `packages/content/economia` |
| Penalidade de XP — Premium | 54% da XP necessária para o level atual | caminho previsto: `packages/content/economia` |
| Piso de proteção de level | 8 | caminho previsto: `packages/content/economia` |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema.

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
