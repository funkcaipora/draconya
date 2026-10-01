// Ruleset de Hunt (FUN-43, §14) — o primeiro ruleset concreto, e o molde dos outros cinco.
//
// Um ruleset define QUATRO coisas, e são as mesmas para hunt, treino, quest, boss e guild
// war. Vale escrever de novo aqui, porque é o teste de fogo da interface:
//
//   | como entra          | pelo menu, com dificuldade escolhida; instância criada na entrada |
//   | o que encerra       | ação manual, regra de saída, ou morte (§14.8)                     |
//   | o que a morte faz   | encerra — devolver à PZ é a FUN-38, do lado do servidor           |
//   | como recompensa     | loot, XP e abate no Bestiário, bloqueados com stamina zero        |
//
// Se a Guild War não couber nessa mesma interface depois, ela foi modelada em cima de hunt —
// e descobrir isso na F5 custa semanas. É por isso que nada aqui pede método novo em
// `Ruleset`: tudo o que a hunt precisa cabe em `onEnter`, `onEvent`, `onCreatureDied`, `onEnd`
// e no par `getState`/`restore`.
//
// A instância é ISOLADA: mapa, rota e spawns são desta sessão e de mais ninguém. Não existe
// disputa por spawn, e é isso que permite a hunt rodar sozinha, com o navegador fechado.

import {
  BASIC_ABILITY_ID, BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, DRUNK_CONDITION_KEY,
  FEARED_CONDITION_KEY, INVISIBLE_CONDITION_KEY, ITEM_SLOTS, PACIFIED_CONDITION_KEY,
  ROOTED_CONDITION_KEY, SPELL_SKILL_WEAPON, fieldStagesOf, floorChangeAt,
  floorChangeToward, isBlocked, migrateBotConfigV1,
} from '@draconya/content';
import type {
  AmmoFamily, Ammunition, BotAction, BotActionV2, BotConfig, BotConfigV2, BotExitRule, BotLoot, Charm, Combat,
  CompiledWeaponFamily, Content, DamageModifiers, DamageType, FieldSpec, FieldStage, Hunt,
  Item, ItemSlot, Monster, MonsterAbility, MonsterDefense, MonsterSummonEntry, MonsterTargetChange,
  PartyConfig, Point, Progression, Regen, ResolvedWeapon, Route, Skill, Skinning, Spell, SpellArea, SpellEffect,
  SpawnPoint, Stamina, Supply, Tilemap, Vocation, WeaponFamily, WeaponProfile,
} from '@draconya/content';
import { CharacterRuntime } from '../character.js';
import { areaTiles, directionOf, FORWARD, isSelfOrigin, tileKey } from '../area.js';
import type { AreaSource, Direction } from '../area.js';
import {
  NOT_IN_CATALOG, NOT_POSSIBLE, NOT_SUMMONABLE, TOO_MANY_SUMMONS, actionExhaustKey, balanceOf,
  castSpell, executeHealing, groupCooldownKey, ownPurse, spellCooldownKey, supplyCooldownKey, useSupply,
} from '../casting.js';
import type {
  CastRefused, CastResult, CastSuccess, Purse, SpellAim, SpellScaling, SpellTarget, UtilityRefusal,
} from '../casting.js';
import type { ConditionState, FleeState } from '../conditions.js';
import {
  advanceTick, conditionFromSpec, conditionImmunityOf, retiredTick, rollDrunkDeviation, sameTick,
  specTickIntervalMs, tickOf,
} from '../conditions.js';
import type { NormalizedTick } from '../conditions.js';
import { Fields } from '../fields.js';
import type { TileFieldState } from '../fields.js';
import { NO_FLEE_INDEX, fleePath, initialFleeIndex, stepFrom } from '../fear.js';
import type { FleeMap } from '../fear.js';
import { chestStorageKeyOf, isDoorKind, isToggleable, TileOverrides } from '../tile-overrides.js';
import type { InteractableKind, InteractableTool, TileOverrideState } from '../tile-overrides.js';
import type { CreatureHealed, PartyBagChanged, SpellCastTarget } from '../combat-events.js';
import { resolveDamage } from '../combat/damage.js';
import { hasCharmStage, hasSkinningStage } from '../combat/profile.js';
import {
  ADRENALINE_BURST_CONDITION, ActionCritical, CHARM_PARALYZE_CONDITION, CLEANSE_IMMUNITY_MS,
  FATAL_HOLD_MS, carnageCharmDamage, charmAttackBonus, charmChance, cleanseTypeOfCondition,
  cleanseTypeOfSpec, findAssigned, negatedOutcome, offensiveCharmEffect, rollCleanseCharm,
  rollDefensiveCharm, rollNormalPercentCharm, rollOffensiveCharm,
} from '../combat/charms.js';
import type { CharmAttackBonus, CleanseType } from '../combat/charms.js';
import type { AssignedCharms } from '../charms.js';
import { IN_FIGHT_WINDOW_MS, isInFight } from '../combat/in-fight.js';
import type { DamageOutcome, Defender } from '../combat/damage.js';
import { reflectedDamageIntent } from '../combat/reflect.js';
import { cleavePower, cleaveTiles } from '../combat/cleave.js';
import type { ReflectAttacker, ReflectedDamage } from '../combat/reflect.js';
import { applyDamageOutcome } from '../combat/outcome.js';
import type { AppliedDamageOutcome } from '../combat/outcome.js';
import {
  combineCombatModifiers, monsterCriticalModifiers, rollSharedCriticalOutcome,
} from '../combat/modifiers.js';
import type { DefenseSource } from '../combat/defense.js';
import {
  DISTANCE_BLOCK_FLAGS, MAGIC_BLOCK_FLAGS, MELEE_BLOCK_FLAGS,
} from '../combat/blockhit.js';
import { attackedRecently } from '../combat/fight-mode.js';
import { playerArmor, playerDefense, playerMitigation } from '../combat/player-defense.js';
import type { PlayerMitigationVocation } from '../combat/player-defense.js';
import { resolveWeaponPower } from '../combat/weapon-power.js';
import { rollCombatValue } from '../combat/combat-value.js';
import { resolveWeaponHit } from '../combat/weapon-power.js';
import type { WeaponHit } from '../combat/weapon-power.js';
import { missShotTile, rollDistanceHit } from '../combat/distance-hit.js';
import {
  afterAttackBlock, afterShieldBlock, distanceTries, meleeTries,
} from '../combat/attack-practice.js';
import { forgetActor, recordDamage, resolveDeath } from '../death.js';
import type { KillCredit, Victim } from '../death.js';
import type { BestiaryConfig } from '../bestiary.js';
import type { BosstiaryConfig } from '../bosstiary.js';
import { pickByWeight, Spawner } from '../hunt/spawner.js';
import type { SpawnArea, SpawnerState } from '../hunt/spawner.js';
import { rollLoot } from '../loot.js';
import {
  SCAVENGE_CHARM_ID, rollSkinning, scavengeChanceFor, skinningChanceRange, skinningStageAt,
} from '../skinning.js';
import {
  applyAttackRate, applyRate, creatureRatesFor, experienceRateFor, skillRateFor,
} from '../rates.js';
import {
  autoSellLimit, bagValue, canShareExperience, DEFAULT_SHARED_EXPERIENCE_RULES, partyScaledManaCost,
  reserveProportionally, settleEntries, shareCostsOf, sharedExperiencePercent, splitEqually,
  splitLootOf, uniqueVocations, xpByDamage, xpShare,
} from '../party.js';
import type { MemberCapacity, PartyBagState } from '../party.js';
import type { LootAmmunition, LootGut, LootItem, LootResult, LootSupply } from '../loot.js';
import type { CarriedItem, ContainerRules, EquipmentObserver, Wearer } from '../inventory.js';
import { compileBot, percentOf } from '../bot.js';
import type { BotActuator, BotView, CompiledBot, CompiledSlot, CooldownOfAction } from '../bot.js';
import { compileAutomations } from '../automation.js';
import type { AutomationActuator, CompiledAutomations } from '../automation.js';
import {
  CHALLENGE_CONDITION_KEY, FATAL_HOLD_CONDITION_KEY, MonsterRuntime, canMonsterEnterField, chooseTarget,
  decideMonsterAction, decideUnengagedMove, isInSpawnRange, isMonsterFleeing, monsterSubject,
  nearestPrey, seesInvisible,
} from '../monster/monster.js';
import type { MonsterState, Prey } from '../monster/monster.js';
import { abilityBlockFlags, abilityTargets, abilityTiles, isMeleeAbility } from '../monster/ability.js';
import type { Blocked, FloorPoint, GridPoint } from '../monster/step.js';
import {
  danceStep, distance, fleeStep, greedyStep, sameFloor, shuffledCardinals,
} from '../monster/step.js';
import { isSightClear } from '../line-of-sight.js';
import { DEFAULT_TARGETING, countAreaTargets, countTargets, selectTarget } from '../targeting.js';
import type { Targeting } from '../targeting.js';
import {
  applyDeathPenalty, applyExperienceBonus, grantXp, levelExperienceBonusPercent, statsForLevel,
} from '../progression.js';
import { Rng } from '../rng.js';
import {
  containerRulesFor, equipmentAbsorb, equipmentCleavePercent, equipmentReflect, immunitiesOnly,
} from '../inventory.js';
import {
  TileOccupancy, canOccupy, move, movementDuration, place, placeNear, relocate, swapPlaces,
  tilesAround,
} from '../movement.js';
import type { Movable, MoveResult, WorldPoint } from '../movement.js';
import type { RouteState } from '../route/walker.js';
import { EventPriority } from '../schedule.js';
import type { ScheduledEvent } from '../schedule.js';
import { powerMultiplier, skillFactorFor } from '../skills.js';
import { drainStamina, isExhausted } from '../stamina.js';
import { drainFedMs, feed as feedCharacter, FOOD_CAP_MS } from '../food.js';
import { findRelation, levitateDestination, ropeDestination } from '../utility-spells.js';
import { blessingCount } from '../blessings.js';
import { consumeLossAmulet, loseItemsOnDeath } from '../item-loss.js';
import type { ItemLossOutcome } from '../item-loss.js';
import { RouteWalker } from '../route/walker.js';
import { boundedPath, isAdjacentTo, isExactly } from '../route/pathfind.js';
import { Session } from '../session.js';
import type { Aggregates, EndReason, Receipt, Ruleset, SessionSnapshot } from '../session.js';

/**
 * Os eventos da hunt. Uma cadência, um tipo — e cada um reagenda a si mesmo.
 *
 * Antes tudo isto era uma fase do `onTick`, avaliada a cada passo para quase sempre não fazer
 * nada. Agora cada cadência acorda na hora dela.
 */
const PLAYER_STEP = 'player-step';
const PLAYER_ATTACK = 'player-attack';
const MONSTER_STEP = 'monster-step';
const MONSTER_ATTACK = 'monster-attack';
/**
 * Uma ability DECLARADA do monstro (CMB-06). O subject é derivado (`m:<id>:<abilityId>`), e é
 * ele que a morte cancela sem varrer a fila — `#onMonsterDied` conhece os ids pelo conteúdo.
 *
 * A básica legada continua em `MONSTER_ATTACK` com subject `m:<id>`: um snapshot de um nó
 * anterior traz esses eventos, e tratá-los como ability básica é o que mantém a retomada
 * compatível durante o deploy em rolagem.
 */
const MONSTER_ABILITY = 'monster-ability';
const monsterAbilitySubject = (id: number, abilityId: string): string =>
  `${monsterSubject(id)}:${abilityId}`;
/**
 * Uma DEFESA declarada de monstro (#518): mesmo desenho do `MONSTER_ABILITY`, subject derivado
 * (`m:<id>:<defenseId>`) para a morte cancelar sem varrer a fila e para duas defesas do mesmo
 * monstro, com cadências diferentes, não colidirem no mesmo (kind, subject).
 */
const MONSTER_DEFENSE = 'monster-defense';
const monsterDefenseSubject = (id: number, defenseId: string): string =>
  `${monsterSubject(id)}:${defenseId}`;
/**
 * Uma entrada de invocação declarada de monstro (#546): mesmo desenho do `MONSTER_DEFENSE`,
 * subject derivado (`m:<id>:<monsterId>`) para a morte do MESTRE cancelar sem varrer a fila, e
 * para duas entradas de nomes diferentes não colidirem no mesmo `(kind, subject)`. O
 * `monsterId` (o nome do que nasce) é o identificador natural da entrada, como o TFS conta
 * `summonCount` por `summonBlock.name` — `buildContent` recusa duas entradas do mesmo nome no
 * mesmo monstro, então a chave é única por construção.
 */
const MONSTER_SUMMON = 'monster-summon';
const monsterSummonSubject = (id: number, monsterId: string): string =>
  `${monsterSubject(id)}:${monsterId}`;
/**
 * O raio de busca de tile livre para uma invocação nascer perto do mestre (#546, TFS/Canary
 * `Map::placeCreature(centerPos, creature, extendedPos: false, ...)`, chamado por
 * `Game::placeCreature(summon, getPosition(), false, summonBlock.force)`): a posição exata do
 * mestre já está ocupada por ELE — tile é exclusivo (invariante 8) —, então a busca tenta os
 * vizinhos, como `Spawner.#freeTile`. **É 1, não um raio maior — fidelidade, não estética.**
 * Com `extendedPos: false` a fonte usa só o `normalRelList` de 8 posições (os 8 vizinhos
 * imediatos; `things/sources/forgottenserver/src/map.cpp`, o mesmo em
 * `things/sources/canary/src/map/map.cpp`) e NUNCA expande além disso — sem vizinho livre,
 * `placeCreature` devolve falso e a invocação daquela rolagem simplesmente não acontece (o TFS
 * não tenta um anel mais largo). Um raio maior aqui nasceria invocação 2-3 tiles longe do mestre
 * em sala cheia, onde a fonte teria simplesmente desistido daquela rolagem — a PRÓXIMA cadência
 * desta entrada tenta de novo, como o respawn adiado do Spawner.
 */
const SUMMON_SPAWN_RADIUS = 1;
/**
 * O teto de invocações VIVAS por PERSONAGEM (#598, M38-01, ADR 0057 decisão 3): "Teto de 2" —
 * `summon_creature.lua` do Canary confere `player:getSummonCount() >= 2` antes de invocar,
 * somando invocação normal e familiar no MESMO contador (`Player::getSummonCount`,
 * `player.cpp`). O familiar (#599) soma no mesmo teto quando existir; hoje só a Summon Creature
 * o usa.
 */
const PLAYER_SUMMON_CAP = 2;
/**
 * Os quatro vizinhos ORTOGONAIS que o Carnage atinge, na ordem do Canary
 * (`iobestiary.cpp: offsets = {{-1,0},{1,0},{0,-1},{0,1}}`).
 */
const CARNAGE_OFFSETS: readonly (readonly [number, number])[] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
/**
 * A troca de alvo por tempo (#518). Só existe UMA por monstro — o subject é o `m:<id>` de
 * sempre, e `resolveDeath` já a cancela junto do resto ao matar (`cancelEvents(subject)`).
 */
const MONSTER_TARGET_CHANGE = 'monster-target-change';
/**
 * A dança de alvo (#543, TFS/Canary `Monster::getDanceStep`): o passo lateral cosmético de quem
 * já está colado e sem passo a dar. Mesmo desenho do `MONSTER_TARGET_CHANGE` — subject `m:<id>`
 * exato, cancelado de graça por `resolveDeath` (`cancelEvents(subject)`) —, mas diferente dele
 * na vida útil: NÃO roda a hunt inteira, só enquanto a adjacência se mantém (`MonsterRuntime.
 * danceArmed`). Um monstro perseguindo ou sem alvo não paga o timer.
 */
const MONSTER_DANCE = 'monster-dance';
/** A cadência PRÓPRIA da dança (#543) — decisão de produto do Draconya, não réplica de um
 * "think" de movimento do Canary, que não tem um relógio separado do passo em si. */
const DANCE_INTERVAL_MS = 1_000;
const HEALTH_REGEN = 'health-regen';
const MANA_REGEN = 'mana-regen';
const SPAWN = 'spawn';
/**
 * A população INICIAL da hunt (#583, `SpawnMonster::startup` do Canary): todo ponto nasce na
 * hora, sem `blockable`/telegraph — essas regras só valem para o RESPAWN depois de uma morte.
 * Ver `#onSpawnInitial`.
 */
const SPAWN_INITIAL = 'spawn-initial';
/**
 * O lugar NÃO BLOQUEÁVEL já sorteou o monstro e a posição, e o telegraph de 4200 ms venceu
 * (#583, `spawn_monster.cpp:317-341`, 3× `NONBLOCKABLE_SPAWN_MONSTER_INTERVAL`): o monstro
 * materializa agora, mesmo com participante em cima do ponto. Ver `#pendingSpawns`.
 */
const SPAWN_MATERIALIZE = 'spawn-materialize';
/** O cadáver apodreceu (FUN-123): sai do chão. */
const CORPSE = 'corpse';
/**
 * Um interativo reverte sozinho (#728, ADR 0050 d.3): capim cortado volta a crescer, buraco
 * enche de volta. Evento na fila (invariante 2) — nunca um prazo somado por tick —, agendado no
 * `toggle` que abre o estado temporário e cancelado se alguém usar de novo antes de vencer. O
 * `subject` é o `interactableId` (a posição, `interactableIdOf`); porta não agenda este evento —
 * ela fecha no `vacate` (`TileOverrides.closeDoorIfVacant`), e alavanca não decai.
 */
const TILE_REVERT = 'tile-revert';
const EXIT_RULES = 'exit-rules';
const EXIT_COUNTDOWN = 'exit-countdown';
/**
 * O vencimento da votação de encerrar a hunt para todos (#432, ADR 0032 d.14). É um evento da
 * fila no instante exato em que vence — nunca um contador por tick (invariante 2). O subject é
 * fixo porque só existe uma votação por vez: re-propor cancela o vencimento anterior.
 */
const END_VOTE_EXPIRE = 'end-vote-expire';
const END_VOTE_SUBJECT = 'end-vote';
/** A janela de aprovação, em tempo LÓGICO (ADR 0032 d.14). Conteúdo pode mudar sem ADR. */
export const END_VOTE_WINDOW_MS = 60_000;

/**
 * O disparo manual ACEITO mas ADIADO pela exaustão de ação compartilhada (#726, ADR 0049
 * decisão 6): agenda no vencimento do livro `exhaust:action`, e um segundo disparo antes disso
 * SUBSTITUI o primeiro — `character.pendingManualAction` guarda qual, e o subject é o
 * `characterId` (nunca dois pendentes do mesmo personagem ao mesmo tempo).
 */
const PENDING_MANUAL_ACTION = 'pending-manual-action';

/**
 * A exaustão de ação de um item da mochila/carga/comida que não declara `actionExhaustMs`
 * próprio (comida, carga de bênção — só o SUPPLY do catálogo declara o campo, #690): o
 * `timeBetweenExActions` do Canary/TFS (`configmanager.cpp`, default 1000 — distinto do
 * `timeBetweenActions` de 200 usado por passo/ataque comuns). `use-item`/`use-item-on` são as
 * "Ex actions" do Tibia (`playerUseItemEx`), e são elas que essa constante regula.
 */
const MANUAL_ITEM_EXHAUST_MS = 1_000;

/**
 * O resultado da esfola do bot no abate (#626). `afterTtlMs` só existe quando HOUVE sorteio — é
 * ele que diz "tentou": a vida que o cadáver passa a ter (do estágio em que foi esfolado; o
 * `transform(skin.after)` do Canary reinicia o decaimento). `material` é o que o sorteio rendeu.
 */
interface SkinAtDeath {
  readonly material: LootItem | null;
  readonly afterTtlMs: number | undefined;
}

/** O abate sem esfola: sem ferramenta, sem monstro esfolável ou fora do `combat-v4` (#626). */
const NO_SKIN: SkinAtDeath = { material: null, afterTtlMs: undefined };

/**
 * O vencimento de um item equipado por TEMPO (ADR 0032 d.8): o anel que gasta por duração. É
 * um evento da fila, agendado no equip e cancelado no desequip (invariante 2) — nunca um
 * `remainingMs -= dtMs`. O subject é `<characterId>:<slot>`, o que permite cancelar por slot.
 */
const EQUIP_EXPIRE = 'equip-expire';
function equipExpirySubject(characterId: string, slot: ItemSlot): string {
  return `${characterId}:${slot}`;
}

/**
 * Um ganho da regeneração PRÓPRIA de um item vestido (#688, `bonuses.regeneration`): a
 * `CONDITION_REGENERATION` que o Canary cria por slot em `MoveEvent::EquipItem`. Um evento por
 * ganho, no instante exato (invariante 2), somado à regeneração da vocação e independente dela —
 * as cadências diferem. O subject é `<characterId>:<slot>:<health|mana>`, o que permite
 * cancelar por slot quando o item sai.
 */
const ITEM_REGEN = 'item-regen';
type ItemRegenResource = 'health' | 'mana';
function itemRegenSubject(characterId: string, slot: ItemSlot, what: ItemRegenResource): string {
  return `${characterId}:${slot}:${what}`;
}

/**
 * O ciclo das automações do catálogo (AB-08, ADR 0032 d.9). Evento PERIÓDICO que se reagenda
 * (como `monster-step`), nunca avaliação por tick: a 1 Hz desanexada o resultado é o mesmo da
 * 10 Hz anexada (invariante 2, ADR 0020). O subject é o personagem; quem não habilitou
 * automação nenhuma não agenda nada.
 */
const AUTOMATION = 'bot-automation';
const AUTOMATION_INTERVAL_MS = 1_000;

type ExitReason = 'manual-exit' | 'exit-rule';

/**
 * A saída pendente de um personagem, como o hospedeiro a apresenta (#802): o motivo, em que fase
 * ela está e o instante LÓGICO em que ela conclui — o mais cedo que o ruleset a deixa terminar
 * SE nenhum golpe novo empurrar a trava de combate. É leitura pura do que já está agendado
 * (`EXIT_COUNTDOWN`) e do carimbo de combate: nada aqui é estado novo nem entra no snapshot.
 *
 * - `countdown`: a contagem VISUAL do `exitDelayMs` corre e o personagem está fora de combate;
 * - `in-combat`: o personagem lutou há menos de `IN_FIGHT_WINDOW_MS` — a saída só conclui quando
 *   a janela vence (a do `CONDITION_INFIGHT` do Canary, por dano aplicado — #625, `in-fight.ts`).
 */
export interface ExitStatus {
  readonly reason: ExitReason;
  readonly phase: 'countdown' | 'in-combat';
  readonly untilMs: number;
}
/**
 * As condições (#155, CMB-07): o vencimento e o tique periódico. Eventos da fila (invariante 2),
 * nunca acumulador. `subject` é `<targetId>/<key>`: um cancelamento por condição, sem varrer a
 * fila. O alvo pode ser personagem ou monstro desde o CMB-07 — o id do monstro é `m:<id>`.
 */
const CONDITION_EXPIRE = 'condition-expire';
const CONDITION_TICK = 'condition-tick';
const conditionSubject = (targetId: string, key: string): string => `${targetId}/${key}`;
/**
 * O think de VISIBILIDADE (#559): o momento em que uma criatura larga o alvo que ficou invisível.
 * No Canary/TFS é o `Creature::onThink` (`creature.cpp:130-140`) — `attackedCreature &&
 * !canSeeCreature(attackedCreature)` — que roda UMA vez por `EVENT_CREATURE_THINK_INTERVAL`
 * (1000 ms, `creature.hpp:47`), e cada criatura pensa numa fase própria e sorteada
 * (`Game::addCreatureCheck`, `game.cpp:7672`: `uniform_random(0, EVENT_CREATURECOUNT - 1)`). O sim
 * não tem um relógio de think por criatura (seria um evento por criatura por segundo, invariante
 * 2), então o think que importa é AGENDADO no instante em que a invisibilidade começa
 * (`#scheduleVisibilityThinks`): quem tinha a criatura como alvo pensa uma vez, num instante
 * sorteado em [0, 1000) ms — a mesma distribuição da fase do Canary — e larga o alvo se ele
 * continuar invisível. `subject` é a criatura que pensa (`m:<id>` ou o `characterId`), o que
 * cancela o evento de graça quando ela morre (`resolveDeath`).
 */
const VISIBILITY_THINK = 'visibility-think';
const VISIBILITY_THINK_INTERVAL_MS = 1_000;
/**
 * O pensamento do PERSONAGEM (`Game::checkCreatures`, `game.cpp:7726`): o Canary roda `onThink`,
 * `onAttacking` e `executeConditions` de cada criatura UMA vez por `EVENT_CREATURE_THINK_INTERVAL`
 * (1000 ms, `creature.hpp:47`), numa fase própria e sorteada ao entrar no jogo
 * (`Game::addCreatureCheck`). O `sim` não tem um relógio de think por criatura (invariante 2): a
 * fase é SORTEADA UMA VEZ por personagem, com o `Rng` da sessão, na primeira vez que alguém precisa
 * dela (`#thinkDelayMs`), e persiste no snapshot (`RunnerState.thinkPhaseMs`) — é a grade de
 * pensamentos do personagem, a mesma para o medo e para a retomada do golpe. Quem depende do
 * pensamento é AGENDADO para o próximo instante da grade, nunca um evento por segundo.
 */
const CREATURE_THINK_INTERVAL_MS = 1_000;
/**
 * O pensamento da condição `feared` do PERSONAGEM (M44-04, #622): o `ConditionFeared::
 * executeCondition` do Canary, no pensamento do personagem (`CREATURE_THINK_INTERVAL_MS`). É
 * AGENDADO quando o medo começa, no próximo instante da grade do personagem, e se re-arma a cada
 * 1000 ms até o primeiro pensamento DEPOIS do prazo — que fecha a condição (o Canary só a limpa
 * nesse pensamento, e a fuga do último pensamento sai antes de a condição fechar). O `subject` é o
 * `characterId`. Não há `CONDITION_EXPIRE` para o `feared` de personagem: quem o encerra é este
 * evento.
 */
const FEAR_THINK = 'fear-think';
/**
 * O pensamento que RETOMA o golpe depois de `pacified` (M44-04, #622): `Player::doAttacking` volta
 * antes de qualquer golpe sob a condição (`player.cpp:3982`) e NINGUÉM re-arma o ataque quando ela
 * acaba — a cadeia de golpes do Canary morre ali, e o próximo golpe sai no primeiro gatilho depois
 * do prazo: o pensamento seguinte do personagem (`Game::checkCreatures` chama `onAttacking`) ou um
 * passo dele/do alvo (`Creature::onCreatureMove`, o `#armPlayerAttack` deste motor). Este evento é
 * o pensamento: agendado UMA vez por pacificação, no primeiro instante da grade do personagem a
 * partir do vencimento. O `subject` é o `characterId`.
 */
const ATTACK_THINK = 'attack-think';
/**
 * A imunidade a novo medo depois que um acaba (`Player::setImmuneFear()`, `player.cpp:1930`,
 * default `10000`): 10 s em que `Combat::checkFearConditionAffected` recusa reaplicar. O Cleanse
 * dá 11 s (`CLEANSE_IMMUNITY_MS`). Mesma janela do mapa `cleanseImmunity`, chave `feared`.
 */
const FEAR_IMMUNITY_MS = 10_000;
/**
 * A chave e a duração do `CONDITION_SOUL` do Canary (#593, `Player::onGainExperience`,
 * `data/events/scripts/player.lua`): quatro minutos, fixo — não é `_open` porque o Canary não
 * varia isto por vocação nem por conteúdo, ao contrário do teto e da cadência (`soulMax`/
 * `soulGainTicksMs`, que SÃO conteúdo). Relançar (`merge: 'refresh'`) reinicia o prazo, como o
 * Canary faz a cada XP ganha.
 */
const SOUL_CONDITION_KEY = 'soul-regen';
const SOUL_CONDITION_DURATION_MS = 4 * 60 * 1000;
/**
 * Os campos de tile (CMB-07): um evento POR CAMPO. O tique aplica a condição a quem pisa nos
 * tiles; o vencimento tira o campo. `subject` é `f:<id>`.
 */
const FIELD_TICK = 'field-tick';
const FIELD_EXPIRE = 'field-expire';
/**
 * O campo troca para o PRÓXIMO estágio da cadeia (#560, `decayTo` do Canary) — só quando há um
 * próximo; o último estágio vence por `FIELD_EXPIRE`, como sempre. Nunca os dois agendados ao
 * mesmo tempo para o mesmo campo: o vencimento do estágio atual dispara UM dos dois, nunca
 * ambos — quem decide qual, em `applyField`/`#onFieldStageAdvance`, é `stageIndex + 1 <
 * stages.length`.
 */
const FIELD_STAGE_ADVANCE = 'field-stage-advance';
const fieldSubject = (fieldId: string): string => `f:${fieldId}`;

/**
 * O id de UMA instância de campo lançado por JOGADOR (#591) — `Fields` indexa por id de
 * conteúdo (`fields.ts`), então reaproveitar `spec.id` cru faria a mesma runa em tiles
 * diferentes se substituir (a segunda plantação MOVERIA a primeira) em vez de abrir campos
 * independentes, como o Tibia permite (várias Fire Field lado a lado). O id é o TILE: relançar
 * a MESMA runa no MESMO tile reinicia — a mesma semântica que `applyField` já documenta —, e
 * é determinístico (sem contador para persistir no snapshot).
 */
function fieldInstanceId(specId: string, at: WorldPoint): string {
  return `${specId}@${at.x},${at.y},${at.z}`;
}
/**
 * No MESMO instante, o vencimento roda ANTES do tique — de condição e de campo. É a ordem
 * documentada e testada: o tique do instante de expiração não acontece. A prioridade é explícita
 * (e não a sequência de agendamento) porque relançar reagenda o vencimento depois do tique, e a
 * ordem não pode depender de quem foi agendado por último.
 */
const EXPIRE_PRIORITY = EventPriority.Housekeeping;
const TICK_PRIORITY = EventPriority.Housekeeping + 1;
/**
 * Um evento POR GRUPO de cooldown do conteúdo (AB-07, ADR 0032 d.2). Não existe prioridade
 * global entre grupos: uma cura que executa não atrasa o ataque, porque são vencimentos
 * independentes na mesma fila. Dentro de um grupo, a prioridade é a ordem do slot (RP-002).
 */
const botEvent = (group: string): string => `bot:${group}`;

/** O prefixo que separa o evento de grupo do resto dos eventos do ruleset. */
const BOT_GROUP_PREFIX = 'bot:';

/**
 * O tipo de entrada da configuração do bot (DT-02): v1 ou v2.
 *
 * A v2 é o vocabulário alvo; a v1 continua aceita porque o carregamento só liga a migração no
 * AB-09 (#424) — até lá, `server`/`tools` entregam a config que o jogador salvou, e
 * `migrateBotConfigV1` a normaliza no boundary. A união some no AB-09.
 */
type BotConfigInput = BotConfigV2 | BotConfig;

/**
 * O alvo explícito de um `use-slot` manual (AB-09, ADR 0049 decisão 2), já traduzido pelo host a
 * partir do `creatureId`/`position` numéricos do fio — o `sim` nunca vê o número, só o domínio
 * que já conhece (`subject` de monstro, `characterId`, ou tile). `null`/ausente é "sem mira": cai
 * no default de sempre (alvo fixado, senão o candidato do bot).
 */
export type UseSlotTarget =
  | { readonly kind: 'monster'; readonly subject: string }
  | { readonly kind: 'character'; readonly characterId: string }
  | { readonly kind: 'position'; readonly position: FloorPoint }
  /**
   * O `creatureId` do fio não resolveu para NENHUM personagem/monstro conhecido do host
   * (criatura já saiu de vista/sessão). Distinto de "ausente" (`undefined`): o jogador MIROU
   * algo, e isso precisa recusar `no-target` numa ação mirável — não cair em silêncio no
   * default, que executaria contra um alvo que ele não escolheu.
   */
  | { readonly kind: 'invalid' };

/**
 * A referência a UM item/suprimento de um `use-item`/`use-item-on` (#726, ADR 0049 decisão 3):
 * `instanceId` é uma unidade concreta na mochila/bolsa; `supplyId` é uma unidade do ESTOQUE
 * abstrato (poção, runa, munição — ADR 0026 d.8/ADR 0044), sem instância própria — o MESMO
 * caminho de `useSlot`/`#useSupply`, só que sem passar pela barra. Discriminada por qual CHAVE
 * está presente — a mesma forma do `ref` do protocolo (`itemRefSchema`) e de
 * `CharacterState.pendingManualAction.ref` — para viajar sem tradução entre os três.
 */
export type ItemRef =
  | { readonly instanceId: string }
  | { readonly supplyId: string };

/**
 * Por que `use-item`/`use-item-on` não aconteceu (#726, ADR 0049 decisão 3/7): as mesmas do
 * slot, mais as três que só um item da mochila/estoque pode devolver — `not-carried` (a
 * instância não está com o personagem), `not-usable` (o item existe, mas não tem `effect`
 * executável hoje — ferramenta, ADR 0050, ainda não implementada) e `you-are-full` (comida no
 * teto de `fedMs`, "You are full").
 */
export type UseItemRefusal = SlotRefusal | 'not-carried' | 'not-usable' | 'you-are-full';

/** O resultado de `use-item`/`use-item-on`: sucesso — inclusive ACEITO e ADIADO (decisão 6) — ou recusa tipada. */
export type UseItemOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: UseItemRefusal; readonly retryInMs: number };

/**
 * Por que o disparo manual de um slot não aconteceu (AB-09, ADR 0032 d.3). Tipada porque o
 * jogador merece saber qual foi — e porque o host traduz cada uma para o tooltip do slot.
 *
 * `not-in-catalog` cobre magia/item inexistente e os requisitos que o manual não passa
 * (level, vocação): "essa ação não sai agora". O `magic-level-too-low` tem motivo PRÓPRIO
 * desde a M24-12 (RF-02): a UI precisa dizer POR QUE a runa não rodou, e engolir o requisito
 * de magic level no genérico fazia o jogador procurar o problema no saldo e no alvo.
 */
export type SlotRefusal =
  | 'empty-slot' | 'wrong-set' | 'disabled' | 'not-in-catalog' | 'magic-level-too-low'
  | 'not-enough-mana' | 'not-enough-soul' | 'not-enough-gold' | 'not-enough-item' | 'no-target' | 'out-of-range'
  | 'on-cooldown' | 'group-cooldown'
  /**
   * A condição `pacified` (#554 → M44-04, #622 — a trava de escada e qualquer outra fonte): a
   * magia ou a runa é agressiva e a pacificação ainda não venceu.
   */
  | 'attack-locked'
  /** A condição `feared` (M44-04, #622): sob medo nenhuma magia nem runa sai; poção sai. */
  | 'feared'
  /**
   * Magia AGRESSIVA (`damage`/`damage-over-time`) disparada na Cidade (#792, ADR 0044 d.2): a
   * Cidade é protect zone (ADR 0004, §37) — combate nunca sai dali, só conjuração e o resto do
   * vocabulário não-agressivo. Nenhuma hunt devolve esta razão: só `CityRuleset#useSlot`.
   */
  | 'protection-zone'
  /**
   * A invocação (#598, M38-01, ADR 0057 decisão 3): sem `monsterId`, monstro fora do catálogo,
   * não `summonable`, ou teto de 2 invocações vivas já atingido.
   */
  | 'not-summonable'
  /**
   * A magia do slot ainda não foi APRENDIDA (#624, ADR 0058 d.1): `learn-spell` a compra. O slot
   * continua na barra, marcado — nada é escondido (ADR 0032 d.5) —, e o disparo é recusado com
   * este motivo, próprio para o tooltip dizer "aprenda" em vez de "indisponível".
   */
  | 'not-learned'
  /**
   * As duas runas de invocação restantes (#600, M38-03): o alvo não serve — Convince num monstro
   * não `convinceable` ou que já tem mestre, Animate Dead sem cadáver movível no tile (o
   * `RETURNVALUE_NOTPOSSIBLE` do Canary) — e o teto de 2 invocações vivas contra elas ("You cannot
   * control more creatures.", `too-many-summons`). `not-possible` é também a recusa de Levitate e
   * Magic Rope sem destino (#623), e às utilitárias se somam Magic Rope sem onde pousar
   * (`not-enough-room`), Find Person sem o alvo na sessão (`person-not-found`) e Find Fiend sem
   * monstro fiendish (`no-creatures-around`) — as do `RETURNVALUE_*` do Canary.
   */
  | 'not-possible' | 'too-many-summons'
  | 'not-enough-room' | 'person-not-found' | 'no-creatures-around';

/** O resultado do disparo manual: sucesso, ou recusa tipada com o prazo quando é cooldown. */
export type SlotOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: SlotRefusal; readonly retryInMs: number };

/**
 * Por que `useOnMap` recusou (#729, ADR 0050 d.7; `level-too-low` desde #732, ADR 0050 d.6 T2;
 * `quest-incomplete`/`already-looted`/`no-capacity`/`unknown-item` desde #733, T2 completo).
 * `not-usable` cobre tanto "nada usável aqui" quanto um `kind` fora do T1/T2/T3 (`sign` sem
 * `text`…) — o mesmo motivo que `isToggleable` já unifica, para não inventar comportamento de
 * requisito que o conteúdo não pede (spec da #729, "não invente"). `missing-tool` cobre a porta
 * de chave sem a chave certa na mochila — uma chave É uma ferramenta (`use.tool: 'key'`), e
 * `#hasTool` confere o `keyId` quando o `tool` pedido é `'key'` — e, desde a #734, também
 * `teleport`/`pressure-plate`: os dois têm `TOGGLE_PAIR` (para o mecanismo de link), mas nenhum
 * é acionado por CLIQUE (`NOT_CLICK_USABLE`) — teleporte reage a pisar, placa a step-in/step-out.
 * `quest-incomplete` é a porta de quest fechada sem o storage exigido; `already-looted`/
 * `no-capacity`/`unknown-item` são do baú (`#useChest`) — respectivamente já coletado por este
 * personagem, mochila sem espaço (storage NÃO marcado — o baú continua de pé para a próxima
 * tentativa) e `reward.itemId` fora do catálogo carregado (recusa defensiva, como `#deliverLoot`
 * já faz para loot de monstro).
 */
export type UseOnMapRejection =
  | 'out-of-range' | 'nothing-there' | 'not-usable' | 'missing-tool' | 'level-too-low'
  | 'quest-incomplete' | 'already-looted' | 'no-capacity' | 'unknown-item';

/**
 * UM tile cujo id de aparência muda (#729, ADR 0050 d.7): o par `{ fromState, toState }` do
 * `TileOverrideState`, mais o `appearanceKey`/posição do conteúdo — o que o `server` precisa
 * para resolver os dois lados em `appearances.scenery` e montar o `tile-update` (invariante 6:
 * quem resolve para id é o hospedeiro, nunca este pacote).
 */
export interface TileAppearanceChange {
  readonly position: WorldPoint;
  readonly appearanceKey: string;
  readonly fromState: string;
  readonly toState: string;
}

/** O resultado de `useOnMap`: as mudanças de aparência (self + linkados), ou recusa tipada. */
export type UseOnMapResult =
  | { readonly ok: true; readonly changes: readonly TileAppearanceChange[] }
  | { readonly ok: false; readonly reason: UseOnMapRejection };

/** O texto de `look` sem interativo, ou sem `text` próprio (#729). */
const DEFAULT_LOOK_TEXT = 'Você não vê nada de especial.';

/**
 * Descrição padrão por `kind` de cenário, quando o conteúdo não tem `text` próprio (placa é a
 * única que normalmente tem — as demais caem aqui). T2/T3 entram também: `look` não tem alcance
 * nem exige requisito (DT-03/DT-04 da spec da #729), só descreve o que está lá.
 */
const SCENERY_LOOK_TEXT: Partial<Record<InteractableKind, string>> = {
  door: 'Uma porta.',
  'locked-door': 'Uma porta trancada.',
  'level-door': 'Uma porta reforçada.',
  'quest-door': 'Uma porta trancada.',
  grass: 'Um capim alto.',
  'stone-pile': 'Uma pilha de pedras.',
  hole: 'Um buraco no chão.',
  'rope-spot': 'Um lugar para prender uma corda.',
  ladder: 'Uma escada.',
  lever: 'Uma alavanca.',
  chest: 'Um baú.',
  sign: 'Uma placa.',
  teleport: 'Algo estranho.',
  'pressure-plate': 'Uma placa de pressão no chão.',
};

/**
 * A ferramenta exigida NESTE estado, ou `undefined` (#732). Para todo `kind` do T1 (`grass`/
 * `stone-pile`/`rope-spot`) a ferramenta vale sempre — só existe UMA transição que o jogador
 * aciona. `locked-door` é diferente: a chave só tranca a transição `locked → open`
 * (`key_door.lua` do Canary só confere `item.actionid` contra a porta TRANCADA); uma vez
 * destrancada, ela alterna `closed`↔`open` livremente, como uma porta comum — do contrário toda
 * reabertura pediria a chave de novo, e o Canary não faz isso.
 */
function toolRequiredNow(
  kind: InteractableKind, state: string, requires: { readonly tool?: InteractableTool } | undefined,
): InteractableTool | undefined {
  if (kind === 'locked-door' && state !== 'locked') return undefined;
  return requires?.tool;
}

/**
 * `kind` cujo `TOGGLE_PAIR` existe só para o mecanismo de `toggle`/link (#734, ADR 0050 d.6 T3)
 * — nunca para o CLIQUE do jogador. Teleporte reage a PISAR (`movement.ts#move`, gated pela
 * alavanca que o liga); placa de pressão reage a step-in/step-out (`#onSteppedOnto`/
 * `#onSteppedOffOf`, abaixo). `useOnMap` os recusa aqui mesmo `isToggleable` valendo `true` —
 * clicar numa placa ou num teleporte não é um caso do T1 nem do T3.
 */
const NOT_CLICK_USABLE: ReadonlySet<InteractableKind> = new Set(['teleport', 'pressure-plate']);

/**
 * O estado de UM slot do conjunto ativo (AB-09, UC-BAR-003). É APRESENTAÇÃO: espelha a mesma
 * elegibilidade de `#perform` sem mutar nada, e a contagem de consumível NÃO entra aqui — ela é
 * do `inventory` (invariante 4).
 */
export interface SlotState {
  readonly set: number;
  readonly slot: number;
  readonly state: 'ready' | 'cooldown' | 'blocked' | 'empty';
  readonly remainingMs: number;
  readonly reason?: SlotRefusal;
}

/**
 * Traduz a recusa do atuador para a recusa do slot. É a salvaguarda de DT-08: `slotStates`
 * calcula o mesmo motivo por outro caminho, e o teste prende que os dois coincidem.
 *
 * Exportada para `CityRuleset#useSlot` (#792) reusar a MESMA tradução — duplicá-la é como as
 * duas rotas de refusal divergem no dia em que uma delas ganha um `case` novo e a outra não.
 */
export function refusalOf(result: CastRefused): SlotRefusal {
  switch (result.reason) {
    case 'not-in-catalog':
    case 'level-too-low':
    case 'wrong-vocation':
      return 'not-in-catalog';
    // Motivo PRÓPRIO (RF-02): o slot-state precisa distinguir o requisito de magic level do
    // genérico, senão o cliente não consegue explicar por que a runa não rodou.
    case 'magic-level-too-low': return 'magic-level-too-low';
    case 'on-cooldown': return 'on-cooldown';
    case 'group-cooldown': return 'group-cooldown';
    case 'no-target': return 'no-target';
    case 'out-of-range': return 'out-of-range';
    case 'not-enough-mana': return 'not-enough-mana';
    case 'not-enough-soul': return 'not-enough-soul';
    // O suprimento v2 é ABSTRATO: o "estoque" é o saldo, e a falta dele tem motivo próprio —
    // `not-enough-item` fica reservado ao consumível FÍSICO (a carga de bênção de M22).
    case 'not-enough-gold': return 'not-enough-gold';
    case 'attack-locked': return 'attack-locked';
    case 'feared': return 'feared';
    case 'not-summonable': return 'not-summonable';
    case 'spell-not-learned': return 'not-learned';
    case 'not-possible': return 'not-possible';
    case 'too-many-summons': return 'too-many-summons';
    case 'not-enough-room': return 'not-enough-room';
    case 'person-not-found': return 'person-not-found';
    case 'no-creatures-around': return 'no-creatures-around';
  }
}

/** A recusa do manual, montada num lugar só. */
function refuse(reason: SlotRefusal, retryInMs: number): SlotOutcome {
  return { ok: false, reason, retryInMs };
}

/** A recusa de `use-item`/`use-item-on` (#726), pelo mesmo molde de `refuse`. */
function refuseItem(reason: UseItemRefusal, retryInMs: number): UseItemOutcome {
  return { ok: false, reason, retryInMs };
}

/**
 * De quanto em quanto tempo as regras de saída são avaliadas.
 *
 * Antes era "a cada tick", o que fazia a hunt anexada checar dez vezes por segundo e a
 * desanexada uma — a mesma regra reagindo em tempos diferentes conforme houvesse alguém
 * olhando, que é exatamente o que o invariante 3 proíbe. Um período fixo resolve; 250 ms é
 * responsivo o bastante para uma regra de "vida abaixo de X" e custa quatro avaliações por
 * segundo.
 */
const EXIT_RULE_INTERVAL_MS = 250;

/**
 * Quando o lugar de spawn estava bloqueado, de quanto em quanto tempo tentar de novo.
 *
 * O lugar continua devendo um monstro; o que falta é espaço. Tentar no vencimento seguinte
 * ao invés de insistir é o que evita um laço quente quando o jogador acampa em cima do ponto.
 */
const SPAWN_RETRY_MS = 1000;

/**
 * O telegraph do monstro NÃO BLOQUEÁVEL (#583, `spawn_monster.hpp:97`,
 * `NONBLOCKABLE_SPAWN_MONSTER_INTERVAL`): 3× 1400 ms = 4200 ms entre o efeito de teleporte e o
 * monstro de fato materializar, mesmo com um participante em cima do ponto. A apresentação do
 * efeito em si (`CONST_ME_TELEPORT` do Canary) fica para o protocolo/cliente (#584/M36-03) — o
 * que este número garante aqui é só o ATRASO antes do monstro existir de verdade no mundo.
 */
const NONBLOCKABLE_SPAWN_TELEGRAPH_MS = 4200;

/**
 * A janela de "à vista" que segura o respawn de um monstro `blockable` (#583, `isBlockable` do
 * TFS/Canary, `Spawn::findPlayer`/`Spectators::find`). O Canary usa o VIEWPORT do cliente
 * (`MAP_MAX_VIEW_PORT_X`/`_Y`, 11 tiles nas duas direções — `MAP_MAX_CLIENT_VIEW_PORT_X` + 3 /
 * `_Y` + 5) em vez de um raio fixo; a Chebyshev de 11 tiles é a mesma simplificação
 * retangular→quadrada que `distance` já faz em todo o resto do motor (`monster/step.ts`), e é a
 * decisão desta issue para a pergunta que o ADR 0039 deixou aberta ("viewport do Canary ou do
 * cliente do Draconya") — ver a emenda do ADR para o registro.
 */
const SPAWN_VISIBILITY_RADIUS = 11;

/**
 * Quanto tempo LÓGICO o lure pode ficar PARADO (§13.7, `#luring`) antes de retomar a rota mesmo
 * sem a contagem ter caído abaixo de `min` (#527).
 *
 * A automação é do Draconya, não do TFS/Canary (ADR 0037 decisão 2) — este número não tem fonte
 * de engine nenhuma para citar, é design nosso. Ele existe porque a densidade de agressão do
 * Tibia de verdade (`aggroRadius` maior, `leashRadius: 0` — o Dragon nunca desiste) faz uma
 * party parada numa zona cheia ATRAIR gente de fora do raio de busca continuamente: o abate local
 * nunca esvazia por completo, porque enquanto ele cai um recém-chegado de longe substitui, e
 * `perto` nunca cruza `lure.min` — a mesma regra que junta o bando também o mantém cheio para
 * sempre, e o líder "PARADO NA ROTA" nunca mais anda (achado reproduzindo a QA do M28 com
 * conteúdo real: a party ficava 29 minutos lógicos no mesmo tile, matando sem parar, sem nunca
 * avançar). "A automação é legítima" (invariante 11) não significa "acampa para sempre": o bot
 * que lidera PUXA — anda, junta, limpa, anda de novo —, nunca vira uma torre fixa. Dois minutos é
 * generoso o bastante para esvaziar um aglomerado comum sem ser tão longo que a rota pare de
 * progredir numa hunt cheia.
 */
const MAX_LURE_HOLD_MS = 120_000;

/**
 * Quanto tempo LÓGICO o "puxa à força" (acima) dura antes do lure poder reconsiderar a
 * densidade de novo (#527). Sem isto, o `perto >= lure.max` do PRÓPRIO passo seguinte reengatilha
 * o cerco na hora — a densidade de uma zona cheia não cai num tile só —, e o "resume" depois do
 * teto durava um único passo antes de travar de novo pelos mesmos 120 s. Um minuto de rota é o
 * bastante para o líder sair de verdade da zona (dezenas de tiles, na velocidade de qualquer
 * personagem deste nível) antes do lure voltar a decidir.
 */
const LURE_FORCE_WALK_MS = 60_000;

/**
 * Quanto tempo LÓGICO quem foi empurrado (`#nudgeCompanion`) fica sem tentar reocupar o
 * alcance de follow (#527). Achado reproduzindo a QA do M28: sem este prazo, o par (quem pediu
 * passagem, quem cedeu) empatava para sempre — um saía do tile, e no PRÓPRIO vencimento
 * seguinte do outro (a mesma cadência de passo, os dois eventos entrelaçados) ele reentrava
 * nele antes de quem pediu conseguir passar. O prazo só precisa ser maior que uns poucos passos
 * — o bastante para o líder atravessar o gargalo, não para o follow parecer quebrado.
 */
const NUDGE_YIELD_MS = 3_000;

/**
 * Válvula de ÚLTIMO RECURSO: quanto tempo LÓGICO um follow atravessando andar pode ficar sem
 * progredir — mesmo depois de `#clearCompanionsAround` já ter tentado abrir espaço — antes de
 * desistir e voltar para a PRÓPRIA rota (#527). Não é a saída corriqueira: a primeira versão
 * disto usava 30 s, e quase toda travessia real esbarrava nele — o seguidor desistia do líder
 * por um bloqueio de SEGUNDOS, exatamente o "abandona o líder e vai caçar sozinho em outro
 * andar" que uma QA ao vivo flagrou (Tibia não separa a party assim). Quatro minutos é tempo
 * mais que suficiente para qualquer bloqueio de companheiro se resolver — se ainda assim persiste,
 * é parede ou monstro, e esperar para sempre não é melhor que seguir a rota.
 */
const MAX_CROSS_FLOOR_STUCK_MS = 240_000;

/**
 * A folga (tiles) ALÉM do `targetSearchRadius` de cada seguidor antes do líder considerar
 * alguém "para trás demais" e segurar o passo da rota (#527). Achado numa QA ao vivo: um raio
 * de regroup FIXO menor que `targetSearchRadius` (7 contra 8, a v1 desta constante) produzia
 * um impasse mútuo — o seguidor, a distância 8, ainda está dentro do PRÓPRIO raio de follow
 * (`d > radius` só desiste ALÉM de 8) e por isso `#holdFollow` continua tentando fechar a
 * distância sozinho, ativamente, a cada vencimento; mas o líder, com um limiar MAIS APERTADO
 * que o do seguidor, já achava "longe demais" e segurava — ninguém tinha motivo para se mexer
 * mais rápido, e os dois só se resolviam pela válvula de último recurso (3 min) em vez do
 * follow ativo do seguidor de fato alcançar. O limiar do líder tem que ser FOLGADO em relação
 * ao do seguidor, não apertado: o líder só precisa segurar quando o seguidor JÁ desistiu de
 * seguir sozinho (além do próprio raio) — dentro dele, o follow ativo do seguidor já resolve, e
 * seguraria por segurar. Ver `#partyRegroupBlocked`.
 */
const PARTY_REGROUP_MARGIN = 0;

/**
 * A folga (tiles) ALÉM de `targetSearchRadius` antes do follow desistir por distância (#527).
 * A distância RAW não é monotônica ao longo de um caminho do BFS limitado — um desvio em volta
 * de parede pode aumentar a distância em linha reta antes de diminuir, e sem folga nenhuma o
 * `d > radius` desistia exatamente no meio de uma travessia que o próprio BFS já tinha achado
 * (achado com o bot config real: 8 → 9, um a mais que o `targetSearchRadius` padrão). Fixa e
 * pequena, não "sempre que houver caminho em cache": uma primeira versão desta emenda soltava o
 * teto de desistência por completo enquanto qualquer caminho velho existisse, e um seguidor
 * genuinamente perdido nunca mais desistia — a coesão da varredura real desabou.
 */
const FOLLOW_UNREACHABLE_SLACK = 3;

/**
 * O raio MAIS APERTADO exigido antes do líder ATRAVESSAR ANDAR (#527) — nunca o mesmo do raio
 * "normal" acima. Cruzar uma escada com um seguidor a 6 tiles de distância, no MESMO andar
 * ainda, é o próprio cenário que gera "o líder sumiu escada acima e o seguidor foi atrás
 * sozinho, sem saber que o resto ficou para trás" — o defeito original desta issue. Metade do
 * raio normal é folga o bastante para o último passo antes da escada sem exigir todo mundo
 * exatamente em cima do líder.
 */
const PARTY_REGROUP_FLOOR_CHANGE_RADIUS = 3;

/**
 * Válvula de ÚLTIMO RECURSO: quanto tempo LÓGICO o líder pode ficar esperando a party se juntar
 * antes de seguir em frente de qualquer jeito (#527). Um seguidor genuinamente perdido (morto e
 * saiu, preso numa parede que o motor nunca resolve, o que for) não pode travar o líder — e por
 * extensão a hunt inteira — para sempre. Minutos, não segundos: regroup é para o caso comum de
 * "ficou para trás lutando", que se resolve rápido; a válvula é só para quando não resolve.
 */
const MAX_REGROUP_WAIT_MS = 180_000;

/**
 * O raio (Chebyshev, a partir de quem segue) do BFS limitado do follow (#527, emenda ao ADR
 * 0009, ADR 0037: o bot é automação própria — não precisa da fidelidade ao Tibia que o resto da
 * simulação mantém). Achado numa QA ao vivo: um corredor em U onde os três candidatos do passo
 * guloso (ADR 0009 — direção + dois vizinhos) eram todos parede, mas havia caminho livre pelo
 * lado OPOSTO — o Sorcerer ficou 8 tiles do líder, visivelmente perto, sem nunca conseguir
 * andar até lá, e só a válvula de regroup (3 min) liberava o líder. Trinta tiles cobre qualquer
 * desvio plausível dentro do raio de regroup/busca de follow (7) com folga generosa, sem
 * varrer o mapa inteiro a cada vencimento — é limitado por design, não "path-finding de verdade"
 * (ADR 0009 continua valendo para a rota autorada, que nunca usa isto).
 */
const FOLLOW_PATHFIND_RADIUS = 30;

/**
 * Quanto tempo LÓGICO o passo guloso do follow precisa ficar empacado SEGUIDO antes do BFS
 * limitado entrar (#527). Um monstro ou companheiro momentaneamente no caminho é o caso comum
 * — resolve sozinho em segundos, andando ou morrendo —, e path-find nele produz um desvio
 * inútil pela masmorra em vez de uma espera curta (achado varrendo o bot config real: a coesão
 * da party PIOROU depois do BFS entrar sem este atraso — todo bloqueio passageiro virava rota
 * alternativa). Só uma parede de VERDADE — o corredor em U de uma QA ao vivo, por exemplo —
 * continua bloqueada além deste prazo; poucos segundos é curto o bastante para não atrasar
 * visivelmente a travessia real, e longo o bastante para deixar um monstro/companheiro sair
 * sozinho da frente antes de desviar.
 */
const FOLLOW_PATHFIND_DELAY_MS = 4_000;

/**
 * O raio (Chebyshev) do BFS limitado de um `walk-to` DISTANTE na hunt (#763, achado do QA da
 * #730: `requestMove` só aceitava tile adjacente, e um clique num cadáver de longe nunca fazia
 * o personagem chegar). O MESMO mecanismo do follow (`boundedPath`, ADR 0009 emenda) — bot é
 * automação própria (ADR 0037), e um destino clicado pelo jogador tem a mesma natureza: não
 * precisa da fidelidade ao Tibia que a rota AUTORADA mantém (que nunca faz path-finding, ADR
 * 0009). Trinta tiles cobre qualquer clique plausível dentro do campo de visão sem varrer o
 * mapa inteiro a cada pedido.
 */
const MANUAL_WALK_PATHFIND_RADIUS = 30;

/**
 * Quanto tempo o bot fica PAUSADO depois que o personagem chega ao destino de um `walk-to`
 * distante (#763), OU depois de qualquer intenção manual (abrir cadáver, pegar loot, usar item,
 * usar no mapa) mesmo sem `walk-to` nenhum antes — achado de QA ao vivo: um cadáver já
 * adjacente abria a janela do `open-corpse` normalmente, mas o bot seguia andando embora, e o
 * `take-loot` dois segundos depois batia em `too-far-away`. `#armManualWalkHold` (RE)INICIA a
 * janela a cada uma dessas intenções — dez segundos é generoso para um clique duplo humano e
 * curto o bastante para não prender a hunt inteira quando o jogador só clicou e foi embora.
 */
const MANUAL_WALK_HOLD_MS = 10_000;

/**
 * A mira de uma magia que não mira ninguém (cura). Congelada e compartilhada, como `NO_HITS`
 * em `casting.ts`: uma cura por segundo por personagem não precisa alocar um vetor vazio.
 */
/** Até onde o segundo participante procura tile livre ao entrar (#203): o anel de `placeNear`. */
const ENTRY_RADIUS = 3;

function targetingOf(runner: Runner | undefined): Targeting {
  return runner?.bot?.targeting ?? DEFAULT_TARGETING;
}

function runnerState(runner: Runner): RunnerState {
  // Só os grupos do CONTEÚDO que estão AGENDADOS entram no snapshot. As chaves são strings, e o
  // motor v2 ignora categorias v1 que um snapshot antigo traga (seção 7 do AB-07).
  const botScheduled: string[] = [];
  if (runner.bot !== undefined) {
    for (const group of runner.bot.groups.keys()) {
      if (runner.botReady[group] === false) botScheduled.push(group);
    }
  }
  return {
    route: runner.walker.getState(),
    botScheduled,
    luring: runner.running,
    ringReplaced: runner.ringReplaced,
    playerAttackReady: runner.playerAttackReady,
    warnedExhausted: runner.warnedExhausted,
    warnedFullBackpack: runner.warnedFullBackpack,
    warnedNoGold: runner.warnedNoGold,
    ...(runner.automationWarned.size === 0
      ? {}
      : { automationWarned: Object.fromEntries(runner.automationWarned) }),
    ...(runner.attackTarget === null && runner.botCandidate === null
      ? {}
      : { chosenTarget: runner.attackTarget ?? runner.botCandidate }),
    ...(runner.attackTarget === null || !runner.attackTargetPinned
      ? {}
      : { chosenTargetPinned: true }),
    ...(runner.botConfig === undefined ? {} : { botConfig: runner.botConfig }),
    ...(runner.pendingExit === null ? {} : { pendingExit: runner.pendingExit }),
    ...(runner.followInterrupted ? { followInterrupted: true } : {}),
    ...(runner.followTargetId === undefined ? {} : { followTargetId: runner.followTargetId }),
    ...(runner.followReason === undefined ? {} : { followReason: runner.followReason }),
    ...(runner.lastCombatActionAtMs === null ? {} : { lastCombatActionAtMs: runner.lastCombatActionAtMs }),
    ...(runner.lureStoppedSinceMs === null ? {} : { lureStoppedSinceMs: runner.lureStoppedSinceMs }),
    ...(runner.lureForceWalkUntilMs === null ? {} : { lureForceWalkUntilMs: runner.lureForceWalkUntilMs }),
    ...(runner.nudgedUntilMs === null ? {} : { nudgedUntilMs: runner.nudgedUntilMs }),
    ...(runner.crossFloorStuckSinceMs === null ? {} : { crossFloorStuckSinceMs: runner.crossFloorStuckSinceMs }),
    ...(runner.sameTileStreak === 0 ? {} : { sameTileStreak: runner.sameTileStreak }),
    ...(runner.regroupSinceMs === null ? {} : { regroupSinceMs: runner.regroupSinceMs }),
    ...(runner.manualWalkTo === null ? {} : { manualWalkTo: runner.manualWalkTo }),
    ...(runner.manualWalkHoldUntilMs === null ? {} : { manualWalkHoldUntilMs: runner.manualWalkHoldUntilMs }),
    ...(runner.fearWalk === null ? {} : { fearWalk: runner.fearWalk }),
    ...(runner.thinkPhaseMs === null ? {} : { thinkPhaseMs: runner.thinkPhaseMs }),
    ...(runner.attackParked ? { attackParked: true } : {}),
  };
}

const NO_TILES: readonly WorldPoint[] = [];
const NO_MEMBERS: readonly CharacterRuntime[] = [];
const NO_SPELL_TARGETS: readonly SpellCastTarget[] = [];
/** Nenhum candidato de party para a regra (alvo inválido, fora de alcance ou efeito self-only). */
const NO_CANDIDATES: readonly CharacterRuntime[] = [];
/** Nenhuma invocação de personagem viva (#598) — o caso comum, hoje sempre. */
const NO_PLAYER_SUMMONS: readonly Prey[] = [];
/** O mesmo, com a entidade REAL em vez da forma `Prey` — ver `#livePlayerSummons`. */
const NO_LIVE_PLAYER_SUMMONS: readonly MonsterRuntime[] = [];

/**
 * O nome de dificuldade que ainda chega no protocolo (`enter-hunt.difficulty`, #584). Aceito e
 * IGNORADO pelo `sim` desde o #583 (ADR 0039, fim do pull por dificuldade) — não seleciona mais
 * nada no conteúdo, e por isso não há mais um conjunto fechado de nomes válidos por hunt.
 */
export type HuntDifficultyName = string;

/** O `SpellTarget` do lado de quem o PREENCHE. Ver `HuntRuleset.#spellTarget`. */
type MutableSpellTarget = { -readonly [K in keyof SpellTarget]: SpellTarget[K] };

/**
 * O que o personagem bate e o quanto aguenta. Vem de `content` (§12.1) — nenhum coeficiente
 * mora neste arquivo.
 */
export interface PlayerProfile {
  readonly attackPower: number;
  readonly attackIntervalMs: number;
  readonly attackRange: number;
  readonly armor: number;
  readonly dodgeChance: number;
  /** O tipo do golpe desarmado (CMB-03). Vem de `combat.player.damageType`. */
  readonly damageType: DamageType;
}

/** O que uma regra de saída consegue enxergar. Estreito de propósito: regra não muda estado. */
export interface HuntView {
  readonly elapsedMs: number;
  readonly aggregates: Readonly<Aggregates>;
  readonly participants: readonly CharacterRuntime[];
  readonly monstersAlive: number;
}

/**
 * Regra automática de saída (§14.8, §13.9).
 *
 * Predicado já compilado, avaliado a cada `EXIT_RULE_INTERVAL_MS` — é a forma que o ADR 0002
 * exige do motor de bot, e a razão é a mesma: interpretar JSON a cada avaliação é o caminho
 * fácil e caro. Quem TRADUZ a configuração do jogador nestes predicados é `compileExitRules`,
 * logo abaixo; a interface continua aberta para quem quiser injetar uma regra de teste.
 */
export interface HuntExitRule {
  readonly id: string;
  when(view: HuntView): boolean;
}

/**
 * Traduz as regras do jogador em predicados (FUN-86).
 *
 * Mora AQUI, e não no compilador do bot, porque o predicado lê a `HuntView` — e `bot.ts` não
 * conhece ruleset nenhum, nem pode: o mesmo bot vai valer para quest e boss, que terão outra
 * view. O compilador entrega a regra crua; quem tem a view é quem sabe fechar a closure.
 *
 * O `id` é o que vai para o extrato, e é ele que responde "por que a minha hunt encerrou". Por
 * isso `hp-below` carrega o percentual no id: duas regras de HP com limites diferentes
 * precisam ser distinguíveis na tela de retorno.
 */
export function compileExitRules(
  rules: readonly BotExitRule[],
  items: ReadonlyMap<string, Item>,
): readonly HuntExitRule[] {
  return rules.map((rule) => {
    switch (rule.kind) {
      case 'hp-below': {
        const { percent } = rule;
        return {
          id: `hp-below-${percent}`,
          when: (view: HuntView) => {
            // Só o personagem desta sessão. Party é F3, e quando existir a pergunta vira "o
            // MEU HP", não "o de alguém" — por isso o primeiro participante, e não um `some`
            // que passaria a significar outra coisa sem ninguém mudar esta linha.
            const self = view.participants[0];
            if (self === undefined || !self.alive) return false;
            if (self.maxHealth <= 0) return false;
            return (self.health / self.maxHealth) * 100 < percent;
          },
        };
      }
      case 'out-of-gold':
        return {
          id: 'out-of-gold',
          when: (view: HuntView) => {
            const self = view.participants[0];
            // Saldo é o de entrada mais o delta (FUN-77). Zero é "acabou": com zero não dá
            // para comprar a poção mais barata, e esperar chegar a negativo seria esperar por
            // um estado que o débito recusa antes de criar.
            return self !== undefined && self.alive && balanceOf(self) <= 0;
          },
        };
      case 'party-member-lost':
        return {
          id: 'party-member-lost',
          // Não é predicado periódico (#193): dispara no `onLeave` de OUTRO membro — sair ou
          // morrer, os dois casos que o §13.9 junta —, por `#onMemberLost`, pelo id. A view
          // de cada runner leva só ele, então aqui não há o que olhar; e numa hunt de um não
          // há de quem sair, por construção.
          when: () => false,
        };
      case 'out-of-capacity':
        return {
          id: 'out-of-capacity',
          when(view) {
            const self = view.participants[0];
            if (self === undefined || !self.alive) return false;
            if (self.capacity <= 0) return false;
            return self.inventory.weight(items) >= self.capacity;
          },
        };
    }
  });
}

/**
 * A configuração tem algum slot do conjunto ativo com alvo != self? É a pergunta que
 * `#armHealersOf` faz por participante (só cura/mana aceitam amigo; `validateBotConfigV2` já
 * recusou qualquer outro alvo, e o parse preenche `self` quando ausente).
 */
function hasNonSelfHealRule(config: BotConfigV2): boolean {
  const active = config.sets[config.activeSet];
  if (active === undefined) return false;
  return active.slots.some((slot) => slot !== null && (slot.target?.kind ?? 'self') !== 'self');
}

export interface HuntRulesetOptions {
  readonly hunt: Hunt;
  readonly difficulty: HuntDifficultyName;
  readonly map: Tilemap;
  readonly route: Route;
  readonly monsters: ReadonlyMap<string, Monster>;
  readonly combat: Combat;
  readonly progression: Progression;
  readonly stamina: Stamina;
  /**
   * A tabela da party (#190, ADR 0027). Sempre presente: solo é party de um, e `xpShare`
   * devolve a XP inteira sem ler a tabela.
   */
  readonly party: PartyConfig;
  readonly vocations: ReadonlyMap<string, Vocation>;
  /** Catálogo de magias (FUN-74). Vazio é uma hunt em que nenhuma magia sai. */
  readonly spells: ReadonlyMap<string, Spell>;
  /** Catálogo de supplies (FUN-77). Vazio é uma hunt sem poção. */
  readonly supplies: ReadonlyMap<string, Supply>;
  /**
   * Catálogo de munição (ADR 0026 d.3). A munição é ABSTRATA — uma seleção por família que
   * debita gold no tiro; vazio é uma hunt em que arco e besta não atiram.
   */
  readonly ammunition: ReadonlyMap<string, Ammunition>;
  /** Skills que sobem por uso (FUN-75). Vazio é uma hunt em que nada sobe por fazer. */
  readonly skills: ReadonlyMap<string, Skill>;
  /** Catálogo de itens (FUN-76). O que a arma equipada bate sai daqui. */
  readonly items: ReadonlyMap<string, Item>;
  /**
   * As famílias de arma (CMB-05): a família do perfil aponta a skill e a prática, e a fórmula
   * já vem compilada. Indexada no boot — nenhuma varredura de catálogo por golpe.
   */
  readonly weaponFamilies: ReadonlyMap<WeaponFamily, CompiledWeaponFamily>;
  /** O perfil do golpe desarmado (CMB-05): o fallback de quem não tem arma. */
  readonly unarmed: WeaponProfile;
  /**
   * Os marcos do Bestiário e o bônus por marco (§18, FUN-113). Ausente é uma hunt em que o
   * abate conta, mas nenhum marco fecha e a XP sai sem bônus — o conteúdo de teste que não
   * fala de progressão permanente. É a config quem define marco, não quem autoriza contar.
   */
  readonly bestiary?: BestiaryConfig;
  /**
   * Os níveis do Bosstiary por raridade (#629). Ausente é uma hunt em que o abate de boss conta,
   * mas nenhum nível fecha e nenhum ponto de boss é ganho — o conteúdo de teste que não fala de
   * progressão permanente, como `bestiary` ausente.
   */
  readonly bosstiary?: BosstiaryConfig;
  /**
   * O catálogo dos 25 Charms do Canary (#602/#603, ADR 0053 d.3), por id. Só o `combat-v4`
   * (`hasCharmStage`) os rola; ausente é uma hunt em que nenhum charm dispara — o conteúdo de teste
   * que não fala de Charms, e todo personagem sem atribuição.
   */
  readonly charms?: ReadonlyMap<string, Charm>;
  /**
   * Como o cadáver de cada monstro esfolável é esfolado (#626, ADR 0048 d.5/d.6), por `monsterId`.
   * Só o `combat-v4` (`hasSkinningStage`) esfola; ausente é uma hunt em que nenhuma ferramenta
   * faz nada — o conteúdo de teste que não fala de esfola.
   */
  readonly skinning?: ReadonlyMap<string, Skinning>;
  readonly player: PlayerProfile;
  readonly exitRules?: readonly HuntExitRule[];
  /**
   * A configuração do bot, CRUA (FUN-73, FUN-80, FUN-81).
   *
   * **Uma porta de entrada só.** Houve um tempo em que dava para passar o bot já compilado, e
   * as duas formas divergiram na primeira oportunidade: quem entrava pelo compilado ficava sem
   * as regras de saída, porque elas são compostas a partir da configuração crua. Compilar aqui
   * dentro torna a divergência impossível de escrever.
   *
   * **Sem configuração não há evento nenhum agendado** — o custo de um evento por grupo só
   * existe para quem configurou.
   */
  readonly botConfig?: BotConfigInput;
  /**
   * Substitui o atuador embutido (FUN-74/FUN-77).
   *
   * O padrão é a própria hunt: magia e supply são executados aqui, onde estão o alvo, o RNG da
   * sessão e o relógio lógico. Este campo sobrou como costura de teste — e para o dia em que
   * um ruleset quiser outra política sem reescrever o resto.
   */
  readonly actuator?: BotActuator;
  /**
   * A configuração do bot de CADA participante, por id (#203, ADR 0027). `botConfig` continua
   * sendo a do primeiro a entrar — o caminho solo; quem entra com id aqui usa a sua.
   */
  readonly botConfigs?: Readonly<Record<string, BotConfigInput>>;
  /** A party desta instância (#191, ADR 0027). Ausente é solo. */
  readonly partyOptions?: PartyOptionsInput;
  /** Cooldown de FALLBACK de um grupo sem livro próprio (§13.5: 1 s). Parâmetro, não constante. */
  readonly botCooldownMs?: number;
  /**
   * Até onde o bot ENXERGA ao decidir para onde andar (FUN-85), do conteúdo. Não é o alcance
   * de ataque: só importa com postura `follow` ou `keep-distance`.
   */
  readonly targetSearchRadius?: number;
  /**
   * Premium reduz a penalidade de morte de 60% para 54% (§26.2). É atributo da CONTA, não do
   * personagem, e por isso entra por aqui em vez de morar no `CharacterRuntime`.
   */
  readonly premium?: boolean;
  /**
   * A Boosted Creature do dia (M42, #615, ADR 0054 decisão 7): o `monsterId` sorteado pelo
   * `jobs`, FIXADO nesta instância como a versão de conteúdo (invariante 7) — nunca relido do
   * mundo depois de criada, para a hunt que atravessa a virada continuar com a boosted com
   * que nasceu. Efeitos: `spawntime / 2` nos lugares deste monstro, XP ×2, e um roll extra de
   * loot inteiro (`ondroploot_boosted.lua`, ADR 0054 decisão 7). Ausente é dia sem sorteio
   * (conteúdo sem `boosted/baseline.json`, ou personagem cujo ticket não o carregava): nenhum
   * efeito aplica.
   */
  readonly boostedMonsterId?: string;
}

/**
 * Um cadáver no chão (FUN-123): de que monstro, onde. O prazo dele é o evento `CORPSE` na fila.
 *
 * Desde o ADR 0048 ele também CARREGA o loot (decisão 1): `items`/`gold` são o que ainda não
 * foi coletado — o dono coleta no MESMO evento do abate (`#collectFromCorpse`), então o comum é
 * já nascer com as duas listas vazias/zeradas. `ownerId`/`eligible` espelham `#lootRecipient`/
 * `eligible` do abate (`null` em `splitLoot` — a bolsa é dona, e o cadáver não guarda nada).
 * Os quatro são OPCIONAIS na leitura (snapshot anterior a este ADR não os tem — `ausente` é
 * cadáver vazio, sem bump de `SNAPSHOT_FORMAT_VERSION`), mas sempre presentes ao criar.
 *
 * `diedAtMs`/`skinned` são da ESFOLA (#626): `diedAtMs` é o relógio lógico da morte — a idade do
 * cadáver, que diz em que estágio da cadeia de decaimento ele está e, portanto, se a janela de
 * esfola ainda está aberta —, e `skinned` marca que a esfola já foi tentada (com ou sem sucesso:
 * o Canary transforma o cadáver no "esfolado" nos dois casos, e ele não é chave de tabela
 * nenhuma). Opcionais na leitura pela mesma razão: snapshot anterior não os tem, e sem
 * `diedAtMs` o cadáver não se esfola à mão (a idade é desconhecida — recusa em vez de adivinhar).
 */
export interface CorpseState {
  readonly id: number;
  readonly monsterId: string;
  readonly position: WorldPoint;
  /** MUTÁVEL: colhido por `#collectFromCorpse` e descartado por `#onCorpseDecay`. */
  items?: CarriedItem[];
  gold?: number;
  readonly ownerId?: string | null;
  readonly eligible?: readonly string[];
  readonly diedAtMs?: number;
  /**
   * MUTÁVEL: vira `true` na primeira tentativa de esfola, do bot ou à mão — e é nela que o fim do
   * cadáver é reagendado (`#retimeCorpse`): o decaimento recomeça no `after` do Canary.
   */
  skinned?: boolean;
}

/**
 * O que `HuntRuleset#summonRunePrecondition` devolve para as duas runas de invocação (#600): a
 * conferência que vai para `useSupply`, e o que a mira achou (o monstro do Convince, o cadáver da
 * Animate Dead) para o efeito depois — capturado antes de `#spellHits` ser reaproveitado.
 */
interface SummonRuneCheck {
  readonly check: () => CastRefused | null;
  readonly target: MonsterRuntime | null;
  readonly corpse: CorpseState | null;
}

/** A recusa comum a `openCorpse`/`takeLoot` (#722, ADR 0048 d.4). */
export type CorpseRefusal = 'not-found' | 'not-yours' | 'too-far-away';

/** `takeLoot` acrescenta a recusa de capacidade — só ela é OMISSA em `openCorpse`, que não move nada. */
export type TakeLootRefusal = CorpseRefusal | 'not-enough-capacity';

export type OpenCorpseResult =
  | { readonly ok: true; readonly corpse: CorpseState }
  | { readonly ok: false; readonly reason: CorpseRefusal };

export type TakeLootResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: TakeLootRefusal };

/**
 * Quem pode carregar uma condição (CMB-07): personagem ou monstro. Os dois têm `conditions`,
 * posição e vida; o tique de dano de um DOT entra no mesmo pipeline para os dois.
 */
type ConditionTarget = CharacterRuntime | MonsterRuntime;

/** Como a party divide loot e custo (ADR 0027 decisão 5). */
export type PartyMode = 'split' | 'shared';

/**
 * Os dois eixos do líder, mais a config de loot (§4, §5, ADR 0035 decisão 1).
 *
 * Vive ao lado dos campos achatados de `PartyOptions` para quem preferir o bloco — a migração
 * de `{ settings }` preenche os mesmos eixos. `collect`/`autoSell` só são lidos por `partySummary`
 * nesta issue; o filtro e a venda de fato são do #395.
 */
export interface PartySettings {
  readonly shareCosts: boolean;
  readonly splitLoot: boolean;
  /** `null` = coletar tudo. Filtro de fato é do #395. */
  readonly collect: readonly string[] | null;
  /** Ordem configurada; só os `limit` primeiros valem (aplicação de fato é do #395). */
  readonly autoSell: readonly string[];
}

/**
 * A party desta instância (#191). Ausente é solo. MUTÁVEL desde o #394 — antes era fixada na
 * sessão; o líder muda por `configureParty`.
 *
 * `mode` continua como espelho LEGADO (o `host` o lê até o #400): nasce da combinação dos dois
 * eixos e não é reescrito por `configureParty` — quem manda é `shareCosts`/`splitLoot`.
 */
export interface PartyOptions {
  leaderId: string;
  readonly mode: PartyMode;
  shareCosts: boolean;
  splitLoot: boolean;
  collect: readonly string[] | null;
  autoSell: readonly string[];
  premiumByCharacter: Record<string, boolean>;
}

/**
 * O que `HuntRulesetOptions`/`HuntSessionOptions`/`HuntRulesetState.partyOptions` aceitam: o
 * formato novo (`PartyOptions`, achatado), o bloco `{ settings }` do desenho, OU o legado que
 * `packages/server` ainda constrói com `mode` até o #400 modernizar o ticket.
 */
export type PartyOptionsInput =
  | PartyOptions
  | {
      readonly leaderId: string;
      readonly settings: PartySettings;
      readonly premiumByCharacter?: Readonly<Record<string, boolean>>;
    }
  | {
      readonly leaderId: string;
      readonly mode: PartyMode;
      readonly shareCosts?: boolean;
      readonly splitLoot?: boolean;
      readonly premiumByCharacter?: Readonly<Record<string, boolean>>;
    };

export type ConfigurePartyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not-leader' }
  | { readonly ok: false; readonly reason: 'unknown-item'; readonly itemId: string }
  | { readonly ok: false; readonly reason: 'unsellable-item'; readonly itemId: string };

export interface PartySettingsPatch {
  readonly shareCosts?: boolean;
  readonly splitLoot?: boolean;
  readonly collect?: readonly string[] | null;
  readonly autoSell?: readonly string[];
}

/**
 * A recusa da votação de encerrar (#432). `not-leader` cobre solo e quem não lidera — como
 * `configureParty`, uma sessão sem party não tem líder para propor. `no-proposal` é aprovar ou
 * recusar sem votação aberta; `not-member` é um id que não está presente.
 */
export type PartyEndVoteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not-leader' | 'not-member' | 'no-proposal' };

/** O bloco PARTY dos Detalhes da Caçada (§32, ADR 0035 decisão 11). */
export interface PartySummary {
  readonly leaderId: string;
  readonly shareCosts: boolean;
  readonly splitLoot: boolean;
  readonly members: readonly string[];
  readonly uniqueVocations: number;
  readonly xpPoolPercent: number;
  readonly bagValue: number;
  readonly bagWeight: number;
  readonly autoSell: { readonly configured: number; readonly limit: number };
}

/** Migra o formato legado (`mode` + eixos opcionais) para os campos do `PartyOptions`. */
function partySettingsFromLegacy(input: {
  readonly mode: PartyMode;
  readonly shareCosts?: boolean;
  readonly splitLoot?: boolean;
}): PartySettings {
  return {
    shareCosts: shareCostsOf(input),
    splitLoot: splitLootOf(input),
    collect: null,
    autoSell: [],
  };
}

/**
 * Uma função só migra as duas entradas (construção E snapshot): o formato novo achatado, o
 * bloco `{ settings }` ou o legado `{ mode }`. Sem bump de `SNAPSHOT_FORMAT_VERSION`.
 */
function normalizePartyOptions(input: PartyOptionsInput | undefined): PartyOptions | undefined {
  if (input === undefined) return undefined;
  const premiumByCharacter = { ...(input.premiumByCharacter ?? {}) };
  const settings = (input as { readonly settings?: PartySettings }).settings;
  if (settings !== undefined) {
    return {
      leaderId: input.leaderId,
      mode: settings.shareCosts && settings.splitLoot ? 'shared' : 'split',
      shareCosts: settings.shareCosts,
      splitLoot: settings.splitLoot,
      collect: settings.collect,
      autoSell: [...settings.autoSell],
      premiumByCharacter,
    };
  }
  const flat = input as Partial<PartyOptions>;
  if (flat.collect !== undefined || flat.autoSell !== undefined) {
    // Já é o `PartyOptions` achatado — cópia, para o snapshot não compartilhar referência.
    return {
      leaderId: input.leaderId,
      mode: (input as { readonly mode: PartyMode }).mode,
      shareCosts: flat.shareCosts === true,
      splitLoot: flat.splitLoot === true,
      collect: flat.collect ?? null,
      autoSell: [...(flat.autoSell ?? [])],
      premiumByCharacter,
    };
  }
  const legacy = input as {
    readonly leaderId: string;
    readonly mode: PartyMode;
    readonly shareCosts?: boolean;
    readonly splitLoot?: boolean;
  };
  const migrated = partySettingsFromLegacy(legacy);
  return {
    leaderId: legacy.leaderId,
    mode: legacy.mode,
    shareCosts: migrated.shareCosts,
    splitLoot: migrated.splitLoot,
    collect: migrated.collect,
    autoSell: [...migrated.autoSell],
    premiumByCharacter,
  };
}

/**
 * Nenhuma venda automática efetiva. Fica fora das opções porque o conjunto é derivado do
 * líder a cada abate; criá-lo vazio é o que evita alocar um `Set` por item de quem não vende.
 */
const EMPTY_AUTO_SELL: ReadonlySet<string> = new Set();

/**
 * O filtro de Quick Loot de quem nunca configurou nenhum (ADR 0048 decisão 2): `skip` com lista
 * vazia aceita tudo — o comportamento de sempre, de antes deste ADR.
 */
const DEFAULT_LOOT_FILTER: BotLoot = { filter: 'skip', itemIds: [], autoSell: [] };

/**
 * O formato ANTIGO da bolsa no snapshot (`gold: number`, `items: CarriedItem[]`), lido só
 * pelo `restore` para migrar uma sessão em voo para entradas com `eligible: []` — o sentinel
 * de "presentes no settlement" (D5, sem bump de `SNAPSHOT_FORMAT_VERSION`).
 */
interface LegacyPartyBagState {
  readonly gold: number;
  readonly items: readonly CarriedItem[];
  readonly capacity: number;
}

const isLegacyBag = (bag: unknown): bag is LegacyPartyBagState =>
  typeof (bag as LegacyPartyBagState).gold === 'number';

export interface HuntRulesetState {
  readonly huntId: string;
  readonly difficulty: HuntDifficultyName;
  /**
   * A Boosted Creature FIXADA nesta instância (#615). Como `huntId`/`difficulty`, é IDENTIDADE
   * da instância, e não estado mutável: `huntRulesetFromSnapshot` a lê daqui para reconstruir o
   * ruleset com o mesmo `HuntRulesetOptions.boostedMonsterId` de antes da queda — é o que faz a
   * hunt retomada depois da virada continuar com a boosted com que nasceu (ADR 0054 decisão 7),
   * em vez de herdar a do dia em que o `game` reiniciou. Ausente é sessão sem boosted (mesma
   * regra de `botConfig`).
   */
  readonly boostedMonsterId?: string;
  readonly route: RouteState;
  readonly spawner: SpawnerState;
  /**
   * Lugares NÃO BLOQUEÁVEIS já resolvidos, teleportando (#583). Ausente é nenhum — snapshot
   * anterior a esta issue, ou nenhum lugar no meio dos 4200 ms de telegraph agora.
   */
  readonly pendingSpawns?: readonly {
    readonly slot: number;
    readonly monsterId: string;
    readonly position: WorldPoint;
  }[];
  readonly monsters: readonly MonsterState[];
  readonly nextCreatureId: number;
  /** Os cadáveres no chão (FUN-123). Ausente é nenhum: snapshot anterior. */
  readonly corpses?: readonly CorpseState[];
  /** O próximo id de item de chão. Ausente é `1`: snapshot anterior à FUN-123. */
  readonly nextGroundItemId?: number;
  readonly warnedExhausted: boolean;
  /** Ver `HuntRuleset.#warnedFullBackpack`. Ausente é `false`: snapshot anterior à FUN-88. */
  readonly warnedFullBackpack?: boolean;
  /** Ver `HuntRuleset.#warnedNoGold`. Ausente é `false`: snapshot anterior à FUN-77. */
  readonly warnedNoGold?: boolean;
  /**
   * Até que instante lógico a stamina já foi consumida.
   *
   * Precisa entrar no snapshot: sem ele, uma sessão retomada com quatro horas de hunt no
   * relógio lógico cobraria as quatro horas de novo no primeiro evento.
   */
  readonly staminaAnchorMs: number;
  /** Ver `HuntRuleset.#onPlayerAttack`. Ausente é `true`: engatilhado. */
  readonly playerAttackReady?: boolean;
  /**
   * Quais GRUPOS do bot estão AGENDADOS (AB-07).
   *
   * Precisa entrar no snapshot pela mesma razão que `playerAttackReady`: o evento pendente do
   * grupo está na fila serializada, e restaurar como "engatilhado" faria o próximo `#armBot`
   * agendar um segundo — ação dobrada, que é a invariante que este par protege.
   *
   * As chaves são os grupos do CONTEÚDO (ou as categorias v1 de um snapshot anterior, que o
   * motor v2 ignora). Ausente é "nenhum agendado".
   */
  readonly botScheduled?: readonly string[];
  /** Ver `HuntRuleset.#running`. Ausente é `true`: o lure começa juntando (FUN-87). */
  readonly luring?: boolean;
  /** Ver `HuntRuleset.#ringReplaced`. Ausente é `null`: o dedo estava vazio. */
  readonly ringReplaced?: string | null;
  /**
   * O estado por PARTICIPANTE (#203, ADR 0027): caminhante, bot, lure, anel, golpe engatilhado
   * e avisos de cada um. Os campos soltos acima continuam escritos — com o do primeiro — e são
   * lidos quando esta chave falta: é o snapshot anterior, de um dono só, sem bump.
   */
  readonly runners?: Readonly<Record<string, RunnerState>>;
  /** A party (#191): achatada no formato novo, ou o legado `{mode}` de um snapshot anterior. */
  readonly partyOptions?: PartyOptionsInput;
  /** A bolsa do modo compartilhado (#192). Só existe com `partyOptions.splitLoot`. */
  readonly partyBag?: PartyBagState;
  /**
   * A votação de encerrar em curso (#432). Opcional: ausente é nenhuma votação, o estado de um
   * snapshot anterior. O vencimento já vem na fila serializada; isto preserva quem já aprovou
   * para uma sessão retomada no meio da janela não perder a contagem.
   */
  readonly endVote?: { readonly proposedAtMs: number; readonly approved: readonly string[] };
  /**
   * Os campos de tile ativos (CMB-07). Opcional: ausente é nenhum campo, que é o estado de um
   * snapshot anterior a esta issue. Os eventos de tique e vencimento já vêm na fila serializada.
   */
  readonly fields?: readonly TileFieldState[];
  /**
   * O overlay de cenário usável (#728, ADR 0050 d.2): porta, capim, stone pile e alavanca, por
   * `interactableId` (a posição). Opcional, sem bump de `SNAPSHOT_FORMAT_VERSION`: ausente é
   * "ninguém mexeu em nada ainda", o estado que `TileOverrides.fromInteractables` já produz a
   * partir do conteúdo — o mesmo grau de compatibilidade que `fields` (CMB-07) já tem. Os
   * eventos `TILE_REVERT` pendentes já vêm na fila serializada da sessão.
   */
  readonly tileOverrides?: readonly TileOverrideState[];
  /**
   * A configuração do bot, CRUA (FUN-81).
   *
   * Crua e não compilada: `CompiledBot` é um vetor de closures, e closure não serializa. O
   * `restore` recompila, que é barato — é um `map` sobre poucas dezenas de regras.
   *
   * Precisa entrar no snapshot porque a sessão é a DONA da configuração enquanto roda: uma
   * edição feita no meio da hunt vale na hora, e ler o banco na retomada descartaria tudo o
   * que foi salvo depois do último `UPDATE`. O banco é a fonte para COMEÇAR uma hunt; o
   * snapshot é a fonte para CONTINUAR a que já estava rodando.
   *
   * Opcional: snapshot gravado antes desta issue não tem a chave, e ausente é "sem bot" — que
   * é exatamente o que aquelas sessões tinham.
   *
   * O motor normaliza para v2 ao recompilar (DT-02): a v1 legível no snapshot não perde
   * configuração.
   */
  readonly botConfig?: BotConfigV2;
}

/**
 * O que é de UM participante dentro da hunt (#203). Antes do M13 tudo isto era campo da
 * classe, e a hunt recusava o segundo personagem; agora é um `Runner` por id, e os eventos —
 * que já carregavam `subject` — encontram o seu.
 */
interface Runner {
  walker: RouteWalker;
  /** O bot vigente, MUTÁVEL: o jogador troca no meio da hunt e vale na hora (FUN-81). */
  bot: CompiledBot | undefined;
  /** A configuração v2 correspondente, para o snapshot. Anda junto com `bot`, sempre. */
  botConfig: BotConfigV2 | undefined;
  /**
   * As automações do catálogo, compiladas (AB-08). Derivadas de `botConfig`, como o `bot`:
   * `[]` é nenhuma, e é o que faz um runner sem automação habilitada não agendar o evento.
   */
  automations: CompiledAutomations;
  /**
   * O atuador das automações, montado UMA vez por runner (#420).
   *
   * Antes `#onAutomation` reconstruía o objeto com ~10 closures a cada ciclo (1 Hz mais cada
   * golpe recebido); com 5.000 hunts isso é o coletor rodando o tempo todo. `undefined` só no
   * runner descartável de `getState` sem participantes — não há automação a executar.
   */
  actuator: AutomationActuator | undefined;
  /**
   * Por automação (chave = `model`), a última chave `reason:itemId` que já foi registrada como
   * `automation-blocked`. Só a TRANSIÇÃO registra: uma automação bloqueada por 8 h vale UMA
   * linha no extrato, não 28.800. Ver `RunnerState.automationWarned`.
   */
  readonly automationWarned: Map<string, string>;
  exitRules: readonly HuntExitRule[];
  pendingExit: ExitReason | null;
  /** Por GRUPO: `true` = ENGATILHADO (nenhum evento pendente), `false` = agendado. */
  readonly botReady: Record<string, boolean>;
  /** O golpe está engatilhado? Ver `#onPlayerAttack`. */
  playerAttackReady: boolean;
  /**
   * O alvo de ATAQUE explícito, por subject do monstro (`m:<id>`): o override do jogador
   * (AB-09, ADR 0032 d.5) e o alvo que o bot decide seguir (#480). É EXCLUSIVO — quem mandou
   * seguir um não quer bater em outro no caminho —, e `setAttackTarget` é a única porta de
   * escrita, o que põe jogador e bot no mesmo pipeline (#470).
   *
   * Separado de `botCandidate` (#470): antes os dois dividiam `chosenTarget` mais um booleano
   * `chosenTargetPinned`, e a apresentação usava o alvo de ATAQUE — que é recortado pelo
   * alcance da arma e fazia o alvo sumir da tela fora do corpo a corpo.
   */
  attackTarget: string | null;
  /**
   * O alvo de ataque foi PINADO pelo jogador (AB-09) ou apenas eleito pelo bot (#480)?
   *
   * O bot entra pela MESMA porta (`setAttackTarget`), mas com `pinned: false`: o alvo dele é
   * uma eleição da política, e fora do alcance a política reassume — só o clique do jogador é
   * exclusivo (ADR 0032 d.5). Sem esta distinção, o alvo que o auto-target guarda na tela
   * travaria o corpo a corpo, que é justamente o que a #444 não pode regredir.
   */
  attackTargetPinned: boolean;
  /**
   * O candidato do AUTO-TARGET (#444): o melhor monstro na tela, escolhido pela política,
   * quando não há alvo de ataque válido. É só a mira corrente — sai do alcance e a política
   * reassume —, e `selectedTargetOf` o expõe para a apresentação independentemente do alcance
   * da arma (RF-05).
   */
  botCandidate: string | null;
  /** Está CORRENDO para juntar monstros (§13.7)? Começa juntando. */
  running: boolean;
  /**
   * Desde QUANDO `running` é `false` sem interrupção (#527, `MAX_LURE_HOLD_MS`). `null` quando
   * está correndo (o valor comum) ou sem lure configurado — só existe para o cerco não durar
   * para sempre. Opcional no snapshot (ausente é `null`), sem bump de formato: um snapshot
   * anterior a esta issue nunca tinha um cerco em curso mais longo que o normal.
   */
  lureStoppedSinceMs: number | null;
  /**
   * Até QUANDO o "puxa à força" ignora `lure.max` depois do teto de cerco estourar (#527,
   * `LURE_FORCE_WALK_MS`). `null` fora desse trecho. Sem isto o `perto >= lure.max` do passo
   * seguinte reengatilhava o cerco no mesmo tile em que o teto acabou de liberar o líder.
   */
  lureForceWalkUntilMs: number | null;
  /**
   * Até QUANDO este personagem foi EMPURRADO para abrir passagem (#527, `#nudgeCompanion`,
   * `NUDGE_YIELD_MS`) e por isso não tenta reocupar o alcance de follow. Sem isto o seguidor
   * empurrado volta a ficar adjacente ao alvo no PRÓPRIO vencimento seguinte — muitas vezes no
   * MESMO tile de onde acabou de sair —, e o par (quem pediu passagem, quem cedeu) empata para
   * sempre: um sai, o outro reentra, ninguém nunca passa.
   */
  nudgedUntilMs: number | null;
  /**
   * Desde QUANDO um follow atravessando andar está sem progredir (#527, válvula de último
   * recurso, `MAX_CROSS_FLOOR_STUCK_MS`). `null` fora de uma travessia parada.
   */
  crossFloorStuckSinceMs: number | null;
  /**
   * Quantas vezes SEGUIDAS o passo da rota bateu `same-tile` (#527): o índice do walker um
   * atrás da posição real (ver `#playerStep`). A primeira vez fecha sozinha sem `hold()`; a
   * segunda vez SEGUIDA cai no `hold()` de sempre — a válvula que evita o índice girar um laço
   * pequeno inteiro sem o personagem nunca dar um passo físico. Zera em qualquer outro
   * resultado (passo de verdade, `not-adjacent`, companheiro, parede).
   */
  sameTileStreak: number;
  /**
   * Já registrou `route-blocked` no extrato para o bloqueio ATUAL (#728, ADR 0050 d.4)? Evita
   * uma linha por vencimento parado — zera assim que o passo deixa de ser recusado por
   * interativo. NUNCA persiste no snapshot, como `followPath`: perder a flag numa retomada só
   * custa uma linha extra no extrato, nunca um comportamento errado.
   */
  routeBlockedWarned: boolean;
  /**
   * Desde QUANDO o líder está esperando a party se juntar (#527, `PARTY_REGROUP_MARGIN`/
   * `PARTY_REGROUP_FLOOR_CHANGE_RADIUS`, válvula `MAX_REGROUP_WAIT_MS`). `null` fora de uma
   * espera — só o próprio líder escreve este campo.
   */
  regroupSinceMs: number | null;
  /**
   * Cache do caminho do BFS limitado do follow (#527, ADR 0009 emenda) — só usado quando o
   * passo guloso emperra contra uma parede que exige rodear. `goal` é o tile mirado quando o
   * caminho foi calculado; `path` é o resto do caminho (sem o tile já dado). Invalidado (`null`)
   * assim que o alvo muda de tile, o passo guloso volta a resolver sozinho, ou o próximo tile
   * do caminho deixa de estar livre. NUNCA persiste no snapshot — cache de desempenho puro.
   */
  followPath: { readonly goal: FloorPoint; readonly path: readonly GridPoint[] } | null;
  /**
   * Desde QUANDO o passo guloso do follow está empacado sem progredir (#527) — o BFS limitado
   * só entra depois de `FOLLOW_PATHFIND_DELAY_MS` de bloqueio SEGUIDO, nunca na primeira falha.
   * Um monstro ou companheiro momentaneamente no caminho é o caso comum, e resolve sozinho em
   * segundos — path-find nele produzia desvios inúteis (achado varrendo o bot config real: a
   * coesão da party PIOROU com o BFS sem este atraso, porque todo bloqueio passageiro virava
   * um desvio pela masmorra em vez de uma espera curta). Parede de verdade continua sendo
   * resolvida — só um pouco depois. `null` fora de um bloqueio. NUNCA persiste no snapshot.
   */
  followStuckSinceMs: number | null;
  /** Que anel estava no dedo quando a máquina equipou o dela (§13.8). `null` = vazio. */
  ringReplaced: string | null;
  warnedExhausted: boolean;
  warnedFullBackpack: boolean;
  warnedNoGold: boolean;
  /** Já reportamos `active:false` para este follow e ainda não retomou (§D10, "uma vez"). */
  followInterrupted: boolean;
  /**
   * O alvo CONFIGURADO do follow, guardado no último `#reportFollow` (#401). Existe para o
   * `followStateOf` devolver a verdade ATUAL a quem reconecta: o evento `follow-state` só é
   * emitido na TRANSIÇÃO, e `kind: 'leader'` resolve o líder a cada vencimento — guardar o id
   * aqui é o que dispensa uma segunda resolução de liderança no hospedeiro.
   */
  followTargetId: string | undefined;
  /** Por que o follow está interrompido (#401): o `reason` do último `follow-state` inativo. */
  followReason: 'dead' | 'left' | 'unreachable' | undefined;
  /**
   * O instante LÓGICO do último ataque ou cura A OUTRO PARTICIPANTE (§525, ADR 0027 emenda
   * 2026-09-24/25): é o que `canShareExperience` lê como atividade (`Party::isPlayerActive` do
   * TFS/Canary). `null` é "nunca agiu" — o mesmo que não ter entrada no `ticksMap` de lá.
   * Escrito só por `#markCombatActive`, chamado dos MESMOS pontos que já creditam dano/cura
   * para o DPS/HPS (#431) — `#land`, `#applyHits` sempre; `#emitHealed` só quando o RECIPIENTE
   * não é o próprio healer (`Player::isPartner` exclui `player == this` nas duas engines antes
   * de registrar atividade por cura — curar a si mesmo continua valendo para o HPS, só não para
   * esta atividade). Um quinto ponto de escrita divergiria do que já é creditado em algum lugar.
   */
  lastCombatActionAtMs: number | null;
  /**
   * O caminho de um `walk-to` DISTANTE pedido pelo jogador (#763): quando `to` não é adjacente,
   * `requestMove` calcula com o BFS limitado (`#planManualWalk`, o mesmo mecanismo do follow) e
   * guarda aqui — o PRÓPRIO caminho a percorrer, não um cache de desempenho como `followPath`.
   * Precisa sobreviver a um snapshot (a hunt é idle-first, invariante 3: fechar o navegador no
   * meio do caminho não pode apagá-lo), então é OPCIONAL no `RunnerState`, ao contrário do cache
   * do follow. Enquanto existe, `#playerStep` consome um tile por vencimento em vez de andar
   * pela rota ou perseguir o alvo do bot (RF-02 da spec), com PRIORIDADE ACIMA do combate-stop
   * (achado de QA ao vivo: um destino distante numa masmorra cheia de monstros nunca terminava
   * de andar, porque o combate-stop de sempre segurava o personagem no primeiro alvo ao alcance
   * e nunca soltava) — `destination` é só para comparar com um pedido novo, que substitui em vez
   * de acumular.
   */
  manualWalkTo: { readonly destination: FloorPoint; readonly path: readonly GridPoint[] } | null;
  /**
   * Até QUANDO o bot fica pausado — depois de CHEGAR ao destino de um `walk-to` distante, OU
   * (RE)INICIADA do zero por qualquer intenção manual mesmo sem `walk-to` nenhum antes (#763,
   * `MANUAL_WALK_HOLD_MS`, `#armManualWalkHold`: `open-corpse`, `take-loot`,
   * `use-item`/`use-item-on`, `use-on-map`). `null` fora da janela; precisa sobreviver ao
   * snapshot pela mesma razão de `manualWalkTo` — sem isto, uma hunt retomada bem no meio da
   * janela perderia a pausa e a rota atropelaria o jogador que acabou de
   * chegar.
   */
  manualWalkHoldUntilMs: number | null;
  /**
   * A caminhada FORÇADA do medo (M44-04, #622): os passos que `ConditionFeared` entregou a
   * `Game::forcePlayerAutoWalk` e que o personagem ainda não deu, na ORDEM de caminhada e como
   * valores do enum `Direction` do Canary (`fear.ts`). `null` é "não está fugindo". Consumida um
   * passo por vencimento de `PLAYER_STEP` (`#advanceFearWalk`) com PRIORIDADE ACIMA de tudo — a
   * caminhada forçada substitui a lista de passos do próprio jogador (`startAutoWalk` limpa
   * `listWalkDir`) —, e vazia (`[]`) é o `onWalkComplete` do Canary: o próximo vencimento reavalia
   * a fuga (se o medo ainda vale) e só então solta. Precisa sobreviver a um snapshot pela mesma
   * razão de `manualWalkTo`: fechar o navegador no meio da fuga não pode apagá-la (invariante 3).
   */
  fearWalk: readonly number[] | null;
  /**
   * A fase do pensamento do personagem (`CREATURE_THINK_INTERVAL_MS`), em [0, 1000) ms do relógio
   * lógico: `Game::addCreatureCheck` sorteia a fase de cada criatura uma vez, e esta é a dela.
   * Sorteada preguiçosamente por `#thinkDelayMs` e persistida — fechar o navegador no meio de uma
   * pacificação não pode mover o instante em que o golpe volta (invariante 3). `null` é "ainda não
   * sorteada".
   */
  thinkPhaseMs: number | null;
  /**
   * O golpe está ESTACIONADO esperando o primeiro gatilho depois de `pacified` (M44-04, #622,
   * `#parkAttack`): `playerAttackReady` verdadeiro, nenhum `PLAYER_ATTACK` na fila e um
   * `ATTACK_THINK` agendado. Só o pensamento (ou um passo do personagem ou do alvo, depois do
   * vencimento) o solta — os gatilhos genéricos de `#armPlayerAttack` passam a ignorá-lo, porque a
   * cadeia de golpes do Canary morreu e um personagem parado nunca a reacende por conta própria.
   */
  attackParked: boolean;
}

/**
 * A reserva morde a mochila sem tocar em `inventory.ts` (§11, #396): um `Wearer` com a
 * capacidade PESSOAL já descontada do que a party reservou. Objeto NOVO — nunca escreve
 * `character.capacity` (invariante 9), e `Inventory.add` continua vendo o dono real depois.
 */
function withReservedCapacity(character: CharacterRuntime, reserved: number): Wearer {
  return {
    level: character.level,
    vocationId: character.vocationId,
    capacity: Math.max(0, character.capacity - reserved),
  };
}

/** O `Runner` serializado. Ver `HuntRulesetState.runners`. */
export interface RunnerState {
  readonly route: RouteState;
  readonly botScheduled: readonly string[];
  readonly luring: boolean;
  readonly ringReplaced: string | null;
  readonly playerAttackReady: boolean;
  readonly warnedExhausted: boolean;
  readonly warnedFullBackpack: boolean;
  readonly warnedNoGold: boolean;
  /**
   * Por automação, a última chave `reason:itemId` que já virou `automation-blocked` (AB-08,
   * #420). Precisa entrar no snapshot: sem ele, uma hunt retomada volta a registrar o mesmo
   * aviso a cada ciclo, que é o defeito que este campo fecha. Ausente é "nada avisado".
   */
  readonly automationWarned?: Readonly<Record<string, string>>;
  /**
   * O alvo selecionado (#444). Precisa entrar no snapshot: o alvo persiste no runner até
   * morrer ou sair da tela, e a hunt retomada continua mirando nele. Ausente é "sem alvo" —
   * snapshot anterior, que cai na política no primeiro evento.
   *
   * O NOME do campo é o do formato persistido e não mudou com o #470: na memória ele virou
   * `attackTarget` + `botCandidate`, e `#runnerStateOf`/`#newRunner` fazem a tradução. Renomear
   * a chave do snapshot exigiria bump de formato e tolerância de leitura por uma mudança que
   * não altera o que é gravado (ADR 0014).
   */
  readonly chosenTarget?: string | null;
  /** O alvo é do jogador (AB-09/#480) ou do auto-target (#444)? Ausente é auto (`false`). */
  readonly chosenTargetPinned?: boolean;
  readonly botConfig?: BotConfigV2;
  readonly pendingExit?: ExitReason;
  /**
   * Já reportamos `active:false` para o follow deste participante (#398). Opcional e OMITIDO
   * quando `false`: um snapshot de hunt sem follow configurado não muda de tamanho.
   */
  readonly followInterrupted?: boolean;
  /** O alvo do follow (#401). Opcional: snapshot anterior a esta issue não o tem. */
  readonly followTargetId?: string;
  /** A razão da interrupção do follow (#401). Opcional pelo mesmo motivo. */
  readonly followReason?: 'dead' | 'left' | 'unreachable';
  /**
   * O último ataque ou cura deste participante (§525). Ausente é "nunca" — a hunt retomada
   * volta com a XP compartilhada avaliando este membro como INATIVO até ele agir de novo, o
   * mesmo efeito conservador de um `ticksMap` vazio no TFS/Canary logo após um restart.
   */
  readonly lastCombatActionAtMs?: number;
  /**
   * Desde quando `luring` é `false` sem interrupção (#527, `MAX_LURE_HOLD_MS`). Ausente/`null` é
   * "correndo, ou sem cerco em curso" — um snapshot anterior a esta issue nunca tinha isto, e o
   * efeito é o mesmo: o cerco retomado começa contando do zero, nunca de um estouro que já
   * tivesse acontecido antes do restart.
   */
  readonly lureStoppedSinceMs?: number | null;
  /** Até quando o "puxa à força" vale (#527, `LURE_FORCE_WALK_MS`). Ausente/`null` é fora dele. */
  readonly lureForceWalkUntilMs?: number | null;
  /** Até quando o empurrão (#527, `#nudgeCompanion`) suspende o follow. Ausente/`null` é fora. */
  readonly nudgedUntilMs?: number | null;
  /** Desde quando a travessia de escada do follow está sem progredir (#527). Ausente/`null` é fora. */
  readonly crossFloorStuckSinceMs?: number | null;
  /** Quantas vezes SEGUIDAS o passo da rota bateu `same-tile` (#527). Ausente é zero. */
  readonly sameTileStreak?: number;
  /** Desde quando o líder espera a party se juntar (#527). Ausente/`null` é fora. */
  readonly regroupSinceMs?: number | null;
  /**
   * O caminho de um `walk-to` distante em curso (#763). Ausente é "sem caminho manual" — o
   * padrão de sempre, e o que todo snapshot anterior a esta issue tem.
   */
  readonly manualWalkTo?: { readonly destination: FloorPoint; readonly path: readonly GridPoint[] };
  /** Até quando o bot fica pausado depois de chegar (#763). Ausente/`null` é fora da janela. */
  readonly manualWalkHoldUntilMs?: number | null;
  /**
   * Os passos que faltam da caminhada forçada do medo (M44-04, #622) — ver `Runner.fearWalk`.
   * Ausente é "não está fugindo", o que todo snapshot anterior a esta issue tem.
   */
  readonly fearWalk?: readonly number[];
  /**
   * A fase do pensamento do personagem (M44-04, #622) — ver `Runner.thinkPhaseMs`. Ausente é "ainda
   * não sorteada", o que todo snapshot anterior a esta issue tem.
   */
  readonly thinkPhaseMs?: number;
  /** O golpe está estacionado esperando o pensamento depois de `pacified` (M44-04, #622) — ver `Runner.attackParked`. */
  readonly attackParked?: boolean;
}

export class HuntRuleset implements Ruleset {
  readonly type = 'hunt' as const;

  readonly #options: HuntRulesetOptions;
  /** Um `Runner` por participante presente (#203). Ver `Runner`. */
  readonly #runners = new Map<string, Runner>();
  /** A party (#191): modo e líder. `undefined` é solo. Vem das opções ou do snapshot. */
  #party: PartyOptions | undefined;
  /**
   * A bolsa do modo compartilhado (#192, ADR 0027 decisão 5; #396): todo loot cai aqui, com
   * capacidade igual à soma das capacidades DISPONÍVEIS dos presentes; em OVERWEIGHT o item com
   * peso que não cabe fica no cadáver — não vai para a caixa do líder. `#bagWeight` é derivado e
   * recalculado na retomada; `#bagSeq` dá o id das instâncias (`sessionId:bag:n`), que precisam
   * ser únicas na sessão.
   */
  #bag: PartyBagState | null = null;
  #bagWeight = 0;
  #bagSeq = 0;
  /** Alguém saiu e a cascata do §13.9 ainda não rodou (#193). Ver `onLeave`. */
  #lossPending = false;
  /**
   * A votação de encerrar a hunt para todos (#432, ADR 0032 d.14), ou `null` sem votação.
   * `approved` guarda quem já aprovou, na ordem; o vencimento é o evento `END_VOTE_EXPIRE`.
   */
  #endVote: { proposedAtMs: number; readonly approved: Set<string> } | null = null;
  /**
   * O que o `restore` leu e ainda não pôde materializar: os participantes só existem depois
   * dele, e `onResume` é quem os casa com o estado. `legacy` é o snapshot de um dono só.
   */
  #pendingRunners: { readonly byId: Readonly<Record<string, RunnerState>> | null; readonly legacy: RunnerState | null } | null = null;
  /**
   * Os lugares NÃO BLOQUEÁVEIS já resolvidos e teleportando (#583, `spawn_monster.cpp:317-341`):
   * o monstro e a posição já foram sorteados quando o efeito de teleporte saiu, e ficam aqui até
   * o evento de materialização vencer — sem isto, uma sessão retomada no meio dos 4200 ms
   * perderia qual monstro estava a caminho e sorteria outro (quebrando o determinismo do peso,
   * #582, para quem restaura bem no meio da janela). Indexado por slot: só um pedido pendente por
   * lugar, porque o slot não é reocupado enquanto o lugar não nasce de verdade.
   */
  #pendingSpawns = new Map<number, { readonly monsterId: string; readonly position: WorldPoint }>();
  /**
   * As regras injetadas por quem montou o ruleset, separadas das do jogador.
   *
   * Precisam ficar guardadas à parte porque a lista efetiva é RECOMPOSTA três vezes — na
   * construção, na restauração e a cada troca de configuração — e sem separar não há como
   * recompor sem duplicar as injetadas ou perdê-las. Foi assim que a restauração passou a
   * voltar sem as regras de saída, e o teste de retomada pegou.
   */
  readonly #injectedExitRules: readonly HuntExitRule[];
  #spawner: Spawner;
  #monsters: MonsterRuntime[] = [];
  /**
   * Índice `"m:<id>"` → monstro, para o despacho de evento não varrer a lista.
   *
   * Custa uma entrada de mapa por monstro e paga na hora: com 38 monstros, uma varredura por
   * evento é a diferença entre 9 e 35 µs por instância no `pnpm bench:hunts`, e o custo por
   * instância é o número que a FUN-46 cobra.
   */
  readonly #monsterBySubject = new Map<string, MonsterRuntime>();
  #nextCreatureId = 1;
  /** Os cadáveres no chão, e o próximo id de item de chão (FUN-123). */
  #corpses: CorpseState[] = [];
  #nextGroundItemId = 1;
  /**
   * Os campos de tile ativos (CMB-07), indexados por chave NUMÉRICA de tile. O `Tilemap` é
   * conteúdo imutável; o campo é estado do ruleset (DT-01). `TileOccupancy.fields` referencia
   * esta MESMA instância desde o construtor (#560, como `#tileOverrides`); `restore()` a
   * atualiza por mutação (`restoreState`), nunca a substitui.
   */
  readonly #fields = new Fields();

  /**
   * O overlay de cenário usável desta sessão (#728, ADR 0050 d.2): porta, capim, stone pile e
   * alavanca. Construído do CONTEÚDO fixado (`Tilemap.interactables`, #727) — nunca do disco —
   * e mutado só por esta sessão (invariante 9). `TileOccupancy.overrides` referencia a MESMA
   * instância; `restore()` a atualiza por mutação (`restoreState`), nunca a substitui.
   */
  readonly #tileOverrides: TileOverrides;

  /** Até que instante lógico a stamina já foi cobrada. Ver `#burnStamina`. */
  #staminaAnchorMs = 0;

  /** A view do bot, reaproveitada (FUN-80): montar uma por avaliação é alocar por evento. */
  readonly #botView: BotView = {
    self: null as unknown as CharacterRuntime, targetCount: 0, target: null, partyTarget: null,
    summonCount: 0,
  };

  /**
   * Resolve grupo e chave de cooldown de uma ação do CONTEÚDO, uma vez por slot, na compilação
   * (DT-01). Puro: só lê os catálogos fixados na sessão, nunca o disco (invariante 7).
   *
   * Magia de grupo tranca `group:<g>` (o `castSpell` já o aplica); ação sem grupo declarado cai
   * no livro individual `spell:<id>`/`item:<id>`, para não inventar prioridade compartilhada
   * (DT-06).
   */
  readonly #cooldownOf: CooldownOfAction = (action) => {
    if (action.kind === 'spell') {
      const spell = this.#options.spells.get(action.spellId);
      const group = spell?.group;
      return group === undefined
        ? { group: `spell:${action.spellId}`, cooldownKey: spellCooldownKey(action.spellId) }
        : { group, cooldownKey: groupCooldownKey(group) };
    }
    const supply = this.#options.supplies.get(action.supplyId);
    const group = supply?.group;
    return group === undefined
      ? { group: `supply:${action.supplyId}`, cooldownKey: supplyCooldownKey(action.supplyId) }
      : { group, cooldownKey: groupCooldownKey(group) };
  };

  /**
   * As skills indexadas pelo que as alimenta (FUN-75).
   *
   * Montado UMA vez, na construção. `map.values()` aloca um iterador por chamada, e
   * `#scaledPower` e `#gainSkills` rodam a cada golpe e a cada magia — com 5.000 instâncias
   * isso é o coletor trabalhando para percorrer duas entradas. É a mesma conta que fez o
   * índice de monstro por subject valer a pena.
   */
  readonly #skillsByGain: Readonly<Record<Skill['gain']['on'], readonly Skill[]>>;

  /**
   * A munição BÁSICA de cada família (ADR 0026 d.3): a primeira em ordem de id. É o padrão de
   * quem nunca escolheu — o tiro usa a seleção da família, ou esta. Resolvida UMA vez, no
   * boot da instância: nenhuma varredura de catálogo por tiro.
   */
  readonly #basicAmmo: ReadonlyMap<AmmoFamily, Ammunition>;

  /**
   * Os ids dos itens que esfolam (#626): a `toolId` de cada entrada de `options.skinning`. É o que
   * `use-item`/`use-item-on` confere para tratar uma instância como ferramenta — resolvido UMA vez,
   * no boot da instância. Vazio é uma hunt sem esfola.
   */
  readonly #skinToolIds: ReadonlySet<string>;

  /**
   * A mira da magia, reaproveitada pela mesma razão que `#botView` (FUN-92).
   *
   * Três vetores que andam juntos e são limpos a cada lançamento: os alvos como `castSpell` os
   * enxerga, os monstros correspondentes — quem leva o dano — e o objeto de mira. Uma magia
   * por segundo por personagem, vezes 5.000 instâncias, é alocação que dá para não fazer.
   *
   * Mutáveis de propósito: `castSpell` só lê, e quem escreve é `#aimAt`, num lugar só.
   */
  readonly #spellTargets: MutableSpellTarget[] = [];
  /** Os monstros na mesma ordem de `#spellTargets`: é quem leva o dano de cada rolagem. */
  readonly #spellHits: MonsterRuntime[] = [];
  /**
   * Os ALIADOS de uma cura em área (#475, Mass Healing), na ordem dos participantes da sessão.
   * Reaproveitado como `#spellHits`: a cura de grupo roda por lançamento, e o vetor novo só é
   * o do evento. O conjurador entra nele, mas quem já o curou foi o `castSpell` — o laço pula.
   */
  readonly #healAllies: CharacterRuntime[] = [];
  /** Os tiles da forma do último lançamento (#155), para o efeito por tile. Reaproveitado. */
  #aimTiles: WorldPoint[] = [];
  readonly #aim: { distance: number; targets: readonly SpellTarget[] } = {
    distance: 0, targets: [],
  };

  /**
   * Quem escreve posição. **A hunt não escreve nenhuma** desde a FUN-69 — ela pede.
   *
   * A ocupação de tiles mora lá dentro. Ela precisa ser remontada uma vez quando a sessão
   * nasce ou é restaurada, porque `restore` não enxerga os participantes — a `Session` só os
   * reconstrói depois. Daí a bandeira: remonta no primeiro evento, e mantém incremental dali
   * em diante, porque remontar a cada evento seriam dezenas de varreduras por segundo.
   */
  readonly #world: TileOccupancy;
  #occupancyStale = true;

  constructor(options: HuntRulesetOptions) {
    // `options.difficulty` chega do protocolo (#584) e não é mais validada nem lida aqui
    // (#583, ADR 0039 — fim do pull por dificuldade): o campo é aceito e IGNORADO, guardado só
    // para o snapshot/`changeDifficulty` continuarem redondos enquanto o protocolo o mandar.
    this.#options = options;
    this.#party = normalizePartyOptions(options.partyOptions);
    if (this.#party?.splitLoot) this.#bag = { gold: [], items: [], capacity: 0, overweight: false };
    this.#injectedExitRules = options.exitRules ?? [];
    this.#skillsByGain = {
      'melee-hit': [...options.skills.values()].filter((sk) => sk.gain.on === 'melee-hit'),
      'distance-hit': [...options.skills.values()].filter((sk) => sk.gain.on === 'distance-hit'),
      'spell-cast': [...options.skills.values()].filter((sk) => sk.gain.on === 'spell-cast'),
      'shield-block': [...options.skills.values()].filter((sk) => sk.gain.on === 'shield-block'),
    };
    this.#spawner = new Spawner(options.route.spawnPoints.length);
    this.#tileOverrides = TileOverrides.fromInteractables(options.map.interactables);
    this.#world = new TileOccupancy(
      options.map, { overrides: this.#tileOverrides, fields: this.#fields },
    );
    // A básica por família é a primeira em ordem de id (determinístico, sem varredura por tiro).
    const basics = new Map<AmmoFamily, Ammunition>();
    for (const ammo of [...options.ammunition.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!basics.has(ammo.family)) basics.set(ammo.family, ammo);
    }
    this.#basicAmmo = basics;
    this.#skinToolIds = new Set([...(options.skinning?.values() ?? [])].map((entry) => entry.toolId));
  }

  get monsters(): readonly MonsterRuntime[] {
    return this.#monsters;
  }

  /**
   * O andar da instância. Monstro vive numa grade 2D; o `z` é do mapa, e quem monta o
   * `session-state` precisa dele para pôr o monstro no mesmo andar do personagem (FUN-103).
   */
  get floor(): number {
    return this.#world.map.z;
  }

  /** O mapa da instância (FUN-120): é o que o cliente busca para desenhar a hunt. */
  get mapId(): string {
    return this.#world.map.id;
  }

  get huntId(): string {
    return this.#options.hunt.id;
  }

  get difficulty(): string {
    return this.#options.difficulty;
  }

  attackTargetOf(character: CharacterRuntime): MonsterRuntime | null {
    return this.#attackTarget(character);
  }

  /**
   * Dispara um slot do conjunto ATIVO na hora, ignorando `when` e `auto` (AB-09, ADR 0032 d.3).
   *
   * Manual é manual: a elegibilidade natural é a mesma do bot (`#perform`), mas a condição do
   * slot e a chave automática NÃO valem — o jogador apertou a tecla. `enabled: false` continua
   * valendo (desligado é explícito). O `set` defasado é recusa, não "usa o ativo": o cliente
   * disparou por uma barra que mudou (DT-03).
   *
   * Cooldown é conferido ANTES de executar, e a ação que não aconteceu não inicia cooldown
   * nenhum — a ordem da elegibilidade é o ponto caro aqui.
   *
   * `target` é a mira (ADR 0049 decisão 2): já traduzido pelo host para o domínio do `sim`.
   * Sem ele, vale o default de sempre (alvo fixado, senão o candidato do bot).
   */
  useSlot(
    session: Session, characterId: string, set: number, slotIndex: number,
    target?: UseSlotTarget,
  ): SlotOutcome {
    const character = findById(session.participants, characterId);
    const runner = this.#runners.get(characterId);
    if (character === null || !character.alive || runner === undefined) {
      return refuse('not-in-catalog', 0);
    }
    const config = runner.botConfig;
    if (config === undefined) return refuse('empty-slot', 0);
    if (set !== config.activeSet) return refuse('wrong-set', 0);
    const entry = config.sets[set]?.slots[slotIndex];
    if (entry === null || entry === undefined) return refuse('empty-slot', 0);
    if (entry.enabled === false) return refuse('disabled', 0);

    const wait = this.#cooldownWaitOf(character, entry.do, session.nowMs);
    if (wait > 0) return refuse('on-cooldown', wait);

    // A mira (ADR 0049 decisão 2): resolve recipiente de aliado OU alvo explícito de
    // monstro/posição. `null` é "não se aplica" (ação sem alvo mirável — o `target` é ruído e é
    // ignorado, RF-12 da spec); só uma recusa TIPADA interrompe o disparo.
    const resolved = this.#resolveManualTarget(session, character, entry.do, target);
    if (resolved !== null && !resolved.ok) return refuse(resolved.reason, 0);
    const recipient = resolved?.ok === true && resolved.recipient !== undefined
      ? resolved.recipient : character;
    const explicit = resolved?.ok === true ? resolved.explicit : undefined;

    const result = this.#perform(session, character, entry.do, recipient, explicit);
    if (!result.ok) return refuse(refusalOf(result), result.retryInMs);
    // A ação SAIU: o ciclo automático passa a respeitar o cooldown que ela acabou de iniciar.
    this.#armBot(session, characterId);
    return { ok: true };
  }

  /**
   * Usa um item da mochila/bolsa OU uma unidade do estoque de suprimento — comida, carga de
   * bênção, poção ou runa (#726, ADR 0049 decisão 3). SEM passar pela barra: qualquer
   * suprimento em estoque é usável direto, e o `target` (opcional aqui) é a mesma mira do
   * `use-slot` — vale para runa/poção de dano ou cura miráveis; item sem alvo mirável a ignora.
   *
   * Exaustão compartilhada (#690, ADR 0049 decisão 6): cooldown de GRUPO continua recusa
   * IMEDIATA, como sempre; só a exaustão de AÇÃO (`exhaust:action`) é ADIADA — `pendingManualAction`
   * agenda o reenvio para o vencimento do livro, e o jogador recebe `ok: true` na hora (a
   * aceitação, não a execução).
   */
  useItem(
    session: Session, characterId: string, ref: ItemRef, seq: number, target?: UseSlotTarget,
  ): UseItemOutcome {
    return this.#useItemLike(session, characterId, 'item', ref, seq, target);
  }

  /**
   * Usa um item/suprimento COM alvo (#726, ADR 0049 decisão 3) — a diferença entre "usar" e
   * "usar com…" do menu de contexto da mochila. Mesma resolução de `useItem`, com `target`
   * OBRIGATÓRIO em vez de opcional.
   */
  useItemOn(
    session: Session, characterId: string, ref: ItemRef, seq: number, target: UseSlotTarget,
  ): UseItemOutcome {
    return this.#useItemLike(session, characterId, 'item-on', ref, seq, target);
  }

  #useItemLike(
    session: Session, characterId: string, kind: 'item' | 'item-on', ref: ItemRef, seq: number,
    target: UseSlotTarget | undefined,
  ): UseItemOutcome {
    const character = findById(session.participants, characterId);
    if (character === null || !character.alive) return refuseItem('not-carried', 0);
    // Intenção manual (#763): (re)inicia a janela de pausa do bot, mesmo sem `walk-to` antes e
    // mesmo quando a ação em si é ADIADA pela exaustão (abaixo) — o clique já aconteceu.
    this.#armManualWalkHold(characterId, session.nowMs);

    // A exaustão de ação (#690/ADR 0049 d.6): cooldown de GRUPO/individual continua recusa
    // imediata (não muda com esta issue); só `exhaust:action` sozinha é ADIADA.
    const groupWait = this.#groupOrIndividualWaitOf(character, ref, session.nowMs);
    if (groupWait !== null && groupWait.ms > 0) return refuse(groupWait.reason, groupWait.ms);

    const actionExhaustWait = character.cooldowns.remainingMs(actionExhaustKey(), session.nowMs);
    if (actionExhaustWait > 0) {
      // Substitui qualquer pendência anterior — "um segundo disparo antes do vencimento
      // substitui o primeiro" (decisão 6, o `setNextActionTask` do Canary).
      session.cancelEvent(PENDING_MANUAL_ACTION, characterId);
      character.pendingManualAction = { kind, ref, seq, ...(target === undefined ? {} : { target }) };
      session.scheduleIn(PENDING_MANUAL_ACTION, actionExhaustWait, {
        priority: EventPriority.Housekeeping, subject: characterId,
      });
      return { ok: true };
    }

    return this.#performItemUse(session, character, ref, target);
  }

  /**
   * O vencimento de um `use-item`/`use-item-on` adiado (#726, ADR 0049 decisão 6). Se ninguém o
   * substituiu no meio do caminho (`pendingManualAction` ainda é ESTE), executa de verdade —
   * SEM adiar de novo, mesmo que algo tenha reiniciado a exaustão nesse meio-tempo (o Canary
   * também só tenta uma vez o `nextActionTask`). Falha aqui SÓ ENTÃO vira `use-result`: o
   * sucesso não precisa de segunda mensagem (decisão 7), e quem pediu já foi avisado com
   * `ok: true` no ato do clique.
   */
  #onPendingManualAction(session: Session, characterId: string): void {
    const character = findById(session.participants, characterId);
    const pending = character?.pendingManualAction;
    if (character === null || pending === undefined || pending === null) return;
    character.pendingManualAction = null;
    const ref: ItemRef = pending.ref;
    const target: UseSlotTarget | undefined = pending.target;
    const outcome = this.#performItemUse(session, character, ref, target);
    if (!outcome.ok) {
      session.emit({
        kind: 'manual-action-result', characterId, seq: pending.seq, ok: false, reason: outcome.reason,
      });
    }
  }

  /**
   * A exaustão de GRUPO/individual de um `ItemRef` (#726) — a parte que continua RECUSA
   * IMEDIATA da decisão 6. `null`: a referência não resolve para um supply conhecido (o host já
   * vai recusar `not-carried`/`not-in-catalog` mais adiante) ou é uma instância (comida/bênção
   * não têm livro de grupo — só `exhaust:action`, comum a todos, se aplica a elas).
   */
  #groupOrIndividualWaitOf(
    character: CharacterRuntime, ref: ItemRef, nowMs: number,
  ): { readonly ms: number; readonly reason: SlotRefusal } | null {
    if (!('supplyId' in ref)) return null;
    const supply = this.#options.supplies.get(ref.supplyId);
    if (supply === undefined) return null;
    const groupWait = character.cooldowns.remainingMs(groupCooldownKey(supply.group), nowMs);
    if (groupWait > 0) return { ms: groupWait, reason: 'group-cooldown' };
    const individualWait = character.cooldowns.remainingMs(supplyCooldownKey(supply.id), nowMs);
    if (individualWait > 0) return { ms: individualWait, reason: 'on-cooldown' };
    return null;
  }

  /**
   * A execução DE VERDADE de `use-item`/`use-item-on`, sem checar exaustão (o chamador já
   * checou, ou é o vencimento do adiamento). Resolve `ref` pelo catálogo — `supply` reaproveita
   * `#useSupply`/`casting.ts` por inteiro (ADR 0049 decisão 3: "o mesmo caminho do slot, sem
   * passar pela barra"); `instance` executa comida (soma `fedMs`, ADR 0049 d.5). A carga de
   * bênção (`blessing-charge`) foi REMOVIDA pelo #570: bênção virou serviço de Cidade (ADR
   * 0052), nunca item de mochila — ver `#onCharacterDied` para o consumo e `rulesets/city.ts`
   * para a compra.
   */
  #performItemUse(
    session: Session, character: CharacterRuntime, ref: ItemRef, target: UseSlotTarget | undefined,
  ): UseItemOutcome {
    if ('supplyId' in ref) return this.#performSupplyRef(session, character, ref.supplyId, target);
    return this.#performInstanceRef(session, character, ref.instanceId, target);
  }

  #performSupplyRef(
    session: Session, character: CharacterRuntime, supplyId: string, target: UseSlotTarget | undefined,
  ): UseItemOutcome {
    const supply = this.#options.supplies.get(supplyId);
    if (supply === undefined) return refuseItem('not-carried', 0);
    // Sem estoque e sem gold: `#useSupply`/`useSupply` (`casting.ts`) já recusam
    // `not-enough-gold` na ordem certa (requisitos antes do gold) — nada a checar aqui antes.
    const resolved = this.#resolveManualTarget(
      session, character, { kind: 'supply', supplyId } as BotAction, target,
    );
    if (resolved !== null && !resolved.ok) return refuseItem(resolved.reason, 0);
    const recipient = resolved?.ok === true && resolved.recipient !== undefined
      ? resolved.recipient : character;
    const explicit = resolved?.ok === true ? resolved.explicit : undefined;

    const result = this.#useSupply(session, character, supplyId, recipient, explicit);
    if (!result.ok) return refuseItem(refusalOf(result), result.retryInMs);
    character.cooldowns.start(actionExhaustKey(), session.nowMs, MANUAL_ITEM_EXHAUST_MS);
    return { ok: true };
  }

  #performInstanceRef(
    session: Session, character: CharacterRuntime, instanceId: string, target: UseSlotTarget | undefined,
  ): UseItemOutcome {
    const carried = [...character.inventory.backpack, ...character.inventory.satchel]
      .find((item) => item?.instanceId === instanceId);
    if (carried === undefined || carried === null) return refuseItem('not-carried', 0);
    // A ferramenta de esfola (#626) age sobre o cadáver do tile apontado, e não é consumida.
    if (this.#skinToolIds.has(carried.itemId)) return this.#performSkin(session, character, carried, target);
    const item = this.#options.items.get(carried.itemId);
    // `Item.effect` é opcional na forma (só `kind: 'consumable'` o declara — `buildContent`
    // confere isso no boot, não o tipo): o schema não dá o discriminante de graça ao TS.
    if (item === undefined || item.kind !== 'consumable' || item.effect === undefined) {
      return refuseItem('not-usable', 0);
    }

    if (item.effect.kind === 'food') {
      const fed = feedCharacter(character, item.effect.durationMs);
      if (!fed.ok) return refuseItem('you-are-full', 0);
      character.inventory.consumeOne(instanceId);
      // A confirmação é o `inventory` reenviado (decisão 7: sucesso não vira mensagem própria).
      // "Munch." etc. do Canary, e o `fedMs` novo em si, ficam fora — nenhum dos dois tem campo
      // de protocolo hoje (`player-stats`/`session-state` não expõem `fedMs`); ver desvios da
      // spec desta issue.
      session.emit({ kind: 'equipment-changed', characterId: character.id });
      character.cooldowns.start(actionExhaustKey(), session.nowMs, MANUAL_ITEM_EXHAUST_MS);
      return { ok: true };
    }
    // `heal`/`mana`/`damage` num item de mochila não têm executor hoje: nenhum item real do
    // catálogo declara isso (só a runa/poção do ESTOQUE, via `'supplyId' in ref`, executa
    // dano/cura) — chegar aqui é conteúdo futuro sem mecanismo ainda, e a recusa é a certa.
    return refuseItem('not-usable', 0);
  }

  /**
   * O estado dos slots do conjunto ATIVO (AB-09), para o `slot-state`. PURO: não muta nada e
   * não consome RNG — é a apresentação da mesma elegibilidade que `useSlot` executaria.
   */
  slotStates(session: Session, character: CharacterRuntime): readonly SlotState[] {
    const config = this.#runners.get(character.id)?.botConfig;
    const set = config?.activeSet ?? 0;
    const out: SlotState[] = [];
    for (let slot = 0; slot < BOT_SLOTS_PER_SET; slot += 1) {
      const entry = config?.sets[set]?.slots[slot] ?? null;
      if (entry === null) {
        out.push({ set, slot, state: 'empty', remainingMs: 0 });
        continue;
      }
      if (entry.enabled === false) {
        out.push({ set, slot, state: 'blocked', remainingMs: 0, reason: 'disabled' });
        continue;
      }
      const wait = this.#cooldownWaitOf(character, entry.do, session.nowMs);
      if (wait > 0) {
        out.push({ set, slot, state: 'cooldown', remainingMs: wait, reason: 'on-cooldown' });
        continue;
      }
      out.push(this.#naturalStateOf(session, set, slot, character, entry.do));
    }
    return out;
  }

  /**
   * O jogador escolheu um alvo clicando (AB-09, ADR 0032 d.5). `false` se não é monstro vivo —
   * o host ignora em silêncio, como o `walk` recusado. O override vale para qualquer política e
   * sobrepõe a busca enquanto o alvo vive (DT-05).
   */
  chooseTarget(session: Session, characterId: string, subject: string): boolean {
    const monster = this.#monsterBySubject.get(subject);
    if (monster === undefined || !monster.alive) return false;
    const character = findById(session.participants, characterId);
    if (character === null) return false;
    // A invocação de personagem nunca é alvo de ataque válido — nem a própria, nem a de um
    // companheiro de party (#598, ADR 0057): fogo amigo não é intenção que o cliente devesse
    // conseguir expressar clicando, e o servidor recusa em silêncio, como o clique num monstro
    // morto.
    if (typeof monster.masterId === 'string') return false;
    this.setAttackTarget(character, monster);
    return true;
  }

  /**
   * O monstro vivo por subject, ou `null` (#470). É a ponte do host: o `select-target` chega
   * com o id numérico do fio, e quem o traduz para o runtime é `#subjectOfCreature` do host;
   * aqui ele resolve o subject validado no runtime que `setAttackTarget` recebe.
   */
  monsterBySubject(subject: string): MonsterRuntime | null {
    const monster = this.#monsterBySubject.get(subject);
    return monster !== undefined && monster.alive ? monster : null;
  }

  /**
   * O alvo de ATAQUE explícito (#470): o jogador (AB-09) e o bot (#480). `null` limpa — é o
   * cancelamento do `creatureId: 0`. É a ÚNICA porta de escrita do `attackTarget`, para jogador
   * e bot não terem dois pipelines que divergem (§42: o bot manda os mesmos comandos).
   *
   * `pinned` distingue quem escreveu: o clique do jogador é EXCLUSIVO (fora do alcance não cai
   * na política), a eleição do bot não é — ela é uma mirada corrente, e a política reassume
   * quando ela sai do alcance. Quem chama com a assinatura de dois argumentos é o jogador, e
   * por isso o padrão é `true`; o bot passa `false` explicitamente.
   *
   * Não valida: quem valida é quem resolve o runtime (o host contra o id do fio, o bot contra a
   * política), e o alvo morto é limpo na primeira leitura por `#attackTargetOfRunner`.
   */
  setAttackTarget(
    character: CharacterRuntime, target: MonsterRuntime | null, pinned = true,
  ): void {
    const runner = this.#runners.get(character.id);
    if (runner === undefined) return;
    // Monstro invisível não é alvo (#559): o jogador não o enxerga (`Player::canSeeCreature`,
    // `player.cpp:1418`) e o cliente do Canary nem recebe a criatura para clicar nela
    // (`ProtocolGame::canSee`) — o `Game::playerSetAttackedCreature` do servidor não confere
    // visibilidade nenhuma, a proteção é do lado do cliente. O cliente do Draconya ainda DESENHA
    // o monstro invisível, então esta recusa é o substituto server-side dessa apresentação (não
    // uma regra de caça: o alvo que um jogador do Canary poderia escolher é o mesmo). O alvo que
    // JÁ estava fixado e ficou invisível é outro caso — cai no think agendado, não aqui.
    const visible = target !== null && !target.invisible ? target : null;
    runner.attackTarget = visible === null ? null : visible.subject;
    runner.attackTargetPinned = visible !== null && pinned;
  }

  /**
   * O alvo SELECIONADO para a apresentação (#470, RF-05): o alvo de ataque se houver, senão o
   * candidato do auto-target. **Não é recortado pelo alcance da arma** — é o que mantém o
   * alvo na tela enquanto a criatura está viva e na sessão (o raio de busca), mesmo fora do
   * corpo a corpo. Não muta: apresentação não escreve estado quente (invariante 3).
   */
  selectedTargetOf(character: CharacterRuntime): MonsterRuntime | null {
    const runner = this.#runners.get(character.id);
    if (runner === undefined) return null;
    return this.#liveTargetOf(runner.attackTarget, character, runner.attackTargetPinned)
      ?? this.#liveTargetOf(runner.botCandidate, character);
  }

  /** Os cadáveres no chão agora (FUN-123): quem reanexa precisa vê-los no `session-state`. */
  get groundItems(): readonly CorpseState[] {
    return this.#corpses;
  }

  /** Os campos de tile ativos agora (CMB-07): leitura para snapshot, host e teste. */
  get fields(): readonly TileFieldState[] {
    return this.#fields.getState();
  }

  /** O overlay de cenário usável desta sessão (#728): leitura para snapshot, host e teste. */
  get tileOverrides(): readonly TileOverrideState[] {
    return this.#tileOverrides.getState();
  }

  /**
   * O overlay ATIVO, como mudanças de aparência (#729, ADR 0050 d.7): todo interativo cujo
   * estado hoje difere do `initialState` do conteúdo — o que quem reanexa precisa aplicar por
   * cima da pilha estática para ver a porta já aberta, o capim já cortado. PURO: não muta nada,
   * é a mesma leitura que `#sessionState` do host monta a cada reanexação.
   */
  get tileAppearanceChanges(): readonly TileAppearanceChange[] {
    const changes: TileAppearanceChange[] = [];
    for (const state of this.#tileOverrides.getState()) {
      const content = this.#tileOverrides.contentOf(state.interactableId);
      if (content === null || content.initialState === state.state) continue;
      changes.push({
        position: content.at, appearanceKey: content.appearanceKey,
        fromState: content.initialState, toState: state.state,
      });
    }
    return changes;
  }

  /**
   * TODO interativo, com o suficiente para resolver aparência — não só quem difere do
   * `initialState` como `tileAppearanceChanges` (#729). É a leitura do host para o `tile-update`
   * PASSIVO (#734, ADR 0050 d.6 T3): o walker abrindo uma porta sozinho (#728), uma placa de
   * pressão reagindo a step-in/step-out, ou um `TILE_REVERT` (capim, stone pile, teleporte
   * gated) — nenhum desses passa por `useOnMap`, então nenhum tinha `tile-update` até aqui.
   * `tileAppearanceChanges` continuaria CEGO para "voltou ao estado inicial" (o id some da
   * lista filtrada); aqui todo interativo aparece sempre, e quem decide se mudou desde a
   * última entrega é o host, comparando contra o que ele mesmo já mandou (`sentTileOverrides`).
   * PURO: mesma garantia de `tileAppearanceChanges`.
   */
  get tileOverrideAppearances(): readonly {
    readonly interactableId: string; readonly position: WorldPoint;
    readonly appearanceKey: string; readonly state: string;
  }[] {
    const entries: Array<{
      interactableId: string; position: WorldPoint; appearanceKey: string; state: string;
    }> = [];
    for (const state of this.#tileOverrides.getState()) {
      const content = this.#tileOverrides.contentOf(state.interactableId);
      if (content === null) continue;
      entries.push({
        interactableId: state.interactableId, position: content.at,
        appearanceKey: content.appearanceKey, state: state.state,
      });
    }
    return entries;
  }

  /**
   * O jogador pediu para usar um tile (#729, ADR 0050 d.7): a porta, a alavanca, o capim, a
   * stone pile. Confere alcance (`canUse` do Canary — mesmo andar, adjacente, `|dx|<=1` e
   * `|dy|<=1`) ANTES de tocar em qualquer overlay, e só então delega a `#useInteractable` — a
   * MESMA função que o walker já usa sozinho (#728), para as duas portas nunca divergirem em
   * requisito ou ferramenta.
   */
  useOnMap(session: Session, characterId: string, position: WorldPoint): UseOnMapResult {
    const character = findById(session.participants, characterId);
    if (character === null) return { ok: false, reason: 'nothing-there' };
    if (
      position.z !== character.position.z
      || Math.abs(position.x - character.position.x) > 1
      || Math.abs(position.y - character.position.y) > 1
    ) {
      return { ok: false, reason: 'out-of-range' };
    }
    // Intenção manual (#763): (re)inicia a pausa do bot, mesmo sem `walk-to` antes e mesmo
    // quando o tile não tem nada de usável (abaixo) — o clique em si já é a intenção.
    this.#armManualWalkHold(characterId, session.nowMs);
    const current = this.#tileOverrides.at(position);
    if (current === null) return { ok: false, reason: 'nothing-there' };
    // Baú (#733, ADR 0050 d.6 T2): NUNCA passa por `isToggleable`/`#useInteractable` — não tem
    // par de estados, entrega item uma vez. Desviado ANTES da conferência de toggle, que
    // recusaria com `not-usable` — o mesmo desvio que a porta de level/quest usa a MAIS, não
    // um caminho concorrente.
    if (current.kind === 'chest') return this.#useChest(session, character, current.interactableId);
    if (!isToggleable(current.kind) || NOT_CLICK_USABLE.has(current.kind)) {
      return { ok: false, reason: 'not-usable' };
    }
    const content = this.#tileOverrides.contentOf(current.interactableId);
    const requires = content?.requires;
    // Porta de level (#732, ADR 0050 d.6 T2): `player:getLevel() >= item.actionid - 1000` do
    // Canary (`level_door.lua`) — conferido no MOMENTO de usar, e só quando o estado ainda é
    // `closed` (a mesma porta reaberta por outro personagem confere de novo, como no Canary; uma
    // vez ABERTA ela é só um tile livre até fechar sozinha no `vacate`).
    if (
      current.kind === 'level-door' && current.state === 'closed'
      && requires?.level !== undefined && character.level < requires.level
    ) {
      return { ok: false, reason: 'level-too-low' };
    }
    // Porta de quest (#733, ADR 0050 d.6 T2): `player:getStorageValue(item.actionid) ~= -1` do
    // Canary (`doors.lua`) virou `getStorageValue(requires.storageKey) >= 1` — o Draconya usa
    // `>= 1` (não `~= -1`) porque `0` já é um valor guardado ("aceitou mas não concluiu",
    // `docs/product/quests.md`), e esta porta exige a quest CONCLUÍDA (DT-01 da spec da #733).
    if (
      current.kind === 'quest-door' && current.state === 'closed'
      && requires?.storageKey !== undefined && character.getStorageValue(requires.storageKey) < 1
    ) {
      return { ok: false, reason: 'quest-incomplete' };
    }
    const tool = toolRequiredNow(current.kind, current.state, requires);
    if (tool !== undefined && !this.#hasTool(character, tool, requires?.keyId)) {
      return { ok: false, reason: 'missing-tool' };
    }
    const changes = this.#useInteractable(session, character, current.interactableId);
    if (changes === null) return { ok: false, reason: 'not-usable' };
    return { ok: true, changes };
  }

  /**
   * O jogador olhou uma posição (#729, ADR 0050 d.7): o `text` de uma placa, uma descrição
   * padrão do `kind` de cenário, ou o texto genérico sem interativo nenhum ali. Sem alcance
   * (DT-03 da spec da #729) — o AOI do servidor já limita o que a tela mostra.
   */
  look(position: WorldPoint): { readonly text: string } {
    const current = this.#tileOverrides.at(position);
    if (current === null) return { text: DEFAULT_LOOK_TEXT };
    const content = this.#tileOverrides.contentOf(current.interactableId);
    if (content?.text !== undefined) return { text: content.text };
    return { text: SCENERY_LOOK_TEXT[current.kind] ?? DEFAULT_LOOK_TEXT };
  }

  /**
   * Tenta usar UM interativo — abrir a porta (comum, de level, de chave, de quest), cortar o
   * capim, cavar a pile, puxar a alavanca (ADR 0050 d.4-d.5, T2 completo desde #733),
   * pressionar/soltar uma placa (#734, ADR 0050 d.6 T3). Devolve as mudanças de aparência (o
   * próprio + os linkados que também alternaram, #729) quando o estado mudou; `null` sem tocar
   * em nada — kind sem par de estados (`chest`, fora do escopo — tem caminho próprio em
   * `#useChest`), level/storage insuficiente para a porta correspondente, ou ferramenta exigida
   * (inclusive a chave certa) que este personagem não carrega.
   *
   * `character` é `null` para um step-in/step-out de MONSTRO (#734, `#onSteppedOnto`/
   * `#onSteppedOffOf`, abaixo): monstro não carrega ferramenta, então qualquer interativo que
   * EXIJA uma (`requires.tool`) simplesmente não reage a ele — a mesma regra de `#hasTool`
   * devolvendo `false`, sem duplicar a checagem. Nenhum conteúdo real declara `requires.tool`
   * numa placa de pressão hoje; a checagem existe para o dia em que alguém declarar.
   *
   * Agenda `TILE_REVERT` quando o NOVO estado tem `revertMs` (capim/stone pile, ou uma placa/
   * teleporte que o autor quis com prazo próprio); lever E pressure-plate ligam a quem está em
   * `links` (ADR 0050 d.1, #734) e alternam cada um também — sem re-entrar no MESMO id, que
   * travaria num interativo que se referencia por engano de conteúdo.
   */
  #useInteractable(
    session: Session, character: CharacterRuntime | null, interactableId: string,
  ): readonly TileAppearanceChange[] | null {
    const current = this.#tileOverrides.get(interactableId);
    if (current === null || !isToggleable(current.kind)) return null;
    const content = this.#tileOverrides.contentOf(interactableId);
    const requires = content?.requires;
    // Porta de level/quest (#732/#733): a MESMA conferência de `useOnMap`, para o walker (que
    // chama esta função direto, sem passar por `useOnMap`) nunca abrir uma porta que o
    // personagem não cumpre — as duas leem o MESMO `#tileOverrides`/conteúdo, então nunca
    // divergem. `character` nulo (step-in/step-out de MONSTRO, #734) nunca cumpre um requisito
    // de level nem de storage — a mesma degradação de "sem ferramenta" que `#hasTool` já devolve
    // para `tool`, abaixo.
    if (
      current.kind === 'level-door' && current.state === 'closed' && requires?.level !== undefined
      && (character === null || character.level < requires.level)
    ) return null;
    if (
      current.kind === 'quest-door' && current.state === 'closed' && requires?.storageKey !== undefined
      && (character === null || character.getStorageValue(requires.storageKey) < 1)
    ) return null;
    const tool = toolRequiredNow(current.kind, current.state, requires);
    if (tool !== undefined && (character === null || !this.#hasTool(character, tool, requires?.keyId))) return null;

    const next = this.#tileOverrides.toggle(interactableId, session.nowMs);
    if (next === null) return null;
    session.cancelEvent(TILE_REVERT, interactableId);
    if (next.revertAtMs !== undefined) {
      session.scheduleIn(TILE_REVERT, next.revertAtMs - session.nowMs, {
        priority: EventPriority.Housekeeping, subject: interactableId,
      });
    }
    session.record('tile-used', `${current.kind}:${interactableId}`);

    // Sem `content`, não há `appearanceKey`/posição para montar a mudança — não deveria
    // acontecer (todo id de `#byId` tem uma entrada em `#contentOf`, escritas juntas em
    // `TileOverrides.fromInteractables`), mas nunca inventar um `tile-update` sem os dois lados
    // resolvidos (mesma regra de conteúdo em versão divergente, seção 7 da spec da #729).
    const changes: TileAppearanceChange[] = content === null ? [] : [{
      position: content.at, appearanceKey: content.appearanceKey,
      fromState: current.state, toState: next.state,
    }];

    // Alavanca e placa de pressão (ADR 0050 d.1, #734): ligam a quem está em `links` e
    // alternam CADA um também — nunca o PRÓPRIO id de novo, o que evitaria um laço se o
    // conteúdo (por engano) linkar a si mesma.
    if (current.kind === 'lever' || current.kind === 'pressure-plate') {
      for (const linkedId of this.#tileOverrides.links(interactableId)) {
        if (linkedId === interactableId) continue;
        const before = this.#tileOverrides.get(linkedId);
        if (before === null) continue;
        const linked = this.#tileOverrides.toggle(linkedId, session.nowMs);
        if (linked === null) continue;
        session.cancelEvent(TILE_REVERT, linkedId);
        if (linked.revertAtMs !== undefined) {
          session.scheduleIn(TILE_REVERT, linked.revertAtMs - session.nowMs, {
            priority: EventPriority.Housekeeping, subject: linkedId,
          });
        }
        const linkedContent = this.#tileOverrides.contentOf(linkedId);
        if (linkedContent !== null) {
          changes.push({
            position: linkedContent.at, appearanceKey: linkedContent.appearanceKey,
            fromState: before.state, toState: linked.state,
          });
        }
      }
    }
    return changes;
  }

  /**
   * O baú de quest (#733, ADR 0050 d.6 T2): `uid` + storage do personagem, o mesmo par que o
   * ADR 0050 já descreve para o Canary. NUNCA passa por `isToggleable`/`toggle` — não tem par de
   * estados, entrega item uma vez — e por isso não devolve `TileAppearanceChange` nenhum
   * (`changes: []`): o baú não muda de aparência ao ser usado neste escopo.
   *
   * A ordem das conferências é a que MENOS vaza: já coletado recusa antes de saber se o item
   * existe no catálogo, e o catálogo é conferido antes de gastar capacidade. O item entra pelo
   * MESMO caminho do loot de cadáver/kit (`inventory.add`, `instanceId` determinístico
   * `lootSeq`) — é o que faz o prêmio atravessar `SessionReceipt.acquired` → `jobs/ledger.ts`
   * como qualquer item adquirido em sessão (invariante 10). Sem capacidade, o storage NÃO é
   * marcado (DT-03 da spec da #733): o baú continua de pé para quando a mochila esvaziar.
   */
  #useChest(session: Session, character: CharacterRuntime, interactableId: string): UseOnMapResult {
    const content = this.#tileOverrides.contentOf(interactableId);
    const uid = content?.uid;
    const reward = content?.reward;
    if (content === null || uid === undefined || reward === undefined) {
      return { ok: false, reason: 'not-usable' };
    }
    const storageKey = chestStorageKeyOf(uid);
    if (character.getStorageValue(storageKey) >= 1) return { ok: false, reason: 'already-looted' };
    const definition = this.#options.items.get(reward.itemId);
    if (definition === undefined) {
      // Conteúdo com referência solta — o mapa é importado antes do catálogo de itens estar
      // completo (#573/#754), então isto é esperado até lá, nunca um erro do jogador. Registrado
      // (não só recusado) para o extrato acusar qual baú aponta item que ainda não existe.
      session.record('chest-unknown-item', `${interactableId}:${reward.itemId}`);
      return { ok: false, reason: 'unknown-item' };
    }
    // Sem reserva de bolsa de party: o prêmio é PESSOAL, atribuído a quem usou o baú — não é
    // loot de abate compartilhável, então a capacidade disponível é a do personagem inteira.
    const wearer = withReservedCapacity(character, 0);
    const instanceId = this.#party !== undefined
      ? `${session.id}:${character.id}:${String(character.lootSeq++)}`
      : `${session.id}:${String(character.lootSeq++)}`;
    const carried: CarriedItem = { instanceId, itemId: reward.itemId, quantity: reward.quantity };
    if (!character.inventory.add(carried, this.#options.items, wearer, this.#containerRules(character)).ok) {
      return { ok: false, reason: 'no-capacity' };
    }
    character.setStorageValue(storageKey, 1);
    session.credit(character.id, 'itemsLooted', carried.quantity);
    session.record('chest-looted', interactableId);
    return { ok: true, changes: [] };
  }

  /**
   * Este personagem carrega uma ferramenta que serve para `tool` — equipada ou na mochila.
   *
   * `keyId` (#732) é só para `tool === 'key'`: a porta de chave exige a chave CERTA
   * (`key_door.lua` do Canary: `item.actionid == target.actionid`, "The key does not match."
   * quando diverge) — qualquer chave do inventário NÃO serve, ao contrário da machete, que corta
   * qualquer capim. Sem `keyId` (chamado de fora de uma porta de chave), a ferramenta serve por
   * tipo só, como sempre.
   */
  #hasTool(character: CharacterRuntime, tool: InteractableTool, keyId?: number): boolean {
    const matches = (itemId: string): boolean => {
      const use = this.#options.items.get(itemId)?.use;
      if (use?.tool !== tool) return false;
      return keyId === undefined || use?.keyId === keyId;
    };
    for (const item of character.inventory.items()) {
      if (matches(item.itemId)) return true;
    }
    for (const slot of ITEM_SLOTS) {
      const equipped = character.inventory.equippedAt(slot);
      if (equipped !== null && matches(equipped.itemId)) return true;
    }
    return false;
  }

  /**
   * O prazo de reversão de um interativo venceu (#728, ADR 0050 d.3): capim volta a crescer,
   * buraco enche de volta. Só reverte se o estado AINDA é o que agendou o prazo — usar de novo
   * antes de vencer já cancelou este evento (`#useInteractable`), mas um snapshot restaurado de
   * um formato anterior a esta issue nunca teria este evento, então a defesa nunca é o caminho
   * comum, só a rede de segurança.
   */
  #onTileRevert(session: Session, interactableId: string): void {
    const current = this.#tileOverrides.get(interactableId);
    if (current === null || current.revertAtMs === undefined) return;
    this.#tileOverrides.toggle(interactableId, session.nowMs);
  }

  /** O prazo de um cadáver venceu: sai do chão, e a tela fica sabendo. */
  #onCorpseDecay(session: Session, subject: string): void {
    const id = Number(subject);
    const index = this.#corpses.findIndex((corpse) => corpse.id === id);
    if (index === -1) return;
    this.#corpses.splice(index, 1);
    session.emit({ kind: 'ground-item-vanished', itemId: id });
  }

  /** O ambiente da hunt (FUN-121), do conteúdo — `cavern` no bueiro. Ausente é superfície. */
  get ambience(): 'surface' | 'cavern' | undefined {
    return this.#options.hunt.ambience;
  }

  /** A party desta instância (#191), ou `undefined` em solo. */
  get party(): PartyOptions | undefined {
    return this.#party;
  }

  /**
   * Prévia pura do rateio da bolsa compartilhada (#354, SV-18): quanto cada presente receberia se a bolsa
   * fosse liquidada AGORA — a MESMA conta de `#settle` (linha 2578), chamada como LEITURA, sem
   * gravar nada e sem esvaziar a bolsa. `undefined` fora do modo `shared` (não há bolsa a ratear)
   * e em solo (`#party` ausente) — D8: sistema/dado inexistente é omitido, nunca um zero fabricado.
   */
  partySpendingPreview(session: Session): ReadonlyMap<string, number> | undefined {
    if (this.#party === undefined || !this.#party.splitLoot || this.#bag === null) return undefined;
    const presentIds = session.participants.map((p) => p.id);
    return settleEntries(this.#bag, presentIds, this.#options.items).shares;
  }

  /**
   * Muda a configuração da party (D1, D2). Só o líder pode; a validação de catálogo acontece
   * ANTES de qualquer mutação — ou tudo se aplica, ou nada (como `configureBot`, mas com recusa
   * tipada porque aqui a recusa é visível ao jogador, não só um no-op silencioso).
   *
   * Chamado pelo host ENTRE avanços, a partir do opcode C2S `party-settings` (#400) — nunca
   * dentro de `advanceBy` (invariante 2). O cliente manda intenção crua; quem valida é aqui.
   */
  configureParty(
    session: Session, patch: PartySettingsPatch, byCharacterId: string,
  ): ConfigurePartyResult {
    const party = this.#party;
    if (party === undefined || byCharacterId !== party.leaderId) {
      return { ok: false, reason: 'not-leader' };
    }
    if (patch.collect !== undefined && patch.collect !== null) {
      for (const itemId of patch.collect) {
        if (!this.#options.items.has(itemId)) return { ok: false, reason: 'unknown-item', itemId };
      }
    }
    if (patch.autoSell !== undefined) {
      for (const itemId of patch.autoSell) {
        const item = this.#options.items.get(itemId);
        if (item === undefined) return { ok: false, reason: 'unknown-item', itemId };
        if (item.value === 0) return { ok: false, reason: 'unsellable-item', itemId };
      }
    }
    const next: PartySettings = {
      shareCosts: patch.shareCosts ?? party.shareCosts,
      splitLoot: patch.splitLoot ?? party.splitLoot,
      collect: patch.collect === undefined ? party.collect : patch.collect,
      autoSell: patch.autoSell ?? party.autoSell,
    };
    // Ligar: nasce vazia, igual ao construtor. Desligar: liquida com quem está presente AGORA
    // vendendo entrada por entrada (#395) e descarta. Nada se perde: vira gold ou vai para o
    // líder (`value: 0`, `unsold` de `settleEntries`).
    if (next.splitLoot && !party.splitLoot) this.#bag = { gold: [], items: [], capacity: 0, overweight: false };
    if (!next.splitLoot && party.splitLoot && this.#bag !== null) {
      this.#settle(session, session.participants, 'toggle');
      this.#bag = null;
    }
    party.shareCosts = next.shareCosts;
    party.splitLoot = next.splitLoot;
    party.collect = next.collect;
    party.autoSell = next.autoSell;
    // `configureParty` é um dos gatilhos do §13: ligar/desligar `splitLoot` muda o conjunto de
    // reservas, e mudar a lista de coleta/venda muda o que entra — rebalanceia e emite.
    this.#rebalanceBag(session);
    return { ok: true };
  }

  /**
   * O líder propõe encerrar a hunt para TODOS (#432, ADR 0032 d.14). Não encerra nada: abre uma
   * votação com a própria aprovação do líder (quem propõe, aprova), agenda o vencimento de 60 s
   * na fila e emite `party-end-vote`. Só o líder propõe; solo (sem party) não tem líder, como
   * em `configureParty`.
   *
   * Re-propor REINICIA a janela: cancela o vencimento anterior e esvazia as aprovações, exceto a
   * do líder. É a leitura literal de "o líder propõe" — quem propõe de novo está propondo de
   * novo, não confirmando a proposta velha.
   */
  proposeEnd(session: Session, byLeaderId: string): PartyEndVoteResult {
    const party = this.#party;
    if (party === undefined || byLeaderId !== party.leaderId) {
      return { ok: false, reason: 'not-leader' };
    }
    session.cancelEvent(END_VOTE_EXPIRE, END_VOTE_SUBJECT);
    this.#endVote = { proposedAtMs: session.nowMs, approved: new Set([byLeaderId]) };
    session.scheduleIn(END_VOTE_EXPIRE, END_VOTE_WINDOW_MS, {
      priority: EventPriority.Housekeeping, subject: END_VOTE_SUBJECT,
    });
    this.#emitEndVote(session);
    // Uma party que virou um só (todos os outros saíram): a proposta do líder já é o sim de
    // TODOS os presentes, e a sessão encerra na hora.
    this.#settleEndVote(session);
    return { ok: true };
  }

  /**
   * Um membro presente aprova a proposta em curso (#432). Quando o último presente aprova, a
   * sessão encerra com `party-vote` — o settlement e os extratos saem pelo caminho de sempre
   * (`onEnd` + `Session.end`). Sem proposta aberta é `no-proposal`; id ausente é `not-member`.
   */
  approveEnd(session: Session, characterId: string): PartyEndVoteResult {
    const vote = this.#endVote;
    if (vote === null) return { ok: false, reason: 'no-proposal' };
    if (!session.participants.some((p) => p.id === characterId)) {
      return { ok: false, reason: 'not-member' };
    }
    vote.approved.add(characterId);
    this.#emitEndVote(session);
    this.#settleEndVote(session);
    return { ok: true };
  }

  /**
   * Recusa a proposta em curso (#432): qualquer membro presente (ou o próprio líder) derruba a
   * votação. Como uma recusa impede o "sim de todos", a proposta morre agora e a sessão segue
   * exatamente como estava — o mesmo desfecho de expirar, sem esperar a janela.
   */
  cancelEnd(session: Session, byCharacterId: string): PartyEndVoteResult {
    if (this.#endVote === null) return { ok: false, reason: 'no-proposal' };
    if (!session.participants.some((p) => p.id === byCharacterId)) {
      return { ok: false, reason: 'not-member' };
    }
    this.#clearEndVote(session);
    return { ok: true };
  }

  /**
   * O estado da votação para quem reconecta (#432). `undefined` sem party — não há votação
   * fora de party. O getter é PURO (sem `emit`), como `partySummary`: o host o chama no attach.
   */
  endVoteState(): { active: boolean; proposedAtMs: number; approved: readonly string[] } | undefined {
    if (this.#party === undefined) return undefined;
    const vote = this.#endVote;
    return {
      active: vote !== null,
      proposedAtMs: vote?.proposedAtMs ?? 0,
      approved: vote === null ? [] : [...vote.approved],
    };
  }

  #emitEndVote(session: Session): void {
    if (this.#party === undefined) return;
    const vote = this.#endVote;
    session.emit({
      kind: 'party-end-vote',
      active: vote !== null,
      proposedAtMs: vote?.proposedAtMs ?? 0,
      approved: vote === null ? [] : [...vote.approved],
    });
  }

  /** Derruba a votação e avisa; o vencimento agendado morre com ela. */
  #clearEndVote(session: Session): void {
    session.cancelEvent(END_VOTE_EXPIRE, END_VOTE_SUBJECT);
    this.#endVote = null;
    this.#emitEndVote(session);
  }

  /**
   * Encerra se TODOS os presentes já aprovaram. É o único ponto que decide "o sim de todos": a
   * aprovação, a entrada e a saída passam por aqui, e a comparação é contra os presentes AGORA —
   * quem saiu deixa de contar (ver `onLeave`).
   */
  #settleEndVote(session: Session): void {
    const vote = this.#endVote;
    if (vote === null) return;
    if (session.participants.some((p) => !vote.approved.has(p.id))) return;
    session.cancelEvent(END_VOTE_EXPIRE, END_VOTE_SUBJECT);
    this.#endVote = null;
    this.#emitEndVote(session);
    session.end('party-vote');
  }

  #onEndVoteExpire(session: Session): void {
    // Sem votação é um vencimento órfão (re-propor cancela o anterior): ignorar é a degradação
    // certa, e é o que mantém a fila de uma sessão retomada inofensiva.
    if (this.#endVote === null) return;
    this.#endVote = null;
    this.#emitEndVote(session);
  }

  /**
   * O premium de quem entrou DEPOIS da construção da sessão (#397). `#394` grava
   * `premiumByCharacter` na criação; isto é o único jeito de escrevê-lo para um joiner — sem
   * checagem de líder, porque premium é fato sobre o PRÓPRIO personagem, não configuração da
   * party. Ausência de party é no-op: solo não tem `premiumByCharacter`.
   */
  setMemberPremium(session: Session, characterId: string, premium: boolean): void {
    if (this.#party === undefined) return;
    this.#party = {
      ...this.#party,
      premiumByCharacter: { ...this.#party.premiumByCharacter, [characterId]: premium },
    };
  }

  /**
   * O bloco PARTY dos Detalhes da Caçada (§32, ADR 0035 decisão 11). Getter PURO, sem `emit()`:
   * o host o chama por ciclo, como `partySpendingPreview` (DT-03). `undefined` fora de party.
   *
   * `autoSell.limit` é o do PERSONAGEM líder (D3): o conteúdo manda os números, a sessão só lê.
   * `autoSell.configured` é quantos ids o líder guardou — a aplicação de fato é do #395.
   */
  partySummary(session: Session): PartySummary | undefined {
    const party = this.#party;
    if (party === undefined) return undefined;
    const present = session.participants.map((p) => ({ id: p.id, vocationId: this.#vocationOf(p)?.id ?? null }));
    const unique = uniqueVocations(present);
    // `sharedExperiencePercent` (party.ts) é a MESMA fórmula do Canary que `xpShare` usa ao
    // pagar de verdade — ler qualquer outra conta aqui divergiria do que a party realmente
    // recebe (§525).
    const percent = sharedExperiencePercent(present);
    const value = this.#bag === null ? 0 : bagValue(this.#bag, this.#options.items);
    // O conteúdo sempre preenche (`partySchema` transforma com `{ free: 5, premium: 20 }`); o
    // tipo é opcional por causa das fixtures antigas de `RawContent`.
    const limit = autoSellLimit(
      party.premiumByCharacter, party.leaderId, this.#options.party.autoSellItemTypes,
    );
    return {
      leaderId: party.leaderId,
      shareCosts: party.shareCosts,
      splitLoot: party.splitLoot,
      members: session.participants.map((p) => p.id),
      uniqueVocations: unique,
      xpPoolPercent: percent,
      bagValue: value,
      bagWeight: this.#bagWeight,
      autoSell: { configured: party.autoSell.length, limit },
    };
  }

  /** O índice na rota do PRIMEIRO participante (#203) — o solo de sempre; `-1` sem ninguém. */
  get routeIndex(): number {
    const first = this.#runners.values().next().value as Runner | undefined;
    return first?.walker.index ?? -1;
  }

  /** O índice na rota de um participante, para quem tem o id. */
  routeIndexOf(characterId: string): number {
    return this.#runners.get(characterId)?.walker.index ?? -1;
  }

  /**
   * 10 Hz anexada, 1 Hz desanexada (ADR 0003).
   *
   * A conta fecha porque nada aqui é escrito por tick (invariante 2): o resultado a 1 Hz é o
   * mesmo que a 10 Hz, e o que se perde ao desanexar é só a suavidade do que ninguém está
   * vendo. É esta linha que torna milhares de hunts simultâneas pagáveis.
   */
  hz(attached: boolean): number {
    return attached ? 10 : 1;
  }

  onEnter(session: Session, character: CharacterRuntime): void {
    // Recusa o (maxMembers + 1)-ésimo (§22, #397) ANTES de qualquer efeito colateral — criar o
    // runner, resetar a ocupação do mundo — para que a reversão em `Session.enter` não precise
    // desfazer nada além do próprio push. `character` já está em `session.participants`
    // (empurrado por `Session.enter` antes de chamar `onEnter`): por isso o teste é `>`, não
    // `>=`, contra o limite do CONTEÚDO da party (#392), não um valor fixo da issue.
    if (this.#party !== undefined && session.participants.length > this.#options.party.maxMembers) {
      throw new PartyFullError(this.#options.hunt.id, this.#options.party.maxMembers);
    }
    // Um `Runner` por participante (#203): o caminhante, o bot e o resto do que era campo da
    // classe quando a hunt hospedava um só. O bot é o DELE — por id, ou o da opção solo para
    // o primeiro a entrar.
    const config = this.#options.botConfigs?.[character.id]
      ?? (this.#runners.size === 0 ? this.#options.botConfig : undefined);
    const runner = this.#newRunner(config, undefined, character);
    this.#runners.set(character.id, runner);
    // A colocação passa pela MESMA legalidade que um passo (FUN-69). O primeiro tile da rota
    // é validado no carregamento do conteúdo (FUN-9), então uma recusa aqui é conteúdo
    // quebrado — e falhar alto é melhor que entrar dentro de uma parede.
    // A ocupação nasce com quem JÁ está no mundo desta instância — e o personagem que está
    // entrando não está. A posição que ele traz é da sessão anterior, num mapa que não é
    // este; contá-la aqui marcaria como ocupado um tile da hunt por uma coordenada de
    // cidade. Antes da FUN-72 isso era limpo por acidente, porque `place` liberava a origem.
    this.#world.reset(session.participants.filter((p) => p !== character));
    // Velocidade e capacidade vêm da tabela, como `maxHealth` — e são repostas na entrada
    // porque snapshot anterior traz zero: zero é "não carrega nada" e "não anda" (FUN-119).
    // A velocidade soma o bônus de equipamento (#524: boots of haste) — o item já está no
    // inventário do personagem neste ponto (veio do ticket/snapshot), e é por isso que somar
    // aqui, e não depois, dá o mesmo resultado de quem calçou a bota ANTES de entrar na hunt.
    const stats = statsForLevel(
      character.level, this.#vocationOf(character), this.#options.progression,
    );
    character.speed = stats.speed + character.inventory.speedBonus(this.#options.items);
    if (character.capacity <= 0) character.capacity = stats.capacity;
    // Os containers ganham os tamanhos iniciais aqui (#160) — é onde o conteúdo existe, e é o
    // que migra um snapshot anterior sem bump: nunca encolhe.
    character.inventory.ensureContainers(this.#containerRules(character));
    // Instala o observer e agenda o vencimento do que já está vestido (ADR 0032 d.8): a
    // entrada fresca não passa por `equip`, e o anel que já vinha do ticket precisa vencer.
    this.#armEquipment(session, character);
    // As condições que o personagem TRAZ de outra sessão (#812): `Session.enter` já as traduziu
    // para o relógio desta, mas o vencimento e o próximo tique moravam na fila da anterior.
    this.#armConditions(session, character);
    // O primeiro entra NO tile inicial da rota; o segundo em diante, no livre mais próximo —
    // tile é exclusivo, e o `rejoinNearest` do primeiro passo o põe na rota (#203).
    const at = runner.walker.current;
    const refused = this.#runners.size === 1
      ? place(this.#world, character, at)
      : placeNear(this.#world, character, at, ENTRY_RADIUS);
    if (refused !== null) {
      throw new Error(
        `não dá para entrar na hunt "${this.#options.hunt.id}": o primeiro tile da rota ` +
          `(${at.x},${at.y}) foi recusado — ${refused}`,
      );
    }
    this.#occupancyStale = false;
    session.record('entered-hunt', `${this.#options.hunt.id}/${this.#options.difficulty}`);

    // A fila inicial. Tudo começa PRONTO — vencendo agora —, que é o comportamento que os
    // cooldowns tinham (FUN-25) e a razão continua a mesma: entrar numa hunt e ficar meio
    // segundo parado antes do primeiro passo é um atraso sem explicação na tela.
    const { attackIntervalMs } = this.#options.player;
    session.scheduleIn(PLAYER_STEP, 0, {
      priority: EventPriority.Movement, subject: character.id,
    });
    this.#schedulePlayerAttack(session, character.id, 0);
    if (attackIntervalMs <= 0) throw new Error('attackIntervalMs must be positive');

    const regen = this.#regenOf(character);
    // Primeiro pulso DEPOIS de `ticksMs` (#678): o contador do Canary começa em 0, e entrar na
    // hunt não é poção. `amount` zero é "não regenera", e então não há evento nenhum.
    if (regen.health.amount > 0) {
      session.scheduleIn(HEALTH_REGEN, regen.health.ticksMs, {
        priority: EventPriority.Upkeep, subject: character.id,
      });
    }
    if (regen.mana.amount > 0) {
      session.scheduleIn(MANA_REGEN, regen.mana.ticksMs, {
        priority: EventPriority.Upkeep, subject: character.id,
      });
    }

    // Spawn e regras de saída são da INSTÂNCIA, não do participante (#203): entram na fila com
    // o primeiro, e o segundo não os dobra. A população INICIAL usa `SPAWN_INITIAL`, não
    // `SPAWN` (#583, `SpawnMonster::startup` do Canary): no boot, todo ponto nasce na hora,
    // sem checar `blockable`/telegraph — essas duas regras só existem para o RESPAWN depois de
    // uma morte (`#onMonsterDied` agenda `SPAWN`, o evento gated). Sem essa distinção, um
    // monstro `blockable` nunca nasceria numa hunt pequena onde o personagem já entra à vista
    // do ponto, e um não bloqueável levaria 4200 ms mesmo na primeira vez.
    if (this.#runners.size === 1) {
      for (let slot = 0; slot < this.#spawner.slots.length; slot++) {
        session.scheduleIn(SPAWN_INITIAL, 0, { priority: EventPriority.Spawn, subject: String(slot) });
      }
      session.scheduleIn(EXIT_RULES, EXIT_RULE_INTERVAL_MS, {
        priority: EventPriority.Housekeeping,
      });
    }
    // Só grupo COM regra entra na fila (AB-07). Um personagem sem bot configurado não agenda
    // nada, e os eventos por grupo só existem para quem de fato configurou.
    this.#autoSelectTarget(session, character);
    this.#armBot(session, character.id);
    // As automações (AB-08) seguem a mesma regra: só quem habilitou alguma entra na fila.
    this.#armAutomations(session, character.id);
    // Só depois de tudo pronto (runner armado, posição válida): quem já está OLHANDO a sessão
    // precisa saber que a lotação mudou, e a bolsa precisa recalcular reserva por membro — um
    // join em curso muda `ΣB` (#396) do mesmo jeito que uma saída muda. O aviso é incondicional
    // em party (#397, DT-05): numa hunt tranquila o próximo evento de party pode nunca chegar
    // antes do fim, e os outros presentes precisam ver o novo membro agora.
    if (this.#party !== undefined) this.#emitPartyState(session);
    // `onEnter` é gatilho do §13: quem entra muda a capacidade disponível (e a reserva) dos
    // outros. Depois de tudo montado, para o participante novo já contar.
    this.#rebalanceBag(session);
  }

  /**
   * Um participante saiu de uma hunt que continua (#203, ADR 0027): desfaz o que a entrada fez.
   * O tile é liberado; o `Runner` some — os eventos dele ainda na fila vencem, não encontram o
   * personagem e não fazem nada, como os de um morto. Quem o tinha como alvo perde o alvo no
   * próximo passo, porque a mira é recalculada a cada vencimento.
   */
  onLeave(session: Session, character: CharacterRuntime): void {
    // REMONTA a ocupação no próximo evento, em vez de liberar `character.position`: numa
    // transição quem sai já pode ter sido colocado no mapa de destino, e `TileOccupancy`
    // guarda coordenada, não dono — é a armadilha da FUN-72, registrada no `onLeave` da Cidade.
    this.#occupancyStale = true;
    this.#runners.delete(character.id);
    // Quem seguia `character` para de seguir AGORA (§D10, #398). É AQUI — e não de forma lazy
    // no próximo `#holdFollow` — porque depois do `splice` de `Session.leave` morte e saída
    // manual ficam indistinguíveis por presença, e `character.alive` só é confiável antes dele.
    this.#interruptFollowersOf(session, character);
    // O observer sai com ele: a Cidade não simula, e uma closure apontando para a sessão que
    // ele deixou vazaria. O prazo do anel vestido fica guardado na instância (#689) — o evento
    // morre aqui, o restante não.
    this.#parkEquipment(session, character);
    character.inventory.setEquipmentObserver(null);
    // Os EVENTOS das condições dele saem da fila (CMB-07): o vencimento de quem já saiu não fica
    // órfão. A condição em si FICA no personagem (#812): ele a leva para a próxima sessão, que a
    // traduz para o relógio dela e reagenda — a haste de 30 s não some por uma ida à Cidade, e o
    // veneno também não. Quem morre é outro caso (`#onCharacterDied`): morto não tem condição.
    this.#cancelConditionEvents(session, character);
    // As invocações dele somem JUNTO (#598, M38-01, ADR 0057 decisão 3 — "some ao sair da
    // hunt"): mesmo `#removeSummon` que o mestre MONSTRO já usa quando morre (#546) — sem
    // golpe, sem cadáver, sem abate; nunca pagou nada enquanto viva. `filter` ANTES de remover
    // qualquer uma, pela mesma cautela da FUN-92 (`#removeSummon` troca `#monsters` a cada
    // chamada).
    for (const summon of this.#monsters.filter((m) => m.masterId === character.id)) {
      this.#removeSummon(session, summon);
    }
    // A bolsa é vendida e dividida COM quem sai (#192, ADR 0027 decisão 5): ele leva a parte
    // do que caiu enquanto estava — `Session.leave` emite o extrato dele depois disto, e é o
    // que põe o gold do settlement nele. A capacidade encolhe sem descartar nada: acima do
    // teto a bolsa só para de aceitar, até o próximo settlement zerar.
    if (this.#bag !== null) this.#settle(session, [...session.participants, character], 'leave');
    // A votação de encerrar é dos PRESENTES (#432): quem sai deixa de contar. O vencimento
    // continua correndo; se quem ficou já tinha aprovado todo, `#flushLoss` encerra — depois do
    // extrato de quem saiu, pela mesma ordem que a cascata respeita.
    if (this.#endVote !== null) this.#endVote.approved.delete(character.id);
    // A cascata do §13.9 NÃO roda aqui: `Session.leave` ainda vai emitir o extrato de quem
    // está saindo, e uma cascata dentro do `onLeave` emitiria os extratos dos outros ANTES
    // do dele — `seq` fora de ordem e o `member-left` do primeiro depois dos demais. Fica
    // pendente e roda logo depois: em `#depart` (saída decidida aqui) ou no próximo evento
    // (saída pelo socket, que o hospedeiro chama direto).
    this.#lossPending = true;
  }

  /**
   * A cascata pendente do §13.9 e a liderança por TEMPO de party (#193, D9): `participants[0]`
   * já é o mais antigo, e `leaderId` passa a ser reescrito quando o líder sai — não só lido com
   * fallback. A troca entra no extrato (`leader-changed`) e o `party-state` avisa.
   * Sem ninguém, nada a anunciar — a sessão encerra.
   */
  #flushLoss(session: Session, reason: 'death' | 'exit-rule' | 'manual-exit'): void {
    if (!this.#lossPending) return;
    this.#lossPending = false;
    const cascaded = this.#onMemberLost(session);
    if (session.participants.length === 0) {
      // O motivo é o do ÚLTIMO a sair: se a cascata levou alguém, foi a regra dele.
      if (session.ended === null) session.end(cascaded > 0 ? 'exit-rule' : reason);
      return;
    }
    const party = this.#party;
    if (party !== undefined && !session.participants.some((p) => p.id === party.leaderId)) {
      const next = session.participants[0];
      if (next !== undefined) {
        party.leaderId = next.id;
        session.record('leader-changed', next.id);
      }
    }
    this.#emitPartyState(session);
    // A saída pode ter completado o "sim de todos" (#432): quem ficou e já tinha aprovado
    // encerra agora, depois do extrato de quem saiu.
    this.#settleEndVote(session);
  }

  #emitPartyState(session: Session): void {
    if (this.#party === undefined) return;
    const leader = this.#leader(session);
    session.emit({
      kind: 'party-state',
      leaderId: leader?.id ?? this.#party.leaderId,
      members: session.participants.map((p) => ({ characterId: p.id, alive: p.alive })),
    });
  }

  /**
   * O jogador pede para sair (#802): o `leave-hunt` do socket chega aqui, e a sessão só termina
   * quando `#finishExit` concluir — depois do `exitDelayMs` e fora da janela de combate (#625).
   * Pedir de novo enquanto uma saída está pendente é ignorado, e não reinicia a contagem.
   */
  requestExit(session: Session, characterId: string): void {
    this.#beginExit(session, characterId, 'manual-exit');
  }

  /**
   * O jogador desiste da saída que pediu (#802). Devolve `true` se havia uma saída MANUAL
   * pendente e ela foi desfeita; `false` (e nada muda) se não havia nenhuma, ou se a pendente é a
   * de uma regra do bot — essa é a decisão da configuração dele, e a regra a dispararia de novo
   * no ciclo seguinte enquanto a condição valer.
   *
   * O Canary não tem "logout pendente": recusa na hora quando o personagem está em combate
   * (`RETURNVALUE_YOUMAYNOTLOGOUTDURINGAFIGHT`) e o jogador simplesmente tenta de novo depois.
   * A espera é a forma do Draconya de fazer esse "tenta de novo" pelo jogador, e cancelá-la é só
   * parar de tentar — não muda nenhuma regra de combate nem de trava.
   *
   * O `EXIT_COUNTDOWN` agendado é CANCELADO, e não apenas ignorado quando vencer: um pedido novo
   * logo depois agendaria um segundo, e o velho concluiria a saída antes da hora do novo.
   */
  cancelExit(session: Session, characterId: string): boolean {
    const runner = this.#runners.get(characterId);
    if (runner === undefined || runner.pendingExit !== 'manual-exit') return false;
    session.cancelEvent(EXIT_COUNTDOWN, characterId);
    runner.pendingExit = null;
    return true;
  }

  /** A saída pendente do personagem, ou `null` (ver `ExitStatus`). Só lê. */
  exitStatus(session: Session, characterId: string): ExitStatus | null {
    const reason = this.#runners.get(characterId)?.pendingExit ?? null;
    if (reason === null) return null;
    const lastCombatAtMs = findById(session.participants, characterId)?.lastCombatActionAtMs ?? null;
    const dueAtMs = session.dueAtOf(EXIT_COUNTDOWN, characterId) ?? session.nowMs;
    if (lastCombatAtMs !== null && isInFight(session.nowMs, lastCombatAtMs)) {
      // O evento agendado pode estar ANTES do fim da janela (um golpe novo só é relido quando ele
      // vence, `#finishExit`): o que vale para o jogador é o mais tardio dos dois.
      return {
        reason, phase: 'in-combat',
        untilMs: Math.max(dueAtMs, lastCombatAtMs + IN_FIGHT_WINDOW_MS),
      };
    }
    return { reason, phase: 'countdown', untilMs: dueAtMs };
  }

  #newRunner(
    config: BotConfigInput | undefined, state?: RunnerState, character?: CharacterRuntime,
  ): Runner {
    // A v1 é normalizada no boundary (DT-02): a config que o jogador salvou continua valendo, e
    // o motor v2 só vê o vocabulário v2. Idempotente — um snapshot v2 volta só parseado.
    const normalized = config === undefined ? undefined : migrateBotConfigV1(config);
    const bot = normalized === undefined ? undefined : compileBot(normalized, this.#cooldownOf);
    const runner: Runner = {
      walker: new RouteWalker(this.#options.route, state?.route),
      bot,
      botConfig: normalized,
      automations: compileAutomations(normalized?.automations ?? []),
      actuator: undefined,
      automationWarned: new Map(Object.entries(state?.automationWarned ?? {})),
      exitRules: this.#composeExitRules(normalized),
      pendingExit: state?.pendingExit ?? null,
      botReady: {},
      playerAttackReady: state?.playerAttackReady ?? true,
      // O snapshot guarda um alvo só (#470): `chosenTargetPinned` dizia se ele era do
      // jogador. Na memória ele vira `attackTarget` (explícito) ou `botCandidate` (auto).
      attackTarget: state?.chosenTargetPinned === true ? (state.chosenTarget ?? null) : null,
      botCandidate: state?.chosenTargetPinned === true ? null : (state?.chosenTarget ?? null),
      attackTargetPinned: state?.chosenTargetPinned === true,
      running: state?.luring ?? true,
      lureStoppedSinceMs: state?.lureStoppedSinceMs ?? null,
      lureForceWalkUntilMs: state?.lureForceWalkUntilMs ?? null,
      nudgedUntilMs: state?.nudgedUntilMs ?? null,
      crossFloorStuckSinceMs: state?.crossFloorStuckSinceMs ?? null,
      sameTileStreak: state?.sameTileStreak ?? 0,
      regroupSinceMs: state?.regroupSinceMs ?? null,
      // Cache de caminho do follow (#527) — NUNCA persiste no snapshot: é um cache de
      // desempenho puro (o BFS limitado é determinístico e barato de refazer), não um estado
      // de jogo. Uma sessão restaurada recalcula na hora se precisar; nada observa a diferença.
      followPath: null,
      followStuckSinceMs: null,
      routeBlockedWarned: false,
      ringReplaced: state?.ringReplaced ?? null,
      warnedExhausted: state?.warnedExhausted ?? false,
      warnedFullBackpack: state?.warnedFullBackpack ?? false,
      warnedNoGold: state?.warnedNoGold ?? false,
      followInterrupted: state?.followInterrupted ?? false,
      followTargetId: state?.followTargetId,
      followReason: state?.followReason,
      lastCombatActionAtMs: state?.lastCombatActionAtMs ?? null,
      manualWalkTo: state?.manualWalkTo ?? null,
      manualWalkHoldUntilMs: state?.manualWalkHoldUntilMs ?? null,
      fearWalk: state?.fearWalk ?? null,
      thinkPhaseMs: state?.thinkPhaseMs ?? null,
      attackParked: state?.attackParked === true,
    };
    // O atuador fecha sobre o PRÓPRIO runner (o `ringReplaced` das automações), então só pode
    // ser montado depois que o objeto existe — e é a razão de ele não entrar no literal.
    if (character !== undefined) runner.actuator = this.#automationActuatorFor(runner, character);
    if (bot !== undefined) {
      // Todo grupo começa ENGATILHADO. Só um snapshot v2 carrega chaves de grupo em
      // `botScheduled`; as categorias v1 (`potion`, `attack`, `support`) colidiriam com nomes
      // de grupo, e o motor v2 as re-engatilha — a fila restaurada de um snapshot v1 traz
      // `bot-<categoria>`, que o motor v2 ignora.
      for (const group of bot.groups.keys()) runner.botReady[group] = true;
      if (state?.botConfig?.version === BOT_VOCABULARY_VERSION) {
        for (const group of state.botScheduled) {
          if (runner.botReady[group] !== undefined) runner.botReady[group] = false;
        }
      }
    }
    return runner;
  }

  /** O `Runner` de um participante presente. Lançar é certo: evento de quem saiu é filtrado antes. */
  #runnerOf(characterId: string): Runner {
    const runner = this.#runners.get(characterId);
    if (runner === undefined) throw new Error(`no runner for character ${characterId}`);
    return runner;
  }

  /**
   * Um evento venceu. `session.nowMs` é o instante exato do vencimento.
   *
   * Não existe mais ordem de fases: a ordem entre eventos que vencem no mesmo instante é a
   * prioridade deles (`EventPriority`), que reproduz a ordem que o `onTick` executava.
   */
  onEvent(session: Session, event: ScheduledEvent): void {
    if (this.#occupancyStale) this.#rebuildOccupancy(session);
    // Saída pelo socket (#193): a cascata roda no primeiro evento depois dela.
    this.#flushLoss(session, 'manual-exit');
    this.#burnStamina(session);

    switch (event.kind) {
      case PLAYER_STEP: return this.#onPlayerStep(session, event.subject);
      case PLAYER_ATTACK: return this.#onPlayerAttack(session, event.subject);
      case MONSTER_STEP: return this.#onMonsterStep(session, event.subject);
      case MONSTER_ATTACK: return this.#onMonsterAttack(session, event.subject);
      case MONSTER_ABILITY: return this.#onMonsterAbility(session, event.subject);
      case MONSTER_DEFENSE: return this.#onMonsterDefense(session, event.subject);
      case MONSTER_SUMMON: return this.#onMonsterSummon(session, event.subject);
      case MONSTER_TARGET_CHANGE: return this.#onMonsterTargetChange(session, event.subject);
      case MONSTER_DANCE: return this.#onMonsterDance(session, event.subject);
      case HEALTH_REGEN: return this.#onRegen(session, event.subject, 'health');
      case MANA_REGEN: return this.#onRegen(session, event.subject, 'mana');
      case SPAWN_INITIAL: return this.#onSpawnInitial(session, event.subject);
      case PENDING_MANUAL_ACTION: return this.#onPendingManualAction(session, event.subject);
      case SPAWN: return this.#onSpawn(session, event.subject);
      case SPAWN_MATERIALIZE: return this.#onSpawnMaterialize(session, event.subject);
      case CORPSE: return this.#onCorpseDecay(session, event.subject);
      case TILE_REVERT: return this.#onTileRevert(session, event.subject);
      case EXIT_RULES: return this.#onExitRules(session);
      case EXIT_COUNTDOWN: return this.#onExitCountdown(session, event.subject);
      case END_VOTE_EXPIRE: return this.#onEndVoteExpire(session);
      case CONDITION_TICK: return this.#onConditionTick(session, event.subject);
      case CONDITION_EXPIRE: return this.#onConditionExpire(session, event.subject);
      case VISIBILITY_THINK: return this.#onVisibilityThink(session, event.subject);
      case FEAR_THINK: return this.#onFearThink(session, event.subject);
      case ATTACK_THINK: return this.#onAttackThink(session, event.subject);
      case FIELD_STAGE_ADVANCE: return this.#onFieldStageAdvance(session, event.subject);
      case FIELD_TICK: return this.#onFieldTick(session, event.subject);
      case FIELD_EXPIRE: return this.#onFieldExpire(session, event.subject);
      case EQUIP_EXPIRE: return this.#onEquipExpire(session, event.subject);
      case ITEM_REGEN: return this.#onItemRegen(session, event.subject);
      case AUTOMATION: return this.#onAutomation(session, event.subject);
      default:
        // Um grupo do bot venceu (AB-07): `bot:<group>`. Um evento de tipo que este ruleset não
        // conhece — inclusive `bot-<categoria>` de um snapshot v1 — é ignorado, que é a
        // degradação certa.
        if (event.kind.startsWith(BOT_GROUP_PREFIX)) {
          return this.#onBot(session, event.kind.slice(BOT_GROUP_PREFIX.length), event.subject);
        }
        return;
    }
  }

  /**
   * Stamina cai 1:1 com o tempo de hunt, e zerar NÃO encerra nada (§10.2). É a regra que mais
   * parece bug para quem implementa, e a que mais precisa ser respeitada: o personagem
   * continua caçando, matando e apanhando — só para de ganhar XP.
   *
   * Cobrada pelo tempo LÓGICO decorrido desde a última cobrança, e não por um evento próprio:
   * é uma grandeza contínua, e um evento periódico daria a ela uma granularidade que ela não
   * tem. Assim a conta é exata em qualquer cadência, e o custo é uma subtração.
   */
  #burnStamina(session: Session): void {
    const dtMs = session.nowMs - this.#staminaAnchorMs;
    if (dtMs <= 0) return;
    this.#staminaAnchorMs = session.nowMs;
    for (const character of session.participants) {
      if (!character.alive) continue;
      const exhausted = drainStamina(character, dtMs, this.#options.stamina);
      // A comida drena pelo MESMO tempo de hunt decorrido (#726) — nunca por tick, e sem
      // relógio próprio: é o mesmo argumento de `drainStamina`, e reaproveitar o `dtMs` já
      // calculado aqui evita um segundo acumulador para a mesma grandeza contínua.
      drainFedMs(character, dtMs);
      const runner = this.#runners.get(character.id);
      if (!exhausted || runner === undefined || runner.warnedExhausted) continue;
      runner.warnedExhausted = true;
      // Vale a linha no extrato: daqui para a frente a hunt queima supply sem gerar nada, e
      // descobrir isso só pelo gold que sumiu é como o modo idle perde a confiança de quem
      // deixou o personagem rendendo.
      session.record('stamina-exhausted', character.id);
    }
  }

  /**
   * Regeneração passiva (FUN-36): um PULSO por vencimento (#678) — `amount` pontos a cada
   * `ticksMs`, como a `ConditionRegeneration` do Canary (`condition.cpp`), que soma o intervalo
   * num contador e, ao passar de `ticks`, aplica o `amount` de uma vez.
   *
   * Vale mesmo com stamina zerada: regenerar não é recompensa, é sobrevivência — e o §10.2 é
   * explícito que o personagem continua podendo morrer, não que ele passa a morrer mais
   * rápido.
   *
   * Morto não regenera, e o evento morre com ele. Sem isso, um personagem que caiu voltaria
   * sozinho na hunt em que morreu, e a morte deixaria de encerrar coisa nenhuma.
   */
  #onRegen(session: Session, characterId: string, what: 'health' | 'mana'): void {
    const character = findById(session.participants, characterId);
    if (character === null || !character.alive) return;

    const pulse = this.#regenOf(character)[what];
    if (pulse.amount <= 0) return;
    // A flag de conteúdo (#726, ADR 0049 decisão 5, emenda ao ADR 0043): default `false`
    // preserva o Huntera ("regenera sempre em hunt"); ligada, exige `fedMs > 0` — a
    // `CONDITION_REGENERATION` do Tibia, dada por comida. Sem comida, o pulso NÃO aplica nada
    // desta vez, mas CONTINUA reagendando — a flag pode ligar no meio da hunt sem reconstruir a
    // fila, e comer no meio do jejum é atendido no PRÓXIMO vencimento, sem precisar de evento
    // novo (o `amount <= 0` acima é o único caso em que o evento de fato morre).
    const requiresFood = this.#options.progression.regeneration?.requiresFood ?? false;
    if (requiresFood && character.fedMs <= 0) {
      session.scheduleIn(what === 'health' ? HEALTH_REGEN : MANA_REGEN, pulse.ticksMs, {
        priority: EventPriority.Upkeep, subject: characterId,
      });
      return;
    }
    // Só a vocação: o Life Ring regenera pelos PRÓPRIOS eventos (`ITEM_REGEN`, #688), somados
    // a este pulso, e nunca o multiplica.
    const { amount } = pulse;

    if (what === 'health') {
      // Só a barra, sem `creature-healed` (FUN-109): um "+1" flutuando por segundo a hunt
      // inteira é ruído, mas a barra precisa andar. E só quando REPÔS — de vida cheia, nada
      // mudou, e um evento por segundo para dizer isso é o que uma hunt desanexada de oito
      // horas não precisa produzir.
      if (character.heal(amount) > 0) this.#emitCharacterHealth(session, character);
    } else {
      character.mana = Math.min(character.maxMana, character.mana + amount);
    }

    // O próximo pulso vence em `ticksMs` inteiros — nada de acumulador fracionário nem de
    // `1000 / taxa` em ponto flutuante. Relê a vocação de AGORA (promoção, #566), como o
    // `updateRegeneration` do Canary. Com o recurso cheio o pulso se perde, e o próximo segue
    // agendado — o Canary também zera o contador.
    session.scheduleIn(what === 'health' ? HEALTH_REGEN : MANA_REGEN, pulse.ticksMs, {
      priority: EventPriority.Upkeep, subject: characterId,
    });
  }

  /**
   * Uma criatura morreu (FUN-63): a CONSEQUÊNCIA de hunt. O pipeline já congelou os eventos
   * dela e já resolveu quem matou — aqui só se decide o que isso significa numa hunt.
   */
  onCreatureDied(session: Session, victim: Victim, credit: KillCredit): void {
    if (victim.kind === 'character') this.#onCharacterDied(session, victim.character);
    else this.#onMonsterDied(session, victim.monster, credit);
  }

  #onCharacterDied(session: Session, character: CharacterRuntime): void {
    this.#world.vacate(character.position.x, character.position.y);
    // Morto não tem condição: cancelar aqui impede o vencimento de uma condição dele ficar
    // na fila até o fim da sessão (CMB-07).
    this.#cancelConditions(session, character);

    // A penalidade sai AQUI, na morte, e não no encerramento: quem morre paga, e uma hunt que
    // termina por saída manual ou por regra não custa XP nenhuma (§26.2). A contagem de
    // bênçãos (#570) é do PERSONAGEM morto — bênção é comprada por personagem, nunca por
    // sessão/party, ao contrário do antigo `premium` binário que este parâmetro substituiu.
    const blessings = blessingCount(character.blessings);
    // A perda de ITEM (#571, ADR 0042 decisão 4) vem ANTES da penalidade e do consumo das bênçãos,
    // como no Canary (`Creature::onDeath` chama `dropCorpse` antes de `death()`): a chance lê a
    // contagem de bênçãos de ANTES de a morte as consumir, e o Amulet of Loss protege antes de ser
    // gasto. O sorteio é do `Rng` da sessão, um por item vestido. Desligada (conteúdo real hoje —
    // decisão do dono em aberto, ver `itemLossSchema`) não toca em item nenhum.
    this.#recordItemLoss(session, character, loseItemsOnDeath(character, {
      progression: this.#options.progression,
      items: this.#options.items,
      blessings,
      rng: session.rng,
      newInstanceId: () => this.#newInstanceId(session, character),
    }));
    // O charm Bless (#603, `Player::death`, `player.cpp:4085-4098`): se o ÚLTIMO golpe foi de um
    // monstro ao qual o personagem atribuiu o charm, a perda cai `chance[tier]/100` por cima do que
    // bênção e promoção já reduziram. O último golpe é o `lastHitBy` da atribuição do morto.
    const charmBlessReduction = this.#charmBlessReductionOf(character);
    // Promovido (#566, ADR 0042 decisão 1) soma os 30% adicionais de redução, aditivos, nunca
    // tetados — ver o comentário de `promotionReduction` em `progression.ts`.
    const penalty = applyDeathPenalty(
      character,
      {
        blessings, promoted: character.promoted,
        ...(charmBlessReduction === undefined ? {} : { charmBlessReduction }),
      },
      this.#vocationOf(character),
      this.#options.progression,
      this.#options.skills,
    );
    // Morrer CONSOME todas as bênçãos de uma vez (#570, `Player::death` do Canary) — nunca uma
    // de cada vez, e nunca proporcional à perda. Depois daqui `character.blessings` é `0`
    // até a próxima compra na Cidade.
    if (blessings > 0) {
      character.blessings = 0;
      session.record('blessings-consumed', String(blessings));
    }
    if (penalty.xpLost > 0) {
      // Entra no agregado como perda: o extrato é o que vira linha de ledger, e creditar a XP
      // ganha sem descontar a perdida daria ao jogador uma XP que ele não tem.
      session.credit(character.id, 'xpGained', -penalty.xpLost);
      session.record('xp-penalty', String(penalty.xpLost));
    }
    if (penalty.levelChange !== null) {
      session.record('level-down', `${penalty.levelChange.from} → ${penalty.levelChange.to}`);
      // Descer de level reescreve `maxHealth` pela tabela (`retarget`), e a barra é anunciada
      // de TODO lugar que a escreve (FUN-109). A vida é zero — ele morreu —, mas o máximo
      // mudou, e o cliente que só recebeu o golpe fatal ficaria com um "0 / máximo do level
      // antigo" até a reanexação.
      this.#emitCharacterHealth(session, character);
    }
    // Skill (magic inclusive — é ela quem carrega a perda de mana gasta, ver `DeathPenalty` em
    // `progression.ts`) que perdeu tries: um registro por skill afetada (#569).
    for (const loss of penalty.skillLosses) {
      session.record('skill-penalty', `${loss.skillId}/${String(loss.triesLost)}`);
      if (loss.levelChange !== null) {
        session.record('skill-down', `${loss.skillId}/${loss.levelChange.from} → ${loss.levelChange.to}`);
      }
    }
    // O Amulet of Loss é gasto DEPOIS da penalidade (#571): no Canary a conferência do colar lê o
    // level já rebaixado (`willNotLoseBless`), e o colar vestido se consome mesmo sem ter tido o
    // que proteger.
    const spentAmulet = consumeLossAmulet(character, {
      progression: this.#options.progression, items: this.#options.items,
    });
    if (spentAmulet !== null) session.record('loss-amulet-consumed', spentAmulet.itemId);

    // Solo — ou party que virou solo —: a morte encerra a sessão (§26.1), como sempre. Em party
    // (#193, ADR 0027 decisão 7) o morto SAI com o próprio extrato — penalidade dentro, e a
    // cota do settlement (`onLeave`) — e a sessão continua para os outros.
    if (session.participants.length <= 1) {
      session.end('death');
      return;
    }
    this.#depart(session, character.id, 'death');
  }

  /**
   * A redução que o charm Bless dá à penalidade de morte de `character` (#603): `chance[tier] /
   * 100` quando o último golpe foi de um monstro ao qual ele o atribuiu, senão `undefined`. O
   * monstro que matou ainda está vivo e indexado aqui — a morte do personagem é resolvida no
   * mesmo evento do golpe.
   */
  #charmBlessReductionOf(character: CharacterRuntime): number | undefined {
    const lastHit = character.contribution.lastHitBy;
    if (lastHit === null) return undefined;
    const killer = this.#monsterBySubject.get(lastHit);
    if (killer === undefined) return undefined;
    const assigned = this.#charmsAgainst(character, killer.monsterId);
    const bless = assigned === undefined ? undefined : findAssigned(assigned, 'bless');
    return bless === undefined ? undefined : charmChance(bless) / 100;
  }

  /**
   * O que a perda de item da morte deixou no extrato (#571): um evento por instância destruída —
   * é ele que vira `ledger.ref.notableEvents` e a lista da tela de morte —, mais a proteção que
   * evitou o sorteio e a mochila de reposição. O `detail` de `item-lost-on-death` é
   * `itemId/quantidade/instanceId/characterId`: o dono vai junto porque em party as linhas dos
   * membros compartilham a mesma lista (`Session.notableEvents`), e o `instanceId` é o que liga a
   * linha à instância apagada de `item_instance` (`removedInstances`).
   */
  #recordItemLoss(session: Session, character: CharacterRuntime, outcome: ItemLossOutcome): void {
    for (const { item } of outcome.lost) {
      session.record(
        'item-lost-on-death',
        `${item.itemId}/${String(item.quantity)}/${item.instanceId}/${character.id}`,
      );
    }
    if (outcome.protectedBy === 'amulet') {
      const amulet = character.inventory.equippedAt('neck');
      session.record('item-loss-protected', amulet?.itemId ?? 'amulet');
    } else if (outcome.protectedBy === 'blessings') {
      session.record('item-loss-protected', 'blessings');
    }
    if (outcome.replacement !== null) session.record('backpack-replaced', outcome.replacement.itemId);
  }

  /**
   * O id de uma instância NOVA criada por esta sessão para o personagem (`lootSeq`): o prefixo
   * `${session.id}:` é o que `acquiredBy` filtra para virar linha de `item_instance`, e em party
   * o id leva o dono no meio — dois membros com `lootSeq` 0 colidiriam. Mesmo formato de
   * `#instantiateCorpseItems` e `#useChest`; o critério é o TIPO de sessão, não a contagem.
   */
  #newInstanceId(session: Session, character: CharacterRuntime): string {
    return this.#party !== undefined
      ? `${session.id}:${character.id}:${String(character.lootSeq++)}`
      : `${session.id}:${String(character.lootSeq++)}`;
  }

  /**
   * Um membro sai por decisão do ruleset — morte ou regra de saída (#193): `leave` emite o
   * extrato dele, e o hospedeiro recebe `member-left` com o extrato e o personagem, porque não
   * foi ele quem chamou. O último a sair encerra a sessão com o motivo dele.
   */
  #depart(session: Session, characterId: string, reason: 'death' | ExitReason): void {
    const departure = session.leave(characterId, reason);
    if (departure === null) return;
    session.emit({ kind: 'member-left', characterId, reason, departure });
    this.#flushLoss(session, reason);
  }

  /**
   * Alguém saiu: quem tem a regra `party-member-lost` sai também (§13.9), em cascata e na
   * ordem de entrada. A lista é copiada porque cada `leave` a muda no meio do laço — iterar
   * a viva pularia um membro. O próprio que saiu não está mais nela, por construção.
   */
  #onMemberLost(session: Session): number {
    let cascaded = 0;
    for (const member of [...session.participants]) {
      const runner = this.#runners.get(member.id);
      if (runner === undefined) continue;
      if (!runner.exitRules.some((rule) => rule.id === 'party-member-lost')) continue;
      session.record('exit-rule', 'party-member-lost');
      const departure = session.leave(member.id, 'exit-rule');
      if (departure === null) continue;
      // O `onLeave` deste marcou pendência de novo; a cascata É este laço, então a limpa.
      this.#lossPending = false;
      session.emit({ kind: 'member-left', characterId: member.id, reason: 'exit-rule', departure });
      cascaded += 1;
    }
    return cascaded;
  }

  onEnd(session: Session, _reason: EndReason): void {
    // O observer morre com a sessão: os eventos dele não vão mais vencer, e a closure não pode
    // segurar uma sessão encerrada.
    for (const character of session.participants) {
      this.#parkEquipment(session, character);
      character.inventory.setEquipmentObserver(null);
    }
    // A bolsa é vendida e dividida entre os presentes (#192); os extratos saem DEPOIS disto,
    // com o gold dentro. Fora isso nada a desfazer: a instância morre com a sessão. Todo
    // encerramento produz extrato, inclusive o que acontece sem ninguém assistindo — e é
    // exatamente por isso que ele não depende de nada feito aqui.
    if (this.#bag !== null) this.#settle(session, session.participants, 'end');
  }

  getState(): HuntRulesetState {
    const runners: Record<string, RunnerState> = {};
    for (const [id, runner] of this.#runners) runners[id] = runnerState(runner);
    // Os campos soltos são os do PRIMEIRO runner (#203, DT-02): um nó anterior lendo este
    // snapshot continua funcionando para o solo. Sem runner nenhum — sessão restaurada antes
    // de `onResume`? não acontece; sessão vazia —, saem os defaults.
    const first = this.#runners.values().next().value as Runner | undefined;
    const solo = first === undefined
      ? this.#newRunner(this.#options.botConfig)
      : first;
    const state = runnerState(solo);
    return {
      huntId: this.#options.hunt.id,
      difficulty: this.#options.difficulty,
      ...(this.#options.boostedMonsterId === undefined
        ? {}
        : { boostedMonsterId: this.#options.boostedMonsterId }),
      route: state.route,
      spawner: this.#spawner.getState(),
      pendingSpawns: [...this.#pendingSpawns].map(([slot, p]) => ({ slot, ...p })),
      monsters: this.#monsters.map((m) => m.getState()),
      nextCreatureId: this.#nextCreatureId,
      corpses: [...this.#corpses],
      fields: this.#fields.getState(),
      tileOverrides: this.#tileOverrides.getState(),
      nextGroundItemId: this.#nextGroundItemId,
      warnedExhausted: state.warnedExhausted,
      warnedFullBackpack: state.warnedFullBackpack,
      warnedNoGold: state.warnedNoGold,
      staminaAnchorMs: this.#staminaAnchorMs,
      playerAttackReady: state.playerAttackReady,
      botScheduled: [...state.botScheduled],
      luring: state.luring,
      ringReplaced: state.ringReplaced,
      ...(state.botConfig === undefined ? {} : { botConfig: state.botConfig }),
      runners,
      // Sempre no formato NOVO (achatado). O campo continua opcional e sem bump: um nó antigo
      // que leia `partyOptions.mode`/`shareCosts`/`splitLoot` ainda encontra os três.
      ...(this.#party === undefined ? {} : {
        partyOptions: {
          leaderId: this.#party.leaderId,
          mode: this.#party.mode,
          shareCosts: this.#party.shareCosts,
          splitLoot: this.#party.splitLoot,
          collect: this.#party.collect,
          autoSell: this.#party.autoSell,
          premiumByCharacter: this.#party.premiumByCharacter,
        },
      }),
      ...(this.#bag === null ? {} : {
        partyBag: {
          gold: [...this.#bag.gold],
          items: this.#bag.items.map((entry) => ({ item: entry.item, eligible: [...entry.eligible] })),
          capacity: this.#bag.capacity,
          overweight: this.#bag.overweight,
        },
      }),
      ...(this.#endVote === null ? {} : {
        endVote: {
          proposedAtMs: this.#endVote.proposedAtMs,
          approved: [...this.#endVote.approved],
        },
      }),
    };
  }

  /**
   * Depois do `restore`, com os participantes de pé: os `Runner`s são casados com eles aqui
   * (#203) — por id quando o snapshot os tem, ou o legado de um dono só para o único que há.
   * Um snapshot anterior a #160 traz a lista plana: os containers ganham os tamanhos aqui.
   */
  onResume(session: Session): void {
    const pending = this.#pendingRunners;
    this.#pendingRunners = null;
    for (const character of session.participants) {
      character.inventory.ensureContainers(this.#containerRules(character));
      // SÓ reinstala o observer (ADR 0032 d.8): a fila restaurada já tem o `EQUIP_EXPIRE`, e
      // reagendar aqui duplicaria o evento e o item venceria cedo. Snapshot anterior sem o
      // evento é degradação declarada — o item só volta a vencer quando for reequipado.
      character.inventory.setEquipmentObserver(this.#equipmentObserver(session, character.id));
      if (this.#runners.has(character.id)) continue;
      const state = pending?.byId?.[character.id]
        ?? (pending?.byId === null && session.participants.length === 1 ? pending.legacy : null)
        ?? null;
      // A configuração volta CRUA e é recompilada (FUN-81). Sem isto, uma hunt retomada roda
      // sem bot: continua andando e matando com o ataque básico, então nada PARECE quebrado —
      // o que some é a cura, e o jogador descobre pelo personagem morto. As regras de SAÍDA
      // vêm junto, pela mesma razão.
      this.#runners.set(character.id, this.#newRunner(state?.botConfig, state ?? undefined, character));
      // O mundo mudou enquanto a sessão estava parada: o que estava ENGATILHADO reavalia agora.
      // O que estava AGENDADO tem evento na fila restaurada e `#armBot` o pula — nunca os dois.
      if (character.alive) {
        this.#autoSelectTarget(session, character);
        this.#armBot(session, character.id);
      }
    }
    // A reserva é DERIVADA e não vai no snapshot (DT-02): o primeiro rebalanceamento depois de
    // retomar sai daqui, quando os participantes já existem. Chamá-lo em `restore` quebraria
    // porque lá `session.participants` ainda está vazio.
    if (this.#bag !== null) this.#rebalanceBag(session);
  }

  restore(state: unknown): void {
    const restored = state as HuntRulesetState;
    // A hunt é a IDENTIDADE da instância. Restaurar o estado de uma hunt dentro de outra
    // produziria monstros de um mapa andando em outro. A dificuldade DEIXOU de ser parte dessa
    // identidade (#583, ADR 0039): ela não seleciona mais nada no conteúdo, e comparar o campo
    // ignorado recusaria uma retomada legítima só porque o cliente mandou outro texto.
    if (restored.huntId !== this.#options.hunt.id) {
      throw new Error(
        `snapshot é de "${restored.huntId}", mas este ruleset é de "${this.#options.hunt.id}"`,
      );
    }
    this.#spawner = new Spawner(this.#options.route.spawnPoints.length, restored.spawner);
    this.#pendingSpawns = new Map(
      (restored.pendingSpawns ?? []).map((p) => [p.slot, { monsterId: p.monsterId, position: p.position }]),
    );
    this.#monsters = restored.monsters.map((m) => new MonsterRuntime(m));
    // Snapshot anterior à FUN-119 não traz a velocidade; ela é do conteúdo, e repor daqui é
    // o que impede um monstro restaurado de andar com velocidade zero.
    for (const monster of this.#monsters) {
      if (monster.speed > 0) continue;
      monster.speed = this.#options.monsters.get(monster.monsterId)?.speed ?? 0;
    }
    this.#monsterBySubject.clear();
    for (const monster of this.#monsters) {
      this.#monsterBySubject.set(monsterSubject(monster.id), monster);
    }
    this.#nextCreatureId = restored.nextCreatureId;
    // Os cadáveres voltam com o snapshot; o prazo de cada um é o evento `CORPSE`, que a fila
    // da sessão já trouxe de volta (FUN-123). O loot (ADR 0048) é OPCIONAL na leitura: snapshot
    // de antes deste ADR não tem as quatro chaves, e ausente é cadáver sem loot nenhum.
    this.#corpses = (restored.corpses ?? []).map((corpse) => ({
      ...corpse,
      items: [...(corpse.items ?? [])],
      gold: corpse.gold ?? 0,
      ownerId: corpse.ownerId ?? null,
      eligible: corpse.eligible ?? [],
    }));
    // Os campos voltam indexados por tile (CMB-07); os eventos de tique, avanço de estágio e
    // vencimento já vêm na fila serializada. Ausente é nenhum — snapshot anterior a esta issue.
    // MUTAÇÃO, não substituição (#560, o mesmo motivo de `#tileOverrides` duas linhas abaixo):
    // `TileOccupancy.fields` já referencia esta MESMA instância desde o construtor.
    this.#fields.restoreState(restored.fields);
    // MUTAÇÃO, não substituição (#728): `TileOccupancy.overrides` já referencia esta MESMA
    // instância desde o construtor — trocar `this.#tileOverrides` deixaria o mundo lendo um
    // objeto velho, sempre no estado inicial do conteúdo. Ausente é "nenhuma sessão anterior
    // mexeu em nada", que já é o que `TileOverrides.fromInteractables` produziu na construção.
    this.#tileOverrides.restoreState(restored.tileOverrides);
    this.#nextGroundItemId = restored.nextGroundItemId ?? 1;
    this.#staminaAnchorMs = restored.staminaAnchorMs;
    // Migração na LEITURA (DT-02): snapshot antigo traz `{mode}`, o novo traz os eixos. Sem bump.
    this.#party = normalizePartyOptions(restored.partyOptions);
    // A votação de encerrar volta com quem já aprovou (#432); o vencimento já está na fila do
    // snapshot. Ausente é nenhuma votação — snapshot anterior a esta issue.
    this.#endVote = restored.endVote === undefined
      ? null
      : { proposedAtMs: restored.endVote.proposedAtMs, approved: new Set(restored.endVote.approved) };
    // A bolsa também migra na leitura (D5): o formato antigo (`gold: number`) vira entradas com
    // `eligible: []`, o sentinel de "presentes no settlement" — a regra de hoje, para uma sessão
    // em voo não perder nem confiscar o que já estava na bolsa.
    const restoredBag = restored.partyBag as unknown;
    this.#bag = restoredBag === undefined
      ? (this.#party?.splitLoot ? { gold: [], items: [], capacity: 0, overweight: false } : null)
      : isLegacyBag(restoredBag)
        ? {
            gold: restoredBag.gold > 0 ? [{ amount: restoredBag.gold, eligible: [] }] : [],
            items: restoredBag.items.map((item) => ({ item, eligible: [] })),
            capacity: restoredBag.capacity,
            // Snapshot anterior ao #396: sem a flag, o primeiro rebalanceamento a recalcula.
            overweight: false,
          }
        : {
            gold: [...(restoredBag as PartyBagState).gold],
            items: (restoredBag as PartyBagState).items.map(
              (entry) => ({ item: entry.item, eligible: [...entry.eligible] }),
            ),
            capacity: (restoredBag as PartyBagState).capacity,
            // Opcional na leitura: snapshot anterior ao #396 não tem a chave.
            overweight: (restoredBag as PartyBagState).overweight ?? false,
          };
    // O peso é derivado; o próximo id de instância continua depois do maior que já existe.
    this.#bagWeight = 0;
    this.#bagSeq = 0;
    for (const entry of this.#bag?.items ?? []) {
      this.#bagWeight += (this.#options.items.get(entry.item.itemId)?.weight ?? 0) * entry.item.quantity;
      const n = Number(entry.item.instanceId.split(':').at(-1));
      if (Number.isFinite(n) && n >= this.#bagSeq) this.#bagSeq = n + 1;
    }
    // O estado por participante espera `onResume` (#203): os participantes ainda não existem —
    // a `Session` os reconstrói depois desta chamada. Sem `runners` é o snapshot de um dono
    // só, e os campos soltos são dele. Sem isto, uma hunt retomada no meio de um lure de
    // vinte monstros recomeçaria "correndo" e continuaria juntando por cima do que já estava.
    this.#runners.clear();
    this.#pendingRunners = {
      byId: restored.runners ?? null,
      legacy: {
        route: restored.route,
        botScheduled: restored.botScheduled ?? [],
        luring: restored.luring ?? true,
        ringReplaced: restored.ringReplaced ?? null,
        playerAttackReady: restored.playerAttackReady ?? true,
        warnedExhausted: restored.warnedExhausted,
        warnedFullBackpack: restored.warnedFullBackpack ?? false,
        warnedNoGold: restored.warnedNoGold ?? false,
        ...(restored.botConfig === undefined ? {} : { botConfig: restored.botConfig }),
      },
    };
    // A ocupação é remontada no primeiro evento, quando todo mundo já está de pé.
    this.#occupancyStale = true;
  }

  // --- eventos ------------------------------------------------------------------------------

  /**
   * O ponto de spawn de um índice, na forma que o `Spawner` espera. `resolvedMonsterId` força
   * o monstro já decidido por `#onSpawn` (`monsterId` OU o sorteio de `monsters`) — sem isto, o
   * `Spawner` sortearia de novo internamente para um ponto com `monsters`, consumindo uma
   * SEGUNDA rolagem do `Rng` que poderia cair num monstro diferente do que a checagem de
   * `blockable` já decidiu, quebrando o contrato de UM sorteio por spawn.
   */
  #spawnAreaOf(pointIndex: number, resolvedMonsterId: string): SpawnArea {
    const point = this.#options.route.spawnPoints[pointIndex] as SpawnPoint;
    return { at: point.at, radius: point.radius, monsterId: resolvedMonsterId };
  }

  /**
   * O intervalo de respawn deste monstro, pela metade quando ele é a Boosted Creature do dia
   * (#615, ADR 0054 decisão 7, `SpawnMonster::addMonster`, `spawn_monster.cpp:379-386`: o
   * intervalo é dividido por `rateSpawn × 2` para a boosted — o Draconya não tem `rateSpawn`
   * global, então aqui é só `/ 2`). `Math.max(1, …)` porque zero viraria evento imediato, e um
   * "respawn instantâneo" não é o que a boosted promete — só o dobro de frequência.
   */
  #respawnDelayFor(monsterId: string, baseDelayMs: number): number {
    if (monsterId !== this.#options.boostedMonsterId) return baseDelayMs;
    return Math.max(1, Math.floor(baseDelayMs / 2));
  }

  /**
   * A população INICIAL de um lugar (#583, `SpawnMonster::startup` do Canary — `scheduleSpawn`
   * chamado com `interval: 0`, que pula direto para `spawnMonster` sem passar por
   * `checkSpawnMonster`): nasce na hora, sem checar `blockable` nem telegraph. As duas regras
   * do respawn normal (`#onSpawn`) existem para o monstro que MORREU e está voltando — nunca
   * para popular a hunt vazia, senão um monstro `blockable` nunca nasceria numa hunt pequena
   * onde o personagem já entra à vista do próprio ponto, e todo não bloqueável levaria
   * 4200 ms extras só para a hunt começar.
   *
   * Só parede/ocupação adiam aqui (o `#spawnBlockedFor` de sempre) — e adiam para o caminho
   * NORMAL (`SPAWN`, com todas as regras), nunca de volta para este.
   */
  #onSpawnInitial(session: Session, subject: string): void {
    const slot = Number(subject);
    const slotState = this.#spawner.slots[slot];
    if (slotState === undefined || slotState.occupantId !== null) return;

    const point = this.#options.route.spawnPoints[slotState.pointIndex] as SpawnPoint;
    const monsterId = point.monsterId
      ?? (point.monsters !== undefined ? pickByWeight(point.monsters, session.rng) : null);
    if (monsterId === null) {
      session.scheduleIn(SPAWN, SPAWN_RETRY_MS, { priority: EventPriority.Spawn, subject });
      return;
    }
    if (this.#options.monsters.get(monsterId) === undefined) return;

    const request = this.#spawner.fill(
      slot, (i) => this.#spawnAreaOf(i, monsterId), this.#spawnBlockedFor(), session.rng,
    );
    if (request === null) {
      session.scheduleIn(SPAWN, SPAWN_RETRY_MS, { priority: EventPriority.Spawn, subject });
      return;
    }
    this.#materializeSpawn(session, request.slot, request.monsterId, request.position);
  }

  /**
   * Um lugar de spawn venceu. Nasce um monstro, ou tenta de novo mais tarde — ou, para quem
   * não é `blockable`, agenda o telegraph e só nasce depois dele (#583).
   *
   * A janela de visão de `blockable` é decidida AQUI, sobre a posição NOMINAL do ponto
   * (`point.at`) — ANTES de o `Spawner` sondar tile nenhum — porque é essa a mecânica do
   * `Spawn::findPlayer` do TFS/Canary: o ponto tem uma posição fixa, e é ela que é olhada, não
   * cada candidato de uma busca em raio. Quem está bloqueando por parede/ocupação continua
   * sendo o `Spawner` (`#spawnBlockedFor`), com o retry curto de sempre.
   */
  #onSpawn(session: Session, subject: string): void {
    const slot = Number(subject);
    const slotState = this.#spawner.slots[slot];
    // Ocupado é caso normal (o monstro está vivo) e não pede reagendamento: quem devolve o
    // lugar é `#onMonsterDied`, e é ele que marca a próxima hora.
    if (slotState === undefined || slotState.occupantId !== null) return;

    const point = this.#options.route.spawnPoints[slotState.pointIndex] as SpawnPoint;
    const monsterId = point.monsterId
      ?? (point.monsters !== undefined ? pickByWeight(point.monsters, session.rng) : null);
    if (monsterId === null) {
      session.scheduleIn(SPAWN, SPAWN_RETRY_MS, { priority: EventPriority.Spawn, subject });
      return;
    }
    const definition = this.#options.monsters.get(monsterId);
    // Conteúdo válido não chega aqui com monstro inexistente: `buildContent` checa a
    // referência cruzada e derruba o boot. Sair é o resto defensivo, não a regra.
    if (definition === undefined) return;

    if (definition.blockable) {
      if (this.#hasVisibleParticipant(session, point.at, point.at.z)) {
        // À vista: o relógio REINICIA — a próxima checagem só vence dali a `respawnDelayMs`
        // inteiro, nunca um retry curto (`spawn_monster.cpp`, `sb.lastSpawn = OTSYS_TIME()`).
        // Metade para a Boosted Creature do dia (#615, ADR 0054 decisão 7).
        session.scheduleIn(SPAWN, this.#respawnDelayFor(monsterId, point.respawnDelayMs), {
          priority: EventPriority.Spawn, subject,
        });
        return;
      }
    }

    const request = this.#spawner.fill(
      slot, (i) => this.#spawnAreaOf(i, monsterId), this.#spawnBlockedFor(), session.rng,
    );
    if (request === null) {
      session.scheduleIn(SPAWN, SPAWN_RETRY_MS, { priority: EventPriority.Spawn, subject });
      return;
    }

    if (!definition.blockable) {
      // Não bloqueável: nasce de qualquer forma, mas só depois do telegraph (#583,
      // `NONBLOCKABLE_SPAWN_MONSTER_INTERVAL` × 3) — a apresentação do efeito de teleporte é
      // do protocolo/cliente (#584/M36-03); aqui só o atraso importa. O lugar fica reservado
      // (`#pendingSpawns`) sem ocupar o slot: o monstro ainda não existe no mundo.
      this.#pendingSpawns.set(slot, { monsterId: request.monsterId, position: request.position });
      session.scheduleIn(SPAWN_MATERIALIZE, NONBLOCKABLE_SPAWN_TELEGRAPH_MS, {
        priority: EventPriority.Spawn, subject,
      });
      return;
    }

    this.#materializeSpawn(session, request.slot, request.monsterId, request.position);
  }

  /** O telegraph do monstro não bloqueável venceu (#583): ele nasce agora, mesmo com jogador em cima. */
  #onSpawnMaterialize(session: Session, subject: string): void {
    const slot = Number(subject);
    const pending = this.#pendingSpawns.get(slot);
    this.#pendingSpawns.delete(slot);
    // Defensivo: não deveria faltar — só quem agenda `SPAWN_MATERIALIZE` é `#onSpawn`, e é
    // sempre com um pedido resolvido.
    if (pending === undefined) return;
    this.#materializeSpawn(session, slot, pending.monsterId, pending.position);
  }

  /** Cria o monstro de fato e ocupa o lugar — o passo final de `#onSpawn`/`#onSpawnMaterialize`. */
  #materializeSpawn(session: Session, slot: number, monsterId: string, position: Point): void {
    const definition = this.#options.monsters.get(monsterId);
    if (definition === undefined) return;
    // O tile já foi escolhido livre pelo spawner. O `z` é do PONTO, não do mapa (#519, hunt
    // multiandar) — é o que faz um Dragon Lord nascer em z11 e não em z10.
    const monster = this.#spawnMonster(session, definition, {
      x: position.x, y: position.y, z: position.z,
    }, null);
    this.#spawner.occupy(slot, monster.id);
  }

  /**
   * Nasce um monstro no mundo: cria o runtime, ocupa o tile e arma o que TODO monstro tem —
   * ability básica, defesas, troca de alvo e a própria lista de invocação. Compartilhado por
   * `#onSpawn` (`masterId: null`, do Spawner) e `#spawnSummon` (#546, `masterId` do mestre): as
   * duas portas de entrada de um monstro na hunt.
   *
   * O evento vencendo AGORA reproduz o comportamento anterior — cooldown novo começa pronto,
   * então ele agia no mesmo tick em que nascia. Como `Spawn` tem prioridade menor que
   * `Movement` e `Attack`, isso acontece neste mesmo instante lógico, na ordem certa.
   */
  #spawnMonster(
    session: Session, definition: Monster, at: FloorPoint, masterId: number | string | null,
  ): MonsterRuntime {
    const monster = new MonsterRuntime({
      id: this.#nextCreatureId++,
      monsterId: definition.id,
      position: at,
      home: at,
      health: definition.health,
      targetId: null,
      speed: definition.speed,
      cooldowns: {},
      ...(masterId === null ? {} : { masterId }),
    });
    this.#monsters.push(monster);
    this.#monsterBySubject.set(monsterSubject(monster.id), monster);
    // `place` é quem marca o tile como ocupado, e é ele que recusaria se algo tivesse mudado
    // entre uma coisa e outra — o chamador já escolheu um tile livre (Spawner ou #spawnSummon).
    place(this.#world, monster, at);

    const subjectOf = monsterSubject(monster.id);
    // DEPOIS do `place`: é ele que pode recusar o tile, e anunciar uma posição que ainda pode
    // ser recusada publicaria um monstro onde ele não está (FUN-103). `#at` lê o andar de FATO
    // do monstro (#519) — o do mapa só sobra para quem nunca declarou `z` (andar único).
    session.emit({
      kind: 'creature-appeared', creatureId: subjectOf, monsterId: definition.id,
      position: this.#at(monster),
      health: monster.health, maxHealth: definition.health,
      // `masterId` (#598) só para invocação de PERSONAGEM — a de MONSTRO (#546, `masterId`
      // numérico) não marca nada para a apresentação.
      ...(typeof monster.masterId === 'string' ? { masterId: monster.masterId } : {}),
    });
    session.scheduleIn(MONSTER_STEP, 0, {
      priority: EventPriority.Movement, subject: subjectOf,
    });
    // A básica nasce engatilhada e vence AGORA, como sempre (CMB-06). As abilities DECLARADAS
    // são armadas pelo primeiro passo, que já reavalia a distância — agendá-las aqui seria um
    // evento por ability por monstro nascendo, para quase sempre não achar alvo.
    if (definition.abilities.some((ability) => ability.id === BASIC_ABILITY_ID)) {
      this.#scheduleMonsterAttack(session, monster, 0);
    }
    // As defesas (#518) não dependem de alvo — cura própria é um timer, não uma reação. Cada
    // uma agenda a PRÓPRIA cadência, e a primeira chance só é rolada em `cadenceMs`: um
    // monstro recém-nascido não se cura antes do primeiro vencimento, como o TFS não cura no
    // instante em que nasce.
    for (const defense of definition.defenses) {
      this.#scheduleMonsterDefense(session, monster, defense, defense.cadenceMs);
    }
    // A troca de alvo (#518) é o mesmo desenho: um timer da instância do monstro, não uma
    // reação ao passo. Só existe um por monstro — sem `Set` de agendados, como as abilities.
    if (definition.targetChange !== undefined) {
      session.scheduleIn(MONSTER_TARGET_CHANGE, definition.targetChange.intervalMs, {
        priority: EventPriority.Attack, subject: subjectOf,
      });
    }
    // A invocação (#546) é o mesmo desenho, com uma exceção: SÓ quem nasce sem mestre arma a
    // própria lista — TFS `!isSummon()` em `onThinkDefense`. Sem isto, uma invocação declarando
    // `summons` encadearia mestre → invocação → invocação da invocação, e nenhum monstro do
    // recorte precisa disso nem o TFS deixa acontecer.
    if (masterId === null) {
      for (const entry of definition.summons?.entries ?? []) {
        this.#scheduleMonsterSummon(session, monster, entry, entry.intervalMs);
      }
    }
    // Nasceu colado num personagem: se o golpe dele estava engatilhado, sai agora — de cada
    // um que o tem ao alcance (#203). E o auto-target (#444) reavalia na hora: o monstro que
    // acabou de surgir na tela vira alvo antes do próximo vencimento do bot.
    for (const character of session.participants) {
      this.#autoSelectTarget(session, character);
      this.#armPlayerAttack(session, character);
      this.#armBot(session, character.id);
    }
    return monster;
  }

  /**
   * O mesmo, do lado da invocação (#546): agenda a PRÓXIMA rolagem desta entrada.
   */
  #scheduleMonsterSummon(
    session: Session, monster: MonsterRuntime, entry: MonsterSummonEntry, delayMs: number,
  ): void {
    monster.scheduledSummons.add(entry.monsterId);
    session.scheduleIn(MONSTER_SUMMON, delayMs, {
      priority: EventPriority.Attack, subject: monsterSummonSubject(monster.id, entry.monsterId),
    });
  }

  /**
   * Uma entrada de invocação declarada venceu (#546, TFS/Canary `Monster::onThinkDefense`, o
   * MESMO laço que avalia `defenses`, referência §15-19): tenta nascer um monstro do próprio
   * nome, até o teto DA ENTRADA e o teto DO MONSTRO. A CADÊNCIA reagenda SEMPRE, como a defesa
   * (#518) — mas a rolagem em si é gated por engajamento (`monster.targetId !== null`), o
   * equivalente do Draconya para o `hasFollowPath` que embrulha o laço inteiro na fonte
   * (`!isSummon() && summons.size() < maxSummons && hasFollowPath`, TFS `monster.cpp:991`;
   * idêntico no Canary `monster.cpp:2224`). `hasFollowPath` só fica verdadeiro perseguindo um
   * `followCreature` de verdade (`creature.cpp:351`/`761`/`809`) — este motor não guarda
   * caminho nenhum (armadilha conhecida do `AGENTS.md`: passo guloso, não A*), então "ter alvo"
   * é a aproximação fiel: sem alvo, a fonte nunca entra no laço, e aqui nunca rola a chance.
   */
  #onMonsterSummon(session: Session, subject: string): void {
    // `m:<id>:<monsterId>`, o mesmo desenho de `#onMonsterDefense`.
    const rest = subject.startsWith('m:') ? subject.slice(2) : '';
    const separator = rest.indexOf(':');
    if (separator < 0) return;
    const monster = this.#monsterBySubject.get(monsterSubject(Number(rest.slice(0, separator))));
    if (monster === undefined || !monster.alive) return;
    const definition = this.#options.monsters.get(monster.monsterId);
    const summons = definition?.summons;
    if (definition === undefined || summons === undefined) return;
    const entryMonsterId = rest.slice(separator + 1);
    const entry = summons.entries.find((candidate) => candidate.monsterId === entryMonsterId);
    if (entry === undefined) return;

    monster.scheduledSummons.delete(entry.monsterId);
    this.#scheduleMonsterSummon(session, monster, entry, entry.intervalMs);

    // Ocioso não invoca (#655): o mesmo corte de `#onMonsterDefense` — o `onThinkDefense` do
    // Canary, onde mora o laço de invocação, não roda para quem saiu da lista de `onThink`.
    if (monster.idle) return;

    // O gate de engajamento (`hasFollowPath` do TFS/Canary) vem ANTES de qualquer teto ou
    // rolagem — igual à fonte, onde ele embrulha o laço `summons` inteiro. Sem alvo, nem sequer
    // consome `session.rng`: um monstro parado, nunca visto, não deve mover a sequência de RNG
    // da hunt por uma invocação que a fonte também nunca tentaria.
    if (monster.targetId === null) return;

    // O teto do MONSTRO inteiro, contando toda invocação viva com este mestre — TFS
    // `m_summons.size() < maxSummons`.
    const live = this.#monsters.filter((m) => m.alive && m.masterId === monster.id);
    if (live.length >= summons.max) return;
    // O teto DESTA entrada, por NOME — TFS `summonCount >= summonBlock.max`/`summonsCount >=
    // summonCount`.
    if (live.filter((m) => m.monsterId === entry.monsterId).length >= entry.count) return;

    // `chance` é SEMPRE declarada aqui (o schema exige, como `monsterDefenseSchema.chance`),
    // então SEMPRE consome uma rolagem.
    if (!session.rng.chance(entry.chance)) return;

    this.#spawnSummon(session, monster, entry.monsterId);
  }

  /**
   * Nasce a invocação perto do MESTRE (#546, TFS/Canary `Map::placeCreature(..., extendedPos:
   * false)`): a posição EXATA dele já está ocupada por ELE — tile é exclusivo (invariante 8) —,
   * então a busca tenta os vizinhos, como `Spawner.#freeTile`. Sem tile livre, a tentativa se
   * perde — a PRÓXIMA cadência desta entrada tenta de novo.
   *
   * **Bloqueio é só parede e ocupação — NUNCA `spawnClearRadius`/`blockable`.** Usar
   * `#spawnBlockedFor` aqui (a checagem do SPAWNER) seria aplicar a um mecanismo diferente uma
   * supressão que a fonte nunca tem: `Map::placeCreature` só chama `tile->queryAdd`, sem olhar
   * posição de jogador nenhuma — e `monster.summon` só dispara com o mestre ENGAJADO
   * (`#onMonsterSummon`, `hasFollowPath`), justo a hora em que um jogador típico está colado
   * nele. `#summonBlockedFor` é o bloqueio PRÓPRIO da invocação, não o do Spawner reaproveitado.
   *
   * **A ordem de varredura dos 8 vizinhos é fixa** (a de `tilesAround`, achado pós-review do
   * #546): com mais de um livre, a invocação sempre nasce no primeiro da lista, nunca num
   * sorteado entre eles. TFS embaralha `normalRelList` (`std::shuffle`) antes de escolher — a
   * mesma divergência aceita de `#step` (`packages/sim/AGENTS.md`, "a escolha entre os dois
   * desvios é fixa"): funcionalmente inerte (a invocação nasce adjacente de qualquer forma, e
   * nenhum invariante de determinismo quebra), então fica como nota, não como TODO.
   */
  #spawnSummon(session: Session, master: MonsterRuntime, monsterId: string): void {
    const definition = this.#options.monsters.get(monsterId);
    // `buildContent` confere `summons.entries[].monsterId` contra o catálogo: conteúdo válido
    // não chega aqui com monstro inexistente. Sair é o resto defensivo, como em `#onSpawn`.
    if (definition === undefined) return;

    const blocked = this.#summonBlockedFor();
    let at: FloorPoint | null = null;
    for (const tile of tilesAround(master.position, SUMMON_SPAWN_RADIUS)) {
      if (blocked(tile.x, tile.y, tile.z)) continue;
      at = tile;
      break;
    }
    if (at === null) return;

    this.#spawnMonster(session, definition, at, master.id);
  }

  /**
   * Nasce a invocação de um PERSONAGEM (#598, M38-01, ADR 0057 decisões 1 e 3). Mesmo mecanismo
   * de `#spawnSummon` — busca um vizinho livre pelo mesmo raio e a mesma ordem fixa de
   * varredura, nunca `spawnClearRadius`/`blockable` (a mesma nota de proveniência de lá vale
   * aqui) —, com o MESTRE sendo o `characterId`, não outro monstro. `null` sem tile livre: quem
   * chama já debitou mana e cooldown pelo `castSpell` genérico, então a magia SAI (o jogador
   * sente o custo, como o Canary sente a mesma falha de `Map::placeCreature`) mesmo sem a
   * invocação nascer — o mesmo contrato de "recusar não é falhar" não se aplica aqui porque a
   * falha é de GEOMETRIA (tile cheio), depois que a magia já confirmou tudo o resto.
   */
  #spawnPlayerSummon(session: Session, master: CharacterRuntime, definition: Monster): MonsterRuntime | null {
    const blocked = this.#summonBlockedFor();
    let at: FloorPoint | null = null;
    for (const tile of tilesAround(master.position, SUMMON_SPAWN_RADIUS)) {
      if (blocked(tile.x, tile.y, tile.z)) continue;
      at = tile;
      break;
    }
    if (at === null) return null;
    return this.#spawnMonster(session, definition, at, master.id);
  }

  /**
   * Quantas invocações deste PERSONAGEM estão vivas agora (#598, ADR 0057 decisão 3 — "teto de
   * 2"). Linear sobre `#monsters`: o teto é baixo (2) e a lista de monstros da hunt já é
   * percorrida por golpe em vários lugares deste arquivo — não vale a pena um índice à parte
   * para uma contagem tão pequena.
   */
  #playerSummonCountOf(characterId: string): number {
    let count = 0;
    for (const monster of this.#monsters) {
      if (monster.alive && monster.masterId === characterId) count += 1;
    }
    return count;
  }

  /**
   * As invocações VIVAS de personagem, as entidades REAIS (#598, ADR 0057 decisão 1 — "monstros
   * a atacam"): quem precisa aplicar dano de verdade (`#executeMonsterAbility`) usa esta;
   * `#playerSummonPrey`, abaixo, é a mesma lista na forma estreita que `chooseTarget` conhece.
   *
   * Devolve a lista VAZIA compartilhada quando não há nenhuma — o caminho comum, hoje sempre
   * (nenhum monstro do catálogo declara `summonable` ainda): quem chama preserva a MESMA
   * referência de `session.participants`/`session.participants` combinado, e o comportamento (e
   * o consumo de `session.rng`) não muda em nada — a garantia que os testes de conformance §11
   * prendem.
   */
  #livePlayerSummons(): readonly MonsterRuntime[] {
    let list: MonsterRuntime[] | null = null;
    for (const monster of this.#monsters) {
      if (!monster.alive || typeof monster.masterId !== 'string') continue;
      (list ??= []).push(monster);
    }
    return list ?? NO_LIVE_PLAYER_SUMMONS;
  }

  /**
   * `#livePlayerSummons`, na forma `Prey` — é o que estende o alvo de um monstro HOSTIL
   * (`masterId === null`, ou invocado por OUTRO monstro, #546) para além de
   * `session.participants`, como o Canary trata a invocação como QUALQUER outro oponente
   * (`isOpponent`) na lista de alvos.
   */
  #playerSummonPrey(): readonly Prey[] {
    const summons = this.#livePlayerSummons();
    if (summons.length === 0) return NO_PLAYER_SUMMONS;
    return summons.map((monster) => ({
      id: monster.subject, position: monster.position, alive: monster.alive, health: monster.health,
      invisible: monster.invisible,
    }));
  }

  /**
   * `#monsters`, MENOS as invocações de personagem VIVAS (#598, ADR 0057 decisão 1) — é o que
   * um PERSONAGEM pode escolher como alvo: `selectTarget`/`countTargets`/`countAreaTargets` não
   * sabem "isto é minha invocação", e sem este filtro o auto-target (#444) e a mira de área
   * tratariam a própria invocação (ou a de um companheiro de party) como qualquer monstro comum
   * — o personagem mataria o que acabou de invocar no primeiro golpe engatilhado. Devolve a
   * MESMA referência de `#monsters` quando não há invocação nenhuma (o caso comum, hoje sempre):
   * zero alocação e zero mudança de comportamento para quem nunca invoca.
   */
  #hostileMonsters(): readonly MonsterRuntime[] {
    if (this.#livePlayerSummons().length === 0) return this.#monsters;
    return this.#monsters.filter((m) => typeof m.masterId !== 'string');
  }

  /**
   * Resolve um `targetId` — de PERSONAGEM ou de invocação (`m:<id>`, #598) — na entidade real,
   * para quem precisa de mais que a forma `Prey` (aplicar dano, ler inventário, decidir morte).
   * `session.participants` primeiro: é a lista pequena e o caso comum, contra `#monsterBySubject`
   * (todo monstro da hunt, muito maior em hunts cheias).
   */
  #creatureById(session: Session, id: string | null): CharacterRuntime | MonsterRuntime | null {
    if (id === null) return null;
    const character = findById(session.participants, id);
    if (character !== null) return character;
    return this.#monsterBySubject.get(id) ?? null;
  }

  /**
   * A mesma resolução de `#creatureById`, na forma `Prey` — para `chooseTarget`/
   * `decideMonsterAction` (`monster.ts`, puros e agnósticos de classe concreta), que só
   * conhecem a forma estreita. `CharacterRuntime` já satisfaz `Prey` e sai sem alocação; só o
   * caso NOVO (alvo é invocação de personagem, #598) monta o envelope.
   */
  #preyById(session: Session, id: string | null): Prey | null {
    if (id === null) return null;
    const character = findById(session.participants, id);
    if (character !== null) return character;
    const monster = this.#monsterBySubject.get(id);
    if (monster === undefined) return null;
    return {
      id: monster.subject, position: monster.position, alive: monster.alive, health: monster.health,
      invisible: monster.invisible,
    };
  }

  /**
   * O alvo de UM monstro nesta reavaliação (#598, ADR 0057 decisão 1) — separa os dois
   * mecanismos que `masterId` agora cobre:
   *
   * - **Invocação do PERSONAGEM** (`masterId` é `string`, um `characterId`): NUNCA escolhe
   *   sozinha — herda o alvo do MESTRE (`attackTargetOf`, a mesma resolução que já limpa alvo
   *   morto/fora de alcance) a cada reavaliação, e troca junto quando ele troca. Sem mestre
   *   (saiu/morreu — o cascade de `#removeSummon` ainda não rodou neste instante exato) ou
   *   mestre sem alvo, o resultado é `null`: a invocação fica parada, sem sortear nada.
   * - **Qualquer outro monstro** (hostil do Spawner, ou invocação de OUTRO monstro, #546):
   *   `chooseTarget` de sempre, com a lista de presas estendida pelas invocações de personagem
   *   VIVAS (`#playerSummonPrey`) — o Canary trata a invocação como qualquer oponente
   *   (`isOpponent`). Vazio, é a MESMA referência de `session.participants` de antes desta
   *   issue: zero alocação e zero sorteio a mais quando ninguém invocou.
   */
  #chooseMonsterTarget(
    session: Session, monster: MonsterRuntime, definition: Monster,
    knownSummons?: readonly Prey[],
  ): string | null {
    if (typeof monster.masterId === 'string') {
      const owner = findById(session.participants, monster.masterId);
      if (owner === null || !owner.alive) return null;
      return this.attackTargetOf(owner)?.subject ?? null;
    }
    // `knownSummons` (#655): quem já calculou a lista (o passo, que a reaproveita para a área de
    // visão) a entrega em vez de varrer `#monsters` de novo.
    const summons = knownSummons ?? this.#playerSummonPrey();
    const prey: readonly Prey[] = summons.length === 0
      ? session.participants
      : [...session.participants, ...summons];
    return chooseTarget(monster, prey, definition, session.rng, session.nowMs);
  }

  /**
   * O passo do personagem venceu.
   *
   * UM tile, e reavaliado da posição nova no vencimento seguinte. A versão anterior pulava
   * quantos tiles coubessem no tick, e é de lá que vinha a divergência de dano: num tick de
   * 1 s o personagem atravessava dois tiles de uma vez, o monstro também, e a adjacência era
   * conferida uma vez só, no fim.
   */
  #onPlayerStep(session: Session, characterId: string): void {
    const character = findById(session.participants, characterId);
    if (character === null || !character.alive) return;
    // Snapshot anterior à FUN-119 traz velocidade zero; a tabela repõe, com o bônus de
    // equipamento (#524) — a mesma soma de `onEnter`, para quem calçou a bota antes do bump.
    if (character.speed <= 0) {
      character.speed = statsForLevel(
        character.level, this.#vocationOf(character), this.#options.progression,
      ).speed + character.inventory.speedBonus(this.#options.items);
    }
    // O vencimento seguinte é a duração do passo que este evento der — e, quando ele não der
    // passo nenhum, a de um passo daqui (FUN-119): quem parou volta a olhar em volta no ritmo
    // em que andaria. Agendar ANTES de decidir, com a duração de um passo daqui, dá o mesmo
    // resultado para quem fica e adianta o de quem anda para chão mais lento; por isso o
    // reagendamento fica no fim, com o que de fato aconteceu.
    const stepped = this.#playerStep(session, character);
    // Andou (ou parou para lutar): reavalia o alvo na tela da posição nova e acorda o bot —
    // um monstro que entrou no raio de busca pode destravar a runa (#444).
    this.#autoSelectTarget(session, character);
    this.#armBot(session, character.id);
    const cadence = stepped !== null && stepped.ok
      ? stepped.durationMs
      : movementDuration(this.#world, character, character.position, character.position);
    session.scheduleIn(PLAYER_STEP, cadence, {
      priority: EventPriority.Movement, subject: characterId,
    });
  }

  /** O corpo do passo do personagem; devolve o passo dado, ou `null` quando ficou parado. */
  #playerStep(session: Session, character: CharacterRuntime): MoveResult | null {

    const runner = this.#runnerOf(character.id);

    // A caminhada FORÇADA do medo (M44-04, #622): PRIORIDADE MÁXIMA, acima de tudo — de
    // `forcePlayerAutoWalk`, que substitui a lista de passos do próprio jogador. O personagem
    // continua batendo em quem estiver ao alcance (`#advanceFearWalk` arma o golpe), só não anda
    // por conta própria enquanto a lista durar; o resto do passo (rota, combate-stop, follow)
    // espera a lista esvaziar.
    if (runner.fearWalk !== null) return this.#advanceFearWalk(session, character, runner);

    // `walk-to` distante em curso (#763, achado de QA ao vivo na Darashia Dragon Lair): PRIORIDADE
    // MÁXIMA, ACIMA do combate-stop logo abaixo. Um clique para um cadáver longe, com dragões no
    // alcance o caminho INTEIRO, empacava para sempre no combate-stop de sempre — o alvo nunca
    // morre e nunca sai de alcance numa masmorra cheia, então o personagem nunca voltava a tentar
    // o próximo tile. O jogador que clicou um destino distante já expressou a intenção de IR até
    // lá; `#armPlayerAttack` continua batendo em quem estiver ao alcance NO CAMINHO (a mesma
    // postura do `#holdFollow` — "atacar de onde está é aceitável" —, só não GRUDA para lutar).
    if (runner.manualWalkTo !== null) {
      this.#armPlayerAttack(session, character);
      return this.#advanceManualWalk(session, character);
    }

    // Para para lutar, e retoma DEPOIS no mesmo índice (FUN-42). Como ele para assim que há
    // monstro ao alcance, nunca pisa no tile de um: o combate começa antes do passo.
    //
    // Com LURE configurado (§13.7), quem decide parar deixa de ser "há um ao alcance" e passa a
    // ser a CONTAGEM: correr acumulando até `max`, limpar até cair abaixo de `min`.
    // **Exceto quando quem seguir está em OUTRO andar (#527).** Monstro ao alcance nunca falta
    // perto de um spawn — é raro um seguidor chegar num andar novo sem NENHUM por perto — e
    // parar para lutar aqui significa NUNCA reavaliar `#holdFollow` de novo, porque esta
    // checagem vem ANTES dela a cada vencimento. Uma QA ao vivo com o plano de bot real
    // flagrou exatamente isto: o Druid chegou sozinho num andar cheio de Dragon Lords, entrou
    // em combate, e ficou "sentado" ali — sem nunca se mover — pelo resto da hunt, porque
    // brigar sempre vencia da tentativa de voltar. Reunir a party pesa mais que uma luta que
    // pode esperar; `#holdFollow` continua deixando `#armPlayerAttack` bater em quem estiver
    // ao alcance da arma NO CAMINHO até a escada (ADR 0035 d.9) — isto só recusa GRUDAR ali.
    // **Continua valendo cheio durante a janela de espera do `walk-to` (abaixo)**: chegado o
    // destino, um dragão ao alcance segura o personagem ali para lutar, como o QA relatou aceitar
    // ("atacar de onde está é aceitável") — só ANDAR é que o caminho manual em curso suprime.
    if (
      this.#attackTarget(character) !== null && !this.#luring(runner, character, session.nowMs)
      && !this.#mustCrossFloorToFollow(session, runner, character)
    ) {
      runner.walker.stop();
      this.#armPlayerAttack(session, character);
      return null;
    }

    // A janela de espera depois de CHEGAR a um `walk-to` distante, ou aberta direto por uma
    // intenção manual sem caminho nenhum (#763, `#armManualWalkHold`): suprime rota E
    // perseguição enquanto durar, para o jogador ter tempo de agir (abrir o cadáver, pegar o
    // loot) antes do bot retomar sozinho pelo tile mais próximo.
    if (runner.manualWalkHoldUntilMs !== null) {
      if (session.nowMs < runner.manualWalkHoldUntilMs) {
        this.#armPlayerAttack(session, character);
        return null;
      }
      runner.manualWalkHoldUntilMs = null;
    }

    // Follow de membro (ADR 0035 d.9, §D10, #398): substitui a rota E a postura contra monstro
    // enquanto ativo. O combate já rodou acima — é ele, não isto, que decide se o personagem
    // para para bater; seguir não impede atacar quem estiver ao alcance da arma.
    const follow = this.#holdFollow(session, runner, character);
    if (follow !== false) {
      this.#armPlayerAttack(session, character);
      return follow;
    }

    // Ninguém ao alcance, e a postura pode mandar ele SAIR DA ROTA atrás do alvo (FUN-85).
    // Com `stand` — o padrão — isto não roda, e o comportamento é o de sempre.
    const posture = this.#holdPosture(session, runner, character);
    if (posture !== false) {
      this.#armPlayerAttack(session, character);
      return posture;
    }

    // Ninguém ao alcance: anda. Com postura `stand` o personagem NÃO persegue — ele percorre a
    // rota e deixa o monstro vir. É o que dispensa pathfinding dos dois lados (ADR 0009).
    runner.walker.resume();
    const to = runner.walker.step();
    if (to === null) return null;
    // O walker usa o tile interativo bloqueante antes de pisar (#728, ADR 0050 d.4): a rota
    // autorada pode atravessar tile usável (porta comum, no T1 desta issue), e quem a percorre
    // abre sozinho — é automação legítima (invariante 11), não desvio de caminho (ADR 0009: a
    // rota continua sendo a mesma lista fixa de tiles, nunca recalculada em volta da porta).
    const blockingHere = this.#tileOverrides.at(to);
    if (blockingHere !== null && blockingHere.blocked) {
      if (this.#useInteractable(session, character, blockingHere.interactableId) !== null) {
        runner.routeBlockedWarned = false;
      } else {
        // Sem ferramenta (a chave certa, incluída, #732) ou level insuficiente (level-door),
        // ou kind sem par de estados (`quest-door`/T3, fora do escopo): segura como faria com
        // parede, e registra UMA vez — não uma linha por vencimento parado.
        runner.walker.hold();
        if (!runner.routeBlockedWarned) {
          runner.routeBlockedWarned = true;
          session.record('route-blocked', character.id);
        }
        return null;
      }
    } else {
      runner.routeBlockedWarned = false;
    }
    if (this.#partyRegroupBlocked(session, runner, character, to)) {
      // O LÍDER esperando a party se juntar (#527) — achado numa QA ao vivo com o bot config
      // real: sem haste igual entre vocações, quem não é o líder cai para trás em combate, e o
      // líder — que nunca espera — seguia sozinho por dezenas de tiles antes de qualquer
      // seguidor alcançar de novo, e às vezes atravessava andar com a party inteira ainda do
      // outro lado. Segura o passo como faria com um tile bloqueado; ainda BATE em quem
      // estiver ao alcance da arma (o combate roda ANTES disto, no topo de `#playerStep`) — só
      // não avança sozinho.
      runner.walker.hold();
      return null;
    }
    if (this.#crossesAwayFromLeader(session, runner, character, to)) {
      // A rota PRÓPRIA de um seguidor é um laço fechado (§14.4) — se ela cruza uma escada perto
      // de onde o `d > radius` de `#holdFollow` desistiu (o líder ficou > 8 tiles no MESMO
      // andar, longe o bastante para "fora de alcance", perto o bastante para o ÍNDICE da rota
      // do seguidor continuar sendo o de perto da mesma escada), o laço passa pela MESMA escada
      // TODA VOLTA — e sem esta recusa o seguidor atravessa sozinho, volta, atravessa nulo de
      // novo, dezenas de vezes numa hunt de 10 min (#527, achado com o bot config REAL — sem
      // lure em ninguém — onde Sorcerer/Druid caem para trás em combate com frequência bem
      // maior que o config sintético deste teste supunha). `#holdFollow` sozinho (`d > radius`)
      // só cobre "sem alvo alcançável"; ele NÃO impede a rota própria, que roda LOGO DEPOIS
      // dele devolver `false`, de atravessar andar por conta própria — a rota não sabe onde o
      // líder está. Recusar aqui é a mesma regra do ramo de travessia de `#holdFollow`, só que
      // do lado de quem NÃO tem follow ativo agora: nunca um andar diferente do líder sem ele.
      runner.walker.hold();
      return null;
    }
    if (this.#isLeaderReservedTile(this.#leaderReservedTile(session, character), to)) {
      // A PRÓPRIA rota deste seguidor tem a MESMA coordenada do próximo tile do líder num
      // índice TOTALMENTE diferente do índice atual do líder (#527, achado numa QA ao vivo: a
      // Darashia Dragon Lair repete um corredor estreito em (56,30)/(56,31) em três pontos da
      // rota, cada um andando numa direção). `#holdFollow` já reserva o tile quando este
      // personagem está seguindo ATIVAMENTE — mas aqui ele desistiu de seguir (`d > radius`) e
      // caiu na rota própria, que não sabe nada sobre onde o líder está agora. Segura como um
      // tile bloqueado; o vencimento seguinte tenta de novo, e por enquanto o corredor continua
      // livre para o líder.
      runner.walker.hold();
      return null;
    }
    let result = this.#step(session, character, to, character.id);
    if (!result.ok) {
      if (result.reason === 'not-adjacent') {
        // O personagem não está onde a rota acha que ele está — andou à mão (FUN-69), foi
        // empurrado, ou vem de um follow que acabou de atravessar andar e pode deixá-lo longe
        // de QUALQUER tile da rota (#527, `floorChangeToward`: o passo guloso livre até a
        // escada não tem por que terminar perto da rota). `rejoinNearest` resincroniza o
        // ÍNDICE para o tile mais próximo, mas NÃO move ninguém — se esse tile também não for
        // adjacente, o vencimento seguinte cai no MESMO `not-adjacent` para sempre, resincroniza
        // para o MESMO tile de novo, e nunca dá um passo de verdade (achado reproduzindo a QA
        // do M28 com conteúdo real: o Paladin ficava preso repetindo o resync, imóvel, porque
        // "voltar para a rota" nunca precisou fechar distância antes — um empurrão ou o
        // `walk` manual deixam o personagem a um tile da rota, não a quatro). Fecha a
        // distância com o MESMO passo guloso do resto do motor (ADR 0009) antes de confiar na
        // rota nesta mesma chamada; sem caminho livre, o vencimento seguinte tenta de novo.
        runner.walker.rejoinNearest(character.position);
        const rejoined = runner.walker.current;
        // SEMPRE tenta fechar a distância até o tile resincronizado — mesmo quando ele já está
        // a distância 1 (#527, achado varrendo sementes: um `>` aqui deixava o caso "já
        // adjacente" para o walker.step() do PRÓXIMO vencimento, que avança para `index + 1`,
        // não para `rejoined` — um tile DIFERENTE, e não necessariamente adjacente à posição
        // real. Um companheiro satisfeito, sem lutar, sentado exatamente no tile resincronizado
        // não aparecia em NENHUM `#companionAt`/nudge, porque o passo nunca era de fato
        // tentado). `distance === 0` (já em cima dele) não tem o que fechar.
        if (distance(character.position, rejoined) > 0) {
          const toward = greedyStep(character.position, rejoined, this.#blockedForGroundedStep(character));
          if (toward !== null) {
            // `rollDrunk: false` (#651): a tentativa PRIMÁRIA (`to`, acima) já rolou drunk se a
            // criatura tiver a condição — esta é a recuperação do MESMO vencimento, não um novo
            // passo. Ver a nota de `#step`.
            result = this.#step(
              session, character, { ...toward, z: character.position.z }, character.id, false,
            );
          } else {
            // Os três candidatos do passo guloso rumo à rota estão todos ocupados (#527, achado
            // varrendo várias sementes com conteúdo real: a MESMA geometria de uma QA ao vivo —
            // o líder tinha recuado para uma reentrância do mapa, e os TRÊS seguidores,
            // satisfeitos a distância 1, ocupavam os TRÊS únicos tiles livres ao redor). Pedir
            // passagem a um só não bastava — o próximo `greedyStep` ainda achava os outros dois.
            this.#clearCompanionsAround(session, character, rejoined);
          }
        }
      } else if (this.#companionAt(session, character, to)) {
        // Um COMPANHEIRO parado na rota (#203): ele está lutando ali, e esperar seria ficar
        // atrás dele a hunt inteira — foi o que aconteceu. Contorna com o passo guloso rumo
        // ao tile seguinte; o vencimento seguinte reentra pela rota (`not-adjacent` →
        // `rejoinNearest`). Cercado, segura como faria com um monstro.
        const around = greedyStep(character.position, runner.walker.ahead(), this.#blockedForGroundedStep(character));
        if (around === null) {
          // Cercado dos dois lados: nem o tile original nem o contorno estão livres (#527,
          // achado reproduzindo a QA do M28 com conteúdo real — um SEGUIDOR satisfeito a
          // distância 1 do líder pode acabar parado bem em cima do próximo tile da rota dele,
          // e os dois ficam parados para sempre, um esperando o outro sem que nenhum dos dois
          // tenha motivo para se mexer). Em vez de segurar para sempre, pede ao(s)
          // companheiro(s) que bloqueiam para abrir espaço — só quem não está ocupado com
          // nada mais importante agora cede.
          //
          // **Só pede a TODOS os vizinhos (#527) quando há follow de verdade na hunt** — uma
          // hunt de vários personagens andando a MESMA rota sem NENHUMA relação de líder
          // (`follow.kind: 'none'` em todo mundo, como em `hunt.test.ts`, "party-member-lost
          // com exitDelayMs") nudgear em GRUPO desvia quem está parado por um motivo PRÓPRIO
          // (esperar um monstro chegar, por exemplo) de um bloqueio que nunca foi dele —
          // achado quebrando um teste que já existia. Com follow configurado, o cerco por
          // VÁRIOS seguidores satisfeitos ao redor do líder é o caso que motiva o grupo.
          if (this.#hasActiveFollow(session)) {
            this.#clearCompanionsAround(session, character, runner.walker.ahead());
          } else {
            this.#nudgeCompanion(session, character.position, to);
          }
          runner.walker.hold();
        } else {
          runner.walker.hold();
          // `rollDrunk: false` (#651): mesmo motivo do ramo `not-adjacent` acima — o contorno é
          // a recuperação do passo PRIMÁRIO deste vencimento, que já rolou.
          result = this.#step(
            session, character, { ...around, z: character.position.z }, character.id, false,
          );
        }
      } else if (
        result.reason === 'same-tile' && runner.sameTileStreak < 1
        && (this.#hasActiveFollow(session) || session.participants.length === 1)
      ) {
        // O ÍNDICE do walker está UM ATRÁS da posição real do personagem — ele chegou neste
        // tile por outro caminho (o fecha-distância do ramo `not-adjacent` acima, um empurrão,
        // qualquer passo guloso que não passa por `walker.step()`) antes do walker achar que
        // devia estar lá (#527, achado restaurando um snapshot ao vivo TRAVADO: o Knight
        // ficava parado com `walker.index` sempre voltando ao MESMO valor — `walker.step()`
        // pedia o PRÓXIMO tile, que já era onde o personagem estava, `move()` recusava por
        // `same-tile`, e o `hold()` genérico do `else` abaixo desfazia o AVANÇO do índice,
        // repetindo o MESMO passo recusado para sempre). O índice já avançou (`walker.step()`,
        // no topo) para o tile onde o personagem JÁ ESTÁ — está CERTO ficar assim; `hold()`
        // aqui seria o bug. **Só a PRIMEIRA vez seguida** (`sameTileStreak`, #527, achado
        // varrendo `hunt.test.ts`: sem o limite, um laço pequeno e cheio de companheiros podia
        // bater `same-tile` vencimento após vencimento, e o índice girava o laço INTEIRO sem o
        // personagem nunca dar um passo físico — o desvio real de produção é sempre UM tile,
        // nunca uma sequência).
        //
        // **Só com follow de verdade na hunt** (`#hasActiveFollow`, #527, achado quebrando dois
        // testes que já existiam — `hunt.test.ts` "party-member-lost com exitDelayMs" e
        // `darashia-dragon-lair.test.ts` o respawn de 90 s — nenhum dos dois com follow
        // configurado): sem isto, o mesmo desvio de UM tile podia acontecer numa hunt SEM
        // party, e desprender o índice mais cedo do que o `hold()` de sempre — mudando timing
        // que esses testes fixam, sem relação nenhuma com o bug real (um seguidor atravessando
        // andar atrás do líder). O caso de produção que motivou isto é sempre de follow; fora
        // dele, `hold()` continua sendo o comportamento OBSERVADO e testado. Registrado como
        // acompanhamento: uma hunt solo pode em teoria bater o MESMO desvio por outro caminho
        // (um `walk` manual, por exemplo) e ficar presa — não coberto por este fix.
        //
        // A partir da segunda vez seguida, cai no `hold()` de sempre —
        // parede/companheiro de verdade, não desvio de índice.
        runner.sameTileStreak += 1;
      } else {
        // Rota bloqueada por monstro é normal, e o walker precisa saber: sem `hold` o índice
        // avançaria e o personagem "pularia" o tile ocupado na volta seguinte.
        runner.walker.hold();
      }
    }
    // Fora do `same-tile` consecutivo é o único caso em que a sequência CONTINUA — qualquer
    // outro resultado (passo de verdade, `not-adjacent`, companheiro, parede) zera a contagem
    // (#527): a válvula de `sameTileStreak` existe para um desvio de índice PERSISTENTE, não
    // para dois desvios de UM tile cada, minutos de simulação lógica à parte.
    if (result.ok || result.reason !== 'same-tile') runner.sameTileStreak = 0;
    this.#armPlayerAttack(session, character);
    return result;
  }

  /**
   * Há OUTRO participante vivo parado em `at`? É o bloqueio que se contorna, não se espera.
   *
   * Confere o andar (#519) antes de x/y: `at` vem de `runner.walker.ahead()`/`.step()`, um tile
   * da ROTA — que já carrega o `z` de verdade, mesmo quando o TIPO aqui só promete `GridPoint`
   * —, e a hunt hospeda um personagem só hoje (§14, Fase 3 traz party), então isto é código
   * morto POR ENQUANTO. Sem a checagem, o dia em que a party entrar numa hunt multiandar faria
   * um companheiro dois andares abaixo "bloquear" o walker por coincidência de (x, y) — os três
   * andares da Darashia Dragon Lair compartilham a mesma caixa.
   */
  #companionAt(session: Session, self: CharacterRuntime, at: FloorPoint): boolean {
    for (const other of session.participants) {
      if (other === self || !other.alive) continue;
      if (!sameFloor(other.position.z, at.z)) continue;
      if (other.position.x === at.x && other.position.y === at.y) return true;
    }
    return false;
  }

  /**
   * Pede ao companheiro parado em `at` que abra espaço — o desempate de "cercado dos dois
   * lados" que `#playerStep` usa quando NEM o tile original nem o contorno estão livres (#527).
   *
   * Só cede quem não está ocupado com algo mais importante AGORA: em combate (alcance da arma)
   * a decisão de lutar continua sendo dele, e esta função não a atropela. Quem cede dá um passo
   * guloso para LONGE de quem pediu passagem — `fleeStep`, o mesmo algoritmo de recuo do resto
   * do motor (ADR 0009) — e o walker dele para: o vencimento seguinte de QUALQUER coisa que
   * mova este personagem (rota, follow) reavalia normalmente a partir da posição nova. Sem
   * efeito quando ninguém está no tile, quando quem está lá não pode ceder, ou quando não há
   * para onde ceder (cercado de verdade, e aí `hold()` no chamador continua sendo o certo).
   *
   * **`nudgedUntilMs` é o que faz o passo pegar** (achado reproduzindo a QA do M28: sem ele, o
   * par empatava para sempre — o empurrado saía do tile e, no PRÓPRIO vencimento seguinte,
   * `#holdFollow` já o trazia de volta, muitas vezes para o MESMO tile, antes de quem pediu
   * passagem conseguir atravessar). Enquanto vale, `#holdFollow` do empurrado devolve `false`
   * — o mesmo que "inalcançável" — e ele anda a PRÓPRIA rota por um instante, o bastante para
   * abrir espaço de verdade.
   */
  #nudgeCompanion(session: Session, requester: FloorPoint, at: FloorPoint): void {
    const blocker = session.participants.find((other) => other.alive
      && sameFloor(other.position.z, at.z) && other.position.x === at.x && other.position.y === at.y);
    if (blocker === undefined || this.#attackTarget(blocker) !== null) return;
    // Foge de QUEM PEDIU passagem, nunca do próprio tile — `at` é a posição atual do bloqueio,
    // e fugir dela seria fugir de si mesmo (vetor nulo, `fleeStep` sempre devolveria `null`).
    const base = this.#blockedForGroundedStep(blocker);
    // O nudge NUNCA larga quem cedeu em cima do tile reservado do líder (#527) — sem isto, abrir
    // espaço para UM bloqueio podia criar outro: empurrar alguém exatamente para onde o líder
    // precisa pisar em seguida, a mesma trava com uma causa diferente.
    const reserved = this.#leaderReservedTile(session, blocker);
    const blocked: Blocked = (x, y, z, monsterId) => base(x, y, z, monsterId)
      || this.#isLeaderReservedTile(reserved, { x, y, z: z ?? blocker.position.z });
    let away = fleeStep(blocker.position, requester, blocked);
    if (away === null) {
      // `fleeStep` só tenta os três candidatos alinhados com a direção OPOSTA a quem pediu
      // passagem (ADR 0009) — um companheiro encostado numa parede exatamente NESSA direção
      // fica sem `away`, mesmo com tile livre em outra (#527, achado varrendo sementes com
      // conteúdo real: Paladin preso num canto do mapa, o único lado livre não era o lado
      // "para longe" do líder). Antes de desistir, tenta QUALQUER um dos oito vizinhos, em
      // ordem fixa (determinística, como o resto do motor) — ceder para o lado também abre
      // espaço, só o recuo reto é que não é obrigatório.
      for (const tile of tilesAround(blocker.position, 1)) {
        if (tile.x === blocker.position.x && tile.y === blocker.position.y) continue;
        if (blocked(tile.x, tile.y)) continue;
        away = tile;
        break;
      }
    }
    if (away === null) return;
    const blockerRunner = this.#runnerOf(blocker.id);
    blockerRunner.walker.stop();
    const nudged = this.#step(session, blocker, { ...away, z: blocker.position.z }, blocker.id);
    if (nudged.ok) blockerRunner.nudgedUntilMs = session.nowMs + NUDGE_YIELD_MS;
  }

  /**
   * A versão em GRUPO de `#nudgeCompanion` (#527): pede a TODOS os companheiros vizinhos que
   * estão NO CAMINHO rumo a `toward` — não só a um — que abram espaço, cada um fugindo de
   * `requester`.
   *
   * Existe porque `#nudgeCompanion` sozinho resolve "um companheiro no caminho", mas não "a
   * party inteira cercando o líder" — achado numa QA ao vivo e reproduzido varrendo várias
   * sementes com conteúdo real: o líder numa reentrância do mapa, e os TRÊS seguidores,
   * satisfeitos a distância 1, ocupando os TRÊS únicos tiles livres ao redor — os três
   * candidatos que `greedyStep` tentaria, um por direção. Pedir passagem a um só nunca bastava:
   * o `greedyStep` seguinte ainda encontrava os outros dois no caminho.
   *
   * **Só vizinhos que não pioram a distância até `toward`** — nunca os OITO (#527, achado
   * quebrando um teste que já existia: nudgear um vizinho que está do lado OPOSTO do destino,
   * fora do caminho, o desloca sem necessidade — um personagem parado ali por um motivo
   * PRÓPRIO, como esperar um monstro chegar, saía do lugar por um bloqueio que nunca foi dele).
   * Cada nudge é independente (mesma regra: só cede quem não está lutando agora), e um
   * companheiro sem `away` válido simplesmente fica — não é erro, é "cercado de verdade" também
   * para ele.
   */
  #clearCompanionsAround(session: Session, requester: CharacterRuntime, toward: FloorPoint): void {
    const requesterDistance = distance(requester.position, toward);
    for (const other of session.participants) {
      if (other === requester || !other.alive) continue;
      if (!sameFloor(other.position.z, requester.position.z)) continue;
      if (distance(requester.position, other.position) !== 1) continue;
      if (distance(other.position, toward) > requesterDistance) continue;
      this.#nudgeCompanion(session, requester.position, other.position);
    }
  }

  /**
   * Existe follow de verdade nesta hunt agora — alguém com `botConfig.follow.kind !== 'none'`
   * (#527)? É o que distingue "vários seguidores satisfeitos podem cercar o líder de propósito"
   * (onde o nudge em GRUPO é o certo) de "vários personagens andam a mesma rota sem relação
   * nenhuma entre si" (onde nudgear todo mundo ao redor desvia quem está parado por um motivo
   * PRÓPRIO — achado quebrando um teste que já existia). `#runners` é examinado direto porque
   * isto roda no caminho quente do passo; nenhuma alocação.
   */
  #hasActiveFollow(session: Session): boolean {
    for (const character of session.participants) {
      const runner = this.#runners.get(character.id);
      if (runner?.botConfig?.follow !== undefined && runner.botConfig.follow.kind !== 'none') return true;
    }
    return false;
  }

  /**
   * A postura assume o passo, ou devolve `false` e a rota segue (FUN-85, §13.6).
   *
   * `true` significa "a postura decidiu o que fazer com este vencimento" — e isso inclui
   * DECIDIR FICAR PARADO. Um personagem já na distância que pediu não anda, e também não volta
   * a percorrer a rota: voltar seria ele oscilar entre manter distância e seguir o laço, que
   * de fora parece o bot travado.
   *
   * O passo sai pelo MESMO `#step` do monstro e do `walk` do socket — `movement.ts` é o único
   * escritor de posição (FUN-69), e a postura não é exceção. O walker fica parado enquanto
   * isso; quando o alvo morre, o vencimento seguinte cai na rota, o passo é recusado por
   * `not-adjacent` e `rejoinNearest` reentra pelo tile mais próximo. O caminho de volta já
   * existia, e é o mesmo de quem foi empurrado.
   */
  #holdPosture(session: Session, runner: Runner, character: CharacterRuntime): MoveResult | null | false {
    const posture = targetingOf(runner).posture;
    if (posture.kind === 'stand') return false;

    const target = this.#approachTarget(character);
    if (target === null) return false;

    const from = character.position;
    const d = distance(from, target.position);
    const blocked = this.#blockedForGroundedStep(character);
    // `follow` persegue até poder bater (`d <= reach`), e quando já pode fica parado;
    // `keep-distance` mira a distância configurada (aproxima se d > want, recua se d < want).
    if (posture.kind === 'follow') {
      const reach = this.#attackRangeOf(character);
      if (d <= reach) return null;
      const to = greedyStep(from, target.position, blocked);
      if (to === null) return null;
      runner.walker.stop();
      return this.#step(session, character, { ...to, z: from.z }, character.id);
    }

    const want = posture.tiles;
    // `null` é "a postura decidiu ficar parado": a cadência seguinte é a de um passo daqui.
    if (d === want) return null;

    // `keep-distance` só RECUA com visão livre até o alvo (#553): o TFS só deixa um monstro
    // que mantém distância se afastar quando ele ainda enxerga quem persegue — recuar às cegas
    // podia levar a se afastar do alvo sem motivo, quando na prática ele já perdeu a linha por
    // outra razão. Sem visão, mantém a posição — a mesma "decidiu ficar parado" de `d === want`.
    const to = d > want
      ? greedyStep(from, target.position, blocked)
      : (isSightClear(this.#world.map, from, target.position)
        ? fleeStep(from, target.position, blocked)
        : null);
    // Empacado — cercado, ou contra a parede recuando. Esperar é o comportamento certo, e é o
    // mesmo que o passo guloso do monstro já faz (ADR 0009).
    if (to === null) return null;

    runner.walker.stop();
    return this.#step(session, character, { ...to, z: from.z }, character.id);
  }

  /**
   * Follow de membro (ADR 0035 d.9, §D10, #398). Passo guloso até ficar ADJACENTE (distância 1,
   * Chebyshev — a mesma grade do resto do movimento) do alvo configurado; parado quando já está.
   *
   * `kind: 'leader'` resolve `#leader(session)` a CADA vencimento — nunca guarda o id — pela
   * mesma razão de `#approachTarget` nunca guardar o monstro escolhido: a mira certa é a de
   * agora. `#leader` já cai para o mais antigo presente quando o líder muda (#394), então uma
   * troca de liderança no meio da hunt já reflete aqui sem nenhum código extra.
   *
   * Devolve `false` quando não há follow ativo — E quando o follow está INTERROMPIDO —, para
   * `#playerStep` cair na postura contra monstro e na rota, exatamente como sem follow nenhum.
   *
   * **Andar diferente atravessa ESCADA DE VERDADE, não vira `unreachable` na hora** (#527). Até
   * aqui, o líder mudando de andar deixava o seguidor "sem alvo alcançável" para sempre — ele
   * caía na PRÓPRIA rota, que pode levar a um andar DIFERENTE do que o líder está agora (foi
   * assim que o Druid da QA do M28 foi sozinho para o meio dos Dragon Lords, atrás da própria
   * rota, sem saber que o resto da party tinha ficado para trás). `floorChangeToward`
   * (`@draconya/content`) acha a escada, NO ANDAR do seguidor, que começa a travessia até o
   * andar do alvo — sem pathfinding real (ADR 0009 continua valendo): é o MESMO passo guloso de
   * sempre, só que mirando o tile da escada em vez do alvo. Pisar nela já muda de andar sozinho
   * (`move`, `movement.ts`); no vencimento seguinte o seguidor está no andar novo, e ou já está
   * perto o bastante do alvo (cai no caminho de baixo, por distância) ou a MESMA busca acha a
   * escada seguinte — "tomar a mesma escada que o líder tomou", sem guardar rota nem estado
   * extra. Só vira `unreachable` quando NENHUMA sequência de escadas liga os dois andares — um
   * mapa sem elas, ou hunt de andar único (onde `floorChangeToward` nunca é chamada, porque
   * `sameFloor` já é `true`).
   */
  #holdFollow(session: Session, runner: Runner, character: CharacterRuntime): MoveResult | null | false {
    const follow = runner.botConfig?.follow;
    if (follow === undefined || follow.kind === 'none') return false;

    // Acabou de ser empurrado para abrir passagem (#527, `#nudgeCompanion`): por
    // `NUDGE_YIELD_MS`, o follow fica em suspenso — o mesmo `false` de "inalcançável" — para
    // não voltar direto para cima de quem acabou de pedir passagem. Sem ISTO precisar emitir
    // `follow-state`: a suspensão é curta demais para o jogador notar, e um evento por empurrão
    // seria ruído no fio.
    if (runner.nudgedUntilMs !== null) {
      if (session.nowMs < runner.nudgedUntilMs) return false;
      runner.nudgedUntilMs = null;
    }

    const targetId = follow.kind === 'leader' ? (this.#leader(session)?.id ?? null) : follow.characterId;
    const target = targetId === null ? null : findById(session.participants, targetId);

    // Alvo ausente: nunca deveria chegar aqui por morte ou saída — `#interruptFollowersOf` já
    // reportou no MESMO evento em que o alvo saiu (`onLeave`) —, mas cair no mesmo `false` por
    // segurança nunca escolhe outro, que é a garantia que importa.
    if (target === null || target.id === character.id) return false;

    const from = character.position;

    if (!sameFloor(from.z, target.position.z)) {
      const stair = floorChangeToward(this.#world.map, from.z, target.position.z);
      if (stair === null) {
        this.#reportFollow(session, runner, character.id, target.id, false, 'unreachable');
        return false;
      }
      // O DESTINO da escada — não o tile dela — decide se ela está livre (#527, achado numa QA
      // ao vivo com o plano de bot real: `greedyStep` só confere ocupação do tile da escada em
      // si, que quase nunca tem ninguém em cima; quem rejeita pelo tile de CHEGADA ocupado é
      // `move`/`canOccupy`, chamado só DEPOIS — e o ramo abaixo devolvia esse resultado sem
      // tratar, tentando o MESMO passo rejeitado a cada vencimento, para sempre, sem nunca
      // cair nem no `#clearCompanionsAround` nem na válvula de último recurso, porque os dois
      // só rodavam quando `greedyStep` devolvia `null` — nunca quando devolvia um tile que
      // `#step` recusaria por outro motivo). Checar aqui, ANTES do passo guloso, faz a escada
      // ocupada virar exatamente o mesmo "empacado" de parede — o mesmo caminho de espera +
      // pedir passagem + válvula de último recurso já cobre os dois, e ninguém trava para
      // sempre tentando repisar um degrau cuja chegada está ocupada.
      const landing = floorChangeAt(this.#world.map, stair.x, stair.y, from.z);
      const landingBlocked = landing !== null && this.#world.occupied(landing.x, landing.y, landing.z);
      const to = landingBlocked
        ? null
        : this.#followStep(session, runner, from, stair, this.#blockedFor(character), true, null, false);
      if (to === null) {
        // Empacado a caminho da escada (parede, companheiro, monstro): espera, e PERMANECE
        // seguindo — nunca desiste para ir caçar sozinho em outro andar por um bloqueio
        // PASSAGEIRO (#527, revisto depois de uma QA ao vivo: dar as costas ao líder por causa
        // de um bloqueio de segundos tirava o seguidor do andar do líder sem ele nunca mais
        // voltar — uma party de Tibia não se separa assim). Se o bloqueio for um companheiro,
        // pede que abra espaço — a MESMA saída que desempata a party inteira cercando o líder
        // na rota; sem isto, três seguidores satisfeitos podem ocupar os únicos tiles livres ao
        // redor de um QUARTO que também está tentando atravessar a mesma escada.
        this.#clearCompanionsAround(session, character, stair);
        // `crossFloorStuckSinceMs` só existe como VÁLVULA DE ÚLTIMO RECURSO — não a saída
        // corriqueira que era antes (30 s, quase toda travessia real esbarrava nela e o
        // seguidor desistia rotineiramente, exatamente o abandono que a QA ao vivo flagrou).
        // Um bloqueio que sobrevive a `#clearCompanionsAround` por MINUTOS é parede/monstro,
        // não companheiro — cede à própria rota só quando esperar deixou de ser plausível.
        const stuckSince = runner.crossFloorStuckSinceMs ?? session.nowMs;
        runner.crossFloorStuckSinceMs = stuckSince;
        if (session.nowMs - stuckSince >= MAX_CROSS_FLOOR_STUCK_MS) {
          runner.crossFloorStuckSinceMs = null;
          this.#reportFollow(session, runner, character.id, target.id, false, 'unreachable');
          return false;
        }
        this.#reportFollow(session, runner, character.id, target.id, true);
        return null;
      }
      runner.crossFloorStuckSinceMs = null;
      // Ainda seguindo — só navegando até a escada, não interrompido. `d === 1`/parado não se
      // aplica aqui: a distância contra um alvo em OUTRO andar não diz nada sobre proximidade.
      this.#reportFollow(session, runner, character.id, target.id, true);
      runner.walker.stop();
      const crossingResult = this.#step(session, character, { ...to, z: from.z }, character.id);
      if (crossingResult.ok) this.#advanceFollowPath(runner, to);
      else runner.followPath = null;
      return crossingResult;
    }

    const d = distance(from, target.position);
    const radius = this.#options.targetSearchRadius ?? 8;

    // A distância RAW (Chebyshev) não é monotônica ao longo de um caminho do BFS — rodear uma
    // parede pode AUMENTAR a distância em linha reta antes de diminuir (#527, achado com o bot
    // config real: o Druid tomava o primeiro passo de um desvio de dez passos, a distância raw
    // subia de 8 para 9 — um a mais que `radius`/`targetSearchRadius` —, e `d > radius`
    // desistia do follow exatamente no meio da travessia, jogando fora o caminho já calculado e
    // caindo para a PRÓPRIA rota, sem nada a ver com onde o líder está). `FOLLOW_UNREACHABLE_SLACK`
    // é a folga — pequena e FIXA, não "sempre que houver cache" (essa versão inicial soltava o
    // teto de desistência por completo sempre que um caminho velho continuasse por perto,
    // deixando seguidores genuinamente perdidos NUNCA desistirem, e a coesão da varredura
    // desabou) — o bastante para um desvio típico não estourar o alcance, sem apagar o teto.
    if (d > radius + FOLLOW_UNREACHABLE_SLACK) {
      this.#reportFollow(session, runner, character.id, target.id, false, 'unreachable');
      return false;
    }
    // Em alcance: reporta a RETOMADA se estava interrompido (não-op se já estava ativo). Fica
    // ANTES do "já adjacente" porque retomar e já estar adjacente são independentes: o alvo pode
    // ter voltado ao alcance parado.
    this.#reportFollow(session, runner, character.id, target.id, true);

    // O tile em que o ALVO vai pisar no PRÓXIMO passo da rota DELE nunca é destino válido para
    // quem o segue (#527, achado numa QA ao vivo com o plano de bot real: quatro seguidores
    // convergindo por `greedyStep` podem ficar satisfeitos — `d === 1` — sentados exatamente
    // nos tiles à volta do líder, e num corredor de 1 tile o ÚNICO tile adjacente na direção em
    // que o líder anda É o próximo tile da rota dele. `d === 1` já significa "parado" — sem
    // isto, o seguidor nunca mais sai dali, e o líder fica cercado pelo próprio bloco a hunt
    // inteira, porque nudge/`#clearCompanionsAround` só reage DEPOIS que o líder já tentou e
    // falhou, e num corredor sem outra saída eles também falham). Reservar aqui é PROATIVO: o
    // seguidor nunca escolhe esse tile como destino, então nunca precisa ser desalojado dele.
    const reserved = this.#reservedRouteTile(target);
    const onReserved = reserved !== null
      && from.x === reserved.x && from.y === reserved.y && from.z === reserved.z;

    if (d === 1 && !onReserved) return null;

    const base = this.#blockedForGroundedStep(character);
    const blocked: Blocked = reserved === null
      ? base
      : (x, y, z, monsterId) => base(x, y, z, monsterId)
        || (x === reserved.x && y === reserved.y && (z ?? from.z) === reserved.z);

    // Guloso primeiro; só quando ele emperra o BFS limitado entra (`#followStep`, #527, emenda
    // ao ADR 0009) — o corredor em U que uma QA ao vivo achou, onde os três candidatos do
    // guloso eram todos parede mas havia caminho livre pelo lado OPOSTO.
    const to = this.#followStep(session, runner, from, target.position, blocked, false, reserved, true);
    // Empacado — mesmo comportamento de `#holdPosture`: esperar este vencimento, não é
    // interrupção. "Sem caminho" vira `unreachable` só pela DISTÂNCIA (acima), não por um passo
    // bloqueado — senão contornar uma parede piscaria o follow a cada vencimento. Já em cima do
    // tile reservado e sem candidato livre: espera ali mesmo (ainda adjacente ao líder) até o
    // próximo vencimento, nunca fica MAIS longe só para desocupar.
    if (to === null) return null;

    runner.walker.stop();
    const result = this.#step(session, character, { ...to, z: from.z }, character.id);
    if (result.ok) this.#advanceFollowPath(runner, to);
    else runner.followPath = null;
    return result;
  }

  /**
   * O caminho para um `walk-to` DISTANTE (#763, achado do QA da #730). O MESMO BFS limitado do
   * follow (`boundedPath`, `route/pathfind.ts`, ADR 0009 emenda) — reaproveita a legalidade de
   * `canOccupy`/`MovementWorld` (parede, fora do mapa, ocupação, troca de andar), com UMA
   * exceção: uma porta FECHADA do overlay de sessão (#728) é tratada como PASSÁVEL aqui, porque
   * quem percorre o caminho a abre sozinha ao chegar (`#advanceManualWalk`, a MESMA automação do
   * walker de rota em `#playerStep` — `isDoorKind`, nunca grama/stone-pile, que exigem
   * ferramenta e nunca abrem "de passagem"). Troca de andar fica de fora do caminho: o destino
   * de um `walk-to` é sempre do MESMO `z` do personagem (`requestMove` já fixa isso), e deixar o
   * BFS atravessar uma escada faria um clique perto dela levar para outro andar sem o jogador
   * ter pedido isso.
   *
   * `null` é "fora do raio ou sem caminho" — quem chama (`requestMove`) devolve a recusa tipada
   * `unreachable` (RF-03 da spec): destino genuinamente inalcançável não pode deixar o pedido
   * pendurado sem resposta.
   */
  #planManualWalk(from: FloorPoint, to: GridPoint): readonly GridPoint[] | null {
    // `from` é sempre `character.position` (#519: personagem carrega `z` de verdade, nunca
    // ausente) — o `?? this.#world.map.z` é só para o tipo, como em `#followStep`.
    const z = from.z ?? this.#world.map.z;
    const pathBlocked: Blocked = (x, y) => {
      if (this.#world.occupied(x, y, z)) return true;
      if (this.#world.floorChangeAt(x, y, z) !== null) return true;
      const override = this.#tileOverrides.at({ x, y, z });
      if (override !== null && override.blocked) return !isDoorKind(override.kind);
      return isBlocked(this.#world.map, x, y, z);
    };
    return boundedPath(from, isExactly(to), pathBlocked, MANUAL_WALK_PATHFIND_RADIUS);
  }

  /**
   * Avança o caminho manual pendente (#763): um tile por vencimento, pela MESMA fila de eventos
   * do resto do motor (invariante 2) — nunca o caminho inteiro de uma vez. Chamado tanto por
   * `requestMove` (o primeiro passo, na hora do pedido) quanto por `#playerStep` (os seguintes).
   *
   * Uma porta fechada no próprio caminho é aberta aqui, do MESMO jeito que o walker de rota abre
   * a dela em `#playerStep` — `#planManualWalk` já a tratou como passável, então a única forma
   * dela continuar bloqueada agora é o personagem não cumprir o requisito (chave, nível, quest):
   * aí o caminho manual é ABANDONADO (o bot retoma sozinho no vencimento seguinte, pelo tile
   * mais próximo — o mecanismo que já existe), nunca preso esperando para sempre.
   */
  #advanceManualWalk(session: Session, character: CharacterRuntime): MoveResult | null {
    const runner = this.#runnerOf(character.id);
    const manual = runner.manualWalkTo;
    if (manual === null) return null;
    const next = manual.path[0];
    if (next === undefined) {
      // Chegou (RF-02): liga a janela de espera, e o vencimento seguinte já cai no
      // ramo de `manualWalkHoldUntilMs` de `#playerStep` — nenhuma andança nesta mesma chamada.
      runner.manualWalkTo = null;
      runner.manualWalkHoldUntilMs = session.nowMs + MANUAL_WALK_HOLD_MS;
      return null;
    }
    const at = { x: next.x, y: next.y, z: character.position.z };
    const blockingHere = this.#tileOverrides.at(at);
    if (blockingHere !== null && blockingHere.blocked) {
      if (this.#useInteractable(session, character, blockingHere.interactableId) === null) {
        // Sem ferramenta, level ou storage: o destino era alcançável no instante do pedido e
        // deixou de ser (alguém trancou a porta de novo). Desiste do caminho manual — não do
        // passo do personagem, que segue livre para a rota/bot no próprio vencimento.
        runner.manualWalkTo = null;
        return null;
      }
    }
    // `forced`: o passo de um caminho JÁ guardado continua a lista de passos do jogador
    // (`getNextStep`), que o `startAutoWalk` recusou no INÍCIO (`requestMove`, acima) e que nenhuma
    // condição de controle interrompe por conta própria — sob `feared` ela segue andando
    // (M44-04, #622: o pensamento do medo só foge quando restam menos de dois passos).
    const result = this.#step(session, character, at, character.id, true, true);
    if (result.ok) {
      runner.manualWalkTo = { destination: manual.destination, path: manual.path.slice(1) };
    } else if (result.reason === 'rooted') {
      // Preso no meio do caminho (M44-04, #622): `Creature::onCreatureMove` zera a lista de passos
      // de quem está enraizado (`resetMovementState`, `creature.cpp:503`) e cada passo recusado
      // por `internalMoveCreature` sai dela de qualquer jeito — o caminho NÃO resiste à condição.
      // Sem isto o personagem retomava sozinho, ao fim da raiz, uma caminhada que ninguém mais
      // pediu. O bot retoma pelo tile mais próximo, como no abandono da porta trancada.
      runner.manualWalkTo = null;
    }
    // Recusado por outro motivo (tile temporariamente ocupado por outra criatura, por exemplo): o
    // caminho continua de pé, e o vencimento seguinte tenta o MESMO tile de novo — a mesma
    // tolerância a bloqueio passageiro que a rota autorada já tem, nunca um recálculo a cada
    // tentativa.
    return result;
  }

  /**
   * (Re)inicia a janela de pausa do bot (#763, `MANUAL_WALK_HOLD_MS`) — chamada por toda
   * intenção manual que a spec lista: `openCorpse`, `takeLoot`, `#useItemLike`
   * (`useItem`/`useItemOn`) e `useOnMap`. SEMPRE (re)inicia, mesmo sem um caminho manual
   * anterior — achado de QA ao vivo: um cadáver já adjacente (sem nunca ter passado por
   * `requestMove`) abria a janela do `open-corpse` normalmente, mas o bot seguia livre para
   * andar embora ATRÁS do jogador porque nenhuma pausa nunca tinha sido armada; dois segundos
   * depois o `take-loot` batia em `too-far-away`, porque o bot já tinha levado o personagem para
   * a rota. A intenção manual em SI — abrir o cadáver, usar o item — já é o que deveria segurar
   * o bot, com ou sem `walk-to` antes dela.
   */
  #armManualWalkHold(characterId: string, nowMs: number): void {
    const runner = this.#runners.get(characterId);
    if (runner === undefined) return;
    runner.manualWalkHoldUntilMs = nowMs + MANUAL_WALK_HOLD_MS;
  }

  /**
   * O passo em direção a `goal` para o FOLLOW (#527, emenda ao ADR 0009 —
   * `docs/adr/0009-fixed-hunt-route-without-pathfinding.md`): guloso primeiro — resolve a
   * esmagadora maioria dos casos, O(1), sem estado —, e só quando ele emperra (devolve `null`,
   * empacado contra parede) entra o BFS limitado em cache (`FOLLOW_PATHFIND_RADIUS`,
   * `route/pathfind.ts`). Achado numa QA ao vivo: um corredor em U onde os três candidatos do
   * guloso eram todos parede, mas havia caminho livre pelo lado OPOSTO — sem isto, o seguidor
   * fica visivelmente perto (8 tiles) e nunca anda, até a válvula de regroup soltar o líder.
   *
   * `exact` pede pisar EXATAMENTE em `goal` (a escada que o follow vai atravessar); sem
   * `exact`, o alvo é ficar ADJACENTE a ele (o alvo seguido, cujo tile ninguém pode ocupar).
   *
   * O cache é validado contra a posição ATUAL antes de ser usado — não só contra o alvo: um
   * `from` que se moveu por fora (o guloso resolvendo sozinho por vários vencimentos, um
   * empurrão) deixa `path[0]` do cache velho sem ser mais adjacente a onde o personagem está
   * agora, e usá-lo assim tentaria um passo `not-adjacent`. Mais barato invalidar e recalcular
   * do que arriscar isso.
   */
  #followStep(
    session: Session, runner: Runner, from: FloorPoint, goal: FloorPoint, blocked: Blocked,
    exact: boolean, reserved: FloorPoint | null, grounded: boolean,
  ): GridPoint | null {
    // `blocked` (abaixo) é o predicado de `canOccupy` (#blockedFor/#blockedForGroundedStep) —
    // ele SEMPRE compara contra a posição ATUAL do personagem (`not-adjacent` quando o tile
    // pedido não é vizinho imediato dela), o que faz sentido para o passo guloso — que só
    // avalia os três vizinhos IMEDIATOS de `from` — mas quebra um BFS: ele avalia vizinhos dos
    // nós da FRENTE de busca, não de `from`, e todo tile a mais de um passo do personagem
    // voltaria "bloqueado" mesmo livre (achado depurando o teste desta issue: `blocked(10,2)`
    // devolvia `true` com `isBlocked`/ocupação/`floorChangeAt` todos `false` — só a distância
    // até a posição REAL do personagem, não a do tile explorado, é que reprovava). O BFS usa a
    // MESMA regra de passabilidade (parede, fora do mapa, ocupado, e as mesmas exceções de
    // `blocked` — reservado, aterrado), só que sem o gate de adjacência.
    // `from` é sempre `character.position` (#519: personagem carrega `z` de verdade, nunca
    // ausente) — o `?? this.#world.map.z` é só para o tipo, nunca alcançado na prática.
    const z = from.z ?? this.#world.map.z;
    const pathBlocked: Blocked = (x, y) => {
      if (this.#world.blockedAt(x, y, z) || this.#world.occupied(x, y, z)) return true;
      if (grounded && this.#world.floorChangeAt(x, y, z) !== null) return true;
      if (reserved !== null && x === reserved.x && y === reserved.y && z === reserved.z) return true;
      return false;
    };

    // O CACHE de um caminho já em andamento vence o guloso (#527) — não o contrário. Tentar o
    // guloso de novo a cada vencimento, mesmo com um caminho do BFS já resolvido, podia puxar
    // quem segue para um tile LOCALMENTE mais perto do alvo em linha reta mas que não leva a
    // lugar nenhum (o "bolso" à esquerda de uma QA ao vivo tinha vários desses) — abandonando o
    // caminho real, reiniciando o atraso e o BFS do zero, repetidas vezes, sem nunca terminar
    // de atravessar: o Druid ficou dois minutos "quase" chegando, sem nunca progredir de fato.
    // Com o caminho comprometido, o guloso só volta a decidir quando ELE (o cache) falhar.
    const cache = runner.followPath;
    const sameGoal = cache !== null
      && cache.goal.x === goal.x && cache.goal.y === goal.y && cache.goal.z === goal.z;
    if (sameGoal) {
      const next = cache.path[0];
      if (next !== undefined && distance(from, next) === 1 && !pathBlocked(next.x, next.y)) {
        runner.followStuckSinceMs = null;
        return next;
      }
      runner.followPath = null;
    }

    // O relógio de "empacado" conta a partir de PROGRESSO, não de "o guloso devolveu um tile"
    // (#527, achado com o bot config real: um bolso da Darashia Dragon Lair deixava o guloso
    // "ter sucesso" repetidas vezes, andando para dentro do bolso sem nunca se aproximar de
    // verdade do alvo — cada sucesso zerava o relógio antes dele acumular os
    // `FOLLOW_PATHFIND_DELAY_MS` seguidos que fariam o BFS entrar, e o Druid ficava minutos
    // "andando" sem nunca progredir). Só reduzir a distância RAW até o alvo conta como
    // progresso de verdade; um passo que anda para o lado ou para trás (o próprio caminho do
    // BFS pode fazer isso, contornando uma parede) não reseta o relógio — só não é o guloso
    // quem decide isso, e por isso o cache acima já zera o relógio só quando de fato avança.
    const beforeDistance = distance(from, goal);
    const direct = greedyStep(from, goal, blocked);
    if (direct !== null) {
      if (distance(direct, goal) < beforeDistance) runner.followStuckSinceMs = null;
      else runner.followStuckSinceMs ??= session.nowMs;
      return direct;
    }

    // Só entra no BFS depois de `FOLLOW_PATHFIND_DELAY_MS` de bloqueio/estagnação SEGUIDOS —
    // não na primeira falha (#527, `FOLLOW_PATHFIND_DELAY_MS`): um monstro ou companheiro
    // momentaneamente no caminho resolve sozinho, e path-find nele produzia um desvio inútil
    // pela masmorra em vez de uma espera curta.
    const stuckSince = runner.followStuckSinceMs ?? session.nowMs;
    runner.followStuckSinceMs = stuckSince;
    if (session.nowMs - stuckSince < FOLLOW_PATHFIND_DELAY_MS) return null;

    const isGoal = exact ? isExactly(goal) : isAdjacentTo(goal);
    const path = boundedPath(from, isGoal, pathBlocked, FOLLOW_PATHFIND_RADIUS);
    if (path === null || path.length === 0) return null;
    runner.followPath = { goal: { ...goal }, path };
    return path[0] ?? null;
  }

  /**
   * Consome o tile de `to` do cache do caminho do follow, se ele bater com o topo — mantém o
   * resto do BFS já calculado para o vencimento seguinte, em vez de refazer a busca a cada
   * passo. Qualquer outra coisa (o guloso resolveu direto, o tile não bate) invalida o cache:
   * mais barato recalcular do zero do que arriscar seguir um caminho que não é mais o de agora.
   */
  #advanceFollowPath(runner: Runner, to: GridPoint): void {
    const cache = runner.followPath;
    if (cache === null) return;
    const head = cache.path[0];
    if (head !== undefined && head.x === to.x && head.y === to.y) {
      runner.followPath = { goal: cache.goal, path: cache.path.slice(1) };
    } else {
      runner.followPath = null;
    }
  }

  /**
   * O tile `to` — a rota PRÓPRIA do personagem, não um passo de follow — é uma escada que leva
   * para um andar DIFERENTE do alvo seguido agora? (#527) `false` sem follow configurado: quem
   * não segue ninguém (o líder de verdade) sempre pode atravessar pela própria rota. Ver o
   * chamador, no ramo "ninguém ao alcance: anda" de `#playerStep`.
   */
  #crossesAwayFromLeader(
    session: Session, runner: Runner, character: CharacterRuntime, to: FloorPoint,
  ): boolean {
    const follow = runner.botConfig?.follow;
    if (follow === undefined || follow.kind === 'none') return false;
    const change = floorChangeAt(this.#world.map, to.x, to.y, character.position.z);
    if (change === null) return false;
    const targetId = follow.kind === 'leader' ? (this.#leader(session)?.id ?? null) : follow.characterId;
    const target = targetId === null ? null : findById(session.participants, targetId);
    if (target === null || target.id === character.id) return false;
    return change.z !== target.position.z;
  }

  /**
   * Há follow ativo para alguém em OUTRO andar agora? (#527) Usado só para decidir se o
   * combate pode segurar o personagem no topo de `#playerStep` — repete a mesma busca de alvo
   * do início de `#holdFollow` de propósito: são poucas linhas, e as duas listas de motivo
   * para "não" (sem follow, alvo ausente) precisam concordar — divergir aqui deixaria o
   * combate segurar um seguidor que `#holdFollow` trataria como "sem follow nenhum".
   */
  #mustCrossFloorToFollow(session: Session, runner: Runner, character: CharacterRuntime): boolean {
    const follow = runner.botConfig?.follow;
    if (follow === undefined || follow.kind === 'none') return false;
    const targetId = follow.kind === 'leader' ? (this.#leader(session)?.id ?? null) : follow.characterId;
    const target = targetId === null ? null : findById(session.participants, targetId);
    if (target === null || target.id === character.id) return false;
    return !sameFloor(character.position.z, target.position.z);
  }

  /**
   * O próximo tile da ROTA do alvo seguido — `null` quando o alvo não anda rota nenhuma (ele
   * próprio está em follow de outra pessoa, ou não tem `walker` relevante aqui). Ver o
   * chamador (`#holdFollow`, ramo do mesmo andar) para o porquê de reservar.
   */
  #reservedRouteTile(target: CharacterRuntime): FloorPoint | null {
    const targetRunner = this.#runnerOf(target.id);
    const targetFollow = targetRunner.botConfig?.follow;
    if (targetFollow !== undefined && targetFollow.kind !== 'none') return null;
    const ahead = targetRunner.walker.ahead(1);
    return { ...ahead, z: target.position.z };
  }

  /**
   * O tile reservado do LÍDER da party especificamente (#527) — não "de quem eu sigo agora"
   * (`#reservedRouteTile`, usado só dentro de `#holdFollow`), mas do líder mesmo quando ESTE
   * personagem não está em follow ativo no momento. A rota é UMA SÓ, compartilhada pelos
   * quatro, e um corredor estreito pode aparecer nela em índices BEM diferentes — achado numa
   * QA ao vivo com o plano de bot real: (56,30)/(56,31) na Darashia Dragon Lair aparece em três
   * pontos da rota (índices ~44–46, ~165–168, ~1451–1454), cada um numa direção diferente. Um
   * seguidor pode chegar no tile que travaria o líder por um caminho que NUNCA passa por
   * `#holdFollow` — a PRÓPRIA rota dele (quando `d > radius` desiste de seguir) tem essa MESMA
   * coordenada em ALGUM índice próprio, sem nenhuma relação com o índice atual do líder; ou um
   * nudge que abria espaço para outra coisa pode, por coincidência, largar alguém bem ali.
   * `null` para o próprio líder (sempre livre para a própria rota) e para quem está em outro
   * andar (a reserva só faz sentido no mesmo andar do líder).
   */
  #leaderReservedTile(session: Session, character: CharacterRuntime): FloorPoint | null {
    // Só entra em jogo para quem TEM follow configurado — nunca para uma hunt de vários
    // personagens andando a MESMA rota sem nenhuma relação de líder (`follow.kind: 'none'` em
    // todo mundo, como em `hunt.test.ts`). `#leader(session)` sempre devolve alguém (cai para
    // `participants[0]` sem `#party`), e sem este guarda qualquer hunt de andar único viraria
    // "ninguém pode pisar onde o primeiro personagem vai pisar" — a MESMA regressão que
    // `#hasActiveFollow` existe para evitar em `#clearCompanionsAround`.
    const follow = this.#runnerOf(character.id).botConfig?.follow;
    if (follow === undefined || follow.kind === 'none') return null;
    const leader = this.#leader(session);
    if (leader === undefined || leader.id === character.id) return null;
    if (!sameFloor(character.position.z, leader.position.z)) return null;
    return this.#reservedRouteTile(leader);
  }

  /** `to`/`tile` é o tile reservado do líder (#527)? Comparação de coordenadas, sem alocar. */
  #isLeaderReservedTile(reserved: FloorPoint | null, tile: FloorPoint): boolean {
    return reserved !== null && tile.x === reserved.x && tile.y === reserved.y && tile.z === reserved.z;
  }

  /**
   * O LÍDER deve segurar o próprio passo de rota para a party se reagrupar? (#527) `false` para
   * quem não lidera ninguém (`#leader(session)` sempre devolve alguém — cai para
   * `participants[0]` sem `#party` — mas um seguidor não tem "a party" para esperar, ele É quem
   * se junta) e para quem lidera mas não tem NENHUM seguidor configurado (uma hunt de andar
   * único sem follow, a mesma exceção de `#leaderReservedTile`/`#hasActiveFollow`).
   *
   * O raio exigido é mais apertado (`PARTY_REGROUP_FLOOR_CHANGE_RADIUS`) quando `to` é o tile
   * de ORIGEM de uma escada — atravessar andar é exatamente como a party se perde de vista: um
   * seguidor a 6 tiles ainda no MESMO andar se recupera sozinho em poucos passos, mas um que
   * fica para trás quando o líder já trocou de andar precisa da travessia INTEIRA de
   * `#holdFollow` para alcançar de novo, minutos depois.
   *
   * `MAX_REGROUP_WAIT_MS` é a válvula de último recurso (mesmo espírito de
   * `MAX_CROSS_FLOOR_STUCK_MS`): um seguidor genuinamente perdido não pode travar o líder — e a
   * hunt inteira atrás dele — para sempre.
   */
  #partyRegroupBlocked(
    session: Session, runner: Runner, character: CharacterRuntime, to: FloorPoint,
  ): boolean {
    const leader = this.#leader(session);
    if (leader === undefined || leader.id !== character.id) return false;
    const followers = session.participants.filter((p) => {
      if (p.id === character.id || !p.alive) return false;
      const follow = this.#runnerOf(p.id).botConfig?.follow;
      return follow !== undefined && follow.kind !== 'none';
    });
    if (followers.length === 0) return false;

    const crossingFloor = floorChangeAt(this.#world.map, to.x, to.y, character.position.z) !== null;
    // FOLGADO em relação ao raio de follow de cada seguidor (#527, `PARTY_REGROUP_MARGIN`),
    // nunca mais apertado — um raio menor que `targetSearchRadius` é o que produzia o impasse
    // mútuo que motivou a emenda.
    const followRadius = (this.#options.targetSearchRadius ?? 8) + PARTY_REGROUP_MARGIN;
    const radius = crossingFloor ? PARTY_REGROUP_FLOOR_CHANGE_RADIUS : followRadius;
    const cohesive = followers.every((follower) => sameFloor(follower.position.z, character.position.z)
      && distance(character.position, follower.position) <= radius);
    if (cohesive) {
      runner.regroupSinceMs = null;
      return false;
    }

    const since = runner.regroupSinceMs ?? session.nowMs;
    runner.regroupSinceMs = since;
    if (session.nowMs - since >= MAX_REGROUP_WAIT_MS) {
      runner.regroupSinceMs = null;
      return false;
    }
    return true;
  }

  /**
   * Emite `follow-state` só na TRANSIÇÃO (§D10: "uma vez"). `runner.followInterrupted` é o que
   * faz cada chamada custar uma comparação em vez de um evento — `#holdFollow` chama isto a CADA
   * vencimento enquanto o alvo está em alcance, e só a primeira depois de uma mudança produz
   * `session.emit`.
   */
  #reportFollow(
    session: Session, runner: Runner, characterId: string, targetId: string, active: boolean,
    reason?: 'dead' | 'left' | 'unreachable',
  ): void {
    // A verdade ATUAL é gravada ANTES do curto-circuito de transição: o evento só sai uma vez,
    // mas o `followStateOf` precisa responder "onde o Follow está agora" mesmo quando nada mudou
    // desde o último vencimento (#401).
    runner.followTargetId = targetId;
    runner.followReason = active ? undefined : reason;
    if (runner.followInterrupted === !active) return;
    runner.followInterrupted = !active;
    session.emit({
      kind: 'follow-state', characterId, targetId, active,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  /**
   * O estado ATUAL do Follow de um personagem (#401), para o hospedeiro reenviar a quem
   * reconecta. O evento `follow-state` só é emitido na TRANSIÇÃO (#398), e sem visualizador ele
   * é descartado pelo hospedeiro — esta leitura síncrona é o que faz a verdade sobreviver ao
   * descarte (invariante 3), em vez de o host guardar uma segunda cópia do estado.
   *
   * `undefined` sem Follow configurado (`kind: 'none'`) ou sem alvo resolvido ainda — os dois
   * casos em que o cliente não tem nada a corrigir.
   */
  followStateOf(characterId: string): {
    readonly active: boolean;
    readonly targetId: string;
    readonly reason?: 'dead' | 'left' | 'unreachable';
  } | undefined {
    const runner = this.#runners.get(characterId);
    if (runner === undefined) return undefined;
    const follow = runner.botConfig?.follow;
    if (follow === undefined || follow.kind === 'none') return undefined;
    const targetId = runner.followTargetId
      ?? (follow.kind === 'member' ? follow.characterId : this.#party?.leaderId);
    if (targetId === undefined) return undefined;
    const active = !runner.followInterrupted;
    return {
      active,
      targetId,
      ...(active || runner.followReason === undefined ? {} : { reason: runner.followReason }),
    };
  }

  /**
   * O alvo de um follow saiu da sessão (§D10, #398): quem o seguia é interrompido AGORA, no mesmo
   * evento da saída — é o único lugar em que dá para diferenciar `'dead'` de `'left'`, porque
   * `character.alive` já está `false` antes de `onLeave` rodar. `kind: 'leader'` usa
   * `this.#party?.leaderId` — o valor de ANTES desta saída, porque #394 só o reescreve depois, em
   * `#flushLoss` — para saber se o `departed` ERA o líder.
   */
  #interruptFollowersOf(session: Session, departed: CharacterRuntime): void {
    const reason = departed.alive ? 'left' : 'dead';
    const wasLeader = departed.id === this.#party?.leaderId;
    for (const [followerId, runner] of this.#runners) {
      const follow = runner.botConfig?.follow;
      if (follow === undefined || follow.kind === 'none') continue;
      const followedId = follow.kind === 'leader'
        ? (wasLeader ? departed.id : null)
        : follow.characterId;
      if (followedId !== departed.id) continue;
      this.#reportFollow(session, runner, followerId, departed.id, false, reason);
    }
  }

  /**
   * O jogador salvou uma configuração nova no meio da hunt (FUN-81, §13).
   *
   * Recompila e passa a valer NA HORA. Esperar a próxima hunt seria o jogador corrigir a regra
   * de cura enquanto o personagem morre — e a configuração é dado puro, então recompilar não
   * tem risco nenhum.
   *
   * Quem chama é a sessão dona, nunca outro processo (invariante 9). As regras de saída são
   * recompiladas junto: elas vêm da mesma configuração, e deixar as antigas valendo faria a
   * hunt encerrar por uma regra que o jogador acabou de apagar.
   */
  configureBot(session: Session, config: BotConfigInput, characterId?: string): void {
    // De QUEM (#203): por id, ou o primeiro participante — o caminho solo de sempre.
    const character = characterId === undefined
      ? session.participants[0]
      : findById(session.participants, characterId) ?? undefined;
    if (character === undefined) return;
    const runner = this.#runnerOf(character.id);
    // v1 no boundary vira v2 (DT-02); a config guardada é a v2, para o snapshot já sair no
    // vocabulário novo.
    const normalized = migrateBotConfigV1(config);
    runner.botConfig = normalized;
    runner.bot = compileBot(normalized, this.#cooldownOf);
    runner.automations = compileAutomations(normalized.automations);
    runner.actuator = this.#automationActuatorFor(runner, character);
    // Grupo NOVO (a config antiga não o tinha) nasce ENGATILHADO: `#armBot` só toca os
    // engatilhados, e sem esta linha a regra recém-configurada nunca acordaria.
    for (const group of runner.bot.groups.keys()) {
      if (runner.botReady[group] === undefined) runner.botReady[group] = true;
    }
    runner.exitRules = this.#composeExitRules(normalized);
    // Grupo que ganhou regra agora precisa acordar. `#armBot` só toca os ENGATILHADOS, e os
    // que já tinham evento pendente seguem com ele — a invariante "engatilhado ou agendado"
    // continua valendo do outro lado de uma troca de configuração. Um grupo que SAIU da config
    // tem `botReady` órfão, e o evento pendente dele vence sem achar slots: não faz nada.
    if (character.alive) {
      this.#autoSelectTarget(session, character);
      this.#armBot(session, character.id);
      this.#armAutomations(session, character.id);
    }
  }

  /**
   * Acorda o bot de um personagem cuja CAPACIDADE mudou por fora dele (#624): ele aprendeu uma
   * magia no meio da hunt (`learn-spell` é aceito nela, ADR 0052 d.4), e a regra que o bot vinha
   * PULANDO — recusa sem prazo, `spell-not-learned` — está engatilhada esperando o mundo mudar.
   * Sem isto, uma cura recém-aprendida só voltaria a valer no próximo dano recebido, e uma de
   * suporte talvez nunca. É o mesmo `#armBot` que dano, mana e troca de configuração já chamam:
   * só toca grupo ENGATILHADO (quem tem evento pendente já vai vencer), e a reavaliação é um
   * evento na fila no instante lógico atual — nada por tick, e o mesmo a 1 Hz e a 10 Hz.
   */
  rearmBot(session: Session, characterId: string): void {
    if (findById(session.participants, characterId) === null) return;
    this.#armBot(session, characterId);
  }

  /**
   * Um jogador pediu para andar (FUN-69). Mesmo caminho do bot, mesma razão de recusa.
   *
   * Não mexe no walker: se o passo tirou o personagem da rota, o vencimento seguinte de
   * `PLAYER_STEP` descobre e reentra pelo tile mais próximo. Mas o passo manual É um passo
   * (FUN-122): o próximo vencimento do bot conta a partir dele. Sem isto, o `PLAYER_STEP` já
   * agendado — com a cadência do passo anterior — vencia logo depois, e o personagem dava
   * dois passos dentro da duração de um.
   *
   * `to` DISTANTE (#763, achado do QA da #730): antes, só o tile ADJACENTE era aceito — um
   * `walk-to` para um cadáver a seis tiles nunca chegava, e o cliente (que só manda intenção e
   * espera o servidor decidir, invariante 4) ficava esperando um passo que nunca vinha.
   * `#planManualWalk` calcula o caminho com o BFS limitado do follow; sem caminho dentro do
   * raio, a recusa é `unreachable` — TIPADA, para o bot nunca ficar esperando uma resposta que
   * não vem (RF-03). Um `to` ADJACENTE continua o de sempre (compatível com seta/clique de um
   * tile) e CANCELA um caminho manual em curso — é intenção nova, sobrepõe a anterior, como o
   * cliente já cancela o próprio pedido de aproximação por qualquer outra ação.
   */
  requestMove(session: Session, characterId: string, to: GridPoint): MoveResult {
    const character = findById(session.participants, characterId);
    if (character === null) return { ok: false, reason: 'tile-blocked' };
    if (this.#occupancyStale) this.#rebuildOccupancy(session);
    const runner = this.#runnerOf(characterId);
    // Preso ou com medo, o jogador não escolhe o caminho (M44-04, #622): `startAutoWalk` recusa
    // ANTES de guardar qualquer caminho — recusar aqui evita um `walk-to` distante ficar guardado
    // no runner (`manualWalkTo`) para andar sozinho quando a condição acabar.
    const refusal = this.#controlRefusal(character, session.nowMs);
    if (refusal !== null) return { ok: false, reason: refusal };
    // Uma caminhada forçada que sobrou depois do fim do medo cede ao pedido do jogador: um
    // `startAutoWalk` novo limpa `listWalkDir` no Canary.
    runner.fearWalk = null;
    const from = character.position;
    const adjacent = Math.abs(to.x - from.x) <= 1 && Math.abs(to.y - from.y) <= 1;

    let result: MoveResult;
    if (adjacent) {
      runner.manualWalkTo = null;
      runner.manualWalkHoldUntilMs = null;
      result = this.#step(session, character, { ...to, z: from.z }, characterId);
    } else {
      const path = this.#planManualWalk(from, to);
      if (path === null) return { ok: false, reason: 'unreachable' };
      runner.manualWalkTo = { destination: { ...to, z: from.z }, path };
      // O primeiro tile SAI já neste pedido — o mesmo "responde na hora" do caso adjacente;
      // os seguintes vêm de `#playerStep`, um por vencimento (invariante 2).
      result = this.#advanceManualWalk(session, character) ?? { ok: false, reason: 'tile-blocked' };
    }

    if (result.ok) {
      const runner = this.#runners.get(characterId);
      if (runner !== undefined) runner.sameTileStreak = 0;
      session.cancelEvent(PLAYER_STEP, characterId);
      session.scheduleIn(PLAYER_STEP, result.durationMs, {
        priority: EventPriority.Movement, subject: characterId,
      });
      this.#autoSelectTarget(session, character);
      this.#armPlayerAttack(session, character);
      this.#armBot(session, character.id);
    }
    return result;
  }

  /**
   * O ataque do personagem venceu: um golpe, no que estiver ao alcance agora.
   *
   * Sem alvo, o golpe fica ENGATILHADO em vez de ser desperdiçado, e o evento não é
   * reagendado — quem o traz de volta é `#armPlayerAttack`, no instante em que alguém entra
   * no alcance. Um cooldown que corre no vazio faria o dano do personagem depender de o
   * respawn cair em fase com um relógio, o que é aleatório e invisível: medido na fixture do
   * critério de saída da Fase 1, custava o dobro de encontros por minuto e matava um
   * personagem que antes sobrevivia à hunt inteira.
   */
  #onPlayerAttack(session: Session, characterId: string): void {
    const character = findById(session.participants, characterId);
    if (character === null || !character.alive) return;

    const target = this.#attackTarget(character);
    if (target === null) {
      this.#runnerOf(characterId).playerAttackReady = true;
      return;
    }

    if (!this.#isPinned(character)) {
      const runner = this.#runners.get(characterId);
      if (runner !== undefined && runner.attackTarget !== target.subject) {
        this.setAttackTarget(character, target, false);
      }
    }

    // `pacified` (#554, M30-07, ADR 0040 decisão 1; a condição de verdade desde o M44-04, #622 —
    // `Player::doAttacking` volta antes de qualquer golpe, `player.cpp:3982`): sem golpe, e SEM
    // re-armar — a cadeia de golpes do Canary morre ali, e o golpe volta no primeiro gatilho
    // depois do vencimento (`#parkAttack`). A trava de escada só existe no `combat-v3`, então
    // v1/v2 nunca entram aqui — a menos que o CONTEÚDO aplique `pacified` por outro caminho (o
    // Swift Foot).
    const pacified = character.conditions.get(PACIFIED_CONDITION_KEY);
    if (pacified !== null && pacified.expiresAtMs > session.nowMs) {
      this.#parkAttack(session, character, pacified.expiresAtMs);
      return;
    }

    this.#schedulePlayerAttack(session, characterId, this.#options.player.attackIntervalMs);
    // `combat-v3` (#687): a arma que ficou na mão abaixo do level exigido — o level caiu com
    // ela vestida — bate metade com `wieldUnproperly`, ou NÃO bate (`damagePercent` 0): como o
    // `useWeapon` do Canary que devolve `false`, sem golpe de punho e sem prática. v1/v2 leem
    // `weapon()` como sempre, e a arma abaixo do level segue virando mão vazia (ADR 0031).
    let weapon: Item | null;
    let damagePercent = 100;
    if (this.#isV3()) {
      const held = character.inventory.heldWeapon(this.#options.items, character);
      if (held !== null && held.damagePercent === 0) return;
      weapon = held?.item ?? null;
      damagePercent = held?.damagePercent ?? 100;
    } else {
      weapon = character.inventory.weapon(this.#options.items, character);
    }
    const how = weapon?.weapon;
    // Wand sem mana NÃO bate (#152): o golpe fica agendado para o intervalo seguinte, e sai
    // quando a mana tiver voltado. Não consome mana, não rende skill — como a magia recusada.
    if (how?.kind === 'wand' && character.mana < (how.manaPerHit ?? 0)) return;
    const used = this.#strike(session, character, target, weapon, how, damagePercent);
    // O `Player::updateLastAttack` do Canary (M30-03, #550): só quando a arma foi usada, e DEPOIS
    // do golpe — o reflexo que o golpe provocou ainda enxerga a janela anterior, como lá. Só o
    // `combat-v3` lê este carimbo (o fator de defesa da postura); nos perfis anteriores o
    // snapshot continua sem ele.
    if (used && this.#isV3()) character.lastAttackAtMs = session.nowMs;
    // Quem aplica dano não decide morte: o pipeline resolve quem matou e devolve a
    // consequência a `onCreatureDied`, o mesmo caminho da morte do personagem.
    if (!target.alive) resolveDeath(session, { kind: 'monster', monster: target });
  }

  /**
   * Agenda o golpe do personagem e DESENGATILHA, numa operação só.
   *
   * A invariante é "engatilhado OU agendado, nunca os dois": um golpe engatilhado com evento
   * pendente vira dois ataques por intervalo, que é o dobro do dano. Ela mora aqui, e não na
   * memória de quem escreve a próxima chamada.
   */
  #schedulePlayerAttack(session: Session, characterId: string, delayMs: number): void {
    this.#runnerOf(characterId).playerAttackReady = false;
    session.scheduleIn(PLAYER_ATTACK, delayMs, {
      priority: EventPriority.Attack, subject: characterId,
    });
  }

  /** O mesmo do lado do monstro, e pela mesma razão. */
  #scheduleMonsterAttack(session: Session, monster: MonsterRuntime, delayMs: number): void {
    monster.attackReady = false;
    session.scheduleIn(MONSTER_ATTACK, delayMs, {
      priority: EventPriority.Attack, subject: monsterSubject(monster.id),
    });
  }

  /**
   * Alguém entrou no alcance e o golpe estava engatilhado: ele sai AGORA.
   *
   * Chamado de onde uma criatura pode ter chegado perto — o passo do personagem e o
   * nascimento de um monstro. Não do passo de cada monstro: ali seria uma varredura por
   * monstro por passo, e o custo por instância é o número que a FUN-46 cobra.
   */
  /**
   * Um grupo do bot venceu: percorre os slots na ORDEM da barra (RP-002) e executa o primeiro
   * ELEGÍVEL (RP-001). O inelegível é PULADO no MESMO ciclo (RP-003/RP-004).
   *
   * O reagendamento depende do que aconteceu, e a distinção importa:
   *
   * - **executou** → volta no cooldown do GRUPO (do conteúdo), não num 1 s fixo. É o rate limit
   *   do ADR 0032 d.2, e ele conta a partir da AÇÃO, não do relógio de parede;
   * - **nenhum slot elegível** → ENGATILHA, exceto a recusa por COOLDOWN, que volta no
   *   vencimento do livro que trancou. Um grupo que reagenda no vazio é um evento por segundo
   *   por personagem gasto para descobrir que não há nada a fazer.
   *
   * Atuador que recusa (sem mana, sem item, sem alvo) NÃO consome o cooldown: o próximo slot do
   * MESMO grupo tenta agora (RP-004). Sem mana não melhora com o tempo passar, então a recusa
   * por falta ENGATILHA ao fim do laço.
   */
  #onBot(session: Session, group: string, characterId: string): void {
    const character = findById(session.participants, characterId);
    if (character === null) return;
    const runner = this.#runnerOf(characterId);
    runner.botReady[group] = true;
    const bot = runner.bot;
    if (bot === undefined || !character.alive) return;

const slots = bot.groups.get(group);
    if (slots === undefined) return;
    // A view é montada UMA vez por vencimento: todos os slots do grupo decidem sobre o MESMO
    // instante. Reavaliar por slot depois de uma recusa é o atuador que decide, não o mundo.
    // O alcance é o do GRUPO (#444): um grupo com runa enxerga a 8, não no alcance da arma.
    const reach = this.#groupRange(slots, character);
    const view = this.#botViewOf(character, reach);
    const external = this.#options.actuator;

    let retryInMs = 0;
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i] as CompiledSlot;
      // O `targets` é da AÇÃO avaliada, não do grupo (#480): uma runa de área conta quem cai
      // no FOOTPRINT dela sobre o alvo primário, e uma ação sem área no alcance. Recalcular
      // por slot evita que o slot seguinte herde a contagem do anterior — a view é a mesma, o
      // instante é o mesmo, só a mira muda.
      view.targetCount = this.#targetCountFor(
        character, reach, this.#actionArea(slot.act), this.#actionRange(slot.act),
      );
      // Alvo != self resolve o RECIPIENTE ANTES de avaliar: a condição `hp` lê o CANDIDATO, e o
      // slot pode valer para ele mesmo com o lançador de vida cheia (§26-30, ADR 0035 d.10).
      // Tenta os candidatos NA ORDEM em que chegaram (já rankeada por `#resolveRuleTarget`) e
      // para no primeiro cujo `when` vale — o "usa o primeiro válido" do §29.
      let recipient = character;
      if (slot.target.kind !== 'self') {
        const candidates = this.#resolveRuleTarget(session, character, slot);
        let matched = false;
        for (let j = 0; j < candidates.length; j += 1) {
          const candidate = candidates[j] as CharacterRuntime;
          view.partyTarget = candidate;
          if (slot.when(view)) { recipient = candidate; matched = true; break; }
        }
        view.partyTarget = null;
        if (!matched) continue;
      } else {
        view.partyTarget = null;
        if (!slot.when(view)) continue;                  // condição falsa → PULA (RP-003)
      }
      if (external !== undefined) {
        if (!external.perform(slot.act, view)) continue; // recusou → próximo no mesmo ciclo
        this.#scheduleBot(session, group, characterId, this.#botCooldownMs());
        return;
      }
      // A exaustão de ação compartilhada (#690): a poção logo depois de uma runa ESPERA — o
      // "adiar" do `playerUseItemEx` do Canary é a volta no vencimento, como a recusa por
      // cooldown. Nada é pago nem sorteado antes dela.
      const exhaustWait = this.#actionExhaustWaitOf(character, slot.act, session.nowMs);
      if (exhaustWait > 0) {
        if (exhaustWait > retryInMs) retryInMs = exhaustWait;
        continue;
      }
      const result = this.#perform(session, character, slot.act, recipient);
      if (result.ok) {
        // O grupo trancou: o próximo vencimento é o cooldown DELE (do conteúdo), não um 1 s
        // fixo. A magia já iniciou `group:<g>` no `castSpell`; o item sem livro cai no fallback.
        const wait = character.cooldowns.remainingMs(slot.cooldownKey, session.nowMs);
        this.#scheduleBot(session, group, characterId, wait > 0 ? wait : this.#botCooldownMs());
        // A ação mudou HP, mana ou gold: o que está engatilhado reavalia AGORA, sobre o mundo
        // já resolvido. Uma poção de mana que não acorda a cura é o bot esperando dano novo
        // para usar a mana que acabou de repor.
        this.#armBot(session, characterId);
        // As automações (AB-08) reagem ao mesmo mundo: o anel sai quando a cura devolve o HP,
        // ou quando a magia derruba a mana abaixo do piso — os dois lados da máquina do §13.8
        // dependem do que a ação acabou de mudar.
        this.#armAutomations(session, character.id);
        return;
      }
      // Recusa: o próximo slot do MESMO grupo tenta agora. Só a recusa por COOLDOWN carrega
      // prazo; ela é lembrada para o reagendamento caso nenhum outro slot execute.
      if (result.retryInMs > retryInMs) retryInMs = result.retryInMs;
    }
    // Nenhum elegível: recusa por cooldown volta no vencimento; as outras ENGATILHAM.
    if (retryInMs > 0) this.#scheduleBot(session, group, characterId, retryInMs);
  }

  /**
   * Executa a ação escolhida pelo bot (FUN-74, FUN-77).
   *
   * É o `BotActuator` embutido, e mora aqui — e não numa classe à parte — porque tudo o que
   * ele precisa é da hunt: o alvo mais próximo, o RNG semeado da sessão, o relógio lógico e o
   * pipeline de morte. Uma classe separada receberia os quatro por parâmetro e não ganharia
   * nada em troca.
   */
  #perform(
    session: Session, character: CharacterRuntime, action: BotAction | BotActionV2,
    recipient: CharacterRuntime = character,
    explicit?: MonsterRuntime | FloorPoint,
  ): CastResult {
    switch (action.kind) {
      // `monsterId` (#598, M38-01, ADR 0057 decisão 4) só existe no vocabulário v2 — a v1 não
      // sabe invocar, e `'monsterId' in action` é o que deixa a v1 passar por aqui sem o campo.
      case 'spell': return this.#castSpell(
        session, character, action.spellId, recipient, explicit,
        'monsterId' in action ? action.monsterId : undefined,
      );
      case 'supply': return this.#useSupply(session, character, action.supplyId, recipient, explicit);
      // O item de slot saiu no vocabulário v2 (AB-03): o consumível abstrato é `supply`, com
      // gold no uso, e o item de equipamento é das automações.
      case 'item': return NOT_IN_CATALOG;
    }
  }

  /**
   * Alcance do EFEITO de cura da ação — nunca o de ataque. `null` quando a ação não é magia/
   * supply de cura, OU o efeito é `self`-only: é a checagem em profundidade do RF-05
   * (`validateBotConfig` já recusa a combinação na configuração; aqui a resposta é "sem
   * candidato", nunca uma exceção — a mesma filosofia de toda outra recusa deste arquivo).
   */
  #healRangeOf(action: BotAction): number | null {
    if (action.kind === 'spell') {
      const effect = this.#options.spells.get(action.spellId)?.effect;
      if (effect === undefined || effect.kind !== 'heal' || effect.target !== 'friend') return null;
      return effect.range ?? null;
    }
    if (action.kind === 'supply') {
      const effect = this.#options.supplies.get(action.supplyId)?.effect;
      if (effect === undefined || (effect.kind !== 'heal' && effect.kind !== 'mana')
        || effect.target !== 'friend') {
        return null;
      }
      return effect.range ?? null;
    }
    return null;
  }

  /**
   * Traduz o `target` de um `use-slot` manual (D11, ADR 0049 decisão 2) em recipiente de aliado
   * OU alvo explícito de monstro/posição, ou recusa tipada.
   *
   * `null`: a ação não é mirável — nem `friend` (cura/suporte) nem dano — e `target` é ruído,
   * ignorado sem recusa nenhuma (RF-12 da spec da #725); inclui a magia/runa de área centrada no
   * LANÇADOR, porque `#needsTarget` já devolve `false` para ela (RF-13).
   */
  #resolveManualTarget(
    session: Session, character: CharacterRuntime, action: BotAction, target: UseSlotTarget | undefined,
  ): { ok: true; recipient?: CharacterRuntime; explicit?: MonsterRuntime | FloorPoint }
    | { ok: false; reason: SlotRefusal } | null {
    // Find Person (#623): o "nome" do Canary é o personagem que o jogador MIROU. O alvo vira o
    // `recipient` — o mesmo canal da cura de amigo —, e qualquer outra mira (monstro, tile, criatura
    // que já saiu de vista, ninguém) é o nome que `getPlayerByNameWildcard` não acha. Essa recusa
    // NÃO sai daqui: no Canary ela vem DEPOIS de `playerSpellCheck` (exaustão, level, mana, alma) e
    // INICIA o cooldown da magia e do grupo (`playerCastInstant` chama `applyCooldownConditions`
    // antes de cancelar). Sem `recipient`, o `castSpell` recebe "ninguém nomeado" (o próprio
    // lançador) e `#utilityRefusalOf` devolve `person-not-found` no ponto certo da ordem.
    const findEffect = action.kind === 'spell' ? this.#options.spells.get(action.spellId)?.effect : undefined;
    if (findEffect?.kind === 'find' && findEffect.target === 'person') {
      if (target === undefined || target.kind !== 'character') return { ok: true };
      const member = findById(session.participants, target.characterId);
      if (member === null || !member.alive) return { ok: true };
      return { ok: true, recipient: member };
    }
    const healRange = this.#healRangeOf(action);
    if (healRange !== null) {
      // Ação de ALIADO: sem `target`, cai no default — `#perform` já assume `recipient =
      // character` (curar A SI MESMO, como hoje, RF-12).
      if (target === undefined) return null;
      if (target.kind === 'invalid') return { ok: false, reason: 'no-target' };
      if (target.kind !== 'character') return null; // mira de monstro/posição não se aplica
      const member = findById(session.participants, target.characterId);
      if (member === null || !member.alive) return { ok: false, reason: 'no-target' };
      if (!sameFloor(character.position.z, member.position.z)
        || distance(character.position, member.position) > (healRange || 1)) {
        return { ok: false, reason: 'out-of-range' };
      }
      return { ok: true, recipient: member };
    }

    const damageEffect = action.kind === 'spell'
      ? this.#options.spells.get(action.spellId)?.effect
      : action.kind === 'supply'
        ? this.#options.supplies.get(action.supplyId)?.effect
        : undefined;
    if (damageEffect === undefined || !this.#needsTarget(damageEffect)) return null;
    if (target === undefined) return null;
    if (target.kind === 'invalid') return { ok: false, reason: 'no-target' };
    if (target.kind === 'character') return null; // não se aplica — ignorado (RF-12)
    if (target.kind === 'monster') {
      const monster = this.#monsterBySubject.get(target.subject);
      if (monster === undefined || !monster.alive) return { ok: false, reason: 'no-target' };
      // A invocação (#598, ADR 0057) nunca é alvo válido de fogo amigo — nem por
      // auto-target (`#hostileMonsters`), nem por clique explícito: o cliente manda intenção
      // (invariante 4), e a mira num aliado é sempre inválida, o mesmo `no-target` de "sem
      // alvo. Para efeito de DANO vale para a invocação de QUALQUER jogador, não só a do próprio
      // personagem (#600): no mundo no-pvp o Canary recusa o ataque a `target->isSummon() &&
      // targetMasterPlayer` (`Combat::canTargetCreature`), e uma área centrada nela acertaria o dono.
      // A Convince Creature fica de fora: mirar a invocação alheia chega ao script, que recusa
      // `not-possible` (`target:getMaster()`).
      const hurts = damageEffect.kind === 'damage' || damageEffect.kind === 'damage-over-time';
      if (monster.masterId === character.id || (hurts && typeof monster.masterId === 'string')) {
        return { ok: false, reason: 'no-target' };
      }
      // Monstro invisível (#559). No Canary o cliente NUNCA recebe a criatura que o jogador não
      // enxerga (`ProtocolGame::canSee` → `Player::canSeeCreature`, `player.cpp:1418`), então não
      // há clique nela; o tile continua clicável, e o que o servidor decide é só o que a mira no
      // TILE faz (`Spell::playerRuneSpellCheck`, `spells.cpp:704`): a runa que precisa de alvo
      // (`needTarget`: Sudden Death, Fireball, Paralyze…) recusa o tile sem criatura VISÍVEL
      // (`CANONLYUSETHISRUNEONCREATURES`), e a que não precisa (Great Fireball, Avalanche, os
      // campos…) sai do mesmo jeito e atinge quem estiver lá — invisível inclusive, revelando-o.
      // O cliente do Draconya ainda DESENHA o monstro invisível (a apresentação não some com ele),
      // então este clique existe aqui; o `no-target` do efeito de alvo único é o substituto do
      // filtro de apresentação do Canary, e o efeito de área/campo mira o tile do monstro, como o
      // jogador faria ali. Não é regra de caça: a matemática é a do Canary nos dois casos.
      if (monster.invisible) {
        return this.#isSingleTargetEffect(damageEffect)
          ? { ok: false, reason: 'no-target' }
          : { ok: true, explicit: this.#at(monster) };
      }
      return { ok: true, explicit: monster };
    }
    return { ok: true, explicit: target.position };
  }

  /**
   * Os candidatos de uma regra com alvo != self (D11, ADR 0035 decisão 10).
   *
   * `member` usa SÓ o id pedido: morto, fora da sessão ou fora do alcance devolve lista vazia e
   * a regra não age (§30 — nunca substitui por outro vivo). `lowest-hp-member` devolve todo
   * participante vivo ao alcance ordenado por percentual ASCENDENTE (§28); o próprio lançador
   * entra como candidato de si mesmo, então numa hunt solo "menor vida da party" é ele.
   *
   * Confere o andar (#519) antes do alcance: a hunt hospeda um personagem só hoje (§14 — party
   * é Fase 3), então isto é código morto POR ENQUANTO — mas os três andares da Darashia Dragon
   * Lair compartilham a mesma caixa (x, y), e sem a checagem um curandeiro curaria (ou um
   * `heal-friend` miraria) um companheiro dois andares acima só por coincidência de coordenada,
   * a primeira vez que uma party entrar numa hunt multiandar.
   */
  #resolveRuleTarget(
    session: Session, character: CharacterRuntime, rule: CompiledSlot,
  ): readonly CharacterRuntime[] {
    const range = this.#healRangeOf(rule.act);
    if (range === null) return NO_CANDIDATES;

    if (rule.target.kind === 'member') {
      const member = findById(session.participants, rule.target.characterId);
      if (member === null || !member.alive) return NO_CANDIDATES;
      if (!sameFloor(character.position.z, member.position.z)) return NO_CANDIDATES;
      if (distance(character.position, member.position) > range) return NO_CANDIDATES;
      return [member];
    }

    // `session.participants` já está na ordem de entrada, e `Array#sort` é ESTÁVEL: o desempate
    // cai de graça.
    return session.participants
      .filter((p) => p.alive && sameFloor(character.position.z, p.position.z)
        && distance(character.position, p.position) <= range)
      .sort((a, b) => percentOf(a.health, a.maxHealth) - percentOf(b.health, b.maxHealth));
  }

  /**
   * Acorda o bot de todo participante com ao menos uma regra heal/potion/support de alvo !=
   * self — não só de quem apanhou (RF-06). Custo N por golpe, só com party (ADR 0035,
   * consequências: "aceito").
   */
  #armHealersOf(session: Session): void {
    if (session.participants.length <= 1) return;
    for (const participant of session.participants) {
      const runner = this.#runners.get(participant.id);
      if (runner === undefined || runner.bot === undefined || runner.botConfig === undefined) continue;
      if (hasNonSelfHealRule(runner.botConfig)) this.#armBot(session, participant.id);
    }
  }

  /**
   * Lança a magia. O alvo é o mesmo do golpe — o monstro mais próximo —, e o alcance é o da
   * MAGIA, não o da arma: uma magia de alcance 3 alcança de onde o corpo a corpo não alcança.
   */
  #castSpell(
    session: Session, character: CharacterRuntime, spellId: string,
    recipient: CharacterRuntime = character,
    explicit?: MonsterRuntime | FloorPoint,
    /**
     * O PARÂMETRO da invocação (#598, M38-01, ADR 0057 decisão 4) — "Summon Creature com
     * parâmetro": qual `summonable` a barra pediu. Sem uso em qualquer outra magia.
     */
    monsterId?: string,
  ): CastResult {
    // A ocupação pode estar VAZIA logo depois de restaurar um snapshot (`#occupancyStale`, remontada
    // no primeiro evento ou em `requestMove`). Levitate e Magic Rope leem (`utilityRefusalOf`) e
    // ESCREVEM (`relocate`) a posição, e um `use-slot` do espectador chega entre eventos — sem a
    // remontagem, o salto cairia num tile de outro personagem, e o `#rebuildOccupancy` seguinte
    // marcaria os dois no mesmo tile (a mesma guarda de `requestMove`).
    if (this.#occupancyStale) this.#rebuildOccupancy(session);
    const spell = this.#options.spells.get(spellId);
    if (spell === undefined) return NOT_IN_CATALOG;

    // A invocação (#598) sai do caminho genérico ANTES da mira/cura em área — nenhuma das duas
    // se aplica a `summon` — e confere o que só o RULESET sabe (catálogo de monstro, teto de
    // invocações vivas): `casting.ts` não conhece nem um nem o outro (invariante 1).
    let summonMonster: Monster | undefined;
    if (spell.effect.kind === 'summon') {
      summonMonster = monsterId === undefined ? undefined : this.#options.monsters.get(monsterId);
      if (summonMonster === undefined || !summonMonster.summonable) return NOT_SUMMONABLE;
      if (this.#playerSummonCountOf(character.id) >= PLAYER_SUMMON_CAP) return NOT_SUMMONABLE;
    }

    // Dispel em ÁREA (#592, Cancel Invisibility): a forma sai do LANÇADOR, como a cura em grupo
    // — `#aimFor` entra pelo ramo self-origin e colhe os MONSTROS na forma em `#spellHits`, sem
    // mirar ninguém. Sem monstro na forma, `aim` vem `null` e nada é dispensado: a magia sai
    // igual (gasta a mana, rende a skill), e o lançador nunca é o alvo do dispel (ver abaixo).
    const aim = spell.effect.kind === 'damage'
      ? this.#aimFor(character, spell.effect.range, spell.effect.area, explicit)
      : spell.effect.kind === 'damage-over-time'
        ? this.#aimFor(character, spell.effect.range, undefined, explicit)
        : (spell.effect.kind === 'dispel' && spell.effect.area !== undefined)
          ? this.#aimFor(character, undefined, spell.effect.area)
          : spell.effect.kind === 'challenge'
            ? this.#aimFor(character, spell.effect.range, spell.effect.area, explicit)
            : null;
    // Cura em ÁREA (Mass Healing, #475): a forma sai do lançador e os aliados são colhidos
    // ANTES de emitir, como a mira de dano — a ordem dos alvos é contrato de RNG.
    const healArea = spell.effect.kind === 'heal'
      && spell.effect.area !== undefined && isSelfOrigin(spell.effect.area)
      ? this.#collectHealAllies(session, character, spell.effect.area)
      : null;
    // Alvo de party (#588: Heal/Protect/Enchant/Train Party) — o RAIO, não uma forma: quem cai
    // dentro dele é o roster inteiro da sessão (líder incluso), como `Party::onCastSpell` do
    // Canary. Colhido ANTES de `castSpell` pela MESMA razão da área de cura: só quem tem
    // `session.participants` sabe quem está no alcance.
    const partyAllies = (spell.effect.kind === 'heal-over-time' || spell.effect.kind === 'buff')
      && spell.effect.target === 'party'
      ? this.#collectPartyAllies(session, character, spell.effect.range ?? 0)
      : null;

    const result = castSpell(
      character, spell, aim, session.nowMs, this.#options.combat, session.rng,
      this.#spellScaling(character), recipient, this.#attackerModifiers(character), partyAllies,
      // Bolsa default (solo); o `manaCost` REAL da invocação é do MONSTRO (ADR 0057 d.3).
      undefined, summonMonster?.manaCost,
      // As utilitárias (#623) recusam pelo que só este ruleset vê — mapa, overlay e sessão.
      this.#utilityRefusalOf(character, spell.effect, recipient),
    );
    if (!result.ok) return result;
    // A magia SAIU: a mana gasta é o que ela rende de skill (§9.4) — o custo REAL: o do
    // MONSTRO na invocação (#598), escalado pela party quando for o caso (#588), nunca o
    // `base` de exibição do catálogo. Recusa não rende nada — não gastou mana, não praticou.
    const manaCost = summonMonster?.manaCost ?? (typeof spell.manaCost === 'number'
      ? spell.manaCost
      : partyScaledManaCost(spell.manaCost, partyAllies?.length ?? 0));
    this.#gainSkills(session, character, 'spell-cast', manaCost);
    // O gold da runa em branco (#594, ADR 0044) é agregado da SESSÃO.
    if (result.goldSpent > 0) session.credit(character.id, 'goldSpent', result.goldSpent);
    // A invocação nasce AQUI, depois que tudo o resto já confirmou (#598).
    if (result.summon === true && summonMonster !== undefined) {
      this.#spawnPlayerSummon(session, character, summonMonster);
    }
    // As utilitárias (#623) agem ANTES do `spell-cast`: o Levitate e o Magic Rope desenham o
    // efeito de teleporte no tile de CHEGADA (`creature:getPosition():sendMagicEffect` roda depois
    // do `move`), e o `casterPosition` do evento é lido logo abaixo.
    this.#applyUtilityEffect(session, character, spell.effect, recipient, result);

    // UMA vez, ANTES dos golpes (FUN-109): o cliente desenha o efeito no lançador e nos alvos
    // e só depois faz cada número cair. A ordem é contrato.
    //
    // `targets` é um vetor NOVO, e não `#spellHits`: aquele é reaproveitado e limpo a cada
    // lançamento, e o evento é drenado pelo hospedeiro DEPOIS — quando `#spellHits` já seria a
    // mira da magia seguinte. É a única alocação por lançamento que este arquivo faz de
    // propósito, e ela é do tamanho da mira.
    session.emit({
      kind: 'spell-cast', casterId: character.id, spellId: spell.id,
      casterPosition: this.#at(character),
      targets: aim !== null
        ? this.#spellHits.map((m) => ({ creatureId: m.subject, position: this.#at(m) }))
        : partyAllies !== null
          ? partyAllies.map((ally) => ({ creatureId: ally.id, position: this.#at(ally) }))
          : healArea === null
            ? NO_SPELL_TARGETS
            : this.#healAllies.map((ally) => ({ creatureId: ally.id, position: this.#at(ally) })),
      // Os tiles da forma (#155): vetor NOVO pela razão de `targets`. Alvo de party não tem
      // forma — é raio, não área — e não desenha tile nenhum.
      tiles: aim === null ? (healArea ?? NO_TILES) : [...this.#aimTiles],
    });
    // Dispel (#590): o `castSpell` devolve as CHAVES a remover, e quem tem a fila (para
    // cancelar `condition-expire`/`condition-tick`) é o ruleset — a mesma divisão da condição
    // abaixo. Vale para o RECIPIENTE: o mesmo alvo que a cura composta cura, quando há cura.
    // Dispel em ÁREA (#592, Cancel Invisibility) vale para os MONSTROS colhidos na forma, em vez
    // do recipiente único de sempre — e SÓ para eles (#559). `Combat::CombatFunc` (`combat.cpp:
    // 1562`/`1610`) só inclui o lançador quando `!params.aggressive`, e o `combat` do Cancel
    // Invisibility nunca chama `COMBAT_PARAM_AGGRESSIVE` — o `spell:isAggressive(false)` do
    // script é o `Spell::aggressive` do portão de proteção, outro campo —, então vale o default
    // do Canary (`CombatParams::aggressive = true`): `caster != creature`, o lançador NUNCA é
    // atingido, e outro jogador só o seria com as regras de PvP (`canDoCombatWithExpertPvp`),
    // que a hunt não tem (invariante 8: instanciada, PvE). Quem ficou invisível pelo Invisibility
    // (`utana vid`) continua invisível depois do próprio Cancel Invisibility.
    if (result.dispel !== undefined) {
      if (spell.effect.kind === 'dispel' && spell.effect.area !== undefined) {
        for (const monster of this.#spellHits) this.#dispelConditions(session, monster, result.dispel);
      } else {
        this.#dispelConditions(session, recipient, result.dispel);
      }
    }
    // Condição (#155, CMB-07): o `castSpell` devolve, e quem agenda é quem tem a fila. O DOT
    // mira o ALVO principal da mira; haste, postura, magic shield e Recovery valem no LANÇADOR
    // — ou em CADA membro da party colhido acima (#588), a MESMA condição, sem sorteio por
    // membro (os números do script são fixos: regen 20/2s, shielding +3, magic +1, melee/
    // distance +3).
    if (result.condition !== undefined) {
      if (partyAllies !== null) {
        for (const ally of partyAllies) {
          this.#applyConditionTo(session, ally, {
            ...result.condition,
            targetId: this.#subjectOf(ally),
            sourceId: character.id,
          });
        }
        return result;
      }
      const target: ConditionTarget | undefined = result.condition.tick?.kind === 'damage'
        ? this.#spellHits[0]
        : character;
      if (target !== undefined) {
        this.#applyConditionTo(session, target, {
          ...result.condition,
          targetId: this.#subjectOf(target),
          sourceId: character.id,
        }, true);
        // As condições extras do mesmo lançamento (o `pacified` do Swift Foot, M44-04, #622).
        for (const extra of result.alsoConditions ?? []) {
          this.#applyConditionTo(session, target, {
            ...extra, targetId: this.#subjectOf(target), sourceId: character.id,
          });
        }
      }
      return result;
    }
    // Remoção sem evento (#596: Cancel Magic Shield) — sem `expiresAtMs` a agendar, só a
    // `Conditions` do PRÓPRIO lançador a apagar na hora.
    if (result.removeConditionKey !== undefined) {
      character.conditions.remove(result.removeConditionKey);
      return result;
    }
    if (aim === null) {
      // o efeito prometia — e de vida cheia é zero, sem número nenhum a flutuar. O anúncio é do
      // RECIPIENT: curar um amigo acende a barra dele, não a de quem lançou. O HPS, ao
      // contrário, é de QUEM lançou (#431) — por isso o `character.id` como curador.
      this.#emitHealed(session, recipient, result.healed, 'spell', character.id);
      // Mass Healing: os ALIADOS na forma, um a um, na ordem dos participantes. Cada um consome
      // uma rolagem (o contrato do dano em área), e o conjurador é pulado porque o `castSpell`
      // já o curou. Overheal rende zero e nenhum evento sai.
      if (healArea !== null && spell.effect.kind === 'heal') {
        const scaling = this.#spellScaling(character);
        for (const ally of this.#healAllies) {
          if (ally === character || !ally.alive) continue;
          const healed = executeHealing(
            character, ally, spell.effect, scaling, this.#options.combat, session.rng,
          );
          this.#emitHealed(session, ally, healed, 'spell', character.id);
          // Cura composta em área (#592, Mass Healing): CADA aliado curado perde as MESMAS
          // chaves que o `recipient` principal perdeu — a mesma regra de dispel de sempre, só
          // que aplicada de novo por aliado, porque o `result.dispel` do lançamento só cobre o
          // recipiente único.
          if (spell.effect.dispel !== undefined) {
            this.#dispelConditions(session, ally, spell.effect.dispel.types);
          }
        }
      }
      return result;
    }

    // Provocação (#589): NÃO passa por `#applyHits` — não há dano nenhum a resolver, só a
    // troca forçada de alvo e a suspensão de fuga em cada monstro atingido.
    if (spell.effect.kind === 'challenge') {
      this.#applyChallenge(session, character, spell.effect.durationMs);
      return result;
    }

    this.#applyHits(session, character, result.hits, result.hitOutcomes ?? []);
    return result;
  }

  /**
   * A recusa das magias utilitárias (#623), ou `null` quando a magia pode sair — PURA: não muda
   * nada e não consome sorteio, porque `slotStates` (a apresentação) a chama pelo espelho
   * (`#naturalStateOf`) e o `castSpell` a recebe como `preflight`, ANTES de gastar a mana.
   *
   * - **Levitate:** sem destino pelas regras de `levitateDestination` → `not-possible`.
   * - **Magic Rope:** fora de um rope spot → `not-possible` (o `isRopeSpot` do Canary; o overlay
   *   de cenário é quem sabe onde ele está); sem onde pousar → `not-enough-room`.
   * - **Find Person:** o alvo é o `recipient` (o personagem que o `use-slot` mirou); sem alvo — o
   *   `recipient` é o próprio lançador, o valor de "ninguém nomeado" — recusa `person-not-found`,
   *   o `RETURNVALUE_PLAYERWITHTHISNAMEISNOTONLINE` de `InstantSpell::playerCastInstant`. Esta é a
   *   ÚNICA recusa da família que INICIA o cooldown (o `castSpell` o faz, sem mana nem alma): no
   *   Canary o nome sem jogador roda `applyCooldownConditions` antes de cancelar, ao contrário das
   *   recusas dos scripts de Levitate, Magic Rope e Find Fiend. Procurar a si mesmo não é
   *   oferecido: a resposta seria sempre "ao lado de você".
   * - **Find Fiend:** nenhum monstro é fiendish — o Exaltation Forge (#616) está fora do catálogo
   *   por decisão do dono (2026-09-29) e `ForgeMonster:pickClosestFiendish` devolve `nil` num mundo
   *   sem ele, então a magia recusa como o Canary ("No creatures around"). Quando o Forge pousar,
   *   ESTE é o único ponto a ligar: um monstro fiendish achado troca a recusa pela mensagem.
   */
  #utilityRefusalOf(
    character: CharacterRuntime, effect: SpellEffect, recipient: CharacterRuntime,
  ): UtilityRefusal | null {
    switch (effect.kind) {
      case 'levitate':
        return levitateDestination(this.#world, this.#at(character), character.direction, effect.direction) === null
          ? 'not-possible' : null;
      case 'magic-rope': {
        const here = this.#at(character);
        if (this.#tileOverrides.at(here)?.kind !== 'rope-spot') return 'not-possible';
        return ropeDestination(this.#world, here) === null ? 'not-enough-room' : null;
      }
      case 'find':
        if (effect.target === 'person') return recipient === character ? 'person-not-found' : null;
        return 'no-creatures-around';
      default:
        return null;
    }
  }

  /**
   * O efeito das utilitárias (#623) DEPOIS de `castSpell` ter pago e iniciado o cooldown: mover,
   * dizer, criar. O que pode recusar já recusou em `#utilityRefusalOf` — o mapa não muda entre as
   * duas chamadas —, então o destino aqui é o mesmo que a pré-conferência aprovou.
   */
  #applyUtilityEffect(
    session: Session, character: CharacterRuntime, effect: SpellEffect, recipient: CharacterRuntime,
    result: CastSuccess,
  ): void {
    switch (effect.kind) {
      case 'levitate': {
        const to = levitateDestination(this.#world, this.#at(character), character.direction, effect.direction);
        if (to !== null) this.#jumpToApproved(session, character, to);
        return;
      }
      case 'magic-rope': {
        const to = ropeDestination(this.#world, this.#at(character));
        if (to !== null) this.#jumpToApproved(session, character, to);
        return;
      }
      case 'find':
        if (effect.target !== 'person') return;
        session.emit({
          kind: 'find-result', characterId: character.id, target: 'person', subjectId: recipient.id,
          relation: findRelation(this.#at(character), this.#at(recipient)),
        });
        return;
      case 'food':
        this.#createFood(session, character, result.foods ?? []);
        return;
      default:
    }
  }

  /**
   * O salto de uma utilitária cujo destino `#utilityRefusalOf` JÁ aprovou (#623). Recusar aqui é
   * impossível por construção: as duas chamadas rodam na mesma `#castSpell`, sem nada que mova
   * criatura, abra campo ou troque o overlay entre elas, e `levitateDestination`/`ropeDestination`
   * conferem tudo o que `relocate` confere (limites, bloqueio e ocupação). Se um dia recusar, a
   * magia já PAGOU mana, cooldown e skill por um salto que não aconteceu — calar isso era o defeito
   * que escondia o Magic Rope sobre tile ocupado —, então é erro de programação e falha alto, em
   * vez de cobrar do jogador um efeito que ele não recebeu.
   */
  #jumpToApproved(session: Session, character: CharacterRuntime, to: WorldPoint): void {
    if (!this.#relocateCharacter(session, character, to)) {
      throw new Error(
        `utility spell: the approved destination (${String(to.x)},${String(to.y)},${String(to.z)}) ` +
          `was refused for ${character.id}`,
      );
    }
  }

  /**
   * Instancia a comida da magia Food na mochila do lançador (#623) — o `creature:addItem` do
   * Canary. O mesmo caminho do prêmio de baú (`#useChest`): `instanceId` de `#newInstanceId`,
   * `inventory.add` com a capacidade do personagem, e é isso que faz o item atravessar
   * `SessionReceipt.acquired` até o ledger (invariante 10). O Canary, sem lugar na mochila,
   * larga o item no chão (`canDropOnMap` é `true` por padrão); este modelo não tem item no chão
   * além do cadáver (ADR 0048 d.8), então o que não coube SE PERDE — e é registrado, para o
   * extrato acusar a comida que não coube. O `equipment-changed` é a confirmação visível: o
   * cliente relê o `inventory`.
   */
  #createFood(session: Session, character: CharacterRuntime, foods: readonly string[]): void {
    const wearer = withReservedCapacity(character, 0);
    for (const itemId of foods) {
      const carried: CarriedItem = {
        instanceId: this.#newInstanceId(session, character), itemId, quantity: 1,
      };
      if (!character.inventory.add(carried, this.#options.items, wearer, this.#containerRules(character)).ok) {
        session.record('food-not-carried', itemId);
      }
    }
    session.emit({ kind: 'equipment-changed', characterId: character.id });
  }

  /**
   * Aplica Challenge/Chivalrous Challenge (#589, Canary `doChallengeCreature`/
   * `challengeFocusDuration`): força cada monstro atingido (`#spellHits`, já colhido por
   * `#aimFor`) a mirar quem lançou e agenda a condição `'challenge'`, que `isMonsterFleeing`
   * (`monster/monster.ts`) consulta para suspender a fuga enquanto ela durar. A escrita de
   * `targetId` é direta — como qualquer outro lugar que força alvo (#4900/#4946/#4984/#5232) —
   * porque é a sessão DONA quem escreve `MonsterRuntime` (invariante 9). Relançar no mesmo
   * monstro RENOVA o prazo: `merge` ausente é `'refresh'`, o default de `ConditionState`.
   */
  #applyChallenge(session: Session, character: CharacterRuntime, durationMs: number): void {
    for (const monster of this.#spellHits) {
      // `Monster::challengeCreature` só vale se `selectTarget(creature)` aceita — e `isTarget`
      // exige `canSeeCreature` (Canary `monster.cpp:3475`, `1435`): quem não "vê invisível" não é
      // provocado por um lançador invisível, e a fuga dele não é suspensa (#559).
      if (character.invisible) {
        const definition = this.#options.monsters.get(monster.monsterId);
        if (definition === undefined || !seesInvisible(definition)) continue;
      }
      monster.targetId = character.id;
      this.#applyConditionTo(session, monster, {
        key: CHALLENGE_CONDITION_KEY,
        targetId: this.#subjectOf(monster),
        sourceId: character.id,
        expiresAtMs: session.nowMs + durationMs,
      });
    }
  }

  /**
   * Colhe os membros da party no RAIO (#588: Heal/Protect/Enchant/Train Party) — `Party::
   * onCastSpell` do Canary: o roster inteiro da MESMA sessão (líder incluso — o lançador está a
   * distância 0 de si mesmo), vivos, no MESMO andar, dentro de `radius` tiles em distância
   * Chebyshev (`getDistance` do Canary, `distance()` deste motor — nunca Manhattan). Ordem de
   * `session.participants`, a mesma ordem-contrato de `#collectHealAllies`.
   *
   * Sem forma nenhuma — é raio, não área — e por isso não usa `areaTiles`/`isSelfOrigin`: as
   * quatro magias do Canary aplicam a condição a quem está no alcance, não a quem cai numa
   * geometria desenhada no chão (`AREA_CIRCLE5X5` do script é só o EFEITO visual, nunca lido
   * para decidir quem recebe).
   */
  #collectPartyAllies(
    session: Session, character: CharacterRuntime, radius: number,
  ): readonly CharacterRuntime[] {
    const allies: CharacterRuntime[] = [];
    for (const participant of session.participants) {
      if (!participant.alive) continue;
      if (!sameFloor(character.position.z, participant.position.z)) continue;
      if (distance(character.position, participant.position) > radius) continue;
      allies.push(participant);
    }
    return allies;
  }

  /**
   * Colhe os aliados de uma cura em área (#475): os participantes VIVOS cujo tile cai na forma
   * centrada no lançador, na ordem de `session.participants`. Devolve os tiles para o evento e
   * guarda os alvos em `#healAllies` — a mesma divisão de `#aimFor`.
   *
   * Só personagens entram: Mass Healing cura jogadores (e invocações, que o motor ainda não
   * tem), nunca monstros. A ordem é contrato, como a da área de dano.
   */
  #collectHealAllies(
    session: Session, character: CharacterRuntime, area: SpellArea,
  ): readonly WorldPoint[] {
    const tiles = areaTiles(area, character.position, character.direction);
    this.#healAllies.length = 0;
    const keys = new Set(tiles.map(tileKey));
    for (const participant of session.participants) {
      if (!participant.alive) continue;
      if (!keys.has(tileKey(this.#at(participant)))) continue;
      this.#healAllies.push(participant);
    }
    return tiles;
  }

  /**
   * Aplica os golpes de uma mira — magia (FUN-92) ou runa (#165) — depois de colher TODOS os
   * alvos, e não durante.
   *
   * `#onMonsterDied` faz `this.#monsters = this.#monsters.filter(...)`: resolver morte no
   * meio de uma varredura sobre `#monsters` é varrer um array que está sendo trocado, e os
   * alvos depois do que morreu ficariam de fora. Colher primeiro fecha essa porta.
   * Nenhum monstro entra duas vezes na mesma mira — o principal é excluído do laço da forma.
   *
   * Isso NÃO basta mais para garantir que um alvo colhido continua vivo quando chega a vez
   * dele: desde #546, matar um mestre invocador no meio deste laço cascateia em
   * `#removeSummon` para cada invocação dele (`#onMonsterDied` → mestre morto → invocações
   * somem), e uma invocação adjacente pode ter sido colhida por esta MESMA mira, num índice
   * posterior. `#removeSummon` tira a invocação de `#monsterBySubject`/`#monsters` sem tocar
   * `health`/`alive` (ela nunca morreu, ela sumiu) — o `MonsterRuntime` colhido continua
   * reportando `alive === true`. Sem a conferência abaixo, o laço aplicaria dano de novo nela,
   * emitiria `creature-hit` para um id que o cliente já viu sumir, e — se o dano zerasse a
   * vida — chamaria `resolveDeath` uma segunda vez sobre um monstro que não está em lugar
   * nenhum, o que credita abate duas vezes e libera de novo um tile que já foi liberado (e que
   * pode já ter outro ocupante).
   *
   * `hitOutcomes` (#547, M29-07 — achado da revisão do PR #648) é o `DamageOutcome` INTEIRO de
   * cada alvo, na mesma ordem de `hits` — e é ele, não `hits[i]`, que decide como o golpe é
   * APLICADO: `applyDamageOutcome` (CMB-08) é o único ponto que sabe desviar um
   * `damageType: 'manadrain'` para a MANA do alvo em vez da vida. Chamar `monster.receiveDamage`
   * direto aqui — como este método fazia antes — deixava a magia/runa de dano fora do desvio: um
   * conteúdo que declarasse `manadrain` bateria na vida do monstro como dano comum. `hits`
   * continua existindo só para o extrato (`bestSpellHit`), que quer o RESOLVIDO, nunca o
   * aplicado — a mesma distinção que `#land` já fazia para o golpe básico.
   */
  #applyHits(
    session: Session, character: CharacterRuntime, hits: readonly number[],
    hitOutcomes: readonly DamageOutcome[],
  ): void {
    // Leech (M30-04, #551): a MESMA ação de área divide pelo total de alvos atingidos
    // (`targetsAffected`), como o Canary faz em `Combat::doAreaCombatHealth`/`damage.affected`
    // — a fórmula é `calculateLeechAmount` (`combat/modifiers.ts`), nunca uma divisão simples.
    // Os modificadores são os da AÇÃO, lidos uma vez por `castSpell`/`useSupply` e carregados em
    // `outcome.intent.modifiers` — o Canary lê a skill uma vez por `doCombat`, não por alvo.
    // Quem aplica o leech é `applyDamageOutcome`, com o `targetsAffected` da mira: um caminho só,
    // o mesmo do `#land` — aplicar de novo aqui dobraria o leech de toda magia de dano.
    const targetsAffected = this.#spellHits.length;
    for (let i = 0; i < this.#spellHits.length; i += 1) {
      const monster = this.#spellHits[i] as MonsterRuntime;
      // A morte do mestre, resolvida num índice anterior deste MESMO laço, pode ter cascateado
      // e removido esta invocação (`#removeSummon`) antes de chegar a vez dela — ver o
      // comentário acima. Ela nunca zera `alive` ao sumir, então a checagem certa é presença no
      // índice vivo da instância, não `monster.alive`.
      if (this.#monsterBySubject.get(monster.subject) !== monster) continue;
      const outcome = hitOutcomes[i];
      // Defensivo: `hitOutcomes` nasce do MESMO laço que `hits` em `castSpell`/`useSupply`, os
      // dois sempre do mesmo tamanho — mas um índice sem outcome não aplica nada, em vez de
      // arriscar `undefined` em `applyDamageOutcome`.
      if (outcome === undefined) continue;
      const damage = hits[i] ?? 0;
      // Por ALVO, não a soma da área: "maior hit" é o maior golpe que alguém levou, e somar
      // uma área faria uma magia fraca em cinco alvos superar a mais forte do jogo em um.
      session.credit(character.id, 'bestSpellHit', damage);
      // Aplicar é também ATRIBUIR: o dano de magia conta para quem matou, como o do golpe. Um
      // `manadrain` sai daqui com `healthDamage: 0` sempre — a vida do monstro nunca se move.
      const applied = this.#drainMonster(session, monster, outcome, character, targetsAffected);
      // Magia e runa também passam pelo `blockHit` do alvo no Canary: um acerto limpo recarrega
      // os contadores de sangue e de escudo (#686). Não rendem try de ARMA — a prática delas é
      // de magia, por mana.
      this.#noteAttackBlock(character, outcome);
      // O DPS soma o APLICADO (#431), pela mesma razão do `#land`: a manopla do overkill não
      // entra na conta do dano causado.
      session.creditDamage(character.id, applied.healthDamage);
      recordDamage(monster.contribution, character.id, applied.healthDamage);
      this.#markCombatActive(session, character.id);
      // A definição única de "em combate" (#625): ataque DADO, ao contrário de
      // `Runner.lastCombatActionAtMs` (linha acima) que exclui self-heal — aqui não há cura
      // nenhuma para excluir, é sempre dano de magia num monstro.
      character.lastCombatActionAtMs = session.nowMs;
      // O golpe antes da barra, com o APLICADO — a mesma regra do `#strike`. O elemento
      // (#479) vai junto sempre: o efeito de dano SEMPRE declara um tipo.
      session.emit({
        kind: 'creature-hit', creatureId: monster.subject, attackerId: character.id,
        amount: applied.healthDamage, source: 'spell', position: this.#at(monster),
        damageType: outcome.damageType,
      });
      this.#emitHealth(session, monster);
      // Life leech (M30-04): o mesmo evento e a mesma base (`healthDamage`) do `#land` — nunca o
      // resolvido, overkill não rende leech. Mana leech repõe em silêncio, como lá.
      this.#emitHealed(session, character, applied.lifeLeechApplied, 'leech', character.id);
      // Reflexo e cura por elemento do monstro (#683) — o mesmo ponto do `#land`.
      this.#afterMonsterHit(session, character, monster, outcome);
      // Os charms do jogador (#603) — o mesmo ponto do `#land`, por alvo da magia/runa.
      this.#applyCharmsAfterHit(
        session, character, monster, applied.healthDamage, outcome.intent.extension === true,
      );
      if (!monster.alive) resolveDeath(session, { kind: 'monster', monster });
    }
  }

  /**
   * Colhe quem a magia atinge (FUN-92, #155): o alvo principal primeiro, depois quem cai na
   * forma. Sem área é alvo único — um caso do mesmo caminho, e não um ramo à parte.
   *
   * Duas famílias de forma (referência §19): a centrada no ALVO (alvo único, círculo no alvo)
   * passa por `selectTarget` com o alcance da MAGIA — não o da arma, que era o defeito da
   * FUN-74 —, e a que sai do LANÇADOR (onda, cleave, feixe, círculo em volta) não tem alvo
   * nem alcance: os tiles saem da posição e da DIREÇÃO do personagem, e `distance` vem zero.
   *
   * A ordem é CONTRATO: cada alvo consome uma rolagem do `Rng` da sessão, e ela é a ordem da
   * lista de monstros, que é a de nascimento. Trocar a ordem troca qual sorteio cai em quem, e
   * a mesma semente passa a render uma hunt diferente.
   *
   * Os vetores são REAPROVEITADOS, como `#botView` e `#spellTarget`. A única alocação por
   * lançamento é o `Set` de chaves da forma, do tamanho dela.
   *
   * `explicit` é a mira manual (ADR 0049 decisão 2): um `MonsterRuntime` (alvo apontado) ou um
   * `FloorPoint` (tile apontado, para runa de área sobre chão vazio). Área centrada no
   * LANÇADOR ignora `explicit` (última frase da decisão 2) — a forma sai do lançador de
   * qualquer forma, e é por isso que o ramo abaixo nem olha o parâmetro.
   */
  #aimFor(
    character: CharacterRuntime, range: number | undefined, area: SpellArea | undefined,
    explicit?: MonsterRuntime | FloorPoint,
  ): SpellAim | null {
    this.#spellHits.length = 0;
    this.#spellTargets.length = 0;
    this.#aimTiles = [];

    if (area !== undefined && isSelfOrigin(area)) {
      this.#aimTiles = areaTiles(area, character.position, character.direction);
      const keys = new Set(this.#aimTiles.map(tileKey));
      for (const monster of this.#monsters) {
        // A área de um jogador NUNCA atinge a invocação de jogador — nem a própria, nem a de um
        // companheiro (#600, Canary `Combat::canTargetCreature`, mundo no-pvp: `target->isSummon() &&
        // targetMasterPlayer` recusa). Sem este corte, a primeira Great Fireball perto do convencido
        // o mataria; `#hostileMonsters` já faz o mesmo para a escolha do alvo, mas a colheita da forma
        // varre `#monsters` direto (e não aloca a lista filtrada a cada lançamento).
        if (!monster.alive || typeof monster.masterId === 'string') continue;
        if (!keys.has(tileKey(this.#at(monster)))) continue;
        // Cada alvo da forma precisa da PRÓPRIA visão (#553, RF-05) — a onda cobre um cone
        // inteiro, e alguém atrás de uma parede não é atingido só porque outro, mais à frente,
        // está.
        if (!isSightClear(this.#world.map, character.position, monster.position)) continue;
        this.#collect(character, monster);
      }
      if (this.#spellHits.length === 0) return null;
      this.#aim.distance = 0;
      this.#aim.targets = this.#spellTargets;
      return this.#aim;
    }

    let primary: MonsterRuntime | null = null;
    let primaryPoint: WorldPoint;
    if (explicit === undefined) {
      primary = this.#targetInRange(character, range);
      if (primary === null) return null;
      primaryPoint = this.#at(primary);
    } else if ('position' in explicit) {
      // Mira de MONSTRO (`MonsterRuntime`): precisa estar vivo e no MESMO andar (#519) — mas
      // NÃO recusamos aqui por alcance: `aim.distance` carrega a distância real, e é
      // `castSpell`/`useSupply` quem já confere `aim.distance > effect.range` e recusa
      // `out-of-range` tipado (distinto de `no-target`, ADR 0049 decisão 2/RF-10). Filtrar aqui
      // devolveria `null` → sempre `no-target`, escondendo a recusa certa.
      if (!explicit.alive || !sameFloor(character.position.z, explicit.position.z)) return null;
      primary = explicit;
      primaryPoint = this.#at(explicit);
    } else {
      // Mira de POSIÇÃO (`FloorPoint`): sem monstro no tile, só vale para forma em área — alvo
      // único mirado num tile vazio não tem o que acertar. Mesmo andar (#519); alcance fica
      // para o chamador, pela mesma razão do ramo acima.
      if (!sameFloor(character.position.z, explicit.z)) return null;
      if (area === undefined) return null;
      primaryPoint = { x: explicit.x, y: explicit.y, z: explicit.z ?? this.#world.map.z };
    }
    // A ESCOLHA do alvo (`#targetInRange`) ignora visão de propósito (DT-05 da spec #553): o
    // bot continua mirando o mesmo alvo atrás da parede, em vez de trocar para um pior só
    // porque este está sem linha agora. Só a CAPTURA final é filtrada — o golpe não sai. Vale
    // igual para a mira manual (#725): alvo ou tile atrás da parede não é atingido.
    if (!isSightClear(this.#world.map, character.position, primaryPoint)) return null;
    if (primary !== null) this.#collect(character, primary);

    if (area !== undefined) {
      this.#aimTiles = areaTiles(area, character.position, character.direction, primaryPoint);
      const keys = new Set(this.#aimTiles.map(tileKey));
      for (const monster of this.#monsters) {
        // Mesmo corte da forma centrada no lançador, logo acima: a invocação de jogador fica de fora.
        if (monster === primary || !monster.alive || typeof monster.masterId === 'string') continue;
        if (!keys.has(tileKey(this.#at(monster)))) continue;
        if (!isSightClear(this.#world.map, character.position, monster.position)) continue;
        this.#collect(character, monster);
      }
    }
    // Sem alvo primário e sem colheita de área (mira de posição vazia): nenhum alvo, `null`
    // como sempre.
    if (this.#spellHits.length === 0) return null;

    this.#aim.distance = distance(character.position, primaryPoint);
    this.#aim.targets = this.#spellTargets;
    return this.#aim;
  }

  /**
   * A mira de CHÃO da runa de campo (#591: Fire/Poison/Energy Field/Wall, Magic Wall, Wild
   * Growth, Destroy Field) — DIFERENTE de `#aimFor`: não exige criatura nenhuma no tile (o
   * campo nasce no CHÃO), então não usa `#collect`/`#spellHits`. Exige mira EXPLÍCITA (`#725`/
   * `#726`, `target.position` já resolvido pelo host em `explicit`): sem "alvo atual" — campo
   * não tem alvo selecionado, só tile apontado. `FloorPoint` mira o tile direto; `MonsterRuntime`
   * mira o tile dela (útil no clique em cima de um monstro). Mesmo andar (#519) e linha de
   * visão livre (a mesma checagem que `#aimFor` já aplica à mira manual).
   */
  #groundAimFor(
    character: CharacterRuntime, explicit: MonsterRuntime | FloorPoint | undefined,
  ): SpellAim | null {
    if (explicit === undefined) return null;
    let point: WorldPoint;
    if ('position' in explicit) {
      if (!explicit.alive || !sameFloor(character.position.z, explicit.position.z)) return null;
      point = this.#at(explicit);
    } else {
      if (!sameFloor(character.position.z, explicit.z)) return null;
      point = { x: explicit.x, y: explicit.y, z: explicit.z ?? this.#world.map.z };
    }
    if (!isSightClear(this.#world.map, character.position, point)) return null;
    return { distance: distance(character.position, point), targets: [], point };
  }

  /**
   * O que escala a runa (#165): a skill `magic` de toda vocação, sem o multiplicador por uso (o
   * BP já a conta), MAIS o bônus de equipamento (#524: Hat of the Mad, Focus Cape, Spellbook of
   * Mind Control) MAIS o de condição (#576: Mastermind Potion soma 3 — `CONDITION_PARAM_BUFF_SPELL`
   * do Canary é o que faz a poção valer para runa/magia, não só para o golpe) — as fontes somam
   * no magic level como somam no dano da runa e na cura da poção.
   */
  #runeScaling(character: CharacterRuntime): SpellScaling {
    const magicLevel = this.#magicLevelOf(character);
    return {
      skillLevel: magicLevel, powerScale: 1, magicLevel,
      // O ML especializado por elemento (#680): a fórmula da runa soma o do elemento DELA.
      specializedMagicLevel: character.inventory.specializedMagicLevel(this.#options.items),
    };
  }

  /**
   * O que escala a magia deste personagem (#155): a skill da vocação (`spellSkill`), e as por
   * uso — MAIS o bônus de equipamento da MESMA skill (#524): a Paladin Armor soma em `distance`
   * (a skill da magia do Paladin), o Hat of the Mad/Focus Cape em `magic` (Sorcerer/Druid) — MAIS
   * o de condição (#576: Mastermind Potion soma 3 em `magic`).
   *
   * `SPELL_SKILL_WEAPON` (#567) é a sentinela do Knight: desde a separação de `melee` em
   * `fist`/`club`/`sword`/`axe`, não há mais uma skill fixa para a magia dele — Berserk,
   * Groundshaker etc. escalam pela skill da FAMÍLIA da arma que está na mão agora, resolvida
   * do mesmo jeito que `#weaponPower` resolve o golpe (`Inventory.weapon`, desarmado cai no
   * perfil `fist` de `content.unarmed`).
   */
  #spellScaling(character: CharacterRuntime): SpellScaling {
    const spellSkill = this.#vocationOf(character)?.spellSkill ?? 'magic';
    const skillId = spellSkill === SPELL_SKILL_WEAPON
      ? this.#equippedWeaponSkillId(character) : spellSkill;
    const skill = this.#options.skills.get(skillId);
    return {
      skillLevel: (skill === undefined ? 0 : this.#loyaltyLevelOf(character, skill))
        + character.inventory.skillBonus(this.#options.items, skillId)
        + character.conditions.skillBonus(skillId),
      // A skill de magia escala o poder FIXO, como a de arma escala o golpe (FUN-75).
      powerScale: this.#scaledPower(character, 'spell-cast', 1),
      // A fórmula canônica de CURA (#475) escala pelo magic level, em toda vocação.
      magicLevel: this.#magicLevelOf(character),
      // O termo de arma da fórmula baseada em `attack` (#523: Groundshaker, Berserk, Fierce
      // Berserk, Front Sweep, Whirlwind Throw). `0` desarmado — a mesma resposta honesta de
      // `weaponAttack`, nunca um número inventado.
      weaponAttack: character.inventory.weaponAttack(this.#options.items, character) ?? 0,
      // O ML especializado por elemento (#680): só a fórmula que lê o ML o soma (`formulaSkill`).
      specializedMagicLevel: character.inventory.specializedMagicLevel(this.#options.items),
    };
  }

  /**
   * Teto e cadência de alma do personagem (#593 + #566): a vocação PROMOVIDA reescreve os dois
   * (Canary: 100/120000 base, 200/15000 promovida) quando o conteúdo declara `promotion.soulMax`/
   * `soulGainTicksMs`; sem vocação não há alma (`null`).
   */
  #soulParamsOf(member: CharacterRuntime): { readonly max: number; readonly gainTicksMs: number } | null {
    const vocation = this.#vocationOf(member);
    if (vocation === null) return null;
    const promoted = member.promoted ? vocation.promotion : undefined;
    return {
      max: promoted?.soulMax ?? vocation.soulMax,
      gainTicksMs: promoted?.soulGainTicksMs ?? vocation.soulGainTicksMs,
    };
  }

  /**
   * O ganho passivo de alma (#593, `Player::onGainExperience` do Canary): com vocação escolhida,
   * alma abaixo do teto e esta XP (JÁ com bônus) ≥ o level que o personagem tinha ANTES do
   * ganho, (re)aplica `CONDITION_SOUL` por quatro minutos — um ponto a cada
   * `soulGainTicksMs` da vocação, a mesma máquina de tique/vencimento do #155/CMB-07.
   *
   * Sem vocação não há teto nem cadência para ler (o personagem nasce sem uma, §7.4, e o
   * Canary sempre tem — ver o comentário de `soulMax` em `content/schemas.ts`), então o portão
   * simplesmente não abre: nenhuma alma antes do level 8, como nenhuma magia de vocação.
   */
  #gainSoulFromExperience(
    session: Session, member: CharacterRuntime, experience: number, levelBeforeGain: number,
  ): void {
    const soul = this.#soulParamsOf(member);
    if (soul === null) return;
    if (member.soul >= soul.max) return;
    if (experience < levelBeforeGain) return;
    this.#applyConditionTo(session, member, {
      key: SOUL_CONDITION_KEY,
      targetId: member.id,
      expiresAtMs: session.nowMs + SOUL_CONDITION_DURATION_MS,
      merge: 'refresh',
      tick: { kind: 'soul', amount: 1, intervalMs: soul.gainTicksMs },
    });
  }

  /**
   * Aplica uma condição a um ALVO — personagem ou monstro (CMB-07) — e agenda o vencimento e o
   * tique. Relançar segue a política `merge` declarada: o evento antigo é cancelado ANTES do
   * novo agendamento, sem deixar órfão.
   *
   * Quando `strongest` mantém a condição que já estava, o mapa não muda e NADA é reagendado —
   * comparar a identidade do estado guardado com o que foi passado distingue os dois casos sem
   * um segundo retorno.
   *
   * `fromCombat` liga o portão de IMUNIDADE do monstro, e só o chamador que é um COMBATE o liga
   * (magia, runa, ability): a imunidade de condição do Canary é consultada por
   * `Combat::CombatConditionFunc` (`combat.cpp:1079`) e por mais ninguém que BLOQUEIE uma
   * condição (`Monster::canSeeInvisibility` a lê, mas para outro fim) — o que entra por
   * `Creature::addCondition` direto, que só confere `isSuppress`, não a consulta: o campo de
   * tile, a defesa própria e os charms Cripple/Numb do Bestiário (`iobestiary.cpp:105-109` e
   * `:144-152`, uma `ConditionSpeed(CONDITION_PARALYZE)` adicionada ao monstro sem checar
   * imunidade). Por isso o portão é opt-in do chamador, e não um filtro de tudo que tem origem
   * estrangeira: um chamador novo e não combativo nasce SEM ele, como no Canary.
   */
  #applyConditionTo(
    session: Session, target: ConditionTarget, condition: ConditionState, fromCombat = false,
  ): void {
    // Item que suprime a condição (#688, Dwarven Ring): ela não entra, como a recusa de
    // `Creature::addCondition` do Canary. Só personagem veste item; monstro fica como estava.
    if (condition.key === DRUNK_CONDITION_KEY && target instanceof CharacterRuntime
      && target.inventory.suppresses(this.#options.items, DRUNK_CONDITION_KEY)) return;
    // O medo de um PERSONAGEM (M44-04, #622) tem o portão próprio do combate e a caminhada forçada
    // que o `sim` conduz (`#onFearThink`) — os dois só valem para jogador: `forcePlayerAutoWalk`
    // do Canary ignora qualquer criatura que não seja um `Player`. Em monstro a condição é só o
    // estado (ninguém no Canary aplica medo a monstro), e o vencimento é o `condition-expire`.
    const characterFear = condition.key === FEARED_CONDITION_KEY && target instanceof CharacterRuntime;
    if (characterFear && fromCombat && !this.#fearAffects(session, target)) return;
    // Imunidade de monstro por CONDIÇÃO (#559, ADR 0041 d.2): `Monster::isImmune(ConditionType_t)`
    // do Canary/TFS, consultada por `Combat::CombatConditionFunc` — quem o conteúdo declara imune
    // não recebe a condição de um golpe/magia/runa/ability, ponto de aplicação único, nunca
    // policiado por golpe. Personagem nunca é imune por conteúdo (só item, acima). O `caster ==
    // target` do Canary (`combat.cpp:1079`) pula a checagem: a auto-aplicação (a defesa que se
    // acelera, o monstro que fica invisível) nunca é barrada. `conditionImmunityOf` (`conditions.ts`)
    // traduz a condição para o nome da imunidade — `paralyze` (o sinal NEGATIVO da chave `speed`),
    // `drunk` e as oito DOTs pelo tipo de dano do tique. `invisible` NUNCA entra: a mesma imunidade,
    // no Canary, é repropositada para "enxerga invisível" (`Monster::canSeeInvisibility`, ADR 0041
    // d.2) — ela filtra quem o monstro consegue MIRAR (`chooseTarget`, `monster/monster.ts`), nunca
    // bloqueia o monstro de ficar invisível por conta própria (`monster.defenses`). Campo de tile
    // não passa por aqui (`FIELD_TICK` tiqueta direto), e o Canary tampouco consulta a imunidade
    // de condição no campo — só a de DANO, que já zera o tique.
    if (fromCombat && !(target instanceof CharacterRuntime) && condition.sourceId !== target.subject) {
      const immunities = this.#options.monsters.get(target.monsterId)?.conditionImmunities;
      if (immunities !== undefined && immunities.length > 0) {
        const blockable = conditionImmunityOf(condition);
        if (blockable !== null && immunities.includes(blockable)) return;
      }
    }
    const subject = conditionSubject(this.#subjectOf(target), condition.key);
    const previous = target.conditions.get(condition.key);
    const tick = tickOf(condition);
    // Só reaproveita o tique quando HÁ de fato um evento pendente na mesma cadência: um
    // `nextTickAtMs` ausente (nenhum tique agendado — o último já rodou) ou vencido não é
    // reaproveitável. Sem este segundo requisito, o relançamento herdaria o fantasma do #334 —
    // um `nextTickAtMs` sem evento correspondente na fila — e a condição relançada nunca mais
    // tiquetaria enquanto fosse renovada.
    const keepTick = previous !== null
      && sameTick(previous, condition)
      && previous.nextTickAtMs !== undefined
      && previous.nextTickAtMs <= previous.expiresAtMs;
    // O `nextTickAtMs` é atualizado aqui para o snapshot; quando o tique é REAPROVEITADO, a
    // cadência antiga continua valendo — é o que impede a inanição do relançamento no mesmo ritmo.
    const nextTickAtMs = tick === null
      ? undefined
      : keepTick
        ? previous!.nextTickAtMs
        : session.nowMs + tick.intervalMs;
    let effective: ConditionState = nextTickAtMs === undefined
      ? condition
      : { ...condition, nextTickAtMs };
    if (characterFear) {
      // `ConditionFeared::addCondition` (relançar com a condição já correndo) só atualiza o prazo:
      // o `fleeingFromPos` e o `fleeIndx` continuam os de quando o medo começou. Um medo NOVO
      // (`startCondition`) escolhe a direção de fuga agora, a partir de onde o lançador está.
      effective = { ...effective, flee: previous?.flee ?? this.#startFlee(session, target, condition) };
    }
    target.conditions.apply(effective);
    // `strongest`/`longest` mantiveram o anterior: o evento dele continua valendo, e reagendar
    // duplicaria.
    if (target.conditions.get(condition.key) !== effective) return;
    if (characterFear) {
      // Sem `condition-expire`: o pensamento fecha o medo (ver `FEAR_THINK`). Um medo NOVO arma o
      // primeiro pensamento no próximo instante da grade do personagem — a fase da criatura.
      if (previous === null) {
        session.scheduleIn(FEAR_THINK, this.#thinkDelayMs(session, target.id, session.nowMs), {
          priority: EventPriority.Movement, subject: target.id,
        });
      }
      return;
    }
    if (previous !== null) {
      session.cancelEvent(CONDITION_EXPIRE, subject);
      // Relançar no MESMO ritmo NÃO cancela o tique: ele mantém a cadência. Cancelar e
      // reagendar a cada relançamento empurraria o tique para sempre quando as duas cadências
      // coincidem — o DOT que nunca acontece.
      if (!keepTick) session.cancelEvent(CONDITION_TICK, subject);
    }
    session.scheduleIn(CONDITION_EXPIRE, condition.expiresAtMs - session.nowMs, {
      priority: EXPIRE_PRIORITY, subject,
    });
    if (!keepTick && nextTickAtMs !== undefined) {
      session.scheduleIn(CONDITION_TICK, nextTickAtMs - session.nowMs, {
        priority: TICK_PRIORITY, subject,
      });
    }
    // A invisibilidade que COMEÇA agora (não a renovada) arma o think de quem a perseguia.
    if (condition.key === INVISIBLE_CONDITION_KEY && previous === null) {
      this.#scheduleVisibilityThinks(session, target);
    }
  }

  /**
   * `target` acabou de ficar invisível (#559): cada criatura que o tem como alvo e NÃO o enxerga
   * pensa uma vez, num instante sorteado em [0, 1000) ms (`VISIBILITY_THINK`), e larga o alvo se
   * ele continuar invisível — até lá segue com ele e ataca normalmente, como o Canary.
   *
   * - **Monstros** que o perseguem (`targetId`), exceto os que "veem invisível"
   *   (`Monster::canSeeInvisibility`) — para eles `canSeeCreature` é sempre verdadeiro e o think
   *   nunca larga nada. Ordem de `#monsters` (nascimento): a ordem dos sorteios é contrato.
   * - **Personagens** cujo alvo de ataque é o `target` e foi FIXADO pelo jogador. O alvo ELEITO
   *   pelo bot (`attackTarget` não fixado) e o `botCandidate` caem AQUI, na hora: a eleição
   *   (`selectTarget`) nunca escolhe um invisível e o bot reelege a cada vencimento de monstro
   *   (`#autoSelectTarget`) — o targeting do bot é do Draconya (ADR 0037 d.2), não do Canary. Sai
   *   daqui, num EVENTO, e não da primeira leitura que notar a invisibilidade: os leitores
   *   (`#attackTargetOfRunner`/`#botCandidateOf`) são alcançáveis da apresentação (`slotStates`),
   *   e o campo que o snapshot guarda não pode depender de alguém estar olhando (invariante 3).
   *   O jogador nunca "vê invisível" (`Player::canSeeCreature`, `player.cpp:1418`); só um alvo que
   *   é MONSTRO importa aqui.
   */
  #scheduleVisibilityThinks(session: Session, target: ConditionTarget): void {
    const id = this.#subjectOf(target);
    for (const monster of this.#monsters) {
      if (!monster.alive || monster.targetId !== id) continue;
      const definition = this.#options.monsters.get(monster.monsterId);
      if (definition === undefined || seesInvisible(definition)) continue;
      this.#scheduleVisibilityThink(session, monster.subject);
    }
    if (!(target instanceof MonsterRuntime)) return;
    for (const character of session.participants) {
      const runner = this.#runners.get(character.id);
      if (runner === undefined) continue;
      if (runner.botCandidate === id) runner.botCandidate = null;
      if (runner.attackTarget !== id) continue;
      if (!runner.attackTargetPinned) runner.attackTarget = null;
      else if (character.alive) this.#scheduleVisibilityThink(session, character.id);
    }
  }

  #scheduleVisibilityThink(session: Session, subject: string): void {
    session.scheduleIn(VISIBILITY_THINK, session.rng.integer(0, VISIBILITY_THINK_INTERVAL_MS - 1), {
      priority: EventPriority.Movement, subject,
    });
  }

  /**
   * O think de visibilidade venceu (#559, `Creature::onThink`, `creature.cpp:130-140`): quem
   * pensa larga o alvo que ainda esteja invisível — e só ele. Nada é largado se o alvo já mudou,
   * morreu ou voltou a ficar visível no meio do caminho (a invisibilidade venceu, foi cancelada
   * ou o dano a revelou): é a MESMA checagem `canSeeCreature` do Canary, feita no instante do
   * think, não no da invisibilidade.
   *
   * O monstro larga (`targetId = null`) e o PRÓXIMO `chooseTarget` dele reelege entre quem ele
   * enxerga; o personagem larga o alvo fixado (os campos do bot — `botCandidate` e o alvo não
   * fixado — já saíram quando a invisibilidade começou, ver `#scheduleVisibilityThinks`).
   */
  #onVisibilityThink(session: Session, subject: string): void {
    const monster = this.#monsterBySubject.get(subject);
    if (monster !== undefined) {
      if (!monster.alive) return;
      const definition = this.#options.monsters.get(monster.monsterId);
      if (definition === undefined || seesInvisible(definition)) return;
      const target = this.#preyById(session, monster.targetId);
      if (target !== null && target.invisible === true) monster.targetId = null;
      return;
    }
    const character = findById(session.participants, subject);
    const runner = character === null ? undefined : this.#runners.get(subject);
    if (character === null || !character.alive || runner === undefined) return;
    if (runner.attackTarget === null) return;
    const attacked = this.#monsterBySubject.get(runner.attackTarget);
    if (attacked !== undefined && attacked.invisible) {
      runner.attackTarget = null;
      runner.attackTargetPinned = false;
    }
  }

  #onConditionTick(session: Session, subject: string): void {
    const separator = subject.lastIndexOf('/');
    if (separator < 0) return;
    const target = this.#conditionTargetOf(session, subject.slice(0, separator));
    if (target === null || !target.alive) return;
    const condition = target.conditions.get(subject.slice(separator + 1));
    const tick = condition === null ? null : tickOf(condition);
    if (condition === null || tick === null) return;
    this.#applyConditionTick(session, target, condition, tick);
    // O tique pode ter MATADO o alvo: `#cancelConditions` já removeu a condição e os eventos,
    // e reagendar aqui a ressuscitaria no mapa. Morto não tiqueta.
    if (!target.alive || target.conditions.get(condition.key) === null) return;
    // Reagenda até o prazo: o tique que só caberia DEPOIS de `expiresAtMs` não acontece. O
    // `nextTickAtMs` guardado é o que permite o relançamento reaproveitar a cadência — mas só
    // quando HÁ de fato um evento pendente (#334): sem tique agendado, a chave fica AUSENTE do
    // estado, nunca com um valor fantasma que não corresponde a nenhum evento na fila.
    //
    // M31-02 (#557): a fila do Tibia pode ter ACABADO — `advanceTick` devolve `null`, e a
    // condição para de tiquetar (mesmo antes do vencimento), como o Canary faz quando
    // `damageList` esvazia. Sem fila (tique antigo), `advanceTick` devolve o MESMO tique — o
    // comportamento de sempre.
    //
    // Nos dois ramos abaixo o agendamento de tique acaba sem a condição vencer: `retiredTick`
    // tira o `nextTickAtMs` fantasma E, quando o tique é a fila do Tibia, zera o que falta —
    // senão o `amount` do ÚLTIMO tique já entregue fica reportando força pendente que não
    // existe mais, e `strongest` recusa uma reaplicação real por causa de uma condição já
    // esgotada (#557).
    const advanced = advanceTick(tick);
    if (advanced === null) {
      target.conditions.replace(retiredTick(condition));
      return;
    }
    const nextTickAtMs = session.nowMs + advanced.intervalMs;
    if (nextTickAtMs <= condition.expiresAtMs) {
      target.conditions.replace({
        ...condition,
        tick: {
          ...condition.tick!, amount: advanced.amount, intervalMs: advanced.intervalMs,
          ...(advanced.queue === undefined ? {} : { queue: advanced.queue }),
        },
        nextTickAtMs,
      });
      session.scheduleIn(CONDITION_TICK, advanced.intervalMs, {
        priority: TICK_PRIORITY, subject,
      });
    } else {
      target.conditions.replace(retiredTick(condition));
    }
  }

  #onConditionExpire(session: Session, subject: string): void {
    const separator = subject.lastIndexOf('/');
    if (separator < 0) return;
    this.#conditionTargetOf(session, subject.slice(0, separator))
      ?.conditions.remove(subject.slice(separator + 1));
  }

  /**
   * O tique de uma condição: cura repõe; DANO passa pelo resolver canônico e pelo pipeline de
   * morte (CMB-07) — nunca escrita direta de vida. A atribuição vai para `sourceId` (quem
   * aplicou), e um monstro que cai no tique é resolvido por `resolveDeath`.
   */
  #applyConditionTick(
    session: Session, target: ConditionTarget, condition: ConditionState, tick: NormalizedTick,
  ): void {
    if (!target.alive) return;
    if (tick.kind === 'heal') {
      if (target instanceof CharacterRuntime) {
        // A cura feita é de quem aplicou a condição (`sourceId`), não de quem a carrega (#431).
        this.#emitHealed(session, target, target.heal(tick.amount), 'spell', condition.sourceId);
      }
      return;
    }
    if (tick.kind === 'soul') {
      // Só personagem tem alma (#593); monstro nunca carrega esta condição. Capado no
      // `soulMax` da vocação — sem uma, não há teto e o tique não faz nada (não deveria
      // acontecer: só `#grantPartyXp` aplica esta condição, e só com vocação escolhida).
      if (target instanceof CharacterRuntime) {
        const soulMax = this.#soulParamsOf(target)?.max;
        if (soulMax !== undefined) target.gainSoul(tick.amount, soulMax);
      }
      return;
    }
    const intent = {
      rawDamage: tick.amount,
      source: tick.source ?? 'monster-attack',
      damageType: tick.damageType ?? 'physical',
      // DOT nunca bloqueia por defesa/armadura no `combat-v3` (#548) — poison/fire/campo passam
      // pelo mesmo `Combat` sem `BLOCKARMOR`/`BLOCKSHIELD` que a magia. Ignorado em v1/v2.
      blockable: MAGIC_BLOCK_FLAGS,
    } as const;
    const attacker = condition.sourceId ?? 'field';
    if (target instanceof CharacterRuntime) {
      const resolved = resolveDamage(
        intent, this.#playerDefender(target, session), 'pve', this.#options.combat, session.rng,
        session.nowMs,
      );
      // Os charms defensivos (#603, `combat-v4`) também rolam no tique de uma condição que um
      // MONSTRO VIVO aplicou ao jogador: o `owner` da condição é o atacante do
      // `combatChangeHealth`. Tique de campo (`sourceId` é o id do campo) ou de um monstro que já
      // morreu não tem atacante.
      const owner = condition.sourceId === undefined
        ? undefined : this.#monsterBySubject.get(condition.sourceId);
      const charmed = owner !== undefined && owner.alive && this.#charmStage()
        ? this.#rollDefensiveCharms(
          session, owner, target, intent.damageType, tick.amount, resolved,
        )
        : resolved;
      // O Parry pode matar o dono do tique: a morte é resolvida DEPOIS do golpe, como em
      // `#executeMonsterAbility`.
      const resolveOwnerDeath = (): void => {
        if (owner !== undefined && !owner.alive && this.#monsterBySubject.get(owner.subject) === owner) {
          resolveDeath(session, { kind: 'monster', monster: owner });
        }
      };
      // `null` é o Void Inversion (dreno de mana convertido em ganho): nada a aplicar.
      if (charmed === null) { resolveOwnerDeath(); return; }
      const outcome = charmed;
      // CMB-08: o mana shield entra como estágio explícito, e o hit/atribuição usam o HP
      // aplicado. Sem atacante para leech — o DOT não repõe vida de quem o aplicou.
      const applied = applyDamageOutcome(
        target, outcome, null, target.conditions.damageTakenScale(),
        this.#hasEnergyShield(target),
      );
      recordDamage(target.contribution, attacker, applied.healthDamage);
      session.emit({
        kind: 'creature-hit', creatureId: target.id, attackerId: attacker,
        // `manaDamage` (#547, M29-07): zero para todo tipo além de `manadrain`, que por sua vez
        // zera `healthDamage` — a soma é sempre o número que de fato saiu do alvo.
        amount: applied.healthDamage + applied.manaDamage, source: 'spell', position: this.#at(target),
        damageType: intent.damageType,
      });
      this.#emitCharacterHealth(session, target);
      if (target.health <= 0) session.kill(target);
      resolveOwnerDeath();
      return;
    }
    const outcome = resolveDamage(
      intent, this.#monsterDefender(target), 'pve', this.#options.combat, session.rng,
      session.nowMs,
    );
    // O tique de condição/campo também passa pelo cano único do dano no monstro — um monstro
    // preso que leva dano de um campo em que PODE pisar (ex.: fogo, enquanto preso atrás de um
    // de veneno) ganha a passagem temporária pelo campo que o prende, e o invisível que leva
    // dano do campo volta a ser visível (`#drainMonster`).
    const applied = this.#drainMonster(session, target, outcome, null);
    recordDamage(target.contribution, attacker, applied.healthDamage);
    session.emit({
      kind: 'creature-hit', creatureId: target.subject, attackerId: attacker,
      // `manaDamage` (#547): sempre zero aqui — monstro não tem mana —, mas a soma mantém o
      // mesmo contrato do golpe em personagem, sem um `if` por tipo de alvo.
      amount: applied.healthDamage + applied.manaDamage, source: 'spell', position: this.#at(target),
      damageType: intent.damageType,
    });
    this.#emitHealth(session, target);
    // A cura por elemento (#683) só com um DONO criatura — o `if (attacker)` do Canary: o tique
    // de condição que um personagem aplicou cura o monstro que cura com aquele tipo; o de campo
    // (`sourceId` é o id do campo, não de criatura) não cura.
    if (condition.sourceId !== undefined && this.#conditionTargetOf(session, condition.sourceId) !== null) {
      this.#healMonsterByElement(session, target, outcome);
    }
    if (!target.alive) resolveDeath(session, { kind: 'monster', monster: target });
  }

  /** O alvo de uma condição pelo id: monstro primeiro (`m:<id>`), depois personagem. */
  #conditionTargetOf(session: Session, id: string): ConditionTarget | null {
    const monster = this.#monsterBySubject.get(id);
    if (monster !== undefined) return monster;
    return findById(session.participants, id);
  }

  #subjectOf(target: ConditionTarget): string {
    return target instanceof CharacterRuntime ? target.id : target.subject;
  }

  /**
   * Cancela os eventos das condições de um alvo E as remove (CMB-07). Chamado quando ele morre:
   * sem isto, o vencimento de uma condição de quem não existe mais ficaria na fila até vencer, e o
   * despacho encontraria o vazio — o órfão que o critério da issue proíbe. Quem apenas SAI da
   * sessão não passa por aqui: `#cancelConditionEvents` tira os eventos e deixa a condição.
   */
  #cancelConditions(session: Session, target: ConditionTarget): void {
    this.#cancelConditionEvents(session, target);
    for (const condition of target.conditions.getState()) target.conditions.remove(condition.key);
  }

  /**
   * Tira da fila desta sessão o vencimento e o tique de toda condição do alvo, SEM remover a
   * condição (#812): é o que quem sai (`onLeave`) faz, porque a condição segue com o personagem.
   */
  #cancelConditionEvents(session: Session, target: ConditionTarget): void {
    const id = this.#subjectOf(target);
    for (const condition of target.conditions.getState()) {
      const subject = conditionSubject(id, condition.key);
      session.cancelEvent(CONDITION_EXPIRE, subject);
      session.cancelEvent(CONDITION_TICK, subject);
    }
    // O pensamento do medo, a retomada do golpe e a caminhada forçada também são dele (M44-04,
    // #622): quem morreu ou saiu não foge mais nesta sessão, e os eventos de `FEAR_THINK`/
    // `ATTACK_THINK` não podem ficar órfãos na fila. É a fila e o estado do RUNNER que saem — o
    // `feared` e o `pacified` em si seguem o personagem, como qualquer condição (#812), e a
    // sessão que o recebe os rearma (`#armConditions`).
    if (target instanceof CharacterRuntime) {
      session.cancelEvent(FEAR_THINK, id);
      session.cancelEvent(ATTACK_THINK, id);
      const runner = this.#runners.get(id);
      if (runner !== undefined) {
        runner.fearWalk = null;
        runner.attackParked = false;
      }
    }
  }

  /**
   * Agenda o vencimento e o próximo tique das condições que o personagem entra TRAZENDO de outra
   * sessão (#812). `Session.enter` já traduziu `expiresAtMs`/`nextTickAtMs` para o relógio desta
   * (`CharacterRuntime.moveToClock`), e é daí que sai o prazo que ainda falta. Sem isto uma haste
   * herdada nunca venceria e um veneno herdado nunca tiquetaria: os dois eventos moravam na fila da
   * sessão anterior.
   *
   * Cancela antes de agendar: o personagem que volta à MESMA instância (sai e entra de novo) não
   * pode ficar com dois vencimentos. `Math.max(0, …)` cobre o tique que caía no instante da saída e
   * ainda não tinha rodado — vence agora, como se a fila tivesse seguido.
   */
  #armConditions(session: Session, character: CharacterRuntime): void {
    for (const condition of character.conditions.getState()) {
      const subject = conditionSubject(character.id, condition.key);
      session.cancelEvent(CONDITION_EXPIRE, subject);
      session.cancelEvent(CONDITION_TICK, subject);
      if (condition.key === FEARED_CONDITION_KEY) {
        // O medo de um PERSONAGEM não tem `condition-expire` (M44-04, #622, ver `FEAR_THINK`): quem
        // o fecha é o pensamento depois do prazo, e a fuga do último pensamento sai ANTES de ele
        // fechar. Um `condition-expire` aqui o removeria no instante do prazo, antes dessa fuga e
        // sem a imunidade de 10 s. Entrando por transição o medo volta no próximo instante da grade
        // de pensamento do personagem NESTA sessão — o `flee` viaja na condição, a caminhada
        // forçada (do runner) não: a próxima fuga é decidida de novo.
        session.cancelEvent(FEAR_THINK, character.id);
        session.scheduleIn(FEAR_THINK, this.#thinkDelayMs(session, character.id, session.nowMs), {
          priority: EventPriority.Movement, subject: character.id,
        });
        continue;
      }
      session.scheduleIn(CONDITION_EXPIRE, Math.max(0, condition.expiresAtMs - session.nowMs), {
        priority: EXPIRE_PRIORITY, subject,
      });
      if (condition.nextTickAtMs !== undefined) {
        session.scheduleIn(CONDITION_TICK, Math.max(0, condition.nextTickAtMs - session.nowMs), {
          priority: TICK_PRIORITY, subject,
        });
      }
    }
  }

  /**
   * Remove condições ESPECÍFICAS de um alvo por chave (#590: Cure Poison e afins, puras ou
   * combinadas com cura). Diferente de `#cancelConditions` — que zera TUDO na morte —,
   * aqui só as chaves que o efeito declarou saem; o resto do alvo continua intocado (o critério
   * da issue: Cure Poison remove o poison e NÃO o burning). Chave ausente no alvo não é erro —
   * a magia sai igual, sem nada para remover.
   */
  #dispelConditions(session: Session, target: ConditionTarget, types: readonly string[]): void {
    const id = this.#subjectOf(target);
    for (const type of types) {
      if (target.conditions.get(type) === null) continue;
      const subject = conditionSubject(id, type);
      session.cancelEvent(CONDITION_EXPIRE, subject);
      session.cancelEvent(CONDITION_TICK, subject);
      target.conditions.remove(type);
      // O `endCondition` do medo (M44-04, #622): a caminhada forçada para e a imunidade de 10 s
      // começa, seja qual for quem removeu a condição — o Cleanse, uma cura ou uma magia.
      if (type === FEARED_CONDITION_KEY && target instanceof CharacterRuntime) {
        this.#endFear(session, target);
      }
    }
  }

  /**
   * O cano ÚNICO do dano de vida que um MONSTRO sofre: `Monster::drainHealth` do Canary (`monster.
   * cpp:3442-3458`), que `Game::combatChangeHealth` alcança com `realDamage > 0`
   * (`game.cpp:8735`) para golpe, magia, runa, tique de DOT, campo, reflexo e golpe de invocação.
   * Todo ponto do ruleset que tira vida de um `MonsterRuntime` passa por aqui, e é ISSO que
   * impede que um ponto novo (os charms de dano, por exemplo) esqueça um dos dois efeitos do
   * `drainHealth`: um sexto ponto que chame `applyDamageOutcome` direto num monstro esconderia o
   * defeito, sem teste nenhum que o apontasse:
   *
   * - **O bypass de campo** (M29-05, #655): levar dano ESTANDO preso (`lastStepBlocked`) ou
   *   andando ao acaso (`randomStepping`) concede UMA passagem pelo campo que o prendia
   *   (`ignoresFieldDamage`, `MonsterRuntime.noteDamageTaken`) — nunca de graça, e nunca ao
   *   andar livre. Zero de dano (`chance: 0`, overkill de mira que já matou) não arma.
   * - **A revelação** (#559): `if (isInvisible()) removeCondition(CONDITION_INVISIBLE)`. O mesmo
   *   `healthDamage` que o `applyDamageOutcome` devolve é a fronteira: dano integralmente
   *   absorvido/bloqueado, ou de `manadrain`, não revela ninguém. O jogador NÃO tem este
   *   comportamento (só `Monster::drainHealth` o tem): a invisibilidade dele só cai por prazo,
   *   por Cancel Invisibility ou pelo equipamento.
   *
   * `attacker` é quem recebe o leech (`null` quando não há — DOT, reflexo, campo, golpe de
   * monstro), e `targetsAffected` o divisor dele numa ação em área (`#applyHits`). A atribuição do
   * dano (`recordDamage`/`creditDamage`) fica com o chamador: quem leva o crédito muda por caminho.
   */
  #drainMonster(
    session: Session, monster: MonsterRuntime, outcome: DamageOutcome, attacker: CharacterRuntime | null,
    targetsAffected = 1,
  ): AppliedDamageOutcome {
    const applied = applyDamageOutcome(monster, outcome, attacker, 1, false, targetsAffected);
    monster.noteDamageTaken(applied.healthDamage);
    if (applied.healthDamage > 0) {
      // A remoção passa por `#dispelConditions` — é a fila do ruleset que cancela o
      // `condition-expire` pendente, e um vencimento órfão é o defeito que CMB-07 proíbe.
      if (monster.invisible) this.#dispelConditions(session, monster, [INVISIBLE_CONDITION_KEY]);
    }
    return applied;
  }

  // --- campos de tile (CMB-07) ---------------------------------------------------------------

  /**
   * Aplica um campo de tile. O `sim` resolve os tiles da forma AGORA, indexa por chave numérica
   * e agenda tique e vencimento. Relançar o MESMO id reinicia: os eventos antigos são cancelados
   * antes, sem órfão. É a porta ÚNICA — a ability de monstro e o teste passam por aqui.
   *
   * O campo pertence ao ruleset, nunca ao `Tilemap` (DT-01): conteúdo é imutável e fixado.
   *
   * `direction` (#591) só importa para a forma `wall` — a fileira perpendicular precisa saber
   * lançador→alvo para se orientar. Default `'south'`, preservando bit a bit o único chamador
   * de antes desta issue (a ability de monstro, sempre `circle`, que ignora direção).
   */
  applyField(
    session: Session, spec: FieldSpec, at: WorldPoint, source: AreaSource = 'spell',
    direction: Direction = 'south',
  ): TileFieldState {
    const subject = fieldSubject(spec.id);
    const previous = this.#fields.get(spec.id);
    const stages = fieldStagesOf(spec);
    const stage = stages[0] as FieldStage;
    const multiStage = stages.length > 1;
    const interval = stage.condition === undefined ? null : specTickIntervalMs(stage.condition);
    // Relançar no MESMO ritmo reaproveita o tique pendente: cancelar e reagendar a cada
    // relançamento empurraria o tique para sempre quando a cadência do campo coincide com a da
    // ability — o mesmo defeito de inanição que o DOT tem. Só o vencimento é sempre reagendado.
    // Mas só reaproveita quando HÁ de fato um evento pendente (#334): um `nextTickAtMs` ausente
    // ou vencido é o fantasma que não corresponde a nenhum evento na fila. Relançar SEMPRE volta
    // ao estágio 0 (#560) — mesmo que o campo anterior já tivesse decaído.
    const previousInterval = previous?.condition === undefined ? null : specTickIntervalMs(previous.condition);
    const keepTick = previous !== null
      && previous.nextTickAtMs !== undefined
      && previous.nextTickAtMs <= previous.expiresAtMs
      && previousInterval === interval;
    const nextTickAtMs = interval === null
      ? undefined
      : keepTick
        ? previous!.nextTickAtMs
        : session.nowMs + interval;
    const field: TileFieldState = {
      id: spec.id,
      // `source` (#523, achado da revisão do #536): o campo de uma ability de monstro usa a
      // MESMA tabela de anéis que a área de dano dela — senão o campo de fogo do Dragon Lord
      // cobriria 69 tiles em vez dos 21 que o raio 4 do Canary de fato cobre, enquanto a bola
      // de fogo do mesmo ataque já usa os 21 certos.
      tiles: areaTiles(spec.shape, at, direction, at, source),
      expiresAtMs: session.nowMs + stage.durationMs,
      ...(stage.condition === undefined ? {} : { condition: stage.condition }),
      ...(nextTickAtMs === undefined ? {} : { nextTickAtMs }),
      // A cadeia inteira viaja no estado (#560): `#onFieldStageAdvance` roda bem depois deste
      // método, sem o `FieldSpec` que criou o campo à mão — o ruleset não indexa spec por id.
      ...(multiStage ? { stageIndex: 0, stages } : {}),
      ...(spec.blocksMovement ? { blocksMovement: true } : {}),
      ...(spec.blocksProjectile ? { blocksProjectile: true } : {}),
    };
    if (previous !== null) {
      session.cancelEvent(FIELD_EXPIRE, subject);
      session.cancelEvent(FIELD_STAGE_ADVANCE, subject);
      if (!keepTick) session.cancelEvent(FIELD_TICK, subject);
    }
    this.#fields.apply(field);
    // O vencimento roda ANTES do tique no mesmo instante (prioridade explícita): o tique do
    // instante de expiração encontra o campo removido. Ordem documentada e testada. Um campo
    // com mais de um estágio agenda a TROCA em vez do vencimento — o vencimento de verdade só
    // chega no último estágio, de dentro de `#onFieldStageAdvance`.
    session.scheduleIn(multiStage ? FIELD_STAGE_ADVANCE : FIELD_EXPIRE, stage.durationMs, {
      priority: EXPIRE_PRIORITY, subject,
    });
    if (!keepTick && nextTickAtMs !== undefined) {
      session.scheduleIn(FIELD_TICK, nextTickAtMs - session.nowMs, {
        priority: TICK_PRIORITY, subject,
      });
    }
    // A tela fica sabendo (#561, M31-06): campo aparece OU reinicia, e as duas usam o MESMO
    // evento — o hospedeiro resolve a arte pelo id de conteúdo e substitui pelo mesmo `id`, como
    // relançar já substitui aqui. Emitido DEPOIS de indexar: o cliente nunca vê um campo que o
    // `at()` ainda não devolveria.
    session.emit({ kind: 'field-appeared', fieldId: field.id, tiles: field.tiles });
    return field;
  }

  #onFieldTick(session: Session, subject: string): void {
    const field = this.#fields.get(subject.slice(2));
    // Estágio sem condição (Magic Wall, Wild Growth, ou o último estágio mudo do fire field,
    // #560) não tem o que tiquetar — a defesa é de graça: `applyField`/`#onFieldStageAdvance`
    // nunca agendam `FIELD_TICK` para um estágio assim.
    if (field === null || field.condition === undefined) return;
    const interval = specTickIntervalMs(field.condition);
    if (interval === null) return;
    // Quem PISA no campo agora. Um evento por campo, e `at` é O(1) por criatura — nenhum passo
    // varre a lista de campos.
    for (const target of this.#occupants(session, field)) {
      const condition = conditionFromSpec(
        field.condition, this.#subjectOf(target), field.id, session.nowMs, 'monster-attack',
        { baseSpeed: target.speed, rng: session.rng },
      );
      const tick = tickOf(condition);
      if (tick !== null) this.#applyConditionTick(session, target, condition, tick);
    }
    // Reagenda até o prazo, e guarda o `nextTickAtMs` (#334) pelo mesmo motivo do tique de
    // condição: sem tique agendado, a chave fica AUSENTE, nunca com um valor fantasma.
    const nextTickAtMs = session.nowMs + interval;
    if (nextTickAtMs <= field.expiresAtMs) {
      this.#fields.replace({ ...field, nextTickAtMs });
      session.scheduleIn(FIELD_TICK, interval, {
        priority: TICK_PRIORITY, subject,
      });
    } else {
      const { nextTickAtMs: _nextTickAtMs, ...withoutTick } = field;
      this.#fields.replace(withoutTick);
    }
  }

  #onFieldExpire(session: Session, subject: string): void {
    const fieldId = subject.slice(2);
    const removed = this.#fields.remove(fieldId);
    // A tela fica sabendo (#561, M31-06): só quando de fato havia campo para remover — um
    // snapshot restaurado de formato anterior nunca teria este evento, mas a defesa é de graça.
    if (removed !== null) session.emit({ kind: 'field-vanished', fieldId });
  }

  /**
   * Destroy Field (#591, `destroy_field_rune.lua`): remove o campo NÃO-bloqueante no tile, com
   * a MESMA cancelação de eventos que `applyField` faz ao relançar — sem isso, o `FIELD_TICK`/
   * `FIELD_EXPIRE`/`FIELD_STAGE_ADVANCE` órfão dispararia contra um campo que já não existe.
   * Campo bloqueante (Magic Wall, Wild Growth) nunca é alvo — o Canary também não os lista em
   * `fields` (`destroy_field_rune.lua`). Devolve `false` sem tocar nada quando não há o que
   * destruir, para o chamador recusar `no-target` ANTES de gastar carga/gold (o Lua também só
   * consome o uso em caso de sucesso).
   */
  #destroyFieldAt(session: Session, at: WorldPoint): boolean {
    const field = this.#fields.at(at);
    if (field === null || field.blocksMovement === true) return false;
    const subject = fieldSubject(field.id);
    session.cancelEvent(FIELD_EXPIRE, subject);
    session.cancelEvent(FIELD_STAGE_ADVANCE, subject);
    session.cancelEvent(FIELD_TICK, subject);
    this.#fields.remove(field.id);
    session.emit({ kind: 'field-vanished', fieldId: field.id });
    return true;
  }

  /**
   * O que as duas runas de invocação recusam ANTES de gastar a carga (#600, `convince_creature.lua`
   * e `animate_dead_rune.lua`): a parte do script que só o ruleset sabe conferir, na ordem do
   * Canary. `check` vai para `useSupply` (depois de requisitos, mira e alcance, antes do gold);
   * `target`/`corpse` são o que a mira achou, capturados AGORA — `#spellHits` é reaproveitado — para
   * o efeito depois. `undefined` para todo outro supply: o caminho comum não paga nada.
   *
   * - **Convince**: o alvo é `convinceable` e NÃO tem mestre (`target:getMaster()`, de qualquer
   *   dono — a "carved stone tile" é um NPC de quest fora do catálogo) → senão `not-possible`;
   *   menos de 2 invocações (`#creature:getSummons() >= 2`) → senão `too-many-summons`; mana >=
   *   `manaCost` do monstro (ausente = 0) → senão `not-enough-mana`.
   * - **Animate Dead**: o tile não é SÓLIDO sem criatura visível (`rune:isBlocking(true)`, o
   *   `NOTENOUGHROOM` de `Spell::playerRuneSpellCheck`, que roda ANTES do script) → senão
   *   `not-possible`; o item do topo do tile é um cadáver movível NESTE instante
   *   (`#animatableCorpseAt`) → senão `not-possible`; menos de 2 invocações → senão
   *   `too-many-summons`; e há um tile livre para o monstro nascer — o tile é exclusivo neste motor
   *   (invariante 8), então "nasce onde o Canary força a colocação" vira "no tile ou num vizinho".
   */
  #summonRunePrecondition(
    session: Session, character: CharacterRuntime, effect: Supply['effect'], aim: SpellAim | null,
  ): SummonRuneCheck | undefined {
    if (effect.kind === 'convince') {
      const target = aim === null ? null : (this.#spellHits[0] ?? null);
      return {
        target,
        corpse: null,
        check: () => {
          if (target === null) return NOT_POSSIBLE;
          const definition = this.#options.monsters.get(target.monsterId);
          if (definition?.convinceable !== true || target.masterId !== null) return NOT_POSSIBLE;
          if (this.#playerSummonCountOf(character.id) >= PLAYER_SUMMON_CAP) return TOO_MANY_SUMMONS;
          if (character.mana < (definition.manaCost ?? 0)) {
            return { ok: false, reason: 'not-enough-mana', retryInMs: 0 };
          }
          return null;
        },
      };
    }
    if (effect.kind === 'animate-dead') {
      const at = aim?.point;
      const corpse = at === undefined ? null : this.#animatableCorpseAt(session, at);
      return {
        target: null,
        corpse,
        check: () => {
          // `rune:isBlocking(true)` (`blockingSolid`): `Spell::playerRuneSpellCheck` recusa o tile
          // SÓLIDO sem criatura visível ANTES do script rodar (`RETURNVALUE_NOTENOUGHROOM`, "não há
          // espaço"), e o cadáver, o gold e o cooldown ficam como estavam. Aqui o sólido é o campo
          // bloqueante (Magic Wall, Wild Growth) sobre o tile do cadáver — a parede e a porta fechada
          // também contariam, mas nenhum cadáver nasce nelas.
          if (at !== undefined && this.#world.blockedAt(at.x, at.y, at.z) && !this.#hasVisibleCreatureAt(session, at)) {
            return NOT_POSSIBLE;
          }
          if (corpse === null || at === undefined) return NOT_POSSIBLE;
          if (this.#playerSummonCountOf(character.id) >= PLAYER_SUMMON_CAP) return TOO_MANY_SUMMONS;
          if (this.#freeTileNear(at) === null) return NOT_POSSIBLE;
          return null;
        },
      };
    }
    return undefined;
  }

  /**
   * Há criatura VISÍVEL em `at` (#600)? É o `getBottomVisibleCreature` de `Spell::playerRuneSpellCheck`:
   * personagem vivo ou monstro vivo e não invisível — o jogador nunca enxerga o invisível
   * (`Player::canSeeCreature`). Só a precondição da Animate Dead a usa.
   */
  #hasVisibleCreatureAt(session: Session, at: WorldPoint): boolean {
    for (const character of session.participants) {
      if (character.alive && character.position.x === at.x && character.position.y === at.y
        && sameFloor(character.position.z, at.z)) return true;
    }
    for (const monster of this.#monsters) {
      if (monster.alive && !monster.invisible && monster.position.x === at.x
        && monster.position.y === at.y && sameFloor(monster.position.z, at.z)) return true;
    }
    return false;
  }

  /**
   * O cadáver que a Animate Dead enxerga no tile (#600): o item do TOPO da pilha — o mais RECENTE,
   * porque `Tile::getTopDownItem` devolve o último item posto (`downItems` insere na frente) —, e só
   * se ele é movível AGORA. Um cadáver mais velho por baixo de um recente que ainda não é movível
   * NÃO conta: o script olha uma coisa só. `null` sem cadáver, ou com o do topo ainda na janela
   * `unmove` da cadeia de decaimento.
   */
  #animatableCorpseAt(session: Session, at: WorldPoint): CorpseState | null {
    let top: CorpseState | null = null;
    for (const corpse of this.#corpses) {
      if (corpse.position.x !== at.x || corpse.position.y !== at.y || corpse.position.z !== at.z) continue;
      if (top === null || corpse.id > top.id) top = corpse;
    }
    return top !== null && this.#isCorpseAnimatable(session, top) ? top : null;
  }

  /**
   * O cadáver está numa janela movível da própria cadeia `decayTo` (`monster.corpseAnimatable`, #600)?
   * O tempo desde a morte sai do evento `CORPSE` que a fila já guarda — vencimento menos o prazo
   * total (`corpseTtlMs`) —, e não de um carimbo novo: é estado que sobrevive ao snapshot sem campo
   * extra e não depende de haver alguém olhando (invariante 3). `fromMs` inclusive, `untilMs`
   * exclusivo.
   */
  #isCorpseAnimatable(session: Session, corpse: CorpseState): boolean {
    const definition = this.#options.monsters.get(corpse.monsterId);
    const windows = definition?.corpseAnimatable;
    const ttlMs = definition?.corpseTtlMs;
    if (windows === undefined || ttlMs === undefined) return false;
    const dueAtMs = session.dueAtOf(CORPSE, String(corpse.id));
    if (dueAtMs === null) return false;
    const elapsedMs = ttlMs - (dueAtMs - session.nowMs);
    return windows.some((window) => elapsedMs >= window.fromMs && elapsedMs < window.untilMs);
  }

  /**
   * O cadáver animável mais próximo ao alcance (#600) — a mira do BOT quando ninguém apontou um tile
   * (a automação é do Draconya, ADR 0037 d.2: o jogador aponta na mão, o bot escolhe). Mesmo andar,
   * linha de visão livre e o do TOPO da pilha do tile; o mais próximo, e o mais antigo em empate
   * (id menor). `undefined` sem nenhum.
   */
  #nearestAnimatableCorpse(
    session: Session, character: CharacterRuntime, range: number,
  ): FloorPoint | undefined {
    let best: CorpseState | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const corpse of this.#corpses) {
      if (!sameFloor(character.position.z, corpse.position.z)) continue;
      const away = distance(character.position, corpse.position);
      if (away > range || away > bestDistance) continue;
      if (away === bestDistance && best !== null && corpse.id > best.id) continue;
      if (this.#animatableCorpseAt(session, corpse.position) !== corpse) continue;
      if (!isSightClear(this.#world.map, character.position, corpse.position)) continue;
      best = corpse;
      bestDistance = away;
    }
    return best?.position;
  }

  /**
   * O tile onde uma invocação nasce ao redor de `at` (#600): o próprio tile, senão o primeiro
   * vizinho livre na ordem fixa de `tilesAround` — a mesma regra e o mesmo bloqueio
   * (`#summonBlockedFor`: só parede e ocupação) de `#spawnPlayerSummon`. `null` sem nenhum.
   */
  #freeTileNear(at: WorldPoint): FloorPoint | null {
    const blocked = this.#summonBlockedFor();
    for (const tile of tilesAround(at, SUMMON_SPAWN_RADIUS)) {
      if (blocked(tile.x, tile.y, tile.z)) continue;
      return tile;
    }
    return null;
  }

  /**
   * A Convince Creature (#600, `convince_creature.lua`): paga a mana DO MONSTRO (`addMana(-manaCost)`)
   * e o magic level sobe por ela (`addManaSpent`) — a mesma conta de `#castSpell` —, e o alvo passa a
   * ser invocação do lançador. A precondição já garantiu mana, teto e alvo válido.
   */
  #applyConvince(session: Session, character: CharacterRuntime, target: MonsterRuntime | null): void {
    if (target === null) return;
    const manaCost = this.#options.monsters.get(target.monsterId)?.manaCost ?? 0;
    character.mana -= manaCost;
    this.#gainSkills(session, character, 'spell-cast', manaCost);
    this.#convertToSummon(session, target, character);
  }

  /**
   * O monstro do Spawner vira invocação do PERSONAGEM (#600, `Creature::setMaster(master, true)` +
   * `Creature::setSummon`): daqui em diante é a mesma criatura que `#spawnPlayerSummon` cria — segue o
   * alvo do mestre, credita o dano a ele, nunca paga loot, XP nem Bestiário, some com o mestre.
   *
   * O que NÃO muda, de propósito, é o LUGAR NO SPAWNER: no Canary o ponto continua contando o monstro
   * (`SpawnMonster::spawnedMonsterMap`, só limpo quando o monstro é REMOVIDO — `cleanup`), então o
   * respawn NÃO começa ao convencer; começa quando ele morre ou sai (`#onMonsterDied` /
   * `#removeSummon` liberam o lugar). O ADR 0057 d.5 dizia "imediatamente, `spawn->removeMonster`":
   * essa chamada só existe no ramo `monsterOverspawn` do `Monster::onThink` do TFS (desligado por
   * padrão, e nada a ver com convencer) — ver a emenda do ADR.
   *
   * O que muda: o dono; o alvo antigo (`targetId` — o personagem que o atacava) sai; a lista de
   * invocação PRÓPRIA não arma mais (`!isSummon()` em `onThinkDefense`) — as invocações que ele já
   * tinha continuam dele; o estado de "voltando ao spawn"/ocioso desliga (invocação nunca volta nem
   * fica ociosa); e todo personagem reavalia o alvo, porque o monstro deixou de ser um alvo válido
   * (`#inSightOf`) — inclusive o do próprio mestre, que o estava atacando.
   */
  #convertToSummon(session: Session, monster: MonsterRuntime, master: CharacterRuntime): void {
    const definition = this.#options.monsters.get(monster.monsterId);
    monster.masterId = master.id;
    monster.targetId = null;
    monster.walkingBack = false;
    monster.walkBackByPath = false;
    monster.idle = false;
    for (const entry of definition?.summons?.entries ?? []) {
      session.cancelEvent(MONSTER_SUMMON, monsterSummonSubject(monster.id, entry.monsterId));
    }
    monster.scheduledSummons.clear();
    // A apresentação marca "sua invocação": o mesmo evento de nascimento, agora com o mestre — o
    // cliente aplica `creature-appear` por cima da criatura que já conhece.
    session.emit({
      kind: 'creature-appeared', creatureId: monster.subject, monsterId: monster.monsterId,
      position: this.#at(monster), health: monster.health, maxHealth: this.#maxHealthOf(monster),
      masterId: master.id,
    });
    for (const character of session.participants) this.#autoSelectTarget(session, character);
  }

  /**
   * A Animate Dead (#600, `animate_dead_rune.lua`): o cadáver do tile SAI (`corpse:remove()`) — e o
   * loot que ainda estava nele vai junto, destruído, pela regra do ADR 0048 d.5 (nunca foi instância
   * no banco: não há linha de ledger a fechar) — e o monstro da runa nasce no lugar como invocação
   * do lançador. `ground-item-vanished` (o cliente fecha a janela do cadáver, se aberta) e
   * `creature-appeared` (`#spawnMonster`, com o `masterId`) saem nesta ordem. A precondição já
   * garantiu o cadáver animável, o teto e o tile livre.
   */
  #applyAnimateDead(
    session: Session, character: CharacterRuntime, at: WorldPoint, monsterId: string,
    corpse: CorpseState | null,
  ): void {
    const definition = this.#options.monsters.get(monsterId);
    const tile = this.#freeTileNear(at);
    if (corpse === null || definition === undefined || tile === null) return;
    const index = this.#corpses.indexOf(corpse);
    if (index >= 0) this.#corpses.splice(index, 1);
    session.cancelEvent(CORPSE, String(corpse.id));
    session.emit({ kind: 'ground-item-vanished', itemId: corpse.id });
    this.#spawnMonster(session, definition, tile, character.id);
  }

  /**
   * O campo troca para o PRÓXIMO estágio da cadeia (#560, `decayTo` do Canary). Só existe
   * evento agendado para isto quando `applyField` viu mais de um estágio — o último estágio
   * vence por `FIELD_EXPIRE`, como sempre.
   */
  #onFieldStageAdvance(session: Session, subject: string): void {
    const fieldId = subject.slice(2);
    const field = this.#fields.get(fieldId);
    if (field === null || field.stages === undefined) return;
    const nextIndex = (field.stageIndex ?? 0) + 1;
    const nextStage = field.stages[nextIndex];
    // Não deveria acontecer — `applyField`/esta própria função só agendam ADVANCE quando há um
    // próximo estágio —, mas a defesa é de graça: cai no mesmo caminho do vencimento final.
    if (nextStage === undefined) { this.#onFieldExpire(session, subject); return; }
    // O tique do estágio anterior NÃO atravessa: o novo pode ter outra cadência, ou nenhuma —
    // reaproveitar tiquetaria a condição de dano do estágio que já passou.
    session.cancelEvent(FIELD_TICK, subject);
    const interval = nextStage.condition === undefined ? null : specTickIntervalMs(nextStage.condition);
    const nextTickAtMs = interval === null ? undefined : session.nowMs + interval;
    const updated: TileFieldState = {
      id: field.id,
      tiles: field.tiles,
      expiresAtMs: session.nowMs + nextStage.durationMs,
      stageIndex: nextIndex,
      stages: field.stages,
      ...(nextStage.condition === undefined ? {} : { condition: nextStage.condition }),
      ...(nextTickAtMs === undefined ? {} : { nextTickAtMs }),
      ...(field.blocksMovement === true ? { blocksMovement: true } : {}),
      ...(field.blocksProjectile === true ? { blocksProjectile: true } : {}),
    };
    this.#fields.replace(updated);
    if (nextTickAtMs !== undefined) {
      session.scheduleIn(FIELD_TICK, interval as number, { priority: TICK_PRIORITY, subject });
    }
    const hasMoreStages = field.stages[nextIndex + 1] !== undefined;
    session.scheduleIn(hasMoreStages ? FIELD_STAGE_ADVANCE : FIELD_EXPIRE, nextStage.durationMs, {
      priority: EXPIRE_PRIORITY, subject,
    });
    // A tela fica sabendo (#560): o hospedeiro resolve a arte por ÍNDICE em
    // `appearances.fieldStages[fieldId]` — campo sem entrada troca de estágio MUDO.
    session.emit({ kind: 'field-stage-changed', fieldId, stageIndex: nextIndex, tiles: field.tiles });
  }

  /** Quem está sobre os tiles do campo: participantes e monstros vivos. */
  #occupants(session: Session, field: TileFieldState): ConditionTarget[] {
    const occupants: ConditionTarget[] = [];
    for (const character of session.participants) {
      if (!character.alive) continue;
      if (this.#fields.at(this.#at(character))?.id === field.id) occupants.push(character);
    }
    for (const monster of this.#monsters) {
      if (!monster.alive) continue;
      if (this.#fields.at(this.#at(monster))?.id === field.id) occupants.push(monster);
    }
    return occupants;
  }

  /**
   * A entrada num campo, observada SÓ depois de um passo aceito (`#step`). Refusão de tile não
   * chega aqui — `movement` devolve resultado e não infringe dano (CMB-07). Aplica UM tique.
   */
  #enterField(session: Session, target: ConditionTarget): void {
    const field = this.#fields.at(this.#at(target));
    // Estágio sem condição (#560: Magic Wall, Wild Growth, o último estágio mudo do fire
    // field) não aplica nada a quem entra — só ocupa o tile, e talvez bloqueie.
    if (field === null || field.condition === undefined) return;
    const condition = conditionFromSpec(
      field.condition, this.#subjectOf(target), field.id, session.nowMs, 'monster-attack',
      { baseSpeed: target.speed, rng: session.rng },
    );
    const tick = tickOf(condition);
    if (tick !== null) this.#applyConditionTick(session, target, condition, tick);
  }

  /** Põe o monstro na mira, com a armadura e a mitigação que o conteúdo dá a ele. */
  #collect(character: CharacterRuntime, monster: MonsterRuntime): void {
    this.#spellHits.push(monster);
    // Monstro não esquiva do jogador — é a mesma regra do `#strike`, e ela vale igual para
    // magia. Quando esquiva de monstro existir, vem do conteúdo e os dois leem do mesmo campo.
    const definition = this.#options.monsters.get(monster.monsterId);
    this.#spellTargets.push({
      armor: definition?.armor ?? 0,
      dodgeChance: 0,
      mitigation: definition?.mitigation,
      defenseMitigation: definition?.defenseMitigation,
      // A cura por elemento e o reflexo do monstro (#683) valem para magia e runa como para o
      // golpe — o Canary os resolve em `combatBlockHit`, qualquer que seja a origem.
      elementHealing: definition?.elementHealing,
      reflect: definition?.reflect === undefined
        ? undefined : { reflector: 'monster', table: definition.reflect },
      attacker: this.#reflectAttackerFor(character, monster),
      // Id de conteúdo e velocidade BASE (#592, Paralyze Rune): só o efeito `condition` com
      // `target: 'enemy'` lê os dois, para montar o `ConditionState`/`SpeedContext` do alvo.
      creatureId: monster.subject,
      speed: monster.speed,
      // Os charms passivos do lançador contra ESTE alvo (#603) — Low Blow, Savage Blow, Vampiric
      // Embrace, Void's Call. Ausente (o caso comum) mantém o alvo como sempre foi.
      charm: this.#charmAttackBonusAgainst(character, monster),
    });
  }

  /** Usa o supply e leva o gasto ao extrato. O débito em si é do `useSupply`. */
  #useSupply(
    session: Session, character: CharacterRuntime, supplyId: string,
    recipient: CharacterRuntime = character,
    explicit?: MonsterRuntime | FloorPoint,
  ): CastResult {
    const supply = this.#options.supplies.get(supplyId);
    if (supply === undefined) return NOT_IN_CATALOG;

    // A runa de dano (#165) mira como a magia em área — o mesmo `#aimFor`. A runa de CONDIÇÃO a
    // distância (#592, Paralyze Rune) mira do MESMO jeito, sem área — só um alvo. A runa de CAMPO/
    // Destroy Field (#591) mira o CHÃO — `#groundAimFor`, que não exige criatura nenhuma no
    // tile. Escala SEMPRE pela skill `magic`: runa é do magic level, em toda vocação.
    // A Convince Creature (#600) mira uma CRIATURA, como a runa de alvo único; a Animate Dead mira
    // um TILE (o cadáver), como a runa de campo — e, sem mira manual (o bot), escolhe o cadáver
    // animável mais próximo ao alcance: a automação é do Draconya (ADR 0037 d.2), a regra que ela
    // dispara é a do Canary.
    const isGroundSupply = supply.effect.kind === 'field' || supply.effect.kind === 'destroy-field'
      || supply.effect.kind === 'animate-dead';
    const groundExplicit = supply.effect.kind === 'animate-dead' && explicit === undefined
      ? this.#nearestAnimatableCorpse(session, character, supply.effect.range)
      : explicit;
    const aim = supply.effect.kind === 'damage'
      ? this.#aimFor(character, supply.effect.range, supply.effect.area, explicit)
      : (supply.effect.kind === 'condition' && supply.effect.target === 'enemy')
        ? this.#aimFor(character, supply.effect.range, undefined, explicit)
        : supply.effect.kind === 'convince'
          ? this.#aimFor(character, supply.effect.range, undefined, explicit)
          : isGroundSupply
            ? this.#groundAimFor(character, groundExplicit)
            : null;
    // O que o script das runas de invocação recusa ANTES de gastar a carga (#600) — conferido em
    // `useSupply`, depois de requisitos, mira e alcance, e só com estado do ruleset (catálogo de
    // monstro, cadáveres, teto de invocações, mana). Capturado AGORA: `#spellHits` é reaproveitado.
    const summonRune = this.#summonRunePrecondition(session, character, supply.effect, aim);
    // Destroy Field (#591): sem campo destrutível no tile mirado, recusa ANTES de gastar gold/
    // carga — o `useSupply` (casting.ts) não tem `Fields` para conferir (invariante 1), então a
    // conferência é daqui, o único lugar com estado de sessão.
    if (supply.effect.kind === 'destroy-field' && aim?.point !== undefined) {
      const existing = this.#fields.at(aim.point);
      if (existing === null || existing.blocksMovement === true) {
        return { ok: false, reason: 'no-target', retryInMs: 0 };
      }
    }
    // Quem paga (#192): em solo o usuário; no modo compartilhado, o rateio entre os presentes
    // — e é a bolsa quem credita `goldSpent` a cada um pelo que pagou.
    const shared = this.#party !== undefined && this.#party.shareCosts && session.participants.length > 1;
    const purse = shared ? this.#sharedPurse(session, character) : ownPurse(character);
    const result = useSupply(
      character, supply, aim, this.#options.combat, session.rng, this.#runeScaling(character), purse,
      recipient, session.nowMs, this.#attackerModifiers(character), summonRune?.check,
    );
    if (result.ok) {
      // Gold gasto é agregado da SESSÃO, como `goldGained` é no abate: o extrato leva os dois
      // ao ledger, e o personagem só carrega o delta. No rateio, a bolsa já creditou a cada um.
      if (!shared) session.credit(character.id, 'goldSpent', result.goldSpent);
      // E a CONTAGEM, que é outra pergunta: "gastei 4.000 de gold" e "bebi 80 poções" contam
      // coisas diferentes sobre a mesma hunt, e o §16.1 pede as duas.
      session.credit(character.id, 'suppliesUsed', 1);
      // Dispel (#590, Antidote Rune): mesma divisão de `#castSpell` — o `useSupply` devolve as
      // chaves, o ruleset cancela o evento e remove.
      if (result.dispel !== undefined) {
        this.#dispelConditions(session, recipient, result.dispel);
      }

      // Runa de campo (#591): planta no tile que `useSupply` devolveu, com id POR INSTÂNCIA
      // (`fieldInstanceId`) — a mesma runa em tiles diferentes abre campos independentes, em vez
      // de o segundo cast mover o primeiro (Fields indexa por id de conteúdo, ver fields.ts). A
      // direção lançador→alvo importa só para `wall` (Fire/Poison/Energy Wall); `directionOf`
      // devolve `null` quando lançador e alvo caem no mesmo tile, e a direção atual do
      // personagem é a mesma resposta honesta que o resto do arquivo já dá nesse caso.
      if (result.field !== undefined) {
        const direction = directionOf(character.position, result.field.at) ?? character.direction;
        const instanced: FieldSpec = { ...result.field.spec, id: fieldInstanceId(result.field.spec.id, result.field.at) };
        this.applyField(session, instanced, result.field.at, 'spell', direction);
        session.emit({
          kind: 'supply-used', characterId: character.id, supplyId: supply.id,
          position: this.#at(character), targets: NO_SPELL_TARGETS, tiles: [result.field.at],
        });
        return result;
      }
      // Destroy Field (#591): a presença já foi conferida acima — aqui só remove.
      if (result.destroyFieldAt !== undefined) {
        this.#destroyFieldAt(session, result.destroyFieldAt);
        session.emit({
          kind: 'supply-used', characterId: character.id, supplyId: supply.id,
          position: this.#at(character), targets: NO_SPELL_TARGETS, tiles: [result.destroyFieldAt],
        });
        return result;
      }

      // As duas runas de invocação (#600): o efeito é do ruleset (posse, mana do monstro, cadáver).
      // `supply-used` sai ANTES, como em todo uso — sem alvo nem tile, o efeito é no usuário
      // (`CONST_ME_MAGIC_BLUE` no lançador, o do Canary).
      if (result.convince === true) {
        session.emit({
          kind: 'supply-used', characterId: character.id, supplyId: supply.id,
          position: this.#at(character), targets: NO_SPELL_TARGETS, tiles: NO_TILES,
        });
        this.#applyConvince(session, character, summonRune?.target ?? null);
        return result;
      }
      if (result.animateDead !== undefined) {
        session.emit({
          kind: 'supply-used', characterId: character.id, supplyId: supply.id,
          position: this.#at(character), targets: NO_SPELL_TARGETS, tiles: [result.animateDead.at],
        });
        this.#applyAnimateDead(
          session, character, result.animateDead.at, result.animateDead.monsterId, summonRune?.corpse ?? null,
        );
        return result;
      }

      // O uso ANTES do que ele repôs (FUN-109), como a magia sai antes dos golpes dela. Uma
      // poção de mana para aqui: `healed` é zero e a barra de mana não é assunto desta issue.
      session.emit({
        kind: 'supply-used', characterId: character.id, supplyId: supply.id,
        position: this.#at(character),
        targets: aim === null
          ? NO_SPELL_TARGETS
          : this.#spellHits.map((m) => ({ creatureId: m.subject, position: this.#at(m) })),
        tiles: aim === null ? NO_TILES : [...this.#aimTiles],
      });
      if (aim === null) this.#emitHealed(session, recipient, result.healed, 'supply', character.id);
      else this.#applyHits(session, character, result.hits, result.hitOutcomes ?? []);
      // Poção de buff (#576, CMB-07): o `useSupply` devolve a condição já com o USUÁRIO como
      // alvo e origem (auto-alvo sempre, nunca o `recipient`). A runa de condição a distância
      // (#592, Paralyze Rune) já a devolve com o MONSTRO mirado como alvo (`casting.ts` monta o
      // `ConditionState` com `target.creatureId`) — quem agenda o vencimento é quem tem a fila,
      // a mesma divisão do `#castSpell`, e o alvo aqui é só de quem aplica.
      if (result.condition !== undefined) {
        const conditionTarget = (supply.effect.kind === 'condition' && supply.effect.target === 'enemy')
          ? this.#spellHits[0]
          : character;
        if (conditionTarget !== undefined) {
          this.#applyConditionTo(session, conditionTarget, result.condition, true);
        }
      }
      return result;
    }

    // §20.3 sem a regra de saída: a hunt CONTINUA, sem poção, e o personagem pode morrer. Vale
    // a linha no extrato pela mesma razão que a stamina zerada vale: descobrir isso só pelo
    // personagem morto é como o modo idle perde a confiança de quem o deixou rendendo. Mas só
    // `not-enough-gold` é ESTA notícia (#217): as outras recusas da runa (#165) não são "sem
    // gold". `level-too-low`/`magic-level-too-low` o `BotPanel` já tranca na configuração — a
    // única forma de aparecer aqui é um level-down depois de configurada, e mesmo assim não é
    // pergunta de gold; `no-target`/`out-of-range` são a mira falhando a cada segundo, o mesmo
    // silêncio que `castSpell` já dá às magias.
    if (result.reason === 'not-enough-gold') {
      const runner = this.#runnerOf(character.id);
      if (!runner.warnedNoGold) {
        runner.warnedNoGold = true;
        session.record('supply-unaffordable', supply.id);
      }
    }
    return result;
  }

  /**
   * Reavalia agora o que está engatilhado (FUN-84, AB-07).
   *
   * O mundo mudou de um jeito que pode tornar uma regra válida — o personagem levou dano, um
   * alvo entrou no alcance. Esperar o próximo múltiplo de um relógio para curar quem está
   * caindo é a mesma perda que o golpe engatilhado da FUN-68 corrigiu do outro lado.
   *
   * Só toca grupo ENGATILHADO: quem tem evento pendente já vai vencer, e agendar de novo
   * seria a ação dobrada.
   */
  #armBot(session: Session, characterId: string): void {
    const runner = this.#runnerOf(characterId);
    const bot = runner.bot;
    if (bot === undefined) return;
    for (const group of bot.groups.keys()) {
      if (!runner.botReady[group]) continue;
      this.#scheduleBot(session, group, characterId, 0);
    }
  }

  /** O ÚNICO lugar que agenda grupo. É o que torna "engatilhado ou agendado" verdade. */
  #scheduleBot(
    session: Session, group: string, characterId: string, delayMs: number,
  ): void {
    this.#runnerOf(characterId).botReady[group] = false;
    session.scheduleIn(botEvent(group), delayMs, {
      // Depois do movimento e do ataque: o bot decide sobre o mundo já resolvido do instante.
      priority: EventPriority.Housekeeping, subject: characterId,
    });
  }

  /**
   * A lista efetiva: as do JOGADOR primeiro, as injetadas depois.
   *
   * A ordem decide qual `id` vai para o extrato quando duas valem no mesmo instante, e a do
   * jogador é a que ele consegue explicar — `exitRules` é costura de teste e do dia em que a
   * hunt tiver regra própria.
   */
  #composeExitRules(config: BotConfigV2 | undefined): readonly HuntExitRule[] {
    if (config === undefined) return this.#injectedExitRules;
    return [...compileExitRules(config.exit, this.#options.items), ...this.#injectedExitRules];
  }

  #botCooldownMs(): number {
    return this.#options.botCooldownMs ?? 1_000;
  }

  /** A política do jogador, ou a de sempre: mais próximo, sem preferência, sem sair da rota. */
  #targetingOf(character: CharacterRuntime): Targeting {
    return targetingOf(this.#runners.get(character.id));
  }

  /**
   * Quanto falta para o livro individual E o de grupo liberarem — o MAIOR dos dois (AB-07/AB-09).
   *
   * A magia tranca TRÊS livros no `castSpell`: o próprio `spell:<id>`, o do grupo e o
   * secundário. O par de `#cooldownOf` só expõe o individual quando não há grupo, então o
   * `spell:<id>` é consultado à parte — sem isso, uma magia de `cooldownMs: 4000` num grupo de
   * `1000` aparecia `ready` no `slotStates` e o `#perform` recusava por 3 s (DT-08). O supply
   * usa o mesmo caminho com o livro do grupo. Zero é "pode executar".
   *
   * O supply que declara `actionExhaustMs` (#690) lê também a exaustão de ação compartilhada
   * (`exhaust:action`), que atravessa os grupos: a poção logo depois de uma runa de ataque
   * ESPERA, como o `nextPotionAction` do Canary — o uso é adiado pelo `retryInMs`, não perdido.
   * Magia não lê este livro: a falada do Canary usa `nextAction`/`spellCooldown`, outro relógio.
   */
  #cooldownWaitOf(character: CharacterRuntime, action: BotActionV2, nowMs: number): number {
    const { cooldownKey, group } = this.#cooldownOf(action);
    const individualKey = action.kind === 'spell'
      ? spellCooldownKey(action.spellId)
      : supplyCooldownKey(action.supplyId);
    return Math.max(
      character.cooldowns.remainingMs(cooldownKey, nowMs),
      character.cooldowns.remainingMs(groupCooldownKey(group), nowMs),
      character.cooldowns.remainingMs(individualKey, nowMs),
      this.#actionExhaustWaitOf(character, action, nowMs),
    );
  }

  /**
   * Quanto falta para a exaustão de ação compartilhada (#690) liberar ESTA ação. Zero para magia,
   * para item e para o supply que não declara `actionExhaustMs` (fixture, Magic Shield Potion):
   * só quem trava o livro o lê. O ciclo automático do bot o confere antes de `#perform`, porque
   * poção e runa moram em grupos de bot DIFERENTES e cada grupo só se reagenda pelo próprio livro.
   */
  #actionExhaustWaitOf(character: CharacterRuntime, action: BotAction, nowMs: number): number {
    if (action.kind !== 'supply') return 0;
    if (this.#options.supplies.get(action.supplyId)?.actionExhaustMs === undefined) return 0;
    return character.cooldowns.remainingMs(actionExhaustKey(), nowMs);
  }

  /**
   * O estado NATURAL de um slot que já passou por `enabled` e cooldown: `ready`, ou `blocked`
   * com o mesmo motivo que `#perform` daria (DT-08). Espelha as fontes — catálogo, mana, saldo
   * e alvo — sem executar e sem consumir sorteio.
   */
  #naturalStateOf(
    session: Session, set: number, slot: number, character: CharacterRuntime, action: BotActionV2,
  ): SlotState {
    const blocked = (reason: SlotRefusal): SlotState =>
      ({ set, slot, state: 'blocked', remainingMs: 0, reason });

    if (action.kind === 'spell') {
      const spell = this.#options.spells.get(action.spellId);
      if (spell === undefined) return blocked('not-in-catalog');
      if (character.level < spell.minLevel) return blocked('not-in-catalog');
      if (spell.vocationId !== undefined && character.vocationId !== spell.vocationId) {
        return blocked('not-in-catalog');
      }
      // O aprendizado (#624): a MESMA posição que `castSpell` confere — depois de level e
      // vocação, antes de cooldown/mana/alvo (DT-08: o espelho coincide com o `#perform`).
      if (!character.learnedSpells.has(spell.id)) return blocked('not-learned');
      // Alvo de party (#588): o mesmo espelho, SEM consumir sorteio nem mutar nada — `<= 1` é a
      // MESMA recusa "No party members in range" que `castSpell` daria, e vem ANTES da mana e da
      // alma, a mesma ordem de `castSpell`.
      const effect = spell.effect;
      if ((effect.kind === 'heal-over-time' || effect.kind === 'buff') && effect.target === 'party') {
        const affected = this.#collectPartyAllies(session, character, effect.range ?? 0);
        if (affected.length <= 1) return blocked('no-target');
        if (character.mana < partyScaledManaCost(spell.manaCost, affected.length)) {
          return blocked('not-enough-mana');
        }
        if (character.soul < (spell.soulCost ?? 0)) return blocked('not-enough-soul');
        return { set, slot, state: 'ready', remainingMs: 0 };
      }
      if (character.mana < (spell.manaCost as number)) return blocked('not-enough-mana');
      if (character.soul < (spell.soulCost ?? 0)) return blocked('not-enough-soul');
      // As utilitárias (#623): o mesmo espelho do `preflight` do `castSpell`, DEPOIS da mana e da
      // alma — a ordem do Canary. Find Person depende de QUEM o jogador mira no clique, que o
      // espelho não vê: ele diz `person-not-found` só quando NÃO HÁ ninguém mais na sessão.
      const utility = effect.kind === 'find' && effect.target === 'person'
        ? (session.participants.length <= 1 ? 'person-not-found' : null)
        : this.#utilityRefusalOf(character, effect, character);
      if (utility !== null) return blocked(utility);
      if (this.#needsTarget(spell.effect)) {
        const range = 'range' in spell.effect ? spell.effect.range : undefined;
        if (this.#targetInRange(character, range) === null) return blocked('no-target');
      }
      return { set, slot, state: 'ready', remainingMs: 0 };
    }

    const supply = this.#options.supplies.get(action.supplyId);
    if (supply === undefined) return blocked('not-in-catalog');
    if (supply.effect.kind === 'damage') {
      // A ordem é a de `useSupply`: requisitos, alvo, e SÓ ENTÃO o gold.
      if (supply.requires.level !== undefined && character.level < supply.requires.level) {
        return blocked('not-in-catalog');
      }
      const magicLevel = this.#magicLevelOf(character);
      if (supply.requires.magicLevel !== undefined && magicLevel < supply.requires.magicLevel) {
        // Motivo PRÓPRIO (RF-02): o `#perform` devolve `magic-level-too-low`, e o espelho do
        // `slotStates` tem de coincidir com ele (DT-08) — genérico aqui é o cliente sem a
        // explicação que o requisito da runa pede.
        return blocked('magic-level-too-low');
      }
      if (this.#targetInRange(character, supply.effect.range) === null) return blocked('no-target');
    }
    // Poção e runa são ABSTRATAS: o "estoque" é o saldo, e sem ele a ação não acontece. O motivo
    // é próprio (`not-enough-gold`) — dizer "não tem o item" de uma poção que não é item é o
    // tooltip errado; `not-enough-item` fica com o consumível físico (carga de bênção, M22).
    if (balanceOf(character) < supply.price) return blocked('not-enough-gold');
    return { set, slot, state: 'ready', remainingMs: 0 };
  }

  /**
   * O efeito é de ALVO ÚNICO — dano ou dano ao longo do tempo sem forma —, o análogo do
   * `needTarget(true)` das runas do Canary (Sudden Death, Fireball, Icicle…)? A que tem forma no
   * tile mirado (Great Fireball, Avalanche) e o campo não são: saem sobre o tile, com ou sem
   * criatura visível nele (`Spell::playerRuneSpellCheck`, `spells.cpp:704`).
   */
  #isSingleTargetEffect(effect: { readonly kind: string; readonly area?: SpellArea | undefined }): boolean {
    // A Convince Creature (#600, `needTarget(true)`) também exige criatura VISÍVEL no tile.
    if (effect.kind === 'convince') return true;
    return (effect.kind === 'damage' || effect.kind === 'damage-over-time') && effect.area === undefined;
  }

  /**
   * O efeito exige alvo? Forma que sai do LANÇADOR não exige (onda, cleave, explosão em volta).
   * `field`/`destroy-field` (#591) SEMPRE exigem — campo nasce no tile mirado, nunca no
   * lançador — é o que faz `#resolveManualTarget` repassar `target.position` como `explicit`
   * até `#groundAimFor`, em vez de descartar a mira como "não se aplica".
   */
  #needsTarget(effect: { readonly kind: string; readonly area?: SpellArea | undefined }): boolean {
    if (effect.kind === 'field' || effect.kind === 'destroy-field') return true;
    // As duas runas de invocação (#600) sempre miram: a Convince, uma criatura; a Animate Dead, o
    // tile do cadáver — sem alvo o cliente/servidor não têm o que repassar como `explicit`.
    if (effect.kind === 'convince' || effect.kind === 'animate-dead') return true;
    if (effect.kind !== 'damage' && effect.kind !== 'damage-over-time') return false;
    return effect.area === undefined || !isSelfOrigin(effect.area);
  }

  /**
   * O melhor alvo dentro de `range`, para a mira e o espelho de elegibilidade. Não muta nada.
   *
   * O alvo escolhido vem primeiro (AB-09, ADR 0032 d.5), e vale também para magia e runa. Alvo
   * do JOGADOR fora do alcance devolve `null` — quem mandou mirar num alvo não quer acertar
   * outro; alvo do AUTO-TARGET (#444) cai na política, como em `#attackTarget`.
   */
  #targetInRange(character: CharacterRuntime, range: number | undefined): MonsterRuntime | null {
    const maxDistance = range ?? 1;
    const attack = this.#attackTargetOfRunner(character);
    if (attack !== null) {
      if (distance(character.position, attack.position) <= maxDistance) return attack;
      if (this.#isPinned(character)) return null;
    }
    const candidate = this.#botCandidateOf(character);
    if (candidate !== null
      && distance(character.position, candidate.position) <= maxDistance) {
      return candidate;
    }
    return selectTarget(
      this.#targetingOf(character), this.#hostileMonsters(), character.position, maxDistance,
    );
  }

  /**
   * A view REAPROVEITADA: campos reescritos, objeto nunca recriado (FUN-80).
   *
   * `range` é o alcance da AVALIAÇÃO (#444): um grupo com runa de alcance 8 precisa contar e
   * mirar a 8, e não no alcance da arma. Ausente é o alcance da arma — o caminho de quem não
   * declarou ação de dano à distância.
   */
  #botViewOf(character: CharacterRuntime, range?: number): BotView {
    const reach = range ?? this.#attackRangeOf(character);
    const target = this.#targetInRange(character, reach);
    this.#botView.self = character;
    this.#botView.targetCount = this.#targetCountFor(character, reach, undefined, null);
    this.#botView.target = target === null
      ? null
      : { health: target.health, maxHealth: this.#maxHealthOf(target) };
    // Sem candidato até que `select` avalie uma regra de alvo != self — e `select` o reescreve a
    // cada regra, então um valor da avaliação anterior nunca vaza para a próxima.
    this.#botView.partyTarget = null;
    // A condição `summons` (#598, M38-01): quantas invocações VIVAS este personagem tem agora.
    this.#botView.summonCount = this.#playerSummonCountOf(character.id);
    return this.#botView;
  }

  /**
   * Quantos alvos VÁLIDOS a condição `targets` enxerga para uma AÇÃO do bot (#216, #444, #480).
   *
   * - **Sem área**: os monstros no `reach` — o alcance do grupo, o da ação de dano à distância
   *   (uma runa de alcance 8 conta a 8), ou o da arma. É o comportamento da #216/#444.
   * - **Com área que sai do lançador** (onda, cleave, feixe, círculo em volta): os monstros nos
   *   tiles da forma projetada a partir do personagem — a área não tem alvo primário, e a
   *   contagem tem de ser a mesma que `#aimFor` vai colher.
   * - **Com área centrada no alvo** (Avalanche, Explosion, cruz): projeta a forma sobre o alvo
   *   primário e conta quem cai nela. Sem alvo primário não há forma, e a contagem é 0 — a
   *   condição não dispara.
   *
   * Ignorado não conta em nenhum dos caminhos (RF-03): a condição não pode ser satisfeita por
   * quem o jogador mandou deixar em paz.
   */
  #targetCountFor(
    character: CharacterRuntime, reach: number, area: SpellArea | undefined,
    actionRange: number | null,
  ): number {
    const targeting = this.#targetingOf(character);
    if (area === undefined) {
      return countTargets(targeting, this.#hostileMonsters(), character.position, reach);
    }
    if (isSelfOrigin(area)) {
      return countAreaTargets(
        targeting, this.#hostileMonsters(), areaTiles(area, character.position, character.direction),
      );
    }
    const primary = this.#targetInRange(character, actionRange ?? reach);
    if (primary === null) return 0;
    return countAreaTargets(
      targeting, this.#hostileMonsters(),
      areaTiles(area, character.position, character.direction, this.#at(primary)),
    );
  }

  /**
   * O maior alcance entre as ações de DANO à distância de um grupo (#444). É o alcance que a
   * condição `targets` e o `target` da view usam, porque é o alcance que a ação do grupo pode
   * de fato atingir — sem ele, uma runa de alcance 8 não enxerga o alvo a 5 tiles.
   *
   * Sem ação de dano, cai no alcance da ARMA: um grupo de cura não herda alcance de runa que
   * ele não tem.
   */
  #groupRange(slots: readonly CompiledSlot[], character: CharacterRuntime): number {
    let maxRange = 0;
    for (const slot of slots) {
      const range = this.#actionRange(slot.act);
      if (range !== null && range > maxRange) maxRange = range;
    }
    return maxRange > 0 ? maxRange : this.#attackRangeOf(character);
  }

  /** O alcance da ação, quando ela mira à distância; `null` para cura e ação sem alvo. */
  #actionRange(action: BotActionV2): number | null {
    if (action.kind === 'spell') {
      const spell = this.#options.spells.get(action.spellId);
      if (spell === undefined) return null;
      // Challenge (#589) mira como dano — alvo único centrado no alvo, ou área centrada no
      // lançador — e precisa da MESMA contagem de `targets` por alcance/área que `damage` já
      // tem: sem isto, um Knight com Challenge (alcance 3+) só disparava a regra do bot com o
      // monstro colado (o alcance da arma), o que não é o que a magia alcança de verdade.
      if (spell.effect.kind !== 'damage' && spell.effect.kind !== 'damage-over-time'
        && spell.effect.kind !== 'challenge') return null;
      return 'range' in spell.effect ? spell.effect.range ?? null : null;
    }
    const supply = this.#options.supplies.get(action.supplyId);
    if (supply === undefined || supply.effect.kind !== 'damage') return null;
    return supply.effect.range ?? null;
  }

  /**
   * A forma de área declarada por uma ação de DANO (ou Challenge, #589 — MESMA mira) do bot, ou
   * `undefined` (#480). Magia de cura e ação sem área devolvem `undefined`, e o `targets` cai na
   * contagem por alcance.
   */
  #actionArea(action: BotActionV2): SpellArea | undefined {
    if (action.kind === 'spell') {
      const spell = this.#options.spells.get(action.spellId);
      const effect = spell?.effect;
      if (effect === undefined) return undefined;
      return effect.kind === 'damage' || effect.kind === 'challenge' ? effect.area : undefined;
    }
    const supply = this.#options.supplies.get(action.supplyId);
    return supply?.effect.kind === 'damage' ? supply.effect.area : undefined;
  }

  #maxHealthOf(monster: MonsterRuntime): number {
    return this.#options.monsters.get(monster.monsterId)?.health ?? monster.health;
  }

  /**
   * O personagem está CORRENDO para juntar monstros, em vez de parar para lutar (§13.7)?
   *
   * Máquina de dois estados com dois limiares, e a separação é o ponto: com um limiar só, a
   * contagem oscilando em torno dele faria o personagem alternar entre correr e parar a cada
   * monstro que morre — e um personagem que alterna não faz nem uma coisa nem outra.
   *
   *   correndo  --(chegou em `max`)-->  lutando
   *   lutando   --(caiu abaixo de `min`)-->  correndo
   *
   * Ele NÃO deixa de atacar enquanto corre: o golpe continua saindo em quem estiver ao alcance
   * (`#armPlayerAttack` é chamado no fim do passo). O que muda é ele não PARAR — e é assim que
   * "correr acumulando" funciona sem pathfinding novo, porque o passo guloso dos monstros já
   * os faz seguir.
   *
   * **O cerco tem um teto de tempo, `MAX_LURE_HOLD_MS`** (#527). Numa zona densa — aggro real
   * (raio maior, sem leash) atrai gente de FORA do raio de busca continuamente —, `perto` pode
   * nunca cair abaixo de `min`: quem morre é reposto por um recém-chegado de longe antes do
   * respawn do próprio ponto, e a máquina de dois limiares fica presa em "lutando" para sempre —
   * achado reproduzindo a QA do M28 com o conteúdo real (a party parada 29 minutos lógicos no
   * mesmo tile). `lureStoppedSinceMs` marca QUANDO o cerco começou; estourado o teto, resume
   * "correndo" mesmo com `perto >= min` — o líder retoma a rota e PUXA o que ainda está por
   * perto, em vez de acampar. Isto não é fidelidade de Tibia (a automação é nossa, ADR 0037
   * decisão 2): é o contrato do PRÓPRIO lure, que promete "junta, limpa, anda" e não "vira torre".
   */
  #luring(runner: Runner, character: CharacterRuntime, nowMs: number): boolean {
    const lure = runner.bot?.lure;
    if (lure === undefined) return false;

    // Puxando à força (#527, `LURE_FORCE_WALK_MS`): o teto de cerco acabou de liberar o líder, e
    // esta janela ignora `lure.max` de propósito. Sem ela, a densidade de uma zona cheia não cai
    // num passo só — o vencimento seguinte veria `perto >= lure.max` de novo e reengatilharia o
    // cerco no MESMO tile em que ele tinha acabado de ser liberado, e "resume" duraria um único
    // passo antes de travar outra vez pelos mesmos `MAX_LURE_HOLD_MS`.
    if (runner.lureForceWalkUntilMs !== null) {
      if (nowMs < runner.lureForceWalkUntilMs) return true;
      runner.lureForceWalkUntilMs = null;
    }

    const perto = countTargets(
      targetingOf(runner), this.#hostileMonsters(), character.position,
      this.#options.targetSearchRadius ?? 8,
    );
    if (runner.running) {
      if (perto >= lure.max) {
        runner.running = false;
        runner.lureStoppedSinceMs = nowMs;
      }
    } else if (perto < lure.min) {
      runner.running = true;
      runner.lureStoppedSinceMs = null;
    } else if (
      runner.lureStoppedSinceMs !== null && nowMs - runner.lureStoppedSinceMs >= MAX_LURE_HOLD_MS
    ) {
      // Estourou o teto com a densidade ainda alta: retoma e PROTEGE a retomada por
      // `LURE_FORCE_WALK_MS` — ver o comentário no topo do método.
      runner.running = true;
      runner.lureStoppedSinceMs = null;
      runner.lureForceWalkUntilMs = nowMs + LURE_FORCE_WALK_MS;
    }
    return runner.running;
  }

  /**
   * Reavalia as automações AGORA (AB-08): dano recebido, vencimento de item, troca de
   * configuração ou entrada na hunt. Cancela o ciclo pendente e o traz para o instante zero —
   * o mesmo desenho de `#armBot`, e a razão é a mesma: esperar o próximo múltiplo de um relógio
   * faria a decisão depender de quando alguém olhou.
   */
  #armAutomations(session: Session, characterId: string): void {
    const runner = this.#runners.get(characterId);
    if (runner === undefined || runner.automations.list.length === 0) return;
    session.cancelEvent(AUTOMATION, characterId);
    session.scheduleIn(AUTOMATION, 0, {
      priority: EventPriority.Housekeeping, subject: characterId,
    });
  }

  /**
   * O ciclo periódico das automações venceu (AB-08, ADR 0032 d.9).
   *
   * Monta a view e o atuador UMA vez e itera o catálogo. As automações são INDEPENDENTES: uma
   * bloqueada (item ausente) informa o motivo e NÃO interrompe as seguintes (RF-09). Quem tem
   * automação habilitada se reagenda para o próximo ciclo; quem não tem não gera evento nenhum.
   */
  #onAutomation(session: Session, characterId: string): void {
    const runner = this.#runners.get(characterId);
    if (runner === undefined) return;
    const character = findById(session.participants, characterId);
    if (character !== null && character.alive && runner.actuator !== undefined) {
      const view = this.#botViewOf(character);
      const actuator = runner.actuator;
      for (const automation of runner.automations.list) {
        const outcome = automation.run(view, actuator);
        if (outcome.kind === 'applied') {
          // A automação voltou a agir: o aviso saiu da transição, e a próxima vez que ela
          // bloquear no mesmo motivo volta a valer como notícia.
          runner.automationWarned.delete(automation.model);
          session.record(outcome.event, outcome.detail);
        } else if (outcome.kind === 'blocked') {
          // Só a TRANSIÇÃO registra (#420): uma automação bloqueada por 8 h é UMA linha no
          // extrato, não uma por ciclo. Sem isto, `notableEvents` crescia sem teto e era
          // reserializado inteiro em cada snapshot.
          const key = `${outcome.reason}:${outcome.itemId}`;
          if (runner.automationWarned.get(automation.model) !== key) {
            runner.automationWarned.set(automation.model, key);
            session.record('automation-blocked', `${automation.model}:${key}`);
          }
        } else {
          // `idle`: a automação saiu do bloqueio sem agir (o alvo vivo, o HP voltou). Limpa o
          // aviso para que um novo bloqueio seja notícia de novo.
          runner.automationWarned.delete(automation.model);
        }
      }
    }
    if (runner.automations.list.length > 0) {
      session.scheduleIn(AUTOMATION, AUTOMATION_INTERVAL_MS, {
        priority: EventPriority.Housekeeping, subject: characterId,
      });
    }
  }

  /**
   * O que uma automação pode fazer com o inventário. Fecha sobre o personagem e o catálogo de
   * itens; NENHUM opcode é emitido — a escrita é `character.inventory.equip/unequip` direto,
   * dentro do evento da própria sessão (invariantes 4 e 9).
   *
   * Montado UMA vez por runner (#420), em `#newRunner` e recompilado em `configureBot`. As
   * `containerRules` NÃO são capturadas: elas derivam do inventário (que cresce por level) e
   * seriam um valor velho numa hunt longa, então são lidas na hora em que `unequip` é chamado.
   */
  #automationActuatorFor(runner: Runner, character: CharacterRuntime): AutomationActuator {
    const items = this.#options.items;
    const ammunition = this.#options.ammunition;
    return {
      equippedItemId: (slot) => character.inventory.equippedAt(slot)?.itemId ?? null,
      equippedInstanceId: (slot) => character.inventory.equippedAt(slot)?.instanceId ?? null,
      carriedItem: (itemId) => character.inventory.findStack(itemId),
      slotOf: (itemId) => items.get(itemId)?.slot ?? null,
      equip: (instanceId) => character.inventory.equip(instanceId, character, items).ok,
      unequip: (slot) => character.inventory.unequip(slot, this.#containerRules(character)).ok,
      // A família vem da ARMA na mão; sem arma de distância não há seleção a trocar.
      selectedAmmoId: () => {
        const family = character.inventory.weapon(items, character)?.weapon?.ammoFamily;
        if (family === undefined) return null;
        return character.ammo.get(family) ?? null;
      },
      selectAmmo: (ammoId) => {
        const ammo = ammunition.get(ammoId);
        return ammo === undefined ? false : character.selectAmmo(ammo).ok;
      },
      rememberRing: (instanceId) => { runner.ringReplaced = instanceId; },
      previousRing: () => runner.ringReplaced,
    };
  }

  /**
   * Instala o observer de equipamento e agenda o vencimento do que já está vestido (ADR 0032
   * d.8). A varredura é de no máximo 10 slots UMA vez na entrada — nunca por tick (invariante 2).
   */
  #armEquipment(session: Session, character: CharacterRuntime): void {
    character.inventory.setEquipmentObserver(this.#equipmentObserver(session, character.id));
    for (const slot of ITEM_SLOTS) {
      const equipped = character.inventory.equippedAt(slot);
      if (equipped === null) continue;
      const definition = this.#options.items.get(equipped.itemId);
      if (definition === undefined) continue;
      this.#scheduleItemRegen(session, character.id, slot, definition);
      if (definition.durationMs === undefined) continue;
      // O que sobrou da última vez que ele esteve no corpo (#689); ausente é cheio.
      session.scheduleIn(EQUIP_EXPIRE, equipped.overlay?.durationRemainingMs ?? definition.durationMs, {
        priority: EventPriority.Housekeeping,
        subject: equipExpirySubject(character.id, slot),
      });
    }
  }

  /**
   * Agenda o PRIMEIRO ganho da regeneração de um item recém-vestido (#688): `*TicksMs` depois,
   * como a `ConditionRegeneration` do Canary, que acumula o intervalo antes de curar. Ganho zero
   * é "não regenera este recurso", e então não há evento.
   */
  #scheduleItemRegen(session: Session, characterId: string, slot: ItemSlot, item: Item): void {
    const regen = item.bonuses?.regeneration;
    if (regen === undefined) return;
    if (regen.healthGain > 0) {
      session.scheduleIn(ITEM_REGEN, regen.healthTicksMs, {
        priority: EventPriority.Upkeep, subject: itemRegenSubject(characterId, slot, 'health'),
      });
    }
    if (regen.manaGain > 0) {
      session.scheduleIn(ITEM_REGEN, regen.manaTicksMs, {
        priority: EventPriority.Upkeep, subject: itemRegenSubject(characterId, slot, 'mana'),
      });
    }
  }

  /** Tira os eventos de regeneração de um slot (#688): o item saiu, a regeneração dele acaba. */
  #cancelItemRegen(session: Session, characterId: string, slot: ItemSlot): void {
    session.cancelEvent(ITEM_REGEN, itemRegenSubject(characterId, slot, 'health'));
    session.cancelEvent(ITEM_REGEN, itemRegenSubject(characterId, slot, 'mana'));
  }

  /**
   * Um ganho da regeneração de item venceu (#688). Confere que o slot ainda tem um item que
   * regenera — o cancelamento no desequip cobre o caso comum, e a guarda cobre o resto —, cura e
   * reagenda pela cadência do item que está vestido AGORA.
   */
  #onItemRegen(session: Session, subject: string): void {
    const [characterId, slot, what] = subject.split(':') as [string, ItemSlot, ItemRegenResource];
    const character = findById(session.participants, characterId);
    // Morto não regenera, e o evento morre com ele, como em `#onRegen`.
    if (character === null || !character.alive) return;
    const equipped = character.inventory.equippedAt(slot);
    const regen = equipped === null
      ? undefined
      : this.#options.items.get(equipped.itemId)?.bonuses?.regeneration;
    if (regen === undefined) return;
    const gain = what === 'health' ? regen.healthGain : regen.manaGain;
    if (gain <= 0) return;
    if (what === 'health') {
      // Só a barra, e só quando repôs — a mesma regra de `#onRegen`.
      if (character.heal(gain) > 0) this.#emitCharacterHealth(session, character);
    } else {
      character.mana = Math.min(character.maxMana, character.mana + gain);
    }
    session.scheduleIn(ITEM_REGEN, what === 'health' ? regen.healthTicksMs : regen.manaTicksMs, {
      priority: EventPriority.Upkeep, subject,
    });
  }

  /**
   * Guarda na instância o prazo RESTANTE do item com duração que está saindo do slot (#689): fora
   * do corpo o prazo pausa, e vestir de novo retoma daqui — o `stopduration` do Canary. Tem de
   * rodar ANTES do `cancelEvent`, porque o restante é lido do próprio `EQUIP_EXPIRE` agendado: a
   * fila é a verdade única do prazo, e a instância não guarda `dueAtMs` nenhum (DT-03).
   *
   * Roda só no desequip, nunca por tick (invariante 2), e a conta é em tempo lógico, então sai
   * igual a 1 Hz e a 10 Hz (invariante 3). O restante mora no overlay da #604, que já atravessa
   * snapshot, extrato e ticket sem mudança nenhuma.
   */
  #stashRemaining(session: Session, character: CharacterRuntime, slot: ItemSlot, item: CarriedItem): void {
    if (this.#options.items.get(item.itemId)?.durationMs === undefined) return;
    const dueAt = session.dueAtOf(EQUIP_EXPIRE, equipExpirySubject(character.id, slot));
    // Snapshot anterior sem o evento, ou o próprio vencimento (o item já foi destruído): nada a
    // guardar, e o item degrada para "cheio" — a degradação já declarada em `onResume`.
    if (dueAt === null) return;
    // `max(1, …)`: sair no mesmo instante do vencimento não ressuscita o prazo cheio.
    character.inventory.setOverlay(item.instanceId, {
      ...item.overlay, durationRemainingMs: Math.max(1, dueAt - session.nowMs),
    });
  }

  /**
   * Guarda o restante de TUDO o que ele tem vestido com prazo, na saída da hunt (#689). O anel
   * continua no dedo, mas a Cidade não simula nada (§37): sem isto o prazo morreria com a
   * sessão e a próxima hunt o reagendaria cheio — sair e voltar renovaria o anel de graça.
   * Roda antes do extrato (que sai depois de `onLeave`/`onEnd`), então o restante vai no
   * overlay para o banco. Na Cidade o prazo fica pausado, como fora do dedo.
   *
   * E cancela o `EQUIP_EXPIRE` dele: o subject é `<id>:<slot>`, e um evento órfão na fila
   * venceria sobre o anel se ele voltasse à mesma sessão.
   */
  #parkEquipment(session: Session, character: CharacterRuntime): void {
    for (const slot of ITEM_SLOTS) {
      const equipped = character.inventory.equippedAt(slot);
      if (equipped !== null) this.#stashRemaining(session, character, slot, equipped);
      session.cancelEvent(EQUIP_EXPIRE, equipExpirySubject(character.id, slot));
    }
  }

  /** O que agenda e cancela o vencimento por duração, e reavalia a velocidade. Closure pura sobre a `Session`. */
  #equipmentObserver(session: Session, characterId: string): EquipmentObserver {
    return {
      onEquip: (slot, item, previous) => {
        const subject = equipExpirySubject(characterId, slot);
        // Troca direta anel → anel: o que saiu guarda o que sobrou dele antes do cancelamento.
        const character = previous === null ? null : findById(session.participants, characterId);
        if (previous !== null && character !== null) this.#stashRemaining(session, character, slot, previous);
        // Cancela SEMPRE, inclusive quando o novo item não dura: o prazo agendado no slot é do
        // item que saiu, e não pode vencer sobre o que entrou.
        session.cancelEvent(EQUIP_EXPIRE, subject);
        const definition = this.#options.items.get(item.itemId);
        if (definition?.durationMs !== undefined) {
          // Retoma de onde parou (#689); a primeira vestida é o prazo cheio.
          session.scheduleIn(EQUIP_EXPIRE, item.overlay?.durationRemainingMs ?? definition.durationMs, {
            priority: EventPriority.Housekeeping, subject,
          });
        }
        // A regeneração também é cancelada SEMPRE (#688): trocar Life Ring por Life Ring cria a
        // condição de novo no Canary, e o primeiro ganho volta a sair `*TicksMs` depois.
        this.#cancelItemRegen(session, characterId, slot);
        if (definition !== undefined) {
          this.#scheduleItemRegen(session, characterId, slot, definition);
        }
        this.#recomputeSpeed(session, characterId);
      },
      onUnequip: (slot, item) => {
        const character = findById(session.participants, characterId);
        if (character !== null) this.#stashRemaining(session, character, slot, item);
        session.cancelEvent(EQUIP_EXPIRE, equipExpirySubject(characterId, slot));
        this.#cancelItemRegen(session, characterId, slot);
        this.#recomputeSpeed(session, characterId);
      },
    };
  }

  /**
   * Reavalia `character.speed` pela tabela mais o bônus de equipamento (#524, boots of haste):
   * vestir ou tirar a bota muda a velocidade NO MESMO evento — sem esperar o próximo passo, que
   * já reagenda pela velocidade atual (`#onPlayerStep`). Recomputa do zero, e não soma/subtrai o
   * item que entrou/saiu, porque `character.speed` não guarda a base separada do bônus — um
   * recálculo é barato (poucos slots) e não arrisca divergir por conta dupla.
   */
  #recomputeSpeed(session: Session, characterId: string): void {
    const character = findById(session.participants, characterId);
    if (character === null || character.speed <= 0) return;
    character.speed = statsForLevel(
      character.level, this.#vocationOf(character), this.#options.progression,
    ).speed + character.inventory.speedBonus(this.#options.items);
  }

  /**
   * O prazo de um item equipado venceu. Confere que o slot ainda é o item que dura — o
   * cancelamento no desequip cobre o caso comum, e a guarda cobre o resto —, destrói sem passar
   * por container e avisa a apresentação.
   */
  #onEquipExpire(session: Session, subject: string): void {
    const separator = subject.lastIndexOf(':');
    if (separator < 0) return;
    const characterId = subject.slice(0, separator);
    const slot = subject.slice(separator + 1) as ItemSlot;
    const character = findById(session.participants, characterId);
    if (character === null) return;
    const equipped = character.inventory.equippedAt(slot);
    if (equipped === null) return;
    const definition = this.#options.items.get(equipped.itemId);
    if (definition?.durationMs === undefined) return;
    character.inventory.destroy(slot);
    session.record('item-expired', equipped.itemId);
    session.emit({ kind: 'equipment-changed', characterId });
    // O slot esvaziou: a renovação (AB-08) acontece no MESMO despacho, via `#armAutomations`.
    this.#armAutomations(session, characterId);
  }

  /**
   * Gasta uma carga do colar E do anel quando o golpe é de um tipo que eles protegem (ADR 0032
   * d.8, alargado no #524 para o anel — o Might Ring do Tibia é exatamente isto no dedo). Olha a
   * definição de CADA peça vestida, e não a mitigação somada: a soma não diz de quem é a
   * proteção, e as duas gastam independente — um Dragon Necklace de fogo e um Might Ring que
   * também resiste fogo gastam UMA carga cada no mesmo golpe de fogo.
   *
   * Gasta mesmo quando o golpe é esquivado (DT-03): a mitigação incide no cálculo antes do corte
   * do Dodge, então ela "trabalhou" no golpe. Resistência negativa é vulnerabilidade e não gasta.
   */
  #consumeAmuletCharge(
    session: Session, character: CharacterRuntime, damageType: DamageType,
  ): void {
    this.#consumeProtectionCharge(session, character, 'neck', 'amulet-spent', damageType);
    this.#consumeProtectionCharge(session, character, 'finger', 'ring-spent', damageType);
  }

  /** O corpo de `#consumeAmuletCharge`, por slot — ver o comentário lá. */
  #consumeProtectionCharge(
    session: Session, character: CharacterRuntime, slot: ItemSlot, recordType: string,
    damageType: DamageType,
  ): void {
    const equipped = character.inventory.equippedAt(slot);
    if (equipped === null) return;
    const definition = this.#options.items.get(equipped.itemId);
    if (definition?.charges === undefined) return;
    const protects = definition.mitigation.immunities.has(damageType)
      || definition.mitigation.resistances[damageType] > 0
      // `absorb.percent` (#552) é o mesmo `absorbpercent*`: gasta carga como a resistência.
      || (definition.absorb?.[damageType]?.percent ?? 0) > 0;
    if (!protects) return;
    if (character.inventory.consumeCharge(slot, definition.charges) > 0) return;
    session.record(recordType, equipped.itemId);
    session.emit({ kind: 'equipment-changed', characterId: character.id });
  }

  #armPlayerAttack(session: Session, character: CharacterRuntime): void {
    const runner = this.#runnerOf(character.id);
    if (!runner.playerAttackReady) return;
    if (!character.alive) return;
    // Estacionado depois de `pacified` (M44-04, #622): só o pensamento ou um passo solta o golpe.
    if (runner.attackParked) return;
    if (this.#attackTarget(character) === null) return;
    // `pacified`: o gatilho existe, mas `doAttacking` volta — o golpe fica estacionado até o
    // primeiro gatilho DEPOIS do vencimento. Sem esta checagem cada passo de monstro agendaria um
    // golpe que `#onPlayerAttack` só reestacionaria.
    const pacified = character.conditions.size === 0
      ? null : character.conditions.get(PACIFIED_CONDITION_KEY);
    if (pacified !== null && pacified.expiresAtMs > session.nowMs) {
      this.#parkAttack(session, character, pacified.expiresAtMs);
      return;
    }
    this.#schedulePlayerAttack(session, character.id, 0);
  }

  /**
   * O golpe do personagem ESPERA a `pacified` acabar (M44-04, #622): fica ENGATILHADO — o
   * `playerAttackReady` que `#armPlayerAttack` já usa para "pronto, sem evento" — e ESTACIONADO
   * (`Runner.attackParked`): o gatilho que o traz de volta é o pensamento seguinte ao vencimento
   * (`ATTACK_THINK`), ou um passo do personagem ou do alvo que chegue depois dele
   * (`#releaseParkedAttacks`, o `onCreatureMove` do Canary). NUNCA o instante exato do
   * vencimento: o Canary não re-arma o ataque quando a condição acaba, e o golpe sai até 1000 ms
   * depois, na fase de pensamento do personagem. Um pensamento por estacionamento: ele agenda o
   * próximo se acordar ainda sob a condição (ela foi estendida).
   */
  #parkAttack(session: Session, character: CharacterRuntime, pacifiedUntilMs: number): void {
    const runner = this.#runnerOf(character.id);
    runner.playerAttackReady = true;
    if (runner.attackParked) return;
    runner.attackParked = true;
    session.scheduleIn(
      ATTACK_THINK,
      pacifiedUntilMs - session.nowMs + this.#thinkDelayMs(session, character.id, pacifiedUntilMs),
      { priority: EventPriority.Attack, subject: character.id },
    );
  }

  /** O pensamento do personagem depois de `pacified`: o primeiro gatilho que traz o golpe de volta. */
  #onAttackThink(session: Session, characterId: string): void {
    const character = findById(session.participants, characterId);
    const runner = this.#runners.get(characterId);
    if (character === null || runner === undefined || !runner.attackParked) return;
    runner.attackParked = false;
    if (!character.alive) return;
    this.#armPlayerAttack(session, character);
  }

  /**
   * Um passo aceito pode soltar o golpe estacionado (`Creature::onCreatureMove` com
   * `hasExtraSwing`, `creature.cpp:569`): quando é o do PRÓPRIO personagem ou o do alvo dele — o
   * Canary só olha esses dois —, e a `pacified` já venceu (sob ela `doAttacking` volta). O golpe
   * estacionado só existe durante e logo depois de uma pacificação, então o caminho quente — um
   * passo qualquer de um monstro qualquer — paga uma leitura por participante.
   */
  #releaseParkedAttacks(session: Session, mover: CharacterRuntime | MonsterRuntime): void {
    for (const character of session.participants) {
      const runner = this.#runners.get(character.id);
      if (runner === undefined || !runner.attackParked) continue;
      if (character.conditions.isActive(PACIFIED_CONDITION_KEY, session.nowMs)) continue;
      if (mover !== character && (mover instanceof CharacterRuntime
        || this.#attackTarget(character) !== mover)) continue;
      runner.attackParked = false;
      session.cancelEvent(ATTACK_THINK, character.id);
      this.#armPlayerAttack(session, character);
    }
  }

  /**
   * Quanto falta, a partir de `fromMs`, para o próximo instante da grade de pensamento do
   * personagem (`CREATURE_THINK_INTERVAL_MS`): zero se `fromMs` já cai nela. A fase é a do
   * personagem — sorteada na primeira vez que alguém pergunta (`Runner.thinkPhaseMs`) e igual
   * daí em diante.
   */
  #thinkDelayMs(session: Session, characterId: string, fromMs: number): number {
    const runner = this.#runners.get(characterId);
    let phase = runner?.thinkPhaseMs ?? null;
    if (phase === null) {
      phase = session.rng.integer(0, CREATURE_THINK_INTERVAL_MS - 1);
      if (runner !== undefined) runner.thinkPhaseMs = phase;
    }
    return (((phase - fromMs) % CREATURE_THINK_INTERVAL_MS) + CREATURE_THINK_INTERVAL_MS)
      % CREATURE_THINK_INTERVAL_MS;
  }

  /**
   * O passo de um monstro venceu (CMB-06).
   *
   * A decisão de andar ou bater continua sendo UMA (`decideMonsterAction`), e o alcance de
   * parada é o MAIOR entre as abilities. Depois do passo, as abilities prontas cujo alvo está
   * no alcance DELAS são armadas para agora — é a mesma regra do golpe engatilhado do
   * personagem, do outro lado.
   */
  #onMonsterStep(session: Session, subject: string): void {
    const monster = this.#monsterBySubject.get(subject);
    if (monster === undefined || !monster.alive) return;
    const definition = this.#options.monsters.get(monster.monsterId);
    if (definition === undefined) return;

    // `CharacterRuntime` já satisfaz `Prey` — id, posição e vida. Montar um vetor novo a cada
    // evento era uma alocação por monstro por vencimento, e com 5.000 instâncias isso é o
    // coletor rodando o tempo todo — `#chooseMonsterTarget`/`#preyById` preservam isso quando
    // não há invocação de personagem (#598): a mesma referência de `session.participants`. As
    // invocações de personagem são calculadas UMA vez e servem à escolha do alvo E à área de
    // visão de `decideUnengagedMove` (#655).
    const summons = typeof monster.masterId === 'string' ? NO_PLAYER_SUMMONS : this.#playerSummonPrey();
    monster.targetId = this.#chooseMonsterTarget(session, monster, definition, summons);
    const target = this.#preyById(session, monster.targetId);
    const blocked = this.#blockedForMonster(monster, definition);
    const action = decideMonsterAction(
      monster, target, definition, blocked,
      (from, to) => isSightClear(this.#world.map, from, to),
    );
    // Preso: tinha alvo vivo e a decisão não achou passo, nem aproximando nem fugindo. É o dado
    // que `#land`/`#applyHits` consultam ao aplicar dano, para armar o bypass acima.
    const liveTarget = target !== null && target.alive ? target : null;
    monster.lastStepBlocked = liveTarget !== null && action.kind === 'idle';

    // O passo reagenda sempre: um monstro parado precisa continuar acordando para descobrir
    // que o alvo se mexeu. É a única cadência que roda mesmo sem nada a fazer — e o ritmo é
    // o do passo dado, ou o de um passo daqui quando ele ficou (FUN-119). `retreat` (#542,
    // manter distância) pisa o tile do MESMO jeito que `step` — a diferença entre os dois é só
    // de onde a decisão veio, não de como o passo em si é executado.
    //
    // O `ignoresFieldDamage` só é CONSUMIDO depois deste `#step` (achado da revisão do #650), não
    // antes: `#step` revalida o campo do destino final para um monstro, e precisa ver o MESMO
    // bypass que `#blockedForMonster` acabou de usar para aprovar `action.to` — resetar antes
    // apagaria a concessão bem na hora em que o commit precisa dela. O bypass continua valendo
    // por UMA decisão só, tenha sido usado ou não: é exatamente por isso que o reset abaixo
    // roda sempre, incondicionalmente, depois do passo — exceto nos ramos em que o Canary não o
    // gasta (abaixo).
    let result: MoveResult | null = null;
    let keepsFieldBypass = false;
    if (action.kind === 'step' || action.kind === 'retreat') {
      // `Monster::doFollowCreature` (`monster.cpp:2530`): quem persegue deixa de andar ao acaso.
      monster.randomStepping = false;
      monster.idle = false;
      result = this.#step(session, monster, action.to, subject);
    } else if (action.kind === 'attack') {
      // Colado (ou ao alcance): o `getFollowCreature() && hasFollowPath` do Canary também vale
      // sem passo a dar, e é ele que roda `doFollowCreature` — e desliga o passo aleatório.
      monster.randomStepping = false;
      monster.idle = false;
    } else {
      // Sem perseguição (#655): `updateIdleStatus` + os ramos `doWalkBack`/`doRandomStep` de
      // `Monster::getNextStep`. Ver `decideUnengagedMove`.
      const move = decideUnengagedMove(
        monster, definition, liveTarget, session.participants, summons, blocked,
        this.#blockedForRandomStep(monster, definition), this.#blockedForWalkBackPath(monster, definition),
        session.nowMs, session.rng,
      );
      // `Monster::setIdle`: o flag acompanha a decisão — liga aqui e desliga em qualquer outra,
      // incluindo os ramos de perseguição acima. É ele que cala a defesa, a troca de alvo e a
      // invocação do monstro ocioso (`#onMonsterDefense` e os outros dois timers).
      monster.idle = move.kind === 'idle';
      if (move.kind === 'idle') {
        // `Monster::setIdle(true)` → `Creature::onIdleStatus`: quem ficou ocioso no spawn esquece
        // quem bateu nele (`damageMap.clear()`, `lastHitCreatureId = 0`).
        if (monster.contribution.actorCount > 0) monster.contribution.clear();
      }
      // O passo aleatório, o ocioso e a invocação parada não gastam o bypass de campo — só
      // `doFollowCreature` e `doWalkBack` o zeram, quando não há passo (`monster.cpp:2511,2536`).
      keepsFieldBypass = move.kind !== 'walk-back';
      if ((move.kind === 'walk-back' || move.kind === 'random-step') && move.to !== null) {
        result = this.#step(session, monster, move.to, subject);
      }
    }
    // O bypass de campo (M29-05) vale por UMA decisão — a que acabou de rodar, tenha usado ou
    // não —, e é consumido aqui, como o Canary o gasta no primeiro recálculo de caminho depois
    // de concedido (`Monster::doWalkBack`/`doFollowCreature`).
    if (!keepsFieldBypass) monster.ignoresFieldDamage = false;
    const cadence = result !== null && result.ok
      ? result.durationMs
      : movementDuration(this.#world, monster, monster.position, this.#at(monster));
    session.scheduleIn(MONSTER_STEP, cadence, {
      priority: EventPriority.Movement, subject,
    });
    // Chegou ao alcance com o golpe engatilhado: ele sai agora, e não no próximo múltiplo de
    // um relógio. É a mesma regra do personagem, do outro lado — e vale por ability.
    this.#armMonsterAbilities(session, monster, definition, target);
    // A dança (#543) só existe agendada enquanto o monstro está colado, sem passo a dar — é
    // exatamente `action.kind === 'attack'`, a tradução deste motor para "getNextStep devolveu
    // falso" do Canary. `#onMonsterStep` é o único lugar que ARMA (aqui) e DESARMA (a condição
    // caiu) — `#onMonsterDance` só decide se reagenda A SI MESMO uma vez já em voo.
    if (definition.staticAttack !== undefined) {
      if (action.kind === 'attack' && !monster.danceArmed) {
        monster.danceArmed = true;
        session.scheduleIn(MONSTER_DANCE, DANCE_INTERVAL_MS, {
          priority: EventPriority.Movement, subject,
        });
      } else if (action.kind !== 'attack' && monster.danceArmed) {
        monster.danceArmed = false;
        session.cancelEvent(MONSTER_DANCE, subject);
      }
    }
    // Um monstro que entrou no raio de busca vira alvo na hora (#444): sem isto, quem se
    // aproxima de fora da tela só seria notado no próximo passo do personagem.
    for (const character of session.participants) {
      this.#autoSelectTarget(session, character);
      this.#armBot(session, character.id);
      this.#armPlayerAttack(session, character);
    }
  }

  /**
   * A dança de alvo venceu (#543, TFS/Canary `Monster::doFollowCreature`/`getDanceStep`,
   * mecanismo — não código, ADR 0019). Não escolhe alvo (a dança reage ao que já está
   * perseguido, como o Canary usa `getAttackedCreature`, não uma busca nova) e não muda
   * `lastStepBlocked`/`ignoresFieldDamage`: esses dois são do passo de PERSEGUIÇÃO
   * (`#onMonsterStep`), e a dança é um timer independente que só se aproveita da mesma
   * mecânica de passo (`#step`) para o commit.
   *
   * A condição pode ter caído entre o armamento e este vencimento (o alvo morreu, saiu do
   * alcance, o monstro morreu) — é aqui que ela é revalidada, e é aqui que o evento MORRE sem
   * reagendar quando cai: a outra metade do "cancelado quando a condição cai" (a primeira
   * metade é o desarme ativo de `#onMonsterStep`).
   */
  #onMonsterDance(session: Session, subject: string): void {
    const monster = this.#monsterBySubject.get(subject);
    if (monster === undefined || !monster.alive) return;
    const definition = this.#options.monsters.get(monster.monsterId);
    if (definition === undefined || definition.staticAttack === undefined) return;
    // `#preyById` (#598): o alvo pode ser uma invocação de personagem desde esta issue.
    const target = this.#preyById(session, monster.targetId);
    const blocked = this.#blockedForMonster(monster, definition);
    const action = decideMonsterAction(
      monster, target, definition, blocked,
      (from, to) => isSightClear(this.#world.map, from, to),
    );
    if (action.kind !== 'attack' || target === null) {
      monster.danceArmed = false;
      return;
    }

    // A cadência corre INDEPENDENTE do resultado do sorteio — o mesmo `doAttacking`/`onThinkDefense`
    // de sempre: o intervalo continua enquanto a adjacência se mantém, falhe ou acerte a rolagem.
    session.scheduleIn(MONSTER_DANCE, DANCE_INTERVAL_MS, {
      priority: EventPriority.Movement, subject,
    });
    // Ausente é sempre parado, sem sorteio — mas `staticAttack` já foi conferido acima, então
    // este SEMPRE consome exatamente UMA rolagem (o mesmo contrato de `ability.chance`/
    // `blockChance`/`modifiers.critical`), mesmo com `staticAttack` 0 ou 1.
    if (!session.rng.chance(1 - definition.staticAttack)) return;
    const to = danceStep(monster.position, target.position, blocked, session.rng);
    if (to !== null) this.#step(session, monster, to, subject);
  }

  /**
   * O ataque BÁSICO de um monstro venceu — o legado, e o caminho do rato (CMB-06).
   *
   * A sequência é a de sempre: reescolhe alvo, confere o alcance, reagenda a cadência e aplica
   * pelo pipeline canônico. Sem alvo ao alcance, ENGATILHA em vez de desperdiçar — quem o traz
   * de volta é o passo, que reavalia a distância a cada vencimento. Fugindo (#518), o corpo a
   * corpo entra na mesma regra de "fora do alcance": engatilha e não bate, e é `#armMonsterAbilities`
   * quem re-arma quando o HP subir de novo acima de `runOnHealth`.
   */
  #onMonsterAttack(session: Session, subject: string): void {
    const monster = this.#monsterBySubject.get(subject);
    if (monster === undefined || !monster.alive) return;
    const definition = this.#options.monsters.get(monster.monsterId);
    if (definition === undefined) return;
    const ability = definition.abilities.find((candidate) => candidate.id === BASIC_ABILITY_ID);
    if (ability === undefined) {
      monster.attackReady = true;
      return;
    }

    monster.targetId = this.#chooseMonsterTarget(session, monster, definition);
    const target = this.#creatureById(session, monster.targetId);
    if (target === null || !target.alive
      || distance(monster.position, target.position) > ability.target.range
      || !isSightClear(this.#world.map, monster.position, target.position)
      || (isMonsterFleeing(monster, definition) && isMeleeAbility(ability))) {
      monster.attackReady = true;
      return;
    }

    // Reagenda SEMPRE — a chance é rolada A CADA vencimento, independente do resultado. É o
    // TFS `doAttacking`: o intervalo continua correndo mesmo quando a rolagem falha.
    this.#scheduleMonsterAttack(session, monster, ability.cadenceMs);
    // Ausente é sempre passa, sem consumir sorteio (preserva rato/rotworm bit a bit); declarada,
    // UMA rolagem por vencimento (#518).
    if (ability.chance !== undefined && !session.rng.chance(ability.chance)) return;
    this.#executeMonsterAbility(session, monster, ability, target);
  }

  /**
   * Uma ability DECLARADA de um monstro venceu (CMB-06). O subject carrega o id dela:
   * `m:<id>:<abilityId>`, e é ele que a morte cancela sem varrer a fila.
   */
  #onMonsterAbility(session: Session, subject: string): void {
    // `m:<id>:<abilityId>`: o id é numérico e vem primeiro, então o `:` seguinte separa a
    // ability — o id dela pode conter `:` sem ambiguidade.
    const rest = subject.startsWith('m:') ? subject.slice(2) : '';
    const separator = rest.indexOf(':');
    if (separator < 0) return;
    const monster = this.#monsterBySubject.get(monsterSubject(Number(rest.slice(0, separator))));
    if (monster === undefined || !monster.alive) return;
    const definition = this.#options.monsters.get(monster.monsterId);
    if (definition === undefined) return;
    const abilityId = rest.slice(separator + 1);
    const ability = definition.abilities.find((candidate) => candidate.id === abilityId);
    if (ability === undefined) return;

    monster.scheduledAbilities.delete(ability.id);
    monster.targetId = this.#chooseMonsterTarget(session, monster, definition);
    const target = this.#creatureById(session, monster.targetId);
    if (target === null || !target.alive
      || distance(monster.position, target.position) > ability.target.range
      || !isSightClear(this.#world.map, monster.position, target.position)
      || (isMonsterFleeing(monster, definition) && isMeleeAbility(ability))) {
      // Alvo saiu do alcance, ou a visão fechou (#553), ou o monstro está fugindo e esta
      // ability é corpo a corpo: NÃO bate, e a ability volta a ficar engatilhada —
      // `#armMonsterAbilities` a re-arma.
      return;
    }

    this.#scheduleMonsterAbility(session, monster, ability, ability.cadenceMs);
    if (ability.chance !== undefined && !session.rng.chance(ability.chance)) return;
    this.#executeMonsterAbility(session, monster, ability, target);
  }

  /**
   * Arma para AGORA toda ability pronta cujo alvo está no alcance dela.
   *
   * A básica usa `attackReady`; as declaradas usam `scheduledAbilities` — cada uma tem a
   * própria cadência, e um booleano só não distinguiria "vai bater" de "já tem evento na fila".
   * Fugindo (#518), as abilities CORPO A CORPO nem são armadas — o monstro segue se afastando e
   * só as de alcance continuam saindo.
   */
  #armMonsterAbilities(
    session: Session, monster: MonsterRuntime, definition: Monster, target: Prey | null,
  ): void {
    if (target === null || !target.alive) return;
    const fleeing = isMonsterFleeing(monster, definition);
    for (const ability of definition.abilities) {
      if (fleeing && isMeleeAbility(ability)) continue;
      if (distance(monster.position, target.position) > ability.target.range) continue;
      if (!isSightClear(this.#world.map, monster.position, target.position)) continue;
      if (ability.id === BASIC_ABILITY_ID) {
        if (monster.attackReady) this.#scheduleMonsterAttack(session, monster, 0);
        continue;
      }
      if (monster.scheduledAbilities.has(ability.id)) continue;
      this.#scheduleMonsterAbility(session, monster, ability, 0);
    }
  }

  /**
   * Aplica uma ability: colhe os alvos ANTES de qualquer dano, emite o lançamento e depois um
   * golpe por alvo.
   *
   * A ORDEM é contrato (FUN-109): o `monster-ability-cast` sai antes dos `creature-hit` dele —
   * o projétil e o impacto do lançamento acompanham os números, não o contrário. E a colheita
   * antes do dano é a regra da FUN-92: resolver morte no meio da varredura mexeria na lista
   * de participantes que está sendo lida.
   */
  #executeMonsterAbility(
    session: Session, monster: MonsterRuntime, ability: MonsterAbility,
    primary: CharacterRuntime | MonsterRuntime,
  ): void {
    const subject = monster.subject;
    // O conjunto de presas de uma ability em ÁREA (#598, ADR 0057 decisão 1): estendido pelas
    // invocações de personagem VIVAS, como `#chooseMonsterTarget` — mesma referência de
    // `session.participants` quando não há nenhuma (o caso comum hoje, sempre).
    const summons = this.#livePlayerSummons();
    const prey: readonly (CharacterRuntime | MonsterRuntime)[] = summons.length === 0
      ? session.participants
      : [...session.participants, ...summons];
    // Alvo secundário da FORMA sem visão livre do lançador não é atingido (#553, RF-05) — o
    // principal já passou pelo portão em `#onMonsterAttack`/`#onMonsterAbility`, mas a onda/
    // círculo pode cobrir alguém atrás de uma parede que o alvo principal não está.
    const targets = abilityTargets(ability, this.#at(monster), primary, prey)
      .filter((target) => isSightClear(this.#world.map, this.#at(monster), this.#at(target)));
    const melee = isMeleeAbility(ability);
    const source: 'melee' | 'spell' = melee ? 'melee' : 'spell';
    // A apresentação só sai quando há o que desenhar ou quando a ability NÃO é o corpo a corpo
    // legado — é o que mantém o rato bit a bit (nenhum evento a mais por golpe).
    if (!melee || ability.presentation !== undefined) {
      session.emit({
        kind: 'monster-ability-cast', casterId: subject, abilityId: ability.id,
        casterPosition: this.#at(monster),
        targets: targets.map((target) => ({
          // `subject` (`m:<id>`) para uma invocação de personagem (#598); `id` de sempre para
          // um personagem — `MonsterRuntime.id` é NUMÉRICO, nunca o creatureId do protocolo.
          creatureId: target instanceof MonsterRuntime ? target.subject : target.id,
          position: this.#at(target),
        })),
        tiles: abilityTiles(ability, this.#at(monster), this.#at(primary)),
        ...(ability.presentation?.missileKey === undefined
          ? {} : { missileKey: ability.presentation.missileKey }),
        ...(ability.presentation?.impactKey === undefined
          ? {} : { impactKey: ability.presentation.impactKey }),
      });
    }

    // O crítico do MONSTRO (M30-04, #551): `Monster::getCriticalChance()`, o mesmo para TODA
    // ability dele — básica ou declarada, corpo a corpo ou à distância, como `applyExtensions`
    // do Canary rola uma vez por `doCombat`, qualquer que seja a origem do golpe e QUALQUER que
    // seja o número de alvos que ela atinge. Ausente (`critChance` 0, os quatro monstros do
    // bestiário atual) não declara nada, e nenhum sorteio novo entra — bit a bit o
    // rato/rotworm/dragon/dragon-lord de sempre.
    //
    // A rolagem em si é da AÇÃO (achado da revisão do #551/#653): uma ability em área rola o
    // crítico UMA vez, ANTES do laço por alvo, e `rollSharedCriticalOutcome` faz cada
    // `resolveDamage` por alvo herdar o MESMO resultado — nunca um jogador critica e outro não
    // no mesmo golpe do monstro.
    const monsterDefinition = this.#options.monsters.get(monster.monsterId);
    const monsterModifiers = monsterCriticalModifiers(monsterDefinition);
    const resolvedMonsterModifiers = rollSharedCriticalOutcome(monsterModifiers, session.rng);
    // O rate de ataque de monstro/boss (#691): multiplica o dano SORTEADO, não a faixa — o
    // sorteio é o mesmo, e a sequência do `Rng` não muda. Neutro (1) devolve o sorteio intacto.
    const attackRate = creatureRatesFor(
      this.#options.progression.rates, monsterDefinition?.boss ?? false,
    ).attack;
    for (const character of targets) {
      // A faixa sorteada com o `Rng` da sessão, uma rolagem por alvo — o contrato do loot vale
      // para o dano, e a ordem dos alvos é a de entrada (documentada em `abilityTargets`). No
      // `combat-v3` o sorteio é a normal truncada do Canary (#681); antes, uniforme.
      const rawDamage = applyAttackRate(
        rollCombatValue(session.rng, ability.power.min, ability.power.max, this.#options.combat), attackRate,
      );
      if (character instanceof MonsterRuntime) {
        // A invocação de personagem (#598, ADR 0057 decisão 1 — "monstros a atacam") não tem
        // equipamento, mana shield nem skill: ela usa `#monsterDefender`, o MESMO "monstro como
        // defensor" que já existe para o reflexo do equipamento (`#reflectOntoMonster`) — nunca
        // o caminho do jogador, e sem `attacker` (o reflexo do #552 é de EQUIPAMENTO — uma
        // invocação nunca reflete de volta).
        const result = resolveDamage(
          {
            rawDamage, source: 'monster-attack', damageType: ability.damageType,
            blockable: abilityBlockFlags(ability),
            ...(resolvedMonsterModifiers === undefined ? {} : { modifiers: resolvedMonsterModifiers }),
          },
          this.#monsterDefender(character),
          'pve',
          this.#options.combat,
          session.rng,
          session.nowMs,
        );
        this.#applyMonsterHitOnSummon(session, monster, character, result, source);
        continue;
      }
      const defender = this.#playerDefender(character, session);
      const result = resolveDamage(
        {
          rawDamage, source: 'monster-attack', damageType: ability.damageType,
          // O TIPO DE ATAQUE decide o bloqueio no `combat-v3` (#682, a regra de
          // `Monsters::deserializeSpell` do Canary): o `melee` (a básica legada inclusive)
          // bloqueia os dois; o `combat` FÍSICO passa só pela armadura, em qualquer alcance ou
          // área; qualquer outro tipo é magia para o `blockHit`. `melee` acima continua
          // decidindo SÓ a apresentação (`source`).
          blockable: abilityBlockFlags(ability),
          ...(resolvedMonsterModifiers === undefined ? {} : { modifiers: resolvedMonsterModifiers }),
          // Contra quem o reflexo do equipamento volta (#552): a vida máxima do monstro (o teto
          // de 1 %) e a distância dele ao alvo (a exceção do físico flat). Só o `combat-v3` lê.
          ...(monsterDefinition === undefined ? {} : {
            attacker: {
              maxHealth: monsterDefinition.health,
              distance: distance(monster.position, character.position),
            },
          }),
        },
        defender,
        'pve',
        this.#options.combat,
        session.rng,
        session.nowMs,
      );
      // O reflexo sai ANTES do dano no alvo, como no Canary (`Combat::doCombatHealth` contra o
      // atacante no fim do bloqueio, antes de a vida do alvo mudar) — um monstro que morre pelo
      // próprio golpe refletido ainda acerta este golpe.
      if (result.reflected !== undefined && monster.alive) {
        this.#reflectOntoMonster(session, character, monster, result.reflected);
      }
      // Os charms defensivos (#603, `combat-v4`): DEPOIS do `blockHit` e do reflexo, ANTES do mana
      // shield que `#applyMonsterHit` aplica. `null` é o Void Inversion (o dreno virou ganho de
      // mana): nenhum golpe a aplicar.
      const charmStage = this.#charmStage();
      const landed = charmStage
        ? this.#rollDefensiveCharms(session, monster, character, ability.damageType, rawDamage, result)
        : result;
      if (landed !== null) {
        this.#applyMonsterHit(session, subject, character, ability, defender, landed, source);
      }
      // O Cleanse (#603) roda depois de todo golpe que acertou e antes da condição da ability: se
      // limpou uma condição do jogador (ou o tipo da nova está imune), a nova não entra.
      const conditionBlocked = charmStage && character.alive
        && this.#cleanseBeforeCondition(session, monster, character, ability);
      // A condição da ability (CMB-07), aplicada a CADA alvo vivo que ela acertou. O tique de
      // dano entra no mesmo pipeline do golpe; quem aplicou (o monstro) leva a atribuição.
      //
      // A invocação de personagem já saiu do laço acima (`continue`) — nunca chega aqui. Uma
      // condição declarada numa ability que hoje só atinge invocação não seria aplicada; é o
      // mesmo recorte de `#applyMonsterHitOnSummon` (sem mecanismo exclusivo do jogador), e
      // fica registrado como divergência conhecida, não como pendência silenciosa.
      if (ability.condition !== undefined && character.alive && !conditionBlocked) {
        this.#applyConditionTo(session, character, conditionFromSpec(
          ability.condition, character.id, subject, session.nowMs, 'monster-attack',
          { baseSpeed: character.speed, rng: session.rng },
        ), true);
      }
    }
    // O campo da ability (CMB-07): UMA vez, centrado no alvo principal. A geometria usa a
    // tabela de anéis de MONSTRO (#523), como a área de dano da própria ability — `source:
    // 'monster'` é o que faz o campo de fogo do Dragon Lord cobrir os mesmos 21 tiles da bola.
    if (ability.field !== undefined) {
      this.applyField(session, ability.field, this.#at(primary), 'monster');
    }
    // O reflexo (#552) pode ter matado o monstro no meio da ability. Quem aplica dano não decide
    // morte: o pipeline resolve depois do golpe inteiro, como faz depois do golpe do personagem.
    if (!monster.alive) resolveDeath(session, { kind: 'monster', monster });
  }

  /**
   * A SEGUNDA resolução do reflexo (#552, M30-05): o dano que o equipamento do personagem devolve
   * ao monstro que o atacou. É uma EXTENSÃO (`reflectedDamageIntent`): passa por `resolveDamage`
   * contra a defesa do monstro sem bloqueio por defesa/armadura, nunca reflete de volta, não
   * critica e não faz leech (`attacker` nulo em `applyDamageOutcome`). O crédito do dano é do
   * personagem — ele conta para quem matou e para o DPS, como qualquer golpe dele.
   *
   * Não resolve a morte: quem chama decide quando (`#executeMonsterAbility`, depois do golpe
   * inteiro). O reflexo do MONSTRO sobre o personagem (#683) é o espelho deste, com o mesmo
   * `resolveReflect`.
   */
  #reflectOntoMonster(
    session: Session, character: CharacterRuntime, monster: MonsterRuntime, reflected: ReflectedDamage,
  ): void {
    const outcome = resolveDamage(
      reflectedDamageIntent(reflected), this.#monsterDefender(monster), 'pve', this.#options.combat,
      session.rng, session.nowMs,
    );
    const applied = this.#drainMonster(session, monster, outcome, null);
    recordDamage(monster.contribution, character.id, applied.healthDamage);
    session.emit({
      kind: 'creature-hit', creatureId: monster.subject, attackerId: character.id,
      amount: applied.healthDamage + applied.manaDamage, source: 'melee', position: this.#at(monster),
      damageType: outcome.damageType,
    });
    this.#emitHealth(session, monster);
    session.creditDamage(character.id, applied.healthDamage);
  }

  /**
   * O fim de um golpe de ability em UM alvo: aplica, atribui, anuncia, treina shielding e
   * decide a morte. É o mesmo corpo do ataque básico de sempre, agora por alvo.
   */
  #applyMonsterHit(
    session: Session, subject: string, character: CharacterRuntime, ability: MonsterAbility,
    defender: Defender, outcome: DamageOutcome, source: 'melee' | 'spell',
  ): void {
    // O CMB-08: o mana shield do personagem vira estágio explícito, e o hit/atribuição usam o
    // HP APLICADO. A postura (#155) escala o dano TOMADO antes do escudo; o atacante é `null`
    // porque monstro não faz leech — o outcome informa a mana absorvida sem matar ninguém. O
    // Energy Ring (SV-16) é a segunda fonte de escudo, resolvida por quem tem o catálogo.
    const applied = applyDamageOutcome(
      character, outcome, null, character.conditions.damageTakenScale(),
      this.#hasEnergyShield(character),
    );
    recordDamage(character.contribution, subject, applied.healthDamage);
    // A definição única de "em combate" (#625): ataque RECEBIDO — básico e ability declarada
    // passam os dois por aqui (`#onMonsterAttack`/`#onMonsterAbility` chamam
    // `#executeMonsterAbility`, que termina em cada alvo aqui). O espelho é `#land`/`#applyHits`,
    // que marcam o DADO.
    character.lastCombatActionAtMs = session.nowMs;
    // O colar gasta UMA carga por golpe do tipo que ele protege (ADR 0032 d.8), mesmo esquivado
    // (DT-03). A proteção vale NESTE golpe; a destruição, se zerou, é para o próximo.
    this.#consumeAmuletCharge(session, character, ability.damageType);
    // O golpe ANTES da barra (FUN-109): o número flutuante acompanha a barra caindo, não o
    // contrário. `attackerId` é o subject do monstro, o mesmo id com que ele nasceu e anda.
    session.emit({
      kind: 'creature-hit', creatureId: character.id, attackerId: subject,
      // `manaDamage` (#547, M29-07): o número que sobe azul quando a ability é `manadrain` — a
      // vida some do `healthDamage` (zero por design) para ele aparecer.
      amount: applied.healthDamage + applied.manaDamage, source, position: this.#at(character),
      damageType: outcome.damageType,
    });
    this.#emitCharacterHealth(session, character);
    // Shielding sobe pelo USO (CMB-04). Em `combat-v1`/`v2`: uma vez por ataque ELEGÍVEL
    // recebido — há fonte de defesa e o golpe é do TIPO que a defesa aprova
    // (`combat.defense.blockTypes`). Nunca por tick, nunca por dano aplicado.
    //
    // No `combat-v3` (#686) a regra é a do Canary (`Player::onBlockHit`), e substitui a
    // elegibilidade por origem que o #548 tinha posto aqui: o escudo só treina quando o golpe
    // recebido FOI bloqueado (defesa ou armadura) com carga de bloqueio, ainda há bloqueios de
    // escudo guardados (`shieldBlockCount`, recarregado pelo golpe limpo do PRÓPRIO personagem)
    // e é ESCUDO na mão — arma de uma mão não treina shielding. Apanhar, por si só, não treina.
    if (this.#isV3()) {
      const shield = afterShieldBlock(
        character.attackPractice, outcome, defender.defense?.kind === 'shield',
      );
      character.attackPractice = shield.state;
      if (shield.tries > 0) this.#gainSkills(session, character, 'shield-block', shield.tries);
    } else if (this.#options.combat.defense !== undefined
      && defender.defense !== undefined && defender.defense.kind !== 'none'
      && this.#options.combat.defense.blockTypes.includes(ability.damageType)) {
      this.#gainSkills(session, character, 'shield-block', 1);
    }
    // HP caiu: reavalia AGORA o que está engatilhado (FUN-84). Esperar o próximo múltiplo de
    // um relógio para curar quem está caindo é a mesma perda que o golpe engatilhado da
    // FUN-68 corrigiu do outro lado — só que aqui ela custa a vida do personagem.
    this.#armBot(session, character.id);
    // E os curandeiros da party: quem tem regra de alvo != self precisa acordar AGORA, sem
    // esperar o próprio ciclo de golpe — o HP que caiu é de OUTRO membro (RF-06).
    this.#armHealersOf(session);
    // E as automações defensivas (§13.8, AB-08): este é o instante em que o anel existe para
    // servir, e é a antecipação que faz o swap acontecer no golpe, não no próximo ciclo.
    this.#armAutomations(session, character.id);
    if (character.health > 0) return;

    // `receiveDamage` já marcou `alive = false`; `kill` é o que conta a morte no extrato e
    // avisa o ruleset. Chamar os dois é deliberado: quem aplica dano não decide morte.
    session.kill(character);
  }

  /**
   * O mesmo de `#applyMonsterHit`, para quando o ALVO é uma invocação de PERSONAGEM (#598, ADR
   * 0057 decisão 1 — "monstros a atacam"). Sem os mecanismos exclusivos do jogador — mana
   * shield, carga de colar/anel, prática de shielding, bot e automação: a invocação não tem
   * equipamento, skill nem bot próprio, só vida. O corpo é o de `#reflectOntoMonster` (o mesmo
   * "monstro como defensor" já usado quando o reflexo do jogador acerta o monstro atacante) —
   * `applyDamageOutcome` já é genérico sobre `DamageTarget` (`CharacterRuntime | MonsterRuntime`).
   *
   * A morte é resolvida AQUI, e não deixada para o fim de `#executeMonsterAbility` como o dano
   * ao próprio `monster` (reflexo): a invocação não é o atacante desta ability, e nada mais no
   * laço por alvo depende dela continuar viva depois deste golpe.
   *
   * Serve os DOIS sentidos do combate monstro-contra-monstro que o #598 abre: um monstro
   * HOSTIL golpeando a invocação do jogador (`target` é a invocação), e a invocação do jogador
   * golpeando um monstro hostil (`target` é o hostil, `attacker` é a invocação). No segundo
   * caso a atribuição (#598, ADR 0057 decisão 2) vai para o MESTRE, nunca para a invocação: o
   * dano dela entra no mapa de dano em nome de quem a invocou — é o que faz a XP por razão de
   * dano (#523) e o Bestiário renderem para o personagem, não para um `m:<id>` que `xpByDamage`
   * nunca reconheceria como participante.
   */
  #applyMonsterHitOnSummon(
    session: Session, attacker: MonsterRuntime, target: MonsterRuntime, outcome: DamageOutcome,
    source: 'melee' | 'spell',
  ): void {
    const creditId = typeof attacker.masterId === 'string' ? attacker.masterId : attacker.subject;
    const applied = this.#drainMonster(session, target, outcome, null);
    recordDamage(target.contribution, creditId, applied.healthDamage);
    session.emit({
      kind: 'creature-hit', creatureId: target.subject, attackerId: attacker.subject,
      amount: applied.healthDamage + applied.manaDamage, source, position: this.#at(target),
      damageType: outcome.damageType,
    });
    this.#emitHealth(session, target);
    // O dano da invocação conta para o DPS do MESTRE (#431), como qualquer golpe dele.
    if (typeof attacker.masterId === 'string') session.creditDamage(attacker.masterId, applied.healthDamage);
    if (target.health > 0) return;
    resolveDeath(session, { kind: 'monster', monster: target });
  }

  /** O mesmo do lado do monstro, e pela mesma razão. */
  #scheduleMonsterAbility(
    session: Session, monster: MonsterRuntime, ability: MonsterAbility, delayMs: number,
  ): void {
    monster.scheduledAbilities.add(ability.id);
    session.scheduleIn(MONSTER_ABILITY, delayMs, {
      priority: EventPriority.Attack, subject: monsterAbilitySubject(monster.id, ability.id),
    });
  }

  /** O mesmo, do lado da defesa (#518). */
  #scheduleMonsterDefense(
    session: Session, monster: MonsterRuntime, defense: MonsterDefense, delayMs: number,
  ): void {
    monster.scheduledDefenses.add(defense.id);
    session.scheduleIn(MONSTER_DEFENSE, delayMs, {
      priority: EventPriority.Attack, subject: monsterDefenseSubject(monster.id, defense.id),
    });
  }

  /**
   * Uma DEFESA declarada de um monstro venceu (#518, TFS `Monster::onThinkDefense`, referência
   * §15-19): cura própria. Independente do alvo — não precisa de ninguém para curar —, então
   * reagenda-se SEMPRE, ao contrário das abilities de ataque, que dependem de alcance. Vence sem
   * rolar nada com o monstro OCIOSO (`MonsterRuntime.idle`, #655), como o Canary.
   */
  #onMonsterDefense(session: Session, subject: string): void {
    // `m:<id>:<defenseId>`, o mesmo desenho de `#onMonsterAbility`.
    const rest = subject.startsWith('m:') ? subject.slice(2) : '';
    const separator = rest.indexOf(':');
    if (separator < 0) return;
    const monster = this.#monsterBySubject.get(monsterSubject(Number(rest.slice(0, separator))));
    if (monster === undefined || !monster.alive) return;
    const definition = this.#options.monsters.get(monster.monsterId);
    if (definition === undefined) return;
    const defenseId = rest.slice(separator + 1);
    const defense = definition.defenses.find((candidate) => candidate.id === defenseId);
    if (defense === undefined) return;

    monster.scheduledDefenses.delete(defense.id);
    this.#scheduleMonsterDefense(session, monster, defense, defense.cadenceMs);

    // Ocioso não usa defesa (#655): o Canary tira o monstro ocioso da lista de `onThink`
    // (`setIdle(true)` → `removeCreatureCheck`), então `onThinkDefense` nunca roda enquanto ele
    // dura — e sem rolagem, como lá. O timer continua reagendando acima (a fila segue dirigida
    // por evento; 1 Hz e 20 Hz idênticos), só vence sem efeito. Sem este corte, um Doom Deer
    // ocioso se daria haste sozinho, a condição impediria o ocioso e ele passearia pelo spawn.
    if (monster.idle) return;

    // `chance` é SEMPRE declarada aqui (o schema exige), então SEMPRE consome uma rolagem — ao
    // contrário de `ability.chance`, que só existe em conteúdo novo. UMA rolagem só: a defesa é
    // UMA entrada do `monster.defenses` do Canary, cura OU condição, nunca as duas competindo
    // por sorteios separados.
    if (!session.rng.chance(defense.chance)) return;

    if (defense.heal !== undefined) {
      // Normal truncada no `combat-v3` (#681, `monster.cpp:2218` → `combat.cpp:189`); uniforme antes.
      const amount = rollCombatValue(session.rng, defense.heal.min, defense.heal.max, this.#options.combat);
      const healed = monster.heal(definition.health, amount);
      // De vida cheia, zero repôs — sem evento, como a regeneração passiva (`#onRegen`): um "+0"
      // flutuando por cadência é ruído que uma hunt desanexada não precisa produzir.
      if (healed > 0) {
        session.emit({
          kind: 'creature-healed', creatureId: monster.subject, amount: healed, source: 'monster',
          position: this.#at(monster),
          ...(defense.presentation?.impactKey === undefined
            ? {} : { impactKey: defense.presentation.impactKey }),
        });
        this.#emitHealth(session, monster);
      }
    }
    // O self-haste (CMB-11, #556): a condição de velocidade que a defesa aplica em SI MESMO —
    // o Doom Deer. `baseSpeed` é o `speed` do PRÓPRIO monstro no instante da aplicação, como
    // `Creature::getBaseSpeed()` do Canary lê o de quem recebe a condição.
    if (defense.condition !== undefined) {
      this.#applyConditionTo(session, monster, conditionFromSpec(
        defense.condition, monster.subject, monster.subject, session.nowMs, 'monster-attack',
        { baseSpeed: monster.speed, rng: session.rng },
      ));
    }
  }

  /**
   * A troca de alvo por tempo de um monstro venceu (#518, TFS/Canary `Monster::onThinkTarget`,
   * `monster.cpp:2141-2192`, idêntico em `forgottenserver/src/monster.cpp:919-963`). Um timer
   * da instância, como a defesa — não depende do alvo atual estar vivo ou no alcance, e
   * reagenda-se sempre enquanto o monstro viver.
   *
   * **Nunca consulta `targetStrategy` (#645, ADR 0037 d.6).** `onThinkTarget` resolve o
   * critério só pelo `targetDistance` do TIPO do monstro (`definition.targetDistance`, #542 —
   * o MESMO campo `info.targetDistance` que o Canary lê aqui, não a distância corrida até o
   * alvo nem o alcance das abilities) —, nunca pelos pesos: `useRandomSearch = targetDistance
   * <= 1` (`monster.cpp:2185-2186`). Para o Dragon (`targetDistance: 1` em `dragon.lua`, melee
   * mesmo com bola/onda de alcance 7), isso é SEMPRE `RANDOM`; a estratégia ponderada só entra
   * no ramo estreito de `chooseTarget` (`monster.ts`, "fuga bloqueada") — ver "Seleção
   * ponderada de alvo" em `docs/product/combat.md`.
   */
  #onMonsterTargetChange(session: Session, subject: string): void {
    const monster = this.#monsterBySubject.get(subject);
    if (monster === undefined || !monster.alive) return;
    const definition = this.#options.monsters.get(monster.monsterId);
    const targetChange = definition?.targetChange;
    if (definition === undefined || targetChange === undefined) return;

    session.scheduleIn(MONSTER_TARGET_CHANGE, targetChange.intervalMs, {
      priority: EventPriority.Attack, subject,
    });

    // Ocioso não troca de alvo (#655): `onThinkTarget` também é do `onThink`, que o monstro
    // ocioso não roda — o mesmo corte de `#onMonsterDefense`, sem rolagem.
    if (monster.idle) return;

    // Invocação de PERSONAGEM (#598) nunca reavalia sozinha — o alvo é sempre o do mestre
    // (`#chooseMonsterTarget`, chamado pelo passo/ataque/ability dela). O evento continua
    // reagendando acima (é inofensivo, como o de `MONSTER_SUMMON` numa invocação que nunca
    // arma a própria lista), mas não sorteia nada daqui em diante.
    if (typeof monster.masterId === 'string') return;

    if (!session.rng.chance(targetChange.chance)) return;

    // Um alvo válido DIFERENTE do atual — trocar para o mesmo não é troca. O mesmo andar
    // primeiro (#519): um alvo em outro andar não é alvo válido — o `isTarget` do TFS confere o
    // `z` antes da distância, como `chooseTarget` já faz. Estendido pelas invocações de
    // personagem VIVAS (#598), como `#chooseMonsterTarget` — mesma referência de
    // `session.participants` quando não há nenhuma.
    const summons = this.#playerSummonPrey();
    const prey: readonly Prey[] = summons.length === 0
      ? session.participants
      : [...session.participants, ...summons];
    // `searchTarget` só olha quem `isTarget` aceita, e `isTarget` exige `canSeeCreature` (Canary
    // `monster.cpp:1435`) — quem não "vê invisível" nunca sorteia um alvo invisível (#559).
    const blind = !seesInvisible(definition);
    const candidates = prey.filter((candidate) => candidate.alive
      && candidate.id !== monster.targetId
      && !(blind && candidate.invisible === true)
      && sameFloor(monster.position.z, candidate.position.z)
      && distance(monster.position, candidate.position) <= definition.aggroRadius);
    if (candidates.length === 0) return;

    // RANDOM para `targetDistance <= 1` (o caso do rato/rotworm/Dragon/Dragon Lord), NEAREST
    // fixo para quem mantém distância — zero peso consultado, como `onThinkTarget` real.
    const chosen = definition.targetDistance <= 1
      ? candidates[session.rng.integer(0, candidates.length - 1)] ?? null
      : nearestPrey(monster.position, candidates);
    if (chosen === null) return;
    monster.targetId = chosen.id;
    this.#armMonsterAbilities(session, monster, definition, chosen);
  }

  /**
   * Pede um passo e emite o que voltou.
   *
   * É por aqui que TODO passo da hunt passa — bot, monstro e o `walk` do socket. Uma recusa
   * não é erro: o tile pode estar ocupado agora, e ficar parado até o vencimento seguinte é o
   * mesmo que o passo guloso já fazia ao empacar (ADR 0009).
   *
   * O desvio de drunk (M31-03, #558) troca o destino ANTES do commit — é por isto que TODO
   * passo passar por aqui basta para cobrir o `walk` manual, a rota do bot e o passo guloso do
   * monstro com a MESMA regra (ADR 0041 decisão 3 — o passo conduzido pelo bot inclusive, sem
   * exceção de automação, invariante 11). Um tile desviado bloqueado falha como `move` já falha
   * para qualquer outro motivo — o bot replaneja sozinho no próximo vencimento, sem tratamento
   * especial.
   *
   * `rollDrunk` (achado da revisão do #651) é `false` só na tentativa de RECUPERAÇÃO que
   * `#playerStep` faz no MESMO vencimento — o contorno de companheiro e o fecha-distância de
   * `not-adjacent` (§ logo abaixo) chamam `#step` de novo depois que a tentativa PRIMÁRIA já
   * rolou drunk (se a criatura tiver a condição). Sem isto, um único vencimento de
   * `PLAYER_STEP` podia consumir DOIS sorteios independentes — o próprio Canary nunca faz isso:
   * `Monster::doFollowCreature`/`doWalkBack` (`monster.cpp`) caem para `getDanceStep`/
   * `getRandomStep` quando o passo primário falha, e nenhum dos dois passa de novo por
   * `Creature::getNextStep`/`onWalk` — o sorteio é UM por DECISÃO de movimento, nunca um por
   * tentativa física de chegar lá.
   *
   * `forced` (M44-04, #622) marca o passo que NÃO é a caminhada própria da criatura: a fuga do
   * medo, o passo de um `walk-to` já guardado e o empurrão. As condições de controle o tratam
   * diferente — `feared` recusa o INÍCIO do caminhar do próprio jogador (`Creature::startAutoWalk`,
   * antes de qualquer sorteio) mas não a lista de passos que já corre nem a fuga que ele mesmo
   * impõe (`forcePlayerAutoWalk` passa `ignoreConditions`); `rooted` recusa TODO passo, o forçado
   * inclusive (`Game::internalMoveCreature`, DEPOIS do desvio de drunk — o sorteio de quem está
   * preso e bêbado ao mesmo tempo acontece igual). Um passo forçado dentro de um campo que causa
   * dano é recusado sob `feared` (`game.cpp:1975-1980`): a fuga desvia dele, nunca o atravessa — e
   * para o PERSONAGEM o campo do tile PEDIDO é olhado ANTES do desvio (`Player::onWalk`), sem
   * sorteio nenhum.
   *
   * Para um MONSTRO, o DESVIO DE DANO é revalidado aqui, no COMMIT — não só na decisão (M29-05,
   * achado da revisão do #650): `decideMonsterAction` já filtrou os candidatos com
   * `#blockedForMonster`, mas o destino que chega até aqui pode ter sido REESCRITO depois da
   * decisão (o desvio de embriaguez do #558, logo acima) sem passar de novo por aquele
   * predicado. Isto é `canMonsterEnterField` (M29-05) — a preferência que só o monstro respeita
   * e só quando o campo tem `damageType` (`Movable`/`MovementWorld` continuam genéricos e
   * servem a Cidade também, então o desvio não pode morar ali). O campo BLOQUEANTE (#560, Magic
   * Wall/Wild Growth) é outra checagem, e já mora dentro de `move()`/`canOccupy`
   * (`TileOccupancy.blockedAt` consulta `Fields.blockedAt`) — vale para QUALQUER criatura sem
   * precisar de uma segunda checagem aqui, e é por isso que só o desvio de dano precisa dela.
   */
  #step<P extends GridPoint>(
    session: Session, mover: Movable<P>, to: P, creatureId: string, rollDrunk = true, forced = false,
  ): MoveResult {
    // `size > 0`: `#step` é o caminho quente de todo passo de todo monstro, e a criatura sem
    // NENHUMA condição — o caso comum — nunca paga as leituras de controle abaixo.
    const controlled = (mover instanceof CharacterRuntime || mover instanceof MonsterRuntime)
      && mover.conditions.size > 0;
    if (controlled && !forced) {
      // `startAutoWalk` recusa a caminhada de quem está preso ou com medo, antes de qualquer
      // sorteio (M44-04, #622): nem o `walk` do socket, nem a rota do bot, nem o passo do monstro.
      const refusal = this.#controlRefusal(mover, session.nowMs);
      if (refusal !== null) return { ok: false, reason: refusal };
    }
    // `Player::onWalk` (`player.cpp:2942-2955`) olha o campo de dano do tile PEDIDO antes do
    // `Creature::onWalk` — que é onde o drunk sorteia: sob `feared`, um passo da lista de passos
    // para um campo que causa dano volta aí, sem sorteio e sem desvio. O mesmo campo no tile
    // desviado é recusado mais abaixo, por `internalMoveCreature`.
    if (rollDrunk && controlled && forced && mover instanceof CharacterRuntime
      && mover.conditions.isActive(FEARED_CONDITION_KEY, session.nowMs)
      && this.#harmfulFieldAt(to, this.#floorOf(mover))) {
      return { ok: false, reason: 'feared' };
    }
    const target = rollDrunk ? this.#drunkTarget(session, mover, to) : to;
    if (controlled) {
      // O que `internalMoveCreature` ainda recusa DEPOIS do desvio: `rooted` sempre, e sob
      // `feared` o campo que causa dano no destino (só a fuga chega aqui — o resto já voltou).
      if (mover.conditions.isActive(ROOTED_CONDITION_KEY, session.nowMs)) return { ok: false, reason: 'rooted' };
      if (mover.conditions.isActive(FEARED_CONDITION_KEY, session.nowMs)
        && this.#harmfulFieldAt(target, this.#floorOf(mover))) {
        return { ok: false, reason: 'feared' };
      }
    }
    // O campo é conferido no destino FINAL — depois do desvio de drunk, que pode ter trocado o
    // tile aprovado pela decisão (M29-05, achado da revisão do #650).
    if (mover instanceof MonsterRuntime && this.#monsterFieldBlocked(mover, target)) {
      return { ok: false, reason: 'tile-blocked' };
    }
    // Empurra quem ocupa o destino FINAL, pela mesma razão do campo acima (M29-08): o destino
    // que chega até aqui pode ter sido reescrito depois da decisão em `#monsterBlocked`.
    if (mover instanceof MonsterRuntime) this.#clearPushableOccupant(session, mover, target);
    let result = move(this.#world, mover, target);
    // O jogador ATRAVESSA a invocação de qualquer jogador (#600, `Player::canWalkthrough`): o
    // tile ocupado por ela não recusa o passo, troca de lugar com ela. Vale para todo passo de
    // personagem — a rota do bot, o follow e o `walk` à mão —, que é o que este ponto único cobre.
    let walkedThrough: MonsterRuntime | null = null;
    let walkedThroughStep: Extract<MoveResult, { ok: true }> | null = null;
    if (!result.ok && result.reason === 'tile-occupied' && mover instanceof CharacterRuntime) {
      const summon = this.#playerSummonAt(target, this.#floorOf(mover));
      if (summon !== null) {
        const swapped = swapPlaces(this.#world, mover, summon);
        if (swapped.ok) {
          result = swapped.mover;
          walkedThrough = summon;
          walkedThroughStep = swapped.other;
        }
      }
    }
    if (result.ok) {
      // O instante do último passo do MONSTRO (#655, `Creature::lastStep`): o passo aleatório o
      // lê para respeitar o intervalo mínimo. É gravado aqui porque `#step` é o único ponto por
      // onde toda posição muda — perseguição, volta ao spawn, passo aleatório, dança e empurrão
      // (`#pushAside`) —, e o Canary o grava em qualquer deslocamento do próprio monstro.
      if (mover instanceof MonsterRuntime) mover.lastMoveAtMs = session.nowMs;
      // A direção do personagem (#155): é de onde saem onda, cleave e feixe. Só o passo a
      // escreve, e só a do personagem — o monstro não lança magia.
      if (mover instanceof CharacterRuntime) {
        mover.direction = directionOf(result.from, result.to) ?? mover.direction;
        // Stairhop (#554, M30-07, ADR 0040 decisão 1): trocar de andar OU ser redirecionado por
        // um teleporte tranca o ataque do personagem por `stairhopDelayMs` — `oldPos.z !=
        // newPos.z || teleport` do Canary (`player.cpp:12417-12423`). Escada e teleporte passam
        // pelos DOIS mesmos redirecionamentos de `move()` (`packages/sim/src/movement.ts`), e um
        // que pousa fora do tile adjacente pedido É um dos dois — um passo comum nunca é. Só o
        // `combat-v3` lê (`#isV3`); ausente é identidade, e nenhuma sessão v1/v2 grava a trava.
        this.#lockAfterJump(session, mover, result);
      }
      session.emit({
        kind: 'creature-moved', creatureId,
        from: result.from, to: result.to, durationMs: result.durationMs,
      });
      // Um passo do personagem ou do alvo dele solta o golpe estacionado depois de `pacified`
      // (M44-04, #622): `Creature::onCreatureMove`, o "extra swing" do Canary.
      if (mover instanceof CharacterRuntime || mover instanceof MonsterRuntime) {
        this.#releaseParkedAttacks(session, mover);
      }
      // A entrada num campo (CMB-07) é observada SÓ depois de um passo ACEITO: `movement`
      // devolve resultado e nunca infringe dano. Um tile recusado não aplica o campo.
      if (mover instanceof CharacterRuntime || mover instanceof MonsterRuntime) {
        this.#enterField(session, mover);
      }
      if (walkedThrough !== null && walkedThroughStep !== null) {
        // A invocação foi para o tile de ONDE o personagem saiu: o cliente a vê trocar de lugar. Ela
        // NÃO entra num campo de lá nem aperta placa — no Canary ela nem se mexeu, os dois dividiam
        // o tile; a troca é só como este motor (ocupação exclusiva) representa isso.
        session.emit({
          kind: 'creature-moved', creatureId: walkedThrough.subject,
          from: walkedThroughStep.from, to: walkedThroughStep.to, durationMs: walkedThroughStep.durationMs,
        });
        // Nenhuma placa de pressão: os DOIS tiles continuam ocupados, e a placa só solta quando o
        // tile esvazia (`#onSteppedOffOf`).
        return result;
      }
      // Placa de pressão (#734, ADR 0050 d.6 T3): `#step` é o ÚNICO lugar que escreve posição
      // (comentário do topo do arquivo), então é o único choke point que cobre bot, monstro E o
      // `walk` do socket sem duplicar a checagem em cada chamador. Pressiona o destino ANTES de
      // soltar a origem — a ordem só importa quando `from`/`to` fossem a MESMA placa, que
      // `canOccupy` já recusa como `same-tile`, então não há ambiguidade real.
      const character = mover instanceof CharacterRuntime ? mover : null;
      this.#onSteppedOnto(session, character, result.to);
      this.#onSteppedOffOf(session, character, result.from);
    }
    return result;
  }

  /**
   * O stairhop (#554, M30-07): um passo que trocou de andar OU pousou fora do tile adjacente
   * pedido tranca o ataque do personagem por `stairhopDelayMs`. Extraído de `#step` no #623 porque
   * Levitate e Magic Rope também são saltos — `Player::onCreatureMove` do Canary trata do mesmo
   * jeito qualquer `teleport || oldPos.z != newPos.z`, sem perguntar se foi escada, magia ou
   * teleporte de cenário. Só o `combat-v3` lê; ausente é identidade.
   */
  #lockAfterJump(session: Session, mover: CharacterRuntime, result: MoveResult & { readonly ok: true }): void {
    const stairhopDelayMs = this.#options.combat.stairhopDelayMs;
    if (stairhopDelayMs !== undefined && this.#isV3() && (
      result.to.z !== result.from.z
      || Math.abs(result.to.x - result.from.x) > 1
      || Math.abs(result.to.y - result.from.y) > 1
    )) {
      // A condição `pacified` de verdade (M44-04, #622), `createCondition(CONDITIONID_DEFAULT,
      // CONDITION_PACIFIED, STAIRHOP_DELAY)` — com a fusão de `updateCondition`: uma
      // pacificação mais longa que já corre (o Swift Foot) não é encurtada pela troca de andar.
      this.#applyConditionTo(session, mover, {
        key: PACIFIED_CONDITION_KEY, targetId: mover.id, sourceId: mover.id,
        expiresAtMs: session.nowMs + stairhopDelayMs, merge: 'longest',
      });
    }
  }

  /**
   * O SALTO do personagem para `to` (#623: Levitate, Magic Rope) — a mesma cauda de `#step`
   * (stairhop, `creature-moved`, campo, placa de pressão), sem virar o personagem: o Canary não
   * troca a direção de quem levita (`creature:move` não passa direção) nem de quem sobe pela corda.
   * Devolve `false`, sem escrever nada, quando o destino recusa — `relocate` nunca aplica pela
   * metade. Mora aqui, com `#step`, porque este é o outro único ponto que escreve posição.
   */
  #relocateCharacter(session: Session, character: CharacterRuntime, to: WorldPoint): boolean {
    const result = relocate(this.#world, character, to);
    if (!result.ok) return false;
    // O salto CANCELA a caminhada manual em curso (`walk-to`, #763): `Creature::onCreatureMove`
    // do Canary chama `stopEventWalk()` para todo `teleport || oldPos.z != newPos.z`, e Levitate e
    // Magic Rope são os dois. Sem isto o `manualWalkTo` ficava de pé com o `path[0]` do ANDAR
    // ANTIGO, e `#playerStep` — que dá prioridade a ele sobre combate, follow e rota — repetia o
    // mesmo tile recusado (`same-tile`/`not-adjacent`) para sempre: a hunt idle congelada, com o
    // navegador fechado, até alguém mandar uma intenção nova. É o mesmo descarte que o ramo
    // adjacente de `requestMove` faz, e o bot retoma pela rota no vencimento seguinte.
    const runner = this.#runners.get(character.id);
    if (runner !== undefined) {
      runner.manualWalkTo = null;
      runner.manualWalkHoldUntilMs = null;
    }
    this.#lockAfterJump(session, character, result);
    session.emit({
      kind: 'creature-moved', creatureId: character.id,
      from: result.from, to: result.to, durationMs: result.durationMs,
    });
    this.#enterField(session, character);
    this.#onSteppedOnto(session, character, result.to);
    this.#onSteppedOffOf(session, character, result.from);
    return true;
  }

  /**
   * A invocação de jogador VIVA em `at` (#600) — a que o personagem atravessa em vez de bater nela.
   * `Player::canWalkthrough` do Canary (`player.cpp`) libera a criatura cujo mestre é um jogador no
   * mundo no-pvp (ADR 0060), de QUALQUER dono: a do próprio personagem e a de um companheiro de party.
   * Linear sobre `#monsters`, e só no caminho de um passo recusado por ocupação — o mesmo custo de
   * `#monsterAt`.
   */
  #playerSummonAt(at: GridPoint, z: number): MonsterRuntime | null {
    for (const candidate of this.#monsters) {
      if (!candidate.alive || typeof candidate.masterId !== 'string') continue;
      if (candidate.position.x !== at.x || candidate.position.y !== at.y) continue;
      if (!sameFloor(candidate.position.z, z)) continue;
      return candidate;
    }
    return null;
  }

  /**
   * Abre o tile de destino para quem `canPushCreatures` (M29-08, TFS/Canary `Monster::
   * pushCreatures`, `monster.cpp:2405-2440`): sem efeito para quem não tem a flag, para tile
   * vazio, ou quando o ocupante não é um monstro `pushable` — inclusive o JOGADOR, que
   * `#monsterAt` nunca encontra (só varre `this.#monsters`). Roda no COMMIT — dentro de
   * `#step`, revalidado no destino FINAL —, nunca na decisão: `decideMonsterAction`
   * (`monster/monster.ts`) é PURA e não pode mover ninguém (invariante 9); só `#step` tem
   * autoridade de escrita.
   *
   * **Só em `combat-v3`** (ADR 0031/0040): o empurrão consome `session.rng` (`#pushAside`, o
   * Fisher-Yates dos 4 cardeais) e move OUTRA criatura, e as duas coisas mudam o que uma hunt
   * `combat-v1`/`v2` congelada rende — a MESMA razão pela qual `#practice`/o crítico de item
   * (CMB-08, #551) e o hit chance de distância (#555) só entram sob `combat-v3`. Hoje nenhum
   * monstro do catálogo declara `canPushCreatures` (Dragon e Dragon Lord AINDA não — ver a nota
   * de `pushable`/`canPushCreatures`/`canPushItems` no schema), mas o predicado de decisão
   * (`#pushablePathThrough`) já teria mudado o CAMINHO escolhido bem antes de chegar aqui: a
   * dupla checagem (lá e aqui) é a mesma redundância que `#monsterFieldBlocked` já faz para o
   * campo — nunca confiar que só o outro lado da linha barrou.
   */
  #clearPushableOccupant(session: Session, pusher: MonsterRuntime, to: GridPoint): void {
    if (!this.#isV3()) return;
    const definition = this.#options.monsters.get(pusher.monsterId);
    if (definition === undefined || !definition.canPushCreatures) return;
    const z = this.#floorOf(pusher);
    if (!this.#world.occupied(to.x, to.y, z)) return;
    const occupant = this.#monsterAt(to.x, to.y, z, pusher);
    if (occupant === null) return;
    if (this.#options.monsters.get(occupant.monsterId)?.pushable !== true) return;
    if (!this.#pushAside(session, occupant)) this.#crushMonster(session, occupant);
  }

  /** O monstro VIVO em (x, y, z), exceto `exclude` — varre `this.#monsters`, nunca jogador. */
  #monsterAt(x: number, y: number, z: number, exclude: MonsterRuntime): MonsterRuntime | null {
    for (const candidate of this.#monsters) {
      if (candidate === exclude || !candidate.alive) continue;
      if (candidate.position.x !== x || candidate.position.y !== y) continue;
      if (!sameFloor(candidate.position.z, z)) continue;
      return candidate;
    }
    return null;
  }

  /**
   * Empurra para um tile cardinal livre, em ordem embaralhada pelo `session.rng` — o
   * Fisher-Yates completo de `shuffledCardinals` (o mesmo do passo aleatório, #655), parente do
   * parcial de `#creditStock` mais abaixo — e tenta cada um pelo MESMO `#step` de qualquer outro
   * passo (§10.2 da referência de domínio: nunca atribuir a posição da vítima diretamente,
   * sempre pelo mesmo `MovementSystem`). `rollDrunk: false`: o empurrão é força EXTERNA, não a
   * decisão de movimento do empurrado — ele não rola a própria condição por ter sido empurrado. Devolve `false`, sem NENHUM efeito, quando os quatro recusam
   * (parede, fora do mapa, outro ocupante, campo que ele mesmo não cruza) — quem chama esmaga.
   */
  #pushAside(session: Session, occupant: MonsterRuntime): boolean {
    for (const direction of shuffledCardinals(session.rng)) {
      const candidate = {
        ...occupant.position, x: occupant.position.x + direction.x, y: occupant.position.y + direction.y,
      };
      // `forced` (M44-04, #622): o empurrão é força EXTERNA (`internalMoveCreature` direto, sem
      // `startAutoWalk`) — quem está com medo é empurrado como qualquer um, quem está preso não.
      if (this.#step(session, occupant, candidate, occupant.subject, false, true).ok) return true;
    }
    return false;
  }

  /**
   * Esmaga quem não coube em nenhum cardinal (Canary `Monster::pushCreatures`, `monster.cpp:
   * 2429-2431`: `changeHealth(-health)` + `setDropLoot(true)`). Zera a vida e entrega ao MESMO
   * pipeline de morte de qualquer monstro (`resolveDeath` → `#onMonsterDied`) — nunca um segundo
   * caminho de morte: `contribution` continua vazia (ninguém bateu), então `credit.lastHitBy` é
   * `null`, e `#onMonsterDied` já paga a regra de "sem dono" que um abate cujo matador sumiu
   * paga hoje — sem XP, loot elegível a quem estiver presente. Não passa por `resolveDamage`:
   * não é golpe, é esmagamento — o Canary também não chama `Game::combatChangeHealth` aqui, só
   * `changeHealth` direto, sem tipo de dano, sem defesa, sem crítico.
   */
  #crushMonster(session: Session, occupant: MonsterRuntime): void {
    occupant.health = 0;
    resolveDeath(session, { kind: 'monster', monster: occupant });
  }

  /** Pisou numa placa de pressão OCIOSA (`up`): pressiona, com o cascade de `links` de sempre. */
  #onSteppedOnto(session: Session, character: CharacterRuntime | null, at: WorldPoint): void {
    const current = this.#tileOverrides.at(at);
    if (current === null || current.kind !== 'pressure-plate' || current.state !== 'up') return;
    this.#useInteractable(session, character, current.interactableId);
  }

  /**
   * Saiu de uma placa PRESSIONADA (`down`): solta. A ocupação de tile é EXCLUSIVA (invariante 8
   * na letra do `sim` — `TileOccupancy.#occupied` é um `Set` por tile, `canOccupy` recusa
   * `tile-occupied`), então a origem de um passo aceito está SEMPRE vazia neste ponto — não há
   * "ainda tem alguém ali" para conferir, ao contrário da porta (`closeDoorIfVacant`), cujo
   * `stillOccupied` é defensivo para um caso que nem chega a existir hoje.
   */
  #onSteppedOffOf(session: Session, character: CharacterRuntime | null, at: WorldPoint): void {
    const current = this.#tileOverrides.at(at);
    if (current === null || current.kind !== 'pressure-plate' || current.state !== 'down') return;
    this.#useInteractable(session, character, current.interactableId);
  }

  /**
   * O destino de um passo, depois do desvio de drunk (M31-03, #558, `Creature::onWalk` do
   * Canary/TFS). Só personagem e monstro carregam `Conditions` — os dois únicos tipos que
   * `#step` recebe —, e só quem TEM a condição (`Conditions.hasDrunk`) chega a rolar: uma
   * criatura sem drunk nunca consome este sorteio (a mesma regra do `chance` ausente de uma
   * ability, CMB-06). O desvio troca só x/y, a partir da posição ATUAL — nunca da direção que
   * `to` já representava —, e preserva o resto de `to` (o `z` que o chamador já resolveu).
   */
  #drunkTarget<P extends GridPoint>(session: Session, mover: Movable<P>, to: P): P {
    if (!(mover instanceof CharacterRuntime) && !(mover instanceof MonsterRuntime)) return to;
    if (!mover.conditions.hasDrunk()) return to;
    // O drunk que já estava ativo quando o item suprimidor foi vestido fica oculto (#688, o
    // `hasCondition` do Canary devolve false): sem desvio, e sem consumir sorteio.
    if (mover instanceof CharacterRuntime
      && mover.inventory.suppresses(this.#options.items, DRUNK_CONDITION_KEY)) return to;
    const { direction } = rollDrunkDeviation(session.rng);
    // `speak` (r <= 4, "Hicks!") fica sem consumidor: o Draconya ainda não tem evento de fala de
    // criatura (docs/product/combat.md) — presentação, não regra de hunt (ADR 0037 d.6).
    if (direction === null) return to;
    const offset = FORWARD[direction];
    return { ...to, x: mover.position.x + offset.x, y: mover.position.y + offset.y };
  }

  // --- as condições de controle: rooted, feared e pacified (M44-04, #622) -----------------------

  /**
   * Por que a criatura NÃO anda por conta própria agora: `rooted` ou `feared`, nessa ordem, ou
   * `null` quando nada a prende. É o que `Creature::startAutoWalk` confere (`creature.cpp:329`) —
   * o portão de toda caminhada que a criatura decide, seja o `walk` do socket, a rota do bot ou o
   * passo do monstro.
   */
  #controlRefusal(mover: ConditionTarget, nowMs: number): 'rooted' | 'feared' | null {
    if (mover.conditions.isActive(ROOTED_CONDITION_KEY, nowMs)) return 'rooted';
    if (mover.conditions.isActive(FEARED_CONDITION_KEY, nowMs)) return 'feared';
    return null;
  }

  /**
   * O tile tem um campo que causa dano e NÃO bloqueia (`field && !field->isBlocking() &&
   * field->getDamage() != 0`, `game.cpp:1975-1980` e `condition.cpp:2214`)? É o campo que a fuga do
   * medo nunca pisa. "Causa dano" é uma condição de dano ao longo do tempo no estágio VIGENTE do
   * campo — o estágio mudo do fire field (`decayTo` sem dano) e o campo só de bloqueio não valem.
   */
  #harmfulFieldAt(point: GridPoint, z: number): boolean {
    const field = this.#fields.at({ x: point.x, y: point.y, z });
    return field !== null && field.blocksMovement !== true
      && field.condition?.effect.kind === 'damage-over-time';
  }

  /**
   * O mundo que a fuga do medo enxerga a partir de um personagem (`FleeMap`, `fear.ts`). O tile é
   * transitável para a BUSCA como `Tile::queryAdd(FLAG_PATHFINDING)` diz: parede, borda, porta
   * fechada e campo bloqueante (`blockedAt`), criatura no tile, escada e teleporte (o pathfinding
   * do Canary os recusa) e nada mais — o campo de dano NÃO barra a busca, só o passo.
   */
  #fleeMapFor(character: CharacterRuntime): FleeMap {
    const z = this.#floorOf(character);
    return {
      walkable: (x, y) => !this.#world.blockedAt(x, y, z)
        && this.#world.floorChangeAt(x, y, z) === null
        && this.#world.teleportAt(x, y, z) === null
        && !this.#world.occupied(x, y, z),
      harmfulField: (x, y) => this.#harmfulFieldAt({ x, y }, z),
      sightClear: (from, to) => isSightClear(this.#world.map, { ...from, z }, { ...to, z }),
    };
  }

  /**
   * `Combat::checkFearConditionAffected` (`combat.cpp:1003`): o personagem aceita um medo NOVO?
   * Não, quando está dentro da imunidade de 10 s do medo anterior (11 s depois de um Cleanse,
   * `Player::isImmuneFear`), quando JÁ está com medo, e quando a party dele já tem gente demais com
   * medo — `(membros + 5) / 5` de cada vez, em inteiro, contando os membros SEM o líder (o
   * `memberList` do Canary não o inclui) e descontando os que estão com medo agora (o líder com
   * medo não desconta: o laço do Canary só olha `getMembers()`). Sozinho, não há party.
   */
  #fearAffects(session: Session, character: CharacterRuntime): boolean {
    if ((character.cleanseImmunity.get(FEARED_CONDITION_KEY) ?? -1) >= session.nowMs) return false;
    if (character.conditions.isActive(FEARED_CONDITION_KEY, session.nowMs)) return false;
    const participants = session.participants;
    if (participants.length <= 1) return true;
    const leaderId = this.#party?.leaderId ?? participants[0]?.id;
    const members = participants.filter((member) => member.id !== leaderId);
    let affectable = Math.floor((members.length + 5) / 5);
    for (const member of members) {
      if (member.conditions.isActive(FEARED_CONDITION_KEY, session.nowMs)) affectable -= 1;
    }
    return affectable > 0;
  }

  /**
   * `ConditionFeared::startCondition` (`condition.cpp:2396`): a direção de fuga inicial, a partir de
   * ONDE o lançador está agora (`CONDITION_PARAM_CASTER_POSITION`, que `CombatConditionFunc` grava
   * no clone). Sem lançador conhecido (campo, ou um que já saiu do mundo), o tile do próprio
   * personagem — o caso do sorteio, o único que consome o `Rng` da sessão.
   */
  #startFlee(session: Session, character: CharacterRuntime, condition: ConditionState): FleeState {
    const caster = condition.sourceId === undefined
      ? null : this.#conditionTargetOf(session, condition.sourceId);
    const from = this.#at(caster ?? character);
    const index = initialFleeIndex(this.#fleeMapFor(character), character.position, from, session.rng);
    return { from, index };
  }

  /**
   * O corpo de `ConditionFeared::executeCondition` que decide a fuga (`condition.cpp:2403-2427`): com
   * MENOS de dois passos por dar, escolhe a direção (se ainda não escolheu) e busca o caminho.
   * Devolve a lista a entregar a `forcePlayerAutoWalk` — possivelmente vazia —, ou `null` quando
   * o Canary devolve `false` (preso: nenhum vizinho aceita o passo). O índice de fuga que a busca
   * girou volta para o estado da condição: é ele que faz o próximo pensamento tentar outra direção.
   */
  #fleeFor(session: Session, character: CharacterRuntime, condition: ConditionState): readonly number[] | null {
    const flee = condition.flee;
    if (flee === undefined) return null;
    const map = this.#fleeMapFor(character);
    let index = flee.index;
    if (index === NO_FLEE_INDEX) index = initialFleeIndex(map, character.position, flee.from, session.rng);
    const result = fleePath(map, character.position, index);
    if (result.index !== flee.index) {
      character.conditions.replace({ ...condition, flee: { ...flee, index: result.index } });
    }
    return result.ok ? result.path : null;
  }

  /**
   * `Game::forcePlayerAutoWalk` (`game.cpp:4548`): a lista de passos do medo SUBSTITUI a
   * caminhada do próprio jogador (`startAutoWalk` limpa `listWalkDir`) — a de um `walk-to`
   * distante inclusive. Lista vazia não anda: o Canary devolve antes de agendar passo nenhum.
   */
  #startFleeWalk(runner: Runner, path: readonly number[]): void {
    runner.manualWalkTo = null;
    runner.fearWalk = path.length === 0 ? null : path;
  }

  /**
   * O medo do personagem acabou (`ConditionFeared::endCondition`, `condition.cpp:2429-2438`): a
   * caminhada forçada para (`stopEventWalk`) e ele ganha 10 s de imunidade a um medo novo
   * (`Player::setImmuneFear`). Serve o fim natural (o pensamento depois do prazo) e a remoção por
   * fora (Cleanse, cura) — quem chama já tirou a condição, ou é ela que este método tira.
   */
  #endFear(session: Session, character: CharacterRuntime): void {
    session.cancelEvent(FEAR_THINK, character.id);
    character.conditions.remove(FEARED_CONDITION_KEY);
    character.cleanseImmunity.set(FEARED_CONDITION_KEY, session.nowMs + FEAR_IMMUNITY_MS);
    const runner = this.#runners.get(character.id);
    if (runner !== undefined) runner.fearWalk = null;
  }

  /**
   * O pensamento do medo venceu (`ConditionFeared::executeCondition`, `Game::checkCreatures`).
   * A ordem é a do Canary: primeiro a fuga (que só ENFILEIRA a caminhada forçada), depois a
   * checagem de prazo da `Condition` base — que, passado o `endTime`, fecha o medo e para a
   * caminhada em curso. A caminhada que a fuga acabou de enfileirar roda DEPOIS do fim
   * (`g_dispatcher().addEvent`), sem depender mais da condição: o jogador ainda foge a lista
   * inteira depois de o medo acabar, uma vez.
   */
  #onFearThink(session: Session, characterId: string): void {
    const character = findById(session.participants, characterId);
    const runner = this.#runners.get(characterId);
    if (character === null || !character.alive || runner === undefined) return;
    const condition = character.conditions.get(FEARED_CONDITION_KEY);
    if (condition === null) return;
    // `creature->getWalkSize() < 2`: a lista de passos é UMA no Canary, e aqui ela mora em dois
    // lugares — a fuga e o `walk-to` distante que o jogador já tinha guardado (os dois nunca
    // coexistem: `#startFleeWalk` e `requestMove` limpam um ao pôr o outro). Com dois passos ou
    // mais por andar, o medo ainda não foge: o jogador termina o caminho dele.
    const walkSize = runner.fearWalk?.length ?? runner.manualWalkTo?.path.length ?? 0;
    const path = walkSize < 2 ? this.#fleeFor(session, character, condition) : null;
    if (condition.expiresAtMs < session.nowMs) {
      this.#endFear(session, character);
    } else {
      session.scheduleIn(FEAR_THINK, CREATURE_THINK_INTERVAL_MS, {
        priority: EventPriority.Movement, subject: characterId,
      });
    }
    if (path !== null) this.#startFleeWalk(runner, path);
  }

  /**
   * Um passo da caminhada forçada (`Creature::onCreatureWalk` com `getNextStep`): tira o
   * PRIMEIRO da lista e tenta pisar no tile daquela direção A PARTIR DE ONDE O PERSONAGEM ESTÁ
   * AGORA — o passo recusado (parede, campo de dano, criatura) é descartado, e o seguinte sai da
   * posição em que ele ficou, sem replanejar: é assim que o Canary consome `listWalkDir`.
   *
   * A lista vazia é o `onWalkComplete` (`Player::onWalkComplete`, `player.cpp:6247`): se o medo
   * AINDA vale, a fuga é reavaliada na hora, em vez de esperar o próximo pensamento; senão a
   * caminhada acaba e o personagem volta a andar por conta própria.
   */
  #advanceFearWalk(session: Session, character: CharacterRuntime, runner: Runner): MoveResult | null {
    const walk = runner.fearWalk;
    if (walk === null) return null;
    const [direction, ...rest] = walk;
    if (direction === undefined) {
      runner.fearWalk = null;
      const condition = character.conditions.get(FEARED_CONDITION_KEY);
      if (condition !== null && condition.expiresAtMs >= session.nowMs) {
        const path = this.#fleeFor(session, character, condition);
        if (path !== null) this.#startFleeWalk(runner, path);
      }
      this.#armPlayerAttack(session, character);
      return null;
    }
    runner.fearWalk = rest;
    const next = stepFrom(character.position, direction);
    const result = this.#step(
      session, character, { ...next, z: character.position.z }, character.id, true, true,
    );
    this.#armPlayerAttack(session, character);
    return result;
  }

  /**
   * A vida do monstro mudou — uma vez por golpe (FUN-103).
   *
   * `creature-health` existia no protocolo sem emissor nenhum: o monstro aparecia, andava e
   * morria com a barra cheia o tempo todo, e o sintoma parecia bug do cliente.
   */
  #emitHealth(session: Session, monster: MonsterRuntime): void {
    const definition = this.#options.monsters.get(monster.monsterId);
    session.emit({
      kind: 'creature-health-changed', creatureId: monster.subject,
      health: monster.health, maxHealth: definition?.health ?? monster.health,
    });
  }

  /**
   * A vida do PERSONAGEM mudou (FUN-109). O mesmo evento do monstro, com o id dele.
   *
   * Sai de todo lugar que escreve `character.health` OU `character.maxHealth` nesta hunt —
   * golpe, cura, poção, regeneração, level up e penalidade de morte —, e a completude é o
   * ponto: um caminho que muda a vida sem passar por aqui é a barra do jogador parando de
   * andar até a próxima reanexação, que era o defeito inteiro. O máximo conta porque
   * `retarget` (`progression.ts`) reescreve os dois de uma vez.
   */
  #emitCharacterHealth(session: Session, character: CharacterRuntime): void {
    session.emit({
      kind: 'creature-health-changed', creatureId: character.id,
      health: character.health, maxHealth: character.maxHealth,
    });
  }

  /**
   * O personagem REPÔS vida: o número que sobe, e depois a barra que sobe (FUN-109).
   *
   * Só com `amount > 0`. `castSpell` e `useSupply` devolvem o que REPÔS, não o que o efeito
   * prometia — e uma cura em quem estava cheio repôs zero. Um "+0" flutuando é ruído, e a
   * barra que não mudou não tem o que anunciar.
   */
  #emitHealed(
    session: Session, character: CharacterRuntime, amount: number,
    source: CreatureHealed['source'], healerId?: string,
  ): void {
    if (amount <= 0) return;
    // A cura FEITA conta para quem lançou (#431): o evento acende a barra do RECIPIENT, mas o
    // HPS é do healer. O guarda de participante descarta um `sourceId` que não seja personagem
    // (a condição de um monstro, por exemplo) — `creditHealing` somaria num id que não é dono.
    if (healerId !== undefined && session.participants.some((p) => p.id === healerId)) {
      session.creditHealing(healerId, amount);
      // Atividade de XP compartilhada (§525) é OUTRA coisa que HPS: `Player::isPartner`
      // (TFS/Canary) exclui `player == this` antes de registrar `updatePlayerTicks` por cura —
      // curar A SI MESMO não prova que o personagem está engajado com a party, e as duas
      // engines não contam. HPS continua contando o self-heal (linha acima); só a atividade
      // que `canShareExperience` lê exige um RECIPIENTE diferente do healer.
      if (character.id !== healerId) this.#markCombatActive(session, healerId);
    }
    session.emit({
      kind: 'creature-healed', creatureId: character.id, amount, source,
      position: this.#at(character),
    });
    this.#emitCharacterHealth(session, character);
  }

  /**
   * Onde a criatura está, com o andar de FATO dela (#519, hunt multiandar).
   *
   * Até esta issue isto sempre devolvia `this.#world.map.z` — o andar PADRÃO do mapa —,
   * ignorando `creature.position.z` mesmo para o personagem. Numa hunt de andar único isso nunca
   * divergia (só existia um andar para se estar), e por isso o defeito nunca apareceu: a
   * Darashia Dragon Lair é a primeira hunt em que ele apareceria, com todo golpe e toda mira de
   * área calculados no andar ERRADO sempre que alguém não estivesse no padrão do mapa. `?? map.z`
   * sobra só para quem nunca carrega `z` de verdade — o monstro de snapshot anterior a esta issue.
   */
  #at(creature: { readonly position: FloorPoint }): WorldPoint {
    return { x: creature.position.x, y: creature.position.y, z: creature.position.z ?? this.#world.map.z };
  }

  /** O andar de FATO da criatura — o mesmo que `#at` usa, sem montar o `WorldPoint` inteiro. */
  #floorOf(creature: { readonly position: FloorPoint }): number {
    return creature.position.z ?? this.#world.map.z;
  }

  #onExitRules(session: Session): void {
    session.scheduleIn(EXIT_RULES, EXIT_RULE_INTERVAL_MS, {
      priority: EventPriority.Housekeeping,
    });
    this.#applyExitRules(session);
  }

  #applyExitRules(session: Session): void {
    const monstersAlive = this.#monsters.filter((m) => m.alive).length;
    // As regras são de CADA participante (#203): a view de cada um leva só ele e os agregados
    // dele — `hp-below` e `out-of-gold` leem `participants[0]`. O que disparar faz é da
    // sessão: em solo, encerrar; em party, sair (#193).
    for (const character of session.participants) {
      const runner = this.#runners.get(character.id);
      if (runner === undefined || runner.pendingExit !== null) continue;
      const view: HuntView = {
        elapsedMs: session.aggregates.durationMs,
        aggregates: session.aggregatesOf(character.id),
        participants: [character],
        monstersAlive,
      };
      for (const rule of runner.exitRules) {
        if (!rule.when(view)) continue;
        // O extrato precisa dizer QUAL regra — "sua hunt encerrou por uma regra de saída" sem
        // dizer qual é a mensagem que faz o jogador desconfiar do bot que ele mesmo configurou.
        session.record('exit-rule', rule.id);
        this.#beginExit(session, character.id, 'exit-rule');
        break;
      }
    }
  }

  #beginExit(session: Session, characterId: string, reason: ExitReason): void {
    const runner = this.#runners.get(characterId);
    if (runner === undefined || runner.pendingExit !== null) return;
    runner.pendingExit = reason;
    const delayMs = this.#options.hunt.exitDelayMs;
    if (delayMs === undefined) { this.#finishExit(session, characterId); return; }
    session.scheduleIn(EXIT_COUNTDOWN, delayMs, {
      priority: EventPriority.Housekeeping, subject: characterId,
    });
  }

  #onExitCountdown(session: Session, characterId: string): void {
    this.#finishExit(session, characterId);
  }

  #finishExit(session: Session, characterId: string): void {
    const runner = this.#runners.get(characterId);
    const reason = runner?.pendingExit ?? null;
    if (runner === undefined || reason === null) return;
    // A trava de combate (#625, a janela do CONDITION_INFIGHT do Canary): a saída — manual ou por regra do
    // bot, as duas passam por `#beginExit`/`#finishExit` — só CONCLUI fora de combate. O
    // `exitDelayMs` continua a contagem VISUAL (o `#beginExit` acima); isto é uma segunda trava,
    // por cima, que reagenda para o instante em que o combate vence em vez de completar a
    // saída — `pendingExit` continua marcado, e nenhum novo `#beginExit` se soma por cima
    // (`#applyExitRules`/`requestExit` já recusam reentrar enquanto ele não é `null`).
    const character = findById(session.participants, characterId);
    if (character !== null && isInFight(session.nowMs, character.lastCombatActionAtMs)) {
      const unlockAtMs = character.lastCombatActionAtMs! + IN_FIGHT_WINDOW_MS;
      session.scheduleIn(EXIT_COUNTDOWN, unlockAtMs - session.nowMs, {
        priority: EventPriority.Housekeeping, subject: characterId,
      });
      return;
    }
    runner.pendingExit = null;
    if (session.participants.length <= 1) {
      if (session.ended === null) session.end(reason);
      return;
    }
    this.#depart(session, characterId, reason);
  }

  // --- combate ------------------------------------------------------------------------------

  /**
   * Um golpe do personagem, do jeito que a arma na mão bate (#152, ADR 0026 decisões 3 e 4;
   * perfis de arma no CMB-05): corpo a corpo com o `attack` da arma (ou desarmado); tiro com o
   * `attack` da munição escolhida, debitando o preço dela; ou wand, gastando mana e causando
   * dano mágico por faixa. Os três compartilham o mesmo fim — aplicar, atribuir, anunciar,
   * contar o recorde, praticar — e é `#land` quem aplica.
   *
   * O poder sai de `resolveWeaponPower` com o PERFIL da arma: o ruleset não conhece nome de
   * item nem vocação (DT-01). A família do perfil aponta a skill e a prática, e é por isso que
   * wand/rod não recebem multiplicador de weapon skill — o perfil deles não tem `power`.
   *
   * Devolve `true` quando a arma foi USADA — o `result` de `Player::doAttacking` do Canary
   * (`useWeapon`/`useFist` devolvem `true`): o golpe saiu, tenha acertado ou errado. É o que
   * `#onPlayerAttack` grava em `lastAttackAtMs` (M30-03, #550), de onde o fator de defesa da
   * postura tira a janela "bateu há menos de um intervalo". `false` é o tiro que NÃO saiu — sem
   * visão livre, sem munição, monstro fora do conteúdo —, que o Canary também não conta.
   */
  #strike(
    session: Session, character: CharacterRuntime, monster: MonsterRuntime,
    weapon: Item | null, how: ResolvedWeapon | undefined, damagePercent = 100,
  ): boolean {
    const definition = this.#options.monsters.get(monster.monsterId);
    if (definition === undefined) return false;
    const defender = this.#monsterDefender(monster);
    // Contra quem o reflexo do monstro volta (#683) — ausente no monstro que não reflete.
    const reflectAttacker = this.#reflectAttackerFor(character, monster);

    if (weapon !== null && how?.kind === 'distance') {
      // Sem visão livre até o alvo (#553), o tiro NÃO sai — como sem munição, antes de gastar
      // nada. O alvo continua sendo o mesmo (a escolha ignora visão): o próximo vencimento
      // reavalia, e acerta assim que a linha abrir. Vale para o arremessável (#575) também —
      // ele só troca a fonte do projétil, nunca a exigência de linha de visão.
      if (!isSightClear(this.#world.map, character.position, monster.position)) return false;
      // O arremessável (#575): sem `ammoFamily`, o item na mão É o próprio projétil — não há
      // seleção por família nem lançador (ADR 0026 d.3 não se aplica a ele). `buildContent` já
      // garante que toda arma `distance` tem exatamente um dos dois campos.
      if (how.ammoFamily === undefined) {
        this.#throwWeapon(session, character, monster, weapon, how, damagePercent, defender, reflectAttacker);
        return true;
      }
      const ammo = this.#ammoFor(character, how.ammoFamily);
      // Sem munição paga pela família — catálogo vazio, ou saldo que não cobre o preço: o tiro
      // NÃO sai. Nada de dano inventado nem de munição grátis (ADR 0026 d.3): sem gold, a regra
      // de saída `out-of-gold` encerra a hunt, como para a poção.
      if (ammo === null) return false;
      // O estoque de loot (#520, revisão do #536) é gasto ANTES do gold — a mesma regra do
      // supply em `useSupply`. Estoque é PESSOAL, nunca rateado: quem tem Burst Arrow no
      // estoque atira das PRÓPRIAS, e o resto da party continua pagando gold pelas delas.
      const stock = character.ammunitionStock.get(ammo.id) ?? 0;
      if (stock > 0) {
        if (stock <= 1) character.ammunitionStock.delete(ammo.id);
        else character.ammunitionStock.set(ammo.id, stock - 1);
      } else if (ammo.price > 0) {
        // O rateio do §4 inclui a MUNIÇÃO paga (#394): com `shareCosts` ligado quem paga é a
        // purse compartilhada — a MESMA do supply, com o resto do atirador. O `#ammoFor` já
        // conferiu `canAfford` pela purse; aqui só se debita. Sem rateio, o comportamento de
        // sempre: gold do personagem E agregado da sessão (§20.1).
        const shareCosts = this.#party !== undefined && this.#party.shareCosts && session.participants.length > 1;
        if (shareCosts) {
          this.#sharedPurse(session, character).pay(ammo.price);
        } else {
          character.goldDelta -= ammo.price;
          session.credit(character.id, 'goldSpent', ammo.price);
        }
      }
      // Chance de acerto (#522, `combat-v2`): o tiro sai e paga o preço mesmo errando — só o
      // DANO depende da rolagem. `combat-v1` (sem `distanceHitChance`) sempre acerta. Rolada
      // ANTES do `emit` (#555): o destino do `shot` depende de `hit` só no `combat-v3` — errado
      // E a mais de 1 tile do alvo, o projétil visualmente cai num tile adjacente. `v1`/`v2`
      // continuam com `to` fixo no monstro mesmo no erro (ADR 0031/0040: perfil já publicado é
      // bit a bit, e `#missDestination` consome um sorteio A MAIS do `session.rng` que esses
      // dois perfis não podiam ganhar sem virar um perfil novo).
      const hit = this.#rollDistanceHit(session, character, monster, ammo, how);
      session.emit({
        kind: 'shot', attackerId: character.id, targetId: monster.subject,
        weaponItemId: weapon.id, ammoId: ammo.id, from: this.#at(character),
        to: hit || !this.#isV3() ? this.#at(monster) : this.#missDestination(session, character, monster),
      });
      // `combat-v1`/`v2`: a prática é do TIRO, não do acerto (CMB-05) — imunidade, bloqueio e
      // o erro de pontaria não impedem a skill de subir. No `combat-v3` (#686) quantos tries o
      // tiro rende vem do tipo de bloqueio (`distanceTries`): 2 limpo, 1 bloqueado, 0 imune.
      if (!this.#isV3()) this.#practice(session, character, how.family, 1);
      if (!hit) {
        // O tiro errado não passa pelo `blockHit` do alvo — vale o estado do tiro ANTERIOR.
        if (this.#isV3()) {
          this.#practice(session, character, how.family, distanceTries(character.attackPractice));
        }
        // A munição é ABSTRATA: nada de pilha a consumir. O tiro errou, mas já pagou o preço, e
        // o próximo usa a mesma seleção (ou a básica da família) enquanto houver gold. O tiro
        // SAIU: é golpe de arma (`useWeapon` devolve `true` no Canary), e abre a janela do fator
        // de defesa da postura.
        return true;
      }
      // O `base` da fórmula e o TIPO são da MUNIÇÃO (o bow não tem attack próprio), e a família
      // e a escala vêm do perfil da arma. Uma alocação por tiro, como o `defender` acima.
      const power = how.power;
      const profile: WeaponProfile = {
        family: how.family,
        damageType: ammo.damageType,
        range: how.range,
        ...(power === undefined ? {} : { power: { ...power, base: ammo.attack } }),
      };
      const result = resolveDamage(
        {
          rawDamage: this.#weaponPower(session, character, profile, damagePercent).physical
            + this.#perfectShotBonus(character, monster),
          source: 'basic-attack',
          damageType: profile.damageType,
          modifiers: this.#hitModifiers(session, character, monster),
          // Distância bloqueia por armadura, mas NÃO por escudo no `combat-v3` (#548) —
          // `WeaponDistance` do Canary não seta `blockedByShield`.
          blockable: DISTANCE_BLOCK_FLAGS,
          ...(reflectAttacker === undefined ? {} : { attacker: reflectAttacker }),
        },
        defender, 'pve', this.#options.combat, session.rng, session.nowMs,
      );
      this.#land(session, character, monster, result, 'melee');
      if (this.#isV3()) {
        this.#practice(session, character, how.family, distanceTries(character.attackPractice));
      }
      // A munição é ABSTRATA: nada de pilha a consumir. O tiro que saiu já pagou o preço, e o
      // próximo usa a mesma seleção (ou a básica da família) enquanto houver gold.
      return true;
    }

    if (weapon !== null && how?.kind === 'wand') {
      const manaPerHit = how.manaPerHit ?? 0;
      // A mana sai ANTES da rolagem, e a conferência foi em `#onPlayerAttack`: chegar aqui é
      // ter mana. Uma rolagem por golpe, com o `Rng` da sessão — a mesma semente, o mesmo
      // dano, como o loot (contrato).
      character.mana -= manaPerHit;
      session.emit({
        kind: 'shot', attackerId: character.id, targetId: monster.subject,
        weaponItemId: weapon.id, from: this.#at(character), to: this.#at(monster),
      });
      // Dano por faixa fixa e do TIPO da arma (CMB-03): a wand de vortex é energia, o rod de
      // snakebite é terra; sem declaração o boot resolve `arcane`, o `kind: magic` do v1. O
      // perfil da wand/rod não tem `power`, então NÃO há multiplicador de weapon skill (DT-02).
      const result = resolveDamage(
        {
          rawDamage: this.#weaponPower(session, character, how, damagePercent).physical,
          source: 'basic-attack',
          damageType: how.damageType,
          modifiers: this.#hitModifiers(session, character, monster),
          // Wand/rod não bloqueiam nem por armadura nem por escudo no `combat-v3` (#548) — o
          // `WeaponWand` do Canary não declara nenhum dos dois; é dano MÁGICO.
          blockable: MAGIC_BLOCK_FLAGS,
          ...(reflectAttacker === undefined ? {} : { attacker: reflectAttacker }),
        },
        defender, 'pve', this.#options.combat, session.rng, session.nowMs,
      );
      this.#land(session, character, monster, result, 'spell');
      // Rende magia pela MANA gasta, como a magia (§9.4): é assim que a wand treina magic level.
      this.#practice(session, character, how.family, manaPerHit);
      return true;
    }

    // Corpo a corpo — ou desarmado: sem arma na mão vale o perfil `fist` (CMB-05), que carrega
    // o `attack`, o alcance e o tipo de `combat.player`.
    const profile: WeaponProfile = how ?? this.#options.unarmed;
    // O cleave (#552) sai ANTES do golpe principal, como no Canary; só com ARMA corpo a corpo —
    // o punho do Canary (`Weapon::useFist`) não passa por `WeaponMelee::useWeapon`.
    if (weapon !== null && how?.kind === 'melee') this.#cleave(session, character, monster, profile, damagePercent);
    const hit = this.#weaponPower(session, character, profile, damagePercent);
    const result = resolveDamage(
      {
        rawDamage: hit.physical,
        source: 'basic-attack',
        damageType: profile.damageType,
        modifiers: this.#hitModifiers(session, character, monster),
        // Corpo a corpo (ou desarmado) bloqueia os dois — o default de `MELEE_BLOCK_FLAGS`,
        // explícito aqui só por simetria com os outros dois ramos de `#strike`.
        blockable: MELEE_BLOCK_FLAGS,
        // O elemento da arma (#687, só `combat-v3`) é o componente secundário do golpe (#473):
        // sem escudo nem armadura, como o `blockHit(…, false, false)` do Canary — só perde para
        // resistência e imunidade. Sem elemento (ou total zero) não há secundário nem sorteio.
        ...(hit.elemental > 0 && profile.element !== undefined
          ? {
            secondary: {
              rawDamage: hit.elemental,
              damageType: profile.element.type,
              blockable: MAGIC_BLOCK_FLAGS,
            },
          }
          : {}),
        ...(reflectAttacker === undefined ? {} : { attacker: reflectAttacker }),
      },
      defender, 'pve', this.#options.combat, session.rng, session.nowMs,
    );
    this.#land(session, character, monster, result, 'melee');
    // `combat-v1`/`v2`: o golpe ACONTECEU, conta como uso, tenha ele acertado forte ou de
    // raspão, e mesmo que o alvo seja imune ou já esteja morto (CMB-05). No `combat-v3` (#686)
    // é o tipo de bloqueio que decide: 1 try, ou 0 contra imune e bloqueado sem sangue.
    this.#practice(session, character, profile.family,
      this.#isV3() ? meleeTries(character.attackPractice) : 1);
    return true;
  }

  /**
   * O cleave do golpe corpo a corpo (M30-05, #552; `WeaponMelee::useWeapon` do Canary): com
   * `cleavePercent` vestido, cada monstro vivo nos dois tiles que flanqueiam o alvo
   * (`cleaveTiles`) leva uma rolagem PRÓPRIA de poder da arma na fração do cleave. É EXTENSÃO
   * (`damage.extension = true` no Canary): sem crítico, sem leech e sem reflexo — o intent não
   * declara crítico nem leech, só o aumento por tipo do atacante, que o `blockHit` do alvo aplica
   * a qualquer golpe. Bloqueia como corpo a corpo, e cada vítima pratica a skill uma vez
   * (`onUsedWeapon` roda por `internalUseWeapon`).
   *
   * Só no `combat-v3`: os perfis anteriores não conhecem o atributo, e o item que o declara não
   * muda um golpe congelado neles. A morte das vítimas é resolvida aqui, depois de todas — a
   * regra de colher antes de aplicar (FUN-92) — e antes do golpe principal, que é de outro tile.
   */
  #cleave(
    session: Session, character: CharacterRuntime, target: MonsterRuntime, profile: WeaponProfile,
    damagePercent: number,
  ): void {
    if (!this.#isV3()) return;
    const percent = equipmentCleavePercent(character.inventory, this.#options.items);
    if (percent <= 0) return;
    const tiles = cleaveTiles(character.position, target.position);
    if (tiles === null) return;
    const victims: MonsterRuntime[] = [];
    for (const tile of tiles) {
      for (const candidate of this.#monsters) {
        // O golpe de varredura não acerta a invocação de jogador (#600) — o mesmo corte do `#aimFor`.
        if (candidate !== target && candidate.alive && typeof candidate.masterId !== 'string'
          && candidate.position.x === tile.x && candidate.position.y === tile.y
          && sameFloor(candidate.position.z, target.position.z)) {
          victims.push(candidate);
        }
      }
    }
    if (victims.length === 0) return;
    const increase = this.#attackerModifiers(character)?.increase;
    for (const victim of victims) {
      // O golpe do cleave é o `internalUseWeapon` inteiro na fração (`weapons.cpp:282-306`): o
      // `damageModifier` do `unproperly` (#687) e a divisão físico/elemento vêm ANTES, e a fração
      // corta os dois componentes, cada um truncado.
      const hit = this.#weaponPower(session, character, profile, damagePercent);
      const elemental = cleavePower(hit.elemental, percent);
      const result = resolveDamage(
        {
          rawDamage: cleavePower(hit.physical, percent),
          source: 'basic-attack',
          damageType: profile.damageType,
          ...(increase === undefined ? {} : { modifiers: { increase } }),
          blockable: MELEE_BLOCK_FLAGS,
          extension: true,
          ...(elemental > 0 && profile.element !== undefined
            ? {
              secondary: {
                rawDamage: elemental,
                damageType: profile.element.type,
                blockable: MAGIC_BLOCK_FLAGS,
              },
            }
            : {}),
        },
        this.#monsterDefender(victim), 'pve', this.#options.combat, session.rng, session.nowMs,
      );
      this.#land(session, character, victim, result, 'melee');
      this.#practice(session, character, profile.family, 1);
    }
    for (const victim of victims) {
      if (!victim.alive) resolveDeath(session, { kind: 'monster', monster: victim });
    }
  }

  /**
   * O poder bruto de um golpe pelo PERFIL (CMB-05, `combat-v2` em #522), com a postura por
   * último.
   *
   * A skill que escala é a da FAMÍLIA, não uma por nome: o ruleset lê `family.skillId` do
   * conteúdo e o nível do personagem, MAIS o bônus de equipamento da mesma skill (#524: a
   * Paladin Armor soma em `distance` — o crossbow bate mais forte com ela vestida). Corpo a
   * corpo e distância recebem a postura (`buff`);
   * wand/rod têm faixa fixa e não passam por ela — como sempre. O multiplicador de vocação
   * (`meleeDamageMultiplier`/`distDamageMultiplier`, #522) só o `combat-v2` lê; passar o valor
   * sempre é inofensivo — o v1 nunca teve multiplicador de vocação.
   */
  #weaponPower(
    session: Session, character: CharacterRuntime, profile: WeaponProfile, damagePercent: number,
  ): WeaponHit {
    const family = this.#options.weaponFamilies.get(profile.family);
    const skillLevel = this.#skillLevelOf(character, family);
    const vocation = this.#vocationOf(character);
    const vocationMultiplier = family?.kind === 'distance'
      ? vocation?.distDamageMultiplier ?? 1
      : vocation?.meleeDamageMultiplier ?? 1;
    const hit = resolveWeaponHit(
      profile, character.level, skillLevel, session.rng, this.#options.combat, vocationMultiplier,
      damagePercent, character.fightMode,
    );
    // A postura vale para as duas partes do golpe (#687), cada uma arredondada.
    if (family?.kind === 'distance' || family?.kind === 'melee') {
      const scale = character.conditions.damageDealtScale(family.kind);
      return {
        physical: Math.round(hit.physical * scale),
        elemental: Math.round(hit.elemental * scale),
      };
    }
    return hit;
  }

  /**
   * Os modificadores avançados do ATACANTE (M30-04, #551, CMB-08): crítico, life leech e mana
   * leech, somados do que está VESTIDO (`Inventory.combatModifiers`) mais o `combat.modifiers`
   * estático do conteúdo — o andaime original do CMB-08, que nenhum conteúdo real declara hoje,
   * mas que a conformance ainda exercita. `undefined` quando nenhuma fonte declara nada — o de
   * sempre, sem sorteio novo. Usado tanto pelo golpe básico (`#strike`) quanto pela magia
   * (`#castSpell`): o Canary rola crítico para qualquer combate do jogador, não só o corpo a
   * corpo (`Combat::applyExtensions`).
   */
  #attackerModifiers(character: CharacterRuntime): DamageModifiers | undefined {
    return combineCombatModifiers(
      this.#options.combat.modifiers,
      character.inventory.combatModifiers(this.#options.items),
    );
  }

  // --- Charms em combate (#603, M39-03, ADR 0053 d.5) -----------------------------------------
  //
  // As rolagens e a ordem são as do Canary (`Game::combatChangeHealth`/`applyCharmRune`,
  // `Combat::applyExtensions`, `Monster::death`, `Player::death`) — o contrato do estágio do
  // `combat-v4` em `docs/product/combat-conformance.md`. Só o `combat-v4` (`hasCharmStage`) roda
  // qualquer uma delas: numa sessão ainda fixada em `combat-v3` o registro de Charms do personagem
  // existe e não dispara nada (invariante 7). Sem atribuição a este monstro o custo é um
  // `size === 0` e nenhuma alocação — o caminho de toda hunt sem charm.

  /** O estágio de Charms roda neste perfil? */
  #charmStage(): boolean {
    return hasCharmStage(this.#options.combat.compatibilityProfile);
  }

  /** Os charms do personagem que agem contra `monsterId`, ou `undefined` (o caso comum). */
  #charmsAgainst(character: CharacterRuntime, monsterId: string): AssignedCharms | undefined {
    const catalogue = this.#options.charms;
    if (catalogue === undefined || !this.#charmStage()) return undefined;
    return character.charms.assignedTo(monsterId, catalogue);
  }

  /** O que os charms PASSIVOS do personagem somam a um golpe contra `monster` — ver `CharmAttackBonus`. */
  #charmAttackBonusAgainst(
    character: CharacterRuntime, monster: MonsterRuntime,
  ): CharmAttackBonus | undefined {
    const assigned = this.#charmsAgainst(character, monster.monsterId);
    return assigned === undefined ? undefined : charmAttackBonus(assigned, monster.monsterId);
  }

  /**
   * Os modificadores de UM golpe dado a `monster`: os do atacante (`#attackerModifiers`) mais os
   * charms passivos contra ele (Low Blow, Savage Blow, Vampiric Embrace, Void's Call). Sem charm é
   * o MESMO objeto de sempre — o crítico segue sendo rolado dentro do `resolveDamage`, na posição
   * de antes; com charm o crítico é decidido AQUI (`ActionCritical`, o `applyExtensions` do Canary
   * roda antes do `blockHit`) e o Low Blow tem o segundo sorteio que o Canary tem.
   */
  #hitModifiers(
    session: Session, character: CharacterRuntime, monster: MonsterRuntime,
  ): DamageModifiers | undefined {
    const base = this.#attackerModifiers(character);
    const bonus = this.#charmAttackBonusAgainst(character, monster);
    if (bonus === undefined) return base;
    return new ActionCritical(base, session.rng).forTarget(bonus, session.rng);
  }

  /**
   * O que os charms do jogador fazem DEPOIS de um golpe dele num monstro (`Game::applyCharmRune` e
   * o Fatal Hold de `Combat::CombatHealthFunc`). Chamado por `#land` (arma, wand) e por
   * `#applyHits` (magia e runa), o único par de caminhos em que o personagem acerta um monstro —
   * e também pelo dano dos próprios charms, como no Canary.
   *
   * `extension` é o golpe que já é extensão de outro (o cleave): o Canary só roda os charms
   * OFENSIVOS em `!damage.extension` — e o Fatal Hold, que mora um degrau acima, roda em todos.
   * `healthDamage` é o HP de fato removido: golpe que não tirou vida não rola charm ofensivo
   * (`realDamage == 0` sai antes de `applyCharmRune`). Monstro que morreu no golpe não tem o que
   * receber: o Canary ainda gasta os sorteios e o dano dá zero, então pular é equivalente.
   */
  #applyCharmsAfterHit(
    session: Session, character: CharacterRuntime, monster: MonsterRuntime,
    healthDamage: number, extension: boolean,
  ): void {
    if (!monster.alive) return;
    const assigned = this.#charmsAgainst(character, monster.monsterId);
    if (assigned === undefined) return;
    if (!extension && healthDamage > 0) {
      // Major antes de minor, como `{ major, minor }` de `applyCharmRune`.
      for (const entry of [assigned.major, assigned.minor]) {
        if (!monster.alive) return;
        if (entry === undefined || entry.charm.type !== 'offensive') continue;
        if (!rollOffensiveCharm(session.rng, charmChance(entry))) continue;
        const effect = offensiveCharmEffect(
          entry.charm, character, this.#maxHealthOf(monster),
        );
        if (effect.kind === 'paralyze') {
          // Cripple: `target->addCondition` direto, sem o portão de imunidade: sem `fromCombat` (ver `#applyConditionTo`).
          this.#applyConditionTo(session, monster, conditionFromSpec(
            CHARM_PARALYZE_CONDITION, monster.subject, character.id, session.nowMs, 'charm',
            { baseSpeed: monster.speed, rng: session.rng },
          ));
        } else if (effect.kind === 'damage') {
          this.#applyCharmDamage(
            session, character, monster, effect.amount, effect.damageType, effect.neutral,
          );
        }
      }
    }
    this.#rollFatalHold(session, character, monster, assigned);
  }

  /**
   * O dano de um charm num monstro (`parseCharmCombat` → `Combat::doCombatHealth` com
   * `damage.extension = true`): passa pelo MESMO resolver, contra a defesa do monstro, sem
   * bloqueio por defesa/armadura (`CombatParams` sem `blockedByArmor`/`blockedByShield`), sem
   * crítico, sem leech e sem reflexo — só o AUMENTO por tipo do atacante vale, como em
   * `applyAbsorbDamageModifications`. O NEUTRO (Overpower, Overflux, Carnage, Parry) pula a
   * absorção, a imunidade e a resistência, como o `COMBAT_NEUTRALDAMAGE` do Canary.
   *
   * Quem chama resolve a morte do monstro: aqui só o dano, a atribuição e o anúncio.
   */
  #applyCharmDamage(
    session: Session, character: CharacterRuntime, monster: MonsterRuntime, amount: number,
    damageType: DamageType, neutral: boolean,
  ): void {
    if (amount <= 0 || !monster.alive) return;
    const increase = neutral ? undefined : this.#attackerModifiers(character)?.increase;
    const outcome = resolveDamage(
      {
        rawDamage: amount, source: 'charm', damageType, blockable: MAGIC_BLOCK_FLAGS,
        extension: true,
        ...(neutral ? { neutral: true } : {}),
        ...(increase === undefined ? {} : { modifiers: { increase } }),
      },
      this.#monsterDefender(monster), 'pve', this.#options.combat, session.rng, session.nowMs,
    );
    // O cano único do dano no monstro (`Monster::drainHealth`): o charm também revela o invisível
    // e arma o bypass de campo, como qualquer outro dano.
    const applied = this.#drainMonster(session, monster, outcome, null);
    recordDamage(monster.contribution, character.id, applied.healthDamage);
    session.emit({
      kind: 'creature-hit', creatureId: monster.subject, attackerId: character.id,
      amount: applied.healthDamage, source: 'spell', position: this.#at(monster),
      damageType: outcome.damageType,
    });
    this.#emitHealth(session, monster);
    // O dano do charm conta para o DPS (`updatePlayerPartyHuntAnalyzer` roda em todo dano do
    // jogador, extensão inclusive) — mas não é "golpe básico": não entra no recorde do extrato.
    session.creditDamage(character.id, applied.healthDamage);
    this.#healMonsterByElement(session, monster, outcome);
    // O Fatal Hold mora em `CombatHealthFunc`, então o dano do próprio charm o rola de novo.
    const assigned = this.#charmsAgainst(character, monster.monsterId);
    if (assigned !== undefined) this.#rollFatalHold(session, character, monster, assigned);
  }

  /**
   * Fatal Hold (`Combat::CombatHealthFunc`, `combat.cpp:919-937`): a cada golpe do jogador num
   * monstro do charm, `chance > normal_random(0, 100)` prende o monstro — ele não foge por vida
   * baixa por 30 s (`Monster::isFleeing`, `fatalHoldDuration <= 0`). Um novo acerto RENOVA o prazo.
   *
   * **O prazo do Canary só corre para quem troca de alvo** (`Monster::onThinkTarget` o drena dentro
   * de `changeTargetSpeed != 0 && runAwayHealth > 0`): o monstro que foge e NÃO tem `targetChange`
   * fica preso para sempre — três no catálogo (achad, drasilla, muglex-clan-assassin). É o
   * mecanismo, e é reproduzido: sem `targetChange` o prazo é `Number.MAX_SAFE_INTEGER`. Monstro
   * que nunca foge (`runOnHealth` ausente ou zero) não tem o que prender.
   */
  #rollFatalHold(
    session: Session, character: CharacterRuntime, monster: MonsterRuntime, assigned: AssignedCharms,
  ): void {
    const fatal = findAssigned(assigned, 'fatal-hold');
    if (fatal === undefined || !monster.alive) return;
    if (!rollNormalPercentCharm(session.rng, charmChance(fatal))) return;
    const definition = this.#options.monsters.get(monster.monsterId);
    if (definition === undefined || (definition.runOnHealth ?? 0) <= 0) return;
    this.#applyConditionTo(session, monster, {
      key: FATAL_HOLD_CONDITION_KEY,
      targetId: monster.subject,
      sourceId: character.id,
      expiresAtMs: definition.targetChange === undefined
        ? Number.MAX_SAFE_INTEGER
        : session.nowMs + FATAL_HOLD_MS,
    });
  }

  /**
   * Os charms DEFENSIVOS contra um golpe de monstro que acabou de passar pelo `blockHit`
   * (`Game::combatChangeHealth`, `game.cpp:8566-8583`): DEPOIS da defesa, da armadura e do reflexo
   * do equipamento, ANTES do mana shield. Minor antes de major, cada um com
   * `chance >= normal_random(1, 10000) / 100`:
   *
   *   - Adrenaline Burst: haste de 10 s no jogador;
   *   - Numb: paralisia de 10 s no monstro que bateu;
   *   - Parry: o dano recebido volta ao monstro como NEUTRO;
   *   - Dodge: o golpe inteiro é negado (o único Dodge deste perfil).
   *
   * O tique de uma condição que o MONSTRO aplicou ao jogador (`ConditionDamage::doDamage` resolve
   * o `owner` para o atacante e chama o mesmo `combatChangeHealth`) rola exatamente igual, a cada
   * tique — ver `#applyConditionTick`. O tique de campo, ou de um monstro que já morreu, não tem
   * atacante e não rola.
   *
   * Um golpe que já chegou a zero não rola nada (`healthChange == 0` sai antes). O `manadrain` é
   * outro ramo do Canary (`combatChangeMana`): o Void Inversion vem primeiro — converte o dreno em
   * GANHO de mana, com o valor BRUTO — e depois major e minor, nesta ordem, sem o Parry.
   *
   * Devolve o outcome a aplicar: o mesmo quando nada nega o golpe, o ZERADO quando o Dodge o nega
   * (o `blockHit` já gastou carga de bloqueio e treinou escudo, então o golpe segue pelo caminho
   * normal com dano zero) ou `null` quando o Void Inversion o transformou em ganho de mana.
   *
   * **Parry: só o SEGUNDO ponto do Canary é reproduzido.** O `47dfd51` rola o Parry duas vezes por
   * golpe — `game.cpp:7944-7952`, dentro de `combatBlockHit`, e `:8566-8583`. No primeiro, o valor
   * já está no sinal de VIDA-DE-ALVO (`damage.primary.value` é negativo ali) e o `-realDamage` do
   * `parseDefensiveCharmCombat` sai POSITIVO: `combatChangeHealth` o lê como CURA e o monstro
   * recupera o que acabou de bater. Só o segundo (valores já em módulo) reflete de verdade. Esse
   * primeiro ponto é o defeito descrito na PR do #603 — reproduzi-lo faria o Parry anular a si
   * mesmo. Pelo mesmo sinal, o Parry no ramo de mana (`combatChangeMana`) não reflete: não rola.
   */
  #rollDefensiveCharms(
    session: Session, monster: MonsterRuntime, character: CharacterRuntime, damageType: DamageType,
    rawDamage: number, result: DamageOutcome,
  ): DamageOutcome | null {
    const assigned = this.#charmsAgainst(character, monster.monsterId);
    if (assigned === undefined) return result;
    const rng = session.rng;
    if (damageType === 'manadrain') {
      // O Void Inversion vem ANTES de tudo em `combatChangeMana` — antes até de o `blockHit` e da
      // mana atual serem consultados: converte o dreno em ganho, mesmo com a mana zerada.
      const inversion = findAssigned(assigned, 'void-inversion');
      if (inversion !== undefined && rollNormalPercentCharm(rng, charmChance(inversion))) {
        character.mana = Math.min(character.maxMana, character.mana + rawDamage);
        return null;
      }
      // Sem mana para perder (`manaLoss <= 0`) ou imune ao dreno (`blockType != BLOCK_NONE`), o
      // Canary sai antes de rolar qualquer charm.
      if (character.mana <= 0 || result.immune) return result;
      for (const entry of [assigned.major, assigned.minor]) {
        if (entry === undefined || entry.charm.type !== 'defensive') continue;
        if (entry.charm.id === 'cleanse' || entry.charm.id === 'parry') continue;
        if (!rollDefensiveCharm(rng, charmChance(entry))) continue;
        if (this.#applyDefensiveCharm(session, monster, character, entry.charm.id, 0)) {
          return negatedOutcome(result);
        }
      }
      return result;
    }
    const healthChange = result.resolvedDamage + (result.secondaryOutcome?.resolvedDamage ?? 0);
    if (healthChange <= 0) return result;
    for (const entry of [assigned.minor, assigned.major]) {
      if (entry === undefined || entry.charm.type !== 'defensive' || entry.charm.id === 'cleanse') continue;
      if (!rollDefensiveCharm(rng, charmChance(entry))) continue;
      if (this.#applyDefensiveCharm(session, monster, character, entry.charm.id, healthChange)) {
        return negatedOutcome(result);
      }
    }
    return result;
  }

  /** O efeito de um charm defensivo que passou na rolagem. `true` é o Dodge: o golpe acaba aqui. */
  #applyDefensiveCharm(
    session: Session, monster: MonsterRuntime, character: CharacterRuntime, charmId: string,
    healthChange: number,
  ): boolean {
    switch (charmId) {
      case 'dodge':
        return true;
      case 'adrenaline-burst':
        this.#applyConditionTo(session, character, conditionFromSpec(
          ADRENALINE_BURST_CONDITION, character.id, character.id, session.nowMs, 'charm',
          { baseSpeed: character.speed, rng: session.rng },
        ));
        return false;
      case 'numb':
        // Numb: `target->addCondition` direto, sem o portão de imunidade: sem `fromCombat` (ver `#applyConditionTo`).
        this.#applyConditionTo(session, monster, conditionFromSpec(
          CHARM_PARALYZE_CONDITION, monster.subject, character.id, session.nowMs, 'charm',
          { baseSpeed: monster.speed, rng: session.rng },
        ));
        return false;
      case 'parry':
        this.#applyCharmDamage(session, character, monster, healthChange, 'physical', true);
        return false;
      default:
        return false;
    }
  }

  /**
   * O Cleanse (`Combat::CombatConditionFunc`, `combat.cpp:1037-1062`) — roda depois de CADA golpe
   * de monstro que acertou o jogador, e ANTES de a ability aplicar a condição dela: com o charm
   * atribuído a este monstro e ao menos uma condição negativa ativa (`Creature::
   * getCleansableConditions`), `chance >= normal_random(0, 10000) / 100` remove UMA delas,
   * sorteada (`uniform_random`), e dá ao tipo removido 11 s de imunidade. A condição nova da
   * ability NÃO entra nessa rodada.
   *
   * A imunidade vale contra a condição da ability (`isImmuneCleanse`) mesmo quando o Cleanse já
   * não dispara — é estado do JOGADOR, não do charm. Devolve `true` quando a condição da ability
   * não deve mais ser aplicada.
   */
  #cleanseBeforeCondition(
    session: Session, monster: MonsterRuntime, character: CharacterRuntime, ability: MonsterAbility,
  ): boolean {
    const assigned = this.#charmsAgainst(character, monster.monsterId);
    const cleanse = assigned === undefined ? undefined : findAssigned(assigned, 'cleanse');
    if (cleanse !== undefined) {
      const cleansable: { readonly key: string; readonly type: CleanseType }[] = [];
      for (const condition of character.conditions.getState()) {
        const type = cleanseTypeOfCondition(condition);
        if (type !== null) cleansable.push({ key: condition.key, type });
      }
      if (cleansable.length > 0 && rollCleanseCharm(session.rng, charmChance(cleanse))) {
        const picked = cleansable[session.rng.integer(0, cleansable.length - 1)] as {
          readonly key: string; readonly type: CleanseType;
        };
        // `removeCondition(type)` do Canary tira TODAS as do tipo sorteado.
        this.#dispelConditions(
          session, character, cleansable.filter((entry) => entry.type === picked.type).map((e) => e.key),
        );
        character.cleanseImmunity.set(picked.type, session.nowMs + CLEANSE_IMMUNITY_MS);
        return true;
      }
    }
    if (ability.condition === undefined || character.cleanseImmunity.size === 0) return false;
    const type = cleanseTypeOfSpec(ability.condition);
    return type !== null && (character.cleanseImmunity.get(type) ?? -1) >= session.nowMs;
  }

  /**
   * O Carnage (`Monster::death`, `monster.cpp:3283-3291`): ao morrer, o monstro ao qual o jogador
   * atribuiu o charm rola `chance >= normal_random(1, 10000) / 100`, e cada monstro nos quatro
   * tiles ORTOGONAIS leva `min(15 % da vida do morto, 6× o level)` de dano neutro. O jogador é
   * quem deu o último golpe — ou, sem ele, quem o monstro estava atacando. Roda também para o
   * monstro invocado por outro monstro (o `Monster::death` não confere `isSummon()`); invocação de
   * jogador fica de fora como VÍTIMA (não é alvo hostil, `Combat::canDoCombat`).
   *
   * Roda no FIM de `#onMonsterDied`, com o morto já fora dos índices: as mortes que o Carnage causa
   * são resolvidas depois de todos os golpes (a regra de colher antes de aplicar, FUN-92) e podem
   * encadear outro Carnage.
   */
  #carnage(
    session: Session, dead: MonsterRuntime, definition: Monster, credit: KillCredit,
  ): void {
    const killer = findById(session.participants, credit.lastHitBy)
      ?? findById(session.participants, dead.targetId);
    if (killer === null) return;
    const assigned = this.#charmsAgainst(killer, dead.monsterId);
    const carnage = assigned?.major?.charm.id === 'carnage' ? assigned.major : undefined;
    if (carnage === undefined || !rollDefensiveCharm(session.rng, charmChance(carnage))) return;
    const amount = carnageCharmDamage(definition.health, killer.level, carnage.charm.percent ?? 0);
    const victims: MonsterRuntime[] = [];
    for (const [dx, dy] of CARNAGE_OFFSETS) {
      const x = dead.position.x + dx;
      const y = dead.position.y + dy;
      for (const candidate of this.#hostileMonsters()) {
        if (candidate.alive && candidate.position.x === x && candidate.position.y === y
          && sameFloor(candidate.position.z, dead.position.z)) {
          victims.push(candidate);
          break;
        }
      }
    }
    for (const victim of victims) {
      this.#applyCharmDamage(session, killer, victim, amount, 'physical', true);
    }
    for (const victim of victims) {
      if (!victim.alive && this.#monsterBySubject.get(victim.subject) === victim) {
        resolveDeath(session, { kind: 'monster', monster: victim });
      }
    }
  }

  /** O nível da skill que a família aponta; sem família ou skill no catálogo, zero. */
  #skillLevelOf(character: CharacterRuntime, family: CompiledWeaponFamily | undefined): number {
    const skill = family === undefined ? undefined : this.#options.skills.get(family.skillId);
    // O bônus de equipamento da mesma skill (#524) entra aqui — no dano E na chance de acerto à
    // distância (#522), como a skill do Tibia já inclui o `skillDist` do item — MAIS o de
    // condição (#576: Berserk Potion soma 5 em `melee`, Bullseye Potion soma 5 em `distance`).
    return (skill === undefined ? 0 : this.#loyaltyLevelOf(character, skill))
      + (family === undefined ? 0 : character.inventory.skillBonus(this.#options.items, family.skillId))
      + (family === undefined ? 0 : character.conditions.skillBonus(family.skillId));
  }

  /**
   * A skill que a arma NA MÃO agora aponta (#567, `SPELL_SKILL_WEAPON`): a mesma leitura de
   * `#strike` (`Inventory.weapon`), caindo no perfil `fist` de `content.unarmed` desarmado —
   * nunca um nome fixo, porque `fist`/`club`/`sword`/`axe` são skills diferentes desde a
   * separação de `melee`. Sem a família no catálogo (conteúdo de teste incompleto), `fist`.
   */
  #equippedWeaponSkillId(character: CharacterRuntime): string {
    const item = character.inventory.weapon(this.#options.items, character);
    const family = item?.weapon?.family ?? this.#options.unarmed.family;
    return this.#options.weaponFamilies.get(family)?.skillId ?? 'fist';
  }

  /**
   * A chance de acerto à distância (#522, `combat-v2`): uma rolagem por tiro, SEMPRE consumida
   * quando o conteúdo declara `combat.distanceHitChance` — a mesma regra do bloqueio e do
   * crítico (ADR 0031). Conteúdo `combat-v1` (sem a tabela) não rola nada e sempre acerta, o
   * que preserva o v1 bit a bit — nenhum sorteio novo entra na sequência de uma hunt legada.
   *
   * `ammo.hitChance` (#522) e `ammo.maxHitChance`/`how.hitChance` (#524, só dado até aqui)
   * entram como o caminho direto, o balde da munição e o bônus/malus do arco — ver
   * `combat/distance-hit.ts`.
   */
  #rollDistanceHit(
    session: Session, character: CharacterRuntime, monster: MonsterRuntime, ammo: Ammunition,
    how: ResolvedWeapon,
  ): boolean {
    const table = this.#options.combat.distanceHitChance;
    if (table === undefined) return true;
    const family = this.#options.weaponFamilies.get('distance');
    const skillLevel = this.#skillLevelOf(character, family);
    const tiles = distance(character.position, monster.position);
    return rollDistanceHit(
      tiles, skillLevel, table, session.rng, ammo.maxHitChance, ammo.hitChance, how.hitChance,
    );
  }

  /**
   * O destino do `shot` de um tiro à distância que ERROU, só sob `combat-v3` (#555,
   * `missShotTile`, `combat/distance-hit.ts`) — os dois chamadores (`#strike`, `#throwWeapon`)
   * só entram aqui depois de conferir `this.#isV3()`, nunca em `v1`/`v2`. Adjacente ao alvo, o
   * Canary não redireciona, e o destino continua sendo o próprio alvo; a mais de 1 tile,
   * sorteia com `session.rng` um tile ANDÁVEL entre os nove do quadro 3×3 centrado nele.
   * Compartilhada pela munição por família (`#strike`) e pelo arremessável (`#throwWeapon`) —
   * os dois caminhos de tiro que podem errar.
   */
  #missDestination(session: Session, character: CharacterRuntime, monster: MonsterRuntime): WorldPoint {
    const tiles = distance(character.position, monster.position);
    return missShotTile(this.#world.map, tiles, this.#at(monster), session.rng);
  }

  /**
   * O arremessável (#575, ADR 0026 d.3 NÃO se aplica): sem `ammoFamily`, o item na mão É o
   * próprio projétil — não há seleção por família nem lançador, e não é munição abstrata: é um
   * item de verdade, `stackable: true` (spear, throwing star — como o `royal-spear.json`
   * autoral já declarava, à espera desta issue), looteado e empilhado como qualquer item comum.
   * `weapon !== null` já garante `quantity >= 1` (`equip` nunca deixa pilha vazia no corpo), então
   * não há "sem estoque" a conferir aqui — só a QUEBRA, que consome uma unidade da PILHA
   * (`Inventory.consumeStack`), nunca `ammunitionStock` (isso é só da munição arrow/bolt).
   */
  #throwWeapon(
    session: Session, character: CharacterRuntime, monster: MonsterRuntime, weapon: Item,
    how: ResolvedWeapon, damagePercent: number, defender: Defender,
    reflectAttacker: ReflectAttacker | undefined,
  ): void {
    // A chance de acerto é rolada ANTES do `emit` (#555): no `combat-v3`, errado E a mais de 1
    // tile do alvo, o destino cai num tile adjacente — ver `#missDestination`. `v1`/`v2` mantêm
    // `to` fixo no monstro mesmo no erro (ADR 0031/0040: perfil já publicado é bit a bit).
    const hit = this.#rollThrowHit(session, character, monster, how);
    session.emit({
      kind: 'shot', attackerId: character.id, targetId: monster.subject,
      weaponItemId: weapon.id, from: this.#at(character),
      to: hit || !this.#isV3() ? this.#at(monster) : this.#missDestination(session, character, monster),
    });
    if (!this.#isV3()) this.#practice(session, character, how.family, 1);
    // A quebra é rolagem SEMPRE consumida (ADR 0031): a sequência de RNG não pode depender do
    // valor de `breakChance` — a mesma regra do bloqueio e do crítico.
    if (session.rng.chance((how.breakChance ?? 0) / 100)) {
      character.inventory.consumeStack('hand');
    }
    if (!hit) {
      if (this.#isV3()) this.#practice(session, character, how.family, distanceTries(character.attackPractice));
      return;
    }
    const power = this.#weaponPower(session, character, how, damagePercent);
    const result = resolveDamage(
      {
        rawDamage: power.physical + this.#perfectShotBonus(character, monster),
        source: 'basic-attack',
        damageType: how.damageType,
        modifiers: this.#hitModifiers(session, character, monster),
        // Como a munição por família (#548): bloqueia por armadura, nunca por escudo.
        blockable: DISTANCE_BLOCK_FLAGS,
        ...(reflectAttacker === undefined ? {} : { attacker: reflectAttacker }),
      },
      defender, 'pve', this.#options.combat, session.rng, session.nowMs,
    );
    this.#land(session, character, monster, result, 'melee');
    if (this.#isV3()) this.#practice(session, character, how.family, distanceTries(character.attackPractice));
  }

  /**
   * A chance de acerto do arremessável (#575): o CAMINHO FIXO de `distance-hit.ts` — o próprio
   * `how.hitChance` da arma (viper star 80%, leaf star 90%) faz o papel do `ammunition.hitChance`
   * direto do Canary (`it.hitChance != 0` ANTES da tabela/balde), porque não há munição separada
   * cujo campo pudesse carregar isso. Sem tabela de `combat.distanceHitChance` (v1), sempre acerta.
   */
  #rollThrowHit(
    session: Session, character: CharacterRuntime, monster: MonsterRuntime, how: ResolvedWeapon,
  ): boolean {
    const table = this.#options.combat.distanceHitChance;
    if (table === undefined) return true;
    const family = this.#options.weaponFamilies.get('distance');
    const skillLevel = this.#skillLevelOf(character, family);
    const tiles = distance(character.position, monster.position);
    return rollDistanceHit(tiles, skillLevel, table, session.rng, undefined, how.hitChance ?? 0, undefined);
  }

  /**
   * O bônus de perfect shot (#575; `Player::getPerfectShotDamage`, Canary `weapons.cpp:706-718`/
   * `game.cpp:8500-8509`): soma quando a distância de Chebyshev até o alvo é EXATAMENTE o
   * `perfectShot.range` da peça no slot de escudo (a aljava) — nem mais perto, nem mais longe.
   * Vale para os dois caminhos de tiro (munição por família E arremessável), porque o Canary lê a
   * MESMA peça nos dois. Sem aljava, ou aljava sem `perfectShot`, o bônus é zero.
   */
  #perfectShotBonus(character: CharacterRuntime, monster: MonsterRuntime): number {
    const shield = character.inventory.shield(this.#options.items, character);
    const perfectShot = shield?.perfectShot;
    if (perfectShot === undefined) return 0;
    return distance(character.position, monster.position) === perfectShot.range ? perfectShot.damage : 0;
  }

  /**
   * Registra que `characterId` atacou ou curou agora (§525, ADR 0027 emenda 2026-09-24): a
   * atividade que `canShareExperience` lê como `Party::isPlayerActive` do TFS/Canary. Sem
   * `Runner` (id que não é participante — `healerId` de uma condição, por exemplo) é no-op, a
   * mesma guarda de `session.creditHealing` em `#emitHealed`.
   */
  #markCombatActive(session: Session, characterId: string): void {
    const runner = this.#runners.get(characterId);
    if (runner !== undefined) runner.lastCombatActionAtMs = session.nowMs;
  }

  /**
   * Pratica UMA vez pelo golpe, na skill que a família aponta — SÓ ELA (CMB-05, #567). A
   * prática é o `gain` da skill — `melee-hit`/`distance-hit` rendem por uso, `spell-cast` por
   * mana gasta — e o gatilho vem do conteúdo, nunca de um `if` por nome.
   *
   * Chama `#gainSkill` DIRETO, na skill resolvida — nunca `#gainSkills` (o grupo inteiro de
   * `sk.gain.on`): desde a separação de `melee` em `fist`/`club`/`sword`/`axe`, as quatro
   * compartilham o MESMO gatilho `melee-hit`, e o grupo faria uma espada treinar `axe` junto —
   * o defeito que o #567 existe para não introduzir. `distance`/`magic` continuam com uma
   * skill só por grupo, então o comportamento delas não muda.
   *
   * É chamada DEPOIS do `#land` e sem condição de dano: imunidade, resistência alta ou alvo
   * morto no impacto não impedem a prática, porque o golpe de fato ocorreu.
   */
  #practice(
    session: Session, character: CharacterRuntime, family: WeaponFamily, amount: number,
  ): void {
    const definition = this.#options.weaponFamilies.get(family);
    if (definition === undefined) return;
    const skill = this.#options.skills.get(definition.skillId);
    if (skill === undefined) return;
    this.#gainSkill(session, character, skill, amount);
  }

  /**
   * `onAttackedCreatureBlockHit` do Canary (#686): o personagem vê o tipo de bloqueio do golpe
   * que desferiu — o primário, depois o secundário, e a última chamada vence (`combatBlockHit`).
   * `combat-v1`/`v2` não produzem tipo, e aqui nada muda.
   */
  #noteAttackBlock(character: CharacterRuntime, outcome: DamageOutcome): void {
    if (outcome.blockType === undefined) return;
    let state = afterAttackBlock(character.attackPractice, outcome.blockType);
    const secondary = outcome.secondaryOutcome?.blockType;
    if (secondary !== undefined) state = afterAttackBlock(state, secondary);
    character.attackPractice = state;
  }

  /**
   * O perfil `combat-v3` (#548, ADR 0040) ou o que ele acumulou por cima (`combat-v4`, ADR
   * 0052 decisão 7) — congelado na sessão pelo conteúdo (invariante 7). O endgame (M38-M44)
   * emenda o MESMO `combat-v4` issue a issue enquanto `tibia-parity` for a branch de
   * integração (ele congela só no merge na `main`, ADR 0040 d.3): por isso este predicado
   * cobre os dois ids, em vez de ganhar um `#isV4` irmão — nenhuma issue do endgame até aqui
   * revogou mecanismo do `combat-v3`, só acrescentou em cima.
   */
  #isV3(): boolean {
    const profile = this.#options.combat.compatibilityProfile;
    return profile === 'combat-v3' || profile === 'combat-v4';
  }

  /** O fim de todo golpe do personagem: aplicar, atribuir, anunciar e contar o recorde. */
  #land(
    session: Session, character: CharacterRuntime, monster: MonsterRuntime,
    outcome: DamageOutcome, source: 'melee' | 'spell',
  ): void {
    // O CMB-08: aplicar é o estágio explícito que passa pelo mana shield (no alvo), remove HP
    // efetivo e credita o leech clampado no atacante. O `outcome` já traz o resolvido e o
    // crítico; a atribuição e o hit usam o HP APLICADO, nunca a mana absorvida nem o overkill.
    const applied = this.#drainMonster(session, monster, outcome, character);
    this.#noteAttackBlock(character, outcome);
    recordDamage(monster.contribution, character.id, applied.healthDamage);
    this.#markCombatActive(session, character.id);
    // A definição única de "em combate" (#625): ataque DADO — o espelho de `#applyMonsterHit`,
    // que marca o RECEBIDO. Ver a nota de distinção com `Runner.lastCombatActionAtMs` acima.
    character.lastCombatActionAtMs = session.nowMs;
    // O número que flutua é o APLICADO — o que saiu da barra —, e sai ANTES dela (FUN-109). O
    // resolvido é o recorde do extrato, logo abaixo; mostrar 300 sobre um rato de 10 é o
    // cliente contando uma história que a barra desmente.
    session.emit({
      kind: 'creature-hit', creatureId: monster.subject, attackerId: character.id,
      // `manaDamage` (#547): sempre zero contra um monstro (sem mana), mas soma pelo mesmo
      // contrato de `#applyMonsterHit` — nenhum `if` por tipo de alvo aqui também.
      amount: applied.healthDamage + applied.manaDamage, source, position: this.#at(monster),
      damageType: outcome.damageType,
    });
    this.#emitHealth(session, monster);
    // Life leech (CMB-08): o que de fato repôs no atacante, já clampado no teto. Atacante cheio,
    // ou alvo integralmente absorvido pela mana, informa zero e não emite evento — o número
    // verde não mente.
    this.#emitHealed(session, character, applied.lifeLeechApplied, 'leech', character.id);
    // O maior hit é o RESOLVIDO, não o aplicado (§16.1): um golpe de 300 num monstro com 10 de
    // vida foi um golpe de 300. Guardar o aplicado faria o recorde depender de quão morto o
    // alvo já estava, e o jogador nunca veria o número que ele de fato bateu.
    session.credit(character.id, 'bestBasicHit', outcome.resolvedDamage);
    // O DPS, ao contrário do recorde, soma o APLICADO (#431): overkill e absorção por mana
    // shield não são dano que saiu da barra de ninguém.
    session.creditDamage(character.id, applied.healthDamage);
    // O reflexo e a cura por elemento do monstro (#683), nesta ordem — a do Canary no fim de
    // `combatBlockHit`. Ausentes do outcome (v1/v2, ou monstro que não os declara), nada acontece.
    this.#afterMonsterHit(session, character, monster, outcome);
    // Os charms do jogador (#603): depois do dano aplicado e do leech, como `applyCharmRune`.
    this.#applyCharmsAfterHit(
      session, character, monster, applied.healthDamage, outcome.intent.extension === true,
    );
  }

  /**
   * O que o golpe do personagem desencadeia no MONSTRO depois de aplicado (#683): o reflexo dele
   * contra o personagem e a cura por elemento. Um ponto só, chamado de `#land` e de `#applyHits`
   * — os dois caminhos em que o personagem acerta um monstro —, para as duas regras não
   * divergirem entre golpe e magia.
   */
  #afterMonsterHit(
    session: Session, character: CharacterRuntime, monster: MonsterRuntime, outcome: DamageOutcome,
  ): void {
    if (outcome.reflected !== undefined && character.alive) {
      this.#reflectOntoCharacter(session, character, monster, outcome.reflected);
    }
    this.#healMonsterByElement(session, monster, outcome);
  }

  /**
   * A SEGUNDA resolução do reflexo do MONSTRO (#683): o espelho de `#reflectOntoMonster` (#552),
   * com o mesmo `reflectedDamageIntent` — EXTENSÃO, sem bloqueio por defesa/armadura, sem
   * crítico, sem leech, nunca reflete de volta. O tipo é o ORIGINAL (refletor `monster`), então a
   * absorção, a imunidade e a resistência do equipamento do personagem valem contra ele.
   *
   * Vem DEPOIS do dano no monstro — a ordem do fluxo da spec —, e por isso sai mesmo quando o
   * golpe matou o monstro: o reflexo do Canary é decidido no bloqueio, antes de a vida mudar. O
   * teto de 1 % da vida máxima do personagem faz a morte por reflexo exigir um personagem já no
   * último 1 %; quando acontece, é resolvida aqui, como em `#applyMonsterHit`.
   */
  #reflectOntoCharacter(
    session: Session, character: CharacterRuntime, monster: MonsterRuntime, reflected: ReflectedDamage,
  ): void {
    const outcome = resolveDamage(
      reflectedDamageIntent(reflected), this.#playerDefender(character, session), 'pve',
      this.#options.combat, session.rng, session.nowMs,
    );
    const applied = applyDamageOutcome(
      character, outcome, null, character.conditions.damageTakenScale(),
      this.#hasEnergyShield(character),
    );
    recordDamage(character.contribution, monster.subject, applied.healthDamage);
    session.emit({
      kind: 'creature-hit', creatureId: character.id, attackerId: monster.subject,
      amount: applied.healthDamage + applied.manaDamage, source: 'melee', position: this.#at(character),
      damageType: outcome.damageType,
    });
    this.#emitCharacterHealth(session, character);
    // HP caiu: o mesmo despertar de `#applyMonsterHit` — bot, curandeiros e automações.
    this.#armBot(session, character.id);
    this.#armHealersOf(session);
    this.#armAutomations(session, character.id);
    if (character.health <= 0) session.kill(character);
  }

  /**
   * A cura por elemento (#683, `monster.heals`): depois do dano e do reflexo (`combatBlockHit`
   * do Canary cura por último), a soma do primário com o secundário — o `damageHeal` único de
   * lá. Monstro morto não cura: o golpe que mata não gera evento. De vida cheia, zero repôs e
   * nada é emitido — a mesma regra da defesa de cura (`#onMonsterDefense`).
   */
  #healMonsterByElement(session: Session, monster: MonsterRuntime, outcome: DamageOutcome): void {
    const amount = (outcome.elementHealing ?? 0) + (outcome.secondaryOutcome?.elementHealing ?? 0);
    if (amount <= 0 || !monster.alive) return;
    const definition = this.#options.monsters.get(monster.monsterId);
    if (definition === undefined) return;
    const healed = monster.heal(definition.health, amount);
    if (healed <= 0) return;
    session.emit({
      kind: 'creature-healed', creatureId: monster.subject, amount: healed, source: 'monster',
      position: this.#at(monster),
    });
    this.#emitHealth(session, monster);
  }

  /**
   * A munição que o tiro usa (#152, ADR 0026 d.3): a escolhida da família, ou a BÁSICA dela.
   *
   * `null` é "não atira": a família não tem munição no catálogo, ou não há gold NEM estoque de
   * loot (#520, revisão do #536) que cubra o tiro. **Não existe munição grátis** — sem gold e
   * sem estoque o tiro não sai, e é a regra de saída `out-of-gold` que encerra a hunt. O preço
   * é conferido ANTES do gold sair, e o débito (ou o consumo do estoque) fica em `#strike`.
   */
  #ammoFor(character: CharacterRuntime, family: AmmoFamily): Ammunition | null {
    const chosenId = character.ammo.get(family);
    const chosen = chosenId === undefined ? undefined : this.#options.ammunition.get(chosenId);
    const ammo = chosen !== undefined && chosen.family === family
      ? chosen
      : this.#basicAmmo.get(family) ?? null;
    if (ammo === null) return null;
    const hasStock = (character.ammunitionStock.get(ammo.id) ?? 0) > 0;
    if (!hasStock && balanceOf(character) < ammo.price) return null;
    return ammo;
  }

  /**
   * O poder já escalado pelas skills que alimentam esta fonte.
   *
   * Percorre o catálogo em vez de procurar uma skill por nome: quais skills existem e o que
   * alimenta cada uma é DADO (§9.4), e um `'melee'` escrito aqui faria o motor conhecer o
   * nome de uma skill que o conteúdo pode renomear.
   */
  #scaledPower(character: CharacterRuntime, on: Skill['gain']['on'], base: number): number {
    const definitions = this.#skillsByGain[on];
    // Nenhuma skill alimentada por esta fonte: só a postura, se houver. É o caminho de um
    // conteúdo sem skills, e ele custa uma comparação — e uma multiplicação com postura.
    if (definitions.length === 0) {
      if (on === 'melee-hit') return Math.round(base * character.conditions.damageDealtScale('melee'));
      if (on === 'distance-hit') return Math.round(base * character.conditions.damageDealtScale('distance'));
      return base;
    }

    let power = base;
    for (let i = 0; i < definitions.length; i += 1) {
      const definition = definitions[i] as Skill;
      if (definition.damagePerLevel === 0) continue;
      power *= powerMultiplier(definition, this.#loyaltyLevelOf(character, definition));
    }
    // A postura (#155) escala o golpe e o tiro aqui; a magia é escalada dentro de `castSpell`,
    // por alvo — aplicar nos dois lugares contaria a mesma postura duas vezes.
    if (on === 'melee-hit') power *= character.conditions.damageDealtScale('melee');
    else if (on === 'distance-hit') power *= character.conditions.damageDealtScale('distance');
    return Math.round(power);
  }

  /**
   * Credita uso a toda skill alimentada por esta fonte (`spell-cast`, `shield-block`): hoje uma
   * skill só por grupo, então iterar ou chamar `#gainSkill` uma vez dá no mesmo — mas iterar é
   * o que continua certo se um dia houver mais de uma nesse mesmo grupo.
   *
   * `amount` é o que a fonte rende: um golpe é um golpe; uma magia rende a MANA que gastou
   * (§9.4, modelo do Tibia). Sem isso, a forma ótima de subir magia seria lançar mil vezes a
   * magia mais barata, e o jogo viraria macro de spam.
   */
  #gainSkills(
    session: Session, character: CharacterRuntime, on: Skill['gain']['on'], amount: number,
  ): void {
    const definitions = this.#skillsByGain[on];
    for (let i = 0; i < definitions.length; i += 1) {
      this.#gainSkill(session, character, definitions[i] as Skill, amount);
    }
  }

  /**
   * Credita uso a UMA skill (#567): a que a família de arma aponta, nunca o grupo inteiro de
   * `gain.on` — é o que separa `fist`/`club`/`sword`/`axe` de verdade, depois de todas
   * compartilharem o mesmo gatilho `melee-hit`. `#gainSkills`, acima, continua servindo os
   * gatilhos que SÃO compartilhados de propósito.
   *
   * Subir de nível é evento notável: numa hunt de oito horas é uma das poucas coisas que o
   * jogador quer ver ao voltar, ao lado do level up (§16.2).
   */
  #gainSkill(
    session: Session, character: CharacterRuntime, definition: Skill, amount: number,
  ): void {
    if (amount <= 0) return;
    const gain = definition.gain;
    const points = gain.on === 'spell-cast' ? gain.pointsPerMana * amount : gain.points * amount;
    // O fator de crescimento é DESTA vocação (#521, ADR 0037): um Knight sobe corpo a corpo
    // rápido e magia devagar, um Sorcerer o oposto — a mesma curva de conteúdo, um `factor`
    // diferente por quem está usando.
    const vocation = this.#vocationOf(character);
    const factor = skillFactorFor(definition, vocation, this.#options.progression);
    // O rate de skill/magia (#691), pelo stage do nível BASE — o Canary acha o stage do ML
    // por `getBaseMagicLevel()`. Os pontos já são reais: nada a arredondar.
    const rate = skillRateFor(this.#options.progression.rates, definition.id, character.skills.levelOf(definition));
    if (character.skills.gain(definition, rate === 1 ? points : points * rate, factor) > 0) {
      session.record('skill-up', `${definition.id}/${character.skills.levelOf(definition)}`);
    }
  }

  /**
   * O monstro morreu: conta o abate, recompensa quem matou e devolve o lugar ao spawner.
   *
   * A recompensa vai ao ÚLTIMO GOLPE (DT-03). A atribuição inteira fica guardada em
   * `credit.damageByActor`; a divisão entre participantes é regra de produto e entra com
   * party — os dados já vão estar lá.
   */
  #onMonsterDied(session: Session, monster: MonsterRuntime, credit: KillCredit): void {
    const definition = this.#options.monsters.get(monster.monsterId);
    const killer = findById(session.participants, credit.lastHitBy);
    // O abate conta SEMPRE, para todo presente: "matei N" é a pergunta do analisador de cada
    // um (#190, DT-01), e a party matou junto. Em solo é o de sempre — conta mesmo com a fonte
    // sumida ou o dono morto; o extrato mentiria se dissesse que não.
    for (const participant of session.participants) session.credit(participant.id, 'kills', 1);

    const eligible = session.participants.length === 1
      ? (killer !== null && killer.alive && !isExhausted(killer) ? [killer] : NO_MEMBERS)
      : session.participants.filter((p) => p.alive && !isExhausted(p));
    // Invocação (#546, TFS `hasBeenSummoned()`/`setDropLoot(false)`/`setSkillLoss(false)`):
    // nunca paga loot, XP nem Bestiário — ela nasceu de outro monstro, não do Spawner, e o
    // abate dela não é o que a hunt existe para pagar (`Player::onKilledMonster` devolve cedo
    // para quem tem mestre, antes de tocar Bestiário ou hunting task). `#lootRecipient` consome
    // `session.rng` em party `split`; pular o cálculo inteiro é o que impede um abate que nunca
    // paga nada de mover a sequência de sorteio de toda a hunt (FUN-63) por uma rolagem que o
    // Tibia nem faz.
    const isSummon = monster.masterId !== null;
    // Quem recebe o loot (#191): em solo, o matador — se pode receber; sem dono (fonte que
    // sumiu) ou dono morto, ninguém. Em party `split`, UM elegível sorteado; em `shared`,
    // ninguém — a bolsa (#192).
    const recipient = isSummon ? null : this.#lootRecipient(session, killer, eligible);
    // O que o cadáver nasce carregando (ADR 0048 decisão 1) — vazio no modo bolsa (o loot vai
    // direto para ela, "como hoje") e quando não há destinatário nenhum.
    let corpseGold = 0;
    let corpseItems: CarriedItem[] = [];
    // A esfola do bot (#626, ADR 0048 d.5): tentada no MESMO evento, DEPOIS de todo o sorteio de
    // loot — a ordem do RNG é contrato (FUN-63), e o estágio novo entra por último para não
    // deslocar nada do que já saía. `skinAfterTtlMs` só existe quando houve sorteio — é ele que
    // marca o cadáver como esfolado e que o reagenda (o `transform` do Canary reinicia o decaimento).
    let skinAfterTtlMs: number | undefined;
    if (!isSummon && definition !== undefined && this.#bag !== null && session.participants.length > 1) {
      // Modo compartilhado (#192): tudo cai na BOLSA — sem destinatário, sem modificador
      // individual, e a ordem do RNG é a de solo (gold, depois itens na ordem da tabela).
      // Só com alguém elegível: um monstro que morreu com todo mundo morto não paga ninguém.
      if (eligible.length > 0) {
        const loot = this.#rollLootFor(monster, definition.loot, session.rng, this.#gutOf(session, monster, credit));
        // Elegibilidade da bolsa (D4/§16.1): TODOS os presentes no instante do abate — o mesmo
        // conjunto que paga o rateio, não o `eligible` (vivo + stamina) que decide XP.
        const presentAtDrop = session.participants.map((p) => p.id);
        if (loot.gold > 0) this.#bag.gold.push({ amount: loot.gold, eligible: presentAtDrop });
        // `#deliverToBag` rebalanceia e emite SEMPRE (mesmo sem itens: o gold muda o `value`),
        // então o `#emitBag` que existia aqui para o drop de gold puro sumiu (DT-03).
        this.#deliverToBag(session, loot.items);
        // Supply e munição (#520): não passam pela bolsa — são abstratos, sem peso e sem
        // settlement a liquidar depois. Divididos entre os MESMOS presentes que a bolsa usa
        // (`presentAtDrop`, D4/§16.1), não o `eligible` de XP.
        this.#creditSupplies(session, session.participants, loot.supplies);
        this.#creditAmmunition(session, session.participants, loot.ammunition);
        // Sem dono do cadáver, a esfola é de quem entre os elegíveis tem a ferramenta (na ordem
        // da sessão) e o material cai na bolsa, como o resto do loot desta modalidade.
        const skin = this.#skinAtDeath(session, monster, eligible);
        skinAfterTtlMs = skin.afterTtlMs;
        if (skin.material !== null) this.#deliverToBag(session, [skin.material]);
      }
    } else if (!isSummon && definition !== undefined && recipient !== null) {
      // O sorteio é IDÊNTICO a antes deste ADR — gold, depois itens na ordem da tabela — e o
      // destino é o cadáver, não mais direto na mochila (ADR 0048 decisão 1). `corpseGold`/
      // `corpseItems` alimentam o cadáver logo abaixo, e `#collectFromCorpse` roda no MESMO
      // evento (decisão 3): não há "segunda chance" para quem está olhando ainda em #721/W2 —
      // isso é o W3/#722.
      const loot = this.#rollLootFor(
        monster, this.#lootTableFor(definition, recipient), session.rng, this.#gutOf(session, monster, credit),
      );
      corpseGold = loot.gold;
      corpseItems = this.#instantiateCorpseItems(session, recipient, loot.items);
      // Supply e munição (#520): o recipiente do loot leva o estoque inteiro, como o gold —
      // são abstratos, sem cadáver (ADR 0048 decisão 1).
      this.#creditSupplies(session, [recipient], loot.supplies);
      this.#creditAmmunition(session, [recipient], loot.ammunition);
      // O material da esfola cai NO CADÁVER, ao lado do loot, e segue o filtro de Quick Loot do
      // dono no `#collectFromCorpse` logo abaixo (ADR 0048 d.3/d.5) — sobra por filtro ou por
      // capacidade fica lá, como qualquer item.
      const skin = this.#skinAtDeath(session, monster, [recipient]);
      skinAfterTtlMs = skin.afterTtlMs;
      if (skin.material !== null) {
        corpseItems = [...corpseItems, ...this.#instantiateCorpseItems(session, recipient, [skin.material])];
      }
    }
    // A XP é da PARTY (#190, ADR 0027 decisão 3): pool por vocações únicas, dividido por igual
    // entre os elegíveis — e em solo o elegível é o matador, pela mesma condição de sempre.
    // `#grantPartyXp` também é quem credita o Bestiário (#546: nenhum dos três vale para quem
    // tem mestre).
    //
    // O Bosstiary vem DEPOIS, e fora do `eligible`: o Canary paga a XP e só então chama
    // `onKilledMonster` de cada matador, sem o portão de stamina e de vida da XP (#629) — um
    // herói exausto, ou uma party cujos membros estão todos exaustos, continua contando o boss.
    // Os matadores saem ANTES da XP: o level up deste abate não pode mexer na régua de nível
    // da XP compartilhada que já valia quando o monstro morreu.
    if (!isSummon && definition !== undefined) {
      const bosstiaryKillers = definition.boss && definition.bosstiary !== undefined
        ? this.#killersOf(session, credit)
        : NO_MEMBERS;
      this.#grantPartyXp(session, monster, definition, eligible, credit);
      this.#creditBosstiary(session, monster, definition, bosstiaryKillers);
    }
    // Abate comum NÃO vira evento notável. `notableEvents` é a lista curta da tela de retorno
    // (§16.2), e uma hunt de oito horas com uma linha por rato não é lista, é log.

    // O lugar volta a contar o tempo — e é aqui que a próxima hora dele é marcada, agora que
    // o spawner não guarda mais instante nenhum. O `spawntime` do PONTO (#519/#583, o `<monster
    // spawntime="...">` do Canary é por posição, não por zona) é OBRIGATÓRIO desde o #583: não
    // há mais dificuldade nenhuma para cair como fallback.
    this.#releaseSpawnSlot(session, monster);
    // O andar de FATO do monstro (#519) — nunca o do mapa: é o que libera o tile certo quando
    // ele morre em z11 num mapa cujo andar padrão é z10.
    this.#world.vacate(monster.position.x, monster.position.y, this.#floorOf(monster));
    // O cadáver carrega o loot (FUN-123, ADR 0048 decisão 1): fica no tile por `corpseTtlMs` do
    // MONSTRO (#585 — era da hunt) e some sozinho, levando o que ninguém coletou junto
    // (decisão 5) — a arte é da tabela, no hospedeiro (invariante 6).
    //
    // A COLETA roda sempre, com `corpseTtlMs` ou sem — é o abate creditando gold e item de
    // sempre, e gatear por um campo de conteúdo opcional quebraria todo monstro que nunca falou
    // de cadáver. Só a PERSISTÊNCIA do que sobra (o cadáver visível, com prazo próprio) depende
    // de `corpseTtlMs`: sem ele, o que o filtro não aceitou ou não coube não tem onde esperar, e
    // desaparece — o "não deixa nada" de antes deste ADR, agora só para a sobra.
    //
    // A invocação NUNCA deixa cadáver (#600): `Creature::dropCorpse` do Canary devolve cedo com um
    // POFF quando `!lootDrop && getMonster()` — e `setMaster(..., true)`/`setDropLoot(false)` é o que
    // toda invocação recebe (a do jogador, a de monstro, o convencido e o Skeleton da Animate Dead).
    // Sem esta regra o esqueleto animado morreria e deixaria um cadáver animável: a cadeia infinita
    // de Animate Dead que o Canary nunca permite.
    const corpseTtlMs = isSummon ? undefined : definition?.corpseTtlMs;
    const corpse: CorpseState = {
      id: corpseTtlMs === undefined ? 0 : this.#nextGroundItemId++,
      monsterId: monster.monsterId,
      position: this.#at(monster),
      items: corpseItems,
      gold: corpseGold,
      ownerId: recipient?.id ?? null,
      eligible: eligible.map((p) => p.id),
      diedAtMs: session.nowMs,
      ...(skinAfterTtlMs !== undefined ? { skinned: true } : {}),
    };
    // O dono coleta AGORA, sem plateia (invariante 3, ADR 0048 decisão 3): o `autoLoot` do
    // Canary, sem trava de Premium. O que o filtro não aceita ou não cabe fica no cadáver.
    if (recipient !== null) this.#collectFromCorpse(session, corpse, recipient);
    if (corpseTtlMs !== undefined) {
      this.#corpses.push(corpse);
      session.emit({
        kind: 'ground-item-appeared', itemId: corpse.id, monsterId: corpse.monsterId,
        position: corpse.position,
      });
      // Esfolado no abate, o cadáver não vive o `corpseTtlMs` inteiro: o Canary o transforma em
      // `skin.after` (com ou sem sucesso), e o decaimento recomeça dali — a vida passa a ser a do
      // `after` (`Skinning.stages[].afterTtlMs`), contada a partir do abate.
      session.scheduleIn(CORPSE, skinAfterTtlMs ?? corpseTtlMs, {
        priority: EventPriority.Housekeeping, subject: String(corpse.id),
      });
    }
    // Os eventos dele já saíram da fila: congelar é o primeiro estágio do pipeline. Aqui só
    // se tira o monstro dos índices desta instância — e da atribuição de quem ele bateu, senão
    // o mapa do personagem cresce uma chave por respawn até o fim da hunt.
    const subject = monster.subject;
    // As CONDIÇÕES do monstro (CMB-07) saem com ele: sem isto, o DOT de um monstro morto
    // continuaria na fila e venceria contra o vazio. O `resolveDeath` só cancela o `m:<id>`.
    this.#cancelConditions(session, monster);
    for (const character of session.participants) forgetActor(character.contribution, subject);
    // As abilities DECLARADAS têm subject DERIVADO (CMB-06), e o `resolveDeath` só cancelou o
    // `m:<id>`. Cancelar pelos ids que o conteúdo conhece é O(abilities), sem varrer a fila —
    // e é o que impede um monstro morto de acordar uma vez por cadência.
    for (const ability of definition?.abilities ?? []) {
      if (ability.id === BASIC_ABILITY_ID) continue;
      session.cancelEvent(MONSTER_ABILITY, monsterAbilitySubject(monster.id, ability.id));
    }
    // As DEFESAS (#518) têm o mesmo problema e a mesma solução: subject derivado, cancelado
    // pelos ids que o conteúdo conhece. `MONSTER_TARGET_CHANGE` usa o subject `m:<id>` exato, e
    // esse o `resolveDeath` já cancelou junto do resto.
    for (const defense of definition?.defenses ?? []) {
      session.cancelEvent(MONSTER_DEFENSE, monsterDefenseSubject(monster.id, defense.id));
    }
    // A INVOCAÇÃO (#546) é o mesmo problema e a mesma solução: subject derivado por NOME. Só um
    // monstro sem mestre chegou a agendar algum (`#spawnMonster`), então este laço é vazio para
    // toda invocação — e para todo monstro sem `summons` — sem precisar perguntar qual dos dois.
    for (const entry of definition?.summons?.entries ?? []) {
      session.cancelEvent(MONSTER_SUMMON, monsterSummonSubject(monster.id, entry.monsterId));
    }
    this.#monsterBySubject.delete(subject);
    this.#monsters = this.#monsters.filter((m) => m.id !== monster.id);
    // O alvo escolhido morreu: o auto-target reavalia AGORA para o próximo mais próximo na tela
    // (#444, AB-09). O alvo antigo aponta para um subject que acabou de sair do índice, e são
    // `#attackTargetOfRunner`/`#botCandidateOf` que o limpam — não há um segundo lugar para
    // esquecer de limpar.
    for (const character of session.participants) this.#autoSelectTarget(session, character);
    // Um emit aqui, e não uma varredura de `#monsters` por ciclo no hospedeiro: com 5.000
    // instâncias, quem conta o custo é a fila, não o laço de quem olha (FUN-103).
    session.emit({ kind: 'creature-vanished', creatureId: subject });

    // O mestre morreu: as invocações dele vão junto (#546, TFS `Game::removeCreature`, o laço
    // que remove `creature->summons` quando o dono some). `filter` ANTES de remover qualquer
    // uma — `#removeSummon` troca `#monsters` por um array novo a cada chamada (a mesma cautela
    // da FUN-92: varrer o array que está sendo trocado pularia a segunda invocação sempre que
    // há duas), e o filtro compara pelo id NUMÉRICO, que continua válido mesmo depois do mestre
    // já ter saído de `#monsters` alguns parágrafos acima.
    const summons = this.#monsters.filter((m) => m.masterId === monster.id);
    for (const summon of summons) this.#removeSummon(session, summon);
    // O Carnage (#603) no FIM, com o morto já fora dos índices: as mortes que ele causa são
    // resolvidas aqui dentro, depois de todos os golpes, e podem encadear outro Carnage. Vale para a
    // invocação também: o `Monster::death` do Canary não confere `isSummon()` — só o loot, a XP e o
    // Bestiário (`Player::onKilledMonster`) a excluem, e é por isso que o `isSummon` acima os guarda
    // e este não. A invocação de PERSONAGEM nunca chega a um `killer`: quem a mata é monstro.
    if (definition !== undefined && this.#charmStage()) {
      this.#carnage(session, monster, definition, credit);
    }
  }

  /**
   * O monstro saiu do mundo (morreu, ou some com o mestre): devolve o lugar dele ao Spawner e
   * agenda o respawn. Um monstro sem lugar (invocação do jogador, do #598, ou de outro monstro)
   * devolve `null` e não agenda nada — e um monstro CONVENCIDO (#600) ainda tem o lugar do ponto de
   * onde saiu, que só volta agora, como no Canary (`SpawnMonster::cleanup` só limpa o que
   * `isRemoved()`).
   *
   * Metade do prazo para a Boosted Creature do dia (#615, ADR 0054 decisão 7, `SpawnMonster::
   * addMonster`, `spawn_monster.cpp:379-386`): o monstro que acabou de sair é o mesmo que vai
   * respawnar neste lugar, então o `monsterId` DELE decide, não o do ponto — pontos com `monsters`
   * (peso) só sabem qual nasceu depois do sorteio.
   */
  #releaseSpawnSlot(session: Session, monster: MonsterRuntime): void {
    const slot = this.#spawner.release(monster.id);
    if (slot === null) return;
    const pointIndex = this.#spawner.slots[slot]?.pointIndex;
    const point = pointIndex === undefined ? undefined : this.#options.route.spawnPoints[pointIndex];
    if (point === undefined) return;
    session.scheduleIn(SPAWN, this.#respawnDelayFor(monster.monsterId, point.respawnDelayMs), {
      priority: EventPriority.Spawn, subject: String(slot),
    });
  }

  /**
   * Uma invocação some porque o MESTRE morreu ou foi removido (#546, TFS `Game::removeCreature`:
   * `setSkillLoss(false)` e `removeCreature(summon)` para cada uma, sem passar pelo pipeline de
   * morte). Ela nunca pagou XP, loot nem Bestiário enquanto viva (`#onMonsterDied` já a exclui
   * pelo `masterId`), e esta remoção não é diferente: sem golpe, sem cadáver, sem abate — libera
   * o tile e cancela os eventos dela, os MESMOS três laços de `#onMonsterDied` (ability, defesa,
   * invocação — vazio nela mesma, que nunca arma a própria lista), com `cancelEvents(subject)`
   * no lugar do que `resolveDeath` faria por um golpe que nunca aconteceu.
   */
  #removeSummon(session: Session, summon: MonsterRuntime): void {
    const definition = this.#options.monsters.get(summon.monsterId);
    const subject = summon.subject;
    this.#cancelConditions(session, summon);
    for (const character of session.participants) forgetActor(character.contribution, subject);
    for (const ability of definition?.abilities ?? []) {
      if (ability.id === BASIC_ABILITY_ID) continue;
      session.cancelEvent(MONSTER_ABILITY, monsterAbilitySubject(summon.id, ability.id));
    }
    for (const defense of definition?.defenses ?? []) {
      session.cancelEvent(MONSTER_DEFENSE, monsterDefenseSubject(summon.id, defense.id));
    }
    for (const entry of definition?.summons?.entries ?? []) {
      session.cancelEvent(MONSTER_SUMMON, monsterSummonSubject(summon.id, entry.monsterId));
    }
    // `resolveDeath` cancelaria o `m:<id>` base (passo, ataque básico, troca de alvo) ao matar;
    // esta invocação nunca morreu — ela some —, então quem cancela é aqui.
    session.cancelEvents(subject);
    this.#world.vacate(summon.position.x, summon.position.y, this.#floorOf(summon));
    // O monstro CONVENCIDO (#600) ainda ocupa o lugar do ponto de spawn de onde saiu: sumir com o
    // mestre o remove do mundo, e o Canary começa o respawn ali (`Monster::onRemoveCreature`, ramo
    // `creature.get() == this` → `startSpawnMonsterCheck`). Invocação sem lugar (`null`) não agenda nada.
    this.#releaseSpawnSlot(session, summon);
    this.#monsterBySubject.delete(subject);
    this.#monsters = this.#monsters.filter((m) => m.id !== summon.id);
    for (const character of session.participants) this.#autoSelectTarget(session, character);
    session.emit({ kind: 'creature-vanished', creatureId: subject });
  }

  /**
   * Entrega o que caiu: mochila primeiro, Caixa de Loot da Sessão para o que não couber
   * (§22.2, §21.6, FUN-88).
   *
   * **O id da instância é DETERMINÍSTICO** — `sessionId:n` —, e isso é o que torna a inserção
   * idempotente: um extrato reprocessado insere a mesma chave primária e não faz nada. É a
   * mesma propriedade que a `UNIQUE (session_id, seq)` dá ao ledger (invariante 10), obtida do
   * mesmo jeito: identidade previsível em vez de conferência.
   *
   * Nada aqui escreve banco. O `sim` não faz I/O (invariante 1): o que ele faz é registrar
   * onde cada coisa ficou, e o extrato leva.
   */
  /**
   * A cota de XP de cada elegível para este abate (§525, ADR 0027 emenda 2026-09-24/25).
   *
   * Com 0/1 elegível, ou fora de party, `xpShare` já devolve a cota igual (a XP inteira em
   * solo) sem ler mais nada — o `canShareExperience` do TFS/Canary não tem o que decidir com
   * menos de dois. Com 2+, a XP compartilhada é TUDO OU NADA (`Party::getSharedExperienceStatus`):
   * `canShareExperience` confere nível (2/3 do MAIOR level de TODA a sessão), alcance/andar do
   * líder e atividade recente — checados sobre `allMembers`, o ROSTER INTEIRO da sessão
   * (`getPlayers()` nas duas engines: líder + membros, presente ou não elegível para receber),
   * não só `eligible`; se todos passam, a cota é igual (`xpShare`, cujo divisor TAMBÉM é
   * `allMembers.length` — o tamanho total da party, como as duas engines fazem, não a contagem
   * de elegíveis); se qualquer um falha, ninguém compartilha — cada elegível recebe pelo DANO
   * que causou neste monstro (`xpByDamage`), como o Tibia sem party.
   *
   * `this.#party` ausente com `eligible.length > 1` não deveria acontecer (só a party hospeda
   * mais de um dono), mas cai para a cota igual em vez de lançar — o mesmo espírito defensivo
   * de `autoSellLimit` diante de conteúdo incompleto.
   */
  #xpShares(
    session: Session, eligible: readonly CharacterRuntime[], experience: number, credit: KillCredit,
  ): ReadonlyMap<string, number> {
    const party = this.#party;
    const allMembers = session.participants.map((p) => ({ id: p.id, vocationId: this.#vocationOf(p)?.id ?? null }));
    if (eligible.length <= 1 || party === undefined) {
      const share = xpShare(experience, eligible, allMembers);
      return new Map(eligible.map((member) => [member.id, share]));
    }
    if (this.#sharedExperienceActive(session, party)) {
      const share = xpShare(experience, eligible, allMembers);
      return new Map(eligible.map((member) => [member.id, share]));
    }
    return xpByDamage(experience, eligible, credit.damageByActor);
  }

  /**
   * A XP compartilhada está ATIVA neste instante? (`Party::isSharedExperienceActive()` do
   * TFS/Canary, avaliada no abate — o mesmo `Party::getSharedExperienceStatus` que `#xpShares`
   * sempre usou.) Tudo ou nada sobre o ROSTER inteiro: nível, alcance do líder e atividade —
   * ver `canShareExperience`. Sem líder presente, não há de onde medir o alcance: inativa.
   */
  #sharedExperienceActive(session: Session, party: PartyOptions): boolean {
    const leader = session.participants.find((p) => p.id === party.leaderId);
    const highestLevel = session.participants.reduce((max, p) => Math.max(max, p.level), 0);
    const rules = this.#options.party.sharedExperience ?? DEFAULT_SHARED_EXPERIENCE_RULES;
    return leader !== undefined && canShareExperience(
      session.participants.map((member) => ({
        id: member.id,
        level: member.level,
        position: member.position,
        lastActionAtMs: this.#runners.get(member.id)?.lastCombatActionAtMs ?? null,
      })),
      highestLevel, leader.position, session.nowMs, rules,
    );
  }

  /**
   * Quem o Canary põe no conjunto `killers` de um monstro que morreu (`Creature::onDeath`,
   * `src/creatures/creature.cpp`) — o conjunto a que `Player::onKilledMonster` chama, e portanto
   * o que decide o Bosstiary (#629) lá, sem olhar stamina nem vida: só `Player::gainExperience`
   * tem o portão de stamina, e ele é da XP. (O Bosstiary não existe no TFS.)
   *
   * - todo jogador com dano neste monstro no `damageMap` (o dano da invocação já entra no nome
   *   do mestre, `#applyMonsterHitOnSummon`, como `attacker->getMaster()` no Canary) — quem não
   *   bateu não é matador, e quem já saiu da sessão não está mais aqui para ser achado
   *   (`getCreatureByID`);
   * - e, com a XP compartilhada ATIVA, o roster inteiro da party (líder e todos os membros) —
   *   mas só se algum deles bateu: o Canary acrescenta a party ao ver UM atacante dela.
   *
   * Sem `partyOptions` com 2+ participantes (fixture), cai para o roster inteiro — a mesma
   * cota igual que `#xpShares` devolve nesse caso. Em ordem de entrada: o conjunto do Canary não
   * tem ordem, e os eventos notáveis saem na da sessão.
   */
  #killersOf(session: Session, credit: KillCredit): readonly CharacterRuntime[] {
    const dealers = session.participants.filter((p) => (credit.damageByActor[p.id] ?? 0) > 0);
    if (dealers.length === 0 || session.participants.length === 1) return dealers;
    const party = this.#party;
    return party === undefined || this.#sharedExperienceActive(session, party)
      ? session.participants
      : dealers;
  }

  /**
   * O abate de BOSS conta no Bosstiary de cada matador (#629, `Player::addBosstiaryKill` em
   * `Player::onKilledMonster`) — e só dele: o Canary chama depois de pagar a XP, em outro laço
   * do `Creature::onDeath`, e SEM o portão de stamina nem de vida que decide quem recebe a XP
   * (`#grantPartyXp`). Um herói com stamina zero continua na hunt e o boss que ele ajudou a
   * matar conta: nível e pontos. Quem chama já excluiu a invocação (`hasBeenSummoned`).
   *
   * `killers` é `#killersOf` avaliado ANTES da XP. Boss sem `bosstiary` (fixture de teste com
   * `boss: true`) não conta, como o Canary faria com um `isBoss` sem `bossRaceId`, e o comum
   * nunca passa por aqui (`Bestiary`, em `#grantPartyXp`). Fechar um nível é evento notável,
   * como o marco do Bestiário: três vezes por boss na vida do personagem. Nada aqui consome RNG.
   */
  #creditBosstiary(
    session: Session, monster: MonsterRuntime, definition: Monster, killers: readonly CharacterRuntime[],
  ): void {
    const boss = definition.bosstiary;
    if (!definition.boss || boss === undefined) return;
    const solo = session.participants.length === 1;
    for (const member of killers) {
      const recorded = member.bosstiary.record(boss.raceId, boss.rarity, this.#options.bosstiary);
      if (recorded.levelReached !== null) {
        const detail = `${monster.monsterId}/${String(recorded.levelReached)}`;
        session.record('bosstiary-level', solo ? detail : `${member.id}/${detail}`);
      }
    }
  }

  /**
   * A XP de um abate, dividida pela party (#190, ADR 0027 decisões 3 e emenda 2026-09-24).
   *
   * A cota vem de `#xpShares` — pool por vocações únicas reais dividido por igual quando a
   * party inteira atende a elegibilidade do TFS/Canary, por dano quando não atende. Elegível é
   * quem está VIVO com stamina — a condição que sempre decidiu se o matador recebia, aplicada a
   * cada membro. Em solo, a cota é a XP inteira sem ler a tabela, e o único elegível é o
   * matador: nada muda, inclusive quando a fonte do golpe sumiu — aí o solo continua sem XP,
   * porque o único candidato não é o matador (DT-04).
   *
   * A ordem é contrato: para cada elegível, na ordem de ENTRADA, o bônus de Bestiário de ANTES
   * deste abate (DT-04 da FUN-113) SOMA-SE ao bônus de level e aos que vierem — a XP com bônus
   * sai de UMA multiplicação em inteiro (`applyExperienceBonus`), nunca de uma cadeia de
   * `floor` por bônus; depois `grantXp` → `record` no Bestiário. Nada aqui consome RNG.
   */
  #grantPartyXp(
    session: Session, monster: MonsterRuntime, definition: Monster, eligible: readonly CharacterRuntime[],
    credit: KillCredit,
  ): void {
    if (eligible.length === 0) return;
    // Boosted Creature (#615, ADR 0054 decisão 7): XP ×2 — dobrado na BASE do pool, antes da
    // divisão por vocações únicas e do bônus de Bestiário/level, para o dobro valer para todo
    // elegível na mesma proporção que a XP normal já dividia entre eles.
    const baseExperience = monster.monsterId === this.#options.boostedMonsterId
      ? definition.experience * 2
      : definition.experience;
    const shares = this.#xpShares(session, eligible, baseExperience, credit);
    const solo = session.participants.length === 1;
    for (const member of eligible) {
      const share = shares.get(member.id) ?? 0;
      // Aditivo por decisão (#563): Bestiário + faixa de level + os que vierem (VIP, evento —
      // extensão aqui, valor zero hoje; a monetização está fora desta issue). O rate de XP
      // (#691) multiplica DEPOIS do bônus somado (o `baseRate` do Canary), pelo level de CADA
      // membro: é no `onGainExperience` de cada um que o Canary o aplica.
      const bonusPercent = member.bestiary.xpBonusPercent(this.#options.bestiary)
        + levelExperienceBonusPercent(member.level, this.#options.progression);
      const experience = applyRate(
        applyExperienceBonus(share, bonusPercent),
        experienceRateFor(this.#options.progression.rates, member.level),
      );
      // O level de ANTES do ganho é o que o Canary compara (`onGainExperience`, DEPOIS do
      // `grantXp` o level já teria subido, e o portão perderia o "esta XP foi grande o
      // bastante para o level que eu TINHA" — o mesmo cuidado do bônus de Bestiário logo acima.
      const levelBeforeGain = member.level;
      const change = grantXp(member, experience, this.#vocationOf(member), this.#options.progression);
      session.credit(member.id, 'xpGained', experience);
      this.#gainSoulFromExperience(session, member, experience, levelBeforeGain);
      // Level up É evento notável, ao contrário do abate: é a única coisa que aconteceu numa
      // hunt de oito horas que o jogador quer ver ao voltar (§16.2). Em party o detalhe diz
      // DE QUEM (DT-02); em solo fica como sempre foi, e `event-text.ts` lê o formato solo.
      if (change !== null) {
        session.record('level-up', solo ? String(change.to) : `${member.id}/${String(change.to)}`);
        // E reescreve `health`/`maxHealth` pela tabela (`retarget`): a barra sai daqui como
        // de todo lugar que a escreve (FUN-109). Sem isto, a barra sobre o herói ficava com o
        // máximo velho até o próximo golpe ou regeneração — e de vida cheia a regeneração não
        // anuncia nada, então "até a reanexação".
        this.#emitCharacterHealth(session, member);
        // Level up REESCREVE `capacity` pela tabela (`retarget`, progression.ts): é gatilho do
        // §13 — a disponível do membro cresce, e as reservas mudam com ela.
        this.#rebalanceBag(session);
      }
      // O abate conta no Bestiário de TODO elegível (ADR 0027 decisão 4), pela MESMA condição
      // que paga a XP (§18.6): stamina zero não conta abate. E fechar um marco é evento
      // notável, como o level up: acontece cinco vezes por monstro na vida do personagem.
      //
      // BOSS não conta no Bestiário (#629): `Player::addBestiaryKill` devolve cedo para
      // `isBoss()`. Ele conta no Bosstiary, mas NÃO aqui — o Bosstiary não tem o portão de
      // stamina e de vida da XP, e `#creditBosstiary` roda depois deste laço, sobre os
      // `killers` do Canary (`#killersOf`).
      if (!definition.boss) {
        const reached = member.bestiary.record(monster.monsterId, this.#options.bestiary);
        if (reached.milestoneReached !== null) {
          const detail = `${monster.monsterId}/${String(reached.milestoneReached)}`;
          session.record('bestiary-milestone', solo ? detail : `${member.id}/${detail}`);
        }
      }
    }
  }

  /**
   * O rateio de um supply no modo compartilhado (#192, ADR 0027 decisão 5).
   *
   * `floor(c / n)` de cada presente e o resto do usuário; quem não tem saldo para a cota paga
   * o que tem e o usuário cobre; se nem o usuário cobre, `canAfford` é `false` e nada é
   * debitado de ninguém — a garantia continua sendo a ORDEM, como no solo. `pay` credita
   * `goldSpent` a cada um pelo que pagou: o extrato de cada membro sai equalizado.
   */
  #sharedPurse(session: Session, user: CharacterRuntime): Purse {
    const plan = (cost: number): Map<string, number> | null => {
      const present = session.participants;
      const share = Math.floor(cost / present.length);
      const paid = new Map<string, number>();
      let uncovered = cost - share * present.length;   // o resto é do usuário
      for (const member of present) {
        if (member === user) continue;
        const can = Math.min(share, Math.max(0, balanceOf(member)));
        paid.set(member.id, can);
        uncovered += share - can;
      }
      const mine = share + uncovered;
      if (balanceOf(user) < mine) return null;
      paid.set(user.id, mine);
      return paid;
    };
    return {
      canAfford: (cost) => plan(cost) !== null,
      pay: (cost) => {
        const paid = plan(cost);
        if (paid === null) return;
        for (const member of session.participants) {
          const gold = paid.get(member.id) ?? 0;
          if (gold === 0) continue;
          member.goldDelta -= gold;
          session.credit(member.id, 'goldSpent', gold);
        }
      },
    };
  }

  /** O líder presente, ou o mais antigo (#192): é dele a caixa do excedente e o invendável. */
  #leader(session: Session): CharacterRuntime | undefined {
    const wanted = this.#party?.leaderId;
    return session.participants.find((p) => p.id === wanted) ?? session.participants[0];
  }

  /**
   * O limite de tipos vendáveis do LÍDER (D2/§23.1): o Premium é do PERSONAGEM líder, nunca do
   * usuário do item. O conteúdo manda os números; a sessão só lê.
   */
  #autoSellLimit(): number {
    const party = this.#party;
    if (party === undefined) return 0;
    return autoSellLimit(
      party.premiumByCharacter, party.leaderId, this.#options.party.autoSellItemTypes,
    );
  }

  /** Os ids que de fato vendem: só os `autoSellLimit` PRIMEIROS da lista configurada (§23.1). */
  #effectiveAutoSell(): ReadonlySet<string> {
    const party = this.#party;
    if (party === undefined) return EMPTY_AUTO_SELL;
    return new Set(party.autoSell.slice(0, this.#autoSellLimit()));
  }

  /**
   * O loot cai na bolsa (#192, #396): pelo PESO, contra a capacidade DISPONÍVEL somada
   * (`capacity − inventory.weight`), não a total — bolsa e mochila contavam a mesma capacidade
   * duas vezes. `itemsLooted` conta para todo presente — "quantos itens caíram" é a pergunta do
   * §16.1, e caíram para a party (DT-03) —, mas SÓ o que de fato é coletado.
   *
   * A lista de COLETA filtra DEPOIS de `rollLoot` (§7, D2): zero RNG a mais (FUN-63), e o item
   * fora da lista fica no cadáver — sem `itemsLooted`, sem caixa de ninguém. A VENDA AUTOMÁTICA
   * é um subconjunto lógico da coleta: o item vendável nunca pesa nem entra na bolsa, vira gold
   * na hora dividido pelos presentes no abate (§8, D2/§16.1).
   *
   * Em OVERWEIGHT (§14, DT-01) um item com `weight > 0` que não cabe NÃO é coletado: fica no
   * cadáver — nem bolsa, nem caixa do líder (a caixa é coletar com outro destinatário). Item de
   * peso `0` sempre entra, gold sempre entra, autovenda sempre vende.
   */
  #deliverToBag(session: Session, items: readonly LootItem[]): void {
    const bag = this.#bag;
    const party = this.#party;
    if (bag === null || party === undefined) return;
    // A capacidade DISPONÍVEL é lida uma vez por abate: itens de um mesmo drop só aumentam
    // `#bagWeight`, então o teto não muda no meio do laço.
    const totalAvailable = this.#availableCapacities(session)
      .reduce((sum, m) => sum + m.available, 0);
    // Elegibilidade da bolsa (D4/§16.1): TODOS os presentes no instante do abate — o mesmo
    // conjunto que paga o rateio, não o `eligible` (vivo + stamina) que decide XP.
    const presentAtDrop = session.participants.map((p) => p.id);
    const effectiveAutoSell = this.#effectiveAutoSell();

    for (const rolled of items) {
      const definition = this.#options.items.get(rolled.itemId);
      if (definition === undefined) continue;

      // Filtro de coleta (§7, D2), DEPOIS de `rollLoot` — zero RNG a mais (FUN-63). Fora da
      // lista, o item não existe para a party: sem `itemsLooted`, sem caixa de ninguém.
      if (party.collect !== null && !party.collect.includes(rolled.itemId)) {
        continue;
      }

      // Venda automática (§8, D2): subconjunto lógico da coleta — nunca pesa, nunca entra na
      // bolsa. `value: 0` na lista é ignorado aqui como defesa (configureParty já recusa
      // configurar assim; isto cobre conteúdo que mudou de valor sob uma sessão em voo).
      if (effectiveAutoSell.has(rolled.itemId) && definition.value > 0) {
        const amount = definition.value * rolled.quantity;
        const split = splitEqually(amount, presentAtDrop.length);
        const shares = presentAtDrop.map((characterId, i) => ({ characterId, gold: split[i] ?? 0 }));
        for (const { characterId, gold } of shares) {
          if (gold === 0) continue;
          const member = findById(session.participants, characterId);
          if (member === null) continue;
          member.goldDelta += gold;
          session.credit(member.id, 'goldGained', gold);
        }
        for (const p of session.participants) session.credit(p.id, 'itemsLooted', rolled.quantity);
        // Venda automática NÃO é evento notável (D2): a lista curta da tela de retorno não leva
        // uma linha por dragon ham — só `party-settlement` de saída/fim/toggle entra ali.
        session.emit({
          kind: 'party-settlement', total: amount, reason: 'auto-sell', itemId: rolled.itemId, shares,
        });
        continue;
      }

      const weight = definition.weight * rolled.quantity;
      // OVERWEIGHT (§14): item com peso que não cabe não é coletado — fica no cadáver, sem
      // virar instância, sem contar `itemsLooted`, sem caixa de ninguém. Peso `0` sempre passa.
      if (weight > 0 && this.#bagWeight + weight > totalAvailable) continue;

      const carried: CarriedItem = {
        instanceId: `${session.id}:bag:${String(this.#bagSeq++)}`,
        itemId: rolled.itemId, quantity: rolled.quantity,
      };
      bag.items.push({ item: carried, eligible: presentAtDrop });
      this.#bagWeight += weight;
      for (const p of session.participants) session.credit(p.id, 'itemsLooted', carried.quantity);
    }
    // `#rebalanceBag` é o ÚNICO emissor de `party-bag-changed` (DT-03) e roda mesmo com `items`
    // vazio, porque um drop só de gold muda o `value` da bolsa.
    this.#rebalanceBag(session);
  }

  /** A capacidade DISPONÍVEL de cada presente: `max(0, capacity − inventory.weight)` (§12, D4). */
  #availableCapacities(session: Session): MemberCapacity[] {
    return session.participants.map((p) => ({
      id: p.id,
      available: Math.max(0, p.capacity - p.inventory.weight(this.#options.items)),
    }));
  }

  /**
   * O ÚNICO ponto que recalcula disponível/reservas/OVERWEIGHT e emite `party-bag-changed`
   * (§11-§15, #396). Chamado só nos gatilhos do §13: `onEnter`, `onLeave` (via `#settle`),
   * `#deliverToBag`, `#deliverLoot`, level up que reescreve `capacity`, `#settle`, autovenda
   * (dentro de `#deliverToBag`) e `configureParty`. NUNCA por tick — é o que faz 1 Hz e 10 Hz
   * rebalancearem no mesmo evento lógico, não no mesmo instante de relógio (invariante 2).
   */
  #rebalanceBag(session: Session): void {
    const bag = this.#bag;
    if (bag === null) return;
    const members = this.#availableCapacities(session);
    const totalAvailable = members.reduce((sum, m) => sum + m.available, 0);
    const reservedById = reserveProportionally(this.#bagWeight, members);
    const reservations = members.map((m) => ({
      characterId: m.id, reserved: reservedById.get(m.id) ?? 0, available: m.available,
    }));
    // OVERWEIGHT: a bolsa está CHEIA — não há mais espaço para item com peso. O ADR escreve
    // `W > ΣB`, mas como só se adiciona o que cabe, `W` nunca ultrapassa `ΣB` por drop; a
    // igualdade é o estado de "cheio" do plano §3 (bolsa 1 500 com disponível 1 500), e é o que
    // o gatilho de recusa enxerga. Bolsa vazia (peso 0) NUNCA é OVERWEIGHT, mesmo com ΣB = 0.
    const overweight = this.#bagWeight > 0 && this.#bagWeight >= totalAvailable;
    // Uma linha por TRANSIÇÃO: comparar com o valor JÁ PERSISTIDO em `bag.overweight` é o que
    // evita um `party-overweight` falso logo depois de um `onResume` (DT-02/§7).
    if (overweight !== bag.overweight) {
      session.record('party-overweight', overweight ? 'on' : 'off');
    }
    bag.overweight = overweight;
    bag.capacity = totalAvailable;
    this.#emitBag(session, reservations);
  }

  #emitBag(session: Session, reservations: PartyBagChanged['reservations'] = []): void {
    const bag = this.#bag;
    if (bag === null) return;
    session.emit({
      kind: 'party-bag-changed',
      gold: bag.gold.reduce((sum, entry) => sum + entry.amount, 0),
      items: bag.items.map((entry) => entry.item),
      weight: this.#bagWeight, capacity: bag.capacity,
      value: bagValue(bag, this.#options.items),
      overweight: bag.overweight,
      reservations,
    });
  }

  /**
   * Vende a bolsa ENTRADA por entrada (#192, ADR 0027 decisão 5; #395, D4/D6): ao sair alguém
   * — com quem sai incluído —, no fim, e ao desligar `splitLoot`. Cada entrada é dividida só
   * entre `eligible ∩ present`; cada um recebe a cota em `goldDelta` e `goldGained`; o resto vai
   * um gold por membro na ordem de entrada. O que não se vende (`value: 0`) vai para a mochila
   * do líder — peso ignorado (`forceAdd`, ADR 0048 decisão 7: sem cadáver de monstro à mão para
   * segurar o excedente, e o item já não pôde virar gold). Registrado no extrato — "vendeu
   * nada" também é informação.
   */
  #settle(
    session: Session, present: readonly CharacterRuntime[], reason: 'leave' | 'end' | 'toggle',
  ): void {
    const bag = this.#bag;
    if (bag === null || present.length === 0) return;
    if (bag.gold.length === 0 && bag.items.length === 0) {
      // Nada a vender, mas a composição pode ter mudado (saída): rebalanceia mesmo assim.
      this.#rebalanceBag(session);
      return;
    }
    const { shares, unsold, total } = settleEntries(bag, present.map((p) => p.id), this.#options.items);
    for (const member of present) {
      const gold = shares.get(member.id) ?? 0;
      if (gold === 0) continue;
      member.goldDelta += gold;
      session.credit(member.id, 'goldGained', gold);
    }
    // A bolsa foi VENDIDA: a reserva que ela impunha à mochila cai junto, ANTES de devolver o
    // que não vendeu. Senão a própria reserva recusaria o item que a bolsa guardava — o líder
    // recebe os `unsold` com a capacidade cheia (RF-05: "settlement libera a reserva").
    bag.gold = [];
    bag.items.length = 0;
    this.#bagWeight = 0;
    const leader = this.#leader(session) ?? present[0];
    if (leader !== undefined) {
      for (const item of unsold) {
        leader.inventory.forceAdd(item, this.#options.items, this.#containerRules(leader));
      }
    }
    session.record('party-settlement', `${String(total)}/${String(present.length)}`);
    session.emit({
      kind: 'party-settlement', total, reason,
      shares: present.map((p) => ({ characterId: p.id, gold: shares.get(p.id) ?? 0 })),
    });
    this.#rebalanceBag(session);
  }

  /**
   * Quem recebe o loot de um abate (#191, ADR 0027 decisão 5).
   *
   * Solo — ou party que virou solo —: o matador, e NENHUM sorteio. Um `rng` a mais aqui
   * mudaria a sequência de loot de toda hunt existente (FUN-63), e o teste que grava a
   * sequência é o que prende. Party `split` com ≥ 2: um elegível sorteado, uniforme, ANTES de
   * `rollLoot` — os modificadores (Prey, quando existir) são do destinatário e mudam a tabela
   * rolada. Party `shared`: ninguém; o loot vai para a bolsa (#192).
   */
  #lootRecipient(
    session: Session, killer: CharacterRuntime | null, eligible: readonly CharacterRuntime[],
  ): CharacterRuntime | null {
    if (this.#party === undefined || session.participants.length < 2) {
      return killer !== null && killer.alive && !isExhausted(killer) ? killer : null;
    }
    if (this.#party.splitLoot) return null;
    if (eligible.length === 0) return null;
    return eligible[session.rng.integer(0, eligible.length - 1)] ?? null;
  }

  /**
   * A tabela de loot COMO o destinatário a vê. Identidade hoje: não há modificador de loot
   * por personagem — o Prey (§19) é quem vai mexer aqui, e o gancho existe para ele entrar
   * DEPOIS do sorteio do destinatário, e não antes.
   */
  #lootTableFor(definition: Monster, _recipient: CharacterRuntime): Monster['loot'] {
    return definition.loot;
  }

  /**
   * O charm Gut de quem é DONO do cadáver (#603): o Canary gera o loot uma vez, com o Gut de
   * `Player(corpse:getCorpseOwner())` — e o dono é quem causou MAIS dano (`Monster::getCorpse`,
   * `setAttribute(CORPSEOWNER, mostDamageCreature)`), não o destinatário do loot nem quem deu o
   * último golpe. `undefined` sem o charm para este monstro: o sorteio é o de sempre.
   */
  #gutOf(session: Session, monster: MonsterRuntime, credit: KillCredit): LootGut | undefined {
    if (!this.#charmStage()) return undefined;
    const owner = findById(session.participants, credit.mostDamageBy);
    if (owner === null) return undefined;
    const assigned = this.#charmsAgainst(owner, monster.monsterId);
    const gut = assigned === undefined ? undefined : findAssigned(assigned, 'gut');
    if (gut === undefined) return undefined;
    return {
      percent: charmChance(gut),
      isProduct: (itemId) => this.#options.items.get(itemId)?.creatureProduct === true,
    };
  }

  /**
   * O sorteio de loot deste monstro — com o roll extra da Boosted Creature do dia (#615, ADR
   * 0054 decisão 7, `ondroploot_boosted.lua`, `factor 1.0`): a mesma tabela sorteada DE NOVO,
   * logo depois do sorteio normal, na mesma ordem (gold → itens na ordem da tabela) — nunca
   * antes, e nunca misturado no meio, porque a ORDEM do RNG é contrato (FUN-63) e o roll extra
   * não pode deslocar a sequência de quem não encontra a boosted. `factor 1.0` — e não um fator
   * maior — é por quê o roll extra é uma tabela INTEIRA a mais, não uma chance melhorada na
   * mesma tabela: dobra a EXPECTATIVA de drop, não a chance de cada linha.
   */
  #rollLootFor(monster: MonsterRuntime, table: Monster['loot'], rng: Rng, gut?: LootGut): LootResult {
    // O Gut (#603) só entra no sorteio NORMAL: o roll extra da boosted (`ondroploot_boosted.lua`)
    // passa `gut = false`.
    const first = rollLoot(table, rng, this.#options.progression.rates.loot, gut);
    if (monster.monsterId !== this.#options.boostedMonsterId) return first;
    const second = rollLoot(table, rng, this.#options.progression.rates.loot);
    return {
      gold: first.gold + second.gold,
      items: second.items.length === 0 ? first.items : [...first.items, ...second.items],
      supplies: second.supplies.length === 0 ? first.supplies : [...first.supplies, ...second.supplies],
      ammunition: second.ammunition.length === 0
        ? first.ammunition
        : [...first.ammunition, ...second.ammunition],
    };
  }

  /**
   * Materializa o loot sorteado em itens do CADÁVER, com `instanceId` DETERMINÍSTICO (ADR 0048
   * decisão 1/5) — o id é gasto AQUI, mesmo que o item nunca seja coletado e apodreça com o
   * cadáver: a idempotência do invariante 10 vem da identidade previsível, não da contagem
   * contígua. Ver a versão anterior a este ADR (`#deliverLoot`) para o mesmo argumento sobre o
   * catálogo ser conferido antes de gastar o id.
   */
  #instantiateCorpseItems(
    session: Session, recipient: CharacterRuntime, items: readonly LootItem[],
  ): CarriedItem[] {
    const carried: CarriedItem[] = [];
    for (const rolled of items) {
      if (this.#options.items.get(rolled.itemId) === undefined) continue;
      // Em party (#191) o id leva o dono no meio — dois membros com `lootSeq` 0 colidiriam; em
      // solo o formato é o de sempre. O critério é o TIPO de sessão (DT-03, #397), não a
      // contagem de presentes.
      const instanceId = this.#party !== undefined
        ? `${session.id}:${recipient.id}:${String(recipient.lootSeq++)}`
        : `${session.id}:${String(recipient.lootSeq++)}`;
      carried.push({ instanceId, itemId: rolled.itemId, quantity: rolled.quantity });
    }
    return carried;
  }

  /**
   * O limite de autovenda INDIVIDUAL (ADR 0048 decisão 2, PRD §22.1): o mesmo
   * `party.autoSellItemTypes` da autovenda de party, mas lido pelo PRÓPRIO Premium do
   * personagem — fora de party, `#options.premium` é quem diz (o mesmo fallback de
   * `#onCharacterDied` para a penalidade de morte, D3).
   */
  #individualAutoSellLimit(characterId: string): number {
    const premium = this.#party?.premiumByCharacter[characterId] ?? this.#options.premium ?? false;
    return autoSellLimit({ [characterId]: premium }, characterId, this.#options.party.autoSellItemTypes);
  }

  /**
   * O dono coleta do cadáver o que o filtro de Quick Loot aceita e cabe (ADR 0048 decisão 3): o
   * `autoLoot` do Canary, sem trava de Premium (invariante 11) — roda no MESMO evento do abate,
   * sem plateia (invariante 3). Gold é sempre coletado (o Quick Loot do Tibia sempre leva a
   * moeda); item vendável em `loot.autoSell` vira gold na hora, cortado pelo limite do PRÓPRIO
   * Premium; o resto FICA no cadáver — filtrado ou sem capacidade, sem diferença nenhuma: as
   * duas são "não coletado" (§14 do `#deliverToBag` de antes já tratava OVERWEIGHT assim).
   *
   * `itemsLooted` conta só o que ENTROU na mochila ou foi vendido (decisão 5) — o que ficou no
   * cadáver não é loot "levado" ainda, mesmo já tendo saído do sorteio.
   */
  #collectFromCorpse(session: Session, corpse: CorpseState, character: CharacterRuntime): void {
    if ((corpse.gold ?? 0) > 0) {
      const gold = corpse.gold ?? 0;
      character.goldDelta += gold;
      session.credit(character.id, 'goldGained', gold);
      corpse.gold = 0;
    }
    const items = corpse.items ?? [];
    if (items.length === 0) return;
    corpse.items = this.#collectItems(session, character, items);
    // Gatilho do §13: o loot pessoal mudou o peso da mochila, e com ele a capacidade disponível
    // e as reservas da party. No-op quando não há bolsa, que é o caso comum.
    this.#rebalanceBag(session);
  }

  /**
   * O miolo do Quick Loot (ADR 0048 decisão 3): aplica o filtro, a autovenda e a capacidade de
   * `character` a `items` e devolve o que FICOU — o que o filtro recusou e o que não coube. É a
   * parte de `#collectFromCorpse` que também serve a esfola à mão (#626), onde só o material
   * novo passa pelo filtro, sem reprocessar o que já esperava no cadáver.
   */
  #collectItems(
    session: Session, character: CharacterRuntime, items: readonly CarriedItem[],
  ): CarriedItem[] {
    const filter = this.#runnerOf(character.id).botConfig?.loot ?? DEFAULT_LOOT_FILTER;
    const autoSellIds = new Set(filter.autoSell.slice(0, this.#individualAutoSellLimit(character.id)));
    // A capacidade já descontada da reserva que a party fez dele (§11, DT-05) — como
    // `#deliverLoot` fazia antes deste ADR; `reserved` é 0 fora do modo bolsa.
    const reserved = this.#bag === null
      ? 0
      : (reserveProportionally(this.#bagWeight, this.#availableCapacities(session)).get(character.id) ?? 0);
    const wearer = withReservedCapacity(character, reserved);

    const remaining: CarriedItem[] = [];
    for (const item of items) {
      const accepted = filter.filter === 'accept'
        ? filter.itemIds.includes(item.itemId)
        : !filter.itemIds.includes(item.itemId);
      if (!accepted) { remaining.push(item); continue; }

      const definition = this.#options.items.get(item.itemId);
      if (definition !== undefined && autoSellIds.has(item.itemId) && definition.value > 0) {
        const amount = definition.value * item.quantity;
        character.goldDelta += amount;
        session.credit(character.id, 'goldGained', amount);
        session.credit(character.id, 'itemsLooted', item.quantity);
        continue;
      }

      if (character.inventory.add(item, this.#options.items, wearer, this.#containerRules(character)).ok) {
        session.credit(character.id, 'itemsLooted', item.quantity);
        continue;
      }

      // Não coube: fica no cadáver — a segunda chance é ELE, não uma caixa da sessão (ADR 0048
      // decisão 7). O aviso é o mesmo de sempre, uma linha por sessão.
      remaining.push(item);
      const runner = this.#runnerOf(character.id);
      if (runner.warnedFullBackpack) continue;
      runner.warnedFullBackpack = true;
      session.record('backpack-full', character.id);
    }
    return remaining;
  }

  // --- Esfola de cadáver (#626, M44-08, ADR 0048 d.5/d.6, ADR 0053 d.5) -----------------------
  //
  // A matemática é `skinning.ts` (a janela por estágio, a chance, o Scavenge); aqui ficam o
  // QUANDO e o PARA ONDE. Só o `combat-v4` esfola (`hasSkinningStage`): uma sessão fixada em
  // `combat-v3` não reconhece ferramenta nenhuma (invariante 7). O bot esfola NO ABATE, dentro do
  // mesmo evento que coleta o loot (`#onMonsterDied`), e o jogador presente esfola à mão com o
  // `use-item-on` da ferramenta no tile do cadáver (`#performSkin`) — as duas rodam o MESMO
  // sorteio (`#rollSkin`), e as duas só o consomem com ferramenta e monstro esfolável, que é o
  // que faz uma hunt sem faca gastar exatamente o `session.rng` de antes.

  /**
   * A esfola do bot no abate: o primeiro candidato com a ferramenta do monstro na mochila esfola,
   * com a idade zero do cadáver (a janela abre no primeiro estágio). `afterTtlMs` presente diz que
   * houve sorteio — o cadáver nasce `skinned` e com a vida do `after` — e `material` é o que o
   * sorteio rendeu.
   */
  #skinAtDeath(
    session: Session, monster: MonsterRuntime, candidates: readonly CharacterRuntime[],
  ): SkinAtDeath {
    const entry = this.#options.skinning?.get(monster.monsterId);
    if (entry === undefined || !hasSkinningStage(this.#options.combat.compatibilityProfile)) return NO_SKIN;
    const stage = skinningStageAt(entry, 0);
    if (stage === null) return NO_SKIN;
    for (const candidate of candidates) {
      if (candidate.inventory.findStack(entry.toolId) === null) continue;
      return { material: this.#rollSkin(session, candidate, entry, stage), afterTtlMs: stage.afterTtlMs };
    }
    return NO_SKIN;
  }

  /**
   * O sorteio da esfola de `skinner` (UMA rolagem de `session.rng`): o `chanceRange` do Canary,
   * encolhido pelo Scavenge dele quando o charm vale para o estágio em que o cadáver está agora
   * (`scavengeChanceFor`). `null` é a tentativa que falhou.
   */
  #rollSkin(
    session: Session, skinner: CharacterRuntime, entry: Skinning, stage: Skinning['stages'][number],
  ): LootItem | null {
    const assignedTo = skinner.charms.assignmentOf(SCAVENGE_CHARM_ID);
    const scavenge = assignedTo === undefined
      ? undefined
      : scavengeChanceFor(
        this.#options.charms?.get(SCAVENGE_CHARM_ID), skinner.charms.tierOf(SCAVENGE_CHARM_ID),
        this.#options.skinning?.get(assignedTo), stage,
      );
    return rollSkinning(session.rng, entry, skinningChanceRange(scavenge))
      ? { itemId: entry.materialId, quantity: 1 }
      : null;
  }

  /**
   * O cadáver que a ferramenta encontra num tile: o do TOPO da pilha — o Canary usa o
   * `getTopDownItem` do tile, e o cadáver mais novo entra por cima. `undefined` sem cadáver ali.
   */
  #topCorpseAt(position: FloorPoint): CorpseState | undefined {
    for (let i = this.#corpses.length - 1; i >= 0; i -= 1) {
      const corpse = this.#corpses[i] as CorpseState;
      if (corpse.position.x === position.x && corpse.position.y === position.y
        && sameFloor(position.z, corpse.position.z)) {
        return corpse;
      }
    }
    return undefined;
  }

  /**
   * A esfola à mão (`use-item-on` da ferramenta com o TILE do cadáver por alvo — ADR 0049
   * decisão 3): confere alcance (o `Actions::canUse` do Canary — mesmo andar e adjacente,
   * `|dx| <= 1` e `|dy| <= 1`, SEM linha de visão: o `skinning.lua` não chama `allowFarUse`, então o
   * `canUseFar` 7×5 das runas não vale aqui, e o jogador longe é recusado e andado até o cadáver),
   * que a ferramenta é a do monstro, que o cadáver não foi esfolado e que a janela do estágio
   * ainda está aberta; sorteia; e o material passa pelo filtro de Quick Loot de quem esfolou —
   * o que não é aceito, ou não cabe, fica no cadáver, como o resto do loot.
   *
   * Tudo que o Canary responde com "not possible" (sem cadáver, ferramenta errada, já esfolado,
   * estágio fora da janela) é `not-usable`; o alcance é `out-of-range`. A tentativa gasta o
   * cadáver — `skinned` — com ou sem sucesso, REINICIA o decaimento dele (`#retimeCorpse`) e
   * nenhuma recusa consome sorteio.
   */
  #performSkin(
    session: Session, character: CharacterRuntime, tool: CarriedItem, target: UseSlotTarget | undefined,
  ): UseItemOutcome {
    if (!hasSkinningStage(this.#options.combat.compatibilityProfile)) return refuseItem('not-usable', 0);
    if (target === undefined || target.kind !== 'position') return refuseItem('not-usable', 0);
    const corpse = this.#topCorpseAt(target.position);
    if (corpse === undefined) return refuseItem('not-usable', 0);

    // O `canUse` do Canary (`Actions::canUse`): mesmo andar e `areInRange<1, 1>`, sem linha de
    // visão — a mesma conferência de `useOnMap` e de `open-corpse`/`take-loot`.
    const from = character.position;
    if (!sameFloor(from.z, corpse.position.z)
      || Math.abs(from.x - corpse.position.x) > 1
      || Math.abs(from.y - corpse.position.y) > 1) {
      return refuseItem('out-of-range', 0);
    }

    const entry = this.#options.skinning?.get(corpse.monsterId);
    if (entry === undefined || entry.toolId !== tool.itemId
      || corpse.skinned === true || corpse.diedAtMs === undefined) {
      return refuseItem('not-usable', 0);
    }
    const stage = skinningStageAt(entry, session.nowMs - corpse.diedAtMs);
    if (stage === null) return refuseItem('not-usable', 0);

    corpse.skinned = true;
    // O `topItem:transform(skin.after)` do Canary roda com sucesso ou sem, e o `Item::setID` do
    // item novo reinicia o decaimento: o cadáver passa a viver a cadeia do `after` a partir de
    // AGORA, e não mais o que faltava dos 670 s.
    this.#retimeCorpse(session, corpse, stage.afterTtlMs);
    const material = this.#rollSkin(session, character, entry, stage);
    if (material !== null) {
      const left = this.#collectItems(session, character, this.#instantiateCorpseItems(session, character, [material]));
      corpse.items = [...(corpse.items ?? []), ...left];
      this.#rebalanceBag(session);
    }
    session.emit({ kind: 'equipment-changed', characterId: character.id });
    character.cooldowns.start(actionExhaustKey(), session.nowMs, MANUAL_ITEM_EXHAUST_MS);
    return { ok: true };
  }

  /**
   * Reagenda o fim de um cadáver esfolado (#626): o evento `CORPSE` que o abate marcou em
   * `corpseTtlMs` é cancelado e um novo vence `afterTtlMs` depois de agora — a vida do `after` do
   * `skinning.lua`. O que ficou no cadáver (o loot que o filtro recusou, ou que não coube) vive
   * esse prazo e some com ele, como na decisão 6 do ADR 0048: continua sendo "um número só, o do
   * Tibia", agora o do cadáver esfolado.
   */
  #retimeCorpse(session: Session, corpse: CorpseState, afterTtlMs: number): void {
    const subject = String(corpse.id);
    session.cancelEvent(CORPSE, subject);
    session.scheduleIn(CORPSE, afterTtlMs, { priority: EventPriority.Housekeeping, subject });
  }

  /** Ache o cadáver por id do item do chão (#722), ou `undefined` — já apodreceu ou nunca existiu. */
  #corpseById(groundItemId: number): CorpseState | undefined {
    return this.#corpses.find((corpse) => corpse.id === groundItemId);
  }

  /**
   * Confere se o personagem pode abrir/pegar deste cadáver (#722, ADR 0048 d.4): dono, ou
   * presente na elegibilidade do abate — o `Player::canOpenCorpse` da party, espelhado por
   * `ownerId`/`eligible` (que `#onMonsterDied` já grava, ver `CorpseState`).
   */
  #canLootCorpse(corpse: CorpseState, characterId: string): boolean {
    return corpse.ownerId === characterId || (corpse.eligible ?? []).includes(characterId);
  }

  /**
   * Abrir a janela do cadáver (#722, ADR 0048 d.4): confere dono/elegibilidade e distância
   * (≤ 1, mesmo andar — o `areInRange<1,1,0>`/`Actions::canUse` do Canary, ver §5 da spec da
   * issue) e devolve o que ainda está lá. PURA quanto a JOGO — abrir não é coletar (invariante
   * 3) — mas (RE)INICIA a janela de pausa do bot (#763, `#armManualWalkHold`), COM ou SEM
   * `walk-to` antes: achado de QA ao vivo — um cadáver já adjacente abria a janela normalmente,
   * o bot seguia andando embora sem NUNCA ter tido uma pausa armada, e o `take-loot` dois
   * segundos depois batia em `too-far-away`. Bookkeeping do `Runner`, não estado de jogo, como
   * `routeBlockedWarned` já é em outro lugar.
   */
  openCorpse(session: Session, characterId: string, groundItemId: number): OpenCorpseResult {
    const corpse = this.#corpseById(groundItemId);
    if (corpse === undefined) return { ok: false, reason: 'not-found' };
    if (!this.#canLootCorpse(corpse, characterId)) return { ok: false, reason: 'not-yours' };
    const character = findById(session.participants, characterId);
    if (character === null) return { ok: false, reason: 'not-found' };
    if (
      !sameFloor(character.position.z, corpse.position.z)
      || distance(character.position, corpse.position) > 1
    ) {
      return { ok: false, reason: 'too-far-away' };
    }
    this.#armManualWalkHold(characterId, session.nowMs);
    return { ok: true, corpse };
  }

  /**
   * Pegar do cadáver o que sobrou do Quick Loot automático do abate (#722, ADR 0048 d.4).
   *
   * `instanceId: null` é o CLIQUE do Tibia: reaplica o MESMO filtro de Quick Loot do
   * personagem (`#collectFromCorpse`, que já credita ouro e autovenda) a tudo que ainda está
   * no cadáver — idempotente quando não sobrou nada. Um `instanceId` é arrastar ESTE item
   * específico da janela, IGNORANDO o filtro — o "segunda chance" do Canary; ouro não é
   * tocado nesse ramo, porque ouro não tem `instanceId` para arrastar (o clique já o cobre).
   */
  takeLoot(
    session: Session, characterId: string, groundItemId: number, instanceId: string | null,
  ): TakeLootResult {
    const corpse = this.#corpseById(groundItemId);
    if (corpse === undefined) return { ok: false, reason: 'not-found' };
    if (!this.#canLootCorpse(corpse, characterId)) return { ok: false, reason: 'not-yours' };
    const character = findById(session.participants, characterId);
    if (character === null) return { ok: false, reason: 'not-found' };
    if (
      !sameFloor(character.position.z, corpse.position.z)
      || distance(character.position, corpse.position) > 1
    ) {
      return { ok: false, reason: 'too-far-away' };
    }
    this.#armManualWalkHold(characterId, session.nowMs);

    if (instanceId === null) {
      this.#collectFromCorpse(session, corpse, character);
      return { ok: true };
    }

    const items = corpse.items ?? [];
    const index = items.findIndex((item) => item.instanceId === instanceId);
    if (index === -1) return { ok: false, reason: 'not-found' };
    const item = items[index];
    if (item === undefined) return { ok: false, reason: 'not-found' };

    // A mesma reserva de capacidade que `#collectFromCorpse` usa (§11, DT-05) — `reserved` é 0
    // fora do modo bolsa.
    const reserved = this.#bag === null
      ? 0
      : (reserveProportionally(this.#bagWeight, this.#availableCapacities(session)).get(character.id) ?? 0);
    const wearer = withReservedCapacity(character, reserved);
    const result = character.inventory.add(item, this.#options.items, wearer, this.#containerRules(character));
    if (!result.ok) return { ok: false, reason: 'not-enough-capacity' };

    session.credit(character.id, 'itemsLooted', item.quantity);
    corpse.items = items.filter((_, i) => i !== index);
    this.#rebalanceBag(session);
    return { ok: true };
  }

  /**
   * Credita o ESTOQUE de supply do loot (#520) a quem recebeu o drop — ver `#creditStock`.
   * Supply é ABSTRATO (AB-01, ADR 0032 d.6): sem peso, sem instância, sem OVERWEIGHT — o
   * estoque É o destino final, e não passa pela bolsa nem pelo `#settle` como item.
   */
  #creditSupplies(
    session: Session, recipients: readonly CharacterRuntime[], supplies: readonly LootSupply[],
  ): void {
    this.#creditStock(
      session, recipients, supplies,
      (line) => line.supplyId,
      (id) => this.#options.supplies.get(id) !== undefined,
      (member) => member.supplyStock,
    );
  }

  /**
   * Credita o ESTOQUE de munição FÍSICA do loot (#520, revisão do #536) — a mesma mecânica e a
   * mesma razão do `#creditSupplies`: munição continua abstrata no TIRO (ADR 0026 d.7), mas o
   * que caiu em loot (Burst Arrow, Power Bolt) precisa existir como estoque para ser gasto
   * antes do gold (`#ammoFor`/`#strike`).
   */
  #creditAmmunition(
    session: Session, recipients: readonly CharacterRuntime[], ammunition: readonly LootAmmunition[],
  ): void {
    this.#creditStock(
      session, recipients, ammunition,
      (line) => line.ammunitionId,
      (id) => this.#options.ammunition.get(id) !== undefined,
      (member) => member.ammunitionStock,
    );
  }

  /**
   * O mecanismo comum de `#creditSupplies`/`#creditAmmunition` (#520): em solo/split o
   * recipiente sozinho leva tudo; em shared, dividido entre os presentes no abate.
   *
   * **O resto vai para recipientes SORTEADOS, não sempre para o primeiro da lista** (achado da
   * revisão do #536): a quantidade comum é 1 (uma Strong Health Potion para 4 presentes), e
   * `splitEqually` — certo para o rateio de GOLD em `#settle`, que soma MUITOS drops numa bolsa
   * antes de dividir UMA vez — sempre manda o resto para o índice 0. Aplicado abate a abate,
   * isso credita a MESMA pessoa toda vez. Aqui o resto é sorteado sem reposição (embaralhamento
   * parcial de Fisher-Yates) com o `Rng` da sessão — o mesmo sorteio que `#lootRecipient` já usa
   * para o destinatário em modo `split` —, e ao longo de muitos abates cada presente recebe a
   * unidade extra proporcionalmente.
   *
   * O catálogo é conferido ANTES de gastar um id, como `#deliverLoot` faz com item:
   * `buildContent` recusa loot de supply/munição inexistente no boot, e isto só dispara com
   * conteúdo mudando sob uma sessão em voo.
   */
  #creditStock<T extends { readonly quantity: number }>(
    session: Session, recipients: readonly CharacterRuntime[], rolled: readonly T[],
    idOf: (line: T) => string, existsInCatalog: (id: string) => boolean,
    stockOf: (member: CharacterRuntime) => Map<string, number>,
  ): void {
    if (recipients.length === 0 || rolled.length === 0) return;
    for (const line of rolled) {
      const id = idOf(line);
      if (!existsInCatalog(id)) continue;
      const base = Math.floor(line.quantity / recipients.length);
      const remainder = line.quantity - base * recipients.length;
      const shares = new Array<number>(recipients.length).fill(base);
      // Fisher-Yates parcial: sorteia `remainder` índices DISTINTOS entre os `recipients.length`
      // presentes, um a um, sem reposição — cada um consome exatamente uma rolagem do Rng.
      const order = recipients.map((_, i) => i);
      for (let i = 0; i < remainder; i += 1) {
        const pick = session.rng.integer(i, order.length - 1);
        const chosen = order[pick] as number;
        order[pick] = order[i] as number;
        order[i] = chosen;
        shares[chosen] = (shares[chosen] ?? 0) + 1;
      }
      for (let i = 0; i < recipients.length; i += 1) {
        const share = shares[i] ?? 0;
        if (share === 0) continue;
        const member = recipients[i] as CharacterRuntime;
        const stock = stockOf(member);
        stock.set(id, (stock.get(id) ?? 0) + share);
        // Conta no ANALISADOR como o item (§16.1): caiu, e é isso que importa para "quantos
        // itens caíram" — não há um agregado separado só para supply/munição.
        session.credit(member.id, 'itemsLooted', share);
      }
    }
  }

  /** Os tamanhos de container deste personagem (#160): a mochila que ele veste, e a tabela. */
  #containerRules(character: CharacterRuntime): ContainerRules {
    return containerRulesFor(character.inventory, this.#options.items, this.#options.progression);
  }

  #vocationOf(character: CharacterRuntime): Vocation | null {
    if (character.vocationId === null) return null;
    // Vocação que saiu do conteúdo cai para a tabela base em vez de derrubar a hunt: perder
    // stats é ruim, perder a sessão inteira de quem estava caçando é pior.
    return this.#options.vocations.get(character.vocationId) ?? null;
  }

  /**
   * O nível desta skill COM o bônus de Loyalty (#628, ADR 0052 d.5) — o `Player::getLoyaltySkill`
   * que `getSkillLevel` do Canary usa no lugar do nível base, e o `getLoyaltyMagicLevel` que
   * `getMagicLevel` usa para o magic level. É o nível que ESCALA o golpe, a magia, a defesa e a
   * cura e que confere requisito de runa; as leituras que não são "uso da skill" — ganhar tries,
   * o estágio de rate (`getBaseMagicLevel`), a penalidade de morte — continuam no nível BASE
   * (`skills.levelOf`), como no Canary.
   *
   * Sem bônus (o normal: menos de 360 dias de conta), é o nível base direto — sem achar a
   * vocação nem calcular fator nenhum.
   */
  #loyaltyLevelOf(character: CharacterRuntime, definition: Skill): number {
    if (character.loyaltyBonusPercent === 0) return character.skills.levelOf(definition);
    return character.loyaltyLevelOf(
      definition, skillFactorFor(definition, this.#vocationOf(character), this.#options.progression),
    );
  }

  /**
   * O magic level EFETIVO (`Player::getMagicLevel` do Canary): o do Loyalty (#628) mais o bônus
   * de equipamento (#524) e o de condição (#576) — as três fontes somam, como somam no dano da
   * runa e na cura da poção. É o número que a fórmula de magia lê e o que o requisito de
   * `magicLevel` de uma runa confere; `#runeScaling`, `#spellScaling` e o espelho de
   * `slotStates` leem DESTE ponto só, para o "bloqueada" da tela nunca discordar do disparo.
   */
  #magicLevelOf(character: CharacterRuntime): number {
    const magic = this.#options.skills.get('magic');
    return (magic === undefined ? 0 : this.#loyaltyLevelOf(character, magic))
      + character.inventory.skillBonus(this.#options.items, 'magic')
      + character.conditions.skillBonus('magic');
  }

  /**
   * A regeneração passiva DESTE personagem (#521, ADR 0037): a da vocação escolhida, ou a da
   * tabela base (sem vocação — Canary `vocations.xml`, id 0 "None") para quem ainda não tem
   * uma. Cada vocação regenera num ritmo diferente no Tibia; antes da #521 era um número só
   * para todo mundo. Em pulsos desde #678.
   *
   * Promovido (#566, ADR 0042 decisão 1) lê o bloco `promotion.regen` da vocação quando ele
   * existe — `vocations.xml` ids 5-8 regeneram mais rápido que as bases 1-4. Ausente o bloco
   * (conteúdo de teste sem promoção), degrada para o `regen` normal, mesmo com `promoted: true`.
   */
  #regenOf(character: CharacterRuntime): Regen {
    const vocation = this.#vocationOf(character);
    if (character.promoted && vocation?.promotion?.regen !== undefined) return vocation.promotion.regen;
    return vocation?.regen ?? this.#options.progression.regen;
  }

  /**
   * A defesa do personagem: a armadura do CONTEÚDO mais a do que ele veste (FUN-82).
   *
   * Soma, e não substituição: `combat.player.armor` é a resistência do corpo, e a peça vestida
   * acrescenta. Substituir faria vestir a primeira armadura deixar o personagem mais frágil se
   * ela valesse menos que o número base.
   *
   * Recebe o personagem porque a armadura passou a depender de quem é — antes era constante. E
   * a `session` (o relógio lógico e a fila) porque, no `combat-v3`, a defesa da postura ofensiva
   * e balanceada depende de o personagem ter batido há pouco (M30-03, #550) — e o empate exato
   * da janela olha se o golpe dele está agendado para este ms (ver `attackedRecently`).
   */
  #playerDefender(character: CharacterRuntime, session: Session): Defender {
    // A resistência e a imunidade do EQUIPAMENTO (CMB-03), compiladas na hora do golpe a
    // partir dos poucos slots vestidos — não é varredura de tabela de resistência. `combat-v1`/
    // `v2` a usam inteira; o `combat-v3` (#552) tira dela a resistência, que vira `absorb`.
    const mitigation = character.inventory.mitigation(this.#options.items);
    const blockCharge = character.blockCharge;

    if (this.#isV3()) {
      // A fórmula REAL do jogador do 13.x (#549, M30-02) — `playerDefense`/`playerArmor`/
      // `playerMitigation` (`combat/player-defense.ts`) substituem, só aqui, os números ad hoc
      // que `combat-v1`/`v2` (no `else` abaixo) continuam usando: `combat.player.armor` (uma
      // constante "personagem desarmado no level 1") e `#defenseSourceOf` (a defesa da peça
      // escalada por `powerMultiplier`, uma fórmula própria do Draconya). "O jogador defensor
      // usa os números atuais de defesa e armadura até o M30-02" (comentário do #548) — esta
      // issue É o M30-02.
      //
      // A mão e o escudo são lidos UMA VEZ e passados aos dois montadores — `weapon()`/
      // `shield()` fazem lookup no catálogo e conferem `requires`, e as três fórmulas do golpe
      // (aqui e as duas de baixo) usam o MESMO equipamento do MESMO golpe.
      const weaponItem = character.inventory.weapon(this.#options.items, character);
      const shieldItem = character.inventory.shield(this.#options.items, character);
      // A absorção e o reflexo do equipamento (#552, M30-05): a resistência do ITEM é o
      // `absorbpercent*` do Canary, aplicado item a item DEPOIS da armadura (`Player::blockHit`)
      // — por isso ela sai de `mitigation` (que fica só com as imunidades) e entra em `absorb`.
      const absorb = equipmentAbsorb(character.inventory, this.#options.items);
      const reflect = equipmentReflect(character.inventory, this.#options.items);
      return {
        armor: playerArmor(character.inventory.armor(this.#options.items)),
        dodgeChance: this.#options.player.dodgeChance,
        mitigation: immunitiesOnly(mitigation),
        ...(absorb === undefined ? {} : { absorb }),
        ...(reflect === undefined ? {} : { reflect: { reflector: 'player' as const, table: reflect } }),
        defense: {
          kind: shieldItem !== null ? 'shield' : weaponItem !== null ? 'weapon' : 'none',
          defense: this.#playerDefenseV3(character, weaponItem, shieldItem, session),
        },
        defenseMitigation: this.#playerMitigationV3(character, weaponItem, shieldItem),
        blockCharge,
      };
    }

    return {
      armor: this.#options.player.armor + character.inventory.armor(this.#options.items),
      dodgeChance: this.#options.player.dodgeChance,
      mitigation,
      // A fonte de defesa (CMB-04): escolhida pelo `Inventory` (DT-01) e escalada aqui pela
      // skill de shielding, que é do ruleset porque vive no personagem. `combat-v1`/`v2`
      // continuam com este número — só `combat-v3` (acima) muda de fórmula.
      defense: this.#defenseSourceOf(character),
      // As cargas de bloqueio do `combat-v3` (#548): ignoradas em v1/v2, mas inofensivas de
      // carregar — o personagem é dono do próprio estado (invariante 9), e `applyDamageOutcome`
      // é quem escreve de volta o que este golpe gastou.
      blockCharge,
      // A mana ATUAL (#547, M29-07 — achado da revisão do PR #648): só um `manadrain` a lê, e
      // só para capar o dreno ANTES da resistência, como o Canary faz (`Defender.mana`,
      // `damage.ts`). Sem isto, `resolveBlockHitProfile` resistiria o poder bruto inteiro e só
      // limitaria à mana no fim, dobrando o dreno contra um alvo com resistência ao tipo.
      mana: character.mana,
    };
  }

  /**
   * A skill de escudo do PERSONAGEM (#549, M30-02) — `SKILL_SHIELD` do Canary, `shielding` no
   * Draconya. Reusa `combat.defense.skillId` (CMB-04): é a MESMA skill que já escala o bloqueio
   * do `combat-v1`/`v2`, então não há por que o `combat-v3` declarar uma segunda entrada de
   * conteúdo só para o mesmo número. Sem a entrada (conteúdo de teste), zero — a mesma leitura
   * de `#defenseSourceOf`.
   */
  #shieldSkillLevelOf(character: CharacterRuntime): number {
    const skillId = this.#options.combat.defense?.skillId;
    const skill = skillId === undefined ? undefined : this.#options.skills.get(skillId);
    if (skill === undefined || skillId === undefined) return 0;
    // `getSkillLevel` do Canary soma `varSkills[skill]` (o bônus de EQUIPAMENTO) para TODA
    // skill, sem exceção para `SKILL_SHIELD` (`player.cpp:7480`) — a mesma leitura que
    // `#skillLevelOf` já faz para a skill de arma/punho. Nenhum item do catálogo declara hoje
    // um bônus de `shielding` (#549), mas a fórmula fica correta para o dia em que um declarar.
    return this.#loyaltyLevelOf(character, skill)
      + character.inventory.skillBonus(this.#options.items, skillId);
  }

  /**
   * A mitigação da vocação (#549, M30-02) — a da vocação escolhida, ou a da tabela base (sem
   * vocação, Canary `vocations.xml` id 0 "None") para quem ainda não tem uma. A mesma forma de
   * `#regenOf`, para o mesmo motivo: cada vocação tem os próprios `multiplier`/`primaryShield`/
   * `secondaryShield`, e quem não escolheu ainda usa o número base.
   */
  #mitigationVocationOf(character: CharacterRuntime): PlayerMitigationVocation {
    return this.#vocationOf(character)?.mitigation ?? this.#options.progression.mitigation;
  }

  /**
   * `playerDefense` (#549, M30-02; `combat/player-defense.ts`) montada com o que o personagem
   * tem na mão e no escudo (já resolvidos por `#playerDefender`, um lookup só por golpe) — a
   * arma primeiro (sobrescreve o punho), o escudo por cima (sobrescreve a arma), exatamente a
   * ordem sequencial do `Player::getDefense` do Canary.
   *
   * A skill da arma NÃO é `#skillLevelOf` direto quando a família é `wand` (achado de revisão,
   * #549): `Player::getWeaponSkill` do Canary só reconhece FIST/SWORD/CLUB/AXE/MISSILE/DISTANCE
   * (`player.cpp:474-509`) — `WEAPON_WAND` cai no `default: attackSkill = 0`. `#skillLevelOf`
   * devolveria a skill de MAGIA (a família `wand` aponta `skillId: 'magic'`, usado para o DANO,
   * não a defesa), que é quase sempre não-zero — e como wand/rod nunca declaram `defense`/
   * `extraDefense`, isso faria `playerDefense` pular o piso fixo (`defenseSkill === 0` → 1/2) e
   * cair na fórmula cheia com `defenseValue` zerado, sempre 0. Zerar aqui reproduz o `default`
   * do Canary e devolve o piso correto para um Sorcerer/Druid sem escudo.
   */
  #playerDefenseV3(
    character: CharacterRuntime, weaponItem: Item | null, shieldItem: Item | null, session: Session,
  ): number {
    const fistFamily = this.#options.weaponFamilies.get('fist');
    const weaponFamily = weaponItem?.weapon?.family === undefined
      ? undefined
      : this.#options.weaponFamilies.get(weaponItem.weapon.family);
    return playerDefense({
      ...(weaponItem === null ? {} : {
        weapon: {
          defense: weaponItem.defense,
          extraDefense: weaponItem.extraDefense,
          skillLevel: weaponFamily?.kind === 'wand'
            ? 0
            : this.#skillLevelOf(character, weaponFamily),
        },
      }),
      ...(shieldItem === null ? {} : { shield: { defense: shieldItem.defense } }),
      fistSkillLevel: this.#skillLevelOf(character, fistFamily),
      shieldSkillLevel: this.#shieldSkillLevelOf(character),
      // A postura que o jogador escolheu (M30-03, #550) e a janela "bateu há menos de um
      // intervalo de ataque" — o `Player::getDefenseFactor(false)` do Canary, calculado contra o
      // relógio LÓGICO da sessão, nunca contra o de parede (invariante 2). No empate exato o
      // golpe do herói agendado para ESTE ms conta como já dado (`attackedRecently`): a fila é a
      // verdade única do prazo, e olhá-la só acontece nesse ms, não a cada golpe recebido.
      fightMode: character.fightMode,
      recentlyAttacked: attackedRecently(
        character.lastAttackAtMs, session.nowMs, this.#options.player.attackIntervalMs,
        () => session.dueAtOf(PLAYER_ATTACK, character.id) === session.nowMs,
      ),
    });
  }

  /**
   * `playerMitigation` (#549, M30-02; `combat/player-defense.ts`) montada com o mesmo
   * equipamento de `#playerDefenseV3`, mais o `spellbook`/`quiver` do escudo e o `twoHanded`/
   * `ammoFamily` da arma — os dois pares que só esta fórmula lê.
   */
  #playerMitigationV3(
    character: CharacterRuntime, weaponItem: Item | null, shieldItem: Item | null,
  ): number {
    return playerMitigation({
      shieldSkillLevel: this.#shieldSkillLevelOf(character),
      vocation: this.#mitigationVocationOf(character),
      ...(weaponItem === null ? {} : {
        weapon: {
          defense: weaponItem.defense,
          extraDefense: weaponItem.extraDefense,
          twoHanded: weaponItem.twoHanded,
          usesAmmo: weaponItem.weapon?.ammoFamily !== undefined,
        },
      }),
      ...(shieldItem === null ? {} : {
        shield: {
          defense: shieldItem.defense,
          rangedFocus: shieldItem.spellbook || shieldItem.quiver,
        },
      }),
      // A postura escolhida (M30-03, #550): o `fightFactor` da mitigação é ESTÁTICO — não olha o
      // relógio de ataque, diferente do da defesa acima.
      fightMode: character.fightMode,
    });
  }

  /**
   * A defesa do MONSTRO como defensor (#548, `combat-v3`): armadura, mitigação por tipo
   * (CMB-03), a defesa e a mitigação percentual novas (`Monster.defense`/`defenseMitigation`,
   * ADR 0040) e as cargas de bloqueio — o mesmo papel de `#playerDefender`, do outro lado do
   * golpe. Monstro sem definição (conteúdo apagado no meio de uma sessão viva, nunca deveria
   * acontecer) vira o neutro de sempre.
   */
  #monsterDefender(monster: MonsterRuntime): Defender {
    const definition = this.#options.monsters.get(monster.monsterId);
    return {
      armor: definition?.armor ?? 0,
      dodgeChance: 0,
      mitigation: definition?.mitigation,
      defenseMitigation: definition?.defenseMitigation,
      defense: { kind: 'monster', defense: definition?.defense ?? 0 },
      blockCharge: monster.blockCharge,
      // A cura por elemento e o reflexo do monstro (#683): ausentes no monstro que não os
      // declara — o caso comum, que não paga objeto nenhum. Só o `combat-v3` os lê.
      ...(definition?.elementHealing === undefined ? {} : { elementHealing: definition.elementHealing }),
      ...(definition?.reflect === undefined
        ? {} : { reflect: { reflector: 'monster' as const, table: definition.reflect } }),
    };
  }

  /**
   * O ATACANTE que o reflexo do monstro precisa (#683): a vida máxima do personagem (o teto de
   * 1 %) e a distância dele ao monstro. `undefined` quando o monstro não reflete nada — o intent
   * de sempre, sem objeto novo por golpe. O reflexo de monstro vale a qualquer distância; a
   * distância viaja só porque `ReflectAttacker` a exige.
   */
  #reflectAttackerFor(character: CharacterRuntime, monster: MonsterRuntime): ReflectAttacker | undefined {
    if (this.#options.monsters.get(monster.monsterId)?.reflect === undefined) return undefined;
    return { maxHealth: character.maxHealth, distance: distance(character.position, monster.position) };
  }

  /**
   * O Energy Ring no dedo (§13.9, SV-16): a segunda fonte de mana shield, resolvida pelo
   * catálogo — `CharacterRuntime` não conhece conteúdo. Entra em `applyDamageOutcome` como a
   * mesma leitura OU-lógica da condição `mana-shield`, e nunca soma com ela.
   */
  #hasEnergyShield(character: CharacterRuntime): boolean {
    return character.inventory.ringEffect(this.#options.items)?.kind === 'energy-shield';
  }

  /**
   * A fonte de defesa do personagem (CMB-04), já escalada pela skill de shielding.
   *
   * A ESCOLHA é do `Inventory` (DT-01): escudo, arma de uma mão, nenhuma — uma regra só, a
   * mesma que já recusa bow com escudo. Aqui entra o que é do ruleset: a skill que o conteúdo
   * apontou em `combat.defense.skillId` multiplica a defesa da peça, como a skill de arma
   * multiplica o ataque. Sem skill (conteúdo de teste, ou referência ausente), a peça vale o
   * que ela diz.
   */
  #defenseSourceOf(character: CharacterRuntime): DefenseSource {
    const source = character.inventory.defenseSource(this.#options.items, character);
    if (source.kind === 'none') return source;
    const skillId = this.#options.combat.defense?.skillId;
    if (skillId === undefined) return source;
    const skill = this.#options.skills.get(skillId);
    if (skill === undefined) return source;
    // O malus de condição (#576: Berserk/Bullseye tiram 10 de `shielding`) entra na MESMA skill
    // que escala a defesa — `powerMultiplier` já pisa em `Math.max(0, …)`, então o malus nunca
    // deixa o nível efetivo negativo, só encosta no piso de `startingLevel`.
    const level = this.#loyaltyLevelOf(character, skill) + character.conditions.skillBonus(skillId);
    return {
      kind: source.kind,
      defense: Math.round(source.defense * powerMultiplier(skill, level)),
    };
  }

  /**
   * Em quem bater AGORA: o alvo escolhido, se vivo e ao alcance; senão o melhor da política
   * dentro do alcance da arma (FUN-85).
   *
   * Era `#nearestMonster`, e a política era o motor. Agora ela vem da configuração — e
   * `nearest` continua sendo o padrão, então uma hunt sem bot se comporta exatamente como
   * antes. O desempate segue estável, e é `selectTarget` que o garante.
   *
   * Alvo do JOGADOR fora do alcance devolve `null` em vez de cair na política: quem mandou
   * seguir um não quer bater em outro no caminho — quem o leva até lá é `#approachTarget`, na
   * postura `follow` (ADR 0032 d.5). Alvo do AUTO-TARGET (#444) é só a mira corrente: fora do
   * alcance da arma, o golpe cai no melhor da política, e é isso que mantém o corpo a corpo
   * batendo no monstro colado enquanto a runa espera o alvo distante.
   */
  #attackTarget(character: CharacterRuntime): MonsterRuntime | null {
    // O alvo explícito (jogador ou bot, #470/#480) vem primeiro. O pinned do JOGADOR é
    // EXCLUSIVO: fora do alcance devolve `null` em vez de cair na política. O eleito pelo bot
    // NÃO é — fora do alcance ele cede para o candidato/política, e é isso que mantém o corpo
    // a corpo batendo no monstro colado enquanto o bot mira um alvo distante (#444).
    const attack = this.#attackTargetOfRunner(character);
    if (attack !== null) {
      if (distance(character.position, attack.position) <= this.#attackRangeOf(character)) {
        return attack;
      }
      if (this.#isPinned(character)) return null;
    }
    // O candidato do auto-target (#444) é só a mira corrente: fora do alcance da arma, o golpe
    // cai no melhor da política, e é isso que mantém o corpo a corpo batendo no monstro colado
    // enquanto a runa espera o alvo distante.
    const candidate = this.#botCandidateOf(character);
    if (candidate !== null
      && distance(character.position, candidate.position) <= this.#attackRangeOf(character)) {
      return candidate;
    }
    return selectTarget(
      this.#targetingOf(character), this.#hostileMonsters(), character.position, this.#attackRangeOf(character),
    );
  }

  /**
   * O monstro vivo, no MESMO andar e dentro do raio de busca; senão `null`. A VISIBILIDADE fica
   * de fora de propósito (#559): "saiu de cena" — morreu, mudou de andar, passou do raio — é o
   * que os leitores que LIMPAM o campo (`#attackTargetOfRunner`/`#botCandidateOf`) perguntam, e
   * um monstro apenas invisível NÃO saiu de cena: ele volta a ser visível por prazo ou por dano.
   * **NÃO muta.**
   */
  #inSightOf(subject: string | null, character: CharacterRuntime): MonsterRuntime | null {
    if (subject === null) return null;
    const monster = this.#monsterBySubject.get(subject);
    if (monster === undefined || !monster.alive) return null;
    // A invocação de personagem nunca é alvo de ataque de ninguém (#598) — e um monstro do Spawner
    // pode virar uma no meio da vida, pela Convince Creature (#600): quem o tinha na mira (o próprio
    // mestre, o candidato do bot, um companheiro de party) o larga na leitura seguinte.
    if (typeof monster.masterId === 'string') return null;
    // Andar diferente é tela diferente (#519): um alvo pinado antes de trocar de andar — o dele
    // ou o do personagem — não continua "na tela" só porque o (x, y) ainda está perto.
    if (!sameFloor(this.#floorOf(character), this.#floorOf(monster))) return null;
    if (distance(character.position, monster.position) > (this.#options.targetSearchRadius ?? 8)) {
      return null;
    }
    return monster;
  }

  /**
   * `#inSightOf` + a regra de visibilidade do JOGADOR. **NÃO muta** — é a leitura que
   * `selectedTargetOf` usa para a apresentação (invariante 3).
   *
   * O jogador não enxerga monstro invisível (`Player::canSeeCreature`, Canary `player.cpp:1418`:
   * só `CanSenseInvisibility`/GM vê) e `Creature::onThink` larga o alvo de ataque que ficou
   * invisível (#559). O alvo FIXADO pelo jogador segue até o think agendado
   * (`#onVisibilityThink`, `keepInvisible`) — até lá ele ainda ataca, e o golpe REVELA o
   * monstro (`#drainMonster`). O alvo ELEITO pelo bot não é devolvido: o targeting do bot é do
   * Draconya (ADR 0037 d.2) e `selectTarget` nunca escolhe um invisível.
   */
  #liveTargetOf(
    subject: string | null, character: CharacterRuntime, keepInvisible = false,
  ): MonsterRuntime | null {
    const monster = this.#inSightOf(subject, character);
    return monster !== null && monster.invisible && !keepInvisible ? null : monster;
  }

  /**
   * O alvo de ATAQUE vivo; limpa o campo se morreu ou saiu da tela. `null` se não há.
   *
   * Invisível e não fixado devolve `null` SEM limpar (#559): este leitor é alcançável da
   * apresentação (`slotStates` → `#targetInRange`), e o que chega ao snapshot não pode depender
   * de haver alguém assistindo (invariante 3). O campo do alvo eleito que fica invisível é
   * limpo NO EVENTO em que a invisibilidade começa (`#scheduleVisibilityThinks`), nunca aqui.
   */
  #attackTargetOfRunner(character: CharacterRuntime): MonsterRuntime | null {
    const runner = this.#runners.get(character.id);
    if (runner === undefined || runner.attackTarget === null) return null;
    const monster = this.#inSightOf(runner.attackTarget, character);
    if (monster === null) {
      runner.attackTarget = null;
      runner.attackTargetPinned = false;
      return null;
    }
    return monster.invisible && !runner.attackTargetPinned ? null : monster;
  }

  /**
   * O candidato do AUTO-TARGET vivo; limpa o campo se morreu ou saiu da tela. O mesmo contrato de
   * `#attackTargetOfRunner` para o invisível: `null` sem escrever nada.
   */
  #botCandidateOf(character: CharacterRuntime): MonsterRuntime | null {
    const runner = this.#runners.get(character.id);
    if (runner === undefined || runner.botCandidate === null) return null;
    const monster = this.#inSightOf(runner.botCandidate, character);
    if (monster === null) {
      runner.botCandidate = null;
      return null;
    }
    return monster.invisible ? null : monster;
  }

  /** O alvo corrente é do JOGADOR (AB-09), ou só uma eleição do bot (#480)? */
  #isPinned(character: CharacterRuntime): boolean {
    const runner = this.#runners.get(character.id);
    return runner !== undefined && runner.attackTarget !== null && runner.attackTargetPinned;
  }

  /**
   * O alcance é da ARMA (#152): o bow alcança 6, wand e rod 3, e o desarmado vale o alcance
   * do perfil `fist` (CMB-05) — que o boot monta de `combat.player.attackRange`, o corpo a
   * corpo. A arma sem `range` já saiu do boot com o da família.
   */
  #attackRangeOf(character: CharacterRuntime): number {
    return character.inventory.weapon(this.#options.items, character)?.weapon?.range
      ?? this.#options.unarmed.range;
  }

  /**
   * Atrás de quem ANDAR: o alvo escolhido primeiro (para "seguir" fora do alcance), senão o
   * melhor dentro do raio de visão.
   *
   * Só é consultado quando a postura não é `stand`. Separar dos dois é o que destravou esta
   * issue: enquanto a busca parava no alcance da arma, "seguir o alvo" não tinha como ser
   * expresso — quem já está ao alcance não precisa ser seguido.
   */
  #approachTarget(character: CharacterRuntime): MonsterRuntime | null {
    if (this.#isPinned(character)) {
      const attack = this.#attackTargetOfRunner(character);
      if (attack !== null) return attack;
    }
    return selectTarget(
      this.#targetingOf(character), this.#hostileMonsters(), character.position,
      this.#options.targetSearchRadius ?? 8,
    );
  }

  /**
   * Auto-target (#444): sem alvo pinado pelo jogador, seleciona o melhor monstro na TELA — o raio
   * de busca, o mesmo de `#approachTarget` — e o guarda. É o que faz um monstro que surge ao
   * alcance virar alvo na hora.
   *
   * A eleição passa por `setAttackTarget(..., pinned: false)` (#480, §42): o bot entra pelo
   * MESMO pipeline do jogador, mas sem pinar — fora do alcance a política reassume. O
   * `botCandidate` continua sendo a mira de tela, e é ele que sobrevive ao cancelamento do
   * jogador. NÃO sobrepõe o alvo pinado do jogador: com um `attackTarget` pinado vivo e na tela,
   * sai sem tocar em nada. Quando ele morre ou sai da tela, `#attackTargetOfRunner` limpa o campo e
   * a chamada seguinte já reavalia para o próximo mais próximo.
   */
  #autoSelectTarget(session: Session, character: CharacterRuntime): void {
    const runner = this.#runners.get(character.id);
    if (runner === undefined || !character.alive) return;
    if (this.#isPinned(character)) {
      if (this.#attackTargetOfRunner(character) !== null) return;
    }

    const best = this.#approachTarget(character);
    const next = best === null ? null : best.subject;
    if (next === runner.attackTarget) return;
    runner.botCandidate = next;
    // A troca de alvo do bot entra pela porta única (#480): jogador e bot não têm pipelines
    // que divergem. `false` porque é eleição de política, não clique.
    this.setAttackTarget(character, best, false);
    if (next === null) return;
    // O alvo novo pode destravar uma regra e um golpe engatilhados: reavalia agora, e não no
    // próximo múltiplo de um relógio.
    this.#armBot(session, character.id);
    this.#armPlayerAttack(session, character);
  }

  // --- ocupação -----------------------------------------------------------------------------

  /**
   * Os predicados `Blocked` que o passo guloso e o spawner consomem, derivados de `canOccupy`
   * — uma fonte de verdade, dois formatos.
   *
   * UMA closure, reaproveitada, com o mover num campo e um ponto de sondagem mutado no lugar,
   * e não uma closure nova (nem um `{ x, y }` novo) por chamada. Parece detalhe e não é: isto
   * roda até três vezes por passo de cada monstro, e com 5.000 instâncias uma alocação aqui é
   * o coletor rodando o tempo todo. Só é seguro porque ninguém guarda o predicado — ele é
   * usado e descartado dentro da mesma chamada.
   */
  #mover: Movable<GridPoint> | null = null;
  readonly #probe = { x: 0, y: 0 };

  readonly #moverBlocked: Blocked = (x, y) => {
    this.#probe.x = x;
    this.#probe.y = y;
    return canOccupy(this.#world, this.#mover as Movable<GridPoint>, this.#probe) !== null;
  };

  #blockedFor(mover: Movable<GridPoint>): Blocked {
    this.#mover = mover;
    return this.#moverBlocked;
  }

  /**
   * `#blockedFor`, mas ACRESCENTA o campo (M29-05, TFS `Monster::canWalkOnFieldType`): um tile
   * com campo de fogo/veneno/energia que o MONSTRO não pode pisar conta como bloqueado — para o
   * passo guloso E para a fuga (#518), porque as duas passam por este ÚNICO predicado dentro de
   * `decideMonsterAction`. Só monstro: o jogador pode entrar em qualquer campo (e leva o dano),
   * então nenhum call site de personagem usa isto.
   *
   * UMA closure reaproveitada com o monstro e a definição capturados em campo mutável — o mesmo
   * desenho de `#moverBlocked`, e pela mesma razão: isto roda até três vezes por passo de cada
   * monstro, e uma closure nova por vencimento é o coletor rodando o tempo todo com 5.000
   * instâncias.
   */
  #fieldMonster: MonsterRuntime | null = null;
  #fieldDefinition: Monster | null = null;
  readonly #fieldProbe = { x: 0, y: 0, z: 0 };

  /** O predicado de campo isolado (M29-05) — compartilhado pela decisão e pelo commit abaixo. */
  #fieldBlocksMonster(monster: MonsterRuntime, definition: Monster, x: number, y: number): boolean {
    this.#fieldProbe.x = x;
    this.#fieldProbe.y = y;
    this.#fieldProbe.z = this.#floorOf(monster);
    const field = this.#fields.at(this.#fieldProbe);
    return !canMonsterEnterField(definition, monster.ignoresFieldDamage, field);
  }

  /**
   * `#moverBlocked`, mas com uma exceção (M29-08, TFS/Canary `Monster::canPushCreatures`): um
   * tile SÓ recusado por `tile-occupied` deixa de bloquear quando quem decide `canPushCreatures`
   * e o único ocupante é um monstro `pushable` — o empurrão em si acontece no COMMIT
   * (`#clearPushableOccupant`, dentro de `#step`), nunca aqui: esta função é PURA quanto a mundo
   * (só lê), como todo `Blocked` (ADR 0009). Qualquer OUTRA razão de recusa (parede, fora do
   * mapa, jogador no tile, monstro não-pushable) continua bloqueando como sempre.
   */
  readonly #monsterBlocked: Blocked = (x, y) => {
    this.#probe.x = x;
    this.#probe.y = y;
    const rejection = canOccupy(this.#world, this.#fieldMonster as MonsterRuntime, this.#probe);
    if (rejection !== null && !(rejection === 'tile-occupied' && this.#pushablePathThrough(x, y))) {
      return true;
    }
    return this.#fieldBlocksMonster(this.#fieldMonster as MonsterRuntime, this.#fieldDefinition as Monster, x, y);
  };

  /**
   * Só a metade de LEITURA de `#clearPushableOccupant` (M29-08) — ver o comentário lá, inclusive
   * o porquê de `#isV3()` gatear os dois lados: sem ele, um monstro `combat-v1`/`v2` já
   * ESCOLHERIA um caminho diferente aqui (achando o tile passável), mesmo que o commit acabasse
   * recusando por falta do gate lá — e "o caminho escolhido muda" já é o suficiente para uma
   * hunt congelada divergir (o guloso tenta os DOIS vizinhos só quando o primário falha).
   */
  #pushablePathThrough(x: number, y: number): boolean {
    if (!this.#isV3()) return false;
    const pusher = this.#fieldMonster;
    const definition = this.#fieldDefinition;
    if (pusher === null || definition === null || !definition.canPushCreatures) return false;
    const occupant = this.#monsterAt(x, y, this.#floorOf(pusher), pusher);
    if (occupant === null) return false;
    return this.#options.monsters.get(occupant.monsterId)?.pushable === true;
  }

  #blockedForMonster(monster: MonsterRuntime, definition: Monster): Blocked {
    this.#mover = monster;
    this.#fieldMonster = monster;
    this.#fieldDefinition = definition;
    return this.#monsterBlocked;
  }

  /**
   * `Monster::canWalkTo` (#655, `monster.cpp:3216-3227`), o predicado do passo ALEATÓRIO — mais
   * estrito que `#monsterBlocked`: o raio de spawn vale, tile com criatura recusa MESMO que ela
   * seja empurrável (o Canary confere `getTopVisibleCreature == nullptr` antes de qualquer
   * empurrão), e tile de teleporte recusa (`TILESTATE_TELEPORT` em `Tile::queryAdd`). Escada e
   * parede já recusam em `canOccupy`. O campo segue a mesma regra do passo guloso — `queryAdd`
   * roda com `FLAG_IGNOREFIELDDAMAGE`, cujo `!(getIgnoreFieldDamage() || canWalkOnFieldType())`
   * é exatamente `canMonsterEnterField`.
   *
   * Lê o monstro e a definição dos MESMOS campos que `#monsterBlocked` — quem chama já passou por
   * `#blockedForMonster` neste evento —, para não alocar uma closure por passo.
   */
  readonly #randomStepBlocked: Blocked = (x, y) => {
    const monster = this.#fieldMonster as MonsterRuntime;
    if (!isInSpawnRange(monster, x, y)) return true;
    this.#probe.x = x;
    this.#probe.y = y;
    if (canOccupy(this.#world, monster, this.#probe) !== null) return true;
    const z = this.#floorOf(monster);
    if (this.#world.teleportAt(x, y, z) !== null) return true;
    return this.#fieldBlocksMonster(monster, this.#fieldDefinition as Monster, x, y);
  };

  #blockedForRandomStep(monster: MonsterRuntime, definition: Monster): Blocked {
    this.#mover = monster;
    this.#fieldMonster = monster;
    this.#fieldDefinition = definition;
    return this.#randomStepBlocked;
  }

  /**
   * O predicado da BUSCA de caminho da volta ao spawn (#655, `walkBackPathStep`): para um tile
   * QUALQUER — o `#monsterBlocked` do passo guloso passa por `canOccupy`, que só admite vizinhos
   * do mover e recusa todo o resto como `not-adjacent`, o que faria a busca nunca achar caminho
   * além do primeiro passo. O que ele diz de um tile é o que `canOccupy` diria de um passo até
   * lá: parede, borda, porta fechada e campo bloqueante (`blockedAt`), escada e teleporte (o
   * monstro não troca de andar, nem por teleporte), criatura no tile — salvo a empurrável que o
   * guloso também atravessa (`#pushablePathThrough`) — e o campo de dano que ele não pisa.
   *
   * Lê o monstro e a definição dos MESMOS campos que `#monsterBlocked`; uma closure só, sem
   * alocação por chamada — a busca varre centenas de tiles.
   */
  readonly #walkBackPathBlocked: Blocked = (x, y) => {
    const monster = this.#fieldMonster as MonsterRuntime;
    const z = this.#floorOf(monster);
    if (this.#world.blockedAt(x, y, z)) return true;
    if (this.#world.floorChangeAt(x, y, z) !== null || this.#world.teleportAt(x, y, z) !== null) return true;
    if (this.#world.occupied(x, y, z) && !this.#pushablePathThrough(x, y)) return true;
    return this.#fieldBlocksMonster(monster, this.#fieldDefinition as Monster, x, y);
  };

  #blockedForWalkBackPath(monster: MonsterRuntime, definition: Monster): Blocked {
    this.#fieldMonster = monster;
    this.#fieldDefinition = definition;
    return this.#walkBackPathBlocked;
  }

  /**
   * SÓ o campo do destino, revalidado no COMMIT do passo (`#step`, achado da revisão do #650) —
   * ver o comentário lá. Busca a própria definição do monstro em vez de reaproveitar
   * `#fieldDefinition`: não depende de `#blockedForMonster` ter rodado antes na mesma decisão, e
   * por isso continua correto mesmo que o destino tenha sido reescrito por outra coisa depois
   * dela.
   */
  #monsterFieldBlocked(monster: MonsterRuntime, to: GridPoint): boolean {
    const definition = this.#options.monsters.get(monster.monsterId);
    if (definition === undefined) return false;
    return this.#fieldBlocksMonster(monster, definition, to.x, to.y);
  }

  /**
   * `#blockedFor`, mas trata TAMBÉM qualquer tile de troca de andar como bloqueado (#527) — só
   * para os passos gulosos INCIDENTAIS de um personagem: fechar distância até a rota, contornar
   * um companheiro, ceder lugar a quem pediu passagem, perseguir por postura, aproximar do alvo
   * de follow no MESMO andar. Nenhum deles PRETENDE atravessar andar — e como z10/z11/z12 da
   * Darashia Dragon Lair compartilham a MESMA caixa x/y (nota de `RouteWalker.rejoinNearest`),
   * um passo guloso comum pode, por coincidência geométrica, mirar exatamente o tile de ORIGEM
   * de uma escada sem que NENHUM código ali soubesse que aquele tile era uma escada — `canOccupy`
   * (por trás de `#blockedFor`) só confere se o DESTINO dela está livre, nunca se cruzar ali faz
   * sentido para quem pediu o passo. Achado com o bot config REAL da party de dragões (sem lure
   * em ninguém): Sorcerer/Druid cruzavam para z11 e voltavam dezenas de vezes numa hunt de 10
   * min, sobrevivendo aos dois guardas que já tratam travessia INTENCIONAL (`#holdFollow`,
   * ramo de andar diferente, e `#crossesAwayFromLeader` na rota própria) porque o passo que
   * cruzava não vinha de nenhum dos dois — vinha de "fechar distância"/"contornar"/"ceder"/
   * "perseguir"/"aproximar no mesmo andar". A travessia intencional continua usando
   * `#blockedFor` puro — ali pisar na escada É o objetivo, e `landingBlocked` (`#holdFollow`)
   * já cobre o caso de chegada ocupada.
   */
  #blockedForGroundedStep(mover: CharacterRuntime): Blocked {
    const base = this.#blockedFor(mover);
    const z = mover.position.z;
    return (x, y, stepZ, monsterId) => base(x, y, stepZ, monsterId)
      || this.#world.floorChangeAt(x, y, z) !== null;
  }

  /** Para o spawn não há quem se mova: só parede e ocupação. */
  /**
   * Onde um monstro NÃO nasce (#236): parede, tile ocupado — e, com `spawnClearRadius` > 0,
   * qualquer tile a menos disso de um participante vivo. Sem o terceiro, o rato nascia no
   * tile ao lado do herói e, com `respawnDelayMs` igual ao intervalo de ataque, morria no
   * MESMO instante em que nascia (`Spawn` vence antes de `Attack`): o cliente recebia
   * appear + hit + disappear num lote só e desenhava o dano num tile vazio.
   *
   * Recusar aqui é ADIAR, não cancelar: `#onSpawn` reagenda em `SPAWN_RETRY_MS`. Só parede e
   * ocupação — desde o #583 a janela de visão de quem é `blockable` é decidida ANTES desta
   * checagem, em `#onSpawn`/`#hasVisibleParticipant` (ela precisa rodar sobre a posição NOMINAL
   * do ponto, não sobre cada tile candidato que o `Spawner` sonda). Morto não conta para
   * ocupação: ele está saindo.
   *
   * **O `z` é do PONTO, nunca o do mapa (#519).** `Spawner.#freeTile` passa o andar de cada
   * tile que sonda; sem isto, todo ponto seria checado no andar padrão do mapa, e um lugar
   * de z11 nasceria "livre" mesmo bloqueado por parede em z11 só porque o tile equivalente em
   * z10 está livre.
   */
  #spawnBlockedFor(): Blocked {
    return (x, y, z = this.#world.map.z) =>
      this.#world.blockedAt(x, y, z) || this.#world.occupied(x, y, z);
  }

  /**
   * "À vista" para o respawn de um monstro `blockable` (#583, `Spawn::findPlayer`/
   * `Spectators::find` do TFS/Canary): algum participante VIVO, no MESMO andar do ponto, dentro
   * da janela de visão (`SPAWN_VISIBILITY_RADIUS`).
   *
   * **`blockable` é a EXCEÇÃO, não a regra** (`isBlockable` do TFS/Canary). No Canary, 1.640 dos
   * 1.656 monstros do bestiário — Dragon e Dragon Lord inclusive — têm `isBlockable: false`:
   * eles respawnam olhando para o jogador, ignorando quem está perto. Só quem declara
   * `blockable: true` (rato e rotworm, o comportamento do Huntera preservado) espera a vista
   * limpar antes de nascer.
   */
  #hasVisibleParticipant(session: Session, at: Point, z: number): boolean {
    for (const participant of session.participants) {
      if (!participant.alive || this.#floorOf(participant) !== z) continue;
      if (distance(participant.position, at) <= SPAWN_VISIBILITY_RADIUS) return true;
    }
    return false;
  }

  /**
   * Onde uma INVOCAÇÃO não nasce (#546, TFS/Canary `Map::placeCreature`): só parede e tile
   * ocupado — NUNCA a janela de visão de `blockable` que `#hasVisibleParticipant` aplica ao
   * RESPAWN (#583).
   *
   * As duas checagens têm o MESMO formato (`Blocked`) e o mesmo primeiro passo, mas são
   * mecanismos diferentes da fonte: `Spawn::findPlayer` (TFS/Canary) segura o RESPAWN do
   * Spawner perto de um jogador vivo; `Map::placeCreature`, que resolve `monster.summon`, nunca
   * olha posição de jogador — só `tile->queryAdd`. Reaproveitar `#spawnBlockedFor` aqui faria um
   * jogador cercando o mestre (a ÚNICA hora em que `#onMonsterSummon` de fato tenta invocar,
   * porque exige `targetId` — TFS `hasFollowPath`) suprimir a invocação que a fonte deixaria
   * nascer ao lado dele.
   */
  #summonBlockedFor(): Blocked {
    return (x, y, z = this.#world.map.z) =>
      this.#world.blockedAt(x, y, z) || this.#world.occupied(x, y, z);
  }

  /**
   * Remonta a ocupação do zero. Chamado UMA vez, no primeiro evento depois de a sessão nascer
   * ou ser restaurada — dali em diante `move` e `place` a mantêm incremental.
   */
  #rebuildOccupancy(session: Session): void {
    this.#occupancyStale = false;
    this.#world.reset([...this.#monsters, ...session.participants]);
  }
}

/**
 * Busca por id sem closure.
 *
 * `array.find((p) => p.id === x)` aloca uma closure por chamada, e estes caminhos rodam
 * dezenas de vezes por segundo por instância — com 5.000 instâncias, é coletor.
 */
function findById<T extends { readonly id: string }>(
  items: readonly T[],
  id: string | null,
): T | null {
  if (id === null) return null;
  for (const item of items) if (item.id === id) return item;
  return null;
}

// --- montagem a partir de `content` ----------------------------------------------------------

export interface HuntSessionOptions {
  readonly id: string;
  readonly content: Content;
  readonly huntId: string;
  readonly difficulty: HuntDifficultyName;
  readonly createdAtMs: number;
  readonly exitRules?: readonly HuntExitRule[];
  readonly premium?: boolean;
  /** A configuração do bot, crua. Ver `HuntRulesetOptions.botConfig`. */
  readonly botConfig?: BotConfigInput;
  /** A de cada participante, por id (#203). Ver `HuntRulesetOptions.botConfigs`. */
  readonly botConfigs?: Readonly<Record<string, BotConfigInput>>;
  /** A party desta instância (#191). Ver `HuntRulesetOptions.partyOptions`. */
  readonly partyOptions?: PartyOptionsInput;
  /** Substitui o atuador embutido. Ver `HuntRulesetOptions.actuator`. */
  readonly actuator?: BotActuator;
  /** A Boosted Creature do dia (#615). Ver `HuntRulesetOptions.boostedMonsterId`. */
  readonly boostedMonsterId?: string;
}

export class HuntUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HuntUnavailableError';
  }
}

/**
 * `onEnter` recusa join além do limite do conteúdo (#397, §22): TIPADO, ao contrário do
 * `throw new Error` de colocação (linha 1033) — aquele é falha de CONTEÚDO (o primeiro tile da
 * rota não existe; nunca deveria acontecer em produção); este é um caminho ESPERADO em toda
 * hunt de party madura, e o hospedeiro precisa distingui-lo para recusar o ticket em vez de
 * derrubar a sessão.
 */
export class PartyFullError extends Error {
  readonly maxMembers: number;
  constructor(huntId: string, maxMembers: number) {
    super(`party da hunt "${huntId}" já tem ${String(maxMembers)} membros (limite do conteúdo)`);
    this.name = 'PartyFullError';
    this.maxMembers = maxMembers;
  }
}

/** Monta o ruleset com tudo o que a hunt escolhida precisa. Lança quando falta alguma peça. */
/**
 * O que não é conteúdo nem identidade da hunt. Objeto, e não posicionais (FUN-84): já eram
 * cinco parâmetros, e o bot traria o sétimo — a essa altura a chamada vira uma fila de
 * `undefined` no meio para alcançar o último.
 */
export interface HuntRulesetExtras {
  readonly exitRules?: readonly HuntExitRule[];
  readonly premium?: boolean;
  /** A configuração do bot, crua. Ver `HuntRulesetOptions.botConfig`. */
  readonly botConfig?: BotConfigInput;
  /** A de cada participante, por id (#203). Ver `HuntRulesetOptions.botConfigs`. */
  readonly botConfigs?: Readonly<Record<string, BotConfigInput>>;
  /** A party desta instância (#191). Ver `HuntRulesetOptions.partyOptions`. */
  readonly partyOptions?: PartyOptionsInput;
  /** Substitui o atuador embutido. Ver `HuntRulesetOptions.actuator`. */
  readonly actuator?: BotActuator;
  /** A Boosted Creature do dia (#615). Ver `HuntRulesetOptions.boostedMonsterId`. */
  readonly boostedMonsterId?: string;
}

export function createHuntRuleset(
  content: Content,
  huntId: string,
  difficulty: HuntDifficultyName,
  extras: HuntRulesetExtras = {},
): HuntRuleset {
  const { premium, botConfig, botConfigs, partyOptions, exitRules, actuator, boostedMonsterId } = extras;
  // A configuração passa CRUA para o ruleset, e ele compila. Compilar aqui criaria uma segunda
  // forma de entrar — e as regras de saída, que saem da mesma configuração, ficariam de fora
  // de quem entrasse pela outra. Já aconteceu.
  const hunt = content.hunts.get(huntId);
  if (hunt === undefined) throw new HuntUnavailableError(`hunt "${huntId}" não existe`);
  const map = content.maps.get(hunt.mapId);
  if (map === undefined) {
    throw new HuntUnavailableError(`hunt "${huntId}" aponta mapa inexistente "${hunt.mapId}"`);
  }
  const route = content.routes.get(hunt.routeId);
  if (route === undefined) {
    throw new HuntUnavailableError(`hunt "${huntId}" aponta rota inexistente "${hunt.routeId}"`);
  }
  return new HuntRuleset({
    hunt,
    difficulty,
    map,
    route,
    monsters: content.monsters,
    combat: content.combat,
    progression: content.progression,
    stamina: content.stamina,
    vocations: content.vocations,
    skills: content.skills,
    items: content.items,
    weaponFamilies: content.weaponFamilies,
    unarmed: content.unarmed,
    // Opcional no conteúdo, opcional aqui — e a chave só existe quando há valor, por causa do
    // `exactOptionalPropertyTypes`.
    party: content.party,
    ...(content.bestiary === undefined ? {} : { bestiary: content.bestiary }),
    ...(content.bosstiary === undefined ? {} : { bosstiary: content.bosstiary }),
    charms: content.charms,
    skinning: content.skinning,
    targetSearchRadius: content.bot.targetSearchRadius,
    spells: content.spells,
    supplies: content.supplies,
    ammunition: content.ammunition,
    player: { ...content.combat.player },
    ...(exitRules === undefined ? {} : { exitRules }),
    ...(premium === undefined ? {} : { premium }),
    ...(botConfig === undefined ? {} : { botConfig }),
    ...(botConfigs === undefined ? {} : { botConfigs }),
    ...(partyOptions === undefined ? {} : { partyOptions }),
    ...(actuator === undefined ? {} : { actuator }),
    ...(boostedMonsterId === undefined ? {} : { boostedMonsterId }),
    // O cooldown de FALLBACK do grupo vem do CONTEÚDO (§13.5), como todo parâmetro de
    // balanceamento; o livro do conteúdo (`group:<g>`) tem precedência.
    botCooldownMs: content.bot.categoryCooldownMs,
  });
}

/**
 * Cria a instância. É a ENTRADA: a sessão nasce com o mapa, a rota e os spawns da dificuldade
 * escolhida, e a versão de conteúdo congelada (invariante 7).
 *
 * O personagem entra depois, com `session.enter` — quem o constrói é o servidor, que é o dono
 * do estado durável.
 */
export function createHuntSession(options: HuntSessionOptions): Session {
  return new Session({
    id: options.id,
    contentVersion: options.content.version,
    ruleset: createHuntRuleset(options.content, options.huntId, options.difficulty, {
      ...(options.exitRules === undefined ? {} : { exitRules: options.exitRules }),
      ...(options.premium === undefined ? {} : { premium: options.premium }),
      ...(options.botConfig === undefined ? {} : { botConfig: options.botConfig }),
      ...(options.botConfigs === undefined ? {} : { botConfigs: options.botConfigs }),
      ...(options.partyOptions === undefined ? {} : { partyOptions: options.partyOptions }),
      ...(options.actuator === undefined ? {} : { actuator: options.actuator }),
      ...(options.boostedMonsterId === undefined ? {} : { boostedMonsterId: options.boostedMonsterId }),
    }),
    // Semente derivada do id: a mesma sessão reproduz a mesma sequência de combate, que é o
    // que torna "por que eu morri" uma pergunta investigável.
    rng: Rng.fromSeed(options.id),
    createdAtMs: options.createdAtMs,
  });
}

/**
 * Reconstrói o ruleset de um snapshot de hunt (FUN-28).
 *
 * A hunt e a dificuldade vêm do PRÓPRIO snapshot: são identidade da instância, não escolha de
 * quem retoma. Devolve `null` quando o conteúdo não tem mais as peças — e `null` é a resposta
 * certa, porque retomar numa hunt diferente é pior que não retomar.
 */
export function huntRulesetFromSnapshot(
  snapshot: SessionSnapshot,
  content: Content,
): HuntRuleset | null {
  const state = snapshot.ruleset as Partial<HuntRulesetState> | undefined;
  if (state?.huntId === undefined || state.difficulty === undefined) return null;
  try {
    // Sem o resto dos `extras` (bot, party…): eles voltam do próprio estado do ruleset, em
    // `restore`, e não daqui. `boostedMonsterId` é a ÚNICA exceção — é IDENTIDADE da instância
    // como `huntId`/`difficulty` (#615), não estado mutável, e por isso vem do snapshot aqui,
    // não de `restore`.
    return createHuntRuleset(content, state.huntId, state.difficulty, {
      ...(state.boostedMonsterId === undefined ? {} : { boostedMonsterId: state.boostedMonsterId }),
    });
  } catch {
    return null;
  }
}

/**
 * Trocar de dificuldade ENCERRA a instância e cria outra (§14.7). Não existe alteração
 * dinâmica, e não tente ser esperto aqui: mudar `monsterCount` no meio deixaria monstros da
 * densidade antiga vivos ao lado dos novos, e o jogador veria uma dificuldade que não é
 * nenhuma das duas.
 *
 * O extrato da instância antiga sai por `manual-exit` — o jogador pediu — com um evento
 * notável dizendo o que ele trocou, para a tela de retorno não ficar com um encerramento sem
 * explicação.
 */
export function changeDifficulty(
  session: Session,
  options: {
    readonly content: Content;
    readonly to: HuntDifficultyName;
    readonly newSessionId: string;
    readonly nowMs: number;
  },
): { readonly session: Session; readonly receipts: readonly Receipt[] } {
  const ruleset = session.ruleset;
  if (!(ruleset instanceof HuntRuleset)) {
    throw new Error(`sessão ${session.id} não é uma hunt`);
  }
  const state = ruleset.getState();
  const characters = [...session.participants];

  session.record('difficulty-changed', `${state.difficulty} → ${options.to}`);
  const receipts = session.end('manual-exit');

  const next = createHuntSession({
    id: options.newSessionId,
    content: options.content,
    huntId: state.huntId,
    difficulty: options.to,
    createdAtMs: options.nowMs,
    // A boosted É a mesma (#615): trocar de dificuldade não é entrar de novo — o personagem
    // continua no mesmo dia, e a instância nova herda a identidade da antiga.
    ...(state.boostedMonsterId === undefined ? {} : { boostedMonsterId: state.boostedMonsterId }),
  });
  for (const character of characters) next.enter(character);
  return { session: next, receipts };
}
