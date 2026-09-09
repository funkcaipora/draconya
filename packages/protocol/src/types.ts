// Um schema Zod por mensagem. É ele que valida a entrada ANTES de virar estado — mensagem
// malformada é recusada com erro tipado, nunca aplicada pela metade (invariante 4).

import { z } from 'zod';
import type { C2SName, S2CName } from './messages.js';

const Point = z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() });
const Direction = z.enum(['north', 'east', 'south', 'west']);

/**
 * Uma criatura como ela chega no estado completo. Mesmos campos do `creature-appear`, de
 * propósito: o cliente aplica os dois pelo mesmo caminho, e um campo que só existisse num
 * deles viraria a diferença entre "reconectei" e "vi aparecer".
 */
const CreatureState = z.object({
  id: z.number().int(),
  position: Point,
  appearanceId: z.number().int(),
  name: z.string(),
  health: z.number(),
  maxHealth: z.number(),
});

/** Os agregados da sessão — o que o §16.2 chama de "quanto rendeu". */
const Aggregates = z.object({
  durationMs: z.number(),
  xpGained: z.number(),
  goldGained: z.number(),
  goldSpent: z.number(),
  kills: z.number().int(),
  deaths: z.number().int(),
});

/** Lista CURTA para a tela de retorno. Não é log: guarda só o que vale contar. */
const NotableEvent = z.object({
  atMs: z.number(),
  type: z.string(),
  detail: z.string().optional(),
});

export const C2S_SCHEMAS = {
  authenticate: z.object({ ticket: z.string().min(1), clientVersion: z.string() }),
  ping: z.object({ t: z.number() }),
  'client-ready': z.object({}),
  'session-attach': z.object({}),
  walk: z.object({ direction: Direction }),
  'walk-to': z.object({ destination: Point }),
  say: z.object({ channel: z.string(), text: z.string().max(255) }),
  logout: z.object({}),
} as const satisfies Record<C2SName, z.ZodType>;

export const S2C_SCHEMAS = {
  pong: z.object({ t: z.number() }),
  welcome: z.object({ characterId: z.string(), contentVersion: z.string() }),
  /**
   * O estado ATUAL completo, nunca um replay (§16.2).
   *
   * Voltar depois de seis horas precisa mostrar onde o personagem está agora, quanto rendeu e
   * a lista curta de eventos notáveis. Tentar animar seis horas de eventos é o erro óbvio, e
   * a versão sutil dele é mandar "os últimos N eventos" e deixar o cliente decidir — por isso
   * não existe campo para fila de eventos aqui, só o agregado e a lista notável.
   *
   * É o maior payload do protocolo: numa hunt cheia são dezenas de entidades com estado. O
   * codec comprime acima do limiar sozinho.
   */
  'session-state': z.object({
    /**
     * `sessionType`, e não `type`: `type` é o discriminador da MENSAGEM em todo o protocolo,
     * e o codec o remove antes de serializar (`const { type, ...props } = msg`). Um campo de
     * carga com esse nome é apagado no caminho e a mensagem inteira passa a ser recusada na
     * validação do outro lado — sem erro, porque `decodeS2C` devolve `null` em silêncio.
     */
    sessionType: z.string(),
    elapsedMs: z.number(),
    /** Quem é o jogador nesta instância — sem isto a câmera não tem em quem centrar. */
    self: z.object({
      creatureId: z.number().int(),
      characterId: z.string(),
      health: z.number(), maxHealth: z.number(),
      mana: z.number(), maxMana: z.number(),
      level: z.number().int(), xp: z.number(),
    }),
    world: z.object({
      mapId: z.string().nullable(),
      creatures: z.array(CreatureState),
    }),
    aggregates: Aggregates,
    notableEvents: z.array(NotableEvent),
  }),
  'instance-enter': z.object({ instanceId: z.string(), map: z.string() }),
  'creature-appear': z.object({
    id: z.number().int(),
    position: Point, appearanceId: z.number().int(), name: z.string(),
    health: z.number(), maxHealth: z.number(),
  }),
  // Um passo é enviado UMA vez, com origem, destino e duração. O cliente interpola o
  // intervalo inteiro — não existe snapshot por tick (ADR 0001, seção de banda).
  'creature-move': z.object({
    id: z.number().int(),
    from: Point, to: Point, durationMs: z.number().positive(), pushed: z.boolean().optional(),
  }),
  'creature-disappear': z.object({ id: z.number().int() }),
  'creature-health': z.object({ id: z.number().int(), health: z.number(), maxHealth: z.number() }),
  'player-stats': z.object({
    health: z.number(), maxHealth: z.number(), mana: z.number(), maxMana: z.number(),
    level: z.number().int(), xp: z.number(), capacity: z.number(), gold: z.number(), staminaMs: z.number(),
  }),
  'experience-gain': z.object({ amount: z.number(), sourceId: z.number().int().optional() }),
  'system-message': z.object({ level: z.enum(['info', 'warning', 'error']), text: z.string() }),
  'chat-message': z.object({ channel: z.string(), author: z.string(), text: z.string() }),
  /**
   * O extrato: a sessão acabou, por quê, e o que rendeu (§16.2, ADR 0010).
   *
   * O `reason` não é enfeite. "Sua hunt foi encerrada por manutenção" é aceitável; sumir sem
   * explicação não é — e é assim que um jogo idle perde a confiança de quem deixou o
   * personagem rendendo.
   */
  'session-ended': z.object({
    reason: z.enum(['manual-exit', 'exit-rule', 'death', 'drain', 'completed']),
    aggregates: Aggregates,
    notableEvents: z.array(NotableEvent),
  }),
} as const satisfies Record<S2CName, z.ZodType>;

export type C2SProps<N extends C2SName> = z.infer<(typeof C2S_SCHEMAS)[N]>;
export type S2CProps<N extends S2CName> = z.infer<(typeof S2C_SCHEMAS)[N]>;

/**
 * Carga de uma mensagem, com o caso vazio tratado.
 *
 * `z.object({})` infere `Record<string, never>` — um objeto que não aceita chave NENHUMA. A
 * interseção `{ type: 'logout' } & Record<string, never>` é impossível de satisfazer, então
 * `logout`, `client-ready` e `session-attach` eram, na prática, **impossíveis de construir em
 * código tipado**: o cliente não conseguia mandar nenhuma das três. Só não tinha aparecido
 * porque ninguém tinha tentado.
 *
 * O teste é `string extends keyof P`: só um objeto com assinatura de índice tem `string`
 * entre as chaves; um payload de verdade tem os nomes dos próprios campos.
 */
type Payload<P> = string extends keyof P ? unknown : P;

export type C2SMessage = { [N in C2SName]: { type: N } & Payload<C2SProps<N>> }[C2SName];
export type S2CMessage = { [N in S2CName]: { type: N } & Payload<S2CProps<N>> }[S2CName];
