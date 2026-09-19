// Os companheiros durante a hunt (#197, #318): nome, HP % e quem lidera. Aparece no lugar da
// formação assim que a sessão é uma party, dentro de um `Panel` dock com o rodapé do kit.
//
// O HP vem de dois lugares: do `party-state` (attach e mudança de composição) e, no meio, do
// `creature-health` que o mundo já recebe de cada um — a lista de criaturas tem o nome, e é
// por ele que se casa. Lido num intervalo curto, e não por assinatura: o mundo é um objeto
// mutado no lugar (ADR 0007), e o painel só existe em party.
//
// Vocação, level e mana chegaram com o SV-11 (#347): a abreviação vem do NOME em
// `catalogue.vocations`, buscada pelo `vocationId` que o `party-state` manda — nunca escrita à
// mão aqui — e cai para o id cru, sem cor, quando o catálogo não o reconhece (nó `game` ou
// conteúdo divergente). Nada aparece quando `vocationId` é `null` ou, para level/mana, quando o
// campo é `undefined` (D8: o cliente não fabrica o que o servidor não mandou). Gasto ainda
// espera SV-18, DPS/HPS esperam E2; expulsar é ação da FORMAÇÃO (`PartyPanel.tsx`, SV-22/#358),
// não deste painel.
//
// O rodapé ganhou os DOIS interruptores do líder (#405, ADR 0033 D1): "Rateio de custos" e
// "Dividir loot" leem `party-state.shareCosts`/`splitLoot` (com `mode` como fallback derivado,
// nunca escrito à mão) e o líder os liga/desliga EM TEMPO DE HUNT. O clique manda INTENÇÃO
// (`party-settings`, invariante 4); quem decide se aplica é o host, e a tela só reflete o
// `party-state` que volta. O membro vê os dois desabilitados.
//
// O botão usa `leave-hunt`, não `partyActions.leave()`: depois do start a party HTTP já foi
// consumida, enquanto o opcode 10 retira somente este personagem da sessão compartilhada.

import { useEffect, useState } from 'react';
import { useHudSlice } from '../state/useSlice.js';
import { sendIntent } from '../net/current.js';
import { leaveHunt } from './HuntActions.js';
import { percentFromWorld } from './party-member-view.js';
import { shareCostsOf, splitLootOf } from './party-loot-format.js';
import { Button } from './ui/Button.js';
import { IconButton } from './ui/IconButton.js';
import { Panel } from './ui/Panel.js';
import { Switch } from './ui/Switch.js';
import { VitalBar } from './ui/VitalBar.js';

export const HEALTH_POLL_MS = 1_000;

/** A letra que representa a vocação (SV-11, #347) — a inicial do NOME, nunca do id. */
export function vocationAbbreviation(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function PartyMembers({ partyLootOpen, onToggleLoot, onManage }: {
  partyLootOpen: boolean;
  onToggleLoot: () => void;
  onManage: () => void;
}) {
  const partyView = useHudSlice((state) => state.party);
  const me = useHudSlice((state) => state.characterId);
  const catalogue = useHudSlice((state) => state.catalogue);
  const [, tick] = useState(0);
  useEffect(() => {
    if (partyView === null) return;
    const id = setInterval(() => { tick((n) => n + 1); }, HEALTH_POLL_MS);
    return () => { clearInterval(id); };
  }, [partyView]);
  if (partyView === null) return null;

  // O líder é quem muda os dois eixos (PRD §33). O membro VÊ o estado, sem clicar.
  const leader = partyView.leaderId === me;
  const footer = (
    <div className="party-footer">
      <p className="party-footer-note">Parar no meio da caçada exige o sim de todos.</p>
      <div className="party-footer-toggles">
        <Switch
          title="Rateio de custos"
          tone="gold"
          on={shareCostsOf(partyView)}
          disabled={!leader}
          // Intenção, nunca o valor final (invariante 4): quem decide se aplica é o host, que
          // devolve o `party-state` atualizado ou um `system-message` de recusa.
          {...(leader
            ? { onChange: (on: boolean) => { sendIntent({ type: 'party-settings', shareCosts: on }); } }
            : {})}
        />
        <Switch
          title="Dividir loot"
          tone="gold"
          on={splitLootOf(partyView)}
          disabled={!leader}
          {...(leader
            ? { onChange: (on: boolean) => { sendIntent({ type: 'party-settings', splitLoot: on }); } }
            : {})}
        />
      </div>
      <Button
        variant="danger"
        size="sm"
        block
        className="party-footer-leave"
        onClick={() => { leaveHunt(sendIntent); }}
      >
        Sair da party
      </Button>
    </div>
  );

  return (
    <Panel
      dock
      title={`Party · ${String(partyView.members.length)}`}
      footer={footer}
      actions={(
        <>
          <IconButton size="sm" title="Party loot" active={partyLootOpen} onClick={onToggleLoot}>
            ▣
          </IconButton>
          {/* Abre o modal "Gerenciar party" (#320, R3-11/R3-12) — a formação e as ações de
              party voltam a existir DURANTE a hunt, sem duplicar PartyPanel.tsx. */}
          <IconButton size="sm" title="Gerenciar party" onClick={onManage}>⚙</IconButton>
        </>
      )}
    >
      <ul className="party-companions" aria-label="companheiros">
        {partyView.members.map((member) => {
          const percent = percentFromWorld(member.name) ?? member.healthPercent;
          const isSelf = member.characterId === me;
          const isLeader = member.characterId === partyView.leaderId;
          // A vocação é procurada pelo NOME no catálogo (SV-11, #347); sem correspondência
          // (nó `game` anterior ou conteúdo divergente), cai para o id cru, sem cor.
          const vocation = member.vocationId !== null
            ? catalogue?.vocations.find((v) => v.id === member.vocationId)
            : undefined;
          const vocationLabel = member.vocationId === null
            ? null
            : (vocation !== undefined ? vocationAbbreviation(vocation.name) : member.vocationId);
          const vocationTitle = vocation?.name ?? member.vocationId ?? undefined;
          const vocationClass = vocation !== undefined ? ` party-companion-voc-${vocation.id}` : '';
          return (
            <li key={member.characterId} className={`party-companion${member.alive ? '' : ' party-companion-down'}`}>
              <div className="party-companion-header">
                <span className="party-companion-name">
                  {isLeader && <span className="party-leader-star">★</span>}
                  <b className={isSelf ? 'party-companion-self' : undefined}>{isSelf ? 'você' : member.name}</b>
                </span>
                {vocationLabel !== null && (
                  <span className={`party-companion-voc${vocationClass}`} title={vocationTitle}>
                    {vocationLabel}
                  </span>
                )}
                {member.level !== undefined && (
                  <span className="party-companion-level">{`LV ${String(member.level)}`}</span>
                )}
              </div>
              {/* Gasto (SV-18), DPS/HPS (E2) e expulsão (formação, SV-22/#358) ficam de fora:
                  o HUD não fabrica valores que o servidor não transmitiu. */}
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
