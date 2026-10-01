// scripts/catalog/skinning.ts — o leitor de esfola de cadáver do Canary (M44-08, #626; ADR
// 0037/0038, ADR 0048 d.5/d.6, ADR 0053 d.5).
//
//   pnpm catalog:import skinning          # escreve packages/content/data/skinning/generated/*.json
//   pnpm catalog:import skinning --check  # regenera em memória e compara, não escreve nada
//
// Lê `data-otservbr-global/scripts/actions/tools/skinning.lua` como DADO (`lua-table.ts` avalia só
// expressão literal, nunca executa Lua — ADR 0019): `local config = { [ferramenta] = {
// [id do cadáver] = { value, newItem, after }, … } }`. As duas ferramentas são a obsidian knife
// (5908) e a blessed wooden stake (5942); `value` é a chance em `chanceRange = 100000`
// (`CREATURE_SKINNING_CHANCE = 25000`, 25 %) e `newItem` o material.
//
// **A chave do Lua é o id de um ITEM, não um monstro.** O Canary decide "esse cadáver se esfola?"
// pelo id que o cadáver É agora (`config[item.itemid][target.itemid]`), e o cadáver troca de id
// ao decair (`items.xml`: `decayTo`/`duration`) — o Dragon é `5973` por 10 s, `4025` por 300 s,
// `4026` por 300 s e `4027` por 60 s, e só os dois primeiros ids são chave. Então o importador
// cruza a tabela com o `monster.corpse` de cada monstro e SEGUE a cadeia de decaimento dele: os
// estágios cujo id é chave são a JANELA de esfola (`stages`); o resto da vida do cadáver não se
// esfola, e o `sim` recusa como o Canary recusa ("not possible"). Vários monstros compartilham o
// id (o `5969` é do Minotaur, do Minotaur Bruiser e do Depowered Minotaur; o `5995`, de todo
// demônio e do Orshabaal) — e o Canary esfola todos, chefes inclusive, porque a regra é pelo item.
//
// **A tentativa reinicia o decaimento.** Com ou sem sucesso o Canary roda `topItem:transform(
// skin.after)`, e o `Item::setID` do item novo reinicia o `duration` (e limpa o dono do cadáver):
// o cadáver esfolado vive o `duration` do `after` mais a cadeia `decayTo` dele (o Dragon esfolado
// vira `4026`: 300 s + 60 s do `4027`), e não mais o que faltava da vida de 670 s. O importador
// guarda essa soma por estágio (`afterTtlMs`, de `corpseTtlMsFromChain`), porque o `after` é da
// entrada de cada id.
//
// **"87 mapeamentos" é a contagem da palavra `newItem` no arquivo.** A issue conta as 87
// ocorrências, que incluem o código da função e os prêmios de quest. O que a tabela declara de
// fato são chaves simples (`[id] = { value, newItem, after }`), duas LISTAS de prêmio (o boss da
// Halloween, com armazenamento de quest de 4 h, e o mármore, escultura de item de mapa) e as
// quatro chaves de escultura de gelo — nenhuma dessas três é caça. Só as chaves que são estágio
// do cadáver de algum monstro viram esfola, e o resto fica listado nas notas do relatório, nunca
// em silêncio.
//
// **Só o que o catálogo carrega.** Um monstro que o Canary esfola mas o Draconya não tem
// (`packages/content/data/monsters/**`), e uma ferramenta ou material fora de `data/items/**`,
// saem em `skipped` com o motivo — a mesma disciplina de `spawns.ts`, e o boot recusaria a
// referência solta de qualquer jeito. Reimportar recupera o que o catálogo passar a ter.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { repoRootFrom } from './env.js';
import type { CatalogEntity, CatalogSource } from './generated-writer.js';
import { constantsFrom, evaluateAssignments, type LuaValue } from './lua-table.js';
import {
  CANARY_ITEMS_XML, corpseTtlMsFromChain, listMonsterFiles, monsterTypeName, readCorpseDecayChains,
  readItemNames, slugify, type DecayStage,
} from './monsters.js';
import { registerCatalogType, type CatalogImportContext, type CatalogImportResult } from './registry.js';
import type { SkippedEntity } from './report.js';
import { loadMonsterIds } from './spawns.js';

/** `skinning.lua`, dentro do checkout do Canary. */
export const CANARY_SKINNING_LUA = 'data-otservbr-global/scripts/actions/tools/skinning.lua';

/** `chanceRange` do Lua — o mesmo `SKINNING_CHANCE_SCALE` de `@draconya/content` (conferido abaixo). */
export const CANARY_SKINNING_CHANCE_SCALE = 100_000;

/** Limite de estágios ao seguir a cadeia — a mesma proteção de `corpseTtlMsFromChain`. */
const MAX_DECAY_STAGES = 32;

/** O que o leitor precisa do catálogo do Draconya, para não gerar referência solta. */
export interface SkinningReaderDeps {
  /** Os ids dos monstros carregados (`data/monsters/**`). */
  readonly monsterIds: ReadonlySet<string>;
  /** Os ids dos itens carregados (`data/items/**`) — ferramenta e material. */
  readonly itemIds: ReadonlySet<string>;
}

/** Uma entrada `[id do cadáver] = { value, newItem, after }` de UMA ferramenta. */
interface SkinEntry {
  readonly value: number;
  readonly newItem: number;
  /**
   * O `after` do Lua: o id em que o cadáver se TRANSFORMA quando a esfola é tentada
   * (`topItem:transform(skin.after)`, com sucesso ou sem). `undefined` quando a entrada não o
   * declara — o Lua cairia no `decayTo` do item, e esta importação não modela esse ramo.
   */
  readonly after: number | undefined;
}

/** `ferramenta (id do Canary) → id do cadáver → entrada`. */
type ToolTable = ReadonlyMap<number, ReadonlyMap<number, SkinEntry>>;

function isPlainRecord(value: LuaValue | undefined): value is { readonly [key: string]: LuaValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A tabela `config` do Lua, já como mapas numéricos. Entrada que não é `{ value, newItem }`
 * simples — o boss da abóbora e o mármore são LISTAS de prêmio — fica em `nonCreature`: é o que
 * o `skinning.lua` declara além de cadáver de criatura, e o relatório o lista.
 */
export function readSkinningTable(source: string): {
  readonly tools: ToolTable;
  readonly nonCreatureKeys: readonly number[];
  readonly chanceScale: number | undefined;
  readonly newItemMentions: number;
} {
  // `CREATURE_SKINNING_CHANCE` é uma `local` do próprio arquivo: o número sai dele, não daqui.
  const chance = /^local\s+CREATURE_SKINNING_CHANCE\s*=\s*(\d+)/m.exec(source)?.[1];
  const constants = constantsFrom(chance === undefined ? {} : { CREATURE_SKINNING_CHANCE: Number(chance) });
  const config = evaluateAssignments(source, 'config', constants);

  const tools = new Map<number, Map<number, SkinEntry>>();
  const nonCreatureKeys: number[] = [];
  for (const [toolKey, table] of Object.entries(config)) {
    const toolId = Number(toolKey);
    if (!Number.isInteger(toolId) || !isPlainRecord(table)) continue;
    const entries = new Map<number, SkinEntry>();
    for (const [corpseKey, raw] of Object.entries(table)) {
      const corpseId = Number(corpseKey);
      if (!Number.isInteger(corpseId)) continue;
      if (!isPlainRecord(raw) || typeof raw['value'] !== 'number' || typeof raw['newItem'] !== 'number') {
        nonCreatureKeys.push(corpseId);
        continue;
      }
      // `after` (o cadáver esfolado em que ele vira) entra só pela VIDA que ele tem: o `sim` não
      // tem outro cadáver — a esfola marca este como já esfolado —, mas o `transform` reinicia o
      // decaimento no `duration` do `after`, e é essa soma que vira `Skinning.stages[].afterTtlMs`.
      const after = raw['after'];
      entries.set(corpseId, {
        value: raw['value'], newItem: raw['newItem'], after: typeof after === 'number' ? after : undefined,
      });
    }
    tools.set(toolId, entries);
  }

  // `chanceRange` é uma `local` da função (`local charmMType, chanceRange = …, 100000`): a escala
  // que o `Skinning.chance` assume tem que ser a do arquivo.
  const range = /,\s*chanceRange\s*=[^\n]*,\s*(\d+)\s*$/m.exec(source)?.[1];
  return {
    tools, nonCreatureKeys, chanceScale: range === undefined ? undefined : Number(range),
    newItemMentions: (source.match(/newItem/g) ?? []).length,
  };
}

/** Um estágio da cadeia de decaimento do cadáver: o id do item e quanto ele dura. */
export interface CorpseStage {
  readonly itemId: number;
  /** `undefined`: o id não tem `duration` no `items.xml` — o último estágio, que não decai. */
  readonly durationMs: number | undefined;
}

/** A cadeia do cadáver desde `corpseId`, estágio a estágio (`items.xml`: `duration`/`decayTo`). */
export function corpseChain(
  corpseId: number, chains: ReadonlyMap<number, DecayStage>,
): readonly CorpseStage[] {
  const stages: CorpseStage[] = [];
  const visited = new Set<number>();
  let current: number | undefined = corpseId;
  for (let step = 0; step < MAX_DECAY_STAGES; step += 1) {
    if (current === undefined || current === 0 || visited.has(current)) break;
    visited.add(current);
    const stage = chains.get(current);
    if (stage === undefined) {
      stages.push({ itemId: current, durationMs: undefined });
      break;
    }
    stages.push({ itemId: current, durationMs: stage.durationSeconds * 1000 });
    current = stage.decayTo;
  }
  return stages;
}

export interface SkinnableCorpse {
  readonly toolItemId: number;
  readonly entry: SkinEntry;
  /**
   * Os estágios esfoláveis — o prefixo da cadeia cujos ids são chave da ferramenta, cada um com o
   * `after` que a ENTRADA DELE declara (o id em que o cadáver vira quando se tenta esfolá-lo).
   */
  readonly stages: readonly {
    readonly canaryItemId: number; readonly durationMs: number; readonly afterItemId: number;
  }[];
}

/**
 * Resolve a esfola de UM cadáver a partir da cadeia dele: os estágios que são chave (todos da
 * MESMA ferramenta, com o MESMO material e a MESMA chance) e que formam o PREFIXO da cadeia — a
 * janela é contínua desde a morte. `undefined` quando nenhum estágio é chave; `problem` quando a
 * tabela e a cadeia não fecham (o Canary teria dois materiais para o mesmo cadáver, ou um estágio
 * esfolável depois de um que não é), que vira `skipped` em vez de uma janela adivinhada.
 */
export function resolveSkinnableCorpse(
  stages: readonly CorpseStage[], tools: ToolTable,
): SkinnableCorpse | { readonly problem: string } | undefined {
  const keyOf = (itemId: number): { tool: number; entry: SkinEntry } | undefined => {
    for (const [tool, entries] of tools) {
      const entry = entries.get(itemId);
      if (entry !== undefined) return { tool, entry };
    }
    return undefined;
  };

  const skinnable: { canaryItemId: number; durationMs: number; afterItemId: number }[] = [];
  let first: { tool: number; entry: SkinEntry } | undefined;
  let prefixEnded = false;
  for (const stage of stages) {
    const key = keyOf(stage.itemId);
    if (key === undefined) { prefixEnded = true; continue; }
    if (prefixEnded) return { problem: `o estágio ${String(stage.itemId)} é esfolável depois de um que não é (a janela não é contínua)` };
    if (first === undefined) first = key;
    else if (key.tool !== first.tool || key.entry.newItem !== first.entry.newItem || key.entry.value !== first.entry.value) {
      return { problem: `os estágios do cadáver declaram ferramenta, material ou chance diferentes (${String(stage.itemId)})` };
    }
    if (stage.durationMs === undefined) {
      return { problem: `o estágio ${String(stage.itemId)} não tem duration no items.xml (não decai — a janela não fecha)` };
    }
    if (key.entry.after === undefined) {
      return { problem: `o estágio ${String(stage.itemId)} não declara \`after\` (o Canary usaria o decayTo, que esta importação não modela)` };
    }
    skinnable.push({ canaryItemId: stage.itemId, durationMs: stage.durationMs, afterItemId: key.entry.after });
  }
  if (first === undefined) return undefined;
  return { toolItemId: first.tool, entry: first.entry, stages: skinnable };
}

/** `monster.corpse = <id>` de um `.lua` de monstro — só a atribuição de topo, nunca um comentário. */
export function monsterCorpseId(source: string): number | undefined {
  const raw = /^monster\.corpse\s*=\s*(\d+)\s*$/m.exec(source)?.[1];
  return raw === undefined ? undefined : Number(raw);
}

export interface SkinningCatalog extends CatalogImportResult {
  /** Quantos monstros do Canary têm cadáver esfolável (antes do corte pelo catálogo do Draconya). */
  readonly skinnableInCanary: number;
}

export function readSkinningCatalog(ctx: CatalogImportContext, deps: SkinningReaderDeps): SkinningCatalog {
  const source = readFileSync(join(ctx.canaryDir, CANARY_SKINNING_LUA), 'utf8');
  const { tools, nonCreatureKeys, chanceScale, newItemMentions } = readSkinningTable(source);
  const chains = readCorpseDecayChains(join(ctx.canaryDir, CANARY_ITEMS_XML));
  const itemNames = readItemNames(join(ctx.canaryDir, CANARY_ITEMS_XML));
  const skinSource: CatalogSource = { engine: 'canary', commit: ctx.canaryCommit, path: CANARY_SKINNING_LUA };
  const slugOfItem = (id: number): string | undefined => {
    const name = itemNames.get(id);
    return name === undefined ? undefined : slugify(name);
  };

  const entities: CatalogEntity[] = [];
  const skipped: SkippedEntity[] = [];
  const seen = new Set<string>();
  const matchedKeys = new Set<number>();
  let skinnableInCanary = 0;

  for (const path of listMonsterFiles(ctx.canaryDir)) {
    const text = readFileSync(join(ctx.canaryDir, path), 'utf8');
    const typeName = monsterTypeName(text);
    const corpseId = monsterCorpseId(text);
    if (typeName === undefined || corpseId === undefined) continue;
    const stages = corpseChain(corpseId, chains);
    const resolved = resolveSkinnableCorpse(stages, tools);
    if (resolved === undefined) continue;

    const id = slugify(typeName);
    const monsterSource: CatalogSource = { engine: 'canary', commit: ctx.canaryCommit, path };
    const skip = (reason: string): void => {
      skipped.push({ id, name: typeName, reason, source: monsterSource });
    };
    skinnableInCanary += 1;
    if ('problem' in resolved) { skip(resolved.problem); continue; }
    for (const stage of resolved.stages) matchedKeys.add(stage.canaryItemId);

    if (seen.has(id)) { skip('id duplicado (o primeiro arquivo vence, como no importador de monstros)'); continue; }
    seen.add(id);
    if (!deps.monsterIds.has(id)) { skip('monstro fora do catálogo do Draconya'); continue; }

    const toolId = slugOfItem(resolved.toolItemId);
    const materialId = slugOfItem(resolved.entry.newItem);
    if (toolId === undefined || !deps.itemIds.has(toolId)) {
      skip(`ferramenta ${String(resolved.toolItemId)} (${toolId ?? 'sem nome no items.xml'}) fora do catálogo de itens`);
      continue;
    }
    if (materialId === undefined || !deps.itemIds.has(materialId)) {
      skip(`material ${String(resolved.entry.newItem)} (${materialId ?? 'sem nome no items.xml'}) fora do catálogo de itens`);
      continue;
    }
    // A vida do cadáver DEPOIS da tentativa, por estágio: o `Item::setID` do `after` reinicia o
    // decaimento no `duration` dele e segue a cadeia `decayTo` (`corpseTtlMsFromChain`, a mesma
    // soma do `corpseTtlMs` do monstro). Um `after` que não decai deixaria o cadáver para sempre —
    // vida que o `sim` não representa —, e vira `skipped` em vez de um número adivinhado.
    const windows: { canaryItemId: number; durationMs: number; afterTtlMs: number }[] = [];
    let openAfter: number | undefined;
    for (const stage of resolved.stages) {
      const afterTtlMs = corpseTtlMsFromChain(stage.afterItemId, chains);
      if (afterTtlMs === undefined) { openAfter = stage.afterItemId; break; }
      windows.push({ canaryItemId: stage.canaryItemId, durationMs: stage.durationMs, afterTtlMs });
    }
    if (openAfter !== undefined) {
      skip(`o \`after\` ${String(openAfter)} não tem duration no items.xml (o cadáver esfolado não decairia)`);
      continue;
    }
    entities.push({
      id, toolId, materialId, chance: resolved.entry.value, stages: windows, source: skinSource,
    });
  }

  const plainCount = [...tools.values()].reduce((sum, entries) => sum + entries.size, 0);
  const notes: string[] = [
    `${String(skinnableInCanary)} monstros do Canary têm cadáver esfolável (o \`monster.corpse\` ou um estágio da `
    + `cadeia de decaimento dele é chave do \`config\`); ${String(entities.length)} estão no catálogo do Draconya e `
    + `saem como entidade, ${String(skipped.length)} ficam fora do corte.`,
    `A issue #626 fala em "87 mapeamentos": é a contagem da palavra \`newItem\` no arquivo (${String(newItemMentions)}), que `
    + `inclui o código da função e os prêmios de quest. A tabela declara ${String(plainCount)} chaves simples (${String(matchedKeys.size)} `
    + `são estágio do cadáver de algum monstro do Canary) e ${String(nonCreatureKeys.length)} listas de prêmio.`,
    `\`chanceRange\` do Lua: ${chanceScale === undefined ? 'não encontrado' : String(chanceScale)}`
    + `${chanceScale === CANARY_SKINNING_CHANCE_SCALE ? ' (confere com `SKINNING_CHANCE_SCALE`)' : ' — DIFERE de `SKINNING_CHANCE_SCALE` (100000): o `Skinning.chance` deixou de estar na escala certa'}.`,
  ];
  const unmatched = [...tools].flatMap(([tool, entries]) => [...entries.keys()]
    .filter((corpseId) => !matchedKeys.has(corpseId))
    .map((corpseId) => `${String(corpseId)} (${itemNames.get(corpseId) ?? '?'}, ${slugOfItem(tool) ?? String(tool)})`));
  notes.push(
    `Chaves do \`config\` que nenhum monstro do Canary tem como estágio de cadáver (${String(unmatched.length)}): `
    + `${unmatched.length === 0 ? 'nenhuma' : unmatched.join(', ')}. São ids de item de mapa que nenhum \`monster.corpse\` `
    + 'nem estágio da cadeia dele alcança (o cadáver decorativo, os cubos de gelo da escultura) — ficam de fora, sem monstro.',
  );
  const lists = nonCreatureKeys.map((key) => `${String(key)} (${itemNames.get(key) ?? '?'})`);
  notes.push(
    `Entradas que são LISTA de prêmios, não um material só (${String(lists.length)}): ${lists.join(', ') || 'nenhuma'} — `
    + 'o boss da abóbora (armazenamento de quest de 4 h) e o mármore (escultura de item de mapa) não são caça.',
  );
  if (/target\.itemid\s*==\s*4301/.test(source)) {
    notes.push(
      'O ramo `target.itemid == 4301` da faca (quest Rottin Wood and the Married Men: o segundo estágio do cadáver do '
      + 'coelho rende o item 12172 sem sorteio e sem consumir o cadáver, sem conferir a quest) fica fora — é objetivo de '
      + 'quest, não caça, e o `sim` não tem quest. A esfola de coelho aqui é só a da tabela (a janela de 10 s do `6017`).',
    );
  }

  return {
    slices: new Map<string, CatalogEntity[]>([['skinning', entities]]),
    skipped, notes, skinnableInCanary,
  };
}

/** Os ids de `data/<tipo>` e a raiz do repositório — o que o registro passa ao leitor. */
export function loadSkinningDeps(repoRoot: string): SkinningReaderDeps {
  const data = resolve(repoRoot, 'packages', 'content', 'data');
  return { monsterIds: loadMonsterIds(join(data, 'monsters')), itemIds: loadMonsterIds(join(data, 'items')) };
}

registerCatalogType({
  id: 'skinning',
  dataDir: 'packages/content/data/skinning',
  run: (ctx) => readSkinningCatalog(ctx, loadSkinningDeps(repoRootFrom(import.meta.url))),
});
