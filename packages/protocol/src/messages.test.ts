import { describe, expect, it } from 'vitest';
import {
  CLIENT_TO_SERVER, BURNED_OPCODES_C2S, BURNED_OPCODES_S2C,
  OPCODE_TO_NAME_C2S, OPCODE_TO_NAME_S2C, SERVER_TO_CLIENT,
} from './messages.js';
import { C2S_SCHEMAS, S2C_SCHEMAS } from './types.js';

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
