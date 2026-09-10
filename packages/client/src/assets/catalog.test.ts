import { describe, expect, it } from 'vitest';
import { positionInSheet, readCatalog, sheetFor, SPRITE_TYPES } from './catalog.js';

const sheet = (over: Record<string, unknown> = {}) => ({
  type: 'sprite', file: 'sprites-1.bmp.lzma',
  spritetype: 0, firstspriteid: 100, lastspriteid: 243, area: 64, ...over,
});

const catalog = (...entries: readonly unknown[]) => readCatalog([
  { type: 'appearances', file: 'appearances-abc.dat' },
  ...entries,
]);

describe('readCatalog (FUN-16)', () => {
  it('acha o arquivo de aparências e as folhas', () => {
    const read = catalog(sheet(), { type: 'staticdata', file: 'staticdata.dat' });
    expect(read.appearancesFile).toBe('appearances-abc.dat');
    expect(read.sheets).toHaveLength(1);
    expect(read.sheets[0]).toMatchObject({
      file: 'sprites-1.bmp.lzma', width: 32, height: 32, columns: 12,
      firstSpriteId: 100, lastSpriteId: 243,
    });
  });

  it('ignora o que não é sprite nem aparência', () => {
    // `staticdata`, `map` e o que o pacote trouxer numa versão futura. Tentar interpretá-los
    // faria uma versão nova recusar carregar por causa de dado que o jogo nem desenha.
    const read = catalog(
      { type: 'staticdata', file: 'staticdata.dat' },
      { type: 'staticmapdata', file: 'map.dat' },
      { type: 'futuro-desconhecido', file: 'x.dat', campoNovo: 42 },
      sheet(),
    );
    expect(read.sheets).toHaveLength(1);
  });

  it('recusa índice sem entrada de aparências', () => {
    // Sem ela não há o que carregar, e seguir daria um jogo que sobe e desenha nada.
    expect(() => readCatalog([sheet()])).toThrow(/nenhuma entrada do tipo "appearances"/);
  });

  it('recusa folha sem faixa de ids, em vez de assumir uma', () => {
    expect(() => catalog(sheet({ firstspriteid: undefined })))
      .toThrow(/sem faixa de ids/);
    expect(() => catalog(sheet({ spritetype: undefined })))
      .toThrow(/sem faixa de ids ou spritetype/);
  });

  it('recusa spritetype desconhecido em vez de chutar 32×32', () => {
    // Chutar desenharia um quarto de cada sprite, e o sintoma na tela não apontaria o índice.
    expect(() => catalog(sheet({ spritetype: 9 }))).toThrow(/spritetype 9 desconhecido/);
  });

  it('recusa faixa invertida', () => {
    expect(() => catalog(sheet({ firstspriteid: 500, lastspriteid: 100 })))
      .toThrow(/faixa invertida/);
  });

  it('recusa duas folhas cobrindo o mesmo id', () => {
    // Faixas cruzadas fazem a resposta depender da ORDEM do arquivo: o sprite vem certo às
    // vezes, que é o pior formato de defeito para depurar.
    expect(() => catalog(
      sheet({ file: 'a', firstspriteid: 100, lastspriteid: 200 }),
      sheet({ file: 'b', firstspriteid: 150, lastspriteid: 300 }),
    )).toThrow(/"a" e "b" cobrem o mesmo id/);
  });

  it('ordena as folhas por id, mesmo com o arquivo fora de ordem', () => {
    // A busca binária de `sheetFor` depende disso, e um pacote não promete ordem nenhuma.
    const read = catalog(
      sheet({ file: 'c', firstspriteid: 500, lastspriteid: 599 }),
      sheet({ file: 'a', firstspriteid: 100, lastspriteid: 199 }),
      sheet({ file: 'b', firstspriteid: 200, lastspriteid: 299 }),
    );
    expect(read.sheets.map((s) => s.file)).toEqual(['a', 'b', 'c']);
  });

  it('cada spritetype tem a geometria da §13.1', () => {
    // 32×32 em 12 colunas, 32×64 em 12, 64×32 em 6, 64×64 em 6 — folha de 384 px de largura
    // nos quatro casos, que é o que permite localizar por aritmética em vez de medir a imagem.
    expect(SPRITE_TYPES.map((t) => t.width * t.columns)).toEqual([384, 384, 384, 384]);
  });
});

describe('sheetFor (FUN-16)', () => {
  const read = catalog(
    sheet({ file: 'a', firstspriteid: 100, lastspriteid: 199 }),
    sheet({ file: 'b', firstspriteid: 200, lastspriteid: 299 }),
    sheet({ file: 'c', firstspriteid: 300, lastspriteid: 399 }),
  );

  it('acha a folha de um id no meio, na borda de baixo e na de cima', () => {
    // As bordas são o defeito clássico deste tipo de busca, e a faixa é INCLUSIVA nos dois
    // lados: um `<` no lugar de `<=` perde exatamente um sprite por folha.
    expect(sheetFor(read, 250)?.file).toBe('b');
    expect(sheetFor(read, 200)?.file).toBe('b');
    expect(sheetFor(read, 299)?.file).toBe('b');
  });

  it('devolve null para id que nenhuma folha cobre', () => {
    // Antes da primeira, depois da última, e num buraco entre duas. Devolver a folha mais
    // próxima desenharia o sprite errado em vez de acusar o índice incompleto.
    expect(sheetFor(read, 99)).toBeNull();
    expect(sheetFor(read, 400)).toBeNull();
    expect(sheetFor(catalog(
      sheet({ file: 'a', firstspriteid: 100, lastspriteid: 199 }),
      sheet({ file: 'c', firstspriteid: 300, lastspriteid: 399 }),
    ), 250)).toBeNull();
  });

  it('acha em qualquer posição de um catálogo grande', () => {
    // Busca binária errada acerta o meio e erra as pontas. Mil folhas cobrem o caso.
    const many = readCatalog([
      { type: 'appearances', file: 'a.dat' },
      ...Array.from({ length: 1_000 }, (_, i) => sheet({
        file: `s${i}`, firstspriteid: i * 100, lastspriteid: i * 100 + 99,
      })),
    ]);
    for (const i of [0, 1, 499, 998, 999]) {
      expect(sheetFor(many, i * 100 + 50)?.file).toBe(`s${i}`);
    }
  });
});

describe('positionInSheet (FUN-16)', () => {
  const [folha] = catalog(sheet({ firstspriteid: 100, lastspriteid: 243 })).sheets;

  it('o primeiro id da folha fica na origem', () => {
    expect(positionInSheet(folha!, 100)).toEqual({ x: 0, y: 0 });
  });

  it('anda em coluna e quebra a linha na largura da folha', () => {
    // 12 colunas de 32 px: o índice 11 é o fim da primeira linha, o 12 abre a segunda.
    expect(positionInSheet(folha!, 111)).toEqual({ x: 11 * 32, y: 0 });
    expect(positionInSheet(folha!, 112)).toEqual({ x: 0, y: 32 });
    expect(positionInSheet(folha!, 113)).toEqual({ x: 32, y: 32 });
  });

  it('respeita a altura do spritetype, e não assume 32', () => {
    // 32×64 tem 12 colunas mas o dobro da altura: usar 32 aqui desenharia metade do sprite,
    // com a outra metade vindo do vizinho de baixo.
    const [alta] = catalog(sheet({ spritetype: 1, firstspriteid: 0, lastspriteid: 71 })).sheets;
    expect(alta?.height).toBe(64);
    expect(positionInSheet(alta!, 12)).toEqual({ x: 0, y: 64 });
  });

  it('devolve null para id que não é desta folha', () => {
    // Devolver (0,0) esconderia o erro de quem chamou desenhando o sprite errado.
    expect(positionInSheet(folha!, 99)).toBeNull();
    expect(positionInSheet(folha!, 244)).toBeNull();
  });
});
