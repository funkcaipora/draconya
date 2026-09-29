// Baixa um snapshot imutavel do pacote DatSpr comunitario e gera a biblioteca local.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { buildLegacySpriteLibrary } from './build-asset-library.js';

const execFileAsync = promisify(execFile);
const REPOSITORY = 'https://github.com/tibia-oce/assets';
const COMMIT = '7bfb56b98095c4be6190877a5cecabc9650678ca';
const VERSION = '1098';
const FILES = [
  {
    name: 'Tibia.spr',
    sha256: '4f6ec92a1de406465b299b118fad8925300b94749db79990f04588d232992d08',
    url: `https://media.githubusercontent.com/media/tibia-oce/assets/${COMMIT}/things/1098/Tibia.spr`,
  },
  {
    name: 'Tibia.dat',
    sha256: '51a2367522e61faa8b9743db32c02f76601bd6ae663b81efacc597f9652e9919',
    url: `https://raw.githubusercontent.com/tibia-oce/assets/${COMMIT}/things/1098/Tibia.dat`,
  },
  {
    name: 'Tibia.otfi',
    sha256: '7743548835944bc799cb871a4e5def84f7af76815031871b9ce74b5ec0e8add3',
    url: `https://raw.githubusercontent.com/tibia-oce/assets/${COMMIT}/things/1098/Tibia.otfi`,
  },
  {
    name: 'credits.txt',
    sha256: 'f3cce19dbb6fd2f97e1863a5fc65225e35e274ca3069a40d21542d405641a984',
    url: `https://raw.githubusercontent.com/tibia-oce/assets/${COMMIT}/things/1098/credits.txt`,
  },
] as const;

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function obtainFile(directory: string, file: (typeof FILES)[number]): Promise<void> {
  const destination = join(directory, file.name);
  if (existsSync(destination) && fileHash(destination) === file.sha256) {
    console.log(`Verified ${file.name}.`);
    return;
  }
  const partial = `${destination}.partial`;
  rmSync(partial, { force: true });
  console.log(`Downloading ${file.name}...`);
  await execFileAsync('curl', [
    '--location', '--fail', '--show-error', '--retry', '3', '--output', partial, file.url,
  ], { maxBuffer: 1024 * 1024 });
  const actualHash = fileHash(partial);
  if (actualHash !== file.sha256) {
    rmSync(partial, { force: true });
    throw new Error(`${file.name} checksum mismatch: expected ${file.sha256}, received ${actualHash}.`);
  }
  renameSync(partial, destination);
}

const sourceDir = resolve('things', VERSION);
mkdirSync(sourceDir, { recursive: true });
for (const file of FILES) await obtainFile(sourceDir, file);
writeFileSync(join(sourceDir, 'source.json'), `${JSON.stringify({
  repository: REPOSITORY,
  commit: COMMIT,
  version: VERSION,
  files: FILES.map(({ name, sha256 }) => ({ name, sha256 })),
}, null, 2)}\n`);

const manifest = await buildLegacySpriteLibrary({
  sourceDir,
  outputDir: join(sourceDir, 'library'),
  version: VERSION,
});
console.log(JSON.stringify(manifest.completeness, null, 2));
console.log(`Open Tibia asset library written to ${join(sourceDir, 'library')}.`);
