// Ruleset da Cidade — protect zone (§37).
//
// É o mais simples do jogo, e por isso o melhor teste da interface `Ruleset`: se a Cidade
// não couber nela sem gambiarra, a interface nasceu modelada em cima de hunt, e Guild War
// não vai caber depois.

import type { Tilemap } from '@draconya/content';
import type { EndReason, Ruleset, Session } from '../session.js';
import type { CharacterRuntime } from '../character.js';
import type { GridPoint } from '../monster/step.js';
import { TileOccupancy, move, place } from '../movement.js';
import type { MoveResult } from '../movement.js';

export interface CityRulesetOptions {
  /**
   * O mapa da Cidade, com o ponto de entrada (FUN-60, FUN-69). Sem ele a Cidade não anda e não
   * coloca ninguém — é o que a sessão de Cidade era antes: um lugar sem geometria, onde o
   * personagem nascia em `(0,0)` porque não havia mapa para dizer que isso é parede.
   */
  readonly map?: Tilemap;
  /** Milissegundos por tile ao andar na Cidade. Vem de `progression.stepDurationMs`. */
  readonly stepDurationMs?: number;
}

export function createCityRuleset(options: CityRulesetOptions = {}): Ruleset {
  const world = options.map === undefined ? null : new TileOccupancy(options.map);
  let occupancyStale = true;

  const rebuild = (session: Session): void => {
    occupancyStale = false;
    world?.reset(session.participants);
  };

  return {
    type: 'city',

    // Orientada a evento: sem laço de simulação nenhum. Movimento e chat chegam como
    // mensagem e respondem; loja, depósito e market são pedido-resposta.
    hz: () => 0,

    onEnter(session: Session, character: CharacterRuntime) {
      // Voltar à cidade cura — é para onde a morte devolve (§26.1).
      character.health = character.maxHealth;
      character.mana = character.maxMana;
      character.alive = true;
      if (options.stepDurationMs !== undefined) character.stepDurationMs = options.stepDurationMs;

      // A colocação passa pela MESMA legalidade que um passo (FUN-69). O ponto de entrada é
      // validado no carregamento do conteúdo contra `isBlocked`, então uma recusa aqui é
      // outra criatura em cima dele — e nesse caso o personagem fica onde estava.
      if (world !== null && options.map?.entryPoint !== undefined) {
        if (occupancyStale) rebuild(session);
        place(world, character, { ...options.map.entryPoint, z: options.map.z });
      }
      session.record('entered-city', character.id);
    },

    onEvent() {
      // Nunca deveria ser chamado: `hz` é 0 e a cidade não agenda nada. Se for, alguém pôs
      // um evento na fila da cidade e está queimando CPU no único espaço compartilhado do
      // jogo — justamente onde o custo por jogador precisa ficar perto de zero.
      throw new Error('city is event-driven; it must not receive scheduled events');
    },

    onCreatureDied() {
      // Protect zone não causa dano (§37). Chegar aqui é bug de outro sistema, e falhar
      // alto é melhor que registrar uma morte impossível no extrato do jogador.
      throw new Error('nothing dies in a protect zone');
    },

    onEnd(_session: Session, _reason: EndReason) {
      // A cidade não gera extrato: não há progresso a creditar.
    },

    // A Cidade é PZ (ADR 0004), mas PZ proíbe combate, não movimento. Mesmo caminho e mesma
    // razão de recusa que o bot e o monstro na hunt (FUN-69).
    requestMove(session: Session, characterId: string, to: GridPoint): MoveResult {
      if (world === null) return { ok: false, reason: 'out-of-bounds' };
      if (occupancyStale) rebuild(session);
      const character = session.participants.find((p) => p.id === characterId);
      if (character === undefined) return { ok: false, reason: 'tile-blocked' };
      const result = move(world, character, { ...to, z: character.position.z });
      if (result.ok) {
        session.emit({
          kind: 'creature-moved', creatureId: characterId,
          from: result.from, to: result.to, durationMs: result.durationMs,
        });
      }
      return result;
    },
  };
}
