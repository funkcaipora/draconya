import { buildContent, placeholderAppearances } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { buildCatalogue } from './catalogue.js';
import { TEST_HUNT, rawTestContent, testContent } from '../testing/content.js';

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
        .toEqual(['difficulties', 'id', 'lootDrops', 'name', 'outfitIds', 'recommendedLevel']);
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
        { id: 'bow', name: 'Bow', kind: 'weapon', slot: 'hand', weight: 31, twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' } },
        { id: 'wand', name: 'Wand', kind: 'weapon', slot: 'hand', weight: 19, weapon: { kind: 'wand', range: 3, manaPerHit: 2, damage: { min: 8, max: 18 } } },
      ],
      ammunition: [
        { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 0 },
        { id: 'sniper-arrow', name: 'Sniper Arrow', family: 'arrow', attack: 28, price: 5, requires: { level: 20 } },
      ],
    };
    const content = buildContent({ ...withWeapons, appearances: [placeholderAppearances(withWeapons)] });
    const { items, ammunition } = buildCatalogue(content);

    expect(items.find((item) => item.id === 'bow')).toMatchObject({ twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' } });
    const wand = items.find((item) => item.id === 'wand');
    expect(wand?.weapon).toEqual({ kind: 'wand', range: 3 });
    expect(ammunition).toEqual([
      { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 0, appearanceId: 1, requires: {} },
      { id: 'sniper-arrow', name: 'Sniper Arrow', family: 'arrow', attack: 28, price: 5, appearanceId: 2, requires: { level: 20 } },
    ]);
  });

  it('leva os monstros — id e nome, em ordem de id — para a tela do Bestiário (FUN-113)', () => {
    // O contador chega por id; sem esta lista a tela mostraria "rat: 12" em vez de "Rat". Só
    // id e nome: vida, ataque e XP são balanceamento que o cliente não simula (invariante 4).
    // Mutação que mata: devolver `[]`, vazar o monstro inteiro, ou não ordenar.
    const { appearances: _placeholder, ...raw } = rawTestContent();
    const rat = raw.monsters[0] as Record<string, unknown>;
    const bat = { ...rat, id: 'bat', name: 'Bat' };
    // O rato ANTES do morcego no conteúdo cru: a ordem do catálogo tem que ser a do id.
    const twoMonsters = { ...raw, monsters: [rat, bat] };
    const content = buildContent({ ...twoMonsters, appearances: [placeholderAppearances(twoMonsters)] });

    const { monsters } = buildCatalogue(content);

    expect(monsters).toEqual([{ id: 'bat', name: 'Bat' }, { id: 'rat', name: 'Rat' }]);
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
    expect(bot.advancedFromLevel).toBe(content.bot.advancedFromLevel);
    expect(bot.slots).toEqual(content.bot.slots);
    expect(bot.advancedOnly.targetPolicies).toEqual(content.bot.advancedOnly.targetPolicies);
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
    expect(Object.keys(supply ?? {}).sort()).toEqual(['effect', 'id', 'name', 'price']);
    expect(supply?.price).toBeGreaterThan(0);
  });
});
