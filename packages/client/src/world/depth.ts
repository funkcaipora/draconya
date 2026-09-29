// A profundidade de um tile, em número (ADR 0034).
//
// É o RESULTADO da varredura por diagonal do OTClient como função: anti-diagonal `x + y`
// primeiro, e dentro dela `x` crescente — sudoeste antes de nordeste. Não é `y * M + x`: por
// linha, a parede a SUDOESTE de um dragão cobriria a metade esquerda dele, e no Tibia ela não
// cobre (o par NE/SW é o único em que as duas ordens divergem; `depth.test.ts` prende exatamente
// esse par). Puro: sem Pixi, sem `state/`, sem relógio — aritmética que roda sem GPU.

/** Multiplicador da diagonal: maior que qualquer `x` de um recorte de mapa (PRD §7.1). */
export const ROW_MULTIPLIER = 10_000;
/** Quantos objetos de `scene` um tile pode ordenar entre si; o último slot é da criatura. */
export const SLOTS_PER_TILE = 64;
/** A vaga da criatura: depois dos itens do MESMO tile, como o OTClient. */
export const CREATURE_SLOT = SLOTS_PER_TILE - 1; // 63

/** A profundidade de um TILE: sul e leste depois de norte e oeste, nordeste depois de sudoeste. */
export function spatialOrder(x: number, y: number): number {
  return (x + y) * ROW_MULTIPLIER + x;
}

/**
 * O `zIndex` de um objeto do `scene`: profundidade do tile × 64 + slot preso a [0, 63].
 *
 * O `clamp` mantém o `zIndex` inteiro e a criatura sempre por cima dos itens do tile dela: um
 * tile com mais de 63 objetos de `scene` empilha os excedentes no slot 63, em ordem de inserção
 * (itens entram na repintura, antes da criatura), e nunca invade o tile seguinte.
 */
export function sceneZIndex(x: number, y: number, slot: number): number {
  const clamped = Math.min(SLOTS_PER_TILE - 1, Math.max(0, Math.floor(slot)));
  return spatialOrder(x, y) * SLOTS_PER_TILE + clamped;
}
