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
| `packages/sim/src/combat/weapon-power.test.ts` | tabela (attack, skill, level, attackFactor, vocationMultiplier) → faixa `[min, max]` igual à conta do Canary; distribuição (média/desvio) da normal truncada numa amostra grande; retrocompatibilidade — sem `combat`, ou com `combat-v1`, a fórmula não muda |
| `packages/sim/src/combat/distance-hit.test.ts` | a tabela por skill/distância (1–7); o balde `ammunition.maxHitChance` (#524) — tabela ou chance fixa; o bônus/malus `weapon.hitChance` (#524); a rolagem sempre consumida |
| `packages/sim/src/rulesets/weapons.test.ts` (`combat-v2: chance de acerto à distância`) | o `#strike` fim a fim: skill baixa erra mais que skill alta à mesma distância, `combat-v1` continua sempre acertando, 1 Hz == 10 Hz com a chance ligada |
| `packages/server/src/game/rat-cellars.test.ts`, `rotworm-caves.test.ts` | conformance do CONTEÚDO REAL sob `combat-v2` — inclusive frequência-invariância (`dez minutos a 1 Hz e a 10 Hz...`) |

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
  Canary (`creature.cpp`, `blockTicks += interval; if (blockTicks >= 1000) ...`) como duas
  "vagas" independentes, cada uma um instante absoluto em que volta a ficar pronta. Equivalente
  em EFEITO (no máximo duas cargas disponíveis, cada uma recarregando em 1000 ms depois de
  gasta), não literal — a diferença só aparece num padrão de uso adversarial que nenhum vetor
  desta issue exercita.
- **As flags de bloqueio vêm da ORIGEM do dano, não do tipo** (diferente do CMB-04, que aprovava
  por `damageType`): corpo a corpo bloqueia defesa E armadura; distância só armadura; magia,
  runa, wand/rod e DOT não bloqueiam nenhum dos dois. `combat/damage.ts` deriva isso por
  chamador (`MELEE_BLOCK_FLAGS`/`DISTANCE_BLOCK_FLAGS`/`MAGIC_BLOCK_FLAGS` em `blockhit.ts`), e
  cada produtor (`#strike`, `#executeMonsterAbility`, `castSpell`, `useSupply`, DOT) declara o
  próprio no `DamageIntent.blockable`.
- **`resolveDamage` ganhou um parâmetro `nowMs` OBRIGATÓRIO** — o instante lógico da sessão, que
  só o `combat-v3` lê (para o `blockCharge`). `combat-v1`/`v2` o ignoram, mas todo chamador
  precisa passá-lo agora; um esquecimento erraria em silêncio só sob `combat-v3`.

### Oráculos do `combat-v3`

| Arquivo | O que prende |
|---|---|
| `packages/sim/src/combat/block-charge.test.ts` | disponibilidade e consumo das duas cargas; o vetor do #548 — segundo bloqueio no mesmo segundo gasta a última carga, terceiro não defende |
| `packages/sim/src/combat/blockhit.test.ts` | os vetores à mão do #548 — defesa 30 → `[15,30]`; armadura 25 → `[12,23]`; armadura 3 → `−1`; armadura 0 → identidade; imunidade zera antes de tudo; mitigação percentual sobre o pós-armadura; a armadura é PULADA quando a defesa já zerou |
| `packages/sim/src/combat/damage.test.ts` (`combat-v3`) | o pipeline fim a fim — Dodge primeiro, crítico reposicionado, piso poupando imunidade, `combat-v1`/`v2` continuam bit a bit |
| `packages/content/src/content.test.ts` | `monsterSchema` aceita `defense`/`defenseMitigation`, default `0`; `combat-v3` exige `weaponDamage`/`distanceHitChance` como o v2 |

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
