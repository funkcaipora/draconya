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
- Supplies comuns (poções, runas) não existem fisicamente; uso debita gold diretamente. Munição também não existe fisicamente — desde a AB-02 é item empilhável (`packages/content/data/items/*-arrow.json`), mas o `sim` v1 ainda debita o preço por tiro pelo caminho do supply até a AB-05 aposentar o fallback grátis.
- Drop de supply por monstro credita gold, não gera pilha física.
- Sem regra de saída por gold zerado ativa: personagem permanece na hunt, sem conseguir pagar supplies, podendo morrer.
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
- Supplies abstratos não são listados no Market como pilha tradicional (não existem como item físico).
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
| Preço da Poção de Vida | 45 `[ABERTO — valor provisório: 45]` | `packages/content/data/items/health-potion.json`, campo `price` |
| Preço da Poção de Mana | 50 `[ABERTO — valor provisório: 50]` | `packages/content/data/items/mana-potion.json`, campo `price` |
| Preço por tiro da munição | arrow 0 (grátis), burst arrow 3 `[ABERTO — valor provisório: 3]`, sniper arrow 5 `[ABERTO — valor provisório: 5, preço do NPC no Tibia]`, onyx arrow 7 `[ABERTO — valor provisório: 7, preço do NPC no Tibia]` | `packages/content/data/items/{arrow,burst-arrow,sniper-arrow,onyx-arrow}.json`, `price` |

## Em aberto

- ~~[ABERTO] Preço de arrows e demais munições (§20.2, §43.5)~~ → **Resolvido:** a arrow é grátis e as outras debitam por tiro (ADR 0026, decisão 3; revisto pela AB-02, ADR 0032 d.7 — munição é item); os valores 3, 5 e 7 são provisórios, em `packages/content/data/items/*-arrow.json`.

## Supply abstrato, na prática (FUN-77)

§20.1 **[REVOGADO em parte]**: desde a AB-01 (ADR 0032 decisão 6) poção e runa **são itens**
empilháveis do catálogo `data/items/`, com peso, `price` de compra e `restock`. O catálogo
`data/supplies/` deixou de existir. O que sobrevive desta seção é a **projeção de compatibilidade
v1** (`content.supplies`), derivada dos itens consumíveis, que mantém a config de bot v1 salva
válida enquanto ela ainda debita gold por uso; ela sai quando a AB-03 (#418) migrar o vocabulário
para v2 e a AB-04 (#419) trocar o débito por uso pela pilha + reposição por lote.

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

**O Market não é uma vitrine de listagem simples — é um livro de ordens (2026-09-16).** O PRD
(§33.2) diz só que "todo item físico negociável pode ser colocado no Market por gold", sem
especificar como a compra/venda acontece. A decisão de produto de 2026-09-16
(`docs/design-system-plan.md` §10, item 6 — a entrar no ADR 0029 via #244) fecha isso como um
livro de ordens de compra e venda, com as colunas comprador/vendedor, quantidade, preço e total,
como o modal "Casa de leilões" do handoff do design system desenha. A regra de "sem taxa" (§32.3
do PRD, já implementada acima) continua igual; só o mecanismo de correspondência entre oferta e
demanda muda de "em aberto" para "livro de ordens". O E13 herda este desenho quando o Market for
implementado; nenhuma tela é construída nesta task (D8 do `docs/design-system-plan.md`).
