import { describe, expect, it } from 'vitest';
import { Rng } from './rng.js';
import {
  DEFAULT_INDEX_ABOVE, EMPTY_SCHEDULE, EventPriority, Schedule, comesFirst, comesFirstStable,
} from './schedule.js';
import type { ScheduleOptions, ScheduleState, ScheduledEvent } from './schedule.js';

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

describe('dueAtOf (#689)', () => {
  it('acha o vencimento do evento pelo kind e subject, e devolve null depois do cancel', () => {
    const schedule = new Schedule();
    schedule.schedule('step', 100, { subject: 'c:ring' });
    schedule.schedule('equip-expire', 600_000, { subject: 'c:ring' });
    schedule.schedule('equip-expire', 50, { subject: 'c:amulet' });
    expect(schedule.dueAtOf('equip-expire', 'c:ring')).toBe(600_000);
    expect(schedule.dueAtOf('equip-expire', 'c:boots')).toBeNull();
    schedule.cancel('equip-expire', 'c:ring');
    // Mutação que mata: ler um evento cancelado ressuscitaria o prazo de um anel que saiu.
    expect(schedule.dueAtOf('equip-expire', 'c:ring')).toBeNull();
    expect(schedule.dueAtOf('equip-expire', 'c:amulet')).toBe(50);
  });

  it('depois de vencer (pop), o evento não está mais lá', () => {
    const schedule = new Schedule();
    schedule.schedule('equip-expire', 10, { subject: 'c:ring' });
    schedule.pop();
    expect(schedule.dueAtOf('equip-expire', 'c:ring')).toBeNull();
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

describe('cancelamento preguiçoso (#827), no regime indexado', () => {
  // `indexAbove: 0` indexa desde o primeiro evento: é o regime do mundo, com poucas dezenas de eventos.
  const LAZY = { indexAbove: 0 } as const;

  it('cancelar não toca no heap: vira lápide, e só deixa de contar em `size`', () => {
    // 1 lápide em 3 não passa da metade do heap, então a compactação não roda e a lápide ainda
    // está lá. Mutação que mata: cancelar reconstruindo o heap (o `tombstones` seria 0).
    const schedule = new Schedule(LAZY);
    schedule.schedule('a', 100, { subject: 'x' });
    schedule.schedule('b', 200, { subject: 'y' });
    schedule.schedule('c', 300, { subject: 'z' });
    expect(schedule.cancel('b', 'y')).toBe(1);
    expect(schedule.size).toBe(2);
    expect(schedule.tombstones).toBe(1);
  });

  it('pop e peek descartam a lápide que está no topo, sem despachá-la', () => {
    const schedule = new Schedule(LAZY);
    schedule.schedule('first', 100, { subject: 'x' });
    schedule.schedule('second', 200, { subject: 'y' });
    schedule.schedule('third', 300, { subject: 'z' });
    schedule.cancel('first', 'x');
    expect(schedule.tombstones).toBe(1);
    // O `peek` mostra o primeiro VIVO, e a lápide que o escondia já saiu do heap.
    expect(schedule.peek()?.kind).toBe('second');
    expect(schedule.tombstones).toBe(0);
    expect(drain(schedule)).toEqual(['second@200', 'third@300']);
  });

  it('compacta quando mais da metade do heap é lápide, e só então', () => {
    const schedule = new Schedule(LAZY);
    for (let i = 0; i < 10; i++) schedule.schedule('e', 100 + i, { subject: `s${i}` });
    for (let i = 5; i < 9; i++) schedule.cancelSubject(`s${i}`);
    // 4 de 10 e depois 5 de 10: metade exata NÃO é "mais da metade".
    schedule.cancelSubject('s9');
    expect(schedule.tombstones).toBe(5);
    expect(schedule.size).toBe(5);
    // A sexta passa de 5/10: o heap é compactado e some tudo o que era lápide.
    schedule.cancelSubject('s4');
    expect(schedule.tombstones).toBe(0);
    expect(schedule.size).toBe(4);
    expect(drain(schedule)).toEqual(['e@100', 'e@101', 'e@102', 'e@103']);
  });

  it('o heap continua válido depois de compactar', () => {
    // Compactar reempilha em O(n); um vetor filtrado e não reempilhado despacharia fora de ordem
    // só às vezes, que é a pior forma de errar.
    const schedule = new Schedule(LAZY);
    for (let i = 300; i > 0; i--) schedule.schedule('e', (i * 7919) % 1000, { subject: `s${i % 3}` });
    schedule.cancelSubject('s0');
    schedule.cancelSubject('s1');
    expect(schedule.tombstones).toBe(0);
    const drained = drain(schedule).map((s) => Number(s.split('@')[1]));
    expect(drained).toHaveLength(100);
    expect(drained).toEqual([...drained].sort((a, b) => a - b));
  });

  it('reagendar depois de cancelar nasce vivo: a lápide não pega o evento novo', () => {
    // O ciclo do jogo: o monstro troca de alvo, cancela o passo e agenda outro, e o novo não
    // pode morrer junto do velho.
    const schedule = new Schedule(LAZY);
    schedule.schedule('step', 100, { subject: 'm:1' });
    schedule.schedule('other', 150, { subject: 'm:2' });
    schedule.schedule('far', 900, { subject: 'm:3' });
    expect(schedule.cancel('step', 'm:1')).toBe(1);
    schedule.schedule('step', 500, { subject: 'm:1' });
    expect(schedule.size).toBe(3);
    expect(drain(schedule)).toEqual(['other@150', 'step@500', 'far@900']);
  });

  it('cancelar de novo só leva o que foi agendado desde o último cancelamento', () => {
    const schedule = new Schedule(LAZY);
    schedule.schedule('step', 100, { subject: 'm:1' });
    expect(schedule.cancel('step', 'm:1')).toBe(1);
    schedule.schedule('step', 200, { subject: 'm:1' });
    schedule.schedule('step', 300, { subject: 'm:1' });
    expect(schedule.cancel('step', 'm:1')).toBe(2);
    expect(schedule.cancel('step', 'm:1')).toBe(0);
    expect(schedule.size).toBe(0);
    expect(schedule.pop()).toBeUndefined();
  });

  it('dueAtOf ignora lápide, mesmo a que vence antes do evento vivo', () => {
    const schedule = new Schedule(LAZY);
    // Os três de enchimento mantêm a lápide abaixo da metade do heap: ela ainda está lá, e é ela
    // que a varredura tem de pular.
    for (const filler of ['x', 'y', 'z']) schedule.schedule('step', 10, { subject: filler });
    schedule.schedule('equip-expire', 50, { subject: 'c:ring' });
    schedule.cancel('equip-expire', 'c:ring');
    expect(schedule.tombstones).toBe(1);
    schedule.schedule('equip-expire', 600_000, { subject: 'c:ring' });
    // Mutação que mata: ler a lápide devolveria 50.
    expect(schedule.dueAtOf('equip-expire', 'c:ring')).toBe(600_000);
    schedule.cancel('equip-expire', 'c:ring');
    expect(schedule.dueAtOf('equip-expire', 'c:ring')).toBeNull();
  });

  it('o estado não serializa lápide, e restaurar não as traz de volta', () => {
    const schedule = new Schedule(LAZY);
    for (let i = 0; i < 5; i++) schedule.schedule('e', 100 + i, { subject: `s${i}` });
    schedule.cancelSubject('s1');
    expect(schedule.tombstones).toBe(1);
    const state = schedule.getState();
    expect(state.events.map((e) => e.subject)).toEqual(['s0', 's2', 's3', 's4']);
    const restored = Schedule.fromState(JSON.parse(JSON.stringify(state)) as ScheduleState);
    expect(restored.tombstones).toBe(0);
    expect(drain(restored)).toEqual(['e@100', 'e@102', 'e@103', 'e@104']);
  });

  it('o evento é só os cinco campos de sempre: a contabilidade não vaza para o snapshot nem para o `toEqual`', () => {
    const schedule = new Schedule(LAZY);
    const event = schedule.schedule('step', 100, { subject: 'm:1', priority: EventPriority.Attack });
    expect(event).toEqual({ kind: 'step', dueAtMs: 100, priority: EventPriority.Attack, subject: 'm:1', seq: 0 });
    expect(Object.keys(event)).toEqual(['kind', 'dueAtMs', 'priority', 'subject', 'seq']);
    expect(JSON.stringify(schedule.getState())).toBe(
      '{"events":[{"kind":"step","dueAtMs":100,"priority":3,"subject":"m:1","seq":0}],"nextSeq":1}',
    );
  });

  it('deferOverdue leva as lápides embora e conta só os vivos', () => {
    const schedule = new Schedule(LAZY);
    schedule.schedule('dead', 10, { subject: 'a' });
    schedule.schedule('old', 20, { subject: 'b' });
    schedule.schedule('future', 900, { subject: 'c' });
    schedule.schedule('future2', 901, { subject: 'd' });
    schedule.cancelSubject('a');
    expect(schedule.tombstones).toBe(1);
    expect(schedule.deferOverdue(500)).toBe(1);
    expect(schedule.tombstones).toBe(0);
    expect(drain(schedule)).toEqual(['old@500', 'future@900', 'future2@901']);
    // A contabilidade fecha em zero: lápide que ficasse no heap sem ser contada tornaria o contador
    // negativo quando o topo a descartasse.
    expect(schedule.tombstones).toBe(0);
  });

  it('não vaza o registro dos pares: milhares de subjects que passam pela fila são esquecidos', () => {
    // O id de monstro só cresce, e a contabilidade de cada par é por subject. Sem a varredura de
    // pares ociosos o mapa teria um subject por criatura que já nasceu, a hunt inteira.
    const schedule = new Schedule(LAZY);
    for (let i = 0; i < 20_000; i++) {
      schedule.schedule('step', i, { subject: `m:${i}` });
      schedule.schedule('attack', i, { subject: `m:${i}` });
      schedule.pop();
      schedule.pop();
    }
    expect(schedule.size).toBe(0);
    expect(schedule.trackedSlots).toBeLessThan(300);
  });

  it('a varredura dos pares ociosos não esquece um par que ainda tem evento vivo', () => {
    const schedule = new Schedule(LAZY);
    // Pares que passam pela fila e ficam ociosos...
    for (let i = 0; i < 80; i++) {
      schedule.schedule('gone', i, { subject: `gone:${i}` });
      schedule.pop();
    }
    // ...e pares que ficam vivos: criá-los cruza o limiar da varredura com eles já na fila.
    for (let i = 0; i < 200; i++) schedule.schedule('step', 1000 + i, { subject: `live:${i}` });
    expect(schedule.trackedSlots).toBeLessThan(280);
    // Mutação que mata: esquecer o par vivo faria o cancelamento não achar o evento (devolveria 0).
    for (let i = 0; i < 200; i++) expect(schedule.cancel('step', `live:${i}`)).toBe(1);
    expect(schedule.size).toBe(0);
  });

  it('um subject com vários kinds: cada par é cancelado sozinho, e o subject todo de uma vez', () => {
    // O encadeamento dos pares do mesmo subject: achar o do meio e do fim da lista, e cancelar a lista inteira.
    const schedule = new Schedule(LAZY);
    for (const kind of ['a', 'b', 'c', 'd']) schedule.schedule(kind, 100, { subject: 'm:1' });
    schedule.schedule('x', 100, { subject: 'm:2' });
    expect(schedule.cancel('c', 'm:1')).toBe(1);
    expect(schedule.cancel('a', 'm:1')).toBe(1);
    expect(schedule.dueAtOf('b', 'm:1')).toBe(100);
    expect(schedule.dueAtOf('d', 'm:1')).toBe(100);
    expect(schedule.cancelSubject('m:1')).toBe(2);
    expect(drain(schedule)).toEqual(['x@100']);
  });

  it('o ciclo do timer (vence e se reagenda) reaproveita o par em vez de recriá-lo', () => {
    const schedule = new Schedule(LAZY);
    schedule.schedule('step', 0, { subject: 'm:1' });
    for (let i = 1; i <= 1000; i++) {
      schedule.pop();
      schedule.schedule('step', i * 100, { subject: 'm:1' });
    }
    expect(schedule.trackedSlots).toBe(1);
    expect(schedule.size).toBe(1);
  });
});

describe('os dois regimes da fila: remoção direta e índice com lápide (#827)', () => {
  it('a fila da hunt (dezenas de eventos, até o limiar) nunca indexa: sem lápide, sem registro de pares', () => {
    // É o que mantém a instância byte a byte, em CPU e em memória: o índice custa ~100 bytes por
    // par e um acesso a `Map` por evento, e a remoção direta de dezenas de eventos é mais barata.
    const schedule = new Schedule();
    for (let i = 0; i < DEFAULT_INDEX_ABOVE; i++) schedule.schedule('step', i, { subject: `m:${i % 50}` });
    expect(schedule.indexed).toBe(false);
    expect(schedule.cancelSubject('m:3')).toBe(Math.ceil((DEFAULT_INDEX_ABOVE - 3) / 50));
    expect(schedule.cancel('step', 'm:4')).toBeGreaterThan(0);
    expect(schedule.tombstones).toBe(0);
    expect(schedule.trackedSlots).toBe(0);
    expect(schedule.indexed).toBe(false);
  });

  it('passa a indexar quando a fila ultrapassa o limiar, e conta o que já estava nela', () => {
    const schedule = new Schedule({ indexAbove: 8 });
    for (let i = 0; i < 8; i++) schedule.schedule('step', 100 + i, { subject: `m:${i}` });
    expect(schedule.indexed).toBe(false);
    schedule.schedule('step', 108, { subject: 'm:8' });
    expect(schedule.indexed).toBe(true);
    expect(schedule.size).toBe(9);
    // Os que entraram ANTES de o índice existir também se cancelam por ele.
    expect(schedule.cancelSubject('m:0')).toBe(1);
    expect(schedule.cancel('step', 'm:8')).toBe(1);
    expect(schedule.size).toBe(7);
    expect(drain(schedule)).toEqual([101, 102, 103, 104, 105, 106, 107].map((at) => `step@${at}`));
  });

  it('no limiar padrão: 1024 eventos ainda não indexam, o 1025º sim', () => {
    const schedule = new Schedule();
    for (let i = 0; i < DEFAULT_INDEX_ABOVE; i++) schedule.schedule('e', i, { subject: `s${i}` });
    expect(schedule.indexed).toBe(false);
    schedule.schedule('e', 5000, { subject: 'last' });
    expect(schedule.indexed).toBe(true);
    expect(schedule.size).toBe(DEFAULT_INDEX_ABOVE + 1);
  });

  it('restaurar um estado grande já nasce indexado, e a ordem sai igual', () => {
    const big = new Schedule({ indexAbove: 4 });
    for (let i = 0; i < 40; i++) big.schedule('e', (i * 17) % 90, { subject: `s${i % 7}` });
    big.cancelSubject('s2');
    const restored = Schedule.fromState(JSON.parse(JSON.stringify(big.getState())) as ScheduleState, { indexAbove: 4 });
    expect(restored.indexed).toBe(true);
    expect(restored.tombstones).toBe(0);
    expect(drain(restored)).toEqual(drain(big));
  });

  it('larga o índice só quando a fila encolhe a um quarto do limiar — histerese', () => {
    const schedule = new Schedule({ indexAbove: 16 });
    for (let i = 0; i < 17; i++) schedule.schedule('e', i, { subject: `s${i}` });
    expect(schedule.indexed).toBe(true);
    // 16, 15, ... 4 vivos: abaixo do limiar (16) e ainda indexada. Oscilar em torno dele não pode
    // construir e destruir o índice a cada evento.
    for (let i = 0; i < 13; i++) schedule.pop();
    expect(schedule.size).toBe(4);
    expect(schedule.indexed).toBe(true);
    schedule.pop();
    expect(schedule.size).toBe(3);
    expect(schedule.indexed).toBe(false);
    expect(schedule.trackedSlots).toBe(0);
  });

  it('largar o índice leva as lápides embora, e a fila segue certa nos dois regimes', () => {
    const schedule = new Schedule({ indexAbove: 16 });
    for (let i = 0; i < 20; i++) schedule.schedule('e', 100 + i, { subject: `s${i}` });
    // 19 cancelamentos de pares com um só evento: a compactação roda a cada vez que passa da
    // metade, e a fila acaba abaixo de um quarto do limiar — o índice cai com o que restou.
    for (let i = 0; i < 19; i++) schedule.cancelSubject(`s${i}`);
    expect(schedule.indexed).toBe(false);
    expect(schedule.tombstones).toBe(0);
    expect(schedule.size).toBe(1);
    // Voltando a crescer, reindexa, e o evento que sobrou continua lá.
    for (let i = 0; i < 20; i++) schedule.schedule('e', 200 + i, { subject: `t${i}` });
    expect(schedule.indexed).toBe(true);
    expect(schedule.size).toBe(21);
    expect(drain(schedule)).toEqual(['e@119', ...Array.from({ length: 20 }, (_, i) => `e@${200 + i}`)]);
  });

  it('o cancelamento direto devolve a contagem e mantém o heap válido', () => {
    const schedule = new Schedule();
    for (let i = 60; i > 0; i--) schedule.schedule(i % 2 ? 'odd' : 'even', i * 10, { subject: `s${i % 3}` });
    expect(schedule.cancel('odd', 's1')).toBe(10);
    expect(schedule.cancelSubject('s2')).toBe(20);
    const drained = drain(schedule).map((entry) => Number(entry.split('@')[1]));
    expect(drained).toEqual([...drained].sort((a, b) => a - b));
    expect(drained).toHaveLength(30);
  });
});

describe("desempate estável ('stable', #827)", () => {
  type Spec = { kind: string; subject: string; dueAtMs: number; priority: number };
  const key = (e: { dueAtMs: number; priority: number; subject: string; kind: string }): string =>
    `${e.dueAtMs}/${e.priority}/${e.subject}/${e.kind}`;
  const drainKeys = (schedule: Schedule): string[] => {
    const out: string[] = [];
    for (let next = schedule.pop(); next !== undefined; next = schedule.pop()) out.push(key(next));
    return out;
  };
  const load = (specs: readonly Spec[], tieBreak: 'insertion' | 'stable'): Schedule => {
    const schedule = new Schedule({ tieBreak });
    for (const s of specs) schedule.schedule(s.kind, s.dueAtMs, { priority: s.priority, subject: s.subject });
    return schedule;
  };
  const shuffled = <T>(items: readonly T[], rng: Rng): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = rng.integer(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };

  // 240 eventos com instantes e prioridades que se repetem de propósito: é o empate que importa.
  const specs: Spec[] = Array.from({ length: 240 }, (_, i) => ({
    kind: ['step', 'attack', 'defense', 'think'][i % 4] as string,
    subject: `m:${(i * 7) % 30}`,
    dueAtMs: ((i * 13) % 5) * 100,
    priority: i % 3,
  }));

  it('inserir os mesmos eventos em qualquer ordem dá o mesmo despacho', () => {
    const rng = Rng.fromSeed('stable-permutations');
    const reference = drainKeys(load(specs, 'stable'));
    for (let round = 0; round < 25; round++) {
      expect(drainKeys(load(shuffled(specs, rng), 'stable'))).toEqual(reference);
    }
  });

  it('a ordem é (instante, prioridade, subject, kind), nessa ordem de importância', () => {
    const expected = [...specs]
      .sort((a, b) =>
        a.dueAtMs - b.dueAtMs || a.priority - b.priority ||
        (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0) ||
        (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
      .map(key);
    expect(drainKeys(load(specs, 'stable'))).toEqual(expected);
  });

  it("no 'insertion' a mesma permutação muda o despacho — o teste de cima não passa por acaso", () => {
    const rng = Rng.fromSeed('stable-permutations');
    const reference = drainKeys(load(specs, 'insertion'));
    const outcomes = new Set<string>();
    for (let round = 0; round < 10; round++) {
      outcomes.add(drainKeys(load(shuffled(specs, rng), 'insertion')).join('|'));
    }
    outcomes.add(reference.join('|'));
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('o timer reinserido volta ao lugar em que estaria se nunca tivesse saído', () => {
    // O que a dormência faz: tira os timers de um monstro e os devolve depois. Com o desempate
    // pela inserção o reinserido ganha um `seq` novo e vai para o fim do instante.
    const build = (tieBreak: 'insertion' | 'stable'): string[] => {
      const schedule = new Schedule({ tieBreak });
      schedule.schedule('step', 100, { subject: 'm:1' });
      schedule.schedule('step', 100, { subject: 'm:2' });
      schedule.schedule('step', 100, { subject: 'm:3' });
      schedule.cancelSubject('m:2');
      schedule.schedule('step', 100, { subject: 'm:2' });
      return drainKeys(schedule);
    };
    expect(build('stable')).toEqual(['100/2/m:1/step', '100/2/m:2/step', '100/2/m:3/step']);
    expect(build('insertion')).toEqual(['100/2/m:1/step', '100/2/m:3/step', '100/2/m:2/step']);
  });

  it('o mesmo (subject, kind) duas vezes no mesmo instante despacha pela ordem de agendamento', () => {
    // São indistinguíveis, mas a ordem tem de continuar TOTAL, ou dois nós divergiriam no seq.
    const schedule = new Schedule({ tieBreak: 'stable' });
    const a = schedule.schedule('step', 100, { subject: 'm:1' });
    const b = schedule.schedule('step', 100, { subject: 'm:1' });
    expect(comesFirstStable(a, b)).toBe(true);
    expect(comesFirstStable(b, a)).toBe(false);
    expect([schedule.pop()?.seq, schedule.pop()?.seq]).toEqual([0, 1]);
  });

  it('compara subject e kind por unidade de código, e não por locale', () => {
    // `localeCompare` poria "a" antes de "B"; a unidade de código põe "B" (66) antes de "a" (97).
    // Dois nós com locales diferentes têm de ordenar igual.
    const schedule = new Schedule({ tieBreak: 'stable' });
    schedule.schedule('k', 0, { subject: 'a' });
    schedule.schedule('k', 0, { subject: 'B' });
    expect(drainKeys(schedule)).toEqual(['0/2/B/k', '0/2/a/k']);
  });

  it('a escolha vai no estado, só no stable, e a restauração a respeita', () => {
    const stable = new Schedule({ tieBreak: 'stable' });
    stable.schedule('step', 100, { subject: 'm:2' });
    stable.schedule('step', 100, { subject: 'm:1' });
    const state = JSON.parse(JSON.stringify(stable.getState())) as ScheduleState;
    expect(state.tieBreak).toBe('stable');
    const restored = Schedule.fromState(state);
    expect(restored.tieBreak).toBe('stable');
    restored.schedule('step', 100, { subject: 'm:0' });
    expect(drainKeys(restored)).toEqual(['100/2/m:0/step', '100/2/m:1/step', '100/2/m:2/step']);

    // O default NÃO ganha chave nenhuma: o snapshot da instância é o de sempre, byte a byte.
    const insertion = new Schedule();
    insertion.schedule('step', 100, { subject: 'm:2' });
    expect('tieBreak' in insertion.getState()).toBe(false);
    expect(Schedule.fromState(insertion.getState()).tieBreak).toBe('insertion');
  });

  it('a opção de quem restaura vale mais que o estado', () => {
    const state: ScheduleState = {
      events: [{ kind: 'step', dueAtMs: 0, priority: 2, subject: 'a', seq: 0 }], nextSeq: 1,
    };
    expect(Schedule.fromState(state, { tieBreak: 'stable' }).tieBreak).toBe('stable');
    expect(Schedule.fromState().tieBreak).toBe('insertion');
  });
});

// --- equivalência com a implementação de antes do #827 ---------------------------------------

/**
 * O ORÁCULO: a fila como era antes do cancelamento preguiçoso, intacta — filtra e reempilha o
 * heap inteiro a cada cancelamento, varre o heap para `dueAtOf`. É lenta e é o que a nova tem de
 * reproduzir em tudo o que dá para observar. Fica no teste, e não no código, de propósito.
 */
class LegacySchedule {
  #heap: ScheduledEvent[] = [];
  #nextSeq = 0;
  readonly #before: (a: ScheduledEvent, b: ScheduledEvent) => boolean;

  constructor(before: (a: ScheduledEvent, b: ScheduledEvent) => boolean = comesFirst) {
    this.#before = before;
  }

  static fromState(
    state: ScheduleState, before: (a: ScheduledEvent, b: ScheduledEvent) => boolean,
  ): LegacySchedule {
    const schedule = new LegacySchedule(before);
    for (const event of state.events) schedule.#push(event);
    schedule.#nextSeq = state.nextSeq;
    return schedule;
  }

  get size(): number {
    return this.#heap.length;
  }

  getState(): ScheduleState {
    const events = [...this.#heap].sort((a, b) => (this.#before(a, b) ? -1 : 1));
    return { events, nextSeq: this.#nextSeq };
  }

  schedule(
    kind: string, dueAtMs: number, options: { readonly priority?: number; readonly subject?: string } = {},
  ): ScheduledEvent {
    const event: ScheduledEvent = {
      kind, dueAtMs, priority: options.priority ?? EventPriority.Movement,
      subject: options.subject ?? '', seq: this.#nextSeq++,
    };
    this.#push(event);
    return event;
  }

  peek(): ScheduledEvent | undefined {
    return this.#heap[0];
  }

  pop(): ScheduledEvent | undefined {
    const top = this.#heap[0];
    if (top === undefined) return undefined;
    const last = this.#heap.pop() as ScheduledEvent;
    if (this.#heap.length > 0) {
      this.#heap[0] = last;
      this.#siftDown(0);
    }
    return top;
  }

  cancel(kind: string, subject: string): number {
    const before = this.#heap.length;
    const kept = this.#heap.filter((e) => e.kind !== kind || e.subject !== subject);
    if (kept.length === before) return 0;
    this.#heap = [];
    for (const event of kept) this.#push(event);
    return before - kept.length;
  }

  dueAtOf(kind: string, subject: string): number | null {
    let dueAt: number | null = null;
    for (const event of this.#heap) {
      if (event.kind !== kind || event.subject !== subject) continue;
      if (dueAt === null || event.dueAtMs < dueAt) dueAt = event.dueAtMs;
    }
    return dueAt;
  }

  cancelSubject(subject: string): number {
    const before = this.#heap.length;
    const kept = this.#heap.filter((e) => e.subject !== subject);
    if (kept.length === before) return 0;
    this.#heap = [];
    for (const event of kept) this.#push(event);
    return before - kept.length;
  }

  deferOverdue(untilMs: number): number {
    let deferred = 0;
    const rescheduled = this.#heap.map((event) => {
      if (event.dueAtMs >= untilMs) return event;
      deferred++;
      return { ...event, dueAtMs: untilMs };
    });
    if (deferred === 0) return 0;
    this.#heap = [];
    for (const event of rescheduled) this.#push(event);
    return deferred;
  }

  #push(event: ScheduledEvent): void {
    this.#heap.push(event);
    let index = this.#heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.#before(this.#heap[index] as ScheduledEvent, this.#heap[parent] as ScheduledEvent)) return;
      [this.#heap[index], this.#heap[parent]] = [this.#heap[parent] as ScheduledEvent, this.#heap[index] as ScheduledEvent];
      index = parent;
    }
  }

  #siftDown(from: number): void {
    let index = from;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.#heap.length &&
        this.#before(this.#heap[left] as ScheduledEvent, this.#heap[smallest] as ScheduledEvent)) smallest = left;
      if (right < this.#heap.length &&
        this.#before(this.#heap[right] as ScheduledEvent, this.#heap[smallest] as ScheduledEvent)) smallest = right;
      if (smallest === index) return;
      [this.#heap[index], this.#heap[smallest]] = [this.#heap[smallest] as ScheduledEvent, this.#heap[index] as ScheduledEvent];
      index = smallest;
    }
  }
}

describe('equivalência com a fila de antes do cancelamento preguiçoso (#827)', () => {
  const KINDS = ['step', 'attack', 'defense', 'expire'];
  // Poucos subjects e instantes curtos: é o que força empate, cancelamento que acerta e reagendamento.
  const FEW_SUBJECTS = ['', 'm:1', 'm:2', 'm:3', 'm:10', 'c:1', 'c:2'];
  // Passa de 64 pares `(kind, subject)`, que é onde a fila varre os pares ociosos: com poucos
  // subjects a varredura nunca roda, e o que ela faz com um par vivo ficaria sem teste.
  const MANY_SUBJECTS = Array.from({ length: 150 }, (_, i) => `m:${i}`);
  const SUBJECTS = FEW_SUBJECTS;
  const view = (e: ScheduledEvent | undefined): string | undefined =>
    e === undefined ? undefined : `${e.dueAtMs}/${e.priority}/${e.subject}/${e.kind}/${e.seq}`;

  const pools = [['poucos', FEW_SUBJECTS], ['muitos', MANY_SUBJECTS]] as const;
  // Os três regimes da fila: sempre indexada, indexada acima de 12 eventos (a fila cruza o limiar
  // nos dois sentidos), e a pequena de verdade, que nunca indexa.
  const regimes: readonly (readonly [string, ScheduleOptions])[] = [
    ['indexada', { indexAbove: 0 }], ['limiar 12', { indexAbove: 12 }], ['pequena', {}],
  ];
  const cases = pools.flatMap(([poolName, pool]) =>
    regimes.flatMap(([regimeName, regime]) =>
      (['insertion', 'stable'] as const).map((tieBreak) => ({ tieBreak, poolName, pool, regimeName, regime }))));
  for (const { tieBreak, poolName, pool, regimeName, regime } of cases) {
    it(`${tieBreak}, ${poolName} subjects, fila ${regimeName}: sequências aleatórias dão a mesma ordem de despacho e as mesmas respostas`, () => {
      const before = tieBreak === 'stable' ? comesFirstStable : comesFirst;
      const options: ScheduleOptions = { tieBreak, ...regime };
      let tombstonesSeen = 0;
      let compactions = 0;
      let indexBuilt = 0;
      let indexDropped = 0;
      let where = '';
      // `expect` por operação custaria meio milhão de chamadas; só se constrói a mensagem (e só se
      // chama o `expect`) quando as duas filas divergem.
      const same = (actual: unknown, expected: unknown, what: string): void => {
        if (actual !== expected) expect(actual, `${where} ${what}`).toBe(expected);
      };
      for (let seed = 0; seed < 20; seed++) {
        const rng = Rng.fromSeed(`oracle-${tieBreak}-${poolName}-${regimeName}-${seed}`);
        const pick = <T>(items: readonly T[]): T => items[rng.integer(0, items.length - 1)] as T;
        let oracle = new LegacySchedule(before);
        let fresh = new Schedule(options);
        let nowMs = 0;
        for (let step = 0; step < 1000; step++) {
          const roll = rng.integer(0, 99);
          where = `${tieBreak} ${poolName} ${regimeName} seed ${seed} step ${step}`;
          const tombstonesBefore = fresh.tombstones;
          const indexedBefore = fresh.indexed;
          if (roll < 42) {
            const kind = pick(KINDS);
            const eventOptions = { subject: pick(pool), priority: rng.integer(0, 4) };
            const dueAtMs = nowMs + rng.integer(0, 40);
            same(view(fresh.schedule(kind, dueAtMs, eventOptions)), view(oracle.schedule(kind, dueAtMs, eventOptions)), 'schedule');
          } else if (roll < 56) {
            const kind = pick(KINDS);
            const subject = pick(pool);
            same(fresh.cancel(kind, subject), oracle.cancel(kind, subject), 'cancel');
          } else if (roll < 64) {
            const subject = pick(pool);
            same(fresh.cancelSubject(subject), oracle.cancelSubject(subject), 'cancelSubject');
          } else if (roll < 86) {
            const expected = oracle.pop();
            same(view(fresh.pop()), view(expected), 'pop');
            if (expected !== undefined) nowMs = Math.max(nowMs, expected.dueAtMs);
          } else if (roll < 91) {
            same(view(fresh.peek()), view(oracle.peek()), 'peek');
          } else if (roll < 95) {
            const kind = pick(KINDS);
            const subject = pick(pool);
            same(fresh.dueAtOf(kind, subject), oracle.dueAtOf(kind, subject), 'dueAtOf');
          } else if (roll < 98) {
            const untilMs = nowMs + rng.integer(0, 30);
            same(fresh.deferOverdue(untilMs), oracle.deferOverdue(untilMs), 'deferOverdue');
          } else if (roll < 99) {
            // Vai e volta pelo JSON, como o snapshot: a fila nova tem de continuar igual.
            const state = JSON.parse(JSON.stringify(oracle.getState())) as ScheduleState;
            const freshState = JSON.parse(JSON.stringify(fresh.getState())) as ScheduleState;
            expect(freshState, where).toEqual(tieBreak === 'stable' ? { ...state, tieBreak: 'stable' } : state);
            oracle = LegacySchedule.fromState(state, before);
            fresh = Schedule.fromState(freshState, options);
          } else {
            // Rajada: esvazia a fila quase toda, para a indexada cruzar o limiar para baixo.
            const keep = rng.integer(0, 3);
            while (oracle.size > keep) {
              const expected = oracle.pop();
              same(view(fresh.pop()), view(expected), 'burst pop');
              if (expected !== undefined) nowMs = Math.max(nowMs, expected.dueAtMs);
            }
          }
          same(fresh.size, oracle.size, 'size');
          same(fresh.tombstones >= 0, true, 'tombstones >= 0');
          if (fresh.tombstones > 0) tombstonesSeen++;
          // Um cancelamento que DIMINUI as lápides é uma compactação.
          if (roll >= 42 && roll < 64 && fresh.tombstones < tombstonesBefore) compactions++;
          if (!indexedBefore && fresh.indexed) indexBuilt++;
          if (indexedBefore && !fresh.indexed) indexDropped++;
        }
        // O que sobra despacha igual, até o fim — incluindo o `seq`.
        where = `${tieBreak} ${poolName} ${regimeName} seed ${seed} drain`;
        for (;;) {
          const expected = oracle.pop();
          same(view(fresh.pop()), view(expected), 'pop');
          if (expected === undefined) break;
        }
        expect(fresh.size).toBe(0);
        // Fila vazia não guarda lápide nenhuma: toda a contabilidade fechou.
        expect(fresh.tombstones).toBe(0);
      }
      // A sequência aleatória de fato exercitou o que se quer provar — senão o teste prova nada.
      if (regimeName === 'pequena') {
        expect(tombstonesSeen).toBe(0);
        expect(indexBuilt).toBe(0);
      } else {
        expect(tombstonesSeen).toBeGreaterThan(500);
        // Com 150 subjects o cancelamento raramente acerta mais da metade do heap: só o pool pequeno compacta.
        if (poolName === 'poucos') expect(compactions).toBeGreaterThan(20);
      }
      if (regimeName === 'limiar 12') {
        expect(indexBuilt).toBeGreaterThan(20);
        expect(indexDropped).toBeGreaterThan(20);
      }
    });
  }

  it('o estado de uma fila com cancelamentos é idêntico ao da antiga, evento por evento', () => {
    const rng = Rng.fromSeed('oracle-state');
    const oracle = new LegacySchedule();
    const fresh = new Schedule();
    for (let i = 0; i < 400; i++) {
      const kind = KINDS[rng.integer(0, 3)] as string;
      const options = { subject: SUBJECTS[rng.integer(0, 6)] as string, priority: rng.integer(0, 4) };
      const dueAtMs = rng.integer(0, 200);
      oracle.schedule(kind, dueAtMs, options);
      fresh.schedule(kind, dueAtMs, options);
      if (i % 9 === 0) {
        const subject = SUBJECTS[rng.integer(0, 6)] as string;
        oracle.cancelSubject(subject);
        fresh.cancelSubject(subject);
      }
    }
    expect(JSON.stringify(fresh.getState())).toBe(JSON.stringify(oracle.getState()));
  });
});
