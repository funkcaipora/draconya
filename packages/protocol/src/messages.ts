// Fonte única do protocolo. Este é o ÚNICO arquivo do repositório onde um opcode aparece
// (invariante 5). As tabelas de tradução por direção são derivadas daqui, nunca escritas à mão.
//
// REGRA QUE NÃO PODE SER QUEBRADA: opcode nunca é reciclado. Mensagem removida deixa o número
// queimado, listado abaixo. Reaproveitar um número faz um cliente antigo interpretar a mensagem
// nova como a velha — e o sintoma aparece longe da causa.

export const CLIENT_TO_SERVER = {
  authenticate: 1,
  ping: 2,
  'client-ready': 3,
  'session-attach': 4,
  walk: 5,
  'walk-to': 6,
  say: 7,
  logout: 8,
} as const;

export const SERVER_TO_CLIENT = {
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
export const BURNED_OPCODES_C2S: readonly number[] = [];
export const BURNED_OPCODES_S2C: readonly number[] = [];

export type C2SName = keyof typeof CLIENT_TO_SERVER;
export type S2CName = keyof typeof SERVER_TO_CLIENT;

function invert(map: Record<string, number>): ReadonlyMap<number, string> {
  const inverted = new Map<number, string>();
  for (const [name, opcode] of Object.entries(map)) {
    const existing = inverted.get(opcode);
    if (existing !== undefined) {
      throw new Error(`opcode ${opcode} duplicated between "${existing}" and "${name}"`);
    }
    inverted.set(opcode, name);
  }
  return inverted;
}

export const OPCODE_TO_NAME_C2S = invert(CLIENT_TO_SERVER);
export const OPCODE_TO_NAME_S2C = invert(SERVER_TO_CLIENT);
