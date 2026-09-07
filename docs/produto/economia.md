# Economia, supply e Market

**Status:** não implementado
**PRD:** §20, §32, §33, §43.5
**Épico:** E5 (supply abstrato, ledger); E13 (Market, Coins por gold)

## Comportamento

Poções, runas e munições comuns não existem como itens físicos carregados durante a hunt: usar um supply desconta gold diretamente, sem gerenciar pilha nem reposição. Quando um monstro "dropa" um item desse tipo, o valor correspondente entra na economia como gold, não como pilha física de consumível. Os preços de poções e runas usam o Tibia como referência inicial de balanceamento; o preço de arrows e demais munições ainda não foi definido. Todos os valores devem ser configuráveis.

Se o gold do personagem acabar durante a hunt: com a regra "sair quando o gold acabar" ativa no bot, ele sai da hunt; sem essa regra, ele permanece, mas deixa de conseguir pagar os supplies necessários e pode morrer (ver `bot.md`, §13.9).

Gold entra na economia principalmente por loot/venda de itens, autovenda, e recompensas de quest quando aplicável — daily quests com pequenas recompensas podem existir depois, mas não são pilar econômico do MVP. Gold sai por supplies abstratos, taxa de imbuement, rerolls adicionais de Prey, compras de itens/Coins no Market, e futuramente pela Forja.

O Market é global, acessível a partir de qualquer cidade/PZ relevante, e não cobra taxa de listagem nem comissão sobre venda. Todo item físico negociável pode ser colocado à venda por gold, respeitando as regras de existência de cada item; supplies abstratos, por não existirem fisicamente, não são listados como pilha tradicional. Coins — que pertencem à conta, não ao personagem — também podem ser vendidas no Market por gold, transferidas de conta vendedora para conta compradora. Essa venda cria a ponte oficial entre dinheiro real e economia de gold, e por isso a transação precisa ser altamente auditável e consistente.

## Regras

- Supplies comuns (poções, runas, munições) não existem fisicamente; uso debita gold diretamente.
- Drop de supply por monstro credita gold, não gera pilha física.
- Sem regra de saída por gold zerado ativa: personagem permanece na hunt, sem conseguir pagar supplies, podendo morrer.
- Com a regra ativa: personagem sai da hunt quando o gold acaba.
- Market sem taxa de listagem e sem comissão sobre venda.
- Coins são vendáveis no Market por gold, transferindo-se de conta para conta.
- Supplies abstratos não são listados no Market como pilha tradicional (não existem como item físico).

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Taxa de listagem no Market | 0% | caminho previsto: `packages/content/economia` |
| Comissão sobre venda no Market | 0% | caminho previsto: `packages/content/economia` |
| Preço de poções e runas | referência inicial: preços do Tibia (conteúdo final a definir) | caminho previsto: `packages/content/supply` |
| Preço de arrows e demais munições | `[ABERTO]` | caminho previsto: `packages/content/supply` |

## Em aberto

- Preço de arrows e demais munições, ainda não definido (§20.2, §43.5).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
