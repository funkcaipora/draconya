// Schemas de todo dado de jogo. São a definição normativa: o que não passa aqui não entra
// na simulação, e conteúdo inválido derruba o boot em vez de virar bug de balanceamento
// três semanas depois.

import { z } from 'zod';

/** Referência a uma aparência no pacote de assets. NUNCA um caminho de arquivo (invariante 6). */
const appearanceId = z.number().int().positive();

export const monsterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  outfitId: appearanceId,
  recommendedLevel: z.number().int().positive(),
  health: z.number().int().positive(),
  experience: z.number().int().nonnegative(),
  /** Dano por ataque, antes de defesa. */
  attack: z.number().int().nonnegative(),
  armor: z.number().int().nonnegative(),
  /** Milissegundos entre ataques. Tempo decorrido, nunca contagem de tick (invariante 2). */
  attackIntervalMs: z.number().int().positive(),
  /** Tiles por passo de movimento, em milissegundos. */
  stepDurationMs: z.number().int().positive(),
  /** Raio de agressão, em tiles. */
  aggroRadius: z.number().int().nonnegative(),
  loot: z.array(
    z.object({
      itemId: z.string().min(1),
      chance: z.number().min(0).max(1),
      min: z.number().int().positive().default(1),
      max: z.number().int().positive().default(1),
    }),
  ).default([]),
});

export const huntDifficultySchema = z.object({
  /** Monstros por ponto de spawn. Sem variação aleatória de densidade no MVP (§14.5). */
  perSpawnPoint: z.number().int().positive(),
  composition: z.array(
    z.object({ monsterId: z.string().min(1), weight: z.number().positive() }),
  ).min(1),
  respawnDelayMs: z.number().int().positive(),
});

export const huntSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  recommendedLevel: z.number().int().positive(),
  mapId: z.string().min(1),
  difficulties: z.record(
    z.enum(['beginner', 'professional', 'hero', 'legendary']),
    huntDifficultySchema,
  ).refine((d) => Object.keys(d).length > 0, 'a hunt precisa de ao menos uma dificuldade'),
});

export const vocationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  healthPerLevel: z.number().int().nonnegative(),
  manaPerLevel: z.number().int().nonnegative(),
  capacityPerLevel: z.number().int().nonnegative(),
  /**
   * Marcador de valor ainda não decidido no PRD. Palpite disfarçado de decisão é o que faz
   * ninguém lembrar de voltar — o carregador avisa no boot, e o `docs-check` conta.
   */
  _open: z.string().optional(),
});

export type Monster = z.infer<typeof monsterSchema>;
export type Hunt = z.infer<typeof huntSchema>;
export type HuntDifficulty = z.infer<typeof huntDifficultySchema>;
export type Vocation = z.infer<typeof vocationSchema>;

// --- mapa e rota (FUN-9) -------------------------------------------------------------------

const point = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  z: z.number().int(),
});

/**
 * O mapa vem como grade de caracteres, uma string por linha: `#` bloqueia, qualquer outro
 * caractere é livre.
 *
 * Escolha deliberada sobre um formato binário compacto: mapa é conteúdo, e conteúdo se edita
 * e se revisa. Numa grade ASCII o diff de um pull request mostra a parede que mudou; num
 * blob base64 mostra que "o mapa mudou". O custo é tamanho de arquivo, que não importa para
 * dezenas de mapas — e a conversão para bitmap acontece uma vez, no carregamento.
 */
export const tilemapSchema = z.object({
  id: z.string().min(1),
  z: z.number().int(),
  grid: z.array(z.string().min(1)).min(1),
});

export const routeSchema = z.object({
  id: z.string().min(1),
  mapId: z.string().min(1),
  /** Ordenada, e fecha um laço: o último tile é adjacente ao primeiro (§14.4). */
  tiles: z.array(point).min(2),
  spawnPoints: z.array(
    z.object({
      /** Índice na rota. Ancorar no índice, e não em coordenada, mantém rota e spawn juntos. */
      routeIndex: z.number().int().nonnegative(),
      radius: z.number().int().positive().default(3),
    }),
  ).default([]),
});

export type TilemapData = z.infer<typeof tilemapSchema>;
export type RouteData = z.infer<typeof routeSchema>;
export type Point = z.infer<typeof point>;
