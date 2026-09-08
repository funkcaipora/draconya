# Revisão de FUN-10 e FUN-11 — 2026-09-08

## Resultado

**FUN-10 pode ir para Done: não.** O código e os testes locais estão corrigidos, mas falta
exercitar cadastro/login/callback/logout com um tenant WorkOS real, redirects registrados e
HTTPS. A revisão validou os contratos HTTP oficiais e usou respostas controladas do provedor;
isso não comprova configuração ou comportamento do tenant de produção.

**FUN-11 pode ir para Done: sim, considerando esta versão corrigida.** Criação, seleção,
listagem, ownership, nomes concorrentes, soft delete, bloqueio de ativos e integração com
admissão foram exercitados com Postgres, Redis e WebSocket reais. Banco existente precisa
receber a migração documentada antes do deploy. Não foi executada migração em banco do usuário.

Nenhuma issue foi movida para Done automaticamente. FUN-16 e M2 não foram implementadas.

## Escopo e procedência

A base da revisão foi a pasta `Downloads/draconya-main`, sem `.git`, com a implementação de
FUN-10/FUN-11 fornecida pelo usuário. Ela foi incorporada ao checkout Git para uma entrega por
PR à `main`. Durante a revisão, a `main` recebeu os PRs #16, #17 e #19; a branch foi rebaseada
sobre `c3cab92` para preservar essas atualizações. A validação final usa Vitest 4.1.11 e Zod 4.

Foram lidos README, AGENTS/CLAUDE da raiz e servidor, ADR 0012 e as fronteiras de simulação,
autenticação, ticket, diretório e limite de ativos. Foram revisados cookie, configuração,
adaptador WorkOS, Redis, repositório Drizzle, schema, migrações e montagem real dos processos.

## Problemas encontrados, por severidade

| Severidade | Problema na versão revisada | Correção e evidência |
|---|---|---|
| Alta | A exclusão consultava ativos fora da transação; uma emissão simultânea podia obter ownership e criar ticket para um personagem removido. | `withOwnedCharacter` e soft delete adquirem o mesmo `SELECT FOR UPDATE`. Teste determinístico de lock e disputas HTTP reais aceitam somente emissão/409 ou 404/exclusão. |
| Alta | O slot de conta expirava em 30 s sem ser renovado pela sessão, liberando personagens ainda ativos para exclusão e permitindo ultrapassar o teto. | Renovação conjunta do lease e slot. Testes Redis e processo compilado confirmaram sessão desanexada e DELETE 409 após 32 s. |
| Alta | A sessão era criada antes de confirmar o registro Redis; outro nó podia sobrescrever seu registro. | `prepare` aguarda registro condicionado à reserva e recusa sobrescrita de sessão viva; duas preparações locais compartilham uma promessa. |
| Alta | Conta legada ou de desenvolvimento podia ser reassociada automaticamente por coincidência de e-mail, sem prova adicional de ownership. | Upsert exclusivo por `external_auth_id`; conflito de e-mail não altera vínculo e retorna 409. Testes Postgres cobrem identidade diferente e login simultâneo. |
| Média | `state` tinha validade apenas no cookie, sem consumo único ou expiração validada pelo servidor. | Namespace Redis próprio, TTL de 600 s, consumo atômico e limpeza do cookie no callback. |
| Média | Login deixava a credencial anterior apresentada válida até o TTL. | Rotação e revogação da credencial antiga na mesma transação Redis; testes de replay da credencial antiga. |
| Média | CORS e `SameSite=Lax` eram a única proteção das mutações; subdomínios do mesmo site não estavam isolados. | Verificação de `Origin`, `Referer` e Fetch Metadata nas mutações, inclusive logout. Testes de origem hostil e mesmo site. |
| Média | Logs HTTP podiam registrar code/state da callback; respostas privadas não proibiam cache e falhas de dependência vazavam detalhes. | Serializador remove query/cookies, `private, no-store` e resposta sanitizada em falha de infraestrutura. |
| Média | Erro de Redis no handshake podia virar rejeição assíncrona não tratada e parar o processo de jogo. | Resposta 503 com tratamento de abort; teste de WebSocket real confirma que `/healthz` continua respondendo após falha. |
| Média | A factory inicial ignorava o registro criado e entrava com placeholder level 8 / XP 4200. | Ticket leva level/XP obtidos do banco pelo servidor; factory usa esses valores, com regressões de estado inicial e payload forjado. |
| Média | Não havia migração para o banco inglês existente; o arquivo histórico em português foi alterado indevidamente no anexo. | Migração inicial versionada, upgrade transacional próprio e preservação do arquivo histórico. Testes de preservação de personagem/Premium/ledger e rollback por colisão. |
| Média | Validação de nome ocorria antes da normalização e aceitava nomes curtos após trim; representação Unicode não era consistente. | NFC, tamanho após normalização, rejeição de controles e constraint/índice no Postgres. |
| Média | `bigint` de XP/gold/stamina podia atravessar como `number` impreciso. | Recusa explícita de valores fora do intervalo inteiro seguro, sem alterar balanceamento. |
| Média | O adaptador WorkOS não limitava o tempo da troca de código e seguia redirects HTTP. | Timeout de 10 s, `redirect: error`, resposta validada e `sid` obrigatório para o fluxo hospedado. |
| Média | A versão enviada não passava no typecheck por incompatibilidade de logger Fastify. | Composição usa o contrato `FastifyBaseLogger`, sem cast para esconder incompatibilidade. |
| Média | Entrada local não carregava `.env` e executava o carregador de conteúdo a partir do diretório errado; runtime Docker não copiava os dados de conteúdo. | `pnpm dev` executa na raiz com `--env-file`; runtime inclui `content/data`; variável corrigida para `PROCESSES`. |

Nenhum problema classificado como crítico foi confirmado nesta revisão. Esta classificação
não equivale a uma auditoria externa nem a uma prova de ausência de vulnerabilidades.

## Estado das garantias solicitadas

- Cookies: `HttpOnly`, `SameSite=Lax`, `Secure` em produção, expiração explícita; state restrito
  ao caminho do callback. Origens/redirects produtivos exigem HTTPS; modo dev é proibido no boot.
- Sessões HTTP: tokens opacos aleatórios, TTL absoluto de 12 h, sem renovação pela leitura,
  recuperação pelo Redis, rotação e logout invalidando a chave. Falha do Redis recusa acesso.
- WorkOS: **nenhum SDK instalado**. O adaptador usa `fetch`; `user.id`/`user.email` vêm da
  resposta autenticada HTTPS e `sid` é extraído exclusivamente para logout, nunca para autorizar
  requests. Não há método de SDK antigo/inexistente usado pela aplicação.
- Personagens: criação sem vocação, level 1, XP/gold 0, capacidade 400, stamina 86.400.000 ms
  e timestamp; Coins na conta e Premium no personagem. IDs novos são UUID em colunas `text`
  existentes; timestamps Postgres usam timezone e respostas usam ISO UTC.
- Ownership: listagem/seleção/exclusão/ticket derivam conta da sessão HTTP. Personagem de outra
  conta e personagem removido não geram ticket; payload não define estado de progressão.
- Banco: FKs, unicidade de identidade externa, índice de nome parcial case-insensitive e NFC.
  Soft delete preserva linha e proveniência; o nome fica disponível novamente como já definido
  na implementação recebida. Não há limite total de personagens por conta.
- Redis/game: namespaces distintos para HTTP/state/ticket; ticket tem TTL curto e uso único,
  é vinculado ao nó e reserva um dos dois slots atomicamente. Cookie HTTP não é aceito como ticket.
  Registro de sessão é confirmado antes do upgrade, e desconexão não encerra a sessão.
- TypeScript: código de aplicação continua TypeScript; lint de fronteiras e typecheck passam.
  SQL de migração e JSON de metadados são dados/DDL, não introdução de código JavaScript.

Contratos WorkOS conferidos em documentação primária:
[autorização](https://workos.com/docs/reference/authkit/authentication/get-authorization-url),
[troca de código](https://workos.com/docs/reference/authkit/authentication) e
[logout](https://workos.com/docs/reference/authkit/logout).

## Testes adicionados ou ampliados

`api/auth.test.ts`, `auth/cookies.test.ts`, `auth/sessions.test.ts` e `auth/workos.test.ts`
cobrem dev login, recuperação, rotação, logout, state, replay, expiração, formato inválido,
flags de cookies, redirects e contrato HTTP do provedor.

`api/characters.test.ts`, `db/repository.test.ts` e `db/upgrade-existing-schema.test.ts`
cobrem criação, valores iniciais, nomes, Unicode, ownership, soft delete, constraints,
concorrência, valores numéricos seguros e migração com preservação/rollback.

`api/security.test.ts`, `api/integration.test.ts`, `api/tickets.test.ts`, `tickets.test.ts`,
`directory.test.ts`, `game/host.test.ts` e `game/sessions.test.ts` cobrem CSRF, cache/logs,
HTTP + Postgres + Redis + WebSocket reais, limite de ativos, competição por ticket/exclusão,
reconexão, rejeição de cookie como ticket e falhas de infraestrutura.

A verificação adicional executou `dist/main.js` com `api,game,jobs`: login → criar personagem →
ticket → welcome → fechar socket → esperar 32 s → confirmar sessão e slot → DELETE 409 →
logout → `/auth/me` 401. Ela confirma também a composição real da entrada compilada.

## Resultados exatos dos comandos

Ambiente: Node 24.14.1, pnpm 10.0.0, Postgres 17 e Redis 7 descartáveis. O teste final usa
`TEST_REDIS_URL` e `DATABASE_TEST_URL` explícitos. Nenhum teste foi pulado.

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0; lockfile atualizado, instalação concluída |
| `pnpm check` | exit 0; lint, typecheck, 30 arquivos / 232 testes, docs-check e source-policy aprovados |
| `pnpm build` | exit 0; `tsc -b` aprovado; Vite 6.4.3, 25 módulos; JS 143,71 kB / gzip 46,15 kB |
| `pnpm test` | exit 0; Vitest 4.1.11, 30 arquivos / 232 testes aprovados |

Trechos da saída final de `pnpm check`:

```text
Test Files  30 passed (30)
     Tests  232 passed (232)
docs-check: passed — no problems found.
source-policy: passed — no first-party JavaScript.
```

O docs-check lista oito decisões de produto já abertas como informação, sem falha. A instalação
emite um aviso de depreciação `url.parse()` de dependência, sem impedir instalação/verificação.

## Pendências e limites

FUN-10 permanece pendente de teste com WorkOS real em HTTPS, inclusive as URLs permitidas do
tenant e o término da sessão hospedada. A resposta de logout informa uma URL: o consumidor
precisa navegar até ela para encerrar também a sessão WorkOS; a sessão Redis local já está
invalidada. Não foi implantado cliente visual para demonstrar isso.

A revogação externa continua limitada pelo TTL local conforme ADR 0012; não foi introduzido
webhook de revogação. Falta de persistência/retomada e máquina de estados de jogo continua em
suas issues próprias, sem ser apresentada como concluída pela integração de admissão.

Banco existente requer o upgrade documentado em `docs/product/accounts-and-characters.md`.
Colisões legadas de nomes precisam ser resolvidas explicitamente. A migração inicial Drizzle
é para banco novo; um banco legado ainda sem journal exige baseline revisada antes de futuras
migrações pelo journal.

## Incidente durante a execução

Uma execução preliminar usou o Redis local padrão e executou `FLUSHDB` nos bancos 1 e 2. Não
há snapshot nem evidência sobre o conteúdo anterior desses bancos. O usuário foi informado.
O helper passou a exigir `TEST_REDIS_URL`, e as verificações seguintes usaram somente o Redis
descartável dedicado. Postgres foi testado em schemas isolados; banco de aplicação do usuário
não recebeu migração.
