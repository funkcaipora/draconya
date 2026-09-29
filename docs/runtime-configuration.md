# Configuração por papel e persistência do bot

Contrato vigente desde a issue #263 e o [ADR 0028](adr/0028-role-configuration-and-bot-write-behind.md).
Implementação: `packages/server/src/config.ts`, `main.ts`, `bot-config-store.ts`,
`jobs/bot-config.ts` e `jobs/character-state.ts`.

## Seleção e requisitos

`PROCESSES` é uma lista separada por vírgulas, com espaços opcionais. Ausente significa
`api,game,jobs`. Lista vazia, papel desconhecido, duplicata ou a variável antiga `PROCESSOS`
recusam o boot antes de abrir conexões. Não usar a ausência da variável para pedir só um papel.

| Configuração | `api` | `game` | `jobs` |
|---|---|---|---|
| `REDIS_URL` | obrigatória | obrigatória | obrigatória |
| `DATABASE_URL` | obrigatória | não exigida; não abre conexão mesmo se fornecida | obrigatória |
| `WORKOS_API_KEY` e `WORKOS_CLIENT_ID` | obrigatórias em produção; nos outros ambientes, ambas ou nenhuma | não exigidas | não exigidas |
| `API_ORIGIN` | origem HTTP(S), HTTPS em produção | sem exigência de HTTPS | sem exigência de HTTPS |
| `WORKOS_REDIRECT_URI` | HTTP(S), HTTPS em produção | sem exigência de HTTPS | sem exigência de HTTPS |
| `GAME_PUBLIC_URL` | sem exigência de WSS | `ws/wss`, obrigatoriamente `wss` em produção | sem exigência de WSS |
| `API_PORT` / `GAME_PORT` / `JOBS_PORT` | escuta em 3000 por padrão | escuta em 7171 por padrão | métricas em 3001 por padrão |
| `AUTH_DEV_MODE` | `true` só fora de produção | `true` também é recusado em produção | `true` também é recusado em produção |

Combinações usam a união dos requisitos. Valores fornecidos continuam passando pela validação
sintática do schema, mesmo quando seu papel não foi selecionado. `DATABASE_URL` vazio é
ausente; `REDIS_URL` não tem default. Credenciais WorkOS vazias são ausentes.

`API_ORIGIN` não aceita credenciais, caminho além de `/`, query ou fragmento e é normalizada
para a origem. `GAME_PUBLIC_URL` não aceita credenciais, query ou fragmento: o ticket será
adicionado depois. O default local é `ws://localhost:7171`, portanto produção com `game`
precisa fornecer um endereço `wss`. O runtime permite hosts e caminhos por nó; o script
de staging continua validando `wss://<APP_ORIGIN>/ws`. WSS descreve o endereço **público**:
o TLS pode terminar no proxy, enquanto o `game` escuta HTTP/WebSocket na rede interna.

`CONTENT_DIR`, `THINGS_VERSION`, `NODE_ID`, `LOG_LEVEL` e `NODE_ENV` continuam comuns ao boot.
`THINGS_DIR` pertence a importação, inventário e testes de assets; não aparece no objeto
`Configuration` do servidor. Sua remoção não muda os scripts nem a localização dos assets.

## Exemplos de produção

Variáveis a fornecer a **cada container**, além do conteúdo e da imagem. Os endereços são
exemplos; senhas e credenciais devem vir do mecanismo de secrets do ambiente.

```dotenv
# game: não recebe DATABASE_URL nem credenciais WorkOS
PROCESSES=game
NODE_ENV=production
REDIS_URL=redis://redis:6379
NODE_ID=game-1
GAME_PUBLIC_URL=wss://game.example.com/ws
```

```dotenv
# jobs: não recebe credenciais WorkOS nem endereço público de socket
PROCESSES=jobs
NODE_ENV=production
REDIS_URL=redis://redis:6379
DATABASE_URL=postgres://draconya:<password>@postgres:5432/draconya
```

```dotenv
# api
PROCESSES=api
NODE_ENV=production
REDIS_URL=redis://redis:6379
DATABASE_URL=postgres://draconya:<password>@postgres:5432/draconya
API_ORIGIN=https://game.example.com
WORKOS_REDIRECT_URI=https://game.example.com/api/auth/callback
WORKOS_API_KEY=<secret>
WORKOS_CLIENT_ID=<client-id>
```

`AUTH_DEV_MODE` omitido é `false`. Ao usar `.env` compartilhado em desenvolvimento,
`PROCESSES=game pnpm dev` ainda pode receber variáveis extras; elas não criam conexões
de Postgres nem instanciam autenticação no `game`. Para separar produção, forneça somente
os segredos necessários. O modo solo do Compose atual continua `api,game,jobs`.

Migrações pertencem à etapa de deploy com acesso ao banco, antes de `api/jobs` aceitarem
trabalho. Este ajuste não faz o `game` executar migrations nem reorganiza o Compose.
O healthcheck padrão do Dockerfile aponta para a API (3000): containers separados precisam
do `/healthz` do `game` em 7171 e do `/metrics` do `jobs` em 3001, nas suas portas configuradas.
Um boot saudável não prova a saúde do loop de simulação; essa observabilidade continua na #225.

## Caminho de uma edição do bot

1. O socket envia `bot-config`. O host valida vocabulário, catálogo e gate de level contra
   o conteúdo da sessão. Configuração recusada não gera pendência.
2. A sessão aplica a regra imediatamente. `BotConfigStore.save` faz `HSET bot-config:pending
   <characterId> <envelope>`. Uma nova edição substitui a pendência anterior.
3. O host devolve `bot-config-result { ok: true }` somente após o Redis aceitar. Se não
   conseguir, devolve `ok: false` com motivo: a regra vale nesta sessão, mas é preciso tentar
   salvar novamente. Sem callback de persistência em fixtures, o comportamento de falha é igual.
4. `jobs` percorre o hash com `HSCAN`, no ciclo de 10 s. Para cada personagem, trava a linha
   do Postgres, lê a pendência e substitui `bot_config`. A preferência não movimenta valor
   e não gera linha econômica no ledger.
5. Depois do commit, um script Lua compara o envelope e remove apenas a edição processada.
   A edição nova sobrevive a um consumidor atrasado, inclusive quando é idêntica à anterior.
6. Na admissão, `settleCharacterState` processa a preferência antes do progresso. Sem
   pendência é um `HEXISTS` e nenhuma transação — o caso comum de toda listagem e de quase
   todo ticket. O callback atende a emissão solo, a party e a lista de personagens. O ticket
   continua carregando `InitialCharacter.botConfig`, lido do Postgres. O nó que recebe o
   ticket valida novamente a preferência contra seu conteúdo antes de adotá-la.

Não há schema ou protocolo novo: `character.bot_config` e `bot-config-result` já existiam.
Personagens antigos, inclusive os com `bot_config = null`, continuam compatíveis.

## Falhas, concorrência e operação

| Situação | Resultado e recuperação |
|---|---|
| Redis indisponível ao salvar | regra ativa na sessão, falha de salvamento no socket; jogador pode repetir |
| Postgres indisponível | pendência sem TTL permanece; próximo ciclo tenta novamente; admissão falha em vez de carregar preferência antiga |
| Queda depois do commit, antes do ACK | repete a substituição inteira; não duplica valor nem apaga edição nova |
| `api` e `jobs` concorrentes | trava da linha serializa a leitura da pendência e a escrita; leitura ocorre depois da trava |
| Edição durante a transação | ACK por comparação preserva a nova pendência para o próximo consumidor |
| Personagem excluído ou inexistente | consumidor descarta a pendência correspondente sem alterar personagem |
| Pendência corrompida (não é `{ id, config }`) | vai para `bot-config:corrupt`, sai da fila e a admissão segue com a linha do Postgres; erro no log; uma edição válida gravada por cima sobrevive (#265) |
| Perda do Redis antes da gravação durável | pode perder a última edição; AOF/backup são necessários; confirmação não equivale a commit de Postgres |

Para diagnóstico, `HLEN bot-config:pending` mostra quantos personagens aguardam gravação,
sem imprimir configurações, e `HLEN bot-config:corrupt` quantas entradas foram postas em
quarentena — o conteúdo fica lá, sem TTL, até quem investigar apagar com `HDEL`. Os logs
`Wrote bot configurations`, `Failed to persist bot configuration` e `Quarantined a corrupt
pending bot configuration` registram resultado/erro; falhas de itens também incrementam a
métrica de falha de ciclo. Não há alerta específico novo nesta entrega. Não usar
`DEL`/`FLUSHDB` para destravar a fila: isso apaga preferências ainda não duráveis.

Implantação separada: consumidores `api/jobs` primeiro, produtores `game` depois. Para
rollback, drenar o `game` novo, manter consumidores desta versão até o hash esvaziar e
só então restaurar consumidores antigos. O ADR 0021 fica como histórico substituído.

## Verificação reproduzível

- `config.test.ts`: matriz de requisitos, URLs inválidas, WSS em produção e remoção de
  `THINGS_DIR`; `main.test.ts` chama a seleção real, sem copiar sua implementação.
- `game/host.test.ts`: confirmação após persistência e erro sem desfazer a regra ativa.
- `api/phase-two-exit.postgres.test.ts`, bloco "persistência do bot entre processos":
  Redis/Postgres reais, ciclo de jobs, caso comum sem transação, retry após falha,
  concorrência com edição durante a transação, ACK antigo, exclusão, quarentena de entrada
  corrompida e socket em nó `game` sem banco → novo ticket → outro nó, antes de qualquer
  ciclo de `jobs`.

Antes da entrega, instalar com `pnpm install --frozen-lockfile`, fornecer
`TEST_REDIS_URL` e `DATABASE_TEST_URL` de serviços descartáveis e rodar `pnpm check` e
`pnpm build`. Os testes de Redis apagam os bancos 1 a 16 do destino de teste; o 0 continua
sendo o do desenvolvimento local. **O Redis de teste precisa de 32 bancos** (`redis-server
--databases 32`; o CI sobe por `docker run`, e quem roda a suíte localmente precisa subir o
`TEST_REDIS_URL` com o mesmo valor) — o `party-v2-exit.postgres.test.ts` usa o banco 16, e o
padrão de 16 bancos (0–15) faria `SELECT 16` cair no banco 0 em silêncio. Nunca apontar as
variáveis de integração para serviços de produção. Checks de assets sem pacote/OTBM local
avisam que não conferiram esses arquivos.

### Evidência da entrega — 2026-09-16

- `pnpm check` aprovado com Redis e PostgreSQL descartáveis: 134 arquivos, 1.968 testes
  aprovados e 9 pulados; lint, typecheck, docs-check e source-policy aprovados.
- Inventário Tibia 13.32 e regeneração dos mapas não conferidos: pacote de arte e OTBM
  ausentes neste worktree. Nenhum desses artefatos foi alterado nesta entrega.
- `pnpm build` aprovado; permanece o aviso de tamanho do bundle do cliente acima de 500 kB.
- `node packages/server/dist/main.js`, com ambiente isolado e `NODE_ENV=production`:
  `game` iniciou sem `DATABASE_URL` nem WorkOS; `jobs` sem WorkOS; `api` e modo solo também
  iniciaram. Cada papel respondeu em sua rota (`/healthz` ou `/metrics`) e encerrou com
  código 0 após `SIGTERM`. Credenciais WorkOS de teste só validaram o boot, não o login externo.
- Não houve deploy, alteração de banco de produção ou teste visual de navegador. O cenário
  de bot foi validado com socket real, API, Redis e PostgreSQL, incluindo troca do nó de jogo.
