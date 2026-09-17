// O painel "Skills" da coluna esquerda (RC-04, #317, ADR 0030 decisões 3/5 —
// docs/kit-fidelity-plan.md §4 linha RC-04, achados R2-01/R2-05/R2-06 + os "missed" do
// verificador sobre HP/Mana/Stamina/Level). Sucede `CharacterPanel.tsx` nesta coluna: os mesmos
// seis campos que já chegam por `player-stats` (Experiência, Level, HP, Mana, Capacidade,
// Stamina), no título e na ordem do kit (Hud.jsx:36-38, data.js:18/21), com um `IconButton` ⚙
// que abre o modal de personalização do kit v3 (Modals.jsx:295-301).
//
// `CharacterPanel.tsx` NÃO é apagado por esta issue — fica como está, sem consumidor, até a
// RC-06 (#319) reaproveitar o conteúdo dele na aba "Personagem" do modal de Personagem.
//
// A visibilidade das seis linhas é preferência de TELA (`localStorage`, skills-preference.ts).
// A ORDEM não é editável (kit v3: "a ordem do painel segue a ordem desta lista", Modals.jsx:299)
// — o checkbox liga/desliga, nunca arrasta.

import { useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import { Panel } from './ui/Panel.js';
import { StatRow } from './ui/StatRow.js';
import { IconButton } from './ui/IconButton.js';
import { Modal } from './ui/Modal.js';
import { Checkbox } from './ui/Checkbox.js';
import { Button } from './ui/Button.js';
import {
  SKILL_LABELS, SKILL_ORDER, loadVisibleSkills, saveVisibleSkills, staminaClock,
} from './skills-preference.js';
import type { SkillId } from './skills-preference.js';

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const count = (value: number): string => integer.format(Math.round(value));

/** Os únicos dois tokens de vital que este painel usa hoje — Hit Points e Mana (data.js:18). */
const TONE_BY_ID: Partial<Record<SkillId, string>> = { hp: 'vital-hp', mana: 'vital-mp' };

export function SkillsCustomizeModal({
  open, onClose, visible, onApply,
}: {
  open: boolean;
  onClose: () => void;
  visible: readonly SkillId[];
  onApply: (ids: readonly SkillId[]) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Personalizar skills"
      width={440}
      meta={`${String(visible.length)} de ${String(SKILL_ORDER.length)} visíveis`}
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { onApply(SKILL_ORDER); }}
          >
            Padrão
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="skills-customize-grid">
        {SKILL_ORDER.map((id) => (
          <Checkbox
            key={id}
            checked={visible.includes(id)}
            label={SKILL_LABELS[id]}
            onChange={(checked) => {
              const next = checked
                ? [...visible, id]
                : visible.filter((v) => v !== id);
              onApply(next);
            }}
          />
        ))}
      </div>
      <p className="skills-customize-note">A ordem do painel segue a ordem desta lista.</p>
    </Modal>
  );
}

export interface SkillsPanelProps {
  collapsed?: boolean;
  onToggle?: () => void;
  customizing?: boolean;
}

export function SkillsPanel({
  collapsed: initialCollapsed = false,
  onToggle,
  customizing: initialCustomizing = false,
}: SkillsPanelProps) {
  const xp = useHudSlice((state) => state.xp);
  const level = useHudSlice((state) => state.level);
  const health = useHudSlice((state) => state.health, { throttleMs: 100 });
  const mana = useHudSlice((state) => state.mana, { throttleMs: 100 });
  const capacity = useHudSlice((state) => state.capacity);
  const staminaMs = useHudSlice((state) => state.staminaMs);

  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [visible, setVisible] = useState<readonly SkillId[]>(() => loadVisibleSkills());
  const [customizing, setCustomizing] = useState(initialCustomizing);

  function applyVisible(ids: readonly SkillId[]): void {
    setVisible(ids);
    saveVisibleSkills(ids);
  }

  const values: Record<SkillId, string> = {
    exp: count(xp),
    level: String(level),
    hp: count(health),
    mana: count(mana),
    capacity: `${count(capacity)} oz`,
    stamina: staminaClock(staminaMs),
  };

  const handleToggle = onToggle ?? (() => { setCollapsed((c) => !c); });

  return (
    <>
      <Panel
        dock
        title="Skills"
        collapsed={onToggle ? initialCollapsed : collapsed}
        onToggle={handleToggle}
        actions={
          <IconButton
            title="Personalizar skills"
            onClick={() => { setCustomizing(true); }}
          >
            ⚙
          </IconButton>
        }
      >
        {SKILL_ORDER.filter((id) => visible.includes(id)).map((id) => (
          <StatRow
            key={id}
            label={SKILL_LABELS[id]}
            value={values[id]}
            {...(TONE_BY_ID[id] !== undefined ? { tone: TONE_BY_ID[id] } : {})}
          />
        ))}
      </Panel>
      {customizing && (
        <SkillsCustomizeModal
          open={customizing}
          onClose={() => { setCustomizing(false); }}
          visible={visible}
          onApply={applyVisible}
        />
      )}
    </>
  );
}
