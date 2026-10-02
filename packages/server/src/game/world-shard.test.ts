import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import { BOT_VOCABULARY_VERSION_V1, localToAbsolute } from '@draconya/content';
import type { Content } from '@draconya/content';
import { CharacterRuntime, WorldRuleset, statsForLevel } from '@draconya/sim';
import type { HuntRuleset, Session } from '@draconya/sim';
import { testContent } from '../testing/content.js';
import type { InitialCharacter } from '../tickets.js';
import {
  CityShard, DEFAULT_WORLD_ID, WorldFullError, WorldShard, characterFromTicket, createCitySessionFactory,
  createSessionBuilder, createSessionWiring, createWorldSessionFactory,
} from './sessions.js';
import { HuntEntryUnavailableError } from './rest-entry.js';

// O `WorldShard` (#839, OW-18) sobre o conteúdo REAL — a Thais importada do OTBM e o `main.json` —, pelo
// mesmo `loadContent` do boot: o templo absoluto (32369, 32241, 7) é o tile local (94, 88, 7), e é nele que
// o login cai. O que se prende aqui é o que o shard promete: UMA sessão por `world_id`, descartada quando
// vazia, com o teto valendo só na entrada do repouso — e a flag `OPEN_WORLD` escolhendo, na costura, entre
// a Cidade de sempre e o mundo.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => (cached ??= loadContent(DATA));

const TEMPLE = { x: 94, y: 88, z: 7 };

/** O personagem como a sessão o recebe do ticket do `api`: o que o login produz. */
const fromTicket = (id: string, initial: Partial<InitialCharacter> = {}): CharacterRuntime =>
  characterFromTicket(real(), id, { level: 1, xp: 0, townId: 'thais', ...initial }, () => 0);

const hero = (id: string): CharacterRuntime => {
  const stats = statsForLevel(1, null, real().progression);
  return new CharacterRuntime({
    id, position: { x: 0, y: 0, z: 7 },
    health: stats.maxHealth, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
    level: 1, xp: 0, vocationId: null, gold: 0, goldDelta: 0, alive: true, cooldowns: {},
  });
};

const rulesetOf = (session: Session): WorldRuleset => {
  if (!(session.ruleset instanceof WorldRuleset)) throw new Error('a sessão não é um mundo');
  return session.ruleset;
};

describe('o WorldShard (#839, OW-18): uma sessão por mundo, descartada quando vazia', () => {
  it('o primeiro a chegar cria o mundo, e o segundo entra na MESMA sessão', () => {
    const shard = new WorldShard(real());
    const first = shard.admit(DEFAULT_WORLD_ID, fromTicket('a'), 'rest');
    const second = shard.admit(DEFAULT_WORLD_ID, fromTicket('b'), 'rest');

    // Mutação que mata: uma sessão por personagem (a Cidade antes da FUN-71) ou uma cópia nova a cada
    // chegada — o mundo é UM, e dois personagens nunca o dividiriam.
    expect(second).toBe(first);
    expect(first.ruleset.type).toBe('world');
    expect(first.participants.map((participant) => participant.id)).toEqual(['a', 'b']);
    expect(shard.populationOf(DEFAULT_WORLD_ID)).toBe(2);
    expect(shard.population).toBe(2);
    expect(shard.worlds).toBe(1);
    expect(shard.sessionOf(DEFAULT_WORLD_ID)).toBe(first);
  });

  it('o login cai no templo — o tile local (94, 88, 7), em PZ — quando o ticket não traz posição', () => {
    const shard = new WorldShard(real());
    const arrival = fromTicket('a');
    shard.admit(DEFAULT_WORLD_ID, arrival, 'rest');
    expect(arrival.position).toEqual(TEMPLE);
  });

  it('o login cai na posição SALVA quando o ticket a traz (a coordenada absoluta do Tibia)', () => {
    const shard = new WorldShard(real());
    const map = real().maps.get('thais');
    if (map === undefined) throw new Error('sem thais');
    // Dez tiles ao sul do templo, na rua.
    const saved = { x: 94, y: 97, z: 7 };
    const absolute = localToAbsolute(map, saved);
    if (absolute === undefined) throw new Error('fora do recorte');
    const arrival = fromTicket('a', { worldPosition: absolute });

    shard.admit(DEFAULT_WORLD_ID, arrival, 'rest');

    expect(arrival.position).toEqual(saved);
  });

  it('dois personagens com a MESMA posição salva não ocupam o mesmo tile', () => {
    const shard = new WorldShard(real());
    const map = real().maps.get('thais');
    if (map === undefined) throw new Error('sem thais');
    const absolute = localToAbsolute(map, { x: 94, y: 97, z: 7 });
    const a = fromTicket('a', { worldPosition: absolute as never });
    const b = fromTicket('b', { worldPosition: absolute as never });
    shard.admit(DEFAULT_WORLD_ID, a, 'rest');
    shard.admit(DEFAULT_WORLD_ID, b, 'rest');
    // O tile é exclusivo (ADR 0023): o segundo cai no livre mais próximo a pé.
    expect(b.position).not.toEqual(a.position);
  });

  it('o mundo VAZIO é esquecido, e a próxima entrada cria outro — com id novo, para o ledger não colidir', () => {
    const shard = new WorldShard(real());
    const alone = fromTicket('a');
    const first = shard.admit(DEFAULT_WORLD_ID, alone, 'rest');
    first.leave('a', 'manual-exit');
    expect(shard.populationOf(DEFAULT_WORLD_ID)).toBe(0);
    expect(shard.worlds).toBe(0);
    expect(shard.sessionOf(DEFAULT_WORLD_ID)).toBeUndefined();

    const second = shard.admit(DEFAULT_WORLD_ID, fromTicket('b'), 'rest');

    // Mutação que mata: reaproveitar a sessão vazia — ela atravessaria os deploys na versão de conteúdo do
    // primeiro (invariante 7) e reusaria o `session_id` de extratos já gravados, e o ledger é
    // `UNIQUE (session_id, seq)` (invariante 10).
    expect(second).not.toBe(first);
    expect(second.id).not.toBe(first.id);
    expect(second.contentVersion).toBe(real().version);
    expect(shard.worlds).toBe(1);
  });

  it('o mundo é criado com o relógio do nó, a versão de conteúdo congelada e a 10 Hz com ou sem ninguém olhando', () => {
    const shard = new WorldShard(real(), () => 1_234);
    const session = shard.admit(DEFAULT_WORLD_ID, fromTicket('a'), 'rest');
    expect(session.createdAtMs).toBe(1_234);
    expect(session.contentVersion).toBe(real().version);
    expect(session.currentHz()).toBe(10);
    expect(session.ended).toBeNull();
  });

  it('o personagem que NASCE do ticket traz as condições no relógio de zero, e o mundo que já andou as recebe no dele', () => {
    const shard = new WorldShard(real());
    const first = shard.admit(DEFAULT_WORLD_ID, fromTicket('a'), 'rest');
    first.advanceBy(120_000); // o mundo anda há dois minutos quando o segundo chega
    const arrival = fromTicket('b', { conditions: [{ key: 'haste', expiresAtMs: 8_000, speedPercent: 30 }] });

    shard.admit(DEFAULT_WORLD_ID, arrival, 'rest');

    // Mutação que mata: omitir `carryRestoredConditions` — a condição, no relógio de zero, já teria vencido
    // há dois minutos no relógio desta sessão, e `armConditions` a apagaria na entrada.
    const haste = arrival.conditions.getState().find((condition) => condition.key === 'haste');
    expect(haste?.expiresAtMs).toBe(first.nowMs + 8_000);
  });
});

describe('o teto vale só na entrada do repouso (ADR 0060 d.2b)', () => {
  it('o mundo cheio recusa quem vem do REPOUSO, com o mundo e o teto no erro', () => {
    const shard = new WorldShard(real(), undefined, { capacity: 2 });
    shard.admit(DEFAULT_WORLD_ID, fromTicket('a'), 'rest');
    shard.admit(DEFAULT_WORLD_ID, fromTicket('b'), 'rest');
    expect(shard.isFull(DEFAULT_WORLD_ID)).toBe(true);

    const refused = fromTicket('c');
    expect(() => shard.admit(DEFAULT_WORLD_ID, refused, 'rest')).toThrow(WorldFullError);
    try {
      shard.admit(DEFAULT_WORLD_ID, refused, 'rest');
    } catch (error) {
      expect(error).toMatchObject({ worldId: DEFAULT_WORLD_ID, capacity: 2 });
    }
    // A recusa não deixa rastro: o personagem não entrou, e o mundo continua com dois.
    expect(shard.populationOf(DEFAULT_WORLD_ID)).toBe(2);
    expect(rulesetOf(shard.sessionOf(DEFAULT_WORLD_ID) as Session).type).toBe('world');
    expect((shard.sessionOf(DEFAULT_WORLD_ID) as Session).participants.some((p) => p.id === 'c')).toBe(false);
  });

  it('quem volta de uma INSTÂNCIA entra sempre, mesmo com o mundo cheio', () => {
    const shard = new WorldShard(real(), undefined, { capacity: 2 });
    shard.admit(DEFAULT_WORLD_ID, fromTicket('a'), 'rest');
    shard.admit(DEFAULT_WORLD_ID, fromTicket('b'), 'rest');

    // Mutação que mata: aplicar o teto a toda entrada — quem já estava no mundo antes de sair para a hunt
    // ficaria sem sessão ao voltar, preso numa instância encerrada.
    const back = shard.admit(DEFAULT_WORLD_ID, hero('c'), 'instance');

    expect(back.participants.map((participant) => participant.id)).toEqual(['a', 'b', 'c']);
    expect(shard.populationOf(DEFAULT_WORLD_ID)).toBe(3);
    // E o mundo, acima do teto, segue recusando o repouso.
    expect(() => shard.admit(DEFAULT_WORLD_ID, fromTicket('d'), 'rest')).toThrow(WorldFullError);
  });

  it('o teto padrão é o `capacity` do conteúdo do mundo (main.json: 200)', () => {
    const shard = new WorldShard(real());
    expect(real().worlds.get(DEFAULT_WORLD_ID)?.capacity).toBe(200);
    shard.admit(DEFAULT_WORLD_ID, fromTicket('a'), 'rest');
    expect(shard.isFull(DEFAULT_WORLD_ID)).toBe(false);
  });

  it('vaga que abre — alguém sai — deixa o próximo entrar', () => {
    const shard = new WorldShard(real(), undefined, { capacity: 1 });
    const session = shard.admit(DEFAULT_WORLD_ID, fromTicket('a'), 'rest');
    expect(() => shard.admit(DEFAULT_WORLD_ID, fromTicket('b'), 'rest')).toThrow(WorldFullError);
    // Um segundo personagem fica no mundo, para ele não esvaziar e ser esquecido.
    shard.admit(DEFAULT_WORLD_ID, hero('keeper'), 'instance');
    session.leave('a', 'manual-exit');
    session.leave('keeper', 'manual-exit');
    expect(shard.isFull(DEFAULT_WORLD_ID)).toBe(false);
    expect(shard.admit(DEFAULT_WORLD_ID, fromTicket('b'), 'rest').participants.map((p) => p.id)).toEqual(['b']);
  });

  it('`vacanciesOf` é o teto menos quem está no mundo — o número que a fila da OW-21 compara com a posição (#842)', () => {
    const shard = new WorldShard(real(), undefined, { capacity: 3 });
    // Mundo sem sessão: o teto inteiro. Mundo que o conteúdo não tem: nenhuma vaga.
    expect(shard.vacanciesOf(DEFAULT_WORLD_ID)).toBe(3);
    expect(shard.vacanciesOf('nao-existe')).toBe(0);

    const session = shard.admit(DEFAULT_WORLD_ID, fromTicket('a'), 'rest');
    shard.admit(DEFAULT_WORLD_ID, fromTicket('b'), 'rest');
    expect(shard.vacanciesOf(DEFAULT_WORLD_ID)).toBe(1);

    // Quem volta de uma instância passa do teto, e a conta não fica negativa: o mundo cheio tem ZERO vaga,
    // não menos um — a fila compara posição com vaga, e uma vaga negativa admitiria o contrário.
    shard.admit(DEFAULT_WORLD_ID, hero('c'), 'instance');
    shard.admit(DEFAULT_WORLD_ID, hero('d'), 'instance');
    expect(shard.populationOf(DEFAULT_WORLD_ID)).toBe(4);
    expect(shard.vacanciesOf(DEFAULT_WORLD_ID)).toBe(0);

    // E sai ao ritmo de quem sai: abaixo do teto a vaga reaparece.
    session.leave('a', 'manual-exit');
    session.leave('b', 'manual-exit');
    session.leave('c', 'manual-exit');
    expect(shard.vacanciesOf(DEFAULT_WORLD_ID)).toBe(2);
  });

  it('um teto que não é inteiro positivo é recusado na construção', () => {
    for (const capacity of [0, -1, 1.5, Number.NaN]) {
      expect(() => new WorldShard(real(), undefined, { capacity })).toThrow(/capacity/);
    }
  });
});

describe('o mundo que o conteúdo não tem', () => {
  it('um `world_id` desconhecido é recusado com o id no erro, sem criar sessão', () => {
    const shard = new WorldShard(real());
    expect(() => shard.admit('inexistente', fromTicket('a'), 'rest')).toThrow(/unknown world "inexistente"/);
    expect(shard.worlds).toBe(0);
  });

  it('o nó com `OPEN_WORLD` e conteúdo SEM o mundo padrão não sobe — recusa na construção, não no primeiro ticket', () => {
    const noWorlds = testContent();
    expect(noWorlds.worlds.size).toBe(0);
    expect(() => new WorldShard(noWorlds)).toThrow(/OPEN_WORLD needs the world "main"/);
    expect(() => createSessionWiring(noWorlds, undefined, { openWorld: true })).toThrow(/OPEN_WORLD needs the world/);
    // E sem a flag o mesmo conteúdo monta como sempre.
    expect(() => createSessionWiring(noWorlds, undefined, { openWorld: false })).not.toThrow();
  });
});

describe('a costura de sessões do nó e a flag OPEN_WORLD (#839)', () => {
  it('com a flag DESLIGADA — o default — o login cai na Cidade e o mundo não existe', () => {
    const wiring = createSessionWiring(real(), () => 0);
    expect(wiring.worldShard).toBeUndefined();
    const session = wiring.createSession('a', { level: 1, xp: 0 });
    expect(session.ruleset.type).toBe('city');
    // `to: 'world'` não tem destino: o host recusa a transição (`unknown-destination`). E o mesmo
    // construtor constrói o resto (a hunt), para o `null` não ser só "personagem não achado".
    expect(wiring.buildSession({ to: 'world' }, session, 'a')).toBeNull();
    expect(wiring.buildSession({ to: 'hunt', huntId: 'rat-cellars' }, session, 'a')?.ruleset.type).toBe('hunt');
  });

  it('com a flag LIGADA o login cai no MUNDO, e o segundo login entra na mesma sessão', () => {
    const wiring = createSessionWiring(real(), () => 0, { openWorld: true });
    const first = wiring.createSession('a', { level: 1, xp: 0, townId: 'thais' });
    const second = wiring.createSession('b', { level: 1, xp: 0, townId: 'thais' });

    expect(first.ruleset.type).toBe('world');
    expect(second).toBe(first);
    expect(first.participants.map((participant) => participant.id)).toEqual(['a', 'b']);
    expect(first.participants[0]?.position).toEqual(TEMPLE);
    expect(wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(2);
  });

  it('o ticket de PARTY continua nascendo HUNT com a flag ligada: a party é uma instância', () => {
    const wiring = createSessionWiring(real(), () => 0, { openWorld: true });
    const session = wiring.createSession('a', { level: 1, xp: 0 }, {
      sessionId: 's-party', leaderId: 'a', shareCosts: true, splitLoot: true,
      huntId: 'rat-cellars', difficulty: 'cautious',
      members: [
        { characterId: 'a', accountId: 'acc-a', initialCharacter: { level: 1, xp: 0 } },
        { characterId: 'b', accountId: 'acc-b', initialCharacter: { level: 1, xp: 0 } },
      ],
    });
    expect(session.ruleset.type).toBe('hunt');
    expect(session.id).toBe('s-party');
    expect(session.participants.map((participant) => participant.id)).toEqual(['a', 'b']);
    // Nenhum mundo foi criado por causa dele.
    expect(wiring.worldShard?.worlds).toBe(0);
  });

  it('o MESMO mundo nos dois caminhos: quem volta de uma hunt chega onde o login chegou', () => {
    const wiring = createSessionWiring(real(), () => 0, { openWorld: true });
    const world = wiring.createSession('a', { level: 1, xp: 0, townId: 'thais' });
    wiring.createSession('b', { level: 1, xp: 0, townId: 'thais' });

    // `b` vai caçar: o destino é construído pelo MESMO builder (a âncora de saída é do host).
    const hunt = wiring.buildSession({ to: 'hunt', huntId: 'rat-cellars' }, world, 'b');
    expect(hunt?.ruleset.type).toBe('hunt');
    world.leave('b', 'manual-exit');

    // E volta: `to: 'world'` devolve a sessão em que `a` ficou, e não um mundo novo.
    const back = wiring.buildSession({ to: 'world' }, hunt as Session, 'b');
    expect(back).toBe(world);
    expect(back?.participants.map((participant) => participant.id)).toEqual(['a', 'b']);
  });

  it('o mundo não sucede a si mesmo: de um mundo para o mundo não há destino', () => {
    const wiring = createSessionWiring(real(), () => 0, { openWorld: true });
    const world = wiring.createSession('a', { level: 1, xp: 0, townId: 'thais' });
    // O host já recusa `same-state` antes de construir; esta é a segunda linha.
    expect(wiring.buildSession({ to: 'world' }, world, 'a')).toBeNull();
  });

  it('a volta de uma instância ignora o teto, e o login do repouso o respeita', () => {
    const wiring = createSessionWiring(real(), () => 0, { openWorld: true, worldShard: { capacity: 1 } });
    const world = wiring.createSession('a', { level: 1, xp: 0, townId: 'thais' });
    // Mundo cheio (teto 1): o repouso é recusado...
    expect(() => wiring.createSession('c', { level: 1, xp: 0, townId: 'thais' })).toThrow(WorldFullError);

    // ...e quem vem de uma hunt entra do mesmo jeito. `b` estava no mundo antes de caçar (aqui: numa
    // Cidade que a flag ainda deixa existir, de onde o builder o leva à hunt e de volta).
    const city = wiring.cityShard.admit(fromTicket('b'), true);
    const hunt = wiring.buildSession({ to: 'hunt', huntId: 'rat-cellars' }, city, 'b');
    const back = wiring.buildSession({ to: 'world' }, hunt as Session, 'b');
    expect(back).toBe(world);
    expect(back?.participants.map((participant) => participant.id)).toEqual(['a', 'b']);
  });

  it('o shard da Cidade segue como era, ao lado do mundo: o mesmo `CityShard` nos dois caminhos', () => {
    const wiring = createSessionWiring(real(), () => 0, { openWorld: true });
    expect(wiring.cityShard).toBeInstanceOf(CityShard);
    const world = wiring.createSession('a', { level: 1, xp: 0, townId: 'thais' });
    const hunt = wiring.buildSession({ to: 'hunt', huntId: 'rat-cellars' }, world, 'a');
    world.leave('a', 'manual-exit');
    // O CONSTRUTOR ainda sabe levar à Cidade (a volta atrás da flag, ADR 0060 d.3a): a cópia é a do shard do nó. Com a
    // flag ligada quem decide o destino do fim de uma hunt é o hospedeiro (OW-20), e ele nunca pede a Cidade.
    const city = wiring.buildSession({ to: 'city' }, hunt as Session, 'a');
    expect(city?.ruleset.type).toBe('city');
    expect(wiring.cityShard.population).toBe(1);
  });
});

describe('as fábricas soltas seguem como sempre, sem o shard do mundo', () => {
  it('createCitySessionFactory e createSessionBuilder não conhecem o mundo', () => {
    const content = testContent();
    const session = createCitySessionFactory(content)('a', { level: 1, xp: 0 });
    expect(session.ruleset.type).toBe('city');
    expect(createSessionBuilder(content)({ to: 'world' }, session, 'a')).toBeNull();
  });

  it('createWorldSessionFactory leva o mundo pedido: um `world_id` que não existe é recusado', () => {
    const factory = createWorldSessionFactory(real(), () => 0, new WorldShard(real()), 'inexistente');
    expect(() => factory('a', { level: 1, xp: 0 })).toThrow(/unknown world/);
  });
});

describe('a hunt idle como PRIMEIRA sessão do personagem (#842, OW-21, ADR 0060 d.6b)', () => {
  const ENTRY = { hunt: 'rat-cellars' } as const;
  const login = { level: 1, xp: 0, townId: 'thais' } as const;
  const huntRuleset = (session: Session) => session.ruleset as HuntRuleset;

  it('com `OPEN_WORLD` o `entry: { hunt }` cria a HUNT como primeira sessão — e o mundo nem nasce', () => {
    const wiring = createSessionWiring(real(), () => 0, { openWorld: true });

    const session = wiring.createSession('a', login, undefined, ENTRY);

    // Criação, não transição (invariante 8): o personagem está em exatamente uma sessão, a hunt, sem ter
    // passado por sessão nenhuma antes. Mutação que mata: criar o mundo e transicionar para a hunt.
    expect(session.ruleset.type).toBe('hunt');
    expect(huntRuleset(session).huntId).toBe('rat-cellars');
    expect(session.participants.map((participant) => participant.id)).toEqual(['a']);
    expect(wiring.worldShard?.worlds).toBe(0);
    expect(wiring.cityShard.population).toBe(0);
  });

  it('o mundo CHEIO não alcança quem vai direto para a hunt: é o que mantém a base econômica acessível', () => {
    const wiring = createSessionWiring(real(), () => 0, { openWorld: true, worldShard: { capacity: 1 } });
    wiring.createSession('a', login);
    expect(() => wiring.createSession('b', login)).toThrow(WorldFullError);

    const hunt = wiring.createSession('b', login, undefined, ENTRY);

    expect(hunt.ruleset.type).toBe('hunt');
    expect(wiring.worldShard?.populationOf(DEFAULT_WORLD_ID)).toBe(1);
  });

  it('a âncora do mundo atravessa a hunt: o personagem volta ao tile onde saiu, não ao templo', () => {
    const map = real().maps.get('thais');
    if (map === undefined) throw new Error('sem thais');
    const anchor = localToAbsolute(map, { x: 94, y: 97, z: 7 });
    if (anchor === undefined) throw new Error('fora do recorte');
    const wiring = createSessionWiring(real(), () => 0, { openWorld: true });

    const session = wiring.createSession('a', { ...login, worldPosition: anchor }, undefined, ENTRY);

    // `worldPosition` é o que o extrato leva de volta ao banco (OW-15) e o que a volta ao mundo usa (OW-20):
    // a hunt não a toca, e quem entrou nela do login sai dela no mesmo lugar em que deslogou.
    expect(session.participants[0]?.worldPosition).toEqual(anchor);
  });

  it('o bot do ticket entra COMPILADO na hunt, e um que o vocabulário recusa não derruba a entrada', () => {
    const wiring = createSessionWiring(real(), () => 0, { openWorld: true });
    const valid = { version: BOT_VOCABULARY_VERSION_V1, heal: [], potion: [], attack: [], rune: [], support: [] };

    const withBot = wiring.createSession('a', { ...login, botConfig: valid }, undefined, ENTRY);
    const withTornBot = wiring.createSession('b', { ...login, botConfig: { version: 999 } }, undefined, ENTRY);

    // Mutação que mata: criar a hunt sem a configuração do ticket — as regras de saída e a barra de ações
    // do personagem sairiam da mesma configuração, e a hunt direta rodaria sem elas.
    expect(huntRuleset(withBot).getState().runners?.['a']?.botConfig).toBeDefined();
    expect(huntRuleset(withTornBot).getState().runners?.['b']?.botConfig).toBeUndefined();
    expect(withTornBot.ruleset.type).toBe('hunt');
  });

  it('uma hunt que não existe é recusada com `HuntEntryUnavailableError`, sem cair no mundo no lugar dela', () => {
    const wiring = createSessionWiring(real(), () => 0, { openWorld: true });

    expect(() => wiring.createSession('a', login, undefined, { hunt: 'nao-existe' }))
      .toThrow(HuntEntryUnavailableError);
    // Quem pediu a hunt idle e recebe o mundo cheio de gente sem ter pedido é pior que uma recusa que se explica.
    expect(wiring.worldShard?.worlds).toBe(0);
  });

  it('o ticket de PARTY vence a entrada: a party é uma instância, e a hunt dela já é a primeira sessão', () => {
    const wiring = createSessionWiring(real(), () => 0, { openWorld: true });
    const session = wiring.createSession('a', login, {
      sessionId: 's-party', leaderId: 'a', shareCosts: true, splitLoot: true,
      huntId: 'rat-cellars', difficulty: 'cautious',
      members: [
        { characterId: 'a', accountId: 'acc-a', initialCharacter: { level: 1, xp: 0 } },
        { characterId: 'b', accountId: 'acc-b', initialCharacter: { level: 1, xp: 0 } },
      ],
    }, { hunt: 'rat-cellars' });
    expect(session.id).toBe('s-party');
  });

  it('com a flag DESLIGADA a fábrica da Cidade IGNORA a entrada: o repouso é a Cidade, e a hunt se escolhe no menu', () => {
    // O portão do plano: sem `OPEN_WORLD` o jogo é o de hoje, byte a byte. Mutação que mata: honrar `entry`
    // na fábrica da Cidade.
    const wiring = createSessionWiring(real(), () => 0);
    const session = wiring.createSession('a', { level: 1, xp: 0 }, undefined, ENTRY);
    expect(session.ruleset.type).toBe('city');
    expect(wiring.worldEntry).toBeUndefined();
  });
});
