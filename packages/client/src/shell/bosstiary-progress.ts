// O Bosstiary em números (#629, ADR 0052 d.1), fora do componente para ser testável — o mesmo
// padrão de `bestiary-progress.ts` e `charms-progress.ts`.
//
// **Isto é apresentação, não regra.** Quem conta o abate de boss, fecha o nível e soma os pontos é
// o `sim` (`sim/bosstiary.ts`), e o cliente não simula: o que se calcula aqui é "em que nível o boss
// está" e "quantos abates faltam para o próximo", a partir do registro CRU que o servidor manda
// (`bosstiary`) e da tabela que o catálogo fixou na sessão (`catalogue.bosstiary`, invariante 7).
// Os PONTOS não se derivam: o servidor manda o total. Se as contas divergirem, a do servidor é a
// verdadeira — e nada daqui volta pelo socket (invariante 4).

import type { BosstiaryConfig, MonsterListing } from '../state/hud.js';

/** As três raridades do Canary (`BosstiaryRarity_t`), em ordem crescente. */
export type BossRarity = 'bane' | 'archfoe' | 'nemesis';

/** 0 = nenhum nível alcançado ainda, 3 = o último da tabela. */
export type BossLevel = 0 | 1 | 2 | 3;

/** Um boss do catálogo, como a aba o lista: o primeiro monstro de cada `raceId`. */
export interface BossListing {
  readonly id: string;
  readonly name: string;
  readonly rarity: BossRarity;
  readonly raceId: number;
}

/**
 * Os bosses do catálogo, UM por `raceId`. Quatro `raceId` são compartilhados por variantes do
 * mesmo boss (as formas de Urmahlullu, as duas Goshnar's Megalomania…), e o contador é um só —
 * listá-las todas mostraria o mesmo número em cinco linhas. Fica o primeiro na ORDEM DO CATÁLOGO
 * (por id), que é o que `IOBosstiary::addBosstiaryMonster` faz com a repetição: ignora a segunda.
 */
export function bossesOf(monsters: readonly MonsterListing[]): BossListing[] {
  const seen = new Set<number>();
  const bosses: BossListing[] = [];
  for (const monster of monsters) {
    const boss = monster.bosstiary;
    if (boss === undefined || seen.has(boss.raceId)) continue;
    seen.add(boss.raceId);
    bosses.push({ id: monster.id, name: monster.name, rarity: boss.rarity, raceId: boss.raceId });
  }
  return bosses;
}

/** Os abates de um boss no registro cru — a chave é o `raceId` em texto. */
export function killsOfBoss(kills: Readonly<Record<string, number>>, boss: BossListing): number {
  return kills[String(boss.raceId)] ?? 0;
}

/**
 * O nível de um boss: quantos degraus da tabela da raridade o contador já atingiu — `>=`, como o
 * `IOBosstiary::getBossCurrentLevel`. Sem tabela (servidor sem Bosstiary), 0.
 */
export function bossLevelOf(kills: number, rarity: BossRarity, config: BosstiaryConfig | null): BossLevel {
  if (config === null) return 0;
  let level = 0;
  for (const info of config.levels[rarity]) {
    if (kills >= info.kills) level += 1;
  }
  return level as BossLevel;
}

/** O que a linha de um boss mostra. */
export interface BossProgress {
  readonly kills: number;
  readonly level: BossLevel;
  /** Abates do PRÓXIMO nível, ou `null` no último (ou sem tabela): não há "próximo" a mostrar. */
  readonly nextKills: number | null;
  /** Fração até o próximo nível, 0 a 100; 100 no último nível. */
  readonly percent: number;
}

export function bossProgressOf(kills: number, rarity: BossRarity, config: BosstiaryConfig | null): BossProgress {
  const level = bossLevelOf(kills, rarity, config);
  const next = config?.levels[rarity][level]?.kills ?? null;
  if (config === null) return { kills, level, nextKills: null, percent: 0 };
  if (next === null) return { kills, level, nextKills: null, percent: 100 };
  return { kills, level, nextKills: next, percent: Math.min(100, (kills / next) * 100) };
}

/** Quantos bosses têm pelo menos um abate — o "abatidos" da caixa de progresso. */
export function bossesKilled(bosses: readonly BossListing[], kills: Readonly<Record<string, number>>): number {
  return bosses.filter((boss) => killsOfBoss(kills, boss) > 0).length;
}
