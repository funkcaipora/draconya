# Hazard

**Status:** parcial — o mecanismo inteiro do Canary existe (nível por zona, crítico e reforço do
monstro, esquiva do monstro, XP, rolagens extras de loot, subida de nível, Plunder Patriarch) e a
Gnomprona Gardens, a única zona que o Canary marca, é jogável com as duas espécies que o catálogo
resolve hoje. Faltam o casulo (Hazard Pods, sem item no chão), o chefe que sobe o nível (The
Primal Menace, fora do catálogo) e 13 das 15 espécies do jardim (dependem do #579 e do #622).
**PRD:** — (sistema do Tibia 13.x, ADR 0037; sem seção no PRD)
**Épico:** E3 · milestone M44 (`M44-14`, #632)
**ADRs:** [0052](../adr/0052-endgame-progression-state-and-city-services-through-the-owning-session.md)
d.1 (registro `hazard`), d.5 (nível fixado na entrada) e d.7 (estágio do `combat-v4`);
[0037](../adr/0037-tfs-canary-fidelity-except-action-bar-and-automation.md) d.6 (caçada idêntica)

## Comportamento

Algumas zonas do Tibia deixam o jogador **escolher o quanto de perigo quer**: quanto maior o
nível de hazard, mais forte o monstro e mais generosa a recompensa. O Canary tem UMA zona assim,
`hazard.gnomprona-gardens` (`data-otservbr-global/scripts/systems/hazard_primal.lua`), com níveis
de 1 a 12. **O nível mínimo é 1, e não há "sem hazard" dentro da zona** — o título da issue dizia
"opcional", mas `Hazard.new` tem `minLevel = prototype.minLevel or 1` e o nível `0` nem é aceito
pelo NPC que o troca (`gnomadness.lua`: `desiredLevel <= 0` recusa). Opcional é ENTRAR na zona.

**Quem escolhe, e quando.** O nível é escolhido NA CIDADE, antes de entrar, no seletor "Hazard"
do modal "Escolha uma caçada" (só aparece nas hunts de zona de hazard). O Canary o troca falando
com um NPC fora da zona; o equivalente aqui é a Cidade, serviço sem rolagem tratado pela sessão
dona (ADR 0052 d.2). A intenção `set-hazard-level { zoneId, level }` só é aceita na sessão de
Cidade: dentro da hunt o nível é **FIXO** desde a entrada (ADR 0052 d.5, como a versão de
conteúdo), e a escolha lá é recusada. O servidor confere a zona, o piso (`minLevel`) e o teto que
o personagem já desbloqueou — quem escolhe acima do teto leva `system-message`.

**O que o nível faz** (todos os efeitos são do `combat-v4`, estágio #632 em
[`combat-conformance.md`](./combat-conformance.md)). Vale para todo monstro da hunt de zona que
nasceu do spawner — a invocação de monstro (`masterId`) e a de personagem NÃO são monstro de
hazard, pela mesma razão do Canary (o `HazardMonster.onSpawn` roda no spawner e em
`Game.createMonster`, nunca em `Monster::createMonster`):

| Efeito | Quem | Fórmula do Canary (`player.cpp`, `game.cpp`, Lua) | Config |
|---|---|---|---|
| **Reforço de dano** | monstro → jogador | `+ ceil(dano × nível × 200 / 10000)` em todo golpe (primário e, se houver, secundário) | `damageMultiplier` 200 |
| **Crítico** | monstro → jogador | uma rolagem `normal_random(1, 10000)` por golpe; se `<= 750` e passaram 2 s desde o último crítico NESTE jogador: `+ ceil(dano × (5000 + (nível − 1) × 25) / 10000)`, ANTES do reforço | `criticalChance` 750, `criticalMultiplier` 25, `criticalIntervalMs` 2000 |
| **Esquiva** | jogador → monstro | uma rolagem `normal_random(1, 10000)`; se `<= nível × 85` o golpe INTEIRO some | `dodgeMultiplier` 85 |
| **Defesa** | jogador → monstro | `− ceil(dano × nível × defenseMultiplier / 10000)`; o Canary traz `0`, então não faz nada | `defenseMultiplier` 0 |
| **XP** | abate | `floor(xp + xp × 1,75 × nível × 2 / 100)`, depois do rate e do bônus de level/Bestiário: +3,5 % por nível | `expBonusMultiplier` 2 |
| **Loot** | abate | `rolls = 2 × nível × 2 / 100` (0,04 a 0,48 no teto do Canary); a parte fracionária decide o arredondamento por UMA rolagem `math.random(0, 100) < frac × 100` (a chance real é 48/101 no nível 12); cada rolagem é uma tabela INTEIRA a mais, depois da boosted, sem Gut | `lootBonusMultiplier` 2 |
| **Plunder Patriarch** | morte de monstro da zona | pelos feridores: menor nível entre eles; `random(1, 10000) <= nível × 87` é o casulo e ENCERRA; senão `random(1, 100000) <= nível × 25` faz nascer o Plunder Patriarch no tile livre mais próximo (raio 4) | `podDropMultiplier` 87, `plunderSpawnMultiplier` 25 |

**Em party vale o MENOR nível entre os membros** (`Party:refreshHazard` e os laços de
`parseAttackRecvHazardSystem`/`parseAttackDealtHazardSystem`): o dano, a esquiva, a XP e o loot
usam o mesmo número para todos. Cada membro leva o próprio registro (o ticket de cada um), e o
modal "Detalhes da caçada" avisa "party: o menor" ao lado do nível.

**As probabilidades reais NÃO são as nominais.** `normal_random` centra em 0,5 (desvio 0,25) e é
truncada em `[0, 1]`: o crítico de "750/10000" acontece em ~2,3 % dos golpes (e não em 7,5 %), a
esquiva do nível 1 em ~0,2 % e a do nível 12 em ~3,4 %. É o comportamento do Canary — `combat/
hazard.test.ts` mede as três com 200 mil sorteios — e é o que este motor reproduz: o reforço de
dano, que é determinístico, é quem carrega o perigo.

**O golpe reforçado é "extensão", e extensão pula os charms defensivos.** O
`parseAttackRecvHazardSystem` marca `damage.extension = true` no crítico e no reforço, e o
`Game::combatChangeHealth` só rola os charms defensivos quando `!damage.extension` — como o reforço
vale para todo golpe de monstro de zona (nível ≥ 1), **os charms defensivos (Dodge, Parry, Numb,
Adrenaline Burst) nunca rolam contra monstro de hazard**. Reproduzido, mesmo estranho.

## O nível sobe matando o chefe

`Hazard:levelUp` (Canary): o teto desbloqueado sobe um (até 12) quando o jogador **escolheu o
próprio teto** e o chefe da zona morre. A conta de `creaturescripts_the_primal_menace_killed.lua`:
o menor nível escolhido entre os feridores é `hazardPoints`; cada feridor cujo teto é IGUAL a
`hazardPoints` chama `levelUp`, que só sobe se o nível escolhido também for o teto. Aqui:
`HazardProgress.levelUp` (`packages/sim/src/hazard.ts`), disparado por `#hazardOnMonsterDeath` na
morte do monstro `zone.levelUpMonsterId`, e o evento notável `hazard-level-up` ("Hazard: Gnomprona
Gardens · nível 4 liberado") entra no extrato.

**The Primal Menace ainda não está no catálogo** (`big death wave` é magia de nome próprio sem
mapeador, #579) e o Canary o luta numa instância de quest, não na hunt. O `levelUpMonsterId` fica
declarado no conteúdo — e o `sim` já o lê — para o dia em que a luta existir; **hoje todo
personagem joga a zona no nível 1**, e o mecanismo está provado por teste com um chefe de
fixture.

## Persistência (ADR 0052 d.1 e d.5)

Registro `jsonb` `characters.hazard` (migração `0027_632-hazard.sql`):
`{ maxLevel: { zoneId: n }, currentLevel: { zoneId: n }, version: 1 }`. Lido INTEIRO no ticket,
escrito INTEIRO pelo ledger a partir do extrato — **última escrita vence** (a escolha desce e
sobe), nunca fusão por máximo. A escolha na Cidade grava o extrato de estado NA HORA (e não só no
`release`): o ticket de uma party é emitido pela `api` a partir da linha do banco, e sem isto o
membro entraria na hunt com o nível de antes. Quem nunca tocou no hazard não gera extrato por
causa dele. O S2C `hazard` manda o registro cru no attach, a cada escolha e a cada subida de
nível; `catalogue.hazardZones` traz nome e faixa de cada zona e `catalogue.hunts[].hazardZoneId`
diz qual hunt é de zona.

## Regras

- Uma hunt é de zona de hazard quando `hunt.hazardZoneId` aponta uma chave de
  `hazard/baseline.json.zones`; `buildContent` recusa a zona inexistente. A zona do Canary é uma
  CAIXA de coordenadas; aqui é a hunt inteira, porque a sessão é instanciada.
- O estágio só roda no perfil `combat-v4` (`hasHazardStage`). Numa sessão fixada em `combat-v3`
  (conteúdo anterior) o nível existe e não faz nada (invariante 7).
- O nível de cada jogador é o do registro dele na Cidade, lido a cada golpe como o MENOR entre os
  participantes — fixo porque a escolha é recusada dentro da hunt, e não por um campo copiado.
- O carimbo do último crítico levado (`CharacterRuntime.hazardCriticalAtMs`) vive no relógio
  lógico da sessão: viaja no snapshot e zera em `Session.enter`.

## Parâmetros de balanceamento

Todos em `packages/content/data/hazard/baseline.json`, transcritos de `config.lua.dist` /
`configmanager.cpp` do Canary `47dfd51`. Nenhum é decisão nossa; nenhum `[ABERTO]`.

| Parâmetro | Valor | Origem no Canary |
|---|---|---|
| `criticalIntervalMs` | 2000 | `hazardCriticalInterval` |
| `criticalChance` | 750 | `hazardCriticalChance` |
| `criticalMultiplier` | 25 | `hazardCriticalMultiplier` |
| `damageMultiplier` | 200 | `hazardDamageMultiplier` |
| `defenseMultiplier` | 0 | `hazardDefenseMultiplier` |
| `dodgeMultiplier` | 85 | `hazardDodgeMultiplier` |
| `expBonusMultiplier` | 2 | `hazardExpBonusMultiplier` |
| `lootBonusMultiplier` | 2 | `hazardLootBonusMultiplier` |
| `podDropMultiplier` | 87 | `hazardPodsDropMultiplier` |
| `plunderSpawnMultiplier` | 25 | `hazardSpawnPlunderMultiplier` |
| `zones.gnomprona-gardens` | 1–12; crit, dodge, damageBoost, defenseBoost ligados | `hazard_primal.lua` |

A hunt: `packages/content/data/hunts/gnomprona-gardens.json` (mapa e rota do OTBM real, spawns do
`otservbr-monster.xml`; o `_open` do arquivo traz os comandos exatos e o que ficou de fora).

## Divergências do Canary

Só as que NÃO são regra de caçada (ADR 0037 d.6 não admite divergência de caçada):

- **A zona é a hunt, e o nível se escolhe na Cidade** — o Canary usa uma caixa de coordenadas e um
  NPC. É a forma da sessão instanciada, não uma regra do jogo.
- **Hazard Pods ficam de fora** — o casulo é um item no chão que vira Fungosaurus em 4 s (ou fere
  quem o pisa entre 2 e 4 s), e o Draconya não tem item no chão além do cadáver (ADR 0048 d.8).
  A rolagem dele continua consumida e continua impedindo o Plunder, para o Plunder ter a chance que
  o Canary dá. É a exceção que a direção da issue deixou escrita; **fica registrada como não
  feita**, não como divergência aceita.
- **O portão `isRewardBoss` do Plunder** não existe (não há "chefe de recompensa" no catálogo);
  nenhum monstro desta zona é um.
- **A mensagem "(Hazard)" no texto de dano/XP/loot** é apresentação e não foi desenhada.

## Em aberto

Nada herdado do PRD. As pendências são de dependência: o casulo (item no chão), o chefe que sobe
o nível (catálogo de monstros com magia de nome próprio, #579), e as 13 espécies da zona que o
catálogo ainda não resolve (Gore Horn, Gorerilla, Emerald Tortoise, Sabretooth, Sulphur Spouter,
Undertaker, Nighthunter, Sulphider, Mantosaurus, Mercurial Menace, Noxious Ripptor, Headpecker,
Shrieking Cry-Stal — magias de nome próprio, corrente de energia e as condições `root`/`fear` do
#622). Rodar `pnpm catalog:spawns --map gnomprona-gardens` quando elas entrarem os acrescenta ao
mapa.
