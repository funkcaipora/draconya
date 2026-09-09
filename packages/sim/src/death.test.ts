import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './character.js';
import {
  Contribution, creditFor, emptyContribution, forgetActor, recordDamage, resolveDeath,
} from './death.js';
import type { KillCredit, Victim } from './death.js';
import { MonsterRuntime } from './monster/monster.js';
import { Rng } from './rng.js';
import { EventPriority } from './schedule.js';
import { Session } from './session.js';
import type { Ruleset } from './session.js';

const monster = (over: Partial<ConstructorParameters<typeof MonsterRuntime>[0]> = {}) =>
  new MonsterRuntime({
    id: 7, monsterId: 'rat', position: { x: 1, y: 1 }, home: { x: 1, y: 1 }, health: 20,
    targetId: null, cooldowns: {}, ...over,
  });

const character = (id = 'hero') => new CharacterRuntime({
  id, position: { x: 0, y: 0, z: 7 }, health: 100, maxHealth: 100, mana: 0, maxMana: 0,
  level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
});

describe('atribuição de dano', () => {
  it('último golpe e maior dano são coisas diferentes, e podem divergir', () => {
    // A atribuição que só guarda o último golpe é a que party e boss não conseguem usar.
    const state = emptyContribution();
    recordDamage(state, 'a', 30);
    recordDamage(state, 'b', 5);
    recordDamage(state, 'a', 30);
    recordDamage(state, 'b', 5);

    const credit = creditFor(state);
    expect(credit.lastHitBy).toBe('b');
    expect(credit.mostDamageBy).toBe('a');
    expect(credit.damageByActor).toEqual({ a: 60, b: 10 });
  });

  it('muta no lugar: o golpe seguinte soma ao mesmo ator', () => {
    // Caminho quente. Com 5.000 instâncias, um mapa novo por golpe é o coletor rodando o
    // tempo todo; a atribuição é um `Map` mutado, e o snapshot é derivado dele uma vez.
    const state = emptyContribution();
    recordDamage(state, 'a', 1);
    recordDamage(state, 'a', 2);
    expect(state.damageBy('a')).toBe(3);
    expect(state.actorCount).toBe(1);
  });

  it('golpe sem dano não conta: ninguém mata com zero', () => {
    const state = emptyContribution();
    recordDamage(state, 'a', 0);
    expect(creditFor(state)).toEqual({ lastHitBy: null, mostDamageBy: null, damageByActor: {} });
  });

  it('empate em dano vai para quem bateu primeiro', () => {
    const state = emptyContribution();
    recordDamage(state, 'first', 10);
    recordDamage(state, 'second', 10);
    expect(creditFor(state).mostDamageBy).toBe('first');
  });

  it('esquece um ator que deixou de existir, inclusive como último golpe', () => {
    const state = emptyContribution();
    recordDamage(state, 'm:1', 5);
    recordDamage(state, 'm:2', 7);
    forgetActor(state, 'm:2');
    expect(state.getState()).toEqual({ damageByActor: { 'm:1': 5 } });
    forgetActor(state, 'm:9');   // desconhecido: nada muda, nada lança
    expect(state.getState()).toEqual({ damageByActor: { 'm:1': 5 } });
  });

  it('sobrevive ao snapshot da criatura, e a cópia não compartilha o mapa', () => {
    // Sem isto, o abate depois de uma retomada credita a quem bateu DEPOIS dela — quem
    // tirou 90% da vida antes da queda do nó desaparece da conta.
    const before = monster();
    recordDamage(before.contribution, 'hero', 15);
    const state = before.getState();
    const after = new MonsterRuntime(state);

    expect(after.contribution.getState()).toEqual({ damageByActor: { hero: 15 }, lastHitBy: 'hero' });
    recordDamage(after.contribution, 'other', 1);
    expect(state.contribution?.damageByActor).toEqual({ hero: 15 });
    expect(before.contribution.getState()).toEqual({ damageByActor: { hero: 15 } , lastHitBy: 'hero' });

    const hero = character();
    recordDamage(hero.contribution, 'm:7', 40);
    expect(new CharacterRuntime(hero.getState()).contribution.getState()).toEqual({
      damageByActor: { 'm:7': 40 }, lastHitBy: 'm:7',
    });
  });

  it('snapshot anterior à FUN-63 restaura com atribuição vazia', () => {
    expect(monster().contribution.getState()).toEqual({ damageByActor: {} });
    expect(Contribution.fromState(undefined).getState()).toEqual({ damageByActor: {} });
  });
});

describe('resolveDeath', () => {
  function sessionWith(onCreatureDied: Ruleset['onCreatureDied']) {
    const ruleset: Ruleset = {
      type: 'hunt', hz: () => 1, onEnter: () => {}, onEvent: () => {}, onEnd: () => {},
      onCreatureDied,
    };
    return new Session({
      id: 's', contentVersion: 'v', ruleset, rng: Rng.fromSeed('s'), createdAtMs: 0,
    });
  }

  it('congela a criatura, resolve o crédito e entrega a consequência ao ruleset', () => {
    const seen: Array<{ victim: Victim; credit: KillCredit }> = [];
    const session = sessionWith((_s, victim, credit) => { seen.push({ victim, credit }); });
    const rat = monster();
    recordDamage(rat.contribution, 'hero', 20);
    session.scheduleIn('monster-step', 100, { subject: rat.subject, priority: EventPriority.Movement });
    session.scheduleIn('monster-attack', 100, { subject: rat.subject, priority: EventPriority.Attack });
    session.scheduleIn('player-step', 100, { subject: 'hero' });

    const credit = resolveDeath(session, { kind: 'monster', monster: rat });

    // Só os eventos DELE saem da fila: o do personagem continua.
    expect(session.pendingEvents).toBe(1);
    expect(credit).toEqual({ lastHitBy: 'hero', mostDamageBy: 'hero', damageByActor: { hero: 20 } });
    expect(seen).toEqual([{ victim: { kind: 'monster', monster: rat }, credit }]);
  });

  it('a morte do personagem passa pelo MESMO pipeline', () => {
    // Antes eram dois caminhos: `session.kill` para o personagem e `#reap` para o monstro.
    // Boss e guild war precisariam de um terceiro e de um quarto.
    const seen: Victim[] = [];
    const session = sessionWith((_s, victim) => { seen.push(victim); });
    const hero = character();
    session.enter(hero);
    recordDamage(hero.contribution, 'm:7', 100);
    session.scheduleIn('player-attack', 50, { subject: hero.id });

    session.kill(hero);

    expect(hero.alive).toBe(false);
    expect(session.aggregates.deaths).toBe(1);
    expect(session.pendingEvents).toBe(0);
    expect(seen).toEqual([{ kind: 'character', character: hero }]);
  });

  it('sem golpe registrado, o crédito é nulo — abate sem dono', () => {
    const session = sessionWith(() => {});
    expect(resolveDeath(session, { kind: 'monster', monster: monster() })).toEqual({
      lastHitBy: null, mostDamageBy: null, damageByActor: {},
    });
  });
});
