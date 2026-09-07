# Quests

**Status:** não implementado
**PRD:** §28
**Épico:** E11

## Comportamento

Quests usam mapas instanciados, potencialmente maiores e mais exploráveis que uma hunt, nos quais o personagem pode precisar andar manualmente, descobrir caminhos e resolver um objetivo. Podem ser feitas solo ou em party — não existe tamanho mínimo global, e o tamanho máximo é definido individualmente por cada quest. Não existem checkpoints no modelo inicial: a quest não salva progresso parcial intermediário. Repetibilidade também depende da quest específica — algumas são únicas, outras repetíveis —, e o framework precisa suportar os dois casos.

A promoção de vocação (`progressao.md`, §9.2) é o caso mais importante de quest única e permanente no MVP.

## Regras

- Mapas instanciados, com exploração e movimentação manual.
- Solo ou party; sem mínimo global de membros.
- Tamanho máximo de party definido individualmente por cada quest.
- Sem checkpoints no modelo inicial.
- Repetibilidade definida por quest: algumas únicas, outras repetíveis.
- A quest de promoção de vocação é única e permanente.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Tamanho máximo de party | definido individualmente por quest (sem valor global) | caminho previsto: `packages/content/quests` |
| Checkpoints | inexistentes no modelo inicial | caminho previsto: `packages/content/quests` |
| Repetibilidade | por quest (única ou repetível) | caminho previsto: `packages/content/quests` |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema.

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
