// O texto DERIVADO das automações (AB-12/#427): o resumo da linha, o nome de um item, os
// defaults de um rascunho novo e o problema que bloqueia o Salvar. PURO: sem React, sem store,
// sem socket e sem relógio — o mesmo molde de `action-config.ts`.
//
// O resumo é gerado dos parâmetros e das condições (RF-03): trocar o item ou o limiar muda o que
// a linha mostra. Nada aqui avalia elegibilidade, estoque, alvo ou resultado (invariante 4) — é
// apresentação, e quem decide é o `sim`.
//
// **Adaptação de forma (AB-12).** O vocabulário v2 real usa `BotConditionV2` (o `BotCondition` do
// rascunho da issue era o tipo v1). O modelo e os parâmetros são o `BotAutomation` do #418, e os
// itens vêm do catálogo v2 do #424.

import type { BotAutomation, BotAutomationModel, BotConditionV2 } from '@draconya/content';
import type { ItemDefinition } from '../state/hud.js';
import { OPERATOR_OPTIONS } from './action-config.js';

/** O glifo de cada comparador, a mesma fonte que o `ConditionList` usa. */
const OPERATOR_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  OPERATOR_OPTIONS.map((option) => [option.value, option.label]),
);

/** A forma humana de uma condição v2: "HP < 50 %", "≥ 3 alvos", "sem haste". */
export function conditionSummary(condition: BotConditionV2): string {
  if (condition.kind === 'condition') {
    if (condition.conditionId === '') return 'Condição';
    return condition.present ? `sem ${condition.conditionId}` : `com ${condition.conditionId}`;
  }
  const op = OPERATOR_LABEL[condition.op] ?? condition.op;
  if (condition.kind === 'targets') return `${op} ${String(condition.count)} alvos`;
  const label = condition.kind === 'hp' ? 'HP' : condition.kind === 'mana' ? 'Mana' : 'Vida do alvo';
  return `${label} ${op} ${String(condition.percent)} %`;
}

/**
 * O nome de exibição do item; sem item no catálogo devolve o PRÓPRIO id (nunca inventa um nome).
 * O id cru é a resposta certa para conteúdo que mudou sob uma sessão de versão fixa (invariante 7).
 */
export function itemName(itemId: string, items: readonly ItemDefinition[]): string {
  return items.find((item) => item.id === itemId)?.name ?? itemId;
}

/** O resumo da LINHA, gerado dos parâmetros e das condições — nunca um texto fixo por modelo. */
export function automationSummary(automation: BotAutomation, items: readonly ItemDefinition[]): string {
  const enter = automation.enter.map(conditionSummary).join(' · ');
  const exit = automation.exit.map(conditionSummary).join(' · ');
  switch (automation.model) {
    case 'renew-ring':
    case 'renew-amulet':
      // O gatilho é o slot vazio (AB-08); o item está no modal, então o resumo é o "quando".
      return 'quando acabar';
    case 'swap-ammo-by-targets':
      return `${enter} → ${itemName(automation.params.ammoA, items)} · senão ${itemName(automation.params.ammoB, items)}`;
    case 'swap-weapon-shield-by-hp':
      return `${enter} → Escudo + ${itemName(automation.params.oneHanded, items)} · ${exit} → ${itemName(automation.params.twoHanded, items)}`;
    case 'swap-ring':
      return `${enter} → ${itemName(automation.params.itemId, items)} · ${exit}`;
  }
}

/**
 * Apresentação do catálogo de modelos (captura 35): o subtítulo de cada modelo. O mapa é SÓ
 * decoração — a LISTA de modelos é `catalogue.bot.automations`, e modelo sem subtítulo sai sem
 * ele. NÃO contém "Comer comida" (ADR 0032 d.9) nem a trava de level revogada (ADR 0032 d.5).
 */
export const MODEL_SUBTITLE: Readonly<Partial<Record<BotAutomationModel, string>>> = {
  'renew-ring': 'Troca o anel do dedo quando as cargas acabam',
  'renew-amulet': 'Troca o amuleto quando as cargas acabam',
  'swap-ammo-by-targets': 'Munição em área com muitos alvos, single-target com poucos',
  'swap-weapon-shield-by-hp': 'Set defensivo com HP baixo, ofensivo com HP alto',
  'swap-ring': 'Troca o anel e o remove quando o HP recupera',
};

/** Os parâmetros de item de cada modelo — o que a tela oferece e o que `blankAutomation` exige. */
export type AutomationItemParam =
  | 'itemId' | 'ammoA' | 'ammoB' | 'oneHanded' | 'shield' | 'twoHanded';

/**
 * Os itens que um parâmetro aceita. O `slot` do catálogo separa anel (`finger`) de colar
 * (`neck`), munição (`ammo`) e escudo (`shield`); entre as armas, `twoHanded` separa o set
 * defensivo do ofensivo. É a única "lista de opções" desta tela, e ela é derivada do catálogo.
 */
export function itemsForParam(
  model: BotAutomationModel,
  param: AutomationItemParam,
  items: readonly ItemDefinition[],
): readonly ItemDefinition[] {
  switch (param) {
    case 'ammoA':
    case 'ammoB':
      return items.filter((item) => item.slot === 'ammo');
    case 'shield':
      return items.filter((item) => item.slot === 'shield');
    case 'oneHanded':
      return items.filter((item) => item.slot === 'hand' && item.twoHanded !== true);
    case 'twoHanded':
      return items.filter((item) => item.slot === 'hand' && item.twoHanded === true);
    case 'itemId':
      return items.filter((item) => item.slot === (model === 'renew-amulet' ? 'neck' : 'finger'));
  }
}

/** O primeiro item de um parâmetro, ou `null` quando o catálogo não tem nenhum do slot. */
function firstItemId(
  model: BotAutomationModel, param: AutomationItemParam, items: readonly ItemDefinition[],
): string | null {
  return itemsForParam(model, param, items)[0]?.id ?? null;
}

/** Um rascunho novo do modelo, com defaults do kit e o primeiro item do slot exigido. */
export function blankAutomation(
  model: BotAutomationModel,
  items: readonly ItemDefinition[],
): BotAutomation | null {
  switch (model) {
    case 'renew-ring': {
      const itemId = firstItemId(model, 'itemId', items);
      if (itemId === null) return null;
      return { model, params: { itemId }, enter: [], exit: [] };
    }
    case 'renew-amulet': {
      const itemId = firstItemId(model, 'itemId', items);
      if (itemId === null) return null;
      return { model, params: { itemId }, enter: [], exit: [] };
    }
    case 'swap-ammo-by-targets': {
      const ammoA = firstItemId(model, 'ammoA', items);
      const ammoB = itemsForParam(model, 'ammoB', items)[1]?.id ?? ammoA;
      if (ammoA === null || ammoB === null) return null;
      return {
        model,
        params: { ammoA, ammoB },
        enter: [{ kind: 'targets', op: '>=', count: 3 }],
        exit: [{ kind: 'targets', op: '<', count: 3 }],
      };
    }
    case 'swap-weapon-shield-by-hp': {
      const oneHanded = firstItemId(model, 'oneHanded', items);
      const shield = firstItemId(model, 'shield', items);
      const twoHanded = firstItemId(model, 'twoHanded', items);
      if (oneHanded === null || shield === null || twoHanded === null) return null;
      return {
        model,
        params: { oneHanded, shield, twoHanded },
        enter: [{ kind: 'hp', op: '<', percent: 50 }],
        exit: [{ kind: 'hp', op: '>', percent: 80 }],
      };
    }
    case 'swap-ring': {
      const itemId = firstItemId(model, 'itemId', items);
      if (itemId === null) return null;
      return {
        model,
        params: { itemId, manaFloor: 0, restorePrevious: true },
        enter: [{ kind: 'hp', op: '<', percent: 50 }],
        exit: [{ kind: 'hp', op: '>', percent: 80 }],
      };
    }
  }
}

/** Os ids de item de uma automação, para conferir que todos existem no catálogo. */
function itemIdsOf(automation: BotAutomation): readonly string[] {
  switch (automation.model) {
    case 'renew-ring':
    case 'renew-amulet':
    case 'swap-ring':
      return [automation.params.itemId];
    case 'swap-ammo-by-targets':
      return [automation.params.ammoA, automation.params.ammoB];
    case 'swap-weapon-shield-by-hp':
      return [automation.params.oneHanded, automation.params.shield, automation.params.twoHanded];
  }
}

/**
 * Bloqueia o Salvar: faixa morta de HP ou item ausente do catálogo. A faixa morta é a mesma
 * regra do `botAutomationSchema`/`sim` (AB-08): saída de HP precisa ser MAIOR que a entrada,
 * senão a troca oscila a cada golpe (rodapé das capturas 37/38). O servidor recusa de novo, e a
 * tela mostra o motivo antes de salvar.
 */
export function automationProblem(automation: BotAutomation, items: readonly ItemDefinition[]): string | null {
  if (automation.model === 'swap-weapon-shield-by-hp' || automation.model === 'swap-ring') {
    const enter = automation.enter.find((condition) => condition.kind === 'hp');
    const exit = automation.exit.find((condition) => condition.kind === 'hp');
    if (
      enter !== undefined && exit !== undefined
      && enter.kind === 'hp' && exit.kind === 'hp'
      && exit.percent <= enter.percent
    ) {
      return 'A saída de HP precisa ser maior que a entrada — sem faixa morta a troca oscila a cada golpe.';
    }
  }
  const missing = itemIdsOf(automation).find((id) => !items.some((item) => item.id === id));
  if (missing !== undefined) return `O item ${missing} não está no catálogo.`;
  return null;
}
