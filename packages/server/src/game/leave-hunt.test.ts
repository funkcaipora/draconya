// O `leave-hunt` do jogador passa pelo `requestExit` do ruleset (#802).
//
// Até esta issue o opcode encerrava a sessão direto (`session.end`/`session.leave`), então o
// `exitDelayMs` e a trava de combate de 60 s (#625, `CONDITION_INFIGHT` do Canary) só valiam
// para a saída automática do bot. Aqui a hunt é a REAL (`createHuntSession`), com o host de
// verdade e o construtor de sessão de produção (`createSessionBuilder`) — o `sim` prova a
// matemática da espera em `hunt.test.ts`; este arquivo prova o CANAL: o que o socket recebe, o
// que o host grava, e que a saída conclui com ou sem alguém olhando (invariante 3).
//
// Tempo dirigido pelo relógio injetado, nunca dormido (invariante 2).

import { CharacterRuntime, createHuntSession } from '@draconya/sim';
import type { HuntRuleset, Session } from '@draconya/sim';
import { BOT_VOCABULARY_VERSION_V1, botConfigSchema, buildContent } from '@draconya/content';
import type { BotConfig, RawContent } from '@draconya/content';
import type { S2CMessage } from '@draconya/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../log.js';
import type { SessionDirectory, SessionLocation } from '../directory.js';
import type { ReceiptStore } from '../receipts.js';
import { SessionHost } from './host.js';
import { CityShard, createSessionBuilder } from './sessions.js';
import { FakeSocket } from './testing.js';
import { TEST_HUNT, TEST_PROGRESSION, TEST_ROUTE, rawTestContent } from '../testing/content.js';

const logger = createLogger('silent', 'test');

const ofType = <T extends S2CMessage['type']>(messages: readonly S2CMessage[], type: T) =>
  messages.filter((m): m is Extract<S2CMessage, { type: T }> => m.type === type);

interface Saved { characterId: string; sessionId: string; reason: string }

/**
 * Uma hunt real sem monstro nenhum — o assunto aqui é a saída, e não o combate: quem quer estar
 * "em combate" carimba `lastCombatActionAtMs` no personagem, como os testes do `sim` fazem.
 *
 * Com mais de um id é uma PARTY (`partyOptions`): os personagens são donos da MESMA sessão, como
 * o ticket de party os põe.
 */
function fixture(options: {
  exitDelayMs?: number;
  members?: readonly string[];
  /** Quem leva a regra de saída `party-member-lost` (§13.9): sai junto quando outro membro sai. */
  exitOnLoss?: readonly string[];
  /** As primeiras N gravações de extrato FALHAM (o Redis que pisca) — a sucessão que não fecha. */
  failSaves?: number;
} = {}) {
  const members = options.members ?? ['hero'];
  const raw = rawTestContent();
  const shaped: RawContent = {
    ...raw,
    routes: [{ ...TEST_ROUTE, spawnPoints: [] }],
    hunts: [{ ...TEST_HUNT, ...(options.exitDelayMs === undefined ? {} : { exitDelayMs: options.exitDelayMs }) }],
    progression: [{
      ...TEST_PROGRESSION,
      regen: { health: { ticksMs: 1000, amount: 0 }, mana: { ticksMs: 1000, amount: 0 } },
    }],
  };
  const content = buildContent(shaped);

  let now = 0;
  const saved: Saved[] = [];
  let failuresLeft = options.failSaves ?? 0;
  const receipts = {
    save: async (r: Saved) => {
      if (failuresLeft > 0) { failuresLeft -= 1; throw new Error('receipt store unavailable'); }
      saved.push({ characterId: r.characterId, sessionId: r.sessionId, reason: r.reason });
    },
  } as unknown as ReceiptStore;
  const exitOnLoss: BotConfig = botConfigSchema.parse({
    version: BOT_VOCABULARY_VERSION_V1,
    heal: [], potion: [], attack: [], rune: [], support: [],
    exit: [{ kind: 'party-member-lost' }],
  });
  const character = (id: string) => new CharacterRuntime({
    id, position: { x: 1, y: 1, z: 7 }, health: 1_000, maxHealth: 1_000, mana: 0, maxMana: 0,
    level: 8, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
  });

  let shared: Session | null = null;
  const huntFor = (characterId: string): Session => {
    if (shared === null) {
      shared = createHuntSession({
        id: 'hunt-1', content, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
        ...(members.length > 1 ? { partyOptions: { leaderId: members[0] as string, mode: 'shared' as const } } : {}),
        ...(options.exitOnLoss === undefined
          ? {}
          : { botConfigs: Object.fromEntries(options.exitOnLoss.map((id) => [id, exitOnLoss])) }),
      });
      for (const id of members) shared.enter(character(id));
    }
    void characterId;
    return shared;
  };
  // O diretório com a CAS de verdade: `succeed` só troca se o registro ainda é o da origem. Sem
  // ele uma corrida entre duas sucessões passa em silêncio — é a que perde que SOLTA o personagem.
  const located = new Map<string, string>();
  const released: string[] = [];
  const directory = {
    register: async (characterId: string, location: SessionLocation) => {
      located.set(characterId, location.sessionId);
      return true;
    },
    succeed: async (characterId: string, _accountId: string, from: SessionLocation, to: SessionLocation) => {
      if (located.get(characterId) !== from.sessionId) return false;
      located.set(characterId, to.sessionId);
      return true;
    },
    release: async (characterId: string) => { released.push(characterId); located.delete(characterId); },
    releaseSlot: async () => {},
    renew: async () => {},
  } as unknown as SessionDirectory;
  const cityShard = new CityShard(content, () => now);
  const host = new SessionHost({
    nodeId: 'n1', contentVersion: content.version, logger, now: () => now, receipts, directory,
    monsterCatalog: content.monsters, skillCatalog: content.skills,
    createSession: huntFor,
    buildSession: createSessionBuilder(content, () => now, cityShard),
  });

  const runFor = (ms: number, step = 100) => {
    for (let t = 0; t < ms; t += step) { now += step; host.cycle(); }
    host.flush();
  };
  /** Deixa as promessas do host (extrato, troca de sessão) terminarem. */
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
  };
  const hunt = () => shared as Session;
  const ruleset = () => hunt().ruleset as HuntRuleset;
  const typeOf = (characterId: string) => host.sessionFor(characterId)?.ruleset.type;
  return { host, saved, released, runFor, settle, hunt, ruleset, typeOf, now: () => now, character };
}

/** Prepara e anexa um personagem; devolve o socket e o viewer. */
async function attach(f: ReturnType<typeof fixture>, characterId = 'hero') {
  await f.host.prepare(characterId, undefined, `acc-${characterId}`);
  const socket = new FakeSocket();
  const viewer = f.host.attach(socket, characterId);
  f.host.handle(viewer, { type: 'session-attach' });
  f.host.flush();
  socket.frames.length = 0;
  return { socket, viewer };
}

describe('leave-hunt pede a saída ao ruleset (#802)', () => {
  it('com exitDelayMs, a sessão continua durante a contagem e o cliente recebe `exit-pending`', async () => {
    const f = fixture({ exitDelayMs: 5_000 });
    const { socket, viewer } = await attach(f);

    f.host.handle(viewer, { type: 'leave-hunt' });
    f.host.flush();
    // Nada encerrou: o host só PEDIU.
    expect(f.typeOf('hero')).toBe('hunt');
    expect(f.hunt().ended).toBeNull();
    expect(ofType(socket.received(), 'exit-pending')).toEqual([
      { type: 'exit-pending', active: true, reason: 'manual-exit', phase: 'countdown', remainingMs: 5_000 },
    ]);

    f.runFor(4_900);
    await f.settle();
    expect(f.typeOf('hero')).toBe('hunt');
    expect(f.saved).toEqual([]);

    // No prazo, a sessão conclui e o personagem volta para a Cidade — a sucessão de sempre.
    f.runFor(200);
    await f.settle();
    expect(f.typeOf('hero')).toBe('city');
    expect(f.saved).toEqual([{ characterId: 'hero', sessionId: 'hunt-1', reason: 'manual-exit' }]);
    f.host.flush();
    expect(ofType(socket.received(), 'session-ended').map((m) => m.reason)).toEqual(['manual-exit']);
    expect(socket.ended).toBeNull();
  });

  it('sem exitDelayMs e fora de combate, a saída conclui na hora (o solo de sempre)', async () => {
    const f = fixture();
    const { socket, viewer } = await attach(f);

    f.host.handle(viewer, { type: 'leave-hunt' });
    await vi.waitFor(() => { expect(f.typeOf('hero')).toBe('city'); });
    expect(f.saved).toEqual([{ characterId: 'hero', sessionId: 'hunt-1', reason: 'manual-exit' }]);
    f.host.flush();
    expect(ofType(socket.received(), 'exit-pending')).toEqual([]);
    expect(ofType(socket.received(), 'session-ended')).toHaveLength(1);
  });

  it('o segundo clique de uma saída que concluiu na hora não solta o personagem', async () => {
    // Mutação que mata: deixar o segundo `leave-hunt` cair na transição enquanto a sucessão do
    // primeiro corre — as duas disputariam o diretório, e a que perde SOLTA o personagem.
    const f = fixture();
    const { socket, viewer } = await attach(f);

    f.host.handle(viewer, { type: 'leave-hunt' });
    f.host.handle(viewer, { type: 'leave-hunt' });
    await f.settle();
    f.host.flush();

    expect(f.typeOf('hero')).toBe('city');
    expect(f.saved).toEqual([{ characterId: 'hero', sessionId: 'hunt-1', reason: 'manual-exit' }]);
    expect(f.released).toEqual([]);
    expect(socket.ended).toBeNull();
    expect(ofType(socket.received(), 'system-message')).toEqual([]);
  });

  it('em combate, a saída NÃO conclui antes de 60 s do último golpe — mesmo sem exitDelayMs', async () => {
    const f = fixture();
    const { socket, viewer } = await attach(f);
    f.runFor(1_000);
    const hero = f.hunt().participants[0] as CharacterRuntime;
    hero.lastCombatActionAtMs = f.hunt().nowMs;
    const lastHitAt = hero.lastCombatActionAtMs;

    f.host.handle(viewer, { type: 'leave-hunt' });
    f.host.flush();
    expect(ofType(socket.received(), 'exit-pending')).toEqual([
      { type: 'exit-pending', active: true, reason: 'manual-exit', phase: 'in-combat', remainingMs: 60_000 },
    ]);

    // A 59,9 s do golpe ainda em combate: nada de extrato, nada de Cidade.
    f.runFor(lastHitAt + 59_900 - f.hunt().nowMs);
    await f.settle();
    expect(f.typeOf('hero')).toBe('hunt');
    expect(f.hunt().ended).toBeNull();
    expect(f.saved).toEqual([]);

    // Aos 60 s a trava libera.
    f.runFor(200);
    await f.settle();
    expect(f.typeOf('hero')).toBe('city');
    expect(f.saved.map((s) => s.reason)).toEqual(['manual-exit']);
  });

  it('um golpe novo durante a espera empurra o prazo, e o cliente recebe o `exit-pending` novo', async () => {
    const f = fixture();
    const { socket, viewer } = await attach(f);
    f.runFor(1_000);
    const hero = f.hunt().participants[0] as CharacterRuntime;
    hero.lastCombatActionAtMs = f.hunt().nowMs;
    f.host.handle(viewer, { type: 'leave-hunt' });
    f.runFor(30_000);
    socket.frames.length = 0;

    // O golpe novo chega aos 31 s; a previsão passa de 60 s para 90 s do início.
    hero.lastCombatActionAtMs = f.hunt().nowMs;
    f.runFor(200);
    const [pushed] = ofType(socket.received(), 'exit-pending');
    expect(pushed).toMatchObject({ active: true, phase: 'in-combat' });
    expect(pushed?.remainingMs).toBeGreaterThan(59_000);
    expect(pushed?.remainingMs).toBeLessThanOrEqual(60_000);

    // Passa dos 60 s do PRIMEIRO golpe (t = 61 s, quando a trava antiga venceria): ainda em
    // combate, porque o golpe novo empurrou o prazo para 91 s. Mutação que mata: tirar o segundo
    // golpe — sem ele a saída conclui aos 61 s e este `expect` falha.
    f.runFor(30_000);
    await f.settle();
    expect(f.now()).toBeGreaterThan(61_000);
    expect(f.typeOf('hero')).toBe('hunt');
    expect(f.saved).toEqual([]);

    // E conclui no prazo empurrado, e não antes dele.
    f.runFor(29_600);
    await f.settle();
    expect(f.typeOf('hero')).toBe('hunt');
    f.runFor(500);
    await f.settle();
    expect(f.typeOf('hero')).toBe('city');
    expect(f.saved.map((s) => s.reason)).toEqual(['manual-exit']);
  });

  it('cancel-exit desfaz a saída: `exit-pending { active: false }`, e a hunt segue depois do prazo', async () => {
    const f = fixture({ exitDelayMs: 5_000 });
    const { socket, viewer } = await attach(f);
    f.host.handle(viewer, { type: 'leave-hunt' });
    f.runFor(2_000);
    socket.frames.length = 0;

    f.host.handle(viewer, { type: 'cancel-exit' });
    f.host.flush();
    expect(ofType(socket.received(), 'exit-pending')).toEqual([{ type: 'exit-pending', active: false }]);

    f.runFor(60_000);
    await f.settle();
    expect(f.typeOf('hero')).toBe('hunt');
    expect(f.saved).toEqual([]);

    // Cancelar sem nada pendente é um no-op: nenhuma mensagem, nenhuma recusa.
    socket.frames.length = 0;
    f.host.handle(viewer, { type: 'cancel-exit' });
    f.host.flush();
    expect(socket.received()).toEqual([]);
  });

  it('pedir a saída duas vezes não reinicia a contagem', async () => {
    const f = fixture({ exitDelayMs: 5_000 });
    const { viewer } = await attach(f);
    f.host.handle(viewer, { type: 'leave-hunt' });
    f.runFor(3_000);
    f.host.handle(viewer, { type: 'leave-hunt' });
    f.runFor(2_100);
    await f.settle();
    // 5 s desde o PRIMEIRO pedido — o segundo não empurrou nada.
    expect(f.typeOf('hero')).toBe('city');
  });

  it('idle-first: o jogador que pede a saída e desanexa sai do mesmo jeito, no mesmo instante', async () => {
    // Invariante 3. A espera é um evento da fila do `sim`: sem nenhum visualizador ela vence
    // igual, e a sucessão (extrato, Cidade) roda sem ninguém olhando.
    const f = fixture({ exitDelayMs: 5_000 });
    const { viewer } = await attach(f);
    f.host.handle(viewer, { type: 'leave-hunt' });
    f.host.detach(viewer);

    f.runFor(4_000);
    await f.settle();
    expect(f.typeOf('hero')).toBe('hunt');
    f.runFor(2_000);
    await f.settle();
    expect(f.typeOf('hero')).toBe('city');
    expect(f.saved).toEqual([{ characterId: 'hero', sessionId: 'hunt-1', reason: 'manual-exit' }]);
  });

  it('reanexar no meio da espera devolve `exit-pending` com o que falta agora', async () => {
    const f = fixture({ exitDelayMs: 5_000 });
    const first = await attach(f);
    f.host.handle(first.viewer, { type: 'leave-hunt' });
    f.host.detach(first.viewer);
    f.runFor(3_000);

    const socket = new FakeSocket();
    const viewer = f.host.attach(socket, 'hero');
    f.host.handle(viewer, { type: 'session-attach' });
    f.host.flush();
    const [pending] = ofType(socket.received(), 'exit-pending');
    expect(pending).toMatchObject({ active: true, reason: 'manual-exit', phase: 'countdown' });
    expect(pending?.remainingMs).toBeGreaterThan(1_000);
    expect(pending?.remainingMs).toBeLessThanOrEqual(2_000);
  });

  it('attach sem saída pendente não manda `exit-pending` nenhum', async () => {
    const f = fixture({ exitDelayMs: 5_000 });
    const { socket } = await attach(f);
    f.host.flush();
    expect(ofType(socket.received(), 'exit-pending')).toEqual([]);
  });

  it('leave-hunt na Cidade continua recusado com aviso (nada a pedir ao ruleset)', async () => {
    const f = fixture();
    const { socket, viewer } = await attach(f);
    f.host.handle(viewer, { type: 'leave-hunt' });
    await vi.waitFor(() => { expect(f.typeOf('hero')).toBe('city'); });
    f.host.flush();
    socket.frames.length = 0;

    f.host.handle(viewer, { type: 'leave-hunt' });
    await vi.waitFor(() => {
      f.host.flush();
      expect(ofType(socket.received(), 'system-message').length).toBeGreaterThan(0);
    });
    expect(f.typeOf('hero')).toBe('city');
  });
});

describe('leave-hunt numa party (#802)', () => {
  it('quem sai espera a contagem, leva o extrato DELE para a Cidade, e a hunt continua para o outro', async () => {
    const f = fixture({ exitDelayMs: 5_000, members: ['a', 'b'] });
    const a = await attach(f, 'a');
    await attach(f, 'b');

    f.host.handle(a.viewer, { type: 'leave-hunt' });
    f.runFor(4_000);
    await f.settle();
    expect(f.typeOf('a')).toBe('hunt');
    expect(f.saved).toEqual([]);

    f.runFor(1_500);
    await f.settle();
    // Um extrato, o dele; a sessão segue com o outro dono.
    expect(f.saved).toEqual([{ characterId: 'a', sessionId: 'hunt-1', reason: 'manual-exit' }]);
    expect(f.typeOf('a')).toBe('city');
    expect(f.hunt().ended).toBeNull();
    expect(f.hunt().participants.map((p) => p.id)).toEqual(['b']);
    expect(f.typeOf('b')).toBe('hunt');
  });

  it('em combate, quem sai da party espera a janela de 60 s — e só ele', async () => {
    const f = fixture({ members: ['a', 'b'] });
    const a = await attach(f, 'a');
    await attach(f, 'b');
    f.runFor(1_000);
    const hero = f.hunt().participants.find((p) => p.id === 'a') as CharacterRuntime;
    hero.lastCombatActionAtMs = f.hunt().nowMs;

    f.host.handle(a.viewer, { type: 'leave-hunt' });
    f.runFor(30_000);
    await f.settle();
    expect(f.typeOf('a')).toBe('hunt');
    expect(f.hunt().participants).toHaveLength(2);

    f.runFor(30_500);
    await f.settle();
    expect(f.typeOf('a')).toBe('city');
    expect(f.typeOf('b')).toBe('hunt');
  });
});

describe('quem sai da party por dentro do sim vai para a Cidade, e a party não acaba (#802)', () => {
  it('member-left (morte) com o construtor de produção: o morto é movido, e o outro segue', async () => {
    // O construtor de produção procurava o personagem em `from.participants` — e quem saiu por
    // dentro do `sim` já não está lá. Devolvia `null`, o host caía no `release`, e o `release`
    // de uma sessão privada ENCERRA a sessão inteira: a saída de UM membro acabava a party.
    const f = fixture({ members: ['a', 'b'] });
    await attach(f, 'a');
    await attach(f, 'b');
    const departure = f.hunt().leave('b', 'death');
    if (departure === null) throw new Error('b devia poder sair');
    f.hunt().emit({ kind: 'member-left', characterId: 'b', reason: 'death', departure });
    f.runFor(2_000);
    await f.settle();

    expect(f.saved.map((s) => s.characterId)).toEqual(['b']);
    expect(f.typeOf('b')).toBe('city');
    expect(f.hunt().ended).toBeNull();
    expect(f.typeOf('a')).toBe('hunt');
  });
});

describe('a saída imediata que encerra a sessão não perde o extrato de quem saiu (#802)', () => {
  // `requestExit` conclui NA HORA (sem `exitDelayMs`, fora de combate) e o `#depart` do membro
  // pode encerrar a sessão na mesma chamada. O `member-left` dele fica na fila do `sim`, e o
  // ciclo não visita mais sessão encerrada: o host tem que drená-lo ANTES de disparar a sucessão.
  const bySaved = (saved: readonly Saved[]) =>
    [...saved].sort((x, y) => x.characterId.localeCompare(y.characterId));

  it('o voto de encerrar que a saída de quem faltava completa: os três extratos, os três na Cidade', async () => {
    // Party de três; o líder propõe, `b` aprova, `c` NÃO aprovou — e sai. Sem `c` entre os
    // presentes o voto passa a ser unânime e a sessão acaba com `party-vote`, dentro do
    // `requestExit`. Mutação que mata: checar `ended` antes de drenar os `member-left` — o extrato
    // de `c` (XP, gold, ledger) some, e ele fica preso numa hunt que já acabou.
    const f = fixture({ members: ['a', 'b', 'c'] });
    const a = await attach(f, 'a');
    const b = await attach(f, 'b');
    const c = await attach(f, 'c');
    f.runFor(1_000);

    f.host.handle(a.viewer, { type: 'party-end-vote', approve: true });
    f.host.handle(b.viewer, { type: 'party-end-vote', approve: true });
    expect(f.hunt().ended).toBeNull();

    f.host.handle(c.viewer, { type: 'leave-hunt' });
    await f.settle();

    expect(f.hunt().ended).toBe('party-vote');
    expect(bySaved(f.saved)).toEqual([
      { characterId: 'a', sessionId: 'hunt-1', reason: 'party-vote' },
      { characterId: 'b', sessionId: 'hunt-1', reason: 'party-vote' },
      { characterId: 'c', sessionId: 'hunt-1', reason: 'manual-exit' },
    ]);
    expect(f.typeOf('a')).toBe('city');
    expect(f.typeOf('b')).toBe('city');
    expect(f.typeOf('c')).toBe('city');
    expect(f.released).toEqual([]);
    f.host.flush();
    expect(ofType(c.socket.received(), 'session-ended').map((m) => m.reason)).toEqual(['manual-exit']);
  });

  it('party-member-lost que esvazia a party: quem saiu e quem foi na cascata salvam o extrato', async () => {
    // Dois membros; `b` tem a regra "alguém do grupo saiu". A saída imediata de `a` derruba `b` em
    // cascata, `participants` fica vazio e a sessão acaba com `exit-rule` — sem NENHUM presente
    // para `session.receipts()`. Os dois extratos só existem nos `member-left`.
    const f = fixture({ members: ['a', 'b'], exitOnLoss: ['b'] });
    const a = await attach(f, 'a');
    await attach(f, 'b');
    f.runFor(1_000);

    f.host.handle(a.viewer, { type: 'leave-hunt' });
    await f.settle();

    expect(f.hunt().ended).toBe('exit-rule');
    expect(bySaved(f.saved)).toEqual([
      { characterId: 'a', sessionId: 'hunt-1', reason: 'manual-exit' },
      { characterId: 'b', sessionId: 'hunt-1', reason: 'exit-rule' },
    ]);
    expect(f.typeOf('a')).toBe('city');
    expect(f.typeOf('b')).toBe('city');
    expect(f.released).toEqual([]);
  });

  it('o mesmo caminho SEM visualizador (idle-first): a fila é drenada e os extratos salvos', async () => {
    // Invariante 3: nada disso depende de alguém assistindo. `#presentMoves` sem visualizador
    // enfileira os `member-left` em `departures`, e é essa fila que a saída imediata drena.
    const f = fixture({ members: ['a', 'b'], exitOnLoss: ['b'] });
    const a = await attach(f, 'a');
    const b = await attach(f, 'b');
    f.runFor(1_000);
    f.host.handle(a.viewer, { type: 'leave-hunt' });
    f.host.detach(a.viewer);
    f.host.detach(b.viewer);
    await f.settle();

    expect(bySaved(f.saved).map((s) => s.characterId)).toEqual(['a', 'b']);
    expect(f.typeOf('a')).toBe('city');
    expect(f.typeOf('b')).toBe('city');
  });
});

describe('leave-hunt depois de uma sucessão que falhou (#802)', () => {
  it('o segundo clique é o retry manual: grava o extrato e leva o personagem à Cidade', async () => {
    // A primeira gravação falha (Redis piscando): a sessão está encerrada, o personagem continua
    // nela, e o ciclo a ignora. Antes do #802 o segundo clique passava pela transição e
    // recuperava; o guarda `ended` do host o engolia em silêncio. Mutação que mata: voltar a
    // `if (ended !== null) return` sem distinguir "em voo" de "falhou".
    const f = fixture({ failSaves: 1 });
    const { viewer } = await attach(f);

    f.host.handle(viewer, { type: 'leave-hunt' });
    await f.settle();
    expect(f.hunt().ended).toBe('manual-exit');
    expect(f.saved).toEqual([]);
    expect(f.typeOf('hero')).toBe('hunt');

    f.host.handle(viewer, { type: 'leave-hunt' });
    await f.settle();
    expect(f.saved).toEqual([{ characterId: 'hero', sessionId: 'hunt-1', reason: 'manual-exit' }]);
    expect(f.typeOf('hero')).toBe('city');
    expect(f.released).toEqual([]);
  });
});
