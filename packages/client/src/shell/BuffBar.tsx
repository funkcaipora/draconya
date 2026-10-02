// A barra de condições ativas sobre o mundo (#348, SV-05/SV-12; kit v3 Hud.jsx).
// Mostra as condições temporárias (haste, cura contínua, escudo mágico, bônus ativo)
// com badges coloridas e tempo restante atualizado a cada segundo.
//
// No MUNDO (#846, OW-23) ela leva também os dois ícones de estado do Tibia — a zona de proteção (o pombo, `PlayerIcon::Pigeon`) e a
// luta (as espadas, `PlayerIcon::Swords`) —, na MESMA fileira de ícones de condição que o Tibia usa: são o mesmo
// tipo de dado, o que o servidor diz sobre o personagem agora (`player-stats.zone` e `inFight`).

import type { ZoneKind } from '@draconya/protocol';
import type { ActiveCondition } from '../state/hud.js';
import { useHudSlice } from '../state/useSlice.js';
import { useElapsedMs } from './Analyzer.js';
import { Badge, type BadgeTone } from './ui/Badge.js';

const CONDITION_BADGE: Record<ActiveCondition['kind'], { tone: BadgeTone; label: string }> = {
  haste: { tone: 'haste', label: 'Haste' },
  'heal-over-time': { tone: 'ice', label: 'Cura contínua' },
  'mana-shield': { tone: 'energy', label: 'Escudo mágico' },
  buff: { tone: 'gold', label: 'Bônus ativo' },
  light: { tone: 'gold', label: 'Luz' },
};

/** Um ícone de estado do mundo: a zona de proteção ou a luta. */
export interface StatusBadge {
  readonly id: 'protection-zone' | 'in-fight';
  readonly tone: BadgeTone;
  readonly label: string;
}

/**
 * Os ícones de estado do mundo, a partir do que o servidor disse (`player-stats.zone` e `inFight`). PURA.
 *
 * - **Zona de proteção** só em `'protection'`: é o `TILESTATE_PROTECTIONZONE` do Canary, e `'no-pvp'` e
 *   `'no-logout'` não acendem ícone nenhum (`canary/src/creatures/players/player.cpp:926-934`).
 * - **Em luta** some dentro da PZ mesmo com `inFight`: o Canary tira as espadas quando o personagem pisa a
 *   zona de proteção (`icons.erase(PlayerIcon::Swords)`, `player.cpp:933`), porque ali a luta não prende ninguém.
 * - `null` — "este servidor não diz" — não acende nada: o ícone só aparece porque o servidor o disse.
 */
export function statusBadgesOf(zone: ZoneKind | null, inFight: boolean | null): StatusBadge[] {
  const badges: StatusBadge[] = [];
  if (zone === 'protection') badges.push({ id: 'protection-zone', tone: 'holy', label: 'Zona de proteção' });
  if (inFight === true && zone !== 'protection') badges.push({ id: 'in-fight', tone: 'blood', label: 'Em luta' });
  return badges;
}

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
  const zone = useHudSlice((state) => state.zone);
  const inFight = useHudSlice((state) => state.inFight);
  const statuses = statusBadgesOf(zone, inFight);
  if (conditions.length === 0 && statuses.length === 0) return null;
  return (
    <div className="buff-bar" aria-label="condições ativas">
      {statuses.map((status) => (
        <Badge key={status.id} tone={status.tone}>{status.label}</Badge>
      ))}
      {conditions.map((condition) => (
        <Pill key={condition.kind} condition={condition} receivedAtMs={receivedAtMs} />
      ))}
    </div>
  );
}
