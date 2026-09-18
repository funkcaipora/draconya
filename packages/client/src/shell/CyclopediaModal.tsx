// Cyclopedia — modal com abas Itens e Bestiary (#321, #344, RC-08, ADR 0030 decisão 3). Bosstiary
// não aparece antes do respectivo sistema; busca, grade/lista e ordenação são apresentação
// local sobre `catalogue` e `bestiary`, sem mensagem ao servidor.

import { useMemo, useState } from 'react';
import type { BestiaryConfig, BestiaryCounts, ItemDefinition, MonsterListing } from '../state/hud.js';
import { useHudSlice } from '../state/useSlice.js';
import { bonusPercent, progressOf } from './bestiary-progress.js';
import type { BestiaryProgress } from './bestiary-progress.js';
import { SLOT_TEXT } from './EquipmentPanel.js';
import { ItemSprite } from './ItemSprite.js';
import { Badge } from './ui/Badge.js';
import { Button } from './ui/Button.js';
import { IconButton } from './ui/IconButton.js';
import { Input } from './ui/Input.js';
import { Kicker } from './ui/Kicker.js';
import { Modal } from './ui/Modal.js';
import { Select } from './ui/Select.js';
import { Tabs } from './ui/Tabs.js';

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const percentFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const collator = new Intl.Collator('pt-BR');
const weightFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

const count = (value: number): string => integer.format(value);
const bonusText = (value: number): string => `+${percentFmt.format(value)} %`;

export type CyclopediaTab = 'Itens' | 'Bestiary';
export type BestiarySort = 'progress' | 'name' | 'kills';

const SORT_OPTIONS: ReadonlyArray<{ value: BestiarySort; label: string }> = [
  { value: 'progress', label: 'Progresso (% maior)' },
  { value: 'name', label: 'Nome (A – Z)' },
  { value: 'kills', label: 'Abates' },
];

export interface BestiaryEntry {
  readonly monster: MonsterListing;
  readonly kills: number;
  readonly progress: BestiaryProgress;
  /** Meta da barra: próximo marco, ou o último quando todos já foram alcançados. */
  readonly goal: number;
  readonly done: boolean;
  readonly percent: number;
}

/** Prepara uma entrada para as duas vistas, sem duplicar a regra de marcos do Bestiário. */
export function entryOf(
  monster: MonsterListing, kills: number, config: BestiaryConfig | null,
): BestiaryEntry {
  if (config === null || config.milestones.length === 0) {
    return { monster, kills, progress: { reached: 0, next: null }, goal: 0, done: false, percent: 0 };
  }
  const progress = progressOf(kills, config.milestones);
  const lastMilestone = config.milestones[config.milestones.length - 1] ?? 0;
  const goal = progress.next ?? lastMilestone;
  const done = progress.next === null;
  const percent = done ? 100 : Math.min(100, (kills / goal) * 100);
  return { monster, kills, progress, goal, done, percent };
}

/** Busca por nome, sem categoria até o catálogo transportar essa dimensão (SV-20). */
export function filterEntries(entries: readonly BestiaryEntry[], query: string): BestiaryEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...entries];
  return entries.filter((entry) => entry.monster.name.toLowerCase().includes(needle));
}

/** Progresso e abates descem; por nome, o collator preserva a ordem pt-BR. */
export function sortEntries(entries: readonly BestiaryEntry[], sort: BestiarySort): BestiaryEntry[] {
  const sorted = [...entries];
  if (sort === 'name') return sorted.sort((a, b) => collator.compare(a.monster.name, b.monster.name));
  if (sort === 'kills') return sorted.sort((a, b) => b.kills - a.kills);
  return sorted.sort((a, b) => b.percent - a.percent || b.progress.reached - a.progress.reached);
}

function ProgressBox({ entries, config, counts }: {
  entries: readonly BestiaryEntry[]; config: BestiaryConfig; counts: BestiaryCounts;
}) {
  const total = entries.length * config.milestones.length;
  const reached = entries.reduce((sum, entry) => sum + entry.progress.reached, 0);
  const percent = total > 0 ? Math.round((reached / total) * 100) : 0;
  const bonus = bonusPercent(counts, config.milestones, config.xpBonusPercentPerMilestone);
  return (
    <section className="cyclopedia-modal-progress">
      <Kicker tone="muted">Progresso no Bestiário</Kicker>
      <div className="cyclopedia-modal-progress-head">
        <span>{`${count(reached)} / ${count(total)}`}</span>
        <span className="cyclopedia-modal-progress-pct">{`${String(percent)}%`}</span>
      </div>
      <i className="cyclopedia-modal-progress-track">
        <i className="cyclopedia-modal-progress-fill" style={{ width: `${String(percent)}%` }} />
      </i>
      <span className="cyclopedia-modal-progress-note">
        {'Bônus: '}<b>{bonusText(bonus)}</b>{' de experiência'}
      </span>
    </section>
  );
}

/** Sem `appearanceId` no catálogo, o lugar do sprite segue como placeholder tracejado do kit. */
function EntrySprite({ className }: { className: string }) {
  return <span className={className} aria-hidden="true" />;
}

function EntryCard({ entry }: { entry: BestiaryEntry }) {
  const { monster, kills, goal, done, percent, progress } = entry;
  return (
    <article className="cyclopedia-modal-card">
      <b className="cyclopedia-modal-card-name">{monster.name}</b>
      <span className="cyclopedia-modal-card-sprite-wrap">
        <EntrySprite className="cyclopedia-modal-card-sprite" />
        {progress.reached > 0 && (
          <Badge tone="gold" dot={false} className="cyclopedia-modal-card-star">
            {`★${String(progress.reached)}`}
          </Badge>
        )}
      </span>
      <span className={`cyclopedia-modal-card-count${done ? ' cyclopedia-modal-count-done' : ''}`}>
        {done ? '✓ ' : ''}{count(kills)} / {count(goal)}
      </span>
      <i className="cyclopedia-modal-card-track">
        <i className={`cyclopedia-modal-card-fill${done ? ' cyclopedia-modal-fill-done' : ''}`}
          style={{ width: `${String(percent)}%` }} />
      </i>
    </article>
  );
}

function EntryRow({ entry }: { entry: BestiaryEntry }) {
  const { monster, kills, goal, done, percent } = entry;
  return (
    <div className="cyclopedia-modal-row">
      <EntrySprite className="cyclopedia-modal-row-sprite" />
      <b>{monster.name}</b>
      <i className="cyclopedia-modal-row-track">
        <i className={`cyclopedia-modal-row-fill${done ? ' cyclopedia-modal-fill-done' : ''}`}
          style={{ width: `${String(percent)}%` }} />
      </i>
      <span className={done ? 'cyclopedia-modal-count-done' : ''}>{count(kills)} / {count(goal)}</span>
    </div>
  );
}

/**
 * Categoria de exibição — pelo `slot` (§9, DT-04): reaproveita o mesmo rótulo do painel do
 * set em vez de inventar um segundo texto para o mesmo `ItemSlot`. Sem slot (comida, moeda
 * antiga), "Outros" — nunca `null`/`undefined` na tela.
 */
export function categoryOf(item: ItemDefinition): string {
  if (item.slot === null) return 'Outros';
  return SLOT_TEXT[item.slot] ?? item.slot;
}

/**
 * Busca por nome, case-insensitive — a MESMA regra de `filterEntries` (linha acima), agora
 * sobre `catalogue.items` em vez de monstros. Query vazia devolve todos, na mesma ordem.
 */
export function filterItems(items: readonly ItemDefinition[], query: string): ItemDefinition[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...items];
  return items.filter((item) => item.name.toLowerCase().includes(needle));
}

function ItemRow({ item }: { item: ItemDefinition }) {
  const category = categoryOf(item);
  const attack = item.attack ?? 0;
  const armor = item.armor ?? 0;
  return (
    <article className="cyclopedia-modal-item-row">
      <span className="cyclopedia-modal-item-sprite">
        <ItemSprite appearanceId={item.appearanceId} name={item.name} />
      </span>
      <span className="cyclopedia-modal-item-info">
        <b className="cyclopedia-modal-item-name">{item.name}</b>
        <span className="cyclopedia-modal-item-category">{category}</span>
      </span>
      <span className="cyclopedia-modal-item-stats">
        {attack > 0 && (
          <Badge tone="muted" dot={false}>{`⚔ Atq ${String(attack)}`}</Badge>
        )}
        {armor > 0 && (
          <Badge tone="muted" dot={false}>{`⛨ Def ${String(armor)}`}</Badge>
        )}
        <span className="cyclopedia-modal-item-weight">
          {`⚖ ${weightFmt.format(item.weight)} oz`}
        </span>
      </span>
    </article>
  );
}

function ItemsTab({ items, query }: { items: readonly ItemDefinition[]; query: string }) {
  const visible = useMemo(() => filterItems(items, query), [items, query]);

  if (visible.length === 0) {
    return <p className="cyclopedia-modal-empty">Nenhum item encontrado.</p>;
  }
  return (
    <div className="cyclopedia-modal-items-list">
      {visible.map((item) => <ItemRow key={item.id} item={item} />)}
    </div>
  );
}

export function itemsFooterNote(items: readonly ItemDefinition[], query: string): string {
  const total = items.length;
  const needle = query.trim().toLowerCase();
  if (needle === '') return `${count(total)} itens no catálogo`;
  const visible = items.filter((item) => item.name.toLowerCase().includes(needle)).length;
  return `${count(visible)} de ${count(total)} itens`;
}

function BestiaryTab({ monsters, counts, config, query }: {
  monsters: readonly MonsterListing[]; counts: BestiaryCounts; config: BestiaryConfig | null;
  query: string;
}) {
  const [grid, setGrid] = useState(true);
  const [sort, setSort] = useState<BestiarySort>('progress');
  const entries = useMemo(
    () => monsters.map((monster) => entryOf(monster, counts[monster.id] ?? 0, config)),
    [monsters, counts, config],
  );
  const visible = useMemo(
    () => sortEntries(filterEntries(entries, query), sort),
    [entries, query, sort],
  );

  return (
    <div className="cyclopedia-modal-body">
      <div className="cyclopedia-modal-sidebar">
        {config !== null && <ProgressBox entries={entries} config={config} counts={counts} />}
      </div>
      <div className="cyclopedia-modal-main">
        <div className="cyclopedia-modal-toolbar">
          <Kicker className="cyclopedia-modal-toolbar-title">Todas as entradas do Bestiário</Kicker>
          <IconButton active={grid} title="Grade" onClick={() => { setGrid(true); }}>▦</IconButton>
          <IconButton active={!grid} title="Lista" onClick={() => { setGrid(false); }}>☰</IconButton>
          <span className="cyclopedia-modal-toolbar-label">Ordenar por:</span>
          <span className="cyclopedia-modal-sort">
            <Select options={SORT_OPTIONS} value={sort} size="sm"
              onChange={(value) => { setSort(value as BestiarySort); }} />
          </span>
          {/* Inerte no kit: sem semântica de produto, o controle não inventa uma ação. */}
          <Button variant="secondary" size="sm" className="cyclopedia-modal-highlight">Destacar</Button>
        </div>
        {visible.length === 0
          ? <p className="cyclopedia-modal-empty">Nenhum monstro encontrado.</p>
          : (
            <div className={`cyclopedia-modal-grid${grid ? '' : ' cyclopedia-modal-grid-list'}`}>
              {visible.map((entry) => (grid
                ? <EntryCard key={entry.monster.id} entry={entry} />
                : <EntryRow key={entry.monster.id} entry={entry} />
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

export function CyclopediaModal({ onClose, initialTab }: { onClose: () => void; initialTab?: CyclopediaTab }) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const counts = useHudSlice((state) => state.bestiary);
  const [tab, setTab] = useState<CyclopediaTab>(initialTab ?? 'Bestiary');
  const [query, setQuery] = useState('');

  const monsters = catalogue?.monsters ?? [];
  const items = catalogue?.items ?? [];
  const config = catalogue?.bestiary ?? null;
  const known = counts ?? {};
  const bonus = config === null
    ? null
    : bonusPercent(known, config.milestones, config.xpBonusPercentPerMilestone);
  const reached = config === null
    ? 0
    : monsters.reduce((sum, monster) => sum + progressOf(known[monster.id] ?? 0, config.milestones).reached, 0);
  const total = config === null ? 0 : monsters.length * config.milestones.length;

  const bestiaryFooterNote = monsters.length === 0
    ? 'Este servidor não tem Bestiário.'
    : bonus === null
      ? `${count(monsters.length)} monstros no Bestiário`
      : `Bônus do Bestiário: ${bonusText(bonus)} de experiência (${count(reached)} / ${count(total)} marcos)`;

  const footerNote = catalogue === null
    ? 'Carregando…'
    : tab === 'Itens'
      ? itemsFooterNote(items, query)
      : bestiaryFooterNote;

  const footer = (
    <>
      <span className="cyclopedia-modal-footer-note">{footerNote}</span>
      <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
    </>
  );

  return (
    <Modal
      open
      title="Cyclopedia"
      meta="Os registros do jogo"
      onClose={onClose}
      width={860}
      height={600}
      footer={footer}
    >
      {catalogue === null
        ? <p className="cyclopedia-modal-empty">Carregando…</p>
        : (
          <>
            <Tabs
              items={['Itens', 'Bestiary']}
              value={tab}
              className="cyclopedia-modal-tabs"
              onChange={(value) => { setTab(value as CyclopediaTab); }}
            />
            <Input
              size="sm"
              placeholder="Digite para buscar…"
              value={query}
              className="cyclopedia-modal-search"
              onChange={(event) => { setQuery(event.target.value); }}
            />
            {tab === 'Bestiary'
              ? (monsters.length === 0
                ? <p className="cyclopedia-modal-empty">Este servidor não tem Bestiário.</p>
                : <BestiaryTab monsters={monsters} counts={known} config={config} query={query} />)
              : <ItemsTab items={items} query={query} />}
          </>
        )}
    </Modal>
  );
}
