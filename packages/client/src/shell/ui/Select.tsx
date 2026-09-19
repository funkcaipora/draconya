// Select (#246, ADR 0029 D2): sem `label`, renderiza só o <select> (o handoff já fazia isso —
// a reescrita preserva, ver §7 da spec). `options` aceita string solta ou {value,label}, como
// no handoff; a seta "▾" é decoração pura (`aria-hidden`), nunca alvo de clique.
//
// `disabled`/`ariaLabel` (#437): o "Você" de `ConditionList` é um select de UMA opção, visível
// e INERTE (ADR 0030 D4, DT-06 da spec de #435) — não há condição por membro da party ainda
// (M20). `aria-label` supre o rótulo visível que este select, sem `label`, não tem.

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  options: ReadonlyArray<string | SelectOption>;
  value?: string;
  onChange?: (value: string) => void;
  size?: 'sm' | 'md' | 'lg';
  /** rótulo à esquerda, controle à direita (barra de ações de configurações) */
  inline?: boolean;
  className?: string;
  disabled?: boolean;
  /** Rótulo para leitor de tela quando não há `label` visível. */
  ariaLabel?: string;
}

function optionValue(option: string | SelectOption): string {
  return typeof option === 'string' ? option : option.value;
}

function optionLabel(option: string | SelectOption): string {
  return typeof option === 'string' ? option : option.label;
}

export function Select({
  label, options, value, onChange, size = 'sm', inline = false, className, disabled = false, ariaLabel,
}: SelectProps) {
  const field = (
    <span className="ui-select-field">
      <select
        value={value}
        onChange={(event) => { onChange?.(event.target.value); }}
        className={`ui-select ui-select-${size}`}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        {options.map((option) => (
          <option key={optionValue(option)} value={optionValue(option)}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
      <span className="ui-select-caret" aria-hidden="true">▾</span>
    </span>
  );

  if (!label) return field;

  const wrapClasses = ['ui-select-wrap', inline ? 'ui-select-inline' : null, className ?? null]
    .filter((v): v is string => v !== null).join(' ');

  return (
    <label className={wrapClasses}>
      <span className="ui-select-label">{label}</span>
      {field}
    </label>
  );
}
