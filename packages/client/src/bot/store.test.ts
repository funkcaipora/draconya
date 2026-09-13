import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOT_VOCABULARY_VERSION } from '@draconya/content';
import type { BotConfig } from '@draconya/content';
import {
  INITIAL_BOT, SAVE_DEBOUNCE_MS, bot, botResult, draftFrom, edit, emptyDraft, loadConfig, moveRule, putRule,
  removeRule, setConfigSender, toConfig, toggleRule,
} from './store.js';

const rule = (percent: number, enabled = true) => ({
  enabled,
  when: { kind: 'hp' as const, op: '<=' as const, percent },
  do: { kind: 'spell' as const, spellId: 'heal' },
});

beforeEach(() => { bot.set(() => INITIAL_BOT); });

describe('o rascunho do bot (FUN-89)', () => {
  it('nasce com as cinco categorias vazias', () => {
    const draft = emptyDraft();
    expect(Object.keys(draft.rules).sort())
      .toEqual(['attack', 'heal', 'potion', 'rune', 'support']);
    expect(draft.exit).toEqual([]);
    expect(draft.targeting.policy).toBe('nearest');
  });

  it('a ORDEM dos slots é a prioridade, e ela viaja como está', () => {
    // §13.4: o primeiro de cima é o que executa. Reordenar na hora de mandar mudaria o
    // comportamento sem o jogador ter pedido — e ele não estaria lá para notar.
    edit((draft) => ({ ...draft, rules: { ...draft.rules, heal: [rule(30), rule(70)] } }));

    const config = toConfig(bot.get().draft);
    expect(config.heal.map((r) => (r.when as { percent: number }).percent)).toEqual([30, 70]);
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
    edit((draft) => ({ ...draft, rules: { ...draft.rules, heal: [rule(30)] } }));

    botResult(false, 'categoria "heal" tem 4 regras e só 3 slots');

    expect(bot.get().save).toBe('refused');
    expect(bot.get().reason).toContain('slots');
    expect(bot.get().draft.rules.heal).toHaveLength(1);
  });

  it('mudar depois de salvar tira o "salvo" da tela', () => {
    // O que está no servidor deixou de ser o que está na tela. Continuar dizendo "salvo"
    // faria o jogador fechar o navegador achando que configurou.
    botResult(true, null);
    edit((draft) => ({ ...draft, rules: { ...draft.rules, heal: [rule(30)] } }));

    expect(bot.get().save).toBe('idle');
  });

  it('mudar depois de uma recusa apaga o motivo antigo', () => {
    // Um motivo velho ao lado de um rascunho novo é uma mensagem que já não se aplica.
    botResult(false, 'motivo antigo');
    edit((draft) => draft);

    expect(bot.get().reason).toBeNull();
  });
});

describe('a configuração em vigor chega do servidor (FUN-111)', () => {
  const config = () => ({
    ...toConfig(emptyDraft()),
    heal: [rule(70)],
    attack: [{
      enabled: true,
      when: { kind: 'targets' as const, op: '>=' as const, count: 1 },
      do: { kind: 'spell' as const, spellId: 'strike' },
    }],
    exit: [{ kind: 'hp-below' as const, percent: 10 }],
  });

  it('draftFrom é o inverso de toConfig: a configuração dá a volta inteira sem perder nada', () => {
    // Mutação que mata: `draftFrom` esquecer uma categoria, `exit` ou `targeting`.
    const original = config();
    expect(toConfig(draftFrom(original))).toEqual(original);
  });

  it('o bot AVANÇADO dá a volta também: lure e ringSwap passam opacos pelo rascunho', () => {
    // Era a metade que faltava: a tela carregava a configuração de um level 50 sem `ringSwap`,
    // chamava de "salvo", e o próximo "Salvar" apagava o anel que a hunt trocava. Mutação que
    // mata: `draftFrom` sem `advanced`, ou `toConfig` sem o espalhamento.
    const advanced = {
      ...config(),
      lure: { min: 2, max: 4 },
      ringSwap: { itemId: 'life-ring', equipBelow: 40, removeAbove: 70, manaFloor: 0, restorePrevious: true },
    };
    expect(toConfig(draftFrom(advanced))).toEqual(advanced);
    // E sem eles a chave não aparece: `undefined` numa configuração é uma chave a mais no JSON.
    expect(Object.keys(toConfig(draftFrom(config())))).not.toContain('lure');
  });

  it('com a tela pristina, a configuração vira o rascunho, já como "salvo"', () => {
    // Era o defeito: a tela nascia vazia a cada carregamento, e "Salvar" dali apagava as
    // regras que a hunt estava executando.
    loadConfig(config());
    const state = bot.get();
    expect(state.draft.rules.heal).toHaveLength(1);
    expect(state.draft.rules.attack).toHaveLength(1);
    expect(state.draft.exit).toHaveLength(1);
    expect(state.save).toBe('saved');
    expect(state.reason).toBeNull();
  });

  it('um rascunho editado e NÃO salvo sobrevive à reconexão', () => {
    // Mutação que mata: carregar sempre — uma reconexão no meio da digitação apagaria o
    // que o jogador escreveu, pela mesma razão que uma recusa não pode.
    edit((draft) => ({ ...draft, rules: { ...draft.rules, potion: [rule(40)] } }));
    loadConfig(config());
    const state = bot.get();
    expect(state.draft.rules.potion).toHaveLength(1);
    expect(state.draft.rules.heal).toHaveLength(0);
    expect(state.save).toBe('idle');
  });

  it('um rascunho SALVO é substituído: o que está nele é o que o servidor tem', () => {
    edit((draft) => ({ ...draft, rules: { ...draft.rules, potion: [rule(40)] } }));
    botResult(true, null);
    loadConfig(config());
    const state = bot.get();
    expect(state.draft.rules.potion).toHaveLength(0);
    expect(state.draft.rules.heal).toHaveLength(1);
    expect(state.save).toBe('saved');
  });

  it('configuração que este cliente não entende é ignorada, e a tela fica como estava', () => {
    // A partir de um rascunho EDITADO: "ignorada" e "zerada" são indistinguíveis numa tela vazia.
    edit((draft) => ({ ...draft, rules: { ...draft.rules, potion: [rule(40)] } }));
    loadConfig({ version: 'x', heal: 'nope' });
    expect(bot.get().draft.rules.potion).toHaveLength(1);
    expect(bot.get().save).toBe('idle');
    expect(bot.get().touched).toBe(true);
  });

  it('um rascunho RECUSADO sobrevive à reconexão: é o que o jogador precisa corrigir', () => {
    // Mutação que mata: `loadConfig` só poupar `idle` — a reconexão logo depois da recusa
    // apagaria justamente o que a mensagem de recusa mandou consertar.
    edit((draft) => ({ ...draft, rules: { ...draft.rules, potion: [rule(40)] } }));
    botResult(false, 'bot avançado exige level 50');
    loadConfig(config());
    expect(bot.get().draft.rules.potion).toHaveLength(1);
    expect(bot.get().draft.rules.heal).toHaveLength(0);
    expect(bot.get().save).toBe('refused');
    expect(bot.get().reason).toBe('bot avançado exige level 50');
  });

  it('um rascunho PENDENTE sobrevive à reconexão: o que está em voo não é substituído', () => {
    edit((draft) => ({ ...draft, rules: { ...draft.rules, potion: [rule(40)] } }));
    bot.set((state) => ({ ...state, save: 'pending', reason: null }));
    loadConfig(config());
    expect(bot.get().draft.rules.potion).toHaveLength(1);
    expect(bot.get().save).toBe('pending');
  });

  it('um rascunho apagado até ficar vazio, e não salvo, NÃO é intocado: fica', () => {
    // "Vazio" e "intocado" não são a mesma coisa: quem apagou todas as regras querendo salvar
    // o vazio veria a configuração antiga voltar na próxima reconexão. Mutação que mata:
    // decidir pela FORMA do rascunho em vez de por `touched`.
    edit((draft) => ({ ...draft, rules: { ...draft.rules, potion: [rule(40)] } }));
    edit((draft) => ({ ...draft, rules: { ...draft.rules, potion: [] } }));
    expect(JSON.stringify(bot.get().draft)).toBe(JSON.stringify(emptyDraft()));
    loadConfig(config());
    expect(bot.get().draft.rules.heal).toHaveLength(0);
    expect(bot.get().save).toBe('idle');
  });
});

describe('o interruptor salva sozinho, com debounce (#162)', () => {
  const sent: BotConfig[] = [];
  beforeEach(() => {
    sent.length = 0;
    vi.useFakeTimers();
    setConfigSender((config) => { sent.push(config); return true; });
    bot.set(() => ({ ...INITIAL_BOT }));
    edit((draft) => ({ ...draft, rules: { ...draft.rules, heal: [rule(30), rule(70)] } }));
  });
  afterEach(() => {
    setConfigSender(null);
    vi.useRealTimers();
  });

  it('dois toques em 100 ms mandam UMA mensagem, com o estado final e o resto igual', () => {
    // Mutação que mata: mandar no toque (duas mensagens), ou mandar só a regra tocada.
    toggleRule('heal', 1);
    vi.advanceTimersByTime(100);
    toggleRule('heal', 1);
    vi.advanceTimersByTime(100);
    toggleRule('heal', 1);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.heal.map((r) => r.enabled !== false)).toEqual([true, false]);
    expect(sent[0]?.heal).toHaveLength(2);
    expect(bot.get().save).toBe('pending');
  });

  it('a regra desligada continua no rascunho e na configuração mandada: desligar não libera slot', () => {
    toggleRule('heal', 0);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(sent[0]?.heal).toHaveLength(2);
    expect(bot.get().draft.rules.heal[0]?.enabled).toBe(false);
  });

  it('sem conexão o rascunho fica tocado e a tela diz por quê; a recusa do servidor também não desfaz', () => {
    setConfigSender(() => false);
    toggleRule('heal', 0);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(bot.get().save).toBe('refused');
    expect(bot.get().touched).toBe(true);
    expect(bot.get().draft.rules.heal[0]?.enabled).toBe(false);
    botResult(false, 'regra inválida');
    expect(bot.get().draft.rules.heal[0]?.enabled).toBe(false);
    expect(bot.get().reason).toBe('regra inválida');
  });

  it('mover, remover e escrever uma regra salvam; escrever manda AGORA (é o Salvar do editor)', () => {
    moveRule('heal', 1, -1);
    expect(bot.get().draft.rules.heal.map((r) => (r.when as { percent: number }).percent)).toEqual([70, 30]);
    removeRule('heal', 1);
    expect(bot.get().draft.rules.heal).toHaveLength(1);
    putRule('heal', null, rule(50));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.heal.map((r) => (r.when as { percent: number }).percent)).toEqual([70, 50]);
    putRule('heal', 0, rule(10));
    expect(sent).toHaveLength(2);
    expect(sent[1]?.heal.map((r) => (r.when as { percent: number }).percent)).toEqual([10, 50]);
  });
});
