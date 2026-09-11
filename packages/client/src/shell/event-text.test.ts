import { describe, expect, it } from 'vitest';
import { describeEvent } from './event-text.js';

const names = {
  hunts: new Map([['rat-cellars', 'Rat Cellars']]),
  supplies: new Map([['mana-potion', 'Poção de Mana']]),
};

describe('describeEvent (FUN-110)', () => {
  it('traduz TODOS os tipos que o sim grava — nenhum sai como id cru', () => {
    // A lista está ao vivo desde a FUN-110, e `entered-hunt · rat-cellars/beginner` era a
    // primeira linha que todo jogador via. Mutação que mata: apagar um `case`.
    const lines = [
      ['entered-hunt', 'rat-cellars/beginner', 'Entrou em Rat Cellars · Iniciante'],
      ['entered-city', 'c1', 'Voltou para a cidade'],
      ['level-up', '4', 'Subiu de level · 4'],
      ['level-down', '9 → 8', 'Perdeu level · 9 → 8'],
      ['xp-penalty', '1200', 'Perdeu 1200 XP'],
      ['skill-up', 'melee/11', 'Corpo a corpo subiu para 11'],
      ['death', 'c1', 'Morreu'],
      ['stamina-exhausted', 'c1', 'Stamina esgotada'],
      ['backpack-full', 'c1', 'Mochila cheia'],
      ['supply-unaffordable', 'mana-potion', 'Gold acabou para Poção de Mana'],
      ['exit-rule', 'hp-below', 'Saiu por regra · hp-below'],
      ['ring-equipped', 'life-ring', 'Equipou o anel'],
      ['ring-removed', '', 'Tirou o anel'],
      ['difficulty-changed', 'beginner → hero', 'Dificuldade mudou · beginner → hero'],
      ['advance-truncated', '90000', 'Tempo parado descartado'],
      ['ended', 'manual-exit', 'Sessão encerrada · saiu da hunt'],
    ] as const;
    for (const [type, detail, expected] of lines) {
      expect(describeEvent({ atMs: 0, type, detail }, names), type).toBe(expected);
    }
  });

  it('sem catálogo, o id fica no lugar do nome — estável, e não vazio', () => {
    expect(describeEvent({ atMs: 0, type: 'entered-hunt', detail: 'rat-cellars/beginner' }))
      .toBe('Entrou em rat-cellars · Iniciante');
    expect(describeEvent({ atMs: 0, type: 'supply-unaffordable', detail: 'mana-potion' }))
      .toBe('Gold acabou para mana-potion');
  });

  it('tipo que este cliente não conhece sai como veio: pior que frase feia é sumir com o evento', () => {
    expect(describeEvent({ atMs: 0, type: 'boss-spawned', detail: 'dragon' })).toBe('boss-spawned · dragon');
    expect(describeEvent({ atMs: 0, type: 'boss-spawned' })).toBe('boss-spawned');
  });
});
