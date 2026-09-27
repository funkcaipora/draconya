// ContextMenu: um menu posicionado no ponto do clique direito (#724, ADR 0048 d.8 — o menu de
// contexto da mochila/bolsa, "Vender · Descartar"). Fecha no Esc, no clique fora e ao rolar —
// as mesmas três saídas do `Modal` (Esc, scrim), mais a rolagem: um menu posicionado por
// coordenada de tela que fica para trás do que ele apontava é pior que nenhum menu.
//
// Não é `Modal`: não tem scrim nem título, é uma lista pequena ancorada num ponto — a mesma
// diferença que o clique direito do Explorer tem para uma janela.
//
// **Portal para `document.body` (#764).** O menu nasce dentro de `.ui-panel-body`, e um
// ancestral dele tem `transform` — que cria BLOCO DE CONTENÇÃO para `position: fixed`: o menu
// fica fixo ao painel, não à janela. Medido no QA: `style left:831px; top:563px` virava
// `rect x=1635` num viewport de 1024px de largura. `createPortal` tira o menu da árvore do
// painel e o anexa direto no `body`, onde `position: fixed` volta a valer contra a JANELA.
// Sem `document` (SSR/teste — `environment: 'node'` sem jsdom, AGENTS.md do pacote) desenha
// inline: não há portal para fazer, e é o que os testes de `prerender` sempre exerceram.
//
// **Clamp de viewport (#764).** Portal resolve o "fixo a quê"; não resolve um clique perto da
// borda que nasce o menu para FORA da tela mesmo fixo à janela. `useLayoutEffect` mede o menu
// já montado (`getBoundingClientRect`, só existe depois de montado — por isso não dá para
// clampar no primeiro render) e chama a função PURA `clampMenuPosition`
// (`context-menu-position.ts`, testada sem DOM) ANTES do primeiro paint, para o menu não
// piscar no lugar errado e depois pular.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clampMenuPosition } from './context-menu-position.js';
import type { Point } from './context-menu-position.js';

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
  // Nasce na coordenada desejada (é o que os testes de `prerender` — sem efeito nenhum —
  // continuam vendo) e só é reposicionado depois de medido.
  const [position, setPosition] = useState<Point>({ x, y });

  // Repõe a posição desejada sempre que o menu reabre em outro ponto (o componente é
  // remontado por `key`/condicional nos consumidores, então isto cobre principalmente o caso
  // em que não for), e mede+clampa antes do primeiro paint.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || typeof window === 'undefined') { setPosition({ x, y }); return; }
    const rect = el.getBoundingClientRect();
    setPosition(clampMenuPosition(
      { x, y },
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    ));
  }, [x, y]);

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

  const menu = (
    <ul
      ref={ref}
      role="menu"
      className="ui-context-menu"
      style={{ left: position.x, top: position.y }}
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

  return typeof document !== 'undefined' ? createPortal(menu, document.body) : menu;
}
