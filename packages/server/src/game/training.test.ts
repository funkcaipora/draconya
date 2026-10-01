// O Treino de ponta a ponta no hospedeiro (#631, M44-13; ADR 0059): comprar a exercise weapon na
// Cidade, entrar na sessão de Treino, deixá-la correr por eventos até a arma acabar, e voltar à
// Cidade com a skill creditada e o banco de offline training cheio.
//
// A Cidade e a sessão de Treino são as REAIS (`CityShard`, `createSessionBuilder`, `TrainingRuleset`),
// com o host de verdade — o `sim` prova a matemática do golpe em `training.test.ts`; este arquivo
// prova o CANAL: o que o socket recebe, o que o host grava no extrato, e que a compra feita na praça
// chega ao banco antes de o personagem sair dela. Tempo dirigido pelo relógio injetado (invariante 2).

import type { CharacterRuntime } from '@draconya/sim';
import type { S2CMessage } from '@draconya/protocol';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../log.js';
import type { SessionDirectory, SessionLocation } from '../directory.js';
import type { ReceiptStore, SessionReceipt } from '../receipts.js';
import type { InitialCharacter } from '../tickets.js';
import { SessionHost } from './host.js';
import { CityShard, createCitySessionFactory, createSessionBuilder } from './sessions.js';
import { buildCatalogue } from './catalogue.js';
import { FakeSocket } from './testing.js';
import { trainingTestContent } from '../testing/content.js';

const logger = createLogger('silent', 'test');

const ofType = <T extends S2CMessage['type']>(messages: readonly S2CMessage[], type: T) =>
  messages.filter((m): m is Extract<S2CMessage, { type: T }> => m.type === type);

function fixture(options: { gold?: number; staminaMs?: number } = {}) {
  const content = trainingTestContent();

  let now = 0;
  const saved: SessionReceipt[] = [];
  const receipts = {
    save: async (receipt: SessionReceipt) => { saved.push(receipt); },
  } as unknown as ReceiptStore;
  // O diretório com a CAS de verdade, como em `leave-hunt.test.ts`: `succeed` só troca se o
  // registro ainda é o da origem.
  const located = new Map<string, string>();
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
    release: async (characterId: string) => { located.delete(characterId); },
    releaseSlot: async () => {},
    renew: async () => {},
  } as unknown as SessionDirectory;

  const shard = new CityShard(content, () => now);
  const catalogue = buildCatalogue(content);
  const host = new SessionHost({
    nodeId: 'n1', contentVersion: content.version, logger, now: () => now, wallNow: () => now, receipts, directory,
    skillCatalog: content.skills, itemCatalog: content.items, progression: content.progression,
    ...(content.training === undefined ? {} : { training: content.training }),
    catalogue: () => catalogue,
    createSession: createCitySessionFactory(content, () => now, shard),
    buildSession: createSessionBuilder(content, () => now, shard),
  });
  const initial: InitialCharacter = {
    level: 20, xp: 0, gold: options.gold ?? 1_000,
    // A stamina só é rastreada quando o ticket a traz (`null` roda sem teto): o marco nasce no
    // instante 0 do relógio injetado, e o login materializa a partir dele.
    ...(options.staminaMs === undefined ? {} : { staminaMs: options.staminaMs, staminaUpdatedAtMs: 0 }),
    inventory: {
      backpack: [], satchel: [],
      equipped: {},
    },
  } as InitialCharacter;

  const runFor = (ms: number, step = 100) => {
    for (let t = 0; t < ms; t += step) { now += step; host.cycle(); }
    host.flush();
  };
  /** Anda o relógio sem ciclo nenhum — a Cidade não simula, e o que passa é tempo de parede. */
  const advanceClock = (ms: number) => { now += ms; };
  const settle = async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
  };
  const typeOf = (characterId: string) => host.sessionFor(characterId)?.ruleset.type;
  const hero = (): CharacterRuntime => host.sessionFor('hero')?.participants.find((p) => p.id === 'hero') as CharacterRuntime;
  return { host, saved, runFor, advanceClock, settle, typeOf, hero, content, initial, now: () => now };
}

/** Prepara e anexa o personagem; devolve o socket e o viewer, já com a fila limpa. */
async function attach(f: ReturnType<typeof fixture>, attached = true) {
  await f.host.prepare('hero', f.initial, 'acc-hero');
  const socket = new FakeSocket();
  const viewer = attached ? f.host.attach(socket, 'hero') : null;
  if (viewer !== null) f.host.handle(viewer, { type: 'session-attach' });
  f.host.flush();
  socket.frames.length = 0;
  return { socket, viewer };
}

/** Compra a exercise weapon e devolve o id da instância que nasceu. */
function buySword(f: ReturnType<typeof fixture>, viewer: NonNullable<Awaited<ReturnType<typeof attach>>['viewer']>): string {
  f.host.handle(viewer, { type: 'buy-item', itemId: 'exercise-sword' });
  f.host.flush();
  const state = f.hero().inventory.getState();
  const carried = [...state.backpack, ...(state.satchel ?? [])].find((item) => item?.itemId === 'exercise-sword');
  if (carried === null || carried === undefined) throw new Error('the purchase did not create the weapon');
  return carried.instanceId;
}

describe('comprar a exercise weapon na Cidade (#631, ADR 0059 d.2)', () => {
  it('debita o buyPrice, cria a instância `purchase` na mochila e manda o `training-state` com as cargas cheias', async () => {
    const f = fixture({ gold: 1_000 });
    const { socket, viewer } = await attach(f);

    const instanceId = buySword(f, viewer as NonNullable<typeof viewer>);

    expect(f.hero().goldDelta).toBe(-100);
    // A identidade é única por compra: o prefixo é o da sessão da praça (o que `acquiredBy` filtra),
    // com o id do PERSONAGEM e um UUID no fim — a mesma cópia é reaberta em outro dia.
    expect(instanceId).toMatch(/^.+:hero:buy:[0-9a-f-]{36}$/);
    expect(f.hero().inventory.carried(instanceId)).toMatchObject({ itemId: 'exercise-sword', origin: 'purchase' });
    const state = ofType(socket.received(), 'training-state').at(-1);
    expect(state).toEqual({
      type: 'training-state', offlineBankMs: 0, offlineSkill: null,
      weapons: [{ instanceId, itemId: 'exercise-sword', charges: 3 }], activeInstanceId: null,
    });
    // O saldo novo chega ao HUD.
    expect(ofType(socket.received(), 'player-stats').at(-1)?.gold).toBe(900);
  });

  it('duas compras são duas instâncias, com ids distintos — nunca uma pilha', async () => {
    const f = fixture({ gold: 1_000 });
    const { viewer } = await attach(f);
    buySword(f, viewer as NonNullable<typeof viewer>);
    buySword(f, viewer as NonNullable<typeof viewer>);

    const carried = f.hero().inventory.getState().satchel?.filter((item) => item?.itemId === 'exercise-sword') ?? [];
    expect(carried).toHaveLength(2);
    expect(new Set(carried.map((item) => item?.instanceId)).size).toBe(2);
    expect(f.hero().goldDelta).toBe(-200);
  });

  it('recusa sem gold, item que não está à venda e fora da Cidade — sem mexer em nada', async () => {
    const f = fixture({ gold: 50 });
    const { socket, viewer } = await attach(f);
    const send = (itemId: string) => {
      socket.frames.length = 0;
      f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'buy-item', itemId });
      f.host.flush();
      return ofType(socket.received(), 'system-message').map((m) => m.text);
    };

    expect(send('exercise-sword')).toEqual(['Você não tem gold suficiente.']);
    expect(send('rock')).toEqual(['Esse item não está à venda.']);
    expect(send('nao-existe')).toEqual(['Esse item não está à venda.']);
    expect(f.hero().goldDelta).toBe(0);
    expect(f.hero().inventory.getState().satchel?.filter(Boolean) ?? []).toEqual([]);
  });
});

describe('o livro do offline training (#631, ADR 0059 d.3)', () => {
  it('escolhe uma skill que o conteúdo oferece, desmarca com null, e recusa o resto', async () => {
    const f = fixture();
    const { socket, viewer } = await attach(f);
    const say = (skillId: string | null) => {
      socket.frames.length = 0;
      f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'set-offline-training-skill', skillId });
      f.host.flush();
      return {
        state: ofType(socket.received(), 'training-state').at(-1),
        warnings: ofType(socket.received(), 'system-message').map((m) => m.text),
      };
    };

    expect(say('sword').state?.offlineSkill).toBe('sword');
    expect(f.hero().training.skill).toBe('sword');
    // Uma skill que existe no conteúdo mas não está no livro (shielding) NÃO é escolha.
    expect(say('shielding').warnings).toEqual(['Essa skill não está no livro.']);
    expect(f.hero().training.skill).toBe('sword');
    expect(say(null).state?.offlineSkill).toBeNull();
    expect(f.hero().training.skill).toBeNull();
  });

  it('a escolha marca o personagem como sujo, e o extrato durável a leva ao ledger no logout', async () => {
    const f = fixture();
    const { viewer } = await attach(f);
    f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'set-offline-training-skill', skillId: 'magic' });
    f.host.flush();

    await f.host.release('hero', 1000, 'logout');

    expect(f.saved).toHaveLength(1);
    expect(f.saved[0]?.training).toEqual({ offlineBankMs: 0, offlineSkill: 'magic', version: 1 });
  });

  it('o catálogo leva o livro, o que uma carga rende e o preço da exercise weapon', async () => {
    const f = fixture();
    const catalogue = buildCatalogue(f.content);
    expect(catalogue.training).toEqual({
      perCharge: { tries: 7, manaSpent: 600 },
      bankCapMs: 43_200_000, graceMs: 600_000,
      spendCapMs: { free: 21_600_000, premium: 43_200_000 },
      offlineSkills: [
        { skillId: 'sword', name: 'sword', kind: 'attacks' },
        { skillId: 'magic', name: 'magic', kind: 'mana' },
      ],
      // Toda skill que o Treino toca: as do livro, na ordem dele — e o tipo é o do GOLPE.
      skills: [
        { skillId: 'sword', name: 'sword', kind: 'attacks' },
        { skillId: 'magic', name: 'magic', kind: 'mana' },
      ],
    });
    const sword = catalogue.items.find((item) => item.id === 'exercise-sword');
    expect(sword).toMatchObject({ exercise: { skillId: 'sword', charges: 3 }, buyPrice: 100 });
    expect(catalogue.items.find((item) => item.id === 'rock')).not.toHaveProperty('buyPrice');
  });
});

describe('a sessão de Treino, do socket ao extrato (#631, ADR 0059 d.1)', () => {
  it('entra com a exercise weapon: a compra é gravada ANTES de sair da praça, e a cena troca', async () => {
    const f = fixture({ gold: 1_000 });
    const { socket, viewer } = await attach(f);
    const instanceId = buySword(f, viewer as NonNullable<typeof viewer>);
    socket.frames.length = 0;

    f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'enter-training', itemInstanceId: instanceId });
    await f.settle();
    f.host.flush();

    expect(f.typeOf('hero')).toBe('training');
    // O extrato durável da praça saiu ANTES: a arma nova (`acquired`, origem `purchase`) e o gold gasto.
    expect(f.saved).toHaveLength(1);
    expect(f.saved[0]?.acquired).toEqual([
      { instanceId, itemId: 'exercise-sword', quantity: 1, origin: 'purchase' },
    ]);
    expect(f.saved[0]?.aggregates.goldSpent).toBe(100);
    // A cena: o mapa da praça, `sessionType: 'training'`, o personagem ao lado do boneco.
    expect(ofType(socket.received(), 'instance-enter').at(-1)?.map).toBe('city');
    const state = ofType(socket.received(), 'session-state').at(-1);
    expect(state?.sessionType).toBe('training');
    expect(f.hero().position).toEqual({ x: 3, y: 3, z: 7 });
    expect(ofType(socket.received(), 'training-state').at(-1)?.activeInstanceId).toBe(instanceId);
  });

  it('corre por eventos até a arma acabar: 3 cargas = 21 tries, `session-ended` `completed`, e o personagem volta à Cidade', async () => {
    const f = fixture({ gold: 1_000 });
    const { socket, viewer } = await attach(f);
    const instanceId = buySword(f, viewer as NonNullable<typeof viewer>);
    f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'enter-training', itemInstanceId: instanceId });
    await f.settle();
    socket.frames.length = 0;

    // Golpes em t = 0, 2 s e 4 s: a terceira carga é a última, e a sessão conclui no golpe dela.
    f.runFor(1_000);
    expect(ofType(socket.received(), 'training-state').at(-1)?.weapons).toEqual([
      { instanceId, itemId: 'exercise-sword', charges: 2 },
    ]);
    f.runFor(5_000);
    await f.settle();
    f.host.flush();

    expect(f.typeOf('hero')).toBe('city');
    const ended = ofType(socket.received(), 'session-ended');
    expect(ended.map((m) => m.reason)).toEqual(['completed']);
    expect(f.hero().skills.getState()['sword']?.points).toBe(21);
    // A arma foi destruída, e o extrato do Treino leva o id ao ledger (`removedInstances`) junto
    // com a skill nova e o banco: o tempo de treino enche o banco 1:1.
    const receipt = f.saved.at(-1);
    expect(receipt?.reason).toBe('completed');
    expect(receipt?.removedInstances).toEqual([instanceId]);
    expect(receipt?.skills?.['sword']).toEqual({ level: 10, points: 21 });
    expect(receipt?.training?.offlineBankMs).toBeGreaterThanOrEqual(4_000);
    expect(receipt?.training?.offlineBankMs).toBeLessThanOrEqual(5_000);
    // De volta à praça o `training-state` some com a arma e traz o banco.
    const last = ofType(socket.received(), 'training-state').at(-1);
    expect(last?.weapons).toEqual([]);
    expect(last?.activeInstanceId).toBeNull();
    expect(last?.offlineBankMs).toBe(f.hero().training.bankMs);
  });

  it('desanexado, o Treino rende o MESMO: quem fecha o navegador não perde nem ganha tries (invariante 3)', async () => {
    const run = async (attached: boolean) => {
      const f = fixture({ gold: 1_000 });
      const { viewer } = await attach(f, true);
      const instanceId = buySword(f, viewer as NonNullable<typeof viewer>);
      f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'enter-training', itemInstanceId: instanceId });
      await f.settle();
      if (!attached) f.host.detach(viewer as NonNullable<typeof viewer>);
      f.runFor(8_000, 250);
      await f.settle();
      return { points: f.hero().skills.getState()['sword']?.points, type: f.typeOf('hero') };
    };
    const withViewer = await run(true);
    const without = await run(false);
    expect(without).toEqual(withViewer);
    expect(without).toEqual({ points: 21, type: 'city' });
  });

  it('sair do treino cedo devolve à Cidade e a arma guarda as cargas RESTANTES no overlay do extrato', async () => {
    const f = fixture({ gold: 1_000 });
    const { viewer } = await attach(f);
    const instanceId = buySword(f, viewer as NonNullable<typeof viewer>);
    f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'enter-training', itemInstanceId: instanceId });
    await f.settle();
    // t = 0 e t = 2 s: duas cargas gastas. Sai antes do terceiro golpe.
    f.runFor(2_500);

    f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'leave-hunt' });
    await f.settle();

    expect(f.typeOf('hero')).toBe('city');
    const receipt = f.saved.at(-1);
    expect(receipt?.reason).toBe('manual-exit');
    expect(receipt?.removedInstances).toBeUndefined();
    expect(receipt?.overlays?.[instanceId]).toEqual({ charges: 1 });
    expect(f.hero().inventory.carried(instanceId)?.overlay).toEqual({ charges: 1 });
    expect(f.hero().skills.getState()['sword']?.points).toBe(14);
  });

  it('recusa entrar sem a arma, com item que não é exercise weapon, e dentro do próprio Treino', async () => {
    const f = fixture({ gold: 1_000 });
    const { socket, viewer } = await attach(f);
    const instanceId = buySword(f, viewer as NonNullable<typeof viewer>);
    const rejected = (id: string) => {
      socket.frames.length = 0;
      f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'enter-training', itemInstanceId: id });
      f.host.flush();
      return ofType(socket.received(), 'system-message').map((m) => m.text);
    };

    expect(rejected('nao-existe')).toEqual(['Você não tem essa exercise weapon.']);
    expect(f.typeOf('hero')).toBe('city');

    f.hero().inventory.forceAdd(
      { instanceId: 'rock-1', itemId: 'rock', quantity: 1 }, f.content.items, { backpackSlots: 4, satchelSlots: 4, row: 4 },
    );
    expect(rejected('rock-1')).toEqual(['Você não tem essa exercise weapon.']);
    expect(f.typeOf('hero')).toBe('city');

    f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'enter-training', itemInstanceId: instanceId });
    await f.settle();
    expect(f.typeOf('hero')).toBe('training');
    // Dentro do Treino não se compra nem se entra de novo.
    expect(rejected(instanceId)).toEqual(['Você precisa estar na Cidade para treinar.']);
    socket.frames.length = 0;
    f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'buy-item', itemId: 'exercise-sword' });
    f.host.flush();
    expect(ofType(socket.received(), 'system-message').map((m) => m.text)).toEqual(['Só se compra na Cidade.']);
    f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'set-offline-training-skill', skillId: 'sword' });
    f.host.flush();
    expect(ofType(socket.received(), 'system-message').at(-1)?.text)
      .toBe('O livro do offline training só se lê na Cidade.');
  });
});

describe('a stamina não anda no Treino, em NENHUMA saída (ADR 0060 d.14c)', () => {
  const HOUR = 3_600_000;

  /** 5 h de stamina no ticket; 1 h na Cidade (recuperação normal); entra no Treino com a arma de 3 cargas. */
  async function training() {
    const f = fixture({ gold: 1_000, staminaMs: 5 * HOUR });
    const { viewer } = await attach(f);
    f.advanceClock(HOUR);
    const instanceId = buySword(f, viewer as NonNullable<typeof viewer>);
    f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'enter-training', itemInstanceId: instanceId });
    await f.settle();
    expect(f.typeOf('hero')).toBe('training');
    // A ENTRADA materializou: a 1 h antes do treino é recuperação, e o marco é o instante da entrada.
    expect(f.hero().staminaMs).toBe(6 * HOUR);
    expect(f.hero().staminaUpdatedAtMs).toBe(HOUR);
    return { f, viewer, instanceId };
  }

  /** O que o ticket do login seguinte faria com o extrato: `materializeStamina` a partir do marco gravado. */
  const staminaAtNextLogin = (f: ReturnType<typeof fixture>, receipt: SessionReceipt, atMs: number): number | null => {
    // Uma praça NOVA: a do fixture já tem o herói, e o `participants[0]` seria ele.
    const session = createCitySessionFactory(f.content, () => atMs, new CityShard(f.content, () => atMs))('hero-2', {
      ...f.initial, staminaMs: receipt.staminaMs as number, staminaUpdatedAtMs: receipt.staminaUpdatedAtMs as number,
    });
    return session.participants[0]?.staminaMs ?? null;
  };

  it('arma esgotada (a sessão acaba SOZINHA): o extrato leva o marco do FIM do treino, e o login seguinte não o recupera', async () => {
    const { f } = await training();
    // Golpes em t = 0, 2 s e 4 s: a terceira carga é a última, e o Treino conclui sozinho.
    f.runFor(5_000);
    await f.settle();
    expect(f.typeOf('hero')).toBe('city');

    const receipt = f.saved.at(-1) as SessionReceipt;
    expect(receipt.reason).toBe('completed');
    // Nem recuperou nem gastou: a stamina é a da entrada. E o marco acompanhou o treino — o
    // extrato lido ANTES de o construtor segurar o marco na memória carregava o da entrada.
    expect(receipt.staminaMs).toBe(6 * HOUR);
    expect(receipt.staminaUpdatedAtMs).toBeGreaterThanOrEqual(HOUR + 4_000);

    // Uma hora depois, ele volta: só a hora fora do jogo recupera, e não os 4 s que treinou.
    const later = 2 * HOUR;
    const stamina = staminaAtNextLogin(f, receipt, later) as number;
    expect(stamina).toBe(6 * HOUR + (later - (receipt.staminaUpdatedAtMs as number)));
    expect(stamina).toBeLessThan(7 * HOUR);
  });

  it('logout DENTRO do Treino: o extrato leva o marco do instante da saída', async () => {
    const { f } = await training();
    f.runFor(1_000);
    expect(f.typeOf('hero')).toBe('training');

    await f.host.release('hero', 1000, 'logout');

    const receipt = f.saved.at(-1) as SessionReceipt;
    expect(receipt.reason).toBe('manual-exit');
    expect(receipt.staminaMs).toBe(6 * HOUR);
    expect(receipt.staminaUpdatedAtMs).toBe(f.now());
    expect(receipt.staminaUpdatedAtMs).toBeGreaterThan(HOUR);
    expect(staminaAtNextLogin(f, receipt, f.now() + HOUR)).toBe(7 * HOUR);
  });

  it('drenagem (a janela de deploy) no meio do Treino: mesmo marco', async () => {
    const { f } = await training();
    f.runFor(1_000);

    expect(await f.host.drainAll()).toBe(1);

    const receipt = f.saved.at(-1) as SessionReceipt;
    expect(receipt.reason).toBe('drain');
    expect(receipt.staminaMs).toBe(6 * HOUR);
    expect(receipt.staminaUpdatedAtMs).toBe(f.now());
    expect(staminaAtNextLogin(f, receipt, f.now() + HOUR)).toBe(7 * HOUR);
  });

  it('sair pelo `leave-hunt` continua certo (o construtor segura o marco ANTES de gravar)', async () => {
    const { f, viewer } = await training();
    f.runFor(2_500);
    f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'leave-hunt' });
    await f.settle();

    const receipt = f.saved.at(-1) as SessionReceipt;
    expect(receipt.staminaMs).toBe(6 * HOUR);
    expect(receipt.staminaUpdatedAtMs).toBe(f.now());
  });

  it('só o Treino segura o marco: o extrato da Cidade leva a stamina que a runtime tem, com o marco da ENTRADA', async () => {
    // Trava a condição `type === 'training'` contra generalizar o `holdStamina` para toda sessão. O
    // extrato de estado da Cidade leva a stamina (#823: todo extrato é o estado absoluto inteiro,
    // para o mais velho poder ser descartado sem perda), mas NÃO a segura: o marco continua o da
    // entrada, e a hora que passou na Cidade segue sendo recuperação no login seguinte. Generalizar
    // o `holdStamina` o levaria a `f.now()`.
    const f = fixture({ gold: 1_000, staminaMs: 5 * HOUR });
    const { viewer } = await attach(f);
    f.advanceClock(HOUR);
    buySword(f, viewer as NonNullable<typeof viewer>);
    await f.host.release('hero', 1000, 'logout');
    const receipt = f.saved.at(-1) as SessionReceipt;
    expect(receipt.staminaMs).toBe(5 * HOUR);
    expect(receipt.staminaUpdatedAtMs).toBe(0);
    expect(receipt.staminaUpdatedAtMs).toBeLessThan(f.now());
  });
});

describe('o cooldown de 10 s entre dois Treinos (`training-exhaustion` do Canary)', () => {
  const refusal = 'O boneco de treino só pode ser usado depois de 10 segundos de espera.';

  it('entrar, sair e entrar de novo dentro de 10 s é recusado — cada entrada creditaria um golpe em t = 0', async () => {
    const f = fixture({ gold: 1_000 });
    const { socket, viewer } = await attach(f);
    const instanceId = buySword(f, viewer as NonNullable<typeof viewer>);
    const enterTraining = async () => {
      socket.frames.length = 0;
      f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'enter-training', itemInstanceId: instanceId });
      await f.settle();
      f.host.flush();
      return ofType(socket.received(), 'system-message').map((m) => m.text);
    };

    expect(await enterTraining()).toEqual([]);
    expect(f.typeOf('hero')).toBe('training');
    f.runFor(500);
    f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'leave-hunt' });
    await f.settle();
    expect(f.typeOf('hero')).toBe('city');
    // Um golpe (o de t = 0): 7 tries, uma carga.
    expect(f.hero().skills.getState()['sword']?.points).toBe(7);

    // Dentro dos 10 s: recusado, na Cidade, sem golpe nenhum.
    expect(await enterTraining()).toEqual([refusal]);
    expect(f.typeOf('hero')).toBe('city');
    f.advanceClock(4_000);
    expect(await enterTraining()).toEqual([refusal]);
    expect(f.hero().skills.getState()['sword']?.points).toBe(7);
    expect(f.hero().inventory.carried(instanceId)?.overlay).toEqual({ charges: 2 });
  });

  it('libera exatamente 10 s depois do INÍCIO do treino anterior (não da saída dele)', async () => {
    const f = fixture({ gold: 1_000 });
    const { socket, viewer } = await attach(f);
    const instanceId = buySword(f, viewer as NonNullable<typeof viewer>);
    const intent = { type: 'enter-training' as const, itemInstanceId: instanceId };
    f.host.handle(viewer as NonNullable<typeof viewer>, intent);
    await f.settle();
    f.runFor(500);
    f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'leave-hunt' });
    await f.settle();

    // Iniciado em t = 0: livre em t = 10 000, e ainda preso em t = 9 999.
    f.advanceClock(9_999 - f.now());
    socket.frames.length = 0;
    f.host.handle(viewer as NonNullable<typeof viewer>, intent);
    await f.settle();
    f.host.flush();
    expect(f.typeOf('hero')).toBe('city');
    expect(ofType(socket.received(), 'system-message').at(-1)?.text).toBe(refusal);

    f.advanceClock(1);
    f.host.handle(viewer as NonNullable<typeof viewer>, intent);
    await f.settle();
    expect(f.typeOf('hero')).toBe('training');
  });

  it('o carimbo vai para o registro gravado no extrato do Treino — sobrevive ao logout e ao relogin', async () => {
    const f = fixture({ gold: 1_000 });
    const { viewer } = await attach(f);
    const instanceId = buySword(f, viewer as NonNullable<typeof viewer>);
    f.host.handle(viewer as NonNullable<typeof viewer>, { type: 'enter-training', itemInstanceId: instanceId });
    await f.settle();
    f.runFor(500);
    await f.host.release('hero', 1000, 'logout');

    const receipt = f.saved.at(-1) as SessionReceipt;
    expect(receipt.training?.exerciseExhaustedUntilMs).toBe(10_000);
    // O ticket seguinte traz o registro: o carimbo ainda vale e a entrada seria recusada.
    const session = createCitySessionFactory(f.content, f.now, new CityShard(f.content, f.now))('hero-2', {
      ...f.initial, training: receipt.training as NonNullable<typeof receipt.training>,
    });
    const hero = session.participants[0] as CharacterRuntime;
    expect(hero.training.exerciseCooldownLeftMs(f.now() + 4_500, 10_000)).toBe(5_000);
    expect(hero.training.exerciseCooldownLeftMs(f.now() + 9_500, 10_000)).toBe(0);
  });
});
