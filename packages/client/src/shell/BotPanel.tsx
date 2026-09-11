// A configuração do bot (§13.3, §13.6, §13.9, FUN-89).
//
// **É a interação central de um jogo idle-first**: é o que o jogador faz antes de fechar o
// navegador. Depois disso ele não está lá para corrigir nada.
//
// **Nada aqui tem lista de opções em código.** As categorias, os slots, as magias e os supplies
// vêm do catálogo (FUN-73): se a tela e o servidor divergirem sobre o que existe, o jogador
// configura o que o bot recusa — e descobre isso pelo extrato que não fecha.
//
// **A ordem dos slots É a prioridade** (§13.4). O primeiro de cima é o que executa, e por isso
// dá para mover uma regra para cima e para baixo: reordenar é configurar.

import { useState } from 'react';
import { BOT_CATEGORIES, BOT_CONDITION_KINDS } from '@draconya/content';
import type { BotCategory, BotCondition, BotRule } from '@draconya/content';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { sendIntent } from '../net/current.js';
import { bot, edit, toConfig } from '../bot/store.js';
import type { BotVocabulary } from '../state/hud.js';

const CATEGORY_TEXT: Record<BotCategory, string> = {
  heal: 'Cura',
  potion: 'Poções',
  attack: 'Ataque',
  rune: 'Runas e itens',
  support: 'Suporte',
};

const CONDITION_TEXT: Record<string, string> = {
  hp: 'HP %',
  mana: 'Mana %',
  targets: 'Alvos ao alcance',
  'target-hp': 'HP do alvo %',
};

/** Os quatro do §13.3. **Sem `==`**: comparar percentual exato quase nunca dispara. */
const OPERATORS = ['<', '<=', '>', '>='] as const;

/** Uma condição nova do tipo pedido, com o valor no meio da faixa. */
function blankCondition(kind: string): BotCondition {
  if (kind === 'targets') return { kind: 'targets', op: '>=', count: 2 };
  if (kind === 'mana') return { kind: 'mana', op: '<=', percent: 30 };
  if (kind === 'target-hp') return { kind: 'target-hp', op: '<=', percent: 50 };
  return { kind: 'hp', op: '<=', percent: 50 };
}

/** O valor que a condição carrega — percentual ou contagem, conforme o tipo. */
function conditionValue(condition: BotCondition): number {
  return 'percent' in condition ? condition.percent : condition.count;
}

function withValue(condition: BotCondition, value: number): BotCondition {
  return 'percent' in condition
    ? { ...condition, percent: value }
    : { ...condition, count: value };
}

function Rule({ rule, index, total, category, vocabulary, level }: {
  rule: BotRule; index: number; total: number;
  category: BotCategory; vocabulary: BotVocabulary; level: number;
}) {
  const change = (produce: (current: BotRule) => BotRule): void => {
    edit((draft) => ({
      ...draft,
      rules: {
        ...draft.rules,
        [category]: draft.rules[category].map((r, i) => (i === index ? produce(r) : r)),
      },
    }));
  };
  const move = (by: number): void => {
    edit((draft) => {
      const list = [...draft.rules[category]];
      const to = index + by;
      if (to < 0 || to >= list.length) return draft;
      const [moved] = list.splice(index, 1);
      if (moved !== undefined) list.splice(to, 0, moved);
      return { ...draft, rules: { ...draft.rules, [category]: list } };
    });
  };
  const remove = (): void => {
    edit((draft) => ({
      ...draft,
      rules: { ...draft.rules, [category]: draft.rules[category].filter((_, i) => i !== index) },
    }));
  };

  // Poção é supply; o resto é magia. É a divisão do §13.3, e ela vem do catálogo — não há
  // lista de ids em código aqui.
  const actions = category === 'potion'
    ? vocabulary.supplies.map((supply) => ({
      id: supply.id, label: `${supply.name} (${String(supply.price)} gold)`, locked: false,
    }))
    : vocabulary.spells.map((spell) => ({
      id: spell.id,
      label: `${spell.name} (${String(spell.manaCost)} mana)`,
      // Level e vocação são do SERVIDOR; a tela só mostra que ainda não dá, para o jogador
      // não configurar o que vai ser recusado.
      locked: level > 0 && level < spell.minLevel,
    }));

  const actionId = rule.do.kind === 'supply'
    ? rule.do.supplyId
    : rule.do.kind === 'spell' ? rule.do.spellId : rule.do.itemId;

  return (
    <li className="bot-rule">
      <div className="bot-rule-order">
        <button type="button" disabled={index === 0} onClick={() => { move(-1); }}>▴</button>
        <button
          type="button"
          disabled={index === total - 1}
          onClick={() => { move(1); }}
        >
          ▾
        </button>
      </div>
      <select
        aria-label="condição"
        value={rule.when.kind}
        onChange={(event) => {
          change((current) => ({ ...current, when: blankCondition(event.target.value) }));
        }}
      >
        {BOT_CONDITION_KINDS
          .filter((kind) => !vocabulary.advancedOnly.conditions.includes(kind)
            || level >= vocabulary.advancedFromLevel)
          .map((kind) => (
            <option key={kind} value={kind}>{CONDITION_TEXT[kind] ?? kind}</option>
          ))}
      </select>
      <select
        aria-label="operador"
        value={rule.when.op}
        onChange={(event) => {
          change((current) => ({
            ...current,
            when: { ...current.when, op: event.target.value } as BotCondition,
          }));
        }}
      >
        {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
      </select>
      <input
        aria-label="valor"
        type="number"
        min={0}
        max={rule.when.kind === 'targets' ? 99 : 100}
        value={conditionValue(rule.when)}
        onChange={(event) => {
          change((current) => ({
            ...current, when: withValue(current.when, Number(event.target.value)),
          }));
        }}
      />
      <select
        aria-label="ação"
        value={actionId}
        onChange={(event) => {
          const id = event.target.value;
          change((current) => ({
            ...current,
            do: category === 'potion'
              ? { kind: 'supply', supplyId: id }
              : { kind: 'spell', spellId: id },
          }));
        }}
      >
        {actions.map((action) => (
          <option key={action.id} value={action.id} disabled={action.locked}>
            {action.label}
          </option>
        ))}
      </select>
      <button type="button" className="entry-quiet" onClick={remove}>×</button>
    </li>
  );
}

function Category({ category, vocabulary, level }: {
  category: BotCategory; vocabulary: BotVocabulary; level: number;
}) {
  const rules = useStoreSlice(bot, (state) => state.draft.rules[category]);
  const slots = vocabulary.slots[category] ?? 0;
  const first = category === 'potion'
    ? vocabulary.supplies[0]?.id
    : vocabulary.spells[0]?.id;

  return (
    <section className="bot-category">
      <header className="bot-category-head">
        <strong>{CATEGORY_TEXT[category]}</strong>
        <span className="entry-meta">{`${String(rules.length)}/${String(slots)}`}</span>
      </header>
      <ul className="bot-rules">
        {rules.map((rule, index) => (
          <Rule
            key={index}
            rule={rule}
            index={index}
            total={rules.length}
            category={category}
            vocabulary={vocabulary}
            level={level}
          />
        ))}
      </ul>
      {/* O teto vem do catálogo, e a tela para de oferecer ao chegar nele — o servidor recusa
          de qualquer jeito, e deixar clicar para receber "não" é um passo evitável. */}
      {rules.length < slots && first !== undefined && (
        <button
          type="button"
          className="bot-add"
          onClick={() => {
            edit((draft) => ({
              ...draft,
              rules: {
                ...draft.rules,
                [category]: [...draft.rules[category], {
                  when: blankCondition('hp'),
                  do: category === 'potion'
                    ? { kind: 'supply', supplyId: first }
                    : { kind: 'spell', spellId: first },
                }],
              },
            }));
          }}
        >
          + regra
        </button>
      )}
    </section>
  );
}

/**
 * A configuração do bot é uma SOBREPOSIÇÃO, e não uma janela de coluna: uma linha de regra
 * tem condição, operador, valor e ação — não cabe numa janela de 300px, e espremer daria seis
 * caixinhas ilegíveis. Abrir por cima resolve o desktop e É a resposta para o celular (§5.1):
 * configurar o bot é o caso de uso móvel do jogo — o jogador ajusta e fecha, sem precisar de
 * jogabilidade completa. Quem abre e fecha é a barra do topo (FUN-115); `onClose` é o botão
 * de fechar daqui avisando a mesma coisa.
 */
export function BotPanel({ onClose }: { onClose: () => void }) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const level = useHudSlice((state) => state.level);
  const save = useStoreSlice(bot, (state) => state.save);
  const reason = useStoreSlice(bot, (state) => state.reason);

  if (catalogue === null) return null;
  const vocabulary = catalogue.bot;
  const advanced = level >= vocabulary.advancedFromLevel;

  return (
    <div className="bot-overlay" role="dialog" aria-label="configuração do bot">
      <div className="bot-body">
        <header className="bot-title">
          <strong>Configuração do bot</strong>
          <span className="analyzer-summary">
            {save === 'pending' ? 'salvando…' : save === 'saved' ? 'salvo' : ''}
          </span>
          <button type="button" className="entry-quiet" onClick={onClose}>
            fechar
          </button>
        </header>
        {!advanced && (
          // §13.2: o gate é por level, e quem recusa é o servidor. Dizer POR QUÊ aqui evita
          // que o jogador descubra montando uma configuração inteira e levando um não.
          <p className="quiet">
            {`Bot avançado a partir do level ${String(vocabulary.advancedFromLevel)}.`}
          </p>
        )}

        {BOT_CATEGORIES.map((category) => (
          <Category
            key={category}
            category={category}
            vocabulary={vocabulary}
            level={level}
          />
        ))}

        <div className="bot-actions">
          <button
            type="button"
            onClick={() => {
              bot.set((state) => ({ ...state, save: 'pending', reason: null }));
              // Intenção (invariante 4): o cliente manda a configuração, e quem decide se
              // ela vale é o servidor. A resposta vem em `bot-config-result`.
              if (!sendIntent({ type: 'bot-config', config: toConfig(bot.get().draft) })) {
                bot.set((state) => ({
                  ...state, save: 'refused', reason: 'Sem conexão. Tente de novo.',
                }));
              }
            }}
          >
            Salvar
          </button>
        </div>

        {/* A recusa fica na tela, e o rascunho FICA junto: descartar seria a pior resposta a
            "corrija isto" — apagar justamente o que precisa ser corrigido. */}
        {save === 'refused' && reason !== null && <p className="system-error">{reason}</p>}
      </div>
    </div>
  );
}
