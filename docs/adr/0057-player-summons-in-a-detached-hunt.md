# 0057 — Invocações do jogador numa hunt desanexada: criatura da sessão com mestre, XP pelo dano ao mestre, ressumonar é automação

**Status:** proposto — estende a invocação de monstro do M29-06 (#546, `masterId`) ao jogador,
sob o [ADR 0037](0037-tfs-canary-fidelity-except-action-bar-and-automation.md); familiar e
Animate Dead tocam o [ADR 0048](0048-corpse-loot-and-per-character-quick-loot-filter.md)
**Data:** 2026-09-27
**Contexto técnico:** `packages/sim` (`monster/monster.ts` — `masterId` de personagem, alvo do
mestre, XP por dano; `rulesets/hunt.ts` — spawn/respawn ao convencer, cadáver ao animar; fila de
eventos para duração/cooldown do familiar), `packages/content` (monstro: `summonable`,
`convinceable`, `manaCost`; magias `summon`, `familiar`, runas), `packages/protocol`
(`creature-appear.masterId`), bot (ação `summon`, condição `summons`)
**Issues:** M38 — #598, #599, #600

## Contexto

No Canary a invocação é uma criatura com `master`: segue o mestre, herda o alvo dele
(`Creature::setAttackedCreature` propaga), e o dano dela credita XP ao mestre
(`getGainedExperience` usa `attackerMaster`). Summon Creature (level 25, teto 2, mana do
monstro), os quatro familiares (level 200, 15 min de duração e 30 min de cooldown —
`familiarTime 30`, dividido por 2), Convince Creature (transfere um monstro) e Animate Dead
(cadáver → Skeleton) são as quatro formas.

Nada disso conflita com a arquitetura — o `masterId` já existe para monstro invocando monstro —
mas três detalhes precisam de decisão antes de #598: o que acontece com a invocação quando ninguém
está olhando, como ela entra no snapshot, e se o bot pode ressumonar sozinho.

## Decisão

1. **Invocação é criatura da sessão com `masterId` de personagem.** Mesmo `MonsterState` do
   #546, com o mestre podendo ser um `characterId`. Segue o mestre (o `follow` que existe), ataca
   o alvo do mestre e troca quando ele troca; monstros a atacam como no Canary (`isOpponent`).
   Roda idêntica anexada ou desanexada (invariante 3), e entra no **snapshot da sessão** como
   qualquer monstro, para retomada — não é estado do personagem, é da sessão.

2. **XP e Bestiário vão para o mestre.** O dano da invocação é somado no mapa de dano em nome do
   mestre (`attackerMaster`), então a XP por razão de dano (#523) e o abate do Bestiário são do
   mestre; o dono do loot não muda (ADR 0048). A invocação nunca ganha nada.

3. **Vida da invocação:** morre por dano; some quando o mestre morre, sai da hunt, ou a sessão
   acaba; **não existe na Cidade** (protect zone, ADR 0004 — invocar lá é recusado com motivo).
   Teto de 2 invocações por mestre; o familiar **ocupa** um lugar e só pode ser criado sem outra
   invocação viva (`player.lua:246`). Duração do familiar (15 min) e cooldown (30 min) são eventos
   da fila da sessão (invariante 2); o cooldown que sobra ao sair da hunt vira carimbo no
   `CharacterRuntime` e volta no ticket — cooldown de parede (ADR 0052 d.6).

4. **Ressumonar é automação legítima.** A barra ganha a ação `summon { monsterId }` (Summon
   Creature com parâmetro, e cada familiar como magia própria) e a condição `summons < N`; o
   preset por vocação liga "sem invocação viva → invocar" para Druid/Sorcerer e "familiar pronto →
   invocar" para level 200. É o bot fazendo o que o jogador faria (invariante 11); a mana do
   monstro (`manaCost`) é o custo, como no Canary.

5. **Convince Creature** transfere a posse de um monstro `convinceable` da hunt para o mestre,
   pagando `manaCost`; o **ponto de spawn** dele começa o respawn imediatamente, como se ele
   tivesse morrido (`spawn->removeMonster` no Canary). Um monstro convencido não dá XP nem loot
   quando morre.

6. **Animate Dead** exige um cadáver no tile-alvo dentro da vida dele (ADR 0048 d.6); consome o
   cadáver — **o loot que ainda estava nele é destruído**, pela regra do ADR 0048 d.5 (nunca foi
   instância) — e cria um Skeleton invocado dentro do teto de 2. O cliente recebe
   `ground-item-disappear` e `creature-appear`.

## Alternativas

- **Invocação como estado do personagem (persiste entre hunts).** Descartada: no Tibia a invocação
  some no logout; e ela é criatura da sessão, não do `CharacterRuntime`.
- **Invocação sem ataque quando desanexado (só segue).** Descartada pelo invariante 3.
- **Proibir o bot de ressumonar ("parece bot").** Descartada pelo invariante 11.
- **Animate Dead preservando o loot do cadáver (transferir para o Skeleton).** Descartada: cria um
  container com dono a partir de um monstro invocado, sem fonte no Canary; e o ADR 0048 d.5 já
  diz que loot não pego não é instância.

## Consequências

- #598–#600 destravam; `docs/product/combat.md` ganha a seção de invocação do jogador; o preset
  do #526 ganha o familiar.
- `MonsterState.masterId` passa a admitir id de personagem; `creature-appear` leva `masterId`
  opcional (o cliente marca "sua invocação"); bot ganha uma ação e uma condição no vocabulário v2
  (campo novo com default, sem subir versão).
- O importador de monstros (M35) passa a ler `summonable`, `convinceable` e `manaCost`, e a pasta
  `familiars/` deixa de ser pulada.
- O que piora: a invocação entra no mapa de dano e no targeting — os testes de conformance de
  party (#523) ganham vetores com invocação para provar que a XP do mestre não muda a dos outros.

## Invariantes afetados

Nenhum. O **3** é a decisão 1; o **11** é a decisão 4; o **2** é a razão de duração e cooldown
serem eventos da fila.

## Emenda — 2026-09-30: o respawn ao convencer e o cadáver animável (#600)

A implementação do #600 conferiu as decisões 5 e 6 contra as fontes locais (Canary `47dfd51`, TFS
`70793fd`) e corrige duas afirmações — a regra do dono é a mecânica de caça idêntica à do Canary,
inclusive QUANDO ela dispara (ADR 0037 d.6):

- **Decisão 5 — o ponto de spawn não começa o respawn ao convencer.** O texto dizia "imediatamente,
  como se ele tivesse morrido (`spawn->removeMonster` no Canary)". Não é isso que o Canary faz:
  `convince_creature.lua` chama `Creature:setSummon`, que chama `Creature::setMaster(master, true)` —
  e `setMaster` não toca o spawn. O monstro continua em `SpawnMonster::spawnedMonsterMap`, e o
  `SpawnMonster::cleanup` só o retira quando `monster->isRemoved()`. `SpawnMonster::removeMonster`
  não tem chamador nenhum no Canary; no TFS o único é o ramo `monsterOverspawn` de `Monster::onThink`
  (monstro fora do raio de despawn, config desligada por padrão), que nada tem a ver com convencer.
  Logo: **o lugar continua ocupado enquanto o convencido vive, e o respawn do ponto corre quando ele
  morre ou some** (com o mestre, ao sair da hunt), contado daquele instante — o mesmo caminho de
  qualquer monstro do Spawner (`#releaseSpawnSlot`). O resto da decisão vale: custa `manaCost`,
  transfere a posse, não dá XP nem loot ao morrer — e agora também não deixa cadáver
  (`Creature::dropCorpse`, `!lootDrop`), regra que vale para TODA invocação.
- **Decisão 6 — "cadáver vivo no tile-alvo" é "o item do topo é um cadáver MOVÍVEL agora".** O script
  exige `itemType:isCorpse() and itemType:isMovable()` sobre `Tile:getTopDownItem()`, e as duas flags
  são do estágio da cadeia `decayTo` em que o cadáver está (`appearances.dat`: `corpse`, sem `unmove`).
  O primeiro estágio de quase todo monstro é `unmove`: o cadáver recém-abatido não pode ser animado;
  vira movível no primeiro decaimento (10 s no caso comum). `monster.corpseAnimatable` (janelas em ms
  desde a morte, gerado pelo importador) leva isso ao `sim`, que mede o tempo desde a morte pelo evento
  `CORPSE` da fila. O topo da pilha é o cadáver mais recente do tile. O Animate Dead não custa mana (o
  script não chama `addMana`).
