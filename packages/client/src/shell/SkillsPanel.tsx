// O painel Skills é a leitura compacta do personagem, fixa na coluna esquerda. As escolhas de
// linhas são preferência local de tela; os números continuam vindo integralmente do servidor.
//
// SV-10 (#346) acrescenta speed e as skills de combate às seis linhas que já existiam.
// `state.speed` e `state.skills` chegam prontos de `player-stats`/`session-state`
// (`state/apply.ts`); o painel só formata — magic/fist/club/sword/axe/distance mostram o nível e
// passam `percent` ao `StatRow`, que desenha a barra de progresso até o próximo nível. #568 troca
// a linha única "Corpo a Corpo" pelas quatro skills que a #567 separou por tipo de arma.

import { useState } from 'react';
import type { SkillProgress } from '../state/hud.js';
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

/**
 * O nível que a linha mostra: o COM Loyalty (#628), quando o bônus muda o nível — é o que o
 * Canary/Tibia desenha na janela de skills, e o que dano, cura e requisito de runa leem. A
 * barra de progresso continua a do nível BASE (o `percent`), porque é nele que os tries entram.
 */
function shownLevel(skill: SkillProgress): number {
  return skill.loyaltyLevel ?? skill.level;
}

/** A dica da linha quando o Loyalty a mudou: o nível base e quanto o bônus soma. */
function loyaltyHint(skill: SkillProgress): string | undefined {
  if (skill.loyaltyLevel === undefined || skill.loyaltyLevel <= skill.level) return undefined;
  return 'Base ' + String(skill.level) + ' + ' + String(skill.loyaltyLevel - skill.level) + ' de Loyalty';
}

const TONE_BY_ID: Partial<Record<SkillId, string>> = {
  hp: 'vital-hp',
  mana: 'vital-mp',
  magic: 'vital-mp',
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
  const speed = useHudSlice((state) => state.speed);
  const skills = useHudSlice((state) => state.skills);
  const loyaltyBonusPercent = useHudSlice((state) => state.loyaltyBonusPercent);
  const soul = useHudSlice((state) => state.soul);
  const soulMax = useHudSlice((state) => state.soulMax);

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
    speed: count(speed),
    stamina: staminaClock(staminaMs),
    // `0/0` é "sem vocação escolhida" — a mesma degradação de `vocationId: null` no HUD.
    soul: count(soul) + '/' + count(soulMax),
    magic: String(shownLevel(skills.magic)),
    fist: String(shownLevel(skills.fist)),
    club: String(shownLevel(skills.club)),
    sword: String(shownLevel(skills.sword)),
    axe: String(shownLevel(skills.axe)),
    distance: String(shownLevel(skills.distance)),
  };

  // Só as skills de combate têm nível base para explicar quando o Loyalty a mudou.
  const hints: Partial<Record<SkillId, string | undefined>> = {
    magic: loyaltyHint(skills.magic),
    fist: loyaltyHint(skills.fist),
    club: loyaltyHint(skills.club),
    sword: loyaltyHint(skills.sword),
    axe: loyaltyHint(skills.axe),
    distance: loyaltyHint(skills.distance),
  };

  // Só as skills de combate desenham a barra — as demais linhas não têm "próximo nível".
  const percents: Partial<Record<SkillId, number>> = {
    magic: skills.magic.percent,
    fist: skills.fist.percent,
    club: skills.club.percent,
    sword: skills.sword.percent,
    axe: skills.axe.percent,
    distance: skills.distance.percent,
  };

  return (
    <>
      <Panel
        dock
        title="Skills"
        // O bônus de Loyalty da conta (#628): fixado no login, constante pela sessão.
        {...(loyaltyBonusPercent > 0 ? { meta: 'Loyalty +' + String(loyaltyBonusPercent) + '%' } : {})}
        collapsed={collapsed}
        onToggle={() => { setCollapsed((current) => !current); }}
        actions={<IconButton title="Personalizar skills" onClick={() => { setCustomizing(true); }}>⚙</IconButton>}
      >
        {SKILL_ORDER.filter((id) => visible.includes(id)).map((id) => {
          const tone = TONE_BY_ID[id];
          const percent = percents[id];
          const hint = hints[id];
          return (
            <StatRow
              key={id}
              label={SKILL_LABELS[id]}
              value={values[id]}
              {...(tone !== undefined ? { tone } : {})}
              {...(percent !== undefined ? { percent } : {})}
              {...(hint !== undefined ? { title: hint } : {})}
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
