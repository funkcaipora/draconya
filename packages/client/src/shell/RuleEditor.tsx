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
import { bot, putRule } from '../bot/store.js';
import { useStoreSlice } from '../state/useSlice.js';
import type { BotVocabulary } from '../state/hud.js';
import { CONDITION_TEXT } from './rule-text.js';
import { CATEGORY_TEXT } from './BotPanel.js';
import { Modal } from './ui/Modal.js';
import { Select } from './ui/Select.js';
import { Input } from './ui/Input.js';
import { Button } from './ui/Button.js';

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

  // A meta "slot N/M" (RF-06): N é a posição 1-based (a nova entra no FIM da categoria — mesma
  // regra de sempre, §13.4); M é o teto do catálogo, igual ao "n/slots" do cabeçalho da Category.
  const rules = useStoreSlice(bot, (state) => state.draft.rules[category]);
  const slots = vocabulary.slots[category] ?? 0;
  const slotNumber = (index ?? rules.length) + 1;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${index === null ? 'Nova regra' : 'Editar regra'} · ${CATEGORY_TEXT[category]}`}
      width={480}
      meta={`slot ${String(slotNumber)}/${String(slots)}`}
      footer={
        <>
          <span className="rule-editor-hint">Salvar manda agora · quem decide é o servidor</span>
          <span className="rule-editor-actions">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
            {/* Salvar aplica ao rascunho e manda AGORA (invariante 4): quem decide se vale é o
                servidor, e a recusa chega em bot-config-result sem desfazer nada — putRule é a
                MESMA função de antes. */}
            <Button variant="primary" size="sm" onClick={() => { putRule(category, index, rule); onClose(); }}>Salvar</Button>
          </span>
        </>
      }
    >
      <div className="rule-editor-row">
        <Select
          label="Condição"
          size="md"
          value={rule.when.kind}
          options={BOT_CONDITION_KINDS
            .filter((kind) => !vocabulary.advancedOnly.conditions.includes(kind) || level >= vocabulary.advancedFromLevel)
            .map((kind) => ({ value: kind, label: CONDITION_TEXT[kind] ?? kind }))}
          onChange={(value) => { setRule({ ...rule, when: blankCondition(value) }); }}
        />
        <Select
          label="Operador"
          size="md"
          value={rule.when.op}
          options={OPERATORS.map((op) => ({ value: op, label: op }))}
          onChange={(value) => { setRule({ ...rule, when: { ...rule.when, op: value } as BotCondition }); }}
        />
        <Input
          label="Valor"
          size="sm"
          type="number"
          value={String(conditionValue(rule.when))}
          onChange={(event) => { setRule({ ...rule, when: withValue(rule.when, Number(event.target.value)) }); }}
        />
      </div>
      <div className="rule-editor-divider"><span>→ AÇÃO</span></div>
      <div className="rule-action-list">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            data-action-id={action.id}
            disabled={action.locked}
            className={`rule-action${action.id === actionId ? ' rule-action-selected' : ''}`}
            onClick={() => {
              setRule({
                ...rule,
                do: supplies !== null ? { kind: 'supply', supplyId: action.id } : { kind: 'spell', spellId: action.id },
              });
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
      <p className="rule-editor-note">
        Dentro da categoria a avaliação é de cima para baixo: a primeira regra válida executa. HP e Mana comparam percentual, nunca valor absoluto.
      </p>
    </Modal>
  );
}
