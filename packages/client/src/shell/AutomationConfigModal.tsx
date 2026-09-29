// A configuração por modelo (AB-12/#427, capturas 36–38): o `AutomationConfigModal`. **Um**
// componente que ramifica pelo `model` (DT-01) — as capturas compartilham o casco (Modal,
// cabeçalho, toggle, rodapé, faixa morta), e cinco arquivos duplicariam o casco.
//
// A entrada é **OU** e a saída é **E** (ADR 0032 d.9): a semântica é do `sim`, e a tela só reusa o
// `ConditionList` (#426) sob os títulos de cada modelo — não há toggle de lógica. `renew-ring` e
// `renew-amulet` NÃO pedem condição: o gatilho é o slot vazio (AB-08), então o modal mostra
// `ITEM` + `RENOVAR QUANDO` sem lista.
//
// Salvar reusa `putAutomation` (opcode `bot-config`, invariante 5) e valida a faixa morta de HP
// antes de mandar (RF-09). O rascunho NÃO é descartado numa recusa (AGENTS.md do cliente).

import { useState } from 'react';
import type { BotAutomation, BotAutomationModel, BotConditionV2 } from '@draconya/content';
import { useHudSlice } from '../state/useSlice.js';
import { putAutomation } from '../bot/store.js';
import {
  ammoName, automationProblem, automationSummary, itemName, itemsForParam,
} from '../bot/automation-text.js';
import type { AutomationItemParam } from '../bot/automation-text.js';
import type { ItemDefinition } from '../state/hud.js';
import { Modal } from './ui/Modal.js';
import { Select } from './ui/Select.js';
import { Input } from './ui/Input.js';
import { Switch } from './ui/Switch.js';
import { Button } from './ui/Button.js';
import { Kicker } from './ui/Kicker.js';
import { ConditionList } from './ConditionList.js';

export interface AutomationConfigModalProps {
  /** `null` = automação nova (o Salvar acrescenta); número = edição (o Salvar substitui). */
  index: number | null;
  /** O rascunho inicial; para `index === null` vem de `blankAutomation`. */
  initial: BotAutomation;
  onClose: () => void;
}

/** O select de um id do catálogo, com as opções e o nome de fallback que quem chama decide. */
function IdField({ label, value, options, nameOf, onChange }: {
  label: string;
  value: string;
  options: readonly { readonly value: string; readonly label: string }[];
  nameOf: (id: string) => string;
  onChange: (id: string) => void;
}) {
  // Id que saiu do catálogo continua selecionável pelo id cru — o resumo não inventa nome e o
  // servidor decide na validação (invariante 7: a versão da sessão é fixa).
  const withCurrent = options.some((option) => option.value === value)
    ? options
    : [{ value, label: nameOf(value) }, ...options];
  return <Select label={label} size="sm" options={withCurrent} value={value} onChange={onChange} />;
}

/** O select de um item de equipamento do catálogo, filtrado pelo `slot` que o parâmetro exige. */
function ItemField({ model, param, label, value, items, onChange }: {
  model: BotAutomationModel;
  param: AutomationItemParam;
  label: string;
  value: string;
  items: readonly ItemDefinition[];
  onChange: (id: string) => void;
}) {
  return (
    <IdField
      label={label}
      value={value}
      options={itemsForParam(model, param, items).map((item) => ({ value: item.id, label: item.name }))}
      nameOf={(id) => itemName(id, items)}
      onChange={onChange}
    />
  );
}

export function AutomationConfigModal({ index, initial, onClose }: AutomationConfigModalProps) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const [draft, setDraft] = useState<BotAutomation>(initial);

  const descriptors = catalogue?.bot.automations;
  const label = descriptors?.find((entry) => entry.model === draft.model)?.label ?? draft.model;

  // Sem catálogo, "ainda não sei" nunca vira "não tem": nenhuma lista vazia é oferecida.
  if (catalogue === null || descriptors === undefined) {
    return (
      <Modal open onClose={onClose} title="Automação" width={620}>
        <p className="quiet">Carregando…</p>
      </Modal>
    );
  }

  const items = catalogue.items;
  const ammunition = catalogue.ammunition;
  const problem = automationProblem(draft, items, ammunition);
  const setEnter = (enter: readonly BotConditionV2[]): void => { setDraft({ ...draft, enter: [...enter] }); };
  const setExit = (exit: readonly BotConditionV2[]): void => { setDraft({ ...draft, exit: [...exit] }); };

  /** O corpo ramifica pelo modelo; o casco é o mesmo (DT-01). */
  function renderBody() {
    switch (draft.model) {
      case 'renew-ring':
      case 'renew-amulet':
        return (
          <div className="automation-config-grid">
            <section className="automation-config-box">
              <Kicker tone="muted">ITEM</Kicker>
              <ItemField
                model={draft.model} param="itemId" label="" value={draft.params.itemId} items={items}
                onChange={(itemId) => { setDraft({ ...draft, params: { itemId } }); }}
              />
            </section>
            <section className="automation-config-box">
              <Kicker tone="muted">RENOVAR QUANDO</Kicker>
              <Select
                label="" size="sm"
                options={[{ value: 'charges', label: 'Acabar (cargas 0)' }]}
                value="charges" onChange={() => {}}
              />
              <p className="automation-config-hint">Pega o próximo da mochila principal.</p>
            </section>
          </div>
        );
      case 'swap-ammo-by-targets': {
        const threshold = draft.enter.find((condition) => condition.kind === 'targets');
        const count = threshold?.kind === 'targets' ? threshold.count : 3;
        return (
          <div className="automation-config-grid">
            <section className="automation-config-box">
              <Kicker tone="muted">MUITOS ALVOS</Kicker>
              <IdField
                label="Munição" value={draft.params.ammoA}
                options={ammunition.map((ammo) => ({ value: ammo.id, label: ammo.name }))}
                nameOf={(id) => ammoName(id, ammunition)}
                onChange={(ammoA) => { setDraft({ ...draft, params: { ...draft.params, ammoA } }); }}
              />
              <Input
                label="Alvos maior ou igual a" size="sm" type="number" min={0} value={String(count)}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setDraft({
                    ...draft,
                    enter: [{ kind: 'targets', op: '>=', count: next }],
                    exit: [{ kind: 'targets', op: '<', count: next }],
                  });
                }}
              />
            </section>
            <section className="automation-config-box">
              <Kicker tone="muted">POUCOS ALVOS</Kicker>
              <IdField
                label="Munição" value={draft.params.ammoB}
                options={ammunition.map((ammo) => ({ value: ammo.id, label: ammo.name }))}
                nameOf={(id) => ammoName(id, ammunition)}
                onChange={(ammoB) => { setDraft({ ...draft, params: { ...draft.params, ammoB } }); }}
              />
              <p className="automation-config-hint">Volta quando cair abaixo do limite.</p>
            </section>
          </div>
        );
      }
      case 'swap-weapon-shield-by-hp':
        return (
          <>
            <div className="automation-config-grid">
              <section className="automation-config-box">
                <Kicker tone="muted">SET DEFENSIVO</Kicker>
                <ItemField
                  model={draft.model} param="oneHanded" label="Arma" value={draft.params.oneHanded} items={items}
                  onChange={(oneHanded) => { setDraft({ ...draft, params: { ...draft.params, oneHanded } }); }}
                />
                <ItemField
                  model={draft.model} param="shield" label="Escudo" value={draft.params.shield} items={items}
                  onChange={(shield) => { setDraft({ ...draft, params: { ...draft.params, shield } }); }}
                />
              </section>
              <section className="automation-config-box">
                <Kicker tone="muted">SET OFENSIVO</Kicker>
                <ItemField
                  model={draft.model} param="twoHanded" label="Arma" value={draft.params.twoHanded} items={items}
                  onChange={(twoHanded) => { setDraft({ ...draft, params: { ...draft.params, twoHanded } }); }}
                />
              </section>
            </div>
            <Kicker tone="muted">EQUIPAR DEFENSIVO QUANDO</Kicker>
            <ConditionList conditions={draft.enter} onChange={setEnter} />
            <Kicker tone="muted">VOLTAR AO OFENSIVO QUANDO</Kicker>
            <ConditionList conditions={draft.exit} onChange={setExit} />
          </>
        );
      case 'swap-ring':
        return (
          <>
            <div className="automation-config-grid">
              <section className="automation-config-box">
                <Kicker tone="muted">ITEM</Kicker>
                <ItemField
                  model={draft.model} param="itemId" label="" value={draft.params.itemId} items={items}
                  onChange={(itemId) => { setDraft({ ...draft, params: { ...draft.params, itemId } }); }}
                />
              </section>
              <section className="automation-config-box">
                <Kicker tone="muted">MANA</Kicker>
                <Input
                  label="Piso de mana" size="sm" type="number" min={0} max={100}
                  value={String(draft.params.manaFloor)}
                  onChange={(event) => {
                    setDraft({ ...draft, params: { ...draft.params, manaFloor: Number(event.target.value) } });
                  }}
                />
                <label className="automation-config-toggle">
                  <span>Restaurar anterior</span>
                  <Switch
                    on={draft.params.restorePrevious}
                    onChange={(restorePrevious) => {
                      setDraft({ ...draft, params: { ...draft.params, restorePrevious } });
                    }}
                  />
                </label>
              </section>
            </div>
            <Kicker tone="muted">ENTRAR QUANDO</Kicker>
            <ConditionList conditions={draft.enter} onChange={setEnter} />
            <Kicker tone="muted">SAIR QUANDO</Kicker>
            <ConditionList conditions={draft.exit} onChange={setExit} />
          </>
        );
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={label}
      meta="Automação"
      width={620}
      footer={
        <>
          <span className="automation-config-hint">
            Sem faixa morta entre as condições a troca oscila a cada golpe
          </span>
          <span className="automation-config-actions">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
            <Button
              variant="primary"
              size="sm"
              disabled={problem !== null}
              onClick={() => { putAutomation(index, draft); onClose(); }}
            >Salvar</Button>
          </span>
        </>
      }
    >
      {problem !== null && <p className="system-error" role="alert">{problem}</p>}
      <div className="automation-config-head">
        <span className="automation-config-summary">{automationSummary(draft, items, ammunition)}</span>
        <label className="automation-config-toggle">
          <span>ligada</span>
          <Switch
            tone="traffic"
            on={draft.enabled !== false}
            onChange={(on) => { setDraft({ ...draft, enabled: on }); }}
          />
        </label>
      </div>
      {renderBody()}
    </Modal>
  );
}
