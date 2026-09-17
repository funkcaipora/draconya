// Cyclopedia — modal com a aba Bestiary (#321, RC-08, ADR 0030 decisão 3). Itens e Bosstiary
// não aparecem antes dos respectivos sistemas; busca, grade/lista e ordenação são apresentação
// local sobre `catalogue` e `bestiary`, sem mensagem ao servidor.

import { useMemo, useState } from 'react';
import type { BestiaryConfig, BestiaryCounts, MonsterListing } from '../state/hud.js';
import { useHudSlice } from '../state/useSlice.js';
import { bonusPercent, progressOf } from './bestiary-progress.js';
import type { BestiaryProgress } from './bestiary-progress.js';
import { Badge } from './ui/Badge.js';
import { Button } from './ui/Button.js';
import { IconButton } from './ui/IconButton.js';
import { Input } from './ui/Input.js';
import { Kicker } from './ui/Kicker.js';
import { Modal } from './ui/Modal.js';
import { Select } from './ui/Select.js';

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const percentFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const collator = new Intl.Collator('pt-BR');

const count = (value: number): string => integer.format(value);
const bonusText = (value: number): string => `+${percentFmt.format(value)} %`;

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

function BestiaryTab({ monsters, counts, config }: {
  monsters: readonly MonsterListing[]; counts: BestiaryCounts; config: BestiaryConfig | null;
}) {
  const [query, setQuery] = useState('');
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
        <Input size="sm" placeholder="Digite para buscar…" value={query}
          onChange={(event) => { setQuery(event.target.value); }} />
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

export function CyclopediaModal({ onClose }: { onClose: () => void }) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const counts = useHudSlice((state) => state.bestiary);
  const monsters = catalogue?.monsters ?? [];
  const config = catalogue?.bestiary ?? null;
  // Entre catálogo e `bestiary` do attach, ausência significa zero — a mesma convenção da tela
  // anterior, não uma terceira tela intermediária.
  const known = counts ?? {};
  const bonus = config === null
    ? null
    : bonusPercent(known, config.milestones, config.xpBonusPercentPerMilestone);
  const reached = config === null
    ? 0
    : monsters.reduce((sum, monster) => sum + progressOf(known[monster.id] ?? 0, config.milestones).reached, 0);
  const total = config === null ? 0 : monsters.length * config.milestones.length;
  const footerNote = catalogue === null
    ? 'Carregando…'
    : monsters.length === 0
      ? 'Este servidor não tem Bestiário.'
      : bonus === null
        ? `${count(monsters.length)} monstros no Bestiário`
        : `Bônus do Bestiário: ${bonusText(bonus)} de experiência (${count(reached)} / ${count(total)} marcos)`;

  return (
    <Modal
      open
      title="Cyclopedia"
      meta="Os registros do jogo"
      onClose={onClose}
      width={860}
      height={600}
      footer={
        <>
          <span className="cyclopedia-modal-footer-note">{footerNote}</span>
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
        </>
      }
    >
      {/* Só Bestiary existe hoje; uma aba única seria ruído e afirmaria sistemas ausentes. */}
      {catalogue === null
        ? <p className="cyclopedia-modal-empty">Carregando…</p>
        : monsters.length === 0
          ? <p className="cyclopedia-modal-empty">Este servidor não tem Bestiário.</p>
          : <BestiaryTab monsters={monsters} counts={known} config={config} />}
    </Modal>
  );
}
