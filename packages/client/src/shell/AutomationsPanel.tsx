// O painel AUTOMAÇÕES da coluna esquerda (AB-12/#427, régua `docs/kit-reference/10-hud-hunt.png`,
// bloco AUTOMAÇÕES; ADR 0032 decisão 9). Uma linha por automação do rascunho — interruptor, nome,
// resumo gerado dos parâmetros, ⚙ e × — e o "+ Adicionar" que abre o catálogo de modelos.
//
// **Montado na Cidade e na caçada** (ADR 0032 d.5): não há condição de `hunting`, como o painel v1
// v1 era. O estado quente do rascunho vive na store fora do React (ADR 0007); o remetente de
// `bot-config` é instalado UMA vez pela `Shell` (dono único do singleton), nunca por este painel.
//
// O cliente só manda intenção (invariante 4): toggle/× agendam `bot-config` com debounce, e o
// Salvar do modal manda na hora. Nada aqui calcula elegibilidade, estoque ou alvo.

import { useMemo, useState } from 'react';
import type { BotAutomation } from '@draconya/content';
import type { ItemDefinition } from '../state/hud.js';
import { useHudSlice, useStoreSlice } from '../state/useSlice.js';
import {
  bot, removeAutomation, setFollow, setLootFilter, toggleAutoSellItem, toggleAutomation,
  toggleLootItem,
} from '../bot/store.js';
import { automationSummary, blankAutomation } from '../bot/automation-text.js';
import { LOOT_SEARCH_RESULT_LIMIT, visibleLootItems } from './loot-filter.js';
import { ItemSprite } from './ItemSprite.js';
import { Panel } from './ui/Panel.js';
import { Select } from './ui/Select.js';
import { Switch } from './ui/Switch.js';
import { IconButton } from './ui/IconButton.js';
import { Button } from './ui/Button.js';
import { Input } from './ui/Input.js';
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
  const party = useHudSlice((state) => state.party);
  const me = useHudSlice((state) => state.characterId);
  const followState = useHudSlice((state) => state.followState);
  const automations = useStoreSlice(bot, (state) => state.draft.automations);
  const follow = useStoreSlice(bot, (state) => state.draft.follow);
  const loot = useStoreSlice(bot, (state) => state.draft.loot);
  const save = useStoreSlice(bot, (state) => state.save);
  const reason = useStoreSlice(bot, (state) => state.reason);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ index: number | null; initial: BotAutomation } | null>(null);
  // A busca do bloco Loot (#764): sem ela o catálogo inteiro (~1858 itens após a #748) montava
  // como uma `<ul>` só, sempre — mesmo com o painel fechado. `visibleLootItems` é a decisão PURA
  // do que aparece (`loot-filter.ts`, testado sem DOM); aqui só o texto digitado.
  const [lootQuery, setLootQuery] = useState('');

  const panelProps = {
    collapsed: isCollapsed,
    onToggle: toggle,
    ...(save === 'pending' ? { meta: 'salvando…' } : save === 'saved' ? { meta: 'salvo' } : {}),
  };

  const descriptor = catalogue?.bot.automations;
  // `items`/`ammunition` calculados ANTES do retorno antecipado abaixo: hooks (`useMemo`) não
  // podem ficar depois dele — a regra dos hooks exige a mesma ordem em toda renderização, e um
  // `return` antes do `useMemo` faria a contagem variar entre "carregando" e catálogo pronto.
  const items: readonly ItemDefinition[] = catalogue?.items ?? [];
  const ammunition = catalogue?.ammunition ?? [];
  const lootItemIds = loot?.itemIds ?? [];
  const lootAutoSell = loot?.autoSell ?? [];
  const lootRows = useMemo(
    () => visibleLootItems(items, { itemIds: lootItemIds, autoSell: lootAutoSell }, lootQuery, LOOT_SEARCH_RESULT_LIMIT),
    [items, lootItemIds, lootAutoSell, lootQuery],
  );

  // Sem catálogo (ou num nó v1, que não traz `automations`) é "ainda não sei", nunca "não tem".
  if (catalogue === null || descriptor === undefined) {
    return (
      <Panel dock title="Automações" className="automations-panel" {...panelProps}>
        <p className="quiet">Carregando…</p>
      </Panel>
    );
  }

  const labelOf = (model: BotAutomation['model']): string =>
    descriptor.find((entry) => entry.model === model)?.label ?? model;

  return (
    <>
      <Panel dock title="Automações" className="automations-panel" {...panelProps}>
        {/* Follow de membro (#406, ADR 0035 d.9): campo separado da postura — `posture.follow`
            persegue o MONSTRO; este segue um PERSONAGEM. Fora de party não há a quem seguir (§24). */}
        {party !== null && (
          <div className="automation-follow">
            <Select
              label="Seguir"
              size="sm"
              options={[
                { value: 'none', label: 'Não seguir' },
                { value: 'leader', label: 'Líder da party' },
                ...party.members.filter((member) => member.characterId !== me)
                  .map((member) => ({ value: `member:${member.characterId}`, label: member.name })),
              ]}
              value={follow === undefined || follow.kind === 'none'
                ? 'none'
                : follow.kind === 'leader'
                  ? 'leader'
                  : `member:${follow.characterId}`}
              onChange={(value) => {
                if (value === 'leader') { setFollow({ kind: 'leader' }); return; }
                if (value.startsWith('member:')) {
                  setFollow({ kind: 'member', characterId: value.slice('member:'.length) });
                  return;
                }
                setFollow({ kind: 'none' });
              }}
            />
          </div>
        )}
        {/* §25.1: só aparece quando o SERVIDOR disse que o follow parou — nunca um palpite local (D8). */}
        {followState?.active === false && (
          <p className="system-warning">Follow interrompido — alvo indisponível.</p>
        )}
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
              <span className="automation-row-text" title={automationSummary(automation, items, ammunition)}>
                <b>{labelOf(automation.model)}</b>
                <small>{automationSummary(automation, items, ammunition)}</small>
              </span>
              <IconButton title="Configurar" onClick={() => { setEditing({ index, initial: automation }); }}>⚙</IconButton>
              <IconButton title="Remover automação" onClick={() => { removeAutomation(index); }}>×</IconButton>
            </li>
          ))}
        </ul>
        <Button variant="secondary" size="sm" block onClick={() => { setAdding(true); }}>+ Adicionar</Button>
        {/* A recusa fica na tela e o rascunho FICA: descartar seria a pior resposta a "corrija isto". */}
        {save === 'refused' && reason !== null && <p className="system-error">{reason}</p>}
        {/* O filtro de Quick Loot (#722, ADR 0048 d.2/d.4): o que o bot coleta sozinho no abate,
            e o que ele vende na hora — a mesma config que `#collectFromCorpse` já lê no `sim`.
            A busca (#764) troca o "todo o catálogo numa `<ul>`" por: marcados no topo, e o resto
            só entra pelo nome — `visibleLootItems` (`loot-filter.ts`) é quem decide. */}
        <div className="automation-loot">
          <Select
            label="Loot"
            size="sm"
            options={[
              { value: 'skip', label: 'Pegar tudo, exceto…' },
              { value: 'accept', label: 'Pegar só…' },
            ]}
            value={loot?.filter ?? 'skip'}
            onChange={(value) => { setLootFilter(value === 'accept' ? 'accept' : 'skip'); }}
          />
          <Input
            size="sm"
            placeholder="Buscar item…"
            value={lootQuery}
            className="automation-loot-search"
            onChange={(event) => { setLootQuery(event.target.value); }}
          />
          {lootRows.rows.length > 0
            ? (
              <ul className="automation-loot-items">
                {lootRows.rows.map((item) => (
                  <li key={item.id} className="automation-loot-row">
                    <span className="automation-loot-row-sprite">
                      <ItemSprite appearanceId={item.appearanceId} name={item.name} />
                    </span>
                    <span className="automation-loot-row-name" title={item.name}>{item.name}</span>
                    <Switch
                      tone="traffic"
                      on={loot?.itemIds.includes(item.id) ?? false}
                      title={`${loot?.filter === 'accept' ? 'Pegar' : 'Ignorar'} ${item.name}`}
                      onChange={() => { toggleLootItem(item.id); }}
                    />
                    {item.value !== undefined && item.value > 0 && (
                      <Switch
                        tone="gold"
                        on={loot?.autoSell.includes(item.id) ?? false}
                        title={`Vender ${item.name} automaticamente ao coletar`}
                        onChange={() => { toggleAutoSellItem(item.id); }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )
            : (
              <p className="quiet automation-loot-empty">
                {lootQuery.trim() === '' ? 'Busque um item para adicionar ao filtro.' : 'Nenhum item encontrado.'}
              </p>
            )}
          {lootRows.truncated && (
            <p className="quiet automation-loot-hint">
              {`${String(lootRows.shownMatches)} de ${String(lootRows.matchCount)} resultados — refine a busca.`}
            </p>
          )}
        </div>
      </Panel>
      {adding && (
        <AddAutomationModal
          onPick={(model) => {
            const draft = blankAutomation(model, items, ammunition);
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
