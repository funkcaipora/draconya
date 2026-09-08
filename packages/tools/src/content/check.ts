#!/usr/bin/env node
// Valida um diretório de conteúdo e imprime um resumo.
//
// NÃO é o importador que a FUN-9 previa. Importador converte de um formato de origem, e ainda
// não existe formato de origem — os mapas são escritos à mão como grade de caracteres. Escrever
// um conversor agora seria adivinhar a entrada. Quando houver editor de mapa ou dump do cliente
// Tibia, o importador entra aqui e passa a produzir os mesmos JSON que este comando valida.
//
// O que existe já é útil: conferir mapa e rota ANTES de subir o servidor. O boot também valida,
// mas descobrir uma rota aberta pelo `pnpm content:check` é bem mais barato que pelo crash.
//
//   pnpm content:check [diretório]

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from '@draconya/content/load';

// Resolvido a partir deste arquivo, e não do diretório de trabalho: o script roda pelo
// `pnpm --filter`, que executa dentro de packages/tools — um caminho relativo apontaria
// para o lugar errado dependendo de onde o comando foi chamado.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const dir = process.argv[2] ?? join(REPO, 'packages', 'content', 'data');

try {
  const content = loadContent(dir);
  console.log(`conteúdo válido — versão ${content.version}`);
  console.log(`  monstros: ${content.monsters.size}`);
  console.log(`  hunts:    ${content.hunts.size}`);
  console.log(`  vocações: ${content.vocations.size}`);
  console.log(`  mapas:    ${content.maps.size}`);
  console.log(`  rotas:    ${content.routes.size}`);

  for (const [id, route] of content.routes) {
    console.log(`  rota "${id}": ${route.tiles.length} tiles, ${route.spawnPoints.length} spawns`);
  }

  if (content.openValues.length > 0) {
    console.log(`\n${content.openValues.length} valor(es) ainda em aberto no PRD:`);
    for (const aberto of content.openValues) console.log(`  - ${aberto}`);
  }
} catch (erro) {
  console.error((erro as Error).message);
  process.exit(1);
}
