// As sete bênçãos PvE do Tibia (#570, ADR 0052 — substitui o binário `premium` que a #569
// deixou como ponto de extensão em `applyDeathPenalty`).
//
// `CharacterRuntime.blessings` é um BITMASK, não uma contagem: cada bit é o `order` de uma
// bênção do catálogo (`content.blessings`, `packages/content/src/schemas.ts`), e a identidade
// importa porque comprar de novo a mesma bênção é RECUSADO (`already-blessed`) — uma contagem
// sozinha não distinguiria "já tenho Fire of the Suns" de "já tenho seis quaisquer". A redução
// da penalidade de morte só olha a CONTAGEM de bits (`blessingCount`): o Tibia dá o mesmo 8%
// por bênção, regular ou `enhanced` — é só o PREÇO que muda entre as duas.
//
// Compra é serviço de CIDADE (ADR 0052 decisão 2): intenção C2S tratada pela sessão de Cidade
// (`rulesets/city.ts`), nunca endpoint `api` — o personagem na Cidade tem o `CharacterRuntime`
// quente (invariante 9), e só a sessão dona escreve nele. Gold sai pelo ledger
// (`session.credit`, invariante 10, ADR 0052 decisão 3); o efeito (o bit ligado) fica no
// runtime e viaja no extrato como o resto do estado absoluto (`fedMs`, `ammo` — ver
// `packages/server/src/receipts.ts`).
//
// Consumo é morte (issue #570): `HuntRuleset#onCharacterDied` lê `blessingCount` ANTES de
// zerar `character.blessings` — depois de morrer, nenhuma bênção sobra, como no Tibia
// (`Player::death` remove todas, nunca uma de cada vez).

import type { Blessing, BlessingPricing } from '@draconya/content';

/** O bit de uma bênção pelo `order` dela no catálogo (0-6). */
export const blessingBit = (order: number): number => 1 << order;

/** O personagem já tem esta bênção? */
export function hasBlessing(mask: number, order: number): boolean {
  return (mask & blessingBit(order)) !== 0;
}

/** Liga o bit desta bênção — idempotente: ligar de novo o mesmo bit não muda nada. */
export function withBlessing(mask: number, order: number): number {
  return mask | blessingBit(order);
}

/**
 * Quantas bênçãos o bitmask carrega — a única coisa que a penalidade de morte lê
 * (`applyDeathPenalty`, `progression.ts`). Popcount de até 7 bits: um laço simples é mais barato
 * de ler que o truque de Brian Kernighan para uma faixa este pequena, e o custo é irrelevante
 * (uma vez por morte, nunca por tick).
 */
export function blessingCount(mask: number): number {
  let count = 0;
  for (let bit = 0; bit < 7; bit++) if (hasBlessing(mask, bit)) count++;
  return count;
}

/**
 * O preço de UMA bênção neste level (#570, `getBlessingCost` do Canary,
 * `data/libs/systems/blessing.lua:148-166`). Piecewise em três faixas: grátis abaixo do
 * Adventurer's Blessing, fixo até `flatUntilLevel`, linear com offset até `highFromLevel`,
 * linear com base maior dali em diante — `enhanced` troca só o multiplicador/base de cada
 * faixa, nunca a forma. Os números vêm de `progression.blessingPricing` — mecanismo aqui,
 * dado lá (a regra de sempre: `content` é dono do número).
 */
export function blessingCost(level: number, enhanced: boolean, pricing: BlessingPricing): number {
  if (level < pricing.freeBelowLevel) return 0;
  if (level <= pricing.flatUntilLevel) return pricing.flatPrice;
  if (level < pricing.highFromLevel) {
    const multiplier = enhanced ? pricing.midEnhancedMultiplier : pricing.midMultiplier;
    return multiplier * (level - pricing.midOffset);
  }
  const base = enhanced ? pricing.highEnhancedBase : pricing.highBase;
  const multiplier = enhanced ? pricing.highEnhancedMultiplier : pricing.highMultiplier;
  return base + multiplier * (level - pricing.highFromLevel);
}

/** As sete bênçãos do catálogo, ordenadas pelo `order` (o índice do bit) — para a tela de compra. */
export function orderedBlessings(catalog: ReadonlyMap<string, Blessing>): readonly Blessing[] {
  return [...catalog.values()].sort((a, b) => a.order - b.order);
}
