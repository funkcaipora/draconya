// O executor das cinco automações do catálogo (AB-08, ADR 0032 d.9).
//
// PURA: sem I/O, sem relógio, sem RNG, sem protocolo. O atuador opera o `Inventory` em memória,
// e a automação NUNCA emite opcode — quem decide e escreve é a sessão dona (invariantes 1, 4, 9).
//
// Como o `compileBot`, isto é um COMPILADOR: a configuração vira um vetor de funções
// `run(view, actuator)`, uma vez, e o ruleset só itera. Cada modelo fecha sobre os próprios
// parâmetros e sobre `enter`/`exit` compilados — a histerese emerge da assimetria, sem estado
// extra além do `ringReplaced` que já existia (DT-02/DT-04).
//
// **Entrada é OU e saída é E.** `enter` vazio é FALSO (nunca entra); `exit` vazio é FALSO
// (nunca sai). O E vazio verdadeiro faria toda automação reverter no mesmo ciclo em que entrou
// (DT-01).

import type { BotAutomation, BotConditionV2, ItemSlot } from '@draconya/content';
import type { CarriedItem } from './inventory.js';
import { compileAll, compileCondition, percentOf } from './bot.js';
import type { BotView } from './bot.js';

/**
 * O que o executor pode fazer com o inventário do personagem. Sem I/O, sem protocolo.
 *
 * É a fronteira que mantém a automação testável com um atuador FALSO e garante que ela não
 * conhece `Session`, `protocol` nem o ruleset.
 */
export interface AutomationActuator {
  equippedItemId(slot: ItemSlot): string | null;
  equippedInstanceId(slot: ItemSlot): string | null;
  carriedItem(itemId: string): CarriedItem | null;
  /** Slot de conteúdo do item; `null` quando não é equipável. */
  slotOf(itemId: string): ItemSlot | null;
  /** Veste a instância da mochila. `false` na recusa — nunca lança. */
  equip(instanceId: string): boolean;
  /** Desveste o slot para a mochila. `false` quando não havia nada (no-op silencioso). */
  unequip(slot: ItemSlot): boolean;
  /**
   * A munição selecionada para a família que a arma equipada dispara, ou `null`. A munição é
   * ABSTRATA: a seleção é por família, não um item no slot (ADR 0026 d.3).
   */
  selectedAmmoId(): string | null;
  /** Seleciona a munição pelo id. `false` na recusa (level, catálogo) — nunca lança. */
  selectAmmo(ammoId: string): boolean;
  rememberRing(instanceId: string | null): void;
  previousRing(): string | null;
}

export type AutomationOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'applied'; readonly event: string; readonly detail: string }
  | {
    readonly kind: 'blocked';
    readonly reason: 'missing-item' | 'not-equippable' | 'ammo-unavailable';
    readonly itemId: string;
  };

export interface CompiledAutomation {
  readonly model: BotAutomation['model'];
  run(view: BotView, actuator: AutomationActuator): AutomationOutcome;
}

export interface CompiledAutomations {
  readonly list: readonly CompiledAutomation[];
}

/** O resultado silencioso. Compartilhado: um objeto por `run` é alocação que o `AGENTS.md` cobra. */
const IDLE: AutomationOutcome = { kind: 'idle' };

/** OU: vazio é FALSO — uma automação sem condição de entrada nunca entra (DT-01). */
function anyOf(conditions: readonly BotConditionV2[]): (view: BotView) => boolean {
  if (conditions.length === 0) return () => false;
  const predicates = conditions.map(compileCondition);
  return (view) => {
    for (let i = 0; i < predicates.length; i += 1) {
      if ((predicates[i] as (v: BotView) => boolean)(view)) return true;
    }
    return false;
  };
}

const missing = (itemId: string): AutomationOutcome =>
  ({ kind: 'blocked', reason: 'missing-item', itemId });

const notEquippable = (itemId: string): AutomationOutcome =>
  ({ kind: 'blocked', reason: 'not-equippable', itemId });

type RenewAutomation =
  | Extract<BotAutomation, { model: 'renew-ring' }>
  | Extract<BotAutomation, { model: 'renew-amulet' }>;

/**
 * Renovação por "quando acabar" (ADR 0032 d.8): o anel vence por duração e o colar esgota as
 * cargas, e os dois deixam o slot VAZIO. É o slot vazio que é o gatilho — com OUTRO item no
 * mesmo slot a automação não age (o `enter`/`exit` genéricos não participam do "renovar").
 */
function renew(
  automation: RenewAutomation, slot: ItemSlot, event: string,
): CompiledAutomation {
  const { itemId } = automation.params;
  return {
    model: automation.model,
    run(_view, act) {
      if (act.equippedItemId(slot) !== null) return IDLE;
      const carried = act.carriedItem(itemId);
      if (carried === null) return missing(itemId);
      if (!act.equip(carried.instanceId)) return notEquippable(itemId);
      return { kind: 'applied', event, detail: itemId };
    },
  };
}

const renewRing = (automation: Extract<BotAutomation, { model: 'renew-ring' }>): CompiledAutomation =>
  renew(automation, 'finger', 'ring-equipped');

const renewAmulet = (automation: Extract<BotAutomation, { model: 'renew-amulet' }>): CompiledAutomation =>
  renew(automation, 'neck', 'amulet-equipped');

/**
 * Seleciona uma munição da família, informando a falta sem interromper (ADR 0026 d.3). Não é
 * item no slot: a munição é abstrata, e a seleção é o que o tiro passa a usar.
 */
function swapAmmoTo(act: AutomationActuator, ammoId: string): AutomationOutcome {
  if (!act.selectAmmo(ammoId)) {
    return { kind: 'blocked', reason: 'ammo-unavailable', itemId: ammoId };
  }
  return { kind: 'applied', event: 'ammo-swapped', detail: ammoId };
}

/**
 * Munição por número de alvos (ADR 0032 d.9): a região é `ammoA` selecionada; `enter` (OU)
 * leva para A e `exit` (E) volta para B.
 */
function swapAmmoByTargets(
  automation: Extract<BotAutomation, { model: 'swap-ammo-by-targets' }>,
): CompiledAutomation {
  const enter = anyOf(automation.enter);
  const exit = compileAll(automation.exit, false);
  const { ammoA, ammoB } = automation.params;
  return {
    model: 'swap-ammo-by-targets',
    run(view, act) {
      if (act.selectedAmmoId() === ammoA) {
        if (!exit(view)) return IDLE;
        return swapAmmoTo(act, ammoB);
      }
      if (!enter(view)) return IDLE;
      return swapAmmoTo(act, ammoA);
    },
  };
}

/**
 * Arma/escudo por HP (ADR 0032 d.9): HP baixo pede uma mão + escudo, HP alto pede as duas mãos.
 *
 * É a única que precisa de ORDEM, porque o inventário recusa `hands-full` (bow com escudo,
 * #152): desequipar antes de equipar libera a mão e o escudo. Os itens são validados antes de
 * qualquer mutação — a operação é transação (referência §25).
 */
function swapWeaponShield(
  automation: Extract<BotAutomation, { model: 'swap-weapon-shield-by-hp' }>,
): CompiledAutomation {
  const enter = anyOf(automation.enter);
  const exit = compileAll(automation.exit, false);
  const { oneHanded, shield, twoHanded } = automation.params;
  return {
    model: 'swap-weapon-shield-by-hp',
    run(view, act) {
      const inRegion = act.equippedItemId('hand') === oneHanded
        && act.equippedItemId('shield') === shield;
      if (!inRegion) {
        if (!enter(view)) return IDLE;
        // "Já está no slot" É satisfeito: um item equipado não está em container, então exigir
        // `carriedItem` de quem já veste a arma de uma mão dava `missing-item` para sempre e o
        // escudo nunca subia. A mão só é desequipada quando NÃO é já a arma de uma mão; o
        // mesmo para o escudo.
        const oneAlready = act.equippedItemId('hand') === oneHanded;
        const boardAlready = act.equippedItemId('shield') === shield;
        const one = oneAlready ? null : act.carriedItem(oneHanded);
        const board = boardAlready ? null : act.carriedItem(shield);
        if (one === null && !oneAlready) return missing(oneHanded);
        if (board === null && !boardAlready) return missing(shield);
        if (!oneAlready) act.unequip('hand');
        if (!boardAlready) act.unequip('shield');
        if (one !== null && !act.equip(one.instanceId)) return notEquippable(oneHanded);
        if (board !== null && !act.equip(board.instanceId)) return notEquippable(shield);
        return {
          kind: 'applied', event: 'weapon-shield-swapped', detail: `${oneHanded}+${shield}`,
        };
      }
      if (!exit(view)) return IDLE;
      const two = act.carriedItem(twoHanded);
      if (two === null) return missing(twoHanded);
      act.unequip('shield');
      act.unequip('hand');
      if (!act.equip(two.instanceId)) return notEquippable(twoHanded);
      return { kind: 'applied', event: 'weapon-shield-swapped', detail: twoHanded };
    },
  };
}

/**
 * O ring swap do §13.8, agora no vocabulário novo: entrada HP < x OU alvos ≥ N, saída HP > y E.
 *
 * `manaFloor` desativa a máquina inteira e derruba o anel já equipado (ADR 0032 d.9); o anel
 * que estava no dedo antes é guardado no `ringReplaced` existente e devolvido quando
 * `restorePrevious` (DT-04).
 */
function swapRing(
  automation: Extract<BotAutomation, { model: 'swap-ring' }>,
): CompiledAutomation {
  const enter = anyOf(automation.enter);
  const exit = compileAll(automation.exit, false);
  const { itemId, manaFloor, restorePrevious } = automation.params;
  return {
    model: 'swap-ring',
    run(view, act) {
      const mana = percentOf(view.self.mana, view.self.maxMana);
      const wearing = act.equippedItemId('finger') === itemId;
      if (!wearing) {
        // `manaFloor` desativa a máquina inteira: não equipa abaixo do piso.
        if (mana < manaFloor) return IDLE;
        if (!enter(view)) return IDLE;
        const carried = act.carriedItem(itemId);
        if (carried === null) return missing(itemId);
        const previous = act.equippedInstanceId('finger');
        if (!act.equip(carried.instanceId)) return notEquippable(itemId);
        act.rememberRing(previous);
        return { kind: 'applied', event: 'ring-equipped', detail: itemId };
      }
      // Saída em E, MAIS o piso de mana (que derruba o anel já equipado).
      if (mana >= manaFloor && !exit(view)) return IDLE;
      if (!act.unequip('finger')) return IDLE;
      const previous = act.previousRing();
      act.rememberRing(null);
      if (restorePrevious && previous !== null) act.equip(previous);
      return { kind: 'applied', event: 'ring-removed', detail: '' };
    },
  };
}

function compileAutomation(automation: BotAutomation): CompiledAutomation {
  switch (automation.model) {
    case 'renew-ring': return renewRing(automation);
    case 'renew-amulet': return renewAmulet(automation);
    case 'swap-ammo-by-targets': return swapAmmoByTargets(automation);
    case 'swap-weapon-shield-by-hp': return swapWeaponShield(automation);
    case 'swap-ring': return swapRing(automation);
  }
}

/**
 * Compila o catálogo da configuração: só as HABILITADAS viram executor (RF-08).
 *
 * Desligada não age nem agenda — filtrar aqui é o que faz um runner sem automação habilitada
 * não receber evento nenhum.
 */
export function compileAutomations(
  automations: readonly BotAutomation[],
): CompiledAutomations {
  const list: CompiledAutomation[] = [];
  for (const automation of automations) {
    if (automation.enabled === false) continue;
    list.push(compileAutomation(automation));
  }
  return { list };
}
