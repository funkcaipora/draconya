# Economia, consumíveis e Market

**Status:** parcial — gold por abate (FUN-63), suprimento abstrato com gold no uso e munição abstrata com gold no tiro (AB-01/AB-04/AB-05, ADR 0032 d.6/d.7) e loot de item com Caixa de Loot da Sessão (FUN-88) implementados; autovenda, Market e Coins não implementados
**PRD:** §20, §32, §33, §43.5
**Épico:** E5 (consumível, ledger); E13 (Market, Coins por gold)

## Comportamento

Poção e runa são **suprimento abstrato** (ADR 0032 d.6): vivem em `data/supplies/` com `price`,
`effect`, `requires` e `group`, e usar **debita o gold no ato** por `useSupply` — não há item
físico, pilha nem reposição por lote. A munição é **abstrata** pela mesma razão (ADR 0032 d.7):
cada tiro debita o `price` da munição escolhida da família, sem pilha e sem munição grátis. O
único item `consumable` que resta é a `blessing-charge` (a TP-03, M22, é quem a consome). Os
preços usam o Tibia como referência inicial de balanceamento, e todos os valores são
configuráveis.

Se o gold do personagem acabar durante a hunt: com a regra "sair quando o gold acabar" ativa no
bot, ele sai da hunt; sem essa regra, ele permanece, mas deixa de conseguir pagar o próximo
supply e o próximo tiro, e pode morrer (ver `bot.md`, §13.9).

Gold entra na economia principalmente por loot/venda de itens, autovenda, e recompensas de quest
quando aplicável — daily quests com pequenas recompensas podem existir depois, mas não são pilar
econômico do MVP. Gold sai no uso de suprimento e de munição, taxa de imbuement,
rerolls adicionais de Prey, compras de itens/Coins no Market, e futuramente pela Forja.

O Market é global, acessível a partir de qualquer cidade/PZ relevante, e não cobra taxa de
listagem nem comissão sobre venda. Todo item físico negociável pode ser colocado à venda por
gold, respeitando as regras de existência de cada item. Coins — que pertencem à conta, não ao
personagem — também podem
ser vendidas no Market por gold, transferidas de conta vendedora para conta compradora. Essa
venda cria a ponte oficial entre dinheiro real e economia de gold, e por isso a transação precisa
ser altamente auditável e consistente.

## Regras

- Gold de loot é sorteado na morte do monstro, pela tabela `loot.gold` do próprio monstro, com o
  `Rng` da sessão; vira `goldDelta` no personagem e `goldGained` no extrato, e chega à linha do
  personagem pelo ledger com `(session_id, seq)` único — nunca por escrita direta em `gold`
  (invariante 10). Stamina zero bloqueia o loot como bloqueia a XP (§10.2).
- O encerramento só pode remover a sessão e seu snapshot depois de confirmar a gravação do
  extrato no Redis (#267). Tentativas concorrentes aguardam a mesma gravação; falha permite
  retry com o mesmo `(session_id, seq)`. Se o Redis gravou e a resposta se perdeu, repetir não
  duplica gold nem XP, mesmo que o `jobs` já tenha liquidado a primeira tentativa.
- Ao confirmar esse extrato, a sessão incorpora `goldDelta` em `gold` e zera o delta (#241).
  A Cidade reaproveita o mesmo `CharacterRuntime` da hunt; sem essa passagem, um ticket novo
  poderia liquidar o ledger e reencontrar a sessão quente com a base anterior.
- A tabela de loot separa moeda de item: `gold` é campo, `items` é lista — desde a FUN-76/FUN-88
  cada linha de `items` é conferida contra o catálogo, e o carregador recusa só o que não existe
  nele (ver "Divergências" abaixo).
- Suprimento é abstrato: usar **debita o gold no ato** por `useSupply` (`price` do
  `data/supplies/`), e o gasto vira `aggregates.goldSpent` e entra no extrato (ADR 0032 decisão 6,
  invariante 10). Não há estoque a conferir nem lote a comprar: o limitador é o saldo, e o débito
  nunca deixa o saldo negativo — a recusa vem antes, não a correção depois.
- Munição é abstrata (ADR 0032 decisão 7): cada tiro debita o `price` da munição escolhida da
  família, sem pilha e sem fallback grátis; sem saldo que cubra o preço, o tiro não sai.
- Drop de consumível por monstro **não existe**: suprimento e munição não são itens de
  `loot.items`.
- Sem regra de saída por gold zerado ativa: personagem permanece na hunt, sem conseguir pagar o
  próximo supply nem o próximo tiro, podendo morrer.
- Com a regra ativa: personagem sai da hunt quando o gold acaba.
- Market sem taxa de listagem e sem comissão sobre venda.
- O Market é um **livro de ordens de compra e venda** (bid/ask), não uma vitrine de listagem
  única: cada lado mostra vendedor (ou comprador), quantidade, preço unitário e total — o
  desenho do handoff do design system (`ShopModal`, aba "Leilão",
  `ui_kits/draconya/Modals.jsx:226-253`; dados de exemplo em `ui_kits/draconya/data.js:66`, ver
  a spec da issue #262 para os trechos). Decisão de produto de 2026-09-16
  (`docs/design-system-plan.md` §10, item 6): "livro de ordens de compra e venda (vendedor,
  quantidade, preço, total), sem taxa — os dois modelos juntos". A regra de "sem taxa" acima não
  muda; o que esta linha fecha é o MECANISMO, que o PRD (§33.2) deixava em aberto.
- Coins são vendáveis no Market por gold, transferindo-se de conta para conta.
- Em party no modo `shared` (M13, ADR 0027), o supply é rateado na hora — `floor(c/n)` de cada
  presente, resto do usuário — e o loot cai numa bolsa que é **vendida** pelo `value` de cada item
  e dividida entre os presentes a cada saída e no fim; `value: 0` não se vende e vai para o
  líder. É a primeira venda ao NPC do jogo, e usa o mesmo campo que a autovenda (§22.1) vai usar.
  Ver `party.md`.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Loot de gold por monstro (chance, mínimo, máximo) | Rat: 90%, 1–4 | `data/monsters/*.json`, bloco `loot.gold` |
| Taxa de listagem no Market | 0% | caminho previsto: `packages/content/economia` |
| Comissão sobre venda no Market | 0% | caminho previsto: `packages/content/economia` |
| Preço de venda de cada item ao NPC | `value` por item — `bow` 130, `machete` 6, `cheese` 0 (não se vende); mochila `[ABERTO — 5, provisório]` | `packages/content/data/items/*.json`, campo `value` (#188, ADR 0027) |
| Preço da Poção de Vida (gold no uso) | 45 `[ABERTO — valor provisório: 45]` | `packages/content/data/supplies/health-potion.json`, campo `price` |
| Preço da Poção de Mana (gold no uso) | 50 `[ABERTO — valor provisório: 50]` | `packages/content/data/supplies/mana-potion.json`, campo `price` |
| Preço por tiro da munição | arrow 1 `[ABERTO — provisório: 1]`, burst arrow 3 `[ABERTO — provisório: 3]`, sniper arrow 5 `[ABERTO — provisório: 5, preço do NPC no Tibia]`, onyx arrow 7 `[ABERTO — provisório: 7, preço do NPC no Tibia]` | `packages/content/data/ammunition/{arrow,burst-arrow,sniper-arrow,onyx-arrow}.json`, `price` |
| Preço da Avalanche Rune (gold no uso) | 14 `[ABERTO — valor provisório: 14]` | `packages/content/data/supplies/avalanche-rune.json`, campo `price` |

## Em aberto

- ~~[ABERTO] Preço de arrows e demais munições (§20.2, §43.5)~~ → **Resolvido:** a munição é
  abstrata, com `price` por tiro (ADR 0032 d.7, AB-02/AB-05); a `arrow` tem preço maior que zero
  (ponto de partida 1), e os valores 1, 3, 5 e 7 são provisórios, em
  `packages/content/data/ammunition/*.json`.

## Suprimento abstrato, na prática (FUN-77, ADR 0032 d.6)

§20.1 **continua `[DECIDIDO]`**: o suprimento abstrato debita gold por uso e não existe como
pilha. Poção e runa vivem em `data/supplies/` com `price`, `effect`, `requires` e `group`; o uso
chama `useSupply`, que debita `price` do saldo e leva o gasto a `aggregates.goldSpent`. Não há
compra de lote nem caminho `purchase` no ledger — o débito por uso é o desenho.

O que vale do desenho original:

- O saldo que a sessão enxerga é o **gold de entrada mais o delta da sessão**: o loot desta hunt
  já dá para pagar a próxima poção, sem passar pelo banco. Exigir o contrário faria a poção só
  chegar depois de encerrar a sessão, que é o oposto do idle-first.
- O gold de entrada vem do **ticket**, nunca do cliente (invariante 4). Ticket emitido por um `api`
  antigo, sem o campo, entra com zero e recusa o uso — degrada para o lado seguro.
- **O saldo nunca fica negativo**, e a garantia é a ordem: o débito é recusado antes, não
  corrigido depois. O `Math.max(0, …)` que o ledger aplica ao creditar continua como rede de
  segurança.
- O gasto vira `aggregates.goldSpent` na sessão, e o extrato leva ganho e gasto ao ledger na mesma
  linha (`goldGained - goldSpent`), com `(session_id, seq)` único: retry nunca duplica
  (invariante 10).
- **Gold zerado não encerra a hunt** (§20.3, sem a regra de saída): o personagem fica, não paga o
  próximo supply e pode morrer. É comportamento, não erro — mas a primeira recusa por falta vira
  **uma** linha (`supply-unaffordable`) no extrato, não uma por tentativa. A regra de saída "sair
  quando o gold acabar" é da FUN-86.

## Divergências do PRD

~~**Loot de item não cai, e a tabela recusa tentar.**~~ → **Resolvido (FUN-76, FUN-88):** existe
catálogo, `loot.items` é conferido contra ele, e o item cai — mochila se couber, Caixa de Loot da
Sessão se não. Ver [`items.md`](./items.md).

**O §20.1 está de volta.** O PRD tratava o supply como abstração que debitava gold por uso, e é o
que a implementação faz hoje: poção, runa e munição não são itens físicos; usar um supply
desconta gold direto, sem pilha nem reposição (§20.1, `[DECIDIDO]`). A única exceção é a
`blessing-charge`, que segue item `consumable` para a TP-03 (M22) consumir.

**O Market não é uma vitrine de listagem simples — é um livro de ordens (2026-09-16).** O PRD
(§33.2) diz só que "todo item físico negociável pode ser colocado no Market por gold", sem
especificar como a compra/venda acontece. A decisão de produto de 2026-09-16
(`docs/design-system-plan.md` §10, item 6 — a entrar no ADR 0029 via #244) fecha isso como um
livro de ordens de compra e venda, com as colunas comprador/vendedor, quantidade, preço e total,
como o modal "Casa de leilões" do handoff do design system desenha. A regra de "sem taxa" (§32.3
do PRD, já implementada acima) continua igual; só o mecanismo de correspondência entre oferta e
demanda muda de "em aberto" para "livro de ordens". O E13 herda este desenho quando o Market for
implementado; nenhuma tela é construída nesta task (D8 do `docs/design-system-plan.md`).
