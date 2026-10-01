// O Hazard do personagem (M44-14, #632): o registro `hazard` do ADR 0052 d.1 — o nível máximo
// desbloqueado e o nível escolhido de cada zona. É o `player:kv():scoped(zona)` do
// `data/libs/systems/hazard.lua` do Canary (`max-level`, `current-level`), no padrão de `charms`:
// `jsonb` por personagem, lido INTEIRO no ticket, escrito INTEIRO pelo extrato — última escrita
// vence (ADR 0052 d.1), porque o estado final da sessão dona é o que vale.
//
// Só a MATEMÁTICA do registro mora aqui. Quem decide ONDE a escolha é aceita (a Cidade, ADR 0052
// d.2) e quando o nível sobe (a morte do chefe da zona, `HuntRuleset`) é o ruleset; quem o
// persiste é o `server`. `sim` não conhece opcode nem sessão.
//
// **Números do Canary `47dfd51`** (`data/libs/systems/hazard.lua`): `minLevel` é `prototype.
// minLevel or 1`; `getPlayerCurrentLevel`/`getPlayerMaxLevel` devolvem `minLevel` quando a chave
// está ausente ou `<= 0`; `setPlayerCurrentLevel` recusa `level > max`; `setPlayerMaxLevel` clampa
// em `maxLevel`; `levelUp` só sobe o teto quando o nível ESCOLHIDO é o teto.

import type { HazardZone } from '@draconya/content';

/** O registro persistido (ADR 0052 d.1): o que sobra quando o jogador sai. */
export interface HazardState {
  /** `zoneId` → o maior nível desbloqueado (`max-level`). Ausente é o `minLevel` da zona. */
  readonly maxLevel: Readonly<Record<string, number>>;
  /** `zoneId` → o nível escolhido (`current-level`). Ausente é o `minLevel` da zona. */
  readonly currentLevel: Readonly<Record<string, number>>;
  /** Versão do registro (ADR 0052 d.1, como `botConfig.version`) — migra sem coluna nova. */
  readonly version: number;
}

export const HAZARD_STATE_VERSION = 1;

export function emptyHazardState(): HazardState {
  return { maxLevel: {}, currentLevel: {}, version: HAZARD_STATE_VERSION };
}

export type HazardSelectRefusal = 'unknown-zone' | 'below-minimum' | 'above-maximum' | 'invalid-level';

export type HazardSelectResult =
  | { readonly ok: true; readonly level: number }
  | { readonly ok: false; readonly reason: HazardSelectRefusal };

export class HazardProgress {
  readonly #maxLevel = new Map<string, number>();
  readonly #currentLevel = new Map<string, number>();
  #revision = 0;

  private constructor(state: HazardState) {
    for (const [zoneId, level] of Object.entries(state.maxLevel)) this.#maxLevel.set(zoneId, level);
    for (const [zoneId, level] of Object.entries(state.currentLevel)) {
      this.#currentLevel.set(zoneId, level);
    }
  }

  static fromState(state?: HazardState): HazardProgress {
    return new HazardProgress(state ?? emptyHazardState());
  }

  /** Uma CÓPIA — quem guarda para um snapshot não vê a ação seguinte aparecer nele. */
  getState(): HazardState {
    return {
      maxLevel: Object.fromEntries(this.#maxLevel),
      currentLevel: Object.fromEntries(this.#currentLevel),
      version: HAZARD_STATE_VERSION,
    };
  }

  /** Nada foi escolhido nem desbloqueado: o personagem de quem nunca pisou numa zona de hazard. */
  get isEmpty(): boolean {
    return this.#maxLevel.size === 0 && this.#currentLevel.size === 0;
  }

  /**
   * Quantas vezes o registro MUDOU desde que este objeto nasceu — para quem apresenta (o `host`)
   * comparar um inteiro por ciclo em vez de serializar o registro. Não é persistido: recomeça em
   * zero a cada construção (ticket, snapshot), e só serve para comparar com o que já foi mandado.
   */
  get revision(): number {
    return this.#revision;
  }

  /**
   * O maior nível que o personagem pode escolher na zona (`getPlayerMaxLevel`): o guardado,
   * limitado ao intervalo da zona — `<= 0` ou ausente é o `minLevel`, e nada passa do `maxLevel`
   * (o conteúdo pode ter encolhido a zona depois de o jogador ter desbloqueado mais).
   */
  maxLevelOf(zoneId: string, zone: HazardZone): number {
    const stored = this.#maxLevel.get(zoneId);
    if (stored === undefined || stored <= 0) return zone.minLevel;
    return Math.min(Math.max(stored, zone.minLevel), zone.maxLevel);
  }

  /**
   * O nível que vale ao ENTRAR na zona (`getPlayerCurrentLevel`): o escolhido, nunca abaixo do
   * `minLevel` nem acima do teto que o jogador desbloqueou.
   */
  currentLevelOf(zoneId: string, zone: HazardZone): number {
    const stored = this.#currentLevel.get(zoneId);
    const max = this.maxLevelOf(zoneId, zone);
    if (stored === undefined || stored <= 0) return zone.minLevel;
    return Math.min(Math.max(stored, zone.minLevel), max);
  }

  /**
   * Escolhe o nível da próxima entrada (`Hazard:setPlayerCurrentLevel`): inteiro, não abaixo do
   * `minLevel` (o NPC do Canary recusa `<= 0`) e não acima do teto desbloqueado (`level > max →
   * false`). Escolher o nível em que já está é válido e não escreve nada de novo.
   */
  select(zoneId: string, zone: HazardZone | undefined, level: number): HazardSelectResult {
    if (zone === undefined) return { ok: false, reason: 'unknown-zone' };
    if (!Number.isSafeInteger(level)) return { ok: false, reason: 'invalid-level' };
    if (level < zone.minLevel) return { ok: false, reason: 'below-minimum' };
    if (level > this.maxLevelOf(zoneId, zone)) return { ok: false, reason: 'above-maximum' };
    if (this.#currentLevel.get(zoneId) !== level) this.#revision += 1;
    this.#currentLevel.set(zoneId, level);
    return { ok: true, level };
  }

  /**
   * `Hazard:levelUp`: o teto sobe UM nível quando o nível escolhido é o teto, e nunca passa do
   * `maxLevel` da zona. Devolve se mudou — o chamador só marca o personagem como sujo quando
   * mudou.
   */
  levelUp(zoneId: string, zone: HazardZone): boolean {
    const max = this.maxLevelOf(zoneId, zone);
    if (this.currentLevelOf(zoneId, zone) !== max) return false;
    const next = Math.min(max + 1, zone.maxLevel);
    if (next === max) return false;
    this.#maxLevel.set(zoneId, next);
    this.#revision += 1;
    return true;
  }
}

/**
 * A forma de um `HazardState` — para o `server` conferir a linha `jsonb` (sem CHECK) com a mesma
 * régua na emissão e no consumo do ticket, como `isCharmsState`. Forma, nunca domínio: um
 * `zoneId` fora do conteúdo não resolve nada, e nunca trava um personagem.
 */
export function isHazardState(value: unknown): value is HazardState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record['version'] !== 'number') return false;
  return isLevelMap(record['maxLevel']) && isLevelMap(record['currentLevel']);
}

function isLevelMap(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([zoneId, level]) =>
    zoneId.length > 0 && typeof level === 'number' && Number.isSafeInteger(level) && level > 0);
}
