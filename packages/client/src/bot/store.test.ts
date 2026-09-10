import { beforeEach, describe, expect, it } from 'vitest';
import { BOT_VOCABULARY_VERSION } from '@draconya/content';
import { INITIAL_BOT, bot, botResult, edit, emptyDraft, toConfig } from './store.js';

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
