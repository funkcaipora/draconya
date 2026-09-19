import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOT_SET_COUNT, BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION } from '@draconya/content';
import type { BotConfigV2, BotSlot } from '@draconya/content';
import {
  INITIAL_BOT, SAVE_DEBOUNCE_MS, bot, botResult, draftFrom, edit, emptyDraft, loadConfig,
  setActiveSet, setConfigSender, setExitHpBelowPercent, setExitRule, setIgnore, setLure, setPosture,
  setPrioritize, setSlot, setSlotAuto, setTargetingPolicy, toConfig,
} from './store.js';
import type { BotDraft } from './store.js';

const slot = (spellId: string, over: Partial<BotSlot> = {}): BotSlot => ({
  do: { kind: 'spell', spellId },
  when: [],
  auto: true,
  ...over,
});

const withSet = (set: number, index: number, value: BotSlot | null): BotDraft => {
  const draft = emptyDraft();
  const sets = draft.sets.map((current, i) => {
    if (i !== set) return current;
    return { slots: current.slots.map((entry, j) => (j === index ? value : entry)) };
  });
  return { ...draft, sets };
};

beforeEach(() => { bot.set(() => INITIAL_BOT); });

describe('o rascunho do bot v2 (AB-10, ADR 0032 d.1)', () => {
  it('nasce com quatro conjuntos de 24 slots vazios, activeSet 0 e targeting nearest', () => {
    const draft = emptyDraft();
    expect(draft.sets).toHaveLength(BOT_SET_COUNT);
    expect(draft.sets.every((set) => set.slots.length === BOT_SLOTS_PER_SET)).toBe(true);
    expect(draft.sets.flatMap((set) => set.slots).every((entry) => entry === null)).toBe(true);
    expect(draft.activeSet).toBe(0);
    expect(draft.stance).toBe('balanced');
    expect(draft.targeting.policy).toBe('nearest');
  });

  it('a ORDEM dos slots é a prioridade, e ela viaja como está', () => {
    // §13.4: o primeiro de cima é o que executa. Reordenar na hora de mandar mudaria o
    // comportamento sem o jogador ter pedido — e ele não estaria lá para notar.
    edit((draft) => ({
      ...draft,
      sets: draft.sets.map((set, i) => i === 0
        ? { slots: set.slots.map((entry, j) => (j === 0 ? slot('heal') : j === 1 ? slot('strike') : entry)) }
        : set),
    }));

    const config = toConfig(bot.get().draft);
    const first = config.sets[0]?.slots[0];
    const second = config.sets[0]?.slots[1];
    expect(first?.do).toEqual({ kind: 'spell', spellId: 'heal' });
    expect(second?.do).toEqual({ kind: 'spell', spellId: 'strike' });
  });

  it('manda a versão do vocabulário que este cliente entende', () => {
    // Configuração é dado PERSISTIDO: um vocabulário que muda sem número quebra a regra de
    // quem a salvou, em silêncio.
    expect(toConfig(emptyDraft()).version).toBe(BOT_VOCABULARY_VERSION);
  });
});

describe('salvar é uma INTENÇÃO (FUN-89)', () => {
  it('a confirmação marca salvo e limpa o motivo', () => {
    botResult(false, 'algo');
    botResult(true, null);
    expect(bot.get()).toMatchObject({ save: 'saved', reason: null });
  });

  it('a recusa guarda o motivo e NÃO descarta o rascunho', () => {
    // Descartar seria a pior resposta possível a "corrija isto": apagar justamente o que
    // precisa ser corrigido — e o jogador acabou de escrever aquilo.
    edit(() => withSet(0, 0, slot('heal')));
    botResult(false, 'conjunto 1, slot 1: tecla repetida');
    expect(bot.get().save).toBe('refused');
    expect(bot.get().reason).toContain('tecla');
    expect(bot.get().draft.sets[0]?.slots[0]).not.toBeNull();
  });

  it('mudar depois de salvar tira o "salvo" da tela', () => {
    botResult(true, null);
    edit(() => withSet(0, 0, slot('heal')));
    expect(bot.get().save).toBe('idle');
  });

  it('mudar depois de uma recusa apaga o motivo antigo', () => {
    botResult(false, 'motivo antigo');
    edit((draft) => draft);
    expect(bot.get().reason).toBeNull();
  });
});

describe('a configuração em vigor chega do servidor (FUN-111)', () => {
  const config = (): BotConfigV2 => ({
    ...toConfig(emptyDraft()),
    sets: toConfig(emptyDraft()).sets.map((set, i) => i === 0
      ? { slots: set.slots.map((entry, j) => (j === 0 ? slot('heal') : entry)) }
      : set),
    exit: [{ kind: 'hp-below', percent: 10 }],
    lure: { min: 2, max: 4 },
  });

  it('draftFrom é o inverso de toConfig: a configuração dá a volta inteira sem perder nada', () => {
    const original = config();
    expect(toConfig(draftFrom(original))).toEqual(original);
  });

  it('lure dá a volta inteira pelo rascunho como campo próprio', () => {
    const withLure = { ...config(), lure: { min: 2, max: 4 } };
    const draft = draftFrom(withLure);
    expect(draft.lure).toEqual({ min: 2, max: 4 });
    expect(toConfig(draft)).toEqual(withLure);
    expect(Object.keys(toConfig(draftFrom({ ...config(), lure: undefined })))).not.toContain('lure');
  });

  it('com a tela pristina, a configuração vira o rascunho, já como "salvo"', () => {
    // Era o defeito: a tela nascia vazia a cada carregamento, e "Salvar" dali apagava as
    // regras que a hunt estava executando.
    loadConfig(config());
    const state = bot.get();
    expect(state.draft.sets[0]?.slots[0]?.do).toEqual({ kind: 'spell', spellId: 'heal' });
    expect(state.draft.exit).toHaveLength(1);
    expect(state.save).toBe('saved');
    expect(state.reason).toBeNull();
  });

  it('um rascunho editado e NÃO salvo sobrevive à reconexão', () => {
    edit((draft) => withSet(1, 0, slot('strike')));
    loadConfig(config());
    const state = bot.get();
    expect(state.draft.sets[1]?.slots[0]?.do).toEqual({ kind: 'spell', spellId: 'strike' });
    expect(state.draft.sets[0]?.slots[0]).toBeNull();
    expect(state.save).toBe('idle');
  });

  it('um rascunho SALVO é substituído: o que está nele é o que o servidor tem', () => {
    edit((draft) => withSet(1, 0, slot('strike')));
    botResult(true, null);
    loadConfig(config());
    const state = bot.get();
    expect(state.draft.sets[1]?.slots[0]).toBeNull();
    expect(state.draft.sets[0]?.slots[0]?.do).toEqual({ kind: 'spell', spellId: 'heal' });
    expect(state.save).toBe('saved');
  });

  it('configuração que este cliente não entende é ignorada, e a tela fica como estava', () => {
    edit((draft) => withSet(0, 0, slot('heal')));
    loadConfig({ version: 'x', heal: 'nope' });
    expect(bot.get().draft.sets[0]?.slots[0]).not.toBeNull();
    expect(bot.get().save).toBe('idle');
    expect(bot.get().touched).toBe(true);
  });

  it('um rascunho RECUSADO sobrevive à reconexão: é o que o jogador precisa corrigir', () => {
    edit((draft) => withSet(0, 0, slot('heal')));
    botResult(false, 'conjunto 1, slot 1: tecla repetida');
    loadConfig(config());
    expect(bot.get().draft.sets[0]?.slots[0]?.do).toEqual({ kind: 'spell', spellId: 'heal' });
    expect(bot.get().save).toBe('refused');
    expect(bot.get().reason).toContain('tecla');
  });

  it('um rascunho PENDENTE sobrevive à reconexão: o que está em voo não é substituído', () => {
    edit((draft) => withSet(0, 0, slot('heal')));
    bot.set((state) => ({ ...state, save: 'pending', reason: null }));
    loadConfig(config());
    expect(bot.get().draft.sets[0]?.slots[0]?.do).toEqual({ kind: 'spell', spellId: 'heal' });
    expect(bot.get().save).toBe('pending');
  });
});

describe('o conjunto e o automático do slot salvam sozinhos, com debounce (AB-10)', () => {
  const sent: BotConfigV2[] = [];
  beforeEach(() => {
    sent.length = 0;
    vi.useFakeTimers();
    setConfigSender((config) => { sent.push(config); return true; });
    bot.set(() => ({ ...INITIAL_BOT }));
    edit((draft) => withSet(0, 0, slot('heal')));
  });
  afterEach(() => {
    setConfigSender(null);
    vi.useRealTimers();
  });

  it('setActiveSet troca o conjunto e manda UMA mensagem depois do debounce', () => {
    setActiveSet(2);
    vi.advanceTimersByTime(100);
    setActiveSet(3);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.activeSet).toBe(3);
    expect(bot.get().save).toBe('pending');
  });

  it('setSlotAuto desliga o automático do slot do conjunto ATIVO', () => {
    // Mutação que mata: desligar o slot do conjunto errado, ou não mexer no `auto`.
    setSlotAuto(0, false);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(sent[0]?.sets[0]?.slots[0]?.auto).toBe(false);
    expect(bot.get().draft.sets[0]?.slots[0]?.auto).toBe(false);
  });

  it('setSlotAuto num slot vazio não muda nada (não há automático a desligar)', () => {
    setSlotAuto(5, false);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(sent[0]?.sets[0]?.slots[5]).toBeNull();
  });

  it('sem conexão o rascunho fica tocado e a tela diz por quê', () => {
    setConfigSender(() => false);
    setActiveSet(1);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(bot.get().save).toBe('refused');
    expect(bot.get().touched).toBe(true);
    expect(bot.get().draft.activeSet).toBe(1);
  });
});

describe('as regras de saída salvam sozinhas, com o mesmo debounce (#260)', () => {
  const sent: BotConfigV2[] = [];
  beforeEach(() => {
    sent.length = 0;
    vi.useFakeTimers();
    setConfigSender((config) => { sent.push(config); return true; });
    bot.set(() => ({ ...INITIAL_BOT }));
  });
  afterEach(() => {
    setConfigSender(null);
    vi.useRealTimers();
  });

  it('várias mudanças em menos de 300 ms viram UMA mensagem, com o estado final', () => {
    setExitRule('hp-below', true);
    vi.advanceTimersByTime(100);
    setExitRule('out-of-gold', true);
    vi.advanceTimersByTime(100);
    setExitHpBelowPercent(45);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.exit).toEqual(
      expect.arrayContaining([{ kind: 'hp-below', percent: 45 }, { kind: 'out-of-gold' }]),
    );
    expect(sent[0]?.exit).toHaveLength(2);
  });

  it('desligar tira a regra da lista mandada, sem entrada morta', () => {
    setExitRule('party-member-lost', true);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(sent[0]?.exit).toEqual([{ kind: 'party-member-lost' }]);
    setExitRule('party-member-lost', false);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(sent[1]?.exit).toEqual([]);
  });
});

describe('lure e targeting salvam com debounce (SV-09, #345)', () => {
  const sent: BotConfigV2[] = [];
  beforeEach(() => {
    sent.length = 0;
    vi.useFakeTimers();
    setConfigSender((config) => { sent.push(config); return true; });
    bot.set(() => ({ ...INITIAL_BOT }));
  });
  afterEach(() => {
    setConfigSender(null);
    vi.useRealTimers();
  });

  it('setLure escreve draft.lure e manda com debounce', () => {
    setLure({ min: 3, max: 7 });
    expect(bot.get().draft.lure).toEqual({ min: 3, max: 7 });
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.lure).toEqual({ min: 3, max: 7 });
  });

  it('setTargetingPolicy, setPrioritize, setIgnore e setPosture em sequência mandam UMA mensagem', () => {
    setTargetingPolicy('lowest-hp');
    vi.advanceTimersByTime(100);
    setPrioritize(['dragon', 'dragon-lord']);
    vi.advanceTimersByTime(100);
    setIgnore(['rat']);
    vi.advanceTimersByTime(100);
    setPosture({ kind: 'keep-distance', tiles: 3 });
    expect(sent).toHaveLength(0);

    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.targeting).toEqual({
      policy: 'lowest-hp',
      prioritize: ['dragon', 'dragon-lord'],
      ignore: ['rat'],
      posture: { kind: 'keep-distance', tiles: 3 },
    });
  });
});

describe('setSlot grava o slot e manda bot-config AGORA (AB-11, #426)', () => {
  const sent: BotConfigV2[] = [];
  beforeEach(() => {
    sent.length = 0;
    setConfigSender((config) => { sent.push(config); return true; });
    bot.set(() => ({ ...INITIAL_BOT }));
  });
  afterEach(() => { setConfigSender(null); });

  it('grava no conjunto e no índice certos e manda UMA mensagem na hora', () => {
    const next: BotSlot = {
      do: { kind: 'item', itemId: 'health-potion' },
      when: [{ kind: 'mana', op: '>=', percent: 20 }],
      auto: false,
      hotkey: 'F1',
      restock: { batch: 20, min: 5 },
    };
    setSlot(2, 4, next);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.sets[2]?.slots[4]).toEqual(next);
    expect(bot.get().draft.sets[2]?.slots[4]).toEqual(next);
    expect(bot.get().save).toBe('pending');
  });

  it('null limpa o slot e não toca nos vizinhos', () => {
    edit((draft) => withSet(1, 3, slot('heal')));
    setSlot(1, 3, null);
    expect(sent[0]?.sets[1]?.slots[3]).toBeNull();
    expect(bot.get().draft.sets[1]?.slots[3]).toBeNull();
  });
});
