import {
  cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from './load.js';
import { floorChangeAt, isBlocked } from './map.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

describe('loadContent', () => {
  it('carrega o conteúdo real do repositório', () => {
    const content = loadContent(DATA);
    expect(content.monsters.size).toBeGreaterThan(0);
    expect(content.hunts.size).toBeGreaterThan(0);
    expect(content.vocations.size).toBe(4);
    expect(content.version).toMatch(/^[0-9a-f]{8}$/);
  });

  it('carrega o Bestiário real: cinco marcos crescentes e +1 % por marco (FUN-113, §18)', () => {
    // Opcional no `buildContent` (fixture), obrigatório no conteúdo de verdade: sem ele o
    // abate conta e nunca vale nada. Mutação que mata: apagar `bestiary/` de `load.ts`.
    const content = loadContent(DATA);
    expect(content.bestiary?.milestones).toEqual([10_000, 25_000, 50_000, 100_000, 200_000]);
    expect(content.bestiary?.xpBonusPercentPerMilestone).toBe(1);
  });

  it('carrega a tabela da party real, e todo item do repositório tem preço de venda (#188)', () => {
    // A tabela é a do ADR 0027: 25 % por vocação única, teto 100 %. E `value` é obrigatório no
    // schema — este teste prende que o conteúdo REAL passa, e diz quais itens ainda têm o
    // preço em aberto (zero com `_open`), para o próximo item nascer com decisão.
    const content = loadContent(DATA);
    expect(content.party.maxMembers).toBe(4);
    expect(content.party.xpPoolPercentByUniqueVocations).toEqual({ '1': 125, '2': 150, '3': 175, '4': 200 });
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
    expect(hunt?.corpseTtlMs).toBeGreaterThan(0);
    const rat = content.monsters.get('rat');
    expect(rat?.attack).toEqual({ min: 0, max: 8 });
    expect(rat?.speed).toBe(172);
    expect(rat?.corpseAppearanceId).toBe(5964);
    expect(rat?.loot.items.map((i) => i.itemId)).toEqual(['cheese']);
    expect(content.items.get('cheese')?.appearanceId).toBe(3607);
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
    expect(content.appearances?.weapons).toEqual({ 'wand-of-vortex': { missile: 5 }, 'snakebite-rod': { missile: 39 } });
    const distance = content.skills.get('distance');
    expect(distance?.gain).toEqual({ on: 'distance-hit', points: 1 });
    expect(distance?.startingLevel).toBe(10);
  });

  it('carrega a munição como seleção: a arrow é grátis, as outras debitam gold por tiro (ADR 0026, decisão 3)', () => {
    const content = loadContent(DATA);
    // Ícone (objeto) e projétil (missile), conferidos de olho: arrow 3, sniper arrow 22, onyx
    // arrow 23 são os projéteis do pacote 13.32 (#152).
    const ammo = [...content.ammunition.values()]
      .map((a) => [a.id, a.family, a.attack, a.price, a.appearanceId, a.missileId]);
    expect(ammo).toEqual([
      ['arrow', 'arrow', 25, 0, 3447, 3],
      ['onyx-arrow', 'arrow', 38, 7, 7365, 23],
      ['sniper-arrow', 'arrow', 28, 5, 7364, 22],
    ]);
    expect(content.ammunition.get('sniper-arrow')?.requires.level).toBe(20);
    expect(content.ammunition.get('onyx-arrow')?.requires.level).toBe(40);
    // A flecha física saiu do catálogo de itens: munição não tem peso, pilha nem instância.
    expect(content.items.has('arrow')).toBe(false);
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

  it('carrega a Avalanche Rune como supply de ATAQUE, com gate e área (#165)', () => {
    // A runa é supply (debita gold, sem item físico) e não magia: mora em `supplies/`, tem
    // `requires` — o servidor recusa abaixo de level 30 / magic level 4 — e a forma é o
    // círculo de raio 3 no alvo. O gate dela é o primeiro `requires` em supply do repositório.
    // Mutação que mata: apagar `requires` do arquivo — o default `{}` liberaria a runa no level 1.
    const content = loadContent(DATA);
    const rune = content.supplies.get('avalanche-rune');
    expect(rune).toMatchObject({
      price: 14,
      requires: { level: 30, magicLevel: 4 },
      effect: { kind: 'damage', basePower: 45, range: 4, area: { shape: 'circle', radius: 3, centered: 'target' } },
    });
    expect(content.supplies.get('health-potion')?.requires).toEqual({});
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
    'bruise-bane': { level: 1, mana: 10, group: 'healing', groupMs: 2000, cdMs: 1000, kind: 'heal', bp: 15 },
    'lesser-front-sweep': { level: 1, mana: 6, group: 'attack', groupMs: 2000, cdMs: 6000, kind: 'damage', bp: 14 },
    'wound-cleansing': { level: 8, mana: 40, group: 'healing', groupMs: 2000, cdMs: 1000, kind: 'heal', bp: 70 },
    'haste-knight': { level: 14, mana: 60, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'haste' },
    'brutal-strike': { level: 16, mana: 30, group: 'attack', groupMs: 2000, cdMs: 6000, kind: 'damage', bp: 39 },
    'blood-rage': { level: 20, mana: 20, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'buff', secondary: ['stance', 2000] },
    'protector': { level: 20, mana: 20, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'buff', secondary: ['stance', 2000] },
    'charge': { level: 25, mana: 100, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'haste' },
    'whirlwind-throw': { level: 28, mana: 40, group: 'attack', groupMs: 2000, cdMs: 6000, kind: 'damage', bp: 32 },
    'groundshaker': { level: 33, mana: 200, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', bp: 32 },
    'berserk': { level: 35, mana: 125, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 44 },
    'recovery-knight': { level: 50, mana: 75, group: 'healing', groupMs: 1000, cdMs: 60000, kind: 'heal-over-time' },
    'front-sweep': { level: 70, mana: 200, group: 'attack', groupMs: 2000, cdMs: 6000, kind: 'damage', bp: 80 },
    'intense-wound-cleansing': { level: 80, mana: 200, group: 'healing', groupMs: 2000, cdMs: 120000, kind: 'heal', bp: 500 },
  },
  paladin: {
    'lesser-ethereal-spear': { level: 1, mana: 6, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', bp: 9 },
    'light-healing-paladin': { level: 8, mana: 20, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 40 },
    'haste-paladin': { level: 14, mana: 60, group: 'support', groupMs: 2000, cdMs: 2000, kind: 'haste' },
    'intense-healing-paladin': { level: 20, mana: 70, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 120 },
    'divine-defiance': { level: 20, mana: 250, group: 'support', groupMs: 2000, cdMs: 10000, kind: 'buff', secondary: ['stance', 10000] },
    'sharpshooter': { level: 20, mana: 250, group: 'support', groupMs: 2000, cdMs: 10000, kind: 'buff', secondary: ['stance', 10000] },
    'ethereal-spear': { level: 23, mana: 25, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 25 },
    'divine-healing': { level: 35, mana: 160, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 250 },
    'divine-missile': { level: 40, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 60 },
    'divine-caldera': { level: 50, mana: 160, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 150 },
    'recovery-paladin': { level: 50, mana: 75, group: 'healing', groupMs: 1000, cdMs: 60000, kind: 'heal-over-time' },
    'swift-foot': { level: 55, mana: 400, group: 'support', groupMs: 2000, cdMs: 4000, kind: 'haste', secondary: ['focus', 2000] },
    'salvation': { level: 60, mana: 210, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 500 },
    'ethereal-barrage': { level: 60, mana: 135, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 100 },
    'divine-barrage': { level: 70, mana: 175, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 130 },
  },
  sorcerer: {
    'buzz': { level: 1, mana: 6, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 15 },
    'scorch': { level: 1, mana: 8, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 10 },
    'magic-patch-sorcerer': { level: 1, mana: 6, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 10 },
    'apprentices-strike-sorcerer': { level: 6, mana: 6, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 15 },
    'flame-strike-sorcerer': { level: 8, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 45 },
    'ice-strike-sorcerer': { level: 8, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 45 },
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
    'great-death-beam': { level: 66, mana: 140, group: 'attack', groupMs: 2000, cdMs: 6000, kind: 'damage', secondary: ['great-beams', 6000], bp: 155 },
    'strong-flame-strike': { level: 70, mana: 60, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', secondary: ['special', 8000], bp: 125 },
    'strong-energy-strike': { level: 80, mana: 60, group: 'attack', groupMs: 2000, cdMs: 8000, kind: 'damage', secondary: ['special', 8000], bp: 125 },
  },
  druid: {
    'mud-attack': { level: 1, mana: 6, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 15 },
    'chill-out': { level: 1, mana: 8, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 10 },
    'magic-patch-druid': { level: 1, mana: 6, group: 'healing', groupMs: 1000, cdMs: 1000, kind: 'heal', bp: 10 },
    'apprentices-strike-druid': { level: 6, mana: 6, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 15 },
    'flame-strike-druid': { level: 8, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 45 },
    'ice-strike-druid': { level: 8, mana: 20, group: 'attack', groupMs: 2000, cdMs: 2000, kind: 'damage', bp: 45 },
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
    'strong-ice-wave': { level: 40, mana: 170, group: 'attack', groupMs: 2000, cdMs: 4000, kind: 'damage', bp: 150 },
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
  'heal-friend', 'heal-party', 'elemental-synthesis', 'shared-conservation',
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

  it('has exactly the catalogue: 14 + 15 + 23 + 23 vocation spells, plus the three generic ones', () => {
    const byVocation = new Map<string | undefined, number>();
    for (const spell of content.spells.values()) {
      byVocation.set(spell.vocationId, (byVocation.get(spell.vocationId) ?? 0) + 1);
    }
    expect(byVocation.get('knight')).toBe(14);
    expect(byVocation.get('paladin')).toBe(15);
    expect(byVocation.get('sorcerer')).toBe(23);
    expect(byVocation.get('druid')).toBe(23);
    expect(byVocation.get(undefined)).toBe(3);
  });

  it('leaves out, by name, what the engine does not express (ADR 0026 decisão 5)', () => {
    for (const excluded of EXCLUDED_SPELLS) expect(content.spells.has(excluded), excluded).toBe(false);
  });

  it('the Knight scales spells by the weapon skill and the Paladin by distance; the mages by magic', () => {
    expect(content.vocations.get('knight')?.spellSkill).toBe('melee');
    expect(content.vocations.get('paladin')?.spellSkill).toBe('distance');
    expect(content.vocations.get('sorcerer')?.spellSkill).toBe('magic');
    expect(content.vocations.get('druid')?.spellSkill).toBe('magic');
  });
});
