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
- **Nada é escrito "por tick"** (invariante 2). Todo cálculo recebe `dtMs`. Cooldown guarda
  timestamp de disponibilidade, nunca contador decrementado. É o que faz a hunt desanexada rodar a
  1 Hz com resultado idêntico. Ver ADR 0003.
- **O resultado não depende de haver alguém assistindo** (invariante 3). Cai a apresentação, nunca
  a matemática.
- **Estado quente só é escrito pela sessão dona** (invariante 9).
- **Todo personagem está sempre em exatamente uma sessão** (invariante 8).

## Como testar

```
pnpm vitest run packages/sim
```

O teste que mais importa: **rodar o mesmo cenário a 10 Hz e a 1 Hz produz o mesmo resultado.**
Se divergir, alguma fórmula está contando ticks em vez de tempo.

## Armadilhas conhecidas

- Monstro usa **passo guloso, não A\***: tenta o tile que aproxima, bloqueado tenta o adjacente,
  senão espera. Consequência barata: campo bloqueante não invalida caminho nenhum, porque não
  existe caminho guardado. Ver ADR 0009.
- **A escolha entre os dois desvios é fixa** (horário antes de anti-horário). Alternar exigiria
  guardar estado por monstro, e um viés estável é preferível a um que depende de quantas vezes o
  monstro já tentou — esse último produz movimento errático que ninguém reproduz.
- **Custo medido: 0,081 µs por monstro por tick** (`pnpm bench:monster`). É a linha de base que
  a FUN-46 vai cobrar em escala; uma regressão de ordem de grandeza aqui vira conta de servidor.
- A hunt **não faz pathfinding** — a rota é uma lista fixa de tiles vinda de `content`. O
  personagem também não persegue: ele percorre a rota e deixa o monstro vir.
- **A equivalência entre taxas vale para a RECOMPENSA, não para o dano sofrido.** Medido: dez
  minutos de hunt rendem os mesmos abates a 1, 2, 5, 10 e 20 Hz, mas quem roda a 1 Hz apanha até
  1,5× mais. A causa é granularidade de espaço — num tick de 1 s as duas criaturas andam dois
  tiles de uma vez e a adjacência é conferida uma vez só. Corrigir pediria subdividir o tick, que
  gasta o que o 1 Hz economiza. Ver `docs/product/hunt.md`.
- **Ataque usa acumulador (`timesThatFit`), não timestamp absoluto**, mesmo sendo condicional. Já
  foi tentado o contrário: com timestamp os abates passam a divergir entre taxas, porque o ataque
  que fica pronto no meio do tick dispara atrasado e o resto é descartado.
- O adaptador `systemClock` vive em `server/`. Aqui ficam apenas o contrato `Clock` e o
  relógio controlado de teste. O lint recusa os globais `Date` e `performance`, inclusive via
  `globalThis`, para impedir que tempo real volte a entrar no núcleo.
- O motor de bot é compilado ao entrar na sessão, para um vetor de predicados. Interpretar JSON a
  cada avaliação é o caminho fácil e errado. Ver ADR 0002.
