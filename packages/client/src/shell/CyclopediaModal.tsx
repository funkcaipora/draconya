// Cyclopedia — modal com as abas Itens, Bestiary, Bosstiary e Charms (#321, #344, RC-08, ADR 0030
// decisão 3, #602, #629). Busca, grade/lista e ordenação são apresentação local sobre `catalogue`,
// `bestiary` e `bosstiary`, sem mensagem ao servidor — só os Charms mandam intenção.

import { useMemo, useState } from 'react';
import { sendIntent } from '../net/current.js';
import type {
  BestiaryConfig, BestiaryCounts, BosstiaryConfig, BosstiaryRegister, CharmDefinition, CharmsRegister,
  ItemDefinition, MonsterListing,
} from '../state/hud.js';
import { useHudSlice } from '../state/useSlice.js';
import {
  bestiaryStageOf, bonusPercent, charmPointsEarned, progressOf,
} from './bestiary-progress.js';
import type { BestiaryCharmThresholds, BestiaryProgress, BestiaryStage } from './bestiary-progress.js';
import { bossesKilled, bossesOf, bossProgressOf, killsOfBoss } from './bosstiary-progress.js';
import type { BossListing, BossProgress, BossRarity } from './bosstiary-progress.js';
import { charmPointsAvailable, echoesAvailable, nextTierCost } from './charms-progress.js';
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
const weightFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const collator = new Intl.Collator('pt-BR');

const count = (value: number): string => integer.format(value);
const bonusText = (value: number): string => `+${percentFmt.format(value)} %`;

export type CyclopediaTab = 'Itens' | 'Bestiary' | 'Bosstiary' | 'Charms';
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
  /**
   * O estágio da ficha do Canary (#601, ADR 0053 d.1) — 0 sem ficha ainda. `null` sem
   * `monster.bestiary`: o catálogo não trouxe a ficha deste monstro (nó `game` anterior a esta
   * issue). Independente de `progress`/`goal`/`done` acima, que continuam sendo os marcos de XP.
   */
  readonly stage: BestiaryStage | null;
}

/** O rótulo curto de cada estágio da ficha do Canary, na ordem 0 → 3. */
const STAGE_TEXT: readonly string[] = ['Bloqueado', '1º desbloqueio', '2º desbloqueio', 'Completo'];

/** "Comum" a "muito raro" (Canary `Occurrence`, 0 a 3) — o mesmo vocabulário do Cyclopedia real. */
const OCCURRENCE_TEXT: readonly string[] = ['Comum', 'Incomum', 'Raro', 'Muito raro'];

/** Prepara uma entrada para as duas vistas, sem duplicar a regra de marcos do Bestiário. */
export function entryOf(
  monster: MonsterListing, kills: number, config: BestiaryConfig | null,
): BestiaryEntry {
  const stage = monster.bestiary === undefined ? null : bestiaryStageOf(kills, monster.bestiary);
  if (config === null || config.milestones.length === 0) {
    return {
      monster, kills, progress: { reached: 0, next: null }, goal: 0, done: false, percent: 0, stage,
    };
  }
  const progress = progressOf(kills, config.milestones);
  const lastMilestone = config.milestones[config.milestones.length - 1] ?? 0;
  const goal = progress.next ?? lastMilestone;
  const done = progress.next === null;
  const percent = done ? 100 : Math.min(100, (kills / goal) * 100);
  return { monster, kills, progress, goal, done, percent, stage };
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

/**
 * Os pontos de Charm ganhos por todos os monstros VISÍVEIS nesta lista (#601, ADR 0053 d.1) —
 * a mesma restrição de `bonusPercent`, que só soma marco de monstro no catálogo: sem a ficha
 * (`toKill`/`charmsPoints`) não há como saber quanto um monstro fora do catálogo valeria.
 */
function charmPointsOf(entries: readonly BestiaryEntry[], counts: BestiaryCounts): number {
  const thresholds: Record<string, BestiaryCharmThresholds> = {};
  for (const entry of entries) {
    if (entry.monster.bestiary !== undefined) thresholds[entry.monster.id] = entry.monster.bestiary;
  }
  return charmPointsEarned(counts, thresholds);
}

function ProgressBox({ entries, config, counts }: {
  entries: readonly BestiaryEntry[]; config: BestiaryConfig; counts: BestiaryCounts;
}) {
  const total = entries.length * config.milestones.length;
  const reached = entries.reduce((sum, entry) => sum + entry.progress.reached, 0);
  const percent = total > 0 ? Math.round((reached / total) * 100) : 0;
  const bonus = bonusPercent(counts, config.milestones, config.xpBonusPercentPerMilestone);
  const charmPoints = charmPointsOf(entries, counts);
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
      {/* Os marcos de XP (FUN-113) e os Charms do Canary (#601) são DOIS vocabulários de
          progresso — ADR 0053 d.2 registra a divergência —, e por isso duas linhas distintas
          em vez de uma soma que nenhum dos dois sistemas explicaria sozinho. */}
      <span className="cyclopedia-modal-progress-note">
        {'Bônus: '}<b>{bonusText(bonus)}</b>{' de experiência'}
      </span>
      <span className="cyclopedia-modal-progress-note">
        {'Pontos de Charm: '}<b>{count(charmPoints)}</b>
      </span>
    </section>
  );
}

/** Sem `appearanceId` no catálogo, o lugar do sprite segue como placeholder tracejado do kit. */
function EntrySprite({ className }: { className: string }) {
  return <span className={className} aria-hidden="true" />;
}

/** As estrelas de dificuldade do Canary (0 a 5) — cheia até `stars`, vazia depois. */
function DifficultyStars({ stars }: { stars: number }) {
  return (
    <span className="cyclopedia-modal-card-difficulty" title={`Dificuldade ${String(stars)}/5`}>
      {Array.from({ length: 5 }, (_, index) => (index < stars ? '★' : '☆')).join('')}
    </span>
  );
}

function EntryCard({ entry }: { entry: BestiaryEntry }) {
  const {
    monster, kills, goal, done, percent, progress, stage,
  } = entry;
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
      {/* A ficha do Canary (#601): estágio, estrelas de dificuldade e ocorrência — à PARTE do
          marco de XP acima (o "★N" é o milestone global do FUN-113, não a dificuldade). */}
      {monster.bestiary !== undefined && stage !== null && (
        <span className="cyclopedia-modal-card-bestiary">
          <DifficultyStars stars={monster.bestiary.stars} />
          <span className="cyclopedia-modal-card-stage">{STAGE_TEXT[stage]}</span>
          <span className="cyclopedia-modal-card-occurrence">{OCCURRENCE_TEXT[monster.bestiary.occurrence]}</span>
        </span>
      )}
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
  const {
    monster, kills, goal, done, percent, stage,
  } = entry;
  return (
    <div className="cyclopedia-modal-row">
      <EntrySprite className="cyclopedia-modal-row-sprite" />
      <b>{monster.name}</b>
      {monster.bestiary !== undefined && stage !== null && (
        <span className="cyclopedia-modal-row-bestiary">
          <DifficultyStars stars={monster.bestiary.stars} />
          <span className="cyclopedia-modal-card-stage">{STAGE_TEXT[stage]}</span>
        </span>
      )}
      <i className="cyclopedia-modal-row-track">
        <i className={`cyclopedia-modal-row-fill${done ? ' cyclopedia-modal-fill-done' : ''}`}
          style={{ width: `${String(percent)}%` }} />
      </i>
      <span className={done ? 'cyclopedia-modal-count-done' : ''}>{count(kills)} / {count(goal)}</span>
    </div>
  );
}

function BestiaryTab({ monsters, counts, config, query }: {
  monsters: readonly MonsterListing[]; counts: BestiaryCounts; config: BestiaryConfig | null;
  /** Busca do modal (SV-08): a mesma que a aba Itens usa, vinda de cima em vez de local. */
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

// O Bosstiary (#629, ADR 0052 d.1): o registro paralelo de bosses. Só leitura — o servidor conta o
// abate e fecha o nível (`sim/bosstiary.ts`); a tela deriva nível e "quanto falta" do registro cru e
// da tabela do catálogo (`bosstiary-progress.ts`). Boss Slot e boss boosted ficam para o sistema de
// bosses (`docs/product/bosses.md`), por isso não há intenção nenhuma aqui.

export type BosstiarySort = 'kills' | 'name' | 'rarity';

const BOSSTIARY_SORT_OPTIONS: ReadonlyArray<{ value: BosstiarySort; label: string }> = [
  { value: 'kills', label: 'Abates' },
  { value: 'name', label: 'Nome (A – Z)' },
  { value: 'rarity', label: 'Raridade' },
];

/** Os nomes de exibição das três raridades — Nemesis é a mais rara. */
const RARITY_TEXT: Record<BossRarity, string> = { bane: 'Bane', archfoe: 'Archfoe', nemesis: 'Nemesis' };
const RARITY_ORDER: Record<BossRarity, number> = { bane: 0, archfoe: 1, nemesis: 2 };

export interface BossEntry {
  readonly boss: BossListing;
  readonly progress: BossProgress;
}

/** Prepara a linha de um boss: os abates do registro cru e o nível derivado da tabela. */
export function bossEntryOf(
  boss: BossListing, kills: Readonly<Record<string, number>>, config: BosstiaryConfig | null,
): BossEntry {
  return { boss, progress: bossProgressOf(killsOfBoss(kills, boss), boss.rarity, config) };
}

/** Busca por nome — a MESMA regra de `filterEntries`, agora sobre os bosses. */
export function filterBosses(entries: readonly BossEntry[], query: string): BossEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...entries];
  return entries.filter((entry) => entry.boss.name.toLowerCase().includes(needle));
}

/** Abates descem (com o nome desempatando); por raridade, a mais rara primeiro. */
export function sortBosses(entries: readonly BossEntry[], sort: BosstiarySort): BossEntry[] {
  const sorted = [...entries];
  const byName = (a: BossEntry, b: BossEntry) => collator.compare(a.boss.name, b.boss.name);
  if (sort === 'name') return sorted.sort(byName);
  if (sort === 'rarity') {
    return sorted.sort((a, b) => RARITY_ORDER[b.boss.rarity] - RARITY_ORDER[a.boss.rarity] || byName(a, b));
  }
  return sorted.sort((a, b) => b.progress.kills - a.progress.kills || byName(a, b));
}

function BossRow({ entry }: { entry: BossEntry }) {
  const { boss, progress } = entry;
  const done = progress.level === 3;
  return (
    <div className="cyclopedia-modal-row cyclopedia-modal-boss-row">
      <EntrySprite className="cyclopedia-modal-row-sprite" />
      <b>{boss.name}</b>
      <span className="cyclopedia-modal-row-bestiary">
        <Badge tone={boss.rarity === 'bane' ? 'muted' : 'gold'} dot={false}>{RARITY_TEXT[boss.rarity]}</Badge>
        <span className="cyclopedia-modal-card-stage">{`Nível ${String(progress.level)}/3`}</span>
      </span>
      <i className="cyclopedia-modal-row-track">
        <i className={`cyclopedia-modal-row-fill${done ? ' cyclopedia-modal-fill-done' : ''}`}
          style={{ width: `${String(progress.percent)}%` }} />
      </i>
      <span className={done ? 'cyclopedia-modal-count-done' : ''}>
        {progress.nextKills === null ? `✓ ${count(progress.kills)}` : `${count(progress.kills)} / ${count(progress.nextKills)}`}
      </span>
    </div>
  );
}

function BosstiaryTab({ bosses, register, config, query }: {
  bosses: readonly BossListing[]; register: BosstiaryRegister | null; config: BosstiaryConfig | null;
  /** Busca do modal (SV-08): a mesma das outras abas, vinda de cima. */
  query: string;
}) {
  const [sort, setSort] = useState<BosstiarySort>('kills');
  const kills = register?.kills ?? {};
  const entries = useMemo(
    () => bosses.map((boss) => bossEntryOf(boss, kills, config)),
    [bosses, kills, config],
  );
  const visible = useMemo(() => sortBosses(filterBosses(entries, query), sort), [entries, query, sort]);
  const mastered = entries.filter((entry) => entry.progress.level === 3).length;

  return (
    <div className="cyclopedia-modal-body">
      <div className="cyclopedia-modal-sidebar">
        <section className="cyclopedia-modal-progress">
          <Kicker tone="muted">Progresso no Bosstiary</Kicker>
          <span className="cyclopedia-modal-progress-note">
            {'Pontos de boss: '}<b>{count(register?.points ?? 0)}</b>
          </span>
          <span className="cyclopedia-modal-progress-note">
            {'Bosses abatidos: '}<b>{`${count(bossesKilled(bosses, kills))} / ${count(bosses.length)}`}</b>
          </span>
          {config !== null && (
            <span className="cyclopedia-modal-progress-note">
              {'Nível máximo: '}<b>{count(mastered)}</b>
            </span>
          )}
        </section>
      </div>
      <div className="cyclopedia-modal-main">
        <div className="cyclopedia-modal-toolbar">
          <Kicker className="cyclopedia-modal-toolbar-title">Todos os bosses do Bosstiary</Kicker>
          <span className="cyclopedia-modal-toolbar-label">Ordenar por:</span>
          <span className="cyclopedia-modal-sort">
            <Select options={BOSSTIARY_SORT_OPTIONS} value={sort} size="sm"
              onChange={(value) => { setSort(value as BosstiarySort); }} />
          </span>
        </div>
        {visible.length === 0
          ? <p className="cyclopedia-modal-empty">Nenhum boss encontrado.</p>
          : (
            <div className="cyclopedia-modal-grid cyclopedia-modal-grid-list cyclopedia-modal-boss-list">
              {visible.map((entry) => <BossRow key={entry.boss.raceId} entry={entry} />)}
            </div>
          )}
      </div>
    </div>
  );
}

/**
 * Categoria de exibição — pelo `slot` (DT-04): reaproveita o mesmo rótulo do painel do set
 * (`SLOT_TEXT`) em vez de inventar um segundo texto para o mesmo slot. Sem slot (comida, moeda
 * antiga), "Outros" — nunca `null`/`undefined` na tela.
 */
export function categoryOf(item: ItemDefinition): string {
  if (item.slot === null) return 'Outros';
  return SLOT_TEXT[item.slot] ?? item.slot;
}

/**
 * Busca por nome, case-insensitive — a MESMA regra de `filterEntries` (acima), agora sobre
 * `catalogue.items` em vez de monstros. Query vazia devolve todos, na mesma ordem.
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
        {/* Ataque e armadura são opcionais no protocolo (#337): só aparecem quando > 0. */}
        {attack > 0 && <Badge tone="muted" dot={false}>{`⚔ Atq ${String(attack)}`}</Badge>}
        {armor > 0 && <Badge tone="muted" dot={false}>{`⛨ Def ${String(armor)}`}</Badge>}
        <span className="cyclopedia-modal-item-weight">{`⚖ ${weightFmt.format(item.weight)} oz`}</span>
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

/** "N itens no catálogo" sem busca, "N de M itens" com — a mesma dupla forma do rodapé de sempre. */
export function itemsFooterNote(items: readonly ItemDefinition[], query: string): string {
  const total = items.length;
  const needle = query.trim().toLowerCase();
  if (needle === '') return `${count(total)} itens no catálogo`;
  const visible = items.filter((item) => item.name.toLowerCase().includes(needle)).length;
  return `${count(visible)} de ${count(total)} itens`;
}

// A economia de Charms (M39-02, #602, ADR 0052/0053): terceira aba do Cyclopedia. INTENÇÃO
// (invariante 4) — cada botão manda `charm-unlock`/`charm-assign`/`charm-remove`, e o servidor
// decide (custo, slot, ficha completa); a recusa vira `system-message`, como o resto do kit. A
// tela nunca calcula se algo é aceito, só o que já foi pago e o que falta.

const CHARM_CATEGORY_TEXT: Record<CharmDefinition['category'], string> = { major: 'Major', minor: 'Minor' };
const CHARM_TYPE_TEXT: Record<CharmDefinition['type'], string> = {
  offensive: 'Ofensivo', defensive: 'Defensivo', passive: 'Passivo',
};

function CharmRow({ charm, register, monsters }: {
  charm: CharmDefinition; register: CharmsRegister; monsters: readonly MonsterListing[];
}) {
  const tier = (register.tiers[charm.id] ?? 0) as 0 | 1 | 2 | 3;
  const assignedTo = register.assignments[charm.id];
  const cost = nextTierCost(charm, tier);
  const [target, setTarget] = useState('');
  const monsterOptions = monsters.map((monster) => ({ value: monster.id, label: monster.name }));

  return (
    <article className="cyclopedia-modal-charm-row">
      <span className="cyclopedia-modal-charm-name">
        <b>{charm.name}</b>
        <Badge tone={charm.category === 'major' ? 'gold' : 'muted'} dot={false}>
          {CHARM_CATEGORY_TEXT[charm.category]}
        </Badge>
        <Badge tone="muted" dot={false}>{CHARM_TYPE_TEXT[charm.type]}</Badge>
      </span>
      <span className="cyclopedia-modal-charm-tier">{`Tier ${String(tier)}/3`}</span>
      <span className="cyclopedia-modal-charm-target">
        {assignedTo === undefined ? 'Não atribuído' : `Em: ${monsters.find((m) => m.id === assignedTo)?.name ?? assignedTo}`}
      </span>
      <span className="cyclopedia-modal-charm-actions">
        {cost !== null && (
          <Button variant="secondary" size="sm"
            onClick={() => { sendIntent({ type: 'charm-unlock', charmId: charm.id }); }}
          >
            {`Desbloquear (${String(cost)} ${charm.category === 'major' ? 'pts' : 'echoes'})`}
          </Button>
        )}
        {tier > 0 && (
          <>
            <Select
              options={[{ value: '', label: 'Escolher monstro…' }, ...monsterOptions]}
              value={target}
              size="sm"
              onChange={(value) => { setTarget(value); }}
            />
            <Button
              variant="secondary" size="sm" disabled={target === ''}
              onClick={() => {
                if (target === '') return;
                sendIntent({ type: 'charm-assign', charmId: charm.id, monsterId: target });
              }}
            >
              Atribuir
            </Button>
          </>
        )}
        {assignedTo !== undefined && (
          <Button variant="secondary" size="sm"
            onClick={() => { sendIntent({ type: 'charm-remove', charmId: charm.id }); }}
          >
            Remover
          </Button>
        )}
      </span>
    </article>
  );
}

function CharmsTab({ charms, register, monsters, counts }: {
  charms: readonly CharmDefinition[]; register: CharmsRegister; monsters: readonly MonsterListing[];
  counts: BestiaryCounts;
}) {
  const entries: Record<string, BestiaryCharmThresholds> = {};
  for (const monster of monsters) {
    if (monster.bestiary !== undefined) entries[monster.id] = monster.bestiary;
  }
  const pointsAvailable = charmPointsAvailable(counts, entries, register.pointsSpent);
  const echoesLeft = echoesAvailable(register.tiers, charms, register.echoesSpent);
  const assignedCount = Object.keys(register.assignments).length;

  if (charms.length === 0) {
    return <p className="cyclopedia-modal-empty">Este servidor não tem Charms.</p>;
  }
  return (
    <div className="cyclopedia-modal-body">
      <div className="cyclopedia-modal-sidebar">
        <section className="cyclopedia-modal-progress">
          <Kicker tone="muted">Economia de Charms</Kicker>
          <span className="cyclopedia-modal-progress-note">
            {'Pontos disponíveis: '}<b>{count(pointsAvailable)}</b>
          </span>
          <span className="cyclopedia-modal-progress-note">
            {'Minor Charm Echoes: '}<b>{count(echoesLeft)}</b>
          </span>
          <span className="cyclopedia-modal-progress-note">
            {'Atribuídos: '}<b>{count(assignedCount)}</b>
          </span>
        </section>
      </div>
      <div className="cyclopedia-modal-main">
        <div className="cyclopedia-modal-charm-list">
          {charms.map((charm) => (
            <CharmRow key={charm.id} charm={charm} register={register} monsters={monsters} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function CyclopediaModal({ onClose, initialTab }: { onClose: () => void; initialTab?: CyclopediaTab }) {
  const catalogue = useHudSlice((state) => state.catalogue);
  const counts = useHudSlice((state) => state.bestiary);
  const charmsRegister = useHudSlice((state) => state.charms);
  const bosstiaryRegister = useHudSlice((state) => state.bosstiary);
  const [tab, setTab] = useState<CyclopediaTab>(initialTab ?? 'Bestiary');
  const [query, setQuery] = useState('');

  const allMonsters = catalogue?.monsters ?? [];
  // Boss não conta no Bestiário (`Player::addBestiaryKill` devolve cedo para `isBoss()`): ele é do
  // Bosstiary (#629). A lista do Bestiário e os alvos de Charm são só os monstros comuns.
  const monsters = useMemo(() => allMonsters.filter((monster) => monster.bosstiary === undefined), [allMonsters]);
  const bosses = useMemo(() => bossesOf(allMonsters), [allMonsters]);
  const bosstiaryConfig = catalogue?.bosstiary ?? null;
  const items = catalogue?.items ?? [];
  const charms = catalogue?.charms ?? [];
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
  const bestiaryFooterNote = monsters.length === 0
    ? 'Este servidor não tem Bestiário.'
    : bonus === null
      ? `${count(monsters.length)} monstros no Bestiário`
      : `Bônus do Bestiário: ${bonusText(bonus)} de experiência (${count(reached)} / ${count(total)} marcos)`;
  const charmsFooterNote = charms.length === 0
    ? 'Este servidor não tem Charms.'
    : `${count(charms.length)} Charms no catálogo`;
  const bosstiaryFooterNote = bosses.length === 0
    ? 'Este servidor não tem Bosstiary.'
    : `${count(bosses.length)} ${bosses.length === 1 ? 'boss' : 'bosses'} no Bosstiary`;
  const footerNote = catalogue === null
    ? 'Carregando…'
    : tab === 'Itens'
      ? itemsFooterNote(items, query)
      : tab === 'Charms'
        ? charmsFooterNote
        : tab === 'Bosstiary'
          ? bosstiaryFooterNote
          : bestiaryFooterNote;

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
      {catalogue === null
        ? <p className="cyclopedia-modal-empty">Carregando…</p>
        : (
          <>
            {/* Busca única do modal (SV-08), acima das abas: filtra a aba ativa (Itens, Bestiary ou Bosstiary). */}
            <Input
              size="sm"
              placeholder="Digite para buscar…"
              value={query}
              className="cyclopedia-modal-search"
              onChange={(event) => { setQuery(event.target.value); }}
            />
            <Tabs
              items={['Itens', 'Bestiary', 'Bosstiary', 'Charms']}
              value={tab}
              className="cyclopedia-modal-tabs"
              onChange={(value) => { setTab(value as CyclopediaTab); }}
            />
            {tab === 'Itens' && <ItemsTab items={items} query={query} />}
            {tab === 'Bestiary' && (monsters.length === 0
              ? <p className="cyclopedia-modal-empty">Este servidor não tem Bestiário.</p>
              : <BestiaryTab monsters={monsters} counts={known} config={config} query={query} />)}
            {tab === 'Bosstiary' && (bosses.length === 0
              ? <p className="cyclopedia-modal-empty">Este servidor não tem Bosstiary.</p>
              : (
                <BosstiaryTab
                  bosses={bosses} register={bosstiaryRegister} config={bosstiaryConfig} query={query}
                />
              ))}
            {tab === 'Charms' && (
              <CharmsTab
                charms={charms}
                register={charmsRegister ?? { pointsSpent: 0, echoesSpent: 0, tiers: {}, assignments: {} }}
                monsters={monsters}
                counts={known}
              />
            )}
          </>
        )}
    </Modal>
  );
}
