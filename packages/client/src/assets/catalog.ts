// Leitor de `catalog-content.json` — o índice do pacote de assets (FUN-16).
//
// O catálogo é uma LISTA de entradas heterogêneas, cada uma com um `type`. As duas que
// importam para desenhar:
//
//   { "type": "appearances", "file": "appearances-<hash>.dat" }
//   { "type": "sprite", "file": "sprites-<hash>.bmp.lzma",
//     "spritetype": 0, "firstspriteid": 100, "lastspriteid": 200, "area": 64 }
//
// Entrada de `type` desconhecido é **ignorada**, não recusada: o catálogo ganha tipos novos
// entre versões do pacote, e derrubar o carregamento por causa de um tipo que não se desenha
// transformaria uma adição inofensiva em cliente que não abre.
//
// Isto é o oposto do que `content` faz, e de propósito: lá, dado inválido derruba o boot
// (invariante: conteúdo inválido nunca chega à simulação), porque o dado é NOSSO e um erro de
// digitação vira bug de balanceamento. Aqui o arquivo é de terceiro e só governa pixel.

import { z } from 'zod';

/** Uma folha de sprites e a faixa de ids que ela contém. */
export interface SpriteSheet {
  readonly file: string;
  /** Formato do sprite na folha. O tamanho em pixels é assunto do fatiador (FUN-18). */
  readonly spriteType: number;
  readonly firstSpriteId: number;
  readonly lastSpriteId: number;
}

export interface Catalog {
  /** O `.dat` de aparências deste pacote. `null` se o catálogo não declarar nenhum. */
  readonly appearanceFile: string | null;
  /** Folhas ordenadas por `firstSpriteId`, para a busca binária de `sheetForSprite`. */
  readonly sheets: readonly SpriteSheet[];
}

const spriteEntry = z.object({
  file: z.string().min(1),
  spritetype: z.number().int().nonnegative(),
  firstspriteid: z.number().int().nonnegative(),
  lastspriteid: z.number().int().nonnegative(),
});

const appearancesEntry = z.object({
  file: z.string().min(1),
});

/**
 * A forma mínima de uma entrada: um `type`, e o que mais vier.
 *
 * A validação acontece em DUAS etapas, e a ordem é a regra desta issue: primeiro descobre-se o
 * `type`, depois valida-se conforme ele. Uma união simples faria uma entrada `sprite` com campo
 * corrompido escorregar para o ramo "tipo desconhecido" e sumir em silêncio — e uma folha que
 * some é uma faixa inteira de ids sem dono, com todo sprite dela em branco e nada explicando.
 *
 * Tipo desconhecido é ignorado; tipo conhecido com dado inválido é ERRO.
 */
const entrySchema = z.looseObject({ type: z.string() });
const catalogSchema = z.array(entrySchema);

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

/**
 * Valida e monta o catálogo. Lança `CatalogError` quando o JSON não é sequer uma lista de
 * entradas com `type` — aí não é um catálogo, e seguir produziria um cliente sem arte nenhuma
 * e sem explicação.
 */
export function readCatalog(raw: unknown): Catalog {
  const parsed = catalogSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CatalogError(
      `catalog-content.json inválido: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }

  let appearanceFile: string | null = null;
  const sheets: SpriteSheet[] = [];

  for (const [position, entry] of parsed.data.entries()) {
    if (entry.type === 'appearances') {
      appearanceFile = demand(appearancesEntry, entry, position).file;
      continue;
    }
    // Tipo que não se desenha — inclusive um que ainda não existe. Segue o baile.
    if (entry.type !== 'sprite') continue;

    const sheet = demand(spriteEntry, entry, position);
    // Faixa invertida é entrada corrompida, e aceitá-la envenenaria a ordenação: o defeito
    // apareceria como sprite trocado num id que nem é o dela.
    if (sheet.lastspriteid < sheet.firstspriteid) continue;
    sheets.push({
      file: sheet.file,
      spriteType: sheet.spritetype,
      firstSpriteId: sheet.firstspriteid,
      lastSpriteId: sheet.lastspriteid,
    });
  }

  // Ordenar aqui, uma vez, é o que permite a busca binária depois. O catálogo já costuma vir
  // ordenado, e depender disso seria depender de um arquivo que não é nosso.
  sheets.sort((a, b) => a.firstSpriteId - b.firstSpriteId);
  return { appearanceFile, sheets };
}

/**
 * Valida uma entrada de tipo CONHECIDO, ou lança dizendo qual é e onde está.
 *
 * A posição entra na mensagem porque as entradas não têm identificador próprio: sem ela, o
 * relato é "o catálogo está inválido" e quem for consertar abre um arquivo de duzentas linhas
 * sem saber por onde começar.
 */
function demand<T>(schema: z.ZodType<T>, entry: { type: string }, position: number): T {
  const parsed = schema.safeParse(entry);
  if (parsed.success) return parsed.data;
  throw new CatalogError(
    `catalog-content.json: entrada ${position} do tipo "${entry.type}" é inválida — ` +
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
  );
}

/**
 * Qual folha contém este id de sprite, ou `null`.
 *
 * O id de sprite é **global entre todas as folhas** — é assim que um `frameGroup` o referencia
 * —, então achar a folha é achar a faixa. Busca binária porque isto roda por sprite desenhado:
 * varrer ~200 folhas por quadro é o tipo de custo que só aparece com o mapa cheio.
 *
 * As faixas podem ter buracos, e um id dentro de um buraco devolve `null` em vez da folha
 * vizinha — desenhar o sprite errado é pior que não desenhar.
 */
export function sheetForSprite(catalog: Catalog, spriteId: number): SpriteSheet | null {
  const { sheets } = catalog;
  let low = 0;
  let high = sheets.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const sheet = sheets[middle] as SpriteSheet;
    if (spriteId < sheet.firstSpriteId) high = middle - 1;
    else if (spriteId > sheet.lastSpriteId) low = middle + 1;
    else return sheet;
  }
  return null;
}

/**
 * O caminho de um arquivo do pacote, com a VERSÃO dentro.
 *
 * Versionado desde a primeira linha de código de propósito: com caminho fixo, subir de versão
 * do pacote invalida o cache do navegador e troca o significado dos ids ao mesmo tempo — e os
 * dois erros aparecem juntos, como "sprite errado depois do deploy". Com a versão no caminho,
 * pacote novo é URL nova, e o cache antigo simplesmente deixa de ser consultado.
 */
export function thingsPath(version: string | number, file: string): string {
  return `/things/${version}/${file}`;
}
