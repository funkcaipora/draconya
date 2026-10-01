import { describe, expect, it } from 'vitest';
import { CONTEXT_MENU_VIEWPORT_MARGIN, clampMenuPosition } from './context-menu-position.js';

describe('clampMenuPosition (#764)', () => {
  it('mantém a posição desejada quando o menu já cabe inteiro na viewport', () => {
    expect(clampMenuPosition({ x: 100, y: 100 }, { width: 160, height: 120 }, { width: 1024, height: 768 }))
      .toEqual({ x: 100, y: 100 });
  });

  it('reproduz o defeito do QA: clique perto da borda direita empurra o menu para dentro', () => {
    // Medido no QA: `left:831px` num viewport de 1024px de largura vazava para x=1635 por causa
    // do bloco de contenção de `transform` — aqui o menu (220px) precisa caber sem o portal.
    const result = clampMenuPosition(
      { x: 831, y: 100 },
      { width: 220, height: 160 },
      { width: 1024, height: 768 },
    );
    expect(result.x).toBe(1024 - 220 - CONTEXT_MENU_VIEWPORT_MARGIN);
    expect(result.x + 220).toBeLessThanOrEqual(1024 - CONTEXT_MENU_VIEWPORT_MARGIN);
  });

  it('clique perto da borda inferior empurra o menu para cima', () => {
    const result = clampMenuPosition(
      { x: 100, y: 740 },
      { width: 160, height: 200 },
      { width: 1024, height: 768 },
    );
    expect(result.y).toBe(768 - 200 - CONTEXT_MENU_VIEWPORT_MARGIN);
  });

  it('coordenada negativa (canto fora da tela) gruda na margem, nunca fica negativa', () => {
    expect(clampMenuPosition({ x: -50, y: -30 }, { width: 160, height: 120 }, { width: 1024, height: 768 }))
      .toEqual({ x: CONTEXT_MENU_VIEWPORT_MARGIN, y: CONTEXT_MENU_VIEWPORT_MARGIN });
  });

  it('menu maior que a viewport gruda na margem em vez de sair com left/top negativo', () => {
    const result = clampMenuPosition(
      { x: 400, y: 300 },
      { width: 2000, height: 1000 },
      { width: 1024, height: 768 },
    );
    expect(result).toEqual({ x: CONTEXT_MENU_VIEWPORT_MARGIN, y: CONTEXT_MENU_VIEWPORT_MARGIN });
  });

  it('a margem é configurável, e o padrão é 8px', () => {
    expect(CONTEXT_MENU_VIEWPORT_MARGIN).toBe(8);
    const result = clampMenuPosition(
      { x: 990, y: 100 },
      { width: 100, height: 50 },
      { width: 1024, height: 768 },
      20,
    );
    expect(result.x).toBe(1024 - 100 - 20);
  });
});
