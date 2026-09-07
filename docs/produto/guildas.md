# Guildas

**Status:** não implementado
**PRD:** §29
**Épico:** E12

## Comportamento

No MVP, guildas começam simples: sem limite máximo de membros, e com três cargos — Líder, Vice-líder e Membro. O Líder tem administração total da guilda. O Vice-líder pode expulsar membros comuns, mas não pode expulsar outro Vice-líder nem o Líder. Progressão de guilda, árvore de guilda e sistemas adicionais ficam para depois do MVP.

## Regras

- Sem limite máximo de membros por guilda.
- Três cargos: Líder, Vice-líder, Membro.
- Líder: administração total.
- Vice-líder: pode expulsar Membros; não pode expulsar Vice-líder nem Líder.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Limite máximo de membros | sem limite | caminho previsto: `packages/content/guildas` |
| Cargos disponíveis | Líder, Vice-líder, Membro | caminho previsto: `packages/content/guildas` |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema.

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
