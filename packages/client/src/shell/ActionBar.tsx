// A barra de ações 2 × 12 da fileira de 124 px (AB-10, ADR 0032 d.1–5). É a configuração do bot
// E a superfície de disparo manual — um só vocabulário. Monta na Cidade e na caçada: a
// configuração é editável em qualquer lugar, e a execução (recusada com motivo fora da hunt) é
// do servidor.
//
// A barra NÃO calcula elegibilidade, não consome estoque e não decide cooldown (invariante 4):
// cooldown/bloqueio vêm do `slot-state`, e a recusa da tecla do `slot-result`. Suprimento é
// abstrato (sem pilha nem contagem). O cliente só manda intenção — a tecla manda `use-slot`,
// CONJUNTO/ALVO e o Shift+clique mandam `bot-config`.

import { useEffect, useState } from 'react';
import { BOT_SLOTS_PER_SET } from '@draconya/content';
import type { BotTargetPolicy } from '@draconya/content';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { sendIntent } from '../net/current.js';
import {
  bot, setActiveSet, setConfigSender, setSlotAuto, setTargetingPolicy,
} from '../bot/store.js';
import { world } from '../state/world.js';
import { Slot } from './ui/Slot.js';
import type { SlotProps } from './ui/Slot.js';
import { Kicker } from './ui/Kicker.js';
import { Select } from './ui/Select.js';
import { LureTargetingModal } from './LureTargetingModal.js';
import { ActionConfigModal } from './ActionConfigModal.js';
import { useActionKeys } from './useActionKeys.js';
import {
  TARGET_POLICY_OPTIONS, lureCaption, policyLabel, slotKey, slotTitle, slotView,
} from './action-bar.js';

export function ActionBar() {
  const catalogue = useHudSlice((state) => state.catalogue);
  const slotStates = useHudSlice((state) => state.slotStates);
  const slotResults = useHudSlice((state) => state.slotResults);
  const targetId = useHudSlice((state) => state.targetId);
  const save = useStoreSlice(bot, (state) => state.save);
  const activeSet = useStoreSlice(bot, (state) => state.draft.activeSet);
  const targeting = useStoreSlice(bot, (state) => state.draft.targeting);
  const lure = useStoreSlice(bot, (state) => state.draft.lure);
  const draftSets = useStoreSlice(bot, (state) => state.draft.sets);
  const [lureOpen, setLureOpen] = useState(false);
  // Qual slot está com o `ActionConfigModal` aberto, ou `null`. Um por vez: é o slot clicado.
  const [configSlot, setConfigSlot] = useState<number | null>(null);

  // A tecla é do CLIENTE e só manda intenção; o hook lê a store no disparo, nunca no render.
  useActionKeys();

  // A store não importa `net/` (ADR 0007: o socket fica fora do render); a barra liga o remetente
  // ao montar — é ela quem edita o bot desde o AB-10. Intenção (invariante 4): CONJUNTO, ALVO e
  // Shift+clique mandam `bot-config`, e quem decide se vale é o servidor.
  useEffect(() => {
    setConfigSender((config) => sendIntent({ type: 'bot-config', config }));
    return () => { setConfigSender(null); };
  }, []);

  // Um alvo vivo só existe se o servidor disse qual é; o nome vem do mundo na MESMA renderização
  // que a fatia `targetId` já dispara — o mundo não avisa ninguém (ADR 0007), e não precisa.
  const targetName = targetId === null ? null : world.creatures.get(targetId)?.name ?? null;

  // Os NOMES dos conjuntos vêm do catálogo (#424); o que está EM cada slot vem do rascunho v2.
  // Sem catálogo a barra monta vazia — "ainda não sei" nunca vira "não tem".
  const slotCount = catalogue?.bot.slotsPerSet ?? BOT_SLOTS_PER_SET;
  const slots = draftSets[activeSet]?.slots ?? [];
  const setNames = catalogue?.bot.setNames ?? [];
  const saveText = save === 'pending'
    ? 'Salva automaticamente · salvando…'
    : save === 'saved' ? 'Salva automaticamente · salvo' : 'Salva automaticamente';

  return (
    <section className="action-bar" aria-label="Ações">
      <header className="action-bar-head">
        <Kicker tone="muted">Ações</Kicker>
        <span className="action-bar-save">{saveText}</span>
      </header>
      <div className="action-bar-body">
        <div className="action-bar-grid">
          {Array.from({ length: slotCount }, (_, index) => {
            const key = slotKey(activeSet, index);
            const view = catalogue === null
              ? null
              : slotView(slots[index] ?? null, catalogue, slotStates[key] ?? null);
            if (view === null) {
              return (
                <Slot
                  key={index}
                  size={36}
                  empty
                  dashed
                  ariaLabel={`slot ${String(index + 1)} vazio`}
                  // Slot vazio também abre o modal: é por onde o jogador configura o slot (RF-09).
                  onClick={() => { setConfigSlot(index); }}
                />
              );
            }
            // `exactOptionalPropertyTypes`: só entra na chamada a prop que de fato veio.
            const props: SlotProps = {
              size: 36,
              label: view.label,
              ...(view.hotkey === undefined ? {} : { hotkey: view.hotkey }),
              ...(view.element === undefined ? {} : { element: view.element }),
              ...(view.cooldownMs > 0 ? { className: 'action-slot-cooldown' } : {}),
              title: slotTitle(view, slotResults[key] ?? null),
              ariaLabel: `slot ${String(index + 1)}`,
              // Shift+clique desliga o automático; o clique simples abre o `ActionConfigModal`
              // (AB-11/#426).
              onClick: (event) => {
                if (event.shiftKey) { setSlotAuto(index, false); return; }
                setConfigSlot(index);
              },
            };
            return <Slot key={index} {...props} />;
          })}
        </div>
        <div className="action-bar-side">
          {catalogue !== null && setNames.length > 0 && (
            <Select
              inline
              label="Conjunto"
              options={setNames.map((name, index) => ({ value: String(index), label: name }))}
              value={String(activeSet)}
              onChange={(value) => { setActiveSet(Number(value)); }}
            />
          )}
          {catalogue !== null && (
            <Select
              inline
              label="Alvo"
              options={TARGET_POLICY_OPTIONS.map((policy) => ({
                value: policy,
                label: policyLabel(policy, targetName),
              }))}
              value={targeting.policy}
              onChange={(value) => { setTargetingPolicy(value as BotTargetPolicy); }}
            />
          )}
          <button
            type="button"
            className="action-bar-lure"
            onClick={() => { setLureOpen(true); }}
          >⌖ LURE · FOLLOW</button>
          <span className="action-bar-caption">{lureCaption(lure, targeting.posture)}</span>
        </div>
      </div>
      {lureOpen && <LureTargetingModal onClose={() => { setLureOpen(false); }} />}
      {configSlot !== null && (
        <ActionConfigModal
          set={activeSet}
          index={configSlot}
          onClose={() => { setConfigSlot(null); }}
        />
      )}
    </section>
  );
}
