import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { offlineTrainingRulesOf } from '@draconya/sim';
import { createTicketHandler, type TicketRouteDependencies } from './tickets.js';
import { trainingTestContent } from '../testing/content.js';
import type { IssueResult } from '../tickets.js';
import type { CharacterRecord } from '../db/repository.js';

const CHARACTER: CharacterRecord = {
  id: 'p1', accountId: 'a1', name: 'Hero', vocation: null, promoted: false, level: 1, xp: 0, soul: 0, gold: 0,
  capacity: 400, premiumUntil: null, staminaMs: 86400000, staminaUpdatedAt: new Date(),
  state: 'city', sessionId: null, botConfig: null, skills: {}, outfitColors: null, bestiary: null,
  ammo: null, supplyStock: null, ammunitionStock: null, charms: null, hazard: null, bosstiary: null, learnedSpells: null,
  familiar: null, training: null, fedMs: 0, blessings: 0, fightMode: 'attack',
  durableVersion: 0,
  worldId: 'main', worldPosition: null, townId: 'thais', health: null, mana: null, conditions: null,
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

  it('a versão durável do ticket é max(coluna, maior versão pendente), lida DEPOIS de liquidar (#823)', async () => {
    // A sessão nova grava versões MAIORES que as de qualquer extrato que ainda espere
    // liquidação. Mutação que mata: levar só a coluna, ou ler a pendência antes da liquidação
    // (o que sobrou é o que a coluna ainda não viu).
    const order: string[] = [];
    const issue = vi.fn(async (..._args: unknown[]) => ISSUED);
    const issuedWith = async (column: number, pending: number | undefined) => {
      order.length = 0;
      issue.mockClear();
      const response = await post(build({
        tickets: { issue } as never,
        settleProgress: async () => { order.push('settle'); return { written: 1, failed: 0 }; },
        ...(pending === undefined ? {} : {
          pendingDurableVersion: async () => { order.push('pending'); return pending; },
        }),
        withOwnedCharacter: (async (
          _accountId: string,
          _characterId: string,
          operation: (character: typeof CHARACTER) => unknown,
        ) => operation({ ...CHARACTER, durableVersion: column })) as never,
      }), { characterId: 'p1' });
      expect(response.statusCode).toBe(200);
      return (issue.mock.calls[0]?.[2] as { durableVersion?: number } | undefined)?.durableVersion;
    };

    expect(await issuedWith(3, 9)).toBe(9);
    expect(order).toEqual(['settle', 'pending']);
    expect(await issuedWith(12, 9)).toBe(12);
    // Sem Redis de extratos ligado, é a coluna — e `0` é versão, não ausência.
    expect(await issuedWith(4, undefined)).toBe(4);
    expect(await issuedWith(0, undefined)).toBe(0);
  });

  describe('o mundo e os vitais da linha no ticket (#836, OW-15, ADR 0060 d.10.f)', () => {
    const POISON = { key: 'poison', expiresAtMs: 4_000, tick: { amount: 3, intervalMs: 1_000, kind: 'damage' } };
    /** Um personagem que saiu do mundo a 10 HP, no templo, envenenado. */
    const OUT_AT_TEN = {
      ...CHARACTER,
      worldPosition: { x: 32369, y: 32241, z: 7 }, townId: 'thais', health: 10, mana: 3, conditions: [POISON],
    };
    const issuedWith = async (row: typeof CHARACTER, openWorld: boolean | undefined) => {
      const issue = vi.fn(async (..._args: unknown[]) => ISSUED);
      const response = await post(build({
        tickets: { issue } as never,
        ...(openWorld === undefined ? {} : { openWorld }),
        withOwnedCharacter: (async (
          _accountId: string,
          _characterId: string,
          operation: (character: typeof CHARACTER) => unknown,
        ) => operation(row)) as never,
      }), { characterId: 'p1' });
      expect(response.statusCode).toBe(200);
      return issue.mock.calls[0]?.[2] as Record<string, unknown>;
    };

    it('COM a flag, o ticket leva a posição, a cidade, a vida, a mana e as condições que a linha guarda', async () => {
      const initial = await issuedWith(OUT_AT_TEN, true);
      expect(initial).toMatchObject({
        worldPosition: { x: 32369, y: 32241, z: 7 }, townId: 'thais', health: 10, mana: 3, conditions: [POISON],
      });
    });

    it('SEM a flag — o default —, o ticket é o de antes: nenhum campo novo, nem a cidade', async () => {
      // O portão do plano: com a flag desligada tudo funciona como hoje, byte a byte. Mutação que
      // mata: ler as colunas novas sem olhar a flag.
      for (const openWorld of [undefined, false]) {
        const initial = await issuedWith(OUT_AT_TEN, openWorld);
        for (const field of ['worldPosition', 'townId', 'health', 'mana', 'conditions']) {
          expect(initial).not.toHaveProperty(field);
        }
      }
    });

    it('personagem que nunca saiu do mundo: leva só a cidade — cheio, no templo, sem condição', async () => {
      const initial = await issuedWith(CHARACTER, true);
      expect(initial).toMatchObject({ townId: 'thais' });
      for (const field of ['worldPosition', 'health', 'mana', 'conditions']) {
        expect(initial).not.toHaveProperty(field);
      }
    });

    it('uma linha torta não tranca o login: o campo ruim some, e os bons seguem', async () => {
      const initial = await issuedWith({
        ...OUT_AT_TEN, health: 0, conditions: [{ key: 'haste' }],
      }, true);
      // Vida zero é um morto, e o morto entra cheio. A posição e a mana boas ficam.
      expect(initial).toMatchObject({ worldPosition: { x: 32369, y: 32241, z: 7 }, mana: 3 });
      expect(initial).not.toHaveProperty('health');
      expect(initial).not.toHaveProperty('conditions');
    });
  });

  it('a postura de luta da linha entra no ticket; um valor fora dos três modos fica de fora (#550)', async () => {
    // Mesmo caminho do Bestiário: a linha é lida sob a trava e a postura vai no ticket — é assim
    // que ela vale desde o PRIMEIRO golpe da hunt. A coluna tem CHECK, mas um banco editado à
    // mão não tranca o login: o valor torto cai fora e a sessão parte da ofensiva do Canary.
    const issuedWith = async (fightMode: unknown) => {
      const issue = vi.fn(async (..._args: unknown[]) => ISSUED);
      const response = await post(build({
        tickets: { issue } as never,
        withOwnedCharacter: (async (
          _accountId: string,
          _characterId: string,
          operation: (character: typeof CHARACTER) => unknown,
        ) => operation({ ...CHARACTER, fightMode: fightMode as string })) as never,
      }), { characterId: 'p1' });
      expect(response.statusCode).toBe(200);
      return issue.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    };

    for (const fightMode of ['attack', 'balanced', 'defense']) {
      expect(await issuedWith(fightMode)).toMatchObject({ fightMode });
    }
    expect(await issuedWith('aggressive')).not.toHaveProperty('fightMode');
    expect(await issuedWith(null)).not.toHaveProperty('fightMode');
  });

  it('o Hazard da linha entra no ticket; nulo ou corrompido, fica de fora (M44-14, #632)', async () => {
    // Mesmo caminho dos Charms: o nível escolhido na Cidade vai no ticket e vale fixado na hunt
    // (ADR 0052 d.5). A linha é `jsonb` sem CHECK: um registro torto cai fora, sem trancar o login.
    const issuedWith = async (hazard: unknown) => {
      const issue = vi.fn(async (..._args: unknown[]) => ISSUED);
      const response = await post(build({
        tickets: { issue } as never,
        withOwnedCharacter: (async (
          _accountId: string,
          _characterId: string,
          operation: (character: typeof CHARACTER) => unknown,
        ) => operation({ ...CHARACTER, hazard })) as never,
      }), { characterId: 'p1' });
      expect(response.statusCode).toBe(200);
      return issue.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    };

    const registry = { maxLevel: { gardens: 4 }, currentLevel: { gardens: 3 }, version: 1 };
    expect(await issuedWith(registry)).toMatchObject({ hazard: registry });
    expect(await issuedWith(null)).not.toHaveProperty('hazard');
    expect(await issuedWith({ maxLevel: { gardens: -1 }, currentLevel: {}, version: 1 }))
      .not.toHaveProperty('hazard');
    expect(await issuedWith('4')).not.toHaveProperty('hazard');
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

  it('o Bosstiary da linha entra no ticket; nulo ou corrompido, fica de fora (#629)', async () => {
    // A mesma régua do Bestiário: a linha é `jsonb` sem CHECK, e um registro torto cai fora aqui
    // sem trancar o login; o `null` de quem nunca abateu um boss NÃO vira chave.
    const issuedWith = async (bosstiary: unknown) => {
      const issue = vi.fn(async (..._args: unknown[]) => ISSUED);
      const response = await post(build({
        tickets: { issue } as never,
        withOwnedCharacter: (async (
          _accountId: string,
          _characterId: string,
          operation: (character: typeof CHARACTER) => unknown,
        ) => operation({ ...CHARACTER, bosstiary })) as never,
      }), { characterId: 'p1' });
      expect(response.statusCode).toBe(200);
      return issue.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    };

    const record = { kills: { '639': 3 }, points: 40, version: 1 };
    expect(await issuedWith(record)).toMatchObject({ bosstiary: record });
    expect(await issuedWith(null)).not.toHaveProperty('bosstiary');
    expect(await issuedWith({ kills: { '639': -1 }, points: 0, version: 1 })).not.toHaveProperty('bosstiary');
    expect(await issuedWith({ kills: {} })).not.toHaveProperty('bosstiary');
    expect(await issuedWith([1])).not.toHaveProperty('bosstiary');
  });

  it('leva os carimbos do familiar quando a linha tem um registro válido, e descarta o torto (#599)', async () => {
    // Sem eles no ticket, sair da hunt zeraria o cooldown de 30 min: a sessão seguinte leria o
    // personagem como quem nunca invocou. O `null` de quem nunca invocou NÃO vira chave.
    const issuedWith = async (familiar: unknown) => {
      const issue = vi.fn(async (..._args: unknown[]) => ISSUED);
      const response = await post(build({
        tickets: { issue } as never,
        withOwnedCharacter: (async (
          _accountId: string,
          _characterId: string,
          operation: (character: typeof CHARACTER) => unknown,
        ) => operation({ ...CHARACTER, familiar })) as never,
      }), { characterId: 'p1' });
      expect(response.statusCode).toBe(200);
      return issue.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    };

    const stamps = { version: 1, summonUntilMs: 1_790_000_900_000, cooldownUntilMs: 1_790_001_800_000 };
    expect(await issuedWith(stamps)).toMatchObject({ familiar: stamps });
    expect(await issuedWith(null)).not.toHaveProperty('familiar');
    expect(await issuedWith({ version: 1, summonUntilMs: -1, cooldownUntilMs: 0 })).not.toHaveProperty('familiar');
    expect(await issuedWith('nunca')).not.toHaveProperty('familiar');
  });

  it('leva a munição escolhida quando a linha tem uma válida, e descarta a torta (#152)', async () => {
    // A mesma régua do Bestiário: uma escolha torta vira ausente — a sessão atira a grátis —,
    // nunca login recusado por causa de uma preferência.
    const issuedWith = async (ammo: unknown) => {
      const issue = vi.fn(async (..._args: unknown[]) => ISSUED);
      const response = await post(build({
        tickets: { issue } as never,
        withOwnedCharacter: (async (
          _accountId: string,
          _characterId: string,
          operation: (character: typeof CHARACTER) => unknown,
        ) => operation({ ...CHARACTER, ammo })) as never,
      }), { characterId: 'p1' });
      expect(response.statusCode).toBe(200);
      return issue.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    };

    expect(await issuedWith({ arrow: 'sniper-arrow' })).toMatchObject({ ammo: { arrow: 'sniper-arrow' } });
    expect(await issuedWith(null)).not.toHaveProperty('ammo');
    expect(await issuedWith({ arrow: 7 })).not.toHaveProperty('ammo');
    expect(await issuedWith(['arrow'])).not.toHaveProperty('ammo');
  });

  it('as magias aprendidas da linha entram no ticket; nulas ou tortas, ficam de fora (#624, ADR 0058)', async () => {
    // Sem elas na sessão o CAST recusa toda magia (`spell-not-learned`) — quem comprou ontem
    // entraria hoje sem lançar nada. O `null` do personagem novo NÃO vira chave, e a linha é
    // `jsonb` sem CHECK: um registro torto cai fora aqui, sem trancar o login por causa dele.
    const issuedWith = async (learnedSpells: unknown) => {
      const issue = vi.fn(async (..._args: unknown[]) => ISSUED);
      const response = await post(build({
        tickets: { issue } as never,
        withOwnedCharacter: (async (
          _accountId: string,
          _characterId: string,
          operation: (character: typeof CHARACTER) => unknown,
        ) => operation({ ...CHARACTER, learnedSpells })) as never,
      }), { characterId: 'p1' });
      expect(response.statusCode).toBe(200);
      return issue.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    };

    const record = { spellIds: ['berserk', 'wound-cleansing'], version: 1 };
    expect(await issuedWith(record)).toMatchObject({ learnedSpells: record });
    expect(await issuedWith({ spellIds: [], version: 1 })).toMatchObject({ learnedSpells: { spellIds: [] } });
    expect(await issuedWith(null)).not.toHaveProperty('learnedSpells');
    expect(await issuedWith({ spellIds: ['berserk', 'berserk'], version: 1 })).not.toHaveProperty('learnedSpells');
    expect(await issuedWith(['berserk'])).not.toHaveProperty('learnedSpells');
  });

  it('leva a vocação da linha, e a ausência quando ainda não há uma (#154)', async () => {
    // A vocação é escrita uma vez pelo `jobs` e volta pelo ticket a cada entrada — sem isto o
    // diálogo do level 8 reapareceria a cada login. Mutação que mata: tirar o espalhamento.
    const issuedWith = async (vocation: string | null) => {
      const issue = vi.fn(async (..._args: unknown[]) => ISSUED);
      const response = await post(build({
        tickets: { issue } as never,
        withOwnedCharacter: (async (
          _accountId: string,
          _characterId: string,
          operation: (character: typeof CHARACTER) => unknown,
        ) => operation({ ...CHARACTER, vocation })) as never,
      }), { characterId: 'p1' });
      expect(response.statusCode).toBe(200);
      return issue.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    };

    expect(await issuedWith('knight')).toMatchObject({ vocation: 'knight' });
    expect(await issuedWith(null)).not.toHaveProperty('vocation');
  });

  it('deriva o Premium do personagem de `premiumUntil`, contra o relógio (#400, D3)', async () => {
    // O `api` resolve a data e o `game` lê só o boolean (a sessão nunca compara datas). Ativo
    // vira `premium: true`; `null` ou vencido vira AUSENTE — que a sessão trata como Free.
    const issuedWith = async (premiumUntil: Date | null) => {
      const issue = vi.fn(async (..._args: unknown[]) => ISSUED);
      const response = await post(build({
        tickets: { issue } as never,
        withOwnedCharacter: (async (
          _accountId: string,
          _characterId: string,
          operation: (character: typeof CHARACTER) => unknown,
        ) => operation({ ...CHARACTER, premiumUntil })) as never,
      }), { characterId: 'p1' });
      expect(response.statusCode).toBe(200);
      return issue.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    };

    expect(await issuedWith(new Date(Date.now() + 60_000))).toMatchObject({ premium: true });
    expect(await issuedWith(null)).not.toHaveProperty('premium');
    expect(await issuedWith(new Date(Date.now() - 60_000))).not.toHaveProperty('premium');
  });

  it('leva o bônus de Loyalty da CONTA do chamador, e nada quando a conta não tem degrau (#628)', async () => {
    // A idade da conta é da CONTA, e a rota a pede com o `accountId` autenticado — nunca com o
    // que vem no corpo. Sem degrau (ou sem o sistema ligado) o resolver devolve `undefined` e o
    // ticket sai idêntico ao de antes desta issue.
    const issuedWith = async (loyaltyBonusPercentOf?: (accountId: string) => Promise<number | undefined>) => {
      const issue = vi.fn(async (..._args: unknown[]) => ISSUED);
      const response = await post(build({
        tickets: { issue } as never,
        ...(loyaltyBonusPercentOf === undefined ? {} : { loyaltyBonusPercentOf }),
      }), { characterId: 'p1' });
      expect(response.statusCode).toBe(200);
      return issue.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    };

    const seen: string[] = [];
    expect(await issuedWith(async (accountId) => { seen.push(accountId); return 15; }))
      .toMatchObject({ loyaltyBonusPercent: 15 });
    expect(seen).toEqual(['a1']);
    expect(await issuedWith(async () => undefined)).not.toHaveProperty('loyaltyBonusPercent');
    expect(await issuedWith()).not.toHaveProperty('loyaltyBonusPercent');
  });

  it('reconstrói os containers pela posição gravada; a linha sem posição entra no primeiro lugar livre (#160)', async () => {
    // Mutação que mata: ignorar `container`/`slotIndex` (tudo cairia na lista plana), ou
    // perder a linha antiga em vez de encaixá-la.
    const row = (
      id: string, slot: string | null, container: string | null, slotIndex: number | null,
      overlay: unknown = null,
    ) => ({
      id, itemId: 'rock', ownerCharacterId: 'p1', quantity: 1, origin: 'loot', equippedSlot: slot,
      container, slotIndex, overlay, createdAt: new Date(0),
    });
    const issue = vi.fn(async (..._args: unknown[]) => ISSUED);
    const response = await post(build({
      tickets: { issue } as never,
      listItemInstances: async () => [
        row('a', null, 'backpack', 3),
        row('b', null, 'satchel', 0),
        row('old', null, null, null),
        row('dup', null, 'backpack', 3),
        // O overlay por instância (#604): válido atravessa; torto vira ausente, sem trancar o login.
        row('worn', 'hand', null, null, { imbuements: [{ slot: 0, typeId: 'strike-basic', remainingMs: 1000 }] }),
        row('bad', null, 'satchel', 1, { imbuements: 'torto' }),
      ],
    }), { characterId: 'p1' });
    expect(response.statusCode).toBe(200);
    const inventory = (issue.mock.calls[0]?.[2] as { inventory: { backpack: unknown[]; satchel: unknown[]; equipped: Record<string, unknown> } }).inventory;
    expect(inventory.backpack[3]).toMatchObject({ instanceId: 'a' });
    expect(inventory.satchel[0]).toMatchObject({ instanceId: 'b' });
    expect(inventory.equipped['hand']).toMatchObject({
      instanceId: 'worn', overlay: { imbuements: [{ slot: 0, typeId: 'strike-basic', remainingMs: 1000 }] },
    });
    expect(inventory.satchel[1]).toEqual({ instanceId: 'bad', itemId: 'rock', quantity: 1 });
    expect(inventory.satchel[0]).not.toHaveProperty('overlay');
    // As duas sem lugar — a antiga e a que colidiu — entram nos primeiros vazios da mochila.
    expect(inventory.backpack[0]).toMatchObject({ instanceId: 'old' });
    expect(inventory.backpack[1]).toMatchObject({ instanceId: 'dup' });
    expect(inventory.backpack[2]).toBeNull();
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

describe('POST /api/tickets: o gasto do banco de offline training (#631, ADR 0059 d.3-d.4)', () => {
  const HOUR = 3_600_000;
  const NOW = 1_000 * HOUR;
  const rules = offlineTrainingRulesOf(trainingTestContent()) as NonNullable<ReturnType<typeof offlineTrainingRulesOf>>;
  const bank = (offlineBankMs: number, offlineSkill: string | null = 'sword') =>
    ({ offlineBankMs, offlineSkill, version: 1 });

  /**
   * A rota com Treino: o personagem VEM da linha (`row`), o carimbo de repouso é `restedSince`, e o
   * `writer` grava o que a rota mandou escrever — a mesma forma de `withOwnedCharacter` de verdade.
   */
  function scenario(options: {
    row?: Partial<CharacterRecord>;
    restedSinceMs?: number | null;
    resting?: boolean;
    issued?: IssueResult;
  } = {}) {
    const writes: Array<{ training: unknown; skills?: unknown; at: Date }> = [];
    const issue = vi.fn(async (..._args: unknown[]) => options.issued ?? ISSUED);
    const restedSince = vi.fn(async () => options.restedSinceMs === undefined ? null : options.restedSinceMs);
    const app = build({
      tickets: {
        issue,
        resolveNode: async () => ({ ok: true, node: NODE, resting: options.resting ?? true }),
      } as never,
      withOwnedCharacter: (async (
        _accountId: string,
        _characterId: string,
        operation: (character: CharacterRecord, writer: unknown) => unknown,
      ) => operation({ ...CHARACTER, ...options.row }, {
        applyOfflineTraining: async (update: { training: unknown; skills?: unknown; at: Date }) => { writes.push(update); },
      })) as never,
      offlineTraining: { rules, restedSince, now: () => NOW },
    });
    const ticketOf = () => issue.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    return { app, writes, issue, restedSince, ticketOf };
  }

  it('gasta o banco com o personagem em repouso: o ticket leva as skills e o banco novos, e a MESMA transação os grava', async () => {
    // 2 h fora, banco de 3 h, skill sword: treina `min(2 h, 3 h, 6 h do Free)` = 2 h. O golpe é a
    // cada 2 s e a melee rende `/ 2`: 7 200 s / 2 s / 2 = 1 800 tries de sword.
    const s = scenario({ row: { training: bank(3 * HOUR) }, restedSinceMs: NOW - 2 * HOUR });
    const response = await post(s.app, { characterId: 'p1' });

    expect(response.statusCode).toBe(200);
    const ticket = s.ticketOf() as { skills: Record<string, { level: number; points: number }>; training: unknown };
    expect(ticket.training).toEqual(bank(1 * HOUR, null));
    // A escolha do livro é CONSUMIDA (`null`): o mesmo ticket reemitido não gasta de novo.
    expect(ticket.skills['sword']?.level).toBeGreaterThan(10);
    expect(s.writes).toHaveLength(1);
    expect(s.writes[0]?.training).toEqual(bank(1 * HOUR, null));
    expect(s.writes[0]?.skills).toEqual(ticket.skills);
    expect(s.writes[0]?.at).toEqual(new Date(NOW));
  });

  it('o teto é o da CONTA: Free 6 h, Premium 12 h (ADR 0059 d.4), mesmo com banco e ausência maiores', async () => {
    const tempoTreinado = async (premiumUntil: Date | null) => {
      const s = scenario({
        row: { training: bank(12 * HOUR), premiumUntil }, restedSinceMs: NOW - 20 * HOUR,
      });
      await post(s.app, { characterId: 'p1' });
      return (s.ticketOf() as { training: { offlineBankMs: number } }).training.offlineBankMs;
    };
    // Free: gasta 6 h de 12 h; sobram 6 h. Premium (válido em NOW): gasta 12 h; sobra 0.
    expect(await tempoTreinado(null)).toBe(6 * HOUR);
    expect(await tempoTreinado(new Date(NOW + HOUR))).toBe(0);
    // Premium VENCIDO é Free.
    expect(await tempoTreinado(new Date(NOW - HOUR))).toBe(6 * HOUR);
  });

  it('dentro da carência (menos de 10 min fora) a escolha é consumida, o banco fica e nenhuma skill sobe', async () => {
    const s = scenario({ row: { training: bank(3 * HOUR) }, restedSinceMs: NOW - 5 * 60_000 });
    await post(s.app, { characterId: 'p1' });

    expect(s.writes).toHaveLength(1);
    expect(s.writes[0]?.training).toEqual(bank(3 * HOUR, null));
    // Nada rendeu: as skills e o instante delas NÃO são reescritos.
    expect(s.writes[0]).not.toHaveProperty('skills');
  });

  it('sem carimbo de repouso — Redis reiniciado, sessão que caiu sem `release` — o banco NÃO é gasto e nada é escrito', async () => {
    const s = scenario({ row: { training: bank(3 * HOUR) }, restedSinceMs: null });
    await post(s.app, { characterId: 'p1' });

    expect(s.writes).toEqual([]);
    // O ticket leva o registro como está: o tempo continua no banco, e a escolha do livro também.
    expect(s.ticketOf()).toMatchObject({ training: bank(3 * HOUR) });
  });

  it('personagem que ainda tem sessão hospedada não está em repouso: nem consulta o carimbo, nem escreve (invariante 9)', async () => {
    const s = scenario({ row: { training: bank(3 * HOUR) }, restedSinceMs: NOW - 2 * HOUR, resting: false });
    await post(s.app, { characterId: 'p1' });

    expect(s.restedSince).not.toHaveBeenCalled();
    expect(s.writes).toEqual([]);
    expect(s.ticketOf()).toMatchObject({ training: bank(3 * HOUR) });
  });

  it('sem skill escolhida no livro não há o que gastar — e a linha não é tocada', async () => {
    const s = scenario({ row: { training: bank(3 * HOUR, null) }, restedSinceMs: NOW - 2 * HOUR });
    await post(s.app, { characterId: 'p1' });
    expect(s.writes).toEqual([]);
  });

  it('personagem que nunca caçou (sem registro) segue como sempre', async () => {
    const s = scenario({ row: { training: null }, restedSinceMs: NOW - 2 * HOUR });
    const response = await post(s.app, { characterId: 'p1' });
    expect(response.statusCode).toBe(200);
    expect(s.writes).toEqual([]);
    expect(s.ticketOf()).not.toHaveProperty('training');
  });

  it('ticket recusado (active-limit) não gasta o banco: a escolha do livro fica para o próximo login', async () => {
    const s = scenario({
      row: { training: bank(3 * HOUR) }, restedSinceMs: NOW - 2 * HOUR,
      issued: { ok: false, reason: 'active-limit' },
    });
    const response = await post(s.app, { characterId: 'p1' });
    expect(response.statusCode).toBe(409);
    expect(s.writes).toEqual([]);
  });

  it('um registro torto na linha vira ausente no ticket e não trava o login', async () => {
    const s = scenario({ row: { training: { offlineBankMs: -5, offlineSkill: 7 } }, restedSinceMs: NOW - HOUR });
    const response = await post(s.app, { characterId: 'p1' });
    expect(response.statusCode).toBe(200);
    expect(s.ticketOf()).not.toHaveProperty('training');
    expect(s.writes).toEqual([]);
  });
});
