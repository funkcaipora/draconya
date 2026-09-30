import { describe, expect, it } from 'vitest';
import type { CreatureVoices } from '@draconya/protocol';
import {
  SPEECH_COLOR, SPEECH_MIN_MS, SPEECH_MS_PER_CHARACTER, rollSpeech, speechDurationMs, startSpeech,
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

describe('startSpeech', () => {
  it('a primeira rolagem é daqui a `intervalMs`, como o `yellTicks` do Canary, que começa em zero', () => {
    expect(startSpeech(VOICES, 1000).nextAtMs).toBe(6000);
  });
});

describe('rollSpeech', () => {
  it('antes do intervalo não rola e não gasta sorteio nenhum', () => {
    const state = startSpeech(VOICES, 0);
    const random = sequence(); // qualquer chamada lança
    expect(rollSpeech(VOICES, state, 0, random)).toBeNull();
    expect(rollSpeech(VOICES, state, 4999, random)).toBeNull();
    expect(state.nextAtMs).toBe(5000);
  });

  it('no intervalo rola `uniform(1, 100) <= chance`: 10 passa, 11 não — a fronteira é do Canary', () => {
    // `chance >= uniform_random(1, 100)` em `Monster::onThinkYell`. `random` 0.095 → roll 10; 0.105 → roll 11.
    // Mutação que mata: `<` no lugar de `<=`, ou rolar de 0 a 99.
    const passa = startSpeech(VOICES, 0);
    expect(rollSpeech(VOICES, passa, 5000, sequence(0.095, 0))).toEqual({ text: 'Meep!', yell: false });
    const falha = startSpeech(VOICES, 0);
    expect(rollSpeech(VOICES, falha, 5000, sequence(0.105))).toBeNull();
  });

  it('chance 100 sempre fala; a chance pega o 1 e o 100', () => {
    const sempre: CreatureVoices = { ...VOICES, chance: 100 };
    expect(rollSpeech(sempre, startSpeech(sempre, 0), 5000, sequence(0.999, 0))).not.toBeNull();
    expect(rollSpeech(sempre, startSpeech(sempre, 0), 5000, sequence(0, 0))).not.toBeNull();
  });

  it('a linha é sorteada por igual, e `yell` só sai na que é grito', () => {
    const always: CreatureVoices = { ...VOICES, chance: 100 };
    const say = (draw: number) => rollSpeech(always, startSpeech(always, 0), 5000, sequence(0, draw));
    expect(say(0)).toEqual({ text: 'Meep!', yell: false });
    expect(say(0.34)).toEqual({ text: 'FCHHHHH', yell: true });
    expect(say(0.67)).toEqual({ text: 'Fchu?', yell: false });
    // O teto do sorteio nunca sai da lista, mesmo com um `random` que devolva 1 por arredondamento.
    expect(say(0.999999)).toEqual({ text: 'Fchu?', yell: false });
  });

  it('vencer zera a partir de AGORA: um quadro atrasado rola UMA vez, não uma por intervalo perdido', () => {
    // A aba ficou dez minutos em segundo plano; ao voltar, o monstro não fala cento e vinte vezes.
    // É o `yellTicks = 0` do Canary. Mutação que mata: `nextAtMs += intervalMs`.
    const state = startSpeech(VOICES, 0);
    rollSpeech(VOICES, state, 600_000, sequence(0.5));
    expect(state.nextAtMs).toBe(605_000);
    expect(rollSpeech(VOICES, state, 600_001, sequence())).toBeNull();
  });

  it('roda de novo a cada intervalo, passando ou não', () => {
    const state = startSpeech(VOICES, 0);
    const random = sequence(0.5, 0.05, 0, 0.5);
    expect(rollSpeech(VOICES, state, 5000, random)).toBeNull();           // venceu, não passou
    expect(rollSpeech(VOICES, state, 10_000, random)).toEqual({ text: 'Meep!', yell: false }); // venceu e passou
    expect(rollSpeech(VOICES, state, 15_000, random)).toBeNull();         // venceu, não passou
  });
});

describe('a apresentação da fala', () => {
  it('a cor é o laranja do `TEXTCOLOR_ORANGE` (198) da paleta de 216 cores', () => {
    expect(SPEECH_COLOR).toBe(0xff9900);
  });

  it('o balão fica um mínimo na tela, e a fala longa ganha mais tempo', () => {
    expect(speechDurationMs('')).toBe(SPEECH_MIN_MS);
    expect(speechDurationMs('abcd')).toBe(SPEECH_MIN_MS + 4 * SPEECH_MS_PER_CHARACTER);
    expect(speechDurationMs('a'.repeat(40))).toBeGreaterThan(speechDurationMs('a'.repeat(4)));
  });
});
