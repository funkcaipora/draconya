// O painel Batalha (#254, DS-11; ADR 0029 D3/D4/D6): quem está na tela agora, fora o próprio
// personagem e os companheiros de party — que já têm painel próprio (`PartyMembers.tsx`).
//
// Segue o padrão que `PartyMembers.tsx` já usa (ADR 0007): `world` não tem `subscribe` — um
// `creature-move` não pode causar render de React —, então a lista é amostrada por INTERVALO,
// no mesmo `HEALTH_POLL_MS` de 1 s. Sem moldura de alvo: `targetId` não trafega ainda (M15,
// SV-05), e nenhuma linha é clicável nesta issue.
//
// Não existe, no protocolo de hoje, um campo que diga "isto é um monstro" — `creature-appear`
// não carrega tipo, e `catalogue.monsters` só tem `id`/`name` (packages/protocol/src/types.ts).
// A lista é por EXCLUSÃO: o próprio personagem (`world.selfId`) e quem está na party (por
// NOME, a mesma amarração que `PartyMembers.tsx` já usa para o caminho contrário). Um jogador
// de fora da party, visível na Cidade — que é um shard COMPARTILHADO (docs/product/city.md) —
// aparece aqui como se fosse uma criatura de batalha: é um limite aceito e registrado na spec
// da issue (§7 e §12), não um descuido. Corrigi-lo pede um campo novo no protocolo, fora do
// escopo client-only do M14.

import { useEffect, useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import { world } from '../state/world.js';
import { HEALTH_POLL_MS } from './PartyMembers.js';
import { Panel } from './ui/Panel.js';
import { IconButton } from './ui/IconButton.js';

export interface BattleRow {
  readonly id: number;
  readonly name: string;
  readonly percent: number;
}

/**
 * Verde acima de 60 %, amarelo acima de 30 %, vermelho abaixo — as três faixas do handoff
 * (`ui_kits/draconya/Hud.jsx`, função `BattlePanel`, na spec da issue).
 * NÃO é `world/health.ts::healthColor` — aquela é a tabela de CINCO faixas em hex do Pixi, para
 * o canvas; esta é a de três, em CSS, para o HUD (DT-04).
 */
export function battleTone(percent: number): 'ok' | 'warn' | 'danger' {
  if (percent > 60) return 'ok';
  if (percent > 30) return 'warn';
  return 'danger';
}

/**
 * As criaturas visíveis, fora o próprio personagem e a party (DT-01). `world.creatures` é lido
 * DIRETO (ADR 0007): esta função não assina nada, e quem decide quando chamá-la de novo é o
 * `setInterval` de `BattlePanel`.
 */
export function battleRows(partyNames: ReadonlySet<string>): BattleRow[] {
  const rows: BattleRow[] = [];
  for (const creature of world.creatures.values()) {
    if (creature.id === world.selfId) continue;
    if (partyNames.has(creature.name)) continue;
    const percent = creature.maxHealth <= 0 || creature.health <= 0
      ? 0
      : Math.max(0, Math.min(100, Math.round((creature.health / creature.maxHealth) * 100)));
    rows.push({ id: creature.id, name: creature.name, percent });
  }
  return rows;
}

/** As duas ordens do botão "Ordenar" (R7-05, DT-01): 'default' preserva a ordem de chegada de
 * `battleRows` (a mesma de hoje); 'hp-asc' põe quem está mais perto de morrer primeiro. */
export type BattleSortMode = 'default' | 'hp-asc';

/**
 * Pura, sem `world` nem estado: só reordena a lista que `battleRows` já montou. É apresentação
 * — nenhuma intenção nova ao servidor, nenhum dado que o servidor não tenha mandado (invariante
 * 4 intocado). Exportada para o teste unitário cobrir as duas ordens sem montar HTML.
 */
export function sortBattleRows(rows: readonly BattleRow[], mode: BattleSortMode): BattleRow[] {
  if (mode === 'default') return [...rows];
  return [...rows].sort((a, b) => a.percent - b.percent);
}

export function BattlePanel() {
  const partyView = useHudSlice((state) => state.party);
  // Minimiza SOZINHO (DT-02): não passa pelo `open`/`toggle` do Shell, porque a barra do topo
  // (docs/design-system-plan.md §3) não tem um sétimo ícone para Batalha. É o mesmo desenho que
  // o primitivo `Panel` de DS-04 vai ter por dentro quando chegar a esta seção.
  const [collapsed, setCollapsed] = useState(false);
  const [sortMode, setSortMode] = useState<BattleSortMode>('default');
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { tick((n) => n + 1); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); };
  }, []);

  const partyNames = new Set(partyView?.members.map((member) => member.name) ?? []);
  const rows = sortBattleRows(battleRows(partyNames), sortMode);

  return (
    <Panel
      dock
      title={`Batalha · ${String(rows.length)}`}
      className="battle-panel"
      collapsed={collapsed}
      onToggle={() => { setCollapsed((c) => !c); }}
      actions={(
        <IconButton
          title="Ordenar"
          active={sortMode === 'hp-asc'}
          onClick={() => { setSortMode((mode) => (mode === 'default' ? 'hp-asc' : 'default')); }}
        >
          ↕
        </IconButton>
      )}
    >
      {rows.length === 0
        ? <p className="quiet">Nenhuma criatura à vista.</p>
        : (
          <ul className="battle-list">
            {rows.map((row) => (
              <li key={row.id} className="battle-row">
                <span className="battle-icon" aria-hidden="true" />
                <span className="battle-name">{row.name}</span>
                <span className="battle-percent">{`${String(row.percent)}%`}</span>
                <span className={`battle-bar battle-bar-${battleTone(row.percent)}`} aria-label={`HP de ${row.name}`}>
                  <span className="battle-bar-fill" style={{ width: `${String(row.percent)}%` }} />
                </span>
              </li>
            ))}
          </ul>
        )}
    </Panel>
  );
}

