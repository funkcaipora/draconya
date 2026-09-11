import { describe, expect, it } from 'vitest';
import { decodeS2C, encodeS2C } from './codec.js';
import {
  CLIENT_TO_SERVER, BURNED_OPCODES_C2S, BURNED_OPCODES_S2C,
  OPCODE_TO_NAME_C2S, OPCODE_TO_NAME_S2C, SERVER_TO_CLIENT,
} from './messages.js';
import { C2S_SCHEMAS, S2C_SCHEMAS } from './types.js';
import type { S2CMessage } from './types.js';

describe('English payload contract', () => {
  it('accepts English directions and rejects the legacy payload', () => {
    expect(C2S_SCHEMAS.walk.safeParse({ direction: 'north' }).success).toBe(true);
    // Payload anterior à migração; não há tradução automática no contrato novo.
    expect(C2S_SCHEMAS.walk.safeParse(JSON.parse('{"direcao":"norte"}')).success).toBe(false);
  });
});

describe('opcode map', () => {
  it('has no duplicate opcode', () => {
    expect(OPCODE_TO_NAME_C2S.size).toBe(Object.keys(CLIENT_TO_SERVER).length);
    expect(OPCODE_TO_NAME_S2C.size).toBe(Object.keys(SERVER_TO_CLIENT).length);
  });

  it('does not reuse burned opcodes', () => {
    for (const op of BURNED_OPCODES_C2S) expect(OPCODE_TO_NAME_C2S.has(op)).toBe(false);
    for (const op of BURNED_OPCODES_S2C) expect(OPCODE_TO_NAME_S2C.has(op)).toBe(false);
  });

  it('every declared message has a schema', () => {
    for (const name of Object.keys(CLIENT_TO_SERVER)) {
      expect(C2S_SCHEMAS).toHaveProperty(name);
    }
    for (const name of Object.keys(SERVER_TO_CLIENT)) {
      expect(S2C_SCHEMAS).toHaveProperty(name);
    }
  });

  it('every schema corresponds to a declared message', () => {
    for (const name of Object.keys(C2S_SCHEMAS)) {
      expect(CLIENT_TO_SERVER).toHaveProperty(name);
    }
    for (const name of Object.keys(S2C_SCHEMAS)) {
      expect(SERVER_TO_CLIENT).toHaveProperty(name);
    }
  });
});

describe('combat presentation messages (FUN-109)', () => {
  const hit: S2CMessage = { type: 'creature-hit', id: 42, amount: 40, kind: 'spell' };
  const effect: S2CMessage = { type: 'effect', position: { x: 10, y: 9, z: 7 }, effectId: 13 };
  const missile: S2CMessage = {
    type: 'missile', from: { x: 10, y: 10, z: 7 }, to: { x: 10, y: 7, z: 7 }, missileId: 5,
  };

  it('round trips the hit, the effect and the missile through the codec', () => {
    // Três mensagens, e não uma: cada uma tem destino diferente no cliente, e um golpe de
    // corpo a corpo dispara duas enquanto uma magia dispara as três. O que se prende aqui é
    // que as três estão nas DUAS tabelas — opcode e schema — e sobrevivem ao fio inteiras.
    // Mutação que mata: apagar `missile: 19` de SERVER_TO_CLIENT (`decodeS2C` devolve `null`),
    // ou tirar `'spell'` do enum de `kind`.
    for (const message of [hit, effect, missile]) {
      expect(decodeS2C(encodeS2C(message))).toEqual([message]);
    }
  });

  it('is server-to-client only: the client sees the hit, it never reports one', () => {
    // Invariante 4. Se um dia alguém precisar mandar "acertei" do cliente, o lugar de
    // descobrir que isso é errado é aqui, e não na revisão do PR.
    // Mutação que mata: acrescentar `'creature-hit': 14` a CLIENT_TO_SERVER.
    for (const name of ['creature-hit', 'effect', 'missile']) {
      expect(CLIENT_TO_SERVER).not.toHaveProperty(name);
      expect(C2S_SCHEMAS).not.toHaveProperty(name);
    }
  });

  it('rejects a negative amount: healing is a kind, not a sign', () => {
    // Cura como "dano negativo" seria dois jeitos de dizer a mesma coisa, e o cliente tendo
    // de reconhecer os dois. Zero passa: o golpe absorvido pela armadura também aparece.
    // Mutação que mata: remover `.nonnegative()` de `amount` (o negativo passa a decodificar).
    expect(decodeS2C(encodeS2C({ ...hit, amount: -1 }))).toBeNull();
    expect(decodeS2C(encodeS2C({ ...hit, amount: 0 }))).toEqual([{ ...hit, amount: 0 }]);
  });

  it('rejects an unknown hit kind', () => {
    // O `kind` é o que decide a cor. Um valor fora da lista chegaria no cliente sem cor
    // nenhuma, e o número apareceria em branco sobre a criatura — ou não apareceria.
    // Mutação que mata: `z.enum([...])` → `z.string()` em `kind`.
    expect(decodeS2C(encodeS2C({ ...hit, kind: 'poison' as 'melee' }))).toBeNull();
  });

  it('rejects effectId and missileId of zero: there is no appearance zero', () => {
    // O protocolo não sabe o que o 13 desenha, mas sabe que zero não desenha nada — e uma
    // mensagem que manda desenhar nada é um bug do servidor que o cliente não deve esconder.
    // Mutação que mata: `.positive()` → `.nonnegative()` em `effectId` ou em `missileId`.
    expect(decodeS2C(encodeS2C({ ...effect, effectId: 0 }))).toBeNull();
    expect(decodeS2C(encodeS2C({ ...missile, missileId: 0 }))).toBeNull();
  });

  it('rejects a fractional id and a fractional amount: both are counted, never measured', () => {
    // `id` é a chave da criatura no cliente, e 1.5 não é chave de nada — a mensagem chegaria
    // e o número flutuaria sobre um tile vazio. `amount` é o que se desenha em cima da
    // criatura, e meio ponto de vida não existe: `resolveDamage` arredonda antes de emitir,
    // então uma fração aqui é o servidor mandando um número que ele mesmo nunca calculou.
    // Mutação que mata: remover `.int()` de `id` ou de `amount` em `creature-hit`.
    expect(decodeS2C(encodeS2C({ ...hit, id: 1.5 }))).toBeNull();
    expect(decodeS2C(encodeS2C({ ...hit, amount: 1.5 }))).toBeNull();
  });

  it('rejects an effect without position and a missile without origin', () => {
    // Sem `position`, o efeito não tem tile para nascer; sem `from`, o projétil não tem de
    // onde partir. Tornar qualquer um dos dois opcional seria admitir a mensagem que o
    // cliente não consegue desenhar — e o caso de "veio `missile` sem `from`" viraria um
    // estado possível, que é exatamente o que separar as três mensagens quis evitar.
    // A omissão é feita por cast porque `encodeS2C` não valida: só o decode confere o schema.
    // Mutação que mata: `position: Point.optional()` em `effect`, ou `from: Point.optional()`
    // em `missile`.
    const effectWithoutPosition = { type: 'effect', effectId: 13 } as S2CMessage;
    const missileWithoutFrom = {
      type: 'missile', to: { x: 10, y: 7, z: 7 }, missileId: 5,
    } as S2CMessage;
    expect(decodeS2C(encodeS2C(effectWithoutPosition))).toBeNull();
    expect(decodeS2C(encodeS2C(missileWithoutFrom))).toBeNull();
  });
});
