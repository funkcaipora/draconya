import { describe, expect, it } from 'vitest';
import { packHas, packProblems } from './pack.js';
import { packSchema } from './schemas.js';
import type { Appearances, Pack } from './schemas.js';

const SHA = 'a'.repeat(64);

const pack: Pack = packSchema.parse({
  id: 'tibia-test', version: 'test', appearancesSha256: SHA,
  object: [[100, 167], [169, 370], [1100, 1989]],
  outfit: [[1, 134], [136, 160]],
  effect: [[1, 80]],
  missile: [[1, 42], [44, 45]],
});

const table = (over: Partial<Appearances> = {}): Appearances => ({
  id: 'baseline', pack: 'tibia-test',
  monsters: {}, items: {}, maps: {}, spells: {}, supplies: {}, hits: {},
  ...over,
});

describe('packHas', () => {
  it('encontra os dois extremos de cada faixa, e não o buraco entre elas', () => {
    // O buraco é o caso que a busca binária erra por um: 168 está entre [100,167] e [169,370].
    expect(packHas(pack, 'object', 100)).toBe(true);
    expect(packHas(pack, 'object', 167)).toBe(true);
    expect(packHas(pack, 'object', 168)).toBe(false);
    expect(packHas(pack, 'object', 169)).toBe(true);
    expect(packHas(pack, 'object', 370)).toBe(true);
    expect(packHas(pack, 'object', 371)).toBe(false);
    expect(packHas(pack, 'object', 1989)).toBe(true);
  });

  it('não encontra abaixo da primeira faixa nem acima da última', () => {
    expect(packHas(pack, 'object', 99)).toBe(false);
    expect(packHas(pack, 'object', 1990)).toBe(false);
    expect(packHas(pack, 'outfit', 0)).toBe(false);
    expect(packHas(pack, 'outfit', 161)).toBe(false);
  });

  it('consulta o registro pedido, e não os outros: o outfit 21 não é o objeto 21', () => {
    expect(packHas(pack, 'outfit', 21)).toBe(true);
    expect(packHas(pack, 'object', 21)).toBe(false);
    expect(packHas(pack, 'missile', 43)).toBe(false);
    expect(packHas(pack, 'effect', 43)).toBe(true);
  });

  it('registro sem faixa nenhuma não tem id nenhum', () => {
    const empty: Pack = { ...pack, missile: [] };
    expect(packHas(empty, 'missile', 1)).toBe(false);
  });
});

describe('packProblems', () => {
  it('aceita a tabela cujos ids existem todos no pacote', () => {
    expect(packProblems(table({
      monsters: { rat: 21 }, characters: { default: 128 },
      items: { 'spike-sword': 1200 },
      maps: { cellars: { floor: 355, wall: { vertical: 1294, horizontal: 1295, corner: 1298, pole: 1296 } } },
      spells: { strike: { effect: 12, missile: 5 } },
      supplies: { potion: { effect: 14 } },
      hits: { melee: 1 },
    }), pack)).toEqual([]);
  });

  it('recusa o id que não está em faixa nenhuma, e a mensagem diz qual entrada e qual id', () => {
    expect(packProblems(table({ monsters: { rat: 135 } }), pack)).toEqual([
      'appearances.monsters.rat: outfit 135 não existe no pacote tibia-test',
    ]);
  });

  it('confere cada seção da tabela no registro certo — um efeito não é um objeto', () => {
    // Um por seção, todos fora do pacote, para a lista dizer de onde cada um veio.
    const problems = packProblems(table({
      monsters: { rat: 999 }, characters: { default: 999 },
      items: { sword: 168 },
      maps: { cellars: { floor: 99, wall: 371 } },
      spells: { strike: { effect: 81, missile: 43 } },
      supplies: { potion: { effect: 81 } },
      hits: { melee: 81 },
    }), pack);
    expect(problems).toEqual([
      'appearances.monsters.rat: outfit 999 não existe no pacote tibia-test',
      'appearances.characters.default: outfit 999 não existe no pacote tibia-test',
      'appearances.items.sword: object 168 não existe no pacote tibia-test',
      'appearances.maps.cellars.floor: object 99 não existe no pacote tibia-test',
      'appearances.maps.cellars.wall.vertical: object 371 não existe no pacote tibia-test',
      'appearances.maps.cellars.wall.horizontal: object 371 não existe no pacote tibia-test',
      'appearances.maps.cellars.wall.corner: object 371 não existe no pacote tibia-test',
      'appearances.maps.cellars.wall.pole: object 371 não existe no pacote tibia-test',
      'appearances.spells.strike.effect: effect 81 não existe no pacote tibia-test',
      'appearances.spells.strike.missile: missile 43 não existe no pacote tibia-test',
      'appearances.supplies.potion.effect: effect 81 não existe no pacote tibia-test',
      'appearances.hits.melee: effect 81 não existe no pacote tibia-test',
    ]);
  });

  it('confere as quatro peças da parede uma a uma, e diz qual peça', () => {
    const problems = packProblems(table({
      maps: { cellars: { floor: 355, wall: { vertical: 1294, horizontal: 1295, corner: 5000, pole: 1296 } } },
    }), pack);
    expect(problems).toEqual([
      'appearances.maps.cellars.wall.corner: object 5000 não existe no pacote tibia-test',
    ]);
  });

  it('magia sem efeito e sem projétil não é conferida: muda é válida', () => {
    expect(packProblems(table({ spells: { silent: {} } }), pack)).toEqual([]);
  });
});

describe('packSchema', () => {
  const valid = {
    id: 'tibia-test', version: 'test', appearancesSha256: SHA,
    object: [[1, 2]], outfit: [], effect: [], missile: [],
  };

  it('aceita faixas crescentes, inclusive a de um id só', () => {
    expect(packSchema.safeParse({ ...valid, object: [[1, 1], [3, 5]] }).success).toBe(true);
  });

  const messages = (input: unknown): string[] => {
    const parsed = packSchema.safeParse(input);
    return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
  };

  it('recusa faixa invertida, e diz qual', () => {
    expect(messages({ ...valid, object: [[5, 3]] }))
      .toEqual(['object.0 faixa invertida: o primeiro id passa do último']);
  });

  it('recusa faixas fora de ordem ou sobrepostas — a busca binária depende disso — e diz onde', () => {
    // O índice e as duas faixas na mensagem: num arquivo de 760 faixas, "sobrepostas" sem
    // dizer onde manda ler o arquivo inteiro.
    expect(messages({ ...valid, object: [[10, 20], [1, 5]] }))
      .toEqual(['object faixas fora de ordem ou sobrepostas em 1: [10,20] antes de [1,5]']);
    expect(messages({ ...valid, object: [[1, 5], [5, 9]] }))
      .toEqual(['object faixas fora de ordem ou sobrepostas em 1: [1,5] antes de [5,9]']);
    expect(messages({ ...valid, outfit: [[1, 5], [3, 9], [20, 30]] }))
      .toEqual(['outfit faixas fora de ordem ou sobrepostas em 1: [1,5] antes de [3,9]']);
  });

  it('faixas ENCOSTADAS são válidas, só não são o que o gerador escreve', () => {
    expect(packSchema.safeParse({ ...valid, object: [[1, 5], [6, 9]] }).success).toBe(true);
  });

  it('recusa um quinto registro: Zod o descartaria em silêncio', () => {
    expect(packSchema.safeParse({ ...valid, sprite: [[1, 2]] }).success).toBe(false);
  });

  it('exige o sha256 inteiro, em hexadecimal', () => {
    expect(packSchema.safeParse({ ...valid, appearancesSha256: 'abc' }).success).toBe(false);
    expect(packSchema.safeParse({ ...valid, appearancesSha256: 'G'.repeat(64) }).success).toBe(false);
  });

  it('um id é positivo — o zero não existe em registro nenhum do pacote', () => {
    expect(packSchema.safeParse({ ...valid, object: [[0, 2]] }).success).toBe(false);
  });
});
