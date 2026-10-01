import { describe, expect, it } from 'vitest';
import type { CreatureVoices } from '@draconya/protocol';
import {
  SPEECH_COLOR, SPEECH_MIN_MS, SPEECH_MS_PER_CHARACTER, monsterAwake, rollSpeech, speechDurationMs,
  speechHeard, startSpeech,
} from './speech.js';

// A fala periódica do monstro (#620): o relógio e o sorteio são do CLIENTE. O `random` é injetado —
// nenhum destes testes toca o `Rng` da sessão, porque ele não existe aqui.

const VOICES: CreatureVoices = {
  intervalMs: 5000, chance: 10,
  lines: [{ text: 'Meep!' }, { text: 'FCHHHHH', yell: true }, { text: 'Fchu?' }],
};

/** Um `random` que devolve cada valor da lista, em ordem, e lança se pedirem um a mais. */
function sequence(...values: number[]): () => number {
  let next = 0;
  return () => {
    const value = values[next];
    if (value === undefined) throw new Error('random: pediram mais números do que o teste deu');
    next += 1;
    return value;
  };
}

/** Rola com o monstro acordado, que é o caso de quase todo teste do relógio. */
const awakeRoll = (
  state: ReturnType<typeof startSpeech>, nowMs: number, random: () => number, voices: CreatureVoices = VOICES,
) => rollSpeech(voices, state, nowMs, true, random);

describe('startSpeech', () => {
  it('o relógio nasce zerado, como o `yellTicks` do Canary', () => {
    expect(startSpeech(1000)).toEqual({ elapsedMs: 0, lastMs: 1000 });
  });
});

describe('rollSpeech', () => {
  it('antes do intervalo não rola e não gasta sorteio nenhum', () => {
    const state = startSpeech(0);
    const random = sequence(); // qualquer chamada lança
    expect(awakeRoll(state, 0, random)).toBeNull();
    expect(awakeRoll(state, 4999, random)).toBeNull();
    expect(state.elapsedMs).toBe(4999);
  });

  it('no intervalo rola `uniform(1, 100) <= chance`: 10 passa, 11 não — a fronteira é do Canary', () => {
    // `chance >= uniform_random(1, 100)` em `Monster::onThinkYell`. `random` 0.095 → roll 10; 0.105 → roll 11.
    // Mutação que mata: `<` no lugar de `<=`, ou rolar de 0 a 99.
    const passa = startSpeech(0);
    expect(awakeRoll(passa, 5000, sequence(0.095, 0))).toEqual({ text: 'Meep!', yell: false });
    const falha = startSpeech(0);
    expect(awakeRoll(falha, 5000, sequence(0.105))).toBeNull();
  });

  it('chance 100 sempre fala; a chance pega o 1 e o 100', () => {
    const sempre: CreatureVoices = { ...VOICES, chance: 100 };
    expect(awakeRoll(startSpeech(0), 5000, sequence(0.999, 0), sempre)).not.toBeNull();
    expect(awakeRoll(startSpeech(0), 5000, sequence(0, 0), sempre)).not.toBeNull();
  });

  it('a linha é sorteada por igual, e `yell` só sai na que é grito', () => {
    const always: CreatureVoices = { ...VOICES, chance: 100 };
    const say = (draw: number) => awakeRoll(startSpeech(0), 5000, sequence(0, draw), always);
    expect(say(0)).toEqual({ text: 'Meep!', yell: false });
    expect(say(0.34)).toEqual({ text: 'FCHHHHH', yell: true });
    expect(say(0.67)).toEqual({ text: 'Fchu?', yell: false });
    // O teto do sorteio nunca sai da lista, mesmo com um `random` que devolva 1 por arredondamento.
    expect(say(0.999999)).toEqual({ text: 'Fchu?', yell: false });
  });

  it('vencer zera: um quadro atrasado rola UMA vez, não uma por intervalo perdido', () => {
    // A aba ficou dez minutos em segundo plano; ao voltar, o monstro não fala cento e vinte vezes.
    // É o `yellTicks = 0` do Canary. Mutação que mata: `elapsedMs -= intervalMs`.
    const state = startSpeech(0);
    awakeRoll(state, 600_000, sequence(0.5));
    expect(state.elapsedMs).toBe(0);
    expect(awakeRoll(state, 600_001, sequence())).toBeNull();
  });

  it('roda de novo a cada intervalo, passando ou não', () => {
    const state = startSpeech(0);
    const random = sequence(0.5, 0.05, 0, 0.5);
    expect(awakeRoll(state, 5000, random)).toBeNull();           // venceu, não passou
    expect(awakeRoll(state, 10_000, random)).toEqual({ text: 'Meep!', yell: false }); // venceu e passou
    expect(awakeRoll(state, 15_000, random)).toBeNull();         // venceu, não passou
  });

  it('o monstro OCIOSO não acumula: o relógio para e não gasta sorteio (`isIdle` corta o `onThinkYell`)', () => {
    // O Canary tira o monstro ocioso da lista de `onThink`: o `yellTicks` não anda. Aqui, 60 s
    // dormindo não fazem o monstro falar no instante em que acorda.
    // Mutação que mata: acumular `elapsedMs` antes do `if (!awake)`.
    const state = startSpeech(0);
    const random = sequence(); // qualquer sorteio lança
    for (let t = 1000; t <= 60_000; t += 1000) expect(rollSpeech(VOICES, state, t, false, random)).toBeNull();
    expect(state.elapsedMs).toBe(0);
    expect(rollSpeech(VOICES, state, 60_001, true, random)).toBeNull();
  });

  it('acordar NÃO zera o relógio: o que já tinha corrido fica, e só o tempo acordado soma', () => {
    // 3 s acordado, 20 s ocioso e mais 2 s acordado: são 5 s de monstro acordado, e rola — o
    // `yellTicks` do Canary segue de onde parou. Mutação que mata: zerar `elapsedMs` ao dormir
    // (não rolaria aos 5 s acordado), ou somar o tempo ocioso (rolaria já ao acordar).
    const state = startSpeech(0);
    const random = sequence(0.5);
    expect(rollSpeech(VOICES, state, 3000, true, random)).toBeNull();
    expect(rollSpeech(VOICES, state, 23_000, false, random)).toBeNull();
    expect(state.elapsedMs).toBe(3000);
    expect(rollSpeech(VOICES, state, 24_000, true, random)).toBeNull();
    expect(state.elapsedMs).toBe(4000);
    // Venceu aos 5 s acordado; `random` 0.5 é roll 51, que não passa de 10.
    expect(rollSpeech(VOICES, state, 25_000, true, random)).toBeNull();
    expect(state.elapsedMs).toBe(0);
  });
});

describe('monsterAwake: o herói no quadrado de 11 tiles que o monstro enxerga (`Creature::canSee`)', () => {
  const monster = { x: 100, y: 100, z: 7 };

  it('11 tiles acorda, 12 não — nos dois eixos, e a fronteira é inclusiva', () => {
    expect(monsterAwake(monster, { x: 111, y: 100, z: 7 })).toBe(true);
    expect(monsterAwake(monster, { x: 112, y: 100, z: 7 })).toBe(false);
    expect(monsterAwake(monster, { x: 89, y: 100, z: 7 })).toBe(true);
    expect(monsterAwake(monster, { x: 88, y: 100, z: 7 })).toBe(false);
    expect(monsterAwake(monster, { x: 100, y: 111, z: 7 })).toBe(true);
    expect(monsterAwake(monster, { x: 100, y: 112, z: 7 })).toBe(false);
    expect(monsterAwake(monster, { x: 100, y: 89, z: 7 })).toBe(true);
    expect(monsterAwake(monster, { x: 100, y: 88, z: 7 })).toBe(false);
    // O canto do quadrado: Chebyshev, não euclidiana.
    expect(monsterAwake(monster, { x: 111, y: 111, z: 7 })).toBe(true);
  });

  it('de superfície não se enxerga o subsolo; do subsolo, só até dois andares', () => {
    expect(monsterAwake({ x: 100, y: 100, z: 7 }, { x: 100, y: 100, z: 8 })).toBe(false);
    expect(monsterAwake({ x: 100, y: 100, z: 6 }, { x: 100, y: 100, z: 9 })).toBe(false);
    expect(monsterAwake({ x: 100, y: 100, z: 9 }, { x: 100, y: 100, z: 11 })).toBe(true);
    expect(monsterAwake({ x: 100, y: 100, z: 9 }, { x: 100, y: 100, z: 12 })).toBe(false);
    expect(monsterAwake({ x: 100, y: 100, z: 9 }, { x: 100, y: 100, z: 7 })).toBe(true);
    expect(monsterAwake({ x: 100, y: 100, z: 9 }, { x: 100, y: 100, z: 6 })).toBe(false);
  });

  it('a caixa desliza `monster.z - hero.z` tiles por andar (a perspectiva do cliente)', () => {
    // Monstro no andar 7, herói no 6: offsetZ = 1, então o herói vê de x−10 a x+12.
    expect(monsterAwake(monster, { x: 112, y: 100, z: 6 })).toBe(true);
    expect(monsterAwake(monster, { x: 113, y: 100, z: 6 })).toBe(false);
    expect(monsterAwake(monster, { x: 89, y: 100, z: 6 })).toBe(false);
    expect(monsterAwake(monster, { x: 90, y: 100, z: 6 })).toBe(true);
  });
});

describe('speechHeard: quem ouve a fala (`Game::internalCreatureSay`)', () => {
  const monster = { x: 100, y: 100, z: 7 };

  it('o `say` chega a 8 colunas e 6 linhas: 8 ouve, 9 não; 6 ouve, 7 não', () => {
    // Mutação que mata: usar o quadrado de 11 (o do `canSee`) ou o do grito no `say`.
    expect(speechHeard(monster, { x: 108, y: 100, z: 7 }, false)).toBe(true);
    expect(speechHeard(monster, { x: 109, y: 100, z: 7 }, false)).toBe(false);
    expect(speechHeard(monster, { x: 92, y: 100, z: 7 }, false)).toBe(true);
    expect(speechHeard(monster, { x: 91, y: 100, z: 7 }, false)).toBe(false);
    expect(speechHeard(monster, { x: 100, y: 106, z: 7 }, false)).toBe(true);
    expect(speechHeard(monster, { x: 100, y: 107, z: 7 }, false)).toBe(false);
    expect(speechHeard(monster, { x: 100, y: 94, z: 7 }, false)).toBe(true);
    expect(speechHeard(monster, { x: 100, y: 93, z: 7 }, false)).toBe(false);
    // O canto: 8 × 6 inclusive.
    expect(speechHeard(monster, { x: 108, y: 106, z: 7 }, false)).toBe(true);
  });

  it('o `say` só chega no MESMO andar', () => {
    expect(speechHeard(monster, { x: 100, y: 100, z: 6 }, false)).toBe(false);
    expect(speechHeard(monster, { x: 100, y: 100, z: 8 }, false)).toBe(false);
  });

  it('o `yell` chega a 18 colunas e 14 linhas: 18 ouve, 19 não; 14 ouve, 15 não', () => {
    expect(speechHeard(monster, { x: 118, y: 100, z: 7 }, true)).toBe(true);
    expect(speechHeard(monster, { x: 119, y: 100, z: 7 }, true)).toBe(false);
    expect(speechHeard(monster, { x: 82, y: 100, z: 7 }, true)).toBe(true);
    expect(speechHeard(monster, { x: 81, y: 100, z: 7 }, true)).toBe(false);
    expect(speechHeard(monster, { x: 100, y: 114, z: 7 }, true)).toBe(true);
    expect(speechHeard(monster, { x: 100, y: 115, z: 7 }, true)).toBe(false);
    expect(speechHeard(monster, { x: 100, y: 86, z: 7 }, true)).toBe(true);
    expect(speechHeard(monster, { x: 100, y: 85, z: 7 }, true)).toBe(false);
  });

  it('o `yell` atravessa andares — da superfície a dois abaixo dela —, e a caixa desliza por andar', () => {
    // Monstro no 7: chega de 0 a 9. O herói no 9 está a offsetZ = monstro − herói = −2, e a
    // caixa dele vai de x−2−18 a x−2+18 (`cpos.x − offsetZ` dentro de `x ± 18`).
    expect(speechHeard(monster, { x: 100, y: 100, z: 9 }, true)).toBe(true);
    expect(speechHeard(monster, { x: 100, y: 100, z: 10 }, true)).toBe(false);
    expect(speechHeard(monster, { x: 116, y: 100, z: 9 }, true)).toBe(true);
    expect(speechHeard(monster, { x: 117, y: 100, z: 9 }, true)).toBe(false);
    expect(speechHeard(monster, { x: 80, y: 100, z: 9 }, true)).toBe(true);
    expect(speechHeard(monster, { x: 79, y: 100, z: 9 }, true)).toBe(false);
    // O herói no 5 tem offsetZ = +2: a caixa vai de x+2−18 a x+2+18.
    expect(speechHeard(monster, { x: 120, y: 100, z: 5 }, true)).toBe(true);
    expect(speechHeard(monster, { x: 121, y: 100, z: 5 }, true)).toBe(false);
    expect(speechHeard(monster, { x: 84, y: 100, z: 5 }, true)).toBe(true);
    expect(speechHeard(monster, { x: 83, y: 100, z: 5 }, true)).toBe(false);
  });

  it('o `yell` do subsolo alcança dois andares acima e dois abaixo, e do andar 6 só até o 8', () => {
    const underground = { x: 100, y: 100, z: 9 };
    expect(speechHeard(underground, { x: 100, y: 100, z: 7 }, true)).toBe(true);
    expect(speechHeard(underground, { x: 100, y: 100, z: 11 }, true)).toBe(true);
    expect(speechHeard(underground, { x: 100, y: 100, z: 12 }, true)).toBe(false);
    expect(speechHeard(underground, { x: 100, y: 100, z: 6 }, true)).toBe(false);
    const six = { x: 100, y: 100, z: 6 };
    expect(speechHeard(six, { x: 100, y: 100, z: 8 }, true)).toBe(true);
    expect(speechHeard(six, { x: 100, y: 100, z: 9 }, true)).toBe(false);
    // Mais acima da superfície só a superfície: o andar 4 não ouve o subsolo.
    const high = { x: 100, y: 100, z: 4 };
    expect(speechHeard(high, { x: 100, y: 100, z: 7 }, true)).toBe(true);
    expect(speechHeard(high, { x: 100, y: 100, z: 8 }, true)).toBe(false);
  });
});

describe('a apresentação da fala', () => {
  it('a cor é o laranja do índice 198 da paleta de 216 cores — escolha do cliente, não do Canary', () => {
    expect(SPEECH_COLOR).toBe(0xff9900);
  });

  it('o balão fica um mínimo na tela, e a fala longa ganha mais tempo', () => {
    expect(speechDurationMs('')).toBe(SPEECH_MIN_MS);
    expect(speechDurationMs('abcd')).toBe(SPEECH_MIN_MS + 4 * SPEECH_MS_PER_CHARACTER);
    expect(speechDurationMs('a'.repeat(40))).toBeGreaterThan(speechDurationMs('a'.repeat(4)));
  });
});
