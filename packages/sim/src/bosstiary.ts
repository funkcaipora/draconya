// Bosstiary (#629): o registro paralelo de bosses — abates por boss, o nível que cada um
// alcançou (0 a 3) e os pontos de boss. `IOBosstiary::addBosstiaryKill` do Canary
// (`src/io/io_bosstiary.cpp`), chamado por `Player::addBosstiaryKill` em `Player::onKilledMonster`.
// ADR 0052 decisão 1: registro `jsonb` por sistema, escrito pelo extrato da sessão dona.
//
// O motor sabe CONTAR abate e sabe em que abate um nível fecha; quantos abates levam a cada nível
// e quantos pontos ele rende são conteúdo (`bosstiary/baseline.json`), por raridade — e a raridade
// é do MONSTRO (`monster.bosstiary.rarity`, importada do Canary). Sem conteúdo, o abate conta do
// mesmo jeito — só não há nível nem ponto, como o Bestiário sem marcos.
//
// **O contador é acumulador, e isso não briga com o invariante 2**, pela mesma razão do
// Bestiário: o que a regra proíbe é grandeza dependente do TEMPO somada por tick; o que se soma
// aqui é abate, e abate é evento na fila — a morte que `resolveDeath` resolve no instante em que
// vence. A 1 Hz e a 10 Hz morrem os mesmos bosses nos mesmos instantes lógicos.
//
// **A chave é o `raceId` do boss, não o id de conteúdo** — a do Canary (`STORAGEVALUE_
// BESTIARYKILLCOUNT + raceid`). Quatro `raceId` são compartilhados por variantes do mesmo boss
// (as formas de Urmahlullu, as duas Goshnar's Megalomania, os dois Voidborn, Rupture e
// Eradicator2), e abater qualquer uma soma no MESMO contador; chavear por id de conteúdo
// dividiria o de Urmahlullu em cinco. Vira texto (`"1811"`) porque objeto JSON só tem chave de
// texto, e porque a coluna é `jsonb`.

import type { BosstiaryLevelInfo, BosstiaryRarity } from '@draconya/content';

/** Os níveis de um boss: 0 (nunca alcançou nenhum) a 3 (o último da tabela). */
export type BosstiaryLevel = 0 | 1 | 2 | 3;

/**
 * O registro (ADR 0052 d.1): abates por `raceId`, os pontos de boss acumulados e a `version` do
 * formato — como `botConfig.version`, para migrar sem coluna nova. Entra no snapshot e no
 * extrato, como `BestiaryState`.
 */
export interface BosstiaryState {
  /** `raceId` (texto) → abates. Boss nunca abatido não tem entrada. */
  readonly kills: Readonly<Record<string, number>>;
  /** Pontos de boss (`Player::bossPoints`): a soma dos pontos dos níveis já alcançados. */
  readonly points: number;
  readonly version: number;
}

/** A versão atual do registro (ADR 0052 d.1). */
export const BOSSTIARY_STATE_VERSION = 1;

export function emptyBosstiaryState(): BosstiaryState {
  return { kills: {}, points: 0, version: BOSSTIARY_STATE_VERSION };
}

/**
 * A tabela de níveis por raridade — um nível é os abates que o alcançam e os pontos que ele rende
 * (`LevelInfo` do Canary). É estruturalmente o `Bosstiary` do conteúdo — `content.bosstiary` entra
 * aqui sem adaptador —, declarado de novo para o `sim` só depender do que usa: `id`, `source` e
 * `_open` são assunto do carregador.
 */
export interface BosstiaryConfig {
  readonly levels: Readonly<Record<BosstiaryRarity, readonly BosstiaryLevelInfo[]>>;
}

/** O que um abate rendeu ao Bosstiary. Ver `Bosstiary.record`. */
export interface BosstiaryRecord {
  /** Abates deste boss (deste `raceId`) DEPOIS de contar este. */
  readonly kills: number;
  /** O nível DEPOIS deste abate. */
  readonly level: BosstiaryLevel;
  /** O nível (1 a 3) que ESTE abate alcançou, ou `null` — o caso de quase todos. */
  readonly levelReached: 1 | 2 | 3 | null;
  /** Os pontos de boss que este abate rendeu: os do nível alcançado, ou 0. */
  readonly pointsGained: number;
}

/** A chave do contador de um boss: o `raceId` como texto (ver o cabeçalho do arquivo). */
export function bosstiaryKey(raceId: number): string {
  return String(raceId);
}

/**
 * O nível de um boss com `kills` abates: quantos degraus da tabela da raridade o contador já
 * atingiu (`IOBosstiary::getBossCurrentLevel`). Sem tabela, 0.
 */
export function bosstiaryLevelOf(
  kills: number, rarity: BosstiaryRarity, config?: BosstiaryConfig,
): BosstiaryLevel {
  if (config === undefined) return 0;
  let level = 0;
  for (const info of config.levels[rarity]) {
    if (kills >= info.kills) level += 1;
  }
  return level as BosstiaryLevel;
}

export class Bosstiary {
  readonly #kills = new Map<string, number>();
  #points = 0;

  static fromState(state?: BosstiaryState): Bosstiary {
    const bosstiary = new Bosstiary();
    if (state === undefined) return bosstiary;
    for (const [key, kills] of Object.entries(state.kills)) bosstiary.#kills.set(key, kills);
    bosstiary.#points = state.points;
    return bosstiary;
  }

  /** Uma CÓPIA: quem guarda o estado para um snapshot não vê o abate seguinte aparecer nele. */
  getState(): BosstiaryState {
    const kills: Record<string, number> = {};
    for (const [key, count] of this.#kills) kills[key] = count;
    return { kills, points: this.#points, version: BOSSTIARY_STATE_VERSION };
  }

  /**
   * Abates deste boss. Boss nunca abatido não tem entrada, e é assim de propósito: gravar zero
   * para todo boss do conteúdo em todo personagem é encher o snapshot com o padrão.
   */
  killsOf(raceId: number): number {
    return this.#kills.get(bosstiaryKey(raceId)) ?? 0;
  }

  /** Os pontos de boss acumulados. */
  get points(): number {
    return this.#points;
  }

  /**
   * Conta um abate e diz se ele ALCANÇOU um nível — e quantos pontos rendeu.
   *
   * Como `IOBosstiary::addBosstiaryKill`: compara o nível ANTES e DEPOIS de somar o abate e, só
   * se mudou, soma ao total os pontos do nível novo (`levelInfos[raridade][nível - 1].points`).
   * Com abates de um em um, o nível sobe de um em um, então cada nível é alcançado por exatamente
   * um abate — o que faz os pontos dos três níveis SOMAREM (Bane 5+15+30, Archfoe e Nemesis
   * 10+30+60). O `kills` do Canary é `bosstiaryKillMultiplier` (padrão 1) e dobra em evento de
   * servidor ou boss boosted; nada disso existe aqui, então o abate é sempre 1.
   *
   * Sem `config` não há nível a alcançar, mas o abate conta: a config é quem define nível, não
   * quem autoriza contar.
   */
  record(raceId: number, rarity: BosstiaryRarity, config?: BosstiaryConfig): BosstiaryRecord {
    const key = bosstiaryKey(raceId);
    const before = this.#kills.get(key) ?? 0;
    const kills = before + 1;
    this.#kills.set(key, kills);
    const oldLevel = bosstiaryLevelOf(before, rarity, config);
    const level = bosstiaryLevelOf(kills, rarity, config);
    if (config === undefined || level === oldLevel) {
      return { kills, level, levelReached: null, pointsGained: 0 };
    }
    const pointsGained = config.levels[rarity][level - 1]?.points ?? 0;
    this.#points += pointsGained;
    return { kills, level, levelReached: level as 1 | 2 | 3, pointsGained };
  }

  /**
   * Absorve o estado de outro, ficando com o MAIOR de cada boss e dos pontos — a fusão do
   * Bestiário (`Bestiary.merge`), pela mesma razão: abate nunca desce, e os pontos de boss só
   * sobem (o Canary só os soma: `addBossPoints`). É o que impede um extrato antigo, processado
   * fora de ordem, de rebaixar um contador que já subiu.
   */
  static merge(current: BosstiaryState | undefined, incoming: BosstiaryState): BosstiaryState {
    const kills: Record<string, number> = { ...(current?.kills ?? {}) };
    for (const [key, count] of Object.entries(incoming.kills)) {
      const existing = kills[key];
      if (existing === undefined || count > existing) kills[key] = count;
    }
    return {
      kills,
      points: Math.max(current?.points ?? 0, incoming.points),
      version: BOSSTIARY_STATE_VERSION,
    };
  }
}
