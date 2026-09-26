// Leitura do conteúdo em disco. Ponto de entrada SEPARADO de propósito: usa `node:fs`, e
// `sim` é puro (invariante 1). O lint impede `sim` de importar deste caminho.
//
// Só `server` e `tools` importam daqui.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildContent } from './content.js';
import type { Content } from './content.js';

/**
 * Carrega e valida o conteúdo de um diretório. Lança em qualquer problema — conteúdo
 * inválido tem que derrubar o boot, e não chegar à simulação.
 */
export function loadContent(dir: string): Content {
  // Raiz ausente é ERRO, ao contrário das subpastas. A distinção importa: subpasta que ainda
  // não existe é conteúdo crescendo por partes, e vira conjunto vazio; raiz que não existe é
  // caminho errado, e tratá-la como vazia transforma erro de digitação em "conteúdo válido,
  // 0 monstros" — falso verde que passa despercebido até o jogo subir sem nada dentro.
  if (!existsSync(dir)) {
    throw new Error(`diretório de conteúdo não encontrado: ${dir}`);
  }
  return buildContent({
    monsters: readJsonDir(join(dir, 'monsters')),
    hunts: readJsonDir(join(dir, 'hunts')),
    vocations: readJsonDir(join(dir, 'vocations')),
    progression: readJsonDir(join(dir, 'progression')),
    combat: readJsonDir(join(dir, 'combat')),
    stamina: readJsonDir(join(dir, 'stamina')),
    party: readJsonDir(join(dir, 'party')),
    bestiary: readJsonDir(join(dir, 'bestiary')),
    bot: readJsonDir(join(dir, 'bot')),
    spells: readJsonDir(join(dir, 'spells')),
    // Suprimentos e munição ABSTRATOS (ADR 0026 d.3): poção, runa e flecha não são itens — o
    // uso/tiro debita gold, e o catálogo vive em pasta própria.
    supplies: readJsonDir(join(dir, 'supplies')),
    ammunition: readJsonDir(join(dir, 'ammunition')),
    skills: readJsonDir(join(dir, 'skills')),
    items: readJsonDir(join(dir, 'items')),
    // As famílias de arma (CMB-05): alcance, tipo, recurso, fórmula e a skill que as escala —
    // o que o `sim` lê para saber como uma arma bate sem conhecer item nem vocação.
    weaponFamilies: readJsonDir(join(dir, 'weapon-families')),
    // A tabela de aparências (FUN-94). Uma pasta como as outras, com um `baseline.json` dentro:
    // trocar de pacote de assets é editar ESTE arquivo, e não todo arquivo de conteúdo.
    appearances: readJsonDir(join(dir, 'appearances')),
    // O inventário de cada pacote (FUN-21): `packs/<pack>.json`, gerado por
    // `pnpm assets:inventory`. É contra ele que a tabela acima é conferida.
    packs: readJsonDir(join(dir, 'packs')),
    maps: readJsonDir(join(dir, 'maps')),
    routes: readJsonDir(join(dir, 'routes')),
    // `city/city.json`, uma pasta como as outras — é a convenção que o loader e a varredura
    // do invariante 6 esperam. Obrigatório no conteúdo real: sem Cidade ninguém tem onde
    // nascer (FUN-60); o `buildContent` é quem reclama se faltar.
    city: requireCity(readJsonDir(join(dir, 'city'))[0]),
  });
}

/**
 * Um diretório de conteúdo (`data/items`, `data/monsters`, …): arquivo autoral direto, mais
 * `generated/` e `overrides/` quando existem (ADR 0038) — o importador de catálogo escreve a
 * primeira, um humano escreve a segunda, e as duas convivem SEM se sobrescrever.
 *
 * `generated/<fatia>.json` é sempre um array (`pnpm catalog:import`, ver `scripts/catalog/`);
 * um arquivo autoral costuma ser UMA entidade, mas também aceita array — regra única, sem
 * depender de em qual pasta o arquivo está. Id repetido entre autoral e gerado é erro (FUN-*
 * de sempre): `parseAll`, em `content.ts`, já recusa duplicata na lista achatada que sai daqui,
 * sem precisar de checagem própria neste módulo.
 *
 * `overrides/*.json` NUNCA entra na lista achatada como entidade nova — cada arquivo é uma
 * correção `{ id, reason, patch }` aplicada por cima da entidade (autoral ou gerada) de mesmo
 * id. É assim que uma reimportação nunca apaga uma correção em silêncio (ADR 0038 decisão 3):
 * o dado gerado continua sendo a transcrição PURA do Canary, e a correção é reaplicada toda vez
 * que o conteúdo é carregado, não uma vez só na hora de gerar.
 */
function readJsonDir(dir: string): unknown[] {
  const entities = [...readJsonFiles(dir), ...readJsonFiles(join(dir, 'generated'))];
  applyOverrides(dir, entities);
  return entities;
}

/** Lê todo `*.json` de um diretório; array vira várias entidades, objeto vira uma. */
function readJsonFiles(dir: string): unknown[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  } catch {
    // Diretório ausente é conjunto vazio, não erro: o conteúdo cresce por partes, e a
    // validação de referência cruzada já pega o que faltar de verdade.
    return [];
  }
  const entities: unknown[] = [];
  for (const name of names) {
    const caminho = join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(caminho, 'utf8'));
    } catch (erro) {
      throw new Error(`${caminho}: JSON inválido — ${(erro as Error).message}`);
    }
    if (Array.isArray(parsed)) entities.push(...(parsed as unknown[]));
    else entities.push(parsed);
  }
  return entities;
}

interface OverridePatch {
  readonly id: string;
  readonly reason: string;
  readonly patch: Record<string, unknown>;
}

/** Um `overrides/*.json`: `{ id, reason, patch }`, sempre os três — nunca um campo a menos. */
function readOverride(path: string): OverridePatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (erro) {
    throw new Error(`${path}: JSON inválido — ${(erro as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path}: override precisa ser um objeto { id, reason, patch }`);
  }
  const record = parsed as Record<string, unknown>;
  const { id, reason, patch } = record;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`${path}: override sem "id"`);
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    // O motivo obrigatório É a decisão (ADR 0038 decisão 3): sem ele, uma correção vira número
    // sem explicação, indistinguível de erro de digitação na próxima revisão.
    throw new Error(`${path}: override de "${id}" sem "reason" — toda correção exige motivo (ADR 0038 decisão 3)`);
  }
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new Error(`${path}: override de "${id}" sem "patch" (objeto com os campos a corrigir)`);
  }
  return { id, reason, patch: patch as Record<string, unknown> };
}

/**
 * Aplica cada `overrides/*.json` de `dir` por cima da entidade de mesmo id em `entities`,
 * MUTANDO o objeto no lugar — `entities` já reflete a correção quando a função devolve. Override
 * para um id que não existe (nem autoral, nem gerado) é erro: uma correção órfã normalmente
 * significa que o id mudou ou a entidade sumiu, nunca é caso de simplesmente ignorar.
 */
function applyOverrides(dir: string, entities: readonly unknown[]): void {
  const overridesDir = join(dir, 'overrides');
  let names: string[];
  try {
    names = readdirSync(overridesDir).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return;
  }
  if (names.length === 0) return;
  const byId = new Map<string, Record<string, unknown>>();
  for (const entity of entities) {
    if (typeof entity !== 'object' || entity === null || Array.isArray(entity)) continue;
    const id = (entity as Record<string, unknown>)['id'];
    if (typeof id === 'string') byId.set(id, entity as Record<string, unknown>);
  }
  for (const name of names) {
    const path = join(overridesDir, name);
    const override = readOverride(path);
    const target = byId.get(override.id);
    if (target === undefined) {
      throw new Error(`${path}: override para "${override.id}", que não existe em ${dir} (nem autoral, nem gerado)`);
    }
    Object.assign(target, override.patch);
  }
}

/**
 * `city/city.json` é obrigatório no conteúdo REAL (FUN-120): sem ele a Cidade sobe sem mapa e
 * sem `mapId`, o cliente nunca recebe `instance-enter` para a praça, e nada acusa no boot. O
 * `buildContent` continua aceitando conteúdo sem Cidade — é a fixture que só fala de hunt.
 */
function requireCity(city: unknown): unknown {
  if (city === undefined) {
    throw new Error('city/city.json ausente: a Cidade não teria mapa nem ponto de entrada');
  }
  return city;
}
