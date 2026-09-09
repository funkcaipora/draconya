# Morte

**Status:** penalidade de XP implementada; devolver à PZ é a FUN-38
**PRD:** §26
**Épico:** E2

## Comportamento

Na morte em PvE normal, a hunt é encerrada, o personagem volta para a área inicial/PZ com HP e Mana totalmente restaurados, sem debuff temporário, sem sistema de bless, e sem perder item ou equipamento algum — morte no Draconya nunca é uma perda material.

O que a morte de fato custa é XP: a penalidade base é 60% da quantidade de XP necessária para completar o level atual, reduzida para 54% em personagens Premium. Essa penalidade pode causar perda de level, mas o personagem nunca cai abaixo do level 8 por conta dela — esse piso é uma proteção fixa.

## Regras

- Morte encerra a hunt e devolve o personagem à PZ.
- HP e Mana são restaurados totalmente.
- Sem debuff temporário, sem perda de item/equipamento, sem sistema de bless.
- Penalidade de XP: 60% da XP necessária para completar o level atual (Free).
- Penalidade de XP reduzida: 54% (Premium).
- A penalidade pode causar perda de level, mas nunca abaixo do level 8.

## O piso do level 8 protege, e nunca promove

A penalidade é 60% da XP necessária para completar o level atual (54% com Premium), tirada do
**total acumulado**. O level é recalculado a partir dele, e é assim que a queda de level — e a
cascata por mais de um — sai de graça, sem laço escrito à mão.

O piso do level 8 é a parte que engana. Escrito como um `max` puro contra a XP do level 8, ele
**levantaria** a XP de quem está no level 5 — um castigo que dá level. O correto é: a penalidade
nunca deixa o personagem abaixo do que ele já tinha, e nunca o leva abaixo do piso. Quem já está
sob o piso não perde nada.

O piso é de **XP**, não só de level: parar no level 8 com XP negativa é um estado impossível que
dá erro estranho três sistemas adiante.

**Com a curva de hoje, a cascata nunca acontece acima do piso.** Cascatear exige
`0,6 × f(L) > f(L-1)`, e com `exponent: 2` isso só valeria abaixo do level 6 — onde o piso do 8
já protege. O código trata cascata mesmo assim, e há teste com uma curva mais íngreme, porque a
curva é conteúdo e vai ser rebalanceada.

**A penalidade sai na morte, não no encerramento.** Uma hunt que termina por saída manual ou por
regra automática não custa XP nenhuma — quem paga é quem morre. A perda entra no extrato como
número negativo, porque o extrato é o que vira linha de ledger: creditar a XP ganha sem descontar
a perdida daria ao jogador uma XP que ele não tem.

**Nunca perde item** (§3.8), e o teste disso é a ausência: a penalidade mexe em XP, level e stats
derivados, e em mais nada. É o que elimina a necessidade de qualquer sistema de recuperação.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Penalidade de XP — Free | 60% da XP necessária para o level atual | `packages/content/data/progression/baseline.json`, `deathPenalty.fraction` |
| Penalidade de XP — Premium | 54% da XP necessária para o level atual | `packages/content/data/progression/baseline.json`, `deathPenalty.premiumFraction` |
| Piso de proteção de level | 8 | `packages/content/data/progression/baseline.json`, `deathPenalty.levelFloor` |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema.

## Divergências do PRD

**A penalidade mora em `progression/baseline.json`, não num arquivo de economia.** Ela é definida
COMO fração da curva de XP, e separar as duas é como as duas divergem numa rebalanceada.

**Devolver à PZ com HP e mana cheios ainda não acontece** — é a FUN-38. Hoje a morte encerra a
hunt com extrato e cobra a XP; o personagem ainda não é movido para a cidade.
