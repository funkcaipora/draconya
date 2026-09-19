// Amigos é o mínimo do §21 (ADR 0031 decisão 6): adicionar por nome, listar com online/onde,
// remover. Como toda formação de party, é INTENÇÃO por HTTP (invariante 4): quem decide se o
// nome existe, se o par já é amigo e o que a listagem mostra é este processo, nunca o corpo do
// request.
//
// Sem pedido de amizade nem bloqueio: o kit desenha as abas, e elas esperam o épico social. A
// amizade é unidirecional — A ter B como amigo não implica B ter A (DT-01).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { GameRepository } from '../db/repository.js';
import { CannotFriendSelfError, FriendAlreadyExistsError } from '../db/repository.js';
import type { Principal } from './tickets.js';

export interface FriendRouteDependencies {
  readonly authenticate: (request: FastifyRequest) => Promise<Principal | null>;
  readonly ownsCharacter: GameRepository['ownsCharacter'];
  readonly getCharacterByName: GameRepository['getCharacterByName'];
  readonly addFriend: GameRepository['addFriend'];
  readonly listFriends: GameRepository['listFriends'];
  readonly removeFriend: GameRepository['removeFriend'];
  /** O mesmo `locateSession` de `party.ts`/`characters.ts` — `directory.lookup` por baixo. */
  readonly locateSession: (characterId: string) => Promise<{ type: string } | null>;
}

/** O personagem de QUEM fala; `name` é o alvo, acrescentado só no `POST`. */
const Selected = z.object({ characterId: z.string().min(1).max(128) });
const AddFriend = Selected.extend({ name: z.string().min(1).max(64) });

/**
 * Autentica e confere a posse do PRÓPRIO personagem — igual ao `who()` de `party.ts`. O
 * `characterId` do corpo é sempre o de quem fala, nunca o do alvo; quem é adicionado ou
 * removido vem por nome (POST) ou por parâmetro de rota (DELETE).
 */
async function who(
  deps: Pick<FriendRouteDependencies, 'authenticate' | 'ownsCharacter'>,
  request: FastifyRequest,
  reply: FastifyReply,
  body: unknown,
): Promise<{ accountId: string; characterId: string } | null> {
  const parsed = Selected.safeParse(body);
  if (!parsed.success) {
    await reply.code(400).send({ error: 'invalid-body' });
    return null;
  }
  const principal = await deps.authenticate(request);
  if (principal === null) {
    await reply.code(401).send({ error: 'unauthenticated' });
    return null;
  }
  // 404, e não 403: "existe, mas não é seu" faria disto um verificador de ids.
  if (!await deps.ownsCharacter(principal.accountId, parsed.data.characterId)) {
    await reply.code(404).send({ error: 'character-not-found' });
    return null;
  }
  return { accountId: principal.accountId, characterId: parsed.data.characterId };
}

/**
 * `directory.lookup` só dá `type` — sem `huntId` (DT-05). `'city'` é a Cidade viva
 * (invariante 8); qualquer outro tipo colapsa em `'hunt'`, porque o mínimo do §21 só precisa
 * saber se o amigo está na Cidade ou fora dela.
 */
async function statusOf(
  deps: Pick<FriendRouteDependencies, 'locateSession'>,
  characterId: string,
): Promise<{ online: boolean; where: 'city' | 'hunt' | null }> {
  const location = await deps.locateSession(characterId);
  if (location === null) return { online: false, where: null };
  return { online: true, where: location.type === 'city' ? 'city' : 'hunt' };
}

export function registerFriendRoutes(app: FastifyInstance, deps: FriendRouteDependencies): void {
  app.post('/api/friends', async (request, reply) => {
    const me = await who(deps, request, reply, request.body);
    if (me === null) return;
    const body = AddFriend.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid-body' });
    const target = await deps.getCharacterByName(body.data.name);
    if (target === null) return reply.code(404).send({ error: 'character-not-found' });
    if (target.id === me.characterId) return reply.code(409).send({ error: 'cannot-friend-self' });
    try {
      await deps.addFriend(me.characterId, target.id);
    } catch (error) {
      if (error instanceof FriendAlreadyExistsError) {
        return reply.code(409).send({ error: 'already-friends' });
      }
      if (error instanceof CannotFriendSelfError) {
        return reply.code(409).send({ error: 'cannot-friend-self' });
      }
      throw error;
    }
    return reply.send({ ok: true });
  });

  app.get('/api/friends', async (request, reply) => {
    const query = Selected.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid-query' });
    const principal = await deps.authenticate(request);
    if (principal === null) return reply.code(401).send({ error: 'unauthenticated' });
    if (!await deps.ownsCharacter(principal.accountId, query.data.characterId)) {
      return reply.code(404).send({ error: 'character-not-found' });
    }
    const rows = await deps.listFriends(query.data.characterId);
    const result = await Promise.all(rows.map(async (friend) => ({
      characterId: friend.characterId,
      name: friend.name,
      vocationId: friend.vocation,
      level: friend.level,
      ...(await statusOf(deps, friend.characterId)),
    })));
    return reply.send(result);
  });

  // ":characterId" aqui é o AMIGO a remover — quem remove vem do corpo, como em toda rota de
  // party (o mesmo padrão de `Invite`/`Selected` separados em `party.ts`).
  app.delete('/api/friends/:characterId', async (request, reply) => {
    const me = await who(deps, request, reply, request.body);
    if (me === null) return;
    const friendCharacterId = (request.params as { characterId: string }).characterId;
    const ok = await deps.removeFriend(me.characterId, friendCharacterId);
    return reply.send({ ok });
  });
}
