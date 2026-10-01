// A defesa, a armadura e a mitigação percentual do JOGADOR no `combat-v3` (#549, M30-02; ADR
// 0040) — as três funções PURAS que substituem, só para o defensor JOGADOR, os números ad hoc
// que o `combat-v1`/`v2` (e o `combat-v3` até esta issue) usavam: `combat.player.armor` (uma
// constante de conteúdo, "o personagem desarmado no level 1") e a defesa escalada por
// `powerMultiplier` em `hunt.ts#defenseSourceOf` (uma fórmula própria do Draconya, não do
// Tibia). Aqui embaixo é o mecanismo REAL do Tibia 13.x — nenhuma das duas fica sob esta issue
// nas outras versões: `combat-v1`/`v2` continuam lendo os números antigos (`hunt.ts`
// `#playerDefender` só troca de caminho quando `compatibilityProfile === 'combat-v3'`).
//
// Fórmula ORIGINAL em TypeScript a partir do MECANISMO descrito pelo Canary — nunca código
// copiado, traduzido ou adaptado linha a linha (ADR 0019).
//
//   - `playerDefense`  → `Player::getDefense`      (Canary `player.cpp:776-813`)
//   - `playerArmor`    → `Player::getArmor`         (Canary `player.cpp:658-667`)
//   - `playerMitigation` → `PlayerWheel::calculateMitigation` (Canary
//     `player_wheel.cpp:4072-4124`), que é o que `Creature::getMitigation`/`mitigateDamage`
//     consome do lado do jogador (`player.cpp:750-752`; `creature.cpp:911-921`).
//
// O que fica de FORA, de propósito (M41, Roda do Destino — ADR 0040 decisão 1, "o multiplicador
// da Roda é 0 até o M41"): o bônus `Combat Mastery` que soma em `defenseValue` quando um escudo
// tem `defense > 0`, e o `mitigation += mitigation * getMitigationMultiplier() / 100` no fim de
// `calculateMitigation`. Os dois são exclusivamente da Wheel — sem gema, os dois são zero, e
// nenhuma fórmula aqui precisa deles ainda.
//
// `fightMode` é PARÂMETRO das duas funções que o usam (`playerDefense`/`playerMitigation`), na
// forma exata do switch do Canary, e desde a M30-03 (#550) é a POSTURA que o jogador escolheu
// (`CharacterRuntime.fightMode`) — `combat/fight-mode.ts` guarda as três tabelas de fator.
//
// `playerDefense` usa a variante DINÂMICA do fator de defesa (`Player::getDefenseFactor(false)`,
// a que `Creature::blockHit` chama): nos modos ofensivo e balanceado o fator é 0.5/0.75 enquanto
// o jogador bateu há menos de um intervalo de ataque (`recentlyAttacked`) e 1.0 depois; o
// defensivo é 1.0 sempre. QUEM CHAMA decide `recentlyAttacked` — comparando o relógio lógico da
// sessão com o `lastAttackAtMs` do personagem (`attackedRecently`) —, e a função continua pura.
// A variante ESTÁTICA (0.5/0.75/1.0 sem olhar o relógio) é só o que o Canary manda ao CLIENTE
// para o painel de stats — apresentação, fora do resultado da caça.

import { defenseFactorFor, mitigationFightFactorFor } from './fight-mode.js';
import type { FightMode } from './fight-mode.js';

/** A arma na mão, para `playerDefense` (`Player::getWeaponSkill`/`getDefense`). */
export interface PlayerDefenseWeapon {
  /** `weapon.getDefense()` — 0 se a arma não declara `defense` (a maioria). */
  readonly defense: number;
  /** `weapon.getExtraDefense()` — o `extraDefense` do item (§549; 0 na maioria). */
  readonly extraDefense: number;
  /**
   * `getWeaponSkill(weapon)`: o nível da skill que a FAMÍLIA da arma aponta (`melee` para
   * sword/axe/club/fist, `distance` para bow/crossbow) — já com o bônus de equipamento da
   * mesma skill somado, como `hunt.ts#skillLevelOf` já calcula para o dano. Uma arma cuja
   * família não aponta skill de golpe (wand/rod: `getWeaponSkill` do Canary devolve 0 para
   * `WEAPON_WAND`, `default: 0`) tem que chegar aqui como `0` — o CHAMADOR (`hunt.ts
   * #playerDefenseV3`) é quem filtra isso, porque a família `wand` aponta `skillId: 'magic'`
   * (usado para o DANO, DT-02) e não zero por conta própria; sem o filtro, esta função nunca
   * vê o `0` que aciona o `defenseSkill === 0` abaixo quando não há escudo para sobrescrever
   * (achado de revisão, #549).
   */
  readonly skillLevel: number;
}

/** O escudo na mão secundária, para `playerDefense`. */
export interface PlayerDefenseShield {
  /** `shield.getDefense()`. */
  readonly defense: number;
}

export interface PlayerDefenseInput {
  readonly weapon?: PlayerDefenseWeapon;
  readonly shield?: PlayerDefenseShield;
  /** `getSkillLevel(SKILL_FIST)` — em Draconya, o nível da skill `melee` (fist e as três armas
   * corpo a corpo foram consolidadas numa skill só, #521/ADR 0037; ver `AGENTS.md` de `sim`). */
  readonly fistSkillLevel: number;
  /** `getSkillLevel(SKILL_SHIELD)` — em Draconya, a skill `shielding`. */
  readonly shieldSkillLevel: number;
  readonly fightMode: FightMode;
  /**
   * O jogador bateu há menos de um intervalo de ataque (`attackedRecently`,
   * `combat/fight-mode.ts`)? É o `(OTSYS_TIME() - lastAttack) < getAttackSpeed()` de
   * `Player::getDefenseFactor(false)` — só muda o fator nos modos ofensivo e balanceado.
   */
  readonly recentlyAttacked: boolean;
}

/**
 * `Player::getDefense` (Canary `player.cpp:776-813`) — a defesa do JOGADOR que o `combat-v3`
 * (`resolveBlockHit`, `blockhit.ts`) rola em faixa (`uniform_random(defense/2, defense)`)
 * enquanto o `blockCount` tiver carga.
 *
 * A prioridade É a ordem do Canary: sem nada na mão, `defenseValue` começa em 7 (a defesa do
 * PUNHO) e `defenseSkill` é a skill de fist; uma ARMA na mão troca os dois pela dela; um ESCUDO
 * troca os dois de novo — `defenseValue` vira o do escudo (mais o `extraDefense` da arma, se
 * houver uma) e `defenseSkill` vira a skill de escudo. Por isso a arma é olhada primeiro e o
 * escudo por cima, exatamente como as duas atribuições sequenciais do Canary.
 *
 * `vocation->defenseMultiplier` fica de FORA (identidade, `× 1`): as cinco vocações do Canary —
 * e todas as promoções — declaram `<formula defense="1.0">` em `vocations.xml` hoje (conferido
 * em 2026-09-26); incluir o campo no conteúdo agora seria uma tabela que nunca diverge de 1.
 * Note-se que `getDefense` NÃO trunca esse multiplicador do mesmo jeito que `getArmor` — em
 * `getArmor` o Canary CASTA só o multiplicador para inteiro antes de multiplicar (`armor *
 * static_cast<int32_t>(vocation->armorMultiplier)`), então qualquer valor abaixo de `2.0` já
 * colapsa para `1` (e abaixo de `1.0`, para `0`) ANTES da multiplicação; em `getDefense` o
 * `vocation->defenseMultiplier` continua `float` até o fim da expressão (`double`), e é só o
 * `int32_t` de RETORNO da função que trunca o PRODUTO inteiro uma vez. Hoje as duas dão o mesmo
 * resultado porque todo `1.0` trunca para `1` de qualquer jeito — mas um multiplicador
 * fracionário futuro (por exemplo `0.5`) se comportaria de forma bem diferente em cada função:
 * zeraria a armadura via `getArmor`, mas só escalaria a defesa via `getDefense`. Reproduzir
 * `getDefense` copiando o padrão de `getArmor` reproduziria o mecanismo ERRADO.
 */
export function playerDefense(input: PlayerDefenseInput): number {
  let defenseSkill = input.fistSkillLevel;
  let defenseValue = 7;
  const { weapon, shield } = input;

  if (weapon !== undefined) {
    defenseValue = weapon.defense + weapon.extraDefense;
    defenseSkill = weapon.skillLevel;
  }
  if (shield !== undefined) {
    defenseValue = weapon === undefined ? shield.defense : shield.defense + weapon.extraDefense;
    defenseSkill = input.shieldSkillLevel;
  }

  if (defenseSkill === 0) {
    return input.fightMode === 'defense' ? 2 : 1;
  }

  const defenseScalingFactor = shield !== undefined
    ? 0.16
    : (weapon !== undefined && weapon.defense > 0 ? 0.146 : 0.15);

  const raw = (defenseSkill / 4 + 2.23) * defenseValue
    * defenseFactorFor(input.fightMode, input.recentlyAttacked) * defenseScalingFactor;
  // `int32_t Player::getDefense(...)` — o C++ trunca a conversão de `double` para inteiro.
  return Math.trunc(raw);
}

/**
 * `Player::getArmor` (Canary `player.cpp:658-667`) — soma da armadura equipada nos sete slots
 * que contam (cabeça, colar, peito, pernas, pé, anel, munição — NUNCA mão, escudo ou mochila).
 * `Inventory.armor` já soma só esses campos porque nenhum item de mão/escudo/mochila do
 * catálogo atual declara `armor` (eles usam `defense`, um campo DIFERENTE) — a soma que chega
 * aqui já é a certa, e esta função existe para o multiplicador de vocação ter um lugar próprio,
 * citável, em vez de ficar implícito na chamada.
 *
 * `vocation->armorMultiplier` fica de FORA pela MESMA razão de `playerDefense`: `1.0` em toda
 * vocação do `vocations.xml` hoje, conferido em 2026-09-26.
 */
export function playerArmor(equippedArmor: number): number {
  return equippedArmor;
}

/** Como a vocação escala a mitigação (`<mitigation multiplier primaryShield secondaryShield>`
 * de `vocations.xml`) — `vocationSchema.mitigation`/`progressionSchema.mitigation`. */
export interface PlayerMitigationVocation {
  readonly multiplier: number;
  readonly primaryShield: number;
  readonly secondaryShield: number;
}

/** A arma na mão, para `playerMitigation` (`PlayerWheel::calculateMitigation`). */
export interface PlayerMitigationWeapon {
  readonly defense: number;
  readonly extraDefense: number;
  readonly twoHanded: boolean;
  /**
   * A arma atira munição com `ammoType` bolt/arrow (`weapon.getAmmoType() == AMMO_BOLT ||
   * AMMO_ARROW`) — bow e crossbow. Em Draconya, `weapon.ammoFamily !== undefined`.
   */
  readonly usesAmmo: boolean;
}

/** O escudo na mão secundária, para `playerMitigation`. */
export interface PlayerMitigationShield {
  readonly defense: number;
  /** `shield.isSpellBook() || shield.isQuiver()` — os dois usam o MESMO ramo da fórmula. */
  readonly rangedFocus: boolean;
}

export interface PlayerMitigationInput {
  readonly shieldSkillLevel: number;
  readonly vocation: PlayerMitigationVocation;
  readonly weapon?: PlayerMitigationWeapon;
  readonly shield?: PlayerMitigationShield;
  readonly fightMode: FightMode;
}

/**
 * `PlayerWheel::calculateMitigation` (Canary `player_wheel.cpp:4072-4124`) — a mitigação
 * percentual que `Creature::mitigateDamage` tira do dano JÁ com defesa/armadura aplicadas
 * (`damage -= damage * mitigation / 100`, `creature.cpp:911-921`; a exceção de lifedrain/
 * manadrain é do M29-07, e não muda nada aqui). O valor devolvido É o percentual — `1.63`
 * significa "tira 1,63 % do dano", a mesma convenção de `Monster.defenseMitigation`
 * (`schemas.ts`).
 *
 * Escudo e arma são conferidos em SEQUÊNCIA, não em exclusão mútua — os dois podem contribuir
 * ao mesmo tempo (Knight com Mystic Blade + Mastermind Shield): o escudo dá `defenseValue`
 * inicial e o `shieldFactor` (ou o `distanceFactor`, se for spellbook/quiver); a arma pode
 * SOBRESCREVER os dois de novo, na mesma ordem de precedência do Canary — munição primeiro
 * (`usesAmmo`), depois duas mãos, depois uma mão (soma em vez de substituir).
 */
export function playerMitigation(input: PlayerMitigationInput): number {
  let defenseValue = 0;
  let shieldFactor = 1;
  let distanceFactor = 1;
  const { vocation, weapon, shield } = input;

  if (shield !== undefined) {
    if (shield.rangedFocus) {
      distanceFactor = vocation.secondaryShield;
    } else {
      shieldFactor = vocation.primaryShield;
    }
    defenseValue = shield.defense;
  }

  if (weapon !== undefined) {
    if (weapon.usesAmmo) {
      distanceFactor = vocation.secondaryShield;
    } else if (weapon.twoHanded) {
      defenseValue = weapon.defense + weapon.extraDefense;
      shieldFactor = vocation.secondaryShield;
    } else {
      defenseValue += weapon.extraDefense;
      shieldFactor = vocation.primaryShield;
    }
  }

  const fightFactor = mitigationFightFactorFor(input.fightMode);
  const raw = ((input.shieldSkillLevel * vocation.multiplier + shieldFactor * defenseValue) / 100)
    * fightFactor * distanceFactor;
  // `std::ceil(x * 100.0f) / 100.0f` — duas casas decimais, arredondadas para CIMA.
  return Math.ceil(raw * 100) / 100;
}
