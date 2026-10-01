import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSourceCommit } from './env.js';
import {
  convertBase, convertCategory, convertImbuement, readImbuementCatalog, readItemSlugsByCanaryId,
} from './imbuements.js';
import type { CatalogImportContext } from './registry.js';
import { childrenOf, parseXml } from './xml.js';

const COMMIT = 'a'.repeat(40);
const PATH = 'data/XML/imbuements.xml';

// Fixture SINTÉTICA no formato do Canary — números e nomes inventados, nunca uma cópia do
// arquivo real (ADR 0019 limite 1 / ADR 0038 decisão 7, o mesmo aviso de `ammo.test.ts`).
const IMBUEMENTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<imbuements>
	<base id="1" name="Basic" price="5000" protectionPrice="10000" percent="90" removecost="15000" duration="72000" />
	<base id="2" name="Intricate" price="30000" protectionPrice="30000" percent="70" removecost="15000" duration="72000" />
	<base id="3" name="Powerful" price="200000" protectionPrice="50000" percent="50" removecost="15000" duration="72000" />

	<category id="0" name="Test Elemental Damage" agressive="1" />
	<category id="10" name="Test Increase Speed" agressive="0" />

	<imbuement name="Test Scorch" base="1" subgroup=" (Fire)" category="0" iconid="13" premium="0" storage="0">
		<attribute key="description" value="Converts 10% of the physical damage to fire damage." />
		<attribute key="effect" type="damage" combat="fire" value="10" />
		<attribute key="item" value="90001" count="25" />
	</imbuement>
	<imbuement name="Test Scorch" base="2" subgroup=" (Fire)" category="0" iconid="13" premium="1" storage="0">
		<attribute key="description" value="Converts 25% of the physical damage to fire damage." />
		<attribute key="effect" type="damage" combat="fire" value="25" />
		<attribute key="item" value="90001" count="25" />
		<attribute key="item" value="90999" count="5" />
		<attribute key="scroll" value="51739" />
	</imbuement>
	<imbuement name="Test Reduction" base="1" category="0" iconid="4" premium="0" storage="0">
		<attribute key="description" value="Reduces death damage taken by 10%." />
		<attribute key="effect" type="reduction" combat="death" value="10" />
		<attribute key="item" value="90002" count="5" />
	</imbuement>
	<imbuement name="Test Vampirism" base="1" category="1" iconid="46" premium="0" storage="0">
		<attribute key="description" value="Adds life leech." />
		<attribute key="effect" type="skill" value="lifeleech" bonus="500" chance="100" />
		<attribute key="item" value="90002" count="25" />
	</imbuement>
	<imbuement name="Test Swiftness" base="1" category="10" iconid="73" premium="0" storage="0">
		<attribute key="description" value="Raises walking speed by 10." />
		<attribute key="effect" type="speed" value="10" />
		<attribute key="item" value="90001" count="15" />
	</imbuement>
	<imbuement name="Test Featherweight" base="1" category="17" iconid="1" premium="0" storage="0">
		<attribute key="description" value="Raises capacity by 15." />
		<attribute key="effect" type="capacity" value="15" />
		<attribute key="item" value="90001" count="15" />
	</imbuement>
	<imbuement name="Test Vibrancy" base="1" category="19" iconid="79" premium="0" storage="0">
		<attribute key="description" value="Removes paralysis with a chance of 15%." />
		<attribute key="effect" type="paralysis" chance="15" pvpDeflect="1" />
		<attribute key="item" value="90001" count="20" />
	</imbuement>
	<imbuement name="Test Unknown Effect" base="1" category="0" iconid="1" premium="0" storage="0">
		<attribute key="description" value="Uses an effect type this reader does not know." />
		<attribute key="effect" type="mystery" value="1" />
		<attribute key="item" value="90001" count="1" />
	</imbuement>
	<imbuement name="Test Unknown Combat" base="1" category="0" iconid="1" premium="0" storage="0">
		<attribute key="description" value="Uses a combat type this reader does not know." />
		<attribute key="effect" type="damage" combat="void" value="10" />
		<attribute key="item" value="90001" count="1" />
	</imbuement>
</imbuements>
`;

// Fixture sintética de `appearances.json.items` — só os dois materiais que a fixture acima usa
// de verdade (`90001`); `90999`/`90002` ficam de fora de propósito para exercer "material
// ausente" (RF-04).
const APPEARANCES_JSON = JSON.stringify({ items: { 'test-material': 90001 } });

function withTempRepoRoot(run: (repoRoot: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'draconya-imbuements-test-'));
  try {
    mkdirSync(join(dir, 'packages', 'content', 'data', 'appearances'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'content', 'data', 'appearances', 'baseline.json'), APPEARANCES_JSON);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('readItemSlugsByCanaryId', () => {
  it('inverte slug → id em id → slug', () => {
    withTempRepoRoot((repoRoot) => {
      const byId = readItemSlugsByCanaryId(repoRoot);
      expect(byId.get(90001)).toBe('test-material');
      expect(byId.get(90999)).toBeUndefined();
    });
  });
});

function elementsOf(tag: string) {
  return childrenOf(parseXml(IMBUEMENTS_XML), tag);
}

function byName(name: string, base: string) {
  const el = elementsOf('imbuement').find((e) => e.attributes['name'] === name && e.attributes['base'] === base);
  if (el === undefined) throw new Error(`fixture sem imbuement "${name}" base ${base}`);
  return el;
}

const ITEM_SLUGS = new Map([[90001, 'test-material']]);

describe('convertBase', () => {
  it('as 3 bases sintéticas: price/protectionPrice/percent/removeCost/durationSeconds', () => {
    const basic = convertBase(elementsOf('base')[0]!, PATH, COMMIT);
    expect(basic).toMatchObject({
      id: '1', name: 'Basic', price: 5000, protectionPrice: 10000, percent: 90,
      removeCost: 15000, durationSeconds: 72000,
    });
    const powerful = convertBase(elementsOf('base')[2]!, PATH, COMMIT);
    expect(powerful).toMatchObject({ id: '3', name: 'Powerful', price: 200000, percent: 50 });
  });
});

describe('convertCategory', () => {
  it('aggressive "1" vira true, "0" vira false — nunca sempre o mesmo valor', () => {
    const aggressive = convertCategory(elementsOf('category')[0]!, PATH, COMMIT);
    expect(aggressive).toMatchObject({ id: '0', name: 'Test Elemental Damage', aggressive: true });
    const notAggressive = convertCategory(elementsOf('category')[1]!, PATH, COMMIT);
    expect(notAggressive).toMatchObject({ id: '10', name: 'Test Increase Speed', aggressive: false });
  });
});

describe('convertImbuement', () => {
  it('damage: combat + percent, id = slug-tier', () => {
    const { entity, skipped } = convertImbuement(byName('Test Scorch', '1'), PATH, COMMIT, ITEM_SLUGS);
    expect(entity).toMatchObject({
      id: 'test-scorch-1', name: 'Test Scorch', categoryId: '0', baseId: '1', premium: false,
      subgroup: '(Fire)', effect: { type: 'damage', combat: 'fire', percent: 10 },
      materials: [{ itemId: 'test-material', count: 25 }],
    });
    expect(entity).not.toHaveProperty('iconid');
    expect(entity).not.toHaveProperty('storage');
    expect(entity).not.toHaveProperty('scroll');
    expect(skipped).toEqual([]);
  });

  it('reduction: combat + percent', () => {
    const { entity } = convertImbuement(byName('Test Reduction', '1'), PATH, COMMIT, ITEM_SLUGS);
    expect(entity?.['effect']).toEqual({ type: 'reduction', combat: 'death', percent: 10 });
  });

  it('skill: bonus + chance (lifeleech)', () => {
    const { entity } = convertImbuement(byName('Test Vampirism', '1'), PATH, COMMIT, ITEM_SLUGS);
    expect(entity?.['effect']).toEqual({ type: 'skill', skill: 'lifeleech', bonus: 500, chance: 100 });
  });

  it('speed: amount', () => {
    const { entity } = convertImbuement(byName('Test Swiftness', '1'), PATH, COMMIT, ITEM_SLUGS);
    expect(entity?.['effect']).toEqual({ type: 'speed', amount: 10 });
  });

  it('capacity: amount', () => {
    const { entity } = convertImbuement(byName('Test Featherweight', '1'), PATH, COMMIT, ITEM_SLUGS);
    expect(entity?.['effect']).toEqual({ type: 'capacity', amount: 15 });
  });

  it('paralysis: chance + pvpDeflect', () => {
    const { entity } = convertImbuement(byName('Test Vibrancy', '1'), PATH, COMMIT, ITEM_SLUGS);
    expect(entity?.['effect']).toEqual({ type: 'paralysis', chance: 15, pvpDeflect: true });
  });

  it('material ausente do catálogo: a entidade é gerada do mesmo jeito, só sem o material — vira skipped', () => {
    const { entity, skipped } = convertImbuement(byName('Test Scorch', '2'), PATH, COMMIT, ITEM_SLUGS);
    expect(entity).toBeDefined();
    expect(entity?.['materials']).toEqual([{ itemId: 'test-material', count: 25 }]);
    const missing = skipped.find((s) => s.reason.includes('material ausente'));
    expect(missing?.reason).toMatch(/id do Canary 90999/);
  });

  it('scroll nunca entra na entidade — sempre skipped, mesmo quando presente', () => {
    const { entity, skipped } = convertImbuement(byName('Test Scorch', '2'), PATH, COMMIT, ITEM_SLUGS);
    expect(entity).not.toHaveProperty('scroll');
    const scrollLine = skipped.find((s) => s.reason.includes('scroll'));
    expect(scrollLine).toMatchObject({ reason: expect.stringContaining('item da Loja') });
  });

  it('effect type fora do vocabulário conhecido: descarta a entidade inteira', () => {
    const { entity, skipped } = convertImbuement(byName('Test Unknown Effect', '1'), PATH, COMMIT, ITEM_SLUGS);
    expect(entity).toBeUndefined();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toMatch(/fora do vocabulário conhecido/);
  });

  it('combat fora do vocabulário conhecido: descarta a entidade inteira', () => {
    const { entity, skipped } = convertImbuement(byName('Test Unknown Combat', '1'), PATH, COMMIT, ITEM_SLUGS);
    expect(entity).toBeUndefined();
    expect(skipped[0]?.reason).toMatch(/combat "void" fora do vocabulário/);
  });
});

describe('readImbuementCatalog', () => {
  it('as 3 fatias, pulados e notas — determinístico rodando duas vezes sobre a mesma fixture', () => {
    withTempRepoRoot((repoRoot) => {
      const canaryDir = mkdtempSync(join(tmpdir(), 'draconya-canary-test-'));
      try {
        mkdirSync(join(canaryDir, 'data', 'XML'), { recursive: true });
        writeFileSync(join(canaryDir, 'data', 'XML', 'imbuements.xml'), IMBUEMENTS_XML);
        const ctx: CatalogImportContext = {
          canaryDir, forgottenServerDir: '/nao/existe', canaryCommit: COMMIT, forgottenServerCommit: '',
        };
        const first = readImbuementCatalog(ctx, repoRoot);
        const second = readImbuementCatalog(ctx, repoRoot);
        expect([...first.slices.keys()].sort()).toEqual(['bases', 'categories', 'imbuements']);
        expect(first.bases).toHaveLength(3);
        expect(first.categories).toHaveLength(2);
        // 9 <imbuement> na fixture, 2 descartadas por vocabulário desconhecido.
        expect(first.imbuements).toHaveLength(7);
        expect(JSON.stringify([...first.slices])).toEqual(JSON.stringify([...second.slices]));
        expect(first.skipped.length).toBeGreaterThan(0);
        expect(first.notes?.some((n) => n.includes('iconid'))).toBe(true);
      } finally {
        rmSync(canaryDir, { recursive: true, force: true });
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Contra o checkout real, quando ele está nesta máquina (`CANARY_DIR`) — pulado no CI. Cobre o
// critério de teste da issue ("3 imbuements conferidos").

const REAL_CANARY_DIR = process.env['CANARY_DIR'];
const HAS_REAL_CANARY = REAL_CANARY_DIR !== undefined && REAL_CANARY_DIR !== ''
  && existsSync(join(REAL_CANARY_DIR, 'data', 'XML', 'imbuements.xml'));

describe.skipIf(!HAS_REAL_CANARY)('leitor contra o Canary real (CANARY_DIR)', () => {
  const dir = HAS_REAL_CANARY ? (REAL_CANARY_DIR as string) : '';
  const commit = HAS_REAL_CANARY ? readSourceCommit(dir) : '';
  const root = HAS_REAL_CANARY ? parseXml(readFileSync(join(dir, 'data/XML/imbuements.xml'), 'utf8')) : undefined;
  // Raiz real do repositório: este arquivo de teste mora em `scripts/catalog/`.
  const repoRoot = join(import.meta.dirname, '..', '..');

  function realByName(name: string, base: string) {
    const el = childrenOf(root!, 'imbuement')
      .find((e) => e.attributes['name'] === name && e.attributes['base'] === base);
    if (el === undefined) throw new Error(`imbuements.xml sem "${name}" base ${base}`);
    return el;
  }

  it('3 bases: Basic 5000/90%, Intricate 30000/70%, Powerful 200000/50% — removecost e duration iguais', () => {
    const bases = childrenOf(root!, 'base').map((el) => convertBase(el, PATH, commit));
    expect(bases).toHaveLength(3);
    expect(bases).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Basic', price: 5000, percent: 90, removeCost: 15000, durationSeconds: 72000 }),
      expect.objectContaining({ name: 'Intricate', price: 30000, percent: 70 }),
      expect.objectContaining({ name: 'Powerful', price: 200000, percent: 50 }),
    ]));
  });

  it('20 categorias', () => {
    expect(childrenOf(root!, 'category')).toHaveLength(20);
  });

  it('Vampirism tier 1 (Life Leech, categoria 1): skill lifeleech bonus 500 chance 100', () => {
    const itemSlugs = readItemSlugsByCanaryId(repoRoot);
    const { entity } = convertImbuement(realByName('Vampirism', '1'), PATH, commit, itemSlugs);
    expect(entity).toMatchObject({
      id: 'vampirism-1', categoryId: '1', baseId: '1',
      effect: { type: 'skill', skill: 'lifeleech', bonus: 500, chance: 100 },
    });
  });

  it('Swiftness tier 3 (Increase Speed, categoria 10): speed 30, sem scroll na entidade', () => {
    const itemSlugs = readItemSlugsByCanaryId(repoRoot);
    const { entity } = convertImbuement(realByName('Swiftness', '3'), PATH, commit, itemSlugs);
    expect(entity).toMatchObject({ id: 'swiftness-3', categoryId: '10', effect: { type: 'speed', amount: 30 } });
    expect(entity).not.toHaveProperty('scroll');
  });

  it('72 imbuements no total, com o catálogo real de itens', () => {
    const ctx: CatalogImportContext = {
      canaryDir: dir, forgottenServerDir: '/nao/existe', canaryCommit: commit, forgottenServerCommit: '',
    };
    const catalog = readImbuementCatalog(ctx, repoRoot);
    expect(childrenOf(root!, 'imbuement')).toHaveLength(72);
    expect(catalog.imbuements.length).toBeGreaterThan(0);
    expect(catalog.imbuements.length).toBeLessThanOrEqual(72);
  });
});
