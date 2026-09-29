// Input (#246, ADR 0029 D2): campo de texto com rótulo, ação e rodapé de dica/erro. Todo prop
// nativo de <input> (value, onChange, placeholder, type, name, …) é repassado por `...rest` —
// é assim que `size="sm" type="number"` cobre o `NumField` que o handoff usava em três modais
// sem nunca definir (DT-03): não há arquivo `NumField.tsx`, é este componente com duas props.

import type { InputHTMLAttributes } from 'react';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'className'> {
  label?: string;
  action?: string;
  onAction?: () => void;
  hint?: string;
  error?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Input({
  label,
  action,
  onAction,
  hint,
  error,
  size = 'lg',
  className,
  ...rest
}: InputProps) {
  const wrapClasses = ['ui-input', `ui-input-${size}`, className ?? null]
    .filter((value): value is string => value !== null).join(' ');
  const fieldClasses = ['ui-input-field', error ? 'ui-input-error' : null]
    .filter((value): value is string => value !== null).join(' ');

  return (
    <label className={wrapClasses}>
      {(label || action) && (
        <span className="ui-input-head">
          <span className="ui-input-label">{label}</span>
          {action && (
            <button type="button" className="ui-input-action" onClick={onAction}>
              {action}
            </button>
          )}
        </span>
      )}
      <input {...rest} className={fieldClasses} />
      {(hint || error) && (
        <span className="ui-input-footer">{error || hint}</span>
      )}
    </label>
  );
}
