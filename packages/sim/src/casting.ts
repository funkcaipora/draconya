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

import type { Combat, CompiledMitigation, Spell, Supply } from '@draconya/content';
import type { CharacterRuntime } from './character.js';
import { resolveDamage } from './combat/damage.js';
import type { ConditionState } from './conditions.js';
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
  | 'not-enough-gold'
  /** A magia pede uma vocação que este personagem não tem (§9.2, FUN-92). */
  | 'wrong-vocation'
  /** O grupo (ou o secundário) da magia ainda está trancado (#155). Carrega prazo, como `on-cooldown`. */
  | 'group-cooldown'
  /** A runa pede magic level que este personagem não tem (#165). */
  | 'magic-level-too-low';

export interface CastSuccess {
  readonly ok: true;
  /** HP reposto — o quanto REPÔS, não o quanto o efeito prometia. */
  readonly healed: number;
  /** Mana reposta, pela mesma regra. */
  readonly manaRestored: number;
  /**
   * Dano RESOLVIDO no total, ainda não aplicado. Zero quando a magia não é de dano.
   *
   * É a soma de `hits`, e existe para o extrato e o analisador — quem APLICA precisa de
   * `hits`, alvo a alvo, porque cada um leva o seu.
   */
  readonly damage: number;
  /**
   * O dano de cada alvo, na MESMA ordem de `aim.targets` (FUN-92).
   *
   * Ordem é contrato: cada alvo consome uma rolagem do `Rng` da sessão, e trocar a ordem troca
   * qual sorteio cai em quem — o que faz a mesma semente render uma hunt diferente.
   */
  readonly hits: readonly number[];
  /** Gold debitado. Vira `aggregates.goldSpent` em quem chama. */
  readonly goldSpent: number;
  /**
   * A condição que a magia aplica (#155: haste, postura, magic shield, cura ao longo do tempo),
   * já com `expiresAtMs`. Devolvida, não aplicada: quem tem a fila de eventos é o ruleset, e é
   * ele quem agenda o vencimento — a mesma divisão do dano resolvido.
   */
  readonly condition?: ConditionState;
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
  /** Mitigação compilada do alvo (CMB-03). Ausente é o alvo neutro. */
  readonly mitigation?: CompiledMitigation | undefined;
}

/**
 * Onde a magia cai (FUN-92).
 *
 * A distância é UMA, a do alvo principal, e é só ela que o alcance confere: quem foi pego pela
 * área está lá porque cai dentro do raio, não porque o lançador o alcança.
 *
 * `targets` traz o alvo principal PRIMEIRO. A ordem é contrato — ver `CastSuccess.hits`.
 */
export interface SpellAim {
  readonly distance: number;
  readonly targets: readonly SpellTarget[];
}

const NO_HITS: readonly number[] = [];

/**
 * A chave de cooldown de uma magia, no `Cooldowns` do personagem.
 *
 * Prefixada porque o mesmo mapa guarda cooldown de supply e do que vier depois: `heal` a seco
 * colidiria com um supply chamado `heal` no dia em que alguém criasse um.
 */
export function spellCooldownKey(spellId: string): string {
  return `spell:${spellId}`;
}

/** Os dois outros livros de cooldown (#155, referência §21): o grupo e o secundário. */
export function groupCooldownKey(group: string): string {
  return `group:${group}`;
}

/**
 * A chave do cooldown individual de um supply SEM grupo declarado.
 *
 * O supply de grupo usa `group:<g>`; o supply sem grupo cai no livro próprio, para não
 * inventar prioridade compartilhada que o conteúdo não declarou (DT-06).
 */
export function supplyCooldownKey(supplyId: string): string {
  return `supply:${supplyId}`;
}

export function secondaryCooldownKey(name: string): string {
  return `secondary:${name}`;
}

/**
 * O que escala uma magia (#155). `skillLevel` é o level da skill que a vocação usa para magia
 * (`spellSkill`, `magic` por padrão); `powerScale` é o multiplicador das skills por uso
 * (`#scaledPower`) e só vale para `power`/`amount` FIXOS — o `basePower` já entra pela
 * conversão, e multiplicar de novo contaria a mesma skill duas vezes.
 */
export interface SpellScaling {
  readonly skillLevel: number;
  readonly powerScale: number;
}

const NO_SCALING: SpellScaling = { skillLevel: 0, powerScale: 1 };

/**
 * A conversão do Base Power (ADR 0026 decisão 5): inteira nas duas pontas, `min <= max`
 * sempre, nunca abaixo de 1. Os coeficientes são conteúdo (`combat.spellPower`).
 */
export function spellPowerRange(
  basePower: number, level: number, skillLevel: number, spellPower: Combat['spellPower'],
): { readonly min: number; readonly max: number } {
  const mid = basePower * (1 + level * spellPower.levelFactor + skillLevel * spellPower.skillFactor);
  return {
    min: Math.max(1, Math.floor(mid * (1 - spellPower.spread))),
    max: Math.max(1, Math.ceil(mid * (1 + spellPower.spread))),
  };
}

/**
 * O poder de um efeito: o BP convertido e sorteado (UMA rolagem por chamada — ordem é
 * contrato), ou o fixo escalado pelas skills por uso.
 */
function powerOf(
  effect: {
    readonly basePower?: number | undefined;
    readonly power?: number | undefined;
    readonly amount?: number | undefined;
  },
  caster: CharacterRuntime, scaling: SpellScaling, combat: Combat, rng: Rng,
): number {
  if (effect.basePower !== undefined) {
    const { min, max } = spellPowerRange(effect.basePower, caster.level, scaling.skillLevel, combat.spellPower);
    return rng.integer(min, max);
  }
  return Math.round((effect.power ?? effect.amount ?? 0) * scaling.powerScale);
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
  aim: SpellAim | null,
  nowMs: number,
  combat: Combat,
  rng: Rng,
  /**
   * O que escala a magia (FUN-75, #155). Entra pronto, e não como a skill em si, porque quem
   * sabe quais skills alimentam magia é o conteúdo — e este arquivo não conhece catálogo.
   */
  scaling: SpellScaling = NO_SCALING,
): CastResult {
  if (caster.level < spell.minLevel) {
    return { ok: false, reason: 'level-too-low', retryInMs: NOT_WAITING };
  }
  // §9.2 (FUN-92). Antes do cooldown porque nunca melhora: quem não tem a vocação não vai
  // passar a ter esperando, e reagendar por isso seria um evento por segundo para
  // redescobrir a mesma coisa.
  if (spell.vocationId !== undefined && caster.vocationId !== spell.vocationId) {
    return { ok: false, reason: 'wrong-vocation', retryInMs: NOT_WAITING };
  }

  const key = spellCooldownKey(spell.id);
  if (!caster.cooldowns.isReady(key, nowMs)) {
    return { ok: false, reason: 'on-cooldown', retryInMs: caster.cooldowns.remainingMs(key, nowMs) };
  }
  // Os grupos do Tibia (#155, referência §21): livros separados do cooldown da magia, no
  // mesmo `Cooldowns` por prefixo de chave. O prazo devolvido é o do livro que trancou.
  const groupKey = spell.group === undefined ? null : groupCooldownKey(spell.group);
  if (groupKey !== null && !caster.cooldowns.isReady(groupKey, nowMs)) {
    return { ok: false, reason: 'group-cooldown', retryInMs: caster.cooldowns.remainingMs(groupKey, nowMs) };
  }
  const secondaryKey = spell.secondaryGroup === undefined ? null : secondaryCooldownKey(spell.secondaryGroup.name);
  if (secondaryKey !== null && !caster.cooldowns.isReady(secondaryKey, nowMs)) {
    return { ok: false, reason: 'group-cooldown', retryInMs: caster.cooldowns.remainingMs(secondaryKey, nowMs) };
  }

  const effect = spell.effect;
  // Dano precisa de alvo ao alcance — ANTES da mana, que sai por último. Forma que sai do
  // lançador (onda, feixe, explosão em volta) não tem alcance: `aim.distance` vem zero da mira,
  // e `range` não existe nela (o boot recusa). O dano ao longo do tempo (CMB-07) mira como o
  // dano: ele precisa de alvo, e o tique é que passa pelo resolver depois.
  if (effect.kind === 'damage' || effect.kind === 'damage-over-time') {
    if (aim === null || aim.targets.length === 0) {
      return { ok: false, reason: 'no-target', retryInMs: NOT_WAITING };
    }
    // Só o alvo PRINCIPAL é conferido contra o alcance: quem foi pego pela área está lá porque
    // cai dentro da forma, não porque o lançador o alcança.
    if (effect.range !== undefined && aim.distance > effect.range) {
      return { ok: false, reason: 'out-of-range', retryInMs: NOT_WAITING };
    }
  }
  if (caster.mana < spell.manaCost) {
    return { ok: false, reason: 'not-enough-mana', retryInMs: NOT_WAITING };
  }

  caster.mana -= spell.manaCost;
  // Os três livros de uma vez: a magia, o grupo e, se houver, o secundário.
  caster.cooldowns.start(key, nowMs, spell.cooldownMs);
  if (groupKey !== null && spell.groupCooldownMs !== undefined) {
    caster.cooldowns.start(groupKey, nowMs, spell.groupCooldownMs);
  }
  if (secondaryKey !== null && spell.secondaryGroup !== undefined) {
    caster.cooldowns.start(secondaryKey, nowMs, spell.secondaryGroup.cooldownMs);
  }

  switch (effect.kind) {
    case 'damage': {
      const targets = (aim as SpellAim).targets;
      // Uma rolagem POR ALVO, na ordem em que eles chegaram. A ordem é contrato: trocar qual
      // sorteio cai em quem faz a mesma semente render uma hunt diferente, e o `AGENTS.md`
      // deste pacote registra que semente e ordem de consumo do RNG são contrato de loot também.
      //
      // `kind: 'magic'` porque a eficácia da armadura contra magia é outra, e ela é conteúdo
      // (`combat/baseline.json`) — não motor. A postura (Swift Foot, Protector) multiplica o
      // poder ANTES da armadura, como faz com o golpe.
      const dealt = caster.conditions.damageDealtScale('spell');
      const hits: number[] = [];
      let total = 0;
      for (let i = 0; i < targets.length; i += 1) {
        const target = targets[i] as SpellTarget;
        const power = Math.round(powerOf(effect, caster, scaling, combat, rng) * dealt);
        const result = resolveDamage(
          { rawDamage: power, source: 'spell', damageType: effect.damageType },
          { armor: target.armor, dodgeChance: target.dodgeChance, mitigation: target.mitigation },
          'pve',
          combat,
          rng,
        );
        hits.push(result.resolvedDamage);
        total += result.resolvedDamage;
      }
      return { ok: true, healed: 0, manaRestored: 0, damage: total, hits, goldSpent: 0 };
    }
    case 'heal':
      return {
        ok: true,
        healed: restore(caster, 'health', powerOf(effect, caster, scaling, combat, rng)),
        manaRestored: 0, damage: 0, hits: NO_HITS, goldSpent: 0,
      };
    case 'heal-over-time':
      return cast({
        key: 'heal-over-time', spellId: spell.id, expiresAtMs: nowMs + effect.durationMs,
        tick: { amount: effect.amount, intervalMs: effect.intervalMs },
      });
    case 'haste':
      return cast({
        key: 'haste', spellId: spell.id, expiresAtMs: nowMs + effect.durationMs,
        speedPercent: effect.speedPercent,
        ...(effect.damageDealtPercent === undefined ? {} : { damageDealtPercent: effect.damageDealtPercent }),
      });
    case 'buff':
      return cast({
        key: 'buff', spellId: spell.id, expiresAtMs: nowMs + effect.durationMs,
        ...(effect.damageDealtPercent === undefined ? {} : { damageDealtPercent: effect.damageDealtPercent }),
        ...(effect.damageTakenPercent === undefined ? {} : { damageTakenPercent: effect.damageTakenPercent }),
      });
    case 'mana-shield':
      return cast({ key: 'mana-shield', spellId: spell.id, expiresAtMs: nowMs + effect.durationMs });
    /**
     * Dano ao longo do tempo (CMB-07): a magia NÃO bate agora — devolve a condição, e quem a
     * aplica (o ruleset) agenda o tique. O `targetId` fica vazio aqui porque o lançador não
     * conhece o id do alvo; o ruleset o preenche com o alvo principal da mira. Cada tique
     * chama o resolver canônico com `source: 'spell'`.
     */
    case 'damage-over-time':
      return cast({
        key: 'damage-over-time', spellId: spell.id, expiresAtMs: nowMs + effect.durationMs,
        merge: 'refresh',
        tick: {
          kind: 'damage', amount: effect.amount, intervalMs: effect.intervalMs,
          damageType: effect.damageType, source: 'spell',
        },
      });
  }
}

/** O sucesso de uma magia que aplica uma condição: nada muda no lançador além da mana. */
function cast(condition: ConditionState): CastSuccess {
  return { ok: true, healed: 0, manaRestored: 0, damage: 0, hits: NO_HITS, goldSpent: 0, condition };
}

/**
 * Usa o supply, se houver gold.
 *
 * §20.1: poção e runa **não são itens físicos** — usar debita gold direto, e por isso não há
 * estoque a conferir nem instância a consumir. O saldo nunca fica negativo, e a garantia é a
 * ordem: o débito é RECUSADO antes, não corrigido depois.
 *
 * Sem cooldown PRÓPRIO separado: o livro é o do GRUPO (`groupCooldownMs` do conteúdo), como o
 * `group:<g>` de `castSpell`. Um segundo cooldown individual ao lado do de grupo seria dois
 * lugares decidindo a mesma coisa, e o dia em que eles divergissem ninguém saberia qual valia.
 * O início do livro é o mesmo ponto do `castSpell`: depois do pagamento, quando a ação SAIU.
 */
export function useSupply(
  user: CharacterRuntime,
  supply: Supply,
  /** Só a runa (#165) usa os quatro: poção passa `null` e ignora o resto. */
  aim: SpellAim | null = null,
  combat?: Combat,
  rng?: Rng,
  scaling?: SpellScaling,
  /** Quem paga (#192). Ausente: o próprio usuário, do saldo dele — o solo de sempre. */
  purse: Purse = ownPurse(user),
  /**
   * O relógio LÓGICO da sessão. Ausente é "não inicia cooldown" — caminho de fixture que prova
   * o gold sem a mecânica de tempo. O ruleset em produção sempre passa `session.nowMs`, e é o
   * que faz o uso trancar o grupo como o lançamento de magia.
   */
  nowMs?: number,
): CastResult {
  // Runa de ataque (#165, ADR 0026 d.8): a ordem das recusas é a de `castSpell` — requisitos,
  // alvo, alcance, e SÓ ENTÃO o gold. Runa em ninguém não pode custar.
  if (supply.effect.kind === 'damage') {
    if (supply.requires.level !== undefined && user.level < supply.requires.level) {
      return { ok: false, reason: 'level-too-low', retryInMs: NOT_WAITING };
    }
    if (supply.requires.magicLevel !== undefined && (scaling?.skillLevel ?? 0) < supply.requires.magicLevel) {
      return { ok: false, reason: 'magic-level-too-low', retryInMs: NOT_WAITING };
    }
    if (aim === null || aim.targets.length === 0) return { ok: false, reason: 'no-target', retryInMs: NOT_WAITING };
    if (aim.distance > supply.effect.range) return { ok: false, reason: 'out-of-range', retryInMs: NOT_WAITING };
    if (!purse.canAfford(supply.price)) return { ok: false, reason: 'not-enough-gold', retryInMs: NOT_WAITING };
    // Chamador sem contexto de combate: a runa não existe para ele — nunca dano sem `rng`.
    if (combat === undefined || rng === undefined || scaling === undefined) return NOT_IN_CATALOG;
    purse.pay(supply.price);
    startSupplyCooldown(user, supply, nowMs);
    const hits: number[] = [];
    let total = 0;
    for (let i = 0; i < aim.targets.length; i += 1) {
      const target = aim.targets[i] as SpellTarget;
      // UMA rolagem por alvo, na ordem da mira — o contrato do loot e da magia.
      const { min, max } = spellPowerRange(supply.effect.basePower, user.level, scaling.skillLevel, combat.spellPower);
      const power = Math.round(rng.integer(min, max) * user.conditions.damageDealtScale('spell'));
      const result = resolveDamage(
        { rawDamage: power, source: 'rune', damageType: supply.effect.damageType },
        { armor: target.armor, dodgeChance: target.dodgeChance, mitigation: target.mitigation },
        'pve', combat, rng,
      );
      hits.push(result.resolvedDamage);
      total += result.resolvedDamage;
    }
    return { ok: true, healed: 0, manaRestored: 0, damage: total, hits, goldSpent: supply.price };
  }

  if (!purse.canAfford(supply.price)) {
    return { ok: false, reason: 'not-enough-gold', retryInMs: NOT_WAITING };
  }

  purse.pay(supply.price);
  startSupplyCooldown(user, supply, nowMs);
  return supply.effect.kind === 'heal'
    ? {
      ok: true,
      healed: restore(user, 'health', supply.effect.amount),
      manaRestored: 0,
      damage: 0,
      hits: NO_HITS,
      goldSpent: supply.price,
    }
    : {
      ok: true,
      healed: 0,
      manaRestored: restore(user, 'mana', supply.effect.amount),
      damage: 0,
      hits: NO_HITS,
      goldSpent: supply.price,
    };
}

/**
 * Tranca o livro do grupo depois que o uso SAIU — o mesmo ponto do `castSpell`, e pelo mesmo
 * motivo: uma ação recusada não pode consumir o cooldown de quem não a executou. Sem `nowMs` o
 * tempo lógico não está disponível e nada é iniciado (caminho de fixture).
 */
function startSupplyCooldown(user: CharacterRuntime, supply: Supply, nowMs: number | undefined): void {
  if (nowMs === undefined) return;
  user.cooldowns.start(groupCooldownKey(supply.group), nowMs, supply.groupCooldownMs);
}

/**
 * Quem paga um supply (#192, ADR 0027). `canAfford` é conferido ANTES de qualquer efeito e
 * `pay` debita depois — a ordem que `useSupply` sempre teve. Em solo é o próprio usuário; na
 * party compartilhada é o rateio entre os presentes, que só o ruleset sabe montar.
 */
export interface Purse {
  canAfford(cost: number): boolean;
  pay(cost: number): void;
}

/** A bolsa de UM: o saldo dele, e o débito no `goldDelta` dele. */
export function ownPurse(user: CharacterRuntime): Purse {
  return {
    canAfford: (cost) => balanceOf(user) >= cost,
    pay: (cost) => { user.goldDelta -= cost; },
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
