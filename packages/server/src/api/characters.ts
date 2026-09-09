import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import type { SettlementResult } from './tickets.js';
import {
  CharacterNameTakenError,
  type CharacterRecord,
  type GameRepository,
} from '../db/repository.js';

const CreateCharacterBody = z.object({
  name: z.string(),
});
const CharacterParams = z.object({ id: z.string().min(1) });

/**
 * Dependências opcionais das rotas de personagem. Objeto, e não posicionais (FUN-66, DT-02):
 * já eram cinco parâmetros, e a chamada de teste passava `undefined` no meio para chegar ao
 * último. Cada campo ausente desliga a capacidade correspondente, e nada mais.
 */
export interface CharacterRouteOptions {
  readonly isCharacterActive?: ((accountId: string, characterId: string) => Promise<boolean>) | undefined;
  /**
   * Onde o personagem está agora, segundo o diretório de sessões (FUN-30).
   *
   * A coluna `state` da tabela existe e NÃO é escrita por ninguém: a verdade sobre em que
   * atividade o personagem está é a sessão, e a sessão vive no Redis (invariante 8). Ler a
   * coluna fazia a API responder `"city"` para quem estava numa hunt havia seis horas — uma
   * mentira quieta, do tipo que só aparece quando alguém confia nela.
   */
  readonly locateSession?: ((
    characterId: string,
  ) => Promise<{ sessionId: string; type: string } | null>) | undefined;
  /**
   * Liquida o extrato que a última sessão deixou pendente antes de ler a linha (FUN-66).
   *
   * É o MESMO caminho da varredura e do ticket (FUN-56) — mesma linha de ledger, mesma chave
   * única, mesma transação. Somar o pendente só para exibir seria mais barato e duplicaria a
   * derivação de level num segundo lugar; dois lugares divergem.
   */
  readonly settleProgress?: ((characterId: string) => Promise<SettlementResult>) | undefined;
}

export function registerCharacterRoutes(
  app: FastifyInstance,
  auth: AuthService,
  repository: GameRepository,
  options: CharacterRouteOptions = {},
): void {
  const { isCharacterActive, locateSession, settleProgress } = options;

  /**
   * Liquida e diz se ALGO foi escrito. Falhar aqui NÃO recusa a resposta, ao contrário do
   * ticket (FUN-56). A diferença é o que se faz com o número: o ticket CRIA a sessão a partir
   * dele, e entrar com um personagem desatualizado é durável; aqui ele só é exibido, e um 503
   * na tela de personagens trancaria a conta inteira por uma falha de ledger. O pior aceitável
   * é servir o valor atrasado — que é o comportamento de antes desta issue.
   */
  const settle = async (characterId: string, log: { error: (o: unknown, m: string) => void }) => {
    if (settleProgress === undefined) return false;
    try {
      return (await settleProgress(characterId)).written > 0;
    } catch (error) {
      log.error({ error, characterId }, 'Settlement failed while listing characters');
      return false;
    }
  };

  app.get('/api/characters', async (request, reply) => {
    const principal = await auth.authenticate(request);
    if (principal === null) return reply.code(401).send({ error: 'unauthenticated' });

    let characters = await repository.listCharacters(principal.accountId);
    // Liquidar DEPOIS de listar, porque os ids só se conhecem listando. Reler só quando alguma
    // coisa foi de fato escrita: no caso comum — nada pendente — isto é um `SMEMBERS` por
    // personagem e nenhuma consulta a mais ao Postgres.
    let settled = false;
    for (const character of characters) {
      if (await settle(character.id, request.log)) settled = true;
    }
    if (settled) characters = await repository.listCharacters(principal.accountId);

    const located = await Promise.all(characters.map(async (character) => toDto(
      character, (await locateSession?.(character.id)) ?? null,
    )));
    return reply.send({ characters: located });
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
    // O caso fácil: o id já é conhecido, então liquida ANTES de ler.
    await settle(params.data.id, request.log);
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

function toDto(
  character: CharacterRecord,
  location: { sessionId: string; type: string } | null = null,
) {
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
    // O diretório manda; a coluna é só o que sobrou de antes de a sessão existir.
    state: location?.type ?? character.state,
    sessionId: location?.sessionId ?? character.sessionId,
    createdAt: character.createdAt.toISOString(),
  };
}
