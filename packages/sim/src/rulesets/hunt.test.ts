import { buildContent } from '@draconya/content';
import type { Content, Progression, RawContent } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { huntListings } from '../hunt/catalogue.js';
import { statsForLevel, totalXpForLevel } from '../progression.js';
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
  // HP inicial absurdo de propósito. Subir de level RECALCULA `maxHealth` pela tabela
  // (FUN-34/FUN-37), então um herói com HP inventado no teste perderia a vida toda no
  // primeiro level up. Dar a ele um pool enorme VINDO DA TABELA mantém tudo coerente e deixa
  // dez minutos de hunt caberem sem morrer — o personagem ainda não regenera nada, e é isso
  // que a FUN-38 e as poções vão resolver.
  id: 'baseline', startingHealth: 500_000, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  stepDurationMs: 500,
  regen: { healthPerSecond: 1, manaPerSecond: 1 },
  xp: { base: 20, exponent: 2 },
  deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
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

const stamina = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };

const raw = (over: Partial<RawContent> = {}): RawContent => ({
  monsters: [rat], hunts: [hunt], vocations: [], progression: [progression], combat: [combat],
  stamina: [stamina], maps: [map], routes: [route], ...over,
});

const content = (over: Partial<RawContent> = {}): Content => buildContent(raw(over));

const character = (over: Partial<{ health: number; staminaMs: number }> = {}): CharacterRuntime => {
  const stats = statsForLevel(1, null, progression as Progression);
  return new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: over.health ?? stats.maxHealth, maxHealth: stats.maxHealth,
    mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
    staminaMs: over.staminaMs ?? stamina.maxMs, staminaUpdatedAtMs: 0,
    goldDelta: 0, alive: true, cooldowns: {},
  });
};

interface Started {
  readonly session: Session;
  readonly hero: CharacterRuntime;
  readonly ruleset: HuntRuleset;
}

function start(
  options: { difficulty?: 'beginner' | 'professional'; exitRules?: readonly HuntExitRule[];
    health?: number; staminaMs?: number; loaded?: Content } = {},
): Started {
  const session = createHuntSession({
    id: 'session-1',
    content: options.loaded ?? content(),
    huntId: 'arena',
    difficulty: options.difficulty ?? 'beginner',
    createdAtMs: 0,
    ...(options.exitRules === undefined ? {} : { exitRules: options.exitRules }),
  });
  const hero = character({
    ...(options.health === undefined ? {} : { health: options.health }),
    ...(options.staminaMs === undefined ? {} : { staminaMs: options.staminaMs }),
  });
  session.enter(hero);
  return { session, hero, ruleset: session.ruleset as HuntRuleset };
}

/** Avança `durationMs` em passos de `stepMs`. É como se controla o tempo sem esperar por ele. */
function run(session: Session, durationMs: number, stepMs: number): void {
  const steps = Math.floor(durationMs / stepMs);
  for (let i = 0; i < steps && session.ended === null; i++) session.advanceBy(stepMs);
}

describe('entrada', () => {
  it('cria a instância com o mapa, a rota e os spawns da dificuldade escolhida', () => {
    const { session, hero, ruleset } = start();

    expect(session.ruleset.type).toBe('hunt');
    // Fixada na criação (invariante 7): a hunt termina na versão em que começou.
    expect(session.contentVersion).toBe(content().version);
    // Entrou no começo da rota, não na posição que trouxe da cidade.
    expect(hero.position).toEqual({ x: 1, y: 1, z: 7 });

    session.advanceBy(100);
    expect(ruleset.monsters).toHaveLength(1);
  });

  it('a densidade vem da dificuldade, e ela é dado', () => {
    // Trocar `perSpawnPoint` no JSON tem que mudar a hunt. Se precisasse de código, o formato
    // estaria errado — e é isso que este teste protege.
    const { session, ruleset } = start({ difficulty: 'professional' });
    session.advanceBy(100);
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
    // Até o primeiro abate, e guarda o instante: o prazo conta a partir dele, e prender o
    // teste a um número redondo o faria depender de quantos golpes o herói precisou dar.
    while (session.aggregates.kills === 0 && session.nowMs < 60_000) session.advanceBy(100);
    expect(session.aggregates.kills).toBe(1);
    // Respawn instantâneo faria a rota deixar de importar: o personagem mataria tudo parado
    // num ponto só.
    expect(ruleset.monsters).toHaveLength(0);

    // Ainda dentro dos 30 s da dificuldade: nada nasce, e portanto nada mais morre.
    session.advanceBy(29_000);
    expect(ruleset.monsters).toHaveLength(0);
    expect(session.aggregates.kills).toBe(1);

    // Prazo cumprido: o evento de spawn vence dentro deste avanço.
    session.advanceBy(1_000);
    expect(ruleset.monsters).toHaveLength(1);
  });
});

describe('regeneração (FUN-36)', () => {
  it('recupera por tempo decorrido, sem número por tick', () => {
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn, health: 100 });

    run(session, 30_000, 100);

    // 1 HP/s no conteúdo de teste: trinta segundos são trinta pontos, mais um do primeiro
    // tick — os cooldowns começam PRONTOS (FUN-25), a mesma regra que faz o personagem dar o
    // primeiro passo da rota sem esperar meio segundo parado.
    expect(hero.health).toBe(131);
  });

  it('rende exatamente o mesmo a 10 Hz e a 1 Hz', () => {
    // O erro que este desenho evita: somar `taxa * dtMs / 1000` num acumulador fracionário
    // deriva em ponto flutuante e some com uma unidade a cada dez. Em milissegundos a conta
    // é exata, e a hunt desanexada regenera igual à anexada.
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const at = (hz: number): number => {
      const { session, hero } = start({ loaded: semSpawn, health: 100 });
      run(session, 600_000, 1000 / hz);
      return hero.health;
    };
    expect(at(1)).toBe(at(10));
    expect(at(20)).toBe(at(10));
  });

  it('não passa do máximo', () => {
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn });
    run(session, 60_000, 100);
    expect(hero.health).toBe(hero.maxHealth);
  });

  it('morto não regenera', () => {
    // Sem isso, um personagem que caiu voltaria sozinho na hunt em que morreu, e a morte
    // deixaria de encerrar coisa nenhuma.
    const { session, hero } = start({ difficulty: 'professional', health: 12 });
    run(session, 60_000, 100);
    expect(session.ended).toBe('death');
    expect(hero.health).toBe(0);
  });

  it('vale mesmo com stamina zerada: regenerar não é recompensa', () => {
    // O §10.2 diz que o personagem continua podendo morrer, não que ele passa a morrer mais
    // rápido.
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn, health: 100, staminaMs: 0 });
    run(session, 30_000, 100);
    expect(hero.health).toBe(131);
  });

  it('taxa zero não regenera, e não trava o laço de recuperação', () => {
    // Taxa zero não é intervalo infinito: é "não regenera". Sem a saída explícita, o
    // intervalo viraria `Infinity` e o catch-up rodaria até o teto a cada tick.
    const parado = content({
      routes: [{ ...route, spawnPoints: [] }],
      progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    });
    const { session, hero } = start({ loaded: parado, health: 100 });
    run(session, 30_000, 100);
    expect(hero.health).toBe(100);
  });
});

describe('stamina zero', () => {
  it('NÃO encerra a hunt, e bloqueia só a recompensa', () => {
    // A regra que mais parece bug para quem implementa (§10.2). O personagem continua
    // caçando; o que ele deixa de ganhar é XP.
    const { session, hero } = start({ difficulty: 'professional', staminaMs: 0 });

    run(session, 60_000, 100);

    expect(session.ended).toBeNull();
    expect(session.aggregates.kills).toBeGreaterThan(0);
    // O abate conta: o jogador matou, e o extrato mentiria se dissesse que não.
    expect(hero.xp).toBe(0);
    expect(session.aggregates.xpGained).toBe(0);
  });

  it('cai 1:1 com o tempo de hunt', () => {
    const { session, hero } = start();
    run(session, 30_000, 100);
    expect(hero.staminaMs).toBe(86_400_000 - 30_000);
  });

  it('avisa UMA vez ao zerar, e a hunt segue', () => {
    // O cenário comum é o jogador ausente: daqui para a frente a hunt queima supply sem
    // gerar nada. Repetir a linha a cada tick encheria a tela de retorno com ela só.
    const { session } = start({ difficulty: 'professional', staminaMs: 5_000 });

    run(session, 60_000, 100);

    expect(session.ended).toBeNull();
    expect(session.notableEvents.filter((e) => e.type === 'stamina-exhausted'))
      .toHaveLength(1);
  });

  it('a hunt rende normalmente enquanto sobra stamina', () => {
    const { session, hero } = start({ difficulty: 'professional' });
    run(session, 60_000, 100);
    expect(hero.xp).toBeGreaterThan(0);
  });
});

describe('level up e penalidade de morte dentro da hunt', () => {
  it('subir de level É evento notável, ao contrário do abate', () => {
    // É a única coisa que aconteceu numa hunt de oito horas que o jogador quer ver ao voltar.
    const { session } = start({ difficulty: 'professional' });
    run(session, 120_000, 100);
    expect(session.notableEvents.filter((e) => e.type === 'level-up').length)
      .toBeGreaterThan(0);
  });

  it('morrer cobra XP, e o extrato conta a perda em vez de escondê-la', () => {
    // O extrato é o que vira linha de ledger: creditar a XP ganha sem descontar a perdida
    // daria ao jogador uma XP que ele não tem.
    const { session, hero } = start({ difficulty: 'professional', health: 12 });
    hero.level = 20;
    hero.xp = totalXpForLevel(20, progression as Progression);

    run(session, 60_000, 100);

    expect(session.ended).toBe('death');
    expect(hero.level).toBe(19);
    expect(session.aggregates.xpGained).toBeLessThan(0);
    expect(session.notableEvents.find((e) => e.type === 'xp-penalty')).toBeDefined();
    expect(session.notableEvents.find((e) => e.type === 'level-down')?.detail).toBe('20 → 19');
  });

  it('Premium paga menos por morrer', () => {
    const cobrança = (premium: boolean): number => {
      const session = createHuntSession({
        id: 's', content: content(), huntId: 'arena', difficulty: 'professional',
        createdAtMs: 0, premium,
      });
      const hero = character({ health: 12 });
      hero.level = 20;
      hero.xp = totalXpForLevel(20, progression as Progression);
      session.enter(hero);
      run(session, 60_000, 100);
      return Number(session.notableEvents.find((e) => e.type === 'xp-penalty')?.detail);
    };
    expect(cobrança(true)).toBeLessThan(cobrança(false));
  });

  it('sair ou ser encerrado por regra NÃO custa XP: quem paga é quem morre', () => {
    const { session, hero } = start({ difficulty: 'professional' });
    hero.level = 20;
    hero.xp = totalXpForLevel(20, progression as Progression);
    const antes = hero.xp;

    run(session, 10_000, 100);
    session.end('manual-exit');

    expect(hero.xp).toBeGreaterThanOrEqual(antes);
    expect(session.notableEvents.find((e) => e.type === 'xp-penalty')).toBeUndefined();
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
    // Três ratos, não um: com a regeneração da FUN-36 no lugar, um rato sozinho já não mata
    // um personagem de level 1 — ele apanha, mata, e recupera durante o respawn.
    const { session, hero } = start({ difficulty: 'professional', health: 12 });
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
    nova.advanceBy(100);
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

describe('taxa de avanço', () => {
  /** Dez minutos de hunt na taxa dada. Tempo controlado: nada aqui espera de verdade. */
  const tenMinutesAt = (
    hz: number, difficulty: 'beginner' | 'professional', loaded?: Content,
  ): { session: Session; hero: CharacterRuntime } => {
    const { session, hero } = start({ difficulty, ...(loaded === undefined ? {} : { loaded }) });
    run(session, 600_000, 1000 / hz);
    return { session, hero };
  };

  const RATES = [1, 2, 5, 10, 20];

  it('rende exatamente o mesmo a 1, 2, 5, 10 e 20 Hz', () => {
    // O TESTE QUE DEFINE O PROJETO, agora numa sessão que de fato simula uma hunt. Se ele
    // quebrar, a hunt desanexada — que é o modo PADRÃO do jogo — deixou de valer o mesmo que
    // a anexada (invariantes 2 e 3).
    //
    // Desde a FUN-68 isto é uma propriedade da ESTRUTURA, e não de cada fórmula ter sido
    // escrita com cuidado: os eventos vencem nos mesmos instantes lógicos seja qual for o
    // tamanho da janela em que são despachados.
    const rendimento = RATES.map((hz) => {
      const { session, hero } = tenMinutesAt(hz, 'beginner');
      return { kills: session.aggregates.kills, xp: session.aggregates.xpGained, heroXp: hero.xp };
    });
    expect(rendimento[0]?.kills).toBeGreaterThan(0);
    for (const resultado of rendimento) expect(resultado).toEqual(rendimento[0]);
  });

  it('com vários monstros disputando o mesmo ponto, rende exatamente o mesmo', () => {
    // Este teste já foi um LIMITE de 5%, e virou igualdade na FUN-68. O motivo do limite era
    // real: com três monstros disputando um ponto, quem está "mais perto" mudava com a
    // granularidade do passo, porque num tick longo todos andavam vários tiles de uma vez
    // antes de alguém reavaliar distância. Com a fila, cada passo acontece no seu instante e
    // a vizinhança é a mesma em qualquer taxa — não sobra folga para o limite cobrir.
    const kills = RATES.map((hz) => tenMinutesAt(hz, 'professional').session.aggregates.kills);
    expect(kills[0]).toBeGreaterThan(0);
    for (const k of kills) expect(k).toBe(kills[0]);
  });

  it('e o dano SOFRIDO também é igual, desde a FUN-68', () => {
    // Este teste já foi um LIMITE, e virou uma igualdade. Vale guardar a história, porque ela
    // é a justificativa da FUN-68.
    //
    // A recompensa sempre foi igual entre taxas; o dano sofrido, não. Medido: 350 a 10 Hz
    // contra 530 a 1 Hz, 1,51× — e 1 Hz é a hunt desanexada, que é o modo PADRÃO do jogo.
    // Quem caçava AFK apanhava metade a mais.
    //
    // A causa era granularidade de ESPAÇO, não de tempo. Num tick de 1 s o personagem andava
    // dois tiles de uma vez, o rato também, e a adjacência era conferida UMA vez no fim: eles
    // passavam mais ticks colados do que passariam a 10 Hz, e é enquanto estão colados que o
    // ataque avança. O tick em lote não tinha como expressar "os dois andaram em t+500 e
    // nesse instante não estavam adjacentes".
    //
    // O comentário anterior dizia que corrigir "pediria subdividir o tick, o que gasta o que
    // cair para 1 Hz economiza". Era uma falsa escolha: o scheduler lógico processa só os
    // eventos que VENCEM, e é mais barato que o laço que ele substituiu.
    //
    // Sem regeneração NESTE cenário, e é decisão: a comparação é sobre granularidade, e um
    // personagem que se cura enquanto apanha mede as duas coisas somadas.
    const semRegen = content({
      progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    });
    const dano = (hz: number): number => {
      const { hero } = tenMinutesAt(hz, 'beginner', semRegen);
      return hero.maxHealth - hero.health;
    };
    // E não é vácuo: o cenário machuca de verdade nas duas pontas.
    expect(dano(10)).toBeGreaterThan(0);
    for (const hz of RATES) expect(dano(hz)).toBe(dano(10));
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
