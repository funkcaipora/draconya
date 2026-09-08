import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import {
  CharacterNameTakenError,
  type CharacterRecord,
  type GameRepository,
} from '../db/repository.js';

const CreateCharacterBody = z.object({
  name: z.string(),
});
const CharacterParams = z.object({ id: z.string().min(1) });

export function registerCharacterRoutes(
  app: FastifyInstance,
  auth: AuthService,
  repository: GameRepository,
  isCharacterActive?: (accountId: string, characterId: string) => Promise<boolean>,
): void {
  app.get('/api/characters', async (request, reply) => {
    const principal = await auth.authenticate(request);
    if (principal === null) return reply.code(401).send({ error: 'unauthenticated' });
    const characters = await repository.listCharacters(principal.accountId);
    return reply.send({ characters: characters.map(toDto) });
  });

  app.post('/api/characters', async (request, reply) => {
    const principal = await auth.authenticate(request);
    if (principal === null) return reply.code(401).send({ error: 'unauthenticated' });
    const body = CreateCharacterBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid-body' });
    if (/\p{C}/u.test(body.data.name)) {
      return reply.code(400).send({ error: 'invalid-name' });
    }
    const name = normalizeCharacterName(body.data.name);
    const nameLength = [...name].length;
    if (nameLength < 2 || nameLength > 30 || !validCharacterName(name)) {
      return reply.code(400).send({ error: 'invalid-name' });
    }

    try {
      const character = await repository.createCharacter(principal.accountId, name);
      return reply.code(201).send(toDto(character));
    } catch (error) {
      if (error instanceof CharacterNameTakenError) {
        return reply.code(409).send({ error: 'name-taken' });
      }
      throw error;
    }
  });

  app.post('/api/characters/:id/select', async (request, reply) => {
    const principal = await auth.authenticate(request);
    if (principal === null) return reply.code(401).send({ error: 'unauthenticated' });
    const params = CharacterParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid-character' });
    const character = await repository.getCharacter(principal.accountId, params.data.id);
    if (character === null) return reply.code(404).send({ error: 'character-not-found' });
    return reply.send(toDto(character));
  });

  app.delete('/api/characters/:id', async (request, reply) => {
    const principal = await auth.authenticate(request);
    if (principal === null) return reply.code(401).send({ error: 'unauthenticated' });
    const params = CharacterParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid-character' });
    const result = await repository.softDeleteCharacter(
      principal.accountId,
      params.data.id,
      isCharacterActive,
    );
    if (result === 'not-found') return reply.code(404).send({ error: 'character-not-found' });
    if (result === 'active') return reply.code(409).send({ error: 'character-active' });
    return reply.code(204).send();
  });
}

function normalizeCharacterName(value: string): string {
  return value.normalize('NFC').trim().replace(/ +/g, ' ');
}

function validCharacterName(value: string): boolean {
  // Letras Unicode, espaço, apóstrofo e hífen. Sem pontuação de chat, números ou controle.
  return /^\p{L}[\p{L}' -]*\p{L}$/u.test(value);
}

function toDto(character: CharacterRecord) {
  return {
    id: character.id,
    name: character.name,
    vocation: character.vocation,
    level: character.level,
    xp: character.xp,
    gold: character.gold,
    capacity: character.capacity,
    premiumUntil: character.premiumUntil?.toISOString() ?? null,
    staminaMs: character.staminaMs,
    staminaUpdatedAt: character.staminaUpdatedAt.toISOString(),
    state: character.state,
    sessionId: character.sessionId,
    createdAt: character.createdAt.toISOString(),
  };
}
