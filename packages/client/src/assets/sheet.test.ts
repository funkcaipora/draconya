import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeSheet, fromBitmap, toAloneStream } from './sheet.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));

// LZMA DE VERDADE, gerado por `scripts/make-sheet-fixture.ts` com o `lzma` da linha de comando.
// Um mock de LZMA provaria exatamente nada: o que este arquivo existe para verificar é que
// desembrulhamos o container certo e alimentamos o decoder com bytes que ele entende.
const sheet = fixture('sheet.bmp.lzma');
const bitmap = fixture('sheet.bmp');
/** A mesma coisa numa folha de 1×1, cujo cabeçalho CIP tem enchimento de tamanho diferente. */
const tiny = fixture('tiny.bmp.lzma');

/** Onde o enchimento de zeros do cabeçalho CIP acaba. */
const markerOf = (file: Uint8Array): number => {
  let at = 0;
  while (file[at] === 0x00) at++;
  return at;
};

describe('toAloneStream — o container CIP (FUN-17)', () => {
  it('converte o cabeçalho CIP no cabeçalho alone, preservando props e dicionário', () => {
    const alone = toAloneStream(sheet);
    // Os cinco primeiros bytes são os mesmos nos dois formatos — é o que torna a conversão
    // possível sem um decoder LZMA cru.
    expect([...alone.subarray(0, 5)]).toEqual([...sheet.subarray(32, 37)]);
    // E os oito seguintes viram "tamanho desconhecido": o fim vem pelo marcador do stream.
    expect([...alone.subarray(5, 13)]).toEqual(Array.from({ length: 8 }, () => 0xff));
  });

  it('acha o marcador em qualquer posição dentro dos 32 bytes', () => {
    // O enchimento de zeros VARIA com quantos bytes o tamanho em varint de 7 bits ocupa.
    //
    // **Duas fixtures, e a segunda existe por causa de uma mutação sobrevivente.** Com uma só,
    // trocar a varredura por uma posição fixa (`at = 25`) passava em tudo — o teste afirmava
    // "qualquer posição" e via uma. A folha de 1×1 comprime para menos de 128 bytes, o tamanho
    // cabe em um byte, e o marcador anda um lugar.
    expect(markerOf(sheet)).not.toBe(markerOf(tiny));
    expect(decodeSheet(sheet).width).toBe(32);
    expect(decodeSheet(tiny).width).toBe(1);
  });

  it('recusa arquivo sem o marcador, em vez de decodificar lixo', () => {
    // 64 bytes de zero: o marcador nunca aparece. Sem esta recusa, o decoder receberia bytes
    // arbitrários como propriedades LZMA e devolveria pixels aleatórios sem erro nenhum.
    expect(() => toAloneStream(fixture('truncated.bmp.lzma')))
      .toThrow(/marcador do cabeçalho CIP/);
  });

  it('recusa arquivo menor que o próprio cabeçalho', () => {
    expect(() => toAloneStream(new Uint8Array(10))).toThrow(/menor que o cabeçalho CIP/);
  });

  it('recusa arquivo que acaba antes do stream', () => {
    expect(() => toAloneStream(sheet.subarray(0, 45))).toThrow(/stream LZMA vazio/);
  });
});

describe('decodeSheet — LZMA de verdade, ponta a ponta (FUN-17)', () => {
  it('descomprime a folha e devolve as dimensões do BMP', () => {
    const decoded = decodeSheet(sheet);
    expect(decoded.width).toBe(32);
    expect(decoded.height).toBe(32);
    expect(decoded.pixels).toHaveLength(32 * 32 * 4);
  });

  it('o resultado é IDÊNTICO ao BMP original, byte a byte nos pixels', () => {
    // A prova de que a descompressão está certa, e não só "não deu erro". `fromBitmap` sobre o
    // BMP cru e sobre o descomprimido têm que dar a mesma coisa.
    expect([...decodeSheet(sheet).pixels]).toEqual([...fromBitmap(bitmap).pixels]);
  });
});

describe('fromBitmap — BGRA, magenta e o offset (FUN-17)', () => {
  const decoded = fromBitmap(bitmap);

  it('troca B com R: o vermelho do arquivo sai vermelho, não azul', () => {
    // No BMP o pixel (0,0) é `00 00 FF FF` — BGRA, ou seja vermelho. Sem a troca ele sairia
    // azul, e o sintoma seria um jogo inteiro com as cores invertidas.
    expect([...decoded.pixels.subarray(0, 4)]).toEqual([0xff, 0x00, 0x00, 0xff]);
  });

  it('magenta vira TRANSPARENTE, e não um pixel magenta', () => {
    // O alfa do arquivo é 255 em todo pixel, inclusive nos vazios. Confiar nele desenharia um
    // retângulo magenta atrás de cada sprite.
    expect([...decoded.pixels.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
  });

  it('os outros pixels ficam opacos', () => {
    // Guarda contra o oposto do teste acima: uma comparação frouxa que zerasse tudo passaria
    // no de cima e apagaria a folha inteira.
    const at = (10 * 32 + 10) * 4;
    expect([...decoded.pixels.subarray(at, at + 4)]).toEqual([0x40, 10, 10, 0xff]);
  });

  it('lê o offset dos pixels do byte 10, e não de uma constante', () => {
    // Um BMP com máscaras de cor tem o DIB header maior que 40, e os pixels começam depois de
    // 54. Assumir 54 leria o cabeçalho como se fosse imagem.
    const deslocado = new Uint8Array(bitmap.length + 20);
    deslocado.set(bitmap.subarray(0, 54), 0);
    deslocado.set(bitmap.subarray(54), 74);
    new DataView(deslocado.buffer).setUint32(10, 74, true);
    expect([...fromBitmap(deslocado).pixels.subarray(0, 4)]).toEqual([0xff, 0x00, 0x00, 0xff]);
  });

  it('recusa o que não é BMP', () => {
    // Se o container mudar de versão e o conteúdo não for mais BMP, o erro precisa vir aqui —
    // e não como uma textura de lixo que ninguém liga ao arquivo.
    expect(() => fromBitmap(new Uint8Array(64))).toThrow(/não é um BMP/);
  });

  it('recusa BMP que não seja de 32 bits', () => {
    const oitoBits = Uint8Array.from(bitmap);
    new DataView(oitoBits.buffer).setUint16(28, 8, true);
    expect(() => fromBitmap(oitoBits)).toThrow(/esperava BMP de 32 bits, veio de 8/);
  });

  it('recusa BMP cujos pixels passam do fim do arquivo', () => {
    const mentiroso = Uint8Array.from(bitmap);
    new DataView(mentiroso.buffer).setInt32(18, 4096, true);
    expect(() => fromBitmap(mentiroso)).toThrow(/passam do fim/);
  });
});
