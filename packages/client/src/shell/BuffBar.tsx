// A barra de condições ativas sobre o mundo (#348, SV-05/SV-12; kit v3 Hud.jsx).
// Mostra as condições temporárias (haste, cura contínua, escudo mágico, bônus ativo)
// com badges coloridas e tempo restante atualizado a cada segundo.

import type { ActiveCondition } from '../state/hud.js';
import { useHudSlice } from '../state/useSlice.js';
import { useElapsedMs } from './Analyzer.js';
import { Badge, type BadgeTone } from './ui/Badge.js';

const CONDITION_BADGE: Record<ActiveCondition['kind'], { tone: BadgeTone; label: string }> = {
  haste: { tone: 'haste', label: 'Haste' },
  'heal-over-time': { tone: 'ice', label: 'Cura contínua' },
  'mana-shield': { tone: 'energy', label: 'Escudo mágico' },
  buff: { tone: 'gold', label: 'Bônus ativo' },
};

function remainingLabel(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${seconds.toString().padStart(2, '0')}`;
}

function Pill({ condition, receivedAtMs }: { condition: ActiveCondition; receivedAtMs: number }) {
  const elapsed = useElapsedMs(0, receivedAtMs, true);
  const remaining = Math.max(0, condition.remainingMs - elapsed);
  if (remaining <= 0) return null;
  const { tone, label } = CONDITION_BADGE[condition.kind];
  return <Badge tone={tone}>{`${label} ${remainingLabel(remaining)}`}</Badge>;
}

export function BuffBar() {
  const conditions = useHudSlice((state) => state.conditions);
  const receivedAtMs = useHudSlice((state) => state.conditionsReceivedAtMs);
  if (conditions.length === 0) return null;
  return (
    <div className="buff-bar" aria-label="condições ativas">
      {conditions.map((condition) => (
        <Pill key={condition.kind} condition={condition} receivedAtMs={receivedAtMs} />
      ))}
    </div>
  );
}
