# 0011 — Stack de bibliotecas

**Status:** aceito
**Data:** 2026-09-07
**Contexto técnico:** todos os pacotes

## Contexto

O monorepo nasceu sem nenhuma dependência além de TypeScript, Vitest e ESLint. A Fase 1 será
executada em boa parte por agente, com orçamento limitado, e escolha de biblioteca é exatamente
o tipo de decisão que um agente toma de forma diferente a cada tarefa — produzindo duas formas de
validar schema, dois clientes de Redis e três estilos de acesso ao banco no mesmo repositório.

Fixar as escolhas uma vez custa uma tarde e economiza a divergência inteira.

## Decisão

| Papel | Escolha |
|---|---|
| Validação de schema | **Zod** |
| Acesso ao Postgres | **Drizzle ORM** |
| Migrações | **drizzle-kit** |
| Redis | **ioredis** |
| HTTP do `api` | **Fastify** |
| WebSocket do `game` | **uWebSockets.js** |
| Log | **pino** |
| Métricas | **prom-client** |
| Teste | **Vitest**, com Postgres e Redis via docker-compose e `globalSetup` |

`packages/sim` não recebe nenhuma delas — continua puro (invariante 1). Zod entra em `protocol`
e `content`; o resto vive em `server` e `tools`.

## Alternativas

- **TypeBox + AJV** no lugar do Zod — validador compilado, bem mais rápido no caminho quente.
  Descartado por ergonomia e por comunidade menor; ver Consequências.
- **Kysely** no lugar do Drizzle — mais fino, SQL na mão, sem geração de migração. Descartado por
  preferência de produto: schema tipado e migração gerada valem mais que a transparência extra.
- **Prisma** — descartado por pôr um processo próprio no meio e complicar transação, que é
  justamente o que o ledger e o Market exigem (ADR 0006).
- **node-redis** — descartado porque a ergonomia de script Lua do `ioredis` (`defineCommand`) é
  melhor, e o limite de 2 personagens ativos depende de Lua.
- **uWebSockets também no `api`** — descartado: uma dependência a menos não compensa a perda de
  ergonomia num serviço REST comum. Processos separados podem ter stacks separadas.
- **Testcontainers** — descartado por enquanto: mais isolado, mais lento para subir, e o
  docker-compose já existe para desenvolvimento.

## Consequências

- Uma forma de fazer cada coisa. É o ganho principal, e ele só existe se estas escolhas forem
  tratadas como fixas — trocar qualquer uma exige ADR novo, não decisão no meio de uma tarefa.
- **Risco assumido: Zod no caminho quente.** A validação roda em toda mensagem de entrada — na
  ordem de centenas de milhares por segundo no cenário de referência —, e o Zod interpreta o
  schema a cada chamada em vez de compilar. Se o teste de carga (FUN-46) mostrar a validação
  aparecendo no perfil, a saída conhecida é gerar JSON Schema a partir dos mesmos schemas Zod
  (`zod-to-json-schema`) e compilar com AJV só no `protocol`, mantendo o Zod no `content`. A
  escolha foi feita com esse trade-off consciente, não por engano.
- Drizzle acopla o schema ao TypeScript. Migração gerada é conveniente e é preciso **ler o SQL
  gerado** antes de aplicar — geração automática de migração destrutiva é uma armadilha conhecida.
- `sim` segue sem dependência, o que mantém aberta a porta de reescrevê-lo em outra linguagem
  (ADR 0005).

## Invariantes afetados

1 (`sim/` é puro — nenhuma destas bibliotecas entra lá).
