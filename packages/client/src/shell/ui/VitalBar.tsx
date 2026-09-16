// VitalBar: a barra horizontal de HP/mana/XP (DS-04, #247). Substitui Vitals.tsx/.bar de hoje
// (shell.css), cuja skin de pedra do pacote foi aposentada em #250 (ADR 0029 D4). O
// preenchimento usa --vital-<kind> dos tokens — cor sólida, não o gradiente hexadecimal do
// protótipo (ADR 0029 D1: cor duplicada fora do token diverge no primeiro ajuste de paleta).
//
// `kind` não inclui "soul": Soul "não existe em camada nenhuma" no Draconya
// (`docs/design-system-plan.md` §4), diferente do protótipo do handoff, que tem um quinto
// `kind` ("soul") sem uso real — dado que o servidor nunca manda não ganha suporte aqui.

import type { CSSProperties } from 'react';

export interface VitalBarProps {
  kind: 'hp' | 'mp' | 'exp' | 'stamina';
  value?: number;
  max?: number;
  /** 0–100; sobrepõe value/max e mostra "NN%" */
  percent?: number;
  /** rótulo à esquerda (HP / MP / LV 200) */
  label?: string;
  height?: number;
  showText?: boolean;
  className?: string;
}

export function VitalBar({
  kind, value, max, percent, label, height = 15, showText = true, className,
}: VitalBarProps) {
  const pct = percent ?? (value !== undefined && max !== undefined && max > 0
    ? Math.max(0, Math.min(100, (value / max) * 100))
    : 0);
  const text = percent !== undefined
    ? `${String(Math.round(pct))}%`
    : (value !== undefined && max !== undefined ? `${value.toLocaleString('pt-BR')} / ${max.toLocaleString('pt-BR')}` : '');

  const rootClass = ['ui-vital-bar', label !== undefined ? 'ui-vital-bar--labeled' : null, className ?? null]
    .filter(Boolean).join(' ');

  return (
    <div className={rootClass}>
      {label !== undefined && <span className="ui-vital-label">{label}</span>}
      <div className="ui-vital-track" style={{ height } as CSSProperties}>
        <i className="ui-vital-fill" data-kind={kind} style={{ width: `${String(pct)}%` }} />
        {showText && <strong className="ui-vital-text">{text}</strong>}
      </div>
    </div>
  );
}
