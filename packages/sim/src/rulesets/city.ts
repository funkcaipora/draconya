// Ruleset da Cidade — protect zone (§37).
//
// É o mais simples do jogo, e por isso o melhor teste da interface `Ruleset`: se a Cidade
// não couber nela sem gambiarra, a interface nasceu modelada em cima de hunt, e Guild War
// não vai caber depois.

import type { Tilemap } from '@draconya/content';
import type { EndReason, Ruleset, Session } from '../session.js';
import type { CharacterRuntime } from '../character.js';
import type { GridPoint } from '../monster/step.js';
import { TileOccupancy, move, placeReachable } from '../movement.js';
import type { MoveResult } from '../movement.js';

export interface CityRulesetOptions {
  /**
   * O mapa da Cidade, com o ponto de entrada (FUN-60, FUN-69). Sem ele a Cidade não anda e não
   * coloca ninguém — é o que a sessão de Cidade era antes: um lugar sem geometria, onde o
   * personagem nascia em `(0,0)` porque não havia mapa para dizer que isso é parede.
   */
  readonly map?: Tilemap;
  /**
   * Milissegundos por tile ao andar na Cidade — FIXO, para todo mundo (FUN-119, ADR 0025).
   * Vem de `city.stepDurationMs`; a Cidade é navegação, não simulação.
   */
  readonly stepDurationMs?: number;
  /** Quantos tiles a busca por tile livre visita ao chegar. Ver `ENTRY_TILES`. */
  readonly entryTiles?: number;
}

/**
 * Quantos tiles a busca por tile livre visita ao chegar, antes de desistir.
 *
 * 1.089 é o quadrado de 33 — o anel de raio 16 que valia antes da FUN-120 —, e o número vem do
 * TETO DE POPULAÇÃO por cópia (200, na FUN-33): com 289 tiles — o raio 8 de antes — duzentas
 * pessoas ficariam ombro a ombro e ninguém conseguiria andar, porque tile é exclusivo.
 *
 * A busca é em largura pelos tiles ANDÁVEIS (`placeReachable`), do ponto de entrada para
 * fora, então quem chega num templo vazio entra no tile de entrada, e quem chega no lotado
 * fica no primeiro livre a pé — nunca do outro lado de uma parede, que é o que o anel
 * geométrico fazia num prédio.
 */
const ENTRY_TILES = 1_089;

export function createCityRuleset(options: CityRulesetOptions = {}): Ruleset {
  const world = options.map === undefined
    ? null
    : new TileOccupancy(options.map, options.stepDurationMs === undefined
      ? {}
      : { fixedStepMs: options.stepDurationMs });
  let occupancyStale = true;

  const rebuild = (session: Session): void => {
    occupancyStale = false;
    world?.reset(session.participants);
  };

  return {
    type: 'city',
    // O mapa que o cliente desenha (FUN-120). Cidade sem mapa é só fixture.
    ...(options.map === undefined ? {} : { mapId: options.map.id }),

    // A Cidade é o SHARD (FUN-71, ADR 0023): uma cópia, muitos personagens. É a única sessão
    // do jogo assim — hunt, quest, boss e guild war são instanciadas por quem entra.
    shared: true,

    // Orientada a evento: sem laço de simulação nenhum. Movimento e chat chegam como
    // mensagem e respondem; loja, depósito e market são pedido-resposta.
    hz: () => 0,

    onEnter(session: Session, character: CharacterRuntime) {
      // Voltar à cidade cura — é para onde a morte devolve (§26.1).
      character.health = character.maxHealth;
      character.mana = character.maxMana;
      character.alive = true;

      // A colocação passa pela MESMA legalidade que um passo (FUN-69). O ponto de entrada é
      // validado no carregamento do conteúdo contra `isBlocked`, então uma recusa aqui é
      // outra criatura em cima dele — e nesse caso o personagem fica onde estava.
      if (world !== null && options.map?.entryPoint !== undefined) {
        if (occupancyStale) rebuild(session);
        // No tile de entrada, ou no livre mais próximo dele A PÉ (FUN-120).
        //
        // A praça é COMPARTILHADA (FUN-71): o segundo a chegar encontra o primeiro parado
        // exatamente no ponto de entrada, e um `place` seco recusaria — o personagem ficaria
        // fora do mapa, invisível e sem andar, com o log dizendo que ele entrou. E o templo
        // tem paredes: o anel geométrico de `placeNear` colocaria o vigésimo do lado de fora.
        placeReachable(world, character, options.map.entryPoint, options.entryTiles ?? ENTRY_TILES);
      }
      session.record('entered-city', character.id);
    },

    onLeave(session: Session) {
      // REMONTA a ocupação a partir de quem ficou, em vez de liberar o tile pela posição de
      // quem saiu.
      //
      // A diferença não é estilo. Quando esta saída acontece, quem sai já pode ter sido
      // colocado no mapa da hunt para onde vai — e `TileOccupancy` guarda coordenada, não
      // dono. Liberar por `character.position` liberaria um tile da PRAÇA usando coordenada
      // de OUTRO mapa, em cima de quem estivesse parado ali. É o defeito que a FUN-72
      // corrigiu no `place`, pela mesma porta.
      //
      // Sem isto, na direção contrária, sobra um bloqueio invisível no meio da praça: ninguém
      // consegue pisar, ninguém está ali, e nada na tela explica.
      if (world !== null) rebuild(session);
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
