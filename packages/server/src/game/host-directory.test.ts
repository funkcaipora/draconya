// O ticket de party contra o diretório de VERDADE (#527).
//
// `host.test.ts` prova a transição Cidade→hunt inteira com um diretório FALSO — o suficiente
// para o mapa local (`#sessionIdByCharacter`, `#sessions`, visualizadores), mas cego para o
// que só o Redis de verdade encena: `TAKE_OVER_SESSION` recusando porque o NÓ ainda está vivo.
// Foi exatamente esse caminho — `#register` → `REGISTER_SESSION` recusado (o `sessionKey`
// ainda apontava para a Cidade) → `#takeOver` → `TAKE_OVER_SESSION` recusado (o batimento do
// nó existe) — que a QA ao vivo achou: "active reservation expired before session
// registration" em todo handshake, porque o nó nunca estava morto. Só um `SessionDirectory`
// de verdade, com um batimento de nó registrado, exercita essa recusa.

import { CharacterRuntime, Rng, Session, type Ruleset } from '@draconya/sim';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PartyTicket } from '../tickets.js';
import { SessionDirectory } from '../directory.js';
import { createLogger } from '../log.js';
import { connectTestRedis } from '../testing/redis.js';
import { SessionHost } from './host.js';

const logger = createLogger('silent', 'test');
const { redis, available } = await connectTestRedis(17);

afterAll(async () => {
  if (available) await redis.quit();
});

beforeEach(async () => {
  if (available) await redis.flushdb();
});

const character = (id: string): CharacterRuntime => new CharacterRuntime({
  id, position: { x: 0, y: 0, z: 7 },
  health: 100, maxHealth: 100, mana: 0, maxMana: 0,
  level: 8, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
});

const cityRuleset: Ruleset = {
  type: 'city',
  // Como a Cidade de verdade (FUN-71): um shard, não uma sessão privada.
  shared: true,
  hz: () => 0,
  onEnter: () => {},
  onEvent: () => {},
  onCreatureDied: () => {},
  onEnd: () => {},
};

const huntRuleset: Ruleset = {
  type: 'hunt',
  hz: () => 1,
  onEnter: () => {},
  onEvent: () => {},
  onCreatureDied: () => {},
  onEnd: () => {},
};

const party: PartyTicket = {
  sessionId: 's-party', leaderId: 'a', shareCosts: false, splitLoot: false, huntId: 'arena', difficulty: 'cautious',
  members: [
    { characterId: 'a', accountId: 'acc-a', initialCharacter: { level: 8, xp: 0, name: 'Ana' } },
    { characterId: 'b', accountId: 'acc-b', initialCharacter: { level: 8, xp: 0, name: 'Bia' } },
  ],
};

/** A Cidade é UMA sessão compartilhada, como `CityShard.admit` — reaproveitada entre logins. */
function build(): { host: SessionHost; directory: SessionDirectory } {
  const directory = new SessionDirectory(redis);
  let city: Session | null = null;
  const host = new SessionHost({
    nodeId: 'n1', contentVersion: 'v-test', logger,
    directory,
    createParticipant: (characterId) => character(characterId),
    createSession: (characterId, _initial, ticket) => {
      if (ticket === undefined) {
        city ??= new Session({
          id: 'city-1', contentVersion: 'v-test', ruleset: cityRuleset, rng: Rng.fromSeed('city'), createdAtMs: 0,
        });
        city.enter(character(characterId));
        return city;
      }
      const session = new Session({
        id: ticket.sessionId, contentVersion: 'v-test', ruleset: huntRuleset, rng: Rng.fromSeed('p'), createdAtMs: 0,
      });
      for (const member of ticket.members) session.enter(character(member.characterId));
      return session;
    },
  });
  return { host, directory };
}

describe.runIf(available)('o ticket de party contra o diretório de VERDADE (#527)', () => {
  it('registers the hunt when the leader starts the party from a City session already registered on this node', async () => {
    const { host, directory } = build();
    // O batimento é o que faz `TAKE_OVER_SESSION` recusar — o nó está vivo, e é ele mesmo que
    // está pedindo a troca; sem isto o teste passaria mesmo com o defeito, porque a tomada por
    // nó morto teria sucesso por acidente.
    await directory.heartbeat('n1', { sessions: 0, url: 'ws://n1:7171' });
    // A reserva de conta ativa, como `POST /api/tickets` grava antes de emitir o ticket da
    // Cidade (`tickets.ts`, `issueSessionTicket`) — a mesma chave que `directory.register`
    // exige. Os DOIS membros: `/start` reserva para todo mundo ao emitir os N tickets
    // (`tickets.ts`, `issueSessionTicket`), e `b` entra na hunt junto mesmo sem conectar —
    // `#createAndRegister` registra o diretório dele também.
    await directory.reserveSlot('acc-a', 'a');
    await directory.reserveSlot('acc-b', 'b');

    const solo = await host.prepare('a', party.members[0]?.initialCharacter, 'acc-a');
    expect(solo.created).toBe(true);
    expect(await directory.lookup('a')).toEqual({ sessionId: 'city-1', nodeId: 'n1', type: 'city' });

    // O líder clica "Iniciar com o time" DA PRÓPRIA CIDADE: o ticket da party chega para o
    // MESMO nó, com o personagem ainda registrado lá. Não pode lançar.
    await expect(
      host.prepare('a', party.members[0]?.initialCharacter, 'acc-a', party),
    ).resolves.toMatchObject({ created: true });
    expect(host.sessionFor('a')?.id).toBe('s-party');
    expect(await directory.lookup('a')).toEqual({ sessionId: 's-party', nodeId: 'n1', type: 'hunt' });
  });

  it('also registers a second member hosted in the same City on this node', async () => {
    const { host, directory } = build();
    await directory.heartbeat('n1', { sessions: 0, url: 'ws://n1:7171' });
    await directory.reserveSlot('acc-a', 'a');
    await directory.reserveSlot('acc-b', 'b');

    await host.prepare('a', party.members[0]?.initialCharacter, 'acc-a');
    await host.prepare('b', party.members[1]?.initialCharacter, 'acc-b');
    expect(await directory.lookup('a')).toMatchObject({ sessionId: 'city-1', type: 'city' });
    expect(await directory.lookup('b')).toMatchObject({ sessionId: 'city-1', type: 'city' });

    await expect(
      host.prepare('a', party.members[0]?.initialCharacter, 'acc-a', party),
    ).resolves.toMatchObject({ created: true });
    expect(host.sessionFor('a')?.id).toBe('s-party');
    expect(host.sessionFor('b')?.id).toBe('s-party');
    expect(await directory.lookup('a')).toEqual({ sessionId: 's-party', nodeId: 'n1', type: 'hunt' });
    expect(await directory.lookup('b')).toEqual({ sessionId: 's-party', nodeId: 'n1', type: 'hunt' });
  });

  it('a late-join ticket for a member still in the City on this node also registers the hunt', async () => {
    const { host, directory } = build();
    await directory.heartbeat('n1', { sessions: 0, url: 'ws://n1:7171' });
    // `a` e `b` (o líder e o outro membro do ticket completo) e `c` (o late-joiner).
    await directory.reserveSlot('acc-a', 'a');
    await directory.reserveSlot('acc-b', 'b');
    await directory.reserveSlot('acc-c', 'c');

    // A hunt já existe neste nó (o líder entrou primeiro).
    await host.prepare('a', party.members[0]?.initialCharacter, 'acc-a', party);
    expect(host.sessionFor('a')?.id).toBe('s-party');

    // 'c' está na Cidade deste MESMO nó, e chega por um ticket de entrada em curso (#402).
    await host.prepare('c', { level: 8, xp: 0, name: 'Cid' }, 'acc-c');
    expect(await directory.lookup('c')).toMatchObject({ sessionId: 'city-1', type: 'city' });

    const lateJoin: PartyTicket = {
      ...party,
      join: true,
      members: [{ characterId: 'c', accountId: 'acc-c', initialCharacter: { level: 8, xp: 0, name: 'Cid' } }],
    };
    await expect(
      host.prepare('c', { level: 8, xp: 0, name: 'Cid' }, 'acc-c', lateJoin),
    ).resolves.toMatchObject({ created: true });
    expect(host.sessionFor('c')?.id).toBe('s-party');
    expect(await directory.lookup('c')).toEqual({ sessionId: 's-party', nodeId: 'n1', type: 'hunt' });
  });
});
