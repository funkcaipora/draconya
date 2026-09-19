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
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
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

/** Magias genéricas e da vocação atual: a tela nunca oferece o que o servidor recusará. */
export function spellsFor(vocabulary: BotVocabulary, vocationId: string | null): BotVocabulary['spells'] {
  return vocabulary.spells.filter((spell) => spell.vocationId === null || spell.vocationId === vocationId);
}

/** Uma regra nova para a categoria: a primeira ação do catálogo, ligada. */
export function blankRule(category: BotCategory, vocabulary: BotVocabulary, vocationId: string | null = null): BotRule | null {
  const supplies = suppliesFor(category, vocabulary);
  const first = supplies === null ? spellsFor(vocabulary, vocationId)[0]?.id : supplies[0]?.id;
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

/**
 * Só cura/poção/suporte podem mirar outra pessoa, e só quando o catálogo marcou a ação como
 * `targets: 'friend'` (#406, §26-30, DT-02). A mesma regra de slots/`advancedOnly`: a tela
 * nunca oferece o que o servidor recusaria — e nunca inventa um alvo amigo que o conteúdo não
 * declarou.
 */
export function actionAcceptsFriend(
  category: BotCategory,
  entry: { readonly targets?: 'self' | 'friend' | undefined } | undefined,
): boolean {
  return (category === 'heal' || category === 'potion' || category === 'support')
    && entry?.targets === 'friend';
}

/**
 * A regra depois de escolher uma ação (#406, RF-07/DT-03): o `do` novo e o alvo ZERADO quando a
 * ação não aceita amigo. Manter um `target: { kind: 'member' }` invisível na tela salvaria uma
 * configuração que o jogador não vê nem escolheu para aquela ação.
 */
export function withAction(rule: BotRule, doAction: BotRule['do'], acceptsFriend: boolean): BotRule {
  return {
    ...rule,
    do: doAction,
    target: acceptsFriend ? (rule.target ?? { kind: 'self' }) : { kind: 'self' },
  };
}

function spellActions(
  spells: BotVocabulary['spells'], level: number, lockedIds: ReadonlySet<string>,
  vocationNames: ReadonlyMap<string, string>,
): ReadonlyArray<{ readonly id: string; readonly label: string; readonly locked: boolean }> {
  const base = (spell: BotVocabulary['spells'][number]) =>
    `${spell.name} · ${spell.group} (${String(spell.manaCost)} mana)`;
  const bases = spells.map(base);
  const duplicateBases = new Set(bases.filter((label, index) => bases.indexOf(label) !== index));
  const decorated = spells.map((spell, index) => duplicateBases.has(bases[index] ?? '')
    ? `${bases[index]} · ${spell.vocationId === null ? 'Genérica' : vocationNames.get(spell.vocationId) ?? spell.vocationId}`
    : bases[index] ?? spell.id);
  const duplicateLabels = new Set(decorated.filter((label, index) => decorated.indexOf(label) !== index));
  return spells.map((spell, index) => ({
    id: spell.id,
    label: duplicateLabels.has(decorated[index] ?? '') ? `${decorated[index]} · ${spell.id}` : decorated[index] ?? spell.id,
    locked: lockedIds.has(spell.id) || level > 0 && level < spell.minLevel,
  }));
}

export function RuleEditor({ category, index, initial, vocabulary, level, vocationId, vocationNames, onClose }: {
  category: BotCategory;
  /** `null` é regra nova: entra no fim da categoria. */
  index: number | null;
  initial: BotRule;
  vocabulary: BotVocabulary;
  level: number;
  vocationId: string | null;
  vocationNames: ReadonlyMap<string, string>;
  onClose: () => void;
}) {
  const [rule, setRule] = useState<BotRule>(initial);
  const actionId = rule.do.kind === 'supply'
    ? rule.do.supplyId
    : rule.do.kind === 'spell' ? rule.do.spellId : rule.do.itemId;

  // Poção e runa são supply; o resto é magia. É a divisão do §13.3, e ela vem do catálogo.
  const supplies = suppliesFor(category, vocabulary);
  const availableSpells = spellsFor(vocabulary, vocationId);
  let legacySpell: BotVocabulary['spells'][number] | undefined;
  if (supplies === null && rule.do.kind === 'spell') {
    const spellId = rule.do.spellId;
    legacySpell = vocabulary.spells.find((spell) =>
      spell.id === spellId && !availableSpells.some((available) => available.id === spell.id));
  }
  const actions = supplies !== null
    ? supplies.map((supply) => ({
      id: supply.id, label: `${supply.name} (${String(supply.price)} gold)`,
      // A runa (#165) tem level: a tela só mostra que ainda não dá; quem recusa é o servidor.
      locked: level > 0 && level < (supply.requires.level ?? 0),
    }))
    : spellActions(
      legacySpell === undefined ? availableSpells : [legacySpell, ...availableSpells],
      level,
      legacySpell === undefined ? new Set() : new Set([legacySpell.id]),
      vocationNames,
    );

  // A meta "slot N/M" (RF-06): N é a posição 1-based (a nova entra no FIM da categoria — mesma
  // regra de sempre, §13.4); M é o teto do catálogo, igual ao "n/slots" do cabeçalho da Category.
  const rules = useStoreSlice(bot, (state) => state.draft.rules[category]);
  const slots = vocabulary.slots[category] ?? 0;
  const slotNumber = (index ?? rules.length) + 1;

  // O alvo da regra (#406, §26-30, ADR 0033 d.10). Só a tela de cura/poção/suporte oferece o
  // seletor, e só quando a AÇÃO escolhida aceita amigo no catálogo (`targets: 'friend'`) — a
  // mesma regra que já vale para slots/`advancedOnly`: nada é oferecido em código (DT-02).
  // A lista de membros vem ao vivo do `party-state`, sem cópia local (RF-06).
  const party = useHudSlice((state) => state.party);
  const me = useHudSlice((state) => state.characterId);
  const selectedEntry = supplies !== null
    ? supplies.find((supply) => supply.id === actionId)
    : availableSpells.find((spell) => spell.id === actionId);
  const acceptsFriend = actionAcceptsFriend(category, selectedEntry);
  const target = rule.target ?? { kind: 'self' as const };

  function setTarget(next: NonNullable<BotRule['target']>): void {
    setRule({ ...rule, target: next });
  }

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
      {acceptsFriend && (
        <div className="rule-editor-target">
          <fieldset>
            <legend>Alvo</legend>
            <label>
              <input
                type="radio"
                name="rule-target"
                checked={target.kind === 'self'}
                onChange={() => { setTarget({ kind: 'self' }); }}
              />
              Eu
            </label>
            <label>
              <input
                type="radio"
                name="rule-target"
                checked={target.kind === 'lowest-hp-member'}
                onChange={() => { setTarget({ kind: 'lowest-hp-member' }); }}
              />
              Membro da Party com menor vida
            </label>
            <label>
              <input
                type="radio"
                name="rule-target"
                checked={target.kind === 'member'}
                onChange={() => {
                  const first = party?.members.find((member) => member.characterId !== me);
                  if (first !== undefined) setTarget({ kind: 'member', characterId: first.characterId });
                }}
              />
              Membro específico
            </label>
          </fieldset>
          {/* §30: a lista só existe com a party viva; o `characterId` é do rascunho, e quem
              valida se ele ainda é membro é o servidor — a tela não some com a escolha antes do
              Salvar (caso de borda do §7). */}
          {target.kind === 'member' && party !== null && (
            <Select
              size="sm"
              value={target.characterId}
              options={party.members
                .filter((member) => member.characterId !== me)
                .map((member) => ({ value: member.characterId, label: member.name }))}
              onChange={(characterId) => { setTarget({ kind: 'member', characterId }); }}
            />
          )}
        </div>
      )}
      {legacySpell !== undefined && legacySpell.vocationId !== null && (
        <p className="system-warning rule-editor-warning" role="alert">
          {`A regra usa ${legacySpell.name}, que não é da sua vocação.`}
        </p>
      )}
      <div className="rule-action-list">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            data-action-id={action.id}
            disabled={action.locked}
            className={`rule-action${action.id === actionId ? ' rule-action-selected' : ''}`}
            onClick={() => {
              // RF-07/DT-03: trocar para uma ação que NÃO aceita amigo zera o alvo — a decisão
              // mora em `withAction`, pura e testada; aqui só se acha a entrada do catálogo.
              const nextEntry = supplies !== null
                ? supplies.find((supply) => supply.id === action.id)
                : [...(legacySpell === undefined ? [] : [legacySpell]), ...availableSpells]
                  .find((spell) => spell.id === action.id);
              setRule(withAction(
                rule,
                supplies !== null ? { kind: 'supply', supplyId: action.id } : { kind: 'spell', spellId: action.id },
                actionAcceptsFriend(category, nextEntry),
              ));
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
