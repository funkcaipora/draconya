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
por versão hoje (1,1 MB na 13.32):

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
- `maps/<mapId>.json`, um por mapa do conteúdo (`thais`, `rat-cellars`; 1,1 MB na 13.32) —
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
