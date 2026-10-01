# Bosses

**Status:** parcial — a instância, a sala e a recompensa de boss **não estão implementadas**; o
**Bosstiary** (o registro paralelo de bosses: abates, nível e pontos de boss) existe desde o #629
(seção abaixo). Boss Slot e boss boosted continuam fora, porque dependem do sistema de bosses.
**PRD:** §27, §43.7
**Épico:** E11 (o Bosstiary é do E7, progressão persistente)
**ADRs:** [0052](../adr/0052-endgame-progression-state-and-city-services-through-the-owning-session.md)
(estado durável do endgame — o registro `bosstiary`, com a emenda do #629)

## Comportamento

O jogador acessa Boss por um menu dedicado, monta ou é convidado para uma party, e entra em uma instância própria, com capacidade máxima de 10 jogadores. No MVP, cada boss permite uma tentativa/recompensa por dia, conforme a regra de conteúdo — a arquitetura precisa suportar limites diferentes ou custo crescente no futuro, mas isso não é necessário no vertical slice.

Quando o boss começa, a sala fecha: ninguém novo pode entrar. A única exceção é o modo Iniciante, no qual um jogador que morreu pode retornar à instância. O MVP entrega inicialmente esse modo Iniciante: todo participante elegível que causou dano ao boss recebe sua própria recompensa individual ao final, independentemente de ter morrido e retornado durante a luta. A capacidade do sistema também deve prever dois modos futuros mais punitivos — Profissional, em que quem morre não volta à luta, e Herói, em que uma única morte pode encerrar a tentativa de todo o grupo —, mas os detalhes finais de elegibilidade de loot nesses dois modos ainda não foram fechados.

Ao derrotar o boss, cada jogador recebe uma tela de recompensa individual, na qual itens lendários podem ser sorteados. O loot lendário é definido por sorte pura; o MVP não tem pity system.

## Regras

- Tamanho máximo do grupo: 10 jogadores.
- Frequência no MVP: 1 tentativa/recompensa por dia (regra de conteúdo).
- Sala fecha ao iniciar; ninguém novo entra depois.
- Exceção de retorno: só no modo Iniciante, para quem morreu.
- Modo Iniciante (MVP): todo participante elegível que causou dano recebe recompensa individual ao final.
- Modo Profissional (futuro): quem morre não retorna à luta.
- Modo Herói (futuro): pode encerrar a tentativa do grupo inteiro com uma única morte.
- Recompensa é individual, por tela própria ao final; lendários podem ser sorteados nela.
- Sem pity system no MVP.

## Parâmetros de balanceamento

| Parâmetro | Valor previsto | Onde mora em packages/content |
|---|---|---|
| Tamanho máximo do grupo | 10 | caminho previsto: `packages/content/bosses` |
| Tentativas/recompensas por dia (MVP) | 1 | caminho previsto: `packages/content/bosses` |
| Pity system | inexistente no MVP | caminho previsto: `packages/content/bosses` |
| Flag de boss do monstro (#691, o `isBoss` do Canary) | `false` por default; o importador escreve `true` nos 136 bosses do catálogo (#629), junto com `bosstiary` — `buildContent` recusa `bosstiary` sem `boss` | `packages/content/data/monsters/generated/*.json`, `boss` |
| Escala de vida/ataque/defesa de boss (#691) | 1 / 1 / 1 (neutro) — o `rateBossHealth/Attack/Defense` do Canary | `packages/content/data/progression/baseline.json`, `rates.boss` |
| Raridade e `raceId` de cada boss (#629) | Bane / Archfoe / Nemesis, do `monster.bosstiary` do Canary (136 bosses no catálogo) | `packages/content/data/monsters/generated/*.json`, `bosstiary` (escrito por `pnpm catalog:import monsters`) |
| Abates e pontos por nível, por raridade (#629) | Bane 25/100/300 → 5/15/30; Archfoe 5/20/60 → 10/30/60; Nemesis 1/3/5 → 10/30/60 | `packages/content/data/bosstiary/baseline.json`, `levels` |

O que já existe no motor (#691): o monstro declara `boss: true`, e isso troca o bloco de
rates que vale para ele (`progression.rates.boss` no lugar de `rates.monster` — ver
[`progression.md`](./progression.md), "Rates do servidor"). Desde o #629 o importador escreve
`boss: true` junto com o bloco `bosstiary` de cada boss do Canary (o `isBoss` do Canary É "tem
bloco bosstiary"), e o boss deixa de contar no Bestiário e passa a contar no Bosstiary. Instância,
sala e recompensa continuam não implementadas.

## O Bosstiary (#629)

O Bosstiary é o registro paralelo de bosses do Tibia 13.x: cada boss tem uma **raridade**
(Bane, Archfoe ou Nemesis, `monster.bosstiary.bossRace` do Canary), o personagem acumula
**abates por boss**, cada boss tem três **níveis** que fecham em abates fixos da raridade, e cada
nível alcançado soma **pontos de boss**. Segue `IOBosstiary::addBosstiaryKill`
(`src/io/io_bosstiary.cpp`) chamado por `Player::addBosstiaryKill` em `Player::onKilledMonster`,
do Canary 47dfd51.

**Onde o abate conta.** No MESMO evento do abate do Bestiário (`#onMonsterDied`,
`packages/sim/src/rulesets/hunt.ts`), mas **pelos matadores do Canary, e não pela elegibilidade da
XP**: `Creature::onDeath` monta o conjunto `killers` e chama `Player::onKilledMonster` de cada um
— e é lá que `addBosstiaryKill` roda, sem nenhum portão de stamina ou de vida (só
`Player::gainExperience` tem o de stamina). São matadores (`#killersOf`):

- todo personagem com dano neste monstro (o dano da invocação entra no nome do mestre, como
  `attacker->getMaster()` no Canary) — quem não bateu não conta, e quem já saiu da sessão não está
  mais lá para contar;
- e, com a XP compartilhada **ativa** na hora da morte (`Party::isSharedExperienceActive()`: nível,
  alcance do líder e atividade, os mesmos de `party.md`), o roster inteiro da party, líder e todos
  os membros — desde que algum deles tenha batido.

Consequências, todas as do Canary: um herói com **stamina zero** (a hunt continua, só a XP e o loot
param) conta o boss — abate, nível e pontos —; uma party cujos membros estão todos exaustos conta;
e, sem XP compartilhada, um membro parado na party (sem bater, fora de alcance ou inativo) **não**
conta, o que impede um alt AFK de farmar ponto de boss. Os matadores são avaliados ANTES da XP do
mesmo abate (um level up dele não mexe na régua de nível). Nunca para invocação
(`hasBeenSummoned`). Um monstro conta em UM dos dois registros, como no Canary:
`Player::addBestiaryKill` devolve cedo para `isBoss()` e `Player::addBosstiaryKill` devolve cedo
para o contrário. Boss não soma no Bestiário, então não entra nos marcos de XP nem nos pontos de
Charm.

O Bestiário continua com a elegibilidade da XP (vivo e com stamina — `bestiary.md`). Isso é
anterior ao #629 e **diverge do Canary** (onde o Bestiário conta pelos mesmos `killers` e sem
portão de stamina) e do próprio ADR 0043 d.1 / ADR 0053 d.1 ("o Bestiário conta sempre, mesmo com
stamina baixa"); alinhá-lo é decisão de produto à parte (muda `stamina.md` e a regra 4 do ADR
0027), fora do #629 — o Bosstiary não herda a divergência.

**A chave do contador é o `raceId` do Canary**, não o id de conteúdo: o Canary guarda o abate em
`STORAGEVALUE_BESTIARYKILLCOUNT + raceid`, e quatro `raceId` são compartilhados por variantes do
mesmo boss — as cinco formas de Urmahlullu (1811), as duas Goshnar's Megalomania (1969), os dois
Voidborn (1406) e Rupture/Eradicator2 (1225). Abater qualquer variante soma no MESMO contador, e
a tela lista o boss uma vez (`IOBosstiary::addBosstiaryMonster` ignora o `raceId` repetido).
Divergência do desenho da issue (`kills: {monsterId → n}`), pelo motivo acima; no catálogo
importado hoje só o par dos Voidborn tem os dois lados gerados.

**Níveis e pontos** (`IOBosstiary::levelInfos`, `packages/content/data/bosstiary/baseline.json`):

| Raridade | Nível 1 | Nível 2 | Nível 3 | Total de pontos |
|---|---|---|---|---|
| Bane | 25 abates → 5 pontos | 100 → 15 | 300 → 30 | 50 |
| Archfoe | 5 → 10 | 20 → 30 | 60 → 60 | 100 |
| Nemesis | 1 → 10 | 3 → 30 | 5 → 60 | 100 |

O nível alcançado soma os pontos do PRÓPRIO nível ao total (`addBossPoints(levelInfos[raridade]
[nível − 1].points)`); com o abate subindo de um em um, cada nível é alcançado por exatamente um
abate. Fechar um nível é evento notável (`bosstiary-level`, detalhe `monsterId/nível`, em party
`personagem/monsterId/nível`), como o marco do Bestiário: aparece na lista curta do analisador como
"Bosstiary: Dreadmaw · nível 2".

**Registro e persistência** (ADR 0052 d.1): `characters.bosstiary` (`jsonb`, migração
`0023_629-bosstiary`), `{ kills: { "<raceId>": n }, points, version }`. Lido inteiro no ticket,
mutado só pela sessão dona, saído inteiro no extrato (`SessionReceipt.bosstiary`, e no
extrato de snapshot irrestaurável) e escrito pelo ledger — **fundido pelo maior** de cada boss e
dos pontos (`Bosstiary.merge`), como o Bestiário, e não última-escrita-vence como `charms`:
abate e ponto de boss só sobem, então um extrato antigo fora de ordem não rebaixa nada. Não há
intenção C2S: o Bosstiary é só leitura (a mensagem `bosstiary`, S2C 46, sai no attach e a cada
abate de boss).

**O que a tela mostra.** A aba **Bosstiary** do Cyclopedia lista os bosses do catálogo (um por
`raceId`) com raridade, nível N/3 e abates até o próximo nível (ou "✓" no nível 3), busca por nome,
ordenação por abates/nome/raridade, e uma caixa com os pontos de boss, quantos bosses já foram
abatidos e quantos estão no nível máximo. Nível e "quanto falta" são DERIVADOS no cliente do
registro cru e da tabela do catálogo (`shell/bosstiary-progress.ts`); os pontos vêm do servidor.
O Bestiary deixa de listar boss.

**Fora do corte, e por quê.**

- **Boss Slot e boss boosted** — dependem do sistema de bosses (instância, sala e recompensa,
  acima); o `calculateLootBonus`/`getBossBonus` (bônus de loot do baú de recompensa) é a única
  coisa que os pontos de boss compram no Canary, e não há baú de recompensa aqui. Os pontos são
  contados e mostrados, mas ainda não gastam em nada.
- **Podium of Vigour** (o item de casa que o Canary entrega no primeiro nível 2) — não há casa
  nem Store inbox; o título "15 000 pontos" idem.
- **Multiplicador de abate** (`bosstiaryKillMultiplier`, padrão 1, dobrado por evento de servidor
  e triplicado para o boss boosted) — nenhum dos três existe; o abate é sempre 1.
- **Cobertura do catálogo** — dos 249 bosses do Canary (60 Bane, 105 Archfoe, 84 Nemesis), 136
  estão no catálogo importado hoje (42 Bane, 45 Archfoe, 49 Nemesis): os demais dependem de
  mapeamento de ataque/defesa/invocação ainda ausente (`docs/reference/catalog/monsters-report.md`).

## Em aberto

- Regras finais de elegibilidade de recompensa nos modos Profissional e Herói (§27.5, §43.7).

## Divergências do PRD

Vazio por enquanto. É aqui que vai o que foi construído diferente do especificado, e por quê.
