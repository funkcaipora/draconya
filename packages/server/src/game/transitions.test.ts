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

  it('o mundo (OW-18) é o outro centro: dele se vai a toda atividade, e de toda atividade se volta a ele', () => {
    // O mesmo desenho da Cidade, com o mesmo ponto de parada (ADR 0060 d.6). A tabela diz só o que é
    // POSSÍVEL: que `canLogout` deixa o personagem sair do mundo, e que a volta só vai a quem tem
    // alguém olhando, é do hospedeiro (OW-20) — nenhum dos dois mora aqui.
    for (const to of ATIVIDADES) expect(refuseTransition('world', to)).toBeNull();
    for (const from of ATIVIDADES) expect(refuseTransition(from, 'world')).toBeNull();
  });

  it('o mundo e a Cidade não se tocam: quem está numa sai do jogo e entra de novo', () => {
    // A Cidade continua enquanto a flag existir (ADR 0060 d.6), mas as duas são centros, não vizinhas.
    // Uma aresta entre elas seria um caminho de transição a mais que ninguém pediu — e que, do mundo,
    // contornaria o `canLogout`.
    expect(refuseTransition('world', 'city')?.refusal).toBe('not-allowed');
    expect(refuseTransition('city', 'world')?.refusal).toBe('not-allowed');
    expect(refuseTransition('world', 'world')?.refusal).toBe('same-state');
  });

  it('a Cidade segue como era: as arestas dela não mudaram com a chegada do mundo', () => {
    // O que o jogo de hoje depende (a flag desligada é o default): da Cidade vai-se às cinco atividades
    // e nada mais, e a hunt, o treino e o resto voltam a ela.
    expect([...ATIVIDADES, 'world' as const].filter((to) => refuseTransition('city', to) === null))
      .toEqual([...ATIVIDADES]);
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
