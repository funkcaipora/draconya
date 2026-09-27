import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readGeneratedSlice } from './generated-writer.js';
import {
  checkItemPromotion, computeItemPromotion, readAuthoredItemIds, readPackObjectRanges, violatesContentRules,
  writeItemPromotion,
} from './promote-items.js';

const SOURCE = { engine: 'canary' as const, commit: 'a'.repeat(40), path: 'data/items/items.xml' };

let workdir: string | undefined;

afterEach(() => {
  if (workdir !== undefined) { rmSync(workdir, { recursive: true, force: true }); workdir = undefined; }
});

/** Monta um checkout sintético mínimo: staging de itens + os 73 "autorais" (aqui só 1) + o
 *  `appearances/baseline.json` e o `packs/tibia-1332.json` que a promoção confere. */
function setupFixture(root: string, items: Record<string, unknown[]>): void {
  const stagingDir = join(root, 'packages/content/staging/items/generated');
  mkdirSync(stagingDir, { recursive: true });
  for (const [slice, entities] of Object.entries(items)) {
    writeFileSync(join(stagingDir, `${slice}.json`), JSON.stringify(entities, null, 2));
  }

  const itemsDir = join(root, 'packages/content/data/items');
  mkdirSync(itemsDir, { recursive: true });
  writeFileSync(join(itemsDir, 'sword.json'), JSON.stringify({
    id: 'sword', name: 'Sword', kind: 'weapon', weight: 35, value: 25,
  }));

  const appearancesDir = join(root, 'packages/content/data/appearances');
  mkdirSync(appearancesDir, { recursive: true });
  writeFileSync(join(appearancesDir, 'baseline.json'), JSON.stringify({
    id: 'baseline', pack: 'tibia-1332', monsters: {}, items: { sword: 3264 },
  }, null, 2));

  const packsDir = join(root, 'packages/content/data/packs');
  mkdirSync(packsDir, { recursive: true });
  writeFileSync(join(packsDir, 'tibia-1332.json'), JSON.stringify({
    id: 'tibia-1332', version: 1332, object: [[100, 40000]], outfit: [[1, 500]], effect: [[1, 100]], missile: [[1, 100]],
  }, null, 2));
}

function ring(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'test-ring', name: 'test ring', kind: 'ring', slot: 'finger', weight: 1, value: 0, appearanceId: 3900, source: SOURCE, ...overrides,
  };
}

describe('readAuthoredItemIds', () => {
  it('lê o id de cada arquivo direto de data/items, ignorando generated/ e overrides/', () => {
    workdir = mkdtempSync(join(tmpdir(), 'draconya-promote-items-'));
    setupFixture(workdir, {});
    const ids = readAuthoredItemIds(join(workdir, 'packages/content/data/items'));
    expect(ids).toEqual(new Set(['sword']));
  });

  it('diretório ausente é conjunto vazio, não erro', () => {
    workdir = mkdtempSync(join(tmpdir(), 'draconya-promote-items-'));
    expect(readAuthoredItemIds(join(workdir, 'nao-existe'))).toEqual(new Set());
  });
});

describe('violatesContentRules', () => {
  it('imbuementSlots sem slot (a maioria das armas do Canary, sem <attribute slot="hand">) reprova', () => {
    expect(violatesContentRules({ kind: 'weapon', imbuementSlots: 2 }))
      .toMatch(/imbuementSlots/);
  });

  it('imbuementSlots em item empilhável reprova, mesmo com slot', () => {
    expect(violatesContentRules({ kind: 'weapon', slot: 'hand', stackable: true, imbuementSlots: 2 }))
      .toMatch(/imbuementSlots/);
  });

  it('imbuementSlots com slot e sem empilhar passa', () => {
    expect(violatesContentRules({ kind: 'weapon', slot: 'hand', imbuementSlots: 2 })).toBeUndefined();
  });

  it('defense fora de escudo/arma corpo a corpo reprova (a "rusted shield" classificada como valuable)', () => {
    expect(violatesContentRules({ kind: 'other', defense: 10 })).toMatch(/defense/);
  });

  it('defense em escudo passa', () => {
    expect(violatesContentRules({ kind: 'shield', defense: 10 })).toBeUndefined();
  });

  it('defense em arma corpo a corpo passa', () => {
    expect(violatesContentRules({ kind: 'weapon', defense: 10, weapon: { kind: 'melee' } })).toBeUndefined();
  });

  it('arma de distância sem ammoFamily reprova', () => {
    expect(violatesContentRules({ kind: 'weapon', weapon: { kind: 'distance' } })).toMatch(/ammoFamily/);
  });

  it('arma de distância com ammoFamily passa', () => {
    expect(violatesContentRules({ kind: 'weapon', weapon: { kind: 'distance', ammoFamily: 'arrow' } })).toBeUndefined();
  });
});

describe('computeItemPromotion', () => {
  it('promove item novo e extrai appearanceId para appearanceEntries, sem o campo na entidade', () => {
    workdir = mkdtempSync(join(tmpdir(), 'draconya-promote-items-'));
    setupFixture(workdir, { rings: [ring()] });
    const result = computeItemPromotion(workdir);
    const promoted = result.slices.get('rings');
    expect(promoted).toHaveLength(1);
    expect(promoted?.[0]).not.toHaveProperty('appearanceId');
    expect(promoted?.[0]).toMatchObject({ id: 'test-ring', kind: 'ring' });
    expect(result.appearanceEntries.get('test-ring')).toBe(3900);
    expect(result.skippedByAuthored).toEqual([]);
    expect(result.skippedByAppearance).toEqual([]);
  });

  it('id que colide com item autoral é excluído e contado — o autoral vence (ADR 0014)', () => {
    workdir = mkdtempSync(join(tmpdir(), 'draconya-promote-items-'));
    setupFixture(workdir, {
      weapons: [{
        id: 'sword', name: 'sword', kind: 'weapon', weight: 35, value: 0, appearanceId: 3264, source: SOURCE,
      }],
    });
    const result = computeItemPromotion(workdir);
    expect(result.slices.get('weapons')).toEqual([]);
    expect(result.skippedByAuthored).toEqual([
      { id: 'sword', reason: expect.stringContaining('autoral') },
    ]);
    expect(result.appearanceEntries.has('sword')).toBe(false);
  });

  it('appearanceId fora do pacote conferido é excluído e contado, nunca promovido com aparência quebrada', () => {
    workdir = mkdtempSync(join(tmpdir(), 'draconya-promote-items-'));
    setupFixture(workdir, { rings: [ring({ id: 'too-new-ring', appearanceId: 99999 })] });
    const result = computeItemPromotion(workdir);
    expect(result.slices.get('rings')).toEqual([]);
    expect(result.skippedByAppearance).toEqual([
      { id: 'too-new-ring', appearanceId: 99999, reason: expect.stringContaining('pacote') },
    ]);
  });

  it('item que viola regra de conteúdo (imbuementSlots sem slot) é excluído e contado, nunca escrito quebrado', () => {
    workdir = mkdtempSync(join(tmpdir(), 'draconya-promote-items-'));
    setupFixture(workdir, {
      weapons: [{
        id: 'slotless-weapon', name: 'slotless weapon', kind: 'weapon', weight: 40, value: 0,
        imbuementSlots: 2, appearanceId: 3901, source: SOURCE,
      }],
    });
    const result = computeItemPromotion(workdir);
    expect(result.slices.get('weapons')).toEqual([]);
    expect(result.skippedByContentRule).toEqual([
      { id: 'slotless-weapon', reason: expect.stringContaining('imbuementSlots') },
    ]);
    expect(result.appearanceEntries.has('slotless-weapon')).toBe(false);
  });

  it('sem tabela de aparências/pacote no checkout, nada é excluído por aparência (conteúdo de teste)', () => {
    workdir = mkdtempSync(join(tmpdir(), 'draconya-promote-items-'));
    mkdirSync(join(workdir, 'packages/content/staging/items/generated'), { recursive: true });
    writeFileSync(
      join(workdir, 'packages/content/staging/items/generated/rings.json'),
      JSON.stringify([ring({ appearanceId: 99999 })]),
    );
    const result = computeItemPromotion(workdir);
    expect(result.slices.get('rings')).toHaveLength(1);
    expect(result.skippedByAppearance).toEqual([]);
  });

  it('readPackObjectRanges lê o pacote que appearances.pack DECLARA, nunca um nome fixo (#748: a troca para 15.33 na #738 não pede mudança de código aqui)', () => {
    workdir = mkdtempSync(join(tmpdir(), 'draconya-promote-items-'));
    const appearancesDir = join(workdir, 'packages/content/data/appearances');
    mkdirSync(appearancesDir, { recursive: true });
    writeFileSync(join(appearancesDir, 'baseline.json'), JSON.stringify({
      id: 'baseline', pack: 'tibia-1533', monsters: {}, items: {},
    }));
    const packsDir = join(workdir, 'packages/content/data/packs');
    mkdirSync(packsDir, { recursive: true });
    writeFileSync(join(packsDir, 'tibia-1533.json'), JSON.stringify({
      id: 'tibia-1533', version: 1533, object: [[40000, 60000]],
    }));
    // Não existe tibia-1332.json neste checkout sintético — se a função lesse um nome fixo em
    // vez do campo `pack`, ela falharia ou devolveria `undefined` (pacote ausente) em vez das
    // faixas do 15.33.
    expect(readPackObjectRanges(workdir)).toEqual([[40000, 60000]]);
  });
});

describe('writeItemPromotion e checkItemPromotion', () => {
  it('escreve data/items/generated/, mescla appearances.items preservando o autoral, e é idempotente', () => {
    workdir = mkdtempSync(join(tmpdir(), 'draconya-promote-items-'));
    setupFixture(workdir, { rings: [ring()] });

    const result = writeItemPromotion(workdir);
    expect(result.slices.get('rings')).toHaveLength(1);

    const written = readGeneratedSlice(join(workdir, 'packages/content/data/items/generated/rings.json'));
    expect(written).toHaveLength(1);
    expect(written[0]).not.toHaveProperty('appearanceId');

    const appearances = JSON.parse(
      readFileSync(join(workdir, 'packages/content/data/appearances/baseline.json'), 'utf8'),
    ) as { items: Record<string, number> };
    expect(appearances.items).toEqual({ sword: 3264, 'test-ring': 3900 });

    const reportPath = join(workdir, 'docs/reference/catalog/items-promotion-report.md');
    expect(readFileSync(reportPath, 'utf8')).toContain('1 item(ns) promovido(s)');

    // idempotente: rodar de novo produz o mesmo conteúdo.
    const before = readFileSync(join(workdir, 'packages/content/data/items/generated/rings.json'), 'utf8');
    writeItemPromotion(workdir);
    const after = readFileSync(join(workdir, 'packages/content/data/items/generated/rings.json'), 'utf8');
    expect(after).toBe(before);

    expect(checkItemPromotion(workdir).every((o) => o.status === 'fresh')).toBe(true);
  });

  it('item que deixa de ser promovido some de appearances.items na rodada seguinte', () => {
    workdir = mkdtempSync(join(tmpdir(), 'draconya-promote-items-'));
    setupFixture(workdir, { rings: [ring(), ring({ id: 'second-ring', appearanceId: 3901 })] });
    writeItemPromotion(workdir);

    // Segunda rodada: "second-ring" some do staging (por exemplo, o Canary removeu o item).
    setupFixture(workdir, { rings: [ring()] });
    writeItemPromotion(workdir);

    const appearances = JSON.parse(
      readFileSync(join(workdir, 'packages/content/data/appearances/baseline.json'), 'utf8'),
    ) as { items: Record<string, number> };
    expect(appearances.items).toEqual({ sword: 3264, 'test-ring': 3900 });
  });

  it('checkItemPromotion aponta "stale" quando o staging mudou e generated/ não foi regenerado', () => {
    workdir = mkdtempSync(join(tmpdir(), 'draconya-promote-items-'));
    setupFixture(workdir, { rings: [ring()] });
    writeItemPromotion(workdir);

    setupFixture(workdir, { rings: [ring({ id: 'another-ring', appearanceId: 3902 })] });
    const outcomes = checkItemPromotion(workdir);
    expect(outcomes.some((o) => o.slice === 'rings' && o.status === 'stale')).toBe(true);
  });
});
