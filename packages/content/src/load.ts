// Leitura do conteúdo em disco. Ponto de entrada SEPARADO de propósito: usa `node:fs`, e
// `sim` é puro (invariante 1). O lint impede `sim` de importar deste caminho.
//
// Só `server` e `tools` importam daqui.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildContent } from './content.js';
import type { Content } from './content.js';

/**
 * Carrega e valida o conteúdo de um diretório. Lança em qualquer problema — conteúdo
 * inválido tem que derrubar o boot, e não chegar à simulação.
 */
export function loadContent(dir: string): Content {
  return buildContent({
    monsters: readJsonDir(join(dir, 'monsters')),
    hunts: readJsonDir(join(dir, 'hunts')),
    vocations: readJsonDir(join(dir, 'vocations')),
  });
}

function readJsonDir(dir: string): unknown[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  } catch {
    // Diretório ausente é conjunto vazio, não erro: o conteúdo cresce por partes, e a
    // validação de referência cruzada já pega o que faltar de verdade.
    return [];
  }
  return names.map((name) => {
    const caminho = join(dir, name);
    try {
      return JSON.parse(readFileSync(caminho, 'utf8'));
    } catch (erro) {
      throw new Error(`${caminho}: JSON inválido — ${(erro as Error).message}`);
    }
  });
}
