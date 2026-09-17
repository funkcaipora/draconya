// A geometria dos arcos de HP/Mana do jogador (#328, RC-15). Ela fica pura para que as duas
// vistas das vitais possam provar os limites sem depender do DOM ou do estado do HUD.

/** Raio do arco em unidades do viewBox (o kit usa `r = 78`). */
export const ARC_RADIUS = 78;

const CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS;
/** O segmento visível ocupa 32% da circunferência. */
const ARC_SEGMENT = CIRCUMFERENCE * 0.32;
/** Desloca o segmento em 34% da circunferência, como a composição renderizada do kit. */
export const ARC_DASH_OFFSET = Number((-(CIRCUMFERENCE * 0.34)).toFixed(2));

/** `strokeDasharray` do arco de fundo — o segmento inteiro, sempre igual. */
export const ARC_TRACK_DASHARRAY = `${ARC_SEGMENT.toFixed(2)} ${(CIRCUMFERENCE - ARC_SEGMENT).toFixed(2)}`;

/**
 * `strokeDasharray` do arco de progresso para uma fração de 0 a 1. O clamp é o mesmo de
 * `Vitals.tsx`: dado transitório fora do intervalo não pode desenhar além do trilho.
 */
export function arcDasharray(fraction: number): string {
  const filled = ARC_SEGMENT * Math.max(0, Math.min(1, fraction));
  return `${filled.toFixed(2)} ${(CIRCUMFERENCE - filled).toFixed(2)}`;
}
