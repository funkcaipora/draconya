// Montagem e validação do conteúdo. PURO: nenhuma leitura de disco acontece aqui, para este
// módulo poder ser importado por `sim` sem arrastar `node:fs` junto (invariante 1).
// Quem lê arquivo é `@draconya/content/load`, e o lint impede `sim` de importar de lá.

import { z } from 'zod';
import { buildRoute, buildTilemap } from './map.js';
import type { Route, Tilemap } from './map.js';
import { huntSchema, monsterSchema, routeSchema, tilemapSchema, vocationSchema } from './schemas.js';
import type { Hunt, Monster, Vocation } from './schemas.js';

export interface Content {
  /**
   * Identidade do conjunto. É ela que a sessão congela na criação (invariante 7): uma hunt
   * iniciada na versão N termina na versão N, mesmo com deploy no meio.
   */
  readonly version: string;
  readonly monsters: ReadonlyMap<string, Monster>;
  readonly hunts: ReadonlyMap<string, Hunt>;
  readonly vocations: ReadonlyMap<string, Vocation>;
  readonly maps: ReadonlyMap<string, Tilemap>;
  readonly routes: ReadonlyMap<string, Route>;
  /** Valores marcados como não decididos no PRD, para o boot conseguir avisar. */
  readonly openValues: readonly string[];
}

export interface RawContent {
  readonly monsters: readonly unknown[];
  readonly hunts: readonly unknown[];
  readonly vocations: readonly unknown[];
  readonly maps?: readonly unknown[];
  readonly routes?: readonly unknown[];
}

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
  const mapData = parseAll('map', raw.maps ?? [], tilemapSchema, problems);
  const routeData = parseAll('route', raw.routes ?? [], routeSchema, problems);

  const maps = new Map<string, Tilemap>();
  for (const data of mapData.values()) maps.set(data.id, buildTilemap(data));

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
  }

  if (problems.length > 0) throw new ContentError(problems);

  const openValues = [...vocations.values()]
    .filter((v) => v._open !== undefined)
    .map((v) => `vocation/${v.id}: ${v._open ?? ''}`);

  return {
    version: computeVersion(raw),
    monsters,
    hunts,
    vocations,
    maps,
    routes,
    openValues,
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
