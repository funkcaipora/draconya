import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { itemSchema } from '../../packages/content/src/schemas.js';
import { readSourceCommit } from './env.js';
import {
  classify, convertItem, parseVocationRequirement, readItemCatalog, reconcileAuthored, writeOverrides,
} from './items.js';
import type { CatalogImportContext } from './registry.js';
import { childrenOf, parseXml } from './xml.js';

const COMMIT = 'a'.repeat(40);
const PATH = 'data/items/items.xml';

/** Staging carrega `appearanceId` (#748, o mesmo recurso que `outfitId` já usa em
 *  `monsters.test.ts`/`asMonster`) — `itemSchema` não o declara, então todo teste que valida a
 *  entidade CONVERTIDA contra o schema real precisa tirá-lo primeiro, como `promote-items.ts`
 *  faz de verdade antes de escrever `data/items/generated/`. */
function asItem(entity: unknown): unknown {
  const { appearanceId: _appearanceId, ...rest } = entity as Record<string, unknown>;
  return rest;
}

// Fixture SINTÉTICA no formato do Canary — números inventados, nunca um arquivo real copiado
// (ADR 0019/0038 d.7).
const ITEMS_XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<items>
	<item id="90001" article="a" name="test sword">
		<attribute key="primarytype" value="sword weapons"/>
		<attribute key="weaponType" value="sword"/>
		<attribute key="attack" value="14"/>
		<attribute key="extradef" value="1"/>
		<attribute key="defense" value="12"/>
		<attribute key="weight" value="3500"/>
		<attribute key="imbuementslot" value="2"/>
		<attribute key="script" value="moveevent;weapon">
			<attribute key="weaponType" value="sword"/>
			<attribute key="slot" value="hand"/>
		</attribute>
	</item>
	<item id="90002" article="a" name="test two handed sword">
		<attribute key="primarytype" value="sword weapons"/>
		<attribute key="weaponType" value="sword"/>
		<attribute key="slotType" value="two-handed"/>
		<attribute key="attack" value="30"/>
		<attribute key="weight" value="7000"/>
		<attribute key="script" value="moveevent;weapon">
			<attribute key="level" value="20"/>
			<attribute key="unproperly" value="true"/>
			<attribute key="weaponType" value="sword"/>
			<attribute key="vocation" value="Knight;true, Elite Knight"/>
		</attribute>
	</item>
	<item id="90003" article="a" name="test fire sword">
		<attribute key="primarytype" value="sword weapons"/>
		<attribute key="weaponType" value="sword"/>
		<attribute key="elementfire" value="11"/>
		<attribute key="attack" value="24"/>
		<attribute key="weight" value="2300"/>
		<attribute key="script" value="moveevent;weapon">
			<attribute key="level" value="30"/>
			<attribute key="unproperly" value="true"/>
			<attribute key="weaponType" value="sword"/>
			<attribute key="slot" value="hand"/>
		</attribute>
	</item>
	<item id="90004" article="a" name="test bow">
		<attribute key="primarytype" value="distance weapons"/>
		<attribute key="weaponType" value="distance"/>
		<attribute key="slotType" value="two-handed"/>
		<attribute key="ammotype" value="arrow"/>
		<attribute key="range" value="6"/>
		<attribute key="weight" value="3100"/>
		<attribute key="script" value="moveevent;weapon">
			<attribute key="weaponType" value="distance"/>
		</attribute>
	</item>
	<item id="90005" article="a" name="test throwing star">
		<attribute key="primarytype" value="distance weapons"/>
		<attribute key="weaponType" value="distance"/>
		<attribute key="attack" value="10"/>
		<attribute key="weight" value="50"/>
		<attribute key="script" value="moveevent;weapon">
			<attribute key="breakChance" value="10"/>
			<attribute key="weaponType" value="missile"/>
		</attribute>
	</item>
	<item id="90042" article="a" name="test unrecognized distance weapon">
		<attribute key="primarytype" value="distance weapons"/>
		<attribute key="weaponType" value="distance"/>
		<attribute key="attack" value="5"/>
		<attribute key="weight" value="50"/>
	</item>
	<item id="90006" article="a" name="test wand of testing">
		<attribute key="weaponType" value="wand"/>
		<attribute key="shootType" value="energy"/>
		<attribute key="range" value="3"/>
		<attribute key="weight" value="1900"/>
		<attribute key="script" value="moveevent;weapon">
			<attribute key="level" value="6"/>
			<attribute key="mana" value="1"/>
			<attribute key="fromDamage" value="8"/>
			<attribute key="toDamage" value="18"/>
			<attribute key="weaponType" value="wand"/>
			<attribute key="wandType" value="energy"/>
			<attribute key="vocation" value="Sorcerer;true, Master Sorcerer"/>
			<attribute key="slot" value="hand"/>
		</attribute>
	</item>
	<item id="90007" article="a" name="test rod of testing">
		<attribute key="primarytype" value="rods"/>
		<attribute key="weaponType" value="wand"/>
		<attribute key="range" value="3"/>
		<attribute key="weight" value="1900"/>
		<attribute key="script" value="moveevent;weapon">
			<attribute key="level" value="6"/>
			<attribute key="mana" value="2"/>
			<attribute key="fromDamage" value="8"/>
			<attribute key="toDamage" value="18"/>
			<attribute key="weaponType" value="wand"/>
			<attribute key="wandType" value="earth"/>
			<attribute key="vocation" value="Druid;true, Elder Druid"/>
			<attribute key="slot" value="hand"/>
		</attribute>
	</item>
	<item id="90008" article="a" name="test shield">
		<attribute key="primarytype" value="shields"/>
		<attribute key="weaponType" value="shield"/>
		<attribute key="defense" value="14"/>
		<attribute key="weight" value="4000"/>
		<attribute key="script" value="moveevent">
			<attribute key="slot" value="shield"/>
		</attribute>
	</item>
	<item id="90009" article="a" name="test spellbook">
		<attribute key="primarytype" value="spellbooks"/>
		<attribute key="weaponType" value="spellbook"/>
		<attribute key="defense" value="14"/>
		<attribute key="weight" value="1800"/>
		<attribute key="script" value="moveevent">
			<attribute key="slot" value="shield"/>
			<attribute key="vocation" value="Sorcerer;true, Druid;true, Master Sorcerer, Elder Druid"/>
		</attribute>
	</item>
	<item id="90010" article="a" name="test jungle quiver">
		<attribute key="primarytype" value="quivers"/>
		<attribute key="slotType" value="right-hand"/>
		<attribute key="containersize" value="8"/>
		<attribute key="weight" value="1800"/>
		<attribute key="script" value="moveevent">
			<attribute key="slot" value="right-hand"/>
		</attribute>
	</item>
	<item id="90043" article="an" name="test eldritch quiver">
		<attribute key="primarytype" value="quivers"/>
		<attribute key="slotType" value="right-hand"/>
		<attribute key="containersize" value="8"/>
		<attribute key="weight" value="2200"/>
		<attribute key="perfectshotdamage" value="20"/>
		<attribute key="perfectshotrange" value="4"/>
		<attribute key="script" value="moveevent">
			<attribute key="level" value="250"/>
			<attribute key="slot" value="right-hand"/>
		</attribute>
	</item>
	<item id="90011" article="a" name="test steel helmet">
		<attribute key="primarytype" value="helmets"/>
		<attribute key="armor" value="6"/>
		<attribute key="weight" value="4600"/>
		<attribute key="script" value="moveevent">
			<attribute key="slot" value="head"/>
		</attribute>
	</item>
	<item id="90012" article="a" name="test magic plate armor">
		<attribute key="primarytype" value="armors"/>
		<attribute key="armor" value="17"/>
		<attribute key="weight" value="8500"/>
		<attribute key="imbuementslot" value="2"/>
		<attribute key="script" value="moveevent">
			<attribute key="slot" value="armor"/>
		</attribute>
	</item>
	<item id="90013" article="a" name="test plate legs">
		<attribute key="primarytype" value="legs"/>
		<attribute key="armor" value="8"/>
		<attribute key="weight" value="1500"/>
		<attribute key="script" value="moveevent">
			<attribute key="slot" value="legs"/>
		</attribute>
	</item>
	<item id="90014" article="a" name="test steel boots">
		<attribute key="primarytype" value="boots"/>
		<attribute key="armor" value="1"/>
		<attribute key="weight" value="1200"/>
		<attribute key="script" value="moveevent">
			<attribute key="slot" value="feet"/>
		</attribute>
	</item>
	<item id="90015" article="a" name="test might ring">
		<attribute key="primarytype" value="rings"/>
		<attribute key="absorbpercentphysical" value="20"/>
		<attribute key="absorbpercentpoison" value="20"/>
		<attribute key="charges" value="20"/>
		<attribute key="weight" value="100"/>
		<attribute key="script" value="moveevent">
			<attribute key="slot" value="ring"/>
		</attribute>
	</item>
	<item id="90016" article="a" name="test dragon necklace">
		<attribute key="primarytype" value="amulets and necklaces"/>
		<attribute key="absorbpercentfire" value="8"/>
		<attribute key="charges" value="200"/>
		<attribute key="weight" value="630"/>
		<attribute key="script" value="moveevent">
			<attribute key="slot" value="necklace"/>
		</attribute>
	</item>
	<item id="90017" article="a" name="test glimmering fur">
		<attribute key="primarytype" value="creature products"/>
		<attribute key="weight" value="65"/>
	</item>
	<item id="90018" article="a" name="test giant pearl">
		<attribute key="primarytype" value="valuables"/>
		<attribute key="weight" value="80"/>
	</item>
	<item id="90019" article="a" name="test decoration">
		<attribute key="primarytype" value="decoration"/>
		<attribute key="weight" value="10"/>
	</item>
	<item id="90020" name="test boots of haste">
		<attribute key="speed" value="20"/>
		<attribute key="weight" value="750"/>
		<attribute key="script" value="moveevent">
			<attribute key="slot" value="feet"/>
		</attribute>
	</item>
	<item id="90021" article="a" name="test collar of red plasma">
		<attribute key="absorbpercentphysical" value="5"/>
		<attribute key="skillclub" value="4"/>
		<attribute key="skillaxe" value="4"/>
		<attribute key="skillsword" value="4"/>
		<attribute key="weight" value="500"/>
		<attribute key="script" value="moveevent">
			<attribute key="level" value="150"/>
			<attribute key="slot" value="necklace"/>
			<attribute key="vocation" value="Knight;true, Elite Knight"/>
		</attribute>
	</item>
	<item id="90022" article="a" name="test wand of divergent skill">
		<attribute key="skillsword" value="3"/>
		<attribute key="skillaxe" value="5"/>
		<attribute key="weight" value="500"/>
		<attribute key="script">
			<attribute key="slot" value="necklace"/>
		</attribute>
	</item>
	<item id="90023" article="a" name="test regeneration collar">
		<attribute key="healthgain" value="2"/>
		<attribute key="healthticks" value="6000"/>
		<attribute key="managain" value="8"/>
		<attribute key="manaticks" value="6000"/>
		<attribute key="speed" value="5"/>
		<attribute key="suppressdrunk" value="1"/>
		<attribute key="magiclevelpoints" value="3"/>
		<attribute key="firemagiclevelpoints" value="2"/>
		<attribute key="criticalhitchance" value="1000"/>
		<attribute key="criticalhitdamage" value="3500"/>
		<attribute key="lifeleechamount" value="500"/>
		<attribute key="manaleechamount" value="500"/>
		<attribute key="reflectdamage" value="10"/>
		<attribute key="cleavepercent" value="20"/>
		<attribute key="weight" value="200"/>
		<attribute key="script">
			<attribute key="slot" value="necklace"/>
		</attribute>
	</item>
	<item id="90024" article="a" name="test incomplete regeneration">
		<attribute key="healthgain" value="2"/>
		<attribute key="weight" value="200"/>
		<attribute key="script">
			<attribute key="slot" value="necklace"/>
		</attribute>
	</item>
	<item fromid="90030" toid="90031" article="a" name="test ranged blob">
		<attribute key="primarytype" value="creature products"/>
		<attribute key="weight" value="10"/>
	</item>
	<item id="90040" article="a" name="test fist weapon">
		<attribute key="primarytype" value="distance weapons"/>
		<attribute key="weaponType" value="fist"/>
		<attribute key="attack" value="5"/>
		<attribute key="weight" value="100"/>
	</item>
	<item id="90041" article="an" name="test water"/>
	<item id="90042" article="a" name="test rusted shield">
		<attribute key="primarytype" value="valuables"/>
		<attribute key="weaponType" value="shield"/>
		<attribute key="defense" value="1"/>
		<attribute key="weight" value="6500"/>
	</item>
	<item id="90043" name="test broken iks spear">
		<attribute key="primarytype" value="axe weapons"/>
		<attribute key="weight" value="1300"/>
		<attribute key="attack" value="1"/>
		<attribute key="defense" value="1"/>
		<attribute key="weaponType" value="distance"/>
		<attribute key="range" value="3"/>
	</item>
	<item id="90044" article="a" name="test slotless weapon">
		<attribute key="primarytype" value="sword weapons"/>
		<attribute key="weaponType" value="sword"/>
		<attribute key="attack" value="10"/>
		<attribute key="weight" value="3000"/>
		<attribute key="imbuementslot" value="1"/>
	</item>
</items>
`;

function itemsOf(xml: string): ReturnType<typeof childrenOf> {
  return childrenOf(parseXml(xml), 'item');
}

function convert(id: string) {
  const item = itemsOf(ITEMS_XML).find((el) => el.attributes['id'] === id);
  if (item === undefined) throw new Error(`fixture sem item id ${id}`);
  return convertItem(item, PATH, COMMIT);
}

describe('classify', () => {
  it('arma corpo a corpo pelo primarytype', () => {
    expect(classify('sword weapons', 'sword', undefined, 'hand', false)).toEqual({ slice: 'weapons', kind: 'weapon' });
  });

  it('distância com ammotype é lançador; sem ammotype e sem breakChance fica fora do corte', () => {
    expect(classify('distance weapons', 'distance', 'arrow', undefined, false)).toEqual({ slice: 'weapons', kind: 'weapon' });
    const skipped = classify('distance weapons', 'distance', undefined, undefined, false);
    expect('skip' in skipped && skipped.skip).toMatch(/ammotype.*breakChance/);
  });

  it('distância sem ammotype MAS com breakChance é arremessável (#575)', () => {
    expect(classify('distance weapons', 'distance', undefined, undefined, true))
      .toEqual({ slice: 'weapons', kind: 'weapon' });
  });

  it('fist nunca é declarável (DT-01)', () => {
    const skipped = classify('distance weapons', 'fist', undefined, undefined, false);
    expect('skip' in skipped && skipped.skip).toMatch(/fist/);
  });

  it('quiver é item de escudo puro (#575) — sem contêiner, porque a munição não empilha', () => {
    expect(classify('quivers', undefined, undefined, 'right-hand', false))
      .toEqual({ slice: 'shields', kind: 'shield', slot: 'shield' });
  });

  it('sem primarytype nem weaponType, o slot do script ainda classifica (peça de recompensa, #688)', () => {
    expect(classify(undefined, undefined, undefined, 'necklace', false)).toEqual({ slice: 'amulets', kind: 'amulet', slot: 'neck' });
    expect(classify(undefined, undefined, undefined, 'ring', false)).toEqual({ slice: 'rings', kind: 'ring', slot: 'finger' });
    expect(classify(undefined, undefined, undefined, undefined, false)).toMatchObject({ skip: expect.stringMatching(/sem categoria/) });
  });
});

describe('parseVocationRequirement', () => {
  it('"None;true" não exige vocação', () => {
    expect(parseVocationRequirement('None;true')).toBeUndefined();
  });
  it('uma vocação', () => {
    expect(parseVocationRequirement('Sorcerer;true, Master Sorcerer')).toBe('sorcerer');
  });
  it('duas vocações, ordenadas', () => {
    expect(parseVocationRequirement('Knight;true, Paladin;true, Elite Knight, Royal Paladin')).toEqual(['knight', 'paladin']);
  });
  it('ausente', () => {
    expect(parseVocationRequirement(undefined)).toBeUndefined();
  });
});

describe('convertItem', () => {
  it('espada: attack/defense/extraDefense/imbuementSlots, sem requisito', () => {
    const sword = convert('90001');
    expect(sword?.blockers).toEqual([]);
    expect(sword?.entity).toMatchObject({
      id: 'test-sword', name: 'test sword', kind: 'weapon', slot: 'hand',
      weight: 35, attack: 14, defense: 12, extraDefense: 1, imbuementSlots: 2,
      weapon: { kind: 'melee', family: 'sword' },
    });
    expect(itemSchema.parse(asItem(sword?.entity))).toBeTruthy();
  });

  it('espada de duas mãos: twoHanded, requires.level e vocationId, unproperly', () => {
    const twoHanded = convert('90002');
    expect(twoHanded?.entity).toMatchObject({
      twoHanded: true, requires: { level: 20, vocationId: 'knight' },
      weapon: { wieldUnproperly: true },
    });
  });

  it('elemento da arma corpo a corpo (#687) — attack físico separado do elemento', () => {
    const fireSword = convert('90003');
    expect(fireSword?.entity['attack']).toBe(24);
    expect(fireSword?.entity['weapon']).toMatchObject({ element: { type: 'fire', attack: 11 } });
    expect(itemSchema.parse(asItem(fireSword?.entity))).toBeTruthy();
  });

  it('bow real (com ammotype) vira arma de distância; arma de distância sem os dois campos fica fora', () => {
    const bow = convert('90004');
    expect(bow?.blockers).toEqual([]);
    expect(bow?.entity).toMatchObject({ twoHanded: true, weapon: { family: 'distance', ammoFamily: 'arrow', range: 6 } });
    const unrecognized = convert('90042');
    expect(unrecognized?.blockers[0]).toMatch(/ammotype.*breakChance/);
  });

  it('throwing star sem ammotype MAS com breakChance é arremessável (#575): attack próprio, sem ammoFamily', () => {
    const star = convert('90005');
    expect(star?.blockers).toEqual([]);
    expect(star?.entity).toMatchObject({ attack: 10, weapon: { family: 'distance', breakChance: 10 } });
    expect(star?.entity['weapon']).not.toHaveProperty('ammoFamily');
    expect(itemSchema.parse(star?.entity)).toBeTruthy();
  });

  it('wand sem primarytype ainda entra pelo weaponType (a Wand of Vortex real, id 3074)', () => {
    const wand = convert('90006');
    expect(wand?.blockers).toEqual([]);
    expect(wand?.entity['weapon']).toMatchObject({
      kind: 'wand', family: 'wand', damageType: 'energy', manaPerHit: 1, damage: { min: 8, max: 18 },
    });
  });

  it('rod pela vocação druid quando falta primarytype "rods" explícito, e pelo primarytype quando presente', () => {
    const rod = convert('90007');
    expect(rod?.entity['weapon']).toMatchObject({ family: 'rod', damageType: 'earth', manaPerHit: 2 });
  });

  it('escudo e spellbook (kind shield, slot shield, spellbook: true no segundo)', () => {
    const shield = convert('90008');
    expect(shield?.entity).toMatchObject({ kind: 'shield', slot: 'shield', defense: 14 });
    expect(shield?.entity['spellbook']).toBeUndefined();
    const spellbook = convert('90009');
    expect(spellbook?.entity).toMatchObject({ kind: 'shield', slot: 'shield', spellbook: true });
  });

  it('quiver comum (#575): kind shield, slot shield, quiver: true, sem perfectShot', () => {
    const quiver = convert('90010');
    expect(quiver?.blockers).toEqual([]);
    expect(quiver?.entity).toMatchObject({ kind: 'shield', slot: 'shield', quiver: true });
    expect(quiver?.entity).not.toHaveProperty('perfectShot');
    expect(itemSchema.parse(quiver?.entity)).toBeTruthy();
  });

  it('eldritch quiver (#575): perfectShot { range, damage } dos atributos perfectshotrange/perfectshotdamage', () => {
    const eldritch = convert('90043');
    expect(eldritch?.blockers).toEqual([]);
    expect(eldritch?.entity).toMatchObject({
      kind: 'shield', slot: 'shield', quiver: true, perfectShot: { range: 4, damage: 20 },
    });
    expect(itemSchema.parse(eldritch?.entity)).toBeTruthy();
  });

  it('arma sem <script>/slot declarado recebe slot "hand" por default (a maioria das armas do Canary)', () => {
    const slotless = convert('90044');
    expect(slotless?.blockers).toEqual([]);
    expect(slotless?.entity).toMatchObject({ kind: 'weapon', slot: 'hand', imbuementSlots: 1 });
    expect(itemSchema.parse(asItem(slotless?.entity))).toBeTruthy();
  });

  it('defense de item classificado "valuables"/"creature products" (curiosidade de quest) não entra na entidade', () => {
    const rustedShield = convert('90042');
    expect(rustedShield?.blockers).toEqual([]);
    expect(rustedShield?.entity).toMatchObject({ kind: 'other' });
    expect(rustedShield?.entity['defense']).toBeUndefined();
    expect(rustedShield?.entity['weapon']).toBeUndefined();
  });

  it('arma de distância cujo primarytype MENTE (diz "axe weapons", weaponType é "distance") ainda cai fora do corte por falta de ammoFamily', () => {
    const brokenSpear = convert('90043');
    expect(brokenSpear?.blockers[0]).toMatch(/M34-04/);
  });

  it('helmet/armor/legs/boots pelo primarytype, com o slot correspondente', () => {
    expect(convert('90011')?.entity).toMatchObject({ kind: 'armor', slot: 'head', armor: 6 });
    expect(convert('90012')?.entity).toMatchObject({ kind: 'armor', slot: 'chest', armor: 17, imbuementSlots: 2 });
    expect(convert('90013')?.entity).toMatchObject({ kind: 'armor', slot: 'legs', armor: 8 });
    expect(convert('90014')?.entity).toMatchObject({ kind: 'armor', slot: 'feet', armor: 1 });
  });

  it('anel com absorb (poison mapeia para earth, #552) e amuleto com absorb+charges', () => {
    const ring = convert('90015');
    expect(ring?.entity).toMatchObject({
      kind: 'ring', slot: 'finger', charges: 20,
      absorb: { physical: { percent: 20 }, earth: { percent: 20 } },
    });
    const amulet = convert('90016');
    expect(amulet?.entity).toMatchObject({
      kind: 'amulet', slot: 'neck', charges: 200, weight: 6.3,
      absorb: { fire: { percent: 8 } },
    });
  });

  it('creature product e valuable (kind other, sem slot)', () => {
    expect(convert('90017')?.entity).toMatchObject({ kind: 'other' });
    expect(convert('90017')?.entity['slot']).toBeUndefined();
    expect(convert('90018')?.entity).toMatchObject({ kind: 'other' });
  });

  it('decoração comum tem primarytype, então vira PULADO (aparece no relatório), não some em silêncio', () => {
    const decoration = convert('90019');
    expect(decoration?.blockers[0]).toMatch(/sem categoria/);
  });

  it('item sem primarytype nem atributo nenhum (água) some em silêncio — nem isso vira nota', () => {
    expect(convert('90041')).toBeUndefined();
  });

  it('bônus de velocidade sem primarytype (Boots of Haste real, id 3079)', () => {
    const boots = convert('90020');
    expect(boots?.entity).toMatchObject({ kind: 'armor', slot: 'feet', bonuses: { speed: 20 } });
  });

  it('skillsword/skillaxe/skillclub iguais viram UMA bonuses.skills melee (Collar of Red Plasma real, #688)', () => {
    const collar = convert('90021');
    expect(collar?.entity).toMatchObject({
      kind: 'amulet', slot: 'neck', requires: { level: 150, vocationId: 'knight' },
      bonuses: { skills: [{ skillId: 'melee', amount: 4 }] },
      absorb: { physical: { percent: 5 } },
    });
  });

  it('skillsword/skillaxe divergentes usam o maior e registram a divergência', () => {
    const divergent = convert('90022');
    expect(divergent?.entity['bonuses']).toMatchObject({ skills: [{ skillId: 'melee', amount: 5 }] });
    expect(divergent?.ignoredFields.some((f) => f.includes('divergentes'))).toBe(true);
  });

  it('todos os bônus de #688/#680/#552/#551 juntos, e todos passam no itemSchema real', () => {
    const item = convert('90023');
    expect(item?.entity['bonuses']).toMatchObject({
      speed: 5, suppress: ['drunk'],
      specializedMagicLevel: { fire: 2 },
      regeneration: { healthGain: 2, healthTicksMs: 6_000_000, manaGain: 8, manaTicksMs: 6_000_000 },
      skills: [{ skillId: 'magic', amount: 3 }],
    });
    expect(item?.entity['combatModifiers']).toEqual({
      criticalChance: 1000, criticalDamage: 3500, lifeLeech: 500, manaLeech: 500,
    });
    expect(item?.entity['reflect']).toEqual({ physical: { flat: 10 } });
    expect(item?.entity['cleavePercent']).toBe(20);
    expect(itemSchema.parse(asItem(item?.entity))).toBeTruthy();
  });

  it('regeneração incompleta (sem o par de ticks) é descartada e registrada', () => {
    const item = convert('90024');
    expect(item?.entity['bonuses']).toBeUndefined();
    expect(item?.ignoredFields.some((f) => f.includes('incompleta'))).toBe(true);
  });

  it('faixa fromid/toid sem nome único não é convertida (sem `id` — #573 não resolve range)', () => {
    const ranged = itemsOf(ITEMS_XML).find((el) => el.attributes['fromid'] === '90030');
    expect(ranged).toBeDefined();
    expect(convertItem(ranged!, PATH, COMMIT)).toBeUndefined();
  });

  it('fist não gera nem bloqueia — some junto com o restante do vocabulário do item', () => {
    const fist = convert('90040');
    expect(fist?.blockers[0]).toMatch(/fist/);
  });

  it('item sem primarytype nem atributo de bônus (água) some silenciosamente', () => {
    expect(convert('90041')).toBeUndefined();
  });

  it('sem prices (4º parâmetro omitido): value sai 0 — o comportamento de antes do #574', () => {
    const item = convert('90001');
    expect(item?.entity['value']).toBe(0);
  });

  it('com prices: value é o maior sell agregado para o id do Canary (#574)', () => {
    const item = itemsOf(ITEMS_XML).find((el) => el.attributes['id'] === '90001');
    const prices = {
      sellMaxByClientId: new Map([[90001, { amount: 30, itemName: 'test sword', npcFile: 'test.lua' }]]),
    };
    const converted = convertItem(item!, PATH, COMMIT, prices);
    expect(converted?.entity['value']).toBe(30);
  });

  it('com prices mas sem observação para este id: value continua 0', () => {
    const item = itemsOf(ITEMS_XML).find((el) => el.attributes['id'] === '90001');
    const converted = convertItem(item!, PATH, COMMIT, { sellMaxByClientId: new Map() });
    expect(converted?.entity['value']).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// O catálogo inteiro e a reconciliação, contra um diretório TEMPORÁRIO de itens autorais.

describe('readItemCatalog e reconcileAuthored', () => {
  function withTempDir(run: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'draconya-items-test-'));
    try {
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('reconcileAuthored: sem arquivo autoral, sem override', () => {
    withTempDir((dir) => {
      const generated = { id: 'ghost', name: 'Ghost', source: { engine: 'canary' as const, commit: COMMIT, path: PATH } };
      expect(reconcileAuthored(generated, dir, COMMIT)).toBeUndefined();
    });
  });

  it('reconcileAuthored: value divergente (#574) vira patch — sword já correto não gera override', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'mace.json'), JSON.stringify({ id: 'mace', name: 'Mace', kind: 'weapon', weight: 34, value: 0, attack: 28 }));
      const generatedMace = {
        id: 'mace', name: 'Mace', kind: 'weapon', weight: 34, value: 30, attack: 28,
        source: { engine: 'canary' as const, commit: COMMIT, path: PATH },
      };
      const override = reconcileAuthored(generatedMace, dir, COMMIT);
      expect(override?.patch).toEqual({ value: 30 });
      expect(override?.reason).toMatch(/value: 0 → 30/);

      writeFileSync(join(dir, 'sword.json'), JSON.stringify({ id: 'sword', name: 'Sword', kind: 'weapon', weight: 35, value: 25, attack: 14 }));
      const generatedSword = {
        id: 'sword', name: 'Sword', kind: 'weapon', weight: 35, value: 25, attack: 14,
        source: { engine: 'canary' as const, commit: COMMIT, path: PATH },
      };
      expect(reconcileAuthored(generatedSword, dir, COMMIT)).toBeUndefined();
    });
  });

  it('reconcileAuthored: campo numérico divergente vira patch com o motivo', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'old-sword.json'), JSON.stringify({
        id: 'old-sword', name: 'Old Sword', kind: 'weapon', slot: 'hand', weight: 35, value: 0,
        attack: 14, defense: 10,
      }));
      const generated = {
        id: 'old-sword', name: 'Old Sword', kind: 'weapon', slot: 'hand', weight: 35, value: 0,
        attack: 14, defense: 12, extraDefense: 1,
        source: { engine: 'canary' as const, commit: COMMIT, path: PATH },
      };
      const override = reconcileAuthored(generated, dir, COMMIT);
      expect(override?.patch).toEqual({ defense: 12, extraDefense: 1 });
      expect(override?.reason).toMatch(/defense: 10 → 12/);
      expect(override?.reason).toMatch(/extraDefense: \(ausente\) → 1/);
    });
  });

  it('reconcileAuthored: idêntico não gera override', () => {
    withTempDir((dir) => {
      const data = { id: 'twin', name: 'Twin', kind: 'weapon', weight: 10, value: 0, attack: 5 };
      writeFileSync(join(dir, 'twin.json'), JSON.stringify(data));
      const generated = { ...data, source: { engine: 'canary' as const, commit: COMMIT, path: PATH } };
      expect(reconcileAuthored(generated, dir, COMMIT)).toBeUndefined();
    });
  });

  it('writeOverrides grava id/reason/patch em data/items/overrides/<id>.json', () => {
    withTempDir((dir) => {
      writeOverrides(dir, [{ id: 'sample', reason: 'motivo de teste', patch: { attack: 99 } }]);
      const written = JSON.parse(readFileSync(join(dir, 'sample.json'), 'utf8'));
      expect(written).toEqual({ id: 'sample', reason: 'motivo de teste', patch: { attack: 99 } });
    });
  });

  it('o catálogo inteiro: fatias, pulados e notas — nada lança para a fixture sintética', () => {
    withTempDir((dir) => {
      mkdirSync(join(dir, 'data', 'items'), { recursive: true });
      writeFileSync(join(dir, 'data', 'items', 'items.xml'), ITEMS_XML);
      const ctx: CatalogImportContext = {
        canaryDir: dir, forgottenServerDir: '/nao/existe', canaryCommit: COMMIT, forgottenServerCommit: '',
      };
      const catalog = readItemCatalog(ctx, { authoredDir: dir });
      expect([...catalog.slices.keys()].sort()).toEqual([
        'amulets', 'armors', 'boots', 'creature-products', 'helmets', 'legs', 'rings', 'shields', 'valuables', 'weapons',
      ]);
      expect(catalog.slices.get('weapons')?.length).toBeGreaterThan(0);
      // O quiver (#575) não é mais pulado — vira `shields` como escudo/spellbook.
      expect(catalog.slices.get('shields')?.some((e) => e['quiver'] === true)).toBe(true);
      expect(catalog.skipped.some((s) => s.reason.includes('breakChance'))).toBe(true);
      expect(catalog.notes?.some((n) => n.includes('M34-03'))).toBe(true);
      for (const entities of catalog.slices.values()) {
        for (const entity of entities) expect(() => itemSchema.parse(asItem(entity))).not.toThrow();
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Contra o checkout real, quando ele está nesta máquina (`CANARY_DIR`) — pulado no CI.

const REAL_CANARY_DIR = process.env['CANARY_DIR'];
const HAS_REAL_CANARY = REAL_CANARY_DIR !== undefined && REAL_CANARY_DIR !== ''
  && existsSync(join(REAL_CANARY_DIR, 'data', 'items', 'items.xml'));

describe.skipIf(!HAS_REAL_CANARY)('leitor contra o Canary real (CANARY_DIR) — 5 itens conhecidos', () => {
  const dir = HAS_REAL_CANARY ? (REAL_CANARY_DIR as string) : '';
  const commit = HAS_REAL_CANARY ? readSourceCommit(dir) : '';
  const root = HAS_REAL_CANARY ? parseXml(readFileSync(join(dir, 'data/items/items.xml'), 'utf8')) : undefined;

  function byId(id: string) {
    const item = childrenOf(root!, 'item').find((el) => el.attributes['id'] === id);
    if (item === undefined) throw new Error(`items.xml sem id ${id}`);
    return convertItem(item, 'data/items/items.xml', commit);
  }

  it('sword (3264): attack 14, defense 12, extradef 1, 35 oz — igual ao sword.json autoral', () => {
    const sword = byId('3264');
    expect(sword?.blockers).toEqual([]);
    expect(sword?.entity).toMatchObject({ attack: 14, defense: 12, extraDefense: 1, weight: 35 });
  });

  it('fire sword (3280): attack 24 físico, elementfire 11 em weapon.element, level 30, unproperly', () => {
    const fireSword = byId('3280');
    expect(fireSword?.entity['attack']).toBe(24);
    expect(fireSword?.entity['weapon']).toMatchObject({ element: { type: 'fire', attack: 11 }, wieldUnproperly: true });
    expect(fireSword?.entity['requires']).toEqual({ level: 30 });
  });

  it('magic plate armor (3366): armor 17, 85 oz, 2 imbuement slots', () => {
    const armor = byId('3366');
    expect(armor?.entity).toMatchObject({ kind: 'armor', slot: 'chest', armor: 17, weight: 85, imbuementSlots: 2 });
  });

  it('might ring (3048): absorb 20% em 7 tipos (poison vira earth), 20 cargas, 1 oz', () => {
    const ring = byId('3048');
    expect(ring?.entity).toMatchObject({ kind: 'ring', slot: 'finger', charges: 20, weight: 1 });
    const absorb = ring?.entity['absorb'] as Record<string, { percent: number }>;
    for (const type of ['physical', 'fire', 'earth', 'energy', 'ice', 'holy', 'death']) {
      expect(absorb[type]?.percent, type).toBe(20);
    }
  });

  it('dragon necklace (3085): absorb fire 8%, 200 cargas, 6,3 oz', () => {
    const necklace = byId('3085');
    expect(necklace?.entity).toMatchObject({
      kind: 'amulet', slot: 'neck', charges: 200, weight: 6.3, absorb: { fire: { percent: 8 } },
    });
  });

  it('spear (3277, #575): arremessável — attack 25 próprio, breakChance 3, range 3, sem ammoFamily', () => {
    const spear = byId('3277');
    expect(spear?.blockers).toEqual([]);
    expect(spear?.entity).toMatchObject({
      attack: 25, weapon: { family: 'distance', range: 3, breakChance: 3 },
    });
    expect(spear?.entity['weapon']).not.toHaveProperty('ammoFamily');
  });

  it('throwing star (3287, #575): arremessável — attack 30, breakChance 10, range 4', () => {
    const star = byId('3287');
    expect(star?.blockers).toEqual([]);
    expect(star?.entity).toMatchObject({
      attack: 30, weapon: { family: 'distance', range: 4, breakChance: 10 },
    });
  });

  it('eldritch quiver (36666, #575): kind shield, quiver true, perfectShot { range: 4, damage: 20 }', () => {
    const quiver = byId('36666');
    expect(quiver?.blockers).toEqual([]);
    expect(quiver?.entity).toMatchObject({
      kind: 'shield', slot: 'shield', quiver: true, perfectShot: { range: 4, damage: 20 },
    });
  });

  it('jungle quiver (35524, #575): kind shield, quiver true, sem perfectShot (a maioria dos quivers)', () => {
    const quiver = byId('35524');
    expect(quiver?.blockers).toEqual([]);
    expect(quiver?.entity).toMatchObject({ kind: 'shield', slot: 'shield', quiver: true });
    expect(quiver?.entity).not.toHaveProperty('perfectShot');
  });
});
