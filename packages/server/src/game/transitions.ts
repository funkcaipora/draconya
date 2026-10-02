// A máquina de estados do personagem (FUN-30, §6).
//
// Um personagem está em EXATAMENTE UM estado de atividade. Não existe "em treino e em hunt ao
// mesmo tempo", e isso não é regra de jogo policiada em algum lugar: é propriedade estrutural,
// porque o estado é a sessão e todo personagem tem uma só (invariante 8).
//
// **Por que isto merece um arquivo próprio:** o estado exclusivo é também o controle de
// concorrência sobre o estado quente (invariante 9). Não existe lock sobre o gold porque nunca
// há duas fontes de escrita ao mesmo tempo — e essa afirmação só é verdade enquanto a
// transição for de fato exclusiva. Um furo aqui não aparece como bug de sessão: aparece meses
// depois como gold duplicado, e ninguém liga uma coisa à outra.

import type { SessionType } from '@draconya/sim';

/**
 * Para onde cada estado pode ir. **A Cidade é o centro**, e é de propósito: não se vai de hunt
 * direto para boss.
 *
 * A alternativa — permitir tudo para tudo — parece mais flexível e custa caro: cada par novo
 * de estados vira um caminho de transição que ninguém testou, e a transição é justamente o
 * único momento em que o estado quente troca de dono. Passar pela Cidade dá a cada troca um
 * ponto de parada conhecido, onde o personagem está curado, sem instância e sem nada em voo.
 *
 * **Com o mundo aberto (OW-18, ADR 0060 d.6) o centro é o MUNDO, e a Cidade continua enquanto a
 * flag `OPEN_WORLD` existir.** Do mundo se vai a toda instância e de toda instância se volta a ele
 * — é o mesmo desenho, com o mesmo ponto de parada, e é a Cidade que sai quando o mundo cobrir todo
 * serviço dela. Quem constrói o destino decide se ele existe: com a flag desligada nenhum nó
 * hospeda um mundo, `'world'` aqui não passa de uma aresta que o construtor de sessões recusa
 * (`unknown-destination`), e nenhuma mensagem do cliente pede esse destino. O que NÃO está aqui: o
 * mundo não vai à Cidade nem a Cidade ao mundo — quem está numa Cidade sob a flag ligada (o fim de uma
 * hunt ainda volta a ela até a OW-20) sai do jogo e entra de novo.
 *
 * **Esta tabela diz só o que é possível, não quando.** A entrada numa instância a partir do mundo
 * só quando o Tibia deixaria deslogar (`canLogout`, d.6a) é do hospedeiro (OW-20), que a consulta
 * ao ruleset; a volta só com alguém olhando também.
 */
const ALLOWED: Readonly<Record<SessionType, readonly SessionType[]>> = {
  city: ['hunt', 'training', 'quest', 'boss', 'guild-war'],
  world: ['hunt', 'training', 'quest', 'boss', 'guild-war'],
  hunt: ['city', 'world'],
  training: ['city', 'world'],
  quest: ['city', 'world'],
  boss: ['city', 'world'],
  'guild-war': ['city', 'world'],
};

export type TransitionRefusal =
  | 'same-state'
  | 'not-allowed'
  | 'already-transitioning'
  | 'unknown-destination';

export class TransitionError extends Error {
  constructor(readonly refusal: TransitionRefusal, message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

/**
 * A transição é permitida? Devolve `null` quando sim, e o motivo quando não.
 *
 * Motivo, e não um booleano, porque a recusa vai para a tela do jogador. "Você não pode fazer
 * isso" é a mensagem que faz alguém achar que o jogo travou; dizer que é preciso voltar à
 * cidade primeiro é uma instrução.
 */
export function refuseTransition(from: SessionType, to: SessionType): TransitionError | null {
  if (from === to) {
    return new TransitionError('same-state', `o personagem já está em "${from}"`);
  }
  const allowed = ALLOWED[from];
  if (!allowed.includes(to)) {
    return new TransitionError(
      'not-allowed',
      `não se vai de "${from}" para "${to}" direto; volte para a cidade primeiro`,
    );
  }
  return null;
}

/** Mensagem para o jogador. Curta, e sempre dizendo o que fazer em seguida. */
export const REFUSAL_TEXT: Readonly<Record<TransitionRefusal, string>> = {
  'same-state': 'Você já está aqui.',
  'not-allowed': 'Volte para a cidade antes de entrar em outra atividade.',
  // Duas transições disputadas: exatamente uma vence, e a outra precisa saber que perdeu em
  // vez de ficar esperando uma resposta que não vem.
  'already-transitioning': 'Uma mudança de atividade já está em andamento.',
  'unknown-destination': 'Esta atividade não existe neste servidor.',
};
