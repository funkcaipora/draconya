# @draconya/sim

## Propósito

O motor de simulação: sessão, tick, combate, movimento por tile, IA de monstro, motor de bot,
rulesets de hunt/treino/quest/boss/guild war. É onde o jogo acontece.

## Fronteiras

**Pode importar:** `protocol`, `content`.
**Não pode importar:** `server`, `client`, `tools`, e **nenhum I/O** — `node:*`, `fs`, `net`,
`http`, `pg`, `redis`, `uWebSockets.js`, `express`.

Esta é a fronteira mais importante do repositório, e o lint a impõe. Ver `docs/boundaries.md`.

## Invariantes locais

- **Pureza** (invariante 1). Sem I/O, sem framework, sem rede, sem banco, **sem relógio global**.
  Tempo entra como parâmetro; `Date.now()` dentro daqui é bug. É o que permite testar sem
  infraestrutura, rodar no cliente sintético de carga, e reescrever o núcleo em Rust ou Go depois
  sem tocar no protocolo. Ver ADR 0001 e 0005.
- **Nada é escrito "por tick"** (invariante 2). Quem recebe `dtMs` é `Session.advanceBy`, e mais
  ninguém: cada cálculo é um evento da fila e roda no instante EXATO em que vence. É o que faz a
  hunt desanexada a 1 Hz produzir o mesmo estado que a anexada a 10 Hz — não parecido, o mesmo.
  Ver ADR 0003 e ADR 0020.
- **O resultado não depende de haver alguém assistindo** (invariante 3). Cai a apresentação, nunca
  a matemática.
- **Estado quente só é escrito pela sessão dona** (invariante 9).
- **Todo personagem está sempre em exatamente uma sessão** (invariante 8).

## Como testar

```
pnpm vitest run packages/sim
```

O teste que mais importa: **rodar o mesmo cenário a 10 Hz e a 1 Hz produz o mesmo resultado.**
Se divergir, alguém pôs decisão de jogo fora da fila de eventos — porque dentro dela a
equivalência não depende de fórmula nenhuma estar escrita com cuidado.

## Armadilhas conhecidas

- Monstro usa **passo guloso, não A\***: tenta o tile que aproxima, bloqueado tenta o adjacente,
  senão espera. Consequência barata: campo bloqueante não invalida caminho nenhum, porque não
  existe caminho guardado. Ver ADR 0009.
- **A escolha entre os dois desvios é fixa** (horário antes de anti-horário). Alternar exigiria
  guardar estado por monstro, e um viés estável é preferível a um que depende de quantas vezes o
  monstro já tentou — esse último produz movimento errático que ninguém reproduz.
- **Custo medido: 0,069 µs por monstro por decisão** (`pnpm bench:monster`). É a linha de base que
  a FUN-46 cobra em escala; uma regressão de ordem de grandeza aqui vira conta de servidor.
- **Alocação por evento é o que custa caro aqui**, e não a conta em si: com 5.000 instâncias, uma
  closure ou uma string por vencimento é o coletor rodando o tempo todo. Foi medido — índice de
  monstro por subject, predicado de bloqueio reaproveitado, chave de tile numérica e busca sem
  closure valeram de 35,4 para 18,8 µs por tick no `pnpm bench:hunts`. Antes de "otimizar a
  lógica", conte as alocações.
- A hunt **não faz pathfinding** — a rota é uma lista fixa de tiles vinda de `content`. O
  personagem também não persegue: ele percorre a rota e deixa o monstro vir.
- **A equivalência entre taxas vale para TUDO desde a FUN-68** — abates, XP e dano sofrido. Era
  verdade só para a recompensa: quem rodava a 1 Hz apanhava 1,51× mais, por granularidade de
  espaço. Ver ADR 0020 e `docs/product/hunt.md`.
- **Cadência de jogo é EVENTO na fila, nunca cálculo por intervalo.** Passo de rota, passo e
  ataque de monstro, ataque do jogador, regeneração e respawn são todos eventos que se
  reagendam. O acumulador de duração (`timesThatFit`) foi removido: ele devolvia N aplicações e
  deixava quem chamava decidir o que fazer com o N, que é a forma exata do defeito da FUN-67.
- **Grandeza contínua é evento periódico**: uma taxa de `r` por segundo é um evento a cada
  `1000 / r` ms. Não some `r * dtMs / 1000` num acumulador fracionário — somar `0,1` dez vezes em
  ponto flutuante dá `0,9999…` e some uma unidade a cada dez. Já foi tentado e revertido.
- **Cooldown de ataque não corre no vazio.** Quem passa o intervalo inteiro sem alvo fica
  ENGATILHADO e bate no instante do contato, não no próximo múltiplo de um relógio. A invariante
  é "engatilhado OU agendado, nunca os dois", e ela mora em `#schedulePlayerAttack` /
  `#scheduleMonsterAttack` — os dois ao mesmo tempo é o dobro do dano, e já aconteceu.
- **Morte é pipeline, e a consequência é do ruleset** (FUN-63). `resolveDeath` em `death.ts`
  congela a criatura, resolve o crédito (`lastHitBy`, `mostDamageBy`) e chama
  `Ruleset.onCreatureDied`; nenhum ruleset cancela evento de morto por conta própria, e
  nenhuma criatura decide o que a própria morte significa. `Contribution` é um `Map` mutado a
  cada golpe — um `Record` com chave dinâmica e `delete` cai em modo dicionário — e mesmo assim
  a atribuição custa ~2 µs por tick por instância no `pnpm bench:hunts` (18 → 21). É o preço
  de saber quem matou; não o pague duas vezes registrando de novo em outro lugar.
- **Loot sorteia com o `Rng` da sessão, gold antes de item, e `chance: 0` não consome
  sorteio.** Ordem e semente são contrato: mudar qualquer um dos dois muda o que toda hunt
  retomada rende. `Math.random` continua proibido, e `grep -rn "Math.random" src` é vazio.
- **Um evento que se reagenda usa `session.nowMs + intervalo`**, e é exato porque `nowMs` durante
  o despacho É o instante do vencimento. Não há erro a herdar, e por isso não há acumulador.
- **`pnpm source-policy` reprova nome de contador de tick** (`remainingTicks`, `cooldownTicks`, …)
  dentro deste pacote. É a verificação do invariante 2 que não depende de alguém lembrar.
- **Este pacote compila sem `@types/node`.** Desde o TypeScript 6 (FUN-61) o `types` padrão é
  vazio, e só os pacotes que usam Node o pedem no `tsconfig.json`; o `sim` não pede. `process`,
  `setTimeout`, `Buffer` e `node:*` não existem aqui nem como tipo — é o invariante 1 imposto
  pelo compilador, antes do lint. Se um erro "Cannot find name 'process'" aparecer neste
  pacote, a resposta é tirar o `process`, nunca adicionar o `types`.
- O adaptador `systemClock` vive em `server/`. Aqui ficam apenas o contrato `Clock` e o
  relógio controlado de teste. O lint recusa os globais `Date` e `performance`, inclusive via
  `globalThis`, para impedir que tempo real volte a entrar no núcleo.
- O motor de bot é compilado ao entrar na sessão, para um vetor de predicados. Interpretar JSON a
  cada avaliação é o caminho fácil e errado. Ver ADR 0002.
