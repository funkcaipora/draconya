import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from './load.js';
import { floorChangeAt, isBlocked } from './map.js';
import { BOT_CATEGORIES } from './schemas.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

describe('loadContent', () => {
  it('carrega o conteúdo real do repositório', () => {
    const content = loadContent(DATA);
    expect(content.monsters.size).toBeGreaterThan(0);
    expect(content.hunts.size).toBeGreaterThan(0);
    expect(content.vocations.size).toBe(4);
    expect(content.version).toMatch(/^[0-9a-f]{8}$/);
  });

  it('o baseline aplica armadura e escudo SÓ ao físico (#473)', () => {
    // A coluna de armadura e a lista de bloqueio são CONTEÚDO, nunca lógica (§12.1): `physical`
    // vale 1 e todo elemento vale 0, e `blockTypes` aprova só o físico. Sem esta trava, ligar a
    // armadura em um elemento passaria despercebido e o dano elemental já entregue mudaria.
    const { combat } = loadContent(DATA);
    expect(combat.armorEffectiveness.physical).toBe(1);
    for (const [type, value] of Object.entries(combat.armorEffectiveness)) {
      if (type !== 'physical') expect(value, `tipo "${type}"`).toBe(0);
    }
    expect(combat.defense?.blockTypes).toEqual(['physical']);
  });

  it('carrega o Bestiário real: cinco marcos crescentes e +1 % por marco (FUN-113, §18)', () => {
    // Opcional no `buildContent` (fixture), obrigatório no conteúdo de verdade: sem ele o
    // abate conta e nunca vale nada. Mutação que mata: apagar `bestiary/` de `load.ts`.
    const content = loadContent(DATA);
    expect(content.bestiary?.milestones).toEqual([10_000, 25_000, 50_000, 100_000, 200_000]);
    expect(content.bestiary?.xpBonusPercentPerMilestone).toBe(1);
  });

  it('carrega a party real, e todo item do repositório tem preço de venda (#188)', () => {
    // O multiplicador de XP saiu do conteúdo no #525 (ADR 0027 emenda 2026-09-24/25) — é
    // `sharedExperiencePercent` em `packages/sim/src/party.ts`, a fórmula do Canary. E `value`
    // é obrigatório no schema — este teste prende que o conteúdo REAL passa, e diz quais itens
    // ainda têm o preço em aberto (zero com `_open`), para o próximo item nascer com decisão.
    const content = loadContent(DATA);
    expect(content.party.maxMembers).toBe(8);
    expect(content.party.autoSellItemTypes).toEqual({ free: 5, premium: 20 });
    expect(content.party.sharedExperience).toEqual({
      rangeTiles: 30, floors: 1, levelRangeDivisor: 1.5, activityWindowMs: 120_000,
    });
    for (const item of content.items.values()) {
      expect(item.value, `item "${item.id}"`).toBeGreaterThanOrEqual(0);
    }
    expect(content.items.get('bow')?.value).toBe(130);
    expect(content.items.get('cheese')?.value).toBe(0);
  });

  it('o conteúdo real tem o bot padrão do personagem novo, e mana para a primeira magia (FUN-114)', () => {
    // O MVP é "hunt + magias + poção funcionando" no PRIMEIRO minuto: sem isto o personagem
    // novo entrava só no golpe básico até abrir a tela do bot, e sem mana até o level 4.
    const content = loadContent(DATA);
    const config = content.bot.defaultConfig;
    expect(config?.heal.map((rule) => rule.do)).toEqual([{ kind: 'spell', spellId: 'heal' }]);
    expect(config?.potion.map((rule) => rule.do)).toEqual([{ kind: 'supply', supplyId: 'health-potion' }]);
    expect(config?.attack.map((rule) => rule.do)).toEqual([{ kind: 'spell', spellId: 'strike' }]);
    // E dá para lançar qualquer uma das duas magias no level 1.
    const costs = [...content.spells.values()].map((spell) => spell.manaCost);
    expect(content.progression.startingMana).toBeGreaterThanOrEqual(Math.min(...costs));
  });

  it('subpasta ausente é conjunto vazio, não erro', () => {
    // O conteúdo cresce por partes; a validação de referência cruzada pega o que faltar.
    const semMonstros = join(dirname(fileURLToPath(import.meta.url)), '..', 'data-parcial');
    expect(() => loadContent(DATA)).not.toThrow();
    expect(semMonstros).toBeTruthy();
  });

  it('city/city.json ausente é erro: a Cidade não pode subir sem mapa (FUN-120)', () => {
    // "Subpasta ausente é conjunto vazio" vale para o que cresce por partes; a Cidade não é
    // uma parte — sem ela ninguém tem onde nascer, e o boot não acusava nada.
    const dir = mkdtempSync(join(tmpdir(), 'content-'));
    try {
      cpSync(DATA, dir, { recursive: true });
      rmSync(join(dir, 'city'), { recursive: true, force: true });
      expect(() => loadContent(dir)).toThrow(/city\/city\.json ausente/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('RAIZ ausente é erro, e não conjunto vazio', () => {
    // A distinção importa: sem ela, um caminho errado reporta \"conteúdo válido, 0 monstros\",
    // que é falso verde e só aparece quando o jogo sobe sem nada dentro.
    expect(() => loadContent(join(DATA, 'nao-existe'))).toThrow(/não encontrado/);
  });

  it('carrega o mapa e a rota, com o laço fechado', () => {
    // A rota real do repositório precisa passar na mesma validação dos testes unitários —
    // senão o formato está certo e o conteúdo está errado, que dá no mesmo.
    const content = loadContent(DATA);
    const map = content.maps.get('rat-cellars');
    const route = content.routes.get('rat-cellars');
    // O bueiro real (FUN-123, ADR 0025): importado, um andar (o 8), e a rota traçada por
    // `pnpm route:trace` sobre ele — um laço de 160 tiles com um spawn por corredor de rato.
    expect(map?.source?.file).toBe('otservbr.otbm');
    expect(map?.width).toBe(118);
    expect(map?.height).toBe(80);
    expect(map?.z).toBe(8);
    expect(route?.tiles.length).toBe(160);
    expect(route?.spawnPoints.length).toBe(14);
  });

  it('a Rat Cellars é o bueiro real, com os três pulls do Huntera, o rato do Tibia e o queijo (FUN-123)', () => {
    const content = loadContent(DATA);
    const hunt = content.hunts.get('rat-cellars');
    expect(Object.keys(hunt?.difficulties ?? {})).toEqual(['cautious', 'bold', 'reckless']);
    expect(Object.values(hunt?.difficulties ?? {}).map((d) => d.monsterCount)).toEqual([2, 5, 8]);
    expect(hunt?.ambience).toBe('cavern');
    expect(hunt?.corpseTtlMs).toBe(30000);
    const rat = content.monsters.get('rat');
    expect(rat?.class).toBe('mammal');
    // packages/content/data/monsters/rat.json — números do Huntera (docs/reference/
    // huntera-observed.md Parte V §32, 2026-09-22), não mais o provisório da FUN-123.
    expect(rat?.attack).toEqual({ min: 3, max: 4 });
    expect(rat?.mitigation.resistances).toEqual({
      physical: 0, energy: 0, earth: -0.2, fire: 0, ice: 0.1, holy: -0.2, death: 0.1, arcane: 0,
    });
    expect(rat?.speed).toBe(172);
    expect(rat?.corpseAppearanceId).toBe(5964);
    expect(rat?.loot.items.map((i) => i.itemId)).toEqual(['cheese']);
    expect(content.items.get('cheese')?.appearanceId).toBe(3607);
  });

  it('a Rotworm Caves é a caverna de Darashia do Huntera, com os três pulls e o rotworm do Canary (#515)', () => {
    const content = loadContent(DATA);
    const map = content.maps.get('rotworm-caves');
    const route = content.routes.get('rotworm-caves');
    expect(map?.source?.file).toBe('otservbr.otbm');
    expect(map?.width).toBe(88);
    expect(map?.height).toBe(73);
    expect(map?.z).toBe(8);
    expect(route?.tiles.length).toBe(444);
    expect(route?.spawnPoints.length).toBe(13);
    // A caixa importada tem duas componentes andáveis (Huntera Parte VI §38): a principal, de
    // 823 tiles, e um corredor isolado de 79 na borda direita (a partir de x === 78). A rota
    // nunca visita o corredor isolado — só a componente principal.
    expect(route?.tiles.every((t) => t.x < 80)).toBe(true);
    const rotworm = content.monsters.get('rotworm');
    expect(rotworm?.class).toBe('vermin');
    expect(rotworm?.attack).toEqual({ min: 24, max: 30 });
    expect(rotworm?.speed).toBe(180);
    expect(rotworm?.corpseAppearanceId).toBe(5967);
    expect(rotworm?.loot.items.map((i) => i.itemId).sort()).toEqual(
      ['ham', 'legion-helmet', 'lump-of-dirt', 'mace', 'meat', 'sword', 'worm'].sort(),
    );
    expect(content.items.get('worm')?.appearanceId).toBe(3492);
  });

  it('a Cidade é Thais: entrada no templo, andável, e cada escada tem a volta (FUN-120)', () => {
    // O mapa importado é gerado; o que é AUTORADO — entrada e escadas — é o que este teste
    // prende. Uma escada sem a volta é um andar de onde ninguém desce.
    const content = loadContent(DATA);
    const city = content.city;
    if (city === undefined) throw new Error('o conteúdo real não tem Cidade');
    expect(city.id).toBe('thais');
    expect(city.entryPoint).toEqual({ x: 94, y: 88, z: 7 });
    expect(isBlocked(city, 94, 88, 7)).toBe(false);
    expect(content.citySettings?.stepDurationMs).toBe(150);

    const raw = JSON.parse(readFileSync(join(DATA, 'maps', 'thais.json'), 'utf8')) as {
      floorChanges: Array<{ from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } }>;
    };
    expect(raw.floorChanges.length).toBeGreaterThanOrEqual(2);
    for (const change of raw.floorChanges) {
      expect(floorChangeAt(city, change.from.x, change.from.y, change.from.z)).toEqual(change.to);
      expect(isBlocked(city, change.to.x, change.to.y, change.to.z)).toBe(false);
      // A volta: uma escada no andar de chegada, encostada no tile de chegada, que leva de
      // volta ao andar de origem.
      const back = raw.floorChanges.find((other) => other.from.z === change.to.z
        && other.to.z === change.from.z
        && Math.max(Math.abs(other.from.x - change.to.x), Math.abs(other.from.y - change.to.y)) <= 1);
      expect(back, `escada ${JSON.stringify(change)} sem volta`).toBeDefined();
    }
    // A escada do depot, como o Huntera a mostrou (§14): subir em (75,73,7) chega em (75,72,6)
    // e descer de (75,73,6) chega em (75,74,7).
    expect(floorChangeAt(city, 75, 73, 7)).toEqual({ x: 75, y: 72, z: 6 });
    expect(floorChangeAt(city, 75, 73, 6)).toEqual({ x: 75, y: 74, z: 7 });
  });

  it('nenhuma vocação está em aberto: os ganhos por level são os do Tibia (ADR 0026, decisão 5)', () => {
    // Knight 15/5/25, Paladin 10/15/20, Sorcerer e Druid 5/30/10 — HP, mana e capacidade por
    // level, decididos pelo usuário em 2026-09-12. O `_open` do Druida saiu junto: um valor
    // decidido que continua marcado como provisório é o que faz ninguém acreditar na marca.
    const content = loadContent(DATA);
    expect(content.openValues.some((v) => v.startsWith('vocation/'))).toBe(false);
    const gains = [...content.vocations.values()]
      .map((v) => [v.id, v.healthPerLevel, v.manaPerLevel, v.capacityPerLevel]);
    expect(gains).toEqual([
      ['druid', 5, 30, 10], ['knight', 15, 5, 25], ['paladin', 10, 15, 20], ['sorcerer', 5, 30, 10],
    ]);
  });

  it('carrega o kit inicial e as armas de vocação com os ids do pacote 13.32, conferidos de olho (#151)', () => {
    // Os ids foram conferidos abrindo o PNG de cada objeto na biblioteca (skill /assets): o
    // índice não tem nome, e um id errado desenha outra coisa sem erro nenhum. O que se prende
    // aqui é o número; mutação que mata: trocar qualquer id em `appearances/baseline.json`.
    const content = loadContent(DATA);
    const ids = Object.fromEntries([...content.items.values()].map((i) => [i.id, i.appearanceId]));
    expect(ids).toMatchObject({
      machete: 3308, 'leather-helmet': 3355, 'leather-armor': 3361, 'leather-legs': 3559,
      'leather-boots': 3552, backpack: 2854, 'steel-axe': 7773, bow: 3350,
      'wand-of-vortex': 3074, 'snakebite-rod': 3066,
    });
    // O kit não exige nada (o personagem nasce level 1, sem vocação); cada arma de vocação
    // exige a sua; o bow ocupa as duas mãos; a mochila é o container das costas.
    for (const id of ['machete', 'leather-helmet', 'leather-armor', 'leather-legs', 'leather-boots', 'backpack']) {
      expect(content.items.get(id)?.requires, id).toEqual({});
    }
    expect(content.items.get('steel-axe')?.requires.vocationId).toBe('knight');
    expect(content.items.get('bow')?.requires.vocationId).toBe('paladin');
    expect(content.items.get('bow')?.twoHanded).toBe(true);
    expect(content.items.get('wand-of-vortex')?.requires.vocationId).toBe('sorcerer');
    expect(content.items.get('snakebite-rod')?.requires.vocationId).toBe('druid');
    expect(content.items.get('backpack')).toMatchObject({ kind: 'container', slot: 'back' });
    expect(content.items.get('leather-armor')?.weight).toBe(60);
  });

  it('todo personagem nasce vestido com o kit do ADR 0026: seis peças, uma por slot, sem exigir nada (#153)', () => {
    // O kit é conteúdo (`progression.startingKit`), e o que se prende aqui é o que o jogador
    // encontra na primeira entrada. Mutação que mata: tirar uma peça do JSON, ou trocar o slot.
    const content = loadContent(DATA);
    expect(content.progression.startingKit).toEqual([
      { itemId: 'machete', slot: 'hand' },
      { itemId: 'leather-helmet', slot: 'head' },
      { itemId: 'leather-armor', slot: 'chest' },
      { itemId: 'leather-legs', slot: 'legs' },
      { itemId: 'leather-boots', slot: 'feet' },
      { itemId: 'backpack', slot: 'back' },
    ]);
    for (const piece of content.progression.startingKit) {
      const item = content.items.get(piece.itemId);
      expect(item?.slot, piece.itemId).toBe(piece.slot);
      expect(item?.requires, piece.itemId).toEqual({});
    }
    // O kit pesa menos que a capacidade de nascença: senão o personagem nasce sobrecarregado.
    const weight = content.progression.startingKit
      .reduce((sum, piece) => sum + (content.items.get(piece.itemId)?.weight ?? 0), 0);
    expect(weight).toBeLessThan(content.progression.startingCapacity);
  });

  it('cada arma diz como bate, e a skill de distância existe (#152, ADR 0026 decisões 3 e 4; CMB-05)', () => {
    const content = loadContent(DATA);
    const weapon = (id: string) => content.items.get(id)?.weapon;
    // A família é DADO (CMB-05): a arma declara a sua, e a fórmula traz a contribuição da skill
    // apontada (`damagePerLevel` 0,02 da `melee`/`distance`, a partir do nível 10).
    const scaled = (base: number, skillFactor = 0.02, skillStartingLevel = 10) =>
      ({ base, levelFactor: 0, skillFactor, skillStartingLevel, spread: 0 });
    expect(weapon('machete')).toEqual({
      kind: 'melee', family: 'sword', range: 1, damageType: 'physical', power: scaled(12),
    });
    expect(weapon('steel-axe')).toEqual({
      kind: 'melee', family: 'axe', range: 1, damageType: 'physical', power: scaled(21),
    });
    expect(weapon('bow')).toEqual({
      kind: 'distance', family: 'distance', range: 6, ammoFamily: 'arrow', damageType: 'physical',
      power: scaled(0),
    });
    expect(weapon('wand-of-vortex')).toEqual({
      kind: 'wand', family: 'wand', range: 3, manaPerHit: 2, damageType: 'energy',
      fixedDamage: { min: 8, max: 18 },
    });
    expect(weapon('snakebite-rod')).toEqual({
      kind: 'wand', family: 'rod', range: 3, manaPerHit: 1, damageType: 'earth',
      fixedDamage: { min: 8, max: 18 },
    });
    // O desarmado é a família `fist` com o bloco `player` (CMB-05), preservando o v1.
    expect(content.unarmed).toEqual({
      family: 'fist', damageType: 'physical', range: 1, power: scaled(25),
    });
    expect([...content.weaponFamilies.keys()].sort()).toEqual(
      ['axe', 'club', 'distance', 'fist', 'rod', 'sword', 'wand'],
    );
    // Os projéteis da wand e do rod: energia (5) e terra pequena (39), conferidos de olho.
    // O kit level 200 (#524) acrescenta a Wand of Starstorm (energia, 5) e a Hailstorm Rod
    // (gelo, 29 — a mesma da ice-strike, CMB-06). O loot do Dragon (#520) acrescenta a Wand of
    // Inferno (fogo, 4 — a mesma da flame-strike).
    expect(content.appearances?.weapons).toEqual({
      'wand-of-vortex': { missile: 5 },
      'snakebite-rod': { missile: 39 },
      'wand-of-starstorm': { missile: 5 },
      'hailstorm-rod': { missile: 29 },
      'wand-of-inferno': { missile: 4 },
    });
    const distance = content.skills.get('distance');
    expect(distance?.gain).toEqual({ on: 'distance-hit', points: 1 });
    expect(distance?.startingLevel).toBe(10);
  });

  it('a munição é ABSTRATA: `content.ammunition` existe, a arrow tem price > 0 e a família arrow (ADR 0026 d.3)', () => {
    const content = loadContent(DATA);
    // A munição é seleção por família, não item: família, attack e preço por tiro (RF-01).
    for (const id of ['arrow', 'burst-arrow', 'sniper-arrow', 'onyx-arrow']) {
      const ammo = content.ammunition.get(id);
      expect(ammo?.family, id).toBe('arrow');
      expect(ammo?.attack, id).toBeGreaterThan(0);
      expect(ammo?.price, id).toBeGreaterThan(0);
      expect(ammo?.appearanceId, id).toBeGreaterThan(0);
      expect(ammo?.missileId, id).toBeGreaterThan(0);
    }
    // A flecha não é item: não há item de munição no catálogo.
    expect(content.items.has('arrow')).toBe(false);
    expect(content.ammunition.get('arrow')?.attack).toBe(25);
    // A tabela guarda o ícone E o projétil, os dois conferidos contra o pacote.
    expect(content.appearances?.ammunition['arrow']).toEqual({ icon: 3447, missile: 3 });
  });
});

describe('a tabela de aparências é a ÚNICA dona dos ids (FUN-94)', () => {
  it('carrega a tabela real e resolve as entidades do repositório com ela', () => {
    const content = loadContent(DATA);
    // `rat.json` não tem outfitId nenhum; o monstro montado tem. É a indireção funcionando
    // sobre o conteúdo de verdade, e não só sobre fixture.
    expect(content.monsters.get('rat')?.outfitId).toBeGreaterThan(0);
    for (const item of content.items.values()) {
      expect(item.appearanceId).toBeGreaterThan(0);
    }
  });

  it('carries the real spell, supply and hit effects, all as ids (FUN-109)', () => {
    // O contrato que o `game` lê para transformar o que o `sim` emite em `effect` e
    // `missile` no fio. Os números são do pacote 1332 e foram conferidos visualmente; o que
    // se prende aqui é que o arquivo REAL passa pelo schema e pela referência cruzada — e
    // que `strike` tem projétil, porque é a única magia à distância do catálogo.
    // Mutação que mata: trocar `"missile": 5` por `"missile": 6` em `baseline.json`.
    const content = loadContent(DATA);
    expect(content.appearances?.spells['strike']).toEqual({ effect: 12, missile: 5 });
    expect(content.appearances?.supplies['health-potion']).toEqual({ effect: 14 });
    expect(content.appearances?.hits.melee).toBe(1);
    // Toda magia e todo supply do repositório TÊM efeito. Não é regra do carregador — magia
    // muda é válida —, é o estado do conteúdo hoje, e a asserção existe para a magia nova
    // que nascer sem efeito ser uma decisão, e não um esquecimento.
    for (const id of content.spells.keys()) {
      expect(content.appearances?.spells[id]?.effect, `spell "${id}"`).toBeGreaterThan(0);
    }
    for (const id of content.supplies.keys()) {
      expect(content.appearances?.supplies[id]?.effect, `supply "${id}"`).toBeGreaterThan(0);
    }
  });

  it('carrega a Avalanche Rune como consumível de ATAQUE, com gate e área (#165, AB-01)', () => {
    // A runa é item consumível (ADR 0032 d.6) e aparece na projeção v1 como supply de dano:
    // tem `requires` — o servidor recusa abaixo de level 30 / magic level 4 — e a forma é o
    // círculo de raio 3 no alvo. O gate dela é o primeiro `requires` de consumível do repositório.
    // Mutação que mata: apagar `requires` do arquivo — o default `{}` liberaria a runa no level 1.
    const content = loadContent(DATA);
    const rune = content.supplies.get('avalanche-rune');
    expect(rune).toMatchObject({
      price: 14,
      requires: { level: 30, magicLevel: 4 },
      effect: { kind: 'damage', basePower: 45, range: 8, area: { shape: 'circle', radius: 3, centered: 'target' } },
    });
    expect(content.supplies.get('health-potion')?.requires).toEqual({});
  });

  it('carrega as runas de ataque do Canary com fórmula, área e alvo único (#476)', () => {
    // O catálogo completo da #476: cada runa com o SEU elemento, a SUA fórmula e a SUA forma.
    // `area` ausente é a runa de ALVO ÚNICO (Sudden Death, Heavy Magic Missile); a Explosion é
    // a cruz. Mutação que mata: trocar o `damageType` da Thunderstorm para `ice`.
    const content = loadContent(DATA);
    const expected: Readonly<Record<string, {
      readonly damageType: string;
      readonly shape?: string;
      readonly skillMin: number;
      readonly skillMax: number;
      readonly baseMin?: number;
      readonly baseMax?: number;
      /** O projétil da tabela de aparências (#478): a Explosion fica sem, por ora. */
      readonly missile?: number;
    }>> = {
      'avalanche-rune': { damageType: 'ice', shape: 'circle', skillMin: 1.2, skillMax: 2.8, missile: 29 },
      'great-fireball-rune': { damageType: 'fire', shape: 'circle', skillMin: 1.2, skillMax: 2.8, missile: 4 },
      'thunderstorm-rune': { damageType: 'energy', shape: 'circle', skillMin: 1, skillMax: 2.6, missile: 5 },
      'stone-shower-rune': { damageType: 'earth', shape: 'circle', skillMin: 1, skillMax: 2.6, missile: 30 },
      // #523: base 32/48→28/46, skillMin/skillMax exatos 4,605/7,395 (`data/scripts/runes/sudden_death.lua`).
      'sudden-death-rune': { damageType: 'death', skillMin: 4.605, skillMax: 7.395, baseMin: 28, baseMax: 46, missile: 11 },
      'heavy-magic-missile-rune': { damageType: 'energy', skillMin: 0.4, skillMax: 1.59, missile: 5 },
      'explosion-rune': { damageType: 'physical', shape: 'cross', skillMin: 0, skillMax: 4.8 },
    };
    for (const [id, want] of Object.entries(expected)) {
      const effect = content.supplies.get(id)?.effect;
      expect(effect?.kind, id).toBe('damage');
      if (effect?.kind !== 'damage') continue;
      expect(effect.damageType, id).toBe(want.damageType);
      expect(effect.formula?.skillMin, id).toBe(want.skillMin);
      expect(effect.formula?.skillMax, id).toBe(want.skillMax);
      if (want.baseMin !== undefined) expect(effect.formula?.baseMin, id).toBe(want.baseMin);
      if (want.baseMax !== undefined) expect(effect.formula?.baseMax, id).toBe(want.baseMax);
      expect(effect.area?.shape, id).toBe(want.shape);
      // A runa de ataque projeta (#478): o id vem da tabela de aparências, nunca do `sim`.
      // Mutação que mata: trocar o `missile` da Avalanche de 29 para 30 em `baseline.json`.
      expect(content.appearances?.supplies[id]?.missile, id).toBe(want.missile);
    }
  });

  it('as runas de cura do Canary têm fórmula e level corretos (#523)', () => {
    // Ultimate Healing Rune e Intense Healing Rune caíram numa conversão genérica ou num
    // level torto antes do #523 — `data/scripts/runes/ultimate_healing_rune.lua` e
    // `intense_healing_rune.lua`.
    const content = loadContent(DATA);
    const ultimate = content.supplies.get('ultimate-healing-rune');
    expect(ultimate?.effect.kind).toBe('heal');
    if (ultimate?.effect.kind === 'heal') {
      expect(ultimate.effect.formula).toEqual({
        levelFactor: 0.2, skillMin: 7.3, skillMax: 12.4, baseMin: 42, baseMax: 90,
      });
    }
    const intense = content.supplies.get('intense-healing-rune');
    expect(intense?.requires.level).toBe(15);
    expect(intense?.effect.kind).toBe('heal');
    if (intense?.effect.kind === 'heal') {
      expect(intense.effect.formula).toEqual({
        levelFactor: 0.2, skillMin: 3.2, skillMax: 5.4, baseMin: 20, baseMax: 40,
      });
    }
  });

  it('blessing-charge é o ÚNICO item consumable: não-empilhável, sem group nem restock (ADR 0026 d.3)', () => {
    const content = loadContent(DATA);
    const consumables = [...content.items.values()].filter((item) => item.kind === 'consumable');
    expect(consumables.map((item) => item.id)).toEqual(['blessing-charge']);
    const blessing = content.items.get('blessing-charge');
    expect(blessing?.stackable).toBe(false);
    expect(blessing?.effect).toEqual({ kind: 'blessing' });
    expect(blessing?.weight).toBeGreaterThan(0);
  });

  it('content.supplies é o catálogo ABSTRATO, com price e group de cooldown (ADR 0026 d.3)', () => {
    const content = loadContent(DATA);
    expect(content.supplies.get('health-potion')).toMatchObject({
      id: 'health-potion', name: 'Poção de Vida', price: 45, group: 'potion',
      effect: { kind: 'heal', amount: 80 }, requires: {},
    });
    expect(content.supplies.get('avalanche-rune')?.group).toBe('attack');
    // A bênção não é supply: é o único consumível que ainda é item.
    expect(content.supplies.has('blessing-charge')).toBe(false);
  });

  it('appearances.supplies É conferido contra o catálogo abstrato, de um lado só (FUN-109)', () => {
    // A linha órfã continua sendo recusada, mas supply sem efeito é mudo e válido — por isso a
    // conferência é da tabela para o catálogo, e não o contrário (FUN-109).
    const content = loadContent(DATA);
    expect(content.appearances?.supplies['health-potion']).toEqual({ effect: 14 });
    for (const id of Object.keys(content.appearances?.supplies ?? {})) {
      expect(content.supplies.has(id), id).toBe(true);
    }
  });

  it('todo supplyId da baseline de bot resolve no catálogo abstrato (AB-03)', () => {
    // A config v1 salva continua válida: o id aponta para o catálogo de suprimentos.
    const content = loadContent(DATA);
    const config = content.bot.defaultConfig;
    const usados = BOT_CATEGORIES.flatMap((category) => config?.[category] ?? [])
      .flatMap((rule) => (rule.do.kind === 'supply' ? [rule.do.supplyId] : []));
    // A baseline TEM ao menos um supplyId; sem isso o laço abaixo passaria vazio.
    expect(usados.length).toBeGreaterThan(0);
    for (const id of usados) {
      expect(content.supplies.has(id), id).toBe(true);
    }
  });

  it('data/supplies voltou a existir, e a poção não é mais item (ADR 0026 d.3)', () => {
    expect(existsSync(join(DATA, 'supplies'))).toBe(true);
    const content = loadContent(DATA);
    expect(content.items.has('health-potion')).toBe(false);
  });

  it('o pacote que a tabela cita tem inventário em packs/, e a tabela passa por ele (FUN-21)', () => {
    // É o que faz o CI conferir os ids sem ter o pacote: `packs/<pack>.json` é a sombra dele
    // no repositório. Apagar a pasta desligaria a conferência em silêncio — `buildContent`
    // só a roda quando há inventário —, e este teste é o que impede isso.
    const content = loadContent(DATA);
    const pack = content.appearances?.pack;
    expect(pack).toBeTruthy();
    expect(readdirSync(join(DATA, 'packs'))).toContain(`${pack}.json`);
    expect(content.pack?.id).toBe(pack);
  });

  it('o CARREGADOR leva o inventário até a conferência: um id fora dele reprova pelo loadContent (FUN-21)', () => {
    // O teste acima prende que o arquivo existe; este prende que `load.ts` o LÊ. Sem ele,
    // apagar a linha `packs:` do carregador deixaria a suíte verde com a conferência
    // desligada — a mutação que sobreviveu na revisão. O conteúdo real é copiado e um id
    // que o pacote 1332 não tem entra na tabela; o resto do repositório fica como está.
    const copy = mkdtempSync(join(tmpdir(), 'draconya-content-'));
    try {
      cpSync(DATA, copy, { recursive: true });
      const table = join(copy, 'appearances', 'baseline.json');
      const text = readFileSync(table, 'utf8');
      expect(text).toMatch(/"rat": 21/);
      writeFileSync(table, text.replace('"rat": 21', '"rat": 999999'));
      expect(() => loadContent(copy))
        .toThrow('appearances.monsters.rat: outfit 999999 não existe no pacote tibia-1332');
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  it('nenhum arquivo de entidade guarda id de aparência por conta própria', () => {
    // Mesma ideia da varredura de arte abaixo, e pela mesma razão: o schema já recusa a chave
    // solta, mas a mensagem dele ("chave não reconhecida") não diz PARA ONDE o campo foi. Esta
    // varredura diz — e cobre pasta nova de graça, como a de arte cobriu `items/`.
    const ofensores: string[] = [];
    for (const pasta of readdirSync(DATA)) {
      if (pasta === 'appearances') continue;
      for (const arquivo of readdirSync(join(DATA, pasta))) {
        const texto = readFileSync(join(DATA, pasta, arquivo), 'utf8');
        if (/"(appearanceId|outfitId)"\s*:/.test(texto)) ofensores.push(`${pasta}/${arquivo}`);
      }
    }
    // Se este teste reprovou: o id saiu do arquivo da entidade na FUN-94 e vive em
    // `data/appearances/baseline.json`, uma linha por id de conteúdo.
    expect(ofensores).toEqual([]);
  });
});

describe('content/ nunca contém arte (invariante 6)', () => {
  it('nenhum arquivo de dados menciona caminho de imagem', () => {
    // O atalho de gravar o caminho direto é sempre mais rápido numa tarde apertada, e é
    // exatamente assim que a reversibilidade do ADR 0008 some sem ninguém decidir abrir mão
    // dela. Este teste é barato e é a única coisa que impede o atalho.
    const extensoes = /\.(png|jpe?g|gif|webp|bmp|spr|dat)\b/i;
    const ofensores: string[] = [];
    for (const pasta of readdirSync(DATA)) {
      const caminhoPasta = join(DATA, pasta);
      for (const arquivo of readdirSync(caminhoPasta)) {
        const texto = readFileSync(join(caminhoPasta, arquivo), 'utf8');
        if (extensoes.test(texto)) ofensores.push(`${pasta}/${arquivo}`);
      }
    }
    expect(ofensores).toEqual([]);
  });
});

// O catálogo de magias por vocação (#156–#159, ADR 0026 decisão 5): a tabela do TibiaWiki como
// TESTE — nome → level, mana, grupo, cooldowns, secundário, efeito e Base Power. Um número
// copiado errado reprova aqui, não no meio de uma hunt.
type SpellRow = {
  level: number; mana: number; group: string; groupMs: number; cdMs: number;
  secondary?: [string, number]; kind: string; bp?: number;
};
const VOCATION_SPELLS: Record<string, Record<string, SpellRow>> = {
  knight: {
    'bruise-bane': { level: 1, mana: 10, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 15 },
    'lesser-front-sweep': { level: 1, mana: 6, group: 'attack', groupMs: 2000, cdMs: 6000, kind: 'damage', bp: 14 },
    'wound-cleansing': { level: 8, mana: 40, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 70 },
    'haste-knight': { level: 14, mana: 60, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'haste' },
    'brutal-strike': { level: 16, mana: 30, group: 'attack', groupMs: 2000, cdMs: 6000, kind: 'damage', bp: 39 },
    'blood-rage': { level: 60, mana: 290, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'buff', secondary: ['focus', 2000] },
    'protector': { level: 55, mana: 200, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'buff', secondary: ['focus', 2000] },
    'charge': { level: 25, mana: 100, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'haste' },
    'whirlwind-throw': { level: 28, mana: 40, group: 'attack', groupMs: 2000, cdMs: 6000, kind: 'damage', bp: 32 },
    'groundshaker': { level: 33, mana: 160, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', bp: 32 },
    'berserk': { level: 35, mana: 115, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 44 },
    'recovery-knight': { level: 50, mana: 75, group: 'healing', groupMs: 1000, cdMs: 60000, kind: 'heal-over-time' },
    'front-sweep': { level: 70, mana: 200, group: 'attack', groupMs: 2000, cdMs: 6000, kind: 'damage', bp: 80 },
    'fierce-berserk': { level: 90, mana: 340, group: 'attack', groupMs: 2000, cdMs: 6000, kind: 'damage', bp: 90 },
    'intense-wound-cleansing': { level: 80, mana: 200, group: 'healing', groupMs: 1000, cdMs: 600000, kind: 'heal', bp: 500 },
  },
  paladin: {
    'lesser-ethereal-spear': { level: 1, mana: 6, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 9 },
    'light-healing-paladin': { level: 8, mana: 20, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 40 },
    'haste-paladin': { level: 14, mana: 60, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'haste' },
    'intense-healing-paladin': { level: 20, mana: 70, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 120 },
    'divine-defiance': { level: 20, mana: 250, group: 'support', groupMs: 2000, cdMs: 10000, kind: 'buff', secondary: ['stance', 10000] },
    'sharpshooter': { level: 60, mana: 450, group: 'support', groupMs: 2000, cdMs: 10000, kind: 'buff', secondary: ['focus', 10000] },
    'ethereal-spear': { level: 23, mana: 25, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 25 },
    'divine-healing': { level: 35, mana: 160, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 250 },
    'divine-missile': { level: 40, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 60 },
    'divine-caldera': { level: 50, mana: 160, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 150 },
    'recovery-paladin': { level: 50, mana: 75, group: 'healing', groupMs: 1000, cdMs: 60000, kind: 'heal-over-time' },
    'swift-foot': { level: 55, mana: 400, group: 'support', groupMs: 2000, cdMs: 10000, kind: 'haste', secondary: ['focus', 10000] },
    'salvation': { level: 60, mana: 210, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 500 },
    'ethereal-barrage': { level: 60, mana: 135, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 100 },
    'divine-barrage': { level: 70, mana: 175, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 130 },
    'strong-ethereal-spear': { level: 90, mana: 55, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', bp: 70 },
  },
  sorcerer: {
    'buzz': { level: 1, mana: 6, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 15 },
    'scorch': { level: 1, mana: 8, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 10 },
    'magic-patch-sorcerer': { level: 1, mana: 6, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 10 },
    'apprentices-strike-sorcerer': { level: 8, mana: 6, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 15 },
    'flame-strike-sorcerer': { level: 14, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 45 },
    'ice-strike-sorcerer': { level: 15, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 45 },
    'energy-strike-sorcerer': { level: 12, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 45 },
    'terra-strike-sorcerer': { level: 13, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 45 },
    'haste-sorcerer': { level: 14, mana: 60, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'haste' },
    'magic-shield-sorcerer': { level: 14, mana: 50, group: 'support', groupMs: 2000, cdMs: 14000, kind: 'mana-shield' },
    'death-strike': { level: 16, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 45 },
    'fire-wave': { level: 18, mana: 25, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 40 },
    'energy-beam': { level: 23, mana: 40, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 60 },
    'great-energy-beam': { level: 29, mana: 110, group: 'attack', groupMs: 2000, cdMs: 6000, kind: 'damage', secondary: ['great-beams', 6000], bp: 155 },
    'ultimate-healing-sorcerer': { level: 30, mana: 160, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 250 },
    'energy-wave': { level: 38, mana: 170, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', bp: 150 },
    'great-fire-wave': { level: 38, mana: 120, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 100 },
    'lightning': { level: 55, mana: 60, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', secondary: ['special', 8000], bp: 110 },
    'rage-of-the-skies': { level: 55, mana: 600, group: 'attack', groupMs: 4000, cdMs: 40000, kind: 'damage', secondary: ['focus', 40000], bp: 200 },
    'hells-core': { level: 60, mana: 1100, group: 'attack', groupMs: 4000, cdMs: 40000, kind: 'damage', secondary: ['focus', 40000], bp: 250 },
    'great-death-beam': { level: 300, mana: 140, group: 'attack', groupMs: 2000, cdMs: 10000, kind: 'damage', secondary: ['great-beams', 6000], bp: 155 },
    'strong-flame-strike': { level: 70, mana: 60, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', secondary: ['special', 8000], bp: 125 },
    'strong-energy-strike': { level: 80, mana: 60, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', secondary: ['special', 8000], bp: 125 },
    'ultimate-energy-strike': { level: 100, mana: 100, group: 'attack', groupMs: 2000, cdMs: 30000, kind: 'damage', secondary: ['ultimatestrikes', 30000], bp: 180 },
  },
  druid: {
    'mud-attack': { level: 1, mana: 6, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 15 },
    'chill-out': { level: 1, mana: 8, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 10 },
    'magic-patch-druid': { level: 1, mana: 6, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 10 },
    'apprentices-strike-druid': { level: 8, mana: 6, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 15 },
    'flame-strike-druid': { level: 14, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 45 },
    'ice-strike-druid': { level: 15, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 45 },
    'heal-friend-druid': { level: 18, mana: 120, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 60 },
    'light-healing-druid': { level: 8, mana: 20, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 40 },
    'energy-strike-druid': { level: 12, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 45 },
    'terra-strike-druid': { level: 13, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 45 },
    'haste-druid': { level: 14, mana: 60, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'haste' },
    'magic-shield-druid': { level: 14, mana: 50, group: 'support', groupMs: 2000, cdMs: 14000, kind: 'mana-shield' },
    'physical-strike': { level: 16, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 50 },
    'ice-wave': { level: 18, mana: 25, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 35 },
    'intense-healing-druid': { level: 20, mana: 70, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 120 },
    'ultimate-healing-druid': { level: 30, mana: 160, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 250 },
    'mass-healing': { level: 36, mana: 150, group: 'healing', groupMs: 1000, cdMs: 2000, kind: 'heal', bp: 200 },
    'terra-wave': { level: 38, mana: 170, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 120 },
    'strong-ice-wave': { level: 40, mana: 170, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', bp: 150 },
    'wrath-of-nature': { level: 55, mana: 700, group: 'attack', groupMs: 4000, cdMs: 40000, kind: 'damage', secondary: ['focus', 40000], bp: 175 },
    'eternal-winter': { level: 60, mana: 1050, group: 'attack', groupMs: 4000, cdMs: 40000, kind: 'damage', secondary: ['focus', 40000], bp: 200 },
    'strong-terra-strike': { level: 70, mana: 60, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', secondary: ['special', 8000], bp: 115 },
    'forked-thorns': { level: 80, mana: 180, group: 'attack', groupMs: 2000, cdMs: 6000, kind: 'damage', bp: 97 },
    'strong-ice-strike': { level: 80, mana: 60, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', secondary: ['special', 8000], bp: 115 },
  },
};

/** As excluídas por nome (ADR 0026 decisão 5) — em kebab-case, como um id seria. */
const EXCLUDED_SPELLS = [
  'light', 'great-light', 'ultimate-light', 'find-person', 'find-fiend', 'magic-rope', 'levitate',
  'invisible', 'cancel-invisibility', 'cancel-magic-shield', 'creature-illusion',
  'cure-poison', 'cure-bleeding', 'cure-curse', 'cure-electrification', 'cure-burning',
  'inflict-wound', 'holy-flash', 'ignite', 'electrify', 'curse', 'envenom',
  'shield-bash', 'shield-slam', 'challenge', 'train-party', 'protect-party', 'enchant-party',
  'heal-party', 'elemental-synthesis', 'shared-conservation',
  'arrow-call', 'conjure-arrow', 'conjure-explosive-arrow', 'enchant-spear', 'conjure-wand-of-darkness',
  'food', 'summon-creature', 'master-of-decay', 'master-of-flames', 'master-of-thunder',
  'light-healing-sorcerer', 'intense-healing-sorcerer',
];

describe('the vocation spell catalogues (#156–#159)', () => {
  const content = loadContent(DATA);

  for (const [vocationId, rows] of Object.entries(VOCATION_SPELLS)) {
    it(`the ${vocationId} catalogue carries the TibiaWiki numbers`, () => {
      for (const [id, row] of Object.entries(rows)) {
        const spell = content.spells.get(id);
        expect(spell, id).toBeDefined();
        if (spell === undefined) continue;
        expect(spell.vocationId, id).toBe(vocationId);
        expect(spell.minLevel, id).toBe(row.level);
        expect(spell.manaCost, id).toBe(row.mana);
        expect(spell.group, id).toBe(row.group);
        expect(spell.groupCooldownMs, id).toBe(row.groupMs);
        expect(spell.cooldownMs, id).toBe(row.cdMs);
        expect(
          spell.secondaryGroup === undefined ? undefined : [spell.secondaryGroup.name, spell.secondaryGroup.cooldownMs],
          id,
        ).toEqual(row.secondary);
        expect(spell.effect.kind, id).toBe(row.kind);
        if (row.bp !== undefined) expect((spell.effect as { basePower?: number }).basePower, id).toBe(row.bp);
        // E toda magia da vocação tem arte na tabela (ids dentro das faixas do pacote — o
        // schema já conferiu; aqui, que a linha existe).
        expect(content.appearances?.spells[id]?.effect, id).toBeGreaterThan(0);
      }
    });
  }

  it('has exactly the catalogue: 15 + 16 + 24 + 24 vocation spells, plus the three generic ones', () => {
    // #523 acrescentou uma magia por vocação que faltava (Fierce Berserk, Strong Ethereal
    // Spear, Ultimate Energy Strike) — Druid já tinha as 24 (Heal Friend só ganhou fórmula).
    const byVocation = new Map<string | undefined, number>();
    for (const spell of content.spells.values()) {
      byVocation.set(spell.vocationId, (byVocation.get(spell.vocationId) ?? 0) + 1);
    }
    expect(byVocation.get('knight')).toBe(15);
    expect(byVocation.get('paladin')).toBe(16);
    expect(byVocation.get('sorcerer')).toBe(24);
    expect(byVocation.get('druid')).toBe(24);
    expect(byVocation.get(undefined)).toBe(3);
  });

  it('leaves out, by name, what the engine does not express (ADR 0026 decisão 5)', () => {
    for (const excluded of EXCLUDED_SPELLS) expect(content.spells.has(excluded), excluded).toBe(false);
  });

  // Conformidade #523: toda magia/runa de dano ou cura que TEM correspondente real no Canary
  // declara `formula`. Só três magias por vocação NÃO têm: as três genéricas pré-vocação
  // (`heal`, `strike`, `blast`, level 1-7, sem `vocationId` — não existem no Tibia, que não dá
  // magia nenhuma antes da escolha de vocação) e três magias inventadas antes desta auditoria
  // que não correspondem a nenhum nome do Canary (`divine-barrage`, `ethereal-barrage`,
  // `forked-thorns` — ver o `_open` de cada uma). A lista é a allowlist EXATA: crescer sem
  // atualizar aqui é o teste fazendo o trabalho.
  const NOT_FROM_CANARY = ['heal', 'strike', 'blast', 'divine-barrage', 'ethereal-barrage', 'forked-thorns'];

  it('toda magia de dano/cura com correspondente no Canary declara `formula` (#523)', () => {
    const missing: string[] = [];
    for (const spell of content.spells.values()) {
      if (spell.effect.kind !== 'damage' && spell.effect.kind !== 'heal') continue;
      if (NOT_FROM_CANARY.includes(spell.id)) continue;
      if (spell.effect.formula === undefined) missing.push(spell.id);
    }
    expect(missing).toEqual([]);
  });

  it('toda runa de dano/cura com correspondente no Canary declara `formula` (#523)', () => {
    // Poção não é runa e não tem fórmula de level/ML no Canary: é um valor fixo (`amount` —
    // health-potion, mana-potion) ou uma faixa fixa por item (`amountRange` — as poções do Tibia
    // da #524). Toda runa de verdade (as que têm `basePower`, o número de exibição que a fórmula
    // substitui — ADR 0033) declara `formula`.
    const missing: string[] = [];
    for (const supply of content.supplies.values()) {
      const effect = supply.effect;
      if (effect.kind !== 'damage' && effect.kind !== 'heal') continue;
      const isFixedAmount = ('amount' in effect && effect.amount !== undefined)
        || ('amountRange' in effect && effect.amountRange !== undefined);
      if (effect.formula === undefined && !isFixedAmount) missing.push(supply.id);
    }
    expect(missing).toEqual([]);
  });

  it("Apprentice's Strike é dano de FOGO, level 8 (revisão de #523)", () => {
    // `data/scripts/spells/attack/apprentice's_strike.lua`: COMBAT_FIREDAMAGE, spell:level(8).
    // A primeira leitura do #523 trouxe a fórmula certa mas deixou `damageType`/`minLevel`
    // como estavam (energy/6) — o efeito visual já era fogo desde a #219, então a mecânica
    // ficou em desacordo com o que o jogador via na tela.
    for (const id of ['apprentices-strike-druid', 'apprentices-strike-sorcerer']) {
      const spell = content.spells.get(id);
      expect(spell?.minLevel, id).toBe(8);
      expect(spell?.effect.kind, id).toBe('damage');
      if (spell?.effect.kind === 'damage') expect(spell.effect.damageType, id).toBe('fire');
    }
  });

  it('a allowlist do que NÃO vem do Canary não cresce sem ninguém notar', () => {
    // As três genéricas pré-vocação (nunca tiveram vocationId nem BP do TibiaWiki) e as três
    // inventadas (têm vocationId e basePower, mas nome sem correspondente em
    // `data/scripts/spells/**` do Canary — a varredura do #523 não achou).
    for (const id of ['heal', 'strike', 'blast']) {
      expect(content.spells.get(id)?.vocationId, id).toBeUndefined();
    }
    for (const id of ['divine-barrage', 'ethereal-barrage', 'forked-thorns']) {
      expect(content.spells.get(id)?.vocationId, id).toBeDefined();
    }
  });

  it('a Heal Friend (`exura sio`) entra no catálogo com alvo em terceiro e alcance (§26, ADR 0035 d.10)', () => {
    // Emenda ao ADR 0026 d.5: a magia sai da lista de excluídas e passa a ter `target`/`range`.
    // Mutação que mata: manter `'heal-friend'` em `EXCLUDED_SPELLS` — a magia não carregaria.
    // Nome corrigido no #523 (era "Exura Sio", o nome do TibiaWiki não confirmado).
    const spell = content.spells.get('heal-friend-druid');
    expect(spell?.name).toBe('Heal Friend');
    expect(spell?.vocationId).toBe('druid');
    const effect = spell?.effect;
    expect(effect?.kind).toBe('heal');
    if (effect?.kind !== 'heal') throw new Error('heal-friend-druid deveria ser uma cura');
    expect(effect.target).toBe('friend');
    expect(effect.range).toBeDefined();
  });

  it('as poções de vida e mana curam um membro da party, com alcance provisório (§26)', () => {
    // RF-05: a poção deixa de ser só sobre quem usa. `range: 1` é provisório e está no `_open`
    // do arquivo — a decisão final de alcance é do design do cliente.
    for (const id of ['health-potion', 'mana-potion']) {
      const effect = content.supplies.get(id)?.effect;
      expect(effect?.kind === 'heal' || effect?.kind === 'mana', id).toBe(true);
      if (effect?.kind !== 'heal' && effect?.kind !== 'mana') throw new Error(id);
      expect(effect.target, id).toBe('friend');
      expect(effect.range, id).toBe(1);
    }
  });

  it('the Knight scales spells by the weapon skill and the Paladin by distance; the mages by magic', () => {
    expect(content.vocations.get('knight')?.spellSkill).toBe('melee');
    expect(content.vocations.get('paladin')?.spellSkill).toBe('distance');
    expect(content.vocations.get('sorcerer')?.spellSkill).toBe('magic');
    expect(content.vocations.get('druid')?.spellSkill).toBe('magic');
  });
});

// O catálogo importado do Canary (ADR 0038, #572): `generated/` é o que `pnpm catalog:import`
// escreve, `overrides/` é a correção nossa por cima. Cada teste copia o conteúdo real para um
// diretório temporário e acrescenta só o arquivo que o cenário precisa — o resto do repositório
// continua carregando do jeito de sempre, e é isso que prova que a mudança é aditiva.
describe('loadContent — generated/ e overrides/ (ADR 0038)', () => {
  function withCopy(mutate: (dir: string) => void, assert: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'draconya-content-catalog-'));
    try {
      cpSync(DATA, dir, { recursive: true });
      mutate(dir);
      assert(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * Um item novo precisa de uma linha em `appearances.items` (FUN-94) — sem isso `buildContent`
   * reprova por falta de aparência, e não pelo que o teste quer provar. Reaproveita o id da
   * "cheese" (3607): já existe no inventário do pacote 1332, e o teste não fala de arte.
   */
  function givePlaceholderAppearance(dir: string, itemId: string): void {
    const path = join(dir, 'appearances', 'baseline.json');
    const baseline = JSON.parse(readFileSync(path, 'utf8')) as { items: Record<string, number> };
    baseline.items[itemId] = 3607;
    writeFileSync(path, JSON.stringify(baseline, null, 2));
  }

  it('items/generated/<fatia>.json: um array vira várias entidades no catálogo', () => {
    withCopy(
      (dir) => {
        mkdirSync(join(dir, 'items', 'generated'), { recursive: true });
        writeFileSync(join(dir, 'items', 'generated', 'imported.json'), JSON.stringify([
          { id: 'imported-a', name: 'Imported A', kind: 'other', weight: 1, value: 1 },
          { id: 'imported-b', name: 'Imported B', kind: 'other', weight: 2, value: 2 },
        ]));
        givePlaceholderAppearance(dir, 'imported-a');
        givePlaceholderAppearance(dir, 'imported-b');
      },
      (dir) => {
        const content = loadContent(dir);
        expect(content.items.get('imported-a')?.name).toBe('Imported A');
        expect(content.items.get('imported-b')?.weight).toBe(2);
      },
    );
  });

  it('id duplicado entre AUTORAL e GERADO falha no boot', () => {
    withCopy(
      (dir) => {
        mkdirSync(join(dir, 'items', 'generated'), { recursive: true });
        // "backpack" já existe como arquivo autoral (items/backpack.json) — o gerado não pode
        // reintroduzir o mesmo id.
        writeFileSync(join(dir, 'items', 'generated', 'dup.json'), JSON.stringify([
          { id: 'backpack', name: 'Backpack (do gerado)', kind: 'other', weight: 1, value: 1 },
        ]));
      },
      (dir) => {
        expect(() => loadContent(dir)).toThrow(/item "backpack" duplicado/);
      },
    );
  });

  it('overrides/*.json aplica o patch por cima da entidade autoral, com reason exigida', () => {
    withCopy(
      (dir) => {
        mkdirSync(join(dir, 'items', 'overrides'), { recursive: true });
        writeFileSync(join(dir, 'items', 'overrides', 'backpack-weight.json'), JSON.stringify({
          id: 'backpack', reason: 'teste: confere que o override muda o peso', patch: { weight: 999 },
        }));
      },
      (dir) => {
        const content = loadContent(dir);
        const backpack = content.items.get('backpack');
        expect(backpack?.weight).toBe(999);
        // O resto da entidade continua o mesmo — o patch é RASO, não substitui o objeto inteiro.
        expect(backpack?.name).toBe('Backpack');
      },
    );
  });

  it('overrides/*.json também corrige uma entidade GERADA (não só autoral)', () => {
    withCopy(
      (dir) => {
        mkdirSync(join(dir, 'items', 'generated'), { recursive: true });
        mkdirSync(join(dir, 'items', 'overrides'), { recursive: true });
        writeFileSync(join(dir, 'items', 'generated', 'imported.json'), JSON.stringify([
          { id: 'imported-a', name: 'Imported A', kind: 'other', weight: 1, value: 1 },
        ]));
        givePlaceholderAppearance(dir, 'imported-a');
        writeFileSync(join(dir, 'items', 'overrides', 'imported-a-value.json'), JSON.stringify({
          id: 'imported-a', reason: 'teste: TibiaWiki dá outro preço', patch: { value: 42 },
        }));
      },
      (dir) => {
        expect(loadContent(dir).items.get('imported-a')?.value).toBe(42);
      },
    );
  });

  it('override SEM "reason" falha — toda correção precisa de motivo (ADR 0038 decisão 3)', () => {
    withCopy(
      (dir) => {
        mkdirSync(join(dir, 'items', 'overrides'), { recursive: true });
        writeFileSync(join(dir, 'items', 'overrides', 'sem-motivo.json'), JSON.stringify({
          id: 'backpack', patch: { weight: 999 },
        }));
      },
      (dir) => {
        expect(() => loadContent(dir)).toThrow(/sem "reason"/);
      },
    );
  });

  it('override SEM "patch" falha', () => {
    withCopy(
      (dir) => {
        mkdirSync(join(dir, 'items', 'overrides'), { recursive: true });
        writeFileSync(join(dir, 'items', 'overrides', 'sem-patch.json'), JSON.stringify({
          id: 'backpack', reason: 'teste',
        }));
      },
      (dir) => {
        expect(() => loadContent(dir)).toThrow(/sem "patch"/);
      },
    );
  });

  it('override para um id que não existe (nem autoral, nem gerado) falha — correção órfã', () => {
    withCopy(
      (dir) => {
        mkdirSync(join(dir, 'items', 'overrides'), { recursive: true });
        writeFileSync(join(dir, 'items', 'overrides', 'orfao.json'), JSON.stringify({
          id: 'nao-existe-de-verdade', reason: 'teste', patch: { weight: 1 },
        }));
      },
      (dir) => {
        expect(() => loadContent(dir)).toThrow(/override para "nao-existe-de-verdade"/);
      },
    );
  });

  it('override que é um ARRAY (não objeto) falha — a forma é sempre {id, reason, patch}', () => {
    withCopy(
      (dir) => {
        mkdirSync(join(dir, 'items', 'overrides'), { recursive: true });
        writeFileSync(join(dir, 'items', 'overrides', 'array.json'), JSON.stringify([
          { id: 'backpack', reason: 'teste', patch: { weight: 1 } },
        ]));
      },
      (dir) => {
        expect(() => loadContent(dir)).toThrow(/precisa ser um objeto/);
      },
    );
  });

  it('dois overrides para o MESMO id se aplicam em sequência, em ordem de nome de arquivo', () => {
    withCopy(
      (dir) => {
        mkdirSync(join(dir, 'items', 'overrides'), { recursive: true });
        writeFileSync(join(dir, 'items', 'overrides', '1-weight.json'), JSON.stringify({
          id: 'backpack', reason: 'teste 1', patch: { weight: 111 },
        }));
        writeFileSync(join(dir, 'items', 'overrides', '2-value.json'), JSON.stringify({
          id: 'backpack', reason: 'teste 2', patch: { value: 222 },
        }));
      },
      (dir) => {
        const backpack = loadContent(dir).items.get('backpack');
        expect(backpack?.weight).toBe(111);
        expect(backpack?.value).toBe(222);
      },
    );
  });
});
