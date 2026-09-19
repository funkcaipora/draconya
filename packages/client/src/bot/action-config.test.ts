import { describe, expect, it } from 'vitest';
import { BOT_SLOTS_PER_SET } from '@draconya/content';
import type { BotSlot } from '@draconya/content';
import {
  blankConditionV2, conditionBounds, conditionText, conditionValue, draftFromSlot,
  draftProblem, hotkeyConflict, slotFromDraft,
} from './action-config.js';
import type { BotSet, SlotDraft } from './action-config.js';

// O rascunho do slot e a validação que o modal usa antes de mandar `bot-config` (AB-11, #426).
// PURO (DT-03): o teste prende a decisão, não o DOM. O suprimento é abstrato: não há reposição.

function setOf(entries: ReadonlyArray<[number, BotSlot]>): BotSet {
  return {
    slots: Array.from({ length: BOT_SLOTS_PER_SET }, (_, i) =>
      entries.find(([at]) => at === i)?.[1] ?? null),
  };
}

const spellSlot = (over: Partial<BotSlot> = {}): BotSlot => ({
  do: { kind: 'spell', spellId: 'heal' }, when: [], auto: true, ...over,
});

const draft = (over: Partial<SlotDraft> = {}): SlotDraft => ({
  do: { kind: 'spell', spellId: 'heal' }, when: [], auto: true, ...over,
});

describe('hotkeyConflict — a tecla é única DENTRO do conjunto (DT-02)', () => {
  it('acha o outro índice e ignora o próprio slot editado', () => {
    const set = setOf([[0, spellSlot({ hotkey: 'F1' })], [3, spellSlot({ hotkey: 'F1' })]]);
    expect(hotkeyConflict(set, 0, 'F1')).toBe(3);
    expect(hotkeyConflict(set, 3, 'F1')).toBe(0);
    expect(hotkeyConflict(set, 1, 'F2')).toBeNull();
  });

  it('slot vazio não é conflito', () => {
    expect(hotkeyConflict(setOf([[2, spellSlot()]]), 0, 'F1')).toBeNull();
  });
});

describe('draftProblem — o Salvar bloqueado tem motivo', () => {
  it('sem ação, manda escolher', () => {
    expect(draftProblem(draft({ do: null }), setOf([]), 0)).toBe('Escolha uma ação.');
  });

  it('percentual acima de 100 é fora de faixa', () => {
    const bad = draft({ when: [{ kind: 'hp', op: '>=', percent: 150 }] });
    expect(draftProblem(bad, setOf([]), 0)).toContain('fora de faixa');
  });

  it('contagem de alvos negativa é fora de faixa', () => {
    const bad = draft({ when: [{ kind: 'targets', op: '>=', count: -1 }] });
    expect(draftProblem(bad, setOf([]), 0)).toContain('fora de faixa');
  });

  it('tecla em conflito bloqueia nomeando o slot em conflito', () => {
    const set = setOf([[2, spellSlot({ hotkey: 'F1' })]]);
    expect(draftProblem(draft({ hotkey: 'F1' }), set, 0))
      .toBe('A tecla F1 já está no slot 3 deste conjunto.');
  });

  it('ação sem condição é válida (RG-007)', () => {
    expect(draftProblem(draft({ when: [] }), setOf([]), 0)).toBeNull();
  });
});

describe('slotFromDraft — o rascunho vira o slot do contrato', () => {
  it('sem ação devolve null (o modal não deixa salvar assim)', () => {
    expect(slotFromDraft(draft({ do: null }))).toBeNull();
  });

  it('omite hotkey ausente e preserva auto: false', () => {
    const slot = slotFromDraft({ do: { kind: 'spell', spellId: 'heal' }, when: [], auto: false });
    expect(slot).toEqual({ do: { kind: 'spell', spellId: 'heal' }, when: [], auto: false });
    expect(slot !== null && 'hotkey' in slot).toBe(false);
  });

  it('materializa o suprimento abstrato sem reposição', () => {
    const slot = slotFromDraft({
      do: { kind: 'supply', supplyId: 'health-potion' }, when: [], auto: true,
    });
    expect(slot).toEqual({
      do: { kind: 'supply', supplyId: 'health-potion' }, when: [], auto: true,
    });
  });
});

describe('draftFromSlot — abrir carrega o que está salvo (UC-ACTION-002)', () => {
  it('slot nulo vira rascunho vazio com automática ligada', () => {
    expect(draftFromSlot(null)).toEqual({ do: null, when: [], auto: true });
  });

  it('round-trip preserva ação, condições, tecla e auto', () => {
    const original: BotSlot = {
      do: { kind: 'supply', supplyId: 'health-potion' },
      when: [{ kind: 'mana', op: '>=', percent: 20 }],
      auto: false,
      hotkey: 'F1',
    };
    expect(slotFromDraft(draftFromSlot(original))).toEqual(original);
  });
});

describe('blankConditionV2 — a condição nasce pronta para editar', () => {
  it('percentual nasce no meio da faixa; alvos nasce com 1', () => {
    expect(blankConditionV2('hp')).toEqual({ kind: 'hp', op: '>=', percent: 50 });
    expect(blankConditionV2('mana')).toEqual({ kind: 'mana', op: '>=', percent: 50 });
    expect(blankConditionV2('target-hp')).toEqual({ kind: 'target-hp', op: '>=', percent: 50 });
    expect(blankConditionV2('targets')).toEqual({ kind: 'targets', op: '>=', count: 1 });
  });

  it('conditionBounds separa percentual de contagem', () => {
    expect(conditionBounds('hp')).toEqual({ min: 0, max: 100 });
    expect(conditionBounds('targets')).toEqual({ min: 0, max: null });
  });

  it('conditionText escreve a frase que o jogador lê', () => {
    expect(conditionText({ kind: 'targets', op: '>=', count: 2 })).toBe('Nº de alvos ≥ 2');
    expect(conditionText({ kind: 'mana', op: '>=', percent: 20 })).toBe('Mana ≥ 20 %');
    expect(conditionValue({ kind: 'targets', op: '>=', count: 3 })).toBe(3);
  });
});
