import type { SessionType } from '@draconya/sim';
import { describe, expect, it } from 'vitest';
import { REFUSAL_TEXT, refuseTransition } from './transitions.js';

const ATIVIDADES: readonly SessionType[] = ['hunt', 'training', 'quest', 'boss', 'guild-war'];

describe('máquina de estados do personagem (§6)', () => {
  it('a Cidade é o centro: dá para sair dela para qualquer atividade', () => {
    for (const to of ATIVIDADES) expect(refuseTransition('city', to)).toBeNull();
  });

  it('e qualquer atividade volta para a Cidade', () => {
    // Morte, saída manual, drenagem — todas terminam na PZ.
    for (const from of ATIVIDADES) expect(refuseTransition(from, 'city')).toBeNull();
  });

  it('mas não se vai de uma atividade direto para outra', () => {
    // Permitir tudo para tudo parece mais flexível e custa caro: cada par novo vira um
    // caminho de transição que ninguém testou, e a transição é o único momento em que o
    // estado quente troca de dono.
    for (const from of ATIVIDADES) {
      for (const to of ATIVIDADES) {
        if (from === to) continue;
        expect(refuseTransition(from, to)?.refusal).toBe('not-allowed');
      }
    }
  });

  it('o mundo (OW-13) é tipo de sessão, mas ainda não está no grafo: o hospedeiro o põe lá na OW-20', () => {
    // Com `OPEN_WORLD` desligado — o default — nada hospeda um mundo, e este teste prende que a
    // chegada do tipo não abriu nenhuma transição nova: de lá para cá, e daqui para lá, é recusa.
    for (const other of ['city', ...ATIVIDADES] as const) {
      expect(refuseTransition(other, 'world')?.refusal).toBe('not-allowed');
      expect(refuseTransition('world', other)?.refusal).toBe('not-allowed');
    }
    expect(refuseTransition('world', 'world')?.refusal).toBe('same-state');
  });

  it('recusa ir para onde já se está, com motivo próprio', () => {
    // Distinto de "não permitido" de propósito: a mensagem é outra, e confundir as duas faria
    // o jogador achar que a hunt em que ele está não existe.
    expect(refuseTransition('hunt', 'hunt')?.refusal).toBe('same-state');
    expect(refuseTransition('city', 'city')?.refusal).toBe('same-state');
  });

  it('toda recusa tem texto que diz o que fazer em seguida', () => {
    // "Você não pode fazer isso" é a mensagem que faz alguém achar que o jogo travou.
    for (const text of Object.values(REFUSAL_TEXT)) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/undefined/);
    }
  });
});
