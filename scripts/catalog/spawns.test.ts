import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Region } from '../otbm.js';
import { parseXml } from './xml.js';
import {
  extractCanarySpawns, importCanarySpawns, loadMonsterIds, respawnDelayMsOf, slugify,
} from './spawns.js';

describe('extractCanarySpawns (#582)', () => {
  it('lê zonas e filhos, ignora o `z` do filho e usa o `centerz` (spawn_monster.cpp:90-96)', () => {
    const xml = [
      '<?xml version="1.0"?>',
      '<monsters>',
      '\t<monster centerx="100" centery="200" centerz="7" radius="3">',
      '\t\t<monster name="Dragon" x="-1" y="2" z="7" spawntime="90" />',
      '\t</monster>',
      '\t<monster centerx="50" centery="60" centerz="9" radius="2">',
      '\t\t<monster name="Dragon Lord" x="0" y="0" z="9" spawntime="120" />',
      '\t</monster>',
      '</monsters>',
    ].join('\n');
    const points = extractCanarySpawns(parseXml(xml));
    expect(points).toEqual([
      { name: 'Dragon', x: 99, y: 202, z: 7, spawnTimeSec: 90, weight: 1 },
      { name: 'Dragon Lord', x: 50, y: 60, z: 9, spawnTimeSec: 120, weight: 1 },
    ]);
  });

  it('lê `weight` quando declarado — dois monstros na MESMA posição', () => {
    const xml = [
      '<monsters>',
      '<monster centerx="0" centery="0" centerz="0" radius="2">',
      '\t<monster name="Crystal Spider" x="0" y="0" z="0" spawntime="90" weight="3" />',
      '\t<monster name="Wyvern" x="0" y="0" z="0" spawntime="90" weight="1" />',
      '</monster>',
      '</monsters>',
    ].join('\n');
    const points = extractCanarySpawns(parseXml(xml));
    expect(points.map((p) => p.weight)).toEqual([3, 1]);
    expect(points.every((p) => p.x === 0 && p.y === 0)).toBe(true);
  });

  it('não confunde zonas vizinhas: cada filho pertence à zona certa', () => {
    const xml = [
      '<monsters>',
      '<monster centerx="10" centery="10" centerz="7" radius="1">',
      '\t<monster name="Rat" x="0" y="0" z="7" spawntime="60" />',
      '</monster>',
      '<monster centerx="20" centery="20" centerz="7" radius="1">',
      '\t<monster name="Rotworm" x="0" y="0" z="7" spawntime="60" />',
      '</monster>',
      '</monsters>',
    ].join('\n');
    expect(extractCanarySpawns(parseXml(xml)).map((p) => [p.name, p.x, p.y])).toEqual([
      ['Rat', 10, 10],
      ['Rotworm', 20, 20],
    ]);
  });
});

describe('respawnDelayMsOf (spawn_monster.cpp:26-27,387-392)', () => {
  it('converte segundos para ms', () => {
    expect(respawnDelayMsOf(90)).toBe(90_000);
  });
  it('nunca fica abaixo do piso de 1 segundo', () => {
    expect(respawnDelayMsOf(0)).toBe(1000);
  });
  it('nunca passa do teto de 1 dia', () => {
    expect(respawnDelayMsOf(999_999)).toBe(86_400_000);
  });
});

describe('slugify', () => {
  it('kebab-case, como o catálogo gerado (ADR 0038)', () => {
    expect(slugify('Dragon Lord')).toBe('dragon-lord');
    expect(slugify('Silver Rabbit')).toBe('silver-rabbit');
  });
});

describe('loadMonsterIds', () => {
  let dir: string;
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('lê id de arquivo hand-authored (objeto) e do catálogo gerado (array, em subpasta)', () => {
    dir = mkdtempSync(join(tmpdir(), 'draconya-monsters-'));
    writeFileSync(join(dir, 'dragon.json'), JSON.stringify({ id: 'dragon', name: 'Dragon' }));
    mkdirSync(join(dir, 'generated'));
    writeFileSync(join(dir, 'generated', 'mammals.json'), JSON.stringify([{ id: 'badger' }, { id: 'wyvern' }]));
    const ids = loadMonsterIds(dir);
    expect(ids.has('dragon')).toBe(true);
    expect(ids.has('badger')).toBe(true);
    expect(ids.has('wyvern')).toBe(true);
    expect(ids.has('dragon-lord')).toBe(false);
  });
});

describe('importCanarySpawns (#582)', () => {
  const region: Region = { x: [100, 200], y: [100, 200], z: [10, 11] };
  const monsterIds = new Set(['dragon', 'dragon-lord']);

  it('filtra pela região e pelo andar, e converte para coordenadas LOCAIS', () => {
    const points = [
      { name: 'Dragon', x: 150, y: 120, z: 10, spawnTimeSec: 90, weight: 1 }, // dentro
      { name: 'Dragon', x: 5, y: 5, z: 10, spawnTimeSec: 90, weight: 1 }, // fora da caixa
      { name: 'Dragon Lord', x: 150, y: 120, z: 99, spawnTimeSec: 90, weight: 1 }, // fora do andar
    ];
    const report = importCanarySpawns(points, region, monsterIds, 1);
    expect(report.pointsRead).toBe(3);
    expect(report.pointsInRegion).toBe(1);
    expect(report.written).toEqual([
      { x: 50, y: 20, z: 10, radius: 1, respawnDelayMs: 90_000, monsterId: 'dragon' },
    ]);
    expect(report.unknown).toEqual([]);
  });

  it('agrupa pontos na MESMA posição em `monsters` com peso — nunca em `monsterId`', () => {
    const points = [
      { name: 'Crystal Spider', x: 150, y: 120, z: 10, spawnTimeSec: 90, weight: 3 },
      { name: 'Dragon', x: 150, y: 120, z: 10, spawnTimeSec: 90, weight: 1 },
    ];
    const ids = new Set(['crystal-spider', 'dragon']);
    const report = importCanarySpawns(points, region, ids, 1);
    expect(report.grouped).toBe(1);
    expect(report.written).toEqual([
      {
        x: 50, y: 20, z: 10, radius: 1, respawnDelayMs: 90_000,
        monsters: [
          { monsterId: 'crystal-spider', weight: 3 },
          { monsterId: 'dragon', weight: 1 },
        ],
      },
    ]);
    expect(report.written[0]).not.toHaveProperty('monsterId');
  });

  it('monstro fora do catálogo é RELATADO, nunca fatal — o ponto some do resultado', () => {
    const points = [
      { name: 'Ghost Monster', x: 150, y: 120, z: 10, spawnTimeSec: 90, weight: 1 },
    ];
    const report = importCanarySpawns(points, region, monsterIds, 1);
    expect(report.written).toEqual([]);
    expect(report.unknown).toEqual([{ name: 'Ghost Monster', x: 150, y: 120, z: 10 }]);
  });

  it('grupo com um monstro desconhecido e outro conhecido escreve só o conhecido, sem `monsters`', () => {
    const points = [
      { name: 'Ghost Monster', x: 150, y: 120, z: 10, spawnTimeSec: 90, weight: 2 },
      { name: 'Dragon', x: 150, y: 120, z: 10, spawnTimeSec: 90, weight: 1 },
    ];
    const report = importCanarySpawns(points, region, monsterIds, 1);
    expect(report.written).toEqual([
      { x: 50, y: 20, z: 10, radius: 1, respawnDelayMs: 90_000, monsterId: 'dragon' },
    ]);
    expect(report.unknown).toEqual([{ name: 'Ghost Monster', x: 150, y: 120, z: 10 }]);
  });
});
