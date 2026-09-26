// scripts/catalog/generated-writer.ts — escreve `packages/content/data/<tipo>/generated/
// <fatia>.json` (ADR 0038 decisão 2): um array ordenado por id, por fatia/categoria do Canary,
// com o bloco `source` de CADA entidade — nunca um arquivo por entidade (inviabilizaria revisão
// de PR com 1.656 monstros) nem um blob sem proveniência.
//
// O que sai daqui é sempre a transcrição PURA do Canary: nenhuma correção nossa é aplicada
// aqui — isso é `overrides/`, mesclado quando o conteúdo é CARREGADO
// (`packages/content/src/load.ts`), nunca quando é gerado. Reimportar produz sempre o mesmo
// JSON para o mesmo commit (ADR 0038 decisão 2/consequências): a ordem por id, a formatação
// determinística e a ausência de correção aqui são as três coisas que tornam isso verdade.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CatalogSource {
  readonly engine: 'canary' | 'forgottenserver';
  /** Sha completo do commit de onde o número saiu — `readSourceCommit` (`env.ts`). */
  readonly commit: string;
  /** Caminho do arquivo de origem, relativo à raiz do checkout (`items.xml`, `monster/…/rat.lua`). */
  readonly path: string;
}

/**
 * Uma entidade gerada. `id` e `source` são obrigatórios; o resto é o formato específico do
 * tipo (item, monstro, …) — este módulo não conhece schema nenhum, só ordena e escreve.
 */
export interface CatalogEntity {
  readonly id: string;
  readonly source: CatalogSource;
  readonly [field: string]: unknown;
}

/** Ordena por id (ordem de string, estável) — a MESMA ordem toda vez, para o diff ficar mínimo. */
export function sortById(entities: readonly CatalogEntity[]): CatalogEntity[] {
  return [...entities].sort((a, b) => a.id.localeCompare(b.id));
}

/** JSON legível (2 espaços), ordenado por id, terminado em nova linha. */
export function formatGeneratedSlice(entities: readonly CatalogEntity[]): string {
  return `${JSON.stringify(sortById(entities), null, 2)}\n`;
}

export function writeGeneratedSlice(path: string, entities: readonly CatalogEntity[]): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, formatGeneratedSlice(entities));
}

/** O que já está commitado em `generated/<fatia>.json` — usado pelo `--check`. */
export function readGeneratedSlice(path: string): CatalogEntity[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${path}: esperava um array, achou ${typeof parsed}`);
  return parsed as CatalogEntity[];
}

/** Todo arquivo `.json` direto de um diretório `generated/`, por nome de fatia (sem `.json`). */
export function listGeneratedSlices(dir: string): ReadonlyMap<string, CatalogEntity[]> {
  const slices = new Map<string, CatalogEntity[]>();
  if (!existsSync(dir)) return slices;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    slices.set(name.slice(0, -'.json'.length), readGeneratedSlice(join(dir, name)));
  }
  return slices;
}
