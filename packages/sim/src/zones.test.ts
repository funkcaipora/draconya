import { ZONE_FLAG, ZONE_PALETTE, buildTilemap } from '@draconya/content';
import { LOGOUT_REFUSED_REASONS } from '@draconya/protocol';
import type { LogoutRefusedReason } from '@draconya/protocol';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './character.js';
import { IN_FIGHT_WINDOW_MS } from './combat/in-fight.js';
import { canLogout, hasZoneFlag, zoneAt } from './zones.js';
import type { LogoutRefusal, LogoutSubject, ZoneType } from './zones.js';

// Uma tira com UM tile de cada valor da paleta (`ZONE_PALETTE`), mais um de chão normal no
// começo. O andar de cima (z6) não declara a camada: serve para provar que "sem `zones`" é por
// andar, e não por mapa.
//
//     x  0 1 2 3 4 5 6 7 8
//   z7   . p n a l P N A .      (a oitava coluna é chão normal de novo)
//   z6   . . . . . . . . .      (sem a camada)
const ROW = '.pnalPNA.';
const map = buildTilemap({
  id: 'faixa-de-zonas', z: 7,
  floors: {
    7: { grid: ['.........'], zones: [ROW] },
    6: { grid: ['.........'] },
  },
});
const unzoned = buildTilemap({ id: 'sem-zonas', z: 7, grid: ['.........'] });

const at = (x: number, z: number = 7) => ({ x, y: 0, z });

/** O caractere → (tipo, bits que carrega), o que `Tile::getZoneType` devolve para cada tile. */
const EXPECTED: ReadonlyArray<readonly [string, ZoneType]> = [
  ['.', 'normal'],
  ['p', 'protection'],
  ['n', 'nopvp'],
  ['a', 'pvp'],
  ['l', 'nologout'],
  ['P', 'protection'], // PZ + no-logout: o tipo esconde o no-logout...
  ['N', 'nopvp'],      // ...no-pvp + no-logout idem...
  ['A', 'pvp'],        // ...e arena + no-logout também.
];

describe('zoneAt (#831, OW-10)', () => {
  it('devolve o tipo de zona de cada valor da paleta, com a precedência do Tile::getZoneType', () => {
    expect(Object.keys(ZONE_PALETTE).sort()).toEqual(EXPECTED.map(([char]) => char).sort());
    for (const [char, type] of EXPECTED) {
      expect(zoneAt(map, at(ROW.indexOf(char))), `tile '${char}'`).toBe(type);
    }
  });

  it('PZ vence no-pvp, que vence arena, que vence no-logout — a ordem do Tile::getZoneType', () => {
    // O OTBM normalizado nunca traz dois dos três primeiros juntos (`iomap.cpp:165-177`), então a
    // precedência entre eles só se exercita sobre bits crus, escritos à mão num mapa de teste. É
    // a ordem que `zoneAt` promete a quem lê um mapa que um dia traga a combinação.
    const raw = buildTilemap({ id: 'bits-crus', z: 7, floors: { 7: { grid: ['.....'], zones: ['.....'] } } });
    const zones = raw.floors.get(7)?.zones;
    if (zones === null || zones === undefined) throw new Error('a camada devia existir');
    const { protection, noPvp, pvpZone, noLogout } = ZONE_FLAG;
    zones.set([
      protection | noPvp | pvpZone | noLogout, // PZ vence tudo
      noPvp | pvpZone | noLogout,              // no-pvp vence arena e no-logout
      pvpZone | noLogout,                      // arena vence no-logout
      noLogout,                                // só no-logout
      0,
    ]);
    const types = [0, 1, 2, 3, 4].map((x) => zoneAt(raw, at(x)));
    expect(types).toEqual(['protection', 'nopvp', 'pvp', 'nologout', 'normal']);
  });

  it('mapa sem `zones`, andar sem a camada, andar ausente e ponto fora da grade são tile normal', () => {
    for (let x = 0; x < ROW.length; x++) expect(zoneAt(unzoned, at(x))).toBe('normal');
    // O andar de baixo do mapa com a camada não a declara: normal, mesmo sob um tile de PZ em z7.
    for (let x = 0; x < ROW.length; x++) expect(zoneAt(map, at(x, 6))).toBe('normal');
    expect(zoneAt(map, at(1, 9))).toBe('normal'); // andar que o mapa não tem
    expect(zoneAt(map, { x: -1, y: 0, z: 7 })).toBe('normal');
    expect(zoneAt(map, { x: 1, y: 5, z: 7 })).toBe('normal');
    expect(zoneAt(map, { x: 99, y: 0, z: 7 })).toBe('normal');
  });

  it('`z` ausente é o andar padrão do mapa, o mesmo de `isBlocked`', () => {
    expect(zoneAt(map, { x: 1, y: 0 })).toBe('protection');
    expect(zoneAt(map, { x: 4, y: 0 })).toBe('nologout');
  });
});

describe('hasZoneFlag (#831, OW-10)', () => {
  it('lê o bit, não o tipo: no-logout vale por cima de PZ, no-pvp e arena', () => {
    const flagsOf = (char: string) => ({
      protection: hasZoneFlag(map, at(ROW.indexOf(char)), 'protection'),
      noPvp: hasZoneFlag(map, at(ROW.indexOf(char)), 'noPvp'),
      pvpZone: hasZoneFlag(map, at(ROW.indexOf(char)), 'pvpZone'),
      noLogout: hasZoneFlag(map, at(ROW.indexOf(char)), 'noLogout'),
    });
    const none = { protection: false, noPvp: false, pvpZone: false, noLogout: false };
    expect(flagsOf('.')).toEqual(none);
    expect(flagsOf('p')).toEqual({ ...none, protection: true });
    expect(flagsOf('n')).toEqual({ ...none, noPvp: true });
    expect(flagsOf('a')).toEqual({ ...none, pvpZone: true });
    expect(flagsOf('l')).toEqual({ ...none, noLogout: true });
    expect(flagsOf('P')).toEqual({ ...none, protection: true, noLogout: true });
    expect(flagsOf('N')).toEqual({ ...none, noPvp: true, noLogout: true });
    expect(flagsOf('A')).toEqual({ ...none, pvpZone: true, noLogout: true });
  });

  it('sem a camada ou fora do mapa nenhuma marca está ligada', () => {
    for (const flag of Object.keys(ZONE_FLAG) as Array<keyof typeof ZONE_FLAG>) {
      expect(hasZoneFlag(unzoned, at(1), flag)).toBe(false);
      expect(hasZoneFlag(map, at(1, 6), flag)).toBe(false);
      expect(hasZoneFlag(map, { x: -3, y: 0, z: 7 }, flag)).toBe(false);
    }
  });
});

describe('canLogout (#831, OW-10)', () => {
  // `nowMs` do relógio lógico da sessão; o último golpe, 10 s antes — bem dentro da janela.
  const NOW = 100_000;
  const RECENT = NOW - 10_000;
  const subject = (x: number, lastCombatActionAtMs: number | null, z = 7): LogoutSubject => ({
    position: { x, y: 0, z }, lastCombatActionAtMs,
  });

  it('PZ, em luta: ok — a PZ isenta da luta', () => {
    expect(canLogout(subject(ROW.indexOf('p'), RECENT), map, NOW)).toEqual({ ok: true });
  });

  it('PZ, fora de luta: ok', () => {
    expect(canLogout(subject(ROW.indexOf('p'), null), map, NOW)).toEqual({ ok: true });
  });

  it('tile no-logout: recusa, `no-logout-tile` — em luta ou não', () => {
    const refused = { ok: false, reason: 'no-logout-tile' };
    expect(canLogout(subject(ROW.indexOf('l'), null), map, NOW)).toEqual(refused);
    // A recusa por tile vence a recusa por luta: a mensagem é a do tile (protocolgame.cpp:1151).
    expect(canLogout(subject(ROW.indexOf('l'), RECENT), map, NOW)).toEqual(refused);
  });

  it('PZ + no-logout recusa: o no-logout é testado ANTES da PZ, e a PZ não o desfaz', () => {
    // O caso que só existe porque o tile guarda bits: `zoneAt` diz `'protection'` aqui, e quem
    // decidisse a saída pelo tipo abriria o logout num tile que o Canary fecha (player.cpp:6972).
    expect(zoneAt(map, at(ROW.indexOf('P')))).toBe('protection');
    for (const char of ['P', 'N', 'A']) {
      expect(canLogout(subject(ROW.indexOf(char), null), map, NOW), `tile '${char}'`)
        .toEqual({ ok: false, reason: 'no-logout-tile' });
      expect(canLogout(subject(ROW.indexOf(char), RECENT), map, NOW), `tile '${char}' em luta`)
        .toEqual({ ok: false, reason: 'no-logout-tile' });
    }
  });

  it('tile normal, em luta: recusa, `in-fight`', () => {
    expect(canLogout(subject(ROW.indexOf('.'), RECENT), map, NOW))
      .toEqual({ ok: false, reason: 'in-fight' });
  });

  it('tile normal, sem luta: ok — nunca lutou, ou a janela de 60 s já passou', () => {
    expect(canLogout(subject(ROW.indexOf('.'), null), map, NOW)).toEqual({ ok: true });
    expect(canLogout(subject(ROW.indexOf('.'), NOW - IN_FIGHT_WINDOW_MS - 5_000), map, NOW))
      .toEqual({ ok: true });
  });

  it('no-pvp e arena não são PZ: em luta recusam por `in-fight`, fora de luta saem', () => {
    for (const char of ['n', 'a']) {
      expect(canLogout(subject(ROW.indexOf(char), RECENT), map, NOW), `tile '${char}'`)
        .toEqual({ ok: false, reason: 'in-fight' });
      expect(canLogout(subject(ROW.indexOf(char), null), map, NOW), `tile '${char}'`)
        .toEqual({ ok: true });
    }
  });

  it('a janela é a de `isInFight`: 59 999 ms desde o golpe ainda é luta, 60 000 ms já não é', () => {
    const x = ROW.indexOf('.');
    expect(canLogout(subject(x, NOW - (IN_FIGHT_WINDOW_MS - 1)), map, NOW))
      .toEqual({ ok: false, reason: 'in-fight' });
    expect(canLogout(subject(x, NOW - IN_FIGHT_WINDOW_MS), map, NOW)).toEqual({ ok: true });
  });

  it('mapa sem `zones` é tratado como normal: só a luta decide', () => {
    expect(canLogout(subject(1, RECENT), unzoned, NOW)).toEqual({ ok: false, reason: 'in-fight' });
    expect(canLogout(subject(1, null), unzoned, NOW)).toEqual({ ok: true });
    // O andar de cima do mapa com a camada também não a tem: o tile de PZ de z7 não vale em z6.
    expect(canLogout(subject(ROW.indexOf('p'), RECENT, 6), map, NOW))
      .toEqual({ ok: false, reason: 'in-fight' });
  });

  it('é pura: só lê, não toca o personagem e dá o mesmo veredicto ao mesmo estado', () => {
    const frozen = Object.freeze({
      position: Object.freeze({ x: ROW.indexOf('.'), y: 0, z: 7 }), lastCombatActionAtMs: RECENT,
    });
    const first = canLogout(frozen, map, NOW);
    expect(canLogout(frozen, map, NOW)).toEqual(first);
    expect(frozen.lastCombatActionAtMs).toBe(RECENT);
    // O veredicto muda só com o relógio LÓGICO passado: a luta vence 60 s depois do golpe.
    expect(canLogout(frozen, map, RECENT + IN_FIGHT_WINDOW_MS - 1)).toEqual({ ok: false, reason: 'in-fight' });
    expect(canLogout(frozen, map, RECENT + IN_FIGHT_WINDOW_MS)).toEqual({ ok: true });
  });

  it('o veredicto devolvido não é mutável por quem o recebe (compartilhado entre chamadas)', () => {
    const verdict = canLogout(subject(ROW.indexOf('.'), RECENT), map, NOW);
    expect(Object.isFrozen(verdict)).toBe(true);
    expect(Object.isFrozen(canLogout(subject(ROW.indexOf('p'), null), map, NOW))).toBe(true);
  });

  it('os motivos de recusa são os do `logout-refused` do protocolo (OW-11), nos dois sentidos', () => {
    // Em tempo de compilação: um motivo novo, ou removido, de qualquer dos lados deixa de compilar.
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const sameVocabulary: Same<LogoutRefusal, LogoutRefusedReason> = true;
    expect(sameVocabulary).toBe(true);
    // Em tempo de execução: os dois motivos aparecem de fato, e não há outro.
    const seen = new Set<string>();
    for (const [x, last] of [[ROW.indexOf('l'), null], [ROW.indexOf('.'), RECENT]] as const) {
      const verdict = canLogout(subject(x, last), map, NOW);
      if (!verdict.ok) seen.add(verdict.reason);
    }
    expect([...seen].sort()).toEqual([...LOGOUT_REFUSED_REASONS].sort());
  });

  it('aceita um `CharacterRuntime` de verdade: o carimbo é o de `lastCombatActionAtMs`', () => {
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: ROW.indexOf('.'), y: 0, z: 7 },
      health: 100, maxHealth: 100, mana: 50, maxMana: 50, level: 8, xp: 0,
      goldDelta: 0, alive: true, cooldowns: {},
    });
    expect(hero.lastCombatActionAtMs).toBeNull();
    expect(canLogout(hero, map, NOW)).toEqual({ ok: true });
    hero.lastCombatActionAtMs = RECENT;
    expect(canLogout(hero, map, NOW)).toEqual({ ok: false, reason: 'in-fight' });
    // Entrar na PZ com o carimbo ainda quente (corrida para o templo) libera a saída.
    hero.position = at(ROW.indexOf('p'));
    expect(canLogout(hero, map, NOW)).toEqual({ ok: true });
  });
});
