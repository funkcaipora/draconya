# Draconya

MMORPG de navegador em grade de tiles, server-authoritative e idle-first. A hunt — o loop
principal de progressão — é uma sessão que vive no servidor e continua rodando com o navegador
fechado: o jogador entra, direciona o bot, e sair não interrompe nada. Conteúdo manual (quest,
boss, guild war) é instanciado à parte, exige o jogador presente, e reaproveita o mesmo motor de
movimento e ação por tile que a hunt usa.

## Os onze invariantes inegociáveis

Isto é o norte de arquitetura em forma operacional. Toda decisão futura é medida contra esta
lista, e violar qualquer item exige um ADR (`docs/adr/`) explicando por quê.

Skill é invocada, hook é imposto. Esta lista vive num `AGENTS.md` — carregado sempre, sem
depender de alguém lembrar de invocar nada — porque é a única camada em que uma regra deste peso
pode morar (ver `docs/harness-plan.md` §1).

1. **`sim/` é puro** — sem I/O, sem framework, sem rede, sem banco, sem relógio global.
   Por quê: é o que permite testar a simulação sem infraestrutura, rodar num cliente sintético de
   carga, e trocar a camada de servidor sem reescrever a lógica de jogo.

2. **Nada é escrito "por tick"** — quem recebe `dtMs` é `Session.advanceBy`, e cada cálculo é um
   evento da fila que roda no instante exato em que vence. É o que permite rodar a 1 Hz
   desanexado com resultado idêntico — e desde o ADR 0020 isso é propriedade da estrutura, não
   de cada fórmula ter sido escrita com cuidado.

3. **O resultado da simulação não depende de haver alguém assistindo.** Cai a apresentação, nunca
   a matemática.
   Por quê: o jogo é idle-first — a hunt é o modo default e precisa sobreviver ao navegador
   fechado, não só tolerar uma reconexão.

4. **O cliente só manda intenção.** Nunca dano, posição resolvida, loot, XP ou resultado de
   transação.
   Por quê: o servidor é autoritativo. Um cliente comprometido não fabrica resultado se nunca é
   ele quem calcula o resultado.

5. **Opcodes vivem só em `protocol/`**, num arquivo, como fonte única das duas tabelas.
   Por quê: evita que cliente e servidor divirjam sobre o que um opcode significa.

6. **`content/` nunca contém arte** — só `appearanceId` e `outfitId`.
   Por quê: troca de pacote de assets vira remapeamento de ids, não reescrita de conteúdo. Importa
   porque o pacote de assets atual (cliente Tibia) carrega risco jurídico — ver
   `docs/technical-architecture.md` §8 e §13.1.

7. **A versão de conteúdo é fixada na sessão** e não muda no meio dela.
   Por quê: sem isso, um deploy no meio de milhares de hunts desanexadas produz resultado
   inconsistente e impossível de auditar.

8. **Todo personagem está sempre em exatamente um estado**, cidade inclusive — e um estado
   ATIVO é sempre exatamente uma sessão hospedada.
   Por quê: transforma "estado exclusivo" de regra policiada em propriedade estrutural — não
   existe lugar onde o personagem esteja em dois estados ao mesmo tempo.
   O repouso é o estado sem sessão: a Cidade não simula nada (§37), e depois de um prazo sem
   visualizador a sessão dela é recolhida (ADR 0024). O personagem continua na Cidade por
   `characters.state`, que é uma linha só e não admite ambiguidade.

9. **Estado QUENTE só é escrito pela sessão dona.** Nenhum outro processo toca o
   `CharacterRuntime` em memória — isto é absoluto e não tem exceção.
   Por quê: é também o mecanismo de controle de concorrência do gold — não precisa de lock
   adicional porque nunca há duas fontes de escrita ao mesmo tempo.
   **A linha do Postgres não é estado quente.** Ela é durável, é escrita por `jobs` e por `api`,
   e o que serializa as duas é a trava de linha mais a chave única do invariante 10 — que já
   existiam. Ver ADR 0024, inclusive por que essa é a fronteira certa.

10. **Movimentação de valor passa pelo ledger** com `(session_id, seq)` único. Retry nunca
    duplica.

11. **A automação é legítima** — "parece bot" nunca é sinal de punição.
    Por quê: o motor de bot server-side é funcionalidade central de um jogo idle-first. O que
    precisa de defesa é multiconta e RMT, não automação.

## Stack

- **Node 24** + **uWebSockets.js**, em três processos: `api` (stateless, HTTP), `game` (stateful,
  hospeda sessões via WebSocket) e `jobs` (singleton com lock — agendador e reconciliação)
- **PostgreSQL** (verdade durável) + **Redis** (diretório de sessões, leases, filas, snapshots
  quentes)
- Cliente **React** + **PixiJS v8** + **Vite** — HUD em DOM, mundo em canvas, store de jogo fora
  do React
- **TypeScript ponta a ponta**, monorepo em **pnpm workspaces**

## Mapa do repositório

- `packages/protocol` — opcodes, tipos de mensagem e codec de frame; fonte única das tabelas
  cliente/servidor
- `packages/content` — dados de jogo versionados: monstros, hunts, itens, magias, vocações, prey,
  bestiário, supply, economia, flags. Nunca arte.
- `packages/sim` — motor de simulação puro: combate, movimento, bot. Sem I/O; roda em qualquer
  runtime, inclusive num cliente sintético de carga.
- `packages/server` — processos `api` / `game` / `jobs`; persistência, diretório de sessão e
  roteamento
- `packages/client` — React + PixiJS v8 + Vite
- `packages/tools` — scripts de importação (tilemap, rota, assets do cliente Tibia) e o cliente
  sintético de carga

## Idioma

- **Código em inglês:** nomes de todos os arquivos e pastas (inclusive documentação), variáveis, funções, classes, tipos,
  propriedades, constantes, tabelas/colunas, configuração, contratos de rede, logs, erros e
  descrições de testes. Exemplos: `Session`, `characterId`, `contentVersion`, `loadConfiguration`.
- **Documentação e comentários em português.** Identificadores citados nesses textos e exemplos
  de código seguem os nomes reais em inglês. Documentos históricos preservam o contexto da época.
- Commits e títulos de PR usam inglês. A descrição do PR pode ser em português, como documentação.
- Renomear contratos persistidos exige tratar compatibilidade explicitamente; nunca descartar
  dados só para padronizar nomes. Ver ADR 0014.

## Padrão de commit e branch

```
<type>(<scope>): <imperative description in English> (FUN-nn)

type:   feat | fix | refactor | perf | docs | test | chore
scope: sim | protocol | content | server | client | tools | docs | deps
```

Exemplo: `feat(sim): advance simulation using elapsed time (FUN-25)`

O escopo `deps` é do Dependabot (`.github/dependabot.yml`) e de atualização de dependência
feita à mão. Existe porque bump de `fastify` em `packages/server` não é `tools`: escopo que
mente torna o campo inútil justamente no tipo de commit que mais aparece.

`(FUN-nn)` é obrigatório em todo commit, exceto tipo `chore` e `docs`. Trabalho rastreado em
milestone do GitHub em vez do Linear (skill `task-github`, ADR 0025) referencia a issue como
`(#nn)` no mesmo lugar — é referência de issue igual, só muda o rastreador. Um hook recusa o
commit que não bater: `.claude/hooks/validate-commit.sh` dentro do Claude Code, `.githooks/commit-msg` para
commit feito fora dele (git de linha de comando ou GUI).

**Commit de merge é isento.** Ele não descreve uma mudança, descreve uma junção, e o assunto que o
git gera (`Merge branch 'x' into y`) nunca bateria no formato. Os dois hooks detectam por
`MERGE_HEAD`, e não pelo prefixo do assunto — o assunto é texto livre e um commit normal pode
começar com "Merge" sem ser um.

**Branch:** a que o Linear já gera (`funkcaipora/fun-25-...`). Fecha o link automático entre
commit, PR e issue sem trabalho manual.

**Entrega:** commit e PR para `main` fazem parte do trabalho autorizado, sem pedir confirmação
a cada entrega. Nunca faça push direto na `main`; execute `pnpm check` antes de abrir o PR.

## Documentação

- `docs/architecture.md` — restrições do motor impostas pelo design do jogo (instantâneo)
- `docs/technical-architecture.md` — arquitetura de sistema e plano do MVP, épicos e fases
  (instantâneo)
- `docs/harness-plan.md` — por que este harness (CLAUDE.md, hooks, skills, CI) tem esta forma
- `docs/adr/` — uma decisão técnica por arquivo: contexto, decisão, alternativas, consequências
- `docs/product/` — o que cada sistema faz de fato, hoje. Vivo; diverge do PRD quando a
  implementação decidiu diferente, e marca o porquê
- `docs/reference/` — estudo de engines externas usado como **especificação de domínio**. Antes de
  implementar mecânica de jogo nova, consulte a seção correspondente: o objetivo é não
  redescobrir problema que outra engine já resolveu. Ver ADR 0019 — inclusive o limite de
  licença, que não é negociável. São dois documentos e eles respondem coisas diferentes:
  `opentibia-engine-reference.md` diz **como o mecanismo funciona** (TFS e Canary, código
  aberto); `huntera-observed.md` diz **que números um jogo do gênero usa de fato**, observados
  em produção — é a ele que se recorre quando um `[ABERTO]` do PRD precisa de um ponto de
  partida em vez de um palpite

## Ao trabalhar aqui

- **Sempre existe um `AGENTS.md` dentro do pacote que você está editando.** Leia antes de mudar
  qualquer coisa lá — ele define propósito, fronteiras de import e armadilhas conhecidas daquele
  pacote específico. "`sim/` não pode importar de `server/`" está lá, e também é regra de lint.
- **Decisão de arquitetura vira ADR** em `docs/adr/`. Se ela muda um dos onze invariantes acima,
  este arquivo é atualizado no mesmo commit — senão o norte descrito aqui e o código divergem.
- **Sistema do PRD que sai do papel atualiza `docs/product/<system>.md`.** O PRD é o instantâneo
  do que se pretendia numa data; `docs/product/` é o que existe de fato, incluindo os parâmetros
  de balanceamento e onde eles moram em `content/`.
- **Antes de abrir PR ou fechar issue:** `pnpm check` (lint, typecheck, test, docs-check).
- **A versão do Node é fixada** em `.node-version` e em `engines`. Desenvolvimento, Docker e CI
  usam a mesma. Rodar em versão diferente quebra o binário nativo do `uWebSockets.js`, com
  mensagem que não menciona a versão do Node — é o tipo de meia hora perdida que não precisa
  acontecer duas vezes.
- **Dependência nativa nova precisa de binário para `linux/amd64` e `linux/arm64`** (ADR 0013).
  **Confira à mão antes de adicionar: o CI não pega mais.** O job de imagem constrói só `amd64`
  desde 2026-09-08, porque o build `arm64` emulado custava cinco minutos por PR — ver a emenda
  no ADR 0013, que diz quando religar.

## Sobre este arquivo e o CLAUDE.md

`AGENTS.md` é o arquivo real; `CLAUDE.md` é um symlink para ele, na raiz e em cada pacote. O
projeto é executado por mais de uma ferramenta — Claude Code lê `CLAUDE.md`, Codex lê `AGENTS.md`
— e manter dois arquivos com o mesmo conteúdo é como as duas versões divergem sem ninguém
perceber. Um arquivo, dois nomes.

Se você estiver no Claude Code, existem skills em `.claude/skills/` que automatizam os rituais
acima: `/adr`, `/module`, `/compliance`, `/product`, `/spec` e `/delivery`. Em qualquer outra
ferramenta,
os mesmos arquivos servem como checklist legível — a regra vale igual, muda só quem executa.
