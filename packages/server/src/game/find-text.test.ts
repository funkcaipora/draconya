import { describe, expect, it } from 'vitest';
import type { CompassDirection, FindRelation } from '@draconya/sim';
import { findPersonText, findPhrase } from './find-text.js';

describe('a frase do Find (#623) — a estrutura do find_person.lua, em português', () => {
  it('"ao lado" não leva direção: abaixo, ao lado e acima', () => {
    expect(findPhrase({ distance: 'beside', level: 'lower' })).toBe('está abaixo de você');
    expect(findPhrase({ distance: 'beside', level: 'same' })).toBe('está ao seu lado');
    expect(findPhrase({ distance: 'beside', level: 'higher' })).toBe('está acima de você');
  });

  it('"perto" leva o andar (quando difere) e a direção', () => {
    const relation = (level: FindRelation['level']): FindRelation => ({ distance: 'close', level, direction: 'north' });
    expect(findPhrase(relation('same'))).toBe('está ao norte');
    expect(findPhrase(relation('lower'))).toBe('está em um andar inferior, ao norte');
    expect(findPhrase(relation('higher'))).toBe('está em um andar superior, ao norte');
  });

  it('"longe" e "muito longe" só a direção — o Canary não diz o andar dali em diante', () => {
    expect(findPhrase({ distance: 'far', level: 'lower', direction: 'south-west' }))
      .toBe('está longe, a sudoeste');
    expect(findPhrase({ distance: 'very-far', level: 'higher', direction: 'east' }))
      .toBe('está muito longe, a leste');
  });

  it('as oito direções com a preposição que o português pede', () => {
    const expected: Record<CompassDirection, string> = {
      north: 'ao norte', south: 'ao sul', east: 'a leste', west: 'a oeste',
      'north-east': 'a nordeste', 'north-west': 'a noroeste', 'south-east': 'a sudeste',
      'south-west': 'a sudoeste',
    };
    for (const [direction, phrase] of Object.entries(expected)) {
      expect(findPhrase({ distance: 'close', level: 'same', direction: direction as CompassDirection }), direction)
        .toBe(`está ${phrase}`);
    }
  });

  it('a frase completa leva o nome e o ponto final', () => {
    expect(findPersonText('Draconya', { distance: 'far', level: 'same', direction: 'west' }))
      .toBe('Draconya está longe, a oeste.');
  });
});
