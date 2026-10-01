import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import { BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, botConfigV2Schema, botSlotSchema } from '@draconya/content';
import type { BotConfigV2, Content } from '@draconya/content';
import {
  CharacterRuntime, Rng, castSpell, createHuntSession, groupCooldownKey, learnedSpellsStateOf,
  secondaryCooldownKey, spellCooldownKey, statsForLevel, totalXpForLevel,
} from '@draconya/sim';
import type { HuntRuleset, Session } from '@draconya/sim';

// A Rat Cellars REAL (FUN-123): o bueiro de Rookgaard importado, a rota traçada sobre ele e o
// rato do Tibia. Os testes do `sim` falam de fixtures — e o `sim` não lê disco, nem em teste —;
// este mora no servidor, que carrega o conteúdo de verdade, e prende que ele roda: e roda igual
// em qualquer taxa, que é a propriedade do projeto.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

function enter(content: Content, difficulty = 'default'): { session: Session; ruleset: HuntRuleset } {
  const session = createHuntSession({
    id: 'cellars', content, huntId: 'rat-cellars', difficulty, createdAtMs: 0,
  });
  const stats = statsForLevel(8, null, content.progression);
  session.enter(new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 8 },
    health: stats.maxHealth, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
    level: 8, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
  }));
  return { session, ruleset: session.ruleset as HuntRuleset };
}

function run(session: Session, durationMs: number, stepMs: number): void {
  for (let t = 0; t < durationMs && session.ended === null; t += stepMs) session.advanceBy(stepMs);
}

describe('a Rat Cellars real (FUN-123, #583, #586)', () => {
  it('todos os 56 pontos de spawn nascem — sem pull, sem escolha de tamanho (ADR 0039)', () => {
    // Fim do pull por dificuldade: os 56 pontos da rota (importados do recorte real do Canary
    // pelo #586, `pnpm catalog:spawns --map rat-cellars`) nascem juntos, na entrada — a
    // densidade não é mais 2/5/8 escolhidos, é o total de pontos que a rota declara. A
    // população INICIAL nunca checa `blockable` (#583, `SpawnMonster::startup` do Canary); só o
    // tile onde o herói entra pode ficar ocupado no primeiro instante, então o teto observável
    // é 56, mas o instante inicial pode ficar um a menos.
    const { session, ruleset } = enter(real());
    let most = 0;
    for (let t = 0; t < 10_000; t += 100) {
      session.advanceBy(100);
      const alive = ruleset.monsters.filter((m) => m.alive).length;
      expect(alive).toBeLessThanOrEqual(56);
      most = Math.max(most, alive);
    }
    expect(most).toBeGreaterThanOrEqual(55);
  });

  it('o herói percorre o laço e o bueiro rende: abates, XP, gold e queijo em dez minutos', () => {
    const content = real();
    const { session, ruleset } = enter(content);
    run(session, 600_000, 100);
    expect(session.ended).toBeNull();
    expect(session.aggregates.kills).toBeGreaterThan(20);
    // O recorte real (#586) não é monotemático: rat, spider, rabbit, bug e cave-rat, cada um com
    // a própria XP base. O bestiário do herói (permanente, por monstro) diz quantos de cada um
    // morreram; ×3 é o bônus de level do conteúdo real, +200% até o level 300 (o herói do teste
    // nunca chega perto disso), #563.
    const hero = session.participants[0] as CharacterRuntime;
    const kills = hero.bestiary.getState();
    const expectedXp = Object.entries(kills).reduce((sum, [monsterId, count]) => {
      const experience = content.monsters.get(monsterId)?.experience ?? 0;
      return sum + count * experience * 3;
    }, 0);
    expect(session.aggregates.xpGained).toBe(expectedXp);
    expect(session.aggregates.goldGained).toBeGreaterThan(0);
    expect(session.aggregates.itemsLooted).toBeGreaterThan(0);
    // A rota é um laço de 160 tiles: o walker deu a volta ao menos uma vez.
    expect(ruleset.routeIndex).toBeGreaterThanOrEqual(0);
    // RF-05: o número fica visível para comparar com o recorde solo do Huntera (2.066 XP/h ·
    // 1.293 gp/h, docs/reference/huntera-observed.md §31) — comparação, não asserção: o bot do
    // Draconya e o jogador do recorde não seguem a mesma rotação, e o número real muda com a
    // rota e o combate desarmado do level 8.
    const hours = 600_000 / 3_600_000;
    console.log(
      `Rat Cellars (bold, 10 min): XP/h=${(session.aggregates.xpGained / hours).toFixed(0)} `
      + `gp/h=${(session.aggregates.goldGained / hours).toFixed(0)}`,
    );
  });

  it('dez minutos a 1 Hz e a 10 Hz dão o MESMO resultado no bueiro real', () => {
    // O teste que define o projeto (ADR 0003), agora sobre o conteúdo de verdade: nada aqui é
    // escrito por tick, então o extrato e a posição de cada monstro não dependem da taxa.
    const slow = enter(real());
    const fast = enter(real());
    run(slow.session, 600_000, 1_000);
    run(fast.session, 600_000, 100);
    expect(slow.session.aggregates).toEqual(fast.session.aggregates);
    expect(slow.ruleset.monsters.map((m) => [m.id, m.alive, m.position])).toEqual(
      fast.ruleset.monsters.map((m) => [m.id, m.alive, m.position]),
    );
    expect(slow.ruleset.groundItems).toEqual(fast.ruleset.groundItems);
  });
});

describe('Convince Creature e Animate Dead com o conteúdo REAL da Rat Cellars (#600)', () => {
  const runeConfig = (supplyId: string, auto: boolean): BotConfigV2 => {
    const slots: (ReturnType<typeof botSlotSchema.parse> | null)[] = [
      botSlotSchema.parse({ do: { kind: 'supply', supplyId }, auto }),
    ];
    while (slots.length < BOT_SLOTS_PER_SET) slots.push(null);
    const empty = { slots: Array.from({ length: BOT_SLOTS_PER_SET }, () => null) };
    return botConfigV2Schema.parse({
      version: BOT_VOCABULARY_VERSION, activeSet: 0, sets: [{ slots }, empty, empty, empty],
    });
  };
  // Level 30, magic level 10 (as runas pedem 5 e 4), com mana e gold de sobra — o herói não morre nem
  // fica sem nada no meio do teste.
  const enterWithRune = (content: Content, config: BotConfigV2): { session: Session; ruleset: HuntRuleset; hero: CharacterRuntime } => {
    const session = createHuntSession({
      id: 'runes', content, huntId: 'rat-cellars', difficulty: 'default', createdAtMs: 0, botConfig: config,
    });
    const stats = statsForLevel(30, null, content.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 8 },
      health: stats.maxHealth, maxHealth: stats.maxHealth, mana: 5_000, maxMana: 5_000,
      // O XP do level 30: o level é derivado do XP, e o primeiro rato morto o recalcularia para baixo.
      level: 30, xp: totalXpForLevel(30, content.progression), goldDelta: 0, gold: 100_000, alive: true,
      cooldowns: {}, skills: { magic: { level: 10, points: 0 } },
    });
    session.enter(hero);
    return { session, ruleset: session.ruleset as HuntRuleset, hero };
  };

  it('convence um Rat de verdade (mana 200 do rat.lua), e o ponto de spawn dele NÃO respawna enquanto ele vive', () => {
    const content = real();
    const { session, ruleset, hero } = enterWithRune(content, runeConfig('convince-creature-rune', false));
    session.advanceBy(200);
    const rat = ruleset.monsters.find((m) => m.alive && m.monsterId === 'rat');
    if (rat === undefined) throw new Error('sem rato');
    const before = ruleset.monsters.filter((m) => m.alive).length;

    expect(ruleset.useSlot(session, 'hero', 0, 0, { kind: 'monster', subject: rat.subject })).toEqual({ ok: true });
    expect(rat.masterId).toBe('hero');
    expect(hero.mana).toBe(5_000 - 200);
    // O preço real da runa (80, o menor `buy` dos NPCs do Canary).
    expect(hero.goldDelta).toBe(-80);

    // Um minuto depois nada respawnou no lugar dele (o respawn é de 90 s por ponto): a população
    // vinda do Spawner só cai — nunca sobe — e o convencido continua sendo do herói.
    run(session, 60_000, 100);
    expect(rat.masterId).toBe('hero');
    expect(ruleset.monsters.filter((m) => m.alive).length).toBeLessThanOrEqual(before);
  });

  it('o bot ergue Skeletons dos cadáveres da Rat Cellars, só depois da janela `unmove`, e o gold é o preço real (375)', () => {
    const content = real();
    const { session, ruleset, hero } = enterWithRune(content, runeConfig('animate-dead-rune', true));
    // O herói mata os ratos sozinho pelo caminho de sempre; os cadáveres vivem 670 s.
    run(session, 180_000, 100);
    const skeletons = ruleset.monsters.filter((m) => m.alive && m.masterId === 'hero');
    expect(skeletons.length).toBeGreaterThan(0);
    expect(skeletons.length).toBeLessThanOrEqual(2);
    expect(skeletons.every((m) => m.monsterId === 'skeleton')).toBe(true);
    // Cada Skeleton custou UMA runa (375, o preço real) — e a mana nunca sai. Um Skeleton que já
    // morreu em combate também custou a dele, então o total só tem piso.
    expect(session.aggregates.goldSpent % 375).toBe(0);
    expect(session.aggregates.goldSpent).toBeGreaterThanOrEqual(375 * skeletons.length);
    expect(hero.mana).toBe(5_000);
  });

  // A invocação nunca morre pela mão do mestre e o bot não a ataca: parada em cima do próximo tile da
  // rota, ela travava o passo do herói para sempre (o herói de level 30 dava 14 abates em 900 s contra
  // 102 sem a runa). No Canary o jogador ATRAVESSA a invocação de jogador no mundo no-pvp
  // (`Player::canWalkthrough`), então o laço continua girando com o convencido ou o Skeleton no caminho.
  it.each(['convince-creature-rune', 'animate-dead-rune'])(
    'o herói continua andando a rota com a invocação (%s) no caminho — não trava',
    (supplyId) => {
      const content = real();
      const { session, ruleset, hero } = enterWithRune(content, runeConfig(supplyId, true));
      run(session, 240_000, 100);
      expect(ruleset.monsters.some((m) => m.alive && m.masterId === 'hero')).toBe(true);

      // Dali em diante, a posição do herói muda ao longo dos 300 s seguintes (travado, quase nunca mudaria: 0 e 80 sem a travessia, 256 e 248 com ela).
      let changes = 0;
      let last = `${hero.position.x},${hero.position.y}`;
      for (let second = 0; second < 300; second += 1) {
        run(session, 1_000, 100);
        const now = `${hero.position.x},${hero.position.y}`;
        if (now !== last) changes += 1;
        last = now;
      }
      expect(changes).toBeGreaterThan(150);
      expect(hero.alive).toBe(true);
    },
  );
});

describe('o catálogo de magias por vocação com o conteúdo REAL (#156–#159)', () => {
  // Um personagem de level 200 de cada vocação lança UMA magia de cada tipo da vocação dele:
  // sai com `ok`, paga a mana e tranca os livros de cooldown certos. Outra vocação leva
  // `wrong-vocation`; um level abaixo, `level-too-low`. São os NÚMEROS reais passando pelo
  // motor — `casting.test.ts` testa o motor com magias sintéticas. Level 200 (não mais 100,
  // #589, nem 150): Strong Ethereal Spear e Fierce Berserk pedem 90, Ultimate Energy Strike pede
  // 100, Chivalrous Challenge pede 150 e o familiar de vocação (#599) pede 200 — o novo teto de
  // TODAS as quatro vocações.
  const caster = (
    content: Content, vocationId: string, level: number, learnsEverything = true,
  ): CharacterRuntime => {
    const vocation = content.vocations.get(vocationId) ?? null;
    const stats = statsForLevel(level, vocation, content.progression);
    return new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 8 },
      health: stats.maxHealth, maxHealth: stats.maxHealth, mana: 100_000, maxMana: 100_000,
      // #594: a conjuração é mais um `effect.kind`, e pede alma e o gold da runa em branco além
      // da mana — o mesmo motivo de `mana: 100_000` acima, só que para os dois custos novos.
      soul: 100, gold: 100_000,
      level, xp: 0, vocationId, goldDelta: 0, alive: true, cooldowns: {},
      // Sabe TODA magia do catálogo real (#624): o que se prende aqui é o número passando pelo
      // motor, e o portão do aprendizado tem o teste dele logo abaixo.
      ...(learnsEverything ? { learnedSpells: learnedSpellsStateOf(content.spells.keys()) } : {}),
    });
  };
  const aim = { distance: 1, targets: [{ armor: 0, dodgeChance: 0 }] };

  for (const vocationId of ['knight', 'paladin', 'sorcerer', 'druid']) {
    it(`a ${vocationId} casts one spell of each kind of the vocation`, () => {
      const content = real();
      // Alvo de party (#588: Heal/Protect/Enchant/Train Party) fica de fora: elas SEMPRE
      // recusam sem `partyTargets` (a mesma recusa "No party members in range" do Canary com
      // um lançador sozinho), e este harness testa UM herói solo — `casting.test.ts` é quem
      // exercita `castSpell` com a party colhida.
      const mine = [...content.spells.values()].filter(
        (s) => s.vocationId === vocationId
          && !((s.effect.kind === 'heal-over-time' || s.effect.kind === 'buff') && s.effect.target === 'party'),
      );
      expect(mine.length).toBeGreaterThan(0);
      const oneOfEach = new Map(mine.map((s) => [s.effect.kind, s]));
      let now = 0;
      for (const spell of oneOfEach.values()) {
        const hero = caster(content, vocationId, 200);
        // Self-origin ou no alvo: a mira sintética serve às duas — `distance` 1 cabe em todo
        // alcance, e a forma que sai do lançador ignora a distância. Challenge (#589) mira
        // como dano — precisa de alvo — mas não tem `formula`/`basePower`/`power` nenhum. DOT
        // (#596) também mira o alvo, como dano.
        const needsAim = spell.effect.kind === 'damage' || spell.effect.kind === 'challenge'
          || spell.effect.kind === 'damage-over-time';
        const result = castSpell(hero, spell, needsAim ? aim : null, now, content.combat, Rng.fromSeed(spell.id));
        expect(result.ok, spell.id).toBe(true);
        // `manaCost` é sempre NÚMERO aqui — o filtro acima já tirou as magias de party, as
        // únicas com `manaCost` escalado (`party-scaled`).
        expect(hero.mana, spell.id).toBe(100_000 - (spell.manaCost as number));
        expect(hero.cooldowns.isReady(spellCooldownKey(spell.id), now), spell.id).toBe(false);
        if (spell.group !== undefined) {
          expect(hero.cooldowns.isReady(groupCooldownKey(spell.group), now), spell.id).toBe(false);
        }
        if (spell.secondaryGroup !== undefined) {
          expect(hero.cooldowns.isReady(secondaryCooldownKey(spell.secondaryGroup.name), now), spell.id).toBe(false);
        }
        now += 1;
      }
      // Outra vocação, e um level abaixo do mínimo. A magia usada para o cross-vocation check
      // precisa ser a de MENOR `minLevel` da vocação (#596: `mine[0]` deixou de ser confiável —
      // a ordem é a de leitura do arquivo, alfabética por id, e `annihilation`/`ultimate-*`
      // entraram com level bem acima de 80) — senão o caster de level 80 da OUTRA vocação já
      // cairia em `level-too-low` antes de chegar a `wrong-vocation`.
      const first = mine.reduce((a, b) => (a.minLevel < b.minLevel ? a : b));
      const other = vocationId === 'knight' ? 'druid' : 'knight';
      expect(castSpell(caster(content, other, 80), first, aim, 0, content.combat, Rng.fromSeed('x')))
        .toMatchObject({ ok: false, reason: 'wrong-vocation' });
      const highest = mine.reduce((a, b) => (a.minLevel > b.minLevel ? a : b));
      expect(castSpell(caster(content, vocationId, highest.minLevel - 1), highest, aim, 0, content.combat, Rng.fromSeed('x')))
        .toMatchObject({ ok: false, reason: 'level-too-low' });
    });

    it(`a ${vocationId} that has not learned a spell cannot cast it — and nothing is spent (#624)`, () => {
      const content = real();
      // A magia de MENOR level da vocação: a que o personagem alcança primeiro, e a que a
      // migração 0024 concede a todo mundo que já tinha o level dela.
      const first = [...content.spells.values()]
        .filter((s) => s.vocationId === vocationId)
        .reduce((a, b) => (a.minLevel < b.minLevel ? a : b));
      const hero = caster(content, vocationId, 150, false);
      const aimAt = first.effect.kind === 'damage' || first.effect.kind === 'challenge'
        || first.effect.kind === 'damage-over-time' ? aim : null;
      expect(castSpell(hero, first, aimAt, 0, content.combat, Rng.fromSeed('x')))
        .toEqual({ ok: false, reason: 'spell-not-learned', retryInMs: 0 });
      expect(hero.mana).toBe(100_000);
      expect(hero.cooldowns.isReady(spellCooldownKey(first.id), 0)).toBe(true);
      // Aprendida, a MESMA magia sai.
      hero.learnedSpells.grant(first.id);
      expect(castSpell(hero, first, aimAt, 0, content.combat, Rng.fromSeed('x')).ok).toBe(true);
    });
  }
});
