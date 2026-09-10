// @draconya/content — dados de jogo versionados. Ver packages/content/AGENTS.md.
//
// Este ponto de entrada é PURO: só schemas, tipos e montagem em memória. `sim` importa daqui.
// A leitura de disco vive em `@draconya/content/load`, que `sim` não pode importar.

export * from './schemas.js';
export * from './map.js';
export * from './content.js';
export * from './bot.js';
