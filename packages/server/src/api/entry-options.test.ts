import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthService } from '../auth/service.js';
import { loadConfiguration } from '../config.js';
import { buildApi } from './server.js';
import type { EntryHunt } from './entry-options.js';

// O que o menu de entrada pergunta antes do primeiro ticket (#846, OW-23): a flag e as hunts idle diretas. O
// que está em teste é o CONTRATO — `{ openWorld, hunts }`, vazio com a flag desligada, 401 sem sessão — e que
// `buildApi` a monta só com o que ela precisa (auth + a lista de hunts).

const HUNTS: readonly EntryHunt[] = [
  { id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1 },
  { id: 'rotworm-caves', name: 'Rotworm Caves', recommendedLevel: 20 },
];

const environment = {
  DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost', NODE_ENV: 'test',
  API_ORIGIN: 'https://play.draconya.example',
};

const apps: ReturnType<typeof buildApi>[] = [];

function setup(openWorld: boolean, options: { signedIn?: boolean; hunts?: boolean } = {}) {
  const configuration = loadConfiguration({ ...environment, OPEN_WORLD: openWorld ? '1' : '0' });
  const logger = pino({ level: 'silent' });
  // Só `authenticate` e o que `registerAuthRoutes` toca no registro: o resto do serviço nunca é chamado aqui.
  const auth = {
    authenticate: async () => (options.signedIn === false ? null : { accountId: 'acc-1' }),
    devMode: true,
    hostedConfigured: false,
  } as unknown as AuthService;
  const app = buildApi(configuration, logger, {
    auth,
    ...(options.hunts === false ? {} : { entryHunts: () => HUNTS }),
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('GET /api/entry-options (#846, OW-23)', () => {
  it('com o mundo aberto ligado devolve a flag e as hunts que o ticket aceita no `entry`', async () => {
    const response = await setup(true).inject({ method: 'GET', url: '/api/entry-options' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ openWorld: true, hunts: HUNTS });
  });

  it('com a flag desligada — o default — a lista vai VAZIA: o menu não existe e o botão único de sempre vale', async () => {
    const response = await setup(false).inject({ method: 'GET', url: '/api/entry-options' });

    expect(response.statusCode).toBe(200);
    // Mutação que mata: devolver as hunts com a flag desligada — o cliente montaria um menu "Caçar (idle)" cujo
    // `entry: { hunt }` o servidor IGNORA (a hunt idle direta só vale com `OPEN_WORLD`) e cairia na Cidade.
    expect(response.json()).toEqual({ openWorld: false, hunts: [] });
  });

  it('só devolve campos de apresentação: o id, o nome e o level recomendado de cada hunt', async () => {
    const app = (() => {
      const configuration = loadConfiguration({ ...environment, OPEN_WORLD: '1' });
      const auth = { authenticate: async () => ({ accountId: 'acc-1' }), devMode: true } as unknown as AuthService;
      const built = buildApi(configuration, pino({ level: 'silent' }), {
        auth,
        // O catálogo de verdade traz muito mais por hunt (monstros, loot, outfits…): nada disso é do menu.
        entryHunts: () => [{ ...HUNTS[0]!, monsters: [{ id: 'rat' }], lootDrops: 9 } as EntryHunt],
      });
      apps.push(built);
      return built;
    })();

    const response = await app.inject({ method: 'GET', url: '/api/entry-options' });

    expect(response.json()).toEqual({ openWorld: true, hunts: [HUNTS[0]] });
  });

  it('recusa quem não tem sessão', async () => {
    const response = await setup(true, { signedIn: false }).inject({ method: 'GET', url: '/api/entry-options' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthenticated' });
  });

  it('não existe sem a lista de hunts: um `api` montado sem conteúdo não inventa um menu', async () => {
    const response = await setup(true, { hunts: false }).inject({ method: 'GET', url: '/api/entry-options' });

    expect(response.statusCode).toBe(404);
  });
});
