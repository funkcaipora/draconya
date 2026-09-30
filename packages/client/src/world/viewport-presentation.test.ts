// A apresentação do monstro no viewport (#620): addons do outfit, luz, fala periódica e a cor do
// número pela raça. Tudo é desenho — o servidor só manda os campos no `creature-appear` — e o
// sorteio da fala é do CLIENTE (`random` injetado), nunca o `Rng` da sessão.
//
// O mesmo mock do Pixi e o mesmo harness de `viewport.test.ts` (issue #381): o teste afirma
// decisões — que container recebeu o quê, com que texto, cor e posição —, sem GPU e sem DOM.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => import('./testing/pixi-fake.js'));

import { Graphics, Text, type Container } from './testing/pixi-fake.js';
import { SyntheticArt, type SyntheticCatalog } from './testing/art.js';
import { mountTestViewport, resetWorld, sceneOf, testClock } from './testing/harness.js';
import { addFloatingText, world, type Creature } from '../state/world.js';
import { TILE, toScreen, viewFor, zoomFor } from './camera.js';
import { LIGHT_RING_ALPHA, LIGHT_RINGS, lightTint } from './creature-light.js';
import { SPEECH_COLOR, SPEECH_MIN_MS, speechDurationMs } from './speech.js';

const GRASS = 100;
const RAT = 21;
const CATALOG: SyntheticCatalog = { [GRASS]: { kind: 'object' }, [RAT]: { kind: 'outfit' } };

beforeEach(resetWorld);

const scene = () => sceneOf({ width: 40, height: 40, floors: [7], fill: { 7: { ground: GRASS, items: [] } } });

/** Um monstro com apresentação, escrito no `world` como `apply.ts` o faria. */
function monster(
  id: number, at: { x: number; y: number }, extra: Partial<Creature> = {},
): Creature {
  const creature: Creature = {
    id, appearanceId: RAT, name: `monster-${id}`, health: 100, maxHealth: 100,
    position: { ...at, z: 7 }, step: null, ...extra,
  };
  world.creatures.set(id, creature);
  return creature;
}

async function mount(random?: () => number) {
  const clock = testClock();
  const art = new SyntheticArt(CATALOG, { now: clock.now });
  const viewport = await mountTestViewport({
    scene: scene(), art, clock, ...(random === undefined ? {} : { viewport: { random } }),
  });
  viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, RAT);
  return { viewport, art };
}

const glows = (effects: Container): Graphics[] => effects.children.filter(
  (child): child is Graphics => child instanceof Graphics,
);
const texts = (overlay: Container): Text[] => overlay.children.filter(
  (child): child is Text => child instanceof Text,
);

describe('os addons do outfit do monstro (#620)', () => {
  it('a máscara do servidor chega à arte: o monstro com addon pede o quadro COMPOSTO', async () => {
    // Mutação que mata: `creatureTexture` não repassar `creature.addons` (o monstro sairia sem
    // addon), ou repassá-lo sem pô-lo na chave do livro (o quadro sem addon ganharia a entrada).
    const { viewport, art } = await mount();
    monster(2, { x: 12, y: 10 }, { addons: 3 });
    monster(3, { x: 13, y: 10 });
    await viewport.tick(0);
    await viewport.tick(16);
    expect(viewport.creatureSprite(2)?.texture.source.resource).toBe(art.bitmapOf('outfit:21:south:s:0:a3'));
    expect(viewport.creatureSprite(3)?.texture.source.resource).toBe(art.bitmapOf('outfit:21:south:s:0'));
    // Os dois bitmaps são DIFERENTES: a chave do livro separa os quadros com e sem addon.
    expect(art.bitmapOf('outfit:21:south:s:0:a3')).not.toBe(art.bitmapOf('outfit:21:south:s:0'));
  });
});

describe('a luz do monstro (#620)', () => {
  it('ganha um clarão ADITIVO no `effects`: anéis concêntricos da cor do Canary, no tile dele', async () => {
    const { viewport } = await mount();
    monster(2, { x: 12, y: 10 }, { light: { level: 4, color: 208 } });
    await viewport.tick(0);
    await viewport.tick(16);

    const [glow, ...others] = glows(viewport.layers().effects);
    expect(others).toHaveLength(0);
    expect(glow?.blendMode).toBe('add');
    const circles = (glow?.ops ?? []).filter((op) => op.kind === 'circle');
    expect(circles).toHaveLength(LIGHT_RINGS);
    // O maior anel é o alcance inteiro: `level` tiles.
    expect(circles.at(-1)).toMatchObject({ x: 0, y: 0, radius: 4 * TILE });
    // Cada anel é pintado com a cor do índice 208 da paleta de 216, com pouco alfa.
    const fills = (glow?.ops ?? []).filter((op) => op.kind === 'fill');
    expect(fills).toHaveLength(LIGHT_RINGS);
    for (const fill of fills) expect(fill).toEqual({ kind: 'fill', color: lightTint(208), alpha: LIGHT_RING_ALPHA });

    // E é centrado no tile do monstro: o centro do tile dele na tela, com a câmera no herói.
    const view = viewFor(576, 448, zoomFor(576, 448));
    const screen = toScreen({ x: 12, y: 10 }, { x: 10, y: 10, z: 7 }, view);
    expect(glow?.x).toBe(screen.x + TILE / 2);
    expect(glow?.y).toBe(screen.y + TILE / 2);
    expect(glow?.visible).toBe(true);
  });

  it('redesenha só quando `nível:cor` muda, e o resto do quadro é mover o desenho', async () => {
    const { viewport } = await mount();
    const creature = monster(2, { x: 12, y: 10 }, { light: { level: 4, color: 208 } });
    await viewport.tick(0);
    await viewport.tick(16);
    await viewport.tick(32);
    const glow = glows(viewport.layers().effects)[0];
    expect(glow?.clears).toBe(1);

    world.creatures.set(2, { ...creature, light: { level: 2, color: 30 } });
    await viewport.tick(48);
    expect(glow?.clears).toBe(2);
    const circles = (glow?.ops ?? []).filter((op) => op.kind === 'circle');
    expect(circles.at(-1)).toMatchObject({ radius: 2 * TILE });
    expect((glow?.ops ?? []).find((op) => op.kind === 'fill')).toMatchObject({ color: lightTint(30) });
  });

  it('o monstro sem luz não ganha clarão, e o que some leva o dele junto', async () => {
    const { viewport } = await mount();
    monster(2, { x: 12, y: 10 });
    monster(3, { x: 13, y: 10 }, { light: { level: 3, color: 5 } });
    await viewport.tick(0);
    await viewport.tick(16);
    const [glow] = glows(viewport.layers().effects);
    expect(glows(viewport.layers().effects)).toHaveLength(1);

    world.creatures.delete(3);
    await viewport.tick(32);
    expect(glow?.destroyed).toBe(true);
    expect(glows(viewport.layers().effects)).toHaveLength(0);
  });

  it('a criatura fora da janela esconde o clarão — nada brilha no escuro da borda', async () => {
    const { viewport } = await mount();
    const creature = monster(2, { x: 12, y: 10 }, { light: { level: 4, color: 208 } });
    await viewport.tick(0);
    await viewport.tick(16);
    const glow = glows(viewport.layers().effects)[0];
    expect(glow?.visible).toBe(true);

    world.creatures.set(2, { ...creature, position: { x: 38, y: 38, z: 7 } });
    await viewport.tick(32);
    expect(glow?.visible).toBe(false);
  });
});

describe('a fala periódica do monstro (#620)', () => {
  const voices = {
    intervalMs: 5000, chance: 10,
    lines: [{ text: 'Meep!' }, { text: 'GRR' }],
  };
  const speaking = (overlay: Container, text: string) => texts(overlay).find((label) => label.text === text);

  it('fala no intervalo, com o sorteio do CLIENTE, sobre o nome, e some depois', async () => {
    // `random: () => 0` é roll 1 (`<= 10`, passa) e a primeira linha. O `Rng` da sessão nem existe
    // no cliente: é este `random` que decide.
    const random = vi.fn(() => 0);
    const { viewport } = await mount(random);
    monster(2, { x: 12, y: 10 }, { voices });
    await viewport.tick(0);
    await viewport.tick(4999);
    const overlay = viewport.layers().overlay;
    expect(speaking(overlay, 'Meep!')).toBeUndefined();
    expect(random).not.toHaveBeenCalled();

    await viewport.tick(5000);
    const label = speaking(overlay, 'Meep!');
    expect(label?.visible).toBe(true);
    expect(label?.style.fill).toBe(SPEECH_COLOR);
    // Sobre o nome dele: a âncora é embaixo, e termina uma altura de nome acima do nome.
    const name = texts(overlay).find((candidate) => candidate.text === 'monster-2');
    expect(label?.anchor.y).toBe(1);
    expect(label?.x).toBe(name?.x);
    expect(label?.y).toBeLessThan(name?.y ?? 0);

    // Fica o tempo da fala, e depois esconde.
    await viewport.tick(5000 + speechDurationMs('Meep!') - 1);
    expect(label?.visible).toBe(true);
    await viewport.tick(5000 + speechDurationMs('Meep!'));
    expect(label?.visible).toBe(false);
  });

  it('a chance que não passa não fala — e rola uma vez por intervalo, não por quadro', async () => {
    // `random: () => 0.99` é roll 100, que nunca passa de 10.
    const random = vi.fn(() => 0.99);
    const { viewport } = await mount(random);
    monster(2, { x: 12, y: 10 }, { voices });
    await viewport.tick(0);
    for (let t = 16; t <= 5000; t += 500) await viewport.tick(t);
    await viewport.tick(5016);
    expect(random).toHaveBeenCalledTimes(1);
    expect(speaking(viewport.layers().overlay, 'Meep!')).toBeUndefined();
    expect(speaking(viewport.layers().overlay, 'GRR')).toBeUndefined();
    await viewport.tick(10_016);
    expect(random).toHaveBeenCalledTimes(2);
  });

  it('a segunda linha sai quando o sorteio a escolhe', async () => {
    // roll 1 (passa), depois 0.9 × 2 linhas = índice 1.
    const values = [0, 0.9];
    const { viewport } = await mount(() => values.shift() ?? 0);
    monster(2, { x: 12, y: 10 }, { voices });
    await viewport.tick(0);
    await viewport.tick(5000);
    expect(speaking(viewport.layers().overlay, 'GRR')?.visible).toBe(true);
    expect(speaking(viewport.layers().overlay, 'Meep!')).toBeUndefined();
  });

  it('o monstro mudo nunca fala, e o que está fora da janela não roda o relógio', async () => {
    const random = vi.fn(() => 0);
    const { viewport } = await mount(random);
    monster(2, { x: 12, y: 10 });
    monster(3, { x: 38, y: 38 }, { voices });
    await viewport.tick(0);
    await viewport.tick(60_000);
    expect(random).not.toHaveBeenCalled();
    expect(speaking(viewport.layers().overlay, 'Meep!')).toBeUndefined();
  });

  it('o monstro que some leva a fala dele junto', async () => {
    const { viewport } = await mount(() => 0);
    monster(2, { x: 12, y: 10 }, { voices });
    await viewport.tick(0);
    await viewport.tick(5000);
    const label = speaking(viewport.layers().overlay, 'Meep!');
    expect(label).toBeDefined();
    world.creatures.delete(2);
    await viewport.tick(5016);
    expect(label?.destroyed).toBe(true);
  });

  it('a fala mais longa fica mais tempo que a mínima', () => {
    expect(speechDurationMs('a'.repeat(60))).toBeGreaterThan(SPEECH_MIN_MS);
  });
});

describe('o número do golpe físico no viewport (#620)', () => {
  it('sai na cor da RAÇA do alvo: veneno verde, e o herói continua vermelho', async () => {
    const { viewport } = await mount();
    monster(2, { x: 12, y: 10 }, { race: 'venom' });
    await viewport.tick(0);
    addFloatingText(2, 37, 'melee', 0, 'physical');
    addFloatingText(1, 11, 'melee', 0, 'physical');
    await viewport.tick(16);

    const overlay = viewport.layers().overlay;
    const onMonster = texts(overlay).find((label) => label.text === '37');
    const onHero = texts(overlay).find((label) => label.text === '11');
    expect(onMonster?.style.fill).toBe(0x00ff00);
    expect(onHero?.style.fill).toBe(0xff0000);
  });
});
