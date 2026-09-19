// Slot: a célula quadrada de item/ação/equipamento (DS-04, #247). Três tamanhos fixos: 36 barra
// de ação, 30 equipamento/party, 26 container. Vazio mostra o RÓTULO do lugar; só cai no "+"
// genérico sem rótulo nenhum (ADR 0029 D4).
//
// **Arraste nativo (#161, FD-07):** equipamento/container arrastam por cima de
// `shell/drag-intent.ts`, PURO, que decide a MENSAGEM — `Slot` só repassa os handlers ao
// `<button>`; quem decide o que sai é quem monta a tela, nunca o Slot (invariante 4).

import type { CSSProperties, DragEventHandler, MouseEvent, ReactNode } from 'react';

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
  /**
   * O evento vai junto (AB-10, RF-07): o Shift+clique da barra precisa do modificador, e o
   * `<button>` o engolia. Retrocompatível — um handler sem parâmetro continua atribuível.
   */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  /** Nome completo para tooltip nativo — o texto/rótulo visível pode vir cortado. */
  title?: string;
  /** Rótulo para leitor de tela quando o conteúdo visível não basta (ex. "Pescoço (vazio)"). */
  ariaLabel?: string;
  /** Faz do slot a ORIGEM de um arrastar nativo. */
  draggable?: boolean;
  onDragStart?: DragEventHandler<HTMLButtonElement>;
  /** Faz do slot o DESTINO de um arrastar nativo — quem chama decide se aceita (`preventDefault`). */
  onDragOver?: DragEventHandler<HTMLButtonElement>;
  onDrop?: DragEventHandler<HTMLButtonElement>;
}

export function Slot({
  label, hotkey, count, empty, size, kind = 'action', icon, selected, dashed, element, onClick,
  className, title, ariaLabel, draggable, onDragStart, onDragOver, onDrop,
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
      title={title}
      aria-label={ariaLabel}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ '--slot-size': `${String(size)}px` } as CSSProperties}
    >
      {icon}
      {label !== undefined
        ? <span className="ui-slot-label" data-element={element}>{label}</span>
        : icon === undefined && empty === true
          ? <span className="ui-slot-label">+</span>
          : null}
      {hotkey !== undefined && <small className="ui-slot-hotkey">{hotkey}</small>}
      {count !== undefined && count !== null && <b className="ui-slot-count">{count}</b>}
    </button>
  );
}
