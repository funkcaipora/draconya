# Bestiário

**Status:** parcial — o contador de abates por monstro é permanente, os cinco marcos fecham e
cada um dá +1 % de XP PvE para sempre (FUN-113); a janela no cliente lista cada monstro com a
contagem, o próximo marco e o bônus total. Faltam as recompensas especiais por monstro (§18.4)
e a regra de Guild War (§18.5), que não tem Guild War para valer
**PRD:** §18
**Épico:** E7

## Comportamento

O personagem acumula abates por monstro **de forma permanente** — o contador atravessa hunts,
snapshot e extrato, e nunca desce. Cada monstro tem cinco marcos de contagem (10 000, 25 000,
50 000, 100 000 e 200 000 abates), e cada marco alcançado, em qualquer monstro, concede **+1 %
de XP PvE para sempre**. O bônus é **global**: é `1 + 0,01 × (marcos alcançados em todos os
monstros, somados)`, aplicado à XP de todo abate — dois marcos no rato e um no morcego são
+3 % na XP de qualquer coisa que o personagem mate daí em diante.

Abate com stamina zero **não conta** (§18.6) — e não conta pela MESMA condição que já não paga
XP nem loot: é um `if` só em `#onMonsterDied`, e duas condições divergiriam na primeira mudança
em uma delas.

Fechar um marco é evento notável, como o level up: aparece na lista curta do analisador
(§16.2) como "Bestiário: Rato · marco 1 (+1 % XP)". O abate comum não aparece, pela regra de
sempre — uma hunt de oito horas com uma linha por rato não é lista, é log.

**O que a tela mostra.** A janela do Bestiário mora na coluna da direita, abaixo do analisador,
com a mesma linguagem — cabeçalho que abre e fecha, aberta por padrão desde a FUN-115 (a barra
do topo é quem a mostra e esconde). Cada monstro do catálogo tem uma linha: nome, abates,
"próximo marco" (ou "—" depois do último) e "marcos n/5"; a primeira linha do corpo é "Bônus de
XP PvE: +n %", e minimizada o bônus fica no cabeçalho. Num servidor sem monstros no catálogo a
janela diz "Este servidor não tem Bestiário" em vez de uma lista vazia com "+0 %".
Os contadores chegam inteiros do servidor (`bestiary`, no attach e sempre que um muda); os
marcos e o valor de cada um vêm no `catalogue`, fixados na sessão (invariante 7). O cliente
não conta nada — o que ele calcula é "que marco vem depois", e se divergisse do `sim` a conta
do `sim` é a verdadeira.

## Regras

- Cinco marcos de abates por monstro: 10 000 / 25 000 / 50 000 / 100 000 / 200 000.
- O que conta é o abate, não o cadáver: o rato do Tibia (FUN-123 — 20 HP, 5 XP, cadáver só
  visual por dez segundos) rende um abate por morte, e os 10 000 do primeiro marco são
  10 000 ratos, a 5 XP cada antes do bônus.
- Cada marco alcançado dá **+1 % de XP PvE permanente**, somado com os demais — de todos os
  monstros (DT-01, ver Divergências).
- A XP de um abate é `floor(xp × (100 + 1 × marcos) / 100)`, em inteiro: `100 × 1,13` em ponto
  flutuante é `112.99999999999999`, e o `floor` daria 112 onde a conta exata dá 113 — um abate
  em cada setenta perderia um ponto sem ninguém conseguir explicar por quê.
- O abate que **alcança** um marco é pago com o multiplicador de antes; o marco vale do abate
  seguinte em diante (DT-04, ver Divergências).
- Abate com stamina zero não conta, não dá XP e não dá loot — uma condição só.
- O contador é **absoluto** no ticket e no extrato, e o ledger fica com o **maior** por monstro
  (DT-02): abate nunca desce, então um extrato antigo processado fora de ordem não rebaixa nada,
  sem precisar de guarda de instante. É o padrão das skills (FUN-75).
- Personagem ou snapshot anterior à FUN-113 não tem `bestiary`, e isso é `{}` — nenhum abate
  contado, sem subir `SNAPSHOT_FORMAT_VERSION` (DT-06), como `skills`.
- Monstro nunca abatido **não tem entrada**: o `sim` não grava zero para todo monstro do conteúdo
  em todo personagem, e a tela lê a ausência como zero.
- Sem `bestiary` no conteúdo (fixture de teste), o contador sobe do mesmo jeito; só não há
  marco nem bônus — a config define marco, não autoriza contar.
- Todos os bônus são individuais ao personagem e valem só em PvE. Não há PvP para o contrário
  ser testado.
- Recompensas especiais por monstro **não existem** (DT-05): todo monstro usa a recompensa
  padrão.

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora em packages/content |
|---|---|---|
| Marcos (os cinco, crescentes) | 10 000 / 25 000 / 50 000 / 100 000 / 200 000 abates | `packages/content/data/bestiary/baseline.json`, `milestones` |
| Recompensa por marco | +1 ponto percentual de XP PvE | `packages/content/data/bestiary/baseline.json`, `xpBonusPercentPerMilestone` |
| Recompensas especiais por monstro | não implementado (DT-05) | sem entrada — entram com o primeiro monstro que as pedir |

O schema (`bestiarySchema`, em `packages/content/src/schemas.ts`) exige os marcos em ordem
crescente: o `sim` para de contar no primeiro que o contador não alcança, e uma lista fora de
ordem faria o terceiro marco fechar antes do segundo.

## Em aberto

- **Recompensas especiais por monstro** (§18.4, DT-05): loot PvE, Dodge PvE, resistência
  física e elemental PvE, redução de penalidade de morte. O conteúdo não tem monstro que as
  peça, e o formato — qual marco de qual monstro troca a XP por qual bônus — entra com o
  primeiro que pedir, não antes.
- **Guild War** (§18.5): "os bônus valem só em PvE" é verdade por falta de PvP, não por regra
  escrita. A regra entra com a Guild War.

## Divergências do PRD

**O bônus é global, não por monstro (DT-01).** O §18 diz "+1 % de XP PvE permanente" por
marco, e não diz de qual XP. A leitura literal é a global — a XP PvE do personagem, de
qualquer abate —, e é a que foi implementada: `1 + 0,01 × Σ marcos`. "Só a XP daquele monstro"
seria uma segunda regra que o PRD não escreve, e que obrigaria o jogador a farmar o mesmo rato
para colher o que plantou nele — o oposto de uma progressão que dá razão para voltar.

**O abate que fecha o marco é pago pela regra anterior (DT-04).** O PRD não diz se o abate
10 000 já sai com o bônus. Aqui ele sai com o multiplicador que valia quando começou, e o marco
vale do 10 001 em diante: a ordem é determinística (XP primeiro, contagem depois), e invertida o
abate 10 000 seria o único da vida do personagem a render diferente dos vizinhos. O
arredondamento é para baixo.
