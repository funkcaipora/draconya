# @draconya/tools

## Propósito

Ferramentas de desenvolvimento e operação: o cliente sintético de carga, benchmarks e o
`content:check`. Os importadores que falam com o pacote de arte e com o mapa real moram em
`scripts/` na raiz (`pack-inventory.ts`, `import-map.ts`, `otbm.ts`, `fetch-map.ts`, `trace-route.ts`,
`build-asset-library.ts`), porque importam `packages/client/src/assets` por caminho relativo
sob o `tsconfig.tooling.json` — ver `docs/asset-library.md`.

O importador do CATÁLOGO do Tibia (item, monstro, magia — ADR 0038) mora em `scripts/catalog/`,
pelo mesmo motivo e ao lado do importador de mapa, e não aqui: `pnpm catalog:import <tipo>
[--check]` lê `things/sources/canary` (`CANARY_DIR`) e escreve `packages/content/data/<tipo>/
generated/*.json`, nunca `packages/tools`. `scripts/catalog/xml.ts` (XML → árvore própria,
`fast-xml-parser` por baixo), `lua-table.ts` (tabela Lua → JS, `luaparse` por baixo — os dois
MIT, JS puro, sem binário nativo, ADR 0013) e `enums.ts` (enum C++ → `Map<string, number>`, para
resolver `COMBAT_*`/`BESTY_RACE_*`/`CONST_ME_*`) são as três peças que um importador de `<tipo>`
novo usa; `registry.ts` é onde ele se registra (`registerCatalogType`) para o comando aceitar o
nome. O primeiro `<tipo>` registrado é `monsters` (#578, `scripts/catalog/monsters.ts`): lê
`data-otservbr-global/monster/**/*.lua` (sem `familiars/`, `trainers/`, `traps/`) e escreve em
`packages/content/staging/monsters/generated/` — **não** em `data/monsters/generated/`, porque o
monstro gerado ainda não passa no boot (loot por slug de item sem o catálogo do #573, e sem linha na
tabela de aparências); a primeira importação para `data/` é o #580. Ataque, defesa e invocação
passam pelos mapeadores por NOME de `scripts/catalog/monster-abilities.ts` (#579): `melee`,
`combat` (dano com forma, e cura própria em `defenses`), `speed`, `condition` (total fixo),
`drunk`, `firefield`/`poisonfield`/`energyfield` e `monster.summon`; `outfit`, `effect` e
`strength` são descartados porque o Canary não faz nada mecânico com eles. Um nome sem mapeador
(as magias com nome próprio em script Lua, `invisible` em `attacks` — o Canary só o usa em
`defenses`, exceto num chefe de quest —, a `condition` de total sorteado) tira o monstro do
catálogo, e quem invoca um monstro que não foi gerado sai junto. O `immunities[].condition = true`
do Lua vira `monster.conditionImmunities` pela tabela de `luaMonsterTypeConditionImmunities` do
Canary (`bleed`/`fire`/`ice`… → a imunidade à DOT correspondente, #559); `outfit` é reportado por
nome em `ignoredFields` até o M44-03. Dois
campos saem CONDICIONADOS ao schema da base: `kind` (#682) e a onda de monstro em `rows` (#679,
sem ele a onda sai na `wave` antiga — TODO). O que ficou fora vai para
`docs/reference/catalog/monsters-report.md` com o motivo; o que foi lido e não coube (moeda
extra, fraqueza abaixo de −100 %, campo ignorado, nome sem mapeador com a contagem de monstros,
cobertura e a meta revista, chaves de apresentação com o id do Canary) vai para a seção "Notas"
do mesmo relatório.
A velocidade é a do TFS quando `FORGOTTENSERVER_DIR` tem o mesmo monstro, senão Canary × 2 (ADR
0037 d.4) — sem o checkout do TFS, todo monstro cai no × 2, e a nota do relatório diz isso. Limite de licença sem
exceção (ADR 0019/0038): o que sai do Canary é NÚMERO e FATO, nunca uma linha de Lua ou C++
reproduzida — `lua-table.ts` só AVALIA expressão literal, nunca executa Lua de verdade.

`generated/<fatia>.json` é SEMPRE a transcrição pura do Canary — quem aplica `overrides/*.json`
por cima não é este comando, é `@draconya/content` (`load.ts`), toda vez que o conteúdo é
CARREGADO, não só quando é importado. É o que faz uma correção sobreviver a uma reimportação sem
precisar ser reaplicada à mão: ver "O catálogo importado" em `packages/content/AGENTS.md`.

## Fronteiras

**Pode importar:** todos os pacotes. É o topo da pilha e não tem restrição.
**Não pode ser importado por:** `client`. `server` pode, para scripts operacionais.

## Invariantes locais

- Nada aqui roda em produção no caminho do jogador. Se virar dependência de runtime do `server`
  num caminho quente, mudou de pacote.
- O cliente sintético de carga fala o **protocolo**, não o DOM. É o que permite medir 5.000 sessões
  desanexadas sem navegador.
- `src/harness/` testa os hooks do harness (`.githooks/commit-msg`,
  `.claude/hooks/validate-commit.sh`), que continuam morando onde o git e o Claude Code os
  procuram. O teste mora aqui porque o vitest só coleta `packages/*/src/**/*.test.ts` e este é o
  pacote de ferramentas de desenvolvimento — não porque os hooks pertençam a `tools/`.

## Como testar

```
pnpm vitest run packages/tools
```

## Armadilhas conhecidas

- O cliente de carga (`pnpm load`) cobre os dois modos: **anexado** (mantém o socket, mede
  bytes/s e latência) e **desanexado** (entra na hunt, fecha o socket e some). Só o segundo
  valida a projeção de custo, e ele é o modo PADRÃO do jogo, não um caso extremo.
- **Processos worker, não threads.** O limite de descritores de arquivo é por processo, e é ele
  que decide quantos sockets cabem — cinco mil conexões num processo só esbarram nele antes de
  esbarrarem em CPU. Sem isso, o gargalo medido seria o do próprio cliente de carga.
- **`process.send` é assíncrono.** Sair logo depois perde a mensagem quando ela cresce: o worker
  mandava as amostras e chamava `process.exit` no `finally`, e quinhentas sessões anexadas
  voltavam como *zero amostras* enquanto o servidor via as quinhentas de pé. O relatório dizia
  "0 abertas, 0 falharam" — a pior das duas mentiras. Sai no callback do `send`.
- **Memória por sessão do cliente de carga só vale num nó VAZIO.** Ela é o crescimento do heap
  dividido pelas sessões novas; com sessões já rodando, o crescimento delas entra na conta e
  infla o número (deu 168 KiB assim, contra 9 KiB limpo). O relatório avisa quando o nó não
  estava vazio. A medida confiável de memória é o `pnpm bench:hunts`.
- **Módulo que executa ao ser importado é armadilha.** `main.ts` é só a borda; a lógica mora em
  `runner.ts`. A primeira versão punha a chamada no próprio módulo, e importar uma função pura
  num teste subia os workers e esperava a duração inteira — sessenta segundos para rodar treze
  asserções.
- **Script que roda por `tsx` precisa de BUILD antes, e nada avisa.** `tsx` resolve
  `@draconya/sim` pelo `main` do `package.json`, que aponta para `dist` — não para `src`, como o
  alias do Vitest faz. Então a suíte inteira passa com o código novo enquanto `pnpm bench:hunts`
  roda o código de duas semanas atrás, ou quebra com `session.advanceBy is not a function`. Foi o
  que aconteceu na FUN-68: o `pnpm check` ficou verde e o benchmark parou de rodar. Os scripts da
  raiz (`bench:hunts`, `bench:monster`, `load`, `content:check`) agora começam com `tsc -b`, que
  é incremental e custa nada quando já está em dia.
- **`pnpm bench:hunts` não roda no CI, e por isso quebra em silêncio** (#179): ele parou quando
  FUN-94 tornou a tabela de aparências obrigatória e ninguém viu por meses. O cenário vive em
  `src/bench/cold-scenario.ts` e `cold-scenario.test.ts` monta e avança uma hunt — é o teste
  que reprova no PR quando o contrato de `buildContent` mudar de novo. O relatório imprime a
  CPU ao lado da parede: num laptop paginando a parede mediu 380 µs/tick onde a CPU gastou 16.
- **`pnpm bench:hunts` só vale com a máquina junto.** O tick é single-thread, então quem decide é
  desempenho por core (ADR 0013); o relatório imprime plataforma, CPU e versão do Node por isso.
  Medir no laptop e extrapolar para o servidor erra.
- **O aquecimento do JIT não é detalhe:** o mesmo cenário mediu 51 µs pequeno e 12 µs grande. O
  aquecimento é contado em *ticks de sessão*, não em ticks do laço, e cenário pequeno demais sai
  com aviso.
- **Observador de GC é `{ type: 'gc' }`, nunca `{ entryTypes: ['gc'] }`.** A segunda forma é
  aceita sem reclamar e não entrega entrada nenhuma no Node 24 — o relatório dizia "0 ms de GC" e
  não media coisa alguma.
- **O cenário do CMB-10 é MISTO e roda pelo mesmo relatório** (`SCENARIO=combat pnpm bench:hunts`,
  ou `pnpm bench:combat`): ability em área, resistência, defesa de escudo, condição/campo e
  modificadores, sobre 40 monstros. `combat-scenario.test.ts` o monta no CI, como o frio. O
  personagem entra VESTIDO (arma de uma mão + escudo) e com vida enorme — sem a vida enorme ele
  morre, a sessão encerra, e o laço medido passa a rodar sessões mortas: o µs/tick despenca para
  zero e o número vira mentira. Ver `docs/product/combat-conformance.md`.
- **`pnpm bench:city` mede o LEQUE de saída da praça, e o relógio é parte do cenário** (OW-07,
  #828). Ele roda `SessionHost` + `CityShard` + `Viewer` de verdade e o codec real, e o socket só
  conta os bytes do frame. A armadilha que o deixou sem medir o que dizia: com `now: () => 0` o
  hospedeiro recusa o `walk` adiantado (FUN-122) e todo passo depois do primeiro vira recusa, com a
  tabela ainda saindo — o FUN-120 deixou de ser reproduzível sem que ninguém visse. Agora o relógio é
  SIMULADO e anda no ritmo de produção (passo da Cidade de 150 ms, ciclo do hospedeiro de 100 ms,
  tick no máximo divisor comum), e `passos/s` na tabela é o que prova que o cenário anda. A
  medição vive em `city-scenario.ts`, a conta em `city-metrics.ts`, a tabela em `city-report.ts` e
  `city-broadcast.ts` é só a borda; `city-scenario.test.ts` roda tudo em modo curto no CI.
- **CPU do bench de praça é `process.cpuUsage()`, mas continua sendo de máquina.** Numa máquina
  com outros processos (a de desenvolvimento roda agentes em paralelo) o p99 mede a máquina: o
  relatório imprime a carga, e `REPEAT=3` publica a melhor rodada por linha. Antes/depois é sempre
  na mesma máquina, sob carga parecida. `CYCLE_MS` (100) é espelho do `host.ts`, e um teste confere.
- **`MAP=square` é a praça sintética do FUN-33; o padrão é a Thais real.** A sintética existe para
  rodar sem o mapa e para comparar com a medição antiga.

Issues: FUN-45 (cliente de carga), FUN-46 (cenário frio), OW-07/#828 (bench da praça).
