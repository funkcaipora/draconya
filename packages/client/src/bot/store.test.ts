import { beforeEach, describe, expect, it } from 'vitest';
import { BOT_VOCABULARY_VERSION } from '@draconya/content';
import {
  INITIAL_BOT, bot, botResult, draftFrom, edit, emptyDraft, isPristine, loadConfig, toConfig,
} from './store.js';

const rule = (percent: number) => ({
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
    loadConfig({ version: 'x', heal: 'nope' });
    expect(isPristine(bot.get().draft)).toBe(true);
    expect(bot.get().save).toBe('idle');
  });

  it('isPristine: só o rascunho vazio é pristino', () => {
    expect(isPristine(emptyDraft())).toBe(true);
    expect(isPristine({ ...emptyDraft(), exit: [{ kind: 'out-of-gold' }] })).toBe(false);
  });
});
