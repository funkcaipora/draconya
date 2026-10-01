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
// **O ramo garantido da faca vem ANTES da tabela.** `if item.itemid == 5908 then … elseif
// target.itemid == 4301 then` rende o item `12172` ao jogador sem sorteio, sem conferir quest e
// sem transformar o cadáver — o segundo estágio do coelho (`6017` 10 s → `4301` 300 s) dá um pé de
// coelho a cada uso, até decair. `readGuaranteedBranches` lê esses ramos como DADO e só aceita o
// que o Lua faz sem condição: um `elseif target.itemid == N then` cujo corpo é só falar, dar um
// item e `return true`. Os outros ramos do mesmo `if` (quest com armazenamento, `transform`, sorteio
// inline) não são caça e ficam fora. O estágio vira `Skinning.guaranteed` (`startMs`, `durationMs`,
// material), tirado da cadeia `decayTo` do monstro.
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

/**
 * Um ramo do `if item.itemid == <ferramenta> then` que rende um item SEM condição: `elseif
 * target.itemid == <alvo> then`, `player:addItem(<material>, <n>)`, `return true`.
 */
export interface GuaranteedBranch {
  /** A ferramenta do `if` externo (o `item.itemid` que o ramo confere). */
  readonly toolItemId: number;
  /** O id do item em que o cadáver está (`target.itemid`). */
  readonly targetItemId: number;
  /** O `addItem` do ramo. */
  readonly newItem: number;
  readonly quantity: number;
}

/** Uma linha de corpo que o ramo garantido aceita: comentário, fala, `return true` ou o `addItem`. */
const GUARANTEED_BODY_LINE = /^(?:--.*|player:say\(.*\)|return\s+true|player:addItem\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?$/;

/**
 * Os ramos `elseif target.itemid == N then` do `skinning.lua` que rendem um item sem condição, com
 * a ferramenta do `if item.itemid == F then` que os envolve. Só entra o ramo cujo CORPO é feito
 * exclusivamente de fala, comentário, `return true` e UM `player:addItem` — qualquer outra linha
 * (um `getStorageValue`, um sorteio, um `target:transform`/`remove`, um `if` aninhado) o tira, e a
 * condição com `and` nem chega a casar com o padrão. É o contrário de adivinhar: o que o Lua
 * condiciona fica fora, e o que ele dá a qualquer um entra com o número que ele escreve.
 */
export function readGuaranteedBranches(source: string): readonly GuaranteedBranch[] {
  const tools = [...source.matchAll(/\bif\s+item\.itemid\s*==\s*(\d+)\s+then\b/g)]
    .map((match) => ({ at: match.index, toolItemId: Number(match[1]) }));
  const branches: GuaranteedBranch[] = [];
  for (const match of source.matchAll(/\b(?:elseif|if)\s+target\.itemid\s*==\s*(\d+)\s+then\b/g)) {
    const rest = source.slice(match.index + match[0].length);
    const end = /^[ \t]*(?:elseif|else|end)\b/m.exec(rest)?.index ?? rest.length;
    let given: { newItem: number; quantity: number } | undefined;
    let clean = true;
    for (const raw of rest.slice(0, end).split('\n')) {
      const line = GUARANTEED_BODY_LINE.exec(raw.trim());
      if (line === null) { clean = false; break; }
      if (line[1] !== undefined) {
        if (given !== undefined) { clean = false; break; }
        given = { newItem: Number(line[1]), quantity: line[2] === undefined ? 1 : Number(line[2]) };
      }
    }
    const tool = tools.filter((candidate) => candidate.at < match.index).at(-1);
    if (!clean || given === undefined || tool === undefined) continue;
    branches.push({ toolItemId: tool.toolItemId, targetItemId: Number(match[1]), ...given });
  }
  return branches;
}

/** Um estágio da cadeia do monstro que um ramo garantido confere. */
export interface GuaranteedStage {
  readonly branch: GuaranteedBranch;
  /** A idade em que o estágio abre: a soma das durações dos estágios anteriores da cadeia. */
  readonly startMs: number;
  readonly durationMs: number;
}

/**
 * Os estágios da cadeia do cadáver que algum ramo garantido confere, com a idade em que abrem.
 * `problem` quando um deles não decai (sem `duration` no `items.xml`): a janela não fecharia, e
 * isto vira `skipped` em vez de um número adivinhado.
 */
export function resolveGuaranteedStages(
  stages: readonly CorpseStage[], branches: readonly GuaranteedBranch[],
): readonly GuaranteedStage[] | { readonly problem: string } {
  const found: GuaranteedStage[] = [];
  let startMs = 0;
  for (const stage of stages) {
    for (const branch of branches.filter((candidate) => candidate.targetItemId === stage.itemId)) {
      if (stage.durationMs === undefined) {
        return { problem: `o estágio ${String(stage.itemId)} tem ramo garantido mas não tem duration no items.xml (não decai — a janela não fecha)` };
      }
      found.push({ branch, startMs, durationMs: stage.durationMs });
    }
    if (stage.durationMs === undefined) break;
    startMs += stage.durationMs;
  }
  return found;
}

export interface SkinningCatalog extends CatalogImportResult {
  /** Quantos monstros do Canary têm cadáver esfolável (antes do corte pelo catálogo do Draconya). */
  readonly skinnableInCanary: number;
}

export function readSkinningCatalog(ctx: CatalogImportContext, deps: SkinningReaderDeps): SkinningCatalog {
  const source = readFileSync(join(ctx.canaryDir, CANARY_SKINNING_LUA), 'utf8');
  const { tools, nonCreatureKeys, chanceScale, newItemMentions } = readSkinningTable(source);
  const branches = readGuaranteedBranches(source);
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
  /** Os monstros do catálogo que ganharam estágio garantido. */
  const guaranteedMonsters: string[] = [];
  let skinnableInCanary = 0;

  for (const path of listMonsterFiles(ctx.canaryDir)) {
    const text = readFileSync(join(ctx.canaryDir, path), 'utf8');
    const typeName = monsterTypeName(text);
    const corpseId = monsterCorpseId(text);
    if (typeName === undefined || corpseId === undefined) continue;
    const stages = corpseChain(corpseId, chains);
    const resolved = resolveSkinnableCorpse(stages, tools);
    const guaranteed = resolveGuaranteedStages(stages, branches);
    const id = slugify(typeName);
    const monsterSource: CatalogSource = { engine: 'canary', commit: ctx.canaryCommit, path };
    const skip = (reason: string): void => {
      skipped.push({ id, name: typeName, reason, source: monsterSource });
    };
    if (resolved === undefined) {
      // Um ramo garantido num cadáver sem estágio de tabela não cabe no schema (`stages` não é
      // vazio): fica em `skipped` em vez de sumir sem rastro.
      if ('problem' in guaranteed) skip(guaranteed.problem);
      else if (guaranteed.length > 0) skip('o cadáver só tem estágio de ramo garantido, sem estágio da tabela (o schema exige ao menos um)');
      continue;
    }
    skinnableInCanary += 1;
    if ('problem' in resolved) { skip(resolved.problem); continue; }
    if ('problem' in guaranteed) { skip(guaranteed.problem); continue; }
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
    // Os estágios garantidos (o `elseif target.itemid == N` da faca): a ferramenta do `if` externo
    // tem que ser a da tabela deste cadáver, e o material, um item do catálogo.
    const given: { canaryItemId: number; startMs: number; durationMs: number; materialId: string; quantity: number }[] = [];
    let givenProblem: string | undefined;
    for (const stage of guaranteed) {
      const { branch } = stage;
      const givenId = slugOfItem(branch.newItem);
      if (branch.toolItemId !== resolved.toolItemId) {
        givenProblem = `o ramo garantido do estágio ${String(branch.targetItemId)} é da ferramenta ${String(branch.toolItemId)}, e a tabela deste cadáver é da ${String(resolved.toolItemId)}`;
        break;
      }
      if (givenId === undefined || !deps.itemIds.has(givenId)) {
        givenProblem = `material garantido ${String(branch.newItem)} (${givenId ?? 'sem nome no items.xml'}) fora do catálogo de itens`;
        break;
      }
      given.push({
        canaryItemId: branch.targetItemId, startMs: stage.startMs, durationMs: stage.durationMs,
        materialId: givenId, quantity: branch.quantity,
      });
    }
    if (givenProblem !== undefined) { skip(givenProblem); continue; }
    if (given.length > 0) guaranteedMonsters.push(id);
    entities.push({
      id, toolId, materialId, chance: resolved.entry.value, stages: windows,
      ...(given.length > 0 ? { guaranteed: given } : {}), source: skinSource,
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
  const branchText = branches.map((branch) => `${String(branch.targetItemId)} → ${String(branch.newItem)} ×${String(branch.quantity)} `
    + `(${slugOfItem(branch.newItem) ?? '?'}, ferramenta ${String(branch.toolItemId)})`);
  notes.push(
    `Ramos garantidos da ferramenta (\`elseif target.itemid == N then\` que rende um item sem sorteio, sem conferir quest `
    + `e sem consumir o cadáver — o Canary os confere ANTES da tabela) (${String(branches.length)}): `
    + `${branchText.join(', ') || 'nenhum'}. Viram \`Skinning.guaranteed\` nos monstros do catálogo cuja cadeia de decaimento `
    + `passa pelo id (${String(guaranteedMonsters.length)}: ${guaranteedMonsters.join(', ') || 'nenhum'}). Os outros ramos `
    + `\`target.itemid ==\` do mesmo \`if\` (quest com armazenamento, transform, sorteio inline) não são caça e ficam fora.`,
  );

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
