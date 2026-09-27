# 0049 — Uso manual: clique dispara o slot, `use-item`/`use-item-on` para o que está na mochila, e o suprimento abstrato continua sendo o motor

**Status:** proposto — emenda o [ADR 0032](0032-the-rendered-hud-is-the-game-contract.md)
d.3 (o clique passa a disparar) e d.9 (comida entra como consumível), e o
[ADR 0043](0043-tibia-stamina-and-food-only-regeneration.md) (o efeito da comida
vira flag de conteúdo); mantém o [ADR 0026](0026-vocation-starting-kit-containers-and-fixed-columns.md)
d.8, o ADR 0032 d.6/d.7 e o [ADR 0044](0044-conjuring-runes-and-soul-as-abstract-supply.md)
**Data:** 2026-09-26
**Contexto técnico:** `packages/client` (`ActionBar.tsx`, `useActionKeys.ts`, `ContainerWindow`,
`EquipmentPanel`, mira no mundo), `packages/protocol` (`use-slot.target`, `use-item`, `use-item-on`,
`use-result`, `inventory.supplies`/`ammunition`), `packages/sim` (`HuntRuleset.useSlot`, `#perform`,
`#aimFor`, `casting.ts` — `useSupply`, `actionExhaustKey`), `packages/content` (`BOT_HOTKEYS`,
`itemSchema.use`, `progression.regeneration.requiresFood`)
**Issues:** novas — ver `PLAN.md` W6–W7; relacionadas #553 (linha de visão), #576 (poções de buff),
#690 (exaustão compartilhada, já mesclada)

## Contexto

O dono pediu *"usar runas, usar itens"*, *"uso de itens, itens consumíveis"*. Hoje o único disparo
manual é `use-slot` (C2S 17) por **tecla**; o clique no slot só abre o `ActionConfigModal`
(`ActionBar.tsx:105-108`); há 22 teclas para 24 slots; a mochila não tem menu de contexto; não
existe `use-item`; comida é `kind: 'other'` sem efeito; `blessing-charge` não tem executor; a
recusa `level-too-low`/`wrong-vocation` vira texto genérico; fora de hunt `use-slot` é recusado.

O que já está decidido e este ADR **não** reabre: poção, runa e munição são **suprimento abstrato**
(ADR 0026 d.8 → ADR 0032 d.6/d.7; ADR 0044 para conjuração), com o gold saindo no uso e, desde
#520, um `supplyStock`/`ammunitionStock` que o loot credita e que `useSupply` gasta antes do gold.
É parte do contrato da barra de ações, que é uma das duas exceções à fidelidade (ADR 0037 d.2). O
Tibia tem runa e poção físicas na mochila, compradas em pilha no NPC; a diferença não muda nenhum
número de combate, e trocar o modelo agora seria reescrever ADR 0026/0032/0044, `casting.ts`, a
economia de sessão e a bolsa da party — para entregar o mesmo dano com mais peso na mochila.

O que falta, então, não é modelo: é **superfície de uso** — e quatro coisas que o Tibia faz e o
Draconya ainda não expressa: usar com alvo escolhido no clique (`playerUseItemEx`/
`playerUseWithCreature`, alcance `canUseFar` 7×5 com linha de visão), usar um item da mochila
(`playerUseItem`: comida, ferramenta, container), a ação manual **adiada** pela exaustão em vez de
recusada (`setNextActionTask` quando `!canDoAction()`, `game.cpp:6434-6445`), e as barras do
Tibia, em que o botão executa no clique.

## Decisão

1. **O clique esquerdo no slot dispara `use-slot`; configurar é o clique direito (ou o ⚙ do slot);
   Shift+clique continua desligando o automático.** É a barra do Tibia. Emenda o ADR 0032 d.3 só
   no gesto — a intenção e a elegibilidade não mudam. Slot sem tecla passa a ser válido (dispara só
   pelo clique), e `BOT_HOTKEYS` ganha `shift+1…shift+0` (32 teclas para 24 slots) — o Tibia usa
   modificador para as barras extras; o conteúdo é a fonte da lista, como hoje.

2. **`use-slot` ganha `target?: { creatureId } | { position }`, opcional.** É o "usar com mira" do
   Tibia: a barra entra em modo de mira e o clique seguinte no mundo/Batalha completa a intenção.
   Sem `target`, vale o que existe (`#aimFor`: alvo fixado, senão o candidato do bot). Com `target`,
   o servidor confere alcance (`effect.range`), linha de visão (#553 quando pousar) e, para cura
   com `target: 'friend'`, se é membro da party — o mesmo `recipient` que `#perform` já aceita.
   Aplica-se a magia mirada e a runa; magia de área centrada no lançador ignora o campo.

3. **Duas intenções para o que está na mochila, no corpo ou no estoque:**
   `use-item { ref, seq }` e `use-item-on { ref, target, seq }`, com
   `ref = { instanceId } | { supplyId }`. O `sim` resolve pelo catálogo: item `kind: 'consumable'`
   com `use.effect` (comida, `blessing-charge`), item-ferramenta (`use.tool: 'machete' | 'rope' |
   'shovel' | 'pick' | 'key'` — o alvo é um tile, ADR 0050), suprimento do estoque (`supplyId` →
   `useSupply`, o mesmo caminho do slot, sem passar pela barra). Recusas em palavras num S2C
   `use-result { seq, ok, reason }` — típado, como `slot-result`, porque a tela precisa saber a que
   clique a recusa pertence. Alcance: `use-item-on` sobre criatura/tile usa o `canUseFar` do
   Canary (7×5, mesmo andar, linha de visão); sobre item do próprio inventário, nenhum.

4. **O estoque abstrato aparece na mochila.** `inventory` ganha `supplies: [{ id, quantity }]` e
   `ammunition: [{ id, quantity }]` (opcionais; nó anterior manda sem). O cliente desenha uma
   seção "Suprimentos" abaixo da bolsa com o sprite do catálogo e a contagem; clicar usa
   (`use-item { supplyId }`), clicar-com-mira usa em alvo, arrastar para a barra configura o slot.
   O jogador vê o que o loot lhe deu e gasta a runa "do loot" antes de pagar gold — o que já
   acontece no motor desde #520, agora visível.

5. **Comida entra, com o mecanismo do Canary e o efeito ligado por flag.** `food.lua`: comer soma
   `duration` segundos a um contador (`fedMs`, teto 1200 s — "You are full"), mensagem "Munch." /
   "Gulp." por item, exaustão de ação. O efeito no Tibia é a `CONDITION_REGENERATION`; o ADR 0043
   (emenda de 2026-09-25, Huntera) decidiu regeneração **sem** comida. Então: `fedMs` é estado real
   do personagem (snapshot, extrato, Cidade não anda), e `progression.regeneration.requiresFood`
   (default `false`, o Huntera) diz se a regeneração exige `fedMs > 0`. Mudar o número é editar
   conteúdo, não reabrir arquitetura — o dono decide o balanceamento sem tocar código. Emenda o ADR
   0032 d.9 ("comida fica fora") e resolve o `[ABERTO]` do 0043 sem escolher por ele. A automação
   "Comer comida" da sexta linha do kit v3 entra como sexto modelo, ligada por default só quando a
   flag está ligada.

6. **Exaustão compartilhada (#690) vale igual para o manual, e o manual é ADIADO uma vez, não
   recusado.** `useSupply` já trava `exhaust:action`; o disparo manual dentro da exaustão vira
   `pendingManualAction` do personagem, agendado para o vencimento do livro (evento da fila —
   invariante 2), e um segundo disparo antes disso **substitui** o primeiro — é o
   `setNextActionTask` do Canary. Cooldown de grupo (`attack`/`healing`/`support`) continua recusa
   imediata com `retryInMs`, como hoje: no Tibia a magia em cooldown de grupo também não fica na
   fila. Retorno visual: o slot anima o cooldown com o `remainingMs` do `slot-state` e o
   `use-result`/`slot-result` diz "ainda exausto" com o tempo.

7. **Retorno visual e texto.** Todo motivo de recusa (`level-too-low`, `wrong-vocation`,
   `not-enough-mana`, `no-target`, `out-of-range`, `too-far-away`, `not-usable`…) chega em
   palavras (FUN-73) tanto em `slot-result` quanto em `use-result`, e o cliente mostra no tooltip do
   slot ou como toast curto sobre a mochila. Sucesso não vira mensagem (a regra de equipar) — o
   `effect` no tile, o `creature-hit` de cura e o `inventory`/`supplies` mudando são a confirmação;
   comida é a exceção fiel ("Munch.").

8. **Na Cidade nada é consumido.** `use-slot`, `use-item` com suprimento e comida são recusados com
   `not-in-hunt`; a Cidade não tem relógio (ADR 0004/0023, `hz` 0) para exaustão, condição nem
   `fedMs`. `use-item` na Cidade aceita só o que não simula: abrir container, `look`, e — pelo
   ADR 0050 — porta e alavanca. Divergência do Tibia (que deixa comer e beber poção em PZ)
   registrada em `city.md`; reabre quando a Cidade tiver relógio, o que ADR 0004 diz que não terá.

## Alternativas

- **Runa e poção físicas na mochila, como no Tibia.** Descartada pelas razões do contexto: não muda
  resultado de combate, reescreve quatro ADRs e a economia de sessão, e o "acabar no meio da hunt"
  contraria o invariante 11. O estoque visível (decisão 4) entrega a parte que o jogador vê.
- **Só a tecla dispara; o clique continua configurando (ADR 0032 d.3 literal).** Descartada pelo
  pedido do dono e pela fidelidade: o botão do Tibia executa no clique. Configurar sai para o
  clique direito, onde o Tibia também põe.
- **Um só opcode `use` com união de quatro formas (slot, item, supply, tile).** Descartada: as
  recusas, o alcance e o destino da resposta são diferentes por forma; `use-slot` já existe e é
  ack por `slot-result`. Três opcodes com um `seq` cada é mais barato de versionar que um
  discriminador com campos opcionais que "não podem vir juntos".
- **Manual em exaustão é recusado (como o cooldown de grupo).** Descartada pelo Canary, que adia a
  ação; o jogador que aperta a poção 200 ms antes da hora espera ser atendido, não ignorado.
- **Comida com efeito de regeneração já, revertendo o ADR 0043.** Descartada: é decisão de produto
  do dono ("copie do Huntera", 2026-09-25) e não deste ADR; a flag deixa a porta aberta sem
  código novo.
- **Permitir poção e comida na Cidade com um relógio só para isso.** Descartada: dar relógio à
  Cidade é reabrir o ADR 0004 por um caso que não afeta a caça.

## Consequências

- `packages/protocol`: `use-slot.target` (opcional), `use-item` (C2S 21), `use-item-on` (C2S 22),
  `use-result` (S2C 36), `inventory.supplies`/`inventory.ammunition` (opcionais). Números
  definitivos no pouso, pela ordem de merge com o ADR 0048 e 0050.
- `packages/sim`: `useItem`/`useItemOn` no `HuntRuleset` (e um subconjunto no `CityRuleset`),
  `pendingManualAction` como evento da fila (snapshot: opcional, sem bump), `fedMs` no
  `CharacterRuntime` (snapshot e extrato — coluna `characters.fed_ms`, aditiva, ADR 0014), o
  executor da `blessing-charge` (o que a TP-03 esperava) e `use.effect` para comida.
- `packages/content`: `itemSchema.use` (`{ tool } | { effect: food }`), `BOT_HOTKEYS` com Shift,
  `progression.regeneration.requiresFood`, sexta automação `eat-food`.
- `packages/client`: `ActionBar` (clique/direito/mira), `ContainerWindow` com menu de contexto
  (usar, usar com…, vender, descartar), seção Suprimentos, toasts de recusa.
- `docs/product/bot.md` ("A tela"), `items.md` (comida, uso), `economy.md` (estoque visível),
  `city.md` (divergência), `progression.md` (`requiresFood`).
- O que piora: mais um caminho de entrada de intenção que chega **entre** avanços e precisa da
  mesma disciplina de `use-slot` (`#armBot` depois do disparo manual, para o ciclo automático
  respeitar o cooldown iniciado); e a mira no cliente é estado de UI novo que precisa cancelar em
  Esc, em troca de alvo e em `session-ended`.

## Invariantes afetados

Nenhum muda. **4** — o cliente manda slot/item/suprimento e o alvo que clicou; elegibilidade,
alcance, exaustão, gold, estoque e efeito são do servidor. **2** — o adiamento pela exaustão e o
`fedMs` são eventos/instantes da fila, nunca tique. **11** — a barra continua sendo primeiro a
vista do bot; o clique manual é o extra, e o estoque visível serve aos dois. **7** — `requiresFood`
é conteúdo e fixa na sessão.
