import { describe, expect, it } from 'vitest';
import { EMPTY_SCHEDULE, EventPriority, Schedule, comesFirst } from './schedule.js';

const drain = (schedule: Schedule): string[] => {
  const out: string[] = [];
  for (;;) {
    const next = schedule.pop();
    if (next === undefined) return out;
    out.push(`${next.kind}@${next.dueAtMs}`);
  }
};

describe('ordem', () => {
  it('vence primeiro quem tem o instante menor', () => {
    const schedule = new Schedule();
    schedule.schedule('late', 500);
    schedule.schedule('early', 100);
    expect(drain(schedule)).toEqual(['early@100', 'late@500']);
  });

  it('no mesmo instante, a prioridade decide', () => {
    // Reproduz a ordem que o `onTick` executava suas fases. Sem uma ordem total, "quem age
    // primeiro em t=500" viraria detalhe do heap, e a sessão deixaria de ser reproduzível.
    const schedule = new Schedule();
    schedule.schedule('attack', 100, { priority: EventPriority.Attack });
    schedule.schedule('upkeep', 100, { priority: EventPriority.Upkeep });
    schedule.schedule('move', 100, { priority: EventPriority.Movement });
    schedule.schedule('spawn', 100, { priority: EventPriority.Spawn });
    expect(drain(schedule)).toEqual(['upkeep@100', 'spawn@100', 'move@100', 'attack@100']);
  });

  it('no mesmo instante e prioridade, quem foi agendado antes vem antes', () => {
    const schedule = new Schedule();
    schedule.schedule('a', 100);
    schedule.schedule('b', 100);
    schedule.schedule('c', 100);
    expect(drain(schedule)).toEqual(['a@100', 'b@100', 'c@100']);
  });

  it('a comparação é uma ordem TOTAL — nunca devolve empate', () => {
    // `seq` é único por agendamento, então dois eventos nunca são indistinguíveis. É o que
    // garante que dois nós com o mesmo snapshot despachem na mesma ordem.
    const schedule = new Schedule();
    const a = schedule.schedule('x', 100);
    const b = schedule.schedule('x', 100);
    expect(comesFirst(a, b)).toBe(true);
    expect(comesFirst(b, a)).toBe(false);
  });

  it('mantém a ordem com muitos eventos, e não só com os poucos do heap raso', () => {
    // Um heap errado passa com três elementos e falha com trezentos: os defeitos de `siftDown`
    // aparecem quando a árvore tem profundidade.
    const schedule = new Schedule();
    const instants = Array.from({ length: 500 }, (_, i) => ((i * 37) % 500) + 1);
    for (const at of instants) schedule.schedule('e', at);
    const drained = drain(schedule).map((s) => Number(s.split('@')[1]));
    expect(drained).toEqual([...instants].sort((a, b) => a - b));
  });
});

describe('cancelamento', () => {
  it('tira da fila tudo o que é de um subject', () => {
    // É como um monstro que morre leva os eventos dele junto. Sem isso, a fila cresceria com o
    // vencimento de criaturas que não existem, uma vez por cadência, para sempre.
    const schedule = new Schedule();
    schedule.schedule('step', 100, { subject: 'm:1' });
    schedule.schedule('attack', 200, { subject: 'm:1' });
    schedule.schedule('step', 150, { subject: 'm:2' });
    expect(schedule.cancelSubject('m:1')).toBe(2);
    expect(drain(schedule)).toEqual(['step@150']);
  });

  it('cancelar por tipo e subject deixa os outros tipos de pé', () => {
    const schedule = new Schedule();
    schedule.schedule('step', 100, { subject: 'm:1' });
    schedule.schedule('attack', 200, { subject: 'm:1' });
    expect(schedule.cancel('step', 'm:1')).toBe(1);
    expect(drain(schedule)).toEqual(['attack@200']);
  });

  it('cancelar o que não existe não mexe em nada', () => {
    const schedule = new Schedule();
    schedule.schedule('step', 100, { subject: 'm:1' });
    expect(schedule.cancelSubject('m:9')).toBe(0);
    expect(schedule.size).toBe(1);
  });

  it('o heap continua válido depois de um cancelamento', () => {
    // Cancelar reempilha; um `filter` que devolvesse o vetor sem reempilhar deixaria o heap
    // quebrado e a ordem erraria só às vezes, que é a pior forma de errar.
    const schedule = new Schedule();
    for (let i = 20; i > 0; i--) schedule.schedule('e', i * 10, { subject: i % 2 ? 'odd' : 'even' });
    schedule.cancelSubject('odd');
    const drained = drain(schedule).map((s) => Number(s.split('@')[1]));
    expect(drained).toEqual([...drained].sort((a, b) => a - b));
    expect(drained).toHaveLength(10);
  });
});

describe('estado', () => {
  it('vai e volta pelo JSON preservando a ordem de despacho', () => {
    const schedule = new Schedule();
    schedule.schedule('c', 300);
    schedule.schedule('a', 100, { priority: EventPriority.Upkeep, subject: 's' });
    schedule.schedule('b', 200);

    const restored = Schedule.fromState(
      JSON.parse(JSON.stringify(schedule.getState())) as ReturnType<Schedule['getState']>,
    );
    expect(drain(restored)).toEqual(['a@100', 'b@200', 'c@300']);
  });

  it('grava ordenado por vencimento, e não na ordem interna do heap', () => {
    // O snapshot é lido por gente investigando "por que a hunt parou", e um vetor em ordem de
    // heap não responde nada.
    const schedule = new Schedule();
    for (const at of [500, 100, 900, 300]) schedule.schedule('e', at);
    expect(schedule.getState().events.map((e) => e.dueAtMs)).toEqual([100, 300, 500, 900]);
  });

  it('continua a sequência de onde parou, para o desempate não repetir', () => {
    const schedule = new Schedule();
    schedule.schedule('a', 100);
    schedule.schedule('b', 100);
    const restored = Schedule.fromState(schedule.getState());
    const next = restored.schedule('c', 100);
    expect(next.seq).toBe(2);
    expect(drain(restored)).toEqual(['a@100', 'b@100', 'c@100']);
  });

  it('nasce vazia a partir do estado vazio', () => {
    expect(Schedule.fromState(EMPTY_SCHEDULE).size).toBe(0);
    expect(Schedule.fromState().pop()).toBeUndefined();
  });
});

describe('deferOverdue', () => {
  it('empurra para o alvo só o que já venceu, e descarta o atraso', () => {
    // A política do ADR 0018 aplicada a uma engasgada de processo: uma aplicação de
    // recuperação, e o resto vai embora em vez de virar dívida que explode no avanço seguinte.
    const schedule = new Schedule();
    schedule.schedule('old', 10);
    schedule.schedule('older', 20);
    schedule.schedule('future', 900);
    expect(schedule.deferOverdue(500)).toBe(2);
    expect(drain(schedule)).toEqual(['old@500', 'older@500', 'future@900']);
  });

  it('não mexe em nada quando ninguém está atrasado', () => {
    const schedule = new Schedule();
    schedule.schedule('a', 900);
    expect(schedule.deferOverdue(500)).toBe(0);
  });
});
