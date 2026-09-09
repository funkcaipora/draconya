// Ruleset da Cidade — protect zone (§37).
//
// É o mais simples do jogo, e por isso o melhor teste da interface `Ruleset`: se a Cidade
// não couber nela sem gambiarra, a interface nasceu modelada em cima de hunt, e Guild War
// não vai caber depois.

import type { EndReason, Ruleset, Session } from '../session.js';
import type { CharacterRuntime } from '../character.js';

export function createCityRuleset(): Ruleset {
  return {
    type: 'city',

    // Orientada a evento: sem laço de simulação nenhum. Movimento e chat chegam como
    // mensagem e respondem; loja, depósito e market são pedido-resposta.
    hz: () => 0,

    onEnter(session: Session, character: CharacterRuntime) {
      // Voltar à cidade cura — é para onde a morte devolve (§26.1).
      character.health = character.maxHealth;
      character.mana = character.maxMana;
      character.alive = true;
      session.record('entered-city', character.id);
    },

    onEvent() {
      // Nunca deveria ser chamado: `hz` é 0 e a cidade não agenda nada. Se for, alguém pôs
      // um evento na fila da cidade e está queimando CPU no único espaço compartilhado do
      // jogo — justamente onde o custo por jogador precisa ficar perto de zero.
      throw new Error('city is event-driven; it must not receive scheduled events');
    },

    onDeath() {
      // Protect zone não causa dano (§37). Chegar aqui é bug de outro sistema, e falhar
      // alto é melhor que registrar uma morte impossível no extrato do jogador.
      throw new Error('character cannot die in a protect zone');
    },

    onEnd(_session: Session, _reason: EndReason) {
      // A cidade não gera extrato: não há progresso a creditar.
    },
  };
}
