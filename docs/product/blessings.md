# Bênçãos

**Status:** implementado (#570, [ADR 0052](../adr/0052-endgame-progression-state-and-city-services-through-the-owning-session.md)).
Substitui o binário `premium` que a [#569](https://github.com/funkcaipora/draconya/issues/569)
deixou como ponto de extensão em `applyDeathPenalty`.
**PRD:** M33 · Morte do Tibia (skill/ML, bênçãos e item)
**Épico:** E7 · Progressão persistente

## Comportamento

O personagem compra bênçãos na Cidade, uma de cada vez, com gold. Cada bênção reduz a
penalidade de morte em 8%; sete bênçãos dão os mesmos 56% que o antigo `premium: true` binário
dava (tetados em 50% abaixo do level 24, como sempre — ver `docs/product/death.md`). Morrer
consome TODAS as bênçãos de uma vez, não uma por morte — o personagem volta a zero e precisa
comprar de novo.

O catálogo tem sete bênçãos PvE: cinco regulares (id 2–6 do `Blessings.All` do Canary — o
Adventurer's Blessing é o conjunto delas, grátis abaixo do level 21) e duas `enhanced` (Heart of
the Mountain, Blood of the Mountain — mais caras, mesma redução). Twist of Fate (id 1, PvP) fica
fora deste catálogo.

## Regras

- Preço por bênção depende do LEVEL do comprador e de ser `enhanced` ou não
  (`blessingCost`/`progression.blessingPricing`, `packages/sim/src/blessings.ts`):
  - abaixo do level 21: grátis;
  - level 21–30: preço fixo, 2000 gold;
  - level 31–119: linear, `200 × (level − 20)` (regular) ou `260 × (level − 20)` (enhanced);
  - level ≥ 120: `20000 + 75 × (level − 120)` (regular) ou `26000 + 100 × (level − 120)`
    (enhanced).
- Comprar a mesma bênção duas vezes é recusado (`already-blessed`).
- Compra é serviço de CIDADE, nunca hunt — opcode `buy-blessing` (protocolo), tratado pela sessão
  de Cidade dentro do `SessionHost` (ADR 0052 decisão 2). Gold sai por `character.goldDelta`, o
  mesmo caminho de `sell-items` na Cidade.
- Morte consome TODAS as bênçãos (`character.blessings = 0`), sempre — nunca proporcional à
  perda, nunca uma de cada vez.
- A redução na morte é `blessingReduction` (8%) × a CONTAGEM de bênçãos (popcount do bitmask),
  nunca a soma pronta de um binário.

## Onde mora

`CharacterRuntime.blessings` é um BITMASK — um bit por `order` da bênção no catálogo
(`content.blessings`), não uma contagem: a identidade importa porque comprar de novo a mesma
bênção precisa ser recusável. `blessingCount`/`hasBlessing`/`withBlessing`/`blessingCost` moram
em `packages/sim/src/blessings.ts`.

Persistência segue o padrão de `fedMs` (ADR 0049 d.5): `characters.blessings` (`bigint`) na
linha do personagem, ABSOLUTO e última-escrita-vence — NUNCA fundido pelo maior, porque bênção
pode DESCER (a morte zera). O extrato leva o campo sempre, mesmo em zero, tanto pelo caminho de
hunt (`#persistReceipt`) quanto pelo extrato de estado durável da Cidade (`#saveDurableReceipt`,
marcado por `hosted.dirty`).

## Parâmetros de balanceamento

| Parâmetro | Valor | Onde mora em packages/content |
|---|---|---|
| Redução por bênção | 8% | `packages/content/data/progression/baseline.json`, `deathPenalty.blessingReduction` |
| Catálogo (nome, `order`, `enhanced`) | sete bênçãos | `packages/content/data/blessings/*.json` |
| Preço por level | ver "Regras", acima | `packages/content/data/progression/baseline.json`, `blessingPricing` |

## Em aberto

Nenhum `[ABERTO]` do PRD atinge diretamente este sistema. O `freeBelowLevel` (21) da tabela de
preço aplica-se igual a bênção regular e `enhanced` — o Canary não distingue nisso, mas na
prática ninguém abaixo do level 21 compra uma `enhanced`; é uma simplificação deliberada, não um
`[ABERTO]`.
