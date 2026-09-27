import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ammunitionSchema } from '../../packages/content/src/schemas.js';
import { readSourceCommit } from './env.js';
import { AUTHORED_AMMO_SLUGS, convertAmmo, readAmmoCatalog } from './ammo.js';
import { AMMO_CANARY_IDS } from './npc-prices.js';
import type { CatalogImportContext } from './registry.js';
import { childrenOf, parseXml } from './xml.js';

const COMMIT = 'a'.repeat(40);
const PATH = 'data/items/items.xml';

// Fixture SINTÉTICA no formato do Canary — números inventados, nunca um arquivo real copiado
// (ADR 0019/0038 d.7).
const ITEMS_XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<items>
	<item id="90101" article="an" name="test arrow">
		<attribute key="primarytype" value="ammunition"/>
		<attribute key="weaponType" value="ammunition"/>
		<attribute key="ammotype" value="arrow"/>
		<attribute key="maxhitchance" value="91"/>
		<attribute key="attack" value="25"/>
		<attribute key="weight" value="70"/>
		<attribute key="script" value="moveevent;weapon">
			<attribute key="action" value="removecount"/>
			<attribute key="slot" value="ammo"/>
		</attribute>
	</item>
	<item id="90102" article="a" name="test flash arrow">
		<attribute key="primarytype" value="ammunition"/>
		<attribute key="weaponType" value="ammunition"/>
		<attribute key="ammotype" value="arrow"/>
		<attribute key="elementenergy" value="14"/>
		<attribute key="maxhitchance" value="91"/>
		<attribute key="attack" value="14"/>
		<attribute key="weight" value="70"/>
		<attribute key="script" value="moveevent;weapon">
			<attribute key="action" value="removecount"/>
			<attribute key="level" value="20"/>
			<attribute key="slot" value="ammo"/>
		</attribute>
	</item>
	<item id="90103" article="a" name="test unpriced arrow">
		<attribute key="primarytype" value="ammunition"/>
		<attribute key="weaponType" value="ammunition"/>
		<attribute key="ammotype" value="arrow"/>
		<attribute key="attack" value="18"/>
		<attribute key="weight" value="70"/>
		<attribute key="script" value="moveevent;weapon">
			<attribute key="action" value="removecount"/>
			<attribute key="slot" value="ammo"/>
		</attribute>
	</item>
	<item id="90104" article="a" name="arrow">
		<attribute key="primarytype" value="ammunition"/>
		<attribute key="weaponType" value="ammunition"/>
		<attribute key="ammotype" value="arrow"/>
		<attribute key="attack" value="25"/>
		<attribute key="weight" value="70"/>
		<attribute key="script" value="moveevent;weapon">
			<attribute key="action" value="removecount"/>
			<attribute key="slot" value="ammo"/>
		</attribute>
	</item>
	<item id="90105" article="a" name="test confused arrow">
		<attribute key="primarytype" value="ammunition"/>
		<attribute key="weaponType" value="ammunition"/>
		<attribute key="ammotype" value="arrow"/>
		<attribute key="elementfire" value="10"/>
		<attribute key="elementice" value="10"/>
		<attribute key="attack" value="10"/>
		<attribute key="weight" value="70"/>
	</item>
	<item id="90106" article="a" name="test spear">
		<attribute key="primarytype" value="distance weapons"/>
		<attribute key="weaponType" value="distance"/>
		<attribute key="attack" value="25"/>
		<attribute key="weight" value="2000"/>
	</item>
</items>
`;

function itemsOf(xml: string) {
  return childrenOf(parseXml(xml), 'item');
}

function convert(id: string, priced = true) {
  const item = itemsOf(ITEMS_XML).find((el) => el.attributes['id'] === id);
  if (item === undefined) throw new Error(`fixture sem item id ${id}`);
  const prices = priced
    ? { buyMinByClientId: new Map([[90101, { amount: 1, itemName: 'test arrow', npcFile: 'a.lua' }],
      [90102, { amount: 3, itemName: 'test flash arrow', npcFile: 'a.lua' }]]) }
    : undefined;
  return convertAmmo(item, PATH, COMMIT, prices);
}

describe('convertAmmo', () => {
  it('munição comum: family/attack/price/maxHitChance', () => {
    const arrow = convert('90101');
    expect(arrow?.blockers).toEqual([]);
    expect(arrow?.entity).toMatchObject({ family: 'arrow', attack: 25, price: 1, maxHitChance: 91 });
    expect(ammunitionSchema.parse(arrow?.entity)).toBeTruthy();
  });

  it('munição elemental: o element<tipo> vira damageType, attack continua o número do tiro', () => {
    const flash = convert('90102');
    expect(flash?.blockers).toEqual([]);
    expect(flash?.entity).toMatchObject({
      family: 'arrow', attack: 14, damageType: 'energy', price: 3, requires: { level: 20 },
    });
  });

  it('sem NPC vendendo: bloqueia — munição não tem preço grátis (ADR 0026 d.3)', () => {
    const unpriced = convert('90103');
    expect(unpriced?.blockers[0]).toMatch(/NPC vendendo/);
  });

  it('slug autoral (arrow): nunca gerado aqui — npc-prices.ts (#574) já precifica', () => {
    const authored = convert('90104');
    expect(authored?.blockers[0]).toMatch(/autoral/);
    expect(AUTHORED_AMMO_SLUGS.has('arrow')).toBe(true);
  });

  it('mais de um elemento é dado quebrado: bloqueia', () => {
    const confused = convert('90105', false);
    expect(confused?.blockers.some((b) => b.includes('mais de um elemento'))).toBe(true);
  });

  it('item que não é munição (primarytype diferente) devolve undefined', () => {
    expect(convert('90106')).toBeUndefined();
  });
});

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'draconya-ammo-test-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('readAmmoCatalog', () => {
  it('o catálogo inteiro: a fatia ammunition, pulados e notas — nada lança para a fixture sintética', () => {
    withTempDir((dir) => {
      mkdirSync(join(dir, 'data', 'items'), { recursive: true });
      writeFileSync(join(dir, 'data', 'items', 'items.xml'), ITEMS_XML);
      const ctx: CatalogImportContext = {
        canaryDir: dir, forgottenServerDir: '/nao/existe', canaryCommit: COMMIT, forgottenServerCommit: '',
      };
      // Sem `prices`: todo item vira blocker "sem NPC vendendo", mas nada lança — o schema
      // continua satisfeito porque o item nunca entra na fatia.
      const catalog = readAmmoCatalog(ctx);
      expect([...catalog.slices.keys()]).toEqual(['ammunition']);
      expect(catalog.slices.get('ammunition')).toEqual([]);
      expect(catalog.skipped.length).toBeGreaterThan(0);
      expect(catalog.notes?.some((n) => n.includes('AMMO_CANARY_IDS'))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Contra o checkout real, quando ele está nesta máquina (`CANARY_DIR`) — pulado no CI.

const REAL_CANARY_DIR = process.env['CANARY_DIR'];
const HAS_REAL_CANARY = REAL_CANARY_DIR !== undefined && REAL_CANARY_DIR !== ''
  && existsSync(join(REAL_CANARY_DIR, 'data', 'items', 'items.xml'));

describe.skipIf(!HAS_REAL_CANARY)('leitor contra o Canary real (CANARY_DIR)', () => {
  const dir = HAS_REAL_CANARY ? (REAL_CANARY_DIR as string) : '';
  const commit = HAS_REAL_CANARY ? readSourceCommit(dir) : '';
  const root = HAS_REAL_CANARY ? parseXml(readFileSync(join(dir, 'data/items/items.xml'), 'utf8')) : undefined;

  function byId(id: string) {
    const item = childrenOf(root!, 'item').find((el) => el.attributes['id'] === id);
    if (item === undefined) throw new Error(`items.xml sem id ${id}`);
    return convertAmmo(item, PATH, commit);
  }

  it('flash arrow (761): family arrow, damageType energy, attack 14 — sem preço nesta chamada (blocker)', () => {
    const flash = byId('761');
    expect(flash?.entity).toMatchObject({ family: 'arrow', attack: 14, damageType: 'energy' });
    // Sem `prices`, todo item vira blocker "sem NPC vendendo" — o preço real é conferido no
    // teste do catálogo inteiro, que passa `readNpcShopPrices(ctx)` de verdade.
    expect(flash?.blockers[0]).toMatch(/NPC vendendo/);
  });

  it('o catálogo inteiro com preços reais: os 5 slugs autorais nunca aparecem gerados', () => {
    const ctx: CatalogImportContext = {
      canaryDir: dir, forgottenServerDir: '/nao/existe', canaryCommit: commit, forgottenServerCommit: '',
    };
    const catalog = readAmmoCatalog(ctx);
    const generatedIds = new Set(catalog.slices.get('ammunition')?.map((e) => e.id) ?? []);
    for (const slug of AUTHORED_AMMO_SLUGS) expect(generatedIds.has(slug)).toBe(false);
    // Confere que `AMMO_CANARY_IDS` (#574) e `AUTHORED_AMMO_SLUGS` (#575) concordam — as duas
    // listas existem por razões diferentes e não devem divergir silenciosamente.
    expect(new Set(Object.keys(AMMO_CANARY_IDS))).toEqual(AUTHORED_AMMO_SLUGS);
  });
});
