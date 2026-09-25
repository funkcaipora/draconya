# Party de dragões local (#526)

Como deixar uma party de quatro personagens level 200 (Knight, Paladin, Sorcerer, Druid),
equipados com o kit do level 200 (#524) e com bot configurado por vocação, pronta para caçar na
Darashia Dragon Lair — tudo rodando na sua máquina. É o critério de saída do M28: a party roda
localmente no navegador.

O comando central é `pnpm dev:dragon-party`, que faz pelo `api` de verdade (dev-login, criação
de personagem, formação de party) o que um jogador faria manualmente quatro vezes, e escreve
direto no Postgres o que a API de personagem novo não expõe: level, xp, skills, kit e bot. Ver
`packages/tools/src/dev/dragon-party-plan.ts` para os números exatos e o porquê de cada um.

## 1. Postgres e Redis

Duas opções — use a que já tiver disponível.

**Do zero**, com o `docker-compose.yml` do repositório:

```bash
docker compose up -d          # Postgres em 5432 (db `draconya`), Redis em 6379
cp .env.example .env
```

**Reaproveitando um Postgres/Redis de teste que já roda na máquina** (o setup deste projeto para
QA em worktree, `docs/harness-plan.md`): o Postgres de teste em `5433` também serve um banco
`draconya_dev` separado do `draconya_review` que os testes usam, e há um Redis DEDICADO ao dev em
`6381` — **nunca o `6380`, esse é o Redis de teste** que `TEST_REDIS_URL`/`pnpm test` apagam a
cada rodada. Se `draconya_dev` ainda não existir nesse Postgres:

```bash
docker exec <container-do-postgres-5433> psql -U draconya -c 'create database draconya_dev'
```

## 2. `.env`

```bash
cp .env.example .env   # se ainda não copiou acima
```

Edite:

```
DATABASE_URL=postgres://draconya:<senha>@localhost:<5432 ou 5433>/draconya_dev
REDIS_URL=redis://localhost:<6379 ou 6381>
API_ORIGIN=http://localhost:5174
```

`API_ORIGIN` é a origem do **cliente**, não do `api` (o nome é histórico) — o `api` recusa
qualquer mutação cujo `Origin` não bata com ela (`packages/server/src/api/server.ts`), e o
cliente Vite deste projeto roda em `5174` (`.claude/launch.json`), não no `5173` do
`.env.example`.

## 3. O pacote de assets (`things/`)

```bash
ln -s /caminho/para/things things
```

`THINGS_DIR` é só de ferramenta (importador de mapa, inventário de pacote); o servidor em si só
recusa subir se `THINGS_VERSION` não bater com a versão contra a qual o conteúdo foi conferido
(`packages/content/data/packs/`) — o `.env.example` já traz `THINGS_VERSION=1332` certo.

## 4. Instalar, migrar, compilar

```bash
pnpm install
DATABASE_URL=<a mesma do .env> pnpm db:migrate
pnpm exec tsc -b            # sim/content/server/tools compilados — os scripts de tools leem dist/
```

## 5. Subir os três papéis e o cliente

```bash
pnpm dev                                    # api + game + jobs em modo solo, lê .env
PORT=5174 pnpm --filter @draconya/client dev   # noutro terminal
```

## 6. Semear a party

```bash
pnpm dev:dragon-party                # cria/atualiza as quatro contas e personagens, forma a party
pnpm dev:dragon-party --start        # e também inicia a hunt
pnpm dev:dragon-party --reset        # devolve os quatro para a Cidade se algo travou
```

Flags (todas opcionais):

| Flag | Default | O quê |
|---|---|---|
| `--hunt-id=` | `darashia-dragon-lair` | qual hunt configurar na party |
| `--difficulty=` | `bold` | qual dificuldade daquela hunt |
| `--start` | — | inicia a hunt depois de configurar (exclusivo com `--reset`) |
| `--reset` | — | tira os quatro da party e os devolve à Cidade |
| `--database-url=`, `--redis-url=`, `--content-dir=`, `--api-base=`, `--api-port=`, `--client-origin=` | do `.env`/padrão | sobrescrevem o que o `.env` traz, para rodar fora do fluxo acima |

**A Darashia Dragon Lair ainda não existe no conteúdo** enquanto as issues #519 (mapa) e #520
(monstro e hunt) não estiverem integradas nesta branch — rodar com o default falha com uma
mensagem clara listando as hunts que EXISTEM (`rat-cellars`, `rotworm-caves` no MVP) e segue
sem configurar a hunt nem iniciar; as quatro contas, personagens e a party continuam formados e
prontos, só falta configurar assim que a hunt chegar. Para testar o fluxo inteiro antes disso:

```bash
pnpm dev:dragon-party --hunt-id=rat-cellars --difficulty=bold --start
```

**Idempotente**: rodar de novo atualiza as MESMAS quatro contas/personagens (por e-mail e nome) —
não duplica, e reaproveita a party se ela ainda estiver `forming`. Se a party já está `hunting`,
o comando avisa e não faz nada; use `--reset` antes de rodar de novo.

### O que cada personagem recebe

Quatro contas (`knight@draconya.test`, `paladin@…`, `sorcerer@…`, `druid@…`) — uma por
personagem, porque uma conta só tem até dois personagens ativos
(`DEFAULT_ACTIVE_LIMIT`, `packages/server/src/directory.ts`) e o início da party emite um ticket
por membro. Cada personagem ("Draco Knight", "Draco Paladin", "Draco Sorcerer", "Draco Druid"):

- **Level 200**, com a xp exata que a curva do Tibia (#521, `totalXpForLevel`) exige para esse
  level — nunca um número escrito à mão.
- **Skills** do ponto de partida "level 200 realista" da issue: Knight melee 105/escudo 95/ML 10;
  Paladin distância 110/escudo 90/ML 28; Sorcerer e Druid ML 90/escudo 28.
- **O kit level 200** (#524): Knight — elmo de cruzado, armadura de placas mágica, pernas de
  cavaleiro, botas de pressa, escudo mastermind, lâmina mística, colar de dragão, anel do poder;
  Paladin — elmo real, armadura de paladino, pernas da coroa, botas de pressa, besta real (com
  virote power-bolt selecionado), colar de dragão, anel do poder; Sorcerer/Druid — chapéu do
  louco, capa de foco, pernas zaoan, botas de pressa, cajado/bastão (wand of starstorm / hailstorm
  rod), grimório do controle mental, colar de dragão, anel do poder. Mochila em todos.
- **Ouro** para cerca de uma hora de suprimento — uma estimativa grosseira de teste local (uso a
  cada ~30s, tiro a cada intervalo de ataque do conteúdo), somada só sobre o que o PRÓPRIO bot
  config daquela vocação usa (`goldForOneHour` em `dragon-party-plan.ts`), não balanceamento.
- **Bot v2** (AB-03): Knight puxa a rota e briga com Berserk (`exori` — `exori gran`/Fierce
  Berserk ainda não existe no conteúdo); Paladin/Sorcerer/Druid seguem o Knight
  (`botConfig.follow: 'leader'`); Druid cura o membro mais ferido com Exura Sio e lança Mass
  Healing pelo próprio HP (o vocabulário do bot não tem uma condição de "N membros feridos" —
  ver o comentário em `botConfigFor`); todos bebem a poção certa por vocação/level (Supreme
  Health, Ultimate Spirit, Ultimate Mana) por limiar de HP/mana; Sorcerer e Druid usam a runa
  Avalanche (gelo — o dragão é fraco a gelo) como ataque padrão, com uma magia de área maior
  (Rage of the Skies / Eternal Winter) quando há alvo de sobra; Paladin alterna Divine Caldera
  (área) e Divine Missile (alvo único) pela distância; todos recastam Haste sozinhos. Uma regra
  de saída (`hp-below 10%`) evita que o personagem morra sozinho numa hunt sem ninguém olhando.

## 7. Entrar no navegador como o líder

Com o cliente em `http://localhost:5174` aberto, abra o console e faça o dev-login do Knight
(o mesmo endpoint que o script usa, `POST /api/auth/dev-login` só aceita `AUTH_DEV_MODE=true` e
a origem do cliente):

```js
await fetch('http://localhost:3000/api/auth/dev-login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ email: 'knight@draconya.test' }),
});
location.reload();
```

Selecione "Draco Knight" na lista de personagens. Se a party já foi iniciada
(`pnpm dev:dragon-party --start`), o cliente reencontra a hunt em andamento; senão, o menu de
hunt mostra a party pronta para o botão "Iniciar".

## O que observar

- Knight na frente, puxando a rota; os outros três colados nele (`follow: 'leader'`, §M20).
- HP/mana dos quatro no HUD — o Druid bebendo mana e curando quem está mais ferido.
- Runa Avalanche saindo do Sorcerer/Druid contra o dragão (dano de gelo, deveria bater mais
  forte que fogo/energia pela fraqueza elemental).
- `/metrics` do `game` (`http://localhost:7171/metrics` — ou a porta configurada) para custo de
  tick com quatro personagens numa hunt de verdade.

## Se algo travar

```bash
pnpm dev:dragon-party --reset
```

Tira os quatro da party (formulário em Redis) e força `characters.state = 'city'`,
`session_id = null` no Postgres — um atalho deliberado fora do caminho normal (só a sessão dona
escreve estado quente, invariante 9); serve para quando a sessão dona já não está rodando.
**Não** encerra uma sessão de hunt que ainda esteja de pé no `game`: se o `--reset` não for
suficiente, reinicie o processo `game` (`Ctrl+C` e `pnpm dev` de novo) — ele não guarda estado em
Postgres no caminho quente, e a sessão de hunt não sobrevive ao processo cair sem snapshot válido
para esta versão de conteúdo.
