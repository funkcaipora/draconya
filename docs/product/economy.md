# Economia, consumíveis e Market

**Status:** parcial — gold por abate (FUN-63), consumível como item com reposição por lote pelo ledger (AB-01/AB-04, ADR 0032 d.6) e loot de item com Caixa de Loot da Sessão (FUN-88) implementados; autovenda, Market e Coins não implementados
**PRD:** §20, §32, §33, §43.5
**Épico:** E5 (consumível, ledger); E13 (Market, Coins por gold)

## Comportamento

Poção, runa, carga de bênção e munição são **itens físicos empilháveis** na mochila (ADR 0032
d.6/d.7): usar consome uma unidade da pilha, e a barra e a Mochila mostram a contagem real. A
reposição é **idle-first e por lote**: cada slot de item tem `restock { batch, min }` (default do
conteúdo, editável no slot), e quando a pilha cai abaixo do `min` o bot compra `batch` ao preço do
conteúdo, num lançamento `purchase` do ledger — ao entrar na hunt a primeira compra acontece pela
mesma regra. Cada tiro de arma de distância consome uma unidade da pilha equipada no slot `ammo`;
a `arrow` tem preço e lote como qualquer consumível. Os preços usam o Tibia como referência
inicial de balanceamento, e todos os valores são configuráveis.

Se o gold do personagem acabar durante a hunt: com a regra "sair quando o gold acabar" ativa no
bot, ele sai da hunt; sem essa regra, ele permanece, mas deixa de conseguir repor o estoque e
pode morrer (ver `bot.md`, §13.9).

Gold entra na economia principalmente por loot/venda de itens, autovenda, e recompensas de quest
quando aplicável — daily quests com pequenas recompensas podem existir depois, mas não são pilar
econômico do MVP. Gold sai por compra de consumível na reposição por lote, taxa de imbuement,
rerolls adicionais de Prey, compras de itens/Coins no Market, e futuramente pela Forja.

O Market é global, acessível a partir de qualquer cidade/PZ relevante, e não cobra taxa de
listagem nem comissão sobre venda. Todo item físico negociável pode ser colocado à venda por
gold, respeitando as regras de existência de cada item — consumíveis inclusive, que agora são
itens empilháveis como os outros. Coins — que pertencem à conta, não ao personagem — também podem
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
- Consumível é item empilhável: usar decrementa a pilha e **não** debita gold. O gold sai na
  **compra do lote** pela reposição (`restock { batch, min }`), num lançamento `purchase` com
  `(session_id, seq)` único (ADR 0032 decisão 6, invariante 10). A compra é limitada pela
  capacidade livre, pelo teto da pilha e pelo saldo, e nunca deixa o saldo negativo.
- Munição é item empilhável no slot `ammo` (ADR 0032 decisão 7) e, desde a AB-05, cada tiro
  consome uma unidade da pilha equipada — sem débito de gold por tiro e sem fallback grátis; a
  reposição por lote também compra munição.
- Drop de consumível por monstro entrega a pilha física, como qualquer item de `loot.items`.
- Sem regra de saída por gold zerado ativa: personagem permanece na hunt, sem conseguir repor o
  estoque, podendo morrer.
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
- Consumíveis são itens físicos e podem ser listados no Market como qualquer pilha.
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
| Preço por tiro da munição | arrow 1 `[ABERTO — provisório: 1, deixou de ser grátis]`, burst arrow 3 `[ABERTO — provisório: 3]`, sniper arrow 5 `[ABERTO — provisório: 5, preço do NPC no Tibia]`, onyx arrow 7 `[ABERTO — provisório: 7, preço do NPC no Tibia]` | `packages/content/data/items/{arrow,burst-arrow,sniper-arrow,onyx-arrow}.json`, `price` |
| Reposição por lote — `batch` / `min` | poção de vida 50 / 10; poção de mana 50 / 10; avalanche 20 / 5; arrow 100 / 20 `[ABERTO — provisório]` | `packages/content/data/items/*.json`, campo `restock`; override por slot em `bot_config` |
| Preço da Avalanche Rune | 14 `[ABERTO — valor provisório: 14]` | `packages/content/data/items/avalanche-rune.json`, campo `price` |

## Em aberto

- ~~[ABERTO] Preço de arrows e demais munições (§20.2, §43.5)~~ → **Resolvido:** a munição é item
  com `price` e `restock` (ADR 0032 d.7, AB-02/AB-05); a `arrow` deixou de ser grátis (ponto de
  partida 1), e os valores 1, 3, 5 e 7 são provisórios, em
  `packages/content/data/items/*-arrow.json`.

## Supply abstrato, na prática (FUN-77) — **revogado pelo ADR 0032 d.6**

§20.1 **era `[DECIDIDO]` e foi revogado**: o suprimento abstrato debitava gold por uso e não
existia como pilha. Desde a AB-01/AB-04 (ADR 0032 decisão 6) poção, runa e carga de bênção **são
itens** empilháveis de `data/items/`, e o que existe agora é a **reposição por lote** descrita em
"Comportamento" e em `bot.md`: a pilha é a fonte do consumo, e o gold sai na compra do lote por um
lançamento `purchase` no ledger. A projeção de compatibilidade que mantinha a config v1 salva saiu
com a migração v1→v2 (AB-03). Esta seção fica como histórico.

O que continua valendo do desenho original:

- O saldo que a sessão enxerga é o **gold de entrada mais o delta da sessão**: o loot desta hunt
  já dá para comprar poção, sem passar pelo banco. Exigir o contrário faria a poção só chegar
  depois de encerrar a sessão, que é o oposto do idle-first.
- O gold de entrada vem do **ticket**, nunca do cliente (invariante 4). Ticket emitido por um `api`
  antigo, sem o campo, entra com zero e recusa compra — degrada para o lado seguro.
- **O saldo nunca fica negativo**, e a garantia é a ordem: a compra é recusada antes, não corrigida
  depois. O `Math.max(0, …)` que o ledger aplica ao creditar continua como rede de segurança.
- O gasto vira `aggregates.goldSpent` na sessão, e o extrato leva ganho e gasto ao ledger na mesma
  linha (`goldGained - goldSpent`), com `(session_id, seq)` único: retry nunca duplica
  (invariante 10).
- **Gold zerado não encerra a hunt** (§20.3, sem a regra de saída): o personagem fica, não repõe o
  estoque e pode morrer. É comportamento, não erro — mas a primeira recusa por falta vira **uma**
  linha (`supply-unaffordable`) no extrato, não uma por tentativa. A regra de saída "sair quando o
  gold acabar" é da FUN-86.

## Divergências do PRD

~~**Loot de item não cai, e a tabela recusa tentar.**~~ → **Resolvido (FUN-76, FUN-88):** existe
catálogo, `loot.items` é conferido contra ele, e o item cai — mochila se couber, Caixa de Loot da
Sessão se não. Ver [`items.md`](./items.md).

**O §20.1 foi revogado pelo ADR 0032 d.6 (AB-01/AB-04).** O PRD tratava o supply como abstração
que debitava gold por uso. A implementação fez o oposto.

- **PRD dizia:** poções, runas e munições não eram itens físicos; usar um supply descontava gold
  direto, sem pilha nem reposição (§20.1, `[DECIDIDO]`).
- **Implementado:** consumível é item empilhável; usar decrementa a pilha; o gold sai na compra
  do lote pela reposição (`restock { batch, min }`), num lançamento `purchase` do ledger.
- **Motivo:** ADR 0032 decisão 6 — a imagem mostra a contagem real, e a reposição idle-first é o
  que mantém a hunt de 18 h viva com o navegador fechado.

**O Market não é uma vitrine de listagem simples — é um livro de ordens (2026-09-16).** O PRD
(§33.2) diz só que "todo item físico negociável pode ser colocado no Market por gold", sem
especificar como a compra/venda acontece. A decisão de produto de 2026-09-16
(`docs/design-system-plan.md` §10, item 6 — a entrar no ADR 0029 via #244) fecha isso como um
livro de ordens de compra e venda, com as colunas comprador/vendedor, quantidade, preço e total,
como o modal "Casa de leilões" do handoff do design system desenha. A regra de "sem taxa" (§32.3
do PRD, já implementada acima) continua igual; só o mecanismo de correspondência entre oferta e
demanda muda de "em aberto" para "livro de ordens". O E13 herda este desenho quando o Market for
implementado; nenhuma tela é construída nesta task (D8 do `docs/design-system-plan.md`).
