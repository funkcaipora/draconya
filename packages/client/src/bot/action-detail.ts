// A formatação do painel de detalhe do `ActionConfigModal` (#437, ADR 0033, régua da imagem do
// cliente Tibia anexa à issue #435). PURO: sem React, sem store — o mesmo molde de
// `action-config.ts`. O modal só RENDERIZA o que este arquivo devolve; nenhum número é calculado
// dentro do componente.
//
// A tela não decide resultado (invariante 4): a faixa "min~max" é uma PRÉVIA da mesma fórmula
// que o servidor usa para sortear (`spellPowerRange`, de `@draconya/content`) — a rolagem de
// verdade continua exclusiva do servidor. Campo ausente no catálogo (nó `game` anterior à
// #436) nunca vira número inventado: a linha correspondente é OMITIDA (RF-09).

import { spellPowerRange } from '@draconya/content';
import type { Catalogue, SupplyDefinition } from '../state/hud.js';

export type SpellEntry = Catalogue['bot']['spells'][number];
type EffectDetail = NonNullable<SpellEntry['detail']>;
type Area = NonNullable<EffectDetail['area']>;

export type ActionEntry =
  | { readonly kind: 'spell'; readonly spell: SpellEntry }
  | { readonly kind: 'supply'; readonly supply: SupplyDefinition };

/** As três abas da imagem. Runa é suprimento de ataque; item é o resto (poções). */
export type ActionTab = 'Magias' | 'Runas' | 'Itens';
export const ACTION_TABS: readonly ActionTab[] = ['Magias', 'Runas', 'Itens'];

export function actionTab(entry: ActionEntry): ActionTab {
  if (entry.kind === 'spell') return 'Magias';
  return entry.supply.group === 'attack' ? 'Runas' : 'Itens';
}

function nameOf(entry: ActionEntry): string {
  return entry.kind === 'spell' ? entry.spell.name : entry.supply.name;
}

/** O level exigido: `minLevel` da magia; `requires.level ?? 1` do suprimento. */
export function requiredLevel(entry: ActionEntry): number {
  return entry.kind === 'spell' ? entry.spell.minLevel : entry.supply.requires.level ?? 1;
}

/** O id, dentro do namespace do próprio `kind` — spell e supply não compartilham espaço de id. */
export function actionEntryId(entry: ActionEntry): string {
  return entry.kind === 'spell' ? entry.spell.id : entry.supply.id;
}

/** Todas as entradas de uma aba, por level exigido e depois por nome. Se a vocação for informada, filtra magias. */
export function entriesOf(
  catalogue: Catalogue,
  tab: ActionTab,
  vocationId?: string | null,
): readonly ActionEntry[] {
  const entries: ActionEntry[] = tab === 'Magias'
    ? catalogue.bot.spells
        .filter((spell) => {
          if (vocationId === undefined) return true;
          if (vocationId === null) return spell.vocationId === null;
          return spell.vocationId === null || spell.vocationId === vocationId;
        })
        .map((spell) => ({ kind: 'spell', spell }))
    : (catalogue.bot.supplies ?? [])
      .filter((supply) => (tab === 'Runas' ? supply.group === 'attack' : supply.group !== 'attack'))
      .map((supply) => ({ kind: 'supply', supply }));
  return [...entries].sort((a, b) => {
    const byLevel = requiredLevel(a) - requiredLevel(b);
    return byLevel !== 0 ? byLevel : nameOf(a).localeCompare(nameOf(b));
  });
}

export interface DetailContext {
  readonly level: number;
  readonly magicLevel: number;
  readonly spellPower: Catalogue['bot']['spellPower'] | undefined;
}

export interface ActionDetail {
  readonly title: string;          // "Haste"
  readonly requirement: string;    // "Lv. 14+" | "Lv. 30+ · ML 4+"
  readonly rows: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly description: string;    // description do catálogo, ou o fallback por kind
}

/** Tipo (linha do painel e critério de agrupamento): Cura / Mana / Dano / Suporte. */
const TYPE_LABEL: Readonly<Record<string, string>> = {
  heal: 'Cura', 'heal-over-time': 'Cura',
  mana: 'Mana',
  damage: 'Dano', 'damage-over-time': 'Dano',
  haste: 'Suporte', buff: 'Suporte', 'mana-shield': 'Suporte',
};

function typeOf(effect: string): string {
  return TYPE_LABEL[effect] ?? effect;
}

/** O rótulo da linha de valor: igual ao Tipo, exceto Suporte, que vira "Efeito". */
function valueLabel(effect: string): string {
  const type = typeOf(effect);
  return type === 'Suporte' ? 'Efeito' : type;
}

const DAMAGE_TYPE_LABEL: Readonly<Record<string, string>> = {
  physical: 'Físico', energy: 'Energia', earth: 'Terra', fire: 'Fogo',
  ice: 'Gelo', holy: 'Sagrado', death: 'Morte', arcane: 'Arcano',
};

const GROUP_LABEL: Readonly<Record<string, string>> = {
  attack: 'ataque', healing: 'cura', support: 'suporte', potion: 'poção',
};

function areaLabel(area: Area | undefined): string {
  if (area === undefined) return 'Single';
  switch (area.shape) {
    case 'circle': {
      const side = area.radius * 2 + 1;
      return `${String(side)}x${String(side)}`;
    }
    case 'wave': return `Onda ${String(area.length)}`;
    case 'beam': return `Feixe ${String(area.length)}`;
    case 'cleave': return 'Frontal 3';
    case 'cross': return `Cruz ${String(area.radius)}`;
  }
}

/** `1000 → "1s"`, `1500 → "1,5s"` (vírgula, pt-BR), `33000 → "33s"`. */
function seconds(ms: number): string {
  const value = Math.round((ms / 1000) * 10) / 10;
  const text = Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
  return `${text}s`;
}

function effectOf(entry: ActionEntry): string {
  return entry.kind === 'spell' ? entry.spell.effect : entry.supply.effect;
}

function detailOf(entry: ActionEntry): EffectDetail | undefined {
  return entry.kind === 'spell' ? entry.spell.detail : entry.supply.detail;
}

function costOf(entry: ActionEntry): string {
  return entry.kind === 'spell'
    ? `${String(entry.spell.manaCost)} mana`
    : `${String(entry.supply.price)} gold`;
}

/**
 * `null` quando a magia/o suprimento não tem cooldown a mostrar (RF-09). O sufixo "· grupo X Ys"
 * só aparece quando o cooldown do GRUPO é DIFERENTE do da própria magia — no conteúdo real quase
 * toda magia tem os dois iguais, e repetir o mesmo número com outro rótulo não informa nada
 * (correção de revisão em #437: a tabela da spec só mostra o sufixo no exemplo em que os dois
 * divergem, `1s · grupo cura 2s`; `2000/2000` é só `2s`).
 */
function cooldownOf(entry: ActionEntry): string | null {
  if (entry.kind === 'spell') {
    const { cooldownMs, group, groupCooldownMs } = entry.spell;
    if (cooldownMs === undefined) return null;
    const base = seconds(cooldownMs);
    if (group === undefined || groupCooldownMs === undefined || groupCooldownMs === cooldownMs) return base;
    return `${base} · grupo ${GROUP_LABEL[group] ?? group} ${seconds(groupCooldownMs)}`;
  }
  const { groupCooldownMs } = entry.supply;
  return groupCooldownMs === undefined ? null : seconds(groupCooldownMs);
}

/** O valor da linha Dano/Cura/Efeito, ou `null` para omiti-la (RF-09: sem número inventado). */
function effectValue(entry: ActionEntry, detail: EffectDetail, context: DetailContext): string | null {
  const effect = effectOf(entry);
  if (effect === 'haste' && detail.speedPercent !== undefined && detail.durationMs !== undefined) {
    return `Velocidade +${String(detail.speedPercent)}% por ${seconds(detail.durationMs)}`;
  }
  if (effect === 'buff' && detail.durationMs !== undefined) {
    return `Postura por ${seconds(detail.durationMs)}`;
  }
  if (effect === 'mana-shield' && detail.durationMs !== undefined) {
    return `Escudo de mana por ${seconds(detail.durationMs)}`;
  }
  if (
    (effect === 'damage-over-time' || effect === 'heal-over-time')
    && detail.amount !== undefined && detail.intervalMs !== undefined && detail.durationMs !== undefined
  ) {
    return `${String(detail.amount)} a cada ${seconds(detail.intervalMs)} por ${seconds(detail.durationMs)}`;
  }
  if (detail.basePower !== undefined) {
    if (context.spellPower === undefined) return null;
    const range = spellPowerRange(detail.basePower, context.level, context.magicLevel, context.spellPower);
    return `${String(range.min)}~${String(range.max)}`;
  }
  if (detail.power !== undefined) return String(detail.power);
  if (detail.amount !== undefined) return String(detail.amount);
  return null;
}

const DESCRIPTION_FALLBACK: Readonly<Record<string, string>> = {
  Cura: 'Recupera pontos de vida.',
  Mana: 'Recupera pontos de mana.',
  Dano: 'Causa dano ao alvo.',
  Suporte: 'Aplica um efeito temporário.',
};

function descriptionOf(entry: ActionEntry): string {
  const description = entry.kind === 'spell' ? entry.spell.description : entry.supply.description;
  if (description !== undefined) return description;
  return DESCRIPTION_FALLBACK[typeOf(effectOf(entry))] ?? 'Aplica um efeito temporário.';
}

function requirementOf(entry: ActionEntry): string {
  const level = `Lv. ${String(requiredLevel(entry))}+`;
  if (entry.kind === 'supply' && entry.supply.requires.magicLevel !== undefined) {
    return `${level} · ML ${String(entry.supply.requires.magicLevel)}+`;
  }
  return level;
}

/** Monta o painel de detalhe: a tabela da spec (#435 §6) linha a linha. */
export function actionDetail(entry: ActionEntry, context: DetailContext): ActionDetail {
  const effect = effectOf(entry);
  const detail = detailOf(entry);
  const rows: Array<{ label: string; value: string }> = [{ label: 'Tipo', value: typeOf(effect) }];

  if (detail !== undefined) {
    rows.push({ label: 'Área', value: areaLabel(detail.area) });
    if (typeOf(effect) === 'Dano' && detail.damageType !== undefined) {
      rows.push({ label: 'Tipo de dano', value: DAMAGE_TYPE_LABEL[detail.damageType] ?? detail.damageType });
    }
    const value = effectValue(entry, detail, context);
    if (value !== null) rows.push({ label: valueLabel(effect), value });
  }

  rows.push({ label: 'Custo', value: costOf(entry) });
  const cooldown = cooldownOf(entry);
  if (cooldown !== null) rows.push({ label: 'Cooldown', value: cooldown });

  return {
    title: nameOf(entry),
    requirement: requirementOf(entry),
    rows,
    description: descriptionOf(entry),
  };
}
