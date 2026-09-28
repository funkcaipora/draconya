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

| slug | preço anterior | preço novo | fonte |
|---|---|---|---|
| `destroy-field-rune` | 10 | 15 | `asima.lua` |
| `energy-bomb-rune` | 22 | 203 | `alexander.lua` |
| `energy-field-rune` | 12 | 38 | `asima.lua` |
| `energy-wall-rune` | 18 | 85 | `asima.lua` |
| `fire-bomb-rune` | 30 | 147 | `asima.lua` |
| `fire-field-rune` | 20 | 28 | `asima.lua` |
| `fire-wall-rune` | 32 | 61 | `asima.lua` |
| `magic-wall-rune` | 45 | 116 | `alexander.lua` |
| `poison-bomb-rune` | 16 | 85 | `alexander.lua` |
| `poison-field-rune` | 8 | 21 | `asima.lua` |
| `poison-wall-rune` | 14 | 52 | `asima.lua` |
| `wild-growth-rune` | 25 | 160 | `alexander.lua` |
