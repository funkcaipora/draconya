import { describe, expect, it } from 'vitest';
import { buildCatalogue } from './catalogue.js';
import { testContent } from '../testing/content.js';

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
      expect(Object.keys(hunt).sort())
        .toEqual(['difficulties', 'id', 'name', 'outfitIds', 'recommendedLevel']);
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
      .toEqual(['effect', 'id', 'manaCost', 'minLevel', 'name', 'vocationId']);
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
