// Slot: a célula quadrada de item/ação/equipamento (DS-04, #247). Três tamanhos fixos
// (design-system-plan.md §1): 36 barra de ação, 30 equipamento e party, 26 container — quem
// consome passa o número certo; o primitivo não escolhe o tamanho pelo `kind`.
//
// Vazio mostra o RÓTULO do lugar (ex. "PESCOÇO") quando `label` vem, e só cai no "+" genérico
// quando não há rótulo nenhum (ex. "+ regra" tracejado do bot) — corrige o protótipo, que
// desenhava "+" em todo slot vazio e ignorava `label` (ADR 0029 D4, decisão 4 do §10 do plano).

import type { CSSProperties, ReactNode } from 'react';

export interface SlotProps {
  /** Texto curto sem ícone: abreviação de magia/item, ou o rótulo do lugar vazio. */
  label?: string;
  hotkey?: string | number;
  count?: number | string;
  empty?: boolean;
  /** px — 36 barra de ação, 30 equipamento/party, 26 container. */
  size: 26 | 30 | 36;
  kind?: 'action' | 'item' | 'loot' | 'equip';
  icon?: ReactNode;
  selected?: boolean;
  dashed?: boolean;
  /** holy | ice | earth | fire | energy | death — tinge o rótulo */
  element?: 'holy' | 'ice' | 'earth' | 'fire' | 'energy' | 'death';
  onClick?: () => void;
  className?: string;
}

export function Slot({
  label, hotkey, count, empty, size, kind = 'action', icon, selected, dashed, element, onClick, className,
}: SlotProps) {
  const rootClass = [
    'ui-slot',
    empty === true ? 'ui-slot--empty' : null,
    dashed === true ? 'ui-slot--dashed' : null,
    selected === true ? 'ui-slot--selected' : null,
    className ?? null,
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={rootClass}
      data-kind={kind}
      onClick={onClick}
      style={{ '--slot-size': `${String(size)}px` } as CSSProperties}
    >
      {icon ?? (
        <span className="ui-slot-label" data-element={element}>
          {empty === true && label === undefined ? '+' : label}
        </span>
      )}
      {hotkey !== undefined && <small className="ui-slot-hotkey">{hotkey}</small>}
      {count !== undefined && count !== null && <b className="ui-slot-count">{count}</b>}
    </button>
  );
}
