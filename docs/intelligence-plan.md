# Plano — camada de inteligência e analytics

**Status:** proposta para confirmação — nenhuma das dez decisões pendentes está fechada; cada
uma abaixo tem uma recomendação e vira ADR só depois do "vamos fazer assim".
**Data:** 2026-09-10
**Entrada:** [`intelligence-requirements.md`](./intelligence-requirements.md) — os requisitos
consolidados na descoberta. Este documento segue a ordem que o §23 de lá pede e não repete o
que lá já está decidido.
**Natureza:** instantâneo. Depois de confirmado, o que muda vira ADR (`docs/adr/`) e documento
vivo (`docs/intelligence.md`, a criar na primeira entrega), nunca edição aqui.

---

## 0. Como ler

A descoberta produziu duas listas: o que está confirmado (§10 dos requisitos: TypeScript,
Mastra, monorepo, RAG para conhecimento, dados estruturados para o jogo, ingestão orientada a
eventos com seleção, Docker + Coolify, e nada de simulação automática) e o que está pendente
(§21–§23). Este plano faz três coisas, nesta ordem:

1. **Diz o que o repositório já entrega** e que a camada nova só precisa reaproveitar (§1).
   Metade do que parece decisão nova já foi decidido no jogo — e decidido bem.
2. **Recomenda uma resposta para cada pendência**, na ordem do §23 dos requisitos, com as
   alternativas descartadas e o ADR que a registra (§2).
3. **Transforma isso em fases, issues e critérios de saída** verificáveis, no mesmo formato do
   [`technical-architecture.md`](./technical-architecture.md) §17–§18 (§6).

O critério que desempata toda escolha aqui é o mesmo do
[`infrastructure.md`](./infrastructure.md): **agent friendly** — CLI de verdade, roda local com
fidelidade, verificável do terminal. E uma regra nova, própria desta camada: **a inteligência
nunca entra no caminho do jogo.** Se o processo `intel` cair, sumir ou ficar lento, nenhuma hunt
percebe. Toda decisão abaixo foi medida contra isso.

---

## 1. O que o repositório já entrega

Antes de desenhar, vale listar o que já existe e é exatamente o que a camada analítica precisa —
porque o risco "acoplamento da analytics ao runtime do jogo" (§20 dos requisitos) some quando a
camada nova só **observa** o que o jogo já produz.

| Já existe | Onde | O que a camada nova faz com isso |
|---|---|---|
| **Extrato de sessão** (`Receipt`): motivo de encerramento, `Aggregates`, eventos notáveis | `packages/sim/src/session.ts`; gravado pelo `game` em `receipt:{sessionId}` no Redis (`packages/server/src/receipts.ts`) | É o evento analítico mais importante do jogo, e já é escrito uma vez por sessão, no lugar certo, pela sessão dona. Falta só uma cópia dele sair para um stream. |
| **Agregados escritos onde o fato acontece** (invariante 9): `xpGained`, `goldGained`, `goldSpent`, `kills`, `deaths`, `itemsLooted`, `suppliesUsed`, `bestBasicHit`, `bestSpellHit`, `durationMs` | `Aggregates` em `sim` | Base direta de XP/h, gold/h, mortes, supply. Dano total por vocação **não** existe ainda — ver §4.3. |
| **Eventos notáveis** com vocabulário fechado: `entered-hunt`, `entered-city`, `level-up`, `level-down`, `skill-up`, `death`, `xp-penalty`, `stamina-exhausted`, `supply-unaffordable`, `backpack-full`, `exit-rule`, `difficulty-changed`, `ring-equipped`, `ring-removed`, `advance-truncated`, `ended` | `Session.record()` em `sim` | Vocabulário pronto para "por que a hunt acabou", "quantas vezes faltou gold", "quanto se perdeu por `advance-truncated`" (confiabilidade do idle, ADR 0018). |
| **Ledger append-only** com `UNIQUE (session_id, seq)` | `packages/server/src/db/schema.ts`, ADR 0006 | A verdade de todo valor. A analytics **espelha** o ledger; nunca recalcula gold por evento. |
| **Versão de conteúdo fixada na sessão** (invariante 7): `content.version` | `packages/server/src/main.ts`, `game/sessions.ts` | É a chave natural de "antes e depois de uma mudança de balanceamento": toda sessão já carrega a versão com que rodou. Comparar versões é `GROUP BY content_version`. |
| **Log estruturado** (Pino, JSON, com `role`) e **métricas Prometheus por papel** (`api` 3000, `jobs` 3001, `game` 7171) | `packages/server/src/log.ts`, `game/metrics.ts`, `jobs/metrics.ts` | Log continua log e métrica continua métrica — a camada nova os **consulta** por ferramenta, não os copia. |
| **Contrato de papel** (`Role { name, start, drain }`) e `PROCESSES` | `packages/server/src/role.ts`, `main.ts` | O processo novo segue o mesmo contrato: `start`, `drain` em `SIGTERM`, `/healthz`, `/metrics`. |
| **Redis com `appendonly`** e **Postgres 17** em todos os composes; um cliente Redis por processo | `docker-compose.yml`, `compose.prod.yml`, `compose.coolify.yml` | O broker e o banco analítico cabem no que já está de pé. Nenhum serviço novo além do processo `intel`. |
| **Harness de conhecimento**: `AGENTS.md` raiz com os onze invariantes, um por pacote, 24 ADRs indexados, `docs/product/` vivo, `docs/reference/`, skill `/compliance` | raiz, `docs/`, `.claude/skills/` | É o corpus do *Repository Intelligence*, já curado e com dono. O agente não inventa regra: ele **cita** a que existe. O checklist da `/compliance` vira a rubrica do revisor. |
| **Tarefa E15 já prevista**: "tabela de eventos de telemetria do §40, particionada por dia" | `technical-architecture.md` §12 e §17 | Este plano é a execução dessa tarefa, com a lista do §40 do PRD como ponto de partida do catálogo. |

Duas ausências que o plano precisa criar, e que são mudanças **no jogo**, não na camada nova:

- **Dano por vocação** não é medido: os agregados guardam só o maior golpe. Entra
  `damageDealt`, `damageTaken`, `healingDone` e `spellCasts` (por magia) em `Aggregates` —
  escritos onde o fato acontece, como os demais. Ver §4.3.
- **Tempo de login** não é medido: o `api` não tem histograma de duração por rota. Entra um
  histograma `http_request_duration_seconds{route}` no `api` (padrão Prometheus) e um evento
  `auth.login` com a duração do fluxo inteiro (callback do WorkOS até o cookie).

---

## 2. Decisões — uma recomendação por pendência

Na ordem do §23 dos requisitos. Cada item traz **Recomendação** (no imperativo, como um ADR),
**Por quê**, **Descartado** (uma linha por alternativa) e **Registro** (que ADR a formaliza).
Os números de ADR abaixo são os próximos livres (o último é o 0024) e só valem se as decisões
forem confirmadas nesta ordem.

### 2.1 Contrato dos eventos analíticos

**Recomendação.** Um envelope único, versionado por evento, validado por Zod, num pacote puro
novo — `packages/telemetry` (§2.6). Cada evento é um **fato de domínio no passado**
(`session.ended`, `auth.login`), com sujeito (`accountId` / `characterId` / `sessionId`),
`contentVersion`, o processo que o observou e um **id idempotente**. Nada é emitido por tick:
o evento sai no fim do fato, com o agregado que a sessão já escreveu.

```ts
// packages/telemetry/src/envelope.ts (a criar)
export interface TelemetryEnvelope<TName extends string, TPayload> {
  /** Chave de idempotência. Determinística quando o fato tem identidade própria
   *  (`session.ended` → o próprio `sessionId`); ULID quando não tem (`auth.login`). */
  readonly id: string;
  /** `<domínio>.<fato>`, no passado. Só nomes do catálogo passam. */
  readonly name: TName;
  /** Versão do PAYLOAD. Mudança incompatível é versão nova; o consumidor aceita as duas. */
  readonly version: number;
  /** Relógio de parede do processo que OBSERVOU o fato — nunca o relógio lógico da sessão. */
  readonly occurredAtMs: number;
  readonly producer: { readonly process: 'api' | 'game' | 'jobs'; readonly nodeId: string; readonly build: string };
  /** A versão fixada na sessão (invariante 7). É a chave do "antes × depois". */
  readonly contentVersion: string;
  readonly subject: { readonly accountId?: string; readonly characterId?: string; readonly sessionId?: string };
  readonly payload: TPayload;
}
```

O catálogo é um objeto por evento, e `emit()` só aceita o que está nele:

```ts
// packages/telemetry/src/catalog.ts (a criar)
export const sessionEnded = defineEvent('session.ended', 1, z.object({
  type: z.enum(['hunt', 'training', 'quest', 'boss', 'guild-war']),
  huntId: z.string().optional(),
  difficulty: z.string().optional(),
  vocationId: z.string().nullable(),
  levelStart: z.number().int(),
  levelEnd: z.number().int(),
  reason: z.enum(['manual-exit', 'exit-rule', 'death', 'drain', 'completed']),
  aggregates: aggregatesSchema,          // espelha `Aggregates` do sim, declarado aqui
  notableEvents: z.array(z.object({ atMs: z.number(), type: z.string(), detail: z.string().optional() })),
}), { id: (event) => event.subject.sessionId });
```

`telemetry` **não importa `sim`**: os schemas espelham os tipos e o `game` faz o mapeamento na
fronteira. É o que permite mudar `Aggregates` sem mudar o contrato de rede por acidente — a
divergência aparece como erro de tipo no `game`, não como evento silenciosamente diferente.

**Regra de seleção** (§4.3 dos requisitos — "nem todo evento/log vai para analytics"):

1. Só entra no stream o que está no catálogo. Nome fora do catálogo é erro de tipo.
2. O catálogo só aceita fato com **sujeito** e **consequência** em um dos quatro eixos do §40
   do PRD: economia, progressão, confiabilidade do idle, abuso. Diagnóstico (erro, latência
   interna, stack) é log Pino, e **log nunca vai ao stream**.
3. Evento por **sessão ou por transação**, nunca por golpe, passo ou tick. O invariante 2 vale
   para a telemetria também: agregado escrito onde o fato acontece, emitido no fim.
4. `sampleRate` por nome para o que é frequente (`viewer.attached`), declarado no catálogo.
5. **Sem PII.** Ids, nunca e-mail ou nome. O que identifica pessoa fica no banco operacional.

**Por quê.** Catálogo tipado é a única forma de "seleção" que não depende de alguém lembrar; e
o id idempotente é o mesmo mecanismo do ledger (`retry nunca duplica`) aplicado ao pipeline
inteiro — sem ele, "entrega pelo menos uma vez" vira contagem dobrada no primeiro retry.

**Descartado.** *Mandar os logs Pino para o pipeline e filtrar depois* — mistura diagnóstico
com fato, e a filtragem vira regex sobre texto. *Evento por tick / por golpe* — viola o
invariante 2 na prática e multiplica o volume por mil sem pergunta que precise disso.
*Protobuf/Avro* — o codec do jogo é próprio e binário porque está no caminho quente; aqui
JSON validado basta e é legível no `redis-cli`.

**Registro.** ADR 0025 — *Eventos de telemetria: contrato, catálogo e transporte* (junto com
§2.2).

### 2.2 Mecanismo de mensageria

**Recomendação.** **Redis Streams**, no Redis que já existe: um stream `telemetry:events`
com `XADD ... MAXLEN ~ 1000000`, um consumer group `intel`, reclaim de entradas pendentes com
`XAUTOCLAIM` e um stream `telemetry:dead` para o que falhar cinco vezes. O `game` emite
`session.ended` **no mesmo `MULTI` em que grava o extrato** (`#saveReceipt` em
`packages/server/src/game/host.ts`), então extrato e evento nascem juntos ou não nascem. `api`
e `jobs` emitem depois do commit, sem esperar resposta.

Para **valor** (gold, Coins, itens) a fonte não é evento: o processo `intel` espelha a tabela
`ledger` por varredura incremental (`created_at > marca − 5 min`, `ON CONFLICT DO NOTHING`),
com um papel de banco **somente leitura** e `statement_timeout` de 2 s. É a única leitura que a
camada faz no banco operacional, e é a única forma de "retry nunca duplica" continuar sendo
propriedade do ledger, não do pipeline.

**Por quê.** Zero infraestrutura nova, e o `game` já fala com o Redis e continua sem banco.
Streams têm persistência (`appendonly` já ligado), ordem por stream, consumer group com
confirmação por entrada e reclaim — o suficiente para "pelo menos uma vez", que com id
idempotente vira "exatamente uma vez" no armazenamento. Volume é pequeno: no cenário de
referência (5.000 hunts de pé) o fim de sessão produz ordem de um evento por segundo.

**Descartado.** *Kafka / NATS / RabbitMQ* — um serviço a mais para operar num deploy que hoje
é quatro containers, sem volume que justifique. *Outbox transacional no Postgres* — o `game`
não tem banco, e é ele o produtor que importa. *HTTP push do jogo para o `intel`* — acopla o
jogo à disponibilidade da camada nova, que é o risco que o plano existe para evitar.
*Lista Redis (`LPUSH`/`BRPOP`)* — sem consumer group nem reclaim; entrada tirada por um
consumidor que morre some.

**Registro.** ADR 0025.

### 2.3 Armazenamento analítico

**Recomendação.** **Postgres, banco separado `draconya_intel` na mesma instância**, com
migrações próprias (Drizzle, em `packages/intelligence/migrations/`). Dentro dele, schema
`analytics`: `events` particionada por dia, `sessions` (tabela-fato de hunt, uma linha por
sessão), `ledger_entries` (espelho), `content_versions`, e **modelos de leitura** materializados
por hora (§5). Retenção: eventos crus 90 dias (drop de partição), agregados sem prazo, traces
de agente 30 dias.

A imagem do Postgres muda de `postgres:17-alpine` para **`pgvector/pgvector:pg17`** (mesmo
Postgres 17, com a extensão `vector`; publica `amd64` e `arm64`, o que o ADR 0013 exige) — nos
três composes e nos serviços do CI. Volume existente não muda de formato.

**Por quê.** Banco separado e não schema, porque dá papel de conexão próprio (`intel_ro`,
`intel_rw`), backup e retenção independentes, e sair para outra instância é um `pg_dump`.
Mesma instância e não Supabase, porque o deploy é Coolify com Postgres interno sem porta
publicada — subir um segundo fornecedor para um banco de dezenas de MB é custo sem retorno.
Postgres e não ClickHouse, porque as perguntas são `GROUP BY` sobre milhares de linhas por
dia, não bilhões; o **gatilho** para revisitar é eventos acima de ~50 milhões por mês ou
consulta de rollup acima de segundos — registrado no ADR, como o ADR 0015 registra gatilhos.

**Descartado.** *Schema `analytics` no banco `draconya`* — acopla migração da camada nova ao
ORM do jogo e mistura papéis de conexão. *Supabase* — reabre a discussão do
`infrastructure.md` para um banco que não precisa de nada gerenciado. *ClickHouse / Timescale /
DuckDB sobre R2* — certos em outra ordem de grandeza; gatilho explícito acima. *Só métricas
Prometheus* — sem cardinalidade por personagem ou sessão de propósito (FUN-47), então não
responde "qual vocação".

**Registro.** ADR 0026 — *Armazenamento analítico e vetorial no Postgres* (junto com §2.4);
emenda ao ADR 0022 pela imagem do Postgres.

### 2.4 Estratégia de RAG e vector store

**Recomendação.** **pgvector** no mesmo banco `draconya_intel`, via `PgVector` de
`@mastra/pg`; dois índices, `repo_docs` (markdown: `docs/`, `AGENTS.md`, ADRs, skills) e
`repo_code` (`packages/*/src`, sem testes por padrão). **Embeddings da Voyage AI**
(`@ai-sdk/voyage`, provider oficial do AI SDK): `voyage-4` para prosa (multilíngue — a
documentação é em português) e o modelo de código mais recente exposto pelo provider
(`voyage-code-3.5` hoje) para TypeScript, com `inputType: 'document'` ao indexar e `'query'`
ao buscar.

Chunking: markdown por **caminho de títulos** (`docs/adr/0009 › Decisão`), com o título
completo repetido no texto do chunk; TypeScript por **declaração de topo** (função, classe,
interface, `export const`) usando a API do compilador `typescript` que já está no repositório —
sem dependência nova. Cada chunk guarda `{ path, kind, sha, startLine, endLine, headingPath,
contentHash }`; reindexar é diff por hash, não reembedding do repositório inteiro.

Indexação **a partir de um SHA do git**, nunca do disco do container (a imagem de runtime não
tem `src`): o processo `intel` baixa a árvore pela API do GitHub com token somente leitura e
guarda também o texto integral dos arquivos indexados (`repo_files`) — é o que `read_file`
lê. O gatilho é o job de deploy do CI, que já fala com o Coolify: depois de publicar, ele faz
`POST /intel/index { sha }`. Recuperação híbrida: vetor + `tsvector` (busca por identificador
exato, que embedding erra), fundidos por *reciprocal rank fusion*; rerank por
`claude-haiku-4-5` opcional e medido.

O que **não** vai para retrieval: os onze invariantes e o `AGENTS.md` raiz entram **inteiros
no prompt do agente**, como prefixo estável (cache de prompt). Retrieval é para o que não cabe
sempre; o norte cabe.

**Por quê.** Um banco só, uma ferramenta de backup só, e o Mastra já tem o adaptador. Voyage é
o provedor de embeddings que a Anthropic recomenda para uso com Claude, tem modelo de código
dedicado, e fica atrás do AI SDK — trocar é uma linha e um reindex. Chunk por símbolo e por
título é o que faz a citação `path:line` ser possível na resposta.

**Descartado.** *Embeddings locais (`@huggingface/transformers`)* — sem fornecedor, mas
dependência nativa/WASM nova (ADR 0013), CPU no container do `intel` e qualidade menor em
código; fica como rota de fuga se custo ou privacidade pedirem. *Qdrant / Pinecone /
Chroma* — serviço a mais para dezenas de milhares de vetores. *Indexar do disco do
container* — a imagem não tem fonte, e ter seria copiar o repositório para produção. *Só busca
léxica* — não responde "por que a hunt não usa pathfinding" quando a palavra é "rota fixa".

**Registro.** ADR 0026 (store) e ADR 0027 (provedores, §2.5).

### 2.5 Provider e modelo de IA

**Recomendação.** **Anthropic**, via o roteador de modelos do Mastra (`model:
'anthropic/claude-opus-5'`), com *fallback* declarado para `anthropic/claude-sonnet-5`.
Por agente:

| Agente | Modelo | `effort` | Por quê |
|---|---|---|---|
| `reviewer` (code review contextual) | `claude-opus-5` | `high` | É onde errar custa: falso negativo sobre invariante é o bug que a `/compliance` existe para pegar. |
| `repository` (perguntas sobre código/docs) | `claude-opus-5` | `medium` | Resposta citada sobre contexto recuperado; `medium` já basta e corta custo. |
| `analyst` (perguntas analíticas com ferramentas) | `claude-opus-5` | `medium` | Chamadas de ferramenta em sequência; consolidação de resultado numérico. |
| rerank, classificação, *scorers* | `claude-haiku-4-5` / `claude-sonnet-5` | `low` | Tarefas curtas e frequentes. |

Thinking adaptativo fica ligado (é o padrão do `claude-opus-5`); o que se ajusta é `effort`
por agente, via `providerOptions.anthropic`. Chave só no container do `intel`
(`ANTHROPIC_API_KEY`); o jogo nunca a vê.

**Por quê.** O harness deste repositório já é construído em cima do Claude Code — um
fornecedor para o assistente de código e para os agentes do produto é uma conta, uma chave,
um vocabulário de prompt. O roteador do Mastra já conhece esses ids (verificado na
documentação do provider), então a escolha fica atrás de uma string.

**Descartado.** *Provedor "neutro" com abstração própria* — o Mastra já é a abstração; uma
segunda por cima é código sem função. *Modelo local (Ollama)* — sem capacidade para revisão
com contexto de dezenas de arquivos, e sem GPU no destino de deploy. *`claude-fable-5-1` como
padrão* — capacidade acima do que a tarefa pede, a preço acima; fica disponível por
configuração para o revisor se a medição pedir.

**Registro.** ADR 0027 — *Mastra, Anthropic e Voyage na camada de inteligência* (emenda ao
ADR 0011: as bibliotecas novas são permitidas **só** em `packages/intelligence`).

### 2.6 Nome, localização e fronteiras dos pacotes

**Recomendação.** Dois pacotes, pela mesma razão que `protocol` existe separado de `server`:

| Pacote | Propósito | Pode importar | Não pode importar |
|---|---|---|---|
| `packages/telemetry` (`@draconya/telemetry`) | O contrato dos eventos analíticos: envelope, catálogo, schemas Zod, versões. **Puro** — sem I/O, sem Mastra, sem Redis. | nada interno | tudo, inclusive `node:*` (mesma lista do `sim`) |
| `packages/intelligence` (`@draconya/intelligence`) | O processo `intel`: consumidor do stream, espelho do ledger, indexador, agentes Mastra e ferramentas, HTTP e MCP. | `telemetry`, `content` (nomes e versão de conteúdo), `protocol` (tipos, se precisar) | `sim`, `server`, `client`, `tools` |

E duas linhas novas na tabela existente de [`boundaries.md`](./boundaries.md):

| Pacote | Passa a poder importar | Continua não podendo |
|---|---|---|
| `server` | `telemetry` (para emitir) | `intelligence` |
| `client` | — | `telemetry`, `intelligence` (o navegador nunca vê o catálogo) |
| `tools` | `telemetry`, `intelligence` (gerador de eventos sintéticos, avaliações) | — |

`sim` **não** importa `telemetry`: ele já expõe `Receipt`, `Aggregates` e `NotableEvent`, e é
o `game` quem mapeia isso para o catálogo. O núcleo continua sem saber que existe analytics.

O processo `intel` tem **entrada própria** (`packages/intelligence/src/main.ts`) e **imagem
própria** (alvo `intelligence` no mesmo `Dockerfile`, a partir do mesmo estágio `deps`), não um
quarto valor de `PROCESSES` no `server`. Mastra e AI SDK pesam, e não há por que a imagem do
`game` — o caminho quente — carregá-los. O papel novo implementa o mesmo contrato `Role`
(`start`, `drain`), `/healthz` e `/metrics` em `INTEL_PORT` (3002).

**Por quê.** Emissor e consumidor precisam do mesmo contrato sem que `server` importe Mastra
nem `intelligence` importe `server` — a única forma é o contrato viver num pacote que os dois
podem importar e que não importa ninguém. É o desenho de `protocol`. E `intelligence` não
importar `server` é o que garante, por lint, que a camada nunca toca o runtime do jogo.

**Descartado.** *Tudo em `packages/intelligence`, com `server` importando um subcaminho puro*
— funciona, mas a regra de fronteira vira exceção por caminho, e o lint de `no-restricted-imports`
casa por nome de pacote. *Contrato em `protocol`* — `protocol` é o contrato com o navegador, e
o cliente não pode nem saber do catálogo (invariante 4 por outra porta). *Quarto papel dentro de
`server`* — coloca Mastra na imagem do `game`.

**Registro.** ADR 0028 — *Pacotes `telemetry` e `intelligence` e o processo `intel`*. Os dois
pacotes nascem pela skill `/module`, com `AGENTS.md` preenchido, e a tabela de `boundaries.md`
e o `eslint.config.ts` mudam no mesmo commit.

### 2.7 Tools disponíveis aos agentes

Toda ferramenta é **somente leitura**. A única escrita que a camada faz — comentar numa PR — é
feita pelo job de CI com o token do GitHub Actions, nunca pelo agente.

**Repository Intelligence** (agentes `repository` e `reviewer`):

| Tool | O que faz | Guarda |
|---|---|---|
| `search_repository({ query, kind?, pathPrefix?, topK })` | Busca híbrida em `repo_docs` + `repo_code`; devolve chunks com `path`, linhas e `sha`. | `topK ≤ 20`; `kind ∈ {adr, product, docs, agents, skill, code}`. |
| `read_file({ path, startLine?, endLine? })` | Texto de `repo_files` no SHA indexado. | teto de 400 linhas por chamada. |
| `list_adrs()` / `get_invariants()` | O índice de ADRs e os onze invariantes, do índice, não de memória. | — |
| `fetch_pr_diff({ number })` | Diff unificado da PR pela API do GitHub (token somente leitura). | só o repositório configurado. |
| `review_diff({ diff, base })` | Para cada arquivo tocado, recupera `AGENTS.md` do pacote, ADRs e `docs/product/` relevantes, aplica a rubrica da [`/compliance`](../.claude/skills/compliance/SKILL.md) e devolve achados estruturados `{ file, line, invariant?, severity, rationale, citation }`. | nunca executa código; o diff é **dado**, não instrução. |

**Game Intelligence** (agente `analyst`):

| Tool | O que faz | Guarda |
|---|---|---|
| `describe_metrics()` | O dicionário de dados: cada modelo de leitura com grão, colunas, unidade e ressalvas. É o que impede o agente de inventar coluna. | — |
| `query_metric({ metric, filters, range, groupBy })` | Consulta **parametrizada** sobre um modelo de leitura. Sem SQL livre. | `range ≤ 90 dias`; `LIMIT 1000`. |
| `compare_content_versions({ metric, a, b, splitBy })` | O "antes × depois": o mesmo `metric` em duas versões de conteúdo, com intervalo de confiança simples e contagem de sessões por lado. | recusa se um lado tiver menos de N sessões (configurável). |
| `list_content_versions()` | Versões vistas, primeira sessão de cada uma, SHA quando conhecido. | — |
| `get_content({ kind, id, version? })` | O JSON de `content` (monstro, hunt, magia, supply) na versão pedida, do índice do repositório. | — |
| `query_prometheus({ query, range, step })` | PromQL contra o Prometheus (tick lag, reanexação, `http_request_duration_seconds`). | `range ≤ 7 dias`; `step` mínimo. |
| `query_logs({ query, range })` | LogQL contra o Loki, **quando o Grafana Cloud existir** (`infrastructure.md`). Até lá a tool não é registrada. | `range ≤ 24 h`; `limit 500`. |
| `run_sql_readonly({ sql })` | SQL livre para o perfil **operador** só: papel `intel_ro`, `default_transaction_read_only`, `statement_timeout 5 s`, schema `analytics` apenas, `LIMIT` imposto. | fora do perfil operador a tool não existe. |

**Por quê.** Ferramenta parametrizada antes de SQL livre é o que fecha "consultas
potencialmente caras" e "acesso indevido" (§20) por construção, não por prompt. E
`describe_metrics` é a diferença entre um agente que consulta e um que alucina nome de coluna.

**Registro.** Não é decisão de arquitetura; é escopo. Entra na spec das issues (§6), e o
inventário vivo fica em `docs/intelligence.md`.

### 2.8 Autenticação e permissões

**Recomendação.** Três perfis, e nenhum vendor novo:

| Perfil | Quem | O que alcança |
|---|---|---|
| `operator` | o dono do projeto (hoje, uma pessoa) | tudo: produção, staging, `run_sql_readonly`, Studio em staging |
| `developer` | quem desenvolve | `repository`, `reviewer`, `analyst` **em staging**; sem produção |
| `service` | CI e clientes MCP (Claude Code, Cursor) | `review_diff`, `ask_repository`; token com escopo |

Autenticação por **provedor customizado do Mastra** (`server.auth`) com duas entradas: a
**sessão HTTP do Draconya** (cookie validado em `auth:session:*` no Redis, o mesmo caminho de
`GET /api/auth/me`) com uma lista de contas por perfil em variável de ambiente; e **tokens de
serviço** (hash em variável de ambiente, um por cliente, revogáveis). Produção e staging são
**deploys separados** do `intel`, cada um só enxergando o próprio banco — o agente não tem
como cruzar os dois porque não há conexão que cruze.

**Por quê.** Reusar a sessão que o ADR 0017 já define evita segundo login e segunda lista de
usuários; tokens de serviço são o que um job de CI consegue guardar. A segregação por deploy é
mais simples e mais forte que qualquer autorização por linha.

**Descartado.** *JWT próprio* — mais um segredo e um ciclo de rotação para o mesmo resultado.
*Auth do Mastra com Supabase/Auth0* — fornecedor novo para um usuário. *Um `intel` para os dois
ambientes com filtro por linha* — é exatamente o filtro que um prompt malicioso tenta
contornar.

**Registro.** ADR 0029 — *Acesso à camada de inteligência: perfis, sessão reaproveitada e
tokens de serviço*.

### 2.9 Observabilidade

**Recomendação.** As mesmas duas camadas do jogo, mais uma:

- **Log**: `@mastra/loggers` com Pino, mesmo formato e `role: 'intel'`. Sem transport bonito,
  como em `packages/server/src/log.ts`.
- **Métricas Prometheus** em `/metrics` (3002), sem autenticação, escondido pela rede — como
  os outros três. Nomes no padrão `draconya_intel_*`:

  | Métrica | Forma | Por quê |
  |---|---|---|
  | `events_consumed_total{name}` / `events_failed_total{name}` | counters | volume e falha por tipo de evento |
  | `stream_pending` | gauge | entradas não confirmadas no group — é o *lag* |
  | `consumer_last_success_timestamp_seconds` | gauge | o alerta é "não consome há N minutos", como no `jobs` (FUN-59) |
  | `ledger_sweep_rows_total`, `ledger_sweep_last_success_timestamp_seconds` | counter, gauge | o espelho parado é a economia sumindo do painel |
  | `index_last_sha_info{sha}`, `index_chunks{index}`, `index_stale` | gauges | índice atrás da `main` é resposta errada com cara de certa |
  | `agent_runs_total{agent,outcome}`, `agent_duration_seconds{agent}` | counter, histograma | **histograma, nunca média** — a cauda é o que estoura o prazo |
  | `llm_tokens_total{agent,model,kind}`, `llm_cost_usd_total{agent,model}` | counters | custo por agente, para o orçamento (§8) |
  | `tool_calls_total{tool,outcome}`, `tool_duration_seconds{tool}` | counter, histograma | qual ferramenta falha e qual demora |

- **Traces de agente**: `Observability` do Mastra com `MastraStorageExporter` (no
  `draconya_intel`, 30 dias) e `SensitiveDataFilter`; exportador OTel para o Grafana Cloud
  quando ele existir. Todo *run* fica com quem perguntou, que ferramentas chamou, com que
  argumentos, e quanto custou — é a trilha de auditoria da camada.
- **Qualidade**: *scorers* do `@mastra/evals` por amostragem em produção (relevância e
  fidelidade em 20% das respostas, com `claude-haiku-4-5`) e o conjunto dourado de §7 rodando
  por comando. Score cai abaixo do piso → issue, não alerta.

**Registro.** Sem ADR; segue o padrão já registrado (FUN-47, FUN-59).

### 2.10 Deploy

**Recomendação.** Um container a mais, `intel`, nos três composes; a imagem é o alvo
`intelligence` do mesmo `Dockerfile`, instalada com `pnpm install --filter
@draconya/intelligence...` para não arrastar `pixi` nem `uWebSockets.js`. Migrações do
`draconya_intel` antes do boot, como o `app` faz. `stop_grace_period` de 40 s: o `drain`
confirma o que já processou e para de ler o stream. Recursos iniciais: 0,5 vCPU e 1 GB.

| Peça | Mudança |
|---|---|
| `Dockerfile` | estágio `intelligence` (runtime `node:24-trixie-slim`, `USER node`, `EXPOSE 3002`) |
| `docker-compose.yml`, `compose.prod.yml`, `compose.coolify.yml` | serviço `intel`; Postgres → `pgvector/pgvector:pg17`; `deploy/postgres/init-intel.sql` cria `draconya_intel` e os papéis (só roda em volume novo — volume existente recebe o SQL à mão, e o `deploy.md` diz como) |
| `deploy/nginx.conf` | `location /intel/ { proxy_pass http://intel:3002; }`, ao lado de `/api/` e `/ws` |
| `.github/workflows/ci.yml` | job `image` constrói e sobe também o alvo `intelligence` e bate em `/healthz`; job `deploy staging` sincroniza `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `INTEL_*` e, ao final, faz `POST /intel/index { sha }` |
| Variáveis | `INTEL_DATABASE_URL`, `INTEL_READER_DATABASE_URL` (papel `intel_reader` no banco do jogo), `INTEL_PORT`, `INTEL_TOKENS`, `INTEL_OPERATOR_ACCOUNTS`, `INTEL_DAILY_BUDGET_USD`, `GITHUB_READ_TOKEN`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` — todas validadas por Zod no boot, como `loadConfiguration` faz |
| Ambientes | staging primeiro, como o jogo; produção só depois do critério de saída da fase I2 (§6) |

Studio do Mastra (`mastra dev`) só em desenvolvimento e, atrás do perfil `operator`, em
staging. Em produção a superfície é HTTP + MCP.

**Registro.** ADR 0028 (processo) e emenda ao ADR 0022 (topologia).

---

## 3. A arquitetura que resulta

```
   processo game                     processo api                 processo jobs
   SessionHost.#saveReceipt          auth.login, ticket.issued    ledger (varredura)
   MULTI { receipt:{id} ; XADD }     XADD (após a resposta)               │
          │                                  │                            │ (nenhum evento:
          └──────────────┬───────────────────┘                            │  o ledger É a fonte)
                         ▼                                                │
              Redis Stream `telemetry:events`  (MAXLEN ~1M, group `intel`)│
                         │ XREADGROUP · XAUTOCLAIM · `telemetry:dead`     │
   ┌─────────────────────▼─────────────── processo intel (3002) ──────────▼──────────────┐
   │ consumer ──► analytics.events (partição/dia) ──► sessions, content_versions         │
   │ ledger sweep (intel_reader, somente leitura, 2 s) ──► analytics.ledger_entries      │
   │ rollups por hora ──► hunt_hourly · damage_by_vocation · economy_daily · login_daily │
   │ indexer (árvore @ sha via GitHub) ──► repo_files · PgVector repo_docs / repo_code   │
   │ Mastra: agents repository · reviewer · analyst  +  tools (§2.7)  +  scorers        │
   │ Fastify + MastraServer: /intel/*  ·  MCP em /intel/mcp  ·  /healthz  ·  /metrics    │
   └───────────────┬──────────────────────────────┬─────────────────────────────────────┘
                   ▼                              ▼
   Postgres `draconya_intel` (pgvector)      Anthropic (Claude)  ·  Voyage (embeddings)

   quem usa: Claude Code / Cursor (MCP) · CI (review de PR) · operador (HTTP, Studio em staging)
```

O que **não** está no desenho, de propósito: nenhuma seta do `intel` para o `game`, nenhuma
para o navegador, e nenhuma escrita fora do `draconya_intel`.

---

## 4. Catálogo de eventos v1

Derivado da lista do §40 do PRD e do que o jogo já produz. `Produtor` diz quem emite;
`Fase` diz quando existe (o que depende de sistema ainda não implementado entra no catálogo
com o nome reservado e sem produtor, para o nome não ser inventado ad hoc depois).

### 4.1 Já produzível hoje

| Evento | Produtor | Payload (além do envelope) | Idempotência |
|---|---|---|---|
| `session.started` | `game` | `type`, `huntId`, `difficulty`, `vocationId`, `level`, `resumed` | `sessionId` |
| `session.ended` | `game`, no `MULTI` do extrato | `reason`, `aggregates`, `notableEvents`, `levelStart`, `levelEnd`, `staminaMs` | `sessionId` |
| `session.resumed` | `game` | `skippedMs` (o intervalo NÃO simulado, ADR 0018), `nodeId` de origem | `sessionId + logicalNowMs` |
| `viewer.attached` / `viewer.detached` | `game` | `reattachMs`, `attachedMs` acumulado | ULID; `sampleRate` configurável |
| `bot-config.saved` | `game` | contagem de regras por categoria, `vocabularyVersion` | ULID |
| `auth.login` | `api` | `durationMs` (callback → cookie), `provider`, `outcome`, `devMode` | ULID |
| `ticket.issued` | `api` | `durationMs`, `settledReceipts`, `nodeId` | `ticketId` |
| `character.created` / `character.deleted` | `api` | `vocationId` (nulo ao nascer) | `characterId + fato` |
| `loot-box.claimed` | `api`/`game` (quem resgatar) | `items` (ids de catálogo e quantidades) | `sessionId` |

Os eventos notáveis da sessão (`death`, `level-up`, `stamina-exhausted`, `supply-unaffordable`,
`exit-rule`, `backpack-full`, `advance-truncated`…) viajam **dentro** de `session.ended`, com
`atMs` relativo ao relógio lógico. Uma linha por evento notável é derivada no consumidor
(`analytics.session_events`), não emitida — a sessão continua produzindo um fato só.

### 4.2 Reservados (sistema ainda não existe)

`party.created` / `party.started` / `party.abandoned` (E9), `boss.started` / `boss.completed` /
`boss.rewarded` (E11), `prey.rolled` / `prey.rerolled`, `bestiary.milestone` (E7),
`market.listed` / `market.bought` / `market.cancelled`, `coins.transferred`, `coins.purchased`,
`premium.activated` / `premium.expired` (E13), `guild-war.started` / `guild-war.ended` /
`guild-war.throne-captured` (E12), `autosell.sold` (E5), `loot-box.expired` — este último só
quando alguém observar a expiração; hoje quem expira é o TTL e ninguém olha (FUN-88), então
o número honesto é `boxed − claimed`, derivado.

### 4.3 O que muda no `sim` para responder "dano por vocação"

`Aggregates` ganha `damageDealt`, `damageTaken`, `healingDone` e `spellCasts: Record<spellId,
number>`, escritos onde o fato acontece — no golpe resolvido, no dano sofrido, na cura, no
lançamento — pela sessão dona (invariante 9). São contadores de **uso**, como as skills
(FUN-75): a 1 Hz e a 10 Hz acontecem os mesmos golpes nos mesmos instantes lógicos, então o
teste de equivalência entre taxas cobre os campos novos sem exceção. Os campos são opcionais
no protocolo pela mesma razão dos demais (deploy em rolagem, FUN-78), e
[`product/analyzer.md`](./product/analyzer.md) é atualizado. Vocação e level vêm do
`CharacterRuntime` (`vocationId`), que o `game` já tem.

---

## 5. Modelo analítico

Schema `analytics` no banco `draconya_intel`:

```sql
create table analytics.events (
  id               text        not null,
  name             text        not null,
  version          smallint    not null,
  occurred_at      timestamptz not null,
  received_at      timestamptz not null default now(),
  process          text        not null,
  node_id          text        not null,
  build            text,
  content_version  text        not null,
  account_id       text,
  character_id     text,
  session_id       text,
  payload          jsonb       not null,
  primary key (id, occurred_at)          -- partição exige a chave no PK; `occurred_at` é
) partition by range (occurred_at);      -- estável no replay, então o replay colide e não aplica
-- índices: (name, occurred_at), (character_id, occurred_at), (content_version, name)
```

| Tabela | Grão | Alimentada por | Para que pergunta |
|---|---|---|---|
| `sessions` | uma linha por sessão: tipo, hunt, dificuldade, vocação, level início/fim, versão de conteúdo, início, fim, motivo, e todos os agregados | `session.started` + `session.ended` (upsert) | XP/h, gold/h, mortes, supply, duração, motivo de saída — por vocação, hunt, dificuldade, versão |
| `session_events` | um evento notável por linha, com `at_ms` | derivado de `session.ended` | "quantas hunts acabaram por `exit-rule`", "quanto tempo até `stamina-exhausted`" |
| `ledger_entries` | espelho de `ledger` | varredura incremental | economia: entradas e saídas por tipo, por dia, por personagem |
| `content_versions` | uma por versão vista | consumidor, na primeira ocorrência; SHA pelo indexador | o "antes × depois" |
| `logins` | um por `auth.login` / `ticket.issued` | consumidor | tempo de login p50/p95, taxa de falha |
| `hunt_hourly` (view materializada) | hora × hunt × dificuldade × vocação × versão | refresh por hora | a pergunta padrão do balanceamento |
| `damage_by_vocation` (view materializada) | versão × vocação × faixa de level | refresh por hora | dano/h, maior golpe p50/p90, magias mais usadas |
| `economy_daily` (view materializada) | dia × tipo de lançamento | refresh por hora | gold criado, gold destruído, saldo |
| `login_daily` (view materializada) | dia | refresh por hora | p50/p95 de login |
| `items_sold_daily` (reservada) | dia × item | `market.*` (E13) | itens mais vendidos |

Retenção: partições de `events` com mais de 90 dias são derrubadas por um job diário do
próprio `intel`; `sessions`, `ledger_entries` e as views ficam. O dicionário de dados que
`describe_metrics` devolve é **código** (`packages/intelligence/src/store/dictionary.ts`), ao
lado do schema, para não divergir dele.

---

## 6. Fases, issues e critérios de saída

Tamanhos como no `technical-architecture.md` §17: **P** ≤ 1 dia · **M** 2–4 dias · **G** ≥ 1
semana. Proposta de rótulo no Linear: `E16 · Inteligência e analytics`; marcos `I0`–`I4`
numerados à parte dos `M` do jogo, porque a trilha é paralela e não bloqueia nenhuma fase de
lá. Cada issue nasce pela `/spec` antes de ser executada.

### I0 — Decisões e fundação

Não escreve funcionalidade; escreve o que permite escrevê-la sem discutir de novo.

| Tam. | Issue | Pacote / lugar |
|---|---|---|
| P | ADR 0025 — eventos de telemetria: contrato, catálogo, Redis Streams | `docs/adr/` |
| P | ADR 0026 — armazenamento analítico e vetorial no Postgres (`draconya_intel`, pgvector); emenda ao ADR 0022 | `docs/adr/` |
| P | ADR 0027 — Mastra, Anthropic e Voyage; emenda ao ADR 0011 | `docs/adr/` |
| P | ADR 0028 — pacotes `telemetry` e `intelligence`, processo `intel` | `docs/adr/` |
| P | ADR 0029 — perfis, sessão reaproveitada e tokens de serviço | `docs/adr/` |
| M | `/module` `telemetry`: pacote puro, `AGENTS.md`, fronteiras no `eslint.config.ts` e em `boundaries.md`, referência no `tsconfig.json` raiz, alias no `vitest.config.ts`, `COPY` no `Dockerfile` | `packages/telemetry` |
| M | `/module` `intelligence`: pacote, `AGENTS.md`, `main.ts` com `Role`, `config.ts` (Zod), `/healthz`, `/metrics`, alvo `intelligence` no `Dockerfile`, serviço `intel` nos três composes, boot no job `image` do CI | `packages/intelligence`, infra |
| P | Postgres → `pgvector/pgvector:pg17` nos composes e no CI; `deploy/postgres/init-intel.sql`; nota em `deploy.md` para volume existente | infra, `docs/deploy.md` |
| P | `nginx.conf` com `/intel/`; variáveis novas em `scripts/deploy-staging.ts` e no `.env.example`; token de serviço desde o primeiro deploy | infra |

**Pronto quando:** `pnpm check` verde com os dois pacotes vazios; `docker compose up` sobe o
`intel` e `/healthz` responde; o CI constrói e boota a imagem nova; os cinco ADRs estão no
índice.

### I1 — Telemetria: do fato ao armazenamento

| Tam. | Issue | Pacote |
|---|---|---|
| M | Envelope, `defineEvent`, catálogo v1 (§4.1) com schema e *fixture* por evento; teste estrutural: todo nome do catálogo tem schema, exemplo válido e id idempotente | `telemetry` |
| M | `TelemetryStream` no `server` (`XADD MAXLEN ~`), injetado estreito como `ReceiptStore`; `session.started` / `session.ended` / `session.resumed` / `viewer.*` emitidos pelo `SessionHost`, o `ended` no `MULTI` do extrato; teste: uma sessão emite `ended` uma vez, e o retry da drenagem não emite de novo | `server` |
| M | `auth.login`, `ticket.issued`, `character.*` no `api`; `bot-config.saved` no `game`; histograma `http_request_duration_seconds{route}` no `api` | `server` |
| M | `Aggregates` + `damageDealt`, `damageTaken`, `healingDone`, `spellCasts` (§4.3); campos opcionais em `protocol`; teste de equivalência 1 Hz / 10 Hz cobrindo os novos; `product/analyzer.md` | `sim`, `protocol`, `docs` |
| G | Consumidor: `XREADGROUP` no group `intel`, `XAUTOCLAIM` após 60 s, dead-letter na quinta entrega, inserção idempotente, criação de partição do dia; schema e migrações (`events`, `sessions`, `session_events`, `content_versions`, `logins`); métricas de §2.9; testes com Redis e Postgres reais (o CI já tem os dois) — inclusive "o mesmo evento entregue três vezes vira uma linha" e "consumidor morto no meio: a entrada é reclamada e aplicada uma vez" | `intelligence` |
| M | Varredura do ledger com papel `intel_reader` (`statement_timeout 2 s`, janela de sobreposição de 5 min, `ON CONFLICT DO NOTHING`); criação do papel na migração do jogo; teste: reexecutar a varredura não muda nada | `intelligence`, `server/migrations` |
| M | Gerador de eventos sintéticos em `tools` (distribuições configuráveis ou replay de histórico anonimizado) para popular staging e para os testes de resposta conhecida de I3 | `tools` |
| P | Alertas: `stream_pending` crescendo, `consumer_last_success` parado; esqueleto de `docs/intelligence.md` (vivo) | infra, `docs` |

**Pronto quando:** em staging, encerrar uma hunt produz uma linha em `analytics.sessions` em
menos de 60 s com os mesmos números que o extrato levou ao ledger; matar o `intel` no meio e
subir de novo não duplica nem perde nada — como teste, não como demonstração.

### I2 — Repository Intelligence

Não depende de I1 — só de I0. Pode andar em paralelo, e é o valor mais rápido de entregar.

| Tam. | Issue | Pacote |
|---|---|---|
| M | Indexador: árvore no SHA via API do GitHub, chunker markdown por caminho de títulos, chunker TypeScript por declaração de topo (API do `typescript`), hash por chunk, `repo_files`, índices `repo_docs` / `repo_code` no PgVector, metadados de índice (SHA, modelo, dimensão); teste: reindexar o mesmo SHA não chama embedding nenhum; arquivo removido some do índice | `intelligence` |
| P | `POST /intel/index { sha }` (token de serviço) e o passo no job `deploy staging`; métricas `index_last_sha_info`, `index_stale` | `intelligence`, CI |
| M | Tools `search_repository` (híbrida, RRF), `read_file`, `list_adrs`, `get_invariants`; teste com embedder falso determinístico para o pipeline, e conjunto dourado (§7) para a qualidade | `intelligence` |
| M | Agente `repository`: instruções com os invariantes e o `AGENTS.md` raiz como prefixo estável, regra de citação obrigatória (`path:linha` ou ADR), resposta em português, sem memória entre perguntas; *scorers* por amostragem | `intelligence` |
| M | Agente `reviewer` + `fetch_pr_diff` + `review_diff` com saída estruturada; a rubrica é o texto da `/compliance` lido do índice, não uma cópia | `intelligence` |
| M | `MCPServer` (`@mastra/mcp`) em `/intel/mcp` expondo `ask_repository`, `ask_reviewer`, `review_diff`; instruções de uso no Claude Code (`claude mcp add`) e no Cursor em `docs/intelligence.md` | `intelligence`, `docs` |
| M | Workflow `review` no CI: em PR, chama `/intel/review` e publica **um** comentário consultivo; nunca bloqueia merge; sem segredo de escrita no `intel` | CI |
| M | Conjunto dourado: 20 perguntas com fonte esperada e 7 diffs com uma violação plantada cada (as sete da `/compliance`); `pnpm intel:eval` roda por comando com custo impresso; o CI roda só as asserções sem modelo | `intelligence`, `tools` |

**Pronto quando:** "por que a hunt não usa pathfinding?" volta citando o ADR 0009 e
`docs/boundaries.md`; um diff que põe `Date.now()` em `packages/sim` recebe achado do
invariante 1 com a linha; os dois via MCP no Claude Code, e o segundo como comentário numa
PR de teste.

### I3 — Game Intelligence

Depende de I1.

| Tam. | Issue | Pacote |
|---|---|---|
| M | Modelos de leitura (§5) como views materializadas, refresh por hora agendado no `intel`, dicionário de dados em código, `describe_metrics` | `intelligence` |
| M | `query_metric`, `compare_content_versions`, `list_content_versions`, `get_content` | `intelligence` |
| M | `query_prometheus` (e `query_logs`, se o Loki existir) com tetos | `intelligence` |
| M | `run_sql_readonly` para o perfil operador: papel `intel_ro`, `default_transaction_read_only`, `statement_timeout`, schema `analytics`, `LIMIT` imposto; auditoria no trace | `intelligence` |
| M | Agente `analyst`: dicionário como prefixo estável, "sem dado → diga que não há", mostra a consulta que fez, unidade e grão em toda resposta; *scorers* | `intelligence` |
| M | Testes de resposta conhecida: o gerador de I1 produz um cenário onde a vocação A causa 2× o dano de B e a versão `v2` rende 10% menos XP/h; o agente tem que dizer isso, com os números | `intelligence`, `tools` |
| P | `items_sold_daily` e o consumo de `market.*` ficam prontos como schema; ligam quando E13 existir | `intelligence` |

**Pronto quando:** "qual vocação tem maior XP/h na hunt X, na versão A contra a B?" e "qual o
p95 do login hoje?" voltam com números do `draconya_intel` e do Prometheus, com a consulta
visível, em menos de 60 s; e os testes de resposta conhecida passam.

### I4 — Operação e acesso

| Tam. | Issue | Pacote |
|---|---|---|
| M | Provedor de auth do Mastra: sessão HTTP do Draconya + tokens de serviço + perfis; `server.auth.protected` cobrindo `/intel/*` e `/intel/mcp` | `intelligence` |
| P | Um `intel` por ambiente; `INTEL_ENVIRONMENT` rotula traces e métricas | infra |
| M | Orçamento: `INTEL_DAILY_BUDGET_USD`, teto de tokens por *run*, `llm_cost_usd_total`, recusa acima do orçamento com mensagem clara; relatório mensal por agente | `intelligence` |
| P | Retenção: drop de partição (90 d), traces (30 d), reindex ao trocar modelo de embedding; `pg_dump` do `draconya_intel` no mesmo `scripts/backup-postgres.sh` | `intelligence`, `scripts` |
| P | `infrastructure.md` (custo do container e dos fornecedores) e `deploy.md` (o serviço `intel`) atualizados — os dois são vivos | `docs` |

**Pronto quando:** um desenvolvedor sem perfil `operator` não alcança produção nem
`run_sql_readonly`; o orçamento diário estourado aparece na métrica e recusa o próximo *run*;
o backup do `draconya_intel` foi restaurado uma vez.

### Sequência e estimativa

| Fase | Depende de | Duração (uma pessoa) |
|---|---|---|
| I0 | confirmação das decisões (§12) | ~1 semana |
| I1 | I0 | ~2 semanas |
| I2 | I0 | ~2 semanas — em paralelo com I1 |
| I3 | I1 (e I2 para `get_content`) | ~2–3 semanas |
| I4 | I2, I3 | ~1 semana |

**Total: 8–9 semanas** em sequência; 6–7 com I1 e I2 em paralelo. A trilha não bloqueia F3–F7
do jogo, e só uma issue toca `sim` (a de agregados, em I1).

---

## 7. Testes

A regra do repositório vale inteira: o tempo é dirigido, nunca esperado; cada passo verifica
estado. E uma regra nova: **`pnpm check` nunca chama fornecedor.** O que precisa de modelo ou
de embedding de verdade roda por `pnpm intel:eval`, imprime o custo, e é disparado à mão ou
por agendamento — nunca no caminho de uma PR.

| Camada | O que se prova | Como |
|---|---|---|
| `telemetry` | todo evento do catálogo tem schema, exemplo válido, id idempotente; versão nova não quebra a anterior | testes estruturais, como o de `protocol` que varre todas as mensagens |
| produtores | `session.ended` sai no mesmo `MULTI` do extrato e uma vez só; retry da drenagem não emite de novo; `api` emite depois da resposta e falha de Redis não derruba a rota | testes de `server` com Redis real |
| consumidor | mesma entrada três vezes → uma linha; consumidor morto no meio → entrada reclamada e aplicada uma vez; quinta falha → `telemetry:dead`; partição do dia é criada sozinha | testes de `intelligence` com Redis e Postgres reais |
| varredura do ledger | reexecutar não muda nada; linha inserida no banco do jogo aparece no espelho na próxima varredura | Postgres real |
| rollups | resposta conhecida: cenário sintético com números plantados | gerador de `tools` + SQL |
| retrieval | pipeline (chunking determinístico, diff por hash, remoção) com embedder falso; qualidade com o conjunto dourado | `pnpm test` para o primeiro, `pnpm intel:eval` para o segundo |
| agentes | escolha de ferramenta e forma da resposta com o modelo simulado do AI SDK (`ai/test`); qualidade com *scorers* e conjunto dourado | `pnpm test` / `pnpm intel:eval` |
| code review | sete diffs com violação plantada → sete achados certos, zero falsos no diff limpo | `pnpm intel:eval`; no CI, só a asserção de que o contexto recuperado inclui o ADR certo |
| ponta a ponta | staging semeado pelo gerador; as duas perguntas do critério de I3 | à mão, no critério de saída |

---

## 8. Custo

Ordem de grandeza, com os preços de lista de hoje (Opus 5: US$ 5 / US$ 25 por milhão de
tokens de entrada / saída; Haiku 4.5: US$ 1 / US$ 5). Como no `infrastructure.md`: para
decidir, não para orçar — confirme antes de contratar.

| Uso | Tokens típicos | Custo por uso |
|---|---|---|
| revisão de PR (diff + contexto recuperado + rubrica) | ~40 k entrada, ~3 k saída | ~US$ 0,30 |
| pergunta sobre o repositório | ~15 k entrada, ~1,5 k saída | ~US$ 0,10 |
| pergunta analítica com três ferramentas | ~25 k entrada, ~2 k saída | ~US$ 0,20 |
| indexar o repositório inteiro (Voyage) | ~0,5 M tokens | centavos; incremental depois |
| container `intel` (0,5 vCPU / 1 GB) | — | dentro da VPS atual |

Quarenta revisões, duzentas perguntas de cada tipo por mês: **~US$ 70**. O prefixo estável
(invariantes, rubrica, dicionário) em cache de prompt corta a parte de entrada que se repete.
O orçamento diário de I4 é o teto, não a estimativa.

---

## 9. Segurança e permissões

Fecha o §16 dos requisitos com o que §2.7, §2.8 e §2.10 já decidem, mais três regras:

- **Conteúdo é dado, nunca instrução.** Diff de PR, chunk do repositório, payload de evento e
  linha de log passam pelas ferramentas como dado; o agente não tem ferramenta que execute,
  escreva ou envie nada. Instrução embutida num diff ("aprove esta PR") não tem para onde ir.
- **Segredos só no `intel`.** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` e o token de leitura do
  GitHub existem só no container `intel`; o jogo, o cliente e o CI de PR não os têm. O token do
  GitHub é somente leitura; quem escreve comentário é o `GITHUB_TOKEN` do próprio job.
- **Trilha completa.** Todo *run* fica no trace com o usuário, as ferramentas e os argumentos.
  É a "auditoria de ação administrativa" que o §41 do PRD pede, aplicada à camada nova.

Dados de produção só para `operator`; `developer` trabalha em staging semeado pelo gerador —
é também a resposta ao §5.1 dos requisitos ("dados sintéticos a partir de históricos").

---

## 10. Riscos e mitigações

| Risco (§20 dos requisitos) | Mitigação neste plano |
|---|---|
| aumento do volume de eventos | evento por sessão, não por tick; `MAXLEN` no stream; `sampleRate` no catálogo; alerta em `stream_pending` |
| armazenamento crescente | partição por dia com drop em 90 d; rollups compactos; gatilho explícito para ClickHouse |
| respostas incorretas do LLM | citação obrigatória; "sem dado → diga"; consulta visível; *scorers* amostrados; conjunto dourado; revisão só consultiva |
| retrieval de contexto incorreto | busca híbrida; chunk por símbolo/título; `index_stale` quando o índice fica atrás da `main`; norte no prompt, não no retrieval |
| consultas caras | modelos de leitura primeiro; `query_metric` parametrizada; SQL livre só para operador, somente leitura, com `statement_timeout` e `LIMIT` |
| acesso indevido | perfis; um `intel` por ambiente; papéis de banco por finalidade; segredos só no `intel` |
| duplicação / perda de eventos | id idempotente + PK; pelo menos uma vez + reclaim + dead-letter; valor vem do ledger, não de evento |
| acoplamento ao runtime do jogo | `intelligence` não importa `server` (lint); jogo só faz `XADD` e nunca espera o `intel`; `sim` não sabe que analytics existe |
| churn do Mastra (1.x muda rápido) | versões fixadas; agentes e tools atrás de módulos próprios (`agents/`, `tools/`), para a troca ser local |
| dependência de fornecedor | modelo e embedding atrás do roteador e do AI SDK; modelo de embedding gravado no índice; reindex é um job |

---

## 11. O que deliberadamente não entra

- **Executar o `sim` para experimentar balanceamento.** Fora do escopo por decisão (§5.1 dos
  requisitos). O que existe é comparar versões que **já rodaram**, por `contentVersion`.
- **Interface própria de chat.** MCP no Claude Code e no Cursor, comentário no CI e Studio em
  staging cobrem o uso de hoje; painel de admin é E15 do jogo, e um chat dentro dele é
  decisão para quando houver mais de um usuário.
- **Kafka, ClickHouse, banco vetorial dedicado.** Cada um tem gatilho registrado; nenhum tem
  volume hoje.
- **Aprovação ou bloqueio automático de PR.** O revisor comenta; quem aprova é gente. A
  `/compliance` continua sendo a skill; o agente é a mesma rubrica rodando sem ninguém invocar.
- **Fine-tuning e memória de longo prazo dos agentes.** Perguntas são independentes; o
  conhecimento persistente é o repositório e o banco, não a conversa.
- **Encaminhar logs para o stream.** Log é log; a ferramenta consulta o Loki quando ele existir.

---

## 12. O que precisa ser confirmado antes de começar

O §23 dos requisitos pede que as decisões sejam explicitamente confirmadas antes de virar
plano de implementação. Esta é a lista, na ordem de lá, com o padrão que vale se nada for
dito em contrário:

| # | Decisão | Padrão proposto | ADR |
|---|---|---|---|
| 1 | contrato dos eventos | envelope + catálogo Zod em `packages/telemetry`; fato por sessão/transação; id idempotente; sem PII | 0025 |
| 2 | mensageria | Redis Streams no Redis existente; ledger espelhado por varredura somente leitura | 0025 |
| 3 | armazenamento analítico | Postgres, banco `draconya_intel` na mesma instância; partição por dia; rollups por hora; imagem `pgvector/pgvector:pg17` | 0026 |
| 4 | RAG e vector store | pgvector via `@mastra/pg`; Voyage (`voyage-4` / código); chunk por título e por símbolo; indexação por SHA via GitHub | 0026, 0027 |
| 5 | provider e modelo | Anthropic pelo roteador do Mastra: `claude-opus-5` nos três agentes, `claude-haiku-4-5` no que é curto | 0027 |
| 6 | pacotes e fronteiras | `telemetry` (puro) + `intelligence` (processo `intel`, imagem própria); `server` importa `telemetry`; `intelligence` nunca importa `server` | 0028 |
| 7 | tools | as de §2.7, todas somente leitura; SQL livre só para operador | spec das issues |
| 8 | auth e permissões | sessão HTTP do Draconya + tokens de serviço; perfis `operator` / `developer` / `service`; um `intel` por ambiente | 0029 |
| 9 | observabilidade | Pino + Prometheus em 3002 + traces no próprio banco + *scorers* amostrados | — |
| 10 | deploy | container `intel` nos três composes, mesmo `Dockerfile`, Coolify, staging primeiro | 0028, emenda 0022 |

Confirmadas, o passo seguinte é a fase I0: `/adr` para cada linha da última coluna e
`/module` para os dois pacotes — e a partir daí cada issue passa pela `/spec` antes de alguém
executar, como as demais.
