import { describe, expect, it } from 'vitest';
import { describeEvent } from './event-text.js';

const names = {
  hunts: new Map([['rat-cellars', 'Rat Cellars']]),
  supplies: new Map([['mana-potion', 'Poção de Mana']]),
  monsters: new Map([['rat', 'Rato']]),
  percentPerMilestone: 1,
};

describe('describeEvent (FUN-110)', () => {
  it('traduz TODOS os tipos que o sim grava — nenhum sai como id cru', () => {
    // A lista está ao vivo desde a FUN-110, e `entered-hunt · rat-cellars/cautious` era a
    // primeira linha que todo jogador via. Mutação que mata: apagar um `case`.
    const lines = [
      ['entered-hunt', 'rat-cellars/cautious', 'Entrou em Rat Cellars · Cauteloso'],
      ['entered-city', 'c1', 'Voltou para a cidade'],
      ['level-up', '4', 'Subiu de level · 4'],
      ['level-down', '9 → 8', 'Perdeu level · 9 → 8'],
      ['xp-penalty', '1200', 'Perdeu 1200 XP'],
      ['skill-up', 'melee/11', 'Corpo a corpo subiu para 11'],
      ['skill-up', 'distance/11', 'Distância subiu para 11'],
      ['bestiary-milestone', 'rat/1', 'Bestiário: Rato · marco 1 (+1 % XP)'],
      ['death', 'c1', 'Morreu'],
      ['stamina-exhausted', 'c1', 'Stamina esgotada'],
      ['backpack-full', 'c1', 'Mochila cheia'],
      ['supply-unaffordable', 'mana-potion', 'Gold acabou para Poção de Mana'],
      ['exit-rule', 'hp-below', 'Saiu por regra · hp-below'],
      ['ring-equipped', 'life-ring', 'Equipou o anel'],
      ['ring-removed', '', 'Tirou o anel'],
      ['difficulty-changed', 'cautious → hero', 'Dificuldade mudou · cautious → hero'],
      ['advance-truncated', '90000', 'Tempo parado descartado'],
      ['ended', 'manual-exit', 'Sessão encerrada · saiu da hunt'],
    ] as const;
    for (const [type, detail, expected] of lines) {
      expect(describeEvent({ atMs: 0, type, detail }, names), type).toBe(expected);
    }
  });

  it('sem catálogo, o id fica no lugar do nome — estável, e não vazio', () => {
    expect(describeEvent({ atMs: 0, type: 'entered-hunt', detail: 'rat-cellars/cautious' }))
      .toBe('Entrou em rat-cellars · Cauteloso');
    expect(describeEvent({ atMs: 0, type: 'supply-unaffordable', detail: 'mana-potion' }))
      .toBe('Gold acabou para mana-potion');
  });

  it('o marco do Bestiário sem catálogo diz o id e o marco, e NÃO inventa o bônus (FUN-113)', () => {
    // "+1 %" de cabeça seria afirmar um número que o servidor não mandou — a mesma regra do
    // "—" nos agregados opcionais. Com o percentual do catálogo, ele entra por extenso.
    expect(describeEvent({ atMs: 0, type: 'bestiary-milestone', detail: 'rat/3' }))
      .toBe('Bestiário: rat · marco 3');
    expect(describeEvent(
      { atMs: 0, type: 'bestiary-milestone', detail: 'rat/3' },
      { percentPerMilestone: 0.5 },
    )).toBe('Bestiário: rat · marco 3 (+0,5 % XP)');
  });

  it('tipo que este cliente não conhece sai como veio: pior que frase feia é sumir com o evento', () => {
    expect(describeEvent({ atMs: 0, type: 'boss-spawned', detail: 'dragon' })).toBe('boss-spawned · dragon');
    expect(describeEvent({ atMs: 0, type: 'boss-spawned' })).toBe('boss-spawned');
  });
});

describe('a party no extrato (#197)', () => {
  it('reads the level-up of a companion and the bag settlement', () => {
    expect(describeEvent({ atMs: 0, type: 'level-up', detail: '9' })).toBe('Subiu de level · 9');
    expect(describeEvent({ atMs: 0, type: 'level-up', detail: 'ana/9' })).toBe('ana subiu de level · 9');
    expect(describeEvent({ atMs: 0, type: 'party-settlement', detail: '130/3' })).toBe('Bolsa vendida: 130 gold para 3');
  });
});
