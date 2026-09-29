import { describe, expect, it } from 'vitest';
import { bonusPercent, progressOf } from './bestiary-progress.js';

/** Os cinco do §18, como em `content/data/bestiary/baseline.json`. */
const MILESTONES = [10_000, 25_000, 50_000, 100_000, 200_000];

describe('progressOf (FUN-113)', () => {
  it('no limiar exato o marco JÁ conta, e o próximo é o seguinte', () => {
    // O abate 10 000 fecha o primeiro marco — é o que o `sim` grava como `rat/1`. Mostrar
    // "0/5, próximo 10.000" nesse instante contradiz a linha do extrato que acabou de sair.
    // Mutação que mata: `<=` no lugar de `<` (o marco só contaria em 10 001).
    expect(progressOf(9_999, MILESTONES)).toEqual({ reached: 0, next: 10_000 });
    expect(progressOf(10_000, MILESTONES)).toEqual({ reached: 1, next: 25_000 });
    expect(progressOf(10_001, MILESTONES)).toEqual({ reached: 1, next: 25_000 });
  });

  it('zero abates é zero marcos, com o primeiro pela frente', () => {
    expect(progressOf(0, MILESTONES)).toEqual({ reached: 0, next: 10_000 });
  });

  it('depois do último marco não há próximo', () => {
    // `null`, e não `undefined` nem o último de novo: a tela mostra "—", e um marco
    // "próximo" que já foi alcançado é uma meta que nunca sai da tela.
    expect(progressOf(200_000, MILESTONES)).toEqual({ reached: 5, next: null });
    expect(progressOf(1_000_000, MILESTONES)).toEqual({ reached: 5, next: null });
  });

  it('sem marcos não há progresso a mostrar', () => {
    // Servidor sem Bestiário configurado: o contador existe, o marco não.
    expect(progressOf(50_000, [])).toEqual({ reached: 0, next: null });
  });
});

describe('bonusPercent (FUN-113, DT-01)', () => {
  it('soma os marcos de TODOS os monstros — o bônus é global, não daquele monstro', () => {
    // Dois marcos no rato e um no morcego são três marcos, e três pontos. Por monstro seria
    // uma segunda regra que o PRD não escreve — e a que o `sim` não aplica.
    expect(bonusPercent({ rat: 25_000, bat: 10_000 }, MILESTONES, 1)).toBe(3);
  });

  it('vale o que o conteúdo diz que um marco vale', () => {
    expect(bonusPercent({ rat: 10_000 }, MILESTONES, 2)).toBe(2);
    expect(bonusPercent({ rat: 10_000 }, MILESTONES, 0.5)).toBe(0.5);
  });

  it('sem marco alcançado é zero, e contador vazio também', () => {
    expect(bonusPercent({ rat: 9_999 }, MILESTONES, 1)).toBe(0);
    expect(bonusPercent({}, MILESTONES, 1)).toBe(0);
  });

  it('conta o monstro que está no contador e não no catálogo', () => {
    // É o que o `sim` paga (`Bestiary.milestonesReached` varre o estado, não o conteúdo):
    // mostrar menos que o servidor paga seria um número que nenhum extrato explica.
    expect(bonusPercent({ 'retired-monster': 200_000 }, MILESTONES, 1)).toBe(5);
  });
});
