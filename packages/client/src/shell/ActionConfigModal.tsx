// O modal que a barra de ações abre ao configurar um slot (AB-11/#426, redesenhado em #437 na
// régua da imagem do "Configurar ação" do cliente Tibia — anexa à issue #435, ADR 0033):
// abas Magias/Runas/Itens, lista à esquerda, painel de detalhe à direita. Edita o rascunho v2 do
// slot — ação, condições em E, tecla e a chave "automática" — e manda `bot-config` ao Salvar.
//
// **Nada de opcode novo** (invariante 5): Salvar reusa `setSlot` + `flushSave`, o mesmo caminho
// de intenção de sempre (invariante 4). A recusa chega tipada em `bot-config-result`, e o
// rascunho NÃO é descartado (AGENTS.md do cliente).
//
// O vocabulário vem do catálogo v2 (`catalogue.bot`, #424/#436): TIPO, AÇÃO, ATALHO e os tipos de
// condição; o detalhe (dano, cura, cooldown, área…) vem de `bot/action-detail.ts`, PURO — este
// componente só renderiza o que ele devolve, nunca calcula número. A ação é magia ou SUPRIMENTO
// abstrato (poção/runa) — o uso debita gold, não há item nem reposição por lote (ADR 0032
// d.6/d.7). Sem catálogo o modal diz "Carregando…" e não oferece lista vazia (RF-09).

import { Fragment, useState } from 'react';
import { BOT_HOTKEYS } from '@draconya/content';
import type { BotActionV2, BotHotkey, BotRuleTarget } from '@draconya/content';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import type { Catalogue } from '../state/hud.js';
import { bot, setSlot } from '../bot/store.js';
import { draftFromSlot, draftProblem, slotFromDraft } from '../bot/action-config.js';
import type { BotSet, SlotDraft } from '../bot/action-config.js';
import {
  ACTION_TABS, actionDetail, actionEntryId, actionTab, entriesOf, requiredLevel,
} from '../bot/action-detail.js';
import type { ActionEntry, ActionTab } from '../bot/action-detail.js';
import { Modal } from './ui/Modal.js';
import { Tabs } from './ui/Tabs.js';
import { Select } from './ui/Select.js';
import { Switch } from './ui/Switch.js';
import { Button } from './ui/Button.js';
import { Kicker } from './ui/Kicker.js';
import { Slot } from './ui/Slot.js';
import { ConditionList } from './ConditionList.js';

export interface ActionConfigModalProps {
  /** O conjunto ativo da barra (0..BOT_SET_COUNT-1). */
  set: number;
  /** A posição 1-based exibida é `index + 1`. */
  index: number;
  onClose: () => void;
}

function actionOf(entry: ActionEntry): BotActionV2 {
  return entry.kind === 'spell'
    ? { kind: 'spell', spellId: entry.spell.id }
    : { kind: 'supply', supplyId: entry.supply.id };
}

function nameOf(entry: ActionEntry): string {
  return entry.kind === 'spell' ? entry.spell.name : entry.supply.name;
}

/** A entrada do catálogo que a ação do rascunho referencia, ou `null` — fora do catálogo (#420
 *  invariante 7) ou slot vazio. */
function entryOfAction(action: BotActionV2 | null, catalogue: Catalogue): ActionEntry | null {
  if (action === null) return null;
  if (action.kind === 'spell') {
    const spell = catalogue.bot.spells.find((entry) => entry.id === action.spellId);
    return spell === undefined ? null : { kind: 'spell', spell };
  }
  const supply = (catalogue.bot.supplies ?? []).find((entry) => entry.id === action.supplyId);
  return supply === undefined ? null : { kind: 'supply', supply };
}

function isSameAction(entry: ActionEntry, action: BotActionV2 | null): boolean {
  if (action === null) return false;
  return entry.kind === 'spell' && action.kind === 'spell'
    ? entry.spell.id === action.spellId
    : entry.kind === 'supply' && action.kind === 'supply' && entry.supply.id === action.supplyId;
}

/**
 * A ação aceita outro personagem como alvo? Vem do catálogo (`targets: 'friend'`, §26-30, ADR
 * 0035 d.10). A tela só oferece o seletor quando o conteúdo declarou — nada é inventado (DT-02).
 */
export function acceptsFriend(entry: ActionEntry): boolean {
  return (entry.kind === 'spell' ? entry.spell.targets : entry.supply.targets) === 'friend';
}

/** Um rascunho com a ação trocada; condições, tecla e automática sobrevivem. Trocar para uma ação
 *  que NÃO aceita amigo zera o alvo — salvar um `target` invisível seria configuração que o
 *  jogador não escolheu (RF-07/DT-03). */
export function withDo(draft: SlotDraft, action: BotActionV2 | null, friend: boolean): SlotDraft {
  return {
    do: action,
    when: draft.when,
    auto: draft.auto,
    target: friend ? draft.target : { kind: 'self' },
    ...(draft.hotkey === undefined ? {} : { hotkey: draft.hotkey }),
  };
}

/** O rascunho sem tecla — a opção "sem tecla" do ATALHO (22 teclas para 24 slots). */
function withoutHotkey(draft: SlotDraft): SlotDraft {
  return { do: draft.do, when: draft.when, auto: draft.auto, target: draft.target };
}

export function ActionConfigModal({ set, index, onClose }: ActionConfigModalProps) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const level = useHudSlice((state) => state.level);
  const magicLevel = useHudSlice((state) => state.skills.magic.level);
  const party = useHudSlice((state) => state.party);
  const me = useHudSlice((state) => state.characterId);
  const vocationId = useHudSlice((state) => state.vocationId);
  const slot = useStoreSlice(bot, (state) => state.draft.sets[set]?.slots[index] ?? null);
  const storedSet = useStoreSlice(bot, (state) => state.draft.sets[set]);
  const [draft, setDraft] = useState<SlotDraft>(() => draftFromSlot(slot));
  // `null` = ainda não trocada pelo jogador: a aba mostrada segue a ação do rascunho. Uma
  // troca explícita (RF-03) fixa a aba e passa a ignorar o rascunho — trocar de aba NÃO limpa
  // `draft.do` (o painel de detalhe continua mostrando a ação escolhida em outra aba).
  const [pickedTab, setPickedTab] = useState<ActionTab | null>(null);

  const title = `CONFIGURAR AÇÃO · SLOT ${String(index + 1)}`;
  const meta = `Barra de ações · slot ${String(index + 1)}`;

  // Sem catálogo, "ainda não sei" nunca vira "não tem": nenhuma lista vazia é oferecida (RF-09).
  if (catalogue === null) {
    return (
      <Modal open onClose={onClose} title={title} meta={meta}>
        <p className="quiet">Carregando…</p>
      </Modal>
    );
  }

  const currentSet: BotSet = storedSet ?? { slots: [] };
  const problem = draftProblem(draft, currentSet, index);
  const selectedEntry = entryOfAction(draft.do, catalogue);
  const tab = pickedTab ?? (selectedEntry === null ? 'Magias' : actionTab(selectedEntry));
  const entries = entriesOf(catalogue, tab, vocationId);
  const hotkeys = catalogue.bot.hotkeys ?? BOT_HOTKEYS;
  const detail = selectedEntry === null
    ? null
    : actionDetail(selectedEntry, { level, magicLevel, spellPower: catalogue.bot.spellPower });

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      meta={meta}
      width={700}
      footer={
        <>
          <span className="action-config-hint">
            A ação dispara sozinha enquanto ligada · o atalho continua manual
          </span>
          <span className="action-config-actions">
            {slot !== null && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setSlot(set, index, null); onClose(); }}
              >Limpar</Button>
            )}
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

      <div className="action-config-top">
        <Tabs items={ACTION_TABS} value={tab} onChange={(item) => { setPickedTab(item as ActionTab); }} />
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
        <label className="action-config-auto">
          <span>automática</span>
          <Switch
            tone="traffic"
            on={draft.auto}
            onChange={(auto) => { setDraft({ ...draft, auto }); }}
          />
        </label>
      </div>

      <div className="action-config-split">
        <ul className="action-config-list" role="listbox" aria-label={tab}>
          {entries.map((entry) => {
            const selected = isSameAction(entry, draft.do);
            const reqLv = requiredLevel(entry);
            const locked = reqLv > level;
            return (
              <li key={`${entry.kind}-${actionEntryId(entry)}`}>
                <button
                  type="button"
                  aria-pressed={selected}
                  disabled={locked}
                  className={locked ? 'is-locked' : undefined}
                  onClick={() => { if (!locked) setDraft(withDo(draft, actionOf(entry), acceptsFriend(entry))); }}
                >
                  <Slot as="span" size={30} />
                  <span className="action-config-item-name">{nameOf(entry)}</span>
                  {locked && (
                    <span className="action-config-item-lock" title={`Requer Lv. ${String(reqLv)}`}>
                      {`🔒 Lv. ${String(reqLv)}`}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <section className="action-config-detail" aria-live="polite">
          {detail === null ? (
            <p className="quiet">Escolha uma ação na lista.</p>
          ) : (
            <>
              <header>
                <Slot as="span" size={36} />
                <h3>{detail.title}</h3>
                <span className="action-config-req">{detail.requirement}</span>
              </header>
              <dl>
                {detail.rows.map((row) => (
                  <Fragment key={row.label}>
                    <dt data-label={row.label}>{row.label}</dt>
                    <dd data-label={row.label}>{row.value}</dd>
                  </Fragment>
                ))}
              </dl>
              <p className="action-config-description">{detail.description}</p>
            </>
          )}
        </section>
      </div>

      <div className="action-config-conditions-head"><Kicker tone="muted">Condições</Kicker></div>
      {selectedEntry !== null && acceptsFriend(selectedEntry) && (
        <div className="action-config-target">
          <Select
            label="Alvo"
            size="sm"
            options={[
              { value: 'self', label: 'Eu' },
              { value: 'lowest-hp-member', label: 'Membro com menor vida' },
              ...(party === null || party.members.filter((m) => m.characterId !== me).length === 0
                ? []
                : [{ value: 'member', label: 'Membro específico' }]),
            ]}
            value={draft.target.kind}
            onChange={(value) => {
              const first = party?.members.find((member) => member.characterId !== me);
              const next: BotRuleTarget = value === 'member' && first !== undefined
                ? { kind: 'member', characterId: first.characterId }
                : value === 'lowest-hp-member'
                  ? { kind: 'lowest-hp-member' }
                  : { kind: 'self' };
              setDraft({ ...draft, target: next });
            }}
          />
          {draft.target.kind === 'member' && party !== null && (
            <Select
              label="Membro"
              size="sm"
              options={party.members
                .filter((member) => member.characterId !== me)
                .map((member) => ({ value: member.characterId, label: member.name }))}
              value={draft.target.characterId}
              onChange={(characterId) => {
                setDraft({ ...draft, target: { kind: 'member', characterId } });
              }}
            />
          )}
        </div>
      )}
      <ConditionList
        hint="Todas as condições precisam bater. Sem condições, dispara sempre."
        conditions={draft.when}
        onChange={(when) => { setDraft({ ...draft, when }); }}
      />
    </Modal>
  );
}
