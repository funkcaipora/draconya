// A lista de condições em E de um slot (RG-006, AB-11/#426, redesenhada em #437 na régua da
// imagem do "Configurar ação" do Tibia, anexa à issue #435; reusada pelo AB-12/#427). Uma linha
// por condição: quem, tipo, operador por extenso, valor com −/+, o "%" inerte e o × que remove
// SÓ ela (UC-COND-006). A lista vazia é válida — ação sem condição é elegível sempre (RG-007).
//
// A tela não avalia condição nenhuma (invariante 4): ela edita o vocabulário fechado e devolve a
// lista para o rascunho. `Você` é um select de UMA opção, visível e INERTE (ADR 0030 D4, DT-06 da
// spec de #435) — a condição por membro da party chega só com o M20. O `%` é a mesma ideia:
// sempre marcado e desabilitado, ausente em `targets` (que não é percentual).

import type { BotConditionKindV2, BotConditionV2, BotOperator } from '@draconya/content';
import {
  CONDITION_KIND_LABELS, OFFERED_CONDITION_KINDS, OPERATOR_OPTIONS,
  blankConditionV2, conditionBounds, conditionValue,
} from '../bot/action-config.js';
import { Select } from './ui/Select.js';
import { Input } from './ui/Input.js';
import { IconButton } from './ui/IconButton.js';
import { Checkbox } from './ui/Checkbox.js';
import { Button } from './ui/Button.js';

export interface ConditionListProps {
  conditions: readonly BotConditionV2[];
  onChange: (conditions: readonly BotConditionV2[]) => void;
  /**
   * Os tipos oferecidos. Default `OFFERED_CONDITION_KINDS` — o catálogo v2 do AB-09 não publica
   * os efeitos, então `condition` fica de fora até o motor (AB-07) expô-los (DT-05).
   */
  kinds?: readonly BotConditionKindV2[];
  /** Texto acima da lista (o modal de ação passa a nota de "todas precisam bater"). */
  hint?: string;
}

/** Troca o valor de uma condição, respeitando o campo que o tipo dela usa. */
function withValue(condition: BotConditionV2, value: number): BotConditionV2 {
  if (condition.kind === 'targets') return { ...condition, count: value };
  if (condition.kind === 'condition') return condition;
  return { ...condition, percent: value };
}

/** O valor seguinte, preso à faixa do tipo (`conditionBounds`) — nunca sai do −/+ fora da faixa. */
function clamp(kind: BotConditionKindV2, value: number): number {
  const { min, max } = conditionBounds(kind);
  const floored = Math.max(min, value);
  return max === null ? floored : Math.min(max, floored);
}

export function ConditionList({
  conditions, onChange, kinds = OFFERED_CONDITION_KINDS, hint,
}: ConditionListProps) {
  function replace(index: number, condition: BotConditionV2): void {
    onChange(conditions.map((current, i) => (i === index ? condition : current)));
  }

  function step(index: number, condition: BotConditionV2, delta: number): void {
    if (condition.kind === 'condition') return;
    replace(index, withValue(condition, clamp(condition.kind, conditionValue(condition) + delta)));
  }

  return (
    <div className="condition-list">
      {hint !== undefined && <p className="quiet">{hint}</p>}
      {conditions.map((condition, index) => (
        <div className="condition-row" key={index}>
          <Select
            size="sm"
            options={[{ value: 'self', label: 'Você' }]}
            value="self"
            disabled
            ariaLabel="quem"
            onChange={() => {}}
          />
          <Select
            size="sm"
            options={kinds.map((kind) => ({ value: kind, label: CONDITION_KIND_LABELS[kind] }))}
            value={condition.kind}
            onChange={(kind) => { replace(index, blankConditionV2(kind as BotConditionKindV2)); }}
          />
          {condition.kind !== 'condition' && (
            <>
              <Select
                size="sm"
                options={OPERATOR_OPTIONS.map((op) => ({ value: op.value, label: op.label }))}
                value={condition.op}
                onChange={(op) => { replace(index, { ...condition, op: op as BotOperator }); }}
              />
              <IconButton size="sm" title="diminuir" onClick={() => { step(index, condition, -1); }}>
                −
              </IconButton>
              <Input
                size="sm"
                type="number"
                aria-label="valor da condição"
                value={String(conditionValue(condition))}
                onChange={(event) => { replace(index, withValue(condition, Number(event.target.value))); }}
              />
              <IconButton size="sm" title="aumentar" onClick={() => { step(index, condition, 1); }}>
                +
              </IconButton>
              {condition.kind !== 'targets' && <Checkbox checked disabled size={13} />}
            </>
          )}
          <IconButton
            size="sm"
            title="remover condição"
            onClick={() => { onChange(conditions.filter((_, i) => i !== index)); }}
          >×</IconButton>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => { onChange([...conditions, blankConditionV2(kinds[0] ?? 'hp')]); }}
      >+ Adicionar condição</Button>
    </div>
  );
}
