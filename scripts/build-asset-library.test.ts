import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { appearance, appearances, frameGroup } from '../packages/client/src/assets/testing.js';
import {
  buildAssetLibrary,
  buildLegacySpriteLibrary,
  encodePng,
  toCipAloneStream,
} from './build-asset-library.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('asset library CIP wrapper', () => {
  it('preserves LZMA properties, replaces the encoded size and skips the CIP size', () => {
    const file = new Uint8Array(49);
    file.set([0x70, 0x0a, 1, 2, 3], 22);
    file.set([0x5d, 0, 0, 0, 2], 32);
    file.set([9, 8, 7, 6], 45);

    const alone = toCipAloneStream(file);
    expect([...alone.subarray(0, 5)]).toEqual([0x5d, 0, 0, 0, 2]);
    expect([...alone.subarray(5, 13)]).toEqual(Array(8).fill(0xff));
    expect([...alone.subarray(13)]).toEqual([9, 8, 7, 6]);
  });

  it('rejects an unrelated binary', () => {
    expect(() => toCipAloneStream(new Uint8Array(64))).toThrow(/marker/);
  });
});

describe('asset library PNG encoder', () => {
  it('writes lossless RGBA scanlines', () => {
    const png = encodePng(2, 1, Uint8Array.of(255, 0, 0, 255, 0, 0, 0, 0));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const idatLength = new DataView(png.buffer, png.byteOffset + 33, 4).getUint32(0);
    const compressed = png.subarray(41, 41 + idatLength);
    expect([...inflateSync(compressed)]).toEqual([0, 255, 0, 0, 255, 0, 0, 0, 0]);
  });

  it('rejects buffers whose dimensions do not match', () => {
    expect(() => encodePng(2, 2, new Uint8Array(4))).toThrow(/dimensions/);
  });
});

describe('asset library build', () => {
  it('indexes appearances and extracts every available sprite', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'draconya-asset-library-test-'));
    const source = join(temp, 'source');
    const output = join(temp, 'output');
    try {
      mkdirSync(source);
      writeFileSync(join(source, 'catalog-content.json'), JSON.stringify([
        { type: 'appearances', file: 'appearances-test.dat' },
        {
          type: 'sprite', file: 'sprites-test.bmp.lzma', spritetype: 0,
          firstspriteid: 0, lastspriteid: 0,
        },
      ]));
      writeFileSync(join(source, 'appearances-test.dat'), appearances({
        object: [appearance({ id: 100, frameGroups: [frameGroup({ spriteIds: [0] })] })],
      }));
      copyFileSync(
        join(ROOT, 'packages/client/src/assets/fixtures/sheet.bmp.lzma'),
        join(source, 'sprites-test.bmp.lzma'),
      );

      const manifest = await buildAssetLibrary({ sourceDir: source, outputDir: output, version: 'test' });
      expect(manifest.completeness).toMatchObject({
        complete: true, sheetCount: 1, availableSheetCount: 1, availableSpriteCount: 1,
      });
      expect(readFileSync(join(output, 'appearances/object.jsonl'), 'utf8'))
        .toContain('"id":100');
      expect(readFileSync(join(output, 'sprites/000/000000.png')).subarray(0, 8))
        .toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('indexes a complete legacy DatSpr archive into atlas coordinates', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'draconya-legacy-asset-library-test-'));
    const source = join(temp, 'source');
    const output = join(temp, 'output');
    try {
      mkdirSync(source);
      const sprites = Buffer.alloc(29);
      sprites.writeUInt32LE(0x57bbd603, 0);
      sprites.writeUInt32LE(2, 4);
      sprites.writeUInt32LE(0, 8);
      sprites.writeUInt32LE(16, 12);
      sprites.set([255, 0, 255], 16);
      sprites.writeUInt16LE(8, 19);
      sprites.writeUInt16LE(0, 21);
      sprites.writeUInt16LE(1, 23);
      sprites.set([10, 20, 30, 255], 25);
      writeFileSync(join(source, 'Tibia.spr'), sprites);
      const metadata = Buffer.alloc(12);
      metadata.writeUInt16LE(100, 4);
      metadata.writeUInt16LE(20, 6);
      metadata.writeUInt16LE(10, 8);
      metadata.writeUInt16LE(5, 10);
      writeFileSync(join(source, 'Tibia.dat'), metadata);
      writeFileSync(join(source, 'Tibia.otfi'), 'DatSpr\n  transparency: true\n');

      const manifest = await buildLegacySpriteLibrary({
        sourceDir: source,
        outputDir: output,
        version: 'legacy-test',
      });
      expect(manifest.completeness).toEqual({
        complete: true,
        sheetCount: 1,
        availableSheetCount: 1,
        missingSheetCount: 0,
        spriteCount: 2,
        availableSpriteCount: 1,
      });
      expect(manifest.appearances).toEqual({ object: 100, outfit: 20, effect: 10, missile: 5 });
      expect(readFileSync(join(output, 'sprites.jsonl'), 'utf8'))
        .toContain('"id":1,"atlas":"atlases/000000-000001.png","x":32');
      expect(readFileSync(join(output, 'atlases/000000-000001.png')).subarray(0, 8))
        .toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
