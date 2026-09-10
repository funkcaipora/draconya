// Gera uma biblioteca local, navegavel por ferramentas, a partir de um pacote de assets.
//
// Os binarios ficam sob `things/`, que e ignorado pelo Git. O que este script acrescenta e a
// organizacao: indices JSONL por tipo de aparencia, folhas em PNG, quadros por id e, quando
// fornecido, o conteudo do `graphics_resources.rcc.lzma` preservando a arvore do Qt.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { readAppearances } from '../packages/client/src/assets/appearances.js';
import type { Appearance, AppearanceKind } from '../packages/client/src/assets/appearances.js';
import { readCatalog } from '../packages/client/src/assets/catalog.js';
import type { Catalog, SpriteSheet } from '../packages/client/src/assets/catalog.js';
import { decodeSheet } from '../packages/client/src/assets/sheet.js';
import { cutOut } from '../packages/client/src/assets/sprites.js';

const execFileAsync = promisify(execFile);
const CATEGORIES = ['object', 'outfit', 'effect', 'missile'] as const;
const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const RCC_EXTRACTOR = 'github.com/pgaskin/qrc/cmd/qrc2zip@v0.0.2';

interface BuildOptions {
  readonly sourceDir: string;
  readonly outputDir: string;
  readonly version: string;
  readonly graphicsResources?: string;
}

interface SheetRecord extends SpriteSheet {
  readonly sourceAvailable: boolean;
  readonly png: string | null;
}

interface LibraryManifest {
  readonly schemaVersion: 1;
  readonly assetVersion: string;
  readonly format: 'modern-cip';
  readonly generatedAt: string;
  readonly source: {
    readonly catalog: string;
    readonly appearances: string;
    readonly graphicsResources: string | null;
  };
  readonly completeness: {
    readonly complete: boolean;
    readonly sheetCount: number;
    readonly availableSheetCount: number;
    readonly missingSheetCount: number;
    readonly spriteCount: number;
    readonly availableSpriteCount: number;
  };
  readonly appearances: Readonly<Record<AppearanceKind, number>>;
  readonly indexes: {
    readonly sheets: string;
    readonly missingSheets: string;
    readonly sprites: string;
    readonly appearances: Readonly<Record<AppearanceKind, string>>;
    readonly ui: string | null;
  };
}

interface LegacyLibraryManifest {
  readonly schemaVersion: 1;
  readonly assetVersion: string;
  readonly format: 'legacy-spr';
  readonly sourceSignature: string;
  readonly generatedAt: string;
  readonly source: {
    readonly sprites: string;
    readonly metadata: string | null;
    readonly otfi: string | null;
  };
  readonly completeness: {
    readonly complete: true;
    readonly sheetCount: number;
    readonly availableSheetCount: number;
    readonly missingSheetCount: 0;
    readonly spriteCount: number;
    readonly availableSpriteCount: number;
  };
  readonly appearances: {
    readonly object: number | null;
    readonly outfit: number | null;
    readonly effect: number | null;
    readonly missile: number | null;
  };
  readonly indexes: {
    readonly sheets: string;
    readonly missingSheets: null;
    readonly sprites: string;
    readonly appearances: null;
    readonly ui: null;
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonLines(path: string, values: Iterable<unknown>): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const stream = createWriteStream(path, { encoding: 'utf8' });
  for (const value of values) {
    if (!stream.write(`${JSON.stringify(value)}\n`)) {
      await new Promise<void>((accept) => stream.once('drain', accept));
    }
  }
  await new Promise<void>((accept, reject) => {
    stream.once('error', reject);
    stream.end(accept);
  });
}

/**
 * Converte o invólucro CIP usado nos recursos para LZMA "alone".
 *
 * O marcador completo varia entre tipos de recurso. A parte estável é o prefixo `70 0a`, o
 * cabeçalho de 32 bytes e os cinco bytes de propriedades LZMA que vêm logo depois dele.
 */
export function toCipAloneStream(file: Uint8Array): Uint8Array {
  const cipHeaderBytes = 32;
  if (file.length <= cipHeaderBytes + 13) {
    throw new Error('CIP resource is shorter than its header.');
  }
  let marker = 0;
  while (marker < cipHeaderBytes && file[marker] === 0) marker++;
  if (file[marker] !== 0x70 || file[marker + 1] !== 0x0a) {
    throw new Error('CIP resource marker was not found.');
  }
  const stream = file.subarray(cipHeaderBytes + 13);
  if (stream.length === 0) throw new Error('CIP resource has an empty LZMA stream.');
  const alone = new Uint8Array(13 + stream.length);
  alone.set(file.subarray(cipHeaderBytes, cipHeaderBytes + 5), 0);
  alone.fill(0xff, 5, 13);
  alone.set(stream, 13);
  return alone;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, entry) => {
  let crc = entry;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

/** Codifica RGBA sem perda em PNG, sem depender de bibliotecas nativas. */
export function encodePng(
  width: number,
  height: number,
  pixels: Uint8Array | Uint8ClampedArray,
  compressionLevel = 9,
): Uint8Array {
  if (width <= 0 || height <= 0 || pixels.length !== width * height * 4) {
    throw new Error('PNG dimensions do not match the RGBA buffer.');
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row++) {
    const target = row * (1 + width * 4);
    rows[target] = 0;
    rows.set(pixels.subarray(row * width * 4, (row + 1) * width * 4), target + 1);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows, { level: compressionLevel })),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

function readLegacyAppearanceCounts(metadataPath: string): LegacyLibraryManifest['appearances'] {
  if (!existsSync(metadataPath)) {
    return { object: null, outfit: null, effect: null, missile: null };
  }
  const metadata = readFileSync(metadataPath);
  if (metadata.length < 12) throw new Error(`Legacy metadata header is truncated: ${metadataPath}`);
  return {
    object: metadata.readUInt16LE(4),
    outfit: metadata.readUInt16LE(6),
    effect: metadata.readUInt16LE(8),
    missile: metadata.readUInt16LE(10),
  };
}

function legacyHasAlpha(otfiPath: string): boolean {
  if (!existsSync(otfiPath)) return false;
  return /^\s*transparency:\s*true\s*$/mu.test(readFileSync(otfiPath, 'utf8'));
}

function paintLegacySprite(
  source: Buffer,
  sourceOffset: number,
  destination: Uint8Array,
  destinationX: number,
  destinationY: number,
  destinationWidth: number,
  hasAlpha: boolean,
): boolean {
  if (sourceOffset === 0) return false;
  if (sourceOffset < 0 || sourceOffset + 5 > source.length) {
    throw new Error(`Legacy sprite offset ${sourceOffset} is outside Tibia.spr.`);
  }
  const encodedBytes = source.readUInt16LE(sourceOffset + 3);
  let cursor = sourceOffset + 5;
  const end = cursor + encodedBytes;
  if (end > source.length) throw new Error(`Legacy sprite at ${sourceOffset} is truncated.`);

  const colorBytes = hasAlpha ? 4 : 3;
  let pixel = 0;
  while (cursor < end && pixel < 32 * 32) {
    if (cursor + 4 > end) throw new Error(`Legacy sprite run at ${sourceOffset} is truncated.`);
    pixel += source.readUInt16LE(cursor);
    const coloredPixels = source.readUInt16LE(cursor + 2);
    cursor += 4;
    if (pixel + coloredPixels > 32 * 32 || cursor + coloredPixels * colorBytes > end) {
      throw new Error(`Legacy sprite run at ${sourceOffset} exceeds its bounds.`);
    }
    for (let index = 0; index < coloredPixels; index++, pixel++) {
      const x = destinationX + (pixel % 32);
      const y = destinationY + Math.floor(pixel / 32);
      const target = (y * destinationWidth + x) * 4;
      destination[target] = source[cursor] ?? 0;
      destination[target + 1] = source[cursor + 1] ?? 0;
      destination[target + 2] = source[cursor + 2] ?? 0;
      destination[target + 3] = hasAlpha ? (source[cursor + 3] ?? 0) : 255;
      cursor += colorBytes;
    }
  }
  return true;
}

/**
 * Organiza o formato DatSpr usado por clientes Open Tibia antigos em atlas PNG indexados.
 *
 * Uma página tem 4096 quadros (64 x 64). Isso preserva todos os ids sem criar centenas de
 * milhares de arquivos pequenos; `sprites.jsonl` fornece a coordenada exata de cada quadro.
 */
export async function buildLegacySpriteLibrary(
  options: BuildOptions,
): Promise<LegacyLibraryManifest> {
  const sourceDir = resolve(options.sourceDir);
  const outputDir = resolve(options.outputDir);
  const spritesPath = join(sourceDir, 'Tibia.spr');
  const metadataPath = join(sourceDir, 'Tibia.dat');
  const otfiPath = join(sourceDir, 'Tibia.otfi');
  if (!existsSync(spritesPath)) throw new Error(`Legacy sprites not found: ${spritesPath}`);

  const source = readFileSync(spritesPath);
  if (source.length < 8) throw new Error(`Legacy sprite header is truncated: ${spritesPath}`);
  const signature = source.readUInt32LE(0).toString(16).padStart(8, '0');
  const spriteCount = source.readUInt32LE(4);
  const tableEnd = 8 + spriteCount * 4;
  if (spriteCount === 0 || tableEnd > source.length) {
    throw new Error(`Legacy sprite offset table is invalid: ${spritesPath}`);
  }

  const atlasesDir = join(outputDir, 'atlases');
  rmSync(atlasesDir, { recursive: true, force: true });
  mkdirSync(atlasesDir, { recursive: true });
  const pageSize = 4096;
  const atlasColumns = 64;
  const atlasWidth = atlasColumns * 32;
  const atlasHeight = atlasColumns * 32;
  const pageCount = Math.ceil(spriteCount / pageSize);
  const hasAlpha = legacyHasAlpha(otfiPath);
  let availableSpriteCount = 0;
  const spriteRecords: unknown[] = [];
  const sheetRecords: unknown[] = [];

  for (let page = 0; page < pageCount; page++) {
    const firstSpriteId = page * pageSize;
    const lastSpriteId = Math.min(spriteCount - 1, firstSpriteId + pageSize - 1);
    const atlasName = `${String(firstSpriteId).padStart(6, '0')}-${String(lastSpriteId).padStart(6, '0')}.png`;
    const atlasPath = `atlases/${atlasName}`;
    const pixels = new Uint8Array(atlasWidth * atlasHeight * 4);

    for (let spriteId = firstSpriteId; spriteId <= lastSpriteId; spriteId++) {
      const offset = source.readUInt32LE(8 + spriteId * 4);
      const slot = spriteId - firstSpriteId;
      const x = (slot % atlasColumns) * 32;
      const y = Math.floor(slot / atlasColumns) * 32;
      const available = paintLegacySprite(source, offset, pixels, x, y, atlasWidth, hasAlpha);
      if (available) availableSpriteCount++;
      spriteRecords.push({ id: spriteId, atlas: atlasPath, x, y, width: 32, height: 32, available });
    }

    writeFileSync(join(outputDir, atlasPath), encodePng(atlasWidth, atlasHeight, pixels, 6));
    sheetRecords.push({ firstSpriteId, lastSpriteId, columns: atlasColumns, rows: atlasColumns, png: atlasPath });
    if ((page + 1) % 10 === 0 || page + 1 === pageCount) {
      console.log(`Decoded ${page + 1}/${pageCount} legacy sprite atlases.`);
    }
  }

  await writeJsonLines(join(outputDir, 'sheets.jsonl'), sheetRecords);
  await writeJsonLines(join(outputDir, 'sprites.jsonl'), spriteRecords);
  const manifest: LegacyLibraryManifest = {
    schemaVersion: 1,
    assetVersion: options.version,
    format: 'legacy-spr',
    sourceSignature: signature,
    generatedAt: new Date().toISOString(),
    source: {
      sprites: spritesPath,
      metadata: existsSync(metadataPath) ? metadataPath : null,
      otfi: existsSync(otfiPath) ? otfiPath : null,
    },
    completeness: {
      complete: true,
      sheetCount: pageCount,
      availableSheetCount: pageCount,
      missingSheetCount: 0,
      spriteCount,
      availableSpriteCount,
    },
    appearances: readLegacyAppearanceCounts(metadataPath),
    indexes: {
      sheets: 'sheets.jsonl',
      missingSheets: null,
      sprites: 'sprites.jsonl',
      appearances: null,
      ui: null,
    },
  };
  writeJson(join(outputDir, 'manifest.json'), manifest);
  writeFileSync(join(outputDir, 'README.md'), legacyLibraryReadme(manifest));
  return manifest;
}

function spritePath(spriteId: number): string {
  const id = String(spriteId).padStart(6, '0');
  return `sprites/${id.slice(0, 3)}/${id}.png`;
}

function appearanceRecord(appearance: Appearance): unknown {
  return {
    id: appearance.id,
    kind: appearance.kind,
    frameGroups: appearance.frameGroups,
  };
}

function sheetRecord(sourceDir: string, outputDir: string, sheet: SpriteSheet): SheetRecord {
  const available = existsSync(join(sourceDir, sheet.file));
  return {
    ...sheet,
    sourceAvailable: available,
    png: available
      ? relative(outputDir, join(outputDir, 'sheets', `${sheet.firstSpriteId}-${sheet.lastSpriteId}.png`))
      : null,
  };
}

async function extractSheets(
  sourceDir: string,
  outputDir: string,
  catalog: Catalog,
): Promise<SheetRecord[]> {
  const records = catalog.sheets.map((sheet) => sheetRecord(sourceDir, outputDir, sheet));
  mkdirSync(join(outputDir, 'sheets'), { recursive: true });

  for (const [index, sheet] of catalog.sheets.entries()) {
    const source = join(sourceDir, sheet.file);
    if (!existsSync(source)) continue;
    const decoded = decodeSheet(readFileSync(source));
    const sheetPng = join(outputDir, 'sheets', `${sheet.firstSpriteId}-${sheet.lastSpriteId}.png`);
    writeFileSync(sheetPng, encodePng(decoded.width, decoded.height, decoded.pixels));

    for (let spriteId = sheet.firstSpriteId; spriteId <= sheet.lastSpriteId; spriteId++) {
      const offset = spriteId - sheet.firstSpriteId;
      const x = (offset % sheet.columns) * sheet.width;
      const y = Math.floor(offset / sheet.columns) * sheet.height;
      const frame = cutOut(decoded, x, y, sheet.width, sheet.height);
      if (frame === null) throw new Error(`Sprite ${spriteId} falls outside ${sheet.file}.`);
      const destination = join(outputDir, spritePath(spriteId));
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, encodePng(sheet.width, sheet.height, frame));
    }

    if ((index + 1) % 100 === 0) console.log(`Decoded ${index + 1}/${catalog.sheets.length} sheets.`);
  }
  return records;
}

function safeResourcePath(outputDir: string, archivePath: string): string {
  const destination = resolve(outputDir, archivePath);
  const root = `${resolve(outputDir)}${sep}`;
  if (isAbsolute(archivePath) || !destination.startsWith(root)) {
    throw new Error(`Unsafe Qt resource path: ${archivePath}`);
  }
  return destination;
}

async function extractGraphicsResources(source: string, outputDir: string): Promise<string> {
  const compressed = readFileSync(source);
  const temp = mkdtempSync(join(tmpdir(), 'draconya-rcc-'));
  try {
    const lzma = join(temp, 'resources.lzma');
    const rcc = join(temp, 'resources.rcc');
    const zip = join(temp, 'resources.zip');
    writeFileSync(lzma, toCipAloneStream(compressed));
    await execFileAsync('xz', ['--format=lzma', '--decompress', '--stdout', lzma], {
      encoding: 'buffer', maxBuffer: 64 * 1024 * 1024,
    }).then(({ stdout }) => writeFileSync(rcc, stdout));
    await execFileAsync('go', ['run', RCC_EXTRACTOR, '-o', basename(zip), basename(rcc)], {
      cwd: temp, maxBuffer: 16 * 1024 * 1024,
    });

    const entries = unzipSync(readFileSync(zip));
    const index: { path: string; bytes: number; sha256: string }[] = [];
    for (const [path, bytes] of Object.entries(entries).sort(([left], [right]) => left.localeCompare(right))) {
      const destination = safeResourcePath(join(outputDir, 'ui'), path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes);
      index.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
    }
    const indexPath = join(outputDir, 'ui-index.jsonl');
    await writeJsonLines(indexPath, index);
    return relative(outputDir, indexPath);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function libraryReadme(manifest: LibraryManifest): string {
  const status = manifest.completeness.complete
    ? 'completo'
    : `parcial: faltam ${manifest.completeness.missingSheetCount} folhas`;
  return `# Biblioteca local de assets ${manifest.assetVersion}\n\n` +
    `Gerada em ${manifest.generatedAt}. Estado: **${status}**.\n\n` +
    `- \`manifest.json\`: resumo e caminhos dos indices.\n` +
    `- \`sheets.jsonl\`: uma linha por folha, com faixa inclusiva de ids e geometria.\n` +
    `- \`missing-sheets.txt\`: nomes citados no catalogo que faltam no pacote-fonte.\n` +
    `- \`sprites.jsonl\`: uma linha por sprite global; \`png\` e nulo quando a folha nao existe.\n` +
    `- \`appearances/*.jsonl\`: aparencias separadas em object, outfit, effect e missile.\n` +
    `- \`sheets/*.png\`: folhas decodificadas, nomeadas pela faixa de ids.\n` +
    `- \`sprites/<milhar>/*.png\`: quadros individuais, nomeados pelo id global.\n` +
    `- \`ui/\`: arvore original do Qt, quando graphics_resources foi fornecido.\n\n` +
    `Este diretorio e derivado de um pacote local e permanece sob \`things/\`, fora do Git.\n`;
}

function legacyLibraryReadme(manifest: LegacyLibraryManifest): string {
  return `# Biblioteca local de assets ${manifest.assetVersion}\n\n` +
    `Gerada em ${manifest.generatedAt}. Estado: **completo**.\n\n` +
    `- \`manifest.json\`: resumo, assinatura da fonte e totais do Tibia.dat.\n` +
    `- \`sheets.jsonl\`: uma linha por atlas, com faixa inclusiva de ids.\n` +
    `- \`sprites.jsonl\`: uma linha por id, com atlas, coordenadas e disponibilidade.\n` +
    `- \`atlases/*.png\`: páginas de 4096 quadros de 32 x 32 pixels.\n\n` +
    `Este diretorio e derivado de um pacote local e permanece sob \`things/\`, fora do Git.\n`;
}

export async function buildAssetLibrary(options: BuildOptions): Promise<LibraryManifest> {
  const sourceDir = resolve(options.sourceDir);
  const outputDir = resolve(options.outputDir);
  const catalogPath = join(sourceDir, 'catalog-content.json');
  if (!existsSync(catalogPath)) throw new Error(`Catalog not found: ${catalogPath}`);

  const catalog = readCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown);
  const appearancesPath = join(sourceDir, catalog.appearancesFile);
  if (!existsSync(appearancesPath)) throw new Error(`Appearances not found: ${appearancesPath}`);
  const appearances = readAppearances(readFileSync(appearancesPath));
  mkdirSync(outputDir, { recursive: true });

  const appearanceIndexes = {} as Record<AppearanceKind, string>;
  const appearanceCounts = {} as Record<AppearanceKind, number>;
  for (const kind of CATEGORIES) {
    const path = join(outputDir, 'appearances', `${kind}.jsonl`);
    const ordered = [...appearances[kind].values()].sort((left, right) => left.id - right.id);
    await writeJsonLines(path, ordered.map(appearanceRecord));
    appearanceIndexes[kind] = relative(outputDir, path);
    appearanceCounts[kind] = ordered.length;
  }

  const sheets = await extractSheets(sourceDir, outputDir, catalog);
  await writeJsonLines(join(outputDir, 'sheets.jsonl'), sheets);
  writeFileSync(
    join(outputDir, 'missing-sheets.txt'),
    `${sheets.filter((sheet) => !sheet.sourceAvailable).map((sheet) => sheet.file).join('\n')}\n`,
  );
  await writeJsonLines(join(outputDir, 'sprites.jsonl'), sheets.flatMap((sheet) =>
    Array.from({ length: sheet.lastSpriteId - sheet.firstSpriteId + 1 }, (_, offset) => {
      const id = sheet.firstSpriteId + offset;
      return {
        id,
        sheet: sheet.file,
        width: sheet.width,
        height: sheet.height,
        x: (offset % sheet.columns) * sheet.width,
        y: Math.floor(offset / sheet.columns) * sheet.height,
        png: sheet.sourceAvailable ? spritePath(id) : null,
      };
    }),
  ));

  const availableSheets = sheets.filter((sheet) => sheet.sourceAvailable);
  const availableSpriteCount = availableSheets.reduce(
    (sum, sheet) => sum + sheet.lastSpriteId - sheet.firstSpriteId + 1,
    0,
  );
  const spriteCount = sheets.reduce(
    (sum, sheet) => sum + sheet.lastSpriteId - sheet.firstSpriteId + 1,
    0,
  );
  const uiIndex = options.graphicsResources === undefined
    ? null
    : await extractGraphicsResources(resolve(options.graphicsResources), outputDir);
  const manifest: LibraryManifest = {
    schemaVersion: 1,
    assetVersion: options.version,
    format: 'modern-cip',
    generatedAt: new Date().toISOString(),
    source: {
      catalog: catalogPath,
      appearances: appearancesPath,
      graphicsResources: options.graphicsResources === undefined
        ? null
        : resolve(options.graphicsResources),
    },
    completeness: {
      complete: availableSheets.length === sheets.length,
      sheetCount: sheets.length,
      availableSheetCount: availableSheets.length,
      missingSheetCount: sheets.length - availableSheets.length,
      spriteCount,
      availableSpriteCount,
    },
    appearances: appearanceCounts,
    indexes: {
      sheets: 'sheets.jsonl',
      missingSheets: 'missing-sheets.txt',
      sprites: 'sprites.jsonl',
      appearances: appearanceIndexes,
      ui: uiIndex,
    },
  };
  writeJson(join(outputDir, 'manifest.json'), manifest);
  writeFileSync(join(outputDir, 'README.md'), libraryReadme(manifest));
  return manifest;
}

function usage(): string {
  return 'Usage: pnpm assets:library -- --source <assets-dir> --version <name> ' +
    '[--output <dir>] [--resources <graphics_resources.rcc.lzma>]';
}

if (import.meta.main) {
  const { values } = parseArgs({
    // pnpm 10 preserva o separador `--` em `process.argv`; para o parser do Node ele seria um
    // positional vazio e faria exatamente o comando documentado falhar.
    args: process.argv.slice(2).filter((argument, index) => index !== 0 || argument !== '--'),
    options: {
      source: { type: 'string' },
      version: { type: 'string' },
      output: { type: 'string' },
      resources: { type: 'string' },
    },
    strict: true,
  });
  if (values.source === undefined || values.version === undefined) {
    console.error(usage());
    process.exitCode = 1;
  } else {
    const outputDir = values.output ?? join('things', values.version, 'library');
    const sourceDir = resolve(values.source);
    const builder = existsSync(join(sourceDir, 'catalog-content.json'))
      ? buildAssetLibrary
      : buildLegacySpriteLibrary;
    builder({
      sourceDir: values.source,
      outputDir,
      version: values.version,
      ...(values.resources === undefined ? {} : { graphicsResources: values.resources }),
    }).then((manifest) => {
      console.log(JSON.stringify(manifest.completeness, null, 2));
      console.log(`Asset library written to ${resolve(outputDir)}.`);
    }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Asset library generation failed.');
      process.exitCode = 1;
    });
  }
}
