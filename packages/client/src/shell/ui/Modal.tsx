// Modal: scrim + Panel (DS-04, #247). Fecha no ×, no clique fora (scrim) e em Esc.
//
// "Um por vez" é responsabilidade de QUEM ABRE, não deste primitivo: o Shell guarda qual modal
// está aberto numa única fatia de estado (D6; a wiring real é de DS-08 em diante, fora desta
// issue). O Modal aqui não sabe se existe outro modal — ele só desenha o que `open` manda.

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Panel } from './Panel.js';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  meta?: string;
  width?: number;
  height?: number;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Modal({
  open, onClose, title, meta, width = 620, height, footer, className, children,
}: ModalProps) {
  // O ouvinte só existe enquanto o modal está aberto: um modal fechado nunca captura o Esc de
  // outra tela, e dois modais nunca ficam os dois ouvindo ao mesmo tempo.
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-modal-scrim" role="dialog" aria-label={title} onClick={onClose}>
      <div className="ui-modal-dialog" onClick={(event) => { event.stopPropagation(); }}>
        <Panel
          title={title}
          onClose={onClose}
          width={width}
          footer={footer}
          bodyClassName="ui-modal-body"
          className={['ui-panel--modal', className ?? null].filter(Boolean).join(' ')}
          // `exactOptionalPropertyTypes` não deixa passar `undefined` explícito onde a prop é
          // opcional (mesmo padrão de Analyzer.tsx): só entra na chamada quem de fato veio.
          {...(meta !== undefined ? { meta } : {})}
          {...(height !== undefined ? { height } : {})}
        >
          {children}
        </Panel>
      </div>
    </div>
  );
}
