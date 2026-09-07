import { describe, expect, it } from 'vitest';
import {
  CLIENTE_PARA_SERVIDOR, OPCODES_QUEIMADOS_C2S, OPCODES_QUEIMADOS_S2C,
  OPCODE_PARA_NOME_C2S, OPCODE_PARA_NOME_S2C, SERVIDOR_PARA_CLIENTE,
} from './mensagens.js';
import { ESQUEMAS_C2S, ESQUEMAS_S2C } from './tipos.js';

describe('mapa de opcodes', () => {
  it('não tem opcode duplicado', () => {
    expect(OPCODE_PARA_NOME_C2S.size).toBe(Object.keys(CLIENTE_PARA_SERVIDOR).length);
    expect(OPCODE_PARA_NOME_S2C.size).toBe(Object.keys(SERVIDOR_PARA_CLIENTE).length);
  });

  it('não reutiliza opcode queimado', () => {
    for (const op of OPCODES_QUEIMADOS_C2S) expect(OPCODE_PARA_NOME_C2S.has(op)).toBe(false);
    for (const op of OPCODES_QUEIMADOS_S2C) expect(OPCODE_PARA_NOME_S2C.has(op)).toBe(false);
  });

  it('toda mensagem declarada tem schema', () => {
    for (const nome of Object.keys(CLIENTE_PARA_SERVIDOR)) {
      expect(ESQUEMAS_C2S).toHaveProperty(nome);
    }
    for (const nome of Object.keys(SERVIDOR_PARA_CLIENTE)) {
      expect(ESQUEMAS_S2C).toHaveProperty(nome);
    }
  });

  it('todo schema corresponde a uma mensagem declarada', () => {
    for (const nome of Object.keys(ESQUEMAS_C2S)) {
      expect(CLIENTE_PARA_SERVIDOR).toHaveProperty(nome);
    }
    for (const nome of Object.keys(ESQUEMAS_S2C)) {
      expect(SERVIDOR_PARA_CLIENTE).toHaveProperty(nome);
    }
  });
});
