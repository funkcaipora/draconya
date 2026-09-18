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
