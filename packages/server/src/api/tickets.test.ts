import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createTicketHandler, type TicketRouteDependencies } from './tickets.js';
import type { IssueResult } from '../tickets.js';
import type { CharacterRecord } from '../db/repository.js';

const CHARACTER: CharacterRecord = {
  id: 'p1', accountId: 'a1', name: 'Hero', vocation: null, level: 1, xp: 0, gold: 0,
  capacity: 400, premiumUntil: null, staminaMs: 86400000, staminaUpdatedAt: new Date(),
  state: 'city', sessionId: null, botConfig: null, skills: {}, outfitColors: null, bestiary: null,
  createdAt: new Date(),
};

const NODE = { nodeId: 'n1', sessions: 0, url: 'ws://n1:7171' };

const ISSUED: IssueResult = {
  ok: true,
  value: {
    ticket: 'tok', wsUrl: 'ws://n1:7171/?ticket=tok', nodeId: 'n1', expiresAtMs: 1_000,
  },
};

/**
 * `omit` em vez de `{ authenticate: undefined }`: com `exactOptionalPropertyTypes`, passar
 * `undefined` explícito numa propriedade opcional é outra coisa que não passá-la. O teste que
 * exercita "sem autenticação configurada" precisa da AUSÊNCIA, que é o que a rota checa.
 */
function build(
  overrides: Partial<TicketRouteDependencies> = {},
  omit: ReadonlyArray<keyof TicketRouteDependencies> = [],
) {
  const app = Fastify();
  const deps: Record<string, unknown> = {
    authenticate: async () => ({ accountId: 'a1' }),
    withOwnedCharacter: async (
      _accountId: string,
      _characterId: string,
      operation: (character: typeof CHARACTER) => unknown,
    ) => operation(CHARACTER),
    ownsCharacter: async () => true,
    settleProgress: async () => ({ written: 0, failed: 0 }),
    ...overrides,
    // Depois do spread, e mesclado: quase todo teste sobrescreve só o `issue`, e substituir o
    // objeto inteiro tiraria o `resolveNode` junto — que a rota chama antes.
    tickets: {
      issue: async () => ISSUED,
      resolveNode: async () => ({ ok: true, node: NODE }),
      ...(overrides.tickets ?? {}),
    },
  };
  for (const key of omit) delete deps[key];
  app.post('/api/tickets', createTicketHandler(deps as unknown as TicketRouteDependencies));
  return app;
}

const post = (app: ReturnType<typeof build>, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/tickets', payload: body });

describe('POST /api/tickets', () => {
  it('returns the ticket and the URL of the resolved node', async () => {
    const response = await post(build(), { characterId: 'p1' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ticket: 'tok', wsUrl: 'ws://n1:7171/?ticket=tok', expiresAtMs: 1_000,
    });
  });

  it('refuses to serve at all while authentication is not wired', async () => {
    // Falhar fechado. Uma rota de ticket sem autenticação emite credencial para qualquer
    // personagem — é pior que a rota não existir.
    const response = await post(build({}, ['authenticate']), { characterId: 'p1' });
    expect(response.statusCode).toBe(501);
  });

  it('rejects an anonymous caller', async () => {
    const response = await post(build({ authenticate: async () => null }), { characterId: 'p1' });
    expect(response.statusCode).toBe(401);
  });

  it('answers 404 for a character that is not the caller\'s', async () => {
    // Não 403: distinguir "não existe" de "não é seu" entrega uma lista de personagens.
    const response = await post(build({ withOwnedCharacter: async () => null }), { characterId: 'p1' });
    expect(response.statusCode).toBe(404);
  });

  it('NÃO liquida o progresso de um personagem que não é do chamador (ADR 0024)', async () => {
    // A liquidação precisa vir antes da trava de linha, e por isso ela ficava antes da
    // checagem de posse: uma conta autenticada disparava ação sobre dado de outra conta. Nada
    // de valor mudava, mas "nada de valor" não é a fronteira certa num endpoint autenticado.
    const settleProgress = vi.fn(async () => ({ written: 0, failed: 0 }));
    const resolveNode = vi.fn(async () => ({ ok: true as const, node: NODE }));
    const response = await post(
      build({
        ownsCharacter: async () => false,
        settleProgress,
        tickets: { resolveNode } as never,
      }),
      { characterId: 'de-outra-conta' },
    );

    expect(response.statusCode).toBe(404);
    expect(settleProgress).not.toHaveBeenCalled();
    // E nem o nó é resolvido: a posse decide se a rota faz ALGUMA coisa, então ela vem antes
    // de tudo que custa uma ida ao Redis.
    expect(resolveNode).not.toHaveBeenCalled();
  });

  it('a posse é conferida DUAS vezes, e a barata vem antes da liquidação', async () => {
    // Uma não substitui a outra: `ownsCharacter` decide se a rota age, e roda sem travar;
    // `withOwnedCharacter` decide o que é LIDO, sob a trava que o soft delete também usa.
    // Colapsar as duas na segunda devolveria a fresta; na primeira, leria linha sem trava.
    const order: string[] = [];
    const response = await post(
      build({
        ownsCharacter: async () => { order.push('owns'); return true; },
        settleProgress: async () => { order.push('settle'); return { written: 0, failed: 0 }; },
        withOwnedCharacter: (async (
          _accountId: string,
          _characterId: string,
          operation: (character: typeof CHARACTER) => unknown,
        ) => { order.push('lock'); return operation(CHARACTER); }) as never,
      }),
      { characterId: 'p1' },
    );

    expect(response.statusCode).toBe(200);
    expect(order).toEqual(['owns', 'settle', 'lock']);
  });

  it('recusa servir enquanto a checagem de posse não estiver ligada', async () => {
    // Falhar fechado, como as outras dependências: uma rota sem `ownsCharacter` liquidaria o
    // personagem que o corpo pedir. Ausência é 501, nunca "segue sem conferir".
    const response = await post(build({}, ['ownsCharacter']), { characterId: 'p1' });
    expect(response.statusCode).toBe(501);
  });

  it('uses persisted attributes instead of client supplied progress', async () => {
    const issue = vi.fn(async () => ISSUED);
    const response = await post(build({ tickets: { issue } as never }), {
      characterId: 'p1', level: 999, xp: 999999, accountId: 'attacker',
    });
    expect(response.statusCode).toBe(200);
    expect(issue).toHaveBeenCalledWith(
      'a1', 'p1', expect.objectContaining({ level: 1, xp: 0 }), NODE,
    );
  });

  it('as cores do outfit da linha entram no ticket; corrompidas ou nulas, ficam de fora (FUN-104)', async () => {
    // Mesmo caminho do nome e do `botConfig`: a linha é lida sob a trava e o que ela diz vai
    // no ticket. O `null` de quem nunca escolheu NÃO vira chave — o `game` espalha o que
    // recebe, e uma chave `undefined` no claim seria mentira no tipo. E a linha é `jsonb` sem
    // CHECK: um valor fora da paleta cai fora aqui, sem trancar o login por causa de cor.
    const issuedWith = async (outfitColors: unknown) => {
      const issue = vi.fn(async (..._args: unknown[]) => ISSUED);
      const response = await post(build({
        tickets: { issue } as never,
        withOwnedCharacter: (async (
          _accountId: string,
          _characterId: string,
          operation: (character: typeof CHARACTER) => unknown,
        ) => operation({ ...CHARACTER, outfitColors })) as never,
      }), { characterId: 'p1' });
      expect(response.statusCode).toBe(200);
      return issue.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    };

    const colors = { head: 78, body: 69, legs: 58, feet: 76 };
    expect(await issuedWith(colors)).toMatchObject({ outfitColors: colors });
    expect(await issuedWith(null)).not.toHaveProperty('outfitColors');
    expect(await issuedWith({ head: 133, body: 69, legs: 58, feet: 76 }))
      .not.toHaveProperty('outfitColors');
  });

  it('os abates da linha entram no ticket; nulos ou corrompidos, ficam de fora (FUN-113)', async () => {
    // Mesmo caminho das skills: a linha é lida sob a trava e o que ela diz vai no ticket —
    // é assim que o bônus dos marcos vale DURANTE a hunt, e não só depois dela. O `null` de
    // quem nunca abateu nada NÃO vira chave (o `game` espalha o que recebe), e a linha é
    // `jsonb` sem CHECK: uma contagem torta cai fora aqui, sem trancar o login por causa dela.
    const issuedWith = async (bestiary: unknown) => {
      const issue = vi.fn(async (..._args: unknown[]) => ISSUED);
      const response = await post(build({
        tickets: { issue } as never,
        withOwnedCharacter: (async (
          _accountId: string,
          _characterId: string,
          operation: (character: typeof CHARACTER) => unknown,
        ) => operation({ ...CHARACTER, bestiary })) as never,
      }), { characterId: 'p1' });
      expect(response.statusCode).toBe(200);
      return issue.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    };

    const counts = { rat: 10_000, bat: 3 };
    expect(await issuedWith(counts)).toMatchObject({ bestiary: counts });
    expect(await issuedWith(null)).not.toHaveProperty('bestiary');
    expect(await issuedWith({ rat: -1 })).not.toHaveProperty('bestiary');
    expect(await issuedWith([10_000])).not.toHaveProperty('bestiary');
  });

  it('resolve o nó ANTES de abrir a trava de linha (FUN-53)', async () => {
    // Qual nó de jogo está vivo não tem relação nenhuma com a linha do personagem, e
    // descobrir isso é `SCAN` mais `MGET` no Redis. Segurando a trava enquanto isso acontece,
    // uma lentidão do Redis vira pool do Postgres esgotado e toda rota que toca o banco
    // parando de responder — por um problema que não tem a ver com a linha travada.
    const order: string[] = [];
    const app = build({
      tickets: {
        resolveNode: async () => { order.push('resolve-node'); return { ok: true, node: NODE }; },
        issue: async () => { order.push('issue'); return ISSUED; },
      } as never,
      withOwnedCharacter: (async (
        _accountId: string,
        _characterId: string,
        operation: (character: typeof CHARACTER) => unknown,
      ) => {
        order.push('lock');
        return operation(CHARACTER);
      }) as never,
    });

    await post(app, { characterId: 'p1' });

    expect(order).toEqual(['resolve-node', 'lock', 'issue']);
  });

  it('nó indisponível responde sem sequer travar a linha', async () => {
    const order: string[] = [];
    const app = build({
      tickets: {
        resolveNode: async () => ({ ok: false, reason: 'no-node-available' }),
        issue: async () => ISSUED,
      } as never,
      withOwnedCharacter: (async () => { order.push('lock'); return null; }) as never,
    });

    const response = await post(app, { characterId: 'p1' });

    expect(response.statusCode).toBe(503);
    expect(order).toEqual([]);
  });

  it('liquida o progresso pendente ANTES de ler a linha do personagem (FUN-56)', async () => {
    // Entre a sessão encerrar e o `jobs` varrer passam até dez segundos. Ler a linha antes
    // de liquidar devolve o level e a XP de antes da sessão que acabou — e como
    // `statsForLevel` deriva os pontos do level, o personagem também encolhe na tela.
    const order: string[] = [];
    const app = build({
      settleProgress: async () => { order.push('settle'); return { written: 0, failed: 0 }; },
      withOwnedCharacter: (async (
        _accountId: string,
        _characterId: string,
        operation: (character: typeof CHARACTER) => unknown,
      ) => {
        order.push('lock');
        return operation(CHARACTER);
      }) as never,
    });

    await post(app, { characterId: 'p1' });

    // Fora da trava, e não dentro: a liquidação PRECISA da trava para escrever, e chamá-la
    // de dentro dela seria travar contra si mesma.
    expect(order).toEqual(['settle', 'lock']);
  });

  it('recusa a entrada quando a liquidação falha, em vez de deixar passar', async () => {
    // Entrar com um personagem que o servidor SABE estar desatualizado é o defeito que esta
    // rota acabou de deixar de ter. O 503 é retentável de graça: o extrato continua no
    // Redis, e a varredura o pega dentro de dez segundos de qualquer jeito.
    const failed = build({ settleProgress: async () => ({ written: 0, failed: 1 }) });
    const threw = build({
      settleProgress: async () => { throw new Error('redis is down'); },
    });

    for (const app of [failed, threw]) {
      const response = await post(app, { characterId: 'p1' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'progress-not-settled' });
    }
  });

  it('sem liquidação configurada, não emite ticket nenhum', async () => {
    // Emitir mesmo assim traria o defeito de volta CALADO. Quem sabe ler a linha do
    // personagem tem que saber deixá-la em dia antes.
    const response = await post(build({}, ['settleProgress']), { characterId: 'p1' });

    expect(response.statusCode).toBe(501);
  });

  it('rejects a malformed body', async () => {
    expect((await post(build(), { characterId: '' })).statusCode).toBe(400);
    expect((await post(build(), {})).statusCode).toBe(400);
  });

  it.each([
    ['active-limit', 409],
    ['no-node-available', 503],
    ['session-node-unavailable', 503],
  ] as const)('maps %s to HTTP %i', async (reason, status) => {
    const app = build({ tickets: { issue: async () => ({ ok: false, reason }) } as never });
    const response = await post(app, { characterId: 'p1' });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error: reason });
  });
});
