// O modal expandido do Analisador (#315, R8-25 — kit v3, Modals.jsx:302-307). As DEZ linhas de
// `DR.analyzer.rows` do kit (data.js:68), com os NÚMEROS REAIS de `Aggregates` (nenhum literal
// de data.js entra aqui) — Tempo/Loot/Supplies/Maior golpe/Maior magia sem taxa, XP/Gold/
// Gastos/Saldo/Mortos com `/h` na terceira coluna, exatamente como o kit lista.
//
// "Mortes" (o `deaths > 0` condicional de SessionBox) FICA DE FORA deste modal, de propósito:
// o kit não tem essa linha em `analyzer.rows` (só em `analyzerLive.sess`, que é outro formato).
// A janela continua mostrando "Mortes" quando houver, sem mudança (DT-04).

import { Modal } from './ui/Modal.js';
import type { Aggregates } from '../state/hud.js';
import { count, duration, gold, goldRate, optionalCount, rate } from './analyzer-format.js';

export interface AnalyzerModalProps {
  open: boolean;
  onClose: () => void;
  aggregates: Aggregates;
  elapsedMs: number;
}

interface ModalRow {
  label: string;
  value: string;
  /** "" quando o kit não desenha taxa nesta linha (Tempo, Loot, Supplies, os dois "Maior"). */
  rate: string;
}

function rowsOf(aggregates: Aggregates, elapsedMs: number): readonly ModalRow[] {
  const balance = aggregates.goldGained - aggregates.goldSpent;
  return [
    { label: 'Tempo', value: duration(elapsedMs), rate: '' },
    { label: 'XP', value: count(aggregates.xpGained), rate: rate(aggregates.xpGained, elapsedMs) },
    { label: 'Gold', value: gold(aggregates.goldGained), rate: goldRate(aggregates.goldGained, elapsedMs) },
    { label: 'Gastos', value: gold(aggregates.goldSpent), rate: goldRate(aggregates.goldSpent, elapsedMs) },
    { label: 'Saldo', value: gold(balance), rate: goldRate(balance, elapsedMs) },
    { label: 'Mortos', value: count(aggregates.kills), rate: rate(aggregates.kills, elapsedMs) },
    { label: 'Loot', value: optionalCount(aggregates.itemsLooted), rate: '' },
    { label: 'Supplies', value: optionalCount(aggregates.suppliesUsed), rate: '' },
    { label: 'Maior golpe', value: optionalCount(aggregates.bestBasicHit), rate: '' },
    { label: 'Maior magia', value: optionalCount(aggregates.bestSpellHit), rate: '' },
  ];
}

export function AnalyzerModal({ open, onClose, aggregates, elapsedMs }: AnalyzerModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Analisador de caçada" meta="sessão ao vivo" width={460}>
      <div className="analyzer-modal-box">
        {rowsOf(aggregates, elapsedMs).map((row) => (
          <div key={row.label} className="analyzer-modal-row">
            <span>{row.label}</span>
            {/* "Saldo" no tom --ok, como o kit (Modals.jsx:305, `k === "Saldo" ? "var(--ok)" : ...`) */}
            <b className={row.label === 'Saldo' ? 'analyzer-modal-value-ok' : undefined}>{row.value}</b>
            <i>{row.rate}</i>
          </div>
        ))}
      </div>
    </Modal>
  );
}
