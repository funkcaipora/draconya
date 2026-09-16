// Select (#246, ADR 0029 D2): sem `label`, renderiza só o <select> (o handoff já fazia isso —
// a reescrita preserva, ver §7 da spec). `options` aceita string solta ou {value,label}, como
// no handoff; a seta "▾" é decoração pura (`aria-hidden`), nunca alvo de clique.

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
}

function optionValue(option: string | SelectOption): string {
  return typeof option === 'string' ? option : option.value;
}

function optionLabel(option: string | SelectOption): string {
  return typeof option === 'string' ? option : option.label;
}

export function Select({ label, options, value, onChange, size = 'sm', inline = false, className }: SelectProps) {
  const field = (
    <span className="ui-select-field">
      <select
        value={value}
        onChange={(event) => { onChange?.(event.target.value); }}
        className={`ui-select ui-select-${size}`}
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
