// Facções de monstro (#619, M44-01) — o `Faction_t` do Canary (`src/game/game_definitions.hpp:
// 44-53`), `monster.faction`/`enemyFactions` (`monsters.hpp:134-135`) e as três perguntas que
// ele faz com elas (`Monster::isOpponent`, `isTarget` e `Combat::canDoCombat`, conferidos em
// 47dfd51 em 2026-09-30). PURO: entra conteúdo, sai tabela e constante — quem sabe QUEM é o mestre
// de uma invocação, e portanto qual facção ela herda, é o `HuntRuleset`.
//
// **Por que existe um módulo à parte.** O `chooseTarget` (`monster.ts`) precisa do VALOR
// numérico da facção para o desempate, e o ruleset precisa da tabela por monstro para decidir
// quem é alvo e quem o golpe acerta. Os dois números vivem aqui para não haver duas cópias de
// "quanto pesa a facção" — a mesma razão pela qual `TARGET_THINK_INTERVAL_MS` mora em um lugar só.

import { factionValue } from '@draconya/content';
import type { Monster } from '@draconya/content';

/** `FACTION_DEFAULT`: o monstro sem facção — o bestiário quase inteiro. */
export const FACTION_DEFAULT = factionValue('default');

/**
 * `FACTION_PLAYER`: a facção do personagem e de tudo que ele invoca (`Player::faction`,
 * `player.hpp:1858`; `Monster::getFaction` devolve a do mestre). É o DEFAULT de um `Prey` sem
 * `faction`: quem chama `chooseTarget` com a lista de sempre (personagens e invocações de
 * personagem) não precisa dizer nada, e o desempate por facção fica uniforme entre eles.
 */
export const FACTION_PLAYER = factionValue('player');

/**
 * O peso da facção na busca do MAIS PERTO: o Canary soma `faction × 100` à distância
 * (`Monster::searchTargetImmediate`, `TARGETSEARCH_NEAREST`; `MonsterTargetRanker::rank`,
 * `MonsterTargetRankMode::Nearest`). Como a distância de visão é ≤ 11, uma facção de número
 * MAIOR nunca ganha de uma menor por estar mais perto: o jogador (1) é sempre preferido a um
 * inimigo de facção (2+), e a facção 6 (Deepling) a 7 (Deathling), qualquer que seja a distância.
 */
export const NEAREST_FACTION_WEIGHT = 100;

/**
 * O peso da facção na busca por MENOS VIDA e por MAIS DANO (`monster_targeting.cpp`, os modos
 * `Health` e `Damage`): `faction × 100 000`, grande o bastante para que a vida (ou o dano) nunca
 * desempate contra a facção. Note a assimetria do Canary, reproduzida: em "menos vida" a facção
 * MENOR ganha; em "mais dano" a MAIOR.
 */
export const RANK_FACTION_WEIGHT = 100_000;

/** Facção e inimigas de um monstro COM facção, já em valores numéricos. */
export interface FactionInfo {
  /** O valor de `Faction_t` — nunca `FACTION_DEFAULT` (quem não tem facção não entra na tabela). */
  readonly faction: number;
  /** `enemyFactions` como conjunto — `isEnemyFaction` do Canary é `contains`. */
  readonly enemies: ReadonlySet<number>;
}

/**
 * Quais monstros de `monsters` PODEM existir numa hunt cujos pontos de spawn são `spawnPoints`:
 * os dos pontos (`monsterId` ou a lista com peso, #582) e, transitivamente, tudo que algum deles
 * invoca (`summons`, #546). O conteúdo carrega o catálogo INTEIRO em toda hunt — perguntar a ele
 * "tem monstro de facção?" seria sempre sim —, então a tabela só olha o que de fato pode nascer,
 * e uma hunt de Rat Cellars nunca paga o custo de facção.
 */
export function reachableMonsterIds(
  spawnPoints: ReadonlyArray<{
    readonly monsterId?: string; readonly monsters?: ReadonlyArray<{ readonly monsterId: string }>;
  }>,
  monsters: ReadonlyMap<string, Monster>,
): ReadonlySet<string> {
  const reached = new Set<string>();
  const pending: string[] = [];
  const visit = (id: string): void => {
    if (reached.has(id)) return;
    reached.add(id);
    pending.push(id);
  };
  for (const point of spawnPoints) {
    if (point.monsterId !== undefined) visit(point.monsterId);
    for (const entry of point.monsters ?? []) visit(entry.monsterId);
  }
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    for (const entry of monsters.get(id)?.summons?.entries ?? []) visit(entry.monsterId);
  }
  return reached;
}

/**
 * A tabela `monsterId → FactionInfo` dos monstros ALCANÇÁVEIS que têm facção. Vazia é o caso
 * comum (rato, rotworm, dragões, qualquer hunt sem facção) — e é a condição que liga o caminho
 * rápido do ruleset, idêntico bit a bit ao de antes do #619.
 *
 * `faction: 'default'` explícito é o mesmo que ausente, e uma lista `enemyFactions` sem facção
 * própria não faz nada (o Canary só consulta `isEnemyFaction` quando `getFaction() !=
 * FACTION_DEFAULT`) — nos dois casos o monstro fica FORA da tabela.
 */
export function buildFactionTable(
  monsters: ReadonlyMap<string, Monster>, reachable: ReadonlySet<string>,
): ReadonlyMap<string, FactionInfo> {
  const table = new Map<string, FactionInfo>();
  for (const id of reachable) {
    const definition = monsters.get(id);
    if (definition?.faction === undefined) continue;
    const faction = factionValue(definition.faction);
    if (faction === FACTION_DEFAULT) continue;
    table.set(id, { faction, enemies: new Set((definition.enemyFactions ?? []).map(factionValue)) });
  }
  return table;
}
