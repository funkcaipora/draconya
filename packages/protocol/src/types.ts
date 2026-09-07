// Um schema Zod por mensagem. É ele que valida a entrada ANTES de virar estado — mensagem
// malformada é recusada com erro tipado, nunca aplicada pela metade (invariante 4).

import { z } from 'zod';
import type { C2SName, S2CName } from './messages.js';

const Point = z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() });
const Direction = z.enum(['north', 'east', 'south', 'west']);

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
  'session-state': z.object({
    type: z.string(), elapsedMs: z.number(), self: z.unknown(), world: z.unknown(),
    aggregates: z.unknown(), notableEvents: z.array(z.unknown()),
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
} as const satisfies Record<S2CName, z.ZodType>;

export type C2SProps<N extends C2SName> = z.infer<(typeof C2S_SCHEMAS)[N]>;
export type S2CProps<N extends S2CName> = z.infer<(typeof S2C_SCHEMAS)[N]>;

export type C2SMessage = { [N in C2SName]: { type: N } & C2SProps<N> }[C2SName];
export type S2CMessage = { [N in S2CName]: { type: N } & S2CProps<N> }[S2CName];
