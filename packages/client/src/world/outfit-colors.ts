// As cores de RESERVA de um outfit (FUN-23, FUN-104).
//
// O protocolo carrega as cores de cada criatura desde a FUN-104 (`CreatureState.colors`), e
// o viewport pinta com as dela. Esta constante ficou, e agora é a reserva: a criatura que
// chegou SEM cores — um nó `game` anterior num deploy em rolagem, um personagem que nunca
// escolheu, ou monstro, que nunca traz — é pintada com estas.
//
// **Por que uma reserva, e não deixar de pintar.** Um outfit de duas camadas que sobra sem
// multiplicar aparece na tela como um boneco de cores primárias — amarelo, vermelho, verde e
// azul, que são as MARCAS do template, não uma roupa. Pintar com as cores de personagem novo
// dá o mesmo desenho que o servidor daria a quem nunca escolheu; e para quem não tem template
// (monstro) o pacote devolve a base como está, então passar cores a ele não muda nada.

import type { OutfitColors } from '../assets/outfit.js';
import type { Creature } from '../state/world.js';

/**
 * As cores de um personagem recém-criado no Tibia. São DADOS — índices na paleta de 133
 * cores de `assets/outfit.ts` —, não uma escolha nossa.
 */
export const DEFAULT_OUTFIT_COLORS: OutfitColors = { head: 78, body: 69, legs: 58, feet: 76 };

/**
 * As cores com que ESTA criatura é pintada: as dela, ou as de reserva se chegou sem.
 *
 * É a única linha que decide isso, e mora aqui — e não dentro de `creatureTexture`, no
 * viewport — para ser testável: o viewport é uma closure sobre um `Application` do Pixi, que o
 * vitest em Node não monta, e a decisão que ficasse lá dentro só seria conferida no navegador.
 */
export function paintOf(creature: Pick<Creature, 'colors'>): OutfitColors {
  return creature.colors ?? DEFAULT_OUTFIT_COLORS;
}
