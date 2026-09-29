// Panel: a moldura de toda janela do HUD (DS-04, #247) — fio dourado no topo, barra de título
// em mono maiúsculo, corpo rolável e rodapé opcional. É a base de toda seção fixa (dock) e de
// todo Modal, que a usa por dentro (ver Modal.tsx).
//
// `collapsed` é CONTROLADO pelo dono, nunca um estado interno (diferente do protótipo do
// handoff): um botão da barra do topo minimiza várias seções de uma vez — "Inventário" já
// minimiza Set + Mochila + Bolsa juntas (EquipmentPanel.tsx, ContainerWindow.tsx desde #161) —,
// o que um estado local de React dentro do Panel impediria. Onde a store guarda esse booleano é
// decisão de quem monta a tela (fora desta issue).

import type { ReactNode } from 'react';
import { IconButton } from './IconButton.js';

export interface PanelProps {
  /** Título maiúsculo em mono na barra de título. */
  title: string;
  /** Texto pequeno à direita na barra de título (ex.: "salvando…"). */
  meta?: string;
  /** Presente = desenha o botão fechar (×), e ele o chama. */
  onClose?: () => void;
  /** Estado de minimizado, controlado pelo dono. `undefined` = sem botão de minimizar. */
  collapsed?: boolean;
  /** Chamado ao clicar no botão de minimizar/expandir. */
  onToggle?: () => void;
  actions?: ReactNode;
  width?: number | string;
  height?: number | string;
  footer?: ReactNode;
  /** variante encaixada na coluna: sem borda arredondada nem sombra flutuante */
  dock?: boolean;
  className?: string;
  /** classe extra no corpo rolável — usada pelo Modal para o padding de 11px */
  bodyClassName?: string;
  children?: ReactNode;
}

export function Panel({
  title, meta, onClose, collapsed, onToggle, actions, width, height, footer, dock,
  className, bodyClassName, children,
}: PanelProps) {
  const rootClass = [
    'ui-panel',
    dock ? 'ui-panel--dock' : null,
    footer ? 'ui-panel--footer' : null,
    collapsed ? 'ui-panel--collapsed' : null,
    className ?? null,
  ].filter(Boolean).join(' ');
  const bodyClass = ['ui-panel-body', bodyClassName ?? null].filter(Boolean).join(' ');

  return (
    <section className={rootClass} style={{ width, height: collapsed ? undefined : height }}>
      <i className="ui-panel-hairline" />
      <header className="ui-panel-header">
        <strong className="ui-panel-title">{title}</strong>
        {meta !== undefined && <span className="ui-panel-meta">{meta}</span>}
        <div className="ui-panel-actions">
          {actions}
          {onToggle !== undefined && (
            <IconButton title={collapsed ? 'expandir' : 'minimizar'} onClick={onToggle}>–</IconButton>
          )}
          {onClose !== undefined && <IconButton title="fechar" onClick={onClose}>×</IconButton>}
        </div>
      </header>
      {collapsed !== true && <div className={bodyClass}>{children}</div>}
      {collapsed !== true && footer !== undefined && <footer className="ui-panel-footer">{footer}</footer>}
    </section>
  );
}
