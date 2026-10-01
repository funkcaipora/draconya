# 0054 — Prey, Task Hunting, Concoctions e Boosted Creature: o tempo "online" é tempo de hunt, e o dia é do `jobs`

**Status:** proposto — decorre do [ADR 0045](0045-tibia-bestiary-charms-prey-and-training.md)
**Emendado pelo [ADR 0060](0060-tibia-open-world-without-pvp.md) (2026-09-30) — d.1:** a Prey corre junto com a stamina no mundo.
decisão 3 (Prey/Task Hunting/Concoctions pelo Canary) e persiste/cobra pelo
[ADR 0052](0052-endgame-progression-state-and-city-services-through-the-owning-session.md)
**Data:** 2026-09-27
**Contexto técnico:** `packages/content` (`prey/`, `task-hunting/`, `concoctions/`, monstro:
`preyExclusive`), `packages/sim` (`rulesets/hunt.ts` — termo de XP #563, loot #520/ADR 0048,
spawn ADR 0039), `packages/server` (registros `prey`, `taskHunting`, `concoctions`; `jobs`
diário; ticket `boostedMonsterId`), `docs/product/prey.md`
**Issues:** M42 — #612, #613, #614, #615

## Contexto

Os quatro sistemas dependem de **tempo** de formas que o Canary resolve com um servidor sempre
ligado e o jogador "online": a Prey dura 2 h (`preyBonusTime`) e a Concoction 1 h, ambas
contadas enquanto o jogador está logado (`checkPlayerPreys` por minuto; `tickType 'online'`); o
reroll grátis volta 20 h depois (`preyFreeRerollTime`), em tempo de parede; a criatura boosted
troca uma vez por dia no servidor inteiro. O Draconya não tem "online": tem sessão de hunt que
roda com o navegador fechado (invariante 3), Cidade que equivale a offline (ADR 0043 d.2) e um
`sim` que não lê relógio (invariante 1). A issue #614 pergunta exatamente isso: "o que é 'online'
no Draconya?".

A especificação vigente de Prey (`docs/product/prey.md`) veio da observação do Huntera (±70
levels, +10 % fixo, 4 h) e o ADR 0045 já a substituiu pelo Canary; falta dizer o que dos três
sistemas do Canary depende da Loja (Prey Wildcards, terceiro slot) e portanto espera o M22.

## Decisão

1. **"Online" é tempo de sessão de hunt.** `bonusTimeLeft` da Prey (7 200 s) e a duração da
   Concoction (3 600 s) são consumidos pelo tempo decorrido **dentro de uma hunt** — o vencimento
   é um evento agendado na fila da sessão (invariante 2), e o tempo restante sai no extrato quando
   a hunt acaba. Na Cidade nada é consumido. Não depende de haver visualizador (invariante 3), e é
   a mesma régua que a stamina já usa (ADR 0043 d.1: 1 min por 60 s de hunt).

2. **Cooldown de parede é carimbo no registro.** `freeRerollAt` (20 h) da Prey e do Task Hunting,
   `disabledUntil` da tarefa concluída (`taskHuntingLimitedTasksExhaust`, 20 h) e
   `lastActivatedAt` da Concoction (24 h) são timestamps persistidos, comparados na intenção com o
   `nowMs` que o servidor passa (ADR 0052 d.6).

3. **Prey pelo `ioprey.cpp`, dois slots.** Slot 1 para todos, slot 2 exige Premium; o terceiro
   (`preyFreeThirdSlot false`, Loja) e tudo que custa Prey Wildcard (`preySelectListPrice`,
   `preyBonusRerollPrice`, reroll automático, trava de monstro) ficam para o M22 (Loja). Fica:
   grade de 9 monstros sorteada por faixa de level (`reloadMonsterGrid`, estágios por `level/100`)
   sobre o bestiário importado, respeitando `preyExclusive` e sem repetir monstro entre slots;
   reroll da lista grátis a cada 20 h ou por `level × 200` gold pelo ledger; bônus sorteado entre
   dano, defesa, XP e loot com raridade 1–10 que só sobe (`reloadBonusValue`: dano `2r+5` %,
   defesa `2r+10` %, XP e loot `3r+10` %). A grade e a raridade rolam com o `session.rng` da
   Cidade (ADR 0052 d.4) — a intenção de Prey é só de Cidade.

4. **Os bônus de Prey entram onde o Canary os aplica.** XP: multiplicador no termo de XP do #563,
   só contra a raça do slot. Dano dado e recebido: modificadores declarados no `combat-v4` (ADR
   0052 d.7). Loot: um **roll extra inteiro** de loot com chance igual à porcentagem
   (`ondroploot_prey.lua`), somando as chances dos membros da party com o fator 0,7
   (`partyShareLootBoostsDimishingFactor`) — cai no cadáver como o loot normal (ADR 0048).

5. **Task Hunting pelo `ioprey.cpp`, dois slots** (segundo Premium; terceiro com a Loja).
   Dificuldade pela classe do bestiário do monstro; `kills` 25/100/400 por dificuldade × estrelas,
   `secondKills = 2×` quando o jogador aceita o upgrade; recompensa em pontos pela fórmula de
   `initializeTaskHuntOptions`. O abate conta **na hunt, no mesmo evento do Bestiário**, sempre
   (ADR 0043 d.1); os pontos são persistidos no registro `taskHunting` e só sobem por conclusão.
   Reroll e carimbos como na Prey.

6. **Concoctions são compradas com pontos de Task Hunting** (decisão do dono na #614), catálogo
   do `concoctions.lua` (efeitos por condição: crítico +5 %, absorb/increase elemental 8 %,
   Wealth Duplex, Bestiary Betterment 2×, Kooldown Aid, Stamina Extension +60 min), 1 h de hunt,
   24 h de parede entre ativações do mesmo tipo. Comprar e ativar são intenções de Cidade; o
   efeito é condição do M31 (ADR 0041) com vencimento na fila. Preço em pontos por Concoction é
   dado de conteúdo, `[ABERTO — provisório: o do NPC do Tibiadrome no Canary]`.

7. **Boosted Creature é o `jobs`.** Uma vez por dia (hora de virada em conteúdo,
   `boosted.rolloverHourUtc`), o singleton sorteia um monstro com entrada de bestiário e grava
   `world_daily.boostedMonsterId` (Postgres) mais uma cópia em Redis para a `api`. O ticket leva
   `boostedMonsterId`; a sessão o **fixa** no início (ADR 0052 d.5) — a hunt que atravessa a
   virada continua com a boosted com que nasceu, como faz com a versão de conteúdo (invariante 7).
   Efeito: `spawntime / 2` para os pontos daquele monstro, XP ×2 e um roll extra de loot
   (`ondroploot_boosted.lua`). O catálogo de hunts destaca a criatura do dia.

## Alternativas

- **Prey e Concoction em tempo de parede.** Descartada: puniria quem não caça continuamente e
  divergiria do `'online'` do Canary sem ganhar fidelidade — o Tibia também não conta offline.
- **Contar tempo na Cidade como online.** Descartada: a Cidade equivale a offline desde o ADR 0043
  d.2 (stamina); dois sentidos de "online" seriam dois bugs esperando.
- **Manter a especificação do Huntera (`prey.md`).** Descartada pelo ADR 0045 d.3.
- **Prey Wildcards como moeda de gold.** Descartada: no Tibia são item da Loja/Daily Reward; dar
  outro caminho criaria uma economia nova sem fonte. Esperam o M22.
- **Boosted sorteada pela sessão.** Descartada: "do dia" é propriedade do mundo, não da sessão;
  duas hunts no mesmo dia com boosteds diferentes não é o Tibia.

## Consequências

- #612–#615 destravam. `docs/product/prey.md` é reescrito a partir do Canary com a seção "Fora
  por enquanto (Loja)".
- Registros novos: `prey` (2 slots: raça, bônus, raridade, `bonusTimeLeftMs`, `freeRerollAt`),
  `taskHunting` (2 slots, `points`, carimbos) e `concoctions` (ativas com `remainingMs`, carimbos).
  Tabela nova `world_daily` (uma linha por dia). Ticket ganha `boostedMonsterId`.
- O `jobs` ganha a primeira tarefa diária real do esqueleto (`scheduler.ts` já a listava).
- `combat-v4` ganha dois estágios declarados (dano dado e recebido da Prey); o roll extra de loot
  entra depois do `rollLoot` normal, como estágio de loot, sem mudar a semente da FUN-63.

## Invariantes afetados

Nenhum muda. O **3** e o **2** são a decisão 1; o **7** é o espírito da decisão 7; o **9** e o
**10** vêm do ADR 0052.
