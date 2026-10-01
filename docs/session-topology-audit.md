# Auditoria de `session.participants` no `HuntRuleset` (OW-12)

Instantâneo de 2026-10-01. A costura `SessionTopology` (`packages/sim/src/rulesets/topology.ts`, [ADR 0060](adr/0060-tibia-open-world-without-pvp.md) decisão 4) existe porque o `HuntRuleset` lê `session.participants` como "a party": todo presente leva o abate, todos são elegíveis, o loot vai a um sorteado, a sessão acaba quando esvazia. No mundo compartilhado isso dá o loot de uns aos outros. O plano (`open-world-plan.md` §7) aponta esta costura como o ponto mais arriscado do programa, e a mitigação é esta tabela: **cada uso classificado**, para que nenhum fique para trás sem dono.

Este documento é o que a PR da OW-12 traz como "a tabela dos usos". Não é um contrato vivo: é a leitura do arquivo no commit `00c70359` (a `origin/tibia-parity` no começo da OW-12). Quem mexer em `hunt.ts` depois e acrescentar um uso de `session.participants` o classifica na própria PR, com estas quatro perguntas.

## O que foi contado

`packages/sim/src/rulesets/hunt.ts` em `00c70359` tem **150** ocorrências do texto `session.participants` — a issue contava 125 em `733a4e0c`, e o arquivo cresceu desde então (Bosstiary, facções, invocação, treino). **135** são código e **15** são comentário. A tabela do fim cobre as 135; os comentários só citam o campo.

`session.participants` é a lista de quem está na sessão, em ordem de entrada. Ela serve a duas perguntas muito diferentes, e a auditoria existe para separá-las:

- **criaturas presentes**: "quem está aqui, para o monstro mirar, para o tile ficar ocupado, para a magia em área acertar". É verdade em qualquer topologia. O mundo também precisa dela.
- **roster da party**: "quem leva junto". É o que a instância supõe e o mundo não pode supor.

## As quatro classes

| Classe | Significa | O que acontece |
|---|---|---|
| **P** — presentes | O uso lê quem está na sessão como criatura: busca por id, ocupação de tile, alvo de monstro, área de magia, quem bateu. | **Fica.** Vale em qualquer topologia. |
| **T** — topologia | O uso decide uma coisa de recompensa ou de vida da sessão pelo roster. | **Vai para a topologia**: o método está na coluna "Destino". |
| **G** — guardado | É roster da party, mas num código que só roda com `partyOptions`, bolsa compartilhada, votação, rota ou líder. O mundo não passa essas opções, não tem rota e não tem líder. | **Fica**, e o guarda está dito na coluna "Destino". Extrai-se por inteiro na fase do núcleo (OW-61 a OW-65), que é dívida registrada no ADR 0060 d.4. |
| **A** — aberto | É roster da party **sem guarda**: hoje a sessão inteira é a party, e o mundo precisa de uma decisão. | **Fica nesta issue, com dono**: OW-28 ou OW-43, na coluna "Destino". |

## O resultado

| Classe | Usos |
|---|---:|
| P — presentes | 79 |
| T — topologia | 16 |
| G — guardado | 31 |
| A — aberto | 9 |
| **Total** | **135** |

Os 16 usos de classe T estão atrás de 9 perguntas e 2 chaves da `SessionTopology`, que tem ao todo **11 perguntas** e **3 chaves**. As outras três (`startsInstanceSchedules`, `placeOnEnter` e `runsRouteWalker`) não aparecem na tabela porque não leem `session.participants`: decidiam por `#runners.size` e pela rota.

| Membro da topologia | Usos da tabela | O que a instância faz (o código de hoje) |
|---|---|---|
| `creditKill` | 1 | Todo presente leva o abate. |
| `rewardEligible` | 3 | Solo: o pagável, se vivo e com stamina. Party: todo presente vivo e com stamina. |
| `lootRecipient` | 1 | Solo: o matador, sem sorteio. Party `split`: um elegível sorteado. Party `shared`: ninguém, vai para a bolsa. |
| `leaderOf` | 1 | O líder da party presente, ou o mais antigo. |
| `onEmpty` | 1 | A sessão acaba. |
| `onLeaderGone` | 2 | O mais antigo assume e grava `leader-changed`. |
| `onCharacterDied` | 1 | Solo encerra; party solta o morto com o extrato dele. |
| `onExitFinished` | 1 | O mesmo, para a saída concluída. |
| `burnsStaminaByTime` | 1 | Sim. |
| `runsExitRules` | 2 | Sim: o evento periódico e a cascata `party-member-lost`. |
| `namesOwnerInEvents` | 2 | Só com mais de um presente. |
| `startsInstanceSchedules` | — | Com o primeiro corredor. |
| `placeOnEnter` | — | O primeiro no tile inicial da rota; o segundo no livre mais próximo. |
| `runsRouteWalker` | — | Sim. |

Dos onze membros que o ADR 0060 d.4 lista, esta issue entrega todos. A auditoria achou **três perguntas a mais** que também decidiam por "quantos estão aqui": `leaderOf` (a outra metade da liderança), `onExitFinished` (a outra porta de saída, irmã da morte) e `namesOwnerInEvents` (o formato do `level-up`, `bestiary-milestone`, `bosstiary-level` e `hazard-level-up` do extrato dependia de haver um só presente, e no mundo o número de presentes não pode decidir o que vai para o ledger).

## O que ficou aberto, e com quem

São os 9 usos de classe A da tabela (10 com o acréscimo de `#hazardPoints`, abaixo). Nenhum é alcançável hoje (o mundo ainda não existe), mas todos entregariam algo a estranhos no dia em que ele existir, e por isso têm dono.

**OW-28 — Crédito do Canary** (`#xpShares`, `#killersOf`; usos 12143, 12197, 12198, 12201):
- `#xpShares` monta `allMembers` com a sessão inteira, e a cota igual divide por esse tamanho. No mundo a XP é `floor(dano dele / dano total × experiência)`, e o roster não entra na conta.
- `#killersOf` devolve o roster inteiro quando não há `partyOptions` e há 2 ou mais presentes — o mesmo fallback que serve às fixtures. No mundo isso dá o Bosstiary a quem não bateu.

**OW-43 — Party no mundo** (`#resolveRuleTarget`, `#armHealersOf`, `#collectPartyAllies`, `#fearAffects`; usos 6404, 6416, 6417, 6858, 10404 — e `#hazardPoints`, que entrou depois):
- O alvo de cura "party", as magias de party (Heal/Protect/Enchant/Train Party), o teto de medo da party e o nível de hazard da party (o menor entre os membros) leem a sessão inteira. O Canary os lê na party do lançador.
- `#armHealersOf` varre todos os presentes a cada golpe sofrido (`custo N por golpe`, ADR 0035). Com 200 no mundo isso é custo, além de comportamento.

## Armadilhas para quem escrever a topologia de mundo (OW-13)

- **`leaderOf` devolvendo `undefined` é o caso do mundo**, e quem o chama já o trata: `follow: leader` fica sem alvo (`#holdFollow`), `#leaderReservedTile` devolve `null`, `#partyRegroupBlocked` devolve `false` e o `party-state` cai para o `leaderId` da party. O único chamador que não trata é a liquidação da bolsa (`?? present[0]`), e ela só roda com bolsa (classe G).
- **`onEmpty` que não encerra deixa a sessão viva e vazia.** `#flushLoss` volta logo depois dele: não emite `party-state` nem decide votação, que também são de party.
- **`runsExitRules: false` não desliga a saída que o jogador pede.** `requestExit`, `cancelExit` e `exitStatus` continuam valendo, e quem conclui a saída é `onExitFinished`. A trava de combate (#625) é do ruleset, não da topologia.
- **`creditKill` só é perguntada quando o abate paga alguém.** A morte de monstro por monstro sem dano de nenhum presente (#619) não paga ninguém e nunca chega à topologia; quem decide isso é o ruleset (`rewarded`).
- **`lootRecipient` consome `session.rng`** na instância (party `split`): o número e a ordem dos sorteios são contrato (FUN-63). Uma topologia nova que sorteie precisa decidir isso, e a de mundo não deve sortear.
- **A topologia não vai no snapshot.** `huntRulesetFromSnapshot` e `changeDifficulty` montam o ruleset com o default (`instanceTopology`). Isto está certo para a instância, e a sessão de mundo é `checkpointed` e não tem snapshot (ADR 0060 d.10a); quem criar uma sessão que retoma com outra topologia passa a opção na própria montagem.

## Acréscimos depois de `00c70359`

A `origin/tibia-parity` andou enquanto a OW-12 estava aberta (o último merge foi em `c3829ae3`), e duas entregas acrescentaram seis usos de código de `session.participants` ao `hunt.ts`: o Hazard (#632) e a condição de forma (outfit). Pela mesma régua:

| Método | Uso | Classe | Destino |
|---|---|---|---|
| `lookOf` | `findById(session.participants, creatureId)` | P | busca por id |
| `#applyConditionTick` | `findById(session.participants, condition.sourceId) !== null` | P | busca por id: a fonte da condição ainda está na sessão |
| `#executeOutfitAbility` | `[...session.participants, ...this.#monsters]` | P | candidatos da ability de forma |
| `#hazardOnMonsterDeath` | `session.participants.filter(damageByActor)` | P | quem feriu o monstro (o `damageMap` do Canary) |
| `#hazardOnMonsterDeath` | `session.participants.length === 1` | T | `namesOwnerInEvents` — o `hazard-level-up` tinha o mesmo formato condicionado ao número de presentes, e foi ligado à topologia nesta PR |
| `#hazardPoints` | `for (const member of session.participants)` | **A** | **OW-43**: o nível de hazard é o MENOR entre os "membros" (`Party:refreshHazard`), e hoje o membro é a sessão inteira. No mundo, o monstro bateria com o menor nível de todos os presentes |

O total passa a **141** usos de código (P 83, T 17, G 31, A 10), e o item A novo entra na lista da OW-43 acima.

## A tabela

Linhas de `packages/sim/src/rulesets/hunt.ts` em `00c70359`. As colunas "Classe" e "Destino" seguem as quatro classes acima.

| # | Linha | Método | Uso | Classe | Destino |
|---|---|---|---|---|---|
| 1 | 2175 | `useSlot` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 2 | 2238 | `#useItemLike` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 3 | 2273 | `#onPendingManualAction` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 4 | 2412 | `chooseTarget` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 5 | 2547 | `useOnMap` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 6 | 2815 | `partySpendingPreview` | `const presentIds = session.participants.map((p) => p.id);` | G | só com party em modo `shared` (`#party`/`#bag`) |
| 7 | 2857 | `configureParty` | `this.#settle(session, session.participants, 'toggle');` | G | só com party (`configureParty` exige o líder) |
| 8 | 2905 | `approveEnd` | `if (!session.participants.some((p) => p.id === characterId)) {` | G | votação de encerramento: só com party |
| 9 | 2921 | `cancelEnd` | `if (!session.participants.some((p) => p.id === byCharacterId)) {` | G | votação de encerramento: só com party |
| 10 | 2968 | `#settleEndVote` | `if (session.participants.some((p) => !vote.approved.has(p.id))) return;` | G | votação de encerramento: `#endVote` só existe com party |
| 11 | 3007 | `partySummary` | `const present = session.participants.map((p) => ({ id: p.id, vocationId: th...` | G | devolve `undefined` sem party |
| 12 | 3023 | `partySummary` | `members: session.participants.map((p) => p.id),` | G | devolve `undefined` sem party |
| 13 | 3060 | `onEnter` | `if (this.#party !== undefined && session.participants.length > this.#option...` | G | o teto de membros só vale com `#party` |
| 14 | 3083 | `onEnter` | `this.#world.reset([...this.#monsters, ...session.participants.filter((p) =>...` | P | ocupação de tiles: quem já está no mapa |
| 15 | 3218 | `onLeave` | `if (this.#bag !== null) this.#settle(session, [...session.participants, cha...` | G | liquidação da bolsa: `#bag !== null`, só no modo `shared` |
| 16 | 3241 | `#flushLoss` | `if (session.participants.length === 0) {` | T | `onEmpty` — a checagem de "ninguém" fica; o que fazer com ela é da topologia |
| 17 | 3247 | `#flushLoss` | `if (party !== undefined && !session.participants.some((p) => p.id === party...` | T | `onLeaderGone` |
| 18 | 3248 | `#flushLoss` | `const next = session.participants[0];` | T | `onLeaderGone` |
| 19 | 3266 | `#emitPartyState` | `members: session.participants.map((p) => ({ characterId: p.id, alive: p.ali...` | G | `party-state`: sai cedo sem `#party` |
| 20 | 3305 | `exitStatus` | `const lastCombatAtMs = findById(session.participants, characterId)?.lastCom...` | P | busca por id |
| 21 | 3462 | `#burnStamina` | `for (const character of session.participants) {` | T | `burnsStaminaByTime` — o laço é de presentes, quem decide se roda é a chave |
| 22 | 3492 | `#onRegen` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 23 | 3621 | `#onCharacterDied` | `if (session.participants.length <= 1) {` | T | `onCharacterDied` |
| 24 | 3699 | `#onMemberLost` | `for (const member of [...session.participants]) {` | T | `runsExitRules` — a cascata `party-member-lost` é uma regra de saída |
| 25 | 3717 | `onEnd` | `for (const character of session.participants) {` | P | cada presente solta o observer e credita o banco de treino |
| 26 | 3729 | `onEnd` | `if (this.#bag !== null) this.#settle(session, session.participants, 'end');` | G | liquidação da bolsa: `#bag !== null` |
| 27 | 3817 | `onResume` | `for (const character of session.participants) {` | P | retomada: casa cada presente com o seu `Runner` |
| 28 | 3825 | `onResume` | `?? (pending?.byId === null && session.participants.length === 1 ? pending.l...` | P | retomada de snapshot legado de um dono só |
| 29 | 4179 | `#spawnMonster` | `for (const character of session.participants) {` | P | quem está ao lado do monstro que nasceu |
| 30 | 4566 | `#creatureById` | `const character = findById(session.participants, id);` | P | busca por id |
| 31 | 4579 | `#preyById` | `const character = findById(session.participants, id);` | P | busca por id |
| 32 | 4613 | `#chooseMonsterTarget` | `const owner = findById(session.participants, monster.masterId);` | P | busca por id |
| 33 | 4642 | `#chooseMonsterTarget` | `? session.participants` | P | alvos possíveis do monstro |
| 34 | 4643 | `#chooseMonsterTarget` | `: [...session.participants, ...summons];` | P | alvos possíveis do monstro |
| 35 | 4766 | `#targetPreyOf` | `return others.length === 0 ? session.participants : [...session.participant...` | P | alvos possíveis do monstro |
| 36 | 4769 | `#targetPreyOf` | `const targets: Prey[] = summon \|\| profile.enemies.has(FACTION_PLAYER) ? [.....` | P | alvos possíveis do monstro |
| 37 | 4817 | `#playerInView` | `for (const participant of session.participants) {` | P | há personagem à vista do monstro |
| 38 | 4855 | `#onPlayerStep` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 39 | 5110 | `#playerStep` | `&& (this.#hasActiveFollow(session) \|\| session.participants.length === 1)` | G | só no ramo da rota (`runsRouteWalker`): a válvula de índice do walker |
| 40 | 5167 | `#companionAt` | `for (const other of session.participants) {` | P | companheiro parado no tile (ramo da rota) |
| 41 | 5195 | `#nudgeCompanion` | `const blocker = session.participants.find((other) => other.alive` | P | companheiro parado no tile (ramo da rota) |
| 42 | 5252 | `#clearCompanionsAround` | `for (const other of session.participants) {` | P | companheiros ao redor (ramo da rota) |
| 43 | 5270 | `#hasActiveFollow` | `for (const character of session.participants) {` | P | algum presente tem follow configurado |
| 44 | 5375 | `#holdFollow` | `const target = targetId === null ? null : findById(session.participants, ta...` | P | busca por id |
| 45 | 5730 | `#crossesAwayFromLeader` | `const target = targetId === null ? null : findById(session.participants, ta...` | P | busca por id |
| 46 | 5746 | `#mustCrossFloorToFollow` | `const target = targetId === null ? null : findById(session.participants, ta...` | P | busca por id |
| 47 | 5820 | `#partyRegroupBlocked` | `const followers = session.participants.filter((p) => {` | G | só alcançado por quem `leaderOf` devolve como líder: o mundo não tem líder |
| 48 | 5936 | `configureBot` | `? session.participants[0]` | G | default "o primeiro" do caminho solo; o hospedeiro sempre passa o `characterId` |
| 49 | 5937 | `configureBot` | `: findById(session.participants, characterId) ?? undefined;` | P | busca por id |
| 50 | 5974 | `rearmBot` | `if (findById(session.participants, characterId) === null) return;` | P | busca por id |
| 51 | 5997 | `requestMove` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 52 | 6051 | `#onPlayerAttack` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 53 | 6155 | `#onBot` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 54 | 6309 | `#resolveManualTarget` | `const member = findById(session.participants, target.characterId);` | P | busca por id |
| 55 | 6320 | `#resolveManualTarget` | `const member = findById(session.participants, target.characterId);` | P | busca por id |
| 56 | 6395 | `#resolveRuleTarget` | `const member = findById(session.participants, rule.target.characterId);` | P | busca por id |
| 57 | 6404 | `#resolveRuleTarget` | `return session.participants` | A | OW-43 — alvo de cura "party": hoje é a sessão inteira, o mundo precisa de roster de party |
| 58 | 6416 | `#armHealersOf` | `if (session.participants.length <= 1) return;` | A | OW-43 — `<= 1` e laço sobre a sessão inteira por golpe: custo N por golpe com 200 no mundo |
| 59 | 6417 | `#armHealersOf` | `for (const participant of session.participants) {` | A | OW-43 — idem |
| 60 | 6858 | `#collectPartyAllies` | `for (const participant of session.participants) {` | A | OW-43 — magias de party: o Canary usa a party do lançador, não a sessão |
| 61 | 6881 | `#collectHealAllies` | `for (const participant of session.participants) {` | P | cura em área (Mass Healing): quem está no alcance |
| 62 | 7344 | `#scheduleVisibilityThinks` | `for (const character of session.participants) {` | P | cada presente pensa a visibilidade |
| 63 | 7381 | `#onVisibilityThink` | `const character = findById(session.participants, subject);` | P | busca por id |
| 64 | 7567 | `#conditionTargetOf` | `return findById(session.participants, id);` | P | busca por id |
| 65 | 7923 | `#hasVisibleCreatureAt` | `for (const character of session.participants) {` | P | há criatura visível no tile |
| 66 | 8055 | `#convertToSummon` | `for (const character of session.participants) this.#autoSelectTarget(sessio...` | P | cada presente reavalia o alvo |
| 67 | 8126 | `#occupants` | `for (const character of session.participants) {` | P | ocupação de tiles |
| 68 | 8227 | `#useSupply` | `const shared = this.#party !== undefined && this.#party.shareCosts && sessi...` | G | rateio de custo: `#party.shareCosts` |
| 69 | 8484 | `#naturalStateOf` | `? (session.participants.length <= 1 ? 'person-not-found' : null)` | P | Find Person: alguém mais na sessão |
| 70 | 8770 | `#onAutomation` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 71 | 8892 | `#onItemRegen` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 72 | 8959 | `#equipmentObserver` | `const character = previous === null ? null : findById(session.participants,...` | P | busca por id |
| 73 | 8980 | `#equipmentObserver` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 74 | 8997 | `#recomputeSpeed` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 75 | 9014 | `#onEquipExpire` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 76 | 9090 | `#summonFollowOf` | `const master = typeof monster.masterId === 'string' ? findById(session.part...` | P | busca por id |
| 77 | 9123 | `#onAttackThink` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 78 | 9139 | `#releaseParkedAttacks` | `for (const character of session.participants) {` | P | cada presente solta o golpe estacionado |
| 79 | 9244 | `#onMonsterStep` | `monster, definition, liveTarget, session.participants, summons, blocked,` | P | alvos possíveis do monstro |
| 80 | 9299 | `#onMonsterStep` | `for (const character of session.participants) {` | P | cada presente na vista do monstro |
| 81 | 9484 | `#executeMonsterAbility` | `? session.participants` | P | alvos possíveis do monstro |
| 82 | 9485 | `#executeMonsterAbility` | `: [...session.participants, ...summons];` | P | alvos possíveis do monstro |
| 83 | 9946 | `#onMonsterTargetChange` | `? session.participants` | P | alvos possíveis do monstro |
| 84 | 9947 | `#onMonsterTargetChange` | `: [...session.participants, ...summons];` | P | alvos possíveis do monstro |
| 85 | 10404 | `#fearAffects` | `const participants = session.participants;` | A | OW-43 — teto de medo da party: sem party o mundo não deve contar estranhos |
| 86 | 10482 | `#onFearThink` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 87 | 10581 | `#emitHealed` | `if (healerId !== undefined && session.participants.some((p) => p.id === hea...` | P | quem curou ainda está na sessão |
| 88 | 10628 | `#applyExitRules` | `for (const character of session.participants) {` | T | `runsExitRules` — o laço das regras é de cada presente; só roda com a chave |
| 89 | 10673 | `#finishExit` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 90 | 10682 | `#finishExit` | `if (session.participants.length <= 1) {` | T | `onExitFinished` |
| 91 | 10748 | `#strike` | `const shareCosts = this.#party !== undefined && this.#party.shareCosts && s...` | G | rateio de custo: `#party.shareCosts` |
| 92 | 11328 | `#carnage` | `const killer = findById(session.participants, credit.lastHitBy)` | P | busca por id |
| 93 | 11329 | `#carnage` | `?? findById(session.participants, dead.targetId);` | P | busca por id |
| 94 | 11791 | `#onMonsterDied` | `const lastHitter = findById(session.participants, credit.lastHitBy);` | P | busca por id |
| 95 | 11816 | `#onMonsterDied` | `if (rewarded) for (const participant of session.participants) session.credi...` | T | `creditKill` |
| 96 | 11821 | `#onMonsterDied` | `const solo = session.participants.length === 1;` | T | `rewardEligible` |
| 97 | 11822 | `#onMonsterDied` | `const payee = diedToMonster ? session.participants[0] ?? null : lastHitter;` | T | `rewardEligible` |
| 98 | 11827 | `#onMonsterDied` | `: session.participants.filter((p) => p.alive && !isExhausted(p));` | T | `rewardEligible` |
| 99 | 11841 | `#onMonsterDied` | `if (payLoot && definition !== undefined && this.#bag !== null && session.pa...` | G | bolsa compartilhada: `#bag !== null` |
| 100 | 11849 | `#onMonsterDied` | `const presentAtDrop = session.participants.map((p) => p.id);` | G | bolsa compartilhada: quem estava presente no abate |
| 101 | 11857 | `#onMonsterDied` | `this.#creditSupplies(session, session.participants, loot.supplies);` | G | bolsa compartilhada: supply dividido entre os presentes |
| 102 | 11858 | `#onMonsterDied` | `this.#creditAmmunition(session, session.participants, loot.ammunition);` | G | bolsa compartilhada: munição dividida entre os presentes |
| 103 | 11967 | `#onMonsterDied` | `for (const character of session.participants) forgetActor(character.contrib...` | P | cada presente esquece o ator que morreu |
| 104 | 11993 | `#onMonsterDied` | `const owner = findById(session.participants, monster.masterId);` | P | busca por id |
| 105 | 12006 | `#onMonsterDied` | `for (const character of session.participants) this.#autoSelectTarget(sessio...` | P | cada presente reavalia o alvo |
| 106 | 12082 | `#removeSummon` | `for (const character of session.participants) forgetActor(character.contrib...` | P | cada presente esquece o ator |
| 107 | 12105 | `#removeSummon` | `for (const character of session.participants) this.#autoSelectTarget(sessio...` | P | cada presente reavalia o alvo |
| 108 | 12143 | `#xpShares` | `const allMembers = session.participants.map((p) => ({ id: p.id, vocationId:...` | A | OW-28 — `allMembers` da XP: no mundo a XP é pela fatia de dano, não pelo roster |
| 109 | 12165 | `#sharedExperienceActive` | `const leader = session.participants.find((p) => p.id === party.leaderId);` | G | só com `partyOptions`: a XP compartilhada |
| 110 | 12166 | `#sharedExperienceActive` | `const highestLevel = session.participants.reduce((max, p) => Math.max(max, ...` | G | só com `partyOptions`: a XP compartilhada |
| 111 | 12169 | `#sharedExperienceActive` | `session.participants.map((member) => ({` | G | só com `partyOptions`: a XP compartilhada |
| 112 | 12197 | `#killersOf` | `const dealers = session.participants.filter((p) => (credit.damageByActor[p....` | A | OW-28 — `killers` do Bosstiary: sem party, 2+ presentes caem no roster inteiro |
| 113 | 12198 | `#killersOf` | `if (dealers.length === 0 \|\| session.participants.length === 1) return dealers;` | A | OW-28 — idem |
| 114 | 12201 | `#killersOf` | `? session.participants` | A | OW-28 — idem |
| 115 | 12222 | `#creditBosstiary` | `const solo = session.participants.length === 1;` | T | `namesOwnerInEvents` |
| 116 | 12259 | `#grantPartyXp` | `const solo = session.participants.length === 1;` | T | `namesOwnerInEvents` |
| 117 | 12321 | `#sharedPurse` | `const present = session.participants;` | G | rateio de custo da bolsa compartilhada |
| 118 | 12341 | `#sharedPurse` | `for (const member of session.participants) {` | G | rateio de custo da bolsa compartilhada |
| 119 | 12354 | `#leader` | `return session.participants.find((p) => p.id === wanted) ?? session.partici...` | T | `leaderOf` |
| 120 | 12401 | `#deliverToBag` | `const presentAtDrop = session.participants.map((p) => p.id);` | G | bolsa compartilhada: `#deliverToBag` |
| 121 | 12423 | `#deliverToBag` | `const member = findById(session.participants, characterId);` | G | bolsa compartilhada: `#deliverToBag` |
| 122 | 12428 | `#deliverToBag` | `for (const p of session.participants) session.credit(p.id, 'itemsLooted', r...` | G | bolsa compartilhada: `#deliverToBag` |
| 123 | 12448 | `#deliverToBag` | `for (const p of session.participants) session.credit(p.id, 'itemsLooted', c...` | G | bolsa compartilhada: `#deliverToBag` |
| 124 | 12457 | `#availableCapacities` | `return session.participants.map((p) => ({` | G | capacidade da bolsa compartilhada |
| 125 | 12566 | `#lootRecipient` | `if (this.#party === undefined \|\| session.participants.length < 2) {` | T | `lootRecipient` |
| 126 | 12580 | `#participantsDealtDamage` | `for (const participant of session.participants) {` | P | quem bateu neste monstro |
| 127 | 12612 | `#corpseOwnerOf` | `if (findById(session.participants, actorId) === null && !actorId.startsWith...` | P | busca por id |
| 128 | 12616 | `#corpseOwnerOf` | `return findById(session.participants, owner);` | P | busca por id |
| 129 | 12637 | `#experiencePool` | `for (const participant of session.participants) {` | P | a fatia de dano de cada presente na XP do #619 |
| 130 | 12661 | `#gutOf` | `const owner = findById(session.participants, credit.mostDamageBy);` | P | busca por id |
| 131 | 12969 | `openCorpse` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 132 | 12996 | `takeLoot` | `const character = findById(session.participants, characterId);` | P | busca por id |
| 133 | 13864 | `#hasVisibleParticipant` | `for (const participant of session.participants) {` | P | há personagem à vista |
| 134 | 13895 | `#rebuildOccupancy` | `this.#world.reset([...this.#monsters, ...session.participants]);` | P | ocupação de tiles |
| 135 | 14117 | `changeDifficulty` | `const characters = [...session.participants];` | G | troca de dificuldade: operação da instância, o mundo não a tem |
