// scripts/catalog/registry.ts — o `<tipo>` que `pnpm catalog:import <tipo>` aceita, e o que
// roda para cada um.
//
// Vazio nesta issue (M34-01/#572): é infraestrutura pura, e registrar um `<tipo>` de verdade —
// itens do items.xml, monstros do Lua — é o trabalho de #573 em diante (ADR 0038). Um módulo de
// importador novo se registra chamando `registerCatalogType` no import do próprio arquivo (ver
// o padrão comentado abaixo); `import.ts` só precisa importar o módulo para o registro acontecer.

import type { CatalogEntity } from './generated-writer.js';
import type { SkippedEntity } from './report.js';

export interface CatalogImportContext {
  /** `things/sources/canary` desta máquina (resolvido por `env.ts`). */
  readonly canaryDir: string;
  /** `things/sources/forgottenserver`, para a correção de velocidade da decisão 4 do ADR 0037. */
  readonly forgottenServerDir: string;
  /** O commit do Canary neste `canaryDir` (`readSourceCommit`). */
  readonly canaryCommit: string;
  readonly forgottenServerCommit: string;
}

export interface CatalogImportResult {
  /** Nome da fatia (o arquivo `generated/<fatia>.json`) → as entidades dela. */
  readonly slices: ReadonlyMap<string, readonly CatalogEntity[]>;
  readonly skipped: readonly SkippedEntity[];
}

export interface CatalogType {
  /** O `<tipo>` da linha de comando — `items`, `monsters`, … */
  readonly id: string;
  /** `packages/content/data/<tipo>`, relativo à raiz do repositório. */
  readonly dataDir: string;
  readonly run: (ctx: CatalogImportContext) => CatalogImportResult;
}

const registry = new Map<string, CatalogType>();

export function registerCatalogType(type: CatalogType): void {
  if (registry.has(type.id)) throw new Error(`tipo de catálogo "${type.id}" já registrado`);
  registry.set(type.id, type);
}

export function getCatalogType(id: string): CatalogType | undefined {
  return registry.get(id);
}

export function listCatalogTypes(): readonly CatalogType[] {
  return [...registry.values()];
}

/** Só para teste: um registro isolado não polui o `describe` seguinte. */
export function resetCatalogTypesForTest(): void {
  registry.clear();
}

// O formato que #573 (itens) e os importadores seguintes registram, por exemplo:
//
//   import { registerCatalogType } from '../registry.js';
//   registerCatalogType({
//     id: 'items',
//     dataDir: 'packages/content/data/items',
//     run: (ctx) => { … lê items.xml, devolve { slices, skipped } … },
//   });
//
// E `import.ts` importa o módulo (`import './items.js';`) só pelo efeito colateral do registro —
// o mesmo padrão que um roteador de comandos usa em qualquer linguagem.
