# Economia, supply e Market

**Status:** parcial — gold por abate (FUN-63), supply abstrato debitando gold (FUN-77) e loot de item com Caixa de Loot da Sessão (FUN-88) implementados; autovenda, Market e Coins não implementados
**PRD:** §20, §32, §33, §43.5
**Épico:** E5 (supply abstrato, ledger); E13 (Market, Coins por gold)

## Comportamento

Poções, runas e munições comuns não existem como itens físicos carregados durante a hunt: usar um supply desconta gold diretamente, sem gerenciar pilha nem reposição. Quando um monstro "dropa" um item desse tipo, o valor correspondente entra na economia como gold, não como pilha física de consumível. Os preços de poções e runas usam o Tibia como referência inicial de balanceamento. A munição tem catálogo próprio desde o ADR 0026 (decisão 3, #151): é uma seleção por família, a `arrow` é grátis e cada tiro das outras debita o preço dela — o modelo do Huntera, ver `items.md`. Todos os valores devem ser configuráveis.

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
- Supplies comuns (poções, runas) não existem fisicamente; uso debita gold diretamente. Munição também não existe fisicamente: é uma seleção (`packages/content/data/ammunition/`), e cada tiro da munição paga debita o preço dela.
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
| Preço de venda de cada item ao NPC | `value` por item — `bow` 130, `machete` 6, `cheese` 0 (não se vende); mochila `[ABERTO — 5, provisório]` | `packages/content/data/items/*.json`, campo `value` (#188, ADR 0027) |
| Preço da Poção de Vida | 45 `[ABERTO — valor provisório: 45]` | `packages/content/data/supplies/health-potion.json` |
| Preço da Poção de Mana | 50 `[ABERTO — valor provisório: 50]` | `packages/content/data/supplies/mana-potion.json` |
| Preço por tiro da munição | arrow 0 (grátis), sniper arrow 5 `[ABERTO — valor provisório: 5, preço do NPC no Tibia]`, onyx arrow 7 `[ABERTO — valor provisório: 7, preço do NPC no Tibia]` | `packages/content/data/ammunition/*.json`, `price` |

## Em aberto

- ~~[ABERTO] Preço de arrows e demais munições (§20.2, §43.5)~~ → **Resolvido:** a arrow é grátis e as outras debitam por tiro (ADR 0026, decisão 3); os valores 5 e 7 são provisórios, em `packages/content/data/ammunition/`.

## Supply abstrato, na prática (FUN-77)

§20.1 **[DECIDIDO]**: poção e runa não existem fisicamente — usar debita gold direto. Por isso um
supply tem `price` e não tem peso, slot nem instância, e por isso ele mora em
`packages/content/data/supplies/` e não no catálogo de itens.

O saldo que a sessão enxerga é o **gold de entrada mais o delta da sessão**. Duas consequências:

- o loot desta hunt já dá para virar poção, sem passar pelo banco. Exigir o contrário faria a
  poção só chegar depois de encerrar a sessão, que é o oposto do idle-first;
- o gold de entrada vem do **ticket**, nunca do cliente (invariante 4). Um saldo vindo do socket
  seria poção de graça, e não haveria como distinguir isso de um jogador rico. Ticket emitido por
  um `api` antigo, sem o campo, entra com zero e recusa gasto — degrada para o lado seguro.

**O saldo nunca fica negativo**, e a garantia é a ordem: o débito é recusado antes, não corrigido
depois. O `Math.max(0, …)` que o ledger aplica ao creditar continua lá, mas como rede de
segurança — não como a regra.

O gasto vira `aggregates.goldSpent` na sessão, e o extrato leva ganho e gasto ao ledger na mesma
linha (`goldGained - goldSpent`), com `(session_id, seq)` único: retry nunca duplica
(invariante 10).

**Gold zerado não encerra a hunt** (§20.3, sem a regra de saída): o personagem fica, não paga o
supply e pode morrer. É comportamento, não erro — mas a hunt que acabou em morte precisa ter
explicação na tela de retorno, então a primeira recusa por falta de gold vira uma linha
(`supply-unaffordable`) no extrato. **Uma** linha, não uma por tentativa: a categoria de poção
tenta a cada mudança do mundo, e uma linha por tentativa encheria a lista curta até ela deixar de
ser lista. É a mesma escolha do aviso de stamina zerada. A regra de saída "sair quando o gold
acabar" é da FUN-86.

## Divergências do PRD

~~**Loot de item não cai, e a tabela recusa tentar.**~~ → **Resolvido (FUN-76, FUN-88):** existe
catálogo, `loot.items` é conferido contra ele, e o item cai — mochila se couber, Caixa de Loot da
Sessão se não. Ver [`items.md`](./items.md).
