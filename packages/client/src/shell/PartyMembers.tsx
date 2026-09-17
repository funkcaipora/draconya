// Os companheiros durante a hunt (#197, #318): nome, HP % e quem lidera em moldura Panel dock
// com rodapé de ação ("Sair da party") e aviso de consenso. Aparece no lugar da formação assim
// que a sessão é uma party.
//
// O HP vem de dois lugares: do `party-state` (attach e mudança de composição) e, no meio, do
// `creature-health` que o mundo já recebe de cada um — a lista de criaturas tem o nome, e é
// por ele que se casa. Lido num intervalo curto, e não por assinatura: o mundo é um objeto
// mutado no lugar (ADR 0007), e o painel só existe em party.
//
// O modo (`split`/`shared`) aparece como TEXTO (DS-14, `docs/design-system-plan.md` §4): os
// interruptores "Rateio de custos" e "Dividir loot" do handoff não entram — o modo é FIXADO na
// proposta (ADR 0027 decisão 5), e não há nada para o jogador trocar aqui.

import { useEffect, useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import { world } from '../state/world.js';
import { Panel } from './ui/Panel.js';
import { VitalBar } from './ui/VitalBar.js';
import { Button } from './ui/Button.js';
import { partyActions } from '../party/store.js';

export const HEALTH_POLL_MS = 1_000;

export function vocationAbbreviation(name: string): string {
  return name.charAt(0).toUpperCase();
}

/**
 * Duplicado de propósito, e não importado de `PartyPanel.tsx` — a formação, que esta issue NÃO
 * toca (DS-16 é quem redesenha a formação, dentro do modal de caçada). Um módulo só para duas
 * entradas acoplaria dois arquivos que precisam poder mudar em issues diferentes sem se tocar.
 */
const MODE_TEXT: Record<'split' | 'shared', string> = { split: 'Dividido', shared: 'Compartilhado' };

function percentFromWorld(name: string): number | null {
  for (const creature of world.creatures.values()) {
    if (creature.name !== name || creature.maxHealth <= 0) continue;
    return Math.max(0, Math.min(100, Math.round((creature.health / creature.maxHealth) * 100)));
  }
  return null;
}

export function PartyMembers({
  collapsed: initialCollapsed = false,
  onToggle,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
} = {}) {
  const partyView = useHudSlice((state) => state.party);
  const me = useHudSlice((state) => state.characterId);
  const catalogue = useHudSlice((state) => state.catalogue);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [, tick] = useState(0);

  useEffect(() => {
    if (partyView === null) return;
    const id = setInterval(() => { tick((n) => n + 1); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); };
  }, [partyView]);

  if (partyView === null) return null;

  const handleToggle = onToggle ?? (() => { setCollapsed((c) => !c); });
  const handleLeave = () => { void partyActions.leave(); };

  return (
    <Panel
      dock
      title={`Party · ${String(partyView.members.length)}`}
      collapsed={onToggle ? initialCollapsed : collapsed}
      onToggle={handleToggle}
      footer={
        <>
          <p className="party-members-note">Parar no meio da caçada exige o sim de todos.</p>
          <p className="party-members-mode">{MODE_TEXT[partyView.mode]}</p>
          <Button size="sm" variant="ghost" block onClick={handleLeave}>
            Sair da party
          </Button>
        </>
      }
    >
      <ul className="party-companions">
        {partyView.members.map((member) => {
          const percent = percentFromWorld(member.name) ?? member.healthPercent;
          const isSelf = member.characterId === me;
          const isLeader = member.characterId === partyView.leaderId;
          const vocation = member.vocationId !== null && member.vocationId !== undefined
            ? catalogue?.vocations.find((v) => v.id === member.vocationId)
            : undefined;
          const vocAbbr = member.vocationId !== null && member.vocationId !== undefined
            ? (vocation ? vocationAbbreviation(vocation.name) : member.vocationId)
            : null;
          const vocClass = vocation ? ` party-companion-voc-${vocation.id}` : '';
          return (
            <li
              key={member.characterId}
              className={`party-companion${member.alive ? '' : ' party-companion-down'}`}
            >
              <div className="party-companion-header">
                {isLeader && <span className="party-leader-star" title="Líder">★ </span>}
                <span className={isSelf ? 'party-companion-self' : undefined}>
                  {isSelf ? 'você' : member.name}
                </span>
                {vocAbbr !== null && (
                  <span
                    className={`party-companion-voc${vocClass}`}
                    title={vocation?.name ?? member.vocationId ?? undefined}
                  >
                    {vocAbbr}
                  </span>
                )}
                {member.level !== undefined && (
                  <span className="party-companion-level">
                    {`LV ${String(member.level)}`}
                  </span>
                )}
              </div>
              <div className="party-companion-vitals">
                <span className="party-hp-row">
                  <span className="party-hp" aria-label={`HP de ${member.name}`}>
                    <VitalBar kind="hp" percent={member.alive ? percent : 0} height={4} showText={false} />
                  </span>
                  <span className="entry-meta">{member.alive ? `${String(percent)} %` : 'caiu'}</span>
                </span>
                {member.manaPercent !== undefined && (
                  <span className="party-hp-row">
                    <span className="party-hp" aria-label={`Mana de ${member.name}`}>
                      <VitalBar kind="mp" percent={member.alive ? member.manaPercent : 0} height={3} showText={false} />
                    </span>
                    <span className="entry-meta">{member.alive ? `${String(member.manaPercent)} %` : '—'}</span>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
