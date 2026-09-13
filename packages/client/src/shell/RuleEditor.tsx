// O editor de UMA regra do bot (#162): a linha larga de antes — condição, operador, valor e
// ação —, numa sobreposição pequena sobre o painel, com Salvar e Cancelar. É o "Setup" do
// vBot: o painel fixo mostra a linha compacta; a edição fina abre por cima, porque a linha
// larga não cabe em 300 px (o motivo original da sobreposição da FUN-89).
//
// **Nada aqui tem lista de opções em código.** Condições, magias e supplies vêm do catálogo
// (FUN-73). O rascunho local só vira regra do bot no Salvar; Cancelar não toca o rascunho.

import { useState } from 'react';
import { BOT_CONDITION_KINDS } from '@draconya/content';
import type { BotCategory, BotCondition, BotRule } from '@draconya/content';
import { putRule } from '../bot/store.js';
import type { BotVocabulary } from '../state/hud.js';
import { CONDITION_TEXT } from './rule-text.js';

/** Os quatro do §13.3. **Sem `==`**: comparar percentual exato quase nunca dispara. */
const OPERATORS = ['<', '<=', '>', '>='] as const;

/** Uma condição nova do tipo pedido, com o valor no meio da faixa. */
export function blankCondition(kind: string): BotCondition {
  if (kind === 'targets') return { kind: 'targets', op: '>=', count: 2 };
  if (kind === 'mana') return { kind: 'mana', op: '<=', percent: 30 };
  if (kind === 'target-hp') return { kind: 'target-hp', op: '<=', percent: 50 };
  return { kind: 'hp', op: '<=', percent: 50 };
}

/**
 * O que cada categoria lança (§13.3), e vem do catálogo: poção é supply que repõe, runa (#165)
 * é supply de dano — a divisão é pelo `effect` do catálogo, não por lista de ids —, e o resto
 * é magia. `null` é magia.
 */
export function suppliesFor(category: BotCategory, vocabulary: BotVocabulary): BotVocabulary['supplies'] | null {
  if (category === 'potion') return vocabulary.supplies.filter((supply) => supply.effect !== 'damage');
  if (category === 'rune') return vocabulary.supplies.filter((supply) => supply.effect === 'damage');
  return null;
}

/** Uma regra nova para a categoria: a primeira ação do catálogo, ligada. */
export function blankRule(category: BotCategory, vocabulary: BotVocabulary): BotRule | null {
  const supplies = suppliesFor(category, vocabulary);
  const first = supplies === null ? vocabulary.spells[0]?.id : supplies[0]?.id;
  if (first === undefined) return null;
  return {
    enabled: true,
    // A runa é de ataque: a condição de nascença é "há alvo", como a magia de ataque seria.
    when: blankCondition(category === 'rune' ? 'targets' : 'hp'),
    do: supplies === null ? { kind: 'spell', spellId: first } : { kind: 'supply', supplyId: first },
  };
}

function conditionValue(condition: BotCondition): number {
  return 'percent' in condition ? condition.percent : condition.count;
}

function withValue(condition: BotCondition, value: number): BotCondition {
  return 'percent' in condition ? { ...condition, percent: value } : { ...condition, count: value };
}

export function RuleEditor({ category, index, initial, vocabulary, level, onClose }: {
  category: BotCategory;
  /** `null` é regra nova: entra no fim da categoria. */
  index: number | null;
  initial: BotRule;
  vocabulary: BotVocabulary;
  level: number;
  onClose: () => void;
}) {
  const [rule, setRule] = useState<BotRule>(initial);
  const actionId = rule.do.kind === 'supply'
    ? rule.do.supplyId
    : rule.do.kind === 'spell' ? rule.do.spellId : rule.do.itemId;

  // Poção e runa são supply; o resto é magia. É a divisão do §13.3, e ela vem do catálogo.
  const supplies = suppliesFor(category, vocabulary);
  const actions = supplies !== null
    ? supplies.map((supply) => ({
      id: supply.id, label: `${supply.name} (${String(supply.price)} gold)`,
      // A runa (#165) tem level: a tela só mostra que ainda não dá; quem recusa é o servidor.
      locked: level > 0 && level < (supply.requires.level ?? 0),
    }))
    : vocabulary.spells.map((spell) => ({
      id: spell.id,
      label: `${spell.name} · ${spell.group} (${String(spell.manaCost)} mana)`,
      // Level e vocação são do SERVIDOR; a tela só mostra que ainda não dá.
      locked: level > 0 && level < spell.minLevel,
    }));

  return (
    <div className="rule-editor" role="dialog" aria-label="editar regra">
      <div className="rule-editor-body">
        <div className="bot-rule bot-rule-wide">
          <select
            aria-label="condição"
            value={rule.when.kind}
            onChange={(event) => { setRule({ ...rule, when: blankCondition(event.target.value) }); }}
          >
            {BOT_CONDITION_KINDS
              .filter((kind) => !vocabulary.advancedOnly.conditions.includes(kind) || level >= vocabulary.advancedFromLevel)
              .map((kind) => <option key={kind} value={kind}>{CONDITION_TEXT[kind] ?? kind}</option>)}
          </select>
          <select
            aria-label="operador"
            value={rule.when.op}
            onChange={(event) => {
              setRule({ ...rule, when: { ...rule.when, op: event.target.value } as BotCondition });
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
            onChange={(event) => { setRule({ ...rule, when: withValue(rule.when, Number(event.target.value)) }); }}
          />
          <select
            aria-label="ação"
            value={actionId}
            onChange={(event) => {
              const id = event.target.value;
              setRule({
                ...rule,
                do: supplies !== null ? { kind: 'supply', supplyId: id } : { kind: 'spell', spellId: id },
              });
            }}
          >
            {actions.map((action) => (
              <option key={action.id} value={action.id} disabled={action.locked}>{action.label}</option>
            ))}
          </select>
        </div>
        <div className="bot-actions">
          {/* Salvar aplica ao rascunho e manda AGORA (invariante 4: intenção; quem decide é o
              servidor, e a recusa chega em `bot-config-result` sem desfazer nada). */}
          <button type="button" onClick={() => { putRule(category, index, rule); onClose(); }}>Salvar</button>
          <button type="button" className="entry-quiet" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
