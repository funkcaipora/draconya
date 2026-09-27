// scripts/catalog/items.ts — o leitor de itens do Canary (M34-02, #573; ADR 0037/0038).
//
//   pnpm catalog:import items          # escreve packages/content/staging/items/generated/*.json
//   pnpm catalog:import items --check  # regenera em memória e compara
//
// Lê `data/items/items.xml` como DADO (`xml.ts`, nunca o binário `items.otb`) e converte cada
// `<item>` das categorias de CAÇA — arma, escudo/spellbook, capacete, armadura, pernas, bota,
// anel, amuleto, valuables e produto de criatura — para a forma do `itemSchema` de
// `@draconya/content`. O que sai é número e fato (ADR 0019 limite 1): nunca uma linha do Canary
// reproduzida, nunca um preço inventado.
//
// **Por que `staging/` e não `data/items/generated/`** (a mesma razão do #578/monsters.ts):
// o `--check` e a auditoria de 2026-09-26 (`docs/tibia-math-plan.md`) contam 1439 `itemId`
// citados pelo loot de monstro gerado (#578), dos quais só 82 existem hoje no catálogo autoral.
// Gerar 1300+ itens direto em `data/` sem reconciliação de cada um seria arriscar o boot; a
// primeira promoção para `data/` (loot de monstro resolvendo por item de verdade) é issue à
// parte. O registro aponta `packages/content/staging/items` até lá.
//
// **Reconciliação dos 73 itens autorais** (ADR 0014: o id nunca muda). Quando o slug gerado
// aqui bate com um arquivo autoral existente, `reconcileAuthored` compara os campos que os dois
// lados declaram e escreve `packages/content/data/items/overrides/<id>.json` — a correção real,
// carregada no boot — para cada divergência numérica contra o Canary, nunca editando o autoral
// à mão (o comentário do `_open` seria a próxima fonte de verdade errada).
//
// **O que fica de fora, e aparece no relatório** (`docs/reference/catalog/items-report.md`):
// spellbook/varinha sem elemento reconhecido, arma `fist` (família não declarável) e todo
// atributo lido sem campo correspondente no schema desta base. Munição, arremessável e quiver
// (M34-04, #575) são gerados: munição vai para o tipo de catálogo `ammo` (`ammo.ts`, schema
// próprio); arremessável e quiver entram AQUI, na fatia `weapons`/`shields`, porque os dois já
// cabem no `itemSchema` (`weapon.breakChance`, `perfectShot`).
//
// **Preço (`value`, M34-03/#574)**: `items.xml` não carrega preço — vem de
// `data-otservbr-global/npc/*.lua`, lido por `npc-prices.ts` (`readNpcShopPrices`) e passado
// aqui como `ItemPriceLookup`. `value` é o MAIOR `sell` observado para o `id` do item entre
// todo NPC (exceto o Nah'Bob — ver o cabeçalho de `npc-prices.ts`); `0` quando nenhum NPC vende
// (o mesmo "não se vende" do schema, §22.1).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CatalogEntity, CatalogSource } from './generated-writer.js';
import { slugify } from './monsters.js';
import { readNpcShopPrices, type ShopPriceObservation } from './npc-prices.js';
import { registerCatalogType, type CatalogImportContext, type CatalogImportResult } from './registry.js';
import type { SkippedEntity } from './report.js';
import { attrOptional, childrenOf, readXmlFile, type XmlElement } from './xml.js';
import { repoRootFrom } from './env.js';

/** `items.xml` — a fonte única desta issue. */
export const CANARY_ITEMS_XML = 'data/items/items.xml';

/** Diretório real (carregado no boot) dos 73 itens autorais e das correções (ADR 0014). */
export const AUTHORED_ITEMS_DIR = 'packages/content/data/items';

// ---------------------------------------------------------------------------------------------
// Acesso tipado aos atributos de UM `<item>` (e de um `<attribute>` aninhado, mesma forma).

/** `key → <attribute>` de um elemento, primeira ocorrência vence (o Canary não repete). */
export function attributesOf(element: XmlElement): ReadonlyMap<string, XmlElement> {
  const map = new Map<string, XmlElement>();
  for (const child of childrenOf(element, 'attribute')) {
    const key = attrOptional(child, 'key');
    if (key !== undefined && !map.has(key)) map.set(key, child);
  }
  return map;
}

function value(attrs: ReadonlyMap<string, XmlElement>, key: string): string | undefined {
  return attrs.get(key)?.attributes['value'];
}

function numberValue(attrs: ReadonlyMap<string, XmlElement>, key: string): number | undefined {
  const raw = value(attrs, key);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// ---------------------------------------------------------------------------------------------
// Vocabulário do Canary → vocabulário do Draconya.

/**
 * `script.slot` do Canary → `ITEM_SLOTS` do Draconya. `right-hand` é o do quiver (#575): o
 * carcás que ocupa a mão secundária, mapeado para `shield` — o mesmo slot de escudo/spellbook
 * (ADR 0026; `itemSchema.quiver`/`perfectShot`, `content/AGENTS.md` "Munição").
 */
const SLOT_MAP: Readonly<Record<string, string>> = {
  head: 'head', body: 'chest', armor: 'chest', legs: 'legs', feet: 'feet',
  ring: 'finger', necklace: 'neck', shield: 'shield', ammo: 'ammo', backpack: 'back', hand: 'hand',
  'right-hand': 'shield',
};

/** `wandType` (rod/wand) → `DamageType`. Sem `holy`/`physical`: nenhuma wand/rod do Canary os usa. */
const WAND_TYPE_TO_DAMAGE: Readonly<Record<string, string>> = {
  death: 'death', earth: 'earth', energy: 'energy', fire: 'fire', ice: 'ice',
};

/** `element<tipo>` (arma corpo a corpo, e a munição elemental do #575 em `ammo.ts`) → `DamageType`. */
export const ELEMENT_ATTR_TO_DAMAGE: ReadonlyMap<string, string> = new Map([
  ['elementdeath', 'death'], ['elementearth', 'earth'], ['elementenergy', 'energy'],
  ['elementfire', 'fire'], ['elementice', 'ice'], ['elementholy', 'holy'], ['elementphysical', 'physical'],
]);

/** `absorbpercent<tipo>` → `DamageType`. `poison` é o nome legado de `earth` (mesmo `COMBAT_EARTHDAMAGE`
 *  no parser do Canary — conferido em `might-ring.json`, #552). */
const ABSORB_ATTR_TO_DAMAGE: ReadonlyMap<string, string> = new Map([
  ['absorbpercentdeath', 'death'], ['absorbpercentdrown', 'drown'], ['absorbpercentearth', 'earth'],
  ['absorbpercentenergy', 'energy'], ['absorbpercentfire', 'fire'], ['absorbpercentholy', 'holy'],
  ['absorbpercentice', 'ice'], ['absorbpercentlifedrain', 'lifedrain'], ['absorbpercentmanadrain', 'manadrain'],
  ['absorbpercentphysical', 'physical'], ['absorbpercentpoison', 'earth'],
]);

/** As 7 chaves `<elemento>magiclevelpoints` que este checkout do Canary declara (#680). */
const SPECIALIZED_MAGIC_ATTR_TO_ELEMENT: ReadonlyMap<string, string> = new Map([
  ['deathmagiclevelpoints', 'death'], ['earthmagiclevelpoints', 'earth'], ['energymagiclevelpoints', 'energy'],
  ['firemagiclevelpoints', 'fire'], ['healingmagiclevelpoints', 'healing'], ['holymagiclevelpoints', 'holy'],
  ['icemagiclevelpoints', 'ice'], ['physicalmagiclevelpoints', 'physical'],
]);

/**
 * `skill<família>` do Canary → a skill separada correspondente do Draconya (#567/#568): desde a
 * migração de `melee` para `fist`/`club`/`sword`/`axe`, cada atributo vira o bônus da SUA
 * própria skill — nunca mais uma fusão numa `melee` que não existe mais em
 * `packages/content/data/skills/`. `skillfist` (Power Ring real, id 3087) ficava de fora antes
 * desta correção — item com só `skillfist` não gerava bônus nenhum, um item real perdido em
 * silêncio, não só um `skillId` inválido.
 */
const MELEE_SKILL_ATTR_TO_SKILL: ReadonlyMap<string, string> = new Map([
  ['skillfist', 'fist'], ['skillclub', 'club'], ['skillsword', 'sword'], ['skillaxe', 'axe'],
]);

/** Primeiro token de `vocation="Knight;true, Paladin;true, Elite Knight, Royal Paladin"` → id. */
export function parseVocationRequirement(raw: string | undefined): string | string[] | undefined {
  if (raw === undefined) return undefined;
  const ids = new Set<string>();
  for (const segment of raw.split(',')) {
    const trimmed = segment.trim();
    if (!trimmed.includes(';')) continue;
    const name = (trimmed.split(';')[0] ?? '').trim().toLowerCase();
    if (name.length > 0 && name !== 'none') ids.add(name);
  }
  if (ids.size === 0) return undefined;
  const list = [...ids].sort();
  return list.length === 1 ? list[0] : list;
}

// ---------------------------------------------------------------------------------------------
// Classificação: primarytype/weaponType do Canary → categoria de caça do Draconya, ou motivo do skip.

export type ItemSlice =
  | 'weapons' | 'shields' | 'helmets' | 'armors' | 'legs' | 'boots' | 'rings' | 'amulets'
  | 'valuables' | 'creature-products';

export interface Classification {
  readonly slice: ItemSlice;
  readonly kind: 'weapon' | 'shield' | 'armor' | 'ring' | 'amulet' | 'other';
  readonly slot?: string;
}

const ARMOR_SLICE_BY_SLOT: Readonly<Record<string, ItemSlice>> = {
  head: 'helmets', chest: 'armors', legs: 'legs', feet: 'boots',
};

/** Atributo de bônus qualquer — o que faz um item SEM `primarytype` ainda valer a pena gerar
 *  (o `collar of red plasma`, #688: peça de recompensa sem categoria, com `skillsword`/
 *  `skillaxe`/`skillclub`). */
function hasBonusAttribute(attrs: ReadonlyMap<string, XmlElement>): boolean {
  for (const key of attrs.keys()) {
    if (key === 'armor' || key === 'defense' || key === 'speed' || key === 'charges'
      || key === 'magiclevelpoints' || key === 'healthgain' || key === 'managain'
      || key === 'cleavepercent' || key === 'criticalhitchance' || key === 'criticalhitdamage'
      || key === 'lifeleechamount' || key === 'manaleechamount' || key === 'reflectdamage'
      || MELEE_SKILL_ATTR_TO_SKILL.has(key) || key === 'skilldist' || key === 'skillshield'
      || key.startsWith('absorbpercent') || SPECIALIZED_MAGIC_ATTR_TO_ELEMENT.has(key)) return true;
  }
  return false;
}

/**
 * Classifica UM `<item>`, ou devolve o motivo pelo qual ele fica fora do corte desta issue.
 *
 * `hasBreakChance` (#575) é o `<script><attribute key="breakChance">` do item — SÓ existe nos
 * arremessáveis do Canary (spear, throwing star, viper/leaf star); um `weaponType: "distance"`
 * sem `ammotype` E sem `breakChance` continua fora do corte (a família "fist" já cobre o caso
 * de weaponType inexistente/desconhecido; nenhum item real do `items.xml` cai nesse terceiro
 * caso hoje, mas o schema recusaria o gerado sem um dos dois campos).
 */
export function classify(
  primarytype: string | undefined, weaponType: string | undefined, ammotype: string | undefined,
  scriptSlot: string | undefined, hasBreakChance: boolean,
): Classification | { readonly skip: string } {
  switch (primarytype) {
    case 'sword weapons': return { slice: 'weapons', kind: 'weapon' };
    case 'axe weapons': return { slice: 'weapons', kind: 'weapon' };
    case 'club weapons': return { slice: 'weapons', kind: 'weapon' };
    case 'distance weapons':
      if (weaponType === 'fist') return { skip: 'família "fist" não é declarável (fallback do motor, DT-01)' };
      if (ammotype !== undefined) return { slice: 'weapons', kind: 'weapon' };
      return hasBreakChance
        ? { slice: 'weapons', kind: 'weapon' }
        : { skip: 'arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável)' };
    case 'wands': case 'rods': return { slice: 'weapons', kind: 'weapon' };
    case 'shields': case 'spellbooks': return { slice: 'shields', kind: 'shield', slot: 'shield' };
    // O quiver (#575) é item de `kind: 'shield'` puro — sem contêiner, porque a munição do
    // Draconya não tem pilha física a guardar (ADR 0026 d.3). `SLOT_MAP['right-hand']` já
    // resolve o slot; aqui só falta a classificação em si.
    case 'quivers': return { slice: 'shields', kind: 'shield', slot: 'shield' };
    case 'helmets': case 'helmet': return { slice: 'helmets', kind: 'armor', slot: 'head' };
    case 'armors': return { slice: 'armors', kind: 'armor', slot: 'chest' };
    case 'legs': return { slice: 'legs', kind: 'armor', slot: 'legs' };
    case 'boots': return { slice: 'boots', kind: 'armor', slot: 'feet' };
    case 'rings': return { slice: 'rings', kind: 'ring', slot: 'finger' };
    case 'amulets and necklaces': return { slice: 'amulets', kind: 'amulet', slot: 'neck' };
    case 'valuables': return { slice: 'valuables', kind: 'other' };
    case 'creature products': return { slice: 'creature-products', kind: 'other' };
    default: break;
  }
  if (weaponType === 'fist') return { skip: 'família "fist" não é declarável (fallback do motor, DT-01)' };
  // Arma sem `primarytype` (a Wand of Vortex do Sorcerer, id 3074, e a própria Snakebite Rod
  // trazem `weaponType` mas nenhuma tem `primarytype`): o `weaponType` sozinho já basta.
  if (weaponType === 'sword' || weaponType === 'axe' || weaponType === 'club' || weaponType === 'wand') {
    return { slice: 'weapons', kind: 'weapon' };
  }
  if (weaponType === 'distance') {
    if (ammotype !== undefined) return { slice: 'weapons', kind: 'weapon' };
    return hasBreakChance
      ? { slice: 'weapons', kind: 'weapon' }
      : { skip: 'arma de distância sem "ammotype" (lançador) nem "breakChance" (arremessável)' };
  }
  // Peça de recompensa sem `primarytype` (#688): entra pelo SLOT + algum atributo de bônus real.
  const mapped = scriptSlot === undefined ? undefined : SLOT_MAP[scriptSlot];
  if (mapped !== undefined && mapped in ARMOR_SLICE_BY_SLOT) {
    return { slice: ARMOR_SLICE_BY_SLOT[mapped] as ItemSlice, kind: 'armor', slot: mapped };
  }
  if (mapped === 'finger') return { slice: 'rings', kind: 'ring', slot: 'finger' };
  if (mapped === 'neck') return { slice: 'amulets', kind: 'amulet', slot: 'neck' };
  if (mapped === 'shield') return { slice: 'shields', kind: 'shield', slot: 'shield' };
  return { skip: `sem categoria de caça (primarytype "${primarytype ?? 'nenhum'}")` };
}

// ---------------------------------------------------------------------------------------------
// A conversão de UM `<item>`.

export interface ConvertedItem {
  readonly id: string;
  readonly slice: ItemSlice;
  readonly entity: CatalogEntity;
  readonly blockers: readonly string[];
  readonly ignoredFields: readonly string[];
}

const HANDLED_ATTRS: ReadonlySet<string> = new Set([
  'primarytype', 'weaponType', 'weapontype', 'slotType', 'slottype', 'attack', 'defense', 'extradef',
  'armor', 'range', 'weight', 'charges', 'duration', 'imbuementslot', 'speed', 'healthgain',
  'healthticks', 'managain', 'manaticks', 'suppressdrunk', 'criticalhitchance', 'criticalhitdamage',
  'lifeleechamount', 'manaleechamount', 'reflectdamage', 'cleavepercent', 'hitchance', 'hitChance',
  'magiclevelpoints', 'skillfist', 'skillsword', 'skillaxe', 'skillclub', 'skilldist', 'skillshield', 'ammotype',
  'description', 'script',
  // O quiver (#575): `perfectshotrange`/`perfectshotdamage` viram `item.perfectShot`;
  // `containersize` é IGNORADO de propósito — o Draconya não guarda pilha física de munição
  // (ADR 0026 d.3), então o quiver entra como `kind: 'shield'` puro, nunca `kind: 'container'`.
  'perfectshotrange', 'perfectshotdamage', 'containersize',
  ...ELEMENT_ATTR_TO_DAMAGE.keys(), ...ABSORB_ATTR_TO_DAMAGE.keys(), ...SPECIALIZED_MAGIC_ATTR_TO_ELEMENT.keys(),
]);

/**
 * Converte UM `<item>`. Nunca lança por dado do item: tudo que impede a geração vira `blockers`
 * (o item some da fatia e some no relatório), e atributo lido mas fora do schema vira
 * `ignoredFields` (some só das notas).
 */
/** `value` do item — `sellMaxByClientId` de `npc-prices.ts`, indexado pelo `id` numérico do Canary. */
export interface ItemPriceLookup {
  readonly sellMaxByClientId: ReadonlyMap<number, ShopPriceObservation>;
}

export function convertItem(
  item: XmlElement, path: string, commit: string, prices?: ItemPriceLookup,
): ConvertedItem | undefined {
  const id = attrOptional(item, 'id');
  const name = attrOptional(item, 'name');
  if (id === undefined || name === undefined) return undefined; // faixa (fromid/toid) ou sem nome: fora do corte.
  const attrs = attributesOf(item);
  const scriptEl = attrs.get('script');
  const scriptAttrs = scriptEl === undefined ? new Map<string, XmlElement>() : attributesOf(scriptEl);
  const primarytype = value(attrs, 'primarytype');
  const weaponType = value(attrs, 'weaponType') ?? value(attrs, 'weapontype');
  const ammotype = value(attrs, 'ammotype');
  const scriptSlot = value(scriptAttrs, 'slot');
  const recognizedWeaponType = weaponType !== undefined
    && ['sword', 'axe', 'club', 'distance', 'wand'].includes(weaponType);
  // Decoração/tile comum: nem vale olhar. Arma sem `primarytype` (a Wand of Vortex do Sorcerer,
  // id 3074, é exatamente este caso) ainda entra pelo `weaponType`.
  if (primarytype === undefined && !recognizedWeaponType && !hasBonusAttribute(attrs)) return undefined;

  // O arremessável (#575): `breakChance` está no `<script>`, como `level`/`vocation`/`mana` —
  // nunca no topo do `<item>` (spear id 3277, throwing star id 3287, ambos conferidos).
  const breakChance = numberValue(scriptAttrs, 'breakChance');
  const classification = classify(primarytype, weaponType, ammotype, scriptSlot, breakChance !== undefined);
  const source: CatalogSource = { engine: 'canary', commit, path };
  const slug = slugify(name);
  if ('skip' in classification) {
    return {
      id: slug, slice: 'valuables', blockers: [classification.skip], ignoredFields: [],
      entity: { id: slug, name, source },
    };
  }

  const blockers: string[] = [];
  const weight = numberValue(attrs, 'weight');
  // Preço de venda (M34-03/#574): o MAIOR `sell` que algum NPC paga por este `id` numérico do
  // Canary (`npc-prices.ts`, exceto o Nah'Bob). `0` é "não se vende" no schema (§22.1) — o caso
  // de nenhum NPC comum vender o item (ex. Royal Helmet, confirmado pelo TibiaWiki).
  const canaryId = Number(id);
  const sellObservation = prices?.sellMaxByClientId.get(canaryId);
  const entity: Record<string, unknown> = {
    id: slug,
    name,
    kind: classification.kind === 'weapon' ? 'weapon'
      : classification.kind === 'shield' ? 'shield'
        : classification.kind === 'ring' ? 'ring'
          : classification.kind === 'amulet' ? 'amulet'
            : classification.kind === 'armor' ? 'armor' : 'other',
    weight: weight === undefined ? 0 : weight / 100,
    value: sellObservation?.amount ?? 0,
  };
  // Toda arma do catálogo autoral veste no slot `hand` — de uma mão ou de duas (`sword`,
  // `bow`, `wand-of-vortex`: os 22 itens `kind: 'weapon'` de `data/items/*.json` concordam,
  // twoHanded ou não). O Canary raramente declara `<attribute key="slot" value="hand">` no
  // `<script>` de arma (só a exceção confirma — a maioria não), e sem isso `imbuementSlots`
  // reprovava no boot (`content.ts`: "só vale em item que se veste") mesmo a arma sendo
  // vestível de verdade. `hand` é o default de TODA arma, não só de uma mão — twoHanded já
  // diz que ocupa as duas (#152).
  const slot = classification.slot ?? (scriptSlot === undefined ? undefined : SLOT_MAP[scriptSlot])
    ?? (classification.kind === 'weapon' ? 'hand' : undefined);
  if (slot !== undefined) entity['slot'] = slot;

  const twoHanded = value(attrs, 'slotType') === 'two-handed' || value(attrs, 'slottype') === 'two-handed';
  if (twoHanded) entity['twoHanded'] = true;

  const attack = numberValue(attrs, 'attack');
  if (attack !== undefined && attack > 0) entity['attack'] = attack;
  const armorValue = numberValue(attrs, 'armor');
  if (armorValue !== undefined && armorValue > 0) entity['armor'] = armorValue;
  // `defense` só vale em escudo ou arma corpo a corpo (`content.ts`, CMB-04) — a MESMA regra
  // que o Canary já expressa ao classificar por `primarytype`: "rusted shield"/"heavily rusted
  // shield" (id 8900-8902) e "broken macuahuitl" (id 40530) têm `weaponType shield`/`sword` no
  // XML, mas o Canary os classifica como `valuables`/`creature products` — curiosidade de
  // quest, não equipamento de combate de verdade (a descrição confirma: "remove the rust...").
  // Copiar `defense` para um item que o PRÓPRIO Canary não trata como escudo/arma reprovaria
  // no boot; a classificação por `primarytype` já é a decisão do Canary, e `kind: 'other'`
  // segue ela.
  const defense = numberValue(attrs, 'defense');
  if (defense !== undefined && defense > 0 && classification.kind !== 'other') entity['defense'] = defense;
  const extradef = numberValue(attrs, 'extradef');
  if (extradef !== undefined && extradef > 0) entity['extraDefense'] = extradef;

  const charges = numberValue(attrs, 'charges');
  if (charges !== undefined && charges > 0) entity['charges'] = charges;
  const durationSeconds = numberValue(attrs, 'duration');
  if (durationSeconds !== undefined && durationSeconds > 0) entity['durationMs'] = durationSeconds * 1000;
  const imbuementSlots = numberValue(attrs, 'imbuementslot');
  if (imbuementSlots !== undefined && imbuementSlots >= 1 && imbuementSlots <= 3) entity['imbuementSlots'] = imbuementSlots;

  const ignoredFields: string[] = [];
  for (const key of attrs.keys()) if (!HANDLED_ATTRS.has(key)) ignoredFields.push(key);

  // requires (level/vocation) — só no `<script>` aninhado, nunca no topo.
  const level = numberValue(scriptAttrs, 'level');
  const vocationId = parseVocationRequirement(value(scriptAttrs, 'vocation'));
  if (level !== undefined || vocationId !== undefined) {
    entity['requires'] = { ...(level === undefined ? {} : { level }), ...(vocationId === undefined ? {} : { vocationId }) };
  }

  // absorb (M30-05, #552).
  const absorb: Record<string, { percent: number }> = {};
  for (const [attr, type] of ABSORB_ATTR_TO_DAMAGE) {
    const percent = numberValue(attrs, attr);
    if (percent === undefined || percent === 0) continue;
    const clamped = Math.min(Math.max(Math.trunc(percent), -100), 99);
    if (absorb[type] !== undefined) blockers.push(`absorbpercent duplicado para "${type}" (poison/${type} juntos)`);
    absorb[type] = { percent: clamped };
  }
  if (Object.keys(absorb).length > 0) entity['absorb'] = absorb;

  // reflect (M30-05, #552) — só `reflectdamage`, sempre flat de physical neste checkout.
  const reflectDamage = numberValue(attrs, 'reflectdamage');
  if (reflectDamage !== undefined && reflectDamage > 0) entity['reflect'] = { physical: { flat: reflectDamage } };

  const cleave = numberValue(attrs, 'cleavepercent');
  if (cleave !== undefined && cleave > 0) entity['cleavePercent'] = Math.min(cleave, 100);

  // combatModifiers (M30-04, #551) — mesma escala ×10000 do Canary, cópia direta.
  const combatModifiers: Record<string, number> = {};
  const criticalChance = numberValue(attrs, 'criticalhitchance');
  if (criticalChance !== undefined && criticalChance > 0) combatModifiers['criticalChance'] = criticalChance;
  const criticalDamage = numberValue(attrs, 'criticalhitdamage');
  if (criticalDamage !== undefined && criticalDamage > 0) combatModifiers['criticalDamage'] = criticalDamage;
  const lifeLeech = numberValue(attrs, 'lifeleechamount');
  if (lifeLeech !== undefined && lifeLeech > 0) combatModifiers['lifeLeech'] = lifeLeech;
  const manaLeech = numberValue(attrs, 'manaleechamount');
  if (manaLeech !== undefined && manaLeech > 0) combatModifiers['manaLeech'] = manaLeech;
  if (Object.keys(combatModifiers).length > 0) entity['combatModifiers'] = combatModifiers;

  // bonuses (#688): skills (fist/club/sword/axe SEPARADAS desde #567/#568 — nunca mais uma
  // `melee` que não existe em `packages/content/data/skills/`), magic level (especializado e
  // geral), velocidade, regeneração e supressão.
  const skills: { skillId: string; amount: number }[] = [];
  for (const [attr, skillId] of MELEE_SKILL_ATTR_TO_SKILL) {
    const amount = numberValue(attrs, attr);
    if (amount !== undefined && amount > 0) skills.push({ skillId, amount });
  }
  const distanceSkill = numberValue(attrs, 'skilldist');
  if (distanceSkill !== undefined && distanceSkill > 0) skills.push({ skillId: 'distance', amount: distanceSkill });
  const shieldingSkill = numberValue(attrs, 'skillshield');
  if (shieldingSkill !== undefined && shieldingSkill > 0) skills.push({ skillId: 'shielding', amount: shieldingSkill });
  const magicSkill = numberValue(attrs, 'magiclevelpoints');
  if (magicSkill !== undefined && magicSkill > 0) skills.push({ skillId: 'magic', amount: magicSkill });

  const specializedMagicLevel: Record<string, number> = {};
  for (const [attr, element] of SPECIALIZED_MAGIC_ATTR_TO_ELEMENT) {
    const points = numberValue(attrs, attr);
    if (points !== undefined && points > 0) specializedMagicLevel[element] = points;
  }

  const speedBonus = numberValue(attrs, 'speed');
  const healthGain = numberValue(attrs, 'healthgain');
  const healthTicks = numberValue(attrs, 'healthticks');
  const manaGain = numberValue(attrs, 'managain');
  const manaTicks = numberValue(attrs, 'manaticks');
  let regeneration: Record<string, number> | undefined;
  const hasHealthRegen = healthGain !== undefined && healthGain > 0;
  const hasManaRegen = manaGain !== undefined && manaGain > 0;
  if ((hasHealthRegen && healthTicks !== undefined && healthTicks > 0)
    || (hasManaRegen && manaTicks !== undefined && manaTicks > 0)) {
    regeneration = {
      healthGain: hasHealthRegen ? (healthGain ?? 0) : 0,
      healthTicksMs: hasHealthRegen && healthTicks !== undefined ? healthTicks * 1000 : 1000,
      manaGain: hasManaRegen ? (manaGain ?? 0) : 0,
      manaTicksMs: hasManaRegen && manaTicks !== undefined ? manaTicks * 1000 : 1000,
    };
  } else if (hasHealthRegen || hasManaRegen) {
    ignoredFields.push('healthgain/managain sem o par de ticks correspondente — regeneração incompleta, descartada');
  }
  const suppress: string[] = [];
  if (value(attrs, 'suppressdrunk') !== undefined) suppress.push('drunk');

  const bonuses: Record<string, unknown> = {};
  if (skills.length > 0) bonuses['skills'] = skills;
  if (speedBonus !== undefined && speedBonus > 0) bonuses['speed'] = speedBonus;
  if (Object.keys(specializedMagicLevel).length > 0) bonuses['specializedMagicLevel'] = specializedMagicLevel;
  if (regeneration !== undefined) bonuses['regeneration'] = regeneration;
  if (suppress.length > 0) bonuses['suppress'] = suppress;
  if (Object.keys(bonuses).length > 0) entity['bonuses'] = bonuses;

  // weapon (#152/#524/#687) — só em kind: 'weapon'.
  if (classification.kind === 'weapon') {
    // Rod (Druid) e wand (Sorcerer) são o MESMO `weaponType: 'wand'` no Canary — só o `primarytype`
    // ("rods"/"wands") distingue a família, e alguns (Wand of Vortex, id 3074) não o declaram; a
    // vocação exigida é o desempate que sobra.
    const family = weaponType === 'sword' || weaponType === 'axe' || weaponType === 'club' ? weaponType
      : weaponType === 'distance' ? 'distance'
        : primarytype === 'rods' || vocationId === 'druid' ? 'rod' : 'wand';
    const wandType = value(scriptAttrs, 'wandType');
    const damageType = wandType === undefined ? undefined : WAND_TYPE_TO_DAMAGE[wandType];
    if (wandType !== undefined && damageType === undefined) ignoredFields.push(`wandType "${wandType}" sem tipo de dano correspondente`);
    const weapon: Record<string, unknown> = {
      kind: family === 'distance' ? 'distance' : family === 'wand' || family === 'rod' ? 'wand' : 'melee',
      family,
    };
    const range = numberValue(attrs, 'range');
    if (range !== undefined) weapon['range'] = range;
    if (family === 'distance' && ammotype !== undefined) weapon['ammoFamily'] = ammotype;
    // O arremessável (#575): SEM `ammotype` (nenhum lançador) — o `breakChance` do `<script>`,
    // já lido acima para a classificação, entra aqui como o dado da arma.
    if (family === 'distance' && ammotype === undefined && breakChance !== undefined) {
      weapon['breakChance'] = breakChance;
    }
    if (damageType !== undefined) weapon['damageType'] = damageType;
    const mana = numberValue(scriptAttrs, 'mana');
    if (mana !== undefined && mana > 0) weapon['manaPerHit'] = mana;
    const fromDamage = numberValue(scriptAttrs, 'fromDamage');
    const toDamage = numberValue(scriptAttrs, 'toDamage');
    if (fromDamage !== undefined && toDamage !== undefined) {
      weapon['damage'] = { min: Math.min(fromDamage, toDamage), max: Math.max(fromDamage, toDamage) };
    }
    const hitChance = numberValue(attrs, 'hitchance') ?? numberValue(attrs, 'hitChance') ?? numberValue(scriptAttrs, 'hitchance');
    if (hitChance !== undefined) weapon['hitChance'] = Math.min(Math.max(Math.trunc(hitChance), -100), 100);
    if (value(scriptAttrs, 'unproperly') === 'true') weapon['wieldUnproperly'] = true;
    // Elemento da arma corpo a corpo (#687) — só a família melee lê no `combat-v3`.
    if (family === 'sword' || family === 'axe' || family === 'club') {
      const found = [...ELEMENT_ATTR_TO_DAMAGE.entries()]
        .map(([attr, type]) => ({ type, amount: numberValue(attrs, attr) }))
        .filter((entry): entry is { type: string; amount: number } => entry.amount !== undefined && entry.amount > 0);
      if (found.length > 1) blockers.push(`mais de um elemento na arma (${found.map((f) => f.type).join(', ')})`);
      else if (found.length === 1 && found[0] !== undefined) weapon['element'] = { type: found[0].type, attack: found[0].amount };
    }
    if ((family === 'wand' || family === 'rod') && (weapon['manaPerHit'] === undefined || weapon['damage'] === undefined)) {
      blockers.push('wand/rod sem mana ou faixa de dano completa (script;weapon incompleto)');
    }
    // Rede de segurança contra o `primarytype` MENTIROSO do Canary: "broken Iks spear" (id
    // 40535) é `primarytype="axe weapons"` (por isso `classify()` já devolveu `kind: 'weapon'`
    // antes de olhar `weaponType`), mas `weaponType="distance"` sem `ammotype` NEM `breakChance`
    // — um arremessável sem lançador e sem quebra própria, exatamente o caso que `classify()` já
    // pula quando o `primarytype` É "distance weapons" (M34-04). Sem esta segunda checagem, a
    // mesma arma escaparia pela classificação por `primarytype` e reprovaria no boot ("arma de
    // distância precisa de ammoFamily", `content.ts`) em vez de ser contada no relatório como
    // fora do escopo. `weapon['breakChance']` (#575) é a mesma exceção que `classify()` já
    // concede: um arremessável de verdade (spear, throwing star) não tem `ammotype`, mas tem
    // `breakChance`, e não pode cair aqui.
    if (family === 'distance' && weapon['ammoFamily'] === undefined && weapon['breakChance'] === undefined) {
      blockers.push('arremessável/munição sem lançador (M34-04, fora do escopo)');
    }
    entity['weapon'] = weapon;
  } else if (classification.kind === 'shield' && slot === 'shield') {
    if (primarytype === 'spellbooks') entity['spellbook'] = true;
    // O quiver (#575): `quiver: true` para TODO item de `primarytype: "quivers"` (o `right-hand`
    // do Canary — `secondaryShield` na mitigação do jogador, #549); `perfectShot` só nos poucos
    // que declaram `perfectshotrange`/`perfectshotdamage` (eldritch quiver id 36666, alicorn
    // quiver id 39150) — a maioria dos quivers do Canary não tem o bônus.
    if (primarytype === 'quivers') {
      entity['quiver'] = true;
      const perfectShotRange = numberValue(attrs, 'perfectshotrange');
      const perfectShotDamage = numberValue(attrs, 'perfectshotdamage');
      if (perfectShotRange !== undefined && perfectShotRange > 0
        && perfectShotDamage !== undefined && perfectShotDamage > 0) {
        entity['perfectShot'] = { range: perfectShotRange, damage: perfectShotDamage };
      }
    }
  }

  entity['source'] = source;
  // Aparência (#748, ADR 0038 decisão 2, o MESMO recurso que `outfitId` já usa em `monsters.ts`):
  // o `id` do `<item>` do Canary É o `appearanceId` (o clientid do OTB) — conferido em
  // `sword`/3264, o autoral existente. Staging carrega o número; `promote-items.ts` o extrai para
  // `appearances/baseline.json.items` e o remove antes de escrever `data/items/generated/`, porque
  // `itemSchema` não declara este campo.
  if (Number.isFinite(canaryId) && canaryId > 0) entity['appearanceId'] = canaryId;
  else blockers.push(`"id" do Canary não é um número de aparência válido: "${id}"`);
  return { id: slug, slice: classification.slice, entity: entity as CatalogEntity, blockers, ignoredFields };
}

// ---------------------------------------------------------------------------------------------
// Reconciliação dos itens autorais (ADR 0014: o id não muda; a correção é override).

/** O que a reconciliação confere entre o autoral e o gerado — os campos NUMÉRICOS simples. */
const RECONCILED_FIELDS: readonly string[] = [
  'weight', 'attack', 'armor', 'defense', 'extraDefense', 'charges', 'durationMs', 'imbuementSlots', 'cleavePercent',
  'value',
];

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export interface ReconciliationOverride {
  readonly id: string;
  readonly reason: string;
  readonly patch: Record<string, unknown>;
}

/**
 * Compara UM item gerado com o arquivo autoral de mesmo id (quando existe) e devolve o override
 * a gravar em `data/items/overrides/<id>.json` — nunca editando o autoral. Campos simples primeiro
 * (`RECONCILED_FIELDS`); `requires.level` e `weapon.manaPerHit`/`weapon.damage` também, porque as
 * duas wands iniciais (#573, comentário de reconciliação) trocaram `mana`/`level` no arquivo autoral.
 */
export function reconcileAuthored(
  generated: CatalogEntity, authoredDir: string, canaryCommit: string,
): ReconciliationOverride | undefined {
  const authored = readJson(join(authoredDir, `${generated.id}.json`));
  if (authored === undefined) return undefined;
  const patch: Record<string, unknown> = {};
  const diffs: string[] = [];
  for (const field of RECONCILED_FIELDS) {
    const genValue = generated[field];
    const oldValue = authored[field];
    if (genValue === undefined || typeof genValue !== 'number') continue;
    if (oldValue === genValue) continue;
    if (oldValue === undefined && genValue === 0) continue;
    patch[field] = genValue;
    diffs.push(`${field}: ${String(oldValue ?? '(ausente)')} → ${genValue}`);
  }
  const genRequires = generated['requires'] as { level?: number } | undefined;
  const oldRequires = authored['requires'] as { level?: number } | undefined;
  if (genRequires?.level !== undefined && genRequires.level !== oldRequires?.level) {
    patch['requires'] = { ...oldRequires, level: genRequires.level };
    diffs.push(`requires.level: ${String(oldRequires?.level ?? '(ausente)')} → ${genRequires.level}`);
  }
  const genWeapon = generated['weapon'] as Record<string, unknown> | undefined;
  const oldWeapon = authored['weapon'] as Record<string, unknown> | undefined;
  if (genWeapon !== undefined) {
    const weaponPatch: Record<string, unknown> = {};
    if (genWeapon['manaPerHit'] !== undefined && genWeapon['manaPerHit'] !== oldWeapon?.['manaPerHit']) {
      weaponPatch['manaPerHit'] = genWeapon['manaPerHit'];
      diffs.push(`weapon.manaPerHit: ${String(oldWeapon?.['manaPerHit'] ?? '(ausente)')} → ${String(genWeapon['manaPerHit'])}`);
    }
    if (Object.keys(weaponPatch).length > 0) patch['weapon'] = { ...oldWeapon, ...weaponPatch };
  }
  if (diffs.length === 0) return undefined;
  return {
    id: generated.id,
    reason: `Reconciliação do importador de itens (#573/#574) contra o Canary items.xml em \`${canaryCommit.slice(0, 12)}\`: ${diffs.join('; ')}.`,
    patch,
  };
}

// ---------------------------------------------------------------------------------------------
// O catálogo inteiro.

export interface ItemCatalog extends CatalogImportResult {
  readonly converted: readonly ConvertedItem[];
  readonly overrides: readonly ReconciliationOverride[];
}

function countBy(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value_ of values) counts.set(value_, (counts.get(value_) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([value_, count]) => `${value_} (${count})`)
    .join(', ');
}

export interface ItemsReaderOptions {
  /** `packages/content/data/items`, relativo à raiz — onde os 73 autorais moram (ADR 0014). */
  readonly authoredDir: string;
  /** Preço de NPC (#574) — omitido, todo `value` sai `0` (o comportamento de antes do #574). */
  readonly prices?: ItemPriceLookup;
}

/** Lê o `items.xml` inteiro e converte cada `<item>` das categorias de caça. */
export function readItemCatalog(ctx: CatalogImportContext, options: ItemsReaderOptions): ItemCatalog {
  const root = readXmlFile(join(ctx.canaryDir, CANARY_ITEMS_XML));
  const converted: ConvertedItem[] = [];
  for (const item of childrenOf(root, 'item')) {
    const result = convertItem(item, CANARY_ITEMS_XML, ctx.canaryCommit, options.prices);
    if (result !== undefined) converted.push(result);
  }

  const slices = new Map<string, CatalogEntity[]>();
  const skipped: SkippedEntity[] = [];
  const seen = new Set<string>();
  const overrides: ReconciliationOverride[] = [];
  const allIgnored: string[] = [];
  let duplicateSlugs = 0;
  for (const converted_ of converted) {
    allIgnored.push(...converted_.ignoredFields);
    const name = typeof converted_.entity['name'] === 'string' ? converted_.entity['name'] : converted_.id;
    if (converted_.blockers.length > 0) {
      skipped.push({ id: converted_.id, name, reason: converted_.blockers.join('; '), source: converted_.entity.source });
      continue;
    }
    if (seen.has(converted_.id)) {
      duplicateSlugs += 1;
      skipped.push({ id: converted_.id, name, reason: 'id duplicado (outro item já gerou este slug)', source: converted_.entity.source });
      continue;
    }
    seen.add(converted_.id);
    const override = reconcileAuthored(converted_.entity, options.authoredDir, ctx.canaryCommit);
    if (override !== undefined) overrides.push(override);
    const slice = slices.get(converted_.slice) ?? [];
    slice.push(converted_.entity);
    slices.set(converted_.slice, slice);
  }

  const notes: string[] = [
    `${converted.length} \`<item>\` lidos das categorias de caça; ${skipped.length} fora do corte, `
    + `${duplicateSlugs} por slug duplicado (nome repetido — desambiguação de id fica para quando o primeiro `
    + 'conflito real aparecer).',
    `Reconciliação (ADR 0014): ${overrides.length} item(ns) autoral(is) com override gravado em `
    + `\`${AUTHORED_ITEMS_DIR}/overrides/\` — o id nunca muda, só a correção.`,
    'Preço (\`value\`, M34-03/#574): o maior `sell` de `data-otservbr-global/npc/*.lua` por `id` do Canary '
    + '(exceto o Nah\'Bob, ver `npc-prices.ts`); `0` quando nenhum NPC vende, ou quando o importador rodou sem `prices`.',
    '`stackable` nunca declarado (sempre o default `false`): a pilha é um flag de `items.otb`, binário, que este leitor não abre — só `items.xml`.',
    `Campos lidos e ignorados (sem campo no schema desta base ou fora do escopo): ${countBy(allIgnored) || 'nenhum'}.`,
  ];

  return { slices, skipped, notes, converted, overrides };
}

/** Grava os overrides de reconciliação em `data/items/overrides/<id>.json` (correção real, carregada no boot). */
export function writeOverrides(overridesDir: string, overrides: readonly ReconciliationOverride[]): void {
  for (const override of overrides) {
    const path = join(overridesDir, `${override.id}.json`);
    const existing = readJson(path);
    const merged = { id: override.id, reason: override.reason, patch: { ...(existing?.['patch'] as object | undefined), ...override.patch } };
    writeJson(path, merged);
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

registerCatalogType({
  id: 'items',
  // Staging até a promoção para `data/` (loot de monstro resolvendo item de verdade) — ver o
  // cabeçalho deste arquivo.
  dataDir: 'packages/content/staging/items',
  run: (ctx) => {
    const repoRoot = repoRootFrom(import.meta.url);
    const authoredDir = join(repoRoot, AUTHORED_ITEMS_DIR);
    const prices = readNpcShopPrices(ctx);
    const result = readItemCatalog(ctx, { authoredDir, prices });
    writeOverrides(join(authoredDir, 'overrides'), result.overrides);
    return result;
  },
});
