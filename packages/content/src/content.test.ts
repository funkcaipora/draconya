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
  id: 'baseline', dodgeMultiplier: 0.5,
  armorEffectiveness: { melee: 1, magic: 0 }, minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 4, dodgeChance: 0.05 },
};

const stamina = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };

// A aparência é DERIVADA aqui (FUN-94): estes testes falam de loot, rota e referência cruzada,
// e escrever a tabela à mão em cada um faria trinta fixtures carregarem um dado que nenhuma
// delas usa. Quem exercita a tabela em si passa uma explícita — ver o bloco da FUN-94.
const base = (over: Partial<RawContent> = {}): RawContent => {
  const raw: RawContent = {
    monsters: [rat], hunts: [cellars], vocations: [knight],
    progression: [baseline], combat: [combat], stamina: [stamina],
    // O bot é o produto (invariante 11): sem `bot/baseline.json` o conteúdo não monta.
    bot: [{ id: 'baseline', vocabularyVersion: 1, categoryCooldownMs: 1000, advancedFromLevel: 50,
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
      stamina: [stamina],
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
      stamina: [stamina],
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
  const withDefault = (over: Record<string, unknown> = {}) => base({
    spells: [spell],
    bot: [{ id: 'baseline', vocabularyVersion: 1, categoryCooldownMs: 1000, advancedFromLevel: 50,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
      advancedOnly: { targetPolicies: ['lowest-hp'] },
      defaultConfig: config(over) }],
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

  it('e não pode usar recurso do bot avançado: o personagem nasce no level 1', () => {
    expect(() => buildContent(withDefault({
      targeting: { policy: 'lowest-hp', prioritize: [], ignore: [], posture: { kind: 'stand' } },
    }))).toThrow(/defaultConfig: usa recurso do bot avançado \(alvo "lowest-hp"\)/);
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
      weight: 50, attack: 24,
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
    id: 'health-potion', name: 'Poção de Vida', price: 45,
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
    id: 'baseline', pack: 'tibia-1332', monsters: { rat: 21 }, items: {}, ...over,
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
    const placeholder = placeholderAppearances({ spells: [heal], supplies: [potion] });
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
    slot: 'hand', weight: 50, attack: 24, requires: { level: 15 },
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
      id: 'cheese', name: 'Cheese', kind: 'other', weight: 4, stackable: true,
    };
    const anel = {
      id: 'time-ring', name: 'Time Ring', kind: 'ring', slot: 'finger',
      weight: 1, durationMs: 600_000,
    };
    const content = buildContent(base({ items: [queijo, anel] }));
    expect(content.items.get('cheese')?.stackable).toBe(true);
    // Declarado e ainda não consumido por ninguém — §21.3, e a mecânica é issue própria.
    expect(content.items.get('time-ring')?.durationMs).toBe(600_000);
  });
});

describe('a mochila, as duas mãos e a munição no catálogo (ADR 0026, #151)', () => {
  const espada = { id: 'sword', name: 'Sword', kind: 'weapon', slot: 'hand', weight: 10, attack: 10 };

  it('a mochila é container e se veste em `back`; as duas coisas andam juntas', () => {
    const mochila = { id: 'backpack', name: 'Backpack', kind: 'container', slot: 'back', weight: 18 };
    expect(buildContent(base({ items: [mochila] })).items.get('backpack')?.slot).toBe('back');
    // Container fora das costas, e costas sem container: os dois são conteúdo quebrado.
    expect(() => buildContent(base({ items: [{ ...mochila, slot: 'hand' }] }))).toThrow(/slot "back"/);
    expect(() => buildContent(base({ items: [{ ...espada, slot: 'back' }] }))).toThrow(/só container/);
  });

  it('`twoHanded` só em arma', () => {
    expect(buildContent(base({ items: [{ ...espada, twoHanded: true }] })).items.get('sword')?.twoHanded).toBe(true);
    expect(buildContent(base({ items: [espada] })).items.get('sword')?.twoHanded).toBe(false);
    const capacete = { id: 'helmet', name: 'Helmet', kind: 'armor', slot: 'head', weight: 1, twoHanded: true };
    expect(() => buildContent(base({ items: [capacete] }))).toThrow(/twoHanded/);
  });

  it('munição é catálogo próprio, com aparência conferida dos DOIS lados', () => {
    const flecha = { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 0 };
    const content = buildContent(base({ ammunition: [flecha] }));
    expect(content.ammunition.get('arrow')?.appearanceId).toBeGreaterThan(0);
    // Sem linha na tabela é erro, como item; linha órfã também.
    const raw = base({ ammunition: [flecha] });
    const semLinha = { ...raw, appearances: [{ ...placeholderAppearances(raw), ammunition: {} }] };
    expect(() => buildContent(semLinha)).toThrow(/munição "arrow" não tem aparência/);
    const orfa = {
      ...raw,
      appearances: [{
        ...placeholderAppearances(raw),
        ammunition: { arrow: { icon: 1, missile: 1 }, bolt: { icon: 2, missile: 2 } },
      }],
    };
    expect(() => buildContent(orfa)).toThrow(/appearances.ammunition mapeia munição "bolt"/);
    // Ícone E projétil, os dois obrigatórios (#152): tiro sem projétil é vida sumindo do nada.
    const semProjetil = { ...raw, appearances: [{ ...placeholderAppearances(raw), ammunition: { arrow: { icon: 1 } } }] };
    expect(() => buildContent(semProjetil)).toThrow(ContentError);
  });

  it('como a arma bate é da arma: corpo a corpo por padrão, distância exige família com munição, wand exige mana e faixa (#152)', () => {
    // Sem `weapon`, uma arma é corpo a corpo de alcance 1 — o que toda arma era.
    expect(buildContent(base({ items: [espada] })).items.get('sword')?.weapon).toEqual({ kind: 'melee', range: 1 });
    const flecha = { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 0 };
    const arco = { id: 'bow', name: 'Bow', kind: 'weapon', slot: 'hand', weight: 31, twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' } };
    expect(buildContent(base({ items: [arco], ammunition: [flecha] })).items.get('bow')?.weapon?.range).toBe(6);
    // Distância sem família, e família sem munição no catálogo, são as duas formas de um bow que
    // não atira nada.
    expect(() => buildContent(base({ items: [{ ...arco, weapon: { kind: 'distance', range: 6 } }], ammunition: [flecha] }))).toThrow(/precisa de "ammoFamily"/);
    expect(() => buildContent(base({ items: [arco] }))).toThrow(/não tem munição no catálogo/);
    const varinha = { id: 'wand', name: 'Wand', kind: 'weapon', slot: 'hand', weight: 19, weapon: { kind: 'wand', range: 3, manaPerHit: 2, damage: { min: 8, max: 18 } } };
    expect(buildContent(base({ items: [varinha] })).items.get('wand')?.weapon?.manaPerHit).toBe(2);
    expect(() => buildContent(base({ items: [{ ...varinha, weapon: { kind: 'wand', range: 3 } }] }))).toThrow(/precisa de "manaPerHit" e "damage"/);
    expect(() => buildContent(base({ items: [{ ...varinha, weapon: { kind: 'wand', range: 3, manaPerHit: 2, damage: { min: 18, max: 8 } } }] }))).toThrow(/damage.min maior/);
    // Campo de um tipo em arma de outro, e `weapon` fora de arma: conteúdo quebrado.
    expect(() => buildContent(base({ items: [{ ...espada, weapon: { kind: 'melee', range: 1, manaPerHit: 2 } }] }))).toThrow(/só wand/);
    expect(() => buildContent(base({ items: [{ ...espada, weapon: { kind: 'melee', range: 1, ammoFamily: 'arrow' } }] }))).toThrow(/só arma de distância/);
    const capacete = { id: 'helmet', name: 'Helmet', kind: 'armor', slot: 'head', weight: 1, weapon: { kind: 'melee', range: 1 } };
    expect(() => buildContent(base({ items: [capacete] }))).toThrow(/só faz sentido em arma/);
  });

  it('o projétil da wand fica em appearances.weapons, de um lado só: arma muda é válida, linha órfã não (#152)', () => {
    const varinha = { id: 'wand', name: 'Wand', kind: 'weapon', slot: 'hand', weight: 19, weapon: { kind: 'wand', range: 3, manaPerHit: 2, damage: { min: 8, max: 18 } } };
    const raw = base({ items: [varinha] });
    expect(buildContent(raw).appearances?.weapons).toEqual({});
    const comProjetil = { ...raw, appearances: [{ ...placeholderAppearances(raw), weapons: { wand: { missile: 5 } } }] };
    expect(buildContent(comProjetil).appearances?.weapons['wand']?.missile).toBe(5);
    const orfa = { ...raw, appearances: [{ ...placeholderAppearances(raw), weapons: { helmet: { missile: 5 } } }] };
    expect(() => buildContent(orfa)).toThrow(/appearances.weapons mapeia "helmet"/);
  });

  it('toda família de munição precisa da grátis — é o que o bow dispara quando o gold acaba', () => {
    const paga = { id: 'onyx-arrow', name: 'Onyx Arrow', family: 'arrow', attack: 38, price: 7 };
    expect(() => buildContent(base({ ammunition: [paga] }))).toThrow(/não tem munição grátis/);
    const gratis = { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 0 };
    expect(buildContent(base({ ammunition: [paga, gratis] })).ammunition.size).toBe(2);
  });

  it('a aparência NÃO mora na munição: escrevê-la ali é recusado', () => {
    const comAparencia = { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 0, appearanceId: 3447 };
    expect(() => buildContent(base({ ammunition: [comAparencia] }))).toThrow(ContentError);
  });
});

describe('loot de item, agora que existe catálogo (FUN-76)', () => {
  const espada = {
    id: 'spike-sword', name: 'Spike Sword', kind: 'weapon',
    slot: 'hand', weight: 50, attack: 24,
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
