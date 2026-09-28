// Ruleset da Cidade — protect zone (§37).
//
// É o mais simples do jogo, e por isso o melhor teste da interface `Ruleset`: se a Cidade
// não couber nela sem gambiarra, a interface nasceu modelada em cima de hunt, e Guild War
// não vai caber depois.

import type {
  BotConfig, BotConfigV2, Combat, Item, Progression, Spell, Tilemap, Vocation,
} from '@draconya/content';
import { migrateBotConfigV1 } from '@draconya/content';
import { castSpell, ownPurse } from '../casting.js';
import { containerRulesFor } from '../inventory.js';
import { statsForLevel } from '../progression.js';
import type { EndReason, Ruleset, Session } from '../session.js';
import type { CharacterRuntime } from '../character.js';
import type { GridPoint } from '../monster/step.js';
import { TileOccupancy, move, placeReachable } from '../movement.js';
import type { MoveResult } from '../movement.js';
import { refusalOf } from './hunt.js';
import type { SlotOutcome, SlotRefusal, UseSlotTarget } from './hunt.js';

/** A mesma entrada crua que `HuntRuleset#configureBot` aceita — v1 ou v2, migrada ao guardar. */
type BotConfigInput = BotConfigV2 | BotConfig;

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
  /**
   * Os tamanhos de container (#160): a mochila (item) e a bolsa (progressão). A Cidade não
   * simula, mas é onde o personagem entra primeiro — e um snapshot v1 precisa ganhar os 20
   * lugares aqui, antes de qualquer `move`. Ausente é o conteúdo de teste sem itens.
   */
  readonly containers?: { readonly items: ReadonlyMap<string, Item>; readonly progression: Progression };
  /**
   * As vocações do conteúdo, para repor a velocidade da tabela na entrada (SV-04, #340). A
   * Cidade anda em passo FIXO e não a usa para andar — mas `player-stats` a mostra, e um
   * personagem que nunca caçou chega com `speed: 0`, um número que a tabela nunca produziu.
   * Ausente: a tabela base, sem bônus de vocação (hoje nenhuma vocação altera velocidade).
   */
  readonly vocations?: ReadonlyMap<string, Vocation>;
  /**
   * Catálogo de magias (#792, ADR 0044 d.2): sem ele, `useSlot` sempre recusa `not-in-catalog`
   * — a mesma degradação de uma hunt sem `spells` (FUN-74). Só QUEM CONJURA sai daqui; o resto
   * do vocabulário (dano, cura, condição) continua fora da Cidade (ver `useSlot`).
   */
  readonly spells?: ReadonlyMap<string, Spell>;
  /**
   * Coeficientes de combate (§12.1), exigidos por `castSpell` mesmo para conjuração — que não
   * rola nada. Ausente é a mesma recusa de `spells` ausente.
   */
  readonly combat?: Combat;
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

/**
 * O tipo de retorno é mais largo que `Ruleset` de propósito (#792): `useSlot`/`configureBot` não
 * são membros da interface (ver `session.ts`) — o host os alcança com `ruleset as
 * Partial<HuntRuleset>`, a MESMA gambiarra estrutural que já usa para a hunt. Sem a variável
 * `ruleset` abaixo, o literal de retorno tipado como `Ruleset` recusaria essas duas chaves por
 * excesso de propriedade; passando por uma `const` sem anotação, o TypeScript só confere a
 * atribuição — mais larga cabe em mais estreita.
 */
export function createCityRuleset(options: CityRulesetOptions = {}): Ruleset {
  const world = options.map === undefined
    ? null
    : new TileOccupancy(options.map, options.stepDurationMs === undefined
      ? {}
      : { fixedStepMs: options.stepDurationMs });
  let occupancyStale = true;
  // A configuração de bot de cada personagem (#792): só para LER a barra de ações no
  // `useSlot` manual — a Cidade não roda bot nenhum (hz 0, sem fila de eventos). Semeada por
  // `configureBot` (ticket na entrada, ou `bot-config` salvo ao vivo — o host chama os dois
  // pelo MESMO método, como já faz para a hunt).
  const configs = new Map<string, BotConfigV2>();

  /**
   * Remonta a ocupação a partir de quem está na sessão — MENOS quem está entrando agora. O
   * `Session.enter` já pôs o personagem em `participants` quando o `onEnter` roda, e a
   * posição que ele traz é da sessão anterior, num mapa que não é este: a hunt de onde
   * voltou, ou fora do mapa para um personagem novo. Contá-la aqui marcava um tile da praça
   * como ocupado por ninguém — e, quando ela caía por acaso no ponto de entrada, o primeiro
   * a chegar numa praça vazia era desviado para o vizinho. O mesmo filtro que a hunt faz.
   */
  const rebuild = (session: Session, arriving?: CharacterRuntime): void => {
    occupancyStale = false;
    world?.reset(session.participants.filter((p) => p !== arriving));
  };

  const ruleset = {
    type: 'city' as const,
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
      if (options.containers !== undefined) {
        character.inventory.ensureContainers(
          containerRulesFor(character.inventory, options.containers.items, options.containers.progression),
        );
        // A velocidade vem da tabela, como a hunt repõe na entrada (FUN-119): zero é "não sabe
        // ainda", e o painel Skills mostraria "Speed 0" na praça (SV-04, #340). Soma o bônus de
        // equipamento (#524, #527: boots of haste) pela MESMA conta da hunt — sem isto, um
        // personagem que nasce com a bota já calçada (o kit level 200 do dragon-party, #526) e
        // NUNCA entrou numa hunt ainda mostraria a velocidade base na Cidade, com ou sem a bota.
        if (character.speed <= 0) {
          const vocation = character.vocationId === null
            ? null
            : options.vocations?.get(character.vocationId) ?? null;
          character.speed = statsForLevel(character.level, vocation, options.containers.progression).speed
            + character.inventory.speedBonus(options.containers.items);
        }
      }

      // A colocação passa pela MESMA legalidade que um passo (FUN-69). O ponto de entrada é
      // validado no carregamento do conteúdo contra `isBlocked`, então uma recusa aqui é
      // outra criatura em cima dele — e nesse caso o personagem fica onde estava.
      if (world !== null && options.map?.entryPoint !== undefined) {
        if (occupancyStale) rebuild(session, character);
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

    /**
     * A configuração de bot do personagem (#792), pelo MESMO método que `HuntRuleset` expõe —
     * é como `#requestUseSlot`/`#configureBot`/`#adoptTicketBotConfig` do host chegam aqui, via
     * `ruleset as Partial<HuntRuleset>` e `configureBot?.(...)`, sem precisar saber que ruleset
     * é este. A Cidade NÃO compila bot (`compileBot`/`#armBot` são coisa de hunt): guarda só a
     * v2 migrada, para `useSlot` achar o que está em cada slot.
     *
     * `characterId` ausente é NO-OP — diferente da hunt (que cai no primeiro participante, o
     * caminho solo), a Cidade é SHARD (FUN-71): "o primeiro da lista" não identifica ninguém
     * aqui, e adivinhar escreveria a configuração de uma pessoa na conta de outra.
     */
    configureBot(_session: Session, config: BotConfigInput, characterId?: string): void {
      if (characterId === undefined) return;
      configs.set(characterId, migrateBotConfigV1(config));
    },

    /**
     * O disparo manual de um slot na Cidade (#792, ADR 0044 d.2): só CONJURAÇÃO sai daqui.
     *
     * A Cidade é protect zone (ADR 0004, §37) — magia agressiva (`damage`/`damage-over-time`)
     * é recusada por POLÍTICA, antes de tocar mana, cooldown ou RNG (`protection-zone`, nunca
     * devolvida por uma hunt). O resto do vocabulário não-agressivo (cura, condição de haste/
     * buff/mana-shield/dano-ao-longo-do-tempo) ficaria de FORA por um motivo mais estrutural:
     * ele devolve uma `ConditionState` que só o RULESET agenda (`condition-expire`/`-tick` na
     * fila de eventos), e a Cidade não tem fila — `onEvent` acima falha alto de propósito se
     * algo cair nela (a mesma razão de `use-item`/`use-item-on` recusarem comida e poção aqui,
     * ADR 0049 d.8). `conjure` é o único efeito que não agenda nada: credita o estoque e
     * termina no mesmo instante, e é por isso que só ele sai desta lista — o resto fica para
     * quando a Cidade ganhar relógio, o que o ADR 0004 diz que não terá.
     *
     * `target` é ignorado de propósito (RF-12 da #725/#726): conjuração não mira ninguém, e
     * nenhum efeito liberado aqui lê `recipient` além do próprio lançador.
     */
    useSlot(
      session: Session, characterId: string, set: number, slotIndex: number,
      _target?: UseSlotTarget,
    ): SlotOutcome {
      const character = session.participants.find((p) => p.id === characterId);
      if (character === undefined || !character.alive) return refuse('not-in-catalog', 0);
      const config = configs.get(characterId);
      if (config === undefined) return refuse('empty-slot', 0);
      if (set !== config.activeSet) return refuse('wrong-set', 0);
      const entry = config.sets[set]?.slots[slotIndex];
      if (entry === null || entry === undefined) return refuse('empty-slot', 0);
      if (entry.enabled === false) return refuse('disabled', 0);
      // Item e supply (poção, runa de ataque) continuam recusados na Cidade (ADR 0049 d.8):
      // só `spell` chega a ser considerado aqui.
      if (entry.do.kind !== 'spell') return refuse('not-in-catalog', 0);
      const spell = options.spells?.get(entry.do.spellId);
      if (spell === undefined) return refuse('not-in-catalog', 0);
      if (spell.effect.kind === 'damage' || spell.effect.kind === 'damage-over-time') {
        return refuse('protection-zone', 0);
      }
      if (spell.effect.kind !== 'conjure' || options.combat === undefined) {
        return refuse('not-in-catalog', 0);
      }
      const result = castSpell(
        character, spell, null, session.nowMs, options.combat, session.rng,
        undefined, character, undefined, null, ownPurse(character),
      );
      if (!result.ok) return refuse(refusalOf(result), result.retryInMs);
      // O gold da runa em branco (#594, ADR 0044), pela MESMA conta da hunt (`#castSpell`):
      // `goldSpent` é 0 em toda conjuração de munição — só a de supply cobra a runa.
      if (result.goldSpent > 0) session.credit(character.id, 'goldSpent', result.goldSpent);
      return { ok: true };
    },
  };
  return ruleset;
}

/** A recusa do manual, montada num lugar só — espelha `refuse` de `hunt.ts` (DT-08). */
function refuse(reason: SlotRefusal, retryInMs: number): SlotOutcome {
  return { ok: false, reason, retryInMs };
}
