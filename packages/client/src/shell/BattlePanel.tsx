// O painel Batalha (#254, DS-11; ADR 0029 D3/D4/D6): quem está na tela agora, fora o próprio
// personagem e os companheiros de party — que já têm painel próprio (`PartyMembers.tsx`).
//
// Segue o padrão que `PartyMembers.tsx` já usa (ADR 0007): `world` não tem `subscribe` — um
// `creature-move` não pode causar render de React —, então a lista é amostrada por INTERVALO,
// no mesmo `HEALTH_POLL_MS` de 1 s. `targetId` chega em `target-changed` (#470) e é limpo a
// cada `session-state` (#341, SV-05): a criatura que o bot está batendo ganha a moldura
// `.battle-row-selected` (#348, SV-12). Desde #471 a linha é clicável e divide o MESMO
// `hud.targetId` do Viewport: o clique passa pelo `targetTracker` (otimista, toggle no mesmo
// alvo, reconciliação por `seq`).
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
import { sendIntent } from '../net/current.js';
import { targetTracker } from '../state/target.js';
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
 *
 * **Só o ANDAR do próprio personagem** (#527). Numa hunt privada não existe AOI (FUN-33) — o
 * hospedeiro manda TODOS os monstros vivos da instância pelo `session-state`/`creature-appear`,
 * dos três andares da Darashia Dragon Lair inclusive, porque o mundo espacial precisa deles para
 * desenhar o que se vê através de escada e vão (ADR 0034). A lista de batalha não é o mundo: no
 * Tibia a battle list só mostra quem está no MESMO andar (o monstro de outro andar não é um alvo
 * possível), e sem este filtro ela mostrava dragões de z11/z12 para quem estava em z10 — e o
 * bot conta "quantos ao alcance" (`countTargets`, `packages/sim/src/targeting.ts`) já filtrando
 * por andar havia tempo; só a APRESENTAÇÃO estava errada. `world.selfId` ausente (antes do
 * `session-state` chegar) não filtra nada — não há andar próprio para comparar ainda.
 */
export function battleRows(partyNames: ReadonlySet<string>): BattleRow[] {
  const ownFloor = world.selfId === null ? undefined : world.creatures.get(world.selfId)?.position.z;
  const rows: BattleRow[] = [];
  for (const creature of world.creatures.values()) {
    if (creature.id === world.selfId) continue;
    if (partyNames.has(creature.name)) continue;
    if (ownFloor !== undefined && creature.position.z !== ownFloor) continue;
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
  // O alvo do bot (SV-12): `null` quando não há ninguém sendo batido agora.
  const targetId = useHudSlice((state) => state.targetId);
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
              <li key={row.id}>
                <button
                  type="button"
                  className={row.id === targetId ? 'battle-row battle-row-selected' : 'battle-row'}
                  onClick={() => {
                    // INTENÇÃO (invariante 4): o servidor confere se o id é alvo válido. O
                    // rastreador compartilha o MESMO `hud.targetId` do Viewport (#471) e o
                    // segundo clique no alvo atual cancela.
                    targetTracker.selectTarget(row.id, sendIntent);
                  }}
                >
                  <span className="battle-icon" aria-hidden="true" />
                  <span className="battle-name">{row.name}</span>
                  <span className="battle-percent">{`${String(row.percent)}%`}</span>
                  <span className={`battle-bar battle-bar-${battleTone(row.percent)}`} aria-label={`HP de ${row.name}`}>
                    <span className="battle-bar-fill" style={{ width: `${String(row.percent)}%` }} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </Panel>
  );
}

