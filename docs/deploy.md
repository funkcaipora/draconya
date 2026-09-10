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
[ADR 0021](adr/0021-coolify-same-origin-deployment.md) registra a topologia. O repositório
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

O frontend atual é a casca do jogo: a seleção de personagem ainda vem de `?character=<id>`.
As telas de login e seleção de personagem não fazem parte deste deploy.

Referência operacional: [Docker Compose no Coolify](https://coolify.io/docs/applications/build-packs/docker-compose).

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
