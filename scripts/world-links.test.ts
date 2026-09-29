import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SectorTile } from '../packages/client/src/world/sector.js';
import { deriveLinks, FLOOR, parseItemsXml, parseRopeSpots } from './world-links.js';
import type { Point, TileLookup } from './world-links.js';

describe('parseItemsXml', () => {
  it('lê floorchange e type por id e por faixa, e ignora o resto', () => {
    const facts = parseItemsXml(`
      <item id="469" name="stairs"><attribute key="floorchange" value="down"/></item>
      <item fromid="7544" toid="7545" name="ramp"><attribute key="floorchange" value="west"/></item>
      <item id="1948" name="ladder"><attribute key="type" value="ladder"/></item>
      <item id="5" name="nada"><attribute key="weight" value="1"/></item>
      <item id="6" name="vazio"/>`);
    expect(facts.get(469)).toEqual({ floorchange: FLOOR.down });
    expect(facts.get(7545)).toEqual({ floorchange: FLOOR.west });
    expect(facts.get(1948)).toEqual({ type: 'ladder' });
    expect(facts.has(5)).toBe(false);
    expect(facts.has(6)).toBe(false);
  });
});

describe('parseRopeSpots', () => {
  it('lê as duas listas do global.lua', () => {
    expect(parseRopeSpots('ropeSpots = { 386, 421 }\nspecialRopeSpots = { 12935 }\n')).toEqual({
      ground: new Set([386, 421]), special: new Set([12935]),
    });
  });
});

/** Um mundo de fixture: `"x,y,z" → tile`. */
function world(entries: Record<string, Partial<SectorTile>>) {
  const tiles = new Map<string, SectorTile>();
  for (const [key, partial] of Object.entries(entries)) tiles.set(key, { x: 0, y: 0, ground: 100, items: [], flags: 0, ...partial });
  const lookup: TileLookup = (x, y, z) => tiles.get(`${x},${y},${z}`) ?? null;
  const list = [...tiles.entries()].map(([key, tile]) => {
    const [x, y, z] = key.split(',').map(Number) as [number, number, number];
    return [x, y, z, tile] as const;
  });
  return { lookup, list };
}

const ITEMS = parseItemsXml(`
  <item id="1" name="stairs"><attribute key="floorchange" value="down"/></item>
  <item id="2" name="ramp w"><attribute key="floorchange" value="west"/></item>
  <item id="3" name="ramp n"><attribute key="floorchange" value="north"/></item>
  <item id="4" name="ladder"><attribute key="type" value="ladder"/></item>
  <item id="5" name="door"><attribute key="type" value="door"/></item>
  <item id="6" name="ramp southalt"><attribute key="floorchange" value="southalt"/></item>`);
const NO_ROPE = { ground: new Set<number>(), special: new Set<number>() };

function derive(entries: Record<string, Partial<SectorTile>>, teleports: Array<readonly [Point, Point]> = [], unpassIds: number[] = []) {
  const { lookup, list } = world(entries);
  return deriveLinks({ tiles: list, lookup, items: ITEMS, rope: NO_ROPE, unpass: (id) => unpassIds.includes(id), teleports });
}

describe('deriveLinks', () => {
  it('descer olha a flag do tile de pouso: rampa a oeste embaixo desloca +1 em x (emenda #519)', () => {
    const { links } = derive({ '10,10,7': { items: [{ id: 1 }] }, '10,10,8': { items: [{ id: 2 }] }, '11,10,8': {} });
    expect(links).toContainEqual([[10, 10, 7], [11, 10, 8], 'stairs']);
  });

  it('subir lê a flag do próprio tile: norte sobe e anda −1 em y', () => {
    const { links } = derive({ '5,5,8': { items: [{ id: 3 }] }, '5,4,7': {} });
    expect(links).toEqual([[[5, 5, 8], [5, 4, 7], 'stairs']]);
  });

  it('southalt no tile ao norte do pouso desloca −2 em y', () => {
    const { links } = derive({ '10,10,7': { items: [{ id: 1 }] }, '10,9,8': { items: [{ id: 6 }] }, '10,8,8': {} });
    expect(links).toContainEqual([[10, 10, 7], [10, 8, 8], 'stairs']);
  });

  it('sem tile de destino não há ligação', () => {
    expect(derive({ '10,10,7': { items: [{ id: 1 }] } }).links).toEqual([]);
  });

  it('escada de mão sobe ao sul, ou ao primeiro vizinho andável quando o sul bloqueia', () => {
    expect(derive({ '5,5,8': { items: [{ id: 4 }] }, '5,6,7': {} }).links).toEqual([[[5, 5, 8], [5, 6, 7], 'ladder']]);
    const blocked = derive({ '5,5,8': { items: [{ id: 4 }] }, '5,6,7': { items: [{ id: 99 }] }, '6,5,7': {} }, [], [99]);
    expect(blocked.links).toEqual([[[5, 5, 8], [6, 5, 7], 'ladder']]);
  });

  it('teleporte com destino gravado entra; o de script (0,0,0) e o quebrado ficam fora; portas são listadas', () => {
    const result = derive({ '1,1,7': { items: [{ id: 5 }] }, '9,9,7': {} }, [
      [[1, 1, 7], [9, 9, 7]], [[2, 2, 7], [0, 0, 0]], [[3, 3, 7], [500, 500, 7]],
    ]);
    expect(result.links).toEqual([[[1, 1, 7], [9, 9, 7], 'teleport']]);
    expect(result.doors).toEqual([[1, 1, 7, 5]]);
  });
});

// O mapa real, quando gerado: a derivação bate com o que foi autorado à mão.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LINKS = join(ROOT, 'things', '1332', 'world', 'links.json');

describe.skipIf(!existsSync(LINKS))('ligações reais (things/)', () => {
  // Lido no `beforeAll`, nunca no corpo do `describe`: o Vitest executa esse corpo na COLETA
  // mesmo quando o bloco é pulado, e o `links.json` gerado não existe no CI — ler aqui derrubava
  // o arquivo inteiro com ENOENT antes de o `skipIf` valer.
  let byFrom: Map<string, string>;
  beforeAll(() => {
    const data = JSON.parse(readFileSync(LINKS, 'utf8')) as { links: Array<[Point, Point, string]> };
    byFrom = new Map(data.links.map((link) => [link[0].join(','), link[1].join(',')]));
  });

  it('os quatro conectores da Darashia Dragon Lair são os da emenda #519 do ADR 0025', () => {
    expect(byFrom.get('33264,32301,10')).toBe('33265,32301,11');
    expect(byFrom.get('33264,32301,11')).toBe('33263,32301,10');
    expect(byFrom.get('33226,32278,11')).toBe('33227,32278,12');
    expect(byFrom.get('33226,32278,12')).toBe('33225,32278,11');
  });

  it('todas as escadas autoradas de Thais saem da derivação', () => {
    const thais = JSON.parse(readFileSync(join(ROOT, 'packages', 'content', 'data', 'maps', 'thais.json'), 'utf8')) as {
      source: { region: { x: [number, number]; y: [number, number] } };
      floorChanges: Array<{ from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } }>;
    };
    const [ox, oy] = [thais.source.region.x[0], thais.source.region.y[0]];
    for (const change of thais.floorChanges) {
      expect(byFrom.get(`${change.from.x + ox},${change.from.y + oy},${change.from.z}`)).toBe(`${change.to.x + ox},${change.to.y + oy},${change.to.z}`);
    }
    expect(thais.floorChanges.length).toBeGreaterThan(80);
  });
});
