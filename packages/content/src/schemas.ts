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
  /**
   * Até onde o monstro alcança para atacar, em tiles. `1` é corpo a corpo.
   *
   * Separado do raio de agressão de propósito: um monstro que persegue de longe e só bate
   * colado é comportamento diferente de um que atira à distância, e a diferença é conteúdo.
   */
  attackRange: z.number().int().positive().default(1),
  /** Raio a partir do qual ele desiste do alvo e volta ao posto. Zero = nunca desiste. */
  leashRadius: z.number().int().nonnegative().default(0),
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
  /**
   * A rota que o bot percorre. **Apontada, não inferida.**
   *
   * Deduzir a rota pelo `mapId` funcionaria hoje, com uma rota por mapa, e falharia em
   * silêncio no dia em que um mapa tivesse duas — a hunt passaria a andar por um caminho que
   * ninguém escolheu, e nada no arquivo diria por quê. O §14.4 dá UMA rota a cada hunt; o
   * campo diz qual.
   */
  routeId: z.string().min(1),
  /**
   * `partialRecord`, e não `record`: uma hunt define as dificuldades que fazem sentido para
   * ela, não obrigatoriamente as quatro. É o que o `refine` abaixo sempre disse — exigir ao
   * menos uma só faz sentido se nem todas forem obrigatórias.
   *
   * A distinção passou a ser explícita no zod 4, onde `record` com chave de enum virou
   * exaustivo. No zod 3 as duas se escreviam igual, e o comportamento era este.
   */
  difficulties: z.partialRecord(
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

/**
 * A tabela base de progressão: onde o personagem começa, e como cresce ENQUANTO NÃO TEM
 * vocação (§7.4 — ela é escolhida no level 8).
 *
 * O PRD (§9.3) define só o incremento POR VOCAÇÃO. Base e níveis 1–7 não estão decididos, e
 * é por isso que este arquivo carrega `_open`: o jogo não sobe sem esses números, mas eles
 * não podem parecer decisão de balanceamento quando são provisório.
 */
export const progressionSchema = z.object({
  id: z.literal('baseline'),
  startingHealth: z.number().int().positive(),
  startingMana: z.number().int().nonnegative(),
  startingCapacity: z.number().int().positive(),
  /** Incremento por level ATÉ a escolha de vocação. */
  healthPerLevel: z.number().int().nonnegative(),
  manaPerLevel: z.number().int().nonnegative(),
  capacityPerLevel: z.number().int().nonnegative(),
  /** Level em que a vocação é escolhida, e a partir do qual ela passa a reger o crescimento. */
  vocationLevel: z.number().int().positive(),
  /**
   * Milissegundos por tile andado. Fica aqui, e não em `combat`, porque velocidade é
   * atributo do personagem: quando haste e botas existirem, elas modificam ESTE número.
   */
  stepDurationMs: z.number().int().positive(),
  /**
   * A curva de XP, como FÓRMULA e não como tabela: `base * level^exponent` é a XP para
   * completar aquele level.
   *
   * Tabela de 500 linhas seria mais expressiva e é o caminho errado aqui. A curva vai ser
   * rebalanceada muitas vezes, e rebalancear uma tabela é reescrever 500 linhas à mão — o que
   * na prática significa que ela nunca é rebalanceada. Dois números mudam a curva inteira, e
   * a forma continua legível para quem balanceia.
   */
  xp: z.object({
    base: z.number().positive(),
    exponent: z.number().positive(),
  }),
  /**
   * Penalidade de morte (§26.2). Mora aqui, junto da curva, porque ela é definida COMO
   * fração da curva — separar as duas é como as duas divergem numa rebalanceada.
   */
  deathPenalty: z.object({
    /** Fração da XP necessária para completar o level atual. §26.2: 60%. */
    fraction: z.number().min(0).max(1),
    /** A mesma fração para quem tem Premium. §26.2: 54%. */
    premiumFraction: z.number().min(0).max(1),
    /** Abaixo deste level a penalidade não derruba ninguém. §26.2: 8. */
    levelFloor: z.number().int().positive(),
  }),
  _open: z.string().optional(),
});

export type Progression = z.infer<typeof progressionSchema>;

/**
 * Coeficientes de combate. O §12.1 é explícito: fórmula e parâmetro são CONTEÚDO, não código.
 *
 * O que o PRD decide (§12.2) e o que ele não decide estão separados de propósito — o que não
 * está decidido carrega `_open`, para não passar por escolha de balanceamento.
 */
export const combatSchema = z.object({
  id: z.literal('baseline'),
  /** §12.2 DECIDIDO: dodge não zera o dano, reduz à metade. */
  dodgeMultiplier: z.number().min(0).max(1),
  /** Quanto da armadura do alvo é subtraído, por tipo de ataque. */
  armorEffectiveness: z.object({
    melee: z.number().min(0).max(1),
    magic: z.number().min(0).max(1),
  }),
  /** Piso de dano, como fração do ataque: nem a armadura mais alta zera um golpe. */
  minimumDamageFraction: z.number().min(0).max(1),
  /**
   * O personagem **desarmado**: o que ele bate e o quanto aguenta sem equipamento nenhum.
   *
   * Existe porque o jogo tem hunt antes de ter item. Quando o equipamento chegar, estes
   * números continuam sendo o piso — o personagem sem nada nas mãos — e o item passa a somar
   * em cima. É o oposto de deixar o valor em código e "trocar depois": ali ele nunca é
   * trocado, porque ninguém encontra.
   */
  player: z.object({
    attackPower: z.number().int().nonnegative(),
    attackIntervalMs: z.number().int().positive(),
    /** Alcance em tiles. `1` é corpo a corpo — o único que existe hoje. */
    attackRange: z.number().int().positive().default(1),
    armor: z.number().int().nonnegative(),
    dodgeChance: z.number().min(0).max(1),
  }),
  _open: z.string().optional(),
});

export type Combat = z.infer<typeof combatSchema>;

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
