# Economia, supply e Market

**Status:** parcial — gold por abate cai e chega ao personagem pelo ledger (FUN-63); supply, Market e Coins não implementados
**PRD:** §20, §32, §33, §43.5
**Épico:** E5 (supply abstrato, ledger); E13 (Market, Coins por gold)

## Comportamento

Poções, runas e munições comuns não existem como itens físicos carregados durante a hunt: usar um supply desconta gold diretamente, sem gerenciar pilha nem reposição. Quando um monstro "dropa" um item desse tipo, o valor correspondente entra na economia como gold, não como pilha física de consumível. Os preços de poções e runas usam o Tibia como referência inicial de balanceamento; o preço de arrows e demais munições ainda não foi definido. Todos os valores devem ser configuráveis.

Se o gold do personagem acabar durante a hunt: com a regra "sair quando o gold acabar" ativa no bot, ele sai da hunt; sem essa regra, ele permanece, mas deixa de conseguir pagar os supplies necessários e pode morrer (ver `bot.md`, §13.9).

Gold entra na economia principalmente por loot/venda de itens, autovenda, e recompensas de quest quando aplicável — daily quests com pequenas recompensas podem existir depois, mas não são pilar econômico do MVP. Gold sai por supplies abstratos, taxa de imbuement, rerolls adicionais de Prey, compras de itens/Coins no Market, e futuramente pela Forja.

O Market é global, acessível a partir de qualquer cidade/PZ relevante, e não cobra taxa de listagem nem comissão sobre venda. Todo item físico negociável pode ser colocado à venda por gold, respeitando as regras de existência de cada item; supplies abstratos, por não existirem fisicamente, não são listados como pilha tradicional. Coins — que pertencem à conta, não ao personagem — também podem ser vendidas no Market por gold, transferidas de conta vendedora para conta compradora. Essa venda cria a ponte oficial entre dinheiro real e economia de gold, e por isso a transação precisa ser altamente auditável e consistente.

## Regras

- Gold de loot é sorteado na morte do monstro, pela tabela `loot.gold` do próprio monstro, com o
  `Rng` da sessão; vira `goldDelta` no personagem e `goldGained` no extrato, e chega à linha do
  personagem pelo ledger com `(session_id, seq)` único — nunca por escrita direta em `gold`
  (invariante 10). Stamina zero bloqueia o loot como bloqueia a XP (§10.2).
- A tabela de loot separa moeda de item: `gold` é campo, `items` é lista — e a lista precisa ser
  vazia até existir catálogo de itens; o carregador recusa o resto.
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
| Loot de gold por monstro (chance, mínimo, máximo) | Rat: 90%, 1–4 | `data/monsters/*.json`, bloco `loot.gold` |
| Taxa de listagem no Market | 0% | caminho previsto: `packages/content/economia` |
| Comissão sobre venda no Market | 0% | caminho previsto: `packages/content/economia` |
| Preço de poções e runas | referência inicial: preços do Tibia (conteúdo final a definir) | caminho previsto: `packages/content/supply` |
| Preço de arrows e demais munições | `[ABERTO]` | caminho previsto: `packages/content/supply` |

## Em aberto

- Preço de arrows e demais munições, ainda não definido (§20.2, §43.5).

## Divergências do PRD

**Loot de item não cai, e a tabela recusa tentar.** O PRD assume item; o código só tem gold.
`loot.items` existe na forma certa e aceita só lista vazia, para o dia em que houver catálogo — e
para ninguém creditar um item fantasma antes disso.
