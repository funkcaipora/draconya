// O catálogo dos cinco modelos de automação (AB-09, ADR 0032 d.9).
//
// A engine é dona do MECANISMO — o motor de cada modelo vive no `sim` (AB-08) —, e o conteúdo é
// dono dos RÓTULOS e da forma dos parâmetros. O catálogo é o descritor que o servidor manda no
// `catalogue.bot.automations`, para o painel do AB-12 montar o formulário sem ter a lista em
// código: se a tela e o servidor divergirem, o jogador configura o que o servidor recusa.
//
// Nunca contém arte (invariante 6): só ids de item e tipos de campo.

import { BOT_AUTOMATION_MODELS } from './schemas.js';
import type { BotAutomationModel } from './schemas.js';

/** O tipo de campo que o editor desenha. `item` abre o catálogo; os outros dois, um campo. */
export type BotAutomationParamKind = 'item' | 'number' | 'boolean';

export interface BotAutomationParamDescriptor {
  readonly name: string;
  readonly kind: BotAutomationParamKind;
}

export interface BotAutomationDescriptor {
  readonly model: BotAutomationModel;
  readonly label: string;
  readonly params: readonly BotAutomationParamDescriptor[];
}

/**
 * Os cinco modelos, na ordem de `BOT_AUTOMATION_MODELS` — a mesma que o `catalogue` publica.
 *
 * A ordem é contrato de apresentação: a tela lista nesta ordem, e o teste prende que todo
 * modelo do vocabulário tem descritor (um modelo novo sem linha aqui sumiria do painel em
 * silêncio).
 */
export const BOT_AUTOMATION_CATALOGUE: readonly BotAutomationDescriptor[] = [
  {
    model: 'renew-ring',
    label: 'Renovar anel',
    params: [{ name: 'itemId', kind: 'item' }],
  },
  {
    model: 'renew-amulet',
    label: 'Renovar colar',
    params: [{ name: 'itemId', kind: 'item' }],
  },
  {
    model: 'swap-ammo-by-targets',
    label: 'Trocar munição por alvos',
    params: [
      { name: 'ammoA', kind: 'item' },
      { name: 'ammoB', kind: 'item' },
    ],
  },
  {
    model: 'swap-weapon-shield-by-hp',
    label: 'Trocar arma/escudo por vida',
    params: [
      { name: 'oneHanded', kind: 'item' },
      { name: 'shield', kind: 'item' },
      { name: 'twoHanded', kind: 'item' },
    ],
  },
  {
    model: 'swap-ring',
    label: 'Trocar anel por vida',
    params: [
      { name: 'itemId', kind: 'item' },
      { name: 'manaFloor', kind: 'number' },
      { name: 'restorePrevious', kind: 'boolean' },
    ],
  },
];

/** Toda linha do vocabulário tem descritor — o painel não pode ter um modelo sem formulário. */
export const BOT_AUTOMATION_CATALOGUE_MODELS: readonly BotAutomationModel[] =
  BOT_AUTOMATION_CATALOGUE.map((descriptor) => descriptor.model);
