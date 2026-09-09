# 0020 — Relógio lógico e fila de eventos por sessão

**Status:** aceito
**Data:** 2026-09-09
**Contexto técnico:** `sim` (sessão, hunt, monstro, rota), `server` (hospedagem e retomada), FUN-68

## Contexto

A simulação avançava por **tick em lote**: o hospedeiro chamava `session.tick(agora)`, a sessão
derivava um `dtMs` e cada sistema perguntava ao próprio acumulador quantas aplicações couberam
naquele intervalo. A taxa era 10 Hz anexada e 1 Hz desanexada (ADR 0003).

O desenho custou três defeitos, e os três são o mesmo defeito visto de ângulos diferentes.

**1. Granularidade de espaço.** Num tick de 1 s o personagem andava dois tiles de uma vez, o
monstro também, e a adjacência era conferida uma única vez, no fim. Eles passavam mais ticks
colados do que passariam a 10 Hz. Medido: **1,51× mais dano sofrido a 1 Hz** — e 1 Hz é a hunt
desanexada, que é o modo *padrão* do jogo. Quem caçava com o navegador fechado apanhava metade a
mais, e não havia como o tick em lote expressar "os dois andaram em t+500 e nesse instante não
estavam adjacentes".

**2. Quantidade solta.** O acumulador devolvia N aplicações e deixava quem chamava decidir o que
fazer com o N. A FUN-67 foi exatamente isso: dois dos quatro chamadores aplicavam uma só e
jogavam o resto fora, e a hunt desanexada sofria metade do dano devido.

**3. Relógio de processo dentro da simulação.** O `lastTickMs` do snapshot era o monotônico do
processo que morreu, e monotônico não é comparável entre processos. O ADR 0018 precisou de uma
operação — `rebaseClock` — só para consertar isso na retomada. E `Cooldowns` guardava um segundo
mecanismo, absoluto, com o mesmo problema: inofensivo enquanto ninguém o usava, e poção e magia
são exatamente o que viria usá-lo.

O comentário que vivia em `docs/product/hunt.md` dizia que corrigir a granularidade "pediria
subdividir o tick, o que gasta o que cair para 1 Hz economiza". Era uma falsa escolha.

## Decisão

**Relógio lógico por sessão, e fila de eventos no lugar do laço.**

- A sessão nasce com o relógio em **zero** e ele só anda com `advanceBy(dtMs)`. Não é comparável
  com relógio de processo nenhum, e não precisa ser.
- Quem guarda relógio de processo é o **hospedeiro**, em `HostedSession.lastAdvancedAtMs`.
- Uma **fila de eventos** ordenada por `(dueAtMs, priority, seq)` — ordem total, serializável —
  decide quando cada ação acontece. `advanceBy` põe o relógio no vencimento de cada evento antes
  de despachá-lo, e processa só o que vence na janela.
- `Ruleset.onTick(session, dtMs)` dá lugar a `Ruleset.onEvent(session, event)`.
- O mecanismo periódico de `Cooldowns` (`timesThatFit`) é **removido**. O absoluto fica, agora
  sobre tempo lógico.
- `Session.rebaseClock` **deixa de existir**: não há o que rebasear.

A consequência que justifica tudo: dez `advanceBy(100)` e um `advanceBy(1000)` despacham os
mesmos eventos, nos mesmos instantes, na mesma ordem. **A equivalência entre taxas deixa de ser
uma propriedade que cada fórmula precisa preservar e passa a ser uma propriedade da estrutura.**

## Alternativas

- **Subdividir o tick** — descartada por medição, não por intuição: gasta exatamente o que cair
  para 1 Hz economiza, e não resolve a quantidade solta.
- **Timestamp absoluto no lugar do acumulador, mantendo o tick** — já tentada e revertida antes
  desta issue. Os abates passavam a divergir entre taxas (299 a 20 Hz contra 277 a 1 Hz): um
  ataque que fica pronto no meio do tick dispara atrasado e o resto é descartado. O problema não
  era a representação do tempo dentro do tick, era o tick.
- **Manter `timesThatFit` sem uso, para o caso de precisar** — descartada. É a forma exata do
  defeito que este ADR corrige; deixá-la disponível é deixar carregada a arma que já disparou.
- **Reestruturar em `GameCommand`/controllers** (§47 do documento de referência OpenTibia) —
  fora de escopo. Aqui só o tempo.

## Consequências

**A retomada ficou trivial, e o ADR 0018 passou a ser cumprido por construção.** Descartar o
intervalo pulado deixou de ser uma operação que alguém precisa lembrar de chamar: uma sessão
retomada continua do instante lógico em que parou, e o buraco nunca chega a ser oferecido à
simulação. A decisão do ADR 0018 continua valendo — o que mudou é que ela não precisa mais de
mecanismo.

**O formato de snapshot subiu para 3, e o 2 não é migrável.** Os acumuladores que o formato 2
grava dizem quanto cada ação já esperou, não quando ela vence; inventar vencimento a partir disso
seria inventar simulação. Quem lê um formato 2 recusa e credita, que é o caminho que o ADR 0018 e
o ADR 0010 já mandavam seguir.

**O custo por instância mudou, e não na mesma direção nos dois modos.** Medido em Apple M2 /
Node 24.12, como custo por segundo *simulado*:

| | antes | depois |
|---|---|---|
| 10 Hz, anexada | 71 µs/s | **15 µs/s** — 4,7× mais barato |
| 1 Hz, desanexada | 8,9 µs/s | 12,4 µs/s — 1,4× mais caro |

No cenário frio de 5.000 hunts desanexadas (`pnpm bench:hunts`), o custo por tick foi de 9,3 µs
para 18,8 µs, e as instâncias por core de 107.894 para 53.081.

A previsão da issue — "é mais barato, não mais caro" — valia para a hunt **anexada** e se inverte
na desanexada, e vale dizer por quê: a 1 Hz o laço antigo avaliava cada monstro uma vez por
segundo independentemente da cadência real dele, o que é menos trabalho do que a correção exige.
Aquela sub-avaliação *era* o 1,51×. Comparar 9,3 com 18,8 é comparar quantidades de trabalho
diferentes.

**A projeção de custo continua com folga larga.** A estimativa do §14 era de 50–200 µs por tick e
200–500 instâncias por core; o medido é 18,8 µs e 53.081. Nenhuma das saídas previstas no ADR 0015
precisa ser acionada. O custo agora é proporcional ao tempo simulado e quase indiferente à taxa
(15 contra 12,4 µs/s), que é o comportamento que se queria.

**Memória subiu:** 27,9 → 34,7 KiB por sessão, e o snapshot de 8,9 → 12,6 KiB, porque a fila é
serializada. Com 5.000 sessões são ~63 MiB de Redis a mais.

**O balanceamento mudou, e o número está medido.** O cooldown de ataque congelava enquanto não
havia alvo; agora corre em tempo de parede e o golpe fica engatilhado, saindo no instante do
contato. Na sala de teste do critério de saída da Fase 1 o ciclo de encontro caiu de ~5 s para
~2,25 s — o personagem mata mais rápido *e* apanha mais. `packages/content/data` segue confortável
para um level 1, mas a curva de dificuldade precisa ser desenhada contra este comportamento. Ver
`docs/product/hunt.md`.

**Um teto novo, com a mesma política do ADR 0018.** `MAX_EVENTS_PER_ADVANCE` sucede o
`MAX_CATCH_UP` dos cooldowns: uma engasgada de processo não pode virar horas de combate resolvidas
de uma vez. Ao estourar, o que venceu é empurrado para o alvo e o atraso é descartado, nunca
acumulado.

## Invariantes afetados

**Invariante 2 — "nada é escrito por tick".** Continua valendo, e passou a ser estrutural em vez
de convencional. A frase que o explicava — "todo cálculo recebe `dtMs`" — descrevia o mecanismo
antigo; quem recebe `dtMs` agora é só `advanceBy`, e cada cálculo recebe o instante em que ele
vence. O texto no `AGENTS.md` foi atualizado no mesmo commit.

Os outros dez seguem intocados. O invariante 3 — o resultado não depende de haver alguém
assistindo — sai **mais forte**: era verdade para a recompensa e falso para o dano sofrido, e
agora é verdade para os dois.
