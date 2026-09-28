# Relatório de importação — preço de NPC (M34-03/#574)

Fonte: `canary` em `47dfd51f45280a59a1d3e50ba7edd573d7234446`.

1036 arquivo(s) de NPC lidos, 9885 entrada(s) de loja agregadas, 123 descartada(s) por `storageKey` (preço condicionado a quest — DT-02).

## Exclusões

- Nah'Bob (`nah_bob.lua`) — economia própria do `data-otservbr-global`, não fato do Tibia real (precedente #524, ADR 0037 d.4; DT-01).

## Arquivos fora do corte

| arquivo | motivo |
|---|---|
| `angus.lua` | expressão "MemberExpression" não suportada (linha 660) |
| `harog.lua` | expressão "MemberExpression" não suportada (linha 30) |
| `ivalisse.lua` | erro de sintaxe Lua: [95:186] code unit U+2014 is not allowed in the current encoding mode |
| `test_server.lua` | expressão "CallExpression" não suportada — tabela de dado não chama função (linha 512) |

## Preço de supply/munição (autoral)

Nenhuma mudança nesta importação — o dado commitado já confere com o Canary.

## Sem preço resolvido

- light-stone-shower-rune (clientId 21351): nenhum NPC com "buy" encontrado
