// Decodificação de uma folha de sprites (FUN-17).
//
// Uma folha é `sprites-<hash>.bmp.lzma`, e o nome esconde duas camadas:
//
//   1. um container **CIP** de 32 bytes, e depois um stream **LZMA1 CRU** — sem o cabeçalho
//      "alone" que todo decoder de prateleira espera;
//   2. dentro dele, um **BMP de 32 bits** com os pixels em BGRA e magenta como transparência.
//
// O formato do container está documentado em `src/client/spriteappearances.cpp` de
// `opentibiabr/otclient` (MIT). Lemos de lá o FORMATO, não o código — ver `AGENTS.md` deste
// pacote e o ADR 0019.
//
// **Isto roda em Web Worker, nunca no thread principal.** O decoder LZMA em JS puro é pesado, e
// uma folha no thread da UI engasga a entrada no jogo (§13.1). Este módulo é puro de propósito:
// entra `Uint8Array`, sai `Uint8Array`, e quem o coloca num worker é `sheet-worker.ts`.

import { decompressSync } from 'lzma-web/decompress';

/** O cabeçalho CIP tem SEMPRE este tamanho, qualquer que seja o tamanho do arquivo. */
const CIP_HEADER_BYTES = 32;

/** A sequência que marca o fim do enchimento de zeros dentro do cabeçalho CIP. */
const CIP_MARKER = [0x70, 0x0a, 0xfa, 0x80, 0x24] as const;

/** Magenta é a cor de transparência do pacote (§13.1). */
const TRANSPARENT_R = 0xff;
const TRANSPARENT_G = 0x00;
const TRANSPARENT_B = 0xff;

export interface DecodedSheet {
  readonly width: number;
  readonly height: number;
  /** RGBA, pronto para `createImageBitmap` via `ImageData`. */
  readonly pixels: Uint8ClampedArray;
}

/**
 * Desembrulha o container CIP e devolve um stream LZMA no formato **alone**.
 *
 * A conversão é a ideia central deste arquivo. O CIP guarda `[props][dictSize LE32]` e depois
 * oito bytes de tamanho COMPRIMIDO; o alone guarda `[props][dictSize LE32]` e depois oito bytes
 * de tamanho DESCOMPRIMIDO. São os mesmos cinco primeiros bytes — então basta trocar os oito
 * finais por `0xFF` ("tamanho desconhecido") e qualquer decoder padrão lê o resto.
 *
 * A alternativa seria um decoder LZMA cru, que praticamente nenhuma biblioteca de navegador
 * expõe. Cinco bytes de cabeçalho sintetizado compram a escolha inteira de biblioteca.
 */
export function toAloneStream(file: Uint8Array): Uint8Array {
  if (file.length <= CIP_HEADER_BYTES) {
    throw new Error('folha: arquivo menor que o cabeçalho CIP');
  }

  // O enchimento de zeros vem primeiro, e o marcador diz onde ele acaba. Procurar o marcador em
  // vez de assumir uma posição fixa é o que faz isto funcionar para qualquer tamanho de arquivo
  // — o cabeçalho tem 32 bytes sempre, mas o tamanho codificado dentro dele varia.
  let at = 0;
  while (at < CIP_HEADER_BYTES && file[at] === 0x00) at++;
  for (const [offset, expected] of CIP_MARKER.entries()) {
    if (file[at + offset] !== expected) {
      throw new Error('folha: marcador do cabeçalho CIP não encontrado');
    }
  }

  // `[props][dictSize LE32]` começam logo depois do cabeçalho de 32 bytes. O que vem antes —
  // o tamanho em varint de 7 bits — não precisamos: o stream termina em marcador de fim.
  const properties = file.subarray(CIP_HEADER_BYTES, CIP_HEADER_BYTES + 5);
  if (properties.length < 5) throw new Error('folha: propriedades LZMA truncadas');
  // Os oito bytes seguintes são o tamanho comprimido do CIP, e o decoder não os quer.
  const stream = file.subarray(CIP_HEADER_BYTES + 5 + 8);
  if (stream.length === 0) throw new Error('folha: stream LZMA vazio');

  const alone = new Uint8Array(13 + stream.length);
  alone.set(properties, 0);
  // `0xFF` oito vezes é "tamanho desconhecido"; o fim vem pelo marcador do próprio stream.
  alone.fill(0xff, 5, 13);
  alone.set(stream, 13);
  return alone;
}

/**
 * Decodifica a folha inteira: CIP, LZMA, BMP e correção de cor.
 */
export function decodeSheet(file: Uint8Array): DecodedSheet {
  const raw = decompressSync(toAloneStream(file));
  // **A biblioteca decide entre `string` e `Uint8Array` por HEURÍSTICA** — "parece texto?" —, e
  // uma folha é binária. Normalizar aqui em vez de confiar nela é o que impede a heurística de
  // errar num pacote e devolver bytes mutilados, que na tela apareceria como sprite corrompido.
  const bytes = typeof raw === 'string'
    ? Uint8Array.from(raw, (character) => character.charCodeAt(0))
    : Uint8Array.from(raw);

  return fromBitmap(bytes);
}

/**
 * Lê o BMP de 32 bits que sai da descompressão.
 *
 * **O offset dos pixels vem do byte 10 do arquivo**, e não de uma constante: o cabeçalho DIB
 * tem tamanho variável, e assumir 54 lê o lugar errado num BMP com máscaras de cor — que é
 * exatamente o que o Windows escreve às vezes.
 *
 * **Mudou o que sai daqui? Suba `DECODED_FORMAT` em `cache.ts`.** O cache persistente guarda
 * este resultado, e o hash do arquivo não sabe que o decoder mudou.
 */
export function fromBitmap(bmp: Uint8Array): DecodedSheet {
  if (bmp.length < 54 || bmp[0] !== 0x42 || bmp[1] !== 0x4d) {
    throw new Error('folha: o conteúdo descomprimido não é um BMP');
  }
  const view = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength);
  const offset = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  // **O SINAL da altura diz a ordem das linhas.** Altura positiva — que é o que vem do pacote —
  // é BMP de BAIXO para cima: a primeira linha do arquivo é a ÚLTIMA da imagem. Altura negativa
  // é de cima para baixo. Ler o valor absoluto e ignorar o sinal espelha a folha inteira na
  // vertical, e o sintoma é traiçoeiro: chão e parede continuam parecendo chão e parede, mas
  // cada criatura sai de cabeça para baixo, no canto errado do quadro, e os quadros de
  // animação de um outfit passam a apontar para as linhas de OUTRO.
  const signedHeight = view.getInt32(22, true);
  const height = Math.abs(signedHeight);
  const bottomUp = signedHeight > 0;
  const bits = view.getUint16(28, true);
  if (bits !== 32) throw new Error(`folha: esperava BMP de 32 bits, veio de ${bits}`);

  const expected = width * height * 4;
  if (offset + expected > bmp.length) {
    throw new Error('folha: os pixels do BMP passam do fim do arquivo');
  }

  const stride = width * 4;
  const pixels = new Uint8ClampedArray(expected);
  for (let y = 0; y < height; y++) {
    const sourceRow = bottomUp ? height - 1 - y : y;
    const from = offset + sourceRow * stride;
    const to = y * stride;
    for (let x = 0; x < stride; x += 4) {
      // BGRA no arquivo, RGBA na tela: a troca é B↔R.
      const b = bmp[from + x] ?? 0;
      const g = bmp[from + x + 1] ?? 0;
      const r = bmp[from + x + 2] ?? 0;
      // **Magenta é transparência, e o alfa do arquivo é ignorado.** Há folha em que o alfa vem
      // 255 em todo pixel, inclusive nos que deveriam ser vazios — confiar nele desenharia um
      // retângulo magenta atrás de cada sprite.
      const clear = r === TRANSPARENT_R && g === TRANSPARENT_G && b === TRANSPARENT_B;
      pixels[to + x] = clear ? 0 : r;
      pixels[to + x + 1] = clear ? 0 : g;
      pixels[to + x + 2] = clear ? 0 : b;
      pixels[to + x + 3] = clear ? 0 : 0xff;
    }
  }

  return { width, height, pixels };
}
