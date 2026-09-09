import { describe, expect, it } from 'vitest';
import { Cooldowns } from './cooldown.js';

// O mecanismo periódico saiu na FUN-68, e os testes dele foram junto. Quem responde "quantas
// aplicações couberam" agora é a fila de eventos da sessão — ver `schedule.test.ts` e a
// equivalência entre taxas em `session.test.ts`, que é onde aquela propriedade passou a morar.

describe('event-triggered action', () => {
  it('remains unavailable for the duration and becomes ready afterwards', () => {
    const cd = new Cooldowns();
    expect(cd.isReady('heal', 0)).toBe(true);
    cd.start('heal', 0, 1000);
    expect(cd.isReady('heal', 999)).toBe(false);
    expect(cd.remainingMs('heal', 400)).toBe(600);
    expect(cd.isReady('heal', 1000)).toBe(true);
  });

  it('uses an absolute timestamp across snapshots and delayed restoration', () => {
    const cd = new Cooldowns();
    cd.start('heal', 5000, 1000);
    const resumed = Cooldowns.fromState(cd.getState());
    expect(resumed.isReady('heal', 5500)).toBe(false);
    expect(resumed.isReady('heal', 60_000)).toBe(true);
  });

  it('survives JSON, which is how it reaches the Redis snapshot', () => {
    const cd = new Cooldowns();
    cd.start('potion', 1_000, 30_000);
    const state = JSON.parse(JSON.stringify(cd.getState())) as ReturnType<Cooldowns['getState']>;
    expect(Cooldowns.fromState(state).remainingMs('potion', 1_000)).toBe(30_000);
  });

  it('carries only absolute instants — no accumulator to drift', () => {
    // O acumulador de duração saiu do estado na FUN-68. Se ele voltar, volta com ele a
    // possibilidade de escrever uma cadência que depende do tamanho da janela.
    const cd = new Cooldowns();
    cd.start('heal', 0, 1000);
    expect(Object.keys(cd.getState())).toEqual(['until']);
  });

  it('forgets a key on clear', () => {
    const cd = new Cooldowns();
    cd.start('heal', 0, 1000);
    cd.clear('heal');
    expect(cd.isReady('heal', 0)).toBe(true);
  });
});
