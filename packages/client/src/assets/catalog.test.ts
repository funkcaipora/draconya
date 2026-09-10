import { describe, expect, it } from 'vitest';
import { CatalogError, readCatalog, sheetForSprite, thingsPath } from './catalog.js';

const sheet = (file: string, first: number, last: number, spritetype = 0) => ({
  type: 'sprite', file, spritetype, firstspriteid: first, lastspriteid: last, area: 64,
});

describe('readCatalog', () => {
  it('separa o arquivo de aparências das folhas de sprite', () => {
    const catalog = readCatalog([
      { type: 'appearances', file: 'appearances-abc123.dat' },
      sheet('sprites-1.bmp.lzma', 1, 100),
      { type: 'staticdata', file: 'staticdata-def.dat' },
    ]);

    expect(catalog.appearanceFile).toBe('appearances-abc123.dat');
    expect(catalog.sheets).toEqual([
      { file: 'sprites-1.bmp.lzma', spriteType: 0, firstSpriteId: 1, lastSpriteId: 100 },
    ]);
  });

  it('ordena as folhas por faixa, sem confiar na ordem do arquivo', () => {
    // O catálogo já costuma vir ordenado. Depender disso é depender de um arquivo que não é
    // nosso — e a busca binária de `sheetForSprite` devolveria a folha errada em silêncio.
    const catalog = readCatalog([
      sheet('c.lzma', 201, 300), sheet('a.lzma', 1, 100), sheet('b.lzma', 101, 200),
    ]);

    expect(catalog.sheets.map((s) => s.file)).toEqual(['a.lzma', 'b.lzma', 'c.lzma']);
  });

  it('ignora entrada de tipo desconhecido em vez de recusar o catálogo', () => {
    // O catálogo ganha tipos novos entre versões do pacote. Derrubar o carregamento por causa
    // de um tipo que não se desenha transformaria uma adição inofensiva em cliente que não abre.
    const catalog = readCatalog([
      { type: 'quefuturamenteexistira', file: 'x', campoNovo: 42 },
      sheet('a.lzma', 1, 10),
    ]);

    expect(catalog.sheets).toHaveLength(1);
  });

  it('descarta folha com faixa invertida', () => {
    // Entrada corrompida. Aceitá-la envenenaria a ordenação, e o defeito apareceria como
    // sprite trocado num id que nem é o dela.
    expect(readCatalog([sheet('ruim.lzma', 200, 100), sheet('boa.lzma', 1, 10)]).sheets)
      .toEqual([{ file: 'boa.lzma', spriteType: 0, firstSpriteId: 1, lastSpriteId: 10 }]);
  });

  it('sem entrada de aparências, o campo é nulo', () => {
    expect(readCatalog([sheet('a.lzma', 1, 10)]).appearanceFile).toBeNull();
  });

  it('recusa o que não é um catálogo', () => {
    expect(() => readCatalog({ nao: 'e uma lista' })).toThrow(CatalogError);
    expect(() => readCatalog([{ semTipo: true }])).toThrow(CatalogError);
  });

  it('tipo CONHECIDO com dado inválido é erro, não entrada ignorada', () => {
    // Este é o par do teste de tipo desconhecido acima, e a distinção é a regra toda: uma
    // entrada `sprite` corrompida não pode escorregar para o ramo "não sei o que é isso" e
    // sumir. Uma folha que some é uma faixa inteira de ids sem dono, com todo sprite dela em
    // branco — e o catálogo carregou "com sucesso".
    expect(() => readCatalog([{ ...sheet('a.lzma', 1, 10), firstspriteid: -1 }]))
      .toThrow(CatalogError);
    expect(() => readCatalog([{ type: 'appearances' }])).toThrow(CatalogError);
  });

  it('a mensagem diz a posição e o tipo da entrada quebrada', () => {
    // As entradas não têm identificador próprio. Sem a posição, o relato é "o catálogo está
    // inválido" e quem for consertar abre um arquivo de duzentas linhas sem saber por onde.
    expect(() => readCatalog([sheet('a.lzma', 1, 10), { type: 'sprite', file: '' }]))
      .toThrow(/entrada 1 do tipo "sprite"/);
  });

  it('campo novo numa entrada conhecida não a invalida', () => {
    // O pacote ganha campos entre versões. Recusar por causa de um campo a mais seria o
    // mesmo defeito do tipo desconhecido, um nível abaixo.
    const catalog = readCatalog([{ ...sheet('a.lzma', 1, 10), campoQueAindaNaoExiste: 42 }]);
    expect(catalog.sheets).toHaveLength(1);
  });
});

describe('sheetForSprite', () => {
  const catalog = readCatalog([
    sheet('a.lzma', 1, 100),
    sheet('b.lzma', 101, 200),
    // Buraco de propósito: 201..299 não pertencem a folha nenhuma.
    sheet('c.lzma', 300, 400),
  ]);

  it('acha a folha que contém o id, inclusive nas bordas da faixa', () => {
    expect(sheetForSprite(catalog, 1)?.file).toBe('a.lzma');
    expect(sheetForSprite(catalog, 100)?.file).toBe('a.lzma');
    expect(sheetForSprite(catalog, 101)?.file).toBe('b.lzma');
    expect(sheetForSprite(catalog, 350)?.file).toBe('c.lzma');
  });

  it('id dentro de um buraco devolve nulo, e não a folha vizinha', () => {
    // Desenhar o sprite errado é pior que não desenhar: o segundo aparece como falta de arte,
    // o primeiro como um rato com cara de barril, e ninguém liga isso ao catálogo.
    expect(sheetForSprite(catalog, 250)).toBeNull();
  });

  it('id fora de tudo devolve nulo dos dois lados', () => {
    expect(sheetForSprite(catalog, 0)).toBeNull();
    expect(sheetForSprite(catalog, 9999)).toBeNull();
  });

  it('catálogo sem folha nenhuma não quebra a busca', () => {
    expect(sheetForSprite(readCatalog([]), 1)).toBeNull();
  });
});

describe('thingsPath', () => {
  it('põe a versão no caminho', () => {
    // Com caminho fixo, subir de versão do pacote invalida o cache do navegador e troca o
    // significado dos ids ao mesmo tempo — e os dois erros chegam juntos, como "sprite errado
    // depois do deploy". Com a versão no caminho, pacote novo é URL nova.
    expect(thingsPath(1332, 'catalog-content.json')).toBe('/things/1332/catalog-content.json');
    expect(thingsPath('1332', 'appearances-abc.dat')).toBe('/things/1332/appearances-abc.dat');
  });
});
