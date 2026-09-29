// Checkbox (#246, ADR 0029 D2). O handoff usa um <span onClick>, sem teclado nem role
// (Checkbox.jsx:3-4). Esta reescrita ganha role="checkbox", aria-checked e Space/Enter pelo
// teclado — sem isso um primitivo reutilizado em formulário nenhum passa em teste de
// acessibilidade nenhum, e corrigir depois seria reabrir todo consumidor. DT-01.
//
// `size` (R0-07): o kit usa um número livre por chamada (`size={12}` em HuntsModal,
// `size={13}` em HuntDetailsModal, default 15 sem uso real conhecido) — como o `Slot` já faz
// com `--slot-size`, o tamanho vira custom property em vez de uma classe por valor.

import type { CSSProperties } from 'react';

export interface CheckboxProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  /** px — 15 é o default do kit (sem uso real hoje); 12 e 13 são os dois tamanhos que HuntsModal
   *  e HuntDetailsModal realmente usam (Modals.jsx:58,133 do handoff). */
  size?: 12 | 13 | 15;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({
  checked, onChange, label, size = 15, disabled = false, className,
}: CheckboxProps) {
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
        style={{ '--checkbox-size': `${String(size)}px` } as CSSProperties}
      />
      {label !== undefined && <span className="ui-checkbox-label">{label}</span>}
    </label>
  );
}
