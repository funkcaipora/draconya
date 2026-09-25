// @draconya/server — processos api, game e jobs. Ver packages/server/AGENTS.md.

export * from './config.js';
export * as schema from './db/schema.js';
export * from './role.js';
export * from './log.js';
export * from './directory.js';
export * from './tickets.js';
export * from './snapshots.js';
export * from './receipts.js';
export * from './snapshot-settlement.js';
export * from './clock.js';
export * from './auth/service.js';
export * from './auth/sessions.js';
export * from './db/client.js';
export * from './db/repository.js';
// O nó de jogo, para scripts operacionais e medição (`packages/tools`). `BotConfigDecision`
// aparece nos dois módulos — `host` declara o tipo e `sessions` o produz —, então a reexportação
// nomeia a fonte em vez de deixar a ambiguidade para quem importa.
export * from './game/viewer.js';
export * from './game/host.js';
export * from './game/aoi.js';
export {
  CITY_SHARD_CAPACITY, CityShard, createBotConfigValidator, createCitySessionFactory,
  createSessionBuilder, createSessionRestorer,
} from './game/sessions.js';
