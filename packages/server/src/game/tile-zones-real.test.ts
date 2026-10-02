import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import type { Tilemap } from '@draconya/content';
import { IN_FIGHT_WINDOW_MS, canLogout, zoneAt } from '@draconya/sim';

// `zoneAt` e `canLogout` (#831, OW-10) sobre a camada `zones` REAL da Thais (#830, OW-09): lida de
// `TILE_FLAGS` do `otservbr.otbm` e carregada pelo mesmo `loadContent` do boot. O `sim` só vê
// mapa sintético (a fronteira o proíbe de ler disco), e este arquivo é o que prende que a
// convenção de coordenada — local ao recorte, a mesma de `isBlocked` — e a precedência do Canary
// funcionam sobre o dado que o mundo vai usar. As coordenadas são as medidas em
// `docs/product/city.md` ("Zonas por tile") e em `packages/content/src/map.test.ts`.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Tilemap | null = null;
const thais = (): Tilemap => {
  const map = (cached ??= loadContent(DATA).maps.get('thais') ?? null);
  if (map === null) throw new Error('o conteúdo real não tem a thais');
  return map;
};

const NOW = 500_000;
const FRESH_HIT = NOW - 5_000; // um golpe há 5 s: bem dentro da janela de 60 s
const STALE_HIT = NOW - IN_FIGHT_WINDOW_MS; // exatamente na borda: já não é luta
const heroAt = (x: number, y: number, z: number, lastCombatActionAtMs: number | null) =>
  ({ position: { x, y, z }, lastCombatActionAtMs });

describe('zonas reais da Thais (#831, OW-10)', () => {
  it('o templo é PZ: o tile de entrada e a coluna que desce dele', () => {
    const map = thais();
    // O `entryPoint` da Cidade (94, 88, 7) é o templo, e a PZ vai até (94, 96, 7); a rua começa
    // em (94, 97, 7).
    expect(zoneAt(map, { x: 94, y: 88, z: 7 })).toBe('protection');
    expect(zoneAt(map, { x: 94, y: 96, z: 7 })).toBe('protection');
    expect(zoneAt(map, { x: 94, y: 97, z: 7 })).toBe('normal');
  });

  it('em luta, sair do templo vale e sair da rua não', () => {
    const map = thais();
    expect(canLogout(heroAt(94, 88, 7, FRESH_HIT), map, NOW)).toEqual({ ok: true });
    expect(canLogout(heroAt(94, 97, 7, FRESH_HIT), map, NOW)).toEqual({ ok: false, reason: 'in-fight' });
    expect(canLogout(heroAt(94, 97, 7, null), map, NOW)).toEqual({ ok: true });
    expect(canLogout(heroAt(94, 97, 7, STALE_HIT), map, NOW)).toEqual({ ok: true });
  });

  it('o no-logout sozinho de z7 recusa o logout, em luta ou não', () => {
    const map = thais();
    expect(zoneAt(map, { x: 77, y: 56, z: 7 })).toBe('nologout');
    expect(canLogout(heroAt(77, 56, 7, null), map, NOW)).toEqual({ ok: false, reason: 'no-logout-tile' });
    expect(canLogout(heroAt(77, 56, 7, FRESH_HIT), map, NOW)).toEqual({ ok: false, reason: 'no-logout-tile' });
  });

  it('o tile que é PZ E no-logout (z6, em cima do templo) é PZ no tipo e recusa o logout', () => {
    const map = thais();
    expect(zoneAt(map, { x: 94, y: 93, z: 6 })).toBe('protection');
    expect(canLogout(heroAt(94, 93, 6, null), map, NOW)).toEqual({ ok: false, reason: 'no-logout-tile' });
    expect(canLogout(heroAt(94, 93, 6, FRESH_HIT), map, NOW)).toEqual({ ok: false, reason: 'no-logout-tile' });
  });

  it('a Thais não tem no-pvp nem arena: nenhum tile dela é desses tipos', () => {
    const map = thais();
    let pvpish = 0;
    for (const floor of map.floors.values()) {
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const type = zoneAt(map, { x, y, z: floor.z });
          if (type === 'nopvp' || type === 'pvp') pvpish++;
        }
      }
    }
    expect(pvpish).toBe(0);
  });

  it('um recorte de hunt sem a camada é todo normal: só a luta decide a saída', () => {
    const rat = loadContent(DATA).maps.get('rat-cellars');
    if (rat === undefined) throw new Error('o conteúdo real não tem a rat-cellars');
    expect(zoneAt(rat, { x: 10, y: 10, z: rat.z })).toBe('normal');
    expect(canLogout(heroAt(10, 10, rat.z, FRESH_HIT), rat, NOW)).toEqual({ ok: false, reason: 'in-fight' });
    expect(canLogout(heroAt(10, 10, rat.z, null), rat, NOW)).toEqual({ ok: true });
  });
});
