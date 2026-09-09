# Contas, autenticação e personagens

**Status:** parcial — autenticação e CRUD inicial implementados; onboarding visual e escolha de vocação continuam pendentes
**PRD:** §7.1–§7.4
**Épico:** E0

## Comportamento

A identidade da conta é autenticada pelo WorkOS AuthKit. No fluxo real, o `api` redireciona para o Hosted AuthKit, recebe o authorization code no callback e liga o usuário externo a uma linha local de `account` por `external_auth_id`. Depois da autenticação, o Draconya cria uma sessão HTTP própria no Redis e envia ao navegador apenas um token opaco em cookie httpOnly; a credencial do provedor nunca segue para o WebSocket do jogo.

Em desenvolvimento, `AUTH_DEV_MODE=true` substitui o redirect por `POST /api/auth/dev-login`: qualquer e-mail sintaticamente válido cria ou recupera a conta local sem verificação externa. Esse modo é recusado no boot em produção.

Um personagem só ocupa um dos dois slots ativos da conta enquanto tem sessão hospedada. Quem
fecha o navegador e não volta deixa de ocupar depois de **cinco minutos** de repouso: a sessão de
cidade é orientada a evento, não rende nada, e recolhê-la devolve o slot. Uma **hunt desanexada
nunca é recolhida** — desconectar não pode encerrar nada, ou o modo idle deixa de existir
(ADR 0001). A carência existe para reconexão não virar rotatividade: recarregar a página ou
perder o Wi-Fi por um instante não custa a sessão.

Sem sessão hospedada, o personagem continua **na cidade** — repouso não precisa de nó.

O estado de atividade que a API devolve (`state`, `sessionId`) vem do **diretório de sessões**,
não da coluna do banco. A coluna existe e não é escrita por ninguém: a verdade sobre em que
atividade o personagem está é a sessão, e a sessão vive no Redis (invariante 8). Lendo a coluna,
a API respondia `"city"` para quem estava numa hunt havia seis horas — uma mentira quieta, do
tipo que só aparece quando alguém confia nela. Sem sessão no diretório, o estado cai para o da
linha, que é o personagem descansando.

Uma conta pode criar personagens sem limite de quantidade. O personagem nasce no level 1, sem vocação, com a stamina cheia e no estado `city`. Coins pertencem à conta; Premium pertence ao personagem. A seleção do personagem é uma leitura autenticada, e a entrada no jogo continua sendo feita pelo ticket de sessão separado.

Excluir um personagem usa soft delete para preservar identidade histórica e futura proveniência de itens/ledger. Um personagem reservado como ativo no Redis — inclusive com ticket emitido ainda não consumido — não pode ser excluído. Nomes são comparados sem diferenciar maiúsculas/minúsculas; após o soft delete, o nome volta a ficar disponível para outro personagem.

## Regras

- WorkOS autentica a identidade; Draconya mantém a sessão HTTP do aplicativo no Redis.
- Sessão HTTP usa cookie httpOnly, `SameSite=Lax` e `Secure` em produção.
- `AUTH_DEV_MODE=true` só existe para desenvolvimento e nunca pode subir em produção.
- Coins ficam em `account.coins`.
- Personagem nasce com `vocation = NULL`; a escolha continua reservada ao level 8.
- Premium é por personagem (`premium_until`).
- Stamina nasce em 24 horas e é representada por `stamina_ms` + `stamina_updated_at`.
- Personagens por conta são ilimitados; o teto de dois é de personagens ativos e fica no Redis.
- Nome de personagem é único entre personagens não excluídos, sem diferenciar caixa.
- Exclusão é soft delete (`deleted_at`) e é recusada enquanto o personagem estiver ativo/reservado.
- O cookie de login nunca é aceito pelo processo `game`; o socket usa ticket de uso único.

## API implementada

| Método | Rota | Função |
|---|---|---|
| GET | `/api/auth/login` | inicia Hosted AuthKit para login |
| GET | `/api/auth/register` | inicia Hosted AuthKit para cadastro |
| GET | `/api/auth/callback` | valida `state`, conclui login e cria sessão local |
| GET | `/api/auth/me` | devolve a conta autenticada |
| POST | `/api/auth/logout` | encerra sessão local e informa URL de logout do WorkOS quando aplicável |

### Desconectar não é sair

São duas coisas diferentes, e a distinção decide quando um slot de personagem ativo volta.

**Desconectar** (fechar a aba, cair a rede) não encerra nada. A sessão continua no nó, e uma
hunt continua rendendo — é o [ADR 0001](../adr/0001-session-decoupled-from-connection.md), e é
o produto inteiro.

**Sair** é o `logout` do protocolo de jogo (opcode C2S 8). Esse encerra a sessão pelo ruleset,
solta o registro no diretório e **devolve o slot** da conta. Todas as abas daquele personagem
são fechadas junto: sair é do personagem, não da aba.

O `POST /api/auth/logout` do HTTP é outra coisa ainda — ele encerra a sessão de *conta* e não
fala com os nós de jogo. Sair do jogo com o personagem exige o `logout` do socket.

Fica em aberto o caso de quem fecha o navegador e nunca mais volta: hoje esse personagem
segura o slot indefinidamente ([FUN-52](https://linear.app/funkcaipora/issue/FUN-52)). Fechar
isso exige a máquina de estados do personagem (FUN-30), que é quem sabe quando uma sessão de
repouso pode ir embora.
| POST | `/api/auth/dev-login` | login local, somente com `AUTH_DEV_MODE=true` |
| GET | `/api/characters` | lista personagens não excluídos da conta |
| POST | `/api/characters` | cria personagem |
| POST | `/api/characters/:id/select` | seleciona/consulta personagem da própria conta |
| DELETE | `/api/characters/:id` | soft delete se não estiver ativo |

## Parâmetros

| Parâmetro | Valor atual | Onde mora |
|---|---|---|
| TTL da sessão HTTP | 43.200 s (12 h) | `AUTH_SESSION_TTL_SECONDS` |
| Stamina inicial | 86.400.000 ms (24 h) | `packages/server/src/db/schema.ts` |
| Capacidade inicial | 400 | `packages/server/src/db/schema.ts` |
| Level inicial | 1 | `packages/server/src/db/schema.ts` |

## Em aberto

- A UI própria/headless do AuthKit é suportada pela API do WorkOS, mas o MVP usa Hosted AuthKit. A migração para UI embutida só deve acontecer se o redirect se mostrar ruim para a experiência.
- A duração de 12 horas da sessão HTTP é operacional, não balanceamento de jogo, e pode ser ajustada por ambiente.
- A sessão local não consulta o WorkOS a cada request. Revogação externa pode levar até o TTL local para refletir no Draconya; o MVP aceita esse atraso em troca de não colocar o provedor no caminho quente de cada request autenticado.

## Divergências do PRD

A autenticação não é implementada pelo Draconya; credenciais, verificação de e-mail e recuperação de senha são delegadas ao WorkOS por decisão do ADR 0012. Isso não altera as regras econômicas ou de personagem do PRD.

## Garantias de segurança e persistência verificadas

`external_auth_id` é a única chave de identidade. E-mail coincidente não liga automaticamente
contas de desenvolvimento, legadas ou de outro usuário externo. O conflito retorna HTTP 409
sem transferir personagens ou Coins.

O TTL HTTP é absoluto: ler a sessão não prolonga suas 12 horas. Novo login revoga o token
anterior apresentado; logout remove a chave Redis. O `state` de autorização dura 600 segundos
no Redis, é vinculado ao cookie e consumido uma única vez. O callback usa somente destinos
configurados e HTTPS em produção. Mutações HTTP verificam `Origin`/`Referer` e metadados do
navegador; respostas privadas usam `Cache-Control: private, no-store`.

Exclusão e emissão de ticket adquirem a mesma trava de linha do Postgres. A reserva Redis e a
criação do ticket ocorrem atomicamente. O registro do nó não pode sobrescrever uma sessão viva
em outro nó; slots e leases são renovados juntos. O ticket leva `level` e `xp` lidos do banco,
e o primeiro socket usa esses valores. Não há consulta ao Postgres por ação ou tick.

Nomes são normalizados em NFC antes da validação de tamanho (2–30 caracteres), sem controles.
O banco exige NFC e mantém índice único parcial em `lower(normalize(name, NFC))`, somente
para personagens sem `deleted_at`. IDs novos usam UUID; colunas continuam `text` por
compatibilidade. `xp`, `gold` e `stamina_ms` são `bigint` no Postgres; a fronteira recusa valores
fora de `Number.MAX_SAFE_INTEGER`, em vez de devolver progresso arredondado.

## Migração de banco

Banco novo e vazio: execute `DATABASE_URL=... pnpm db:migrate`. A migração versionada em
`packages/server/migrations/` cria tabelas, FKs, defaults, índices e registra o journal Drizzle.
Não execute a migração inicial sobre tabelas que já existem.

Banco existente da `main` anterior à FUN-11: execute
`packages/server/src/db/upgrade-existing-schema.sql` com um cliente Postgres configurado com
`ON_ERROR_STOP`. Ela adiciona soft delete, normaliza nomes e recria a unicidade numa transação.
Nomes legados que colidem fazem a transação falhar e preservam os dados anteriores; resolva
as colisões explicitamente, sem apagar personagens automaticamente. O teste de migração
comprova preservação de Premium, personagem e ledger, além do rollback em colisões.

Esse banco legado, criado via `db:push`, continua sem journal da migração inicial. Não execute
`db:migrate` nele sem antes estabelecer uma baseline revisada do journal; o SQL de atualização
é o caminho de entrega desta revisão para esse caso. Bancos ainda com nomes em português
aplicam primeiro `rename-legacy-schema.sql`, preservado como migração histórica.

## WorkOS e validação externa

Não há SDK WorkOS instalado: `auth/workos.ts` usa `fetch` contra a API HTTP oficial, com timeout
de 10 segundos e redirects desabilitados na troca de código. Foram conferidos os contratos de
[autenticação](https://workos.com/docs/reference/authkit/authentication),
[autorização](https://workos.com/docs/reference/authkit/authentication/get-authorization-url) e
[logout](https://workos.com/docs/reference/authkit/logout).

Configure `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI` e `API_ORIGIN`; em produção
as URLs devem usar HTTPS e `AUTH_DEV_MODE=false`. Registre callback e destino de logout no
Dashboard WorkOS. As credenciais e o tenant real não foram exercitados nesta revisão: o teste
externo de cadastro/login/logout em HTTPS continua necessário para encerrar a FUN-10.
