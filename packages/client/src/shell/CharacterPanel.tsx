// O painel fixo "Personagem" (DS-13, ADR 0029 D6): level, XP, vida, mana, capacidade e stamina,
// numa linha por estatística, no padrão StatRow do handoff. Fixo na coluna esquerda, minimizável
// pelo próprio cabeçalho do Panel (D6) — não passa por `open`/TopBar, porque não há ícone
// "Personagem" na barra do topo (§3 do plano: os seis ícones são Hunts, Bot, Inventário,
// Analisador, Cyclopedia, Chat).
//
// Só o que chega (D8): os seis campos vêm inteiros em `player-stats`, sem opcional — não há
// "—" aqui, ao contrário do Analisador. Sem barra de %: a curva de XP para o próximo level não
// trafega, e SkillsPanel do handoff (que TEM barra) é referência de FORMA, não de conteúdo —
// skills, Magic Level, Speed e Soul não têm linha aqui (M15 SV-04/SV-10, ou nunca, para Soul).
//
// `Panel` (DS-04) não gerencia o próprio minimizado internamente — `collapsed` é sempre
// CONTROLADO pelo dono (ver o comentário de `ui/Panel.tsx`). Como não há `open.character` na
// barra do topo para controlar isso, o painel guarda o próprio `collapsed` num `useState` local
// — o mesmo padrão que `BattlePanel.tsx` já usa por não ter ícone na barra (DT-02 de lá).

import { useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import { Panel } from './ui/Panel.js';
import { StatRow } from './ui/StatRow.js';

// Cada arquivo do shell formata número com o seu próprio Intl.NumberFormat (TopBar.tsx,
// Analyzer.tsx, EquipmentPanel.tsx) — não há módulo compartilhado ainda (DT-01).
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const count = (value: number): string => integer.format(Math.round(value));

/** `2 h 13 min`, o mesmo formato de Analyzer.tsx (duplicado aqui de propósito — DT-01). */
function duration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return `${Math.floor(ms / 1_000)} s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

export function CharacterPanel() {
  const xp = useHudSlice((state) => state.xp);
  const level = useHudSlice((state) => state.level);
  // Mesmo throttle de Vitals.tsx: em hunt, HP e mana mudam dezenas de vezes por segundo.
  const health = useHudSlice((state) => state.health, { throttleMs: 100 });
  const maxHealth = useHudSlice((state) => state.maxHealth);
  const mana = useHudSlice((state) => state.mana, { throttleMs: 100 });
  const maxMana = useHudSlice((state) => state.maxMana);
  // TOTAL, não usado/livre — esse par é `inventory.capacity`, já mostrado no EquipmentPanel.
  const capacity = useHudSlice((state) => state.capacity);
  const staminaMs = useHudSlice((state) => state.staminaMs);

  const [collapsed, setCollapsed] = useState(false);

  return (
    <Panel
      dock
      title="PERSONAGEM"
      collapsed={collapsed}
      onToggle={() => { setCollapsed((current) => !current); }}
    >
      <StatRow label="Experiência" value={count(xp)} />
      <StatRow label="Level" value={String(level)} />
      <StatRow label="HP" value={`${count(health)} / ${count(maxHealth)}`} />
      <StatRow label="Mana" value={`${count(mana)} / ${count(maxMana)}`} />
      <StatRow label="Capacidade" value={`${count(capacity)} oz`} />
      <StatRow label="Stamina" value={duration(staminaMs)} />
    </Panel>
  );
}
