import { describe, expect, it } from 'vitest';
import { buildContent, computeVersion, ContentError } from './content.js';
import type { RawContent } from './content.js';

const rat = {
  id: 'rat', name: 'Rat', outfitId: 21, recommendedLevel: 1,
  health: 20, experience: 5, attack: 6, armor: 0,
  attackIntervalMs: 2000, stepDurationMs: 500, aggroRadius: 4,
  loot: [{ itemId: 'gold-coin', chance: 0.9, min: 1, max: 4 }],
};
const cellars = {
  id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1,
  mapId: 'rat-cellars', routeId: 'rat-cellars',
  difficulties: {
    beginner: { perSpawnPoint: 2, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 30_000 },
  },
};
const knight = { id: 'knight', name: 'Knight', healthPerLevel: 20, manaPerLevel: 5, capacityPerLevel: 25 };
const baseline = {
  id: 'baseline',
  startingHealth: 150, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10,
  vocationLevel: 8, stepDurationMs: 500,
};

const combat = {
  id: 'baseline', dodgeMultiplier: 0.5,
  armorEffectiveness: { melee: 1, magic: 0 }, minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 4, dodgeChance: 0.05 },
};

const base = (over: Partial<RawContent> = {}): RawContent => ({
  monsters: [rat], hunts: [cellars], vocations: [knight],
  progression: [baseline], combat: [combat], ...over,
});

describe('buildContent', () => {
  it('monta o conteúdo válido, indexado por id', () => {
    const content = buildContent(base());
    expect(content.monsters.get('rat')?.name).toBe('Rat');
    expect(content.hunts.get('rat-cellars')?.recommendedLevel).toBe(1);
    expect(content.vocations.get('knight')?.healthPerLevel).toBe(20);
  });

  it('aplica os defaults do schema', () => {
    const semLoot = { ...rat, loot: undefined };
    expect(buildContent(base({ monsters: [semLoot] })).monsters.get('rat')?.loot).toEqual([]);
  });
});

describe('conteúdo inválido derruba, em vez de degradar', () => {
  it('recusa campo com valor impossível', () => {
    // Degradar aqui — pular o monstro, usar valor padrão — é como um erro de digitação vira
    // bug de balanceamento que ninguém liga à causa semanas depois.
    expect(() => buildContent(base({ monsters: [{ ...rat, health: -1 }] }))).toThrow(ContentError);
  });

  it('recusa id duplicado', () => {
    expect(() => buildContent(base({ monsters: [rat, rat] }))).toThrow(/duplicado/);
  });

  it('recusa referência cruzada quebrada, que passa em qualquer schema', () => {
    // Uma hunt apontando monstro inexistente é sintaticamente perfeita e só falha quando
    // alguém entra nela — possivelmente em produção, possivelmente desanexado.
    const orfa = {
      ...cellars,
      difficulties: {
        beginner: { perSpawnPoint: 2, composition: [{ monsterId: 'dragon', weight: 1 }], respawnDelayMs: 1000 },
      },
    };
    expect(() => buildContent(base({ hunts: [orfa] }))).toThrow(/monstro inexistente "dragon"/);
  });

  it('junta todos os problemas numa mensagem só', () => {
    // Corrigir um erro por vez, com um boot a cada, é o caminho para ninguém rodar a validação.
    try {
      buildContent(base({ monsters: [{ ...rat, health: -1 }, { ...rat, id: 'x', attack: -5 }] }));
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      expect((erro as ContentError).problems.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('a mensagem diz qual item e qual campo', () => {
    try {
      buildContent(base({ monsters: [{ ...rat, attackIntervalMs: 0 }] }));
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      expect((erro as ContentError).problems[0]).toMatch(/rat.*attackIntervalMs/);
    }
  });
});

describe('versão do conteúdo', () => {
  it('é estável para o mesmo conjunto', () => {
    expect(computeVersion(base())).toBe(computeVersion(base()));
  });

  it('não depende da ordem das chaves no JSON', () => {
    // Nós diferentes precisam calcular a MESMA versão, senão uma sessão migrada acha que o
    // conteúdo mudou debaixo dela (invariante 7).
    const invertido = { ...rat, aggroRadius: 4, name: 'Rat', id: 'rat' };
    expect(computeVersion(base({ monsters: [invertido] }))).toBe(computeVersion(base()));
  });

  it('muda quando qualquer valor muda', () => {
    expect(computeVersion(base({ monsters: [{ ...rat, experience: 6 }] })))
      .not.toBe(computeVersion(base()));
  });
});

describe('valores em aberto', () => {
  it('são reportados, para o boot conseguir avisar', () => {
    // Palpite disfarçado de decisão é o que faz ninguém lembrar de voltar ao §43.1.
    const druida = { ...knight, id: 'druid', name: 'Druid', _open: '§43.1 provisório' };
    expect(buildContent(base({ vocations: [knight, druida] })).openValues)
      .toEqual(['vocation/druid: §43.1 provisório']);
  });
});

describe('progression baseline', () => {
  it('refuses content without it, instead of inventing a default in code', () => {
    // Todo personagem nasce SEM vocação (§7.4), então sem a base não há stats de level 1. Um
    // default em código seria exatamente o "nada em código" que a FUN-34 proíbe: mudar
    // `healthPerLevel` tem que ser editar JSON, nunca alterar lógica.
    expect(() => buildContent({
      monsters: [rat], hunts: [cellars], vocations: [knight], combat: [combat],
    })).toThrow(/progression\/baseline/);
  });

  it('surfaces its provisional values at boot, like any other', () => {
    // Marcar como provisório no JSON e o boot não repetir é a mesma coisa que não marcar.
    const provisional = { ...baseline, _open: '§9.3 — base ainda não decidida' };
    expect(buildContent(base({ progression: [provisional] })).openValues)
      .toContain('progression/baseline: §9.3 — base ainda não decidida');
  });

  it('is indexed on the content, ready for the simulation to read', () => {
    const content = buildContent(base());
    expect(content.progression.startingHealth).toBe(150);
    expect(content.progression.vocationLevel).toBe(8);
  });
});

describe('combat baseline', () => {
  it('refuses content without it: no coefficient means no damage rule', () => {
    // O §12.1 quer fórmula e parâmetro em CONTEÚDO. Um default em código faria essa regra
    // deixar de valer no dia em que ninguém estivesse olhando.
    expect(() => buildContent({
      monsters: [rat], hunts: [cellars], vocations: [knight], progression: [baseline],
    })).toThrow(/combat\/baseline/);
  });

  it('surfaces its provisional values at boot', () => {
    const provisional = { ...combat, _open: '§12.1 — armadura contra magia não decidida' };
    expect(buildContent(base({ combat: [provisional] })).openValues)
      .toContain('combat/baseline: §12.1 — armadura contra magia não decidida');
  });
});

describe('a rota da hunt é apontada, não inferida', () => {
  // Uma rota por mapa hoje, e é justamente por isso que a checagem precisa existir agora:
  // enquanto der para adivinhar, ninguém percebe que estamos adivinhando.
  const map = { id: 'rat-cellars', z: 7, grid: ['####', '#..#', '#..#', '####'] };
  const route = {
    id: 'rat-cellars', mapId: 'rat-cellars',
    tiles: [
      { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 2, y: 2, z: 7 }, { x: 1, y: 2, z: 7 },
    ],
  };
  const withMap = (over: Partial<RawContent> = {}): RawContent =>
    base({ maps: [map], routes: [route], ...over });

  it('resolve a rota apontada', () => {
    expect(buildContent(withMap()).routes.get('rat-cellars')?.tiles).toHaveLength(4);
  });

  it('recusa hunt que aponta rota inexistente', () => {
    // Passa em qualquer schema e só falha quando alguém entra na hunt — e aí o sintoma é
    // "a hunt não abre", a três semanas de distância da causa.
    const semRota = { ...cellars, routeId: 'nowhere' };
    expect(() => buildContent(withMap({ hunts: [semRota] })))
      .toThrow(/rota inexistente "nowhere"/);
  });

  it('recusa rota que é de outro mapa', () => {
    const outroMapa = { ...map, id: 'other' };
    const outraRota = { ...route, id: 'other-route', mapId: 'other' };
    const cruzada = { ...cellars, routeId: 'other-route' };
    expect(() => buildContent(base({
      maps: [map, outroMapa], routes: [route, outraRota], hunts: [cruzada],
    }))).toThrow(/rota "other-route" é do mapa "other"/);
  });
});
