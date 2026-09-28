# 0056 — Forja da Exaltação em hunts instanciadas: sorteio de stack por spawn com teto por sessão, dust como registro, slivers e cores como item

**Status:** proposto — decorre do [ADR 0046](0046-item-instance-overlay-for-imbuements-and-forge-tier.md)
(tier no overlay) e do [ADR 0039](0039-canary-spawn-points-end-of-pull-difficulty.md) (spawn
por ponto); persiste e cobra pelo [ADR 0052](0052-endgame-progression-state-and-city-services-through-the-owning-session.md)
**Data:** 2026-09-27
**Contexto técnico:** `packages/sim` (spawn em `rulesets/hunt.ts`, instância de monstro,
`combat-v4`), `packages/content` (`forge/` — config, `TierInfo` por classificação, chances de
proc; itens sliver e core), `packages/server` (registro `forge`), `packages/protocol`
(`forge-fuse`, `forge-transfer`, `forge-convert`)
**Issues:** M43 — #616, #617, #618

## Contexto

No Canary a Forja tem três partes: criaturas **Influenced** (stack 1–5) e **Fiendish** (stack 15)
que o `Game` escolhe a cada intervalo entre **todos os monstros vivos do mundo** até um teto
global (`forgeInfluencedLimit 300`, `forgeFiendishLimit 4` por hora); **dust, slivers e cores**
que caem delas; e as ações da forja (fusão, transferência, conversão) que gastam esses materiais
mais gold para subir o **tier** de um item (0–10), com procs por tier em combate (Onslaught, Ruse,
Momentum, Transcendence, Amplification).

O teto global não tem sentido num jogo de hunts instanciadas: não existe "o mundo" com N monstros
vivos, existe uma sessão por jogador ou party (invariante 8). O ADR 0046 já decidiu onde o tier
mora (overlay por instância) e deixou explícito que a escolha de spawn e a forja como tela ficam
para este ADR.

## Decisão

1. **O stack é sorteado por spawn, na sessão, com o `session.rng`**, aplicado à **instância** do
   monstro e nunca à definição (invariante 7). Elegibilidade do Canary (`canBeForgeMonster`: não
   é invocação, não é boss de recompensa, dropa loot, `isForgeCreature`). Duas chances em
   conteúdo: `forge.influencedChancePerSpawn` (stack `uniform(1, 5)`) e
   `forge.fiendishChancePerSpawn` (stack 15), com **dois tetos por sessão** que substituem os
   globais: no máximo `forge.maxInfluencedAlive` Influenced vivas e **1** Fiendish viva por
   sessão, com `forge.fiendishMinIntervalMs` (1 h de tempo de sessão) entre duas Fiendish. Os
   valores são `[ABERTO — provisório: 3 %, 0,2 %, 8, 1 h]`, a calibrar pela densidade do Canary.
   O sorteio é um estágio declarado do `combat-v4` (consome RNG no spawn — ADR 0031).

2. **Stats como o Canary:** vida máxima `× (1 + (15·stack + 35) / 100)` arredondada para cima;
   ícone de stack no `creature-appear` (apresentação). Nada mais muda na criatura.

3. **Dust é registro; slivers e cores são item.** Ao morrer, Influenced dá `stack ×
   forgeAmountMultiplier` de dust ao(s) matador(es), limitado por `forge.dustLevel` (100 inicial,
   sobe até 225 gastando dust — `forgeMaxDust`); Fiendish dá `uniform(3, 7)` slivers mais dust.
   Divisão em party como `exaltation_forge.lua`. Dust vai para o registro `forge.dust` (não
   ocupa inventário, não tem valor de venda, não existe como item no Tibia); slivers e **exalted
   cores** são itens empilháveis do catálogo que caem no cadáver (ADR 0048) e passam pelo
   inventário como qualquer item.

4. **As três ações da forja são intenções de Cidade** (ADR 0052 d.2 e d.4), com rolagem no
   `session.rng` da Cidade: **fusão** (dois itens do mesmo id e tier `t`, 100 dust + gold da
   `TierInfo` por classificação; sucesso 50 %, +15 % com core; falha destrói o segundo item e,
   sem "tier loss reduction" paga, pode baixar o tier do primeiro), **transferência** (tier de A
   para B do mesmo tipo, 100 dust + core + gold) e **conversão** (dust → slivers, slivers → core,
   dust → +1 de `dustLevel`). Gold pelo ledger, itens por `removedInstances`/`acquired`, tier por
   `overlays` (ADR 0052 d.3). Convergence fusion/transfer entram só se a TibiaWiki confirmar que
   são anteriores ao 13.32; senão ficam no relatório do corte.

5. **Procs de tier no `combat-v4`**, no ponto do `combat.cpp` onde o Canary os lê: Onslaught
   (fatal, arma), Ruse (esquiva, armadura), Momentum (reduz cooldown de magia, capacete),
   Transcendence (Avatar sem magia, pernas) e Amplification (aumenta bônus de tier, botas), com as
   fórmulas quadráticas da config (`ruseChanceFormulaA/B/C` etc.). Tier 0 é ausência de proc.

6. **Histórico da forja** (`player_forge_history`) fica no registro `forge.history`, limitado às
   últimas 100 ações — é tela, não economia; nada além do ledger precisa dele para auditoria.

## Alternativas

- **Teto global de Influenced/Fiendish em Redis, compartilhado entre sessões.** Descartada:
  acoplaria o spawn de uma hunt ao estado de outras (invariante 3: o resultado da sessão não
  depende de nada fora dela) e exigiria I/O no caminho do spawn.
- **Escolher a Influenced no início da sessão, uma lista fixa.** Descartada: no Canary a
  criação é contínua ao longo do dia; por spawn é a leitura mais próxima que uma sessão consegue.
- **Dust como item empilhável.** Descartada: não é item no Tibia (é contador do jogador);
  como item entraria em peso, venda e loot com regras que o jogo real não tem.
- **Forjar na hunt.** Descartada pelo ADR 0052 d.4: rolagem fora da Cidade perturbaria o RNG da
  hunt; o Tibia também só forja em cidade.

## Consequências

- #616–#618 destravam. `docs/product/items.md` ganha a seção da Forja ao lado do overlay.
- Registro `forge { dust, dustLevel, history, version }`; itens `exalted-sliver`, `exalted-core`
  no catálogo (M34); `creature-appear` leva `forgeStack` opcional.
- `combat-v4` ganha o estágio de spawn (stack) e os cinco procs.
- O que piora: quatro números de conteúdo sem fonte direta no Canary (as chances e o teto por
  sessão), marcados `[ABERTO — provisório]`; a calibração vem da observação do jogo, não do código.

## Invariantes afetados

Nenhum. O **7** é a razão de o stack ser da instância; o **3** é a razão do teto por sessão; **9**
e **10** vêm do ADR 0052.
