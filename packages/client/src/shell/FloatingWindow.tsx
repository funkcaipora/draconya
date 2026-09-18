// Janela flutuante reutilizável do HUD (#314). O estado de posição é local ao navegador: não
// toca socket, store do jogo nem snapshot, porque arrastar uma moldura não é uma intenção de jogo.

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Panel } from './ui/Panel.js';

export interface Position {
  readonly x: number;
  readonly y: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

interface DragState {
  readonly pointerId: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface FloatingWindowProps {
  /** Nome estável da janela; também separa a posição de cada consumidor no localStorage. */
  readonly name: string;
  readonly title: string;
  /** Posição usada quando não há posição salva, ou quando o storage não está disponível. */
  readonly initial: Position;
  readonly meta?: string;
  readonly onClose?: () => void;
  readonly actions?: ReactNode;
  readonly width?: number;
  readonly footer?: ReactNode;
  /** Classe extra da instância (`ui-floating-window--<name>`), usada pelo `order` de mobile. */
  readonly className?: string;
  readonly children?: ReactNode;
}

const STORAGE_PREFIX = 'draconya:floating-window:';
const DRAG_STRIP_BUTTONS_WIDTH = 60;

function storageKey(name: string): string {
  return STORAGE_PREFIX + name;
}

function isPosition(value: unknown): value is Position {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { x?: unknown; y?: unknown };
  return typeof candidate.x === 'number'
    && Number.isFinite(candidate.x)
    && typeof candidate.y === 'number'
    && Number.isFinite(candidate.y);
}

/** Mantém a janela inteira visível, inclusive quando ela é maior que o viewport. */
export function clampPosition(position: Position, size: Size, viewport: Size): Position {
  const maxX = Math.max(0, viewport.width - size.width);
  const maxY = Math.max(0, viewport.height - size.height);
  return {
    x: Math.min(maxX, Math.max(0, position.x)),
    y: Math.min(maxY, Math.max(0, position.y)),
  };
}

/** Lê uma posição salva sem deixar uma falha de storage impedir a janela de abrir. */
export function loadPosition(name: string, fallback: Position): Position {
  try {
    const value = localStorage.getItem(storageKey(name));
    if (value === null) return fallback;
    const parsed: unknown = JSON.parse(value);
    return isPosition(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Persistência é melhor esforço: privacidade/cota não podem quebrar a interface. */
export function savePosition(name: string, position: Position): void {
  try {
    localStorage.setItem(storageKey(name), JSON.stringify(position));
  } catch {
    // Uma aba que bloqueia storage continua podendo usar a janela nesta sessão.
  }
}

function differs(left: Position, right: Position): boolean {
  return left.x !== right.x || left.y !== right.y;
}

/**
 * Moldura flutuante sobre o mundo. O arraste é limitado à faixa do título e usa Pointer Events
 * com captura local: não instala listeners globais e não conhece o estado de nenhuma sessão.
 */
export function FloatingWindow({
  name,
  title,
  initial,
  meta,
  onClose,
  actions,
  width,
  footer,
  className,
  children,
}: FloatingWindowProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const [position, setPosition] = useState<Position>(() => loadPosition(name, initial));
  const positionRef = useRef(position);
  positionRef.current = position;

  // A posição salva pode ter vindo de um monitor maior. O clamp acontece depois de o Panel ter
  // tamanho real; não há ouvinte de resize porque esta tarefa não tem consumidor que o exija.
  useEffect(() => {
    const element = root.current;
    if (element === null || typeof window === 'undefined') return;

    const loaded = loadPosition(name, initial);
    const rect = element.getBoundingClientRect();
    const next = clampPosition(loaded, rect, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    positionRef.current = next;
    setPosition(next);
    if (differs(loaded, next)) savePosition(name, next);
  }, [initial.x, initial.y, name]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    const element = root.current;
    if (element === null) return;

    const rect = element.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const active = drag.current;
    const element = root.current;
    if (active === null || active.pointerId !== event.pointerId || element === null) return;

    const rect = element.getBoundingClientRect();
    const next = clampPosition({
      x: event.clientX - active.offsetX,
      y: event.clientY - active.offsetY,
    }, rect, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    positionRef.current = next;
    setPosition(next);
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const active = drag.current;
    if (active === null || active.pointerId !== event.pointerId) return;

    drag.current = null;
    savePosition(name, positionRef.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      ref={root}
      className={['floating-window', className ?? null].filter((value): value is string => value !== null).join(' ')}
      style={{ left: position.x, top: position.y }}
      aria-label={title}
    >
      <div
        className="floating-window-drag"
        style={{ right: DRAG_STRIP_BUTTONS_WIDTH }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      />
      <Panel
        title={title}
        {...(meta !== undefined ? { meta } : {})}
        {...(onClose !== undefined ? { onClose } : {})}
        {...(actions !== undefined ? { actions } : {})}
        {...(width !== undefined ? { width } : {})}
        {...(footer !== undefined ? { footer } : {})}
      >
        {children}
      </Panel>
    </div>
  );
}
