// O modal que a barra de ações abre ao configurar um slot (AB-11/#426, régua
// `docs/kit-reference/34-modal-action-config.png`). Edita o rascunho v2 do slot — ação, condições
// em E, tecla, a chave "automática" e a reposição do item — e manda `bot-config` ao Salvar.
//
// **Nada de opcode novo** (invariante 5): Salvar reusa `setSlot` + `flushSave`, o mesmo caminho
// de intenção do editor v1 (invariante 4). A recusa chega tipada em `bot-config-result`, e o
// rascunho NÃO é descartado (AGENTS.md do cliente).
//
// O vocabulário vem do catálogo v2 (`catalogue.bot`, #424): TIPO, AÇÃO, ATALHO e os tipos de
// condição. Sem catálogo o modal diz "Carregando…" e não oferece lista vazia (RF-10).

import { useState } from 'react';
import { BOT_HOTKEYS } from '@draconya/content';
import type { BotActionV2, BotHotkey } from '@draconya/content';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import type { Catalogue } from '../state/hud.js';
import { bot, setSlot } from '../bot/store.js';
import {
  DEFAULT_RESTOCK, draftFromSlot, draftProblem, slotFromDraft,
} from '../bot/action-config.js';
import type { BotSet, SlotDraft, SlotRestock } from '../bot/action-config.js';
import { Modal } from './ui/Modal.js';
import { Select } from './ui/Select.js';
import { Input } from './ui/Input.js';
import { Switch } from './ui/Switch.js';
import { Button } from './ui/Button.js';
import { Kicker } from './ui/Kicker.js';
import { Slot } from './ui/Slot.js';
import { ConditionList } from './ConditionList.js';

type ActionKind = BotActionV2['kind'];

export interface ActionConfigModalProps {
  /** O conjunto ativo da barra (0..BOT_SET_COUNT-1). */
  set: number;
  /** A posição 1-based exibida é `index + 1`. */
  index: number;
  onClose: () => void;
}

/** As ações que o catálogo oferece para um tipo: magias, ou os consumíveis (a poção é item). */
function actionOptions(kind: ActionKind, catalogue: Catalogue): ReadonlyArray<{ value: string; label: string }> {
  if (kind === 'spell') {
    return catalogue.bot.spells.map((spell) => ({ value: spell.id, label: spell.name }));
  }
  return catalogue.items
    .filter((item) => item.kind === 'consumable')
    .map((item) => ({ value: item.id, label: item.name }));
}

/** Nome, rótulo curto do `Slot` e a legenda do cabeçalho (`magia · gasta N mana` | `item · …`). */
function selectedAction(
  action: BotActionV2 | null,
  catalogue: Catalogue,
): { readonly label: string; readonly name: string; readonly subtitle: string } | null {
  if (action === null) return null;
  if (action.kind === 'spell') {
    const spell = catalogue.bot.spells.find((entry) => entry.id === action.spellId);
    const name = spell?.name ?? action.spellId;
    return { label: name, name, subtitle: `magia · gasta ${String(spell?.manaCost ?? 0)} mana` };
  }
  const item = catalogue.items.find((entry) => entry.id === action.itemId);
  return {
    label: item?.shortLabel ?? item?.name ?? action.itemId,
    name: item?.name ?? action.itemId,
    subtitle: 'item · consumível',
  };
}

/** A reposição default de um item: a do catálogo, ou 1/0 quando ele não a declara (ADR 0032 d.6). */
function restockFor(itemId: string, catalogue: Catalogue): SlotRestock {
  return catalogue.items.find((entry) => entry.id === itemId)?.restock ?? DEFAULT_RESTOCK;
}

/** Um rascunho com a ação trocada; `restock` só sobrevive quando o novo `do` é item. */
function withDo(draft: SlotDraft, action: BotActionV2 | null, restock?: SlotRestock): SlotDraft {
  return {
    do: action,
    when: draft.when,
    auto: draft.auto,
    ...(draft.hotkey === undefined ? {} : { hotkey: draft.hotkey }),
    ...(restock === undefined ? {} : { restock }),
  };
}

/** O rascunho sem tecla — a opção "sem tecla" do ATALHO (22 teclas para 24 slots). */
function withoutHotkey(draft: SlotDraft): SlotDraft {
  return {
    do: draft.do,
    when: draft.when,
    auto: draft.auto,
    ...(draft.restock === undefined ? {} : { restock: draft.restock }),
  };
}

export function ActionConfigModal({ set, index, onClose }: ActionConfigModalProps) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const slot = useStoreSlice(bot, (state) => state.draft.sets[set]?.slots[index] ?? null);
  const storedSet = useStoreSlice(bot, (state) => state.draft.sets[set]);
  const [draft, setDraft] = useState<SlotDraft>(() => draftFromSlot(slot));
  const [kind, setKind] = useState<ActionKind>(() => slot?.do.kind ?? 'spell');

  const title = `CONFIGURAR AÇÃO · SLOT ${String(index + 1)}`;
  const meta = `Barra de ações · slot ${String(index + 1)}`;

  // Sem catálogo, "ainda não sei" nunca vira "não tem": nenhuma lista vazia é oferecida (RF-10).
  if (catalogue === null) {
    return (
      <Modal open onClose={onClose} title={title} meta={meta}>
        <p className="quiet">Carregando…</p>
      </Modal>
    );
  }

  const currentSet: BotSet = storedSet ?? { slots: [] };
  const problem = draftProblem(draft, currentSet, index);
  const selected = selectedAction(draft.do, catalogue);
  const activeKind = draft.do?.kind ?? kind;
  const hotkeys = catalogue.bot.hotkeys ?? BOT_HOTKEYS;
  const actionValue = draft.do === null
    ? ''
    : draft.do.kind === 'spell' ? draft.do.spellId : draft.do.itemId;

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      meta={meta}
      width={620}
      footer={
        <>
          <span className="action-config-hint">
            A ação dispara sozinha enquanto ligada · o atalho continua manual
          </span>
          <span className="action-config-actions">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
            <Button
              variant="primary"
              size="sm"
              disabled={problem !== null}
              onClick={() => {
                const next = slotFromDraft(draft);
                if (next !== null) { setSlot(set, index, next); onClose(); }
              }}
            >Salvar</Button>
          </span>
        </>
      }
    >
      {problem !== null && <p className="system-error" role="alert">{problem}</p>}

      <div className="action-config-head">
        <Slot size={36} label={selected?.label ?? '—'} />
        <div className="action-config-ident">
          <strong className="action-config-name">{selected?.name ?? '—'}</strong>
          <span className="action-config-subtitle">
            {selected?.subtitle ?? 'escolha o tipo e a ação'}
          </span>
        </div>
        <label className="action-config-auto">
          <span>automática</span>
          <Switch
            tone="traffic"
            on={draft.auto}
            onChange={(auto) => { setDraft({ ...draft, auto }); }}
          />
        </label>
      </div>

      <div className="action-config-fields">
        <Select
          label="Tipo"
          size="sm"
          options={[{ value: 'spell', label: 'Magia' }, { value: 'item', label: 'Item' }]}
          value={activeKind}
          onChange={(value) => {
            const next = value as ActionKind;
            setKind(next);
            if (draft.do !== null && draft.do.kind !== next) setDraft(withDo(draft, null));
          }}
        />
        <Select
          label="Ação"
          size="sm"
          options={[{ value: '', label: '—' }, ...actionOptions(activeKind, catalogue)]}
          value={actionValue}
          onChange={(value) => {
            if (value === '') { setDraft(withDo(draft, null)); return; }
            if (activeKind === 'spell') {
              setDraft(withDo(draft, { kind: 'spell', spellId: value }));
              return;
            }
            setDraft(withDo(draft, { kind: 'item', itemId: value }, restockFor(value, catalogue)));
          }}
        />
        <Select
          label="Atalho"
          size="sm"
          options={[
            { value: '', label: '— sem tecla' },
            ...hotkeys.map((key) => ({ value: key, label: key })),
          ]}
          value={draft.hotkey ?? ''}
          onChange={(value) => {
            if (value === '') { setDraft(withoutHotkey(draft)); return; }
            setDraft({ ...draft, hotkey: value as BotHotkey });
          }}
        />
      </div>

      <Kicker tone="muted">Usar quando</Kicker>
      <ConditionList
        conditions={draft.when}
        onChange={(when) => { setDraft({ ...draft, when }); }}
      />

      {draft.do?.kind === 'item' && (
        <section className="action-config-restock">
          <Kicker tone="muted">LEVAR/REPOR</Kicker>
          <Input
            label="Levar"
            size="sm"
            type="number"
            min={1}
            value={String(draft.restock?.batch ?? DEFAULT_RESTOCK.batch)}
            onChange={(event) => {
              setDraft({
                ...draft,
                restock: { batch: Number(event.target.value), min: draft.restock?.min ?? 0 },
              });
            }}
          />
          <Input
            label="Repor abaixo de"
            size="sm"
            type="number"
            min={0}
            value={String(draft.restock?.min ?? DEFAULT_RESTOCK.min)}
            onChange={(event) => {
              setDraft({
                ...draft,
                restock: { batch: draft.restock?.batch ?? 1, min: Number(event.target.value) },
              });
            }}
          />
        </section>
      )}

      <p className="action-config-note">
        Cura, poções, ataque, runas e suporte vivem aqui, na barra de ações — a ordem dos slots é a
        prioridade. HP e Mana comparam percentual.
      </p>
    </Modal>
  );
}
