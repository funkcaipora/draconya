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

## O pacote de arte

O cliente desenha com o pacote do Tibia (`things/<versão>/`, ADR 0008), e **tudo que o
Draconya usa sai da própria origem** — nenhum CDN, nenhum servidor de terceiros. O pacote não
está no Git nem na imagem (`things` está no `.gitignore` e no `.dockerignore`; não é nosso para
redistribuir): a imagem do `web` leva só o caminho, `VITE_THINGS_URL` (padrão `/things/1332`,
fixado no build do cliente), e o nginx serve o que estiver montado em
`/usr/share/nginx/html/things` (`deploy/nginx.conf`). Em dev, o Vite serve `things/` da raiz do
repositório no mesmo caminho — ver `packages/client/vite.config.ts`.

No Coolify o volume se chama `things` (`compose.coolify.yml`; no servidor, `<uuid do
recurso>_things` — em staging, `hzd0uu0cuitkdi4ie0h1mu5g_things`). Ele nasce vazio, e povoá-lo
é um passo manual, uma vez por versão do pacote. Sem SSH, o **Terminal do Coolify**
(menu lateral → Terminal → `localhost`) dá um shell de root no servidor e serve igual.

O caminho mais curto é o servidor baixar o pacote direto da origem, sem passar pela sua
máquina. Em staging foi feito assim em 2026-09-11 (4 173 arquivos, 81 MB, ~4 min):

```bash
cat > /root/fetch-things.sh <<'EOF'
#!/bin/sh
set -u
SRC=https://huntera.com.br/things/1332
mkdir -p /things/1332 && cd /things/1332 || exit 1
curl -sSfO "$SRC/catalog-content.json" || exit 1
jq -r '.[].file' catalog-content.json > /tmp/files
fetch() { [ -s "$1" ] || curl -sSf -o "$1" "$SRC/$1" || echo "FAIL $1"; }
n=0; while read f; do fetch "$f" & n=$((n+1)); [ $((n % 8)) -eq 0 ] && wait; done < /tmp/files
wait
echo "DONE $(ls | wc -l) files, $(du -sh . | cut -f1)"
EOF
```

```bash
nohup docker run --rm -v hzd0uu0cuitkdi4ie0h1mu5g_things:/things -v /root/fetch-things.sh:/fetch.sh:ro alpine:3 sh -c 'apk add -q curl jq && sh /fetch.sh' > /root/things-fetch.log 2>&1 &
```

Três `FAIL` são esperados: `staticdata`, `staticmapdata` e `map` são o minimapa do cliente
oficial, que a origem não serve e o Draconya não usa.

**Esse caminho NÃO traz a arte de UI.** A casca (moldura, pedra, slot, barras — FUN-108) lê
`things/<versão>/library/ui/images/*.png`, que é DERIVADO: `pnpm assets:library` extrai
essas imagens do `graphics_resources.rcc.lzma` na sua máquina (`docs/asset-library.md`), e a
origem não as serve (`…/library/ui/images/background.png` responde 404). Elas vêm da sua
máquina, sempre — mesmo quando o resto veio da origem. Só a subpasta, e depois para dentro do
volume (o `cp -r` funde com o que já está lá):

```bash
rsync -av things/1332/library/ui/images/ root@<servidor>:/root/things/1332/library/ui/images/
```

**Nem a pilha dos mapas.** Desde a FUN-121 o cliente desenha o mundo a partir de
`things/<versão>/maps/<mapId>.json` — a pilha de aparências por tile de cada mapa do conteúdo
(Thais e a Rat Cellars), que `pnpm map:import` deriva do OTBM na sua máquina (ADR 0025) e que
nunca é versionada nem vai na imagem. A origem não a serve, e sem ela o jogo abre com a grade
lisa de reserva: templo sem chão, bueiro sem parede, e nenhum erro além do 404 na aba de rede.
Ela sobe pelo MESMO caminho das imagens de UI — é a subpasta `maps/` inteira, dois arquivos
por versão hoje (1,0 MB na 13.32):

```bash
rsync -av things/1332/maps/ root@<servidor>:/root/things/1332/maps/
```

```bash
ssh root@<servidor> 'docker run --rm -v "$(docker volume ls -q | grep _things$)":/things -v /root/things:/src alpine cp -r /src/1332 /things/'
```

Se a origem sumir, o pacote INTEIRO vem da sua máquina pelo mesmo caminho, com um filtro que
deixa passar tudo da raiz — `maps/` incluída — e, de `library/`, SÓ `ui/images/` (o `cp -r` é
o mesmo de cima):

```bash
rsync -av --include='library/' --include='library/ui/' --include='library/ui/images/***' --exclude='library/*' --exclude='library/ui/*' things/1332/ root@<servidor>:/root/things/1332/
```

Os dois `--exclude` são necessários: só `--exclude='library/*'` deixaria `library/ui/` passar
inteira (fontes, cursores, minimapa), porque `ui/` casou no `--include` antes. Foi conferido a
seco contra a 13.32: da `library/`, entram os dois diretórios e os arquivos de `ui/images/`,
nada mais. O que precisa estar no volume:

- `catalog-content.json`, o `appearances-<hash>.dat` que ele aponta e as folhas
  `sprites-<hash>.bmp.lzma` (81 MB na 13.32) — o mundo;
- `maps/<mapId>.json`, um por mapa do conteúdo (`thais`, `rat-cellars`; 1,0 MB na 13.32) —
  a pilha de cada tile, saída de `pnpm map:import`. Confira contra a sua máquina, e não só o
  `200`: `curl -s <APP_ORIGIN>/things/1332/maps/thais.json | shasum -a 256` tem de dar o mesmo
  hash de `shasum -a 256 things/1332/maps/thais.json`. Um mapa reimportado com outra região ou
  outro OTBM muda de conteúdo no mesmo caminho, e o `Cache-Control` de um ano esconde a troca
  de quem já o tinha — por isso a conferência é pelo hash;
- `library/ui/images/` (9,4 MB, ~1 000 PNGs na 13.32, subpastas incluídas) — a casca. O
  cliente lê 17 deles, e é a lista de `UI_SKIN` e `SLOT_IMAGES` em
  `packages/client/src/assets/ui.ts`: `background.png`, `background-dark.png`,
  `3pixel-frame-borderimage.png`, `2pixel-up-frame-borderimage.png`, `containerslot.png`,
  `hitpoints-manapoints-bar-border.png`, `hitpoints-bar-filled.png`, `mana-bar-filled.png`,
  `inventory-head.png`, `inventory-neck.png`, `inventory-torso.png`, `inventory-legs.png`,
  `inventory-feet.png`, `inventory-left-hand.png`, `inventory-right-hand.png`,
  `inventory-finger.png`, `inventory-hip.png`. A subpasta vai inteira porque é pequena e o
  filtro fica em uma linha; se essa tabela crescer, nada muda aqui.

O resto de `library/` (índices, folhas PNG, quadros por id — 900 MB) é a biblioteca de
consulta do Claude Code e continua fora: não é servido nem lido pelo cliente.

Confira com `curl -sI <APP_ORIGIN>/things/1332/catalog-content.json` — `200` com
`Cache-Control: immutable` — e com
`curl -sI <APP_ORIGIN>/things/1332/library/ui/images/background.png`, que também tem de dar
`200`. O hash está no nome de cada folha, então a URL nunca muda de conteúdo e o cache de um
ano é seguro; trocar de versão do pacote é outro caminho, não outro conteúdo no mesmo caminho.
(As imagens de UI não têm hash no nome; mudam só com a versão do pacote, que já está no
caminho.)

**Trocar a versão do pacote é também regenerar o inventário** em
`packages/content/data/packs/` (`pnpm assets:inventory`, ver `docs/asset-library.md`): é contra
ele que o boot recusa um id de aparência que o pacote não tem (FUN-21). A versão servida é
`THINGS_VERSION` no Coolify (padrão `1332`): o compose deriva `VITE_THINGS_URL` dela, e o
`app` recusa subir se ela não for a versão do inventário contra o qual o conteúdo foi
conferido — um deploy apontando outro pacote não passa em silêncio.

**Sem o pacote o jogo abre.** O cliente avisa no console (`pacote de arte indisponível`) e
desenha retângulos: a arte é apresentação, e falta de arte nunca é falha de jogo. **Sem só a
arte de UI** — volume com catálogo, `.dat` e folhas, mas sem `library/ui/images` — o mundo
sai com sprite e a casca sai em cor lisa: o sintoma é só visual, com 404 de PNG na aba de
rede, e o remédio é o `rsync` acima. **Sem só os mapas**, o contrário: casca certa e mundo
em grade lisa, com 404 de `maps/<mapId>.json` — e o remédio é o outro `rsync`. Em staging os
dois faltaram por vezes diferentes (2026-09-11 a casca, 2026-09-12 os mapas), e cada um
parecia um defeito do cliente até alguém abrir a aba de rede.

## Backup

Staging roda por `compose.coolify.yml`, não por `compose.prod.yml` — por isso não é
`scripts/backup-postgres.sh` que faz o backup lá (ver "O que não muda" no fim desta seção). O
backup do staging é feito por **tarefas agendadas do próprio Coolify** (recurso `draconya` →
Automation → Scheduled Tasks), gravando num diretório montado por bind nos containers
`postgres` e `redis`.

### Onde os backups ficam

`compose.coolify.yml` monta, em cada um dos dois serviços, um segundo volume:

```yaml
- '/data/coolify/backups/draconya-staging:/backups'
```

É um **bind** (não volume nomeado) na mesma pasta onde o Coolify já grava os próprios backups
(`/data/coolify/backups`) — a subpasta `draconya-staging` é deste recurso. Bind, e não volume
nomeado, para que o dono do servidor copie os arquivos com `scp`/`rsync` direto do disco, sem
precisar entrar em nenhum container. Dentro de `/backups`, cada serviço escreve na sua própria
subpasta: `postgres/` e `redis/`.

### As três tarefas agendadas

Criadas em Coolify → recurso `draconya` → **Automation → Scheduled Tasks**. As três rodam como
root no container do serviço indicado — `sh -c '...'`, nunca bash: as imagens
`postgres:17-alpine` e `redis:7-alpine` só têm BusyBox, e `stat -c`, `find -mtime` e `date -u`
existem nas duas, mas nenhum comando aqui pode depender de bashismo.

O campo Command do Coolify é `varchar(255)`: passar da margem não recusa o comando ao salvar,
recusa com `SQLSTATE[22001]: String data, right truncated` — foi o que aconteceu com a primeira
versão do `postgres-dump` (mais legível, com espaços e aspas em `"$d"`/`"$f"`), que tinha 302
caracteres. Os três comandos abaixo são os que rodam em produção desde 2026-09-16: sem espaço
supérfluo, sem aspas onde a variável não tem por que conter espaço.

**`postgres-dump`** — cron `0 3 * * *` (UTC) — container `postgres` — timeout 600s:

```sh
sh -c 'set -e;d=/backups/postgres;mkdir -p $d;f=$d/draconya-$(date -u +%Y%m%dT%H%M).dump;pg_dump -U draconya -Fc draconya -f $f;[ $(stat -c %s $f) -gt 1024 ]||{ rm -f $f;exit 1;};find $d -name "*.dump" -mtime +14 -delete;ls -la $d'
```

**`redis-rdb`** — cron `10 3 * * *` (UTC) — container `redis` — timeout 300s:

```sh
sh -c 'set -e;d=/backups/redis;mkdir -p $d;redis-cli --rdb $d/dump-$(date -u +%Y%m%dT%H%M).rdb;find $d -name "*.rdb" -mtime +14 -delete;ls -la $d'
```

**`postgres-restore-test`** — cron `0 4 * * 0` (UTC, semanal, domingo) — container `postgres` —
timeout 600s:

```sh
sh -c 'set -e;createdb -U draconya restore_test;pg_restore -U draconya -d restore_test "$(ls -t /backups/postgres/*.dump|head -1)";psql -U draconya -d restore_test -Atc "select count(*) as characters from character";dropdb -U draconya restore_test'
```

A saída esperada é a contagem de linhas da tabela `character` — singular, é o nome real
(`pgTable('character', ...)` em `packages/server/src/db/schema.ts`, não `characters`). Na
primeira execução, 2026-09-16 01:57 UTC, deu 7.

Os dois primeiros horários são propositalmente próximos, não simultâneos: o Redis (extratos
ainda não liquidados, ADR 0024) e o Postgres não precisam de um snapshot atômico conjunto, mas
dois `pg_dump`/`redis-cli --rdb` competindo por I/O no mesmo minuto seria desperdício sem
motivo. `postgres-restore-test` roda de madrugada num dia à parte (domingo) porque depende do
dump da noite anterior já estar completo, e é a mais pesada das três — um `pg_restore` inteiro
contra um banco descartável.

**Primeira execução real** (2026-09-16): `draconya-20260916T0153.dump` (18.204 bytes) e
`dump-20260916T0155.rdb` (923 bytes).

### Retenção

14 dias em disco, no próprio `find -mtime +14 -delete` de `postgres-dump` e `redis-rdb` — sem
histórico maior até que exista um destino fora do servidor (ver "Cópia para fora do servidor"
abaixo). `postgres-restore-test` não entra nessa conta: o banco `restore_test` que ela cria é
derrubado (`dropdb`) no fim da própria execução, e não deixa arquivo em disco.

O dump do Postgres é recusado (e apagado) se sair com menos de 1 KB: **dump truncado é pior
que backup nenhum**, porque passa despercebido até o dia em que alguém precisa dele. O RDB do
Redis não tem o mesmo teste — `redis-cli --rdb` já falha (código de saída ≠ 0, sob `set -e`)
se a conexão cair no meio, então um arquivo pequeno demais também não sobra no disco de forma
silenciosa.

### Restauração (runbook)

**Backup que nunca foi restaurado não é backup, é esperança.** Teste pelo menos uma vez, e de
novo quando o schema mudar de forma.

**(i) Teste sem sair do servidor.** Já não é manual: a tarefa agendada `postgres-restore-test`
(seção anterior) roda toda semana contra o banco descartável `restore_test` — nunca `draconya`
— e a saída é a contagem de linhas de `character`. Rodar Run Now nela a qualquer momento adianta
a checagem sem esperar o cron; sem erro, e com uma contagem condizente com o que se espera no
ambiente, é o sinal de que o dump mais recente restaura de verdade.

**(ii) Restauração de verdade, num Postgres local** (não no staging — restaurar por cima do
staging não é o caso de uso; é para investigar um incidente ou puxar dado para debug local):

```sh
scp root@<servidor>:/data/coolify/backups/draconya-staging/postgres/draconya-XXXXXXXXTXXXX.dump .
pg_restore -U draconya --clean --if-exists -d draconya draconya-XXXXXXXXTXXXX.dump
```

`--clean --if-exists` derruba os objetos existentes antes de recriar — por isso é contra um
Postgres local dedicado a isso, nunca contra um banco com dado que importa.

**(iii) Redis.** O RDB só é lido na subida do processo, então: parar o `redis`, trocar
`/data/dump.rdb` (dentro do volume `redisdata`) pelo arquivo restaurado, subir de novo. A
pegadinha é o `appendonly yes` do `compose.coolify.yml`: com AOF ligado, um Redis que já tem
`appendonlydir` ignora o `dump.rdb` na subida e recarrega do AOF, não do RDB que acabou de
trocar. Duas saídas — **recomendada: apagar `appendonlydir` antes de subir** (o RDB substitui o
estado inteiro mesmo, então o AOF antigo não tem nada que valha preservar); a alternativa,
subir uma vez com `redis-server --appendonly no` para forçar a leitura do RDB e só depois voltar
ao `command` normal do compose, funciona mas é mais passo para o mesmo resultado.

### Cópia para fora do servidor

**(i) Hoje:** da máquina do dono, `rsync` ou `scp` puxando a pasta inteira:

```sh
rsync -av root@<servidor>:/data/coolify/backups/draconya-staging/ ./draconya-staging-backups/
```

**(ii) O que falta, registrado como pendência — não implementado aqui:** o Coolify tem
integração nativa de **S3 Storage** (Storages → S3), com chaves de acesso configuradas pelo
dono do servidor — nunca neste repositório nem em chat. O backup da **própria base do Coolify**
(Settings → Backup) já está ligado, diário às 00:00 UTC, hoje só local (sem S3 configurado);
quando o dono validar um destino S3/R2 ali, o backup de instância passa a subir sozinho, mas os
dumps do jogo (`draconya-staging/postgres` e `.../redis`) são um recurso à parte do Coolify e
vão continuar só em disco até ganhar uma quarta tarefa agendada que envie para esse mesmo S3
— o comando exato depende de qual credencial/bucket o dono escolher, por isso não é inventado
aqui.

### O que não muda

`scripts/backup-postgres.sh` continua como está — é da topologia de `compose.prod.yml` (VPS,
ADR 0013), não do Coolify (ADR 0022), e staging não o usa.

## O que ainda falta para produção de verdade

Nenhum destes bloqueia a validação, e todos bloqueiam jogadores pagantes:

- TLS — Caddy ou Traefik na frente, com certificado automático
- WebSocket atrás do proxy com `Upgrade` preservado e timeout longo
- Firewall: expor só 80 e 443
- Métricas saindo da VPS para o Grafana Cloud
- Restauração de backup testada
