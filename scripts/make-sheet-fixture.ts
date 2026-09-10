// Gera as fixtures de folha de sprite para `packages/client/src/assets` (FUN-17).
//
// Elas são BINÁRIAS e versionadas, o que normalmente é o tipo de fixture que ninguém consegue
// ler. Aqui vale a exceção, e por uma razão específica: o que precisa ser provado é a decodição
// de LZMA DE VERDADE, e um mock de LZMA prova exatamente nada. Este script é o que devolve a
// legibilidade — a fixture é ilegível, mas a receita dela não é, e regerá-la é um comando.
//
//   pnpm tsx scripts/make-sheet-fixture.ts
//
// O formato de container é o do cliente do Tibia, documentado em `spriteappearances.cpp` de
// `opentibiabr/otclient` (MIT): 32 bytes de cabeçalho CIP, e depois um stream LZMA1 CRU — sem o
// header "alone" que todo decoder de prateleira espera.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'client', 'src', 'assets', 'fixtures');

/** 32×32 pixels: pequeno de propósito, para a fixture caber num repositório. */
const HEADER_BYTES = 54;

/**
 * Um BMP de 32 bits com um padrão que se confere olhando.
 *
 * Os pixels são BGRA no arquivo, que é a ordem do BMP — e trocar B com R é metade do que o
 * decodificador precisa acertar. A magenta (0xFF00FF) é a cor de transparência do pacote.
 */
function bitmap(width = 32, height = 32): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (x === 0 && y === 0) {
        // Vermelho puro no canto: se sair azul, a troca B↔R não aconteceu.
        pixels[at] = 0x00; pixels[at + 1] = 0x00; pixels[at + 2] = 0xff; pixels[at + 3] = 0xff;
      } else if (x === 1 && y === 0) {
        // Magenta: precisa virar transparente.
        pixels[at] = 0xff; pixels[at + 1] = 0x00; pixels[at + 2] = 0xff; pixels[at + 3] = 0xff;
      } else {
        pixels[at] = x; pixels[at + 1] = y; pixels[at + 2] = 0x40; pixels[at + 3] = 0xff;
      }
    }
  }

  const file = new Uint8Array(HEADER_BYTES + pixels.length);
  const view = new DataView(file.buffer);
  file[0] = 0x42; file[1] = 0x4d;                    // "BM"
  view.setUint32(2, file.length, true);              // tamanho do arquivo
  view.setUint32(10, HEADER_BYTES, true);            // OFFSET dos pixels — é o que o leitor lê
  view.setUint32(14, 40, true);                      // tamanho do DIB header
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);                       // planos
  view.setUint16(28, 32, true);                      // bits por pixel
  file.set(pixels, HEADER_BYTES);
  return file;
}

/** Varint de 7 bits, como o cabeçalho CIP codifica o tamanho. */
function sevenBit(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  do {
    const byte = rest % 128;
    rest = Math.floor(rest / 128);
    out.push(rest > 0 ? byte | 0x80 : byte);
  } while (rest > 0);
  return out;
}

/**
 * Envelopa um stream LZMA1 "alone" no container CIP.
 *
 * O alone traz `[props][dictSize LE32][tamanho LE64]`; o CIP traz `[props][dictSize LE32]` e
 * oito bytes de tamanho comprimido no lugar. É essa a única diferença entre os dois, e é o que
 * o leitor desfaz ao contrário.
 */
function cipWrap(alone: Uint8Array): Uint8Array {
  const props = alone.subarray(0, 5);        // lclppb + dictionary size
  const stream = alone.subarray(13);         // o alone tem 8 bytes de tamanho que o CIP não usa
  const size = sevenBit(props.length + 8 + stream.length);
  const marker = [0x70, 0x0a, 0xfa, 0x80, 0x24];
  // O cabeçalho tem SEMPRE 32 bytes; o que sobra vira zeros na frente.
  const pad = 32 - marker.length - size.length;
  if (pad < 0) throw new Error('cabeçalho CIP não cabe em 32 bytes');

  const out = new Uint8Array(32 + props.length + 8 + stream.length);
  out.set(marker, pad);
  out.set(size, pad + marker.length);
  out.set(props, 32);
  // Oito bytes de "cip compressed size", que o leitor pula sem interpretar.
  new DataView(out.buffer).setUint32(32 + props.length, stream.length, true);
  out.set(stream, 32 + props.length + 8);
  return out;
}

const compress = (bytes: Uint8Array): Uint8Array => new Uint8Array(
  // `lzma` da linha de comando, em formato alone. É LZMA de verdade — o ponto da fixture.
  execFileSync('lzma', ['--format=alone', '--stdout', '-6'], { input: Buffer.from(bytes), maxBuffer: 1 << 26 }),
);

const markerAt = (file: Uint8Array): number => {
  let at = 0;
  while (file[at] === 0x00) at++;
  return at;
};

const sheet = cipWrap(compress(bitmap()));
writeFileSync(join(OUT, 'sheet.bmp.lzma'), sheet);
writeFileSync(join(OUT, 'sheet.bmp'), bitmap());

// **A SEGUNDA fixture existe por causa de uma mutação sobrevivente.** O enchimento de zeros do
// cabeçalho CIP varia com quantos bytes o tamanho em varint de 7 bits ocupa — e com uma fixture
// só, fixar a posição do marcador em código passava em todos os testes. Uma folha de 1×1
// comprime para menos de 128 bytes, o tamanho cabe em UM byte, e o marcador anda um lugar.
const tiny = cipWrap(compress(bitmap(1, 1)));
writeFileSync(join(OUT, 'tiny.bmp.lzma'), tiny);
writeFileSync(join(OUT, 'tiny.bmp'), bitmap(1, 1));

// Um arquivo cujo cabeçalho CIP nunca fecha: prova que o leitor recusa em vez de varrer tudo.
writeFileSync(join(OUT, 'truncated.bmp.lzma'), new Uint8Array(64));

console.log(`sheet.bmp.lzma ${sheet.length} bytes, marcador em ${markerAt(sheet)}`);
console.log(`tiny.bmp.lzma  ${tiny.length} bytes, marcador em ${markerAt(tiny)}`);
if (markerAt(sheet) === markerAt(tiny)) {
  throw new Error('as duas fixtures têm o marcador na MESMA posição — a segunda não prova nada');
}
