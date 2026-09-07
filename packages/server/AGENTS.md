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
Coins, personagens e ledger, ligada por `external_auth_id`. A coluna `senha_hash` existe nulável
e sem uso, para que trazer a autenticação para casa seja aditivo. `AUTH_DEV_MODE=true` aceita
qualquer e-mail em desenvolvimento e derruba o boot em produção.

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
- `uWebSockets.js` não é a API do `ws`. Não presuma compatibilidade.
