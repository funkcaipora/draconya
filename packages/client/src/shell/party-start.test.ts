import { describe, expect, it } from 'vitest';
import { startWithTeam } from './party-start.js';
import type { PartyView } from '../party/api.js';
import { readFile } from 'node:fs/promises';

// A decisão de "Iniciar com o time" (RF-03), PURA: líder/membro/sem party, patch só quando a
// seleção diverge do estado REAL, e NENHUMA decisão produz `enter-hunt` — o início da party
// vai por HTTP (`configure` + `start`), nunca pela intenção de hunt solo.

const forming = (over: Partial<PartyView> = {}): PartyView => ({
  id: 'party-1',
  leaderId: 'me',
  mode: 'split',
  huntId: 'rat-cellars',
  difficulty: 'cautious',
  minLevel: 10,
  vocationTargets: { knight: 2, paladin: 1 },
  shareCosts: true,
  splitLoot: false,
  openSlots: { knight: 1, paladin: 1 },
  members: [
    { characterId: 'me', name: 'Eu' },
    { characterId: 'b', name: 'Bob' },
  ],
  published: false,
  state: 'forming',
  sessionId: null,
  ...over,
});

describe('startWithTeam (RF-03)', () => {
  it('the leader with an unchanged selection gets patch: null — only the start goes out', () => {
    const decision = startWithTeam(forming(), 'me', 'rat-cellars', 'cautious');
    expect(decision).toEqual({ enabled: true, reason: null, patch: null });
  });

  it('a different hunt produces the patch with the REAL state passed through', () => {
    // Mutação que mata: inventar shareCosts/splitLoot/minLevel/vocationTargets no patch —
    // o início não pode reescrever o que o líder configurou.
    const decision = startWithTeam(forming(), 'me', 'dragon-lair', 'bold');
    expect(decision.enabled).toBe(true);
    expect(decision.patch).toEqual({
      huntId: 'dragon-lair',
      difficulty: 'bold',
      minLevel: 10,
      vocationTargets: { knight: 2, paladin: 1 },
      shareCosts: true,
      splitLoot: false,
    });
  });

  it('a different pull on the same hunt produces the patch, and only difficulty changes', () => {
    const decision = startWithTeam(forming(), 'me', 'rat-cellars', 'reckless');
    expect(decision.patch).toMatchObject({ huntId: 'rat-cellars', difficulty: 'reckless' });
  });

  it('a null minLevel passes through as the server floor (1), never as an invented value', () => {
    const decision = startWithTeam(forming({ minLevel: null }), 'me', 'dragon-lair', 'bold');
    expect(decision.patch?.minLevel).toBe(1);
  });

  it('a non-leader is disabled with the reason, and no patch is built', () => {
    const decision = startWithTeam(forming(), 'bob', 'dragon-lair', 'bold');
    expect(decision).toEqual({ enabled: false, reason: 'Só o líder inicia com o time.', patch: null });
  });

  it('without a party the decision is disabled, and without a hunt/pull selection too', () => {
    expect(startWithTeam(null, 'me', 'rat-cellars', 'cautious'))
      .toEqual({ enabled: false, reason: 'Você não está numa party.', patch: null });
    expect(startWithTeam(forming(), 'me', null, null))
      .toEqual({ enabled: false, reason: 'Escolha a caçada e o tamanho do pull.', patch: null });
    expect(startWithTeam(forming(), 'me', 'rat-cellars', null))
      .toEqual({ enabled: false, reason: 'Escolha a caçada e o tamanho do pull.', patch: null });
  });

  it('a solo party (leader alone) cannot start — the server would refuse not-enough-members', () => {
    const decision = startWithTeam(
      forming({ members: [{ characterId: 'me', name: 'Eu' }] }), 'me', 'dragon-lair', 'bold',
    );
    expect(decision).toEqual({ enabled: false, reason: 'Uma party precisa de pelo menos dois.', patch: null });
  });

  it('a party already hunting cannot start again', () => {
    const decision = startWithTeam(forming({ state: 'hunting', sessionId: 's1' }), 'me', 'dragon-lair', 'bold');
    expect(decision).toEqual({ enabled: false, reason: 'A party já está caçando.', patch: null });
  });

  it('NO decision ever produces an enter-hunt intent', () => {
    const cases: Array<Parameters<typeof startWithTeam>> = [
      [forming(), 'me', 'rat-cellars', 'cautious'],
      [forming(), 'me', 'dragon-lair', 'bold'],
      [forming(), 'bob', 'dragon-lair', 'bold'],
      [forming({ state: 'hunting', sessionId: 's1' }), 'me', 'dragon-lair', 'bold'],
      [null, 'me', 'rat-cellars', 'cautious'],
      [forming(), 'me', null, null],
      [forming({ members: [{ characterId: 'me', name: 'Eu' }] }), 'me', 'dragon-lair', 'bold'],
    ];
    for (const [current, me, huntId, difficulty] of cases) {
      const decision = startWithTeam(current, me, huntId, difficulty);
      expect(JSON.stringify(decision)).not.toContain('enter-hunt');
    }
  });

  it('the module never mentions enter-hunt — the solo intent lives only in HuntsModal', async () => {
    const source = await readFile(new URL('./party-start.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('enter-hunt');
    expect(source).not.toContain('sendIntent');
  });
});
