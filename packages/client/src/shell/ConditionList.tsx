// A lista de condições em E de um slot (RG-006, AB-11/#426; reusada pelo AB-12/#427). Uma linha
// por condição: tipo, operador, valor e o × que remove SÓ ela (UC-COND-006). A lista vazia é
// válida — ação sem condição é elegível sempre (RG-007).
//
// A tela não avalia condição nenhuma (invariante 4): ela edita o vocabulário fechado e devolve a
// lista para o rascunho. A frase de cada linha (`conditionText`) existe para o leitor de tela e
// para o teste — o desenho é o do kit, com os controles separados.

import type { BotConditionKindV2, BotConditionV2, BotOperator } from '@draconya/content';
import {
  CONDITION_KIND_LABELS, OFFERED_CONDITION_KINDS, OPERATOR_OPTIONS,
  blankConditionV2, conditionText, conditionValue,
} from '../bot/action-config.js';
import { Select } from './ui/Select.js';
import { Input } from './ui/Input.js';
import { IconButton } from './ui/IconButton.js';
import { Button } from './ui/Button.js';

export interface ConditionListProps {
  conditions: readonly BotConditionV2[];
  onChange: (conditions: readonly BotConditionV2[]) => void;
  /**
   * Os tipos oferecidos. Default `OFFERED_CONDITION_KINDS` — o catálogo v2 do AB-09 não publica
   * os efeitos, então `condition` fica de fora até o motor (AB-07) expô-los (DT-05).
   */
  kinds?: readonly BotConditionKindV2[];
}

/** Troca o valor de uma condição, respeitando o campo que o tipo dela usa. */
function withValue(condition: BotConditionV2, value: number): BotConditionV2 {
  if (condition.kind === 'targets') return { ...condition, count: value };
  if (condition.kind === 'condition') return condition;
  return { ...condition, percent: value };
}

export function ConditionList({
  conditions, onChange, kinds = OFFERED_CONDITION_KINDS,
}: ConditionListProps) {
  function replace(index: number, condition: BotConditionV2): void {
    onChange(conditions.map((current, i) => (i === index ? condition : current)));
  }

  return (
    <div className="condition-list">
      {conditions.map((condition, index) => (
        <div className="condition-row" key={index} aria-label={conditionText(condition)}>
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
              <Input
                size="sm"
                type="number"
                aria-label="valor da condição"
                value={String(conditionValue(condition))}
                onChange={(event) => { replace(index, withValue(condition, Number(event.target.value))); }}
              />
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
      >+ CONDIÇÃO</Button>
    </div>
  );
}
