# Deploy

Local primeiro; VPS em São Paulo depois. Ver [`infraestrutura.md`](infraestrutura.md) para
fornecedores e custo, e o [ADR 0013](adr/0013-imagens-multi-arquitetura.md) para arquitetura.

## Local

```bash
docker compose up -d          # Postgres e Redis
cp .env.example .env
pnpm install
pnpm dev                      # os três papéis num processo
```

`pnpm dev` sobe em **modo solo**. Para separar:

```bash
PROCESSOS=game pnpm dev
PROCESSOS=api,jobs pnpm dev
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

`PROCESSOS` decide quais sobem. A mesma imagem serve para o modo solo e para um papel por
container — validar numa VPS pequena não exige desenho diferente do de escala.

## Drenagem

Em `SIGTERM`, o processo drena na ordem `api` → `jobs` → `game`, com prazo de 25 s.

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
