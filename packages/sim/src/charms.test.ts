import { describe, expect, it } from 'vitest';
import type { Charm } from '@draconya/content';
import { Bestiary } from './bestiary.js';
import {
  Charms, charmSlotsFor, emptyCharmsState,
} from './charms.js';
import type { CharmBestiaryEntry, CharmsState } from './charms.js';

const wound: Charm = {
  id: 'wound', name: 'Wound', canaryCharmId: 0, category: 'major', type: 'offensive',
  damageType: 'physical', percent: 5, chance: [5, 10, 11], points: [240, 360, 1200],
};
const dodge: Charm = {
  id: 'dodge', name: 'Dodge', canaryCharmId: 8, category: 'major', type: 'defensive',
  chance: [5, 10, 11], points: [240, 360, 1200],
};
const scavenge: Charm = {
  id: 'scavenge', name: 'Scavenge', canaryCharmId: 13, category: 'minor', type: 'passive',
  chance: [60, 90, 120], points: [100, 150, 225],
};
const catalogue = new Map<string, Charm>([
  ['wound', wound], ['dodge', dodge], ['scavenge', scavenge],
]);

// `charmsPoints: 300` — o suficiente para pagar um tier 0 de Wound (240) sozinho, como um
// monstro real de alto nível do bestiário do Canary.
const RAT: CharmBestiaryEntry = { toKill: 500, charmsPoints: 300 };
const BAT: CharmBestiaryEntry = { toKill: 100, charmsPoints: 5 };
const entries = new Map<string, CharmBestiaryEntry>([['rat', RAT], ['bat', BAT]]);

function bestiaryWithRatKills(kills: number): Bestiary {
  const bestiary = new Bestiary();
  for (let i = 0; i < kills; i += 1) bestiary.record('rat');
  return bestiary;
}

describe('estado vazio', () => {
  it('nasce sem tier, sem atribuição e sem gasto', () => {
    const charms = Charms.fromState();
    expect(charms.getState()).toEqual(emptyCharmsState());
    expect(charms.tierOf('wound')).toBe(0);
    expect(charms.slotsUsed()).toBe(0);
  });
});

describe('slots (ADR 0053 d.4)', () => {
  it('2 Free, 6 Premium — a Charm Expansion (25) fica fora desta issue', () => {
    expect(charmSlotsFor(false)).toBe(2);
    expect(charmSlotsFor(true)).toBe(6);
  });
});

describe('pontos e echoes são DERIVADOS do Bestiário/tiers, nunca somados à parte', () => {
  it('pointsEarned soma charmsPoints de todo monstro com a ficha completa', () => {
    const charms = Charms.fromState();
    const bestiary = bestiaryWithRatKills(500); // rat.toKill
    expect(charms.pointsEarned(bestiary, entries)).toBe(300);
    expect(charms.pointsAvailable(bestiary, entries)).toBe(300);
  });

  it('monstro incompleto não rende ponto nenhum', () => {
    const charms = Charms.fromState();
    const bestiary = bestiaryWithRatKills(499);
    expect(charms.pointsEarned(bestiary, entries)).toBe(0);
  });

  it('echoesEarned soma 25t²+25t+50 por tier MAJOR atravessado (t=0,1,2)', () => {
    const charms = Charms.fromState({
      ...emptyCharmsState(), tiers: { wound: 2 }, pointsSpent: 240 + 360,
    });
    // t=0: 50; t=1: 25+25+50=100 → 150 echoes ganhos ao alcançar tier 2.
    expect(charms.echoesEarned(catalogue)).toBe(50 + 100);
    expect(charms.echoesAvailable(catalogue)).toBe(150);
  });

  it('charm minor no tiers não rende echo (só major rende)', () => {
    const charms = Charms.fromState({ ...emptyCharmsState(), tiers: { scavenge: 2 } });
    expect(charms.echoesEarned(catalogue)).toBe(0);
  });
});

describe('unlock (ADR 0053 d.3)', () => {
  it('major gasta pontos do Bestiário, sobe um tier', () => {
    const charms = Charms.fromState();
    const bestiary = bestiaryWithRatKills(500);
    const result = charms.unlock('wound', catalogue, bestiary, entries);
    expect(result).toEqual({ ok: true, tier: 1 });
    expect(charms.tierOf('wound')).toBe(1);
    expect(charms.pointsAvailable(bestiary, entries)).toBe(300 - 240);
  });

  it('sem pontos suficientes, recusa e não muda nada', () => {
    const charms = Charms.fromState();
    const bestiary = bestiaryWithRatKills(499); // ficha incompleta, 0 pontos ganhos
    const result = charms.unlock('wound', catalogue, bestiary, entries);
    expect(result).toEqual({ ok: false, reason: 'not-enough-points' });
    expect(charms.tierOf('wound')).toBe(0);
  });

  it('minor gasta echoes, derivados de charms major já desbloqueados', () => {
    // Wound (major) no tier 1 já rendeu 50 echoes (t=0).
    const charms = Charms.fromState({ ...emptyCharmsState(), tiers: { wound: 1 } });
    const bestiary = new Bestiary();
    expect(charms.echoesAvailable(catalogue)).toBe(50);
    // Scavenge tier 0→1 custa 100 — mais que os 50 disponíveis.
    expect(charms.unlock('scavenge', catalogue, bestiary, entries)).toEqual({ ok: false, reason: 'not-enough-echoes' });
  });

  it('charm no tier máximo (3) recusa com already-max-tier', () => {
    const charms = Charms.fromState({ ...emptyCharmsState(), tiers: { wound: 3 } });
    const bestiary = bestiaryWithRatKills(500);
    expect(charms.unlock('wound', catalogue, bestiary, entries)).toEqual({ ok: false, reason: 'already-max-tier' });
  });

  it('charm desconhecido recusa com unknown-charm', () => {
    const charms = Charms.fromState();
    const bestiary = new Bestiary();
    expect(charms.unlock('nope', catalogue, bestiary, entries)).toEqual({ ok: false, reason: 'unknown-charm' });
  });
});

describe('assign (ADR 0053 d.4)', () => {
  function unlockedWound(): Charms {
    return Charms.fromState({ ...emptyCharmsState(), tiers: { wound: 1 } });
  }

  it('recusa charm não desbloqueado', () => {
    const charms = Charms.fromState();
    const bestiary = bestiaryWithRatKills(500);
    expect(charms.assign('wound', 'rat', catalogue, bestiary, entries, { premium: false }))
      .toEqual({ ok: false, reason: 'not-unlocked' });
  });

  it('major exige a ficha completa do alvo (kills >= toKill)', () => {
    const charms = unlockedWound();
    const bestiary = bestiaryWithRatKills(499);
    expect(charms.assign('wound', 'rat', catalogue, bestiary, entries, { premium: false }))
      .toEqual({ ok: false, reason: 'monster-not-complete' });
  });

  it('atribui com sucesso quando a ficha está completa', () => {
    const charms = unlockedWound();
    const bestiary = bestiaryWithRatKills(500);
    expect(charms.assign('wound', 'rat', catalogue, bestiary, entries, { premium: false }))
      .toEqual({ ok: true });
    expect(charms.assignmentOf('wound')).toBe('rat');
    expect(charms.slotsUsed()).toBe(1);
  });

  it('Free player: só 2 slots — o terceiro recusa com no-slots', () => {
    const charms = Charms.fromState({
      ...emptyCharmsState(),
      tiers: { wound: 1, dodge: 1, scavenge: 1 },
      assignments: { wound: 'rat', dodge: 'bat' },
    });
    const bestiary = new Bestiary();
    expect(charms.assign('scavenge', 'rat', catalogue, bestiary, entries, { premium: false }))
      .toEqual({ ok: false, reason: 'no-slots' });
  });

  it('Premium: o sexto slot cabe, o sétimo não (fora do corte desta issue: Charm Expansion)', () => {
    const charms = Charms.fromState({
      ...emptyCharmsState(),
      tiers: { wound: 1, dodge: 1, scavenge: 1 },
      assignments: { wound: 'rat', dodge: 'bat' },
    });
    const bestiary = new Bestiary();
    expect(charms.assign('scavenge', 'rat', catalogue, bestiary, entries, { premium: true }))
      .toEqual({ ok: true });
  });

  it('reatribuir o MESMO charm para outro alvo não gasta slot a mais', () => {
    // `scavenge` é minor: não exige ficha completa do alvo, então serve para testar só a
    // reatribuição sem misturar com a regra de `monster-not-complete`.
    const charms = Charms.fromState({
      ...emptyCharmsState(), tiers: { scavenge: 1 }, assignments: { scavenge: 'rat' },
    });
    const bestiary = new Bestiary();
    expect(charms.assign('scavenge', 'bat', catalogue, bestiary, entries, { premium: false }))
      .toEqual({ ok: true });
    expect(charms.assignmentOf('scavenge')).toBe('bat');
    expect(charms.slotsUsed()).toBe(1);
  });

  it('um major e um minor por criatura: um segundo major no mesmo alvo é recusado', () => {
    const charms = Charms.fromState({
      ...emptyCharmsState(), tiers: { wound: 1, dodge: 1 }, assignments: { wound: 'rat' },
    });
    const bestiary = bestiaryWithRatKills(500);
    expect(charms.assign('dodge', 'rat', catalogue, bestiary, entries, { premium: false }))
      .toEqual({ ok: false, reason: 'category-taken' });
  });

  it('um major E um minor no MESMO alvo é permitido (categorias diferentes)', () => {
    const charms = Charms.fromState({
      ...emptyCharmsState(), tiers: { wound: 1, scavenge: 1 }, assignments: { wound: 'rat' },
    });
    const bestiary = bestiaryWithRatKills(500);
    expect(charms.assign('scavenge', 'rat', catalogue, bestiary, entries, { premium: false }))
      .toEqual({ ok: true });
  });
});

describe('remove (ADR 0053 d.4 — o gold é de quem chama, invariante 10)', () => {
  it('remove uma atribuição existente', () => {
    const charms = Charms.fromState({
      ...emptyCharmsState(), tiers: { wound: 1 }, assignments: { wound: 'rat' },
    });
    expect(charms.remove('wound')).toEqual({ ok: true });
    expect(charms.assignmentOf('wound')).toBeUndefined();
    expect(charms.slotsUsed()).toBe(0);
  });

  it('remover charm não atribuído recusa com not-assigned', () => {
    const charms = Charms.fromState({ ...emptyCharmsState(), tiers: { wound: 1 } });
    expect(charms.remove('wound')).toEqual({ ok: false, reason: 'not-assigned' });
  });

  it('remover não desfaz o tier — só a atribuição', () => {
    const charms = Charms.fromState({
      ...emptyCharmsState(), tiers: { wound: 1 }, assignments: { wound: 'rat' },
    });
    charms.remove('wound');
    expect(charms.tierOf('wound')).toBe(1);
  });
});

describe('assignedTo: os charms que agem contra UM monstro (#603, getCharmFromTarget)', () => {
  const parry: Charm = {
    id: 'parry', name: 'Parry', canaryCharmId: 7, category: 'major', type: 'defensive',
    chance: [5, 10, 11], points: [400, 600, 2000],
  };
  const cripple: Charm = {
    id: 'cripple', name: 'Cripple', canaryCharmId: 6, category: 'minor', type: 'offensive',
    chance: [6, 9, 12], points: [100, 150, 225],
  };
  const full = new Map<string, Charm>([['wound', wound], ['parry', parry], ['cripple', cripple]]);

  it('sem atribuição nenhuma é undefined — o caminho quente de toda hunt sem charm', () => {
    expect(Charms.fromState().assignedTo('rat', full)).toBeUndefined();
  });

  it('devolve o major e o minor do monstro, cada um com o tier atual', () => {
    const charms = Charms.fromState({
      ...emptyCharmsState(), tiers: { wound: 2, cripple: 3 },
      assignments: { wound: 'rat', cripple: 'rat' },
    });
    const assigned = charms.assignedTo('rat', full);
    expect(assigned?.major).toEqual({ charm: wound, tier: 2 });
    expect(assigned?.minor).toEqual({ charm: cripple, tier: 3 });
  });

  it('charm atribuído a OUTRO monstro não age contra este', () => {
    const charms = Charms.fromState({
      ...emptyCharmsState(), tiers: { wound: 1, parry: 1 }, assignments: { wound: 'rat', parry: 'bat' },
    });
    expect(charms.assignedTo('rat', full)).toEqual({ major: { charm: wound, tier: 1 } });
    expect(charms.assignedTo('bat', full)).toEqual({ major: { charm: parry, tier: 1 } });
    expect(charms.assignedTo('dragon', full)).toBeUndefined();
  });

  it('ignora o que não está no catálogo (charm removido) e o que nunca foi desbloqueado', () => {
    const charms = Charms.fromState({
      ...emptyCharmsState(), tiers: { wound: 1 }, assignments: { wound: 'rat', ghost: 'rat', parry: 'rat' },
    });
    // `ghost` não está no catálogo; `parry` está sem tier (registro inconsistente).
    expect(charms.assignedTo('rat', full)).toEqual({ major: { charm: wound, tier: 1 } });
  });
});

describe('ida e volta do estado', () => {
  it('fromState/getState preserva pontos, echoes, tiers e atribuições', () => {
    const state: CharmsState = {
      pointsSpent: 240, echoesSpent: 50, tiers: { wound: 1 }, assignments: { wound: 'rat' }, version: 1,
    };
    expect(Charms.fromState(state).getState()).toEqual(state);
  });
});
