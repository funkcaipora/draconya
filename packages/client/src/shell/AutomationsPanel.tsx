// O painel AUTOMAÇÕES da coluna esquerda (AB-12/#427, régua `docs/kit-reference/10-hud-hunt.png`,
// bloco AUTOMAÇÕES; ADR 0032 decisão 9). Uma linha por automação do rascunho — interruptor, nome,
// resumo gerado dos parâmetros, ⚙ e × — e o "+ Adicionar" que abre o catálogo de modelos.
//
// **Montado na Cidade e na caçada** (ADR 0032 d.5): não há condição de `hunting`, como o painel v1
// v1 era. O estado quente do rascunho vive na store fora do React (ADR 0007), e é o painel quem
// injeta o remetente ao montar — a store não importa `net/`.
//
// O cliente só manda intenção (invariante 4): toggle/× agendam `bot-config` com debounce, e o
// Salvar do modal manda na hora. Nada aqui calcula elegibilidade, estoque ou alvo.

import { useEffect, useState } from 'react';
import type { BotAutomation } from '@draconya/content';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import { sendIntent } from '../net/current.js';
import { bot, removeAutomation, setConfigSender, toggleAutomation } from '../bot/store.js';
import { automationSummary, blankAutomation } from '../bot/automation-text.js';
import { Panel } from './ui/Panel.js';
import { Switch } from './ui/Switch.js';
import { IconButton } from './ui/IconButton.js';
import { Button } from './ui/Button.js';
import { AddAutomationModal } from './AddAutomationModal.js';
import { AutomationConfigModal } from './AutomationConfigModal.js';

export interface AutomationsPanelProps {
  /** Controlado pelo dono; ausente, o painel minimiza sozinho pelo próprio cabeçalho. */
  collapsed?: boolean;
  onToggle?: () => void;
}

export function AutomationsPanel({ collapsed, onToggle }: AutomationsPanelProps) {
  const [open, setOpen] = useState(true);
  // Como o `SkillsPanel`: o cabeçalho minimiza sozinho quando o dono não controla o estado.
  const isCollapsed = collapsed ?? !open;
  const toggle = onToggle ?? (() => { setOpen((value) => !value); });
  const catalogue = useHudSlice((state) => state.catalogue);
  const automations = useStoreSlice(bot, (state) => state.draft.automations);
  const save = useStoreSlice(bot, (state) => state.save);
  const reason = useStoreSlice(bot, (state) => state.reason);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ index: number | null; initial: BotAutomation } | null>(null);

  // A store não importa `net/` (ADR 0007): o painel liga o remetente ao montar.
  useEffect(() => {
    setConfigSender((config) => sendIntent({ type: 'bot-config', config }));
    return () => { setConfigSender(null); };
  }, []);

  const panelProps = {
    collapsed: isCollapsed,
    onToggle: toggle,
    ...(save === 'pending' ? { meta: 'salvando…' } : save === 'saved' ? { meta: 'salvo' } : {}),
  };

  const descriptor = catalogue?.bot.automations;
  // Sem catálogo (ou num nó v1, que não traz `automations`) é "ainda não sei", nunca "não tem".
  if (catalogue === null || descriptor === undefined) {
    return (
      <Panel dock title="Automações" className="automations-panel" {...panelProps}>
        <p className="quiet">Carregando…</p>
      </Panel>
    );
  }

  const items = catalogue.items;
  const labelOf = (model: BotAutomation['model']): string =>
    descriptor.find((entry) => entry.model === model)?.label ?? model;

  return (
    <>
      <Panel dock title="Automações" className="automations-panel" {...panelProps}>
        <ul className="automation-list">
          {automations.map((automation, index) => (
            <li
              key={index}
              className={`automation-row${automation.enabled === false ? ' automation-row-off' : ''}`}
            >
              <Switch
                tone="traffic"
                on={automation.enabled !== false}
                title={automation.enabled !== false ? 'ligada' : 'desligada'}
                onChange={() => { toggleAutomation(index); }}
              />
              <span className="automation-row-text" title={automationSummary(automation, items)}>
                <b>{labelOf(automation.model)}</b>
                <small>{automationSummary(automation, items)}</small>
              </span>
              <IconButton title="Configurar" onClick={() => { setEditing({ index, initial: automation }); }}>⚙</IconButton>
              <IconButton title="Remover automação" onClick={() => { removeAutomation(index); }}>×</IconButton>
            </li>
          ))}
        </ul>
        <Button variant="secondary" size="sm" block onClick={() => { setAdding(true); }}>+ Adicionar</Button>
        {/* A recusa fica na tela e o rascunho FICA: descartar seria a pior resposta a "corrija isto". */}
        {save === 'refused' && reason !== null && <p className="system-error">{reason}</p>}
      </Panel>
      {adding && (
        <AddAutomationModal
          onPick={(model) => {
            const draft = blankAutomation(model, items);
            setAdding(false);
            // Modelo sem o item exigido no catálogo: o `AddAutomationModal` já o desabilita, e
            // `blankAutomation` devolve `null` — nunca um modal com `itemId` vazio.
            if (draft !== null) setEditing({ index: null, initial: draft });
          }}
          onClose={() => { setAdding(false); }}
        />
      )}
      {editing !== null && (
        <AutomationConfigModal
          index={editing.index}
          initial={editing.initial}
          onClose={() => { setEditing(null); }}
        />
      )}
    </>
  );
}
