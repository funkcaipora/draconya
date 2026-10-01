# Conformance e benchmark do combate

**Status:** entregue — conformance seedada e benchmark misto (CMB-10, #336)
**PRD:** §12
**Épico:** E2

Este documento é a MEDIÇÃO do pipeline de combate do M19: o contrato executável que o
[ADR 0031](../adr/0031-contrato-de-compatibilidade-de-combate-e-migracao.md) congelou, o
cenário representativo que o mede, e a leitura da linha de base. Ele não é o PRD nem o
`combat.md`; é o que responde "isto continua determinístico?" e "quanto custa?" com comando,
número e contexto de máquina.

Três decisões, e cada uma descarta uma alternativa (CMB-10):

- **DT-01 — oráculo explícito.** O esperado da matriz é dado legível escrito à mão, nunca um
  snapshot que a própria implementação gerou. Um teste que deriva o esperado do observado
  concorda com o defeito que deveria pegar.
- **DT-02 — teste no CI, métrica fora dele.** O CI roda a estrutura e a conformance; o número de
  µs depende da máquina e **não** vira teto global. Máquina lenta é contexto, não falha.
- **DT-03 — cenário misto.** O benchmark mede a composição real (ability, área, resistência,
  defesa, condição/campo e modificadores), e não um golpe corpo a corpo isolado.

## Conformance: a matriz seedada

```
pnpm exec vitest run packages/sim/src/combat/conformance.test.ts
```

A matriz vive em `packages/sim/src/combat/conformance.test.ts`, sobre o contrato puro de
`packages/sim/src/combat/conformance.ts` (`CombatConformanceCase`, `CombatConformanceResult`,
`compareConformance`, `compareObservations`). Cada caso declara semente, plano de avanço lógico
(`advancePlanMs`) e o resultado esperado. **Cada caso roda de três formas e as três têm de
coincidir**:

1. avanço em passos de **100 ms**;
2. avanço em passos de **1000 ms** (`coarsenPlan(·, 10)`, mesmo tempo total);
3. **snapshot no meio**, serialização e retomada.

A igualdade cobre resultado, agregados, morte e o **estado do RNG**. O `RngState` fica fora do
oráculo escrito à mão de propósito: ele não é um número que se lê, é uma propriedade de
equivalência — e é exatamente onde uma mudança de ordem de sorteio aparece.

### O que cada caso protege

| Caso | Etapa do marco | O que reprova |
|---|---|---|
| `physical-plain` | armadura + piso (CMB-02) | armadura por tipo, piso e arredondamento |
| `elemental-ignores-armor` | tipo de dano (CMB-03) | elemento que passa a sofrer armadura |
| `resistance-halves` | resistência (CMB-03) | fração de resistência |
| `vulnerability-amplifies` | vulnerabilidade (CMB-03) | resistência negativa |
| `immunity-zeroes` | imunidade explícita (CMB-03) | imunidade que o piso revoga |
| `defense-blocks-physical` | defesa/escudo (CMB-04) | bloqueio, e o piso sobre o poder bruto |
| `defense-passes-elemental` | `blockTypes` (CMB-04) | elemental que passa a consumir sorteio |
| `dodge-halves` | Dodge (CMB-02) | multiplicador de esquiva |
| `critical-doubles` | crítico (CMB-08) | terceiro sorteio e multiplicador |
| `life-leech-heals-attacker` | life leech (CMB-08) | base no HP aplicado e clamp no teto |
| `mana-leech-fills-attacker` | mana leech (CMB-08) | fração e espaço livre |
| `mana-shield-absorbs` | mana shield (CMB-08) | absorção total/parcial, sem morte |
| `death-ends-session` | morte (FUN-63) | pipeline de morte e `endReason` |

Casos de borda cobertos diretamente: imunidade e chance 0 consomem a **mesma** rolagem
(`compareObservations` entre casos com e sem mitigação), e a sessão que morre no meio do avanço
não deixa a duração de sessão contaminar a equivalência — `durationMs` fica fora do oráculo de
combate (`CombatConformanceAggregates`) porque é tempo de sessão, não resultado de combate.

O bloco de **motor de verdade** (`createHuntSession`) compõe ability à distância e em área,
condição/DOT e campo por tile, e prende que 100 ms, 1000 ms e a retomada produzem o **mesmo
snapshot** — prazos de DOT e de campo inclusive — e que o vencimento do campo é o instante de
aplicação mais a `durationMs` do conteúdo.

## O `combat-v2` (#522, ADR 0037 d.5)

O ADR 0031 exige registro aqui sempre que o contrato muda de propósito. O `combat-v2` é o
próximo perfil livre depois do `combat-v1` (`packages/content/src/schemas.ts`, `COMBAT_V2`):
`migrationPolicy: 'breaking'`, dano de arma pela fórmula do Canary
(`Weapons::getMaxWeaponDamage`) com variância pela normal truncada, e chance de acerto à
distância por skill e tile — o que o ADR 0037 decisão 5 pediu para o M28
(`docs/adr/0037-tfs-canary-fidelity-except-action-bar-and-automation.md`, mesclado ao main por
outra branch do M28, ainda ausente nesta). `packages/content/data/combat/baseline.json` já
declara `combat-v2`: é o perfil que toda hunt nova roda.

O que muda, e o que NÃO muda:

- **A MITIGAÇÃO é a mesma dos dois perfis.** `resolveMitigation` (`combat/damage.ts`, renomeado
  de `resolveCombatV1`) resolve `combat-v1` e `combat-v2` identicamente — Dodge, defesa/escudo,
  crítico, armadura, piso, resistência e imunidade continuam a mesma ordem e a mesma posição de
  RNG. A matriz de oráculos desta página (a tabela acima) vale para os dois perfis, sem
  duplicação: nada nela testa fórmula de arma.
- **O que o `combat-v2` muda vive ANTES do resolver**, em `combat/weapon-power.ts`
  (`resolveWeaponPower`, despachado por `combat.compatibilityProfile`) e `combat/
  distance-hit.ts` (`rollDistanceHit`) — o `rawDamage` que chega em `resolveDamage` já é o
  resultado da fórmula nova, e o acerto/erro do tiro já foi decidido antes de `resolveDamage`
  ser chamado.
- **A sequência de RNG por golpe muda de forma NOVA e documentada**: a normal truncada
  (`normalRandomInt`) consome um número VARIÁVEL de sorteios por chamada — duas frações por
  tentativa de Box-Muller, rejeitando fora de `[0,1]` — ao contrário do `spread` do v1, que
  consumia zero ou um sorteio fixo. Isso é esperado e testado: o que a invariância de
  frequência/retomada prova é que a sequência é determinística por SEMENTE, não que o número de
  sorteios por golpe é constante.

### Oráculos do `combat-v2`

Cada peça tem a própria matriz de oráculos escritos à mão, no mesmo formato desta página:

| Arquivo | O que prende |
|---|---|
| `packages/sim/src/combat/weapon-power.test.ts` | tabela (attack, skill, level, vocationMultiplier) → faixa `[min, max]` igual à conta do Canary; distribuição (média/desvio) da normal truncada numa amostra grande; retrocompatibilidade — sem `combat`, ou com `combat-v1`, a fórmula não muda |
| `packages/sim/src/combat/distance-hit.test.ts` | a tabela por skill/distância (1–7); o balde `ammunition.maxHitChance` (#524) — tabela ou chance fixa; o bônus/malus `weapon.hitChance` (#524); a rolagem sempre consumida |
| `packages/sim/src/rulesets/weapons.test.ts` (`combat-v2: chance de acerto à distância`) | o `#strike` fim a fim: skill baixa erra mais que skill alta à mesma distância, `combat-v1` continua sempre acertando, 1 Hz == 10 Hz com a chance ligada |
| `packages/server/src/game/rat-cellars.test.ts`, `rotworm-caves.test.ts` | conformance do CONTEÚDO REAL — inclusive frequência-invariância (`dez minutos a 1 Hz e a 10 Hz...`). Carregam `packages/content/data` direto (`loadContent(DATA)`), então rodam sob QUALQUER perfil que `combat/baseline.json` declarar no momento — `combat-v2` até esta issue, `combat-v3` desde que `baseline.json` passou a declará-lo (seção seguinte); a suite não fixa o perfil, só prova que o conteúdo real continua verde sob o que estiver em vigor |

## O `combat-v3` (#548, M30-01, ADR 0040)

O ADR 0031 exige registro aqui sempre que o contrato muda de propósito. O `combat-v3` é o
próximo perfil livre depois do `combat-v2` (`packages/content/src/schemas.ts`, `COMBAT_V3`):
`migrationPolicy: 'breaking'`, e o pipeline de RECEBIMENTO — o que o CMB-04/CMB-02/CMB-03 faziam
com defesa, armadura e mitigação — vira a ordem do `Creature::blockHit` do Canary.
`packages/content/data/combat/baseline.json` já declara `combat-v3`: é o perfil que toda hunt
NOVA roda.

O que muda, e o que NÃO muda:

- **O lado OFENSIVO não muda.** A fórmula de arma e a chance de acerto à distância do
  `combat-v2` continuam idênticas — `combat-v3` exige os MESMOS blocos `weaponDamage`/
  `distanceHitChance` que o v2 exige, e `weapon-power.ts`/`distance-hit.ts` não sabem que o
  perfil mudou de v2 para v3 (o despacho é só de `resolveDamage`).
- **O lado DEFENSOR muda por completo.** `resolveBlockHitProfile` (`combat/damage.ts`) substitui
  `resolveMitigation` para `combat-v3`: Dodge continua o primeiro ato (INALTERADO — é onde o
  Tibia também nega o golpe, antes de chamar `blockHit`), mas o que vem depois é o novo estágio
  `resolveBlockHit` (`combat/blockhit.ts`) — imunidade explícita, defesa com `blockCount` e
  faixa aleatória, armadura em faixa (não mais flat) e mitigação percentual
  (`defenseMitigation`, campo NOVO do monstro). A resistência/vulnerabilidade por tipo (CMB-03)
  continua o MESMO mecanismo de antes, só reposicionada depois do estágio novo. O piso
  (`minimumDamageFraction`) é mantido como salvaguarda de PRODUTO — o Canary não tem: lá um
  bloqueio pode legitimamente reduzir o golpe a zero.
- **O crítico foi REPOSICIONADO**, de propósito e documentado: no v1/v2 ele era o 3º sorteio,
  entre defesa e armadura; no v3 ele rola DEPOIS de toda a mitigação (defesa, armadura,
  mitigação percentual, resistência, piso), porque fatiar o estágio novo em dois para encaixar o
  crítico no meio dele mudaria a decisão de "pular a armadura quando a defesa já zerou o golpe"
  sem nenhum conteúdo real declarar `combat.modifiers` hoje para testar a interação. A posição
  exata do crítico sob `combat-v3` é trabalho do M30-04.
- **As cargas de bloqueio (`blockCount`) são calculadas SOB DEMANDA**, nunca por tick
  (invariante 2) — `combat/block-charge.ts` é uma reescrita ORIGINAL do relógio-por-tick do
  Canary (`creature.cpp`, `blockTicks += interval; if (blockTicks >= 1000) ...`), que no Canary é
  um relógio ÚNICO e COMPARTILHADO pelas duas vagas, independente de quando cada uma foi gasta.
  A reescrita guarda um BANCO (quantas cargas já estão creditadas) e o instante a partir do qual
  o relógio ainda não creditou nada; consumir só desconta do banco, nunca reinicia o relógio —
  a mesma propriedade do `blockTicks`, que nunca reseta por causa de um consumo. (Achado da
  revisão do PR #642: a primeira versão deste arquivo modelava duas vagas INDEPENDENTES, cada
  uma reagendando o PRÓPRIO relógio a partir do PRÓPRIO consumo — um mecanismo diferente que
  podia recusar, num combate comum com mais de um atacante, um bloqueio que o relógio
  compartilhado do Canary já teria recarregado; a diferença não era limitada a um padrão
  adversarial, como uma versão anterior deste parágrafo chegou a registrar.) O ausente do
  snapshot (banco no teto desde o instante 0) continua uma simplificação deliberada para quem
  nunca bloqueou — não reproduz a janela inicial do Canary (`blockCount = 0` no spawn, subindo
  em ~2 s), que fica em aberto para quando o produto pedir essa fidelidade.
- **As flags de bloqueio vêm da ORIGEM do dano, não do tipo** (diferente do CMB-04, que aprovava
  por `damageType`): corpo a corpo bloqueia defesa E armadura; distância só armadura; magia,
  runa, wand/rod e DOT não bloqueiam nenhum dos dois. `combat/damage.ts` deriva isso por
  chamador (`MELEE_BLOCK_FLAGS`/`DISTANCE_BLOCK_FLAGS`/`MAGIC_BLOCK_FLAGS` em `blockhit.ts`), e
  cada produtor (`#strike`, `#executeMonsterAbility`, `castSpell`, `useSupply`, DOT) declara o
  próprio no `DamageIntent.blockable`.
- **`resolveDamage` ganhou um parâmetro `nowMs`, OPCIONAL com default `0`** — não obrigatório: a
  alternativa (sem default) foi tentada e descartada (ADR 0040, emenda), porque dezenas de
  fixtures de `combat-v1`/`v2` em teste não têm relógio de sessão nenhum para passar, e nenhuma
  delas lê o parâmetro. É o instante lógico da sessão, que só o `combat-v3` lê (para o
  `blockCharge`); `combat-v1`/`v2` o ignoram. TODO CHAMADOR EM PRODUÇÃO precisa passar
  `session.nowMs` explicitamente mesmo assim — o default só existe para o teste que não precisa
  dele. Um esquecimento em produção COMPILA (o parâmetro é opcional) e erraria em silêncio só sob
  `combat-v3`: o `blockCharge` do defensor ficaria sempre avaliado em `nowMs = 0`, e uma vez que
  o banco já tivesse creditado alguma carga além do instante 0 o defensor perderia o estágio de
  defesa/armadura permanentemente a partir dali.

### Oráculos do `combat-v3`

| Arquivo | O que prende |
|---|---|
| `packages/sim/src/combat/block-charge.test.ts` | disponibilidade e consumo das duas cargas; o vetor do #548 — segundo bloqueio no mesmo segundo gasta a última carga, terceiro não defende |
| `packages/sim/src/combat/blockhit.test.ts` | os vetores à mão do #548 — defesa 30 → `[15,30]`; armadura 25 → `[12,23]`; armadura 3 → `−1`; armadura 0 → identidade; imunidade zera antes de tudo; mitigação percentual sobre o pós-armadura; a armadura é PULADA quando a defesa já zerou |
| `packages/sim/src/combat/damage.test.ts` (`combat-v3`) | o pipeline fim a fim — Dodge primeiro, crítico reposicionado, piso poupando imunidade, `combat-v1`/`v2` continuam bit a bit |
| `packages/content/src/content.test.ts` | `monsterSchema` aceita `defense`/`defenseMitigation`, default `0`; `combat-v3` exige `weaponDamage`/`distanceHitChance` como o v2 |
| `packages/sim/src/rulesets/hunt.test.ts` (`defesa, escudo e prática de shielding`) | shielding treina por ORIGEM sob `combat-v3` — um ataque corpo a corpo elemental (que `combat.defense.blockTypes` recusaria) ainda treina, o oposto do `combat-v1`/`v2` |
| `packages/sim/src/combat/damage.test.ts` (achado da revisão do PR #642) | o componente secundário (#473) herda a carga que o primário já gastou, e o `blockCharge` de nível superior — o único que `applyDamageOutcome` grava de volta — reflete o total consumido pelos dois |
| `packages/sim/src/combat/fight-mode.test.ts` (#550, M30-03) | os três fatores da postura — ataque 1,0/0,75/0,5, defesa dinâmica 0,5·0,75·1,0 batendo e 1,0 parado, mitigação 0,8/1,0/1,2 — e `attackedRecently` (comparação estrita, `null` = nunca bateu) |
| `packages/sim/src/combat/weapon-power.test.ts` (`a postura de luta escala o MÁXIMO`) | o teto do dano de arma por postura (espada 170/128/85, distância 38/29/20), o ofensivo bit a bit igual ao v2 de antes, o `combat-v2` IGNORANDO a postura, wand/rod fora |
| `packages/sim/src/combat/player-defense.test.ts` (`o fator de postura é o DINÂMICO`) | `playerDefense` nos seis cenários modo × batendo/parado, e a mitigação por postura |
| `packages/sim/src/rulesets/hunt.test.ts` (`postura de luta: o fightMode do personagem chega ao golpe e à defesa`) | fim a fim: o teto por postura no golpe da hunt, `lastAttackAtMs` só no v3 e só quando a arma sai, a defesa 11/17/22 batendo e 22 parado (wand sem mana), snapshot/retomada e 1 Hz == 10 Hz |

## O `combat-v4` (ADR 0052 decisão 7)

O veículo ÚNICO do endgame (M38–M44, #598–#632/#643): enquanto `tibia-parity` for a branch de
integração, toda issue do endgame que muda resultado ou ordem de sorteio emenda este MESMO
perfil — um estágio declarado por issue nesta seção, em vez de ganhar um `combat-v5` próprio. Ele
SOMA em cima do `combat-v3`, nunca revoga: `HuntRuleset#isV3()` trata `combat-v3` e `combat-v4`
como o mesmo mecanismo de bloqueio/defesa/mitigação do jogador (o predicado central que TODO
`this.#options.combat.compatibilityProfile === 'combat-v3'` espalhado pelo `sim` precisou virar
`isV3OrLater`/`#isV3()` para continuar valendo sob v4 — achado da implementação do #598, que
criou o perfil: sem isso uma sessão `combat-v4` perderia block-charge, mitigação e o resto do
pipeline de recebimento do v3 em silêncio). O perfil só congela (vira imutável) no merge na
`main` (ADR 0040 decisão 3).

### Estágio #598 (M38-01, invocação do jogador — ADR 0057)

A invocação do jogador vira alvo válido do `chooseTarget` de monstro hostil e credita dano ao
MESTRE via `Contribution`/mapa de dano (ver "Invocação do PERSONAGEM" em `docs/product/
combat.md`). **`additive`, não `breaking`**: nenhum cenário SEM invocação muda de resultado ou de
ordem de sorteio — `HuntRuleset#hostileMonsters()`/`#playerSummonPrey()` devolvem a MESMA
referência de array quando não há invocação viva nenhuma, e nenhum sorteio novo entra no caminho
de quem nunca invoca. O teste de conformance (`hunt.test.ts`, describe "Invocação do PERSONAGEM")
prova o mecanismo com invocação presente; nenhum teste de RNG dedicado foi necessário para "sem
invocação, nada muda" porque a suíte de regressão inteira (4.000+ casos, incluindo os oráculos de
conformance do v3 acima) já roda sob o conteúdo real sem NENHUM monstro `summonable` — e continua
batendo os mesmos números depois da mudança, o que é a prova por ausência de qualquer perturbação.

### Estágio #599 (M38-02, o familiar de vocação — ADR 0057 d.3): `additive`

O familiar é uma invocação de personagem (o estágio #598) e só existe quando alguém lança a magia
de level 200 — nenhum cenário SEM familiar muda de resultado nem de ordem de sorteio: o teleporte
ao mestre e a travessia leem `#familiarIds` (vazio, um `Set.size`), o embaralhamento do tile de
nascimento (10 sorteios do `Rng` da sessão) só roda dentro do lançamento, e a ability em área de
uma invocação usa presas próprias só quando o lançador tem `masterId` de personagem. Três mudanças
tocam também a Summon Creature do #598, e todas só atuam com invocação viva: o alvo herdado é o
SELECIONADO do mestre (não o que a arma alcança), a ability em área da invocação atinge só monstros
hostis, e a invocação de personagem sem alvo passou a SEGUIR o mestre (`summonFollowStep`, o
`updateSummonTarget` do Canary — a divergência que o #598 tinha deixado; a busca de caminho não
sorteia nada). O que o teste prende (`packages/sim/src/rulesets/familiar.test.ts`): duração e
cooldown como eventos da fila (1 Hz × 10 Hz, mesmo snapshot), o carimbo de parede que atravessa a
saída, a recriação ao entrar, a morte, o teleporte, a travessia e a ability contra os hostis.

### Estágio #600 (M38-03, Convince Creature e Animate Dead — ADR 0057 d.5–d.6)

As duas runas só agem quando usadas, e nenhum sorteio novo entra no caminho de quem não as usa
(`useSupply` roda a precondição só nos dois efeitos novos; a mira do bot para Animate Dead não
consome `session.rng`). **`additive`**: os oráculos do v3 e do v4 acima seguem batendo os mesmos
números. Uma regra do estágio vale para toda sessão, de qualquer perfil e com ou sem as runas: **a
invocação que morre não deixa cadáver** (`Creature::dropCorpse`) — o cadáver não paga XP, loot nem sorteio, e
o `nextGroundItemId` só avança para quem deixa cadáver. O detalhe está em "Convince Creature e Animate
Dead" em `docs/product/combat.md`.

### Estágio #603 (M39-03, Charms em combate — ADR 0053 d.5): `breaking`

O primeiro estágio do `combat-v4` que MUDA resultado e ordem de sorteio — por isso o perfil passa
a `migrationPolicy: 'breaking'` (era `additive` com o estágio #598). A partir dele, uma sessão
fixada em `combat-v3` (conteúdo anterior) nunca rola charm nenhum, mesmo com o registro do
personagem cheio (`hasCharmStage`, `combat/profile.ts`): o registro de Charms é do personagem,
o perfil é da versão de conteúdo (invariante 7). São três mudanças declaradas, todas em
`packages/content/data/combat/baseline.json` e `packages/sim/src/combat/charms.ts`:

1. **O Dodge do PRD sai.** `player.dodgeChance` vale `0`, o resolver do `combat-v4` NEM sorteia o
   Dodge (`resolveBlockHitProfile`: `dodged = false`, zero draws — a sequência do v4 é a do v3 sem
   essa rolagem) e a exceção `dodge-halves-damage` sai de `productExceptions`. O único Dodge é o
   charm, que NEGA o golpe inteiro — a #522 tinha mantido o Dodge de metade por acreditar que era
   o charm, e o `Game::combatChangeHealth` (`return true` no ramo do Dodge) mostra que não é.
2. **O crítico BASE de todo jogador** (`playerBaseCriticalChance` 0,05 e `playerBaseCriticalDamage`
   0,1 do `config.lua.dist`, lidos em `Combat::applyExtensions`): `combat.modifiers.critical` =
   `{ chance: 0.05, multiplier: 1.1 }`. A #551 tinha o crítico de item, mas não o base — e Low Blow
   e Savage Blow SOMAM a ele (`baseChance + charm`), então sem ele o Savage Blow não teria crítico
   nenhum a reforçar num personagem sem item de crítico. Todo golpe/magia/runa do jogador passa a
   consumir UMA rolagem de crítico (sempre foi assim para quem declarava `critical`).
3. **O estágio de Charms**, na ordem do Canary:

| # | Onde | Quando | Rolagem |
|---|---|---|---|
| 1 | `Combat::applyExtensions` → `#hitModifiers`/`ActionCritical` | golpe/magia do jogador, ANTES do `blockHit` | crítico base (1 sorteio por ação); se falhou e há Low Blow contra o alvo, 2º sorteio com `base + charm` — UM por monstro-alvo do charm |
| 2 | `Game::combatChangeHealth`, após defesa/armadura/reflexo | golpe de monstro no personagem — e cada TIQUE de condição que um monstro VIVO aplicou (`ConditionDamage::doDamage`) —, antes do mana shield | minor (Adrenaline Burst, Numb) e depois major (Parry, Dodge), cada um `chance ≥ normal(1, 10000)/100`; Dodge encerra |
| 3 | `Game::combatChangeMana` | dreno de mana (`manadrain`) | Void Inversion (`chance > normal(0, 100)`) → major, minor (`normal(1, 10000)`); o Parry não rola nesse ramo |
| 4 | `Combat::CombatConditionFunc` (`#cleanseBeforeCondition`) | depois de todo golpe de monstro que acertou, antes da condição da ability | Cleanse `chance ≥ normal(0, 10000)/100` e `uniform(0, n−1)` da condição sorteada; imunidade de 11 s por tipo |
| 5 | `Game::applyCharmRune` (`#applyCharmsAfterHit`) | depois de todo golpe do jogador que TIROU VIDA de um monstro (extensão/cleave fora) | major e minor ofensivos, cada um `chance ≥ uniform(1, 100)`; a paralisia do Cripple ignora a imunidade a `paralyze` do monstro (ver abaixo) |
| 6 | `Combat::CombatHealthFunc` (`#rollFatalHold`) | depois de todo dano do jogador a um monstro (o próprio dano dos charms inclusive) | Fatal Hold `chance > normal(0, 100)` |
| 7 | `Monster::death` (`#carnage`) | morte de um monstro — invocado por outro monstro inclusive — para o jogador que o matou (ou que ele atacava) | Carnage `chance ≥ normal(1, 10000)/100` |
| 8 | `Player::death` (`#charmBlessReductionOf`) | morte do personagem | sem sorteio: `chance/100` de redução multiplicativa quando o último golpe foi do monstro do Bless |
| 9 | `generateLootRoll` (`#gutOf`) | loot do cadáver do monstro do Gut do MAIOR causador de dano | sem sorteio: `+ ceil(chance × charm / 100)` nos creature products |

Vampiric Embrace e Void's Call somam ao leech por alvo (`ActionCritical.forTarget`, `combat/charms.ts`, sem sorteio; a fórmula do leech continua em `combat/modifiers.ts`). O Scavenge é a
esfola do #626 e não entra aqui — ver o estágio seguinte.

**As probabilidades reais NÃO são as nominais.** `normal_random` centra em 0,5 (desvio 0,25) e
rejeita fora de `[0, 1]`, então um charm defensivo de "5 %" dispara em ~1,4 % dos golpes (10 % →
3,4 %; 11 % → 3,8 %; os minors 6/9/12 % → 1,7/2,9/4,3 %); Void Inversion e Fatal Hold caem de
20/30/40 % para ~9/19/33 % e de 30/45/60 % para ~19/41/66 %. Só os ofensivos, que usam
`uniform_random(1, 100)`, acertam exatamente a chance. Os números saem da CDF da normal truncada e
são prendidos por `combat/charms.test.ts` com 300 mil sorteios por caso.

**Defeitos do `47dfd51` que este estágio NÃO reproduz** (todos listados na PR do #603 para revisão
do dono; cada um está no comentário da função que o evita):

- **Parry, primeiro ponto** (`game.cpp:7944-7952`): o valor está no sinal de vida-de-alvo e o
  `-realDamage` sai POSITIVO — `combatChangeHealth` o lê como cura, então o Parry curaria o monstro
  que bateu, e anularia o segundo ponto (`:8566-8583`, o que de fato reflete). Só o segundo existe.
- **`maxLevelsLimit` estático** (`iobestiary.cpp`): o ramo do Carnage o reatribui a 6, e depois da
  primeira morte por Carnage do processo o teto de TODO charm elemental, de todo jogador, vira 6×
  o level. Estado global de processo não cabe numa sessão determinística: elemental 2×, Carnage 6×.
- **Gut inerte**: o `generateLootRoll` confere `iType:getType() == ITEM_TYPE_CREATUREPRODUCT`, mas
  nenhum item do `items.xml` declara esse `type` (só o `primarytype`, outro campo) — no `47dfd51`
  o charm nunca dispara. Aqui vale para os itens de `primarytype="creature products"`
  (`Item.creatureProduct`, escrito pelo importador — e, nos cinco que já eram autorais, `worm` e as
  peles e escamas dos dragões, por override), o que o Lua descreve.

**Onde o Canary é reproduzido mesmo sendo estranho:** o teto de 2× o level dos elementais (não está
na descrição do charm, está no código), a base do Low Blow somada duas vezes, Low Blow/Savage Blow/
Vampiric/Void's Call valendo sem exigir item de crítico/leech, o Fatal Hold que nunca expira em
monstro que foge e não troca de alvo (achad, drasilla, muglex-clan-assassin), o Bless como redução
MULTIPLICATIVA sobre bênção e promoção, e o dano do charm passando pelo resolver como extensão
(resistência, imunidade e cura por elemento do monstro valem; só o neutro os pula). Mais dois, ambos
do ponto em que o Canary NÃO confere o que o resto do combate confere:

- **O Cripple e o Numb paralisam o monstro imune a `paralyze`.** `iobestiary.cpp` aplica a
  condição com `target->addCondition`, direto; a imunidade por condição (`Monster::isImmune`)
  só é conferida em `Combat::CombatConditionFunc` (`combat.cpp:1079`), que o charm não atravessa, e
  `Creature::addCondition` só recusa a supressão (`isSuppress`, que só o `Player` sobrescreve). O
  `#applyConditionTo` ganha `ignoreImmunity` para esses dois — as demais paralisias (magia, runa,
  ability) seguem barradas. 685 dos 1.028 monstros importados declaram `paralyze`: sem isto os dois
  charms seriam inertes em dois terços do catálogo.
- **O Carnage rola também para o monstro invocado por outro monstro.** O `Monster::death` não
  confere `isSummon()`; só o loot, a XP e o Bestiário (`Player::onKilledMonster`) excluem a
  invocação. A invocação do PERSONAGEM nunca é "morta pelo jogador", então não chega a rolar.

**Conformance de RNG com e sem charms** (`packages/sim/src/rulesets/charms.test.ts`, "a
conformance de RNG com e sem charms"): (a) sem charm nenhum e com charm atribuído a OUTRO monstro
a luta é bit a bit a mesma — estado do `Rng`, vida, condições e cargas de bloqueio; o gate é
aditivo; (b) com charm no monstro que luta a sequência muda; (c) 1 Hz == 10 Hz == 20 Hz com
charms rolando, e (d) a retomada de um snapshot no meio da luta rende o mesmo que a sessão que
nunca caiu (`cleanseImmunity` viaja no snapshot). `packages/server/src/game/charms-combat.test.ts`
prova o mesmo contra a Rat Cellars real e confere cada id despachado contra o catálogo importado.

**Um vetor por charm** (`rulesets/charms.test.ts`; as rolagens e os números em
`combat/charms.test.ts`): Wound, Enflame, Poison, Freeze, Zap, Curse e Divine Wrath (`it.each`
dos sete, tipo e teto), Overpower, Overflux (neutros, tetos), Cripple (e contra o monstro imune a
`paralyze`), Carnage (vizinhos ortogonais, teto de level, neutro, cadeia, monstro invocado),
Dodge, Parry (só o segundo ponto), Adrenaline Burst, Numb (idem imune), a ORDEM minor→major, Void Inversion, Cleanse (sequência remove/imuniza/expira), Fatal Hold
(30 s e para sempre), Low Blow, Savage Blow, Vampiric Embrace, Void's Call, Bless
(`progression.test.ts` e o vetor de morte) e Gut (`loot.test.ts`, o vetor de abates e, em
`charms-combat.test.ts`, as tabelas REAIS de Dragon, Dragon Lord, Rotworm e Cave Rat com o flag
`creatureProduct` de cada creature product do Canary conferido contra o conteúdo carregado).

### Estágio #619 (M44-01, facções de monstro): `additive`

O monstro de facção vira alvo e agressor do de facção inimiga (`faction`/`enemyFactions`, ver
"Facções de monstro" em `docs/product/combat.md`). **`additive`**: nenhum cenário sem facção muda de
resultado ou de ordem de sorteio. O `HuntRuleset` só monta a tabela de facções dos monstros que a hunt
PODE gerar (`reachableMonsterIds`), e com ela vazia (`#hasFactions` falso) as entradas novas —
`#opponentOthersOf`, `#targetPreyOf`, `#mayAttack`, `#isFactionSummonIdle` — devolvem a mesma
referência de antes ou `false`, sem alocar e sem sortear; o desempate por facção soma uma constante a
uma lista só de personagens, e os cortes da morte por monstro (XP, loot, dono do cadáver e abate) só
disparam com um `m:<id>` no mapa de dano, que só existe com facção — a única exceção é a invocação de
PERSONAGEM (#598) morta por um monstro hostil, que deixa de contar abate (o Canary só tem `killers`
entre os jogadores do `damageMap`); nenhum monstro do catálogo é `summonable`, então nenhuma hunt real a
vê. A suíte de regressão inteira (que roda sob conteúdo sem facção)
segue batendo os mesmos números, como no estágio do #598. **Uma versão de conteúdo COM facção é
outro conteúdo (invariante 7)**: a sessão fixada na anterior não tem os campos e não muda.

Duas completudes do golpe de monstro em monstro entram junto, e mexem no #598 (invocação de jogador) —
`additive` também porque nenhum monstro do catálogo é `summonable`: a **condição** da ability passa a
entrar no monstro-alvo (com a imunidade de condição do alvo) e a **cura por elemento** (#683) roda
depois do golpe. O teste de conformance é `rulesets/factions.test.ts`; o de desempate,
`monster/faction.test.ts`.

### Estágio #626 (M44-08, esfola de cadáver e Scavenge — ADR 0048 d.5/d.6, ADR 0053 d.5): `breaking`

O segundo estágio que muda a ordem de sorteio, no mesmo perfil `combat-v4` (`hasSkinningStage`,
`combat/profile.ts`; a sessão fixada em `combat-v3` nunca esfola — invariante 7). Um sorteio novo,
ao FIM do abate:

| # | Onde | Quando | Rolagem |
|---|---|---|---|
| 1 | `#onMonsterDied` → `#skinAtDeath`/`#rollSkin`, DEPOIS de todo o sorteio de loot (gold, itens, o resto de supply/munição da party) e antes da XP | abate de monstro não invocado, com um elegível/dono que tenha a ferramenta DO MONSTRO na mochila ou na bolsa, e o monstro tenha entrada em `content.skinning` | `rng.integer(1, range) <= chance`, `chance` 25 000 e `range` 100 000 — ou `100 000 × charm / 100` com o Scavenge que vale para o estágio do cadáver |
| 2 | `#performSkin` (`use-item-on` da ferramenta com o tile do cadáver) | à mão, com alcance `canUse` (adjacente, sem linha de visão), ferramenta certa, cadáver não esfolado e estágio esfolável | a mesma rolagem, no `session.rng` da sessão |

**A regra que faz do estágio "declarado":** com a ferramenta ausente, com a ferramenta errada,
num monstro sem entrada de esfola ou fora do `combat-v4`, o `session.rng` NÃO é tocado — uma hunt de
quem nunca teve faca consome exatamente o que consumia (`rulesets/skinning.test.ts`, "sem
ferramenta não consome RNG", e `server/src/game/skinning-real.test.ts` contra a Minotaur Camp real).
O Scavenge muda o INTERVALO, nunca a quantidade de sorteios (mesmo estado final do gerador com e sem
charm). 1 Hz == 10 Hz e a retomada de snapshot (`skinned`/`diedAtMs` viajam no `CorpseState`) estão
prendidos nos mesmos arquivos.

**O que o Canary tem de estranho e este estágio reproduz**: o Scavenge ENCOLHE o intervalo em
vez de somar à chance, e como o charm é 60/90/120 o intervalo CRESCE com o tier — tier 1 = 41,7 %,
tier 2 = 27,8 %, tier 3 = 20,8 %, abaixo dos 25 % sem charm (`skinningChanceRange`, testado por
frequência com 200 mil sorteios por caso). A PR do #626 lista essa decisão para o dono rever; é uma
função de uma linha em `sim/skinning.ts`.

## Benchmark: o cenário misto

```
pnpm bench:hunts                  # cenário frio (motor, FUN-46)
SCENARIO=combat pnpm bench:hunts  # cenário misto do M19
pnpm bench:combat                 # atalho para o de cima
HUNTS=1000 pnpm bench:combat      # ajusta o número de sessões
```

O cenário vive em `packages/tools/src/bench/combat-scenario.ts` e monta, com o **contrato real
de `buildContent`** (nada de `things/` nem serviço externo):

- monstro com **ability em área** (`circle` no alvo) que aplica **DOT** e deixa **campo** por
  tile, e uma ability à distância;
- **resistência e vulnerabilidade** por tipo no mesmo monstro;
- personagem vestido com **arma de uma mão** (família `sword`) e **escudo** — o estágio de
  defesa do CMB-04 — mais mochila;
- **modificadores** de crítico e leech no perfil de combate;
- 40 monstros em 10 pontos de spawn, a mesma densidade do cenário frio, para a comparação ser
  sobre o pipeline e não sobre a lotação.

`combat-scenario.test.ts` monta e avança uma hunt no CI e prende que a composição continua de
pé: é o teste que reprova no PR quando o contrato de `buildContent` mudar — o mesmo papel que
`cold-scenario.test.ts` cumpre para o cenário frio.

### Método

- **Desanexado a 1 Hz** (ADR 0003), que é o modo padrão do jogo; `HZ` ajusta.
- O **aquecimento do JIT** é contado em ticks de SESSÃO (300.000), não em ticks do laço; cenário
  pequeno demais sai com aviso e o número é **superestimado**.
- O relatório imprime **parede e CPU** lado a lado: num laptop paginando a parede mente, e é a
  CPU que diz se o número vale.
- GC observado por `{ type: 'gc' }` (a forma `entryTypes` não entrega nada no Node 24).
- Memória por sessão exige `--expose-gc` (o script de `bench:hunts` já o passa).

## Linha de base

Máquina da medição (o número só vale com ela — o tick é single-thread, ADR 0013):

| Campo | Valor |
|---|---|
| Plataforma | `darwin arm64` |
| CPU | Apple M2 × 8 |
| Node | v24.14.1 |
| Memória total | 8,0 GiB |
| GC forçado | sim (`--expose-gc`) |

`HUNTS=1000`, 10 min simulados, 1 Hz, 299 ticks medidos (300 de aquecimento):

| Cenário | µs/tick/instância | Instâncias por core a 1 Hz | Memória/sessão | Snapshot/sessão | GC (pico) |
|---|---|---|---|---|---|
| `cold` (motor, FUN-46) | 20,3 | 49.186 | 60,6 KiB | 14,8 KiB | 260 ms (26,4 ms) |
| `combat` (pipeline M19) | 57,9 | 17.270 | 65,4 KiB | 18,7 KiB | 2.204 ms (42,2 ms) |

### Leitura

- O cenário misto custa **~2,8×** o cenário frio com a mesma densidade de monstros. É o preço do
  pipeline que o M19 entregou: ability em área (mais alvos e mais sorteios), DOT e campo (eventos
  de tique e vencimento), defesa (segundo sorteio) e crítico (terceiro sorteio). A ordem de
  grandeza é a esperada; uma regressão de ordem de grandeza aqui vira conta de servidor.
- A memória por sessão sobe pouco (~5 KiB), mas o **GC cresce** (~8,5× o total do cenário frio):
  a composição nova aloca por evento. É o primeiro lugar a olhar antes de "otimizar a lógica"
  (ver `packages/sim/AGENTS.md`: alocação por evento é o que custa caro).
- O número **não é um teto de CI** (DT-02): ele é contexto para decidir onde otimizar. Comparar
  duas rodadas exige a mesma máquina, o mesmo Node e o mesmo aquecimento.

### Reproduzir

```
git rev-parse HEAD
node --version
HUNTS=1000 pnpm bench:combat
```

Para a conformance, `pnpm exec vitest run packages/sim/src/combat/conformance.test.ts`; para a
estrutura do cenário no CI, `pnpm exec vitest run packages/tools/src/bench/combat-scenario.test.ts`.
