// O evento notável em palavras (§16.2, FUN-83, FUN-110).
//
// Puro e fora do componente para ser testável: a lista ficou AO VIVO na FUN-110, e metade dos
// tipos que o `sim` grava saía cru — `entered-hunt · rat-cellars/cautious`, `skill-up ·
// melee/11` — como primeira linha que todo jogador via. O `sim` grava o TIPO e um `detail`
// curto; o que cada um quer dizer para quem lê é decisão de apresentação, e mora aqui.

import type { NotableEvent } from '../state/hud.js';

/** Os três tamanhos de pull (FUN-123, cópia do Huntera), em palavras. Os mesmos de `HuntMenu`. */
const DIFFICULTY_TEXT: Record<string, string> = {
  cautious: 'Cauteloso',
  bold: 'Ousado',
  reckless: 'Agressivo',
};

const REASON_TEXT: Record<string, string> = {
  'manual-exit': 'saiu da hunt',
  'exit-rule': 'regra de saída',
  death: 'morte',
  drain: 'manutenção',
  completed: 'concluída',
};

const SKILL_TEXT: Record<string, string> = { melee: 'Corpo a corpo', magic: 'Magia' };

/** `1` e `0,5` — o bônus de um marco em pontos percentuais, como o jogador lê. */
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** `id` do conteúdo em palavras, quando há nome; senão o id mesmo, que ao menos é estável. */
export interface EventNames {
  readonly hunts?: ReadonlyMap<string, string>;
  readonly supplies?: ReadonlyMap<string, string>;
  readonly monsters?: ReadonlyMap<string, string>;
  /**
   * Quanto vale um marco do Bestiário, em pontos percentuais (`catalogue.bestiary`). Sem ele
   * a linha diz só o marco: escrever "+1 %" de cabeça seria afirmar um número que o servidor
   * não mandou — a mesma regra do "—" nos agregados opcionais.
   */
  readonly percentPerMilestone?: number;
}

/**
 * A linha de um evento. Tipo desconhecido — um `sim` mais novo que este cliente — sai como
 * veio, tipo e detalhe: pior que uma frase feia é sumir com o evento.
 */
export function describeEvent(event: NotableEvent, names: EventNames = {}): string {
  const detail = event.detail ?? '';
  switch (event.type) {
    case 'entered-hunt': {
      const [huntId = '', difficulty = ''] = detail.split('/');
      const hunt = names.hunts?.get(huntId) ?? huntId;
      const level = DIFFICULTY_TEXT[difficulty] ?? difficulty;
      return level === '' ? `Entrou em ${hunt}` : `Entrou em ${hunt} · ${level}`;
    }
    case 'entered-city': return 'Voltou para a cidade';
    case 'level-up': return `Subiu de level · ${detail}`;
    case 'level-down': return `Perdeu level · ${detail}`;
    case 'xp-penalty': return `Perdeu ${detail} XP`;
    case 'skill-up': {
      const [skill = '', level = ''] = detail.split('/');
      return `${SKILL_TEXT[skill] ?? skill} subiu para ${level}`;
    }
    case 'bestiary-milestone': {
      // `monsterId/n` (FUN-113): o marco fecha cinco vezes por monstro na vida inteira do
      // personagem, e é a única linha do extrato que fala de progressão permanente.
      const [monsterId = '', milestone = ''] = detail.split('/');
      const monster = names.monsters?.get(monsterId) ?? monsterId;
      const bonus = names.percentPerMilestone === undefined
        ? ''
        : ` (+${percent.format(names.percentPerMilestone)} % XP)`;
      return `Bestiário: ${monster} · marco ${milestone}${bonus}`;
    }
    case 'death': return 'Morreu';
    case 'stamina-exhausted': return 'Stamina esgotada';
    case 'backpack-full': return 'Mochila cheia';
    case 'supply-unaffordable': return `Gold acabou para ${names.supplies?.get(detail) ?? detail}`;
    case 'exit-rule': return `Saiu por regra · ${detail}`;
    case 'ring-equipped': return 'Equipou o anel';
    case 'ring-removed': return 'Tirou o anel';
    case 'difficulty-changed': return `Dificuldade mudou · ${detail}`;
    case 'advance-truncated': return 'Tempo parado descartado';
    case 'ended': return `Sessão encerrada · ${REASON_TEXT[detail] ?? detail}`;
    default: return detail === '' ? event.type : `${event.type} · ${detail}`;
  }
}
