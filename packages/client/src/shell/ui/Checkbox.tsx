// Checkbox (#246, ADR 0029 D2). O handoff usa um <span onClick>, sem teclado nem role
// (Checkbox.jsx:3-4). Esta reescrita ganha role="checkbox", aria-checked e Space/Enter pelo
// teclado — sem isso um primitivo reutilizado em formulário nenhum passa em teste de
// acessibilidade nenhum, e corrigir depois seria reabrir todo consumidor. DT-01.

export interface CheckboxProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ checked, onChange, label, disabled = false, className }: CheckboxProps) {
  const toggle = () => { if (!disabled) onChange?.(!checked); };
  return (
    <label className={['ui-checkbox', className ?? null].filter((v): v is string => v !== null).join(' ')}>
      <span
        role="checkbox"
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        className={`ui-checkbox-box${checked ? ' ui-checkbox-checked' : ''}`}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggle(); }
        }}
      />
      {label !== undefined && <span className="ui-checkbox-label">{label}</span>}
    </label>
  );
}
