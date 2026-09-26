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

Duas opções — use a que já tiver disponível. As duas terminam num `.env` completo e consistente;
não misture uma linha de uma com uma linha da outra.

**Opção A — do zero**, com o `docker-compose.yml` do repositório:

```bash
docker compose up -d          # Postgres em 5432 (db `draconya`, usuário/senha `draconya`), Redis em 6379
cp .env.example .env
```

`.env` fica como o `.env.example` já traz (`DATABASE_URL=postgres://draconya:draconya@localhost:5432/draconya`,
`REDIS_URL=redis://localhost:6379`) — só falta o `API_ORIGIN` do passo 2.

**Opção B — reaproveitando um Postgres/Redis de teste que já roda na máquina** (o setup deste
projeto para QA em worktree, `docs/harness-plan.md`): o Postgres de teste em `5433` também pode
servir um banco `draconya_dev` separado do `draconya_review` que os testes usam, mas ele não vem
pronto — crie uma vez:

```bash
docker exec <container-do-postgres-5433> psql -U draconya -c 'create database draconya_dev'
```

Redis de teste (`6380`) é apagado a cada `pnpm test` (`TEST_REDIS_URL`) — **nunca aponte
`REDIS_URL` para ele**. Suba um Redis PRÓPRIO para o dev, em `6381`, se ainda não tiver um:

```bash
docker run -d --name draconya-dev-redis -p 127.0.0.1:6381:6379 redis:7-alpine
```

`.env` desta opção:

```
DATABASE_URL=postgres://draconya:<senha do Postgres 5433>@localhost:5433/draconya_dev
REDIS_URL=redis://localhost:6381
```

## 2. `.env`

```bash
cp .env.example .env   # se ainda não copiou na opção A
```

Em QUALQUER das duas opções, edite (ou confirme) `API_ORIGIN`:

```
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
| `--start` | — | inicia a hunt depois de configurar, e ANEXA o ticket do líder para o `game` criar a sessão de verdade (#527; exclusivo com `--reset`) |
| `--reset` | — | tira os quatro da party, devolve à Cidade e liquida snapshot pendente (#527) |
| `--database-url=`, `--redis-url=`, `--content-dir=`, `--api-base=`, `--api-port=`, `--client-origin=` | do `.env`/padrão | sobrescrevem o que o `.env` traz, para rodar fora do fluxo acima |

**A Darashia Dragon Lair ainda não existe como HUNT no conteúdo** enquanto a issue #520 (o
dragão e o arquivo `hunts/darashia-dragon-lair.json`) não estiver integrada nesta branch — o
mapa e a rota já chegaram pelo #519. Rodar com o default falha com uma mensagem clara listando
as hunts que EXISTEM (`rat-cellars`, `rotworm-caves` no MVP) e segue sem configurar a hunt nem
iniciar; as quatro contas, personagens e a party continuam formados e prontos, só falta
configurar assim que a hunt chegar. Para testar o fluxo inteiro antes disso:

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
- **Ouro** para cerca de uma hora de suprimento — uma estimativa grosseira de teste local, somada
  só sobre o que o PRÓPRIO bot config daquela vocação usa (`goldForOneHour` em
  `dragon-party-plan.ts`), não balanceamento. Poção bebe na cadência de "topar quando precisa"
  (~120/h); runa de ataque (Avalanche) bebe na cadência de COMBATE, pelo `groupCooldownMs` dela
  (~1800/h) — as duas cadências são bem diferentes, e tratá-las como uma só subestimava e muito
  o gasto de quem ataca com runa.
- **Bot v2** (AB-03), contra um dragão fogo-imune/gelo-fraco/terra-resistente (`mitigation` do
  monstro, issue #526): Knight puxa a rota (não segue ninguém) e ataca do mais forte pro mais
  barato — Fierce Berserk (`exori gran`) → Front Sweep (`exori min`) → Berserk (`exori`) →
  Whirlwind Throw (`exori ico`), com Haste (`utito tempo`) sozinho; Paladin/Sorcerer/Druid seguem
  o Knight (`botConfig.follow: 'leader'`). Paladin: Divine Caldera (`exevo mas san`, área) com
  alvo de sobra, senão Strong Ethereal Spear (`exori gran con`) → Divine Missile (`exori san`) →
  Ethereal Spear (`exori con`). Sorcerer: Rage of the Skies (energia) com alvo de sobra — não
  Hell's Core, que é fogo e não faz nada no dragão —, e a runa Avalanche (gelo) como ataque de
  base, já que o Sorcerer não tem magia de gelo própria no catálogo. Druid: cura o membro mais
  ferido com Heal Friend e lança Mass Healing pelo próprio HP (o vocabulário do bot não tem uma
  condição de "N membros feridos" — ver o comentário em `botConfigFor`), ataca com Eternal Winter
  (gelo, a própria fraqueza do dragão) com alvo de sobra e Avalanche como base — nunca Terra Wave/
  Wrath of Nature, terra é 80% resistida. Todos bebem a poção certa por vocação/level (Supreme
  Health, Ultimate Spirit, Ultimate Mana) por limiar de HP/mana. Cada degrau da rotação só entra
  se a magia existir no conteúdo desta branch (`spellCascade`) — o motor já cai para o próximo
  quando o de cima está em cooldown ou sem mana, então não há limiar de mana escrito à mão. Uma
  regra de saída (`hp-below 10%`) evita que o personagem morra sozinho numa hunt sem ninguém
  olhando.

## 7. Entrar no navegador como o líder

**`--start` já cria a hunt** (#527): o script abre um WebSocket com o ticket do líder, manda
`session-attach` e espera o `session-state` confirmar `sessionType: "hunt"` antes de imprimir a
sessão e sair — a mesma sequência que o cliente faz ao reanexar (`net/connection.ts`). A hunt
já está rodando no servidor nesse ponto, sem ninguém olhando (idle-first, ADR 0027); o navegador
só serve para ACOMPANHAR, não para criar nada.

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
(`pnpm dev:dragon-party --start`), o cliente reanexa à hunt já em andamento — nenhum clique
"Iniciar" é necessário; senão (rodou sem `--start`), o menu de hunt mostra a party pronta para o
botão "Iniciar com o time".

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

**Precisa de `REDIS_URL`** (do `.env`, ou `--redis-url=`) — é ele que diz se a sessão de cada
personagem está realmente viva antes de mexer em qualquer coisa. `characters.state`/`session_id`
no Postgres NÃO são a fonte da verdade (`GET /api/characters` já documenta isso — a coluna
"NÃO é escrita por ninguém" e ler nela "fazia a API responder 'city' para quem estava numa hunt
havia seis horas"); quem manda é o diretório de sessão no Redis, e é ele que o `--reset` limpa.

Para cada personagem, o comando confere no diretório se o NÓ dono ainda bate (a mesma pergunta
que o `api` faz para decidir "está em jogo"):

- **Nó vivo** (batimento presente): o `--reset` NÃO apaga nada dele e avisa — a sessão é de
  verdade, e apagar o lease por baixo abriria a fresta de duas hospedagens do mesmo personagem
  (invariante 8/9). Se ela estiver REALMENTE travada (não é só uma hunt legítima em andamento),
  reinicie o processo `game` (`Ctrl+C` e `pnpm dev` de novo) — ele não guarda estado no Postgres
  no caminho quente, e a sessão não sobrevive ao processo cair sem snapshot válido para esta
  versão de conteúdo.
- **Nó morto ou sem sessão registrada**: o `--reset` tira o personagem da party (formulário em
  Redis) e limpa o lease órfão — o mesmo que o `jobs` faria sozinho em até dez segundos (FUN-28);
  isto só adianta a espera.

**Também liquida o snapshot de sessão pendente de cada personagem** (#527, ADR 0010): reiniciar o
`game` no meio de uma hunt drena a sessão sem encerrar — o snapshot resumível continua de pé
(§38.4), mesmo depois do lease do diretório expirar. Sem liquidá-lo, `POST /api/party/:id/start`
recusaria o PRÓXIMO `--start` com `pending-session` (a mesma checagem que existe hoje justamente
para o `game` não "resolver" sozinho qual sessão é a certa) — o loop "reiniciar o servidor →
`--reset` → `--start`" travaria de novo, agora num ponto diferente. `--reset` credita o que o
snapshot tem (XP, gold, itens) como extrato pela MESMA conta que `SessionHost#creditUnrestorable`
usa dentro do `game` (`settleSnapshotAsReceipt`, `packages/server/src/snapshot-settlement.ts`) e
só então apaga a chave — nunca um `DEL` às cegas, que jogaria fora o progresso da hunt anterior.
