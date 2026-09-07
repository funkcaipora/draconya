// Fonte única do protocolo. Este é o ÚNICO arquivo do repositório onde um opcode aparece
// (invariante 5). As tabelas de tradução por direção são derivadas daqui, nunca escritas à mão.
//
// REGRA QUE NÃO PODE SER QUEBRADA: opcode nunca é reciclado. Mensagem removida deixa o número
// queimado, listado abaixo. Reaproveitar um número faz um cliente antigo interpretar a mensagem
// nova como a velha — e o sintoma aparece longe da causa.

export const CLIENTE_PARA_SERVIDOR = {
  authenticate: 1,
  ping: 2,
  'client-ready': 3,
  'session-attach': 4,
  walk: 5,
  'walk-to': 6,
  say: 7,
  logout: 8,
} as const;

export const SERVIDOR_PARA_CLIENTE = {
  pong: 1,
  welcome: 2,
  'session-state': 3,
  'instance-enter': 4,
  'creature-appear': 5,
  'creature-move': 6,
  'creature-disappear': 7,
  'creature-health': 8,
  'player-stats': 9,
  'experience-gain': 10,
  'system-message': 11,
  'chat-message': 12,
} as const;

/** Números que já pertenceram a uma mensagem removida. Nunca reutilize. */
export const OPCODES_QUEIMADOS_C2S: readonly number[] = [];
export const OPCODES_QUEIMADOS_S2C: readonly number[] = [];

export type NomeC2S = keyof typeof CLIENTE_PARA_SERVIDOR;
export type NomeS2C = keyof typeof SERVIDOR_PARA_CLIENTE;

function inverter(mapa: Record<string, number>): ReadonlyMap<number, string> {
  const invertido = new Map<number, string>();
  for (const [nome, opcode] of Object.entries(mapa)) {
    const existente = invertido.get(opcode);
    if (existente !== undefined) {
      throw new Error(`opcode ${opcode} duplicado entre "${existente}" e "${nome}"`);
    }
    invertido.set(opcode, nome);
  }
  return invertido;
}

export const OPCODE_PARA_NOME_C2S = inverter(CLIENTE_PARA_SERVIDOR);
export const OPCODE_PARA_NOME_S2C = inverter(SERVIDOR_PARA_CLIENTE);
