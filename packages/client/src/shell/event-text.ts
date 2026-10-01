// O evento notável em palavras (§16.2, FUN-83, FUN-110).
//
// Puro e fora do componente para ser testável: a lista ficou AO VIVO na FUN-110, e metade dos
// tipos que o `sim` grava saía cru — `entered-hunt · rat-cellars/cautious`, `skill-up ·
// melee/11` — como primeira linha que todo jogador via. O `sim` grava o TIPO e um `detail`
// curto; o que cada um quer dizer para quem lê é decisão de apresentação, e mora aqui.

import type { NotableEvent } from '../state/hud.js';

const REASON_TEXT: Record<string, string> = {
  'manual-exit': 'saiu da hunt',
  'exit-rule': 'regra de saída',
  death: 'morte',
  drain: 'manutenção',
  completed: 'concluída',
  'party-vote': 'votação da party',
};

const SKILL_TEXT: Record<string, string> = {
  melee: 'Corpo a corpo', magic: 'Magia', distance: 'Distância',
};

/** `1` e `0,5` — o bônus de um marco em pontos percentuais, como o jogador lê. */
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** `id` do conteúdo em palavras, quando há nome; senão o id mesmo, que ao menos é estável. */
export interface EventNames {
  readonly hunts?: ReadonlyMap<string, string>;
  readonly supplies?: ReadonlyMap<string, string>;
  readonly monsters?: ReadonlyMap<string, string>;
  /** `itemId` → nome (`catalogue.items`): a perda de item na morte (#571) diz QUAL item. */
  readonly items?: ReadonlyMap<string, string>;
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
      // O `detail` continua `huntId/difficulty` (o `sim` não mudou o formato do evento), mas a
      // dificuldade não é mais mostrada desde o #584 (ADR 0039, fim do pull por dificuldade).
      const [huntId = ''] = detail.split('/');
      const hunt = names.hunts?.get(huntId) ?? huntId;
      return `Entrou em ${hunt}`;
    }
    case 'entered-city': return 'Voltou para a cidade';
    case 'level-up': {
      // Em party o detalhe é `id/level` (#190): diz DE QUEM. Em solo, só o level, como sempre.
      const [who, level] = detail.includes('/') ? detail.split('/') : [undefined, detail];
      return who === undefined ? `Subiu de level · ${level ?? ''}` : `${who} subiu de level · ${level ?? ''}`;
    }
    case 'party-settlement': {
      // `total/presentes` (#192): a bolsa foi vendida e dividida — ao sair alguém, e no fim.
      const [total = '', present = ''] = detail.split('/');
      return `Bolsa vendida: ${total} gold para ${present}`;
    }
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
    case 'item-lost-on-death': {
      // `itemId/quantidade/instanceId/dono` (#571): o cliente mostra o item e a quantidade; o
      // `instanceId` e o dono são da trilha de auditoria do ledger, não da tela.
      const { name, quantity } = lostItemOf(detail, names);
      return `Perdeu na morte · ${name}${quantity > 1 ? ` ×${String(quantity)}` : ''}`;
    }
    case 'item-loss-protected':
      // `blessings` (a tabela deu 0%) ou o id do colar que protegeu.
      return detail === 'blessings'
        ? 'Nenhum item perdido · protegido pelas bênçãos'
        : `Nenhum item perdido · ${names.items?.get(detail) ?? detail} protegeu`;
    case 'loss-amulet-consumed': return `${names.items?.get(detail) ?? detail} consumido`;
    case 'backpack-replaced': return `Ganhou ${names.items?.get(detail) ?? detail} nova, sem mochila`;
    case 'death': return 'Morreu';
    case 'stamina-exhausted': return 'Stamina esgotada';
    case 'backpack-full': return 'Mochila cheia';
    // A Food (#623) sem lugar na mochila: o Canary a largaria no chão, e este modelo não tem item
    // no chão fora do cadáver — o que não coube se perde, e o extrato diz QUAL comida.
    case 'food-not-carried': return `Comida perdida, sem espaço · ${names.items?.get(detail) ?? detail}`;
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

/** O que a linha `item-lost-on-death` diz de UM item: o nome (ou o id) e a quantidade. */
function lostItemOf(detail: string, names: EventNames): { name: string; quantity: number } {
  const [itemId = '', quantity = '1'] = detail.split('/');
  return { name: names.items?.get(itemId) ?? itemId, quantity: Number(quantity) || 1 };
}

/** Uma linha da lista de eventos, já em palavras. `type` e `atMs` são os do evento de origem. */
export interface EventLine {
  readonly atMs: number;
  readonly type: string;
  readonly text: string;
}

/** Quantos itens perdidos a linha agrupada nomeia antes de resumir o resto em "+N". */
const LOST_ITEMS_NAMED = 5;

/**
 * A lista que a tela de retorno mostra (§16.2, #571): cada evento vira uma linha, EXCETO a perda
 * de item na morte, que o `sim` grava UMA linha por instância (é a trilha de auditoria do ledger)
 * e que aqui vira UMA linha só — uma mochila cheia perdida seriam vinte linhas, e a lista mostra
 * só as mais recentes: o resto do extrato sumiria atrás da própria perda.
 *
 * `me` é o personagem de quem olha. Em party as linhas dos membros compartilham a lista de eventos
 * da sessão, e o `detail` da perda leva o dono no fim: o item que OUTRO membro perdeu não entra na
 * tela de quem ficou. Sem dono no `detail` (nó anterior) a linha é de quem olha, como sempre foi.
 */
export function describeEvents(
  events: readonly NotableEvent[], names: EventNames = {}, me?: string,
): EventLine[] {
  const lines: EventLine[] = [];
  const lost: string[] = [];
  let anchor = -1;
  for (const event of events) {
    if (event.type !== 'item-lost-on-death') {
      lines.push({ atMs: event.atMs, type: event.type, text: describeEvent(event, names) });
      continue;
    }
    const detail = event.detail ?? '';
    const owner = detail.split('/')[3];
    if (me !== undefined && owner !== undefined && owner !== me) continue;
    // A linha agrupada nasce onde a PRIMEIRA perda aconteceu: é a posição dela na história.
    if (anchor < 0) {
      anchor = lines.length;
      lines.push({ atMs: event.atMs, type: 'item-lost-on-death', text: '' });
    }
    lost.push(detail);
  }
  if (anchor >= 0) {
    const named = lost.map((detail) => lostItemOf(detail, names));
    const shown = named.slice(0, LOST_ITEMS_NAMED)
      .map(({ name, quantity }) => (quantity > 1 ? `${name} ×${String(quantity)}` : name));
    const rest = named.length - shown.length;
    lines[anchor] = {
      atMs: lines[anchor]?.atMs ?? 0,
      type: 'item-lost-on-death',
      text: `Perdeu na morte · ${shown.join(', ')}${rest > 0 ? ` (+${String(rest)})` : ''}`,
    };
  }
  return lines;
}
