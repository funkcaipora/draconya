// StatRow: uma linha rótulo/valor com barra de progresso opcional (DS-04, #247) — o
// componente da futura janela Skills (SV-10) e do painel Personagem (DS-13).
//
// `tone` é o NOME de um token (ex. "vital-hp", "danger"), escolhido em tempo de execução pelo
// consumidor — uma classe CSS por token possível seria uma lista sem fim. A indireção é a mesma
// que EquipmentPanel.tsx já usa para --slot-icon: uma custom property por instância.

import type { CSSProperties } from 'react';

export interface StatRowProps {
  label: string;
  value: string | number;
  /** progresso até o próximo nível, 0–100; desenha uma barra de 3px sob a linha */
  percent?: number;
  /** nome do token, ex. "vital-hp", "text-gold", "danger" — sem o "--" */
  tone?: string;
  onRemove?: () => void;
  bar?: boolean;
  className?: string;
}

export function StatRow({ label, value, percent, tone, onRemove, bar = true, className }: StatRowProps) {
  const toneStyle = tone !== undefined ? ({ '--stat-tone': `var(--${tone})` } as CSSProperties) : undefined;
  const rootClass = ['ui-stat-row', onRemove !== undefined ? 'ui-stat-row--removable' : null, className ?? null]
    .filter(Boolean).join(' ');

  return (
    <div className={rootClass} style={toneStyle}>
      <span>{label}</span>
      <b className="ui-stat-row-value">{value}</b>
      {onRemove !== undefined && (
        <button type="button" className="ui-stat-row-remove" onClick={onRemove} title="remover">×</button>
      )}
      {bar && percent !== undefined && (
        <i className="ui-stat-row-bar">
          <i className="ui-stat-row-bar-fill" style={{ width: `${String(percent)}%` }} />
        </i>
      )}
    </div>
  );
}
