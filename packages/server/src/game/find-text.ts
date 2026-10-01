// O texto de um Find Person/Find Fiend (#623): o `sim` entrega DADO (`FindRelation`), e a frase em
// português nasce aqui — a apresentação é do hospedeiro, como toda mensagem do jogo. As frases
// espelham as do Canary (`data/scripts/spells/support/find_person.lua`: `messages`/`directions`),
// traduzidas; a estrutura é a dele — "ao lado" não leva direção, "perto" leva o andar e a direção,
// "longe" e "muito longe" só a direção.

import type { CompassDirection, FindRelation } from '@draconya/sim';

/** A direção com a preposição que o português pede ("ao norte", "a leste"). */
const DIRECTION_PHRASE: Readonly<Record<CompassDirection, string>> = {
  north: 'ao norte',
  south: 'ao sul',
  east: 'a leste',
  west: 'a oeste',
  'north-east': 'a nordeste',
  'north-west': 'a noroeste',
  'south-east': 'a sudeste',
  'south-west': 'a sudoeste',
};

/**
 * O trecho que vem depois do nome — "está ao lado de você", "está em um andar inferior, ao
 * norte", "está longe, a leste". Sem ponto final: quem monta a frase completa o acrescenta.
 */
export function findPhrase(relation: FindRelation): string {
  const direction = relation.direction === undefined ? undefined : DIRECTION_PHRASE[relation.direction];
  switch (relation.distance) {
    case 'beside':
      return relation.level === 'lower'
        ? 'está abaixo de você'
        : relation.level === 'higher' ? 'está acima de você' : 'está ao seu lado';
    case 'close':
      if (relation.level === 'lower') return `está em um andar inferior, ${direction ?? ''}`.trimEnd();
      if (relation.level === 'higher') return `está em um andar superior, ${direction ?? ''}`.trimEnd();
      return `está ${direction ?? ''}`.trimEnd();
    case 'far':
      return `está longe, ${direction ?? ''}`.trimEnd();
    case 'very-far':
      return `está muito longe, ${direction ?? ''}`.trimEnd();
  }
}

/** A frase do Find Person: "Fulano está ao norte." */
export function findPersonText(name: string, relation: FindRelation): string {
  return `${name} ${findPhrase(relation)}.`;
}
