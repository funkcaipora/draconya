// Leitor do `catalog-content.json`, o índice do pacote de assets (FUN-16).
//
// Ele responde duas perguntas, e só elas: qual arquivo tem as aparências, e **em qual folha
// mora um id de sprite**. A segunda é a que importa — o id de sprite que sai de
// `appearances.ts` é GLOBAL entre todas as folhas, e sem o índice não há como saber qual
// baixar.
//
// ```jsonc
// [
//   { "type": "appearances", "file": "appearances-abc.dat" },
//   { "type": "sprite", "file": "sprites-1.bmp.lzma",
//     "spritetype": 0, "firstspriteid": 100, "lastspriteid": 243, "area": 64 },
//   { "type": "staticdata", "file": "staticdata.dat" }
// ]
// ```
//
// **`area` é lido e ignorado de propósito.** O que ele significa não está verificado contra um
// pacote real — não temos um nesta máquina (FUN-65) —, e derivar geometria de um campo que
// ninguém conferiu seria pior que derivá-la de `spritetype`, que a §13.1 documenta. Quando um
// pacote de verdade aparecer, é o primeiro campo a conferir.

import { z } from 'zod';

/**
 * Geometria por `spritetype`, da §13.1 do `technical-architecture.md`.
 *
 * A largura da folha é sempre 384 px: 12 colunas de 32 ou 6 de 64. Isso é o que permite
 * localizar um sprite dentro da folha por aritmética, sem medir a imagem depois de baixá-la.
 */
export const SPRITE_TYPES = [
  { width: 32, height: 32, columns: 12 },
  { width: 32, height: 64, columns: 12 },
  { width: 64, height: 32, columns: 6 },
  { width: 64, height: 64, columns: 6 },
] as const;

export interface SpriteSheet {
  /** Nome do arquivo, relativo à pasta da versão. Nunca um caminho absoluto. */
  readonly file: string;
  readonly spriteType: number;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  /** Faixa INCLUSIVA de ids que esta folha contém. */
  readonly firstSpriteId: number;
  readonly lastSpriteId: number;
}

export interface Catalog {
  /** O `appearances-<hash>.dat`. */
  readonly appearancesFile: string;
  /** Ordenadas por `firstSpriteId`, que é o que a busca binária de `sheetFor` exige. */
  readonly sheets: readonly SpriteSheet[];
}

const entrySchema = z.looseObject({
  type: z.string(),
  file: z.string().min(1),
  spritetype: z.number().int().nonnegative().optional(),
  firstspriteid: z.number().int().nonnegative().optional(),
  lastspriteid: z.number().int().nonnegative().optional(),
});

/**
 * Lê o índice. Lança em qualquer problema, pela mesma razão que `buildContent` lança: um
 * catálogo pela metade vira sprite faltando na tela, longe da causa.
 */
export function readCatalog(json: unknown): Catalog {
  const entries = z.array(entrySchema).parse(json);

  const appearances = entries.find((entry) => entry.type === 'appearances');
  if (appearances === undefined) {
    throw new Error('catalog-content.json: nenhuma entrada do tipo "appearances"');
  }

  const sheets: SpriteSheet[] = [];
  for (const entry of entries) {
    // `staticdata`, `staticmapdata`, `map` e o que mais o pacote trouxer: não é sprite.
    if (entry.type !== 'sprite') continue;
    const { spritetype, firstspriteid, lastspriteid } = entry;
    if (spritetype === undefined || firstspriteid === undefined || lastspriteid === undefined) {
      throw new Error(`catalog-content.json: folha "${entry.file}" sem faixa de ids ou spritetype`);
    }
    const geometry = SPRITE_TYPES[spritetype];
    // Um `spritetype` que não conhecemos é pacote de outra versão. Adivinhar 32×32 desenharia
    // metade de cada sprite, e o sintoma na tela não apontaria para o índice.
    if (geometry === undefined) {
      throw new Error(`catalog-content.json: spritetype ${spritetype} desconhecido em "${entry.file}"`);
    }
    if (lastspriteid < firstspriteid) {
      throw new Error(`catalog-content.json: folha "${entry.file}" tem faixa invertida`);
    }
    sheets.push({
      file: entry.file, spriteType: spritetype, ...geometry,
      firstSpriteId: firstspriteid, lastSpriteId: lastspriteid,
    });
  }

  sheets.sort((a, b) => a.firstSpriteId - b.firstSpriteId);

  // Faixas que se cruzam tornam a resposta de `sheetFor` dependente da ORDEM do arquivo, e o
  // sintoma é um sprite certo que às vezes vem errado — o pior formato para depurar.
  for (let i = 1; i < sheets.length; i++) {
    const previous = sheets[i - 1];
    const current = sheets[i];
    if (previous === undefined || current === undefined) continue;
    if (current.firstSpriteId <= previous.lastSpriteId) {
      throw new Error(
        `catalog-content.json: "${previous.file}" e "${current.file}" cobrem o mesmo id`,
      );
    }
  }

  return { appearancesFile: appearances.file, sheets };
}

/**
 * Em qual folha mora este id, ou `null` se nenhuma o cobre.
 *
 * Busca binária porque um pacote real tem MILHARES de folhas, e isto é consultado uma vez por
 * sprite de cada aparência que entra em cena — varredura linear aqui vira o custo de carregar
 * uma tela.
 */
export function sheetFor(catalog: Catalog, spriteId: number): SpriteSheet | null {
  let low = 0;
  let high = catalog.sheets.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const sheet = catalog.sheets[middle];
    if (sheet === undefined) break;
    if (spriteId < sheet.firstSpriteId) high = middle - 1;
    else if (spriteId > sheet.lastSpriteId) low = middle + 1;
    else return sheet;
  }
  return null;
}

/**
 * Onde o sprite fica DENTRO da folha, em pixels.
 *
 * A conta é linha-a-linha a partir do primeiro id da folha. `null` quando o id não é desta
 * folha — chamar com o id errado é defeito de quem chamou, e devolver (0,0) esconderia isso
 * desenhando o sprite errado.
 */
export function positionInSheet(
  sheet: SpriteSheet, spriteId: number,
): { x: number; y: number } | null {
  if (spriteId < sheet.firstSpriteId || spriteId > sheet.lastSpriteId) return null;
  const index = spriteId - sheet.firstSpriteId;
  return {
    x: (index % sheet.columns) * sheet.width,
    y: Math.floor(index / sheet.columns) * sheet.height,
  };
}
