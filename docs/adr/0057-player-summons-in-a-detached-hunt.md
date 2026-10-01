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

## Emenda — 2026-09-29: o familiar implementado (#599)

A decisão 3 fixou o familiar de forma resumida; a implementação (M38-02) leu a fonte inteira
(`Player:CreateFamiliarSpell`, `familiarOnLogin`/`FamiliarDeath`, `Creature::checkSummonMove`,
`Tile::queryAdd`, `Combat::canDoCombat`) e fecha o que faltava. O texto completo, com números e
divergências, está em `docs/product/combat.md` ("O familiar de vocação").

1. **O familiar não é `summonable`.** O Canary declara `summonable = false` nos quatro — é o que
   impede a Summon Creature de invocá-los. A decisão 5 e o texto do ADR ("importar como
   `summonable`") valem só para Convince Creature; o familiar é marcado por `monsterSchema.familiar`
   (o `flags.familiar` do Canary) e por uma magia com o efeito `familiar { monsterId, durationMs,
   cooldownMs }`.
2. **Os dois carimbos são de relógio de PAREDE, e a recriação ao entrar é regra.** O Canary guarda
   `familiar-summon-time = os.time() + duração` (recriado no login com o tempo que sobra, zerado
   pela morte do familiar) além da `CONDITION_SPELLCOOLDOWN` de `2 × duração` contada do
   lançamento. O `CharacterRuntime` carrega os dois (`familiar: { version, summonUntilMs,
   cooldownUntilMs }`), o registro `jsonb` `character.familiar` (ADR 0052 d.1) os persiste por
   última escrita vence — nunca por máximo, porque o `summonUntilMs` desce na morte —, e a
   recriação acontece ao ENTRAR NA HUNT, o login do personagem (a Cidade não tem invocação, d.3).
   O `sim` não lê relógio: o "agora" é `Session.createdAtMs + Session.nowMs`, que o servidor já dá —
   e que ele mantém verdadeiro: na retomada de um snapshot o intervalo descartado (ADR 0018) é
   somado ao `createdAtMs` (`SessionHost#resume`), e os carimbos que o `sim` grava são sempre inteiros
   (teto no lançamento, piso na morte), porque o relógio lógico do hospedeiro é fracionário e todo
   consumidor valida inteiro seguro.
3. **Divergência aceita, herdada do ADR 0052 d.6:** o cooldown corre também na Cidade e offline. No
   Canary a condição só anda com o jogador online. Dentro da hunt são idênticos; fora, a decisão
   deste ADR (d.3, "cooldown de parede") vale.
4. **A recusa por cooldown de parede não carrega prazo para o bot.** Um `retryInMs` de 30 min faria
   o grupo `support` dormir 30 min, e a haste vive no mesmo grupo. A regra engatilha — o bot a
   reavalia a cada evento — e a barra mostra o prazo real.
5. **A invocação de personagem passa a herdar o alvo SELECIONADO do mestre**, não o que a arma dele
   alcança, e a ability em ÁREA de uma invocação de personagem atinge só monstros hostis (nunca a
   party): as duas eram lacunas do primitivo do #598 que o familiar, cuja ability é quase toda em
   área, expôs.
6. **A invocação de personagem sem alvo SEGUE O MESTRE** (o `Monster::updateSummonTarget` do
   Canary: `master != followCreature` → `setFollowCreature(master)`), o que o #598 deixara como
   divergência aceita e a regra da caça idêntica ao Canary (ADR 0037 d.6) não admite. Só segue quem
   enxerga o mestre (mesmo andar, visão de 11), pela busca de menor custo do A* do Canary
   (cardinal 10, diagonal 35, `cheapestPath`), até um tile a EXATAMENTE 2 do mestre com linha de
   visão livre (`getPathSearchParams`: `minTargetDist = 1`, `maxTargetDist = 2`; um tile a 1 é só o
   "melhor até agora" de `FrozenPathingConditionCall`, a que ela recorre se nenhum a 2 for
   alcançável); a de outro monstro (#546) continua parada. Sem mestre à vista ou sem caminho, a
   invocação vagueia (`getNextStep` cai no `doRandomStep`); a Summon Creature comum não segue o
   mestre invisível que ela não enxerga (`canFollowMaster`), e o familiar segue sempre. Vale para a
   Summon Creature e para o familiar.

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
- **Decisão 6, acréscimo — o tile sólido recusa antes do script.** `animate_dead_rune.lua` registra
  `rune:isBlocking(true)` (`blockingSolid`), e `Spell::playerRuneSpellCheck` recusa o tile com
  `TILESTATE_BLOCKSOLID` e sem criatura visível (`RETURNVALUE_NOTENOUGHROOM`) ANTES de o script rodar:
  um campo bloqueante (Magic Wall, Wild Growth) sobre o cadáver o protege, e nem o cadáver, nem o gold,
  nem o cooldown são tocados. O motor recusa `not-possible` (não tem recusa própria para "sem espaço";
  o texto é apresentação). O vizinho livre só vale quando o tile do cadáver está ocupado por alguém.
- **Decisão 1, acréscimo — o jogador atravessa a invocação de jogador, e a área dele não a atinge.**
  Duas regras do mundo no-pvp (ADR 0060) que o #598 não precisava porque o catálogo real ainda não tinha
  nenhuma invocação de jogador: (a) `Player::canWalkthrough` libera o tile de uma invocação de jogador,
  e como a ocupação aqui é exclusiva (invariante 8) o passo do personagem vira TROCA de lugar com ela
  (`swapPlaces`), no `HuntRuleset#step` — sem isso a invocação em cima do próximo tile da rota, que o
  mestre nunca mata, travava o passo do herói pelo resto da hunt; (b) `Combat::canTargetCreature` recusa
  o ataque do jogador a `target->isSummon() && targetMasterPlayer`, então a colheita de toda área (as
  duas formas de `#aimFor` e o golpe de varredura) pula a invocação de qualquer jogador, a do
  companheiro de party inclusive, e a mira explícita de dano nela é `no-target`.
- **Nota de fonte — `getManaCost` não existe como método Lua.** `convince_creature.lua` escreve
  `target:getType():getManaCost()` e `summon_creature.lua` escreve `monsterType:getManaCost()`, mas nem
  o Canary (`monster_type_functions.cpp`) nem o TFS (`luascript.cpp`) registram esse nome: o binding é
  `monsterType:manaCost()`, e só o C++ `Monster::getManaCost()` existe, lendo `info.manaCost`. Os
  scripts, como escritos, falhariam com "attempt to call method" nos motores de referência. O catálogo
  implementa a INTENÇÃO evidente deles — o custo é o `manaCost` do monstro (ausente = 0) — e não o
  comportamento literal (erro de script). O respawn do convencido que some com o mestre, por sua vez,
  parte de `Monster::onRemoveCreature` (ramo da própria remoção → `startSpawnMonsterCheck`), não de
  `onCreatureLeave`, que é o tratador de OUTRA criatura saindo.
