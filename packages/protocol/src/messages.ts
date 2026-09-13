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
  'enter-hunt': 9,
  'leave-hunt': 10,
  'bot-config': 11,
  equip: 12,
  unequip: 13,
  'select-ammo': 14,
  /** Escolher a vocação (#154, ADR 0026 decisão 1). 15: o 14 foi do `select-ammo` (#152). */
  'choose-vocation': 15,
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
  'session-ended': 13,
  /**
   * O catálogo do que existe: hunts (FUN-79) e vocabulário do bot (FUN-89).
   *
   * **Uma mensagem, e não duas.** As duas telas perguntam a mesma coisa — "o que este servidor
   * tem" —, chegam no mesmo instante e mudam pela mesma razão (a versão de conteúdo, que é
   * fixada na sessão). Separar daria dois pacotes que nunca aparecem um sem o outro.
   *
   * Nasceu como `hunt-catalogue` e foi generalizada no mesmo dia, antes de a UI do bot existir.
   * O opcode não muda: é o mesmo assunto, com mais dentro.
   */
  catalogue: 14,
  'bot-config-result': 15,
  inventory: 16,
  /**
   * O que o combate MOSTRA (FUN-109): o número que flutua sobre a criatura, a animação no
   * tile e o projétil de A a B.
   *
   * **Três mensagens, e não uma com campos opcionais.** Cada uma tem destino diferente no
   * cliente — o número vai na criatura, o efeito vai no tile, o projétil vai entre dois —, e
   * uma magia dispara as três de uma vez enquanto um golpe de corpo a corpo dispara duas.
   * Uma mensagem só faria o cliente inspecionar quais campos vieram para decidir o que
   * desenhar, e a combinação "veio `missile` sem `to`" passaria a ser um estado possível.
   *
   * Só S2C, de propósito (invariante 4): o cliente não diz "acertei 40", ele vê que acertou.
   */
  'creature-hit': 17,
  effect: 18,
  missile: 19,
  /**
   * O analisador AO VIVO (§16.1): os agregados e os eventos notáveis da sessão, sempre que
   * um deles muda. Antes só saíam no `session-state` e no `session-ended`, e a janela ficava
   * em zero a hunt inteira — o loop que o M9 fecha não fechava na tela.
   */
  analyzer: 20,
  /**
   * O Bestiário do personagem (§18, FUN-113): quantos de cada monstro ele já abateu. Sai no
   * attach e sempre que um contador muda — é progressão permanente, e a tela precisa ver o
   * marco chegar.
   */
  bestiary: 21,
  /**
   * Um item no chão (FUN-123): hoje, o cadáver de um monstro — só visual, sem loot. Aparece
   * com posição e aparência, e some pelo id quando apodrece. Só S2C: o cliente não põe nada
   * no chão.
   */
  'ground-item-appear': 22,
  'ground-item-disappear': 23,
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
