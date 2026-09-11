// As cores com que todo outfit é pintado por enquanto (FUN-23).
//
// O protocolo ainda não carrega cores de outfit — `creature-appear` traz só o
// `appearanceId` — e o pipeline de colorização (FUN-20) já existe. Entre pintar todo mundo
// com uma cor fixa e não pintar ninguém, pintar é o que exercita o caminho de verdade: um
// template que sobrar sem multiplicar aparece na tela como um boneco de cores primárias.
//
// **Esta constante sai daqui no dia em que o protocolo carregar as cores.** Aí elas vêm da
// criatura, e o viewport passa as dela em vez destas.

import type { OutfitColors } from '../assets/outfit.js';

/**
 * As cores de um personagem recém-criado no Tibia. São DADOS — índices na paleta de 133
 * cores de `assets/outfit.ts` —, não uma escolha nossa.
 */
export const DEFAULT_OUTFIT_COLORS: OutfitColors = { head: 78, body: 69, legs: 58, feet: 76 };
