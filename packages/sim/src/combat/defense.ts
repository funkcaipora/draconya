// Defesa e escudo (CMB-04, ADR 0031 — emenda "Defesa e escudo (CMB-04)").
//
// A defesa é o estágio ENTRE a rolagem de Dodge e a armadura. Ela NÃO é a armadura: a armadura
// é do corpo e vale por tipo de dano; a defesa é da PEÇA (escudo ou arma de uma mão) e vale só
// contra os tipos que o conteúdo aprova — `physical` no `combat-v1`.
//
// Duas coisas fazem este módulo preservar o `combat-v1` bit a bit:
//
//   1. sem fonte (sem escudo e sem arma de uma mão), o estágio é IDENTIDADE e não consome
//      sorteio nenhum;
//   2. a rolagem de bloqueio só existe quando há fonte E o tipo está em `blockTypes`, e ela é
//      o SEGUNDO sorteio do golpe — logo depois do Dodge, que continua o primeiro ato.
//
// Assim, todo conteúdo que não declara defesa consome exatamente os mesmos sorteios de antes, e
// o resultado entregue é idêntico. A fórmula é original do Draconya (ADR 0019): nenhuma engine
// externa é aproximada.

import type { Combat, DamageType } from '@draconya/content';
import type { Rng } from '../rng.js';

/**
 * De ONDE vem a defesa do defensor (DT-01). A escolha é do `Inventory`, que já conhece slots e
 * compatibilidades — `shield` precede `weapon`, e `none` é quem não tem peça elegível.
 */
export interface DefenseSource {
  readonly kind: 'shield' | 'weapon' | 'none';
  readonly defense: number;
}

/** O resultado auditável do estágio de defesa. Efêmero, como o `DamageOutcome`. */
export interface DefenseOutcome {
  readonly source: DefenseSource['kind'];
  /** Quanto o bloqueio tirou do poder bruto. Zero quando não houve fonte ou tipo elegível. */
  readonly blocked: number;
  /** O poder depois da defesa, e o que entra na armadura. */
  readonly afterDefense: number;
}

/** O defensor sem peça de defesa: identidade, e um objeto só para toda a sessão. */
export const NO_DEFENSE: DefenseSource = { kind: 'none', defense: 0 };

/** O mínimo que a defesa precisa do golpe — o `DamageIntent` satisfaz estruturalmente. */
export interface DefenseIntent {
  readonly rawDamage: number;
  readonly damageType: DamageType;
}

/**
 * O estágio de defesa do `combat-v1`. Função PURA a menos do RNG, que é o da sessão — o mesmo
 * contrato de `resolveDamage`.
 *
 * A ordem e a posição do sorteio são contrato (ADR 0031): o Dodge rola primeiro, e o bloqueio
 * só rola quando há fonte elegível e o tipo está aprovado. Ataque elemental, ou defensor sem
 * peça, atravessa sem consumir nada.
 *
 * O bloqueio NUNCA zera o golpe: ele é limitado ao poder bruto, e o piso do perfil
 * (`minimumDamageFraction`, calculado sobre o poder bruto em `damage.ts`) sobrevive a ele.
 */
export function resolveDefense(
  intent: DefenseIntent,
  source: DefenseSource | undefined,
  combat: Combat,
  rng: Rng,
): DefenseOutcome {
  const defense = combat.defense;
  if (source === undefined || source.kind === 'none' || defense === undefined) {
    return { source: 'none', blocked: 0, afterDefense: intent.rawDamage };
  }
  // Tipo não aprovado (elemental): passa intacto e NÃO consome sorteio — é o que impede um
  // ataque de fogo de treinar shielding por acidente.
  if (!defense.blockTypes.includes(intent.damageType)) {
    return { source: source.kind, blocked: 0, afterDefense: intent.rawDamage };
  }
  // UMA rolagem, e só com fonte elegível: a sequência de quem não tem defesa não muda. O
  // sorteio é consumido mesmo com `defense` 0, para a sequência não depender do VALOR da peça.
  const blocked = rng.chance(defense.blockChance)
    ? Math.min(source.defense, intent.rawDamage)
    : 0;
  return { source: source.kind, blocked, afterDefense: intent.rawDamage - blocked };
}
