# @draconya/server

## Propósito

Os três processos: `api` (stateless — HTTP, auth, tickets, market, pagamentos), `game` (stateful —
WebSocket, hospeda sessões) e `jobs` (singleton com lock — agendador, expirações, reconciliação).
Persistência, diretório de sessão e roteamento.

## Fronteiras

**Pode importar:** `protocol`, `content`, `sim`, `tools`.
**Não pode importar:** `client`.

## Invariantes locais

- **O cliente só manda intenção** (invariante 4). Nada que chega pelo socket decide dano, posição
  resolvida, loot, XP ou resultado de transação. Se uma mensagem de entrada carrega resultado, é
  bug de protocolo, não recurso.
- **Movimentação de valor passa pelo ledger** com `(session_id, seq)` único (invariante 10).
  Retry nunca duplica. Ver ADR 0006.
- **Nenhuma leitura ou escrita de banco no caminho crítico de uma ação.** A simulação vive em
  memória; persistência é write-behind. Postgres no meio do tick mata o tempo de resposta.
- Sessão de hunt sobrevive ao socket e ao restart. Deploy **drena encerrando com crédito**, não
  descarta. Ver ADR 0010.
- O limite de 2 personagens ativos por conta é aplicado com script atômico no Redis, nunca com
  verificação otimista.

## Bibliotecas fixas (ADR 0011)

Drizzle + drizzle-kit no Postgres, ioredis, Fastify no `api`, uWebSockets.js no `game`, pino,
prom-client. Zod para validação. Trocar qualquer uma exige ADR novo, não decisão no meio de uma
tarefa — o valor da lista é ser única.

## Autenticação (ADR 0012)

Credencial e fluxos de conta ficam no WorkOS AuthKit; a tabela `account` local segue dona de
Coins, personagens e ledger, ligada por `external_auth_id`. A coluna `password_hash` existe nulável
e sem uso, para que trazer a autenticação para casa seja aditivo. `AUTH_DEV_MODE=true` aceita
qualquer e-mail em desenvolvimento e derruba o boot em produção.

## Ticket de sessão (FUN-12)

A sessão HTTP morre no `api`. O que segue para o socket é um ticket de ~30 s, uso único,
consumido com `GETDEL` e amarrado a um `nodeId` — apresentado a outro nó, é recusado. Duas
regras não são negociáveis aqui:

- **Reconexão volta para o MESMO nó.** Sessão viva num nó que parou de bater é recusada, não
  re-hospedada: escolher outro nó cria a segunda sessão do mesmo personagem (invariante 8).
  Decidir que uma sessão morreu é da retomada (FUN-28), com lock.
- **Sem autenticação, a rota responde 501.** Emissão de ticket sem dono é acesso a qualquer
  conta; falhar aberto aqui é pior que não ter a rota.

O slot de personagem ativo é reservado na EMISSÃO. A varredura em `jobs` devolve o slot por
uma regra só: passado o prazo, se o personagem não tem sessão no diretório, o slot volta —
o que cobre ticket abandonado, ticket queimado numa conexão que morreu, e ticket duplicado
sem um caminho de limpeza para cada caso.

## Como testar

```
pnpm vitest run packages/server
```

Testes de integração que importam: reanexar a uma sessão em andamento; matar o processo e recuperar
do snapshot; drenar em deploy e conferir o extrato; duas requisições simultâneas competindo pelo
terceiro slot de personagem.

## Armadilhas conhecidas

- Ações do jogador são processadas **na chegada**, não enfileiradas para o tick. Enfileirar
  adiciona até 100 ms de jitter em cima do ping — irrelevante na hunt, fatal no PvP manual.
- `uWebSockets.js` não é a API do `ws`. Não presuma compatibilidade. O `HttpRequest` do
  `upgrade` só vale DURANTE o handler: qualquer header ou query que o caminho assíncrono vá
  usar precisa ser lido antes, e mexer na resposta depois de `onAborted` derruba o processo.
- **Teste que usa Redis escolhe um banco só seu** (`testing/redis.ts`). O Vitest roda arquivos
  em paralelo e `flushdb` é global: dois arquivos no mesmo banco passam sozinhos e falham
  juntos, de forma intermitente.
