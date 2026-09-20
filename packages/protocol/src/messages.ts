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
  /**
   * Escolher a munição (#152, ADR 0026 decisão 3). INTENÇÃO: o cliente diz QUAL munição, e
   * quem decide se o level basta é o servidor (invariante 4). A escolha aparece de volta em
   * `player-stats.ammo`; a recusa vira `system-message`, como a de equipar.
   */
  'select-ammo': 14,
  /** Escolher a vocação (#154, ADR 0026 decisão 1). 15: o 14 é do `select-ammo` (#152). */
  'choose-vocation': 15,
  /** Mover um item entre lugares (#160, ADR 0026 decisão 6). */
  'move-item': 16,
  /**
   * Disparo manual de um slot da barra (AB-09, ADR 0032 d.3). INTENÇÃO: o cliente diz QUAL
   * slot; elegibilidade, estoque, mana, cooldown e recusa são do servidor (invariante 4).
   */
  'use-slot': 17,
  /**
   * Escolher o alvo no mundo/Batalha (AB-09, ADR 0032 d.5). INTENÇÃO: o cliente diz QUAL
   * criatura pelo id numérico do servidor; quem decide se é alvo válido é o servidor.
   */
  'select-target': 18,
  /**
   * O líder muda rateio, divisão de lucro, coleta ou venda automática EM TEMPO DE HUNT
   * (#393, ADR 0035 decisão 1). INTENÇÃO, sempre: um patch parcial — cada campo ausente
   * mantém o valor atual — e quem decide se quem mandou é o líder e se os ids do catálogo
   * existem é o servidor (invariante 4). Sucesso é `party-state` (v2) refletindo o estado
   * novo; recusa (`not-leader`, item fora do catálogo, `value: 0` na venda) é
   * `system-message` — não existe um `party-settings-result` dedicado, porque a tela já
   * reflete a verdade no próprio `party-state`, e não o eco do que foi mandado.
   *
   * 19: o 17 e o 18 são do `use-slot` e do `select-target` (AB-09), que chegaram antes.
   */
  'party-settings': 19,
  /**
   * A votação de encerrar a hunt para todos (#432, ADR 0032 decisão 14). INTENÇÃO, como tudo:
   * `approve: true` é o líder PROPOR (a proposta carrega o sim dele) e é o membro APROVAR a
   * proposta em curso; `approve: false` é recusar — derruba a votação e a sessão segue. Quem
   * decide se quem mandou pode propor é o servidor, dentro da sessão dona (invariante 4/9), e a
   * recusa vira `system-message`. Sair sozinho continua `leave-hunt` (10), livre.
   *
   * 20: o 19 é do `party-settings`.
   */
  'party-end-vote': 20,
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
  /**
   * A party (#196, ADR 0027; v2 no #393, ADR 0035). Quatro mensagens só S2C: quem está nela
   * (`party-state` — sai no attach e quando composição, liderança ou configuração mudam), o
   * que há na bolsa compartilhada (`party-bag` — a cada mudança), o que o settlement pagou
   * (`party-settlement` — a cada saída, no fim, ao desligar `splitLoot`, e a cada venda
   * automática) e — desde o #393 — como o Follow do bot está (`follow-state`, por
   * personagem). C2S: sair é `leave-hunt` (10); mudar configuração em tempo de hunt é
   * `party-settings` (19). Formar a party continua HTTP (ADR 0027 decisão 8).
   */
  'party-state': 24,
  'party-bag': 25,
  'party-settlement': 26,
  /**
   * Condições ativas do jogador (haste, buff, magic shield, cura ao longo do tempo).
   * Sai no attach/enter e sempre que as condições ativas mudam (aplicadas ou expiradas).
   */
  'active-conditions': 27,
  /**
   * O total de jogadores online, agregado entre todos os nós `game` (SV-07): cada nó publica,
   * no próprio batimento do diretório de sessões, quantos personagens distintos tem conectados
   * agora; quem manda esta mensagem já somou os nós vivos. Mandada a cada 30 s, para TODA
   * sessão hospedada neste nó — a barra do topo do kit (Hud.jsx:21) aparece tanto na Cidade
   * quanto na hunt.
   *
   * Não é comparada como `player-stats`/`analyzer`/`bestiary` (sem `sameX`): é republicada sem
   * checar se mudou. O próprio intervalo de 30 s já é o teto de banda que se aceita gastar com
   * isto, e guardar "o último valor mandado por VIEWER" custaria mais memória do que o campo
   * economiza em rede — um inteiro pequeno, a cada 30 s, para quem estiver conectado.
   */
  'player-count': 28,
  /**
   * O gasto de cada membro da party e a prévia do rateio do settlement (#354, SV-18): quanto
   * cada um já gastou em supply nesta sessão, e — em modo `shared` — quanto receberia se a
   * bolsa fosse liquidada AGORA. Broadcast, como `party-bag`: o Mapa de Capacidade do protocolo
   * (docs/reviews/kit-fidelity-audit-2026-09-16.md, AVISO 4) registra que `analyzer` — que TEM
   * `goldSpent` por participante — só vai a quem olha aquele personagem; "gasto de cada membro
   * visível a todos" não é ligar um campo, é agregar e mandar a TODOS os visualizadores, o que
   * só `party-bag`/`party-state`/`party-settlement` fazem hoje.
   */
  'party-spending': 29,
  /**
   * O estado de cada slot do conjunto ATIVO (AB-09, ADR 0032 d.3). Só S2C: a CONTAGEM não vem
   * aqui — ela é do `inventory` (invariante 4, o servidor manda o número, não a regra). Sai no
   * attach e quando o par `(state, reason)` de algum slot muda; o `remainingMs` é o instante da
   * entrega, e o cliente anima o cooldown localmente.
   */
  'slot-state': 30,
  /** A resposta ao `use-slot` (AB-09, ADR 0032 d.3): `ok:false` carrega o motivo para o tooltip. */
  'slot-result': 31,
  /**
   * O Follow do bot mudou de estado (#393, ADR 0035 decisão 9): ligou, desligou, ou foi
   * interrompido porque o alvo morreu, saiu ou ficou inalcançável. Por PERSONAGEM — cada
   * membro segue quem quiser. Nunca escolhe outro alvo sozinho: `active: false` é o fim da
   * história até o jogador escolher de novo (ou o mesmo alvo voltar a ser válido).
   *
   * 32: o 30 e o 31 são do `slot-state` e do `slot-result` (AB-09), que chegaram antes.
   */
  'follow-state': 32,
  /**
   * O estado da votação de encerrar a hunt para todos (#432, ADR 0032 decisão 14): o líder
   * propôs, `approved` lista quem já aprovou e `active` diz se a janela de 60 s ainda corre.
   * Sai quando a proposta abre, a cada aprovação, ao expirar e ao ser recusada — e no attach,
   * para quem reconecta no meio da votação. `active: false` é o fim dela.
   *
   * 33: o 32 é do `follow-state`.
   */
  'party-end-vote': 33,
  /**
   * O alvo autoritativo do jogador (#470, AB-09). Confirma a seleção (`creatureId` positivo)
   * ou o cancelamento aceito (`creatureId: null`), e substitui `player-stats.targetId` — que
   * era batimento geral e mascarava confirmação e recusa de input (DT-01). `seq` devolve o
   * número do `select-target` que originou a confirmação, para o cliente descartar ack
   * obsoleto (RF-02). Sem `seq`, a mudança veio do auto-target do servidor (#444).
   *
   * 34: o 32 é do `follow-state` e o 33 é do `party-end-vote` (#432).
   */
  'target-changed': 34,
  /**
   * A recusa do `select-target` (#470): a criatura não é alvo válido, e nada mudou. É
   * deliberadamente distinta de `target-changed { creatureId: null }` — uma é recusa, a outra
   * é cancelamento confirmado (RF-04).
   *
   * 35: o 34 é do `target-changed`.
   */
  'target-cancel': 35,
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
