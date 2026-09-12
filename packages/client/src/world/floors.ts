// Os andares que a tela mostra, e o véu de cada um (FUN-121). Puro: aritmética sobre
// números, extraída do viewport para ser travada sem Pixi — um sinal errado aqui é o depot
// desenhado por cima da rua, e só apareceria olhando a tela.

/**
 * A superfície: na superfície e acima dela vê-se do andar do jogador até o 7, cada andar de
 * baixo sob um véu; no subsolo (8+) só o andar do jogador. É o que o Huntera faz, e o que o
 * Tibia faz sem telhado.
 */
export const SURFACE_FLOOR = 7;

/** Quanto cada andar abaixo do jogador escurece: o cinza multiplica a cada nível. */
export const VEIL_PER_FLOOR = 0.55;

/**
 * Os andares a desenhar para quem está em `z`, entre os que a cena tem, do mais fundo ao do
 * jogador — a ordem de pintura, o de baixo primeiro. Na superfície, do 7 até o dele; no
 * subsolo, só o dele. Andar acima do jogador nunca entra: não há telhado.
 */
export function floorsBelow(floors: readonly number[], z: number): number[] {
  const deepest = z <= SURFACE_FLOOR ? SURFACE_FLOOR : z;
  return floors.filter((floor) => floor >= z && floor <= deepest).sort((a, b) => b - a);
}

/** O cinza de um andar `below` níveis abaixo do jogador: 0 é o andar dele, sem véu. */
export function veilTint(below: number): number {
  return shade(0xffffff, below);
}

/**
 * Uma cor sob o véu de `below` andares: cada canal multiplicado por `VEIL_PER_FLOOR` a cada
 * nível. É o que os retângulos de reserva e as criaturas sem quadro usam para não saírem tão
 * claros quanto o andar do jogador — o véu é da profundidade, não da arte.
 */
export function shade(color: number, below: number): number {
  if (below <= 0) return color;
  const factor = VEIL_PER_FLOOR ** below;
  const channel = (shift: number): number => Math.round(((color >> shift) & 0xff) * factor);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
