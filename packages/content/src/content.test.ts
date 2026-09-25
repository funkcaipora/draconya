import { describe, expect, it } from 'vitest';
import {
  buildContent, computeVersion, ContentError, placeholderAppearances,
} from './content.js';
import type { RawContent } from './content.js';
import { wallSetOf } from './schemas.js';

const rat = {
  id: 'rat', name: 'Rat', recommendedLevel: 1,
  health: 20, experience: 5, attack: 6, armor: 0,
  attackIntervalMs: 2000, speed: 300, aggroRadius: 4,
  loot: { gold: { chance: 0.9, min: 1, max: 4 }, items: [] },
};
const cellars = {
  id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1,
  mapId: 'rat-cellars', routeId: 'rat-cellars',
  difficulties: {
    cautious: { monsterCount: 2, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 30_000 },
  },
};
const knight = { id: 'knight', name: 'Knight', healthPerLevel: 20, manaPerLevel: 5, capacityPerLevel: 25 };
const baseline = {
  id: 'baseline',
  startingHealth: 150, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10,
  vocationLevel: 8, startingSpeed: 300, speedPerLevel: 0,
  regen: { healthPerSecond: 1, manaPerSecond: 1 },
  xp: { base: 20, exponent: 2 },
  deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
};

const combat = {
  id: 'baseline', compatibilityProfile: 'combat-v1', dodgeMultiplier: 0.5,
  armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 }, minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 4, dodgeChance: 0.05 },
};

const stamina = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };
const party = { id: 'baseline', maxMembers: 8, xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200, '5': 200, '6': 200, '7': 200, '8': 200 } };

// As famílias de arma e as skills que elas escalam (CMB-05). O conteúdo real vive em
// `data/weapon-families/` e `data/skills/`; aqui é o mínimo que faz uma arma montar. A fórmula
// é identidade (`levelFactor`/`spread` zero) e a contribuição por nível vem da skill.
const skills = [
  { id: 'melee', name: 'Melee', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0 },
  { id: 'distance', name: 'Distance', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'distance-hit', points: 1 }, damagePerLevel: 0 },
  { id: 'magic', name: 'Magic', startingLevel: 0, curve: { base: 4, factor: 1 }, gain: { on: 'spell-cast', pointsPerMana: 1 }, damagePerLevel: 0 },
];
const family = (id: string, kind: string, skillId: string, range: number) => ({
  id, name: id, kind, skillId, range, damageType: 'physical', resource: 'none',
  formula: { levelFactor: 0, spread: 0 },
});
const weaponFamilies = [
  family('fist', 'melee', 'melee', 1),
  family('sword', 'melee', 'melee', 1),
  family('axe', 'melee', 'melee', 1),
  family('club', 'melee', 'melee', 1),
  family('distance', 'distance', 'distance', 6),
  { id: 'wand', name: 'Wand', kind: 'wand', skillId: 'magic', range: 3, damageType: 'arcane', resource: 'mana' },
  { id: 'rod', name: 'Rod', kind: 'wand', skillId: 'magic', range: 3, damageType: 'arcane', resource: 'mana' },
];

// A aparência é DERIVADA aqui (FUN-94): estes testes falam de loot, rota e referência cruzada,
// e escrever a tabela à mão em cada um faria trinta fixtures carregarem um dado que nenhuma
// delas usa. Quem exercita a tabela em si passa uma explícita — ver o bloco da FUN-94.
const base = (over: Partial<RawContent> = {}): RawContent => {
  const raw: RawContent = {
    monsters: [rat], hunts: [cellars], vocations: [knight],
    progression: [baseline], combat: [combat], stamina: [stamina], party: [party],
    skills, weaponFamilies,
    // O bot é o produto (invariante 11): sem `bot/baseline.json` o conteúdo não monta.
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    ...over,
  };
  return { appearances: [placeholderAppearances(raw)], ...raw };
};

describe('buildContent', () => {
  it('monta o conteúdo válido, indexado por id', () => {
    const content = buildContent(base());
    expect(content.monsters.get('rat')?.name).toBe('Rat');
    expect(content.hunts.get('rat-cellars')?.recommendedLevel).toBe(1);
    expect(content.vocations.get('knight')?.healthPerLevel).toBe(20);
  });

  it('aplica os defaults do schema', () => {
    const semLoot = { ...rat, loot: undefined };
    expect(buildContent(base({ monsters: [semLoot] })).monsters.get('rat')?.loot)
      .toEqual({ items: [] });
  });
});

describe('classe do monstro (SV-20, #356)', () => {
  it('monstro com class: mammal é aceito e propagado para content.monsters', () => {
    const comClasse = { ...rat, class: 'mammal' as const };
    const content = buildContent(base({ monsters: [comClasse] }));
    expect(content.monsters.get('rat')?.class).toBe('mammal');
  });

  it('monstro com classe fora do vocabulário fechado é rejeitado', () => {
    const classeInvalida = { ...rat, class: 'reptile' };
    expect(() => buildContent(base({ monsters: [classeInvalida] }))).toThrow(ContentError);
  });
});

describe('texto de apresentação da hunt (SV-21, #357)', () => {
  it('aceita descrição válida e propaga para content.hunts', () => {
    const comDescricao = {
      ...cellars,
      description: 'Os porões de pedra sob Rookgaard, a ilha que recebe todo aventureiro no primeiro dia.',
    };
    const content = buildContent(base({ hunts: [comDescricao] }));
    expect(content.hunts.get('rat-cellars')?.description).toBe(
      'Os porões de pedra sob Rookgaard, a ilha que recebe todo aventureiro no primeiro dia.',
    );
  });

  it('aceita quando omitido e deixa description como undefined', () => {
    const semDescricao = { ...cellars, description: undefined };
    const content = buildContent(base({ hunts: [semDescricao] }));
    expect(content.hunts.get('rat-cellars')?.description).toBeUndefined();
  });

  it('rejeita string vazia como descrição', () => {
    const descricaoVazia = { ...cellars, description: '' };
    expect(() => buildContent(base({ hunts: [descricaoVazia] }))).toThrow(ContentError);
  });
});

describe('a tabela de loot (FUN-63)', () => {
  it('separa moeda de item: gold tem lugar próprio, e items é a lista', () => {
    const loot = buildContent(base()).monsters.get('rat')?.loot;
    expect(loot?.gold).toEqual({ chance: 0.9, min: 1, max: 4 });
    expect(loot?.items).toEqual([]);
  });

  it('recusa item que não está no catálogo', () => {
    // Aceitar creditaria um item fantasma no primeiro abate. Falhar no boot é o que impede
    // o atalho de "só mais um itemId" antes de existir o que ele aponta.
    //
    // Antes da FUN-76 a recusa era categórica — não havia catálogo nenhum. Agora ela é sobre a
    // REFERÊNCIA, e o teste continua valendo pelo mesmo motivo.
    const withItem = {
      ...rat, loot: { items: [{ itemId: 'spike-sword', chance: 0.1, min: 1, max: 1 }] },
    };
    expect(() => buildContent(base({ monsters: [withItem] }))).toThrow(/não existe no catálogo/);
  });

  it('recusa a forma antiga, com a moeda escondida como item', () => {
    const legacy = { ...rat, loot: [{ itemId: 'gold-coin', chance: 0.9, min: 1, max: 4 }] };
    expect(() => buildContent(base({ monsters: [legacy] }))).toThrow(ContentError);
  });

  it('recusa min acima de max', () => {
    const inverted = { ...rat, loot: { gold: { chance: 1, min: 5, max: 2 }, items: [] } };
    expect(() => buildContent(base({ monsters: [inverted] }))).toThrow(ContentError);
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
        cautious: { monsterCount: 2, composition: [{ monsterId: 'dragon', weight: 1 }], respawnDelayMs: 1000 },
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
      stamina: [stamina], party: [party],
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
      stamina: [stamina], party: [party],
    })).toThrow(/combat\/baseline/);
  });

  it('surfaces its provisional values at boot', () => {
    const provisional = { ...combat, _open: '§12.1 — armadura contra magia não decidida' };
    expect(buildContent(base({ combat: [provisional] })).openValues)
      .toContain('combat/baseline: §12.1 — armadura contra magia não decidida');
  });
});

describe('a taxonomia de dano e a mitigação (CMB-03)', () => {
  const withMitigation = (mitigation: unknown) => base({ monsters: [{ ...rat, mitigation }] });

  it('recusa tipo de dano DESCONHECIDO na resistência e na imunidade', () => {
    // A lista canônica é a fonte única (ADR 0031, emenda). Um tipo que não existe não pode
    // virar uma coluna silenciosa que ninguém resolve.
    expect(() => buildContent(withMitigation({ resistances: { sonic: 0.5 } })))
      .toThrow(ContentError);
    expect(() => buildContent(withMitigation({ immunities: ['sonic'] })))
      .toThrow(ContentError);
  });

  it('recusa resistência fora do intervalo [-1, 1): 1 é ambiguidade com imunidade', () => {
    // Positivo reduz, negativo amplifica; `1` seria imunidade disfarçada (DT-02), e o schema
    // recusa para a imunidade continuar explícita.
    expect(() => buildContent(withMitigation({ resistances: { fire: 1 } }))).toThrow(ContentError);
    expect(() => buildContent(withMitigation({ resistances: { fire: -1.5 } }))).toThrow(ContentError);
    expect(() => buildContent(withMitigation({ resistances: { fire: 1.5 } }))).toThrow(ContentError);
  });

  it('recusa imunidade duplicada', () => {
    expect(() => buildContent(withMitigation({ immunities: ['fire', 'fire'] })))
      .toThrow(/imunidade duplicada/);
  });

  it('recusa resistência e imunidade para o mesmo tipo — a ambiguidade da DT-02', () => {
    expect(() => buildContent(withMitigation({ resistances: { fire: 0.5 }, immunities: ['fire'] })))
      .toThrow(/ao mesmo tempo/);
  });

  it('compila a mitigação no boot: tabela completa por tipo e Set de imunidade', () => {
    const content = buildContent(withMitigation({ resistances: { fire: 0.5 }, immunities: ['ice'] }));
    const mitigation = content.monsters.get('rat')?.mitigation;
    expect(mitigation?.resistances.fire).toBe(0.5);
    expect(mitigation?.resistances.physical).toBe(0);
    expect(mitigation?.resistances.arcane).toBe(0);
    expect(mitigation?.immunities.has('ice')).toBe(true);
    expect(mitigation?.immunities.has('fire')).toBe(false);
  });

  it('a tabela de armadura exige os OITO tipos — um só não basta', () => {
    // `z.record` de chave enum é exaustivo no zod 4: o conteúdo declara tudo, sem default em
    // código. É o que impede a efetividade de um elemento novo nascer zero por esquecimento.
    expect(() => buildContent(base({ combat: [{ ...combat, armorEffectiveness: { physical: 1 } }] })))
      .toThrow(/armorEffectiveness/);
  });

  it('um spell declara damageType ou recebe `arcane`, o default que preserva o v1', () => {
    const semTipo = {
      id: 'strike', name: 'Golpe', manaCost: 15, cooldownMs: 2_000,
      effect: { kind: 'damage', power: 40, range: 3 },
    };
    const content = buildContent(base({ spells: [semTipo] }));
    expect(content.spells.get('strike')?.effect).toMatchObject({ damageType: 'arcane' });
  });

  it('recusa um spell com tipo de dano fora da taxonomia', () => {
    const comTipoErrado = {
      id: 'strike', name: 'Golpe', manaCost: 15, cooldownMs: 2_000,
      effect: { kind: 'damage', power: 40, range: 3, damageType: 'sonic' },
    };
    expect(() => buildContent(base({ spells: [comTipoErrado] }))).toThrow(ContentError);
  });
});

describe('a defesa dos itens e do perfil (CMB-04)', () => {
  const sword = {
    id: 'sword', name: 'Sword', kind: 'weapon', slot: 'hand', weight: 30, value: 0,
    attack: 10, defense: 5,
  };
  const shield = {
    id: 'shield', name: 'Shield', kind: 'shield', slot: 'shield', weight: 40, value: 0, defense: 12,
  };
  const helmet = {
    id: 'helmet', name: 'Helmet', kind: 'armor', slot: 'head', weight: 10, value: 0, defense: 5,
  };
  const arrow = { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 0 };
  const bow = {
    id: 'bow', name: 'Bow', kind: 'weapon', slot: 'hand', weight: 30, value: 0,
    twoHanded: true, defense: 5, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' },
  };
  const wand = {
    id: 'wand', name: 'Wand', kind: 'weapon', slot: 'hand', weight: 10, value: 0, defense: 5,
    weapon: { kind: 'wand', range: 3, manaPerHit: 1, damage: { min: 1, max: 2 } },
  };
  const shielding = {
    id: 'shielding', name: 'Escudo', startingLevel: 10,
    curve: { base: 2, factor: 1 }, gain: { on: 'shield-block', points: 1 },
  };

  it('aceita defense no escudo e na arma corpo a corpo de uma mão', () => {
    const content = buildContent(base({ items: [sword, shield] }));
    expect(content.items.get('sword')?.defense).toBe(5);
    expect(content.items.get('shield')?.defense).toBe(12);
  });

  it('recusa defense em armadura, arma de duas mãos e wand', () => {
    // Bow/twoHanded não deixa defesa residual, e wand/rod não bloqueia: os dois são conteúdo
    // quebrado, e o boot é o lugar de descobrir.
    expect(() => buildContent(base({ items: [helmet] }))).toThrow(/defense só vale/);
    expect(() => buildContent(base({ items: [bow, arrow] })))
      .toThrow(/defense só vale/);
    expect(() => buildContent(base({ items: [wand] }))).toThrow(/defense só vale/);
  });

  it('defense 0 — o default — é aceito em qualquer item: é a ausência', () => {
    const plainHelmet = { id: 'helmet', name: 'Helmet', kind: 'armor', slot: 'head', weight: 10, value: 0 };
    expect(buildContent(base({ items: [plainHelmet] })).items.get('helmet')?.defense).toBe(0);
  });

  it('recusa blockTypes vazio e com tipo duplicado', () => {
    expect(() => buildContent(base({
      combat: [{ ...combat, defense: { blockChance: 0.5, blockTypes: [] } }],
    }))).toThrow(/blockTypes/);
    expect(() => buildContent(base({
      combat: [{ ...combat, defense: { blockChance: 0.5, blockTypes: ['physical', 'physical'] } }],
    }))).toThrow(/duplicado/);
  });

  it('recusa defense.skillId que não existe no catálogo', () => {
    expect(() => buildContent(base({
      combat: [{ ...combat, defense: { skillId: 'shielding', blockChance: 0.5 } }],
    }))).toThrow(/defense\.skillId "shielding" não existe/);
  });

  it('recusa defense.skillId que não sobe por bloqueio', () => {
    const melee = {
      id: 'melee', name: 'Corpo a Corpo', startingLevel: 10,
      curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 },
    };
    expect(() => buildContent(base({
      vocations: [], skills: [melee],
      combat: [{ ...combat, defense: { skillId: 'melee', blockChance: 0.5 } }],
    }))).toThrow(/não sobe por bloqueio/);
  });

  it('aceita a skill de shielding, e blockTypes vazio vira `physical`', () => {
    const content = buildContent(base({
      vocations: [], skills: [...skills, shielding],
      combat: [{ ...combat, defense: { skillId: 'shielding', blockChance: 0.5 } }],
    }));
    expect(content.combat.defense?.skillId).toBe('shielding');
    expect(content.combat.defense?.blockTypes).toEqual(['physical']);
    // Ausente é o estágio identidade — o conteúdo legado não declara defesa e continua montando.
    expect(buildContent(base()).combat.defense).toBeUndefined();
  });
});

describe('abilities de monstro (CMB-06)', () => {
  const spit = {
    id: 'spit', cadenceMs: 1_000, target: { range: 3 }, power: 7,
    damageType: 'energy', presentation: { missileKey: 'spit', impactKey: 'spit-hit' },
  };

  it('ausência normaliza para UMA ability básica com a faixa, a cadência e o tipo de sempre', () => {
    // DT-02: a normalização é do BOOT, não de cada golpe. É o que preserva o rato bit a bit —
    // mesmo sorteio, mesma ordem de evento — sem um ramo no caminho quente.
    const content = buildContent(base());
    const abilities = content.monsters.get('rat')?.abilities;
    expect(abilities).toHaveLength(1);
    expect(abilities?.[0]).toEqual({
      id: 'basic', cadenceMs: rat.attackIntervalMs, target: { range: 1 },
      power: { min: 6, max: 6 }, damageType: 'physical',
    });
  });

  it('a faixa do `attack` vira `{ min, max }` na básica, preservando o sorteio', () => {
    const content = buildContent(base({ monsters: [{ ...rat, attack: { min: 2, max: 9 } }] }));
    expect(content.monsters.get('rat')?.abilities[0]?.power).toEqual({ min: 2, max: 9 });
  });

  it('abilities declaradas SUBSTITUEM a básica, com o poder já em faixa', () => {
    const content = buildContent(base({ monsters: [{ ...rat, abilities: [spit] }] }));
    expect(content.monsters.get('rat')?.abilities).toEqual([{
      id: 'spit', cadenceMs: 1_000, target: { range: 3 }, power: { min: 7, max: 7 },
      damageType: 'energy', presentation: { missileKey: 'spit', impactKey: 'spit-hit' },
    }]);
  });

  it('aceita área `circle` centrada no alvo e no lançador', () => {
    const area = { shape: 'circle', radius: 1, centered: 'caster' } as const;
    const burst = { id: 'burst', cadenceMs: 2_000, target: { range: 2, area }, power: { min: 1, max: 2 } };
    const content = buildContent(base({ monsters: [{ ...rat, abilities: [burst] }] }));
    expect(content.monsters.get('rat')?.abilities[0]?.target.area).toEqual(area);
  });

  it('recusa o id `basic`, reservado à ability que o boot sintetiza', () => {
    expect(() => buildContent(base({
      monsters: [{ ...rat, abilities: [{ id: 'basic', cadenceMs: 1_000, power: 1 }] }],
    }))).toThrow(/reservado ao boot/);
  });

  it('recusa ability duplicada: a escolha por id ficaria ambígua', () => {
    expect(() => buildContent(base({
      monsters: [{ ...rat, abilities: [{ id: 'spit', cadenceMs: 1_000, power: 1 }, { id: 'spit', cadenceMs: 2_000, power: 2 }] }],
    }))).toThrow(/duplicada/);
  });

  it('recusa forma de área que o monstro não lança — `wave` sai da direção do lançador', () => {
    const wave = { id: 'wave', cadenceMs: 1_000, power: 1, target: { range: 3, area: { shape: 'wave', length: 2 } } };
    expect(() => buildContent(base({ monsters: [{ ...rat, abilities: [wave] }] })))
      .toThrow(/só lança `circle`/);
  });

  it('ability sem linha na tabela de aparências é MUDA, nunca erro', () => {
    // O mecanismo acontece; só a arte não sai. Recusar aqui obrigaria toda ability a nascer
    // com arte antes de nascer com número, que é a ordem errada.
    expect(() => buildContent(base({ monsters: [{ ...rat, abilities: [spit] }] }))).not.toThrow();
  });

  it('a tabela de aparências ganha a seção `abilities`, e a expõe por chave semântica', () => {
    const content = buildContent(base({
      monsters: [{ ...rat, abilities: [spit] }],
      appearances: [{
        id: 'baseline', pack: 'tibia-1332', monsters: { rat: 21 }, items: {},
        abilities: { spit: { missile: 5 }, 'spit-hit': { effect: 13 } },
      }],
    }));
    expect(content.appearances?.abilities['spit']).toEqual({ missile: 5 });
    expect(content.appearances?.abilities['spit-hit']).toEqual({ effect: 13 });
  });

  it('uma chave de aparência sem uso é vocabulário à espera, e é válida', () => {
    // Ao contrário de `spells`/`supplies`, as chaves são COMPARTILHADAS — duas abilities podem
    // apontar a mesma. Uma linha sem uso não é a linha órfã que a tabela introduz.
    expect(() => buildContent(base({
      appearances: [{
        id: 'baseline', pack: 'tibia-1332', monsters: { rat: 21 }, items: {},
        abilities: { 'nunca-usada': { missile: 5 } },
      }],
    }))).not.toThrow();
  });
});

describe('o perfil de compatibilidade de combate (ADR 0031, CMB-02)', () => {  it('conteúdo legado/fixture SEM o campo recebe o default compatível `combat-v1`', () => {
    // O default existe para o conteúdo anterior ao perfil continuar montando. O perfil é
    // ADITIVO: nada do resultado entregue muda por ele estar implícito.
    const { compatibilityProfile: _omitido, ...legacy } = combat;
    expect(buildContent(base({ combat: [legacy] })).combat.compatibilityProfile).toBe('combat-v1');
  });

  it('perfil DESCONHECIDO derruba o boot, sem fallback silencioso', () => {
    // Um perfil que o motor não conhece não pode ser reinterpretado: aceitá-lo faria a sessão
    // rodar com uma fórmula que ninguém implementou, com cara de legítima (ADR 0031).
    expect(() => buildContent(base({ combat: [{ ...combat, compatibilityProfile: 'combat-v99' }] })))
      .toThrow(/perfil de compatibilidade "combat-v99" desconhecido/);
  });

  it('o perfil explícito entra na versão do conteúdo: trocá-lo muda a identidade da sessão', () => {
    // O perfil é conteúdo versionado (invariante 7). Só há um perfil válido hoje, então o que
    // se prende é que o campo EXPLÍCITO é hasheado: `computeVersion` lê o cru, não o parseado.
    const { compatibilityProfile: _omitido, ...withoutProfile } = combat;
    const withProfile = { ...withoutProfile, compatibilityProfile: 'combat-v1' };
    expect(computeVersion(base({ combat: [withProfile] })))
      .not.toBe(computeVersion(base({ combat: [withoutProfile] })));
  });

  it('modifiers ausente é o default NEUTRO — o conteúdo existente segue v1', () => {
    // É a ausência que preserva o resultado e a sequência de RNG: nenhum sorteio novo.
    expect(buildContent(base()).combat.modifiers).toBeUndefined();
  });

  it('modifiers declarado parseia, e a chance fora de [0,1] derruba o boot', () => {
    const comMods = {
      ...combat,
      modifiers: { critical: { chance: 0.25, multiplier: 2 }, lifeLeech: 0.1, manaLeech: 0.05 },
    };
    expect(buildContent(base({ combat: [comMods] })).combat.modifiers).toEqual({
      critical: { chance: 0.25, multiplier: 2 }, lifeLeech: 0.1, manaLeech: 0.05,
    });
    const chanceInvalida = {
      ...combat,
      modifiers: { critical: { chance: 1.5, multiplier: 2 } },
    };
    expect(() => buildContent(base({ combat: [chanceInvalida] }))).toThrow(/combat/);
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


describe('o raio livre do spawn (#236)', () => {
  it('ausente é zero: o conteúdo de teste continua nascendo em cima de quem está lá', () => {
    expect(buildContent(base()).hunts.get('rat-cellars')?.spawnClearRadius).toBe(0);
  });

  it('recusa raio negativo', () => {
    expect(() => buildContent(base({ hunts: [{ ...cellars, spawnClearRadius: -1 }] })))
      .toThrow(/spawnClearRadius/);
  });
});

describe('a tabela da party (#188, ADR 0027)', () => {
  it('refuses content without it: solo is a party of one, and the pool lives in content', () => {
    expect(() => buildContent({ ...base(), party: [] })).toThrow(/party\/baseline/);
  });

  it('is indexed on the content, with the pool by unique vocations', () => {
    const content = buildContent(base());
    expect(content.party.maxMembers).toBe(8);
    expect(content.party.xpPoolPercentByUniqueVocations['8']).toBe(200);
    expect(content.party.matchmakingLevelRange).toBe(0);
  });

  it('carrega o limite de venda automática, com default seguro para fixtures antigas (§8)', () => {
    // Mutação que mata: tirar o `.default()` de `autoSellItemTypes` — as quatro fixtures de
    // `RawContent` que não conhecem VIP (content.test, server/testing, tools/bench) parariam de
    // validar.
    expect(buildContent(base()).party.autoSellItemTypes).toEqual({ free: 5, premium: 20 });
    expect(buildContent(base({
      party: [{ ...party, autoSellItemTypes: { free: 1, premium: 3 } }],
    })).party.autoSellItemTypes).toEqual({ free: 1, premium: 3 });
  });

  it('refuses a missing key, a decreasing percent, and maxMembers below two', () => {
    // Mutação que mata: tirar o `superRefine` — a tabela `{ '1': 150, '2': 125 }` entraria, e o
    // sim daria menos XP a uma party mais variada.
    const table = (over: Record<string, unknown>) => () => buildContent({
      ...base(),
      party: [{ id: 'baseline', maxMembers: 4, xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200 }, ...over }],
    });
    expect(table({ xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175 } })).toThrow(/sem a chave "4"/);
    expect(table({ xpPoolPercentByUniqueVocations: { '1': 150, '2': 125, '3': 175, '4': 200 } })).toThrow(/menor que a anterior/);
    expect(table({ maxMembers: 1 })).toThrow(ContentError);
    // Chave a mais é inofensiva.
    expect(table({ xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200, '5': 200 } })).not.toThrow();
  });
});

describe('cura e mana com alvo (§26, ADR 0035 d.10)', () => {
  const spell = (effect: Record<string, unknown>) =>
    ({ id: 'heal', name: 'Cura', manaCost: 20, cooldownMs: 1000, effect });
  const supply = (effect: Record<string, unknown>) =>
    ({ id: 'potion', name: 'Poção', price: 10, group: 'potion', effect });

  it('aceita magia self sem range e magia friend com range', () => {
    expect(() => buildContent(base({ spells: [spell({ kind: 'heal', amount: 60 })] }))).not.toThrow();
    expect(() => buildContent(base({
      spells: [spell({ kind: 'heal', amount: 60, target: 'friend', range: 4 })],
    }))).not.toThrow();
  });

  it('recusa magia friend sem range e self com range', () => {
    // Mutação que mata: trocar `effect.target === 'friend'` por `!== 'self'` — equivalente
    // hoje, mas quebra se um terceiro valor de `target` aparecer.
    expect(() => buildContent(base({ spells: [spell({ kind: 'heal', amount: 60, target: 'friend' })] })))
      .toThrow(/cura em outro personagem precisa de range/);
    expect(() => buildContent(base({ spells: [spell({ kind: 'heal', amount: 60, target: 'self', range: 4 })] })))
      .toThrow(/cura em si mesmo não tem alcance/);
  });

  it('aplica a mesma regra ao supply de cura e de mana', () => {
    expect(() => buildContent(base({ supplies: [supply({ kind: 'heal', amount: 80, target: 'friend' })] })))
      .toThrow(/supply\/potion: efeito em outro personagem precisa de range/);
    expect(() => buildContent(base({ supplies: [supply({ kind: 'mana', amount: 100, target: 'self', range: 1 })] })))
      .toThrow(/supply\/potion: efeito em si mesmo não tem alcance/);
    expect(() => buildContent(base({
      supplies: [supply({ kind: 'mana', amount: 100, target: 'friend', range: 1 })],
    }))).not.toThrow();
  });
});

describe('o preço de venda do item (#188, ADR 0027 decisão 6)', () => {
  it('is mandatory, without a default: an item without a price is a content decision', () => {
    // Mutação que mata: `value: z.number().int().nonnegative().default(0)`.
    const sword = { id: 'sword', name: 'Sword', kind: 'weapon', slot: 'hand', weight: 30, weapon: { kind: 'melee', range: 1 } };
    const withSword = (item: Record<string, unknown>) => {
      const { appearances: _table, ...raw } = base();
      const items = [...(raw.items ?? []), item];
      return { ...raw, items, appearances: [placeholderAppearances({ ...raw, items })] };
    };
    expect(() => buildContent(withSword(sword))).toThrow(/item "sword": value/);
    expect(buildContent(withSword({ ...sword, value: 25 })).items.get('sword')?.value).toBe(25);
  });
});

describe('stamina baseline', () => {
  it('refuses content without it: it is the simulation ceiling, not a detail', () => {
    // A stamina é o principal freio de custo do projeto — o teto de simulação é
    // `2 × contas ativas` (ADR 0001). Um default em código faria o número que sustenta a
    // projeção de custo morar onde ninguém procura por ele.
    expect(() => buildContent({
      monsters: [rat], hunts: [cellars], vocations: [knight],
      progression: [baseline], combat: [combat],
    })).toThrow(/stamina\/baseline/);
  });

  it('is indexed on the content, ready for the simulation to read', () => {
    expect(buildContent(base()).stamina.maxMs).toBe(86_400_000);
  });
});

describe('o bot com que o personagem nasce (FUN-114)', () => {
  const spell = { id: 'heal', name: 'Cura', manaCost: 20, cooldownMs: 1000, effect: { kind: 'heal', amount: 60 } };
  const config = (over: Record<string, unknown> = {}) => ({
    version: 1, rune: [], support: [], exit: [],
    heal: [{ when: { kind: 'hp', op: '<=', percent: 70 }, do: { kind: 'spell', spellId: 'heal' } }],
    potion: [], attack: [],
    targeting: { policy: 'nearest', prioritize: [], ignore: [], posture: { kind: 'stand' } },
    ...over,
  });
  const emptySets = () => Array.from({ length: 4 }, () => ({
    slots: Array.from({ length: 24 }, () => null),
  }));
  const withDefault = (over: Record<string, unknown> = {}) => base({
    spells: [spell],
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
      defaultConfig: config(over) }],
  });
  const withVocationBaseline = (spellId: string) => base({
    spells: [spell],
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
      defaultConfigByVocation: {
        knight: {
          version: 2, activeSet: 0, automations: [], stance: 'balanced',
          targeting: { policy: 'nearest', prioritize: [], ignore: [], posture: { kind: 'stand' } },
          exit: [],
          sets: emptySets().map((set, index) => (index === 0
            ? { slots: set.slots.map((_, slot) => (slot === 0
              ? { do: { kind: 'spell', spellId }, when: [] }
              : null)) }
            : set)),
        },
      } }],
  });

  it('é OPCIONAL, e quando existe sai montada em `content.bot.defaultConfig`', () => {
    expect(buildContent(base()).bot.defaultConfig).toBeUndefined();
    const content = buildContent(withDefault());
    expect(content.bot.defaultConfig?.heal).toHaveLength(1);
  });

  it('passa pelo MESMO juiz que a configuração do jogador: magia inexistente reprova o boot', () => {
    // Mutação que mata: apagar a validação — o defeito viraria "o bot não cura" no primeiro
    // personagem criado, sem explicação.
    expect(() => buildContent(withDefault({
      heal: [{ when: { kind: 'hp', op: '<=', percent: 70 }, do: { kind: 'spell', spellId: 'cura-que-nao-existe' } }],
    }))).toThrow(/defaultConfig: categoria "heal", slot 1: magia "cura-que-nao-existe" não existe/);
  });

  it('as baselines v2 por vocação passam pelo juiz v2, nomeando conjunto e slot', () => {
    // Mutação que mata: não validar `defaultConfigByVocation` — o kit de nascimento da vocação
    // apontaria magia inexistente e o defeito só apareceria no primeiro personagem criado.
    expect(buildContent(withVocationBaseline('heal')).bot.defaultConfigByVocation?.knight)
      .toBeDefined();
    expect(() => buildContent(withVocationBaseline('cura-que-nao-existe')))
      .toThrow(/defaultConfigByVocation\.knight: conjunto 1, slot 1: magia "cura-que-nao-existe" não existe/);
  });
});

describe('o Bestiário (FUN-113, §18)', () => {
  const bestiary = { id: 'baseline', milestones: [10_000, 25_000, 50_000, 100_000, 200_000], xpBonusPercentPerMilestone: 1 };

  it('é OPCIONAL: a fixture de combate não fala de progressão permanente', () => {
    expect(buildContent(base()).bestiary).toBeUndefined();
  });

  it('monta os marcos e o bônus, para o sim ler', () => {
    const content = buildContent(base({ bestiary: [bestiary] }));
    expect(content.bestiary?.milestones).toEqual([10_000, 25_000, 50_000, 100_000, 200_000]);
    expect(content.bestiary?.xpBonusPercentPerMilestone).toBe(1);
  });

  it('recusa marcos fora de ordem: "próximo marco" apontaria para trás', () => {
    expect(() => buildContent(base({ bestiary: [{ ...bestiary, milestones: [10_000, 5_000] }] })))
      .toThrow(/marcos fora de ordem em 1: 10000 antes de 5000/);
    expect(() => buildContent(base({ bestiary: [{ ...bestiary, milestones: [10_000, 10_000] }] })))
      .toThrow(/fora de ordem/);
  });

  it('recusa a lista vazia, o bônus negativo e o bônus FRACIONÁRIO', () => {
    // Meio ponto passaria no schema e quebraria a conta em inteiro de `Bestiary.applyXpBonus`:
    // a garantia do `floor` depende de `p × marcos` ser inteiro.
    expect(() => buildContent(base({ bestiary: [{ ...bestiary, milestones: [] }] }))).toThrow(/bestiary/);
    expect(() => buildContent(base({ bestiary: [{ ...bestiary, xpBonusPercentPerMilestone: -1 }] }))).toThrow(/bestiary/);
    expect(() => buildContent(base({ bestiary: [{ ...bestiary, xpBonusPercentPerMilestone: 0.5 }] }))).toThrow(/bestiary/);
  });
});

describe('ponto de entrada da Cidade (FUN-60)', () => {
  const sala = { id: 'city', z: 7, grid: ['####', '#..#', '#..#', '####'] };

  it('mapa importado (com `source`) dispensa a linha em appearances.maps — a pilha mora em things/ (FUN-118)', () => {
    const imported = {
      id: 'thais', z: 7, floors: { '7': { grid: ['###', '#.#', '###'] } },
      source: { file: 'otservbr.otbm', sha256: 'a'.repeat(64), region: { x: [0, 2] as [number, number], y: [0, 2] as [number, number], z: [7, 7] as [number, number] } },
    };
    const withEntry = { ...sala, entryPoint: { x: 1, y: 1 } };
    const content = buildContent(base({ hunts: [], maps: [withEntry, imported], city: { mapId: 'city', stepDurationMs: 500 } }));
    expect(content.maps.get('thais')?.source?.file).toBe('otservbr.otbm');
  });

  it('aceita um entryPoint em chão livre e o expõe como a Cidade', () => {
    // Sem hunt: a de base aponta o mapa `rat-cellars`, e com um mapa presente a referência
    // cruzada passa a ser checada — o que aqui seria ruído.
    const content = buildContent(base({
      hunts: [], maps: [{ ...sala, entryPoint: { x: 1, y: 1 } }], city: { mapId: 'city', stepDurationMs: 500 },
    }));
    // Com o andar: um mapa de grade única põe o `entryPoint` no seu `z` (FUN-119).
    expect(content.city?.entryPoint).toEqual({ x: 1, y: 1, z: 7 });
  });

  it('recusa entryPoint em parede — quebra no boot, e não no jogador', () => {
    // `(0,0)` é a borda de qualquer tilemap. Era exatamente onde todo personagem nascia, e
    // ninguém notava porque nada consultava posição na Cidade.
    expect(() => buildContent(base({
      hunts: [], maps: [{ ...sala, entryPoint: { x: 0, y: 0 } }], city: { mapId: 'city', stepDurationMs: 500 },
    }))).toThrow(/entryPoint \(0,0,7\)/);
  });

  it('recusa Cidade sem entryPoint e Cidade apontando mapa inexistente', () => {
    expect(() => buildContent(base({ hunts: [], maps: [sala], city: { mapId: 'city', stepDurationMs: 500 } })))
      .toThrow(/não tem entryPoint/);
    expect(() => buildContent(base({ hunts: [], maps: [sala], city: { mapId: 'nowhere', stepDurationMs: 500 } })))
      .toThrow(/mapa inexistente "nowhere"/);
  });
});

describe('a tabela de aparências (FUN-94)', () => {
  const tabela = (over: Record<string, unknown> = {}) => [{
    id: 'baseline', pack: 'tibia-1332', monsters: { rat: 21 }, items: {}, ...over,
  }];

  it('resolve a aparência da entidade a partir da tabela, e não do arquivo dela', () => {
    // O ponto inteiro da issue: `rat.json` não tem outfitId nenhum, e o monstro montado tem.
    const content = buildContent(base({ appearances: tabela() }));
    expect(content.monsters.get('rat')?.outfitId).toBe(21);
  });

  it('recusa a entidade que a tabela não cobre, e diz qual linha falta', () => {
    // Sem isto, o monstro chegaria à sessão sem aparência e o cliente desenharia o quê?
    expect(() => buildContent(base({ appearances: tabela({ monsters: {} }) })))
      .toThrow(/monstro "rat" não tem aparência: falta a linha "rat" em appearances\.monsters/);
  });

  it('recusa a aparência ÓRFÃ — a linha que sobrou de uma entidade apagada', () => {
    // É o defeito que a tabela introduz, e o motivo de a checagem cruzada existir dos dois
    // lados: com o id inline, apagar o monstro levava o id junto; com a tabela, a linha fica.
    expect(() => buildContent(base({ appearances: tabela({ monsters: { rat: 21, dragon: 39 } }) })))
      .toThrow(/appearances\.monsters mapeia monstro "dragon", que não existe no conteúdo/);
  });

  it('recusa a tabela ausente quando há o que mapear', () => {
    const { appearances: _ignorada, ...semTabela } = base();
    expect(() => buildContent(semTabela)).toThrow(/appearances\/baseline\.json ausente/);
  });

  it('DISPENSA a tabela quando não há monstro nem item', () => {
    // Conteúdo que só fala de mapa não tem arte para mapear, e exigir dele um arquivo vazio
    // seria burocracia sem nada do outro lado.
    const { appearances: _ignorada, ...semTabela } = base({ monsters: [], hunts: [] });
    expect(() => buildContent(semTabela)).not.toThrow();
  });

  it('a aparência é um ID, nunca um caminho — o invariante 6, agora na tabela', () => {
    expect(() => buildContent(base({
      appearances: tabela({ monsters: { rat: 'sprites/rat.png' } }),
    }))).toThrow(ContentError);
  });

  it('uma tabela sem `pack` é recusada: número sem origem não se remapeia', () => {
    const [semPack] = tabela();
    delete (semPack as Record<string, unknown>)['pack'];
    expect(() => buildContent(base({ appearances: [semPack] }))).toThrow(ContentError);
  });

  it('trocar de pacote MUDA a versão do conteúdo', () => {
    // Invariante 7: a versão é fixada na sessão. Uma hunt que começou com o pacote antigo
    // termina com ele — o remapeamento não pode trocar a arte no meio de milhares de sessões
    // desanexadas. Isso só vale se a tabela entrar no hash, e é o que este teste prende.
    expect(computeVersion(base({ appearances: tabela() })))
      .not.toBe(computeVersion(base({ appearances: tabela({ monsters: { rat: 22 } }) })));
  });

  it('o remapeamento inteiro cabe num arquivo — é a razão de a tabela existir', () => {
    // O critério do ADR 0008: *"trocar o pacote de assets no futuro é remapear numa tabela,
    // não reescrever content/"*. O teste dele é este: os MESMOS monstros e itens, aparências
    // completamente diferentes, e nenhum arquivo de entidade tocado.
    const espadaLocal = {
      id: 'spike-sword', name: 'Spike Sword', kind: 'weapon', slot: 'hand',
      weight: 50, value: 0, attack: 24,
    };
    const outroPacote = buildContent(base({
      items: [espadaLocal],
      appearances: [{
        id: 'baseline', pack: 'outro', monsters: { rat: 900 }, items: { 'spike-sword': 901 },
      }],
    }));
    expect(outroPacote.monsters.get('rat')?.outfitId).toBe(900);
    expect(outroPacote.items.get('spike-sword')?.appearanceId).toBe(901);
    expect(outroPacote.monsters.get('rat')?.health).toBe(20);
  });
});

describe('a tabela contra o inventário do pacote (FUN-21)', () => {
  const inventory = {
    id: 'tibia-1332', version: '1332', appearancesSha256: 'b'.repeat(64),
    object: [[100, 167], [169, 370]], outfit: [[1, 134]], effect: [[1, 80]], missile: [[1, 42]],
  };
  const tabela = (over: Record<string, unknown> = {}) => [{
    id: 'baseline', pack: 'tibia-1332', monsters: { rat: 21 }, items: {}, ...over,
  }];

  it('aceita a tabela cujos ids existem no pacote', () => {
    const content = buildContent(base({ appearances: tabela(), packs: [inventory] }));
    expect(content.monsters.get('rat')?.outfitId).toBe(21);
  });

  it('recusa o id que o pacote não tem, e diz qual entrada e qual id', () => {
    // O defeito que a issue descreve: o número passa pelo schema, e vira quadrado invisível.
    expect(() => buildContent(base({ appearances: tabela({ monsters: { rat: 135 } }), packs: [inventory] })))
      .toThrow('appearances.monsters.rat: outfit 135 não existe no pacote tibia-1332');
  });

  it('recusa a tabela que cita um pacote sem inventário, quando há inventários', () => {
    // `pack` deixou de ser só documentação: com inventário no conteúdo, o nome tem que bater.
    expect(() => buildContent(base({ appearances: tabela({ pack: 'tibia-9999' }), packs: [inventory] })))
      .toThrow(/aponta o pacote "tibia-9999", e packs\/ não tem o inventário dele/);
  });

  it('sem inventário NENHUM a conferência não roda — a fixture continua sem falar de arte', () => {
    // O placeholder aponta o pacote "placeholder", que não existe em lugar nenhum, e os ids
    // dele são 1, 2, 3… Se isto reprovasse, toda fixture de combate precisaria de inventário.
    expect(() => buildContent(base())).not.toThrow();
    expect(() => buildContent(base({ appearances: tabela({ monsters: { rat: 9999 } }) }))).not.toThrow();
  });

  it('recusa um inventário malformado, e diz qual', () => {
    expect(() => buildContent(base({ appearances: tabela(), packs: [{ ...inventory, object: [[5, 3]] }] })))
      .toThrow(/pack "tibia-1332"/);
  });

  it('o inventário não entra na versão do conteúdo por conta própria: quem muda a arte é a tabela', () => {
    // Regenerar o inventário porque o pacote ganhou ids novos não muda o que nenhuma sessão vê;
    // trocar o `pack` da tabela muda (FUN-94), e esse já era o caso.
    const before = buildContent(base({ appearances: tabela(), packs: [inventory] })).version;
    const grown = { ...inventory, object: [[100, 167], [169, 370], [372, 394]] };
    const after = buildContent(base({ appearances: tabela(), packs: [grown] })).version;
    expect(after).toBe(before);
  });
});

describe('effects of spells, supplies and hits in the appearance table (FUN-109)', () => {
  const heal = {
    id: 'heal', name: 'Cura', manaCost: 20, cooldownMs: 1_000,
    effect: { kind: 'heal', amount: 60 },
  };
  const potion = {
    id: 'health-potion', name: 'Poção de Vida', price: 45, group: 'potion',
    effect: { kind: 'heal', amount: 80 },
  };
  // Uma magia de DANO, porque é ela que tem projétil: o teste de `missile` precisa de uma
  // magia que exista no catálogo, senão a linha órfã é recusada antes de o tipo do campo
  // importar — e a mutação no schema passaria escondida atrás da mensagem certa.
  const strike = {
    id: 'strike', name: 'Golpe Arcano', manaCost: 15, cooldownMs: 2_000,
    effect: { kind: 'damage', power: 40, range: 3 },
  };
  // A base já traz o placeholder com as três seções vazias; aqui a tabela é EXPLÍCITA, como
  // no bloco da FUN-94, porque é dela que o teste fala.
  const tabela = (over: Record<string, unknown> = {}) => [{
    id: 'baseline', pack: 'tibia-1332', monsters: { rat: 21 },
    items: {}, ...over,
  }];
  const withCatalogue = (over: Partial<RawContent> = {}): RawContent =>
    base({ spells: [heal], supplies: [potion], ...over });

  it('exposes effect and missile by spell id, and the effect by supply id', () => {
    // Só ids (invariante 6): quem sabe que 13 é "magic blue" é o pacote, nunca este arquivo.
    // Mutação que mata: apagar `spells`/`supplies`/`hits` do schema (Zod descarta a chave e
    // `appearances.spells` vira `undefined`).
    const content = buildContent(withCatalogue({
      appearances: tabela({
        spells: { heal: { effect: 13, missile: 5 } },
        supplies: { 'health-potion': { effect: 14 } },
        hits: { melee: 1 },
      }),
    }));
    expect(content.appearances?.spells['heal']).toEqual({ effect: 13, missile: 5 });
    expect(content.appearances?.supplies['health-potion']).toEqual({ effect: 14 });
    expect(content.appearances?.hits.melee).toBe(1);
  });

  it('rejects a spell effect for a spell that does not exist, and names it', () => {
    // A linha órfã: o defeito que a tabela introduz. Com o id inline, apagar a magia levaria
    // o efeito junto; com a tabela, a linha fica para trás e sobrevive a três trocas de pacote.
    // Mutação que mata: apagar o laço sobre `appearances.spells` em `buildContent`.
    expect(() => buildContent(withCatalogue({
      appearances: tabela({ spells: { 'exura-vita': { effect: 13 } } }),
    }))).toThrow(/appearances\.spells mapeia magia "exura-vita", que não existe no conteúdo/);
  });

  it('rejects a supply effect for a supply that does not exist, and names it', () => {
    // Mutação que mata: apagar o laço sobre `appearances.supplies` em `buildContent`.
    expect(() => buildContent(withCatalogue({
      appearances: tabela({ supplies: { 'ultimate-potion': { effect: 14 } } }),
    }))).toThrow(/appearances\.supplies mapeia supply "ultimate-potion", que não existe no conteúdo/);
  });

  it('ACCEPTS a spell with no entry in the table: a silent spell is still a spell', () => {
    // Um lado só, ao contrário de monstro e mapa. Exigir o outro obrigaria cada magia nova a
    // nascer com arte antes de nascer com número, que é a ordem errada — e o placeholder das
    // fixtures, que é vazio de propósito, deixaria de montar qualquer conteúdo com magia.
    // Mutação que mata: acrescentar em `buildContent` o laço inverso (`spells` sem linha em
    // `appearances.spells` vira problema).
    const content = buildContent(withCatalogue({ appearances: tabela() }));
    expect(content.spells.get('heal')?.manaCost).toBe(20);
    expect(content.appearances?.spells).toEqual({});
    expect(content.supplies.get('health-potion')?.price).toBe(45);
  });

  it('the placeholder table carries the three sections, empty', () => {
    // É o que deixa toda fixture que fala de magia continuar montando sem escrever tabela à
    // mão — e o que garante que `appearances.spells` nunca é `undefined` para quem consome.
    // Mutação que mata: apagar `spells: {}` de `placeholderAppearances`.
    const placeholder = placeholderAppearances({ spells: [heal], items: [potion] });
    expect(placeholder.spells).toEqual({});
    expect(placeholder.supplies).toEqual({});
    expect(placeholder.hits).toEqual({});
  });

  it('an effect is an ID, never a path — invariant 6 holds for effects as for outfits', () => {
    // Quatro campos, quatro expectativas: cada um é um `appearanceId.optional()` separado no
    // schema, e afrouxar um não afrouxa os outros. Só `heal.effect` aqui deixaria
    // `strike.missile` e `health-potion.effect` aceitarem caminho sem nada acusar.
    // A mensagem é conferida pelo CAMINHO do campo, e não só pelo tipo do erro: `strike` e
    // `health-potion` existem no catálogo, então a única recusa possível é a do schema.
    // Mutação que mata: `effect: appearanceId.optional()` → aceitar `z.string()` também;
    // o mesmo em `missile` de `spells` e em `effect` de `supplies`.
    expect(() => buildContent(withCatalogue({
      appearances: tabela({ spells: { heal: { effect: 'effects/magic-blue.png' } } }),
    }))).toThrow(/spells\.heal\.effect/);
    expect(() => buildContent(withCatalogue({
      spells: [heal, strike],
      appearances: tabela({ spells: { strike: { effect: 12, missile: 'missiles/energy.png' } } }),
    }))).toThrow(/spells\.strike\.missile/);
    expect(() => buildContent(withCatalogue({
      appearances: tabela({ supplies: { 'health-potion': { effect: 'effects/red-shimmer.png' } } }),
    }))).toThrow(/supplies\.health-potion\.effect/);
    expect(() => buildContent(withCatalogue({
      appearances: tabela({ hits: { melee: 0 } }),
    }))).toThrow(ContentError);
  });
});

describe('wall pieces by neighbourhood in the appearance table (FUN-105)', () => {
  const map = { id: 'rat-cellars', z: 7, grid: ['####', '#..#', '#..#', '####'] };
  const route = {
    id: 'rat-cellars', mapId: 'rat-cellars',
    tiles: [
      { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 2, y: 2, z: 7 }, { x: 1, y: 2, z: 7 },
    ],
  };
  const pieces = { vertical: 1294, horizontal: 1295, corner: 1298, pole: 1296 };
  // A tabela é EXPLÍCITA, como nos blocos da FUN-94 e da FUN-109: é do campo `wall` dela que
  // este bloco fala, e o placeholder só escreve um número.
  const tabela = (wall: unknown) => [{
    id: 'baseline', pack: 'tibia-1332', monsters: { rat: 21 }, items: {},
    maps: { 'rat-cellars': { floor: 355, wall } },
  }];
  const withWall = (wall: unknown): RawContent =>
    base({ maps: [map], routes: [route], appearances: tabela(wall) });

  it('wallSetOf turns ONE id into the four pieces, all the same', () => {
    // É o que mantém um mapa com `wall: 1298` desenhando o que desenhava antes da FUN-105: a
    // regra de vizinhança escolhe uma peça por tile, e as quatro apontam a mesma arte.
    // Mutação que mata: `pole: wall` → `pole: 0` (ou qualquer uma das quatro).
    expect(wallSetOf(1298)).toEqual({ vertical: 1298, horizontal: 1298, corner: 1298, pole: 1298 });
  });

  it('wallSetOf returns the four pieces as written, each in its own place', () => {
    // Cada campo conferido por si: `toEqual` com o objeto inteiro deixaria passar uma troca
    // de `vertical` por `horizontal` se a fixture tivesse os dois iguais — daí os quatro
    // números serem diferentes.
    // Mutação que mata: `return wall` → `return { ...wall, vertical: wall.horizontal }`.
    const set = wallSetOf(pieces);
    expect(set.vertical).toBe(1294);
    expect(set.horizontal).toBe(1295);
    expect(set.corner).toBe(1298);
    expect(set.pole).toBe(1296);
  });

  it('the table accepts a single id OR the four pieces, and exposes what was written', () => {
    // Sem normalizar: o arquivo diz o que o humano escreveu, e quem precisa das quatro chama
    // `wallSetOf`. Um schema que normalizasse faria `computeVersion` de dois arquivos
    // diferentes coincidir ou divergir por um detalhe de forma que ninguém decidiu.
    // Mutação que mata: `wall: z.union([appearanceId, wallSetSchema])` → só `appearanceId`
    // (a segunda expectativa) ou só `wallSetSchema` (a primeira).
    expect(buildContent(withWall(1298)).appearances?.maps['rat-cellars']?.wall).toBe(1298);
    expect(buildContent(withWall(pieces)).appearances?.maps['rat-cellars']?.wall).toEqual(pieces);
  });

  it('rejects a set with a piece missing: the rule needs all four, or it draws a hole', () => {
    // `wallSetOf` não tem como inventar a peça que falta, e um `?? corner` em código seria a
    // arte decidida onde ninguém procura por ela (invariante 6, ao contrário).
    //
    // As QUATRO, uma por vez: tirar só `pole` deixava `corner: appearanceId.optional()`
    // passar, porque o schema é um campo por peça e cada campo erra sozinho.
    // Mutação que mata: `corner: appearanceId` → `corner: appearanceId.optional()` (ou
    // qualquer uma das outras três).
    for (const piece of ['vertical', 'horizontal', 'corner', 'pole'] as const) {
      const { [piece]: _missing, ...threePieces } = pieces;
      expect(() => buildContent(withWall(threePieces)), `without ${piece}`)
        .toThrow(/maps\.rat-cellars\.wall/);
    }
  });

  it('a piece is an ID, never a path — invariant 6 holds for each of the four', () => {
    // As QUATRO, uma por vez, pela mesma razão do teste acima: um caminho só em `vertical`
    // deixava `horizontal` aceitar string sem ninguém notar.
    // Mutação que mata: `horizontal: appearanceId` → `z.union([appearanceId, z.string()])`
    // (ou qualquer uma das outras três).
    for (const piece of ['vertical', 'horizontal', 'corner', 'pole'] as const) {
      expect(() => buildContent(withWall({ ...pieces, [piece]: `walls/stone-${piece}.png` })),
        `path in ${piece}`)
        .toThrow(/maps\.rat-cellars\.wall/);
    }
  });

  it('rejects a fifth piece: nobody draws it, and Zod would drop it in silence', () => {
    // `strictObject`, como item e monstro. Uma chave `"diagonal"` descartada em silêncio é
    // exatamente o defeito que a tabela existe para ninguém ter de conferir à mão.
    // Mutação que mata: `z.strictObject` → `z.object` em `wallSetSchema`.
    expect(() => buildContent(withWall({ ...pieces, diagonal: 1297 })))
      .toThrow(/maps\.rat-cellars\.wall/);
  });
});

describe('catálogo de itens (FUN-76)', () => {
  const espada = {
    id: 'spike-sword', name: 'Spike Sword', kind: 'weapon',
    slot: 'hand', weight: 50, value: 0, attack: 24, requires: { level: 15 },
  };

  it('monta o catálogo indexado por id, com os defaults do schema', () => {
    const content = buildContent(base({ items: [espada] }));
    const item = content.items.get('spike-sword');
    expect(item?.attack).toBe(24);
    // Não declarados: armadura zero, não empilha, sem cargas.
    expect(item?.armor).toBe(0);
    expect(item?.stackable).toBe(false);
    expect(item?.charges).toBeUndefined();
  });

  it('a aparência NÃO mora mais no item — escrevê-la ali é recusado, não ignorado', () => {
    // Antes da FUN-94 este campo vivia aqui. Depois dela, Zod DESCARTARIA a chave desconhecida
    // em silêncio: o arquivo pareceria certo, o número não iria a lugar nenhum, e o item
    // apareceria com a arte de outro sem nada acusar. É o que `strictObject` impede.
    const comAparencia = { ...espada, appearanceId: 3271 };
    expect(() => buildContent(base({ items: [comAparencia] }))).toThrow(ContentError);
  });

  it('recusa slot que o personagem não tem', () => {
    // Lista fechada: um item que declara um slot inexistente é conteúdo quebrado, e o boot é
    // o lugar de descobrir isso — não a primeira tentativa de equipar.
    expect(() => buildContent(base({ items: [{ ...espada, slot: 'tail' }] })))
      .toThrow(ContentError);
  });

  it('item empilhável e item com carga cabem no mesmo schema', () => {
    // O empilhável é o queijo, não a flecha: munição deixou de ser item (ADR 0026, decisão 3).
    const queijo = {
      id: 'cheese', name: 'Cheese', kind: 'other', weight: 4, value: 0, stackable: true,
    };
    const anel = {
      id: 'time-ring', name: 'Time Ring', kind: 'ring', slot: 'finger',
      weight: 1, value: 0, durationMs: 600_000,
    };
    const content = buildContent(base({ items: [queijo, anel] }));
    expect(content.items.get('cheese')?.stackable).toBe(true);
    // Declarado e ainda não consumido por ninguém — §21.3, e a mecânica é issue própria.
    expect(content.items.get('time-ring')?.durationMs).toBe(600_000);
  });

  it('anel aceita ringEffect (energy-shield e regen-boost); outros kinds rejeitam', () => {
    const energyRing = {
      id: 'energy-ring', name: 'Energy Ring', kind: 'ring', slot: 'finger',
      weight: 2, value: 100, ringEffect: { kind: 'energy-shield' },
    };
    const lifeRing = {
      id: 'life-ring', name: 'Life Ring', kind: 'ring', slot: 'finger',
      weight: 2, value: 100, ringEffect: { kind: 'regen-boost', percent: 300 },
    };
    const espada = {
      id: 'sword', name: 'Sword', kind: 'weapon', slot: 'hand',
      weight: 10, value: 0, attack: 10, ringEffect: { kind: 'energy-shield' },
    };

    const content = buildContent(base({ items: [energyRing, lifeRing] }));
    expect(content.items.get('energy-ring')?.ringEffect).toEqual({ kind: 'energy-shield' });
    expect(content.items.get('life-ring')?.ringEffect).toEqual({ kind: 'regen-boost', percent: 300 });

    expect(() => buildContent(base({ items: [espada] }))).toThrow(/"ringEffect" só faz sentido em anel/);
  });
});

describe('a mochila, as duas mãos e a munição no catálogo (ADR 0026, #151)', () => {
  const espada = { id: 'sword', name: 'Sword', kind: 'weapon', slot: 'hand', weight: 10, value: 0, attack: 10 };

  it('a mochila é container e se veste em `back`; as duas coisas andam juntas', () => {
    const mochila = { id: 'backpack', name: 'Backpack', kind: 'container', slot: 'back', weight: 18, value: 0, initialSlots: 20 };
    expect(buildContent(base({ items: [mochila] })).items.get('backpack')?.slot).toBe('back');
    // Container tem lugares, e só ele (#160).
    expect(() => buildContent(base({ items: [{ ...mochila, initialSlots: undefined }] }))).toThrow(/precisa de initialSlots/);
    expect(() => buildContent(base({ items: [{ ...espada, initialSlots: 5 }] }))).toThrow(/só vale em kind "container"/);
    // Container fora das costas, e costas sem container: os dois são conteúdo quebrado.
    expect(() => buildContent(base({ items: [{ ...mochila, slot: 'hand' }] }))).toThrow(/slot "back"/);
    expect(() => buildContent(base({ items: [{ ...espada, slot: 'back' }] }))).toThrow(/só container/);
  });

  it('`twoHanded` só em arma', () => {
    expect(buildContent(base({ items: [{ ...espada, twoHanded: true }] })).items.get('sword')?.twoHanded).toBe(true);
    expect(buildContent(base({ items: [espada] })).items.get('sword')?.twoHanded).toBe(false);
    const capacete = { id: 'helmet', name: 'Helmet', kind: 'armor', slot: 'head', weight: 1, value: 0, twoHanded: true };
    expect(() => buildContent(base({ items: [capacete] }))).toThrow(/twoHanded/);
  });

  it('a munição é ABSTRATA: família, attack e price > 0, sem item nem pilha (ADR 0026 d.3)', () => {
    const flecha = { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 1 };
    const content = buildContent(base({ ammunition: [flecha] }));
    expect(content.ammunition.get('arrow')?.attack).toBe(25);
    expect(content.ammunition.get('arrow')?.price).toBe(1);
    // A aparência guarda ícone e projétil, os dois resolvidos no boot.
    expect(content.ammunition.get('arrow')?.appearanceId).toBe(1);
    expect(content.ammunition.get('arrow')?.missileId).toBe(1);
    // Sem item: a flecha não está no catálogo de itens.
    expect(content.items.has('arrow')).toBe(false);
    // Não existe munição grátis: `price` > 0 é exigido, sem fallback.
    expect(() => buildContent(base({ ammunition: [{ ...flecha, price: 0 }] })))
      .toThrow(ContentError);
  });

  it('a munição sem aparência e a linha órfã em appearances.ammunition são recusadas', () => {
    const flecha = { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 1 };
    const raw = base({ ammunition: [flecha] });
    const semAparencia = { ...raw, appearances: [{ ...placeholderAppearances(raw), ammunition: {} }] };
    expect(() => buildContent(semAparencia)).toThrow(/não tem aparência/);
    const orfa = {
      ...raw,
      appearances: [{
        ...placeholderAppearances(raw),
        ammunition: { bolt: { icon: 1, missile: 2 } },
      }],
    };
    expect(() => buildContent(orfa)).toThrow(/appearances.ammunition mapeia munição "bolt", que não existe no conteúdo/);
  });

  it('como a arma bate é da arma: corpo a corpo por padrão, distância exige família com munição, wand exige mana e faixa (#152)', () => {
    // Sem `weapon`, uma arma é corpo a corpo de alcance 1 — o que toda arma era.
    expect(buildContent(base({ items: [espada] })).items.get('sword')?.weapon).toEqual({
      kind: 'melee', family: 'sword', range: 1, damageType: 'physical',
      power: { base: 10, levelFactor: 0, skillFactor: 0, skillStartingLevel: 10, spread: 0 },
    });
    const flecha = { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 1 };
    const arco = { id: 'bow', name: 'Bow', kind: 'weapon', slot: 'hand', weight: 31, value: 0, twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' } };
    expect(buildContent(base({ items: [arco], ammunition: [flecha] })).items.get('bow')?.weapon?.range).toBe(6);
    // Distância sem família, e família sem munição no catálogo, são as duas formas de um bow que
    // não atira nada.
    expect(() => buildContent(base({ items: [{ ...arco, weapon: { kind: 'distance', range: 6 } }], ammunition: [flecha] }))).toThrow(/precisa de "ammoFamily"/);
    expect(() => buildContent(base({ items: [arco] }))).toThrow(/não tem munição no catálogo/);
    const varinha = { id: 'wand', name: 'Wand', kind: 'weapon', slot: 'hand', weight: 19, value: 0, weapon: { kind: 'wand', range: 3, manaPerHit: 2, damage: { min: 8, max: 18 } } };
    expect(buildContent(base({ items: [varinha] })).items.get('wand')?.weapon?.manaPerHit).toBe(2);
    expect(() => buildContent(base({ items: [{ ...varinha, weapon: { kind: 'wand', range: 3 } }] }))).toThrow(/precisa de "manaPerHit" e "damage"/);
    expect(() => buildContent(base({ items: [{ ...varinha, weapon: { kind: 'wand', range: 3, manaPerHit: 2, damage: { min: 18, max: 8 } } }] }))).toThrow(/damage.min maior/);
    // Campo de um tipo em arma de outro, e `weapon` fora de arma: conteúdo quebrado.
    expect(() => buildContent(base({ items: [{ ...espada, weapon: { kind: 'melee', range: 1, manaPerHit: 2 } }] }))).toThrow(/só wand/);
    expect(() => buildContent(base({ items: [{ ...espada, weapon: { kind: 'melee', range: 1, ammoFamily: 'arrow' } }] }))).toThrow(/só arma de distância/);
    const capacete = { id: 'helmet', name: 'Helmet', kind: 'armor', slot: 'head', weight: 1, value: 0, weapon: { kind: 'melee', range: 1 } };
    expect(() => buildContent(base({ items: [capacete] }))).toThrow(/só faz sentido em arma/);
  });

  it('o projétil da wand fica em appearances.weapons, de um lado só: arma muda é válida, linha órfã não (#152)', () => {
    const varinha = { id: 'wand', name: 'Wand', kind: 'weapon', slot: 'hand', weight: 19, value: 0, weapon: { kind: 'wand', range: 3, manaPerHit: 2, damage: { min: 8, max: 18 } } };
    const raw = base({ items: [varinha] });
    expect(buildContent(raw).appearances?.weapons).toEqual({});
    const comProjetil = { ...raw, appearances: [{ ...placeholderAppearances(raw), weapons: { wand: { missile: 5 } } }] };
    expect(buildContent(comProjetil).appearances?.weapons['wand']?.missile).toBe(5);
    const orfa = { ...raw, appearances: [{ ...placeholderAppearances(raw), weapons: { helmet: { missile: 5 } } }] };
    expect(() => buildContent(orfa)).toThrow(/appearances.weapons mapeia "helmet"/);
  });
});

describe('famílias de arma e proficiências (CMB-05, #333)', () => {
  const espada = { id: 'sword', name: 'Sword', kind: 'weapon', slot: 'hand', weight: 10, value: 0, attack: 10 };
  const flecha = { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 1 };
  const arco = { id: 'bow', name: 'Bow', kind: 'weapon', slot: 'hand', weight: 31, value: 0, twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' } };

  it('a arma SEM família recebe o default do `kind`: melee→sword, distance→distance, wand→wand', () => {
    // A normalização preserva o conteúdo anterior ao CMB-05 e a fixture (DT-03). O real declara.
    expect(buildContent(base({ items: [espada] })).items.get('sword')?.weapon?.family).toBe('sword');
    const bow = buildContent(base({ items: [arco], ammunition: [flecha] })).items.get('bow')?.weapon;
    expect(bow?.family).toBe('distance');
    const varinha = { id: 'wand', name: 'Wand', kind: 'weapon', slot: 'hand', weight: 19, value: 0, weapon: { kind: 'wand', range: 3, manaPerHit: 2, damage: { min: 8, max: 18 } } };
    expect(buildContent(base({ items: [varinha] })).items.get('wand')?.weapon?.family).toBe('wand');
  });

  it('recusa família que não existe no catálogo', () => {
    const orfa = { ...espada, weapon: { kind: 'melee', family: 'club', range: 1 } };
    const semClub = weaponFamilies.filter((family) => family.id !== 'club');
    expect(() => buildContent(base({ items: [orfa], weaponFamilies: semClub })))
      .toThrow(/a família "club" não existe em weapon-families/);
  });

  it('recusa família incoerente com o `kind` da arma', () => {
    // Uma `sword` de distância é a família certa para a fórmula errada.
    const incoerente = { ...arco, weapon: { kind: 'distance', family: 'sword', range: 6, ammoFamily: 'arrow' } };
    expect(() => buildContent(base({ items: [incoerente], ammunition: [flecha] })))
      .toThrow(/família "sword" é "melee", e a arma é "distance"/);
  });

  it('recusa `fist` como arma: ela é o fallback desarmado, não um item', () => {
    const punho = { ...espada, weapon: { kind: 'melee', family: 'fist', range: 1 } };
    expect(() => buildContent(base({ items: [punho] }))).toThrow(/"fist" é o fallback desarmado/);
  });

  it('recusa família de melee sem fórmula, e wand/rod com fórmula', () => {
    const semFormula = weaponFamilies.map((family) =>
      family.id === 'sword' ? { ...family, formula: undefined } : family);
    expect(() => buildContent(base({ weaponFamilies: semFormula })))
      .toThrow(/família "melee" precisa de fórmula/);
    const wandComFormula = weaponFamilies.map((family) =>
      family.id === 'wand' ? { ...family, formula: { levelFactor: 0, spread: 0 } } : family);
    expect(() => buildContent(base({ weaponFamilies: wandComFormula })))
      .toThrow(/wand\/rod usam a faixa fixa da arma, não fórmula/);
  });

  it('recusa família de melee que gasta recurso, e wand/rod sem mana', () => {
    const meleeComMana = weaponFamilies.map((family) =>
      family.id === 'sword' ? { ...family, resource: 'mana' } : family);
    expect(() => buildContent(base({ weaponFamilies: meleeComMana })))
      .toThrow(/família "melee" não gasta recurso/);
    const wandSemMana = weaponFamilies.map((family) =>
      family.id === 'wand' ? { ...family, resource: 'none' } : family);
    expect(() => buildContent(base({ weaponFamilies: wandSemMana })))
      .toThrow(/wand\/rod gastam mana/);
  });

  it('recusa família que aponta skill inexistente — quando há skills', () => {
    const orfa = weaponFamilies.map((family) =>
      family.id === 'sword' ? { ...family, skillId: 'swordmanship' } : family);
    expect(() => buildContent(base({ weaponFamilies: orfa })))
      .toThrow(/weaponFamily\/sword: skillId "swordmanship" não existe/);
  });

  it('recusa o catálogo sem `fist`: o desarmado perderia a escala de skill', () => {
    const semFist = weaponFamilies.filter((family) => family.id !== 'fist');
    expect(() => buildContent(base({ weaponFamilies: semFist })))
      .toThrow(/falta a família "fist"/);
  });

  it('a fórmula compilada carrega a contribuição da skill apontada', () => {
    const comEscala = [{ ...skills[0], damagePerLevel: 0.25 }, skills[1], skills[2]];
    const content = buildContent(base({ skills: comEscala }));
    expect(content.weaponFamilies.get('sword')).toMatchObject({
      skillId: 'melee', skillFactor: 0.25, skillStartingLevel: 10,
    });
    // O desarmado é a família `fist` com o `attack` do bloco `player` e a escala da `melee`.
    expect(content.unarmed.power).toMatchObject({
      base: 25, levelFactor: 0, skillFactor: 0.25, skillStartingLevel: 10, spread: 0,
    });
  });
});

describe('o kit de nascimento é conteúdo, e o boot confere (#153, ADR 0026 decisão 2)', () => {
  const machete = { id: 'machete', name: 'Machete', kind: 'weapon', slot: 'hand', weight: 16.5, value: 0, attack: 12 };
  const helmet = { id: 'leather-helmet', name: 'Leather Helmet', kind: 'armor', slot: 'head', weight: 22, value: 0, armor: 1 };
  const axe = { id: 'steel-axe', name: 'Steel Axe', kind: 'weapon', slot: 'hand', weight: 50, value: 0, attack: 21, requires: { vocationId: 'knight' } };
  const withKit = (startingKit: unknown, items: unknown[] = [machete, helmet]) =>
    base({ items, progression: [{ ...baseline, startingKit }] });

  it('sem kit no JSON, ninguém nasce com nada — é o conteúdo de teste', () => {
    expect(buildContent(base()).progression.startingKit).toEqual([]);
  });

  it('aceita o kit com item que existe, no slot dele, sem exigência', () => {
    const content = buildContent(withKit([
      { itemId: 'machete', slot: 'hand' }, { itemId: 'leather-helmet', slot: 'head' },
    ]));
    expect(content.progression.startingKit).toEqual([
      { itemId: 'machete', slot: 'hand' }, { itemId: 'leather-helmet', slot: 'head' },
    ]);
  });

  it('recusa item fantasma, e diz qual', () => {
    expect(() => buildContent(withKit([{ itemId: 'espada-de-luz', slot: 'hand' }])))
      .toThrow(/kit de nascimento aponta item "espada-de-luz"/);
  });

  it('recusa slot que não é o do item: a machete não se veste na cabeça', () => {
    expect(() => buildContent(withKit([{ itemId: 'machete', slot: 'head' }])))
      .toThrow(/"machete" do kit se veste em "hand", não em "head"/);
  });

  it('recusa item que exige vocação ou level: o personagem nasce level 1 sem ela', () => {
    expect(() => buildContent(withKit([{ itemId: 'steel-axe', slot: 'hand' }], [axe])))
      .toThrow(/"steel-axe" do kit exige level ou vocação/);
  });

  it('recusa arma de duas mãos com escudo: o kit não passa por `equip`, então a regra das mãos vale aqui', () => {
    const bow = { id: 'bow', name: 'Bow', kind: 'weapon', slot: 'hand', weight: 31, value: 0, twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' } };
    const shield = { id: 'wooden-shield', name: 'Wooden Shield', kind: 'shield', slot: 'shield', weight: 40, value: 0 };
    const arrow = { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 1 };
    const withArmory = (startingKit: unknown) =>
      base({ items: [bow, shield], ammunition: [arrow], progression: [{ ...baseline, startingKit }] });
    expect(() => buildContent(withArmory([
      { itemId: 'bow', slot: 'hand' }, { itemId: 'wooden-shield', slot: 'shield' },
    ]))).toThrow(/duas mãos e escudo/);
    expect(buildContent(withArmory([{ itemId: 'bow', slot: 'hand' }])).progression.startingKit)
      .toHaveLength(1);
  });

  it('aceita o colar e o escudo no kit: sem `requires`, eles vestem no level 1 (RF-08)', () => {
    // O primeiro colar e o primeiro escudo reais (ADR 0032 d.8): sem exigência de level nem
    // vocação, são o que o personagem pode vestir ao nascer.
    const amulet = {
      id: 'glacier-amulet', name: 'Glacier Amulet', kind: 'amulet', slot: 'neck',
      weight: 5.5, value: 0, charges: 20, mitigation: { resistances: { ice: 0.2 } },
    };
    const shield = {
      id: 'wooden-shield', name: 'Wooden Shield', kind: 'shield', slot: 'shield',
      weight: 40, value: 0, defense: 14,
    };
    const content = buildContent(withKit([
      { itemId: 'glacier-amulet', slot: 'neck' }, { itemId: 'wooden-shield', slot: 'shield' },
    ], [amulet, shield]));
    expect(content.progression.startingKit).toHaveLength(2);
    expect(content.items.get('glacier-amulet')?.charges).toBe(20);
    expect(content.items.get('wooden-shield')?.defense).toBe(14);
  });

  it('recusa duas peças no mesmo slot: o banco recusaria na criação, e o boot é o lugar', () => {
    const sword = { ...machete, id: 'sword', name: 'Sword' };
    expect(() => buildContent(withKit([
      { itemId: 'machete', slot: 'hand' }, { itemId: 'sword', slot: 'hand' },
    ], [machete, sword]))).toThrow(/duas peças em "hand"/);
  });
});

describe('loot de item, agora que existe catálogo (FUN-76)', () => {
  const espada = {
    id: 'spike-sword', name: 'Spike Sword', kind: 'weapon',
    slot: 'hand', weight: 50, value: 0, attack: 24,
  };
  const comLoot = (itemId: string) => ({
    ...rat, loot: { items: [{ itemId, chance: 0.1, min: 1, max: 1 }] },
  });

  it('ACEITA loot que aponta item do catálogo', () => {
    // Era recusado por não haver catálogo. Agora o que decide é a referência existir.
    const content = buildContent(base({ items: [espada], monsters: [comLoot('spike-sword')] }));
    expect(content.monsters.get('rat')?.loot.items[0]?.itemId).toBe('spike-sword');
  });

  it('continua recusando item FANTASMA, e diz qual', () => {
    // Creditar no primeiro abate um item que nunca vai poder ser desenhado, equipado nem
    // vendido é o defeito; o sintoma chegaria dias depois, longe da causa.
    expect(() => buildContent(base({ items: [espada], monsters: [comLoot('excalibur')] })))
      .toThrow(/excalibur/);
  });

  it('sem catálogo nenhum, qualquer loot de item é recusado', () => {
    expect(() => buildContent(base({ monsters: [comLoot('spike-sword')] })))
      .toThrow(ContentError);
  });
});

describe('a arma inicial da vocação (#154, ADR 0026 decisão 3)', () => {
  const axe = {
    id: 'steel-axe', name: 'Steel Axe', kind: 'weapon', slot: 'hand', weight: 41, value: 0, attack: 21,
    weapon: { kind: 'melee', range: 1 }, requires: { vocationId: 'knight' },
  };

  it('aceita a arma que existe, é arma e exige a própria vocação', () => {
    const content = buildContent(base({ vocations: [{ ...knight, startingWeaponItemId: 'steel-axe' }], items: [axe] }));
    expect(content.vocations.get('knight')?.startingWeaponItemId).toBe('steel-axe');
  });

  it('recusa arma inexistente, item que não é arma, e arma que qualquer um veste', () => {
    // Mutação que mata: apagar qualquer uma das três conferências em `buildContent`.
    expect(() => buildContent(base({ vocations: [{ ...knight, startingWeaponItemId: 'nope' }] })))
      .toThrow(/arma inicial "nope" não existe/);
    const helmet = { ...axe, id: 'leather-helmet', kind: 'armor', slot: 'head', weapon: undefined };
    expect(() => buildContent(base({ vocations: [{ ...knight, startingWeaponItemId: 'leather-helmet' }], items: [helmet] })))
      .toThrow(/não é arma/);
    const anyones = { ...axe, id: 'machete', requires: {} };
    expect(() => buildContent(base({ vocations: [{ ...knight, startingWeaponItemId: 'machete' }], items: [anyones] })))
      .toThrow(/precisa exigir a própria vocação/);
  });
});

describe('o kit inicial da vocação é conteúdo, e o boot confere (#496)', () => {
  const axe = {
    id: 'steel-axe', name: 'Steel Axe', kind: 'weapon', slot: 'hand', weight: 41, value: 0, attack: 21,
    weapon: { kind: 'melee', range: 1 }, requires: { vocationId: 'knight' },
  };
  const shield = { id: 'wooden-shield', name: 'Wooden Shield', kind: 'shield', slot: 'shield', weight: 40, value: 0, defense: 14 };
  const withKit = (vocations: unknown[], items: unknown[] = [axe, shield]) =>
    base({ vocations, items });
  const knightWithKit = {
    ...knight,
    startingKit: [{ itemId: 'steel-axe', slot: 'hand' }, { itemId: 'wooden-shield', slot: 'shield' }],
  };

  it('aceita o kit, e o JSON normaliza a peça sem slot declarado', () => {
    const content = buildContent(withKit([
      { ...knightWithKit, startingKit: [{ itemId: 'steel-axe', slot: 'hand' }, { itemId: 'wooden-shield' }] },
    ]));
    expect(content.vocations.get('knight')?.startingKit).toEqual([
      { itemId: 'steel-axe', slot: 'hand' }, { itemId: 'wooden-shield' },
    ]);
  });

  it('recusa item fantasma, e diz qual vocação e qual item', () => {
    expect(() => buildContent(withKit([
      { ...knightWithKit, startingKit: [{ itemId: 'espada-de-luz', slot: 'hand' }] },
    ]))).toThrow(/aponta item "espada-de-luz"/);
  });

  it('recusa peça declarada no slot que não é o do item', () => {
    expect(() => buildContent(withKit([
      { ...knightWithKit, startingKit: [{ itemId: 'steel-axe', slot: 'head' }] },
    ]))).toThrow(/do kit se veste em "hand", não em "head"/);
  });

  it('recusa peça que exige OUTRA vocação: o kit é do dono', () => {
    // O escudo sem `requires` veste em qualquer um — é por isso que o kit do Knight é ele.
    // Mas uma arma de outra vocação no kit é declaração impossível de vestir.
    const wand = {
      id: 'wand-of-vortex', name: 'Wand of Vortex', kind: 'weapon', slot: 'hand', weight: 19, value: 0,
      weapon: { kind: 'wand', range: 3 }, requires: { vocationId: 'sorcerer' },
    };
    expect(() => buildContent(withKit([
      { ...knightWithKit, startingKit: [{ itemId: 'wand-of-vortex', slot: 'hand' }] },
    ], [wand]))).toThrow(/exige a vocação "sorcerer"/);
  });

  it('aceita a peça que exige a PRÓPRIA vocação, como a arma de sempre', () => {
    const content = buildContent(withKit([knightWithKit]));
    expect(content.vocations.get('knight')?.startingKit).toHaveLength(2);
  });

  it('recusa duas peças no mesmo slot: a segunda nasceria na mochila com o slot declarado mentindo', () => {
    const sword = { ...axe, id: 'spike-sword', name: 'Spike Sword' };
    expect(() => buildContent(withKit([
      { ...knightWithKit, startingKit: [{ itemId: 'steel-axe', slot: 'hand' }, { itemId: 'spike-sword', slot: 'hand' }] },
    ], [axe, sword]))).toThrow(/duas peças em "hand"/);
  });

  it('aceita arma de duas mãos com escudo: é o kit do Paladin, e o `equip` dá o estado certo', () => {
    // O kit de nascimento recusa a combinação porque é gravado sem passar por `equip`; o kit
    // da vocação passa por `equip`, e o escudo impedido fica na mochila. Recusar aqui fecharia
    // o kit clássico do arqueiro.
    const bow = { ...axe, id: 'bow', name: 'Bow', twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' }, requires: { vocationId: 'paladin' } };
    const paladin = { ...knight, id: 'paladin', name: 'Paladin', capacityPerLevel: 20 };
    const arrow = { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 1 };
    const content = buildContent(base({
      items: [bow, shield],
      ammunition: [arrow],
      vocations: [{ ...paladin, startingKit: [{ itemId: 'bow', slot: 'hand' }, { itemId: 'wooden-shield', slot: 'shield' }] }],
    }));
    expect(content.vocations.get('paladin')?.startingKit).toHaveLength(2);
  });

  it('arma legada e kit juntos têm de concordar: a arma declarada é peça do kit', () => {
    // O host prefere o kit; um `startingWeaponItemId` fora dele seria a arma que o jogador vê
    // no diálogo e NÃO recebe. O boot é o lugar da divergência.
    const content = buildContent(withKit([
      { ...knightWithKit, startingWeaponItemId: 'steel-axe' },
    ]));
    expect(content.vocations.get('knight')?.startingWeaponItemId).toBe('steel-axe');
    const machete = {
      id: 'machete', name: 'Machete', kind: 'weapon', slot: 'hand', weight: 16.5, value: 0, attack: 12,
      weapon: { kind: 'melee', range: 1 },
    };
    expect(() => buildContent(withKit([
      { ...knightWithKit, startingWeaponItemId: 'machete' },
    ], [axe, shield, machete]))).toThrow(/não é peça do startingKit/);
  });

  it('sem kit no JSON, a vocação concede só a arma legada — o conteúdo de teste continua de pé', () => {
    const content = buildContent(base({ vocations: [{ ...knight, startingWeaponItemId: 'steel-axe' }], items: [axe] }));
    expect(content.vocations.get('knight')?.startingKit).toEqual([]);
  });
});

describe('magia de vocação (#156–#159)', () => {
  it('recusa uma magia cuja vocação não existe', () => {
    // Uma magia órfã subiria muda e nunca seria lançada por ninguém. Mutação que mata: tirar a
    // conferência de `spell.vocationId` em `buildContent`.
    const orphan = {
      id: 'x', name: 'X', manaCost: 1, cooldownMs: 1000, vocationId: 'monk',
      effect: { kind: 'heal', amount: 1 },
    };
    expect(() => buildContent(base({ spells: [orphan] }))).toThrow(/vocationId "monk" não existe/);
    expect(() => buildContent(base({ spells: [{ ...orphan, vocationId: 'knight' }] }))).not.toThrow();
  });
});

describe('requisito de mais de uma vocação em item e suprimento (#524, kit level 200)', () => {
  const paladin = { ...knight, id: 'paladin', name: 'Paladin' };

  it('item: `requires.vocationId` aceita uma LISTA, e cada id precisa existir', () => {
    const sharedArmor = {
      id: 'shared-armor', name: 'Shared Armor', kind: 'armor', slot: 'chest',
      weight: 1, value: 0, requires: { vocationId: ['knight', 'monk'] },
    };
    expect(() => buildContent(base({ vocations: [knight, paladin], items: [sharedArmor] })))
      .toThrow(/item "shared-armor": requires.vocationId "monk" não existe/);
    const fixed = { ...sharedArmor, requires: { vocationId: ['knight', 'paladin'] } };
    expect(() => buildContent(base({ vocations: [knight, paladin], items: [fixed] }))).not.toThrow();
  });

  it('item: sem NENHUMA vocação declarada no catálogo, a conferência é tolerante (conteúdo de teste sem sistema de vocação)', () => {
    // A mesma tolerância de `spellSkill`: `vocations.size === 0` não tem como conferir nada.
    const orphanArmor = {
      id: 'orphan-armor', name: 'Orphan Armor', kind: 'armor', slot: 'chest',
      weight: 1, value: 0, requires: { vocationId: ['sorcerer', 'druid'] },
    };
    expect(() => buildContent(base({ vocations: [], items: [orphanArmor] }))).not.toThrow();
  });

  it('item: `bonuses.skill.skillId` precisa existir no catálogo de skills', () => {
    const mlHat = {
      id: 'ml-hat', name: 'ML Hat', kind: 'armor', slot: 'head', weight: 1, value: 0,
      bonuses: { skill: { skillId: 'nope', amount: 1 } },
    };
    expect(() => buildContent(base({ items: [mlHat] })))
      .toThrow(/item "ml-hat": bonuses.skill.skillId "nope" não existe/);
    const fixed = { ...mlHat, bonuses: { skill: { skillId: 'magic', amount: 1 } } };
    expect(() => buildContent(base({ items: [fixed] }))).not.toThrow();
  });

  it('suprimento: `requires.vocationId` também aceita uma LISTA, com a mesma conferência', () => {
    const greatMana = {
      id: 'great-mana-potion', name: 'Great Mana Potion', price: 250, group: 'potion' as const,
      groupCooldownMs: 1_000,
      requires: { level: 80, vocationId: ['sorcerer', 'druid', 'monk'] },
      effect: { kind: 'mana' as const, amountRange: { min: 150, max: 250 } },
    };
    expect(() => buildContent(base({ vocations: [knight, paladin], supplies: [greatMana] })))
      .toThrow(/supply\/great-mana-potion: requires.vocationId "monk" não existe/);
  });

  it('suprimento: `effect.heal.amountRange` é a faixa fixa da poção do Tibia — min não passa de max', () => {
    const broken = {
      id: 'broken-potion', name: 'Broken Potion', price: 1, group: 'potion' as const,
      groupCooldownMs: 1_000, requires: {},
      effect: { kind: 'heal' as const, amountRange: { min: 350, max: 250 } },
    };
    expect(() => buildContent(base({ supplies: [broken] })))
      .toThrow(/faixa invertida/);
  });

  it('suprimento: `effect.mana` exige `amount` OU `amountRange` — nenhum dos dois é recusado', () => {
    const empty = {
      id: 'empty-potion', name: 'Empty Potion', price: 1, group: 'potion' as const,
      groupCooldownMs: 1_000, requires: {}, effect: { kind: 'mana' as const },
    };
    expect(() => buildContent(base({ supplies: [empty] })))
      .toThrow(/mana precisa de "amount" ou "amountRange"/);
  });

  it('suprimento: `effect.heal.alsoMana` (a poção de espírito) exige `amount` OU `amountRange`', () => {
    const emptySpirit = {
      id: 'empty-spirit', name: 'Empty Spirit', price: 1, group: 'potion' as const,
      groupCooldownMs: 1_000, requires: {},
      effect: {
        kind: 'heal' as const, amountRange: { min: 1, max: 2 }, alsoMana: {},
      },
    };
    expect(() => buildContent(base({ supplies: [emptySpirit] })))
      .toThrow(/alsoMana precisa de "amount" ou "amountRange"/);
    const withMana = {
      ...emptySpirit,
      effect: { ...emptySpirit.effect, alsoMana: { amountRange: { min: 1, max: 2 } } },
    };
    expect(() => buildContent(base({ supplies: [withMana] }))).not.toThrow();
  });
});

describe('grupo de magia (#155, ADR 0026 decisão 5)', () => {
  it('recusa secondaryGroup sem group, e cita o id', () => {
    // O secundário é o segundo livro (combat.md); sem o primeiro ele vira o único, com
    // semântica diferente da documentada. Mutação que mata: tirar esta conferência de
    // `buildContent`.
    const spell = {
      id: 'exura-vita', name: 'Exura Vita', manaCost: 160, cooldownMs: 1000,
      secondaryGroup: { name: 'stance', cooldownMs: 2000 },
      effect: { kind: 'heal', amount: 200 },
    };
    expect(() => buildContent(base({ spells: [spell] })))
      .toThrow(/spell\/exura-vita: secondaryGroup sem group/);
  });
});

describe('a fórmula canônica de dano (#474)', () => {
  const formula = { levelFactor: 0.2, skillMin: 1.403, skillMax: 2.203, baseMin: 8, baseMax: 13 };
  const iceStrike = {
    id: 'ice-strike', name: 'Ice Strike', manaCost: 12, cooldownMs: 2000,
    effect: { kind: 'damage', basePower: 45, range: 3, damageType: 'ice', formula },
  };

  it('aceita basePower junto da fórmula — a fórmula vence, o BP fica de exibição', () => {
    const content = buildContent(base({ spells: [iceStrike] }));
    expect(content.spells.get('ice-strike')?.effect)
      .toMatchObject({ basePower: 45, formula: { skillMin: 1.403 } });
  });

  it('aceita a fórmula sozinha, sem basePower', () => {
    const only = { ...iceStrike, effect: { kind: 'damage', range: 3, damageType: 'ice', formula } };
    expect(() => buildContent(base({ spells: [only] }))).not.toThrow();
  });

  it('recusa `power` junto de fórmula/basePower: dois mecanismos de dano', () => {
    // Mutação que mata: aceitar os dois e deixar a precedência implícita — a magia sairia com
    // o dano errado sem nada acusar.
    const both = { ...iceStrike, effect: { ...iceStrike.effect, power: 10 } };
    expect(() => buildContent(base({ spells: [both] })))
      .toThrow(/power OU basePower\/formula/);
  });

  it('recusa dano sem mecanismo nenhum', () => {
    const none = { ...iceStrike, effect: { kind: 'damage', range: 3, damageType: 'ice' } };
    expect(() => buildContent(base({ spells: [none] })))
      .toThrow(/power OU basePower\/formula/);
  });
});

describe('a fórmula canônica de cura e as runas UH/IH (#475)', () => {
  const formula = { levelFactor: 0.2, skillMin: 1.4, skillMax: 2.0, baseMin: 8, baseMax: 11 };
  const lightHealing = {
    id: 'light-healing', name: 'Light Healing', manaCost: 20, cooldownMs: 1_000,
    group: 'healing', groupCooldownMs: 1_000,
    effect: { kind: 'heal', basePower: 40, formula },
  };
  const massHealing = {
    ...lightHealing, id: 'mass-healing',
    effect: {
      kind: 'heal', basePower: 200, formula,
      area: { shape: 'circle', radius: 1, centered: 'caster' },
    },
  };

  it('aceita a fórmula junto do basePower — a fórmula vence, o BP fica de exibição', () => {
    const content = buildContent(base({ spells: [lightHealing] }));
    expect(content.spells.get('light-healing')?.effect)
      .toMatchObject({ kind: 'heal', basePower: 40, formula: { skillMin: 1.4 } });
  });

  it('aceita a cura em área 3x3 centrada no lançador (Mass Healing)', () => {
    const content = buildContent(base({ spells: [massHealing] }));
    expect(content.spells.get('mass-healing')?.effect)
      .toMatchObject({ area: { shape: 'circle', radius: 1, centered: 'caster' } });
  });

  it('recusa `amount` junto de fórmula/basePower: dois mecanismos de cura', () => {
    // Mutação que mata: aceitar os dois e deixar a precedência implícita — a cura sairia errada.
    const both = { ...lightHealing, effect: { ...lightHealing.effect, amount: 10 } };
    expect(() => buildContent(base({ spells: [both] })))
      .toThrow(/cura precisa de amount OU basePower\/formula/);
  });

  it('recusa cura sem mecanismo nenhum', () => {
    const none = { ...lightHealing, effect: { kind: 'heal' } };
    expect(() => buildContent(base({ spells: [none] })))
      .toThrow(/cura precisa de amount OU basePower\/formula/);
  });

  it('recusa cura em área centrada no ALVO: cura não tem mira', () => {
    const noTarget = {
      ...massHealing,
      effect: { ...massHealing.effect, area: { shape: 'circle', radius: 1, centered: 'target' } },
    };
    expect(() => buildContent(base({ spells: [noTarget] })))
      .toThrow(/cura em área precisa ser centrada no lançador/);
  });

  it('a runa de cura aceita fórmula e recusa dois mecanismos, como a magia', () => {
    const rune = {
      id: 'ultimate-healing-rune', name: 'Ultimate Healing Rune', price: 35,
      group: 'healing', groupCooldownMs: 1_000, requires: { level: 24, magicLevel: 4 },
      effect: {
        kind: 'heal', range: 4,
        formula: { levelFactor: 0.2, skillMin: 5.7, skillMax: 10.3, baseMin: 36, baseMax: 65 },
      },
    };
    expect(buildContent(base({ supplies: [rune] })).supplies.get('ultimate-healing-rune')?.effect)
      .toMatchObject({ kind: 'heal', formula: { skillMin: 5.7 } });
    const both = { ...rune, effect: { ...rune.effect, amount: 10 } };
    expect(() => buildContent(base({ supplies: [both] })))
      .toThrow(/supply\/ultimate-healing-rune: cura precisa de amount\/amountRange OU basePower\/formula/);
  });
});

describe('as runas de ataque do Canary (#476)', () => {
  const suddenDeath = {
    id: 'sudden-death-rune', name: 'Sudden Death Rune', price: 108,
    group: 'attack', groupCooldownMs: 2_000, requires: { level: 45, magicLevel: 15 },
    effect: {
      kind: 'damage', range: 8, damageType: 'death',
      formula: { levelFactor: 0.2, skillMin: 4.6, skillMax: 7.4, baseMin: 32, baseMax: 48 },
    },
  };

  it('aceita a runa de ALVO ÚNICO com fórmula e SEM area (#476)', () => {
    const content = buildContent(base({ supplies: [suddenDeath] }));
    expect(content.supplies.get('sudden-death-rune')?.effect)
      .toMatchObject({ kind: 'damage', damageType: 'death', formula: { skillMin: 4.6 } });
    expect(content.supplies.get('sudden-death-rune')?.effect).not.toHaveProperty('area');
  });

  it('aceita a fórmula junto do basePower — a fórmula vence, o BP fica de exibição', () => {
    const rune = {
      ...suddenDeath, id: 'avalanche-rune',
      effect: { ...suddenDeath.effect, basePower: 45, damageType: 'ice' },
    };
    expect(buildContent(base({ supplies: [rune] })).supplies.get('avalanche-rune')?.effect)
      .toMatchObject({ kind: 'damage', basePower: 45, formula: { skillMin: 4.6 } });
  });

  it('aceita a cruz no alvo (Explosion) e a recusa centrada no lançador', () => {
    const explosion = {
      ...suddenDeath, id: 'explosion-rune', damageType: 'physical',
      effect: { ...suddenDeath.effect, damageType: 'physical', area: { shape: 'cross', radius: 1 } },
    };
    expect(buildContent(base({ supplies: [explosion] })).supplies.get('explosion-rune')?.effect)
      .toMatchObject({ area: { shape: 'cross', radius: 1 } });
    // Runa é lançada NUM alvo: uma forma que sai do lançador não é representável e o schema
    // recusa — o erro é de forma, não chega ao boot.
    const caster = {
      ...explosion,
      effect: { ...explosion.effect, area: { shape: 'circle', radius: 1, centered: 'caster' } },
    };
    expect(() => buildContent(base({ supplies: [caster] }))).toThrow();
  });

  it('recusa dano sem mecanismo nenhum (sem basePower e sem formula)', () => {
    const none = {
      ...suddenDeath,
      effect: { kind: 'damage', range: 8, damageType: 'death' },
    };
    expect(() => buildContent(base({ supplies: [none] })))
      .toThrow(/supply\/sudden-death-rune: dano precisa de basePower ou formula/);
  });
});

describe('condições e campos declarativos (CMB-07, #334)', () => {
  const dot = { kind: 'damage-over-time', amount: 5, intervalMs: 1_000, damageType: 'earth' };
  const condition = { key: 'poison', merge: 'strongest', durationMs: 4_000, effect: dot };
  const field = {
    id: 'fire', durationMs: 5_000,
    shape: { shape: 'circle', radius: 1, centered: 'target' },
    condition: { key: 'fire', merge: 'refresh', durationMs: 5_000, effect: dot },
  };

  it('a condição e o campo da ability chegam COMPILADOS ao sim, sem arte', () => {
    const ability = { id: 'venom', cadenceMs: 1_000, power: 1, condition, field };
    const content = buildContent(base({ monsters: [{ ...rat, abilities: [ability] }] }));
    const compiled = content.monsters.get('rat')?.abilities[0];
    expect(compiled?.condition).toEqual(condition);
    expect(compiled?.field).toEqual(field);
    // Nunca um caminho de arte no campo ou na condição (invariante 6).
    expect(JSON.stringify(compiled?.field)).not.toMatch(/appearance|outfit|sprite|path/i);
  });

  it('recusa campo com forma que o monstro não deixa — `wave` sai da direção do lançador', () => {
    const wave = { ...field, shape: { shape: 'wave', length: 2 } };
    expect(() => buildContent(base({
      monsters: [{ ...rat, abilities: [{ id: 'w', cadenceMs: 1_000, power: 1, field: wave }] }],
    }))).toThrow(/círculo/);
  });

  it('recusa condição fora do vocabulário e efeito malformado', () => {
    expect(() => buildContent(base({
      monsters: [{ ...rat, abilities: [{ id: 'v', cadenceMs: 1_000, power: 1, condition: { ...condition, merge: 'sometimes' } }] }],
    }))).toThrow(ContentError);
    expect(() => buildContent(base({
      monsters: [{
        ...rat,
        abilities: [{
          id: 'v', cadenceMs: 1_000, power: 1,
          condition: { ...condition, effect: { kind: 'damage-over-time', amount: -1, intervalMs: 1_000 } },
        }],
      }],
    }))).toThrow(ContentError);
  });

  it('a magia de dano ao longo do tempo monta; sem `range` é recusada', () => {
    const spell = {
      id: 'poison', name: 'Poison', manaCost: 5, cooldownMs: 1_000,
      effect: { kind: 'damage-over-time', amount: 10, intervalMs: 1_000, durationMs: 3_000, range: 3, damageType: 'earth' },
    };
    const content = buildContent(base({ spells: [spell] }));
    expect(content.spells.get('poison')?.effect.kind).toBe('damage-over-time');
    expect(() => buildContent(base({
      spells: [{
        ...spell,
        effect: { kind: 'damage-over-time', amount: 10, intervalMs: 1_000, durationMs: 3_000, damageType: 'earth' },
      }],
    }))).toThrow(ContentError);
  });
});
