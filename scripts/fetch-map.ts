// Baixa o mapa comunitário do Tibia — `otservbr.otbm` do release do Canary — para
// `things/maps/`, fora do Git (ADR 0025), conferindo o SHA-256 fixado aqui.
//
//   pnpm map:fetch
//
// É o par de `assets:fetch:1098`: a origem, a versão e o hash ficam no código e em
// `things/maps/source.json`, para que o importador (`pnpm map:import`) grave em cada mapa de
// que arquivo ele veio. Trocar de release é trocar as três constantes abaixo E reimportar.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** O release do Canary de onde o mapa vem — o mesmo que o `config.lua.dist` dele aponta. */
export const MAP_SOURCE = {
  repository: 'https://github.com/opentibiabr/canary',
  release: 'v3.6.1',
  url: 'https://github.com/opentibiabr/canary/releases/download/v3.6.1/otservbr.otbm',
  file: 'otservbr.otbm',
  sha256: 'a80de1dda6a9aca3956a9d5b7fb2e0caebb451570d26853fc21beb40d5f31da2',
  bytes: 184_776_037,
} as const;

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || response.body === null) {
    throw new Error(`falha ao baixar ${url}: HTTP ${response.status}`);
  }
  const partial = `${destination}.part`;
  const bytes = new Uint8Array(await response.arrayBuffer());
  writeFileSync(partial, bytes);
  renameSync(partial, destination);
}

export async function fetchMap(thingsDir: string): Promise<string> {
  const dir = join(thingsDir, 'maps');
  mkdirSync(dir, { recursive: true });
  const destination = join(dir, MAP_SOURCE.file);
  if (existsSync(destination) && fileHash(destination) === MAP_SOURCE.sha256) {
    console.log(`${destination} já está na máquina e confere`);
  } else {
    console.log(`baixando ${MAP_SOURCE.url} (${Math.round(MAP_SOURCE.bytes / 1_048_576)} MB)…`);
    await download(MAP_SOURCE.url, destination);
    const actual = fileHash(destination);
    if (actual !== MAP_SOURCE.sha256) {
      rmSync(destination, { force: true });
      throw new Error(`${MAP_SOURCE.file}: checksum esperado ${MAP_SOURCE.sha256}, recebido ${actual}`);
    }
    console.log(`${destination} baixado e conferido`);
  }
  writeFileSync(join(dir, 'source.json'), `${JSON.stringify({
    repository: MAP_SOURCE.repository,
    release: MAP_SOURCE.release,
    url: MAP_SOURCE.url,
    files: [{ name: MAP_SOURCE.file, sha256: MAP_SOURCE.sha256 }],
  }, null, 2)}\n`);
  return destination;
}

if (import.meta.main) {
  const thingsDir = resolve(ROOT, process.env.THINGS_DIR ?? 'things');
  fetchMap(thingsDir).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
