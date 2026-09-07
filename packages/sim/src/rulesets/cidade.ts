// Ruleset da Cidade — protect zone (§37).
//
// É o mais simples do jogo, e por isso o melhor teste da interface `Ruleset`: se a Cidade
// não couber nela sem gambiarra, a interface nasceu modelada em cima de hunt, e Guild War
// não vai caber depois.

import type { MotivoDeEncerramento, Ruleset, Sessao } from '../sessao.js';
import type { CharacterRuntime } from '../personagem.js';

export function rulesetDeCidade(): Ruleset {
  return {
    tipo: 'cidade',

    // Orientada a evento: sem laço de simulação nenhum. Movimento e chat chegam como
    // mensagem e respondem; loja, depósito e market são pedido-resposta.
    hz: () => 0,

    aoEntrar(sessao: Sessao, personagem: CharacterRuntime) {
      // Voltar à cidade cura — é para onde a morte devolve (§26.1).
      personagem.vida = personagem.vidaMaxima;
      personagem.mana = personagem.manaMaxima;
      personagem.vivo = true;
      sessao.registrar('entrou-na-cidade', personagem.id);
    },

    aoTick() {
      // Nunca deveria ser chamado: `hz` é 0. Se for, alguém agendou tick para a cidade e
      // está queimando CPU no único espaço compartilhado do jogo — justamente onde o
      // custo por jogador precisa ficar perto de zero.
      throw new Error('a cidade é orientada a evento; não deve receber tick');
    },

    aoMorrer() {
      // Protect zone não causa dano (§37). Chegar aqui é bug de outro sistema, e falhar
      // alto é melhor que registrar uma morte impossível no extrato do jogador.
      throw new Error('personagem não pode morrer em protect zone');
    },

    aoEncerrar(_sessao: Sessao, _motivo: MotivoDeEncerramento) {
      // A cidade não gera extrato: não há progresso a creditar.
    },
  };
}
