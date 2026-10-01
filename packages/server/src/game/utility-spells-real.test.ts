import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import { BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, botConfigV2Schema, botSlotSchema } from '@draconya/content';
import type { Content } from '@draconya/content';
import { CharacterRuntime, createHuntSession, totalXpForLevel } from '@draconya/sim';
import type { HuntRuleset, Session } from '@draconya/sim';

// As magias utilitárias do #623 com o CONTEÚDO REAL: os arquivos `data/spells/*.json` de verdade,
// os mapas importados (Darashia Dragon Lair de três andares, Rotworm Caves com rope spots) e os
// itens de comida do catálogo. Os testes do `sim` falam de fixtures; este mora no servidor, que
// carrega o conteúdo de verdade — o que ele prende é que o arquivo, o schema, o catálogo e o
// motor concordam num lançamento ponta a ponta.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

const SPELLS = [
  'light', 'great-light', 'ultimate-light-druid', 'levitate-up', 'levitate-down', 'magic-rope',
  'find-person', 'find-fiend', 'food',
] as const;

/** Um druida level 60 — a única vocação que lança Food e a Ultimate Light junto do resto. */
function enter(content: Content, huntId: string): { session: Session; ruleset: HuntRuleset; hero: CharacterRuntime } {
  const session = createHuntSession({
    id: 'utility-real', content, huntId, difficulty: 'default', createdAtMs: 0,
    botConfig: botConfigV2Schema.parse({
      version: BOT_VOCABULARY_VERSION, activeSet: 0,
      sets: [0, 1, 2, 3].map((set) => ({
        slots: Array.from({ length: BOT_SLOTS_PER_SET }, (_, slot) => {
          const spellId = set === 0 ? SPELLS[slot] : undefined;
          return spellId === undefined
            ? null
            : botSlotSchema.parse({ do: { kind: 'spell', spellId }, auto: false });
        }),
      })),
    }),
  });
  // HP absurdo E `xp` coerente com o level — o mesmo cuidado de `darashia-dragon-lair.test.ts`:
  // o teste mede a magia, não quanto o herói aguenta dos monstros que nascem em volta.
  const hero = new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 8 },
    health: 10_000_000, maxHealth: 10_000_000, mana: 10_000, maxMana: 10_000,
    level: 60, xp: totalXpForLevel(60, content.progression), vocationId: 'druid',
    staminaMs: 86_400_000, staminaUpdatedAtMs: 0, gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    soul: 100, capacity: 100_000,
  });
  session.enter(hero);
  return { session, ruleset: session.ruleset as HuntRuleset, hero };
}

const cast = (run: { ruleset: HuntRuleset; session: Session }, spellId: (typeof SPELLS)[number]) =>
  run.ruleset.useSlot(run.session, 'hero', 0, SPELLS.indexOf(spellId));

describe('as utilitárias do #623 no conteúdo real', () => {
  it('Ultimate Light (druid): a condição sai com os números do Canary e vence no instante exato', () => {
    const run = enter(real(), 'darashia-dragon-lair');
    expect(cast(run, 'ultimate-light-druid')).toEqual({ ok: true });
    expect(run.hero.mana).toBe(10_000 - 140);
    expect(run.hero.conditions.get('light')).toMatchObject({
      spellId: 'ultimate-light-druid', expiresAtMs: 1_990_000,
      light: { level: 8, color: 215, durationMs: 1_990_000 },
    });
  });

  it('Levitate (down) numa borda REAL da Darashia Dragon Lair: desce do z10 para o z11', () => {
    // (52,35,10) encarando o sul: o tile da frente é vazio no z10 e o pouso (52,36,11) é chão do
    // z11 — o par que `levitateDestination` acha varrendo o mapa importado.
    const run = enter(real(), 'darashia-dragon-lair');
    run.hero.position = { x: 52, y: 35, z: 10 };
    run.hero.direction = 'south';
    expect(cast(run, 'levitate-down')).toEqual({ ok: true });
    expect(run.hero.position).toEqual({ x: 52, y: 36, z: 11 });
    expect(run.hero.mana).toBe(10_000 - 50);
    // E de novo, já no z11 encarando chão livre à frente: a sonda tem chão, recusa sem custo.
    run.session.advanceBy(2_000);
    expect(cast(run, 'levitate-down')).toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
    expect(run.hero.mana).toBe(10_000 - 50);
  });

  it('Levitate na Rotworm Caves (um andar só no recorte): sem andar acima nem abaixo, recusa sem custo', () => {
    const run = enter(real(), 'rotworm-caves');
    run.hero.direction = 'east';
    expect(cast(run, 'levitate-up')).toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
    expect(cast(run, 'levitate-down')).toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
    expect(run.hero.mana).toBe(10_000);
  });

  it('Magic Rope num rope spot REAL da Rotworm Caves: o recorte não tem o z=7, então "sem espaço"', () => {
    // O importador classifica 3 rope spots na Rotworm Caves (ADR 0050 d.1) e o recorte tem só o
    // andar 8 — a corda reconhece o rope spot, mas o andar de cima não está no mapa. Quando o
    // recorte ganhar o z=7 este teste vira um pouso de verdade.
    const run = enter(real(), 'rotworm-caves');
    run.hero.position = { x: 40, y: 7, z: 8 };
    expect(cast(run, 'magic-rope')).toEqual({ ok: false, reason: 'not-enough-room', retryInMs: 0 });
    expect(run.hero.mana).toBe(10_000);
    // Fora do rope spot é "não possível" — o `Tile:isRopeSpot()` do Canary.
    run.hero.position = { x: 41, y: 7, z: 8 };
    expect(cast(run, 'magic-rope')).toEqual({ ok: false, reason: 'not-possible', retryInMs: 0 });
  });

  it('Find Person e Find Fiend sem alvo recusam; Food cria comida REAL e o `use-item` a come', () => {
    const run = enter(real(), 'darashia-dragon-lair');
    expect(cast(run, 'find-person')).toEqual({ ok: false, reason: 'person-not-found', retryInMs: 0 });
    // O nome sem jogador é a recusa de `InstantSpell::playerCastInstant`: inicia o cooldown da magia
    // e o do grupo `support` (2 s), sem mana nem alma — o Find Fiend logo em seguida está exausto.
    expect(run.hero.mana).toBe(10_000);
    expect(run.hero.soul).toBe(100);
    expect(cast(run, 'find-fiend')).toEqual({ ok: false, reason: 'on-cooldown', retryInMs: 2_000 });
    run.session.advanceBy(2_000);
    // Já o Find Fiend sem fiendish é recusa de SCRIPT: sem custo e sem cooldown — a Food sai logo.
    expect(cast(run, 'find-fiend')).toEqual({ ok: false, reason: 'no-creatures-around', retryInMs: 0 });

    expect(cast(run, 'food')).toEqual({ ok: true });
    expect(run.hero.mana).toBe(10_000 - 120);
    expect(run.hero.soul).toBe(99);
    const created = [...run.hero.inventory.items()];
    expect(created.length).toBeGreaterThan(0);
    const foods = ['meat', 'ham', 'grapes', 'red-apple', 'bread', 'roll', 'cheese'];
    for (const item of created) expect(foods).toContain(item.itemId);
    const first = created[0];
    if (first === undefined) throw new Error('a Food não criou nada');
    expect(run.ruleset.useItem(run.session, 'hero', { instanceId: first.instanceId }, 1)).toEqual({ ok: true });
    expect(run.hero.fedMs).toBeGreaterThan(0);
  });

  it('as nove magias existem no catálogo real com o vocacional certo', () => {
    const content = real();
    for (const id of SPELLS) expect(content.spells.has(id), id).toBe(true);
    expect(content.spells.get('food')?.vocationId).toBe('druid');
    expect(content.spells.get('ultimate-light-druid')?.vocationId).toBe('druid');
    expect(content.spells.get('light')?.vocationId).toBeUndefined();
  });
});
