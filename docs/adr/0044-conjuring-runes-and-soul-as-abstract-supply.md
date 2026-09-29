# 0044 — Conjuração e pontos de alma dentro do modelo de suprimento abstrato

**Status:** proposto — decorre do [ADR 0032](0032-the-rendered-hud-is-the-game-contract.md)
decisão 7 (suprimento e munição abstratos) e do [ADR 0026](0026-vocation-starting-kit-containers-and-fixed-columns.md)
decisão 8 (munição e runa como consumíveis, ambas emendadas pelo 0032); nenhuma das doze questões
do plano bloqueia esta decisão diretamente (ver seção própria)
**Data:** 2026-09-25
**Contexto técnico:** `packages/content` (`spells/`, novo campo `soul` em magia, estoque
abstrato), `packages/sim` (`casting.ts`, pontos de alma no `CharacterRuntime`), `scripts/catalog/`
(extrator de magias e runas, M37-08)
**Issues:** M37-06 (#593); M37-07 (#594)

## Contexto

O ADR 0026 (decisão 8, emendada pelo ADR 0032 decisões 6 e 7) já tirou runa e munição do modelo
de item físico: elas são **seleção** que debita **gold** no uso ou no tiro, sem nascer item de
verdade no inventário. O Tibia faz algo parecido, mas com uma terceira moeda que o Draconya nunca
modelou: **pontos de alma**. Uma magia de conjuração — `conjureItem`, usada por runas de ataque e
por Enchant Spear — debita mana **e** alma **e** o preço da runa em branco (10 gold, confirmado
via `npcConfig.shop`), e credita N cargas do item conjurado. O `avalanche_rune.lua`
(`data/scripts/spells/conjuring/avalanche_rune.lua:15`) declara `spell:soul(3)` — a sintaxe real é
`spell:soul(n)`, usada por cerca de 50 magias de conjuração do catálogo; uma leitura anterior do
inventário tinha buscado a sintaxe errada e concluído (erradamente) que pontos de alma não eram
exigidos por magia nenhuma.

Pontos de alma em si também não existem hoje. No Canary, o teto é 100 (200 para promovido — as
vocações 5–8 do `vocations.xml` declaram `soulmax="200"`), e o ganho é por **condição**: toda vez
que a XP recebida é maior ou igual ao level do personagem, uma condição de alma é (re)aplicada
com o intervalo da vocação (`gainsoulticks`, 15.000 no `vocations.xml` — o Canary usa ticks de
200 ms internamente, então 15.000 ticks correspondem a um intervalo de minutos, verificado no
mecanismo de `Player:onGainExperience`, `data/events/scripts/player.lua:537-541`).

## Decisão

1. **Conjuração debita mana, alma e o preço da runa em branco**, e credita N cargas no estoque
   abstrato de suprimento ou munição — o N vem do terceiro argumento de `conjureItem` no Canary.
   Não nasce item de runa: o modelo é exatamente o mesmo suprimento abstrato do ADR 0026/0032,
   só com um terceiro custo (alma) somado ao gold.
2. **Conjuração pode ser lançada na hunt e na Cidade.** Na Cidade ela vira uma ação de evento que
   não exige laço de simulação — a Cidade não simula nada (invariante 8) — no mesmo espírito de
   qualquer ação pontual que já roda lá.
3. **Pontos de alma seguem o mecanismo do Canary**: máximo 100 (200 para promovido, ADR 0042),
   ganho por condição de alguns minutos quando a XP recebida é ≥ level do personagem, com
   intervalo por vocação (`gainsoulticks`).

## Questões em aberto (decisão do dono)

Nenhuma das doze questões em aberto do plano de paridade trava esta decisão especificamente. O
status **proposto** existe porque este é o primeiro ADR a introduzir pontos de alma como recurso
persistido do personagem — um campo novo (`soul: number`, `soulMax` por vocação/promoção) que
ainda não tem lugar no schema, e a confirmação de um recurso de personagem novo segue a mesma
régua de qualquer schema novo em `packages/content` (a mesma razão de status "proposto" do ADR
0041 para condições). A questão nº 8 do plano — se personagens existentes ganham de graça as
magias do level atual ao aprender por gold com NPC (M44-06) — é adjacente, mas pertence ao
milestone M44 (periféricos), fora do escopo direto deste ADR; fica registrada em
`docs/tibia-parity-plan.md`.

## Alternativas

- **Cobrar só gold na conjuração, como runa/munição hoje fazem, ignorando alma.** Descartada: a
  alma é o único recurso do jogo que só a conjuração usa — ignorá-la deixaria pontos de alma sem
  nenhum consumo, o que o ADR 0037 (decisão 1) trataria como divergência sem exceção que a
  justifique.
- **Modelar a runa conjurada como item físico de verdade, com N cargas empilhadas no
  inventário.** Descartada: reabriria a distinção que o ADR 0026/0032 já fecharam — suprimento
  abstrato existe justamente para não ter item de munição ocupando espaço e peso.
- **Pontos de alma como estado quente separado, fora do `CharacterRuntime`.** Descartada pelo
  invariante 9: todo estado quente do personagem mora no `CharacterRuntime` da sessão dona; um
  recurso novo não abre exceção.

## Consequências

- M37-06 (#593, pontos de alma) e M37-07 (#594, conjuração no modelo abstrato) ficam
  desbloqueados; M37-04 (runas de campo/parede) e M37-10 (runas de ataque restantes) reusam o
  mesmo estoque abstrato sem precisar de decisão própria.
- `CharacterRuntime` ganha `soul`/`soulMax`; snapshot ganha um campo novo, opcional — ausente lê
  como 0, sem bump de `SNAPSHOT_FORMAT_VERSION` se a leitura suportar o default.
- O extrator de magias do M37-08 precisa reconhecer `spell:soul(n)` como forma de fórmula — a
  falha de leitura que esta decisão corrige explicitamente.

## Invariantes afetados

Nenhum muda de texto. O invariante 8 é quem permite conjuração como ação de evento na Cidade sem
laço de simulação. O invariante 9 é quem mantém pontos de alma dentro do `CharacterRuntime` da
sessão dona, sem exceção.
