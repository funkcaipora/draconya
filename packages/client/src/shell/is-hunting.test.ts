import { describe, expect, it } from 'vitest';
import { isHunting, isWorld } from './is-hunting.js';

// "Em hunt" (RF-02, #502): o MESMO cálculo do `Shell` (#259) sobre o `sessionType` do
// analisador — o que o servidor disse por último. Puro, sem DOM.

describe('isHunting (#502)', () => {
  it('is false in the City and without a session', () => {
    expect(isHunting('city')).toBe(false);
    expect(isHunting(null)).toBe(false);
  });

  it('is true for any session that is not the City or the Training (hunt or manual content)', () => {
    expect(isHunting('hunt')).toBe(true);
    expect(isHunting('manual')).toBe(true);
    expect(isHunting('quest')).toBe(true);
  });

  it('is false in the Training (#631): a private session that does not hunt', () => {
    // O Treino não tem analisador, "Sair da caçada" nem party — a casca mostra o estado dele à parte.
    expect(isHunting('training')).toBe(false);
  });
});

describe('o mundo aberto (#846, OW-23)', () => {
  it('is not a hunt: the world is a shared session, with no "Sair da caçada", party loot or exit rules', () => {
    // Mutação que mata: voltar ao `!== 'city'` de antes — o `'world'` viraria caçada e a casca ofereceria
    // "Sair da caçada" (que o servidor recusa no mundo) e a janela de party loot a quem só está andando.
    expect(isHunting('world')).toBe(false);
  });

  it('is told apart from every other session by isWorld', () => {
    expect(isWorld('world')).toBe(true);
    for (const type of ['city', 'hunt', 'training', 'quest', 'manual', null]) {
      expect(isWorld(type)).toBe(false);
    }
  });
});
