import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from './load.js';
import { floorChangeAt, isBlocked } from './map.js';
import { BOT_CATEGORIES, manaCostDisplayOf, NEUTRAL_RATES } from './schemas.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

/**
 * Todo arquivo dentro de `dir`, recursivo — `data/items/generated/` e `data/items/overrides/`
 * (ADR 0038, o importador de catálogo) são subpastas de verdade desde o #573, e uma varredura que
 * só lê `readdirSync` raso lançaria `EISDIR` ao tentar ler uma delas como arquivo.
 */
function filesRecursively(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesRecursively(path));
    else out.push(path);
  }
  return out;
}

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

  it('carrega o Bosstiary real: a tabela do Canary por raridade, e os bosses importados (#629)', () => {
    // Opcional no `buildContent` (fixture), obrigatório no conteúdo de verdade. Mutação que
    // mata: apagar `bosstiary/` de `load.ts`, ou trocar um número da tabela do `io_bosstiary`.
    const content = loadContent(DATA);
    expect(content.bosstiary?.levels).toEqual({
      bane: [{ kills: 25, points: 5 }, { kills: 100, points: 15 }, { kills: 300, points: 30 }],
      archfoe: [{ kills: 5, points: 10 }, { kills: 20, points: 30 }, { kills: 60, points: 60 }],
      nemesis: [{ kills: 1, points: 10 }, { kills: 3, points: 30 }, { kills: 5, points: 60 }],
    });
    // O `isBoss` do Canary é "tem bloco bosstiary": as duas flags andam juntas no catálogo.
    const bosses = [...content.monsters.values()].filter((monster) => monster.bosstiary !== undefined);
    expect(bosses.length).toBeGreaterThan(100);
    for (const monster of bosses) expect(monster.boss, monster.id).toBe(true);
    for (const monster of content.monsters.values()) {
      if (monster.boss) expect(monster.bosstiary, monster.id).toBeDefined();
    }
    // As três raridades existem no catálogo, e a contagem por raridade confere com o Canary.
    const byRarity = (rarity: string) => bosses.filter((monster) => monster.bosstiary?.rarity === rarity).length;
    expect(byRarity('bane')).toBeGreaterThan(0);
    expect(byRarity('archfoe')).toBeGreaterThan(0);
    expect(byRarity('nemesis')).toBeGreaterThan(0);
    // Dreadmaw: Nemesis, raceId 639 (`reptiles/dreadmaw.lua`).
    expect(content.monsters.get('dreadmaw')?.bosstiary).toEqual({ rarity: 'nemesis', raceId: 639 });
    // Os dois Voidborn compartilham o raceId 1406 — um contador só (`io_bosstiary`, storage por raceid).
    expect(content.monsters.get('the-armored-voidborn')?.bosstiary?.raceId).toBe(1406);
    expect(content.monsters.get('the-unarmored-voidborn')?.bosstiary?.raceId).toBe(1406);
    // Monstro de caça comum não é boss.
    expect(content.monsters.get('rat')?.bosstiary).toBeUndefined();
    expect(content.monsters.get('rat')?.boss).toBe(false);
  });

  it('carrega a Boosted Creature real: vira à meia-noite UTC (#615)', () => {
    // Opcional no `buildContent` (fixture): sem ele o `jobs` não sorteia nada. Mutação que
    // mata: apagar `boosted/` de `load.ts`.
    const content = loadContent(DATA);
    expect(content.boosted?.rolloverHourUtc).toBe(0);
  });

  it('carrega o Loyalty real: dez degraus de 360 em 360 pontos, de 5 % a 50 % (#628)', () => {
    // Opcional no `buildContent` (fixture): sem ele nenhum ticket carrega bônus. Os números são
    // os de `data/libs/functions/player.lua:762-790` e `config.lua.dist:239-244` do Canary.
    // Mutação que mata: apagar `loyalty/` de `load.ts`, ou trocar um degrau.
    const content = loadContent(DATA);
    expect(content.loyalty).toMatchObject({
      enabled: true, pointsPerCreationDay: 1, bonusPercentageMultiplier: 1,
    });
    expect(content.loyalty?.tiers).toEqual(
      [5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((percent, index) => ({ minPoints: 360 * (index + 1), percent })),
    );
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
    expect(content.items.get('bow')?.value).toBe(400);
    expect(content.items.get('cheese')?.value).toBe(0);
  });

  it('o conteúdo real tem o bot padrão do personagem novo, e mana para a primeira magia (FUN-114)', () => {
    // O MVP é "hunt + poção funcionando" no PRIMEIRO minuto para quem ainda não escolheu
    // vocação — sem isto o personagem novo entrava só no golpe básico até abrir a tela do bot.
    // Desde o #596, o Tibia real não dá magia NENHUMA antes do level 8 (§7.4) — `heal`/`strike`
    // eram genéricas inventadas antes da auditoria do #523/#596 e saíram do catálogo; o
    // `defaultConfig` PRÉ-VOCAÇÃO fica sem `spellId`, e o golpe básico (sem custo de mana) cobre
    // o ataque até a vocação escolhida trazer a primeira magia real de verdade.
    const content = loadContent(DATA);
    const config = content.bot.defaultConfig;
    expect(config?.heal).toEqual([]);
    expect(config?.potion.map((rule) => rule.do)).toEqual([{ kind: 'supply', supplyId: 'health-potion' }]);
    expect(config?.attack).toEqual([]);
    // E cada `defaultConfigByVocation` aponta uma magia REAL de mana acessível no level em que a
    // vocação é escolhida (level 8, §7.4) — nunca um id que o #596 removeu. `manaCostDisplayOf`
    // (#588): magia de party tem `manaCost` escalado pelo tamanho da party, não um número — o
    // que se compara aqui é o custo de EXIBIÇÃO (o `base`), como o catálogo mostra.
    for (const [vocationId, vocationConfig] of Object.entries(content.bot.defaultConfigByVocation ?? {})) {
      for (const slot of vocationConfig.sets[0]?.slots ?? []) {
        if (slot?.do.kind !== 'spell') continue;
        const spell = content.spells.get(slot.do.spellId);
        expect(spell, `${vocationId}: ${slot.do.spellId}`).toBeDefined();
        expect(content.progression.startingMana, `${vocationId}: ${slot.do.spellId}`)
          .toBeGreaterThanOrEqual(spell === undefined ? Infinity : manaCostDisplayOf(spell.manaCost));
      }
    }
  });

  it('o teto de stamina real é 12 h, o valor do Huntera (M32-01, #562, ADR 0043 emenda 2026-09-25)', () => {
    // Era 24 h (86.400.000 ms) antes desta issue — um número nosso sem fonte. A recuperação
    // fora de hunt segue 1:1, valor PROVISÓRIO (ver `_open` de `stamina/baseline.json`): a
    // razão real de recuperação passiva do Huntera nunca foi medida.
    const content = loadContent(DATA);
    expect(content.stamina.maxMs).toBe(43_200_000);
    expect(content.stamina.recoveryRatio).toBe(1);
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
    // `pnpm route:trace` sobre ele — um laço de 160 tiles. Os 56 pontos de spawn (#586) são os
    // reais do recorte do Canary, não um por corredor escolhido à mão.
    expect(map?.source?.file).toBe('otservbr.otbm');
    expect(map?.width).toBe(118);
    expect(map?.height).toBe(80);
    expect(map?.z).toBe(8);
    expect(route?.tiles.length).toBe(160);
    expect(route?.spawnPoints.length).toBe(56);
  });

  it('a Rat Cellars é o bueiro real, com os spawns reais do Canary (#586), o rato do Tibia e o queijo (FUN-123)', () => {
    const content = loadContent(DATA);
    const hunt = content.hunts.get('rat-cellars');
    const route = content.routes.get('rat-cellars');
    // Fim do pull por dificuldade (#583, ADR 0039), com a composição REAL do Canary desde o
    // #586: o recorte não é monotemático — rato é a maioria (48/56), mas o corte também tem
    // spider, rabbit, bug e cave-rat, exatamente como `otservbr-monster.xml` declara.
    const monsterIds = new Set(
      route?.spawnPoints.map((point) => point.monsterId).filter((id) => id !== undefined),
    );
    expect(monsterIds).toEqual(new Set(['rat', 'spider', 'rabbit', 'bug', 'cave-rat']));
    expect(route?.spawnPoints.filter((point) => point.monsterId === 'rat')).toHaveLength(48);
    expect(hunt?.ambience).toBe('cavern');
    const rat = content.monsters.get('rat');
    expect(rat?.class).toBe('mammal');
    // packages/content/data/monsters/generated/mammals.json — regenerado pelo importador do
    // Canary (#581; era o provisório do Huntera, docs/reference/huntera-observed.md Parte V
    // §32). `data-otservbr-global/monster/mammals/rat.lua` (Canary local 47dfd51): attack
    // 0-8, defense 5, os quatro resistances abaixo (o resto vira 0 na normalização), speed 134.
    expect(rat?.attack).toEqual({ min: 0, max: 8 });
    // corpseTtlMs mora no MONSTRO (#585), não mais na hunt — a soma da cadeia de decaimento
    // real do Canary `items.xml` a partir de `monster.corpse`, gerada pelo mesmo importador.
    expect(rat?.corpseTtlMs).toBe(670000);
    expect(rat?.mitigation.resistances).toEqual({
      physical: 0, energy: 0, earth: 0.2, fire: 0, ice: -0.1, holy: 0.2, death: -0.1,
      drown: 0, lifedrain: 0, manadrain: 0, arcane: 0,
    });
    expect(rat?.speed).toBe(134);
    expect(rat?.corpseAppearanceId).toBe(5964);
    expect(rat?.loot.items.map((i) => i.itemId)).toEqual(['cheese']);
    expect(content.items.get('cheese')?.appearanceId).toBe(3607);
  });

  it('a Rotworm Caves é a caverna de Darashia do Huntera, com os spawns reais do Canary (#586) e o rotworm do Canary (#515)', () => {
    const content = loadContent(DATA);
    const map = content.maps.get('rotworm-caves');
    const route = content.routes.get('rotworm-caves');
    expect(map?.source?.file).toBe('otservbr.otbm');
    expect(map?.width).toBe(88);
    expect(map?.height).toBe(73);
    expect(map?.z).toBe(8);
    expect(route?.tiles.length).toBe(444);
    expect(route?.spawnPoints.length).toBe(42);
    // A caixa importada tem duas componentes andáveis (Huntera Parte VI §38): a principal, de
    // 823 tiles, e um corredor isolado de 79 na borda direita (a partir de x === 78). A rota
    // nunca visita o corredor isolado — só a componente principal.
    expect(route?.tiles.every((t) => t.x < 80)).toBe(true);
    // Composição real do Canary (#586): não é só rotworm — 35 rotworm e 7 terramite.
    const monsterIds = new Set(
      route?.spawnPoints.map((point) => point.monsterId).filter((id) => id !== undefined),
    );
    expect(monsterIds).toEqual(new Set(['rotworm', 'terramite']));
    expect(route?.spawnPoints.filter((point) => point.monsterId === 'rotworm')).toHaveLength(35);
    expect(route?.spawnPoints.filter((point) => point.monsterId === 'terramite')).toHaveLength(7);
    const rotworm = content.monsters.get('rotworm');
    expect(rotworm?.class).toBe('vermin');
    // data-otservbr-global/monster/vermins/rotworm.lua (Canary local 47dfd51): attack 0-40,
    // speed 116 — regenerado pelo importador (#581; era o provisório do Huntera).
    expect(rotworm?.attack).toEqual({ min: 0, max: 40 });
    expect(rotworm?.speed).toBe(116);
    expect(rotworm?.corpseAppearanceId).toBe(5967);
    expect(rotworm?.corpseTtlMs).toBe(670000);
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

  it('o conteúdo real não declara rates: o default é o Tibia com rate 1 (#691)', () => {
    const raw = JSON.parse(readFileSync(join(DATA, 'progression', 'baseline.json'), 'utf8')) as Record<string, unknown>;
    expect(raw).not.toHaveProperty('rates');
    expect(loadContent(DATA).progression.rates).toEqual(NEUTRAL_RATES);
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
    // apontada (`damagePerLevel` 0,02 de `fist`/`club`/`sword`/`axe`/`distance`, a partir do
    // nível 10 — as quatro corpo a corpo eram uma skill só, `melee`, até o #567).
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
    // manaPerHit reconciliado contra o Canary `items.xml` pelo importador de itens (#573): as
    // duas wands iniciais tinham `manaPerHit` TROCADO (vortex 2/snakebite 1) — o real é vortex 1
    // (id 3074, `mana` 1) e snakebite 2 (id 3066, `mana` 2), ver `overrides/{wand-of-vortex,
    // snakebite-rod}.json` e `docs/product/items.md`.
    expect(weapon('wand-of-vortex')).toEqual({
      kind: 'wand', family: 'wand', range: 3, manaPerHit: 1, damageType: 'energy',
      fixedDamage: { min: 8, max: 18 },
    });
    expect(weapon('snakebite-rod')).toEqual({
      kind: 'wand', family: 'rod', range: 3, manaPerHit: 2, damageType: 'earth',
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
      'springsprout-rod': { missile: 39 },
      'underworld-rod': { missile: 32 },
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
    // que `electrify` tem projétil, porque é uma magia à distância do catálogo (#596).
    // Mutação que mata: trocar `"missile": 5` por `"missile": 6` em `baseline.json`.
    const content = loadContent(DATA);
    expect(content.appearances?.spells['electrify']).toEqual({ effect: 12, missile: 5 });
    expect(content.appearances?.supplies['health-potion']).toEqual({ effect: 14 });
    expect(content.appearances?.hits.melee).toBe(1);
    // Toda magia e todo supply do repositório TÊM efeito. Não é regra do carregador — magia
    // muda é válida —, é o estado do conteúdo hoje, e a asserção existe para a magia nova
    // que nascer sem efeito ser uma decisão, e não um esquecimento.
    //
    // As 14 magias de conjuração do #594 (ADR 0044) ainda não têm entrada: a auditoria visual
    // (CMB-09, `docs/combat-presentation-audit.md`) já está bloqueada pela biblioteca parcial
    // (nenhum sprite de efeito/projétil tem PNG nesta máquina) e não foi feita para elas — magia
    // MUDA é válida, e ficam de fora desta asserção até a auditoria acontecer.
    const MUTE_UNTIL_PRESENTATION_AUDIT = new Set([
      'conjure-avalanche-rune', 'conjure-explosion-rune-druid', 'conjure-explosion-rune-sorcerer',
      'conjure-great-fireball-rune', 'conjure-heavy-magic-missile-rune-druid',
      'conjure-heavy-magic-missile-rune-sorcerer', 'conjure-stone-shower-rune',
      'conjure-sudden-death-rune', 'conjure-thunderstorm-rune', 'conjure-intense-healing-rune',
      'conjure-ultimate-healing-rune', 'conjure-arrow', 'conjure-sniper-arrow', 'conjure-power-bolt',
    ]);
    for (const id of content.spells.keys()) {
      if (MUTE_UNTIL_PRESENTATION_AUDIT.has(id)) continue;
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
      price: 64,
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
      // #597 — as 5 runas que faltavam para as 12 do Canary (`staging/runes/generated/general.json`).
      'fireball-rune': {
        damageType: 'fire', skillMin: 1.81, skillMax: 3, baseMin: 10, baseMax: 18, missile: 4,
      },
      'icicle-rune': {
        damageType: 'ice', skillMin: 1.81, skillMax: 3, baseMin: 10, baseMax: 18, missile: 29,
      },
      'light-magic-missile-rune': {
        damageType: 'energy', skillMin: 0.4, skillMax: 0.81, baseMin: 2, baseMax: 4, missile: 5,
      },
      'light-stone-shower-rune': {
        damageType: 'earth', shape: 'cross', skillMin: 0.3, skillMax: 0.45, baseMin: 2, baseMax: 3, missile: 30,
      },
      'stalagmite-rune': {
        damageType: 'earth', skillMin: 0.4, skillMax: 1.59, baseMin: 2, baseMax: 10, missile: 30,
      },
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

  it('a comida é o único consumable, EMPILHÁVEL — a carga de bênção saiu no #570 (ADR 0026 d.3, emenda)', () => {
    const content = loadContent(DATA);
    const consumables = [...content.items.values()].filter((item) => item.kind === 'consumable');
    // `blessing-charge` foi REMOVIDO pelo #570: bênção é serviço de Cidade (ADR 0052), nunca
    // item de mochila. Sobra só a comida (#726, ADR 0049 d.5) — cheese, ham, meat, dragon-ham,
    // green-mushroom —, todas EMPILHÁVEIS.
    expect(consumables.map((item) => item.id).sort()).toEqual(
      ['cheese', 'dragon-ham', 'green-mushroom', 'ham', 'meat'].sort(),
    );
    expect(content.items.has('blessing-charge')).toBe(false);
    const cheese = content.items.get('cheese');
    expect(cheese?.stackable).toBe(true);
    expect(cheese?.effect).toEqual({ kind: 'food', durationMs: 108_000 });
  });

  it('content.supplies é o catálogo ABSTRATO, com price e group de cooldown (ADR 0026 d.3)', () => {
    const content = loadContent(DATA);
    expect(content.supplies.get('health-potion')).toMatchObject({
      id: 'health-potion', name: 'Poção de Vida', price: 50, group: 'potion',
      effect: { kind: 'heal', amountRange: { min: 125, max: 175 } }, requires: {},
    });
    expect(content.supplies.get('avalanche-rune')?.group).toBe('attack');
    expect(content.supplies.get('mana-potion')?.effect).toMatchObject({
      kind: 'mana', amountRange: { min: 75, max: 125 },
    });
    // O Canary cura FAIXA, não número fixo (#690): o `amount` de antes não pode sobreviver.
    expect(content.supplies.get('health-potion')?.effect).not.toHaveProperty('amount');
    expect(content.supplies.get('mana-potion')?.effect).not.toHaveProperty('amount');
    // A bênção não é supply: é o único consumível que ainda é item.
    expect(content.supplies.has('blessing-charge')).toBe(false);
  });

  it('carrega a Small Health Potion do Canary, com efeito de aparência (#690)', () => {
    const content = loadContent(DATA);
    expect(content.supplies.get('small-health-potion')).toMatchObject({
      id: 'small-health-potion', price: 20, group: 'potion', groupCooldownMs: 1000,
      actionExhaustMs: 1000, requires: {},
      effect: { kind: 'heal', amountRange: { min: 60, max: 90 } },
    });
    expect(content.appearances?.supplies['small-health-potion']).toEqual({ effect: 14 });
  });

  it('toda poção e toda runa travam a exaustão de ação compartilhada de 1000 ms, exceto a exceção documentada (#690, #576)', () => {
    // `timeBetweenExActions` do Canary: poção e runa dividem o MESMO relógio. A ÚNICA exceção é
    // a Magic Shield Potion (#576): o `func = magicshield` do `potions.lua` só chama
    // `player:addCondition` da mana shield — nenhuma chamada do arquivo aplica a `exhaust` de
    // módulo (`CONDITION_PARAM_TICKS = 500`) a um jogador —, e é o que
    // `supplySchema.actionExhaustMs` já documentava ANTES desta issue chegar aqui.
    const content = loadContent(DATA);
    for (const [id, supply] of content.supplies) {
      if (id === 'magic-shield-potion') {
        expect(supply.actionExhaustMs, id).toBeUndefined();
        continue;
      }
      expect(supply.actionExhaustMs, id).toBe(1000);
    }
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
    // que o pacote 1533 não tem entra na tabela; o resto do repositório fica como está.
    const copy = mkdtempSync(join(tmpdir(), 'draconya-content-'));
    try {
      cpSync(DATA, copy, { recursive: true });
      const table = join(copy, 'appearances', 'baseline.json');
      const text = readFileSync(table, 'utf8');
      expect(text).toMatch(/"rat": 21/);
      writeFileSync(table, text.replace('"rat": 21', '"rat": 999999'));
      expect(() => loadContent(copy))
        .toThrow('appearances.monsters.rat: outfit 999999 não existe no pacote tibia-1533');
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
      for (const arquivo of filesRecursively(join(DATA, pasta))) {
        const texto = readFileSync(arquivo, 'utf8');
        if (/"(appearanceId|outfitId)"\s*:/.test(texto)) ofensores.push(arquivo);
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
      for (const arquivo of filesRecursively(join(DATA, pasta))) {
        const texto = readFileSync(arquivo, 'utf8');
        if (extensoes.test(texto)) ofensores.push(arquivo);
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
    // #589: força o alvo do monstro; não tem `basePower` — o efeito é `challenge`, não dano.
    'challenge': { level: 20, mana: 30, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'challenge' },
    'chivalrous-challenge': { level: 150, mana: 80, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'challenge' },
    'annihilation': { level: 110, mana: 300, group: 'attack', groupMs: 2000, cdMs: 30000, kind: 'damage' },
    'inflict-wound': { level: 40, mana: 30, group: 'attack', groupMs: 2000, cdMs: 30000, kind: 'damage-over-time' },
  },
  paladin: {
    'lesser-ethereal-spear': { level: 1, mana: 6, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 9 },
    'light-healing-paladin': { level: 8, mana: 20, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 40 },
    'haste-paladin': { level: 14, mana: 60, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'haste' },
    'intense-healing-paladin': { level: 20, mana: 70, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 120 },
    'sharpshooter': { level: 60, mana: 450, group: 'support', groupMs: 2000, cdMs: 10000, kind: 'buff', secondary: ['focus', 10000] },
    'ethereal-spear': { level: 23, mana: 25, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 25 },
    'divine-healing': { level: 35, mana: 160, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 250 },
    'divine-missile': { level: 40, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 60 },
    'divine-caldera': { level: 50, mana: 160, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 150 },
    'recovery-paladin': { level: 50, mana: 75, group: 'healing', groupMs: 1000, cdMs: 60000, kind: 'heal-over-time' },
    'swift-foot': { level: 55, mana: 400, group: 'support', groupMs: 2000, cdMs: 10000, kind: 'haste', secondary: ['focus', 10000] },
    'salvation': { level: 60, mana: 210, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 500 },
    'strong-ethereal-spear': { level: 90, mana: 55, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', bp: 70 },
    'holy-flash': { level: 70, mana: 30, group: 'attack', groupMs: 2000, cdMs: 40000, kind: 'damage-over-time' },
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
    'ultimate-flame-strike': { level: 90, mana: 100, group: 'attack', groupMs: 2000, cdMs: 30000, kind: 'damage', secondary: ['ultimatestrikes', 30000], bp: 180 },
    'ignite': { level: 26, mana: 30, group: 'attack', groupMs: 2000, cdMs: 30000, kind: 'damage-over-time' },
    'electrify': { level: 34, mana: 30, group: 'attack', groupMs: 2000, cdMs: 30000, kind: 'damage-over-time' },
    'strong-haste-sorcerer': { level: 20, mana: 100, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'haste' },
    'cancel-magic-shield-sorcerer': { level: 14, mana: 50, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'remove-condition' },
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
    'strong-ice-strike': { level: 80, mana: 60, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', secondary: ['special', 8000], bp: 115 },
    'ultimate-ice-strike': { level: 100, mana: 100, group: 'attack', groupMs: 2000, cdMs: 30000, kind: 'damage', secondary: ['ultimatestrikes', 30000], bp: 180 },
    'ultimate-terra-strike': { level: 90, mana: 100, group: 'attack', groupMs: 2000, cdMs: 30000, kind: 'damage', secondary: ['ultimatestrikes', 30000], bp: 180 },
    'envenom': { level: 50, mana: 30, group: 'attack', groupMs: 2000, cdMs: 40000, kind: 'damage-over-time' },
    'strong-haste-druid': { level: 20, mana: 100, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'haste' },
    'cancel-magic-shield-druid': { level: 14, mana: 50, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'remove-condition' },
  },
};

/** As excluídas por nome (ADR 0026 decisão 5) — em kebab-case, como um id seria. */
const EXCLUDED_SPELLS = [
  'light', 'great-light', 'ultimate-light', 'find-person', 'find-fiend', 'magic-rope', 'levitate',
  'creature-illusion',
  // agora existe (CMB-07 generalizou a `Condition`). `curse` (#596) é diferente: um DOT
  // multi-estágio (17 valores decrescentes, `Condition:addDamage` chamado 17 vezes) — forma que
  // `spellEffectSchema.damage-over-time` não modela (um valor fixo só). Fica fora, reportada na
  // spec da issue; as outras cinco DOTs de tique único da mesma issue (`ignite`/`electrify`/
  // `envenom`/`inflict-wound`/`holy-flash`) e `cancel-magic-shield` saíram desta lista — o #596
  // as trouxe. `challenge`/`chivalrous-challenge` (#589) também saíram — ver
  // `VOCATION_SPELLS.knight`, acima.
  'curse',
  // Invisibility/Cancel Invisibility entraram no #592 (`invisibility-druid`,
  // `invisibility-sorcerer`, `cancel-invisibility`) — a condição `invisible` (CMB-07) e o
  // dispel em área agora existem, e por isso saem desta allowlist.
  // Heal/Protect/Enchant/Train Party entraram no #588 (alvo de party e custo escalado) — saem
  // da lista de excluídas, e a golden table acima não as cobre porque `manaCost` delas é
  // `party-scaled` (objeto, não número): ver o teste dedicado mais abaixo.
  'shield-bash', 'shield-slam', 'elemental-synthesis', 'shared-conservation',
  // 'conjure-arrow' saiu daqui na #594 (ADR 0044): a conjuração de munição do Paladin existe
  // agora (`packages/content/data/spells/conjure-arrow.json`), no modelo de estoque abstrato.
  'arrow-call', 'conjure-explosive-arrow', 'enchant-spear', 'conjure-wand-of-darkness',
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

  it('has exactly the catalogue: 21 + 20 + 37 + 40 vocation spells, plus one generic (Cure Poison)', () => {
    // #523 acrescentou uma magia por vocação que faltava (Fierce Berserk, Strong Ethereal
    // Spear, Ultimate Energy Strike) — Druid já tinha as 24 (Heal Friend só ganhou fórmula).
    // #590 (cura de condição) acrescentou: Cure Bleeding no Knight (+1) e no Druid (+1), Cure
    // Curse no Paladin (+1), Cure Burning e Cure Electrification só no Druid (+2) — e Cure
    // Poison é a magia genérica (sem `vocationId`) que sobrevive ao #596, abaixo. #589
    // acrescentou Challenge e Chivalrous Challenge no Knight (+2, de 16 para 18) — revisita a
    // exclusão antiga (ver `EXCLUDED_SPELLS`, abaixo, que não a lista mais).
    // #596 fechou o catálogo fora da Roda do Destino, em cima do que #589/#590 já tinham
    // deixado: Knight +2 (Annihilation, Inflict Wound) → 20; Paladin −3 (Divine Defiance/
    // Barrage, Ethereal Barrage removidas — sem correspondente no Canary) +1 (Holy Flash) →
    // 17−2=15; Sorcerer +5 (Ultimate Flame Strike, Ignite, Electrify, Strong Haste, Cancel
    // Magic Shield) → 29; Druid −1 (Forked Thorns removida) +5 (Ultimate Ice/Terra Strike,
    // Envenom, Strong Haste, Cancel Magic Shield) → 27+4=31. As três genéricas pré-vocação
    // (`heal`/`strike`/`blast`) saíram — só Cure Poison (#590) continua sem `vocationId`. #592
    // acrescentou: Cancel Invisibility no Paladin (15+1=16), Invisibility no Sorcerer (29+1=30)
    // e no Druid (31+1=32). #588 acrescentou uma magia de PARTY por vocação: Train Party
    // (Knight, 20+1=21), Protect Party (Paladin, 16+1=17), Enchant Party (Sorcerer, 30+1=31),
    // Heal Party (Druid, 32+1=33) — a golden table acima não as cobre (`manaCost` delas é
    // `party-scaled`, não um número); ver o teste dedicado mais abaixo.
    // #594 (conjuração, ADR 0044) acrescentou por cima disso: Paladin +3 (Conjure Arrow/Sniper
    // Arrow/Power Bolt, 17→20), Sorcerer +5 (Great Fireball, Sudden Death, Thunderstorm, a
    // metade Sorcerer de Explosion e de Heavy Magic Missile, 31→36), Druid +6 (Avalanche,
    // Intense/Ultimate Healing, Stone Shower, a metade Druid de Explosion e de Heavy Magic
    // Missile, 33→39); Knight não ganhou conjuração nenhuma nesta issue.
    const byVocation = new Map<string | undefined, number>();
    for (const spell of content.spells.values()) {
      byVocation.set(spell.vocationId, (byVocation.get(spell.vocationId) ?? 0) + 1);
    }
    expect(byVocation.get('knight')).toBe(21);
    expect(byVocation.get('paladin')).toBe(20);
    expect(byVocation.get('sorcerer')).toBe(37);
    expect(byVocation.get('druid')).toBe(40);
    expect(byVocation.get(undefined)).toBe(1);
  });

  it('Cancel Invisibility usa o `AREA_CIRCLE3X3` do Canary — o círculo de RAIO 3, o mesmo do Mass Healing (#559)', () => {
    // O "3X3" do nome da constante é o raio, não o lado: `register_spells.lua:372-380` tem 37 tiles
    // em linhas 3/5/7/7/7/5/3. A #592 a copiou como raio 1 (9 tiles) e um Paladin com o coelho a 3
    // tiles não o revelava.
    const cancel = content.spells.get('cancel-invisibility')?.effect;
    const mass = content.spells.get('mass-healing')?.effect;
    expect(cancel).toMatchObject({
      kind: 'dispel', types: ['invisible'], area: { shape: 'circle', radius: 3, centered: 'caster' },
    });
    expect(mass).toMatchObject({ area: { shape: 'circle', radius: 3 } });
  });

  it('nenhuma das 13 magias novas do #596 cai no default `arcane` de `damageType`', () => {
    // `arcane` continua no enum `DAMAGE_TYPES` — é o default de `weaponSchema` (wand/rod) e de
    // dez magias físicas ANTERIORES a esta issue (`berserk`, `physical-strike`, etc., um
    // `[ABERTO]` já registrado em `docs/product/combat.md`, fora do escopo do #596). O que esta
    // issue garante é que NENHUMA das 13 que ela introduz depende do default por omissão.
    const NEW_IN_596 = [
      'annihilation', 'ultimate-flame-strike', 'ultimate-ice-strike', 'ultimate-terra-strike',
      'ignite', 'electrify', 'envenom', 'inflict-wound', 'holy-flash',
      'strong-haste-sorcerer', 'strong-haste-druid',
      'cancel-magic-shield-sorcerer', 'cancel-magic-shield-druid',
    ];
    for (const id of NEW_IN_596) {
      const spell = content.spells.get(id);
      expect(spell, id).toBeDefined();
      if (spell?.effect.kind === 'damage' || spell?.effect.kind === 'damage-over-time') {
        expect(spell.effect.damageType, id).not.toBe('arcane');
      }
    }
    // As sete sem correspondente no Canary saíram do catálogo — inclusive as duas (`strike`/
    // `blast`) que dependiam do default `arcane` por omissão.
    for (const removed of [
      'strike', 'blast', 'heal', 'divine-defiance', 'divine-barrage', 'ethereal-barrage', 'forked-thorns',
    ]) {
      expect(content.spells.has(removed), removed).toBe(false);
    }
  });

  it('the four party spells carry the Canary numbers (#588)', () => {
    // `data/scripts/spells/party/*.lua`, main, 2026-09-28: level 32, cooldown/groupCooldown
    // 2000 ms, grupo "support", `manaCost` escalado (`party-scaled`) com o `base`/`decay` de
    // cada script — nunca um número fixo, e nunca a comparação direta da golden table acima
    // (que espera `toBe(row.mana)`, um NÚMERO).
    const rows: Record<string, {
      vocationId: string; base: number; decay: number; effect: 'heal-over-time' | 'buff';
      skillDeltas?: Record<string, number>; amount?: number;
    }> = {
      'heal-party': { vocationId: 'druid', base: 120, decay: 0.9, effect: 'heal-over-time', amount: 20 },
      'protect-party': { vocationId: 'paladin', base: 90, decay: 0.9, effect: 'buff', skillDeltas: { shielding: 3 } },
      'enchant-party': { vocationId: 'sorcerer', base: 120, decay: 0.9, effect: 'buff', skillDeltas: { magic: 1 } },
      'train-party': {
        vocationId: 'knight', base: 60, decay: 0.9, effect: 'buff',
        skillDeltas: { axe: 3, club: 3, sword: 3, fist: 3, distance: 3 },
      },
    };
    for (const [id, row] of Object.entries(rows)) {
      const spell = content.spells.get(id);
      expect(spell, id).toBeDefined();
      if (spell === undefined) continue;
      expect(spell.vocationId, id).toBe(row.vocationId);
      expect(spell.minLevel, id).toBe(32);
      expect(spell.group, id).toBe('support');
      expect(spell.groupCooldownMs, id).toBe(2000);
      expect(spell.cooldownMs, id).toBe(2000);
      expect(spell.manaCost, id).toEqual({ kind: 'party-scaled', base: row.base, decay: row.decay });
      expect(spell.effect.kind, id).toBe(row.effect);
      expect((spell.effect as { target?: string }).target, id).toBe('party');
      expect((spell.effect as { range?: number }).range, id).toBe(36);
      expect((spell.effect as { durationMs?: number }).durationMs, id).toBe(120_000);
      if (row.amount !== undefined) expect((spell.effect as { amount?: number }).amount, id).toBe(row.amount);
      if (row.skillDeltas !== undefined) {
        expect((spell.effect as { skillDeltas?: Record<string, number> }).skillDeltas, id).toEqual(row.skillDeltas);
      }
    }
  });

  it('leaves out, by name, what the engine does not express (ADR 0026 decisão 5)', () => {
    for (const excluded of EXCLUDED_SPELLS) expect(content.spells.has(excluded), excluded).toBe(false);
  });

  // Conformidade #523/#596: toda magia/runa de dano ou cura que TEM correspondente real no
  // Canary declara `formula`. As sete que não tinham correspondente saíram do catálogo no #596
  // (as três genéricas pré-vocação `heal`/`strike`/`blast` e as quatro sem fonte no Canary
  // `divine-defiance`/`divine-barrage`/`ethereal-barrage`/`forked-thorns`) — a allowlist fica
  // VAZIA. `annihilation` (#596) escala por SKILL, não por level/magic level, mas ainda declara
  // `formula` (a forma `skillAttackMin/skillAttackMax`) — não precisa de exceção. A lista
  // continua existindo (em vez de apagada) para o próximo caso real ter onde entrar.
  const NOT_FROM_CANARY: readonly string[] = [];

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

  it('a skill da fórmula transcreve o callback do Canary: LEVELMAGIC declara `magic` (#677)', () => {
    // `CALLBACK_PARAM_LEVELMAGICVALUE` em `data/scripts/spells/attack/<nome>.lua` (lido em
    // 2026-09-26). Em Druid/Sorcerer `spellSkill` já é `magic` e o campo não muda número; no
    // Paladin, Divine Caldera e Divine Missile passam a ler o ML em vez da distance.
    const LEVEL_MAGIC = [
      'apprentices-strike-druid', 'chill-out', 'energy-strike-druid', 'eternal-winter',
      'flame-strike-druid', 'ice-strike-druid', 'ice-wave', 'mud-attack', 'physical-strike',
      'strong-ice-strike', 'strong-ice-wave', 'strong-terra-strike', 'terra-strike-druid',
      'terra-wave', 'wrath-of-nature',
      'apprentices-strike-sorcerer', 'buzz', 'death-strike', 'energy-beam', 'energy-strike-sorcerer',
      'energy-wave', 'fire-wave', 'flame-strike-sorcerer', 'great-death-beam', 'great-energy-beam',
      'great-fire-wave', 'hells-core', 'ice-strike-sorcerer', 'lightning', 'rage-of-the-skies',
      'scorch', 'strong-energy-strike', 'strong-flame-strike', 'terra-strike-sorcerer',
      'ultimate-energy-strike',
      'divine-caldera', 'divine-missile',
      // #596: as três Ultimate X Strike de topo (Fire/Ice/Terra), mesma fórmula/`scaling: 'magic'`
      // de `ultimate-energy-strike` (#523).
      'ultimate-flame-strike', 'ultimate-ice-strike', 'ultimate-terra-strike',
    ];
    // `CALLBACK_PARAM_SKILLVALUE`: a skill da vocação (e o ataque da arma), sem `scaling`.
    const SKILL_VALUE = [
      'berserk', 'brutal-strike', 'fierce-berserk', 'front-sweep', 'groundshaker',
      'lesser-front-sweep', 'whirlwind-throw',
      'ethereal-spear', 'lesser-ethereal-spear', 'strong-ethereal-spear',
      // #596: Annihilation também é `CALLBACK_PARAM_SKILLVALUE` (forma `skillAttackMin`/
      // `skillAttackMax`, sem `scaling` — a mesma família de Groundshaker/Berserk/Front Sweep).
      'annihilation',
    ];
    expect(LEVEL_MAGIC).toHaveLength(40);
    const declared: string[] = [];
    const undeclared: string[] = [];
    for (const spell of content.spells.values()) {
      if (spell.effect.kind !== 'damage' || spell.effect.formula === undefined) continue;
      (spell.effect.formula.scaling === 'magic' ? declared : undeclared).push(spell.id);
    }
    expect(declared.sort()).toEqual([...LEVEL_MAGIC].sort());
    expect(undeclared.sort()).toEqual([...SKILL_VALUE].sort());
  });

  it('as sete magias sem correspondente no Canary saíram do catálogo (#596)', () => {
    // As três genéricas pré-vocação (nunca tiveram vocationId nem BP do TibiaWiki) e as quatro
    // sem fonte no Canary (a varredura do #523 não achou, e a decisão de 2026-09-25 na issue
    // #596 mandou remover) não existem mais.
    for (const id of [
      'heal', 'strike', 'blast', 'divine-defiance', 'divine-barrage', 'ethereal-barrage', 'forked-thorns',
    ]) {
      expect(content.spells.has(id), id).toBe(false);
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
    // #567: `melee` virou quatro skills (fist/club/sword/axe), e o Knight não tem mais uma
    // fixa — `SPELL_SKILL_WEAPON` ("weapon") é a sentinela que o `sim` resolve pela arma na mão.
    expect(content.vocations.get('knight')?.spellSkill).toBe('weapon');
    expect(content.vocations.get('paladin')?.spellSkill).toBe('distance');
    expect(content.vocations.get('sorcerer')?.spellSkill).toBe('magic');
    expect(content.vocations.get('druid')?.spellSkill).toBe('magic');
  });

  it('a skill corpo a corpo virou quatro, uma por tipo de arma (#567)', () => {
    // Base 50 e startingLevel 10 são a `skillBase` do Canary para os quatro tipos (fist/club/
    // sword/axe); só o fallback SEM vocação difere — fist é 1.5, os outros três são 2.0 (o
    // `<skill id multiplier>` da vocação `None` do Canary `vocations.xml`).
    for (const id of ['fist', 'club', 'sword', 'axe']) {
      const skill = content.skills.get(id);
      expect(skill?.startingLevel, id).toBe(10);
      expect(skill?.curve.base, id).toBe(50);
      expect(skill?.gain).toEqual({ on: 'melee-hit', points: 1 });
    }
    expect(content.skills.get('fist')?.curve.factor).toBe(1.5);
    expect(content.skills.get('club')?.curve.factor).toBe(2.0);
    expect(content.skills.get('sword')?.curve.factor).toBe(2.0);
    expect(content.skills.get('axe')?.curve.factor).toBe(2.0);
    expect(content.skills.has('melee')).toBe(false);
    // Cada família de arma treina a SUA skill, não mais uma `melee` compartilhada.
    expect(content.weaponFamilies.get('fist')?.skillId).toBe('fist');
    expect(content.weaponFamilies.get('sword')?.skillId).toBe('sword');
    expect(content.weaponFamilies.get('axe')?.skillId).toBe('axe');
    expect(content.weaponFamilies.get('club')?.skillId).toBe('club');
    // O multiplicador por vocação (Canary `vocations.xml`, verificado em `main` 2026-09-26):
    // Knight uniforme (1.1); Sorcerer/Druid/None distinguem fist (1.5) do resto (2.0/1.8);
    // Paladin uniforme (1.2).
    expect(content.vocations.get('knight')?.skillMultipliers).toMatchObject({
      fist: 1.1, club: 1.1, sword: 1.1, axe: 1.1,
    });
    expect(content.vocations.get('sorcerer')?.skillMultipliers).toMatchObject({
      fist: 1.5, club: 2.0, sword: 2.0, axe: 2.0,
    });
    expect(content.vocations.get('druid')?.skillMultipliers).toMatchObject({
      fist: 1.5, club: 1.8, sword: 1.8, axe: 1.8,
    });
    expect(content.vocations.get('paladin')?.skillMultipliers).toMatchObject({
      fist: 1.2, club: 1.2, sword: 1.2, axe: 1.2,
    });
    expect(content.progression.skillMultipliers).toMatchObject({
      fist: 1.5, club: 2.0, sword: 2.0, axe: 2.0,
    });
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

  it('items/generated/<fatia>.json com o bloco "source" por entidade (ADR 0038 decisão 2) carrega — schema estrito não recusa a proveniência', () => {
    // A mesma forma que `scripts/catalog/generated-writer.ts` (`CatalogEntity`) escreve de
    // verdade: `source: { engine, commit, path }` embutido em CADA entidade. `itemSchema` é
    // `z.strictObject` — sem um campo `source` explícito, isto derrubaria o boot na primeira
    // entidade que #573 gerar.
    withCopy(
      (dir) => {
        mkdirSync(join(dir, 'items', 'generated'), { recursive: true });
        writeFileSync(join(dir, 'items', 'generated', 'imported.json'), JSON.stringify([
          {
            id: 'imported-a', name: 'Imported A', kind: 'other', weight: 1, value: 1,
            source: { engine: 'canary', commit: 'a'.repeat(40), path: 'items.xml' },
          },
        ]));
        givePlaceholderAppearance(dir, 'imported-a');
      },
      (dir) => {
        const content = loadContent(dir);
        expect(content.items.get('imported-a')?.name).toBe('Imported A');
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

// #679: a área de onda e feixe é a contagem por fileira da `AREA_*` do Canary, com a fileira do
// `3` — que o motor ancora um passo à frente (`spells.cpp:337`) e atinge (`combat.cpp:2309`).
// Falha antes da correção: `energy-beam` era `beam 4`, `fire-wave` era `wave 3`.
describe('wave and beam areas transcribed from the Canary AREA_* (#679)', () => {
  const content = loadContent(DATA);

  it('each spell has the area of its AREA_*, counting the row of the 3', () => {
    const expected: Record<string, unknown> = {
      'energy-beam': { shape: 'beam', length: 5 },
      'great-energy-beam': { shape: 'beam', length: 8 },
      'great-death-beam': { shape: 'beam', length: 6 },
      'fire-wave': { shape: 'rows', widths: [1, 3, 3, 5] },
      'ice-wave': { shape: 'rows', widths: [1, 3, 3, 5] },
      'chill-out': { shape: 'rows', widths: [1, 3, 3, 5] },
      scorch: { shape: 'rows', widths: [1, 3, 3, 5] },
      'great-fire-wave': { shape: 'rows', widths: [1, 3, 3, 5, 5] },
      'strong-ice-wave': { shape: 'rows', widths: [1, 3, 3] },
      'terra-wave': { shape: 'rows', widths: [1, 1, 3, 3, 3] },
      'energy-wave': { shape: 'rows', widths: [1, 1, 3, 3, 3] },
    };
    for (const [id, area] of Object.entries(expected)) {
      const effect = content.spells.get(id)?.effect;
      expect(effect?.kind, id).toBe('damage');
      if (effect?.kind === 'damage') expect(effect.area, id).toEqual(area);
    }
  });

  it('as duas runas de invocação do Canary e o Skeleton que a Animate Dead ergue (#600)', () => {
    // `convince_creature.lua`: level 16, ML 5, cooldown 2 s + grupo 2 s, sem `rune:vocation`;
    // `animate_dead_rune.lua`: level 27, ML 4, idem — e o preço é o menor `buy` dos NPCs (80 e 375).
    for (const [id, price, requires] of [
      ['convince-creature-rune', 80, { level: 16, magicLevel: 5 }],
      ['animate-dead-rune', 375, { level: 27, magicLevel: 4 }],
    ] as const) {
      const rune = content.supplies.get(id);
      expect(rune, id).toMatchObject({ price, group: 'support', cooldownMs: 2_000, groupCooldownMs: 2_000, requires });
      expect(rune?.requires.vocationId, id).toBeUndefined();
    }
    expect(content.supplies.get('convince-creature-rune')?.effect).toEqual({ kind: 'convince', range: 8 });
    expect(content.supplies.get('animate-dead-rune')?.effect)
      .toEqual({ kind: 'animate-dead', monsterId: 'skeleton', range: 8 });
    // `skeleton.lua`: `manaCost = 300`, `convinceable`; o cadáver (5972, 10 s `unmove`) só vira
    // movível no primeiro decaimento (4024) e a cadeia inteira dura 670 s.
    expect(content.monsters.get('skeleton')).toMatchObject({
      convinceable: true, manaCost: 300, corpseTtlMs: 670_000,
      corpseAnimatable: [{ fromMs: 10_000, untilMs: 670_000 }],
    });
    // O Dragon não é convencível, e o cadáver dele também só é animável depois do estágio `unmove`.
    expect(content.monsters.get('dragon')?.convinceable).toBe(false);
    expect(content.monsters.get('dragon')?.corpseAnimatable).toEqual([{ fromMs: 10_000, untilMs: 670_000 }]);
    // Rat e Rotworm (as hunts reais) são convencíveis no Canary, com a mana do `rat.lua`/`rotworm.lua`.
    expect(content.monsters.get('rat')).toMatchObject({ convinceable: true, manaCost: 200 });
    expect(content.monsters.get('rotworm')).toMatchObject({ convinceable: true, manaCost: 305 });
    // 128 convencíveis no recorte gerado (139 no Canary inteiro, menos os que o pacote não desenha).
    const convincible = [...content.monsters.values()].filter((monster) => monster.convinceable);
    expect(convincible.length).toBeGreaterThan(100);
    expect(convincible.every((monster) => monster.summonable === false)).toBe(true);
  });

  it('os cinco monstros preservados à mão carregam os campos do #600 do importador, por override (#600)', () => {
    // `preserveHandAuthored` nunca reescreve rat/rotworm/dragon/dragon-lord/dragon-lord-hatchling; o que o
    // importador gera de novo para eles entra por `data/monsters/overrides/`. Este teste prende cada
    // override contra o `staging/` (a transcrição pura do Canary) — se o importador mudar, os dois
    // divergem aqui em vez de em silêncio.
    const staging = join(DATA, '..', 'staging', 'monsters', 'generated');
    const staged = new Map<string, Record<string, unknown>>();
    for (const file of readdirSync(staging)) {
      for (const entity of JSON.parse(readFileSync(join(staging, file), 'utf8')) as Record<string, unknown>[]) {
        staged.set(String(entity['id']), entity);
      }
    }
    for (const id of ['rat', 'rotworm', 'dragon', 'dragon-lord', 'dragon-lord-hatchling']) {
      const monster = content.monsters.get(id);
      const source = staged.get(id);
      expect(monster?.corpseAnimatable, id).toEqual(source?.['corpseAnimatable']);
      expect(monster?.convinceable, id).toBe(source?.['convinceable'] === true);
      expect(monster?.manaCost, id).toBe(source?.['manaCost'] as number | undefined);
    }
  });

  it('dragon and dragon lord corpses last 670000 ms, the Canary items.xml decay chain (#585)', () => {
    for (const id of ['dragon', 'dragon-lord']) {
      expect(content.monsters.get(id)?.corpseTtlMs, id).toBe(670000);
    }
  });

  it('the dragon lord firefield follows the Canary decayTo chain (#560, items.xml:4212-4246)', () => {
    for (const id of ['dragon-lord', 'dragon-lord-hatchling']) {
      const field = content.monsters.get(id)?.abilities.find((a) => a.id === 'firefield')?.field;
      expect(field?.stages, id).toHaveLength(3);
      const stages = field?.stages ?? [];
      // 2118 (dano 20, 200s) → decayTo 2119 (10, 148s) → 2120 (sem field, 98s) → some.
      expect(stages[0]?.durationMs, id).toBe(200_000);
      expect(stages[0]?.condition?.effect.kind, id).toBe('damage-over-time');
      if (stages[0]?.condition?.effect.kind === 'damage-over-time' && stages[0].condition.effect.form === 'rounds') {
        expect(stages[0].condition.effect.rounds[0]?.damage, id).toBe(20);
      }
      expect(stages[1]?.durationMs, id).toBe(148_000);
      expect(stages[1]?.condition?.effect.kind, id).toBe('damage-over-time');
      if (stages[1]?.condition?.effect.kind === 'damage-over-time' && stages[1].condition.effect.form === 'rounds') {
        expect(stages[1].condition.effect.rounds[0]?.damage, id).toBe(10);
      }
      // O último estágio não causa dano — só ocupa o tile até sumir.
      expect(stages[2]?.durationMs, id).toBe(98_000);
      expect(stages[2]?.condition, id).toBeUndefined();
    }
  });

  it('the dragon and dragon lord firewave is the Canary setupArea(8, 3): 26 tiles', () => {
    for (const id of ['dragon', 'dragon-lord']) {
      const ability = content.monsters.get(id)?.abilities.find((a) => a.id === 'firewave');
      expect(ability?.target.area, id).toEqual({ shape: 'rows', widths: [1, 1, 3, 3, 3, 5, 5, 5] });
    }
  });

  it('no spell, supply or monster ability of the catalogue uses the `wave` approximation', () => {
    const catalogue = [
      ...content.spells.values(), ...content.supplies.values(), ...content.monsters.values(),
    ];
    expect(catalogue.length).toBeGreaterThan(0);
    for (const entry of catalogue) {
      expect(JSON.stringify(entry), entry.id).not.toMatch(/"shape":"wave"/);
    }
  });
});

describe('a perda de item na morte do conteúdo real (#571, ADR 0042 decisão 4)', () => {
  it('carrega a tabela do Canary DESLIGADA — a decisão do dono (destruir vs. nunca perder) segue em aberto', () => {
    // `Blessings.LossPercent[n].item` (`blessing.lua:36-46`): 100/70/45/25/10/0… por contagem de
    // bênçãos. `enabled: false` é a regra provisória "nunca perde item" (`docs/product/death.md`
    // §3.8) — ligar é trocar UM booleano, e este teste é o que avisa quem o trocar de que a morte
    // passou a DESTRUIR itens de verdade.
    const { progression } = loadContent(DATA);
    const loss = progression?.deathPenalty.itemLoss;
    expect(loss).toEqual({
      enabled: false,
      lossPercentByBlessings: [100, 70, 45, 25, 10, 0, 0, 0],
      nonContainerDivisor: 10,
      replacementContainerId: 'bag',
    });
  });

  it('a bag de reposição é o `ITEM_BAG` do Canary (8 lugares, nas costas) e tem aparência', () => {
    const { items } = loadContent(DATA);
    const bag = items.get('bag');
    expect(bag).toMatchObject({ kind: 'container', slot: 'back', initialSlots: 8, weight: 8 });
    // 2853 é o clientid da bag no pacote (`items.xml` id 2853) — a tabela de aparências resolve.
    expect(bag?.appearanceId).toBe(2853);
  });

  it('o Amulet of Loss importado ganha `protectsOnDeath` por override — o importador só transcreve o XML', () => {
    const { items } = loadContent(DATA);
    expect(items.get('amulet-of-loss')).toMatchObject({
      slot: 'neck', charges: 1, protectsOnDeath: true, appearanceId: 3057,
    });
    // E é o ÚNICO colar que protege: qualquer outro com a flag seria uma proteção não declarada.
    const protectors = [...items.values()].filter((item) => item.protectsOnDeath).map((item) => item.id);
    expect(protectors).toEqual(['amulet-of-loss']);
  });
});

describe('alma da vocação promovida (#566 + #593)', () => {
  it('as quatro vocações promovidas carregam o teto e a cadência de alma do Canary (200 / 15 s)', () => {
    const content = loadContent(DATA);
    for (const id of ['knight', 'paladin', 'sorcerer', 'druid']) {
      const vocation = content.vocations.get(id);
      expect(vocation?.soulMax).toBe(100);
      expect(vocation?.promotion?.soulMax).toBe(200);
      expect(vocation?.promotion?.soulGainTicksMs).toBe(15_000);
    }
  });
});

describe('regeneração de item do catálogo em milissegundos do Canary (#804)', () => {
  // `healthticks`/`manaticks` do `items.xml` já são ms (`ItemParse::parseHealthAndMana`,
  // `item_parse.cpp:445`, e a condição de regeneração que acumula o think em ms). O importador
  // multiplicava por 1000, e o Ring of Healing regenerava a cada 100 min em vez de 6 s.
  const content = loadContent(DATA);

  it('Ring of Healing (id 3100 do Canary): +6 de vida e +24 de mana a cada 6 s', () => {
    expect(content.items.get('ring-of-healing')?.bonuses?.regeneration).toEqual({
      healthGain: 6, healthTicksMs: 6_000, manaGain: 24, manaTicksMs: 6_000,
    });
  });

  it('nenhum item regenera em intervalo de um minuto ou mais — o sintoma do × 1000', () => {
    const slow = [...content.items.values()].flatMap((item) => {
      const regeneration = item.bonuses?.regeneration;
      if (regeneration === undefined) return [];
      const ticks = Math.max(regeneration.healthTicksMs, regeneration.manaTicksMs);
      return ticks >= 60_000 ? [`${item.id}: ${String(ticks)} ms`] : [];
    });
    expect(slow).toEqual([]);
  });
});
