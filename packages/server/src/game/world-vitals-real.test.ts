import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import { localToAbsolute } from '@draconya/content';
import type { Content, Tilemap, World } from '@draconya/content';
import { createWorldSession, statsForLevel } from '@draconya/sim';
import type { CharacterRuntime, Session } from '@draconya/sim';
import { characterFromTicket } from './sessions.js';
import type { InitialCharacter } from '../tickets.js';
import { carryRestoredConditions } from '../world-state.js';

// O ticket com o mundo e os vitais (#836, OW-15) sobre o conteúdo REAL: a Thais importada do OTBM,
// o `main.json` e a tabela de progressão de verdade — pelo mesmo `loadContent` do boot. É o que
// prende que o personagem que saiu a 10 HP entra no mundo com 10 HP, no tile onde saiu (ou no
// templo, sem posição), e que as condições que faltavam voltam como eventos da sessão que já andou.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => (cached ??= loadContent(DATA));

const worldOf = (): { readonly content: Content; readonly map: Tilemap; readonly world: World } => {
  const content = real();
  const map = content.maps.get('thais');
  const world = content.worlds.get('main');
  if (map === undefined || world === undefined) throw new Error('o conteúdo real não tem a thais ou o mundo main');
  return { content, map, world };
};

const newWorld = (id = 'world-vitals-1'): Session => {
  const { content, map, world } = worldOf();
  return createWorldSession({ id, map, world, content, seed: id, createdAtMs: 0 });
};

/** O personagem como a sessão o recebe do ticket do `api`, no relógio de agora. */
const fromTicket = (id: string, initial: Partial<InitialCharacter> = {}): CharacterRuntime =>
  characterFromTicket(real(), id, { level: 1, xp: 0, townId: 'thais', ...initial }, () => 0);

const maxOfLevel = (level: number) => statsForLevel(level, null, real().progression);

describe('o ticket com os vitais vira o personagem da sessão (#836, OW-15)', () => {
  it('a vida e a mana do ticket entram como estão — deslogar a 10 HP volta com 10 HP', () => {
    const hero = fromTicket('a', { health: 10, mana: 0 });
    expect(hero.health).toBe(10);
    expect(hero.mana).toBe(0);
    // O máximo continua o do level: só o valor de agora vem do ticket.
    expect(hero.maxHealth).toBe(maxOfLevel(1).maxHealth);
    expect(hero.maxMana).toBe(maxOfLevel(1).maxMana);
  });

  it('ticket sem vitais — a flag desligada, ou quem nunca saiu do mundo — nasce CHEIO, como sempre nasceu', () => {
    const hero = fromTicket('a');
    expect(hero.health).toBe(maxOfLevel(1).maxHealth);
    expect(hero.mana).toBe(maxOfLevel(1).maxMana);
  });

  it('é LIMITADO pelo máximo do level: conteúdo que mudou nunca deixa a vida acima do teto', () => {
    const hero = fromTicket('a', { health: 1_000_000, mana: 1_000_000 });
    expect(hero.health).toBe(maxOfLevel(1).maxHealth);
    expect(hero.mana).toBe(maxOfLevel(1).maxMana);
  });

  it('a vida nunca abaixo de 1 — zero seria um morto no tile de entrada —, e a mana nunca abaixo de 0', () => {
    const hero = fromTicket('a', { health: 0, mana: -4 });
    expect(hero.health).toBe(1);
    expect(hero.mana).toBe(0);
  });

  it('leva a cidade e a âncora para o personagem — o dono da sessão as devolve no extrato', () => {
    const anchor = { x: 32369, y: 32250, z: 7 };
    const hero = fromTicket('a', { townId: 'thais', worldPosition: anchor });
    expect(hero.townId).toBe('thais');
    expect(hero.worldPosition).toEqual(anchor);
  });

  it('ticket sem a cidade nem a âncora — o de antes — deixa o personagem sem nenhuma das duas', () => {
    const hero = characterFromTicket(real(), 'a', { level: 1, xp: 0 }, () => 0);
    expect(hero.townId).toBeNull();
    expect(hero.worldPosition).toBeNull();
    expect(hero.conditions.size).toBe(0);
  });
});

describe('o personagem do ticket entra no mundo (#836, OW-15, ADR 0060 d.6)', () => {
  it('SEM posição cai no templo — o 0,0,0 do Canary —, e NÃO é curado ao entrar', () => {
    const { map } = worldOf();
    const session = newWorld();
    const hero = fromTicket('a', { health: 10, mana: 0 });

    session.enter(hero);

    expect(hero.position).toEqual({ x: 94, y: 88, z: 7 });
    expect(map.entryPoint).toEqual(hero.position);
    // A Cidade curava ao entrar (`city.ts:126-130`); o mundo, não — é isso que faz o repouso não curar.
    expect(hero.health).toBe(10);
    expect(hero.mana).toBe(0);
  });

  it('COM posição volta ao tile onde saiu, com a vida com que saiu', () => {
    const { map } = worldOf();
    const street = { x: 94, y: 97, z: 7 };
    const session = newWorld();
    const hero = fromTicket('a', { health: 10, worldPosition: localToAbsolute(map, street) as never });

    session.enter(hero);

    expect(hero.position).toEqual(street);
    expect(hero.health).toBe(10);
  });

  it('a posição que o mapa não tem mais cai no templo, de vida intacta', () => {
    const session = newWorld();
    const hero = fromTicket('a', { health: 10, worldPosition: { x: 1, y: 1, z: 7 } });
    session.enter(hero);
    expect(hero.position).toEqual({ x: 94, y: 88, z: 7 });
    expect(hero.health).toBe(10);
  });
});

describe('as condições do ticket correm outra vez na sessão que já andou (#836, OW-15)', () => {
  const haste = { key: 'haste', expiresAtMs: 8_000, speedPercent: 30, merge: 'refresh' as const };

  it('o prazo restante vira prazo no relógio do mundo, e a condição VENCE como evento no instante certo', () => {
    // O mundo anda há dois minutos quando o personagem entra: a haste que faltava 8 s vence 8 s
    // depois da entrada — não no relógio zero, que já passou. Mutação que mata: tirar o
    // `carryRestoredConditions` — a condição entraria já vencida e seria apagada na entrada.
    const session = newWorld();
    session.enter(fromTicket('first'));
    session.advanceBy(120_000);
    const hero = fromTicket('a', { conditions: [haste] });
    carryRestoredConditions(hero, session);

    session.enter(hero);

    expect(hero.conditions.get('haste')?.expiresAtMs).toBe(128_000);
    session.advanceBy(7_999);
    expect(hero.conditions.get('haste')).not.toBeNull();
    session.advanceBy(1);
    expect(hero.conditions.get('haste')).toBeNull();
  });

  it('SEM trazer o prazo para o relógio da sessão, a condição entra vencida — é o defeito que o carry evita', () => {
    const session = newWorld();
    session.enter(fromTicket('first'));
    session.advanceBy(120_000);
    const hero = fromTicket('a', { conditions: [haste] });

    session.enter(hero);
    session.advanceBy(1);

    expect(hero.conditions.get('haste')).toBeNull();
  });

  it('numa sessão que nasce agora (relógio zero) o carry não muda nada', () => {
    const session = newWorld();
    const hero = fromTicket('a', { conditions: [haste] });
    carryRestoredConditions(hero, session);
    session.enter(hero);
    expect(hero.conditions.get('haste')?.expiresAtMs).toBe(8_000);
  });
});
