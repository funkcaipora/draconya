import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STEP_MS, WalkKeys, directionOf, nextWalkDelay } from './walk-keys.js';

/** `city/city.json` do conteúdo real, lido do disco como `walls.test.ts` lê o mapa. */
const city = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data', 'city', 'city.json'),
  'utf8',
)) as { stepDurationMs: number };

describe('directionOf (FUN-122)', () => {
  it('setas e WASD, pelas quatro cardeais, e mais nada', () => {
    expect(directionOf('ArrowUp')).toBe('north');
    expect(directionOf('KeyW')).toBe('north');
    expect(directionOf('ArrowRight')).toBe('east');
    expect(directionOf('KeyD')).toBe('east');
    expect(directionOf('ArrowDown')).toBe('south');
    expect(directionOf('KeyS')).toBe('south');
    expect(directionOf('ArrowLeft')).toBe('west');
    expect(directionOf('KeyA')).toBe('west');
    expect(directionOf('Space')).toBeNull();
    expect(directionOf('KeyQ')).toBeNull();
  });
});

describe('WalkKeys (FUN-122)', () => {
  it('a última tecla pressionada vence, e soltar volta para a que continua presa', () => {
    const keys = new WalkKeys();
    expect(keys.press('ArrowUp')).toBe('north');
    expect(keys.press('ArrowRight')).toBe('east');
    expect(keys.active).toBe('east');
    expect(keys.release('ArrowRight')).toBe('north');
    expect(keys.release('ArrowUp')).toBeNull();
  });

  it('duas teclas presas nunca dão diagonal: é uma direção por vez, como no Huntera', () => {
    const keys = new WalkKeys();
    keys.press('KeyW');
    keys.press('KeyD');
    expect(['north', 'east', 'south', 'west']).toContain(keys.active);
    expect(keys.active).toBe('east');
  });

  it('o auto-repeat do sistema não muda a ordem', () => {
    const keys = new WalkKeys();
    keys.press('ArrowUp');
    keys.press('ArrowLeft');
    keys.press('ArrowUp'); // repetição da tecla já presa
    expect(keys.active).toBe('north');
    keys.release('ArrowUp');
    expect(keys.active).toBe('west');
  });

  it('duas teclas para a MESMA direção são duas teclas: soltar uma não para quem segura a outra', () => {
    // ↑ e W são ambas "norte". Soltar ↑ com W presa continua andando; soltar as duas para.
    const keys = new WalkKeys();
    keys.press('ArrowUp');
    keys.press('KeyW');
    expect(keys.active).toBe('north');
    expect(keys.release('ArrowUp')).toBe('north');
    expect(keys.release('KeyW')).toBeNull();
  });

  it('soltar uma tecla que nunca desceu aqui não mexe em nada — o keydown dela foi de quem digitava', () => {
    // Segurando ↑ e digitando "w" num campo de texto: o keydown do W é ignorado, o keyup chega.
    const keys = new WalkKeys();
    keys.press('ArrowUp');
    expect(keys.release('KeyW')).toBe('north');
    expect(keys.active).toBe('north');
  });

  it('tecla que não anda não mexe em nada; clear solta tudo', () => {
    const keys = new WalkKeys();
    keys.press('ArrowDown');
    expect(keys.press('KeyQ')).toBeNull();
    expect(keys.release('KeyQ')).toBe('south');
    keys.clear();
    expect(keys.active).toBeNull();
  });
});

describe('o passo de reserva (FUN-122)', () => {
  it('é o mesmo número do conteúdo da Cidade — copiado à mão, e por isso preso aqui', () => {
    expect(DEFAULT_STEP_MS).toBe(city.stepDurationMs);
  });
});

describe('nextWalkDelay (FUN-122)', () => {
  it('manda de novo quando o passo próprio acaba — o creature-move diz o ritmo', () => {
    // Enviado em 1000; o servidor respondeu com um passo de 150 ms que começou em 1020.
    expect(nextWalkDelay(1030, 1000, { startedAtMs: 1020, durationMs: 150 })).toBe(140);
  });

  it('um passo que acaba DEPOIS do intervalo de reserva ainda é esperado: mandar antes é recusado', () => {
    expect(nextWalkDelay(1030, 1000, { startedAtMs: 1100, durationMs: 150 })).toBe(220);
  });

  it('sem passo — parede à frente — manda de novo após o intervalo de reserva', () => {
    expect(nextWalkDelay(1030, 1000, null)).toBe(DEFAULT_STEP_MS - 30);
    expect(nextWalkDelay(1030, 1000, null, 500)).toBe(470);
  });

  it('um passo de ANTES do envio não conta como resposta', () => {
    expect(nextWalkDelay(1030, 1000, { startedAtMs: 900, durationMs: 150 })).toBe(120);
  });

  it('nunca zero nem negativo: um passo já acabado manda no próximo quadro', () => {
    expect(nextWalkDelay(2000, 1000, { startedAtMs: 1000, durationMs: 150 })).toBe(1);
  });
});
