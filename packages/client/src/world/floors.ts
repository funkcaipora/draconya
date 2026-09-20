// O véu de cada andar (FUN-121). Puro: aritmética sobre números, extraída do viewport para ser
// travada sem Pixi — um sinal errado aqui é o depot desenhado por cima da rua, e só apareceria
// olhando a tela. Que andares a tela mostra é `visibility.ts` (M23, D7).

/**
 * A superfície: o andar 7. Que andares a tela mostra — acima até a cobertura, abaixo até
 * aqui; no subsolo dois para cada lado — é `visibility.ts` (M23, D7); aqui fica só o véu.
 */
export const SURFACE_FLOOR = 7;

/** Quanto cada andar abaixo do jogador escurece: o cinza multiplica a cada nível. */
export const VEIL_PER_FLOOR = 0.55;

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
