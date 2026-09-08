# Draconya

MMORPG de navegador em grade de tiles, **server-authoritative e idle-first**.

A hunt — o loop principal de progressão — é uma sessão que vive no servidor e continua rodando
com o navegador fechado. O jogador monta o equipamento, configura as regras de um bot oficial,
escolhe uma caçada e sai; o servidor simula. Conteúdo manual (quest, boss, guild war) é
instanciado à parte, exige o jogador presente, e reaproveita o mesmo motor de movimento por tile.

A frase que define o produto: **é o Tibia jogado com bot, com o bot oficializado.** A habilidade
se reparte de forma explícita — posicionamento e foco são do jogador, reação é da máquina. Como
todo mundo tem o mesmo bot, a luta não é decidida por quem comprou o script melhor.

**Status:** Fase 1 (espinha dorsal), com a conexão ponta a ponta ainda em construção.

| Área | Implementado | Próxima integração |
|---|---|---|
| Protocolo | Opcodes, schemas e codec binário com lote e compressão (FUN-6/7) | Despacho das mensagens no WebSocket |
| Simulação | Sessão por tempo decorrido, RNG determinístico, cooldowns, snapshot em memória e ruleset de Cidade (FUN-25/27/31) | Agendador, persistência e ruleset de Hunt |
| Servidor | Configuração, auth WorkOS + sessão HTTP em Redis, CRUD de personagens, processos `api`/`game`/`jobs`, health/metrics, diretório Redis com leases e limite atômico de ativos, ticket de sessão com resolução de nó, e WebSocket hospedando sessões com anexar/desanexar (FUN-10/11/12/13/14/15/48) | Persistência/retomada de sessão e integração do cliente |
| Conteúdo, cliente e ferramentas | Carregador versionado, formato de tilemap e rota com validação de laço, validador de CLI e entrada React (FUN-8/9) | Assets do cliente Tibia e cliente conectado |

O próximo critério de aceite é o **M1 — Fundação e conexão**: autenticar, selecionar personagem,
receber um ticket de uso único e aparecer num mapa de teste com retângulos. Auth, personagem,
ticket e socket já existem no servidor; falta fechar a demonstração pelo cliente. Os snapshots do núcleo
ainda não provam recuperação após queda do processo; persistência, retomada e drenagem com crédito
continuam como integrações pendentes. O andamento das tarefas fica no
[Linear](https://linear.app/funkcaipora/project/draconya-8ad404c2226c).

---

## Começando

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm db:push      # cria/atualiza o schema local a partir do Drizzle
# Para check/test, exporte TEST_REDIS_URL e DATABASE_TEST_URL apontando para serviços descartáveis.
pnpm check        # lint + typecheck + test + docs-check + source-policy
pnpm dev
```

Com `AUTH_DEV_MODE=true`, faça login local sem credencial WorkOS:

```bash
curl -i -X POST http://localhost:3000/api/auth/dev-login \
  -H 'content-type: application/json' \
  -d '{"email":"dev@example.com"}'
```

O cookie retornado é a sessão HTTP usada em `/api/characters` e `/api/tickets`. Em produção,
`AUTH_DEV_MODE` é proibido e o fluxo usa Hosted AuthKit com callback em
`WORKOS_REDIRECT_URI`.

| Comando | O que faz |
|---|---|
| `pnpm build` | `tsc -b` nas bibliotecas + `vite build` no cliente |
| `pnpm db:push` | aplica o schema Drizzle ao Postgres local; não usar para adivinhar renomeações de banco legado |
| `pnpm db:generate` | gera migração Drizzle para revisão antes de produção |
| `pnpm db:migrate` | aplica migrações versionadas em banco novo; consulte o procedimento para banco existente em `docs/product/accounts-and-characters.md` |
| `pnpm typecheck` | compila sem emitir, via referências de projeto |
| `pnpm test` | Vitest em todos os pacotes |
| `pnpm lint` | ESLint, incluindo as fronteiras de import entre pacotes |
| `pnpm docs-check` | valida a documentação estrutural |
| `pnpm source-policy` | recusa código first-party em JavaScript ([ADR 0016](docs/adr/0016-typescript-only-first-party-code.md)) |
| `pnpm --filter @draconya/client dev` | sobe o cliente em modo de desenvolvimento |

Requisitos: Node 24 (conforme `.node-version`) e pnpm (via corepack).

Os testes de integração usam `TEST_REDIS_URL` e `DATABASE_TEST_URL`, ambos explícitos.
O Redis deve ser descartável: os bancos 1–4 sofrem `FLUSHDB`. Cada teste de Postgres cria e
remove somente seu próprio schema. O CI fornece esses serviços; não aponte testes para bancos
de desenvolvimento com dados que precisam ser preservados.

**Antes do primeiro commit**, ligue os hooks de git:

```bash
git config core.hooksPath .githooks
```

Sem isso, o validador de mensagem de commit não roda fora do Claude Code.

---

## Pacotes

| Pacote | Responsabilidade |
|---|---|
| `packages/protocol` | Opcodes, tipos de mensagem e codec de frame. Fonte única das tabelas cliente/servidor. |
| `packages/content` | Dados de jogo versionados: monstros, hunts, itens, magias, vocações, preços, flags. Nunca arte. |
| `packages/sim` | Motor de simulação **puro**: sessão, tick, combate, movimento, IA, bot. Sem I/O. |
| `packages/server` | Processos `api` (HTTP), `game` (WebSocket, hospeda sessões) e `jobs` (agendador). |
| `packages/client` | React + PixiJS v8 + Vite. HUD em DOM, mundo em canvas. |
| `packages/tools` | Importadores, scripts e o cliente sintético de carga. |

As fronteiras de import entre eles são **regra de lint**, não convenção — ver
[`docs/boundaries.md`](docs/boundaries.md). Cada pacote tem um `AGENTS.md` com propósito,
fronteiras, invariantes locais e armadilhas conhecidas.

---

## Documentação

| Documento | O que é | Natureza |
|---|---|---|
| [`AGENTS.md`](AGENTS.md) | O norte: os onze invariantes inegociáveis, stack, padrão de commit | vivo |
| [`docs/technical-architecture.md`](docs/technical-architecture.md) | Arquitetura e plano do MVP em 15 épicos e 7 fases | vivo |
| [`docs/architecture.md`](docs/architecture.md) | Restrições do motor: o que é barato, caro ou impossível | vivo |
| [`docs/boundaries.md`](docs/boundaries.md) | Quem pode importar quem, e por quê | normativo |
| [`docs/adr/`](docs/adr/) | Decisões técnicas com contexto, alternativas e consequências | append-only |
| [`docs/product/`](docs/product/) | Documentação funcional por sistema: o que existe de fato | vivo |
| [`docs/prd-v0.9.md`](docs/prd-v0.9.md) | O PRD do jogo | instantâneo |
| [`docs/harness-plan.md`](docs/harness-plan.md) | Como a documentação e os padrões são mantidos | vivo |
| [`docs/infrastructure.md`](docs/infrastructure.md) | Fornecedores, recursos e custo estimado em três estágios | vivo |
| [`docs/deploy.md`](docs/deploy.md) | Como subir local e na VPS, papéis, drenagem e backup | vivo |

A distinção que mais importa: o **PRD é um instantâneo** do que se pretendia numa data, com
itens em aberto espalhados. `docs/product/` é o documento **vivo** — o que o código faz hoje,
com os parâmetros de balanceamento e o caminho onde cada um mora.

---

## Contribuindo

**Idioma:** código, identificadores, nomes de arquivos e pastas, contratos, configuração, logs e testes
em inglês; documentação e comentários em português. Exemplos de código na documentação usam
identificadores em inglês. Commits e títulos de PR também ficam em inglês. Ver
[ADR 0014](docs/adr/0014-english-code-conventions.md) para a migração dos contratos existentes.

**Commit:**

```
<type>(<scope>): <imperative description in English> (FUN-nn)

type:   feat | fix | refactor | perf | docs | test | chore
scope: sim | protocol | content | server | client | tools | docs | deps
```

A referência `(FUN-nn)` aponta a issue no Linear e é obrigatória, exceto em `chore` e `docs`.
O formato é validado por hook — nas duas pontas, dentro e fora do Claude Code.

Exemplo: `refactor(sim): standardize runtime identifiers in English (FUN-49)`.

**Branch:** use a que o Linear gera para a issue (`funkcaipora/fun-25-...`), que fecha o
vínculo entre commit, PR e issue sem trabalho manual.

**Entrega:** sempre por PR com destino à `main`, usando a branch da issue; sem push direto na
`main`.

**Antes de abrir PR ou fechar uma issue:** `pnpm check` verde, e o `AGENTS.md` do pacote atualizado se alguma
fronteira ou armadilha mudou. Decisão de arquitetura vira ADR; sistema que sai do papel atualiza
`docs/product/`.

---

## Licença e assets

Código sob licença a definir. **O pacote de assets usado no MVP vem do cliente Tibia** e não
é redistribuído neste repositório — ver [ADR 0008](docs/adr/0008-tibia-client-assets-with-indirection.md),
que registra o risco assumido e a indireção por `appearanceId` que mantém a troca barata.
