import { buildContent } from '@draconya/content';
import type { Content, RawContent } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { huntListings } from '../hunt/catalogue.js';
import { Rng } from '../rng.js';
import { Session } from '../session.js';
import {
  HuntRuleset, changeDifficulty, createHuntSession, huntRulesetFromSnapshot,
} from './hunt.js';
import type { HuntExitRule } from './hunt.js';

// Um mapa pequeno, com uma sala e um laço de dez tiles em volta dela. Pequeno de propósito:
// num mapa assim dá para dizer, olhando, onde cada criatura está — e um teste de simulação
// que ninguém consegue conferir a olho é um teste que ninguém confia.
const map = {
  id: 'arena', z: 7,
  grid: ['######', '#....#', '#....#', '#....#', '######'],
};

const route = {
  id: 'arena-loop', mapId: 'arena',
  tiles: [
    { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 3, y: 1, z: 7 }, { x: 4, y: 1, z: 7 },
    { x: 4, y: 2, z: 7 }, { x: 4, y: 3, z: 7 }, { x: 3, y: 3, z: 7 }, { x: 2, y: 3, z: 7 },
    { x: 1, y: 3, z: 7 }, { x: 1, y: 2, z: 7 },
  ],
  spawnPoints: [{ routeIndex: 4, radius: 2 }],
};

const rat = {
  id: 'rat', name: 'Rat', outfitId: 21, recommendedLevel: 1,
  health: 50, experience: 5, attack: 10, armor: 0,
  attackIntervalMs: 2000, stepDurationMs: 500, aggroRadius: 4, attackRange: 1,
  loot: [],
};

const hunt = {
  id: 'arena', name: 'Arena', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop',
  difficulties: {
    beginner: {
      perSpawnPoint: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 30_000,
    },
    professional: {
      perSpawnPoint: 3, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 10_000,
    },
  },
};

const progression = {
  id: 'baseline', startingHealth: 150, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  stepDurationMs: 500,
};

const combat = {
  id: 'baseline', dodgeMultiplier: 0.5,
  armorEffectiveness: { melee: 1, magic: 0 }, minimumDamageFraction: 0.1,
  // **Esquiva zero neste conteúdo de teste, e é decisão.** Com ela, dano vira função só do
  // tempo decorrido, e a comparação 10 Hz / 1 Hz mede o que ela deveria medir — a matemática
  // do tempo — em vez de medir em que ordem os sorteios caíram. Quem cuida do dodge é
  // `combat/damage.test.ts`, onde ele é o assunto.
  player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 0, dodgeChance: 0 },
};

const raw = (over: Partial<RawContent> = {}): RawContent => ({
  monsters: [rat], hunts: [hunt], vocations: [], progression: [progression], combat: [combat],
  maps: [map], routes: [route], ...over,
});

const content = (over: Partial<RawContent> = {}): Content => buildContent(raw(over));

const character = (over: Partial<{ health: number; maxHealth: number }> = {}): CharacterRuntime =>
  new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: over.health ?? 5000, maxHealth: over.maxHealth ?? 5000,
    mana: 0, maxMana: 0, level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
  });

interface Started {
  readonly session: Session;
  readonly hero: CharacterRuntime;
  readonly ruleset: HuntRuleset;
}

function start(
  options: { difficulty?: 'beginner' | 'professional'; exitRules?: readonly HuntExitRule[];
    health?: number; loaded?: Content } = {},
): Started {
  const session = createHuntSession({
    id: 'session-1',
    content: options.loaded ?? content(),
    huntId: 'arena',
    difficulty: options.difficulty ?? 'beginner',
    createdAtMs: 0,
    ...(options.exitRules === undefined ? {} : { exitRules: options.exitRules }),
  });
  const hero = character(options.health === undefined ? {} : { health: options.health });
  session.enter(hero);
  return { session, hero, ruleset: session.ruleset as HuntRuleset };
}

/** Avança `durationMs` em passos de `stepMs`. É como se controla o tempo sem esperar por ele. */
function run(session: Session, durationMs: number, stepMs: number): void {
  const end = session.nowMs + durationMs;
  for (let at = session.nowMs + stepMs; at <= end && session.ended === null; at += stepMs) {
    session.tick(at);
  }
}

describe('entrada', () => {
  it('cria a instância com o mapa, a rota e os spawns da dificuldade escolhida', () => {
    const { session, hero, ruleset } = start();

    expect(session.ruleset.type).toBe('hunt');
    // Fixada na criação (invariante 7): a hunt termina na versão em que começou.
    expect(session.contentVersion).toBe(content().version);
    // Entrou no começo da rota, não na posição que trouxe da cidade.
    expect(hero.position).toEqual({ x: 1, y: 1, z: 7 });

    session.tick(100);
    expect(ruleset.monsters).toHaveLength(1);
  });

  it('a densidade vem da dificuldade, e ela é dado', () => {
    // Trocar `perSpawnPoint` no JSON tem que mudar a hunt. Se precisasse de código, o formato
    // estaria errado — e é isso que este teste protege.
    const { session, ruleset } = start({ difficulty: 'professional' });
    session.tick(100);
    expect(ruleset.monsters).toHaveLength(3);
  });

  it('recusa um segundo personagem em vez de deixá-lo parado a hunt inteira', () => {
    const { session } = start();
    expect(() => session.enter(character())).toThrow(/um personagem por instância/);
  });

  it('recusa dificuldade que a hunt não define', () => {
    expect(() => createHuntSession({
      id: 's', content: content(), huntId: 'arena', difficulty: 'legendary', createdAtMs: 0,
    })).toThrow(/não define a dificuldade "legendary"/);
  });
});

describe('a sessão em si', () => {
  it('percorre a rota enquanto não há monstro ao alcance', () => {
    // Sem ponto de spawn não nasce nada: sobra só o andar.
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn });

    run(session, 1000, 100);
    // 500 ms por tile: um segundo de rota são dois tiles, e o primeiro passo sai já no
    // primeiro tick porque os cooldowns começam prontos (FUN-25).
    expect(hero.position).toEqual({ x: 4, y: 1, z: 7 });
  });

  it('para para lutar e retoma a rota depois, do mesmo índice', () => {
    const { session, ruleset, hero } = start();

    run(session, 1000, 100);
    // Parado, lutando: o rato saiu do ponto de spawn e encostou.
    expect(ruleset.monsters).toHaveLength(1);
    expect(session.aggregates.kills).toBe(0);
    const paradoEm = hero.position;
    const indice = ruleset.routeIndex;

    run(session, 3000, 100);
    // Matou e voltou a andar — do índice onde tinha parado, nunca do começo (FUN-42).
    expect(session.aggregates.kills).toBe(1);
    expect(ruleset.routeIndex).toBeGreaterThan(indice);
    expect(hero.position).not.toEqual(paradoEm);
  });

  it('credita XP por abate', () => {
    const { session, hero } = start();
    run(session, 10_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.xp).toBe(session.aggregates.kills * rat.experience);
    expect(session.aggregates.xpGained).toBe(hero.xp);
  });

  it('não transforma cada abate em evento notável', () => {
    // `notableEvents` é a lista curta da tela de retorno (§16.2). Uma hunt de oito horas com
    // uma linha por rato não é lista, é log — e ninguém lê log ao voltar.
    const { session } = start({ difficulty: 'professional' });
    run(session, 60_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(1);
    expect(session.notableEvents.filter((e) => e.type === 'kill')).toHaveLength(0);
  });

  it('o monstro morto volta a nascer depois do prazo da hunt, não na hora', () => {
    const { session, ruleset } = start();
    run(session, 6000, 100);
    expect(session.aggregates.kills).toBe(1);
    // Respawn instantâneo faria a rota deixar de importar: o personagem mataria tudo parado
    // num ponto só.
    expect(ruleset.monsters).toHaveLength(0);

    run(session, 30_000, 100);
    expect(ruleset.monsters).toHaveLength(1);
  });
});

describe('stamina zero', () => {
  it('NÃO encerra a hunt, e bloqueia só a recompensa', () => {
    // A regra que mais parece bug para quem implementa (§10.2). O personagem continua
    // caçando; o que ele deixa de ganhar é XP.
    const { session, hero, ruleset } = start({ difficulty: 'professional' });
    ruleset.staminaExhausted = true;

    run(session, 60_000, 100);

    expect(session.ended).toBeNull();
    expect(session.aggregates.kills).toBeGreaterThan(0);
    // O abate conta: o jogador matou, e o extrato mentiria se dissesse que não.
    expect(hero.xp).toBe(0);
    expect(session.aggregates.xpGained).toBe(0);
  });
});

describe('encerramento', () => {
  it('por ação manual, com extrato', () => {
    const { session } = start();
    run(session, 10_000, 100);
    const receipt = session.end('manual-exit');

    expect(session.ended).toBe('manual-exit');
    expect(receipt.reason).toBe('manual-exit');
    expect(receipt.aggregates.kills).toBeGreaterThan(0);
    expect(receipt.notableEvents.map((e) => e.type)).toContain('ended');
  });

  it('por regra automática de saída, dizendo QUAL regra', () => {
    // "Sua hunt encerrou por uma regra de saída" sem dizer qual é a mensagem que faz o
    // jogador desconfiar do bot que ele mesmo configurou.
    const rule: HuntExitRule = { id: 'two-kills', when: (view) => view.aggregates.kills >= 2 };
    const { session } = start({ exitRules: [rule] });

    run(session, 60_000, 100);

    expect(session.ended).toBe('exit-rule');
    expect(session.aggregates.kills).toBe(2);
    expect(session.notableEvents.find((e) => e.type === 'exit-rule')?.detail).toBe('two-kills');
  });

  it('por morte, com o extrato registrando a morte', () => {
    const { session, hero } = start({ health: 12 });
    run(session, 60_000, 100);

    expect(hero.alive).toBe(false);
    expect(session.ended).toBe('death');
    expect(session.aggregates.deaths).toBe(1);
    expect(session.notableEvents.map((e) => e.type)).toContain('death');
  });

  it('encerrada, não avança mais', () => {
    const { session, ruleset } = start();
    run(session, 10_000, 100);
    session.end('manual-exit');
    const antes = { ...session.aggregates };
    const monstros = ruleset.monsters.length;

    run(session, 60_000, 100);

    expect(session.aggregates).toEqual(antes);
    expect(ruleset.monsters).toHaveLength(monstros);
  });
});

describe('troca de dificuldade', () => {
  it('encerra a instância e cria outra, em vez de mudar no meio', () => {
    // §14.7: não existe alteração dinâmica. Mudar `perSpawnPoint` no meio deixaria monstros
    // da densidade antiga vivos ao lado dos novos, e o jogador veria uma dificuldade que não
    // é nenhuma das duas.
    const loaded = content();
    const { session, hero } = start({ loaded });
    run(session, 10_000, 100);

    const { session: nova, receipt } = changeDifficulty(session, {
      content: loaded, to: 'professional', newSessionId: 'session-2', nowMs: session.nowMs,
    });

    expect(session.ended).toBe('manual-exit');
    expect(receipt.aggregates.kills).toBeGreaterThan(0);
    expect(receipt.notableEvents.find((e) => e.type === 'difficulty-changed')?.detail)
      .toBe('beginner → professional');

    // Instância NOVA: id novo, agregados zerados, e a densidade da dificuldade nova.
    expect(nova.id).toBe('session-2');
    expect(nova.aggregates.kills).toBe(0);
    expect(nova.participants[0]).toBe(hero);
    nova.tick(nova.nowMs + 100);
    expect((nova.ruleset as HuntRuleset).monsters).toHaveLength(3);
  });
});

describe('snapshot', () => {
  it('retoma no mesmo ponto da rota, com os mesmos monstros e os mesmos prazos', () => {
    const loaded = content();
    const { session, ruleset } = start({ loaded });
    run(session, 8000, 100);

    const snapshot = session.snapshot();
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    const depois = retomado.ruleset as HuntRuleset;
    expect(depois.routeIndex).toBe(ruleset.routeIndex);
    expect(depois.monsters.map((m) => m.getState()))
      .toEqual(ruleset.monsters.map((m) => m.getState()));
    expect(retomado.aggregates).toEqual(session.aggregates);
    expect(retomado.participants[0]?.position).toEqual(session.participants[0]?.position);
  });

  it('recusa retomar num conteúdo que não tem mais a hunt', () => {
    // Retomar na hunt errada é pior que não retomar: seriam monstros de um mapa andando em
    // outro, creditando XP que ninguém sabe de onde veio.
    const loaded = content();
    const { session } = start({ loaded });
    run(session, 1000, 100);

    const outro = buildContent(raw({
      hunts: [{ ...hunt, id: 'other' }], routes: [route], maps: [map],
    }));
    expect(huntRulesetFromSnapshot(session.snapshot(), outro)).toBeNull();
  });
});

describe('taxa de tick', () => {
  /** Dez minutos de hunt na taxa dada. Tempo controlado: nada aqui espera de verdade. */
  const tenMinutesAt = (
    hz: number, difficulty: 'beginner' | 'professional',
  ): { session: Session; hero: CharacterRuntime } => {
    const { session, hero } = start({ difficulty });
    run(session, 600_000, 1000 / hz);
    return { session, hero };
  };

  const RATES = [1, 2, 5, 10, 20];

  it('rende exatamente o mesmo a 1, 2, 5, 10 e 20 Hz', () => {
    // O TESTE QUE DEFINE O PROJETO, agora numa sessão que de fato simula uma hunt. Se ele
    // quebrar, alguma fórmula passou a contar ticks — e a hunt desanexada, que é o modo
    // PADRÃO do jogo, deixou de valer o mesmo que a anexada (invariantes 2 e 3).
    const rendimento = RATES.map((hz) => {
      const { session, hero } = tenMinutesAt(hz, 'beginner');
      return { kills: session.aggregates.kills, xp: session.aggregates.xpGained, heroXp: hero.xp };
    });
    expect(rendimento[0]?.kills).toBeGreaterThan(0);
    for (const resultado of rendimento) expect(resultado).toEqual(rendimento[0]);
  });

  it('com vários monstros no mesmo ponto, rende quase o mesmo — e o quase é medido', () => {
    // Um monstro por ponto dá igualdade EXATA. Com três disputando o mesmo ponto, quem está
    // "mais perto" muda com a granularidade do passo, e daí sai uma diferença de poucos por
    // cento. É a razão de este teste existir separado do de cima: o número acima é uma
    // igualdade, este é um limite, e confundir os dois esconderia uma regressão de verdade.
    const kills = RATES.map((hz) => tenMinutesAt(hz, 'professional').session.aggregates.kills);
    const menor = Math.min(...kills);
    const maior = Math.max(...kills);
    expect(menor).toBeGreaterThan(0);
    expect(maior - menor).toBeLessThanOrEqual(maior * 0.05);
  });

  it('mas o dano SOFRIDO não é igual, e é a taxa baixa que apanha mais', () => {
    // Medido, não suposto: a recompensa é (quase) idêntica em qualquer taxa; o dano recebido
    // não é.
    //
    // A causa é granularidade de ESPAÇO, não de tempo. Num tick de 1 s o personagem e o rato
    // andam dois tiles cada um de uma vez, e a adjacência é conferida UMA vez no fim: eles
    // passam mais ticks colados do que passariam a 10 Hz, e o acumulador de ataque do rato
    // avança justamente enquanto estão colados.
    //
    // Corrigir pediria subdividir o tick — o que gasta exatamente o que cair para 1 Hz
    // economiza, e economizar é a razão de existir do 1 Hz (ADR 0003). Fica registrado em
    // docs/product/hunt.md, e importa para a FUN-38: quem caça desanexado apanha mais.
    const rapido = tenMinutesAt(10, 'beginner');
    const lento = tenMinutesAt(1, 'beginner');

    const danoRapido = rapido.hero.maxHealth - rapido.hero.health;
    const danoLento = lento.hero.maxHealth - lento.hero.health;
    expect(danoRapido).toBeGreaterThan(0);
    expect(danoLento).toBeGreaterThan(danoRapido);
    // Limitado, e é isso que torna a diferença tolerável em vez de um buraco: menos que o
    // dobro. Se um dia passar disso, alguma coisa mudou de natureza e vale reabrir.
    expect(danoLento).toBeLessThan(danoRapido * 2);
  });

  it('desanexada cai para 1 Hz; anexada sobe para 10 (ADR 0003)', () => {
    const { session } = start();
    expect(session.currentHz()).toBe(1);
    session.attach('viewer');
    expect(session.currentHz()).toBe(10);
  });
});

describe('seleção de hunt', () => {
  it('mostra level recomendado e não tem onde guardar XP/h', () => {
    // §14.3. A regra vira ESTRUTURA: um número oficial de XP/h vira a métrica pela qual toda
    // hunt é julgada, e a partir daí só existe uma hunt boa — a do topo da tabela.
    const [listing] = huntListings(content());
    expect(listing).toEqual({
      id: 'arena', name: 'Arena', recommendedLevel: 1,
      difficulties: ['beginner', 'professional'],
    });
  });

  it('ordena por level recomendado, para servir a quem está começando', () => {
    const alta = { ...hunt, id: 'deep', name: 'Deep', recommendedLevel: 50 };
    expect(huntListings(content({ hunts: [alta, hunt] })).map((h) => h.id))
      .toEqual(['arena', 'deep']);
  });
});
