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
    supplies: readJsonDir(join(dir, 'supplies')),
    skills: readJsonDir(join(dir, 'skills')),
    items: readJsonDir(join(dir, 'items')),
    // Munição (ADR 0026, decisão 3): seleção por família, não item — pasta própria.
    ammunition: readJsonDir(join(dir, 'ammunition')),
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
