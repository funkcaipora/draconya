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

## Emenda — 2026-09-29 (#812): o relógio é da sessão — o personagem chega com os prazos traduzidos e sem os carimbos

Esta decisão faz cada sessão começar o próprio relógio em zero. O que ela não dizia é o que acontece
com um instante gravado em `CharacterRuntime` — que atravessa Cidade → hunt, hunt → Cidade e a saída
da party como o MESMO objeto — e lido pela sessão seguinte: um instante de 57 700 ms da hunt anterior
é "no futuro" de uma sessão que está em 1 000 ms, e o resultado do combate passa a depender do
caminho do objeto, e não do estado e da semente (invariante 3). O #550 achou o primeiro caso
(`lastAttackAtMs`) e o #812 fechou a classe inteira. São duas espécies de grandeza, e cada uma tem um
destino diferente na entrada:

- **Carimbo** ("quando foi a última vez que…") **é zerado.** `Session.enter` chama
  `CharacterRuntime.resetSessionClockState` depois de o `onEnter` aceitar: `lastAttackAtMs` (#550),
  `lastCombatActionAtMs` (#625), o banco de cargas de bloqueio (volta cheio: o contador do Canary sobe
  uma carga por segundo até duas, e qualquer passagem pela Cidade dura mais que isso) e a ação manual
  adiada (o evento dela morava na fila da sessão anterior). A janela de um carimbo é curta (2 s a 60 s)
  e a saída normal da hunt só conclui fora de combate (`isInFight`), então não há restante a preservar.
  A trava de stairhop (`attackLockedUntil`, #554) estava nesta lista até o #622 a transformar na
  condição `pacified`: desde então ela é PRAZO, e atravessa traduzida como as demais condições.
- **Prazo** ("quanto ainda falta") **é traduzido, nunca zerado.** O cooldown de magia e de poção, as
  condições (haste, Utamo Vita, veneno, paralisia, a regeneração de alma) e a imunidade do Cleanse
  atravessam com o que faltava: `restante = instante − agora_da_origem`, e no destino
  `instante' = restante + agora_do_destino` (`CharacterRuntime.moveToClock`, `Cooldowns.rebase`,
  `Conditions.rebase`). O que já venceu na saída não vai. A Cidade não simula (ADR 0023), então o prazo
  fica PAUSADO nela — a mesma convenção do anel de duração (`HuntRuleset#parkEquipment`, #689: "sair e
  voltar renovaria o anel de graça") e da comida (`fedMs`, #726). O ADR 0037 (decisão 6) exige o
  mecanismo do Canary **inclusive quando ele dispara**, e lá a condição de cooldown de magia
  (`CONDITION_SPELLCOOLDOWN`, criada com `CONDITIONID_DEFAULT`) é persistente
  (`Condition::isPersistent`): sobrevive ao logout com os ticks que faltavam, e a morte não a remove
  (`Condition::isRemovableOnDeath`). Zerar tudo na entrada — a primeira versão do #812 — deixava o
  Intense Wound Cleansing (`cooldownMs: 600000`) castável um ou dois minutos depois de uma ida à
  Cidade, e apagava o veneno, a paralisia e o Utamo Vita de graça.
- **A tradução precisa saber onde o relógio antigo parou, e sabe.** A premissa da primeira versão desta
  emenda — que o objeto não guarda isso — era falsa: a sessão que SAI conhece o próprio `nowMs`, e o
  `HuntRuleset#parkEquipment` já o usa. O personagem guarda um vínculo TRANSIENTE com o relógio da
  sessão em que está (não vai no snapshot nem em `getState`; a restauração o religa com `bindClock`, sem
  traduzir) e `Session.leave`/`end` gravam nele o instante EXATO da saída (`markDeparture`) — o
  `advanceBy` que encerra no meio de um evento ainda empurra o relógio até o alvo, e a party segue
  andando para os outros, então ler o relógio da origem depois daria um restante que depende da
  frequência do hospedeiro (invariante 2). O `#runTransition` do host constrói o destino ANTES de
  encerrar a origem: nesse caso a saída ainda não aconteceu, e a origem de tradução é o `nowMs` vivo
  dela — o mesmo instante, porque nada avança uma sessão entre as duas chamadas — e a saída da origem
  depois não traduz de novo (o vínculo já é o da sessão nova).
- **A hunt reagenda o que a fila anterior levava.** `Session.enter` traduz ANTES do `onEnter` para o
  ruleset enxergar os instantes já no relógio dele; `HuntRuleset#armConditions` agenda
  `CONDITION_EXPIRE` e o próximo `CONDITION_TICK` de cada condição trazida (sem isso uma haste
  herdada nunca acabaria). `onLeave` tira os EVENTOS da fila e deixa a condição no personagem; a
  morte (`#onCharacterDied`) continua removendo as condições, e o cooldown de magia segue.
- **A entrada recusada não toca quem continua na origem** (party cheia: a tradução é desfeita, o
  vínculo volta) e **o restore de snapshot não passa por `enter`**: o relógio é o mesmo, e a janela
  quente atravessa. A frequência de avanço (invariante 2) e a restauração continuam invariantes.
- **A regra é estrutural, não de memória**: `SESSION_CLOCK_POLICY` (`session.test.ts`) é um
  `Record<keyof CharacterState, 'stamp' | 'duration' | 'none'>`, e um campo novo do estado do
  personagem não compila até ser classificado — e quem o classifica como carimbo ou prazo precisa dar
  a ele o teste de entrada.

**Não coberto (acompanhamento, ADR 0014):** o prazo atravessa a Cidade **viva**, com o mesmo objeto em
memória. Quando a sessão de repouso é recolhida (ADR 0024) ou o nó cai, o personagem volta do ticket, e
o `characterFromTicket` não traz cooldown nem condição — o Canary os salva no logout. Persisti-los
pede uma coluna em `characters`, o campo no ticket e no extrato, e a migração (ADR 0014). Fica em
aberto como trabalho próprio — não é uma divergência decidida, é o que falta para a persistência no
logout.
