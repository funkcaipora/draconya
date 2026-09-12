# @draconya/tools

## Propósito

Ferramentas de desenvolvimento e operação: o cliente sintético de carga, benchmarks e o
`content:check`. Os importadores que falam com o pacote de arte e com o mapa real moram em
`scripts/` na raiz (`pack-inventory.ts`, `import-map.ts`, `otbm.ts`, `fetch-map.ts`, `trace-route.ts`,
`build-asset-library.ts`), porque importam `packages/client/src/assets` por caminho relativo
sob o `tsconfig.tooling.json` — ver `docs/asset-library.md`.

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
- **`pnpm bench:hunts` só vale com a máquina junto.** O tick é single-thread, então quem decide é
  desempenho por core (ADR 0013); o relatório imprime plataforma, CPU e versão do Node por isso.
  Medir no laptop e extrapolar para o servidor erra.
- **O aquecimento do JIT não é detalhe:** o mesmo cenário mediu 51 µs pequeno e 12 µs grande. O
  aquecimento é contado em *ticks de sessão*, não em ticks do laço, e cenário pequeno demais sai
  com aviso.
- **Observador de GC é `{ type: 'gc' }`, nunca `{ entryTypes: ['gc'] }`.** A segunda forma é
  aceita sem reclamar e não entrega entrada nenhuma no Node 24 — o relatório dizia "0 ms de GC" e
  não media coisa alguma.

Issues: FUN-45 (cliente de carga), FUN-46 (cenário frio).
