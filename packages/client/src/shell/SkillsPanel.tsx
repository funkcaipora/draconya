// O painel Skills é a leitura compacta do personagem, fixa na coluna esquerda. As escolhas de
// linhas são preferência local de tela; os números continuam vindo integralmente do servidor.

import { useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import {
  SKILL_LABELS,
  SKILL_ORDER,
  loadVisibleSkills,
  saveVisibleSkills,
  staminaClock,
} from './skills-preference.js';
import type { SkillId } from './skills-preference.js';
import { Button } from './ui/Button.js';
import { Checkbox } from './ui/Checkbox.js';
import { IconButton } from './ui/IconButton.js';
import { Modal } from './ui/Modal.js';
import { Panel } from './ui/Panel.js';
import { StatRow } from './ui/StatRow.js';

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

function count(value: number): string {
  return integer.format(Math.round(value));
}

const TONE_BY_ID: Partial<Record<SkillId, string>> = {
  hp: 'vital-hp',
  mana: 'vital-mp',
};

interface SkillsCustomizeModalProps {
  selected: readonly SkillId[];
  onChange: (ids: readonly SkillId[]) => void;
  onClose: () => void;
}

function SkillsCustomizeModal({ selected, onChange, onClose }: SkillsCustomizeModalProps) {
  function toggle(id: SkillId): void {
    onChange(selected.includes(id) ? selected.filter((selectedId) => selectedId !== id) : [...selected, id]);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Personalizar skills"
      meta={String(selected.length) + ' de ' + String(SKILL_ORDER.length) + ' visíveis'}
      width={420}
      footer={(
        <>
          <Button variant="secondary" size="sm" onClick={() => { onChange(SKILL_ORDER); }}>Padrão</Button>
          <Button size="sm" onClick={onClose}>Salvar</Button>
        </>
      )}
    >
      <div className="skills-customize-grid">
        {SKILL_ORDER.map((id) => (
          <Checkbox
            key={id}
            checked={selected.includes(id)}
            onChange={() => { toggle(id); }}
            label={SKILL_LABELS[id]}
          />
        ))}
      </div>
      <p className="skills-customize-note">A ordem das linhas segue a ordem do painel.</p>
    </Modal>
  );
}

export function SkillsPanel() {
  const xp = useHudSlice((state) => state.xp);
  const level = useHudSlice((state) => state.level);
  // HP e mana podem mudar dezenas de vezes por segundo durante uma hunt.
  const health = useHudSlice((state) => state.health, { throttleMs: 100 });
  const mana = useHudSlice((state) => state.mana, { throttleMs: 100 });
  const capacity = useHudSlice((state) => state.capacity);
  const staminaMs = useHudSlice((state) => state.staminaMs);

  const [collapsed, setCollapsed] = useState(false);
  const [visible, setVisible] = useState<readonly SkillId[]>(() => loadVisibleSkills());
  const [customizing, setCustomizing] = useState(false);

  function applyVisible(ids: readonly SkillId[]): void {
    setVisible(ids);
    saveVisibleSkills(ids);
  }

  const values: Record<SkillId, string> = {
    exp: count(xp),
    level: String(level),
    hp: count(health),
    mana: count(mana),
    capacity: count(capacity) + ' oz',
    stamina: staminaClock(staminaMs),
  };

  return (
    <>
      <Panel
        dock
        title="Skills"
        collapsed={collapsed}
        onToggle={() => { setCollapsed((current) => !current); }}
        actions={<IconButton title="Personalizar skills" onClick={() => { setCustomizing(true); }}>⚙</IconButton>}
      >
        {SKILL_ORDER.filter((id) => visible.includes(id)).map((id) => {
          const tone = TONE_BY_ID[id];
          return (
            <StatRow
              key={id}
              label={SKILL_LABELS[id]}
              value={values[id]}
              {...(tone !== undefined ? { tone } : {})}
            />
          );
        })}
      </Panel>
      {/* Fica fora do corpo minimizável: a engrenagem do cabeçalho também abre quando Skills está fechado. */}
      {customizing && (
        <SkillsCustomizeModal
          selected={visible}
          onChange={applyVisible}
          onClose={() => { setCustomizing(false); }}
        />
      )}
    </>
  );
}
