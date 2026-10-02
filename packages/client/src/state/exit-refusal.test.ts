import { describe, expect, it } from 'vitest';
import { EXIT_REFUSAL_NOTICE_MS, huntEntryRefusalText, logoutRefusalText } from './exit-refusal.js';

// O `logout-refused` em palavras (OW-23, #846): as duas frases do `canLogout` do Canary, em português, e a
// variante de quem pediu uma hunt idle — o mesmo veredicto vale para as duas (ADR 0060 d.6a).

describe('as frases do logout recusado', () => {
  it('em luta e tile que proíbe sair são frases diferentes, ditas ao jogador em português', () => {
    expect(logoutRefusalText('in-fight')).toBe('Você não pode sair durante uma luta.');
    expect(logoutRefusalText('no-logout-tile')).toBe('Você não pode sair daqui.');
  });

  it('quem pediu uma hunt idle lê o que TENTOU, não o que o servidor checou', () => {
    expect(huntEntryRefusalText('in-fight')).toBe('Você não pode entrar numa caçada durante uma luta.');
    expect(huntEntryRefusalText('no-logout-tile')).toBe('Você não pode entrar numa caçada daqui.');
  });

  it('o aviso fica sobre o mundo o tempo de uma linha de status', () => {
    expect(EXIT_REFUSAL_NOTICE_MS).toBe(5_000);
  });
});
