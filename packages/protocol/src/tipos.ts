// Um schema Zod por mensagem. É ele que valida a entrada ANTES de virar estado — mensagem
// malformada é recusada com erro tipado, nunca aplicada pela metade (invariante 4).

import { z } from 'zod';
import type { NomeC2S, NomeS2C } from './mensagens.js';

const Ponto = z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() });
const Direcao = z.enum(['norte', 'leste', 'sul', 'oeste']);

export const ESQUEMAS_C2S = {
  authenticate: z.object({ ticket: z.string().min(1), versaoDoCliente: z.string() }),
  ping: z.object({ t: z.number() }),
  'client-ready': z.object({}),
  'session-attach': z.object({}),
  walk: z.object({ direcao: Direcao }),
  'walk-to': z.object({ destino: Ponto }),
  say: z.object({ canal: z.string(), texto: z.string().max(255) }),
  logout: z.object({}),
} as const satisfies Record<NomeC2S, z.ZodType>;

export const ESQUEMAS_S2C = {
  pong: z.object({ t: z.number() }),
  welcome: z.object({ personagemId: z.string(), versaoDeConteudo: z.string() }),
  'session-state': z.object({
    tipo: z.string(),
    decorridoMs: z.number(),
    eu: z.unknown(),
    mundo: z.unknown(),
    agregados: z.unknown(),
    eventosNotaveis: z.array(z.unknown()),
  }),
  'instance-enter': z.object({ instanciaId: z.string(), mapa: z.string() }),
  'creature-appear': z.object({
    id: z.number().int(),
    posicao: Ponto,
    aparenciaId: z.number().int(),
    nome: z.string(),
    vida: z.number(),
    vidaMaxima: z.number(),
  }),
  // Um passo é enviado UMA vez, com origem, destino e duração. O cliente interpola o
  // intervalo inteiro — não existe snapshot por tick (ADR 0001, seção de banda).
  'creature-move': z.object({
    id: z.number().int(),
    de: Ponto,
    para: Ponto,
    duracaoMs: z.number().positive(),
    empurrado: z.boolean().optional(),
  }),
  'creature-disappear': z.object({ id: z.number().int() }),
  'creature-health': z.object({ id: z.number().int(), vida: z.number(), vidaMaxima: z.number() }),
  'player-stats': z.object({
    vida: z.number(), vidaMaxima: z.number(),
    mana: z.number(), manaMaxima: z.number(),
    level: z.number().int(), xp: z.number(),
    capacidade: z.number(), gold: z.number(),
    staminaMs: z.number(),
  }),
  'experience-gain': z.object({ quantidade: z.number(), origemId: z.number().int().optional() }),
  'system-message': z.object({ nivel: z.enum(['info', 'aviso', 'erro']), texto: z.string() }),
  'chat-message': z.object({ canal: z.string(), autor: z.string(), texto: z.string() }),
} as const satisfies Record<NomeS2C, z.ZodType>;

export type PropsC2S<N extends NomeC2S> = z.infer<(typeof ESQUEMAS_C2S)[N]>;
export type PropsS2C<N extends NomeS2C> = z.infer<(typeof ESQUEMAS_S2C)[N]>;

export type MensagemC2S = { [N in NomeC2S]: { type: N } & PropsC2S<N> }[NomeC2S];
export type MensagemS2C = { [N in NomeS2C]: { type: N } & PropsS2C<N> }[NomeS2C];
