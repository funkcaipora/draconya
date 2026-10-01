import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type CatalogEntity, formatGeneratedSlice, listGeneratedSlices, readGeneratedSlice, sortById,
  writeGeneratedSlice,
} from './generated-writer.js';

const source = (path: string) => ({ engine: 'canary' as const, commit: 'a'.repeat(40), path });

const ENTITIES: CatalogEntity[] = [
  { id: 'zzz-last', attack: 1, source: source('items.xml') },
  { id: 'aaa-first', attack: 2, source: source('items.xml') },
  { id: 'mid', attack: 3, source: source('items.xml') },
];

describe('sortById', () => {
  it('ordena por id, sem mutar o array original', () => {
    const sorted = sortById(ENTITIES);
    expect(sorted.map((e) => e.id)).toEqual(['aaa-first', 'mid', 'zzz-last']);
    expect(ENTITIES.map((e) => e.id)).toEqual(['zzz-last', 'aaa-first', 'mid']);
  });
});

describe('formatGeneratedSlice', () => {
  it('é JSON legível, ordenado por id, terminado em nova linha', () => {
    const text = formatGeneratedSlice(ENTITIES);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(sortById(ENTITIES));
    // Reimportar o MESMO conjunto produz o MESMO texto — é a idempotência que o ADR 0038
    // promete (decisão 2/consequências).
    expect(formatGeneratedSlice([...ENTITIES].reverse())).toBe(text);
  });
});

describe('writeGeneratedSlice / readGeneratedSlice', () => {
  it('escreve e lê de volta o mesmo conjunto, ordenado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-generated-'));
    try {
      const path = join(dir, 'generated', 'weapons.json');
      writeGeneratedSlice(path, ENTITIES);
      expect(readFileSync(path, 'utf8')).toBe(formatGeneratedSlice(ENTITIES));
      expect(readGeneratedSlice(path)).toEqual(sortById(ENTITIES));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readGeneratedSlice recusa um arquivo que não é array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-generated-'));
    try {
      const path = join(dir, 'not-array.json');
      writeGeneratedSlice(path, []);
      writeFileSync(path, '{"not":"an array"}');
      expect(() => readGeneratedSlice(path)).toThrow(/esperava um array/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('listGeneratedSlices', () => {
  it('lê toda fatia de um diretório generated/, por nome de arquivo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-generated-'));
    try {
      writeGeneratedSlice(join(dir, 'weapons.json'), [ENTITIES[0] as CatalogEntity]);
      writeGeneratedSlice(join(dir, 'armor.json'), [ENTITIES[1] as CatalogEntity]);
      const slices = listGeneratedSlices(dir);
      expect([...slices.keys()]).toEqual(['armor', 'weapons']);
      expect(slices.get('weapons')).toEqual([ENTITIES[0]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('diretório ausente é conjunto vazio, não erro — o conteúdo cresce por partes', () => {
    expect(listGeneratedSlices('/nao/existe')).toEqual(new Map());
  });
});
