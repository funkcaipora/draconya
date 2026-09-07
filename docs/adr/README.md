# Índice de ADRs

Um ADR (*Architecture Decision Record*) registra uma decisão de arquitetura já tomada: o problema
que forçou a decisão, o que foi decidido, o que foi descartado e por quê, e as consequências —
inclusive as ruins. Não é documento de design nem tutorial; é o registro de "por que o projeto
tem esta forma", para que ninguém precise reconstruir o raciocínio a partir de uma conversa
perdida.

Escreva um ADR novo sempre que uma decisão de arquitetura for tomada — não só nas grandes, mas em
qualquer escolha que, se revertida depois, exigiria mudar mais de um lugar do código ou dos
documentos. Use o template de `docs/plano-harness.md` (seção 3.1): Status, Data, Contexto técnico,
Contexto, Decisão, Alternativas, Consequências e Invariantes afetados — numerados conforme
`docs/plano-harness.md` seção 2.2. Se a decisão muda um invariante, o passo seguinte é refletir a
mudança onde os invariantes são declarados; um ADR que contradiz a lista vigente sem marcar isso é
uma inconsistência, não uma atualização.

| # | Título | Status | Resumo |
|---|---|---|---|
| [0001](0001-sessao-desacoplada-da-conexao.md) | Sessão desacoplada da conexão | aceito | A hunt é uma sessão do servidor, não uma extensão do socket; roda com o navegador fechado, e o socket é só um visualizador que se anexa e desanexa. |
| [0002](0002-bot-avaliado-no-servidor.md) | Bot avaliado no servidor | aceito | O motor de regras de automação roda no servidor, com vocabulário fechado (sem linguagem de script) e cinco categorias com cooldown de 1 s cada. |
| [0003](0003-tick-variavel-por-sessao.md) | Tick variável por sessão | aceito | A taxa de tick é função de (tipo de sessão, presença de visualizador); toda fórmula de simulação recebe `dtMs`. |
| [0004](0004-cidade-como-protect-zone.md) | Cidade como protect zone | aceito | O único espaço compartilhado do jogo é deliberadamente inerte: sem combate, sem dano, sem automação; todo o resto é instanciado. |
| [0005](0005-monolito-modular-tres-processos.md) | Monólito modular com três processos | aceito | Processos `api` (stateless), `game` (stateful) e `jobs` (singleton) num monólito modular, em vez de microserviços. |
| [0006](0006-ledger-append-only-idempotente.md) | Ledger append-only idempotente | aceito | Toda movimentação de valor vira linha de ledger com `UNIQUE(session_id, seq)`; retry nunca duplica. |
| [0007](0007-cliente-react-pixi-store-externo.md) | Cliente React + PixiJS com store externo | aceito | Cliente React + PixiJS v8 + Vite; estado de jogo num store mutável fora do React, e o canvas nunca renderiza através dele. |
| [0008](0008-assets-do-cliente-tibia-com-indirecao.md) | Assets do cliente Tibia com indireção por id | aceito | Pacote de assets do cliente Tibia usado no MVP; `content/` referencia só `appearanceId`/`outfitId`, o que mantém a troca de pacote barata. |
| [0009](0009-rota-fixa-sem-pathfinding-na-hunt.md) | Rota fixa sem pathfinding na hunt | aceito | Cada hunt tem rota fixa predeterminada e monstros usam passo guloso; a hunt não precisa de A*, e campos bloqueantes custam zero em invalidação. |
| [0010](0010-drenagem-em-deploy-encerra-creditando.md) | Drenagem em deploy encerra creditando | aceito | Em deploy, o nó encerra cada sessão creditando o progresso, em vez de migrar sessões ao vivo; o formato de snapshot já nasce pronto para migração futura. |
| [0011](0011-stack-de-bibliotecas.md) | Stack de bibliotecas | aceito | Zod, Drizzle, ioredis, Fastify, pino, prom-client e Vitest fixados como escolha única; `sim/` segue sem dependência. |
| [0012](0012-autenticacao-delegada-ao-workos.md) | Autenticação delegada ao WorkOS | aceito | Credencial e fluxos de conta no AuthKit; `account` local segue dona de Coins, personagens e ledger, com `senha_hash` nulável reservado. |
