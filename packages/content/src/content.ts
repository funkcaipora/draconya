// Montagem e validação do conteúdo. PURO: nenhuma leitura de disco acontece aqui, para este
// módulo poder ser importado por `sim` sem arrastar `node:fs` junto (invariante 1).
// Quem lê arquivo é `@draconya/content/load`, e o lint impede `sim` de importar de lá.

import { z } from 'zod';
import { buildRoute, buildTilemap, isBlocked } from './map.js';
import type { Route, Tilemap } from './map.js';
import {
  combatSchema, huntSchema, monsterSchema, progressionSchema, routeSchema, staminaSchema,
  tilemapSchema, vocationSchema,
} from './schemas.js';
import type { Combat, Hunt, Monster, Progression, Stamina, Vocation } from './schemas.js';

export interface Content {
  /**
   * Identidade do conjunto. É ela que a sessão congela na criação (invariante 7): uma hunt
   * iniciada na versão N termina na versão N, mesmo com deploy no meio.
   */
  readonly version: string;
  readonly monsters: ReadonlyMap<string, Monster>;
  readonly hunts: ReadonlyMap<string, Hunt>;
  readonly vocations: ReadonlyMap<string, Vocation>;
  /** Base de progressão: sem ela não há como saber os stats de quem ainda não tem vocação. */
  readonly progression: Progression;
  /** Coeficientes de combate. O §12.1 os quer em conteúdo, nunca em código. */
  readonly combat: Combat;
  /** Teto e taxa de recuperação da stamina (§10). */
  readonly stamina: Stamina;
  readonly maps: ReadonlyMap<string, Tilemap>;
  readonly routes: ReadonlyMap<string, Route>;
  /**
   * O mapa da Cidade, com ponto de entrada (FUN-60). Opcional porque conteúdo de teste que só
   * fala de hunt não precisa dele — mas o conteúdo REAL precisa, e `load.ts` exige.
   */
  readonly city?: Tilemap;
  /** Valores marcados como não decididos no PRD, para o boot conseguir avisar. */
  readonly openValues: readonly string[];
}

export interface RawContent {
  readonly monsters: readonly unknown[];
  readonly hunts: readonly unknown[];
  readonly vocations: readonly unknown[];
  readonly progression?: readonly unknown[];
  readonly combat?: readonly unknown[];
  readonly stamina?: readonly unknown[];
  readonly maps?: readonly unknown[];
  readonly routes?: readonly unknown[];
  /** `{ mapId }` — qual dos mapas é a Cidade. Explícito, e não um id mágico `"city"`. */
  readonly city?: unknown;
}

/** `data/city.json`. Explícito, e não um id mágico: o boot diz qual mapa é a Cidade. */
const citySchema = z.object({ mapId: z.string().min(1) });

export class ContentError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`conteúdo inválido:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ContentError';
  }
}

/**
 * Valida, resolve referências cruzadas e devolve o conteúdo pronto.
 *
 * Lança em qualquer problema, e é para isso que serve: conteúdo inválido tem que impedir o
 * processo de subir. Degradar aqui — pular o monstro quebrado, usar um valor padrão — é como
 * um erro de digitação vira bug de balanceamento que ninguém liga à causa.
 */
export function buildContent(raw: RawContent): Content {
  const problems: string[] = [];

  const monsters = parseAll('monster', raw.monsters, monsterSchema, problems);
  const hunts = parseAll('hunt', raw.hunts, huntSchema, problems);
  const vocations = parseAll('vocation', raw.vocations, vocationSchema, problems);
  const progressions = parseAll('progression', raw.progression ?? [], progressionSchema, problems);
  const progression = progressions.get('baseline');
  // Ausente é ERRO, não conjunto vazio: sem a base não há como calcular os stats de quem
  // ainda não tem vocação, e todo personagem nasce assim (§7.4). Um default em código seria
  // exatamente o "nada em código" que esta issue proíbe.
  if (progression === undefined) {
    problems.push('progression/baseline.json ausente: sem ele não há stats de level 1');
  }
  const combats = parseAll('combat', raw.combat ?? [], combatSchema, problems);
  const combat = combats.get('baseline');
  // Mesma razão da base de progressão: sem coeficiente não há como resolver dano, e um
  // default em código faria o §12.1 deixar de valer no dia em que ninguém estivesse olhando.
  if (combat === undefined) {
    problems.push('combat/baseline.json ausente: sem ele não há como resolver dano');
  }
  const staminas = parseAll('stamina', raw.stamina ?? [], staminaSchema, problems);
  const stamina = staminas.get('baseline');
  // Ausente é ERRO pela mesma razão dos outros dois: a stamina é o TETO DE SIMULAÇÃO do
  // projeto (ADR 0001), e um default em código faria o número que sustenta a projeção de
  // custo morar onde ninguém procura por ele.
  if (stamina === undefined) {
    problems.push('stamina/baseline.json ausente: sem ele não há teto de stamina');
  }
  const mapData = parseAll('map', raw.maps ?? [], tilemapSchema, problems);
  const routeData = parseAll('route', raw.routes ?? [], routeSchema, problems);

  const maps = new Map<string, Tilemap>();
  for (const data of mapData.values()) {
    const map = buildTilemap(data);
    // Ponto de entrada em parede é conteúdo quebrado, e quebra AQUI, no boot — não no
    // primeiro personagem que tentar andar (FUN-60).
    if (map.entryPoint !== undefined && isBlocked(map, map.entryPoint.x, map.entryPoint.y)) {
      problems.push(
        `mapa "${map.id}": entryPoint (${map.entryPoint.x},${map.entryPoint.y}) está fora do ` +
          'mapa ou em parede',
      );
    }
    maps.set(data.id, map);
  }

  let city: Tilemap | undefined;
  if (raw.city !== undefined) {
    const parsed = citySchema.safeParse(raw.city);
    if (!parsed.success) {
      problems.push(`city: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    } else {
      city = maps.get(parsed.data.mapId);
      if (city === undefined) {
        problems.push(`city referencia mapa inexistente "${parsed.data.mapId}"`);
      } else if (city.entryPoint === undefined) {
        problems.push(`mapa da Cidade "${city.id}" não tem entryPoint — ninguém teria onde nascer`);
      }
    }
  }

  const routes = new Map<string, Route>();
  for (const data of routeData.values()) {
    const map = maps.get(data.mapId);
    if (!map) {
      problems.push(`rota "${data.id}" referencia mapa inexistente "${data.mapId}"`);
      continue;
    }
    try {
      routes.set(data.id, buildRoute(data, map));
    } catch (erro) {
      problems.push((erro as Error).message);
    }
  }

  // Loot de item aponta um catálogo de itens que ainda NÃO existe (FUN-63). Aceitar a linha
  // creditaria um item fantasma no primeiro abate; falhar no boot é o que impede o atalho.
  for (const monster of monsters.values()) {
    for (const line of monster.loot.items) {
      problems.push(
        `monstro "${monster.id}": loot.items referencia "${line.itemId}", e não existe catálogo ` +
          'de itens ainda — items precisa ser vazio',
      );
    }
  }

  // Referência cruzada: validar formato não basta. Uma hunt apontando monstro inexistente
  // passa em qualquer schema e só falha quando alguém entra nela.
  for (const hunt of hunts.values()) {
    for (const [difficultyName, difficulty] of Object.entries(hunt.difficulties)) {
      for (const entry of difficulty?.composition ?? []) {
        if (!monsters.has(entry.monsterId)) {
          problems.push(
            `hunt "${hunt.id}" (${difficultyName}) referencia monstro inexistente ` +
              `"${entry.monsterId}"`,
          );
        }
      }
    }
  }

  for (const hunt of hunts.values()) {
    if (maps.size > 0 && !maps.has(hunt.mapId)) {
      problems.push(`hunt "${hunt.id}" referencia mapa inexistente "${hunt.mapId}"`);
    }
    // A rota é o caminho inteiro que o bot percorre. Uma hunt que aponta rota inexistente
    // passa em qualquer schema e só falha quando alguém entra nela — e aí o sintoma é "a
    // hunt não abre", longe da causa.
    if (routes.size > 0 && !routes.has(hunt.routeId)) {
      problems.push(`hunt "${hunt.id}" referencia rota inexistente "${hunt.routeId}"`);
      continue;
    }
    const route = routes.get(hunt.routeId);
    if (route !== undefined && route.mapId !== hunt.mapId) {
      problems.push(
        `hunt "${hunt.id}" está no mapa "${hunt.mapId}" mas a rota "${hunt.routeId}" é do ` +
          `mapa "${route.mapId}"`,
      );
    }
  }

  if (problems.length > 0) throw new ContentError(problems);

  // Todo `_open` do conteúdo, venha de onde vier. Marcar um valor como provisório no JSON e
  // o boot não repetir isso é a mesma coisa que não marcar — o aviso existe justamente para
  // alguém lembrar de voltar.
  const openValues = [
    ...[...vocations.values()]
      .filter((v) => v._open !== undefined)
      .map((v) => `vocation/${v.id}: ${v._open ?? ''}`),
    ...(progression?._open === undefined
      ? []
      : [`progression/${progression.id}: ${progression._open}`]),
    ...(combat?._open === undefined ? [] : [`combat/${combat.id}: ${combat._open}`]),
    ...(stamina?._open === undefined ? [] : [`stamina/${stamina.id}: ${stamina._open}`]),
  ];

  return {
    version: computeVersion(raw),
    monsters,
    hunts,
    vocations,
    progression: progression as Progression,
    combat: combat as Combat,
    stamina: stamina as Stamina,
    maps,
    routes,
    openValues,
    ...(city === undefined ? {} : { city }),
  };
}

function parseAll<S extends z.ZodType<{ id: string }>>(
  kind: string,
  entries: readonly unknown[],
  schema: S,
  problems: string[],
): Map<string, z.infer<S>> {
  const byId = new Map<string, z.infer<S>>();
  for (const [index, entry] of entries.entries()) {
    const parsed = schema.safeParse(entry);
    if (!parsed.success) {
      // O id vem do dado cru: sem ele, a mensagem diria só "item #3", e achar qual arquivo
      // está errado num diretório com dezenas vira caça ao tesouro.
      const id = typeof entry === 'object' && entry !== null && 'id' in entry
        ? String((entry as { id: unknown }).id)
        : `#${index}`;
      problems.push(`${kind} "${id}": ${describeIssues(parsed.error)}`);
      continue;
    }
    const value = parsed.data;
    if (byId.has(value.id)) {
      problems.push(`${kind} "${value.id}" duplicado`);
      continue;
    }
    byId.set(value.id, value);
  }
  return byId;
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(raiz)'} ${i.message}`).join('; ');
}

/**
 * Hash determinístico do conjunto (FNV-1a sobre JSON canônico).
 *
 * Determinístico entre máquinas de propósito: todos os nós precisam calcular a MESMA versão,
 * senão uma sessão migrada acha que o conteúdo mudou. Não é criptográfico e não precisa ser —
 * o que se quer é detectar mudança, não resistir a adversário.
 */
export function computeVersion(raw: RawContent): string {
  const canonical = JSON.stringify(raw, ordenarChaves);
  let hash = 0x811c_9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x0100_0193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Ordena chaves para o hash não depender da ordem em que o JSON foi escrito. */
function ordenarChaves(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
  );
}
