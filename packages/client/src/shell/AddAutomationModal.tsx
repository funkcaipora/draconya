// O catálogo de modelos (AB-12/#427, captura 35): o `AddAutomationModal`. A LISTA vem de
// `catalogue.bot.automations` — a tela não tem os cinco modelos em código (RF-12/DT-03) —, e o
// subtítulo é decoração de `MODEL_SUBTITLE` (modelo sem subtítulo sai sem ele).
//
// Modelo cujo item exigido não existe no catálogo fica `disabled` (DT-05): o schema exige
// `itemId`/`ammoA`/… `min(1)`, e oferecer um modelo que não dá para preencher seria um passo
// evitável. Sem catálogo o modal devolve `null` — nunca uma lista vazia vendida como "não há".

import { useState } from 'react';
import type { BotAutomationModel } from '@draconya/content';
import { useHudSlice } from '../state/useSlice.js';
import { MODEL_SUBTITLE, blankAutomation } from '../bot/automation-text.js';
import { Modal } from './ui/Modal.js';
import { Button } from './ui/Button.js';

export interface AddAutomationModalProps {
  onPick: (model: BotAutomationModel) => void;
  onClose: () => void;
}

export function AddAutomationModal({ onPick, onClose }: AddAutomationModalProps) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const [picked, setPicked] = useState<BotAutomationModel | null>(null);
  const descriptors = catalogue?.bot.automations;
  if (catalogue === null || descriptors === undefined) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Adicionar automação"
      width={520}
      footer={
        <>
          <span className="automation-modal-hint">A automação roda sozinha; o painel liga e desliga</span>
          <span className="automation-modal-actions">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
            <Button
              variant="primary"
              size="sm"
              disabled={picked === null}
              onClick={() => { if (picked !== null) onPick(picked); }}
            >Adicionar</Button>
          </span>
        </>
      }
    >
      <ul className="automation-catalogue">
        {descriptors.map((entry) => (
          <li key={entry.model}>
            <button
              type="button"
              className={`automation-option${entry.model === picked ? ' automation-option-selected' : ''}`}
              disabled={blankAutomation(entry.model, catalogue.items) === null}
              onClick={() => { setPicked(entry.model); }}
            >
              <b>{entry.label}</b>
              {MODEL_SUBTITLE[entry.model] !== undefined && <small>{MODEL_SUBTITLE[entry.model]}</small>}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
