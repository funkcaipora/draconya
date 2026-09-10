# Deploy

Local primeiro; VPS em São Paulo depois. Ver [`infrastructure.md`](infrastructure.md) para
fornecedores e custo, e o [ADR 0013](adr/0013-multi-architecture-images.md) para arquitetura.

## Local

```bash
docker compose up -d          # Postgres e Redis
cp .env.example .env
pnpm install
pnpm dev                      # os três papéis num processo
```

`pnpm dev` sobe em **modo solo**. Para separar:

```bash
PROCESSES=game pnpm dev
PROCESSES=api,jobs pnpm dev
```

Nada precisa ser hospedado até a Fase 2 terminar: o critério de saída da Fase 1 — fechar o
navegador, voltar e encontrar a sessão rodando — é testável inteiro em `localhost`, incluindo
`kill -9` no nó e drenagem em deploy.

## Os três papéis

| Papel | Estado | Escala | O que faz |
|---|---|---|---|
| `api` | stateless | N réplicas | HTTP: auth, tickets, personagens, market, pagamentos |
| `game` | **stateful** | N, sessão presa ao nó | WebSocket; hospeda as sessões |
| `jobs` | singleton com lock | 1 | Agendador, expirações, reconciliação, sessão órfã |

`PROCESSES` decide quais sobem. A mesma imagem serve para o modo solo e para um papel por
container — validar numa VPS pequena não exige desenho diferente do de escala.

## Drenagem

Em `SIGTERM`, o processo drena na ordem `api` → `jobs` → `game`, com prazo de 25 s.

O `game` faz, nessa ordem: para de aceitar sessão nova → grava o snapshot de todas → **encerra
cada uma creditando o progresso** → manda o extrato para quem estiver anexado → some com o
snapshot e o registro no diretório de quem creditou.

**Medido**, com 100 sessões ativas e socket aberto em todas:

| | |
|---|---|
| `SIGTERM` até o processo sair | 179 ms |
| drenagem em si | 129 ms — **1,29 ms por sessão** |
| jogadores avisados | 100/100 |
| extratos creditados no ledger | 100/100 |
| sessões órfãs deixadas para trás | 0 |

Nesse ritmo, 5.000 sessões drenam em cerca de 6,5 s, com folga confortável dentro dos 25 s. **O
número que importa não é a média, é o teto**: drenagem interrompida no meio é pior que drenagem
nenhuma, porque metade credita e metade some, e ninguém sabe qual metade. Ao configurar
`terminationGracePeriod` no orquestrador, meça de novo com a carga real e deixe margem.

Uma sessão que falha ao creditar **fica** com snapshot e registro, de propósito: ela volta pelo
caminho de retomada (FUN-28) na próxima conexão. Voltar retomável é melhor que sumir sem
crédito.

A ordem não é arbitrária. O `api` sai primeiro para parar de emitir ticket; o `jobs` em
seguida para não competir por sessão órfã; e o `game` por último, com o prazo inteiro, porque
é ele que precisa **creditar progresso de quem não está olhando** (FUN-29).

O `stop_grace_period` do compose é 40 s, maior que os 25 s de drenagem de propósito:
**drenagem interrompida no meio é pior que drenagem nenhuma**, porque metade credita e metade
some. Se um dia o nó tiver milhares de sessões, meça quanto a drenagem leva de verdade e ajuste
os dois números juntos.

Segundo `SIGTERM` força saída imediata — se o operador mandou duas vezes, ele quer agora.

## VPS

```bash
git clone <repo> /srv/draconya && cd /srv/draconya
cp .env.example .env    # preencha POSTGRES_PASSWORD e o resto
docker compose -f compose.prod.yml up -d --build
```

Atualizar é `git pull && docker compose -f compose.prod.yml up -d --build`. Nenhum passo manual;
é isso que torna a troca de fornecedor uma tarde.

Em VPS x86 a plataforma do build é `linux/amd64`; no Oracle Ampere, `linux/arm64`. Está no
`compose.prod.yml`, comentado.

**O Postgres não publica porta.** Só é alcançável pela rede interna do compose — publicar a 5432
numa VPS é como a maioria dos bancos vaza.

## Coolify

Use o Build Pack **Docker Compose**, base `/` e arquivo `/compose.coolify.yml`. O
[ADR 0022](adr/0022-coolify-same-origin-deployment.md) registra a topologia. O repositório
privado precisa de GitHub App autorizado ou chave de deploy somente de leitura.

Configure estas variáveis no recurso do Coolify:

| Variável | Valor |
|---|---|
| `POSTGRES_PASSWORD` | Senha aleatória em hexadecimal, compatível com a URL de conexão |
| `APP_ORIGIN` | Origem HTTPS do cliente, sem barra final |
| `GAME_PUBLIC_URL` | A mesma origem com `wss://`, terminando em `/ws` |
| `WORKOS_API_KEY` | Chave do ambiente WorkOS |
| `WORKOS_CLIENT_ID` | Client ID do mesmo ambiente WorkOS |

Associe somente o serviço `web`, porta interna 80, ao domínio HTTPS de `APP_ORIGIN`.
Autorize `<APP_ORIGIN>/api/auth/callback` como redirect URI no WorkOS. As credenciais ficam
somente no runtime do `app`; não habilite sua injeção como argumentos de build.

O cliente usa a API da mesma origem; `/ws` preserva o upgrade WebSocket até o `game`.
PostgreSQL e Redis não publicam portas. O `app` aplica as migrações versionadas antes de
iniciar e mantém `stop_grace_period: 40s`. Use uma única réplica do `app` nesta topologia.

Verifique o status saudável dos quatro serviços, a abertura do cliente por HTTPS e as rotas
`/api/auth/me` (401 sem login) e `/api/auth/login` (redirect WorkOS). `/healthz` no endereço
público verifica o Nginx; o healthcheck interno de `app` verifica o servidor.

O frontend serve a entrada: abrir a origem leva à tela de login, e depois dela à lista de
personagens, com criação e escolha (FUN-97). `?character=<id>` continua funcionando como atalho
de desenvolvimento — o critério de saída da F1 e o cliente sintético de carga entram sem tela.

Referência operacional: [Docker Compose no Coolify](https://coolify.io/docs/applications/build-packs/docker-compose).

### Staging

O primeiro ambiente remoto é **staging**, no projeto Draconya do Coolify. Sua origem é
`https://draconya-staging.179-197-227-14.sslip.io`. O processo mantém `NODE_ENV=production`
para cookies seguros e validação de configuração; esse valor é o modo do runtime Node,
não o nome do ambiente de implantação.

No GitHub, o environment `staging` guarda `WORKOS_API_KEY`, `WORKOS_CLIENT_ID` e
`POSTGRES_PASSWORD` em **Secrets**. `APP_ORIGIN` e `GAME_PUBLIC_URL` ficam em **Variables**.
O job `deploy staging` de `.github/workflows/ci.yml` sincroniza esses valores no Coolify
antes de cada deploy. O GitHub é a fonte dessa configuração; alterações manuais no Coolify
serão sobrescritas na próxima execução.

O environment também guarda o Secret `COOLIFY_API_TOKEN` e as Variables `COOLIFY_URL` e
`COOLIFY_APP_UUID`. O token dedicado tem permissões `read`, `write` e `deploy`, sem `root`
nem leitura de dados sensíveis. Ele expira em um ano; sua renovação exige atualizar esse
Secret. O token é limitado pelo time no Coolify, não pelo recurso.

Após push na `main`, o deploy aguarda os três checks (`docs`, `code` e `image`). PRs nunca
recebem os secrets do job de deploy. O job fixa `git_commit_sha` no SHA aprovado, desativa
o auto-deploy por webhook, sincroniza a configuração e aguarda o resultado do Coolify.
Ele só passa depois de confirmar o SHA publicado, estado saudável e rotas HTTPS.

**As rotas públicas aceitam espera, não afrouxamento.** `running:healthy` é a visão do Coolify
sobre o contêiner; o proxy reverso ainda pode estar trocando o upstream, e nesse instante a rota
devolve 503. O critério continua sendo o status exato — o que existe é um prazo de até um minuto
por rota. Esgotado, a falha diz o último status, porque "nunca subiu: HTTP 503" leva a algum
lugar e "falhou" não.
Execuções de deploy são serializadas; uma execução cujo SHA já não é o topo da `main`
é ignorada para impedir que um CI antigo reverta o staging.

Para reaplicar secrets sem commit novo, execute **Actions → CI → Run workflow → main**.
Esse caminho também repete os checks antes do deploy. Alterar um Secret sozinho não dispara
o workflow. A senha de um PostgreSQL já inicializado não muda com `POSTGRES_PASSWORD`:
uma rotação exige alterar a senha do usuário no banco e atualizar o Secret de forma coordenada.
Não apague o volume para trocar a senha.

**O gatilho de deploy é `POST`.** Desde o Coolify 4.2.0, todo endpoint que muda estado — `deploy`,
`start`, `stop`, `restart`, `enable`, `disable`, validação de servidor — exige POST, e o GET
equivalente responde **405**. Com GET, o sintoma é o pior possível: as variáveis são
sincronizadas, o commit é fixado, o job falha, e o build **nunca começa** — staging fica parado no
commit anterior enquanto a `main` anda. Aconteceu por seis entregas seguidas.

**O job de deploy não roda em PR** (`github.ref == 'refs/heads/main'`), então `gh pr checks` nunca
mostra que ele quebrou. Depois de mergear, confira a execução da `main`:

```bash
gh run list --branch main --limit 1
```

Em falha, consulte o job e a execução correspondente no Coolify. Não há rollback automático
de banco. Um timeout no GitHub não cancela um build remoto já iniciado; confira seu estado
antes de tentar novamente.

A injeção automática de argumentos de build fica desativada no Coolify; a chave WorkOS e a
senha PostgreSQL ficam disponíveis somente no runtime. Nenhum segredo entra no Git ou no
build estático do cliente.

O Coolify interpreta o Compose com um arquivo de variáveis de build separado. Por isso,
as duas credenciais de runtime aceitam interpolação vazia nessa etapa. Isso não libera o
boot sem credenciais: a validação do servidor exige WorkOS, e o PostgreSQL exige senha.

## Backup

```bash
./scripts/backup-postgres.sh
```

No cron, diariamente. Com `R2_BUCKET` definido, envia também para o Cloudflare R2 (egresso
zero, e fora da máquina que pode morrer).

O script recusa dump menor que 1 KB, porque **dump truncado é pior que backup nenhum**: ele
passa despercebido até o dia em que você precisa dele.

**Backup que nunca foi restaurado não é backup, é esperança.** Teste a restauração pelo menos
uma vez, e de novo quando o schema mudar de forma.

## O que ainda falta para produção de verdade

Nenhum destes bloqueia a validação, e todos bloqueiam jogadores pagantes:

- TLS — Caddy ou Traefik na frente, com certificado automático
- WebSocket atrás do proxy com `Upgrade` preservado e timeout longo
- Firewall: expor só 80 e 443
- Métricas saindo da VPS para o Grafana Cloud
- Restauração de backup testada
