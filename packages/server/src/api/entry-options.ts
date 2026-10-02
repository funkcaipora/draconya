// O que o menu de entrada precisa saber ANTES de existir sessão (#846, OW-23, ADR 0060 d.6b): se este servidor
// tem o mundo aberto e, quando tem, quais hunts idle se pode pedir direto no `entry` do ticket.
//
// Existe porque o catálogo de hunts só chega pelo socket (`catalogue`, depois do `welcome`), e o menu "Entrar
// no mundo" ou "Caçar (idle)" é a escolha que DECIDE o primeiro ticket — antes de qualquer socket. Sem esta
// rota o cliente teria de adivinhar a flag (uma variável de build que diverge do servidor sem ninguém ver) e
// carregar uma lista de hunts de cabeça (invariante 7: o conteúdo é do servidor, fixado no boot).
//
// É só LEITURA e só apresentação (invariante 4): quem confere a hunt pedida continua sendo o `POST
// /api/tickets` (`hasHunt`, 400 `unknown-hunt`). Com a flag desligada a lista vai VAZIA — o menu não existe, e
// um cliente do mundo aberto contra esse servidor entra pelo botão único de sempre.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Principal } from './tickets.js';

/** Uma hunt como o menu a oferece: o id que vai no ticket, o nome e o conselho de level. */
export interface EntryHunt {
  readonly id: string;
  readonly name: string;
  readonly recommendedLevel: number;
}

export interface EntryOptionsDependencies {
  readonly authenticate: (request: FastifyRequest) => Promise<Principal | null>;
  /** A flag `OPEN_WORLD` do processo `api`, lida UMA vez do ambiente (como o ticket e a lista de personagens). */
  readonly openWorld: boolean;
  /** As hunts do conteúdo fixado no boot, já na ordem do catálogo. */
  readonly hunts: () => readonly EntryHunt[];
}

export function registerEntryOptionsRoute(app: FastifyInstance, deps: EntryOptionsDependencies): void {
  app.get('/api/entry-options', async (request, reply) => {
    const principal = await deps.authenticate(request);
    if (principal === null) return reply.code(401).send({ error: 'unauthenticated' });
    return reply.send({
      openWorld: deps.openWorld,
      hunts: deps.openWorld ? deps.hunts().map(({ id, name, recommendedLevel }) => ({ id, name, recommendedLevel })) : [],
    });
  });
}
