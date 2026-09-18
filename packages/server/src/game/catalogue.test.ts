import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContent, placeholderAppearances } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import { buildCatalogue } from './catalogue.js';
import { TEST_HUNT, rawTestContent, testContent } from '../testing/content.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
const content = testContent();

describe('o catálogo do que existe (FUN-79, FUN-89)', () => {
  it('leva as hunts em ordem de level, com as dificuldades que cada uma define', () => {
    const { hunts } = buildCatalogue(content);

    expect(hunts.length).toBeGreaterThan(0);
    expect(hunts[0]).toMatchObject({ id: 'arena', recommendedLevel: 1 });
    expect(hunts[0]?.difficulties.length).toBeGreaterThan(0);
  });

  it('NÃO leva estimativa de XP/h nem de gold/h', () => {
    // §14.3, e a regra já é estrutura no protocolo: não existe campo. Este teste é a outra
    // metade — garantir que ninguém acrescente um por aqui. Um número oficial de XP/h vira a
    // métrica pela qual toda hunt é julgada, e o jogo passa a ter uma escolha, não quatro.
    const { hunts } = buildCatalogue(content);

    for (const hunt of hunts) {
      // `lootDrops` é uma CONTAGEM de drops distintos (FUN-123), não uma taxa: continua sem
      // XP/h nem gold/h.
      expect(Object.keys(hunt).sort())
        .toEqual(['difficulties', 'difficultyDetails', 'id', 'loot', 'lootDrops', 'monsters', 'name', 'outfitIds', 'recommendedLevel']);
    }
  });

  it('leva os outfits dos monstros de cada hunt, únicos e em ordem, para o cliente aquecer (FUN-112)', () => {
    // O rato era um quadrado por seis a dez segundos na primeira entrada: as folhas dele só
    // decodificavam quando ele aparecia. Com os ids no catálogo o cliente as pede na Cidade.
    // Mutação que mata: devolver `[]`, ou não deduplicar (o rato está em toda dificuldade).
    const { hunts } = buildCatalogue(content);
    const arena = hunts.find((hunt) => hunt.id === 'arena');
    const rat = content.monsters.get('rat')?.outfitId;
    expect(rat).toBeGreaterThan(0);
    expect(arena?.outfitIds).toEqual([rat]);
  });

  it('o mesmo monstro em duas dificuldades sai UMA vez, e a lista vem em ordem de id', () => {
    // Um id repetido seria uma folha pedida duas vezes; a ordem é o que faz a mensagem ser a
    // mesma a cada boot. Mutação que mata: `push` num array em vez do `Set`, ou sem o `sort`.
    // O morcego entra ANTES do rato no conteúdo cru (placeholder: outfit 1), mas a hunt o lista
    // depois — a ordem do catálogo tem que ser a do id, não a da composição.
    const { appearances: _placeholder, ...raw } = rawTestContent();
    const rat = raw.monsters[0] as Record<string, unknown>;
    const bat = { ...rat, id: 'bat', name: 'Bat' };
    const twoTiers = {
      ...raw,
      monsters: [bat, rat],
      hunts: [{
        ...TEST_HUNT,
        difficulties: {
          cautious: { monsterCount: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 1000 },
          reckless: {
            monsterCount: 2, respawnDelayMs: 1000,
            composition: [{ monsterId: 'rat', weight: 1 }, { monsterId: 'bat', weight: 1 }],
          },
        },
      }],
    };
    const content = buildContent({ ...twoTiers, appearances: [placeholderAppearances(twoTiers)] });
    const ratId = content.monsters.get('rat')?.outfitId ?? -1;
    const batId = content.monsters.get('bat')?.outfitId ?? -1;
    // Os drops distintos da hunt (FUN-123): o rato de teste solta gold, e mais nada — um.
    expect(buildCatalogue(content).hunts[0]?.lootDrops).toBe(1);
    expect(batId).toBeLessThan(ratId);

    const arena = buildCatalogue(content).hunts.find((hunt) => hunt.id === 'arena');
    expect(arena?.outfitIds).toEqual([batId, ratId]);
  });

  it('leva a munição e como cada arma bate — tipo, alcance, família, duas mãos — e nunca mana nem faixa de dano (#152)', () => {
    // O seletor no slot do escudo precisa da família e do preço por tiro; o tooltip, do
    // alcance. Mana por golpe e faixa de dano são balanceamento (invariante 4) e ficam fora.
    const { appearances: _placeholder, ...raw } = rawTestContent();
    const withWeapons = {
      ...raw,
      items: [
        ...(raw.items ?? []),
        { id: 'bow', name: 'Bow', kind: 'weapon', slot: 'hand', weight: 31, value: 0, twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' } },
        { id: 'wand', name: 'Wand', kind: 'weapon', slot: 'hand', weight: 19, value: 0, weapon: { kind: 'wand', range: 3, manaPerHit: 2, damage: { min: 8, max: 18 } } },
        { id: 'arrow', name: 'Arrow', kind: 'ammo', slot: 'ammo', stackable: true, weight: 0.7, value: 0, attack: 25, price: 0, ammunition: { family: 'arrow' } },
        { id: 'sniper-arrow', name: 'Sniper Arrow', kind: 'ammo', slot: 'ammo', stackable: true, weight: 0.8, value: 0, attack: 28, price: 5, requires: { level: 20 }, ammunition: { family: 'arrow' } },
      ],
    };
    const content = buildContent({ ...withWeapons, appearances: [placeholderAppearances(withWeapons)] });
    const { items, ammunition } = buildCatalogue(content);

    expect(items.find((item) => item.id === 'bow')).toMatchObject({ twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' } });
    const wand = items.find((item) => item.id === 'wand');
    expect(wand?.weapon).toEqual({ kind: 'wand', range: 3 });
    expect(ammunition).toEqual([
      { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 0, appearanceId: 4, requires: {} },
      { id: 'sniper-arrow', name: 'Sniper Arrow', family: 'arrow', attack: 28, price: 5, appearanceId: 5, requires: { level: 20 } },
    ]);
  });

  it('leva as vocações — ganhos por level e arma inicial — e o level da escolha (#154)', () => {
    // O diálogo do level 8 lê daqui: a tela não pode ter o 8 em código. A vocação sem arma
    // (conteúdo de teste) fica de fora — sem arma não há o que escolher.
    const { appearances: _placeholder, ...raw } = rawTestContent();
    const withVocations = {
      ...raw,
      items: [
        ...(raw.items ?? []),
        { id: 'steel-axe', name: 'Steel Axe', kind: 'weapon', slot: 'hand', weight: 41, value: 0, attack: 21, requires: { vocationId: 'knight' } },
      ],
      vocations: [
        { id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25, startingWeaponItemId: 'steel-axe' },
        { id: 'monk', name: 'Monk', healthPerLevel: 10, manaPerLevel: 10, capacityPerLevel: 10 },
      ],
    };
    const content = buildContent({ ...withVocations, appearances: [placeholderAppearances(withVocations)] });
    const { vocations, vocationLevel } = buildCatalogue(content);

    expect(vocations).toEqual([
      { id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25, startingWeaponItemId: 'steel-axe' },
    ]);
    expect(vocationLevel).toBe(8);
  });

  it('leva os monstros — id e nome, em ordem de id — para a tela do Bestiário (FUN-113)', () => {
    // O contador chega por id; a tela de detalhes ganha vida e XP (SV-02, #338).
    // Mutação que mata: devolver `[]`, vazar o monstro inteiro, ou não ordenar.
    const { appearances: _placeholder, ...raw } = rawTestContent();
    const rat = raw.monsters[0] as Record<string, unknown>;
    const bat = { ...rat, id: 'bat', name: 'Bat' };
    // O rato ANTES do morcego no conteúdo cru: a ordem do catálogo tem que ser a do id.
    const twoMonsters = { ...raw, monsters: [rat, bat] };
    const content = buildContent({ ...twoMonsters, appearances: [placeholderAppearances(twoMonsters)] });

    const { monsters } = buildCatalogue(content);

    expect(monsters).toEqual([
      { id: 'bat', name: 'Bat', health: 20, experience: 5 },
      { id: 'rat', name: 'Rat', health: 20, experience: 5 },
    ]);
    expect('class' in (monsters[0] ?? {})).toBe(false);
    expect('class' in (monsters[1] ?? {})).toBe(false);
  });

  it('leva os marcos e o bônus do Bestiário quando o conteúdo os tem, e a chave some quando não (FUN-113)', () => {
    // Os marcos são conteúdo fixado na sessão (invariante 7), e a tela mostra "próximo marco"
    // a partir deles. O conteúdo de teste não tem Bestiário — a chave fica AUSENTE, não
    // `undefined`: o codec apagaria a chave e o tipo passaria a mentir. E só os dois campos
    // atravessam: `id` e `_open` são do carregador.
    expect(buildCatalogue(content)).not.toHaveProperty('bestiary');

    const withBestiary = buildContent({
      ...rawTestContent(),
      bestiary: [{ id: 'baseline', milestones: [3, 5], xpBonusPercentPerMilestone: 20 }],
    });
    expect(buildCatalogue(withBestiary).bestiary)
      .toEqual({ milestones: [3, 5], xpBonusPercentPerMilestone: 20 });
  });

  it('leva o vocabulário do bot, e é ele que a tela oferece', () => {
    // A UI do bot não pode ter lista de opções em código: se as duas divergirem, o jogador
    // configura o que o bot recusa — e descobre pelo extrato que não fecha.
    const { bot } = buildCatalogue(content);

    expect(bot.vocabularyVersion).toBe(content.bot.vocabularyVersion);
    expect(bot.slots).toEqual(content.bot.slots);
  });

  it('a magia leva o que a tela mostra e o que o GATE precisa — e nada mais', () => {
    // Dano, cura, alcance e cooldown são balanceamento, e o cliente não simula (invariante 4).
    // Mandá-los seria dar a ele material para calcular resultado.
    const { bot } = buildCatalogue(content);
    const spell = bot.spells[0];

    expect(spell).toBeDefined();
    expect(Object.keys(spell ?? {}).sort())
      .toEqual(['effect', 'group', 'id', 'manaCost', 'minLevel', 'name', 'vocationId']);
  });

  it('vocação ausente vira `null`, e não some', () => {
    // A tela precisa distinguir "qualquer um lança" de "o servidor não disse", e campo
    // opcional colapsa os dois no mesmo `undefined`.
    const { bot } = buildCatalogue(content);
    const semVocacao = bot.spells.find((spell) => spell.vocationId === null);

    expect(semVocacao).toBeDefined();
    expect('vocationId' in (semVocacao ?? {})).toBe(true);
  });

  it('o supply leva o PREÇO, e é o único número de balanceamento aqui', () => {
    // O jogador configura "beber poção abaixo de 40% de HP" olhando quanto ela custa por hora
    // de hunt. Sem o preço, a decisão que a tela existe para apoiar não pode ser tomada.
    const { bot } = buildCatalogue(content);
    const supply = bot.supplies[0];

    expect(supply).toBeDefined();
    expect(Object.keys(supply ?? {}).sort()).toEqual(['effect', 'id', 'name', 'price', 'requires']);
    expect(supply?.price).toBeGreaterThan(0);
  });

  it('a runa leva os requisitos — level e magic level — e nunca o Base Power (#165)', () => {
    // A tela desabilita a runa abaixo do level, como faz com magia; o BP e a conversão são
    // balanceamento (invariante 4) e ficam fora.
    const { appearances: _placeholder, ...raw } = rawTestContent();
    const withRune = {
      ...raw,
      items: [
        ...(raw.items ?? []),
        {
          id: 'avalanche-rune', name: 'Avalanche Rune', kind: 'consumable',
          stackable: true, weight: 1.2, value: 0, price: 14, group: 'attack',
          restock: { batch: 20, min: 5 }, requires: { level: 30, magicLevel: 4 },
          effect: { kind: 'damage', basePower: 45, range: 4, area: { shape: 'circle', radius: 3 } },
        },
      ],
    };
    const { bot } = buildCatalogue(buildContent({ ...withRune, appearances: [placeholderAppearances(withRune)] }));
    const rune = bot.supplies.find((s) => s.id === 'avalanche-rune');
    expect(rune).toEqual({ id: 'avalanche-rune', name: 'Avalanche Rune', price: 14, effect: 'damage', requires: { level: 30, magicLevel: 4 } });
    expect(JSON.stringify(rune)).not.toContain('basePower');
  });

  it('leva valor de venda, ataque e armadura nas definições de item (#337)', () => {
    // A tela precisa de valor (NPC de venda), ataque (armas) e armadura (equipamentos).
    // São atributos base fixos definidos no conteúdo.
    const { appearances: _placeholder, ...raw } = rawTestContent();
    const withEquipment = {
      ...raw,
      items: [
        ...(raw.items ?? []),
        { id: 'sword', name: 'Sword', kind: 'weapon', slot: 'hand', weight: 35, value: 25, attack: 14, armor: 0, weapon: { kind: 'melee', range: 1 } },
        { id: 'shield', name: 'Wooden Shield', kind: 'shield', slot: 'shield', weight: 40, value: 15, attack: 0, armor: 15 },
        { id: 'cheese', name: 'Cheese', kind: 'other', weight: 4, value: 2, attack: 0, armor: 0 },
      ],
    };
    const content = buildContent({ ...withEquipment, appearances: [placeholderAppearances(withEquipment)] });
    const { items } = buildCatalogue(content);

    expect(items.find((item) => item.id === 'sword')).toMatchObject({
      value: 25,
      attack: 14,
      armor: 0,
    });
    expect(items.find((item) => item.id === 'shield')).toMatchObject({
      value: 15,
      attack: 0,
      armor: 15,
    });
    expect(items.find((item) => item.id === 'cheese')).toMatchObject({
      value: 2,
      attack: 0,
      armor: 0,
    });
  });

  it('o mesmo monstro em duas dificuldades aparece UMA vez na hunt, ordenado por id (SV-02, #338)', () => {
    const { appearances: _placeholder, ...raw } = rawTestContent();
    const rat = raw.monsters[0] as Record<string, unknown>;
    const bat = { ...rat, id: 'bat', name: 'Bat' };
    const twoTiers = {
      ...raw,
      monsters: [bat, rat],
      hunts: [{
        ...TEST_HUNT,
        difficulties: {
          cautious: { monsterCount: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 1000 },
          reckless: {
            monsterCount: 2, respawnDelayMs: 1000,
            composition: [{ monsterId: 'rat', weight: 1 }, { monsterId: 'bat', weight: 1 }],
          },
        },
      }],
    };
    const content = buildContent({ ...twoTiers, appearances: [placeholderAppearances(twoTiers)] });
    const arena = buildCatalogue(content).hunts.find((hunt) => hunt.id === 'arena');
    expect(arena?.monsters).toEqual([
      { id: 'bat', name: 'Bat' },
      { id: 'rat', name: 'Rat' },
    ]);
  });

  it('loot com chance 0 é excluído, e o mesmo item em múltiplos monstros aparece UMA vez, ordenado por itemId (SV-02, #338)', () => {
    const { appearances: _placeholder, ...raw } = rawTestContent();
    const rat = raw.monsters[0] as Record<string, unknown>;
    const withItemsAndMonsters = {
      ...raw,
      items: [
        ...(raw.items ?? []),
        { id: 'bone', name: 'Bone', kind: 'other', weight: 5, value: 1, attack: 0, armor: 0 },
        { id: 'cheese', name: 'Cheese', kind: 'other', weight: 4, value: 2, attack: 0, armor: 0 },
        { id: 'rare-gem', name: 'Rare Gem', kind: 'other', weight: 1, value: 100, attack: 0, armor: 0 },
      ],
      monsters: [
        {
          ...rat,
          id: 'rat',
          name: 'Rat',
          loot: {
            gold: { chance: 1, min: 2, max: 2 },
            items: [
              { itemId: 'cheese', chance: 0.5 },
              { itemId: 'rare-gem', chance: 0 },
            ],
          },
        },
        {
          ...rat,
          id: 'bat',
          name: 'Bat',
          loot: {
            items: [
              { itemId: 'cheese', chance: 0.8 },
              { itemId: 'bone', chance: 0.3 },
            ],
          },
        },
      ],
      hunts: [{
        ...TEST_HUNT,
        difficulties: {
          cautious: { monsterCount: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 1000 },
          reckless: {
            monsterCount: 2, respawnDelayMs: 1000,
            composition: [{ monsterId: 'rat', weight: 1 }, { monsterId: 'bat', weight: 1 }],
          },
        },
      }],
    };
    const content = buildContent({
      ...withItemsAndMonsters,
      appearances: [placeholderAppearances(withItemsAndMonsters)],
    });
    const arena = buildCatalogue(content).hunts.find((hunt) => hunt.id === 'arena');
    expect(arena?.loot).toEqual([
      { itemId: 'bone', name: 'Bone' },
      { itemId: 'cheese', name: 'Cheese' },
    ]);
  });

  it('gold nunca entra em loot[] (SV-02, #338)', () => {
    // Gold não é item, é campo do personagem — quem quer saber se a hunt solta gold tem lootDrops.
    const { appearances: _placeholder, ...raw } = rawTestContent();
    const rat = raw.monsters[0] as Record<string, unknown>;
    const withGoldOnly = {
      ...raw,
      monsters: [
        {
          ...rat,
          id: 'rat',
          name: 'Rat',
          loot: {
            gold: { chance: 1, min: 10, max: 50 },
            items: [],
          },
        },
      ],
      hunts: [{
        ...TEST_HUNT,
        difficulties: {
          cautious: { monsterCount: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 1000 },
        },
      }],
    };
    const content = buildContent({
      ...withGoldOnly,
      appearances: [placeholderAppearances(withGoldOnly)],
    });
    const arena = buildCatalogue(content).hunts.find((hunt) => hunt.id === 'arena');
    expect(arena?.lootDrops).toBe(1);
    expect(arena?.loot).toEqual([]);
  });

  it('catalogue.monsters[] reflete todos os monstros de content.monsters com vida e XP (SV-02, #338)', () => {
    const { appearances: _placeholder, ...raw } = rawTestContent();
    const rat = raw.monsters[0] as Record<string, unknown>;
    const bat = { ...rat, id: 'bat', name: 'Bat', health: 15, experience: 8 };
    const skeleton = { ...rat, id: 'skeleton', name: 'Skeleton', health: 50, experience: 35 };
    const content = buildContent({
      ...raw,
      monsters: [skeleton, rat, bat],
      appearances: [placeholderAppearances({ ...raw, monsters: [skeleton, rat, bat] })],
    });
    const { monsters } = buildCatalogue(content);
    expect(monsters).toHaveLength(3);
    expect(monsters).toEqual([
      { id: 'bat', name: 'Bat', health: 15, experience: 8 },
      { id: 'rat', name: 'Rat', health: 20, experience: 5 },
      { id: 'skeleton', name: 'Skeleton', health: 50, experience: 35 },
    ]);
  });

  it('leva a contagem de monstros por dificuldade na mesma ordem de difficulties (SV-19, #355)', () => {
    const { hunts } = buildCatalogue(content);
    const arena = hunts.find((hunt) => hunt.id === 'arena');
    expect(arena?.difficultyDetails).toEqual([
      { id: 'cautious', monsterCount: 1 },
    ]);
  });

  it('leva class quando o conteúdo a define (como o rat do conteúdo real com mammal) e omite a chave quando ausente (SV-20, #356)', () => {
    const realContent = loadContent(DATA);
    const { monsters } = buildCatalogue(realContent);
    const rat = monsters.find((m) => m.id === 'rat');
    expect(rat).toEqual({
      id: 'rat',
      name: 'Rat',
      class: 'mammal',
      health: 20,
      experience: 5,
    });
    expect('class' in (rat ?? {})).toBe(true);

    // Monstro sem class na fixture não tem a chave 'class'
    const withoutClass = buildCatalogue(content).monsters[0];
    expect(withoutClass).toBeDefined();
    expect('class' in (withoutClass ?? {})).toBe(false);
  });

  it('leva description quando a hunt a define (como a rat-cellars do conteúdo real) e omite a chave quando ausente (SV-21, #357)', () => {
    const realContent = loadContent(DATA);
    const { hunts } = buildCatalogue(realContent);
    const cellars = hunts.find((h) => h.id === 'rat-cellars');
    expect(cellars?.description).toBe(
      'Os porões de pedra sob Rookgaard, a ilha que recebe todo aventureiro no primeiro dia. Ratos disputam caixotes e barris pelos corredores baixos — o primeiro perigo que toda espada aprende a enfrentar.',
    );
    expect('description' in (cellars ?? {})).toBe(true);

    // Hunt sem description na fixture de teste omite a chave
    const huntWithoutDescription = buildCatalogue(content).hunts[0];
    expect(huntWithoutDescription).toBeDefined();
    expect('description' in (huntWithoutDescription ?? {})).toBe(false);
  });

  it('buildCatalogue includes progression matching content.progression (SV-25, #361)', () => {
    const { progression } = buildCatalogue(content);
    expect(progression).toEqual({
      startingSpeed: content.progression.startingSpeed,
      speedPerLevel: content.progression.speedPerLevel,
      regen: {
        healthPerSecond: content.progression.regen.healthPerSecond,
        manaPerSecond: content.progression.regen.manaPerSecond,
      },
    });

    const realContent = loadContent(DATA);
    const realCatalogue = buildCatalogue(realContent);
    expect(realCatalogue.progression).toEqual({
      startingSpeed: realContent.progression.startingSpeed,
      speedPerLevel: realContent.progression.speedPerLevel,
      regen: {
        healthPerSecond: realContent.progression.regen.healthPerSecond,
        manaPerSecond: realContent.progression.regen.manaPerSecond,
      },
    });
  });
});



