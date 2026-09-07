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
  id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1, mapId: 'rat-cellars',
  difficulties: {
    beginner: { perSpawnPoint: 2, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 30_000 },
  },
};
const knight = { id: 'knight', name: 'Knight', healthPerLevel: 20, manaPerLevel: 5, capacityPerLevel: 25 };

const base = (over: Partial<RawContent> = {}): RawContent =>
  ({ monsters: [rat], hunts: [cellars], vocations: [knight], ...over });

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
