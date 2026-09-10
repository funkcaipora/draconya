// Lançar magia e usar supply (FUN-74, FUN-77).
//
// O motor não sabe quanto cura nem quanto custa — ele sabe *que* cura e *que* custa. Os
// números são conteúdo, e é isso que permite balancear sem deploy. A mesma regra que já vale
// para monstro, progressão e loot.
//
// **Recusar não é falhar.** Sem mana, sem gold, em cooldown, fora de alcance: a ação não
// acontece e a vida segue. Lançar exceção aqui derrubaria a sessão por uma configuração que o
// jogador escreveu certa — e quem chama já sabe lidar com a recusa: o bot não consome o
// cooldown da categoria por uma ação que não aconteceu (FUN-84).
//
// **O dano sai daqui resolvido, não aplicado.** Quem o aplica é quem tem o alvo, porque aplicar
// é também registrar a atribuição (`recordDamage`) e resolver a morte (`resolveDeath`) — e o
// `AGENTS.md` deste pacote é explícito sobre não pagar a atribuição duas vezes. Este arquivo
// cuida do LANÇADOR: portão, custo e cooldown.

import type { Combat, Spell, Supply } from '@draconya/content';
import type { CharacterRuntime } from './character.js';
import { resolveDamage } from './combat/damage.js';
import type { Rng } from './rng.js';

/** Por que a ação não aconteceu. Tipada porque o jogador merece saber qual das sete foi. */
export type CastRefusal =
  /**
   * Magia, supply ou item que o conteúdo não tem.
   *
   * Em regime normal isto nunca aparece: `validateBotConfig` recusa a configuração ANTES da
   * hunt abrir. Sobra o caso de o conteúdo mudar sob uma sessão já em voo — e aí a resposta
   * certa é a regra não fazer nada, nunca derrubar a hunt de quem estava caçando.
   */
  | 'not-in-catalog'
  | 'level-too-low'
  | 'on-cooldown'
  | 'no-target'
  | 'out-of-range'
  | 'not-enough-mana'
  | 'not-enough-gold';

export interface CastSuccess {
  readonly ok: true;
  /** HP reposto — o quanto REPÔS, não o quanto o efeito prometia. */
  readonly healed: number;
  /** Mana reposta, pela mesma regra. */
  readonly manaRestored: number;
  /** Dano RESOLVIDO, ainda não aplicado. Zero quando a magia não é de dano. */
  readonly damage: number;
  /** Gold debitado. Vira `aggregates.goldSpent` em quem chama. */
  readonly goldSpent: number;
}

export interface CastRefused {
  readonly ok: false;
  readonly reason: CastRefusal;
  /**
   * Em quanto tempo vale tentar de novo, em ms de relógio lógico. Só `on-cooldown` sabe
   * responder; as outras recusas devolvem `0`, que quer dizer "não é questão de esperar".
   *
   * Existe para o bot: uma categoria que engatilha ao ser recusada por cooldown fica dormindo
   * até o mundo mudar, e "o mundo mudar" pode não acontecer — é o bot que para de curar
   * enquanto o personagem está parado sangrando. Com o prazo, ela volta no vencimento.
   */
  readonly retryInMs: number;
}

export type CastResult = CastSuccess | CastRefused;

/** O alvo como o LANÇADOR o enxerga. Dados, sem método: aplicar o dano é de quem tem o alvo. */
export interface SpellTarget {
  readonly armor: number;
  readonly dodgeChance: number;
  /** Distância em tiles até o lançador. Quem sabe medir é quem tem o mapa. */
  readonly distance: number;
}

/**
 * A chave de cooldown de uma magia, no `Cooldowns` do personagem.
 *
 * Prefixada porque o mesmo mapa guarda cooldown de supply e do que vier depois: `heal` a seco
 * colidiria com um supply chamado `heal` no dia em que alguém criasse um.
 */
export function spellCooldownKey(spellId: string): string {
  return `spell:${spellId}`;
}

const NOT_WAITING = 0;

/** A recusa de quem pediu o que não existe. Congelada: é devolvida em caminho quente. */
export const NOT_IN_CATALOG: CastRefused = {
  ok: false, reason: 'not-in-catalog', retryInMs: NOT_WAITING,
};

/**
 * Lança a magia, se puder.
 *
 * A ordem das recusas é deliberada: level, cooldown, alvo, alcance e só então mana. **A mana
 * sai por último** — descontá-la antes de saber se o alvo estava ao alcance é como se perde
 * mana sem lançar nada, que é o defeito que o jogador nota e não consegue explicar.
 *
 * `nowMs` é o relógio LÓGICO da sessão. É o que faz o cooldown valer o mesmo a 1 Hz e a 10 Hz:
 * o instante em que a magia sai é o do vencimento do evento, não o do tick que o carregou.
 */
export function castSpell(
  caster: CharacterRuntime,
  spell: Spell,
  target: SpellTarget | null,
  nowMs: number,
  combat: Combat,
  rng: Rng,
  /**
   * Multiplicador de poder vindo das skills (FUN-75). `1` é "sem skill nenhuma".
   *
   * Entra pronto, e não como a skill em si, porque quem sabe quais skills alimentam magia é o
   * conteúdo — e este arquivo não conhece catálogo. Quem chama já percorreu.
   */
  powerScale = 1,
): CastResult {
  if (caster.level < spell.minLevel) {
    return { ok: false, reason: 'level-too-low', retryInMs: NOT_WAITING };
  }

  const key = spellCooldownKey(spell.id);
  if (!caster.cooldowns.isReady(key, nowMs)) {
    return { ok: false, reason: 'on-cooldown', retryInMs: caster.cooldowns.remainingMs(key, nowMs) };
  }

  if (spell.effect.kind === 'damage') {
    if (target === null) return { ok: false, reason: 'no-target', retryInMs: NOT_WAITING };
    if (target.distance > spell.effect.range) {
      return { ok: false, reason: 'out-of-range', retryInMs: NOT_WAITING };
    }
    if (caster.mana < spell.manaCost) {
      return { ok: false, reason: 'not-enough-mana', retryInMs: NOT_WAITING };
    }

    caster.mana -= spell.manaCost;
    caster.cooldowns.start(key, nowMs, spell.cooldownMs);
    // `kind: 'magic'` porque a eficácia da armadura contra magia é outra, e ela é conteúdo
    // (`combat/baseline.json`) — não motor. A rolagem consome o RNG da sessão como todo golpe.
    const result = resolveDamage(
      { power: Math.round(spell.effect.power * powerScale), kind: 'magic' },
      { armor: target.armor, dodgeChance: target.dodgeChance },
      'pve',
      combat,
      rng,
    );
    return { ok: true, healed: 0, manaRestored: 0, damage: result.damage, goldSpent: 0 };
  }

  if (caster.mana < spell.manaCost) {
    return { ok: false, reason: 'not-enough-mana', retryInMs: NOT_WAITING };
  }
  caster.mana -= spell.manaCost;
  caster.cooldowns.start(key, nowMs, spell.cooldownMs);
  return {
    ok: true,
    healed: restore(caster, 'health', spell.effect.amount),
    manaRestored: 0,
    damage: 0,
    goldSpent: 0,
  };
}

/**
 * Usa o supply, se houver gold.
 *
 * §20.1: poção e runa **não são itens físicos** — usar debita gold direto, e por isso não há
 * estoque a conferir nem instância a consumir. O saldo nunca fica negativo, e a garantia é a
 * ordem: o débito é RECUSADO antes, não corrigido depois.
 *
 * Sem cooldown próprio: quem limita a cadência é o cooldown de CATEGORIA do bot (§13.5). Dar
 * um segundo cooldown ao supply seria dois lugares decidindo a mesma coisa, e o dia em que
 * eles divergissem ninguém saberia qual dos dois estava valendo.
 */
export function useSupply(user: CharacterRuntime, supply: Supply): CastResult {
  if (balanceOf(user) < supply.price) {
    return { ok: false, reason: 'not-enough-gold', retryInMs: NOT_WAITING };
  }

  user.goldDelta -= supply.price;
  return supply.effect.kind === 'heal'
    ? {
      ok: true,
      healed: restore(user, 'health', supply.effect.amount),
      manaRestored: 0,
      damage: 0,
      goldSpent: supply.price,
    }
    : {
      ok: true,
      healed: 0,
      manaRestored: restore(user, 'mana', supply.effect.amount),
      damage: 0,
      goldSpent: supply.price,
    };
}

/** Gold disponível agora: o que entrou na sessão mais o que ela ganhou ou gastou. */
export function balanceOf(character: CharacterRuntime): number {
  return character.gold + character.goldDelta;
}

/**
 * Repõe até o teto e devolve o quanto REPÔS, não o quanto pediu.
 *
 * A diferença importa para o extrato e para o painel: curar 80 em quem estava a 10 do máximo é
 * uma cura de 10, e contar 80 faria toda métrica de eficiência de poção mentir.
 */
function restore(character: CharacterRuntime, pool: 'health' | 'mana', amount: number): number {
  const max = pool === 'health' ? character.maxHealth : character.maxMana;
  const before = pool === 'health' ? character.health : character.mana;
  const after = Math.min(max, before + amount);
  if (pool === 'health') character.health = after;
  else character.mana = after;
  return after - before;
}
