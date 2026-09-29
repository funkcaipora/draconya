import { describe, expect, it } from 'vitest';
import type { FieldSpec } from '@draconya/content';
import { Fields, fieldTileKey } from './fields.js';
import type { TileFieldState } from './fields.js';

// Os campos de tile (CMB-07): o índice por tile, a sobreposição e a serialização. O que este
// teste prende é a ESTRUTURA — a leitura é O(1) por tile e nenhum passo varre a lista.

const dot = (amount: number): FieldSpec['condition'] => ({
  key: 'fire', merge: 'refresh', durationMs: 5_000,
  effect: { kind: 'damage-over-time', amount, intervalMs: 1_000, damageType: 'fire' },
});

const field = (
  id: string, tiles: readonly { x: number; y: number; z: number }[], expiresAtMs = 5_000,
): TileFieldState => ({ id, tiles, expiresAtMs, condition: dot(10) });

const p = (x: number, y: number): { x: number; y: number; z: number } => ({ x, y, z: 7 });

describe('Fields', () => {
  it('indexa por tile: a leitura de um tile coberto é O(1), e fora dele é vazio', () => {
    const fields = new Fields();
    fields.apply(field('fire', [p(2, 2), p(3, 2)]));

    expect(fields.at(p(2, 2))?.id).toBe('fire');
    expect(fields.at(p(3, 2))?.id).toBe('fire');
    expect(fields.at(p(1, 1))).toBeNull();
    expect(fields.size).toBe(1);
  });

  it('na sobreposição, o campo mais RECENTE vence; remover o recente revela o anterior', () => {
    const fields = new Fields();
    fields.apply(field('first', [p(2, 2)]));
    fields.apply(field('second', [p(2, 2)]));

    expect(fields.at(p(2, 2))?.id).toBe('second');
    fields.remove('second');
    expect(fields.at(p(2, 2))?.id).toBe('first');
    fields.remove('first');
    expect(fields.at(p(2, 2))).toBeNull();
  });

  it('relançar o mesmo id devolve o anterior e reindexa os tiles (sem órfão)', () => {
    const fields = new Fields();
    const previous = fields.apply(field('fire', [p(2, 2)]));
    expect(previous).toBeNull();

    const again = fields.apply(field('fire', [p(4, 4)], 9_000));
    expect(again?.tiles).toEqual([p(2, 2)]);
    // O tile antigo não aponta mais para o campo; o novo aponta.
    expect(fields.at(p(2, 2))).toBeNull();
    expect(fields.at(p(4, 4))?.expiresAtMs).toBe(9_000);
    expect(fields.size).toBe(1);
  });

  it('serializa e volta o mesmo — a chave de tile é derivada dos tiles, não gravada', () => {
    const fields = new Fields();
    fields.apply(field('fire', [p(2, 2), p(3, 2)]));
    const restored = Fields.fromState(JSON.parse(JSON.stringify(fields.getState())) as TileFieldState[]);
    expect(restored.getState()).toEqual(fields.getState());
    expect(restored.at(p(2, 2))?.id).toBe('fire');
    expect(Fields.fromState(undefined).size).toBe(0);
  });

  it('a chave do tile distingue o andar', () => {
    expect(fieldTileKey(1, 2, 7)).not.toBe(fieldTileKey(1, 2, 6));
  });
});
