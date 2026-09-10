# Índice de ADRs

Um ADR (*Architecture Decision Record*) registra uma decisão de arquitetura já tomada: o problema
que forçou a decisão, o que foi decidido, o que foi descartado e por quê, e as consequências —
inclusive as ruins. Não é documento de design nem tutorial; é o registro de "por que o projeto
tem esta forma", para que ninguém precise reconstruir o raciocínio a partir de uma conversa
perdida.

Escreva um ADR novo sempre que uma decisão de arquitetura for tomada — não só nas grandes, mas em
qualquer escolha que, se revertida depois, exigiria mudar mais de um lugar do código ou dos
documentos. Use o template de `docs/harness-plan.md` (seção 3.1): Status, Data, Contexto técnico,
Contexto, Decisão, Alternativas, Consequências e Invariantes afetados — numerados conforme
`docs/harness-plan.md` seção 2.2. Se a decisão muda um invariante, o passo seguinte é refletir a
mudança onde os invariantes são declarados; um ADR que contradiz a lista vigente sem marcar isso é
uma inconsistência, não uma atualização.

| # | Título | Status | Resumo |
|---|---|---|---|
| [0001](0001-session-decoupled-from-connection.md) | Sessão desacoplada da conexão | aceito | A hunt é uma sessão do servidor, não uma extensão do socket; roda com o navegador fechado, e o socket é só um visualizador que se anexa e desanexa. |
| [0002](0002-server-side-bot.md) | Bot avaliado no servidor | aceito | O motor de regras de automação roda no servidor, com vocabulário fechado (sem linguagem de script) e cinco categorias com cooldown de 1 s cada. |
| [0003](0003-variable-session-tick-rate.md) | Tick variável por sessão | aceito | A taxa de tick é função de (tipo de sessão, presença de visualizador); toda fórmula de simulação recebe `dtMs`. |
| [0004](0004-city-as-protect-zone.md) | Cidade como protect zone | aceito | O único espaço compartilhado do jogo é deliberadamente inerte: sem combate, sem dano, sem automação; todo o resto é instanciado. |
| [0005](0005-three-process-modular-monolith.md) | Monólito modular com três processos | aceito | Processos `api` (stateless), `game` (stateful) e `jobs` (singleton) num monólito modular, em vez de microserviços. |
| [0006](0006-idempotent-append-only-ledger.md) | Ledger append-only idempotente | aceito | Toda movimentação de valor vira linha de ledger com `UNIQUE(session_id, seq)`; retry nunca duplica. |
| [0007](0007-react-pixi-client-external-store.md) | Cliente React + PixiJS com store externo | aceito | Cliente React + PixiJS v8 + Vite; estado de jogo num store mutável fora do React, e o canvas nunca renderiza através dele. |
| [0008](0008-tibia-client-assets-with-indirection.md) | Assets do cliente Tibia com indireção por id | aceito | Pacote de assets do cliente Tibia usado no MVP; `content/` referencia só `appearanceId`/`outfitId`, o que mantém a troca de pacote barata. |
| [0009](0009-fixed-hunt-route-without-pathfinding.md) | Rota fixa sem pathfinding na hunt | aceito | Cada hunt tem rota fixa predeterminada e monstros usam passo guloso; a hunt não precisa de A*, e campos bloqueantes custam zero em invalidação. |
| [0010](0010-deploy-drain-with-progress-credit.md) | Drenagem em deploy encerra creditando | aceito | Em deploy, o nó encerra cada sessão creditando o progresso, em vez de migrar sessões ao vivo; o formato de snapshot já nasce pronto para migração futura. |
| [0011](0011-library-stack.md) | Stack de bibliotecas | aceito | Zod, Drizzle, ioredis, Fastify, pino, prom-client e Vitest fixados como escolha única; `sim/` segue sem dependência. |
| [0012](0012-workos-delegated-authentication.md) | Autenticação delegada ao WorkOS | aceito | Credencial e fluxos de conta no AuthKit; `account` local segue dona de Coins, personagens e ledger, com `password_hash` nulável reservado. |
| [0013](0013-multi-architecture-images.md) | Imagens multi-arquitetura | aceito | Build para `amd64` e `arm64` desde o primeiro Dockerfile; desenvolvimento em ARM, destino de deploy livre, e a medição de custo passa a depender da arquitetura. |
| [0014](0014-english-code-conventions.md) | Código e caminhos em inglês | aceito | Código, arquivos, pastas e contratos em inglês; documentação e comentários em português; migração explícita de schema, snapshots e leases. |
| [0015](0015-runtime-escape-hatches.md) | Rotas de fuga de runtime | aceito | Node e uWS ficam; núcleo de `sim` em Rust e migração para Bun seguem disponíveis, cada uma com gatilho explícito. Bun não resolve o gargalo projetado. |
| [0016](0016-typescript-only-first-party-code.md) | TypeScript como linguagem única do código first-party | aceito | Código mantido pelo projeto é TypeScript, scripts e configuração entram no typecheck, e `source-policy` reprova o `pnpm check` se um `.js` first-party voltar. |
| [0017](0017-authentication-and-character-admission.md) | Autenticação e admissão de personagens | aceito | Identidade externa sem vínculo por e-mail, sessão HTTP com TTL e admissão coordenada com soft delete e reserva no Redis. |
| [0018](0018-discard-the-gap-when-resuming-a-session.md) | Retomada descarta o intervalo | aceito | Ao retomar após queda, o relógio é reposicionado e o tempo pulado NÃO é simulado; o jogador é avisado do que se perdeu. Simular o buraco inventaria uma luta que não aconteceu. |
| [0019](0019-opentibia-as-domain-specification.md) | OpenTibia como especificação de domínio | aceito | TFS e Canary viram especificação de domínio consultável em `docs/reference/`, nunca código copiado (GPL v2); adoção é puxada por defeito medido ou tarefa na fila, e o que fica adiado está listado para não ser reproposto. |
| [0020](0020-logical-session-scheduler.md) | Relógio lógico e fila de eventos por sessão | aceito | A sessão ganha relógio lógico começando em zero e uma fila de eventos ordenada; `advanceBy` processa só o que vence, o tick em lote sai, e `rebaseClock` deixa de ter o que rebasear. A equivalência entre taxas vira propriedade da estrutura. |
| [0021](0021-the-game-process-writes-the-bot-configuration.md) | O processo `game` escreve a configuração do bot | aceito | A configuração do bot é escrita pelo socket, no `game`, com uma função estreita injetada; a leitura continua no `api`, pelo ticket. Rota HTTP preservaria o writer único e trocaria uma escrita de uma instrução por um mecanismo de propagação novo. |
| [0022](0022-coolify-same-origin-deployment.md) | Deploy integrado no Coolify | aceito | Cliente, API e WebSocket na mesma origem HTTPS; banco e Redis internos, com migrações antes do boot. |
| [0023](0023-the-city-is-a-shard.md) | A Cidade é um shard | aceito | Uma cópia por nó, muitos personagens dentro; `Session` ganha `leave` e o shard não tem extrato nem snapshot. Emendado no mesmo dia com interest management por célula e teto de 200 por cópia, medidos. |
| [0024](0024-hot-state-and-hosted-session-are-not-the-same-thing.md) | Estado quente e sessão hospedada não são a mesma coisa | aceito | Os invariantes 8 e 9 passam a distinguir estado ATIVO de repouso e estado QUENTE de durável — texto alcançando o que a FUN-52 e a FUN-56 já faziam. Sem mudança de runtime, fora a fresta de posse fechada em `POST /api/tickets`. |
