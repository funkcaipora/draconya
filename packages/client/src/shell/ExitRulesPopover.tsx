// "Sair sozinho quando…" (#260, DS-17) — o popover de 262 px no chevron » da pill "Sair da
// caçada" (HuntActions.tsx, criada por #259/DS-16). Três checkboxes, na ordem do kit (#309,
// R4-11) — `out-of-gold`, `party-member-lost`, `hp-below` (com o percentual editável, exceção
// mantida — R4-13/R5-06). A quarta linha do protótipo (capacidade cheia) NÃO aparece: não
// existe no schema (M15, SV-06).
//
// Cada mudança grava `draft.exit` e agenda `bot-config` com o MESMO debounce do interruptor de
// regra (#162, `bot/store.ts`): ligar é ligar, sem botão "Salvar" — o servidor grava a
// configuração inteira de qualquer jeito (ADR 0021). Fechado, um resumo aparece no lugar do
// popover.
//
// AUTOCONTIDO de propósito (RF-09): quem usa este componente (`HuntActions.tsx`) só precisa
// renderizar `<ExitRulesPopover />` logo depois do botão "Sair da caçada" — o estado de
// aberto/fechado, a leitura da store e o posicionamento (`position: relative` na própria raiz)
// são todos internos.

import { useState } from 'react';
import type { BotExitRule } from '@draconya/content';
import { bot, setExitHpBelowPercent, setExitRule } from '../bot/store.js';
import { EXIT_RULE_KINDS, exitRuleLabel, exitRulesSummary, findExitRule } from '../bot/exit-rules.js';
import { useStoreSlice } from '../state/useSlice.js';

function clampPercent(raw: number): number {
  if (Number.isNaN(raw)) return 1;
  return Math.min(100, Math.max(1, Math.round(raw)));
}

/**
 * As três linhas, sem chevron nem resumo — exportado à parte para o teste prender a estrutura
 * (rótulo, checkbox, campo de percentual) sem precisar simular um clique no chevron.
 */
export function ExitRulesList({ rules }: { rules: readonly BotExitRule[] }) {
  return (
    <div className="exit-rules-popover" role="dialog" aria-label="Sair sozinho quando…">
      <i className="exit-rules-hairline" aria-hidden="true" />
      <strong className="exit-rules-title">Sair sozinho quando…</strong>
      {EXIT_RULE_KINDS.map((kind) => {
        const rule = findExitRule(rules, kind);
        const checked = rule !== null;
        return (
          <label key={kind} className="exit-rule-row">
            <span className="exit-rule-label">
              {exitRuleLabel(kind, rule)}
              {kind === 'hp-below' && checked && rule.kind === 'hp-below' && (
                <input
                  type="number"
                  className="exit-rule-percent"
                  aria-label="percentual de HP"
                  min={1}
                  max={100}
                  value={rule.percent}
                  onClick={(event) => { event.stopPropagation(); }}
                  onChange={(event) => { setExitHpBelowPercent(clampPercent(Number(event.target.value))); }}
                />
              )}
            </span>
            <input
              type="checkbox"
              aria-label={exitRuleLabel(kind, rule)}
              checked={checked}
              onChange={(event) => { setExitRule(kind, event.target.checked); }}
            />
          </label>
        );
      })}
      <p className="exit-rules-note">A mesma saída de cinco segundos, iniciada para você.</p>
    </div>
  );
}

export function ExitRulesPopover() {
  const [open, setOpen] = useState(false);
  const rules = useStoreSlice(bot, (state) => state.draft.exit);
  const summary = exitRulesSummary(rules);

  return (
    <span className="exit-rules-anchor">
      <button
        type="button"
        className="exit-rules-toggle"
        aria-label={open ? 'fechar regras de saída' : 'regras de saída'}
        aria-expanded={open}
        onClick={() => { setOpen(!open); }}
      >»</button>
      {open && <ExitRulesList rules={rules} />}
      {!open && summary !== null && <span className="exit-rules-summary">{`Saindo sozinho: ${summary}`}</span>}
    </span>
  );
}
