// O que a tela de seleção de hunt pode mostrar (FUN-43, §14.3).
//
// O §14.3 tem uma regra que é fácil de quebrar sem perceber: **level recomendado aparece,
// estimativa de XP/h e gold/h NÃO**. A razão é de produto, e vale registrar porque contraria
// o instinto de "dar mais informação ao jogador": um número oficial de XP/h vira a métrica
// pela qual toda hunt é julgada, e a partir daí só existe uma hunt boa — a do topo da tabela.
// O jogo passa a ter uma escolha, não quatro.
//
// A regra vira ESTRUTURA aqui: o tipo `HuntListing` é o que o cliente recebe, e ele não tem
// onde guardar a estimativa. Um comentário pedindo para não mandar seria esquecido; um campo
// que não existe não pode ser preenchido por engano.

import type { Content } from '@draconya/content';
import type { HuntDifficultyName } from '../rulesets/hunt.js';

export interface HuntListing {
  readonly id: string;
  readonly name: string;
  /** §14.3: isto o jogador vê. */
  readonly recommendedLevel: number;
  /**
   * Vestígio do pull por dificuldade, removido do conteúdo pelo #583 (ADR 0039): toda hunt
   * nasce direto dos pontos de spawn, sem escolha de tamanho. O campo continua existindo só
   * por compatibilidade de protocolo (#584) — sempre `['default']`, um nome só, até o #584
   * tirar de vez a tela que ainda pede para escolher uma dificuldade.
   */
  readonly difficulties: readonly HuntDifficultyName[];
  readonly description?: string;
  /** A zona de Hazard da hunt (#632): a chave de `content.hazard.zones`. Ausente é sem hazard. */
  readonly hazardZoneId?: string;
}

/** O único nome de "dificuldade" que sobrou depois do #583 — ver `HuntListing.difficulties`. */
export const DEFAULT_DIFFICULTY_NAME = 'default';

/**
 * As hunts disponíveis, em ordem de level recomendado.
 *
 * Ordenar por level, e não pelo id, é o que faz a lista servir a quem está começando: a
 * primeira linha é a hunt em que o personagem de level 1 consegue entrar. O desempate por id
 * mantém a ordem estável entre dois carregamentos do mesmo conteúdo.
 *
 * Trava de acesso (quest, guilda) é a F2 — e Premium/VIP não é trava de hunt no MVP.
 */
export function huntListings(content: Content): HuntListing[] {
  return [...content.hunts.values()]
    .map((hunt) => ({
      id: hunt.id,
      name: hunt.name,
      recommendedLevel: hunt.recommendedLevel,
      difficulties: [DEFAULT_DIFFICULTY_NAME],
      ...(hunt.description === undefined ? {} : { description: hunt.description }),
      ...(hunt.hazardZoneId === undefined ? {} : { hazardZoneId: hunt.hazardZoneId }),
    }))
    .sort((a, b) => a.recommendedLevel - b.recommendedLevel || a.id.localeCompare(b.id));
}
