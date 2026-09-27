// ContextMenu: um menu posicionado no ponto do clique direito (#724, ADR 0048 d.8 — o menu de
// contexto da mochila/bolsa, "Vender · Descartar"). Fecha no Esc, no clique fora e ao rolar —
// as mesmas três saídas do `Modal` (Esc, scrim), mais a rolagem: um menu posicionado por
// coordenada de tela que fica para trás do que ele apontava é pior que nenhum menu.
//
// Não é `Modal`: não tem scrim nem título, é uma lista pequena ancorada num ponto — a mesma
// diferença que o clique direito do Explorer tem para uma janela.

import { useEffect, useRef } from 'react';

export interface ContextMenuAction {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Tooltip nativo — também onde uma ação desabilitada explica por que (como `Button`). */
  title?: string;
  danger?: boolean;
}

export interface ContextMenuProps {
  /** Coordenada de TELA (`clientX`/`clientY` do evento que abriu o menu). */
  x: number;
  y: number;
  actions: readonly ContextMenuAction[];
  onClose: () => void;
}

export function ContextMenu({ x, y, actions, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    function onPointerDown(event: PointerEvent): void {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose();
    }
    // Rolar a tela move tudo, e um menu que fica preso no ponto antigo aponta para o lugar
    // errado — captura, para pegar a rolagem de qualquer coluna, não só a da janela.
    function onScroll(): void { onClose(); }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  return (
    <ul
      ref={ref}
      role="menu"
      className="ui-context-menu"
      style={{ left: x, top: y }}
    >
      {actions.map((action) => (
        <li key={action.label} role="none">
          <button
            type="button"
            role="menuitem"
            disabled={action.disabled ?? false}
            title={action.title}
            className={['ui-context-menu-item', action.danger === true ? 'ui-context-menu-item--danger' : null]
              .filter((value): value is string => value !== null).join(' ')}
            onClick={() => { action.onSelect(); onClose(); }}
          >
            {action.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
