import { describe, expect, it } from 'vitest';
import type { Spell } from '@draconya/content';
import { CharacterRuntime } from './character.js';
import {
  emptyLearnedSpellsState, LEARNED_SPELLS_STATE_VERSION, LearnedSpells, learnedSpellsStateOf,
} from './learned-spells.js';
import type { Learner } from './learned-spells.js';

const berserk: Spell = {
  id: 'berserk', name: 'Berserk', manaCost: 115, cooldownMs: 4_000, minLevel: 35, vocationId: 'knight',
  learnPrice: 2_500, effect: { kind: 'heal', amount: 10, target: 'self' },
};
const woundCleansing: Spell = {
  id: 'wound-cleansing', name: 'Wound Cleansing', manaCost: 40, cooldownMs: 6_000, minLevel: 8,
  vocationId: 'knight', learnPrice: 0, effect: { kind: 'heal', amount: 10, target: 'self' },
};
const curePoison: Spell = {
  id: 'cure-poison', name: 'Cure Poison', manaCost: 30, cooldownMs: 6_000, minLevel: 10,
  learnPrice: 150, effect: { kind: 'heal', amount: 10, target: 'self' },
};
// Great Death Beam: o Canary só a concede pelo Wheel of Destiny, e o conteúdo real a deixa sem preço.
const unpriced: Spell = {
  id: 'great-death-beam', name: 'Great Death Beam', manaCost: 140, cooldownMs: 10_000, minLevel: 300,
  vocationId: 'sorcerer', effect: { kind: 'heal', amount: 10, target: 'self' },
};

const knight = (over: Partial<Learner> = {}): Learner => ({
  level: 40, vocationId: 'knight', gold: 10_000, ...over,
});

describe('LearnedSpells — o registro das magias aprendidas (#624, ADR 0058)', () => {
  it('um personagem novo não sabe magia nenhuma', () => {
    const learned = LearnedSpells.fromState();
    expect(learned.size).toBe(0);
    expect(learned.has('berserk')).toBe(false);
    expect(learned.getState()).toEqual(emptyLearnedSpellsState());
  });

  it('`recorded` separa o "nada" de quem chegou sem registro do registro que é a verdade do personagem', () => {
    // Sem estado (snapshot anterior à #624, ticket de um `api` antigo): a sessão NÃO sabe o que o
    // personagem aprendeu. O extrato omite o campo, e o ledger não apaga a concessão da migração.
    expect(LearnedSpells.fromState().recorded).toBe(false);
    // Com estado — vazio inclusive, o personagem novo que o `api` já leu —, ele é a verdade.
    expect(LearnedSpells.fromState(emptyLearnedSpellsState()).recorded).toBe(true);
    // E uma compra ou concessão faz dele a verdade, mesmo tendo chegado sem nada.
    const bought = LearnedSpells.fromState();
    expect(bought.learn(woundCleansing, knight({ gold: 0 })).ok).toBe(true);
    expect(bought.recorded).toBe(true);
    const granted = LearnedSpells.fromState();
    granted.grant('great-death-beam');
    expect(granted.recorded).toBe(true);
    // A recusa não mexe: pedir o que não pode não transforma o "nada" em registro.
    const refused = LearnedSpells.fromState();
    refused.learn(berserk, knight({ gold: 0 }));
    expect(refused.recorded).toBe(false);
  });

  it('o registro de ida e volta é uma CÓPIA, com a versão do registro (ADR 0052 d.1)', () => {
    const learned = LearnedSpells.fromState(learnedSpellsStateOf(['berserk', 'cure-poison']));
    const state = learned.getState();
    expect(state).toEqual({ spellIds: ['berserk', 'cure-poison'], version: LEARNED_SPELLS_STATE_VERSION });
    // Quem guarda o estado para um snapshot não vê a compra seguinte aparecer nele.
    learned.grant('wound-cleansing');
    expect(state.spellIds).toEqual(['berserk', 'cure-poison']);
    expect(learned.getState().spellIds).toEqual(['berserk', 'cure-poison', 'wound-cleansing']);
  });

  it('`learnedSpellsStateOf` tira os repetidos e mantém a ordem', () => {
    expect(learnedSpellsStateOf(['a', 'b', 'a', 'c', 'b']).spellIds).toEqual(['a', 'b', 'c']);
  });

  describe('learn: a ordem das recusas é a do `StdModule.learnSpell` do Canary', () => {
    it('aprende quando vocação, level e saldo batem — e devolve o preço', () => {
      const learned = LearnedSpells.fromState();
      expect(learned.learn(berserk, knight())).toEqual({ ok: true, price: 2_500 });
      expect(learned.has('berserk')).toBe(true);
    });

    it('magia que o catálogo não tem é `unknown-spell`', () => {
      const learned = LearnedSpells.fromState();
      expect(learned.learn(undefined, knight())).toEqual({ ok: false, reason: 'unknown-spell' });
    });

    it('magia sem `learnPrice` é `not-for-sale` — ninguém a ensina —, mesmo com level e vocação', () => {
      const learned = LearnedSpells.fromState();
      expect(learned.learn(unpriced, { level: 400, vocationId: 'sorcerer', gold: 1e9 }))
        .toEqual({ ok: false, reason: 'not-for-sale' });
      expect(learned.has('great-death-beam')).toBe(false);
    });

    it('já aprendida é `already-learned`, ANTES de qualquer outra checagem', () => {
      const learned = LearnedSpells.fromState(learnedSpellsStateOf(['berserk']));
      // Sem gold, sem level e de outra vocação: o "já sabe" vence — o Canary diz "You already know".
      expect(learned.learn(berserk, { level: 1, vocationId: 'druid', gold: 0 }))
        .toEqual({ ok: false, reason: 'already-learned' });
    });

    it('vocação errada — inclusive quem ainda não escolheu — é `wrong-vocation`', () => {
      const learned = LearnedSpells.fromState();
      expect(learned.learn(berserk, knight({ vocationId: 'druid' })))
        .toEqual({ ok: false, reason: 'wrong-vocation' });
      expect(learned.learn(berserk, knight({ vocationId: null })))
        .toEqual({ ok: false, reason: 'wrong-vocation' });
    });

    it('level abaixo do mínimo é `level-too-low`: no level exato entra, um abaixo não', () => {
      const learned = LearnedSpells.fromState();
      expect(learned.learn(berserk, knight({ level: 34 }))).toEqual({ ok: false, reason: 'level-too-low' });
      expect(learned.learn(berserk, knight({ level: 35 })).ok).toBe(true);
    });

    it('saldo abaixo do preço é `insufficient-gold`: no preço exato entra, um abaixo não', () => {
      const learned = LearnedSpells.fromState();
      expect(learned.learn(berserk, knight({ gold: 2_499 }))).toEqual({ ok: false, reason: 'insufficient-gold' });
      expect(learned.learn(berserk, knight({ gold: 2_500 })).ok).toBe(true);
    });

    it('a magia grátis (`learnPrice: 0`) aprende com o bolso vazio — e `0` não é "sem preço"', () => {
      const learned = LearnedSpells.fromState();
      expect(learned.learn(woundCleansing, knight({ gold: 0 }))).toEqual({ ok: true, price: 0 });
    });

    it('magia sem `vocationId` (Cure Poison) vale para qualquer vocação, só pelo level', () => {
      const learned = LearnedSpells.fromState();
      expect(learned.learn(curePoison, knight({ vocationId: null, level: 10 })).ok).toBe(true);
    });

    it('a recusa nunca marca a magia como aprendida', () => {
      const learned = LearnedSpells.fromState();
      learned.learn(berserk, knight({ gold: 0 }));
      expect(learned.has('berserk')).toBe(false);
      expect(learned.size).toBe(0);
    });
  });

  describe('check: pergunta sem comprar', () => {
    it('devolve o mesmo veredito de `learn` e não muda o registro', () => {
      const learned = LearnedSpells.fromState();
      expect(learned.check(berserk, knight())).toEqual({ ok: true, price: 2_500 });
      expect(learned.has('berserk')).toBe(false);
    });
  });

  describe('grant: o `learnInstantSpell` puro, sem preço', () => {
    it('concede sem conferir nada, e devolve se era NOVA', () => {
      const learned = LearnedSpells.fromState();
      expect(learned.grant('great-death-beam')).toBe(true);
      expect(learned.has('great-death-beam')).toBe(true);
      expect(learned.grant('great-death-beam')).toBe(false);
      expect(learned.size).toBe(1);
    });
  });
});

describe('CharacterRuntime.learnSpell — a compra numa transação só (#624, ADR 0058 d.2)', () => {
  const runtime = (over: { gold?: number; goldDelta?: number; level?: number; vocationId?: string | null } = {}): CharacterRuntime =>
    new CharacterRuntime({
      id: 'hero', position: { x: 1, y: 1, z: 7 }, health: 100, maxHealth: 100, mana: 100, maxMana: 100,
      level: over.level ?? 40, xp: 0, vocationId: over.vocationId === undefined ? 'knight' : over.vocationId,
      staminaMs: null, staminaUpdatedAtMs: 0,
      gold: over.gold ?? 10_000, goldDelta: over.goldDelta ?? 0, alive: true, cooldowns: {},
    });

  it('cobra o preço por `goldDelta` e marca a magia aprendida', () => {
    const hero = runtime();
    expect(hero.learnSpell(berserk)).toEqual({ ok: true, price: 2_500 });
    expect(hero.learnedSpells.has('berserk')).toBe(true);
    expect(hero.goldDelta).toBe(-2_500);
    // A base de entrada NÃO muda: a sessão só movimenta `goldDelta` (invariante 10).
    expect(hero.gold).toBe(10_000);
  });

  it('é IDEMPOTENTE: aprender de novo é recusado e NÃO cobra outra vez', () => {
    const hero = runtime();
    hero.learnSpell(berserk);
    expect(hero.learnSpell(berserk)).toEqual({ ok: false, reason: 'already-learned' });
    expect(hero.learnSpell(berserk)).toEqual({ ok: false, reason: 'already-learned' });
    expect(hero.goldDelta).toBe(-2_500);
  });

  it('o saldo é `gold + goldDelta`: um gasto anterior na mesma sessão já baixou o que sobra', () => {
    // 3.000 de entrada e 1.000 já gastos na sessão → 2.000 disponíveis, menos que os 2.500.
    const hero = runtime({ gold: 3_000, goldDelta: -1_000 });
    expect(hero.learnSpell(berserk)).toEqual({ ok: false, reason: 'insufficient-gold' });
    expect(hero.goldDelta).toBe(-1_000);
    expect(hero.learnedSpells.has('berserk')).toBe(false);
  });

  it('recusa por vocação/level nunca toca no gold', () => {
    const wrong = runtime({ vocationId: 'druid' });
    expect(wrong.learnSpell(berserk).ok).toBe(false);
    const low = runtime({ level: 10 });
    expect(low.learnSpell(berserk).ok).toBe(false);
    expect(wrong.goldDelta).toBe(0);
    expect(low.goldDelta).toBe(0);
  });

  it('a magia grátis não mexe no gold, mas fica aprendida', () => {
    const hero = runtime({ gold: 0 });
    expect(hero.learnSpell(woundCleansing)).toEqual({ ok: true, price: 0 });
    expect(hero.goldDelta).toBe(0);
    expect(hero.learnedSpells.has('wound-cleansing')).toBe(true);
  });

  it('o registro atravessa o snapshot (`getState`) — a hunt retomada sabe o que o personagem comprou', () => {
    const hero = runtime();
    hero.learnSpell(berserk);
    const restored = new CharacterRuntime(JSON.parse(JSON.stringify(hero.getState())));
    expect(restored.learnedSpells.has('berserk')).toBe(true);
    expect(restored.learnedSpells.getState()).toEqual(hero.learnedSpells.getState());
    // E o gold gasto viaja junto: retomar não devolve a compra nem a cobra de novo.
    expect(restored.goldDelta).toBe(-2_500);
    expect(restored.learnSpell(berserk)).toEqual({ ok: false, reason: 'already-learned' });
  });

  it('um estado antigo, sem o registro, retoma sem magia nenhuma — e o `getState` NÃO inventa a chave', () => {
    const hero = runtime();
    // Nunca aprendeu nada nem recebeu registro: o estado dele não tem a chave.
    expect(hero.getState()).not.toHaveProperty('learnedSpells');
    const restored = new CharacterRuntime(JSON.parse(JSON.stringify(hero.getState())));
    expect(restored.learnedSpells.size).toBe(0);
    // Passa pelo snapshot de novo e continua sem a chave: reescrevê-la VAZIA apagaria, no fim da
    // hunt, o que a migração 0023 concedeu no Postgres (ADR 0014).
    expect(restored.getState()).not.toHaveProperty('learnedSpells');
    // Comprar é o que a faz aparecer.
    restored.learnSpell(berserk);
    expect(restored.getState().learnedSpells).toEqual({ spellIds: ['berserk'], version: 1 });
  });
});
