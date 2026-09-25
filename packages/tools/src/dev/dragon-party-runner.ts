// Orquestra a semente da party de dragões (#526): carrega o conteúdo, sobe as quatro contas e
// personagens pelo `api` de verdade, escreve level/skills/kit/bot no Postgres e forma (e,
// opcionalmente, inicia) a party — tudo pelo MESMO caminho que o jogador usaria, exceto os
// campos que só a API de personagem novo não expõe (level, xp, skills, kit, bot), que vão direto
// ao banco em `seedCharacterStats`.
//
// Testável sem rede real: `fetchImpl` é injetável (`DragonPartyApiOptions`) — não há teste de
// integração completo aqui porque isso exigiria o `api` de pé; o que TEM teste (`*.postgres.
// test.ts`) é `seedCharacterStats`, a parte que grava o banco.

import { loadContent } from '@draconya/content/load';
import { createDatabase, SessionDirectory, type Database } from '@draconya/server';
import {
  DRAGON_PARTY_LEADER_VOCATION, DRAGON_PARTY_MEMBERS, type DragonPartyMemberPlan,
} from './dragon-party-plan.js';
import { seedCharacterStats } from './dragon-party-seed.js';
import { DragonPartyApi, type DragonPartySession, type PartyView } from './dragon-party-api.js';

export interface DragonPartyOptions {
  readonly databaseUrl: string;
  readonly contentDir: string;
  readonly apiBaseUrl: string;
  readonly clientOrigin: string;
  readonly huntId: string;
  readonly difficulty: string;
  readonly start: boolean;
  readonly reset: boolean;
  readonly redisUrl?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly log?: ((message: string) => void) | undefined;
}

export interface DragonPartyRunResult {
  readonly exitCode: number;
}

export async function runDragonParty(options: DragonPartyOptions): Promise<DragonPartyRunResult> {
  const log = options.log ?? ((message: string) => console.log(message));
  // `--reset` não toca o Postgres (ver `resetDragonParty`) — só abre a conexão quando ela é
  // realmente usada, para não exigir `DATABASE_URL` de quem só quer destravar a party.
  if (options.reset) return resetDragonParty(options, log);
  const database = createDatabase(options.databaseUrl);
  await database.ping();
  try {
    return await seedAndFormParty(database.db, options, log);
  } finally {
    await database.close();
  }
}

function buildApi(options: DragonPartyOptions): DragonPartyApi {
  return new DragonPartyApi({
    baseUrl: options.apiBaseUrl,
    clientOrigin: options.clientOrigin,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
}

interface SeededMember {
  readonly plan: DragonPartyMemberPlan;
  readonly session: DragonPartySession;
  readonly characterId: string;
}

async function seedAndFormParty(
  db: Database, options: DragonPartyOptions, log: (message: string) => void,
): Promise<DragonPartyRunResult> {
  const content = loadContent(options.contentDir);
  const api = buildApi(options);

  const members: SeededMember[] = [];
  for (const plan of DRAGON_PARTY_MEMBERS) {
    const session = await api.devLogin(plan.email);
    const characterId = await api.ensureCharacter(session, plan.characterName);
    const seeded = await seedCharacterStats(db, content, characterId, plan.vocationId);
    members.push({ plan, session, characterId });
    log(
      `${plan.characterName} (${plan.vocationId}): level ${seeded.level}, xp ${seeded.xp}, `
        + `gold ${seeded.gold}, ${seeded.equippedItemIds.length} peças equipadas`,
    );
  }

  const leader = members.find((member) => member.plan.vocationId === DRAGON_PARTY_LEADER_VOCATION);
  if (leader === undefined) {
    // A lista é fixa em `dragon-party-plan.ts` e sempre inclui o líder — chegar aqui é bug deste
    // arquivo, não estado de runtime possível.
    throw new Error('dragon-party: líder não está entre os membros seedados');
  }

  let party = (await api.myParty(leader.session, leader.characterId)).party;
  if (party === null) {
    party = await api.createParty(leader.session, leader.characterId);
    log(`party criada: ${party.id}`);
  } else {
    log(`party existente reaproveitada: ${party.id} (estado ${party.state})`);
  }

  if (party.state === 'hunting') {
    log('party já está caçando — nada a formar. Use --reset para devolver os quatro à Cidade primeiro.');
    return { exitCode: 0 };
  }

  party = await joinMissingMembers(api, party, leader, members, log);

  if (!content.hunts.has(options.huntId)) {
    const known = [...content.hunts.keys()].join(', ') || '(nenhuma)';
    log(
      `ERRO: a hunt "${options.huntId}" não existe no conteúdo desta branch (hunts disponíveis: ${known}). `
        + 'A Darashia Dragon Lair chega pelas issues #519/#520 — a party continua formada e pronta para '
        + 'configurar assim que a hunt existir. Rode de novo com --hunt-id=<outra id> para testar com o '
        + 'que já existe.',
    );
    return { exitCode: 1 };
  }

  const configured = await api.configure(leader.session, party.id, leader.characterId, {
    huntId: options.huntId, difficulty: options.difficulty, shareCosts: true, splitLoot: true,
  });
  if (configured.status !== 200) {
    log(
      `ERRO: configurar a party para "${options.huntId}"/"${options.difficulty}" falhou `
        + `(${configured.status}): ${JSON.stringify(configured.body)}`,
    );
    return { exitCode: 1 };
  }
  log(`party configurada: hunt "${options.huntId}", dificuldade "${options.difficulty}"`);

  if (!options.start) {
    log('party pronta. Rode com --start para iniciar, ou clique em "Iniciar" no navegador logado como o líder.');
    return { exitCode: 0 };
  }

  const started = await api.start(leader.session, party.id, leader.characterId);
  if (started.status !== 200) {
    log(`ERRO: iniciar a party falhou (${started.status}): ${JSON.stringify(started.body)}`);
    return { exitCode: 1 };
  }
  log('party iniciada — falta o líder anexar no navegador (dev-login da conta do Knight) para presenciar a hunt.');
  return { exitCode: 0 };
}

async function joinMissingMembers(
  api: DragonPartyApi, party: PartyView, leader: SeededMember, members: readonly SeededMember[],
  log: (message: string) => void,
): Promise<PartyView> {
  let current = party;
  for (const member of members) {
    if (member.plan.vocationId === DRAGON_PARTY_LEADER_VOCATION) continue;
    if (current.members.some((entry) => entry.characterId === member.characterId)) continue;
    await api.invite(leader.session, current.id, leader.characterId, member.characterId);
    current = await api.join(member.session, current.id, member.characterId);
    log(`${member.plan.characterName} entrou na party`);
  }
  return current;
}

/**
 * Devolve os quatro para a Cidade quando a party ficou travada.
 *
 * `characters.state`/`characters.session_id` NÃO são a resposta aqui (correção de revisão): a
 * própria API já documenta que "a coluna `state` [...] NÃO é escrita por ninguém" e que confiar
 * nela "fazia a API responder 'city' para quem estava numa hunt havia seis horas — uma mentira
 * quieta" (`packages/server/src/api/characters.ts`, comentário de `locateSession`). Quem manda é
 * o DIRETÓRIO (`SessionDirectory`, Redis) — `GET /api/characters` e o `/party/:id/start` leem
 * `directory.lookup`, nunca a coluna. A recuperação de verdade é apagar o registro de lá, e só
 * isso: por isso este utilitário não abre o Postgres (`runDragonParty`).
 *
 * **Antes de apagar qualquer coisa, confere se o nó dono ainda bate** (a MESMA pergunta que
 * `directory.isActive`/FUN-53 fazem para decidir "está em jogo"): um lookup que resolve para um
 * nó com batimento vivo é uma sessão de verdade, hospedada por um processo que ainda está de pé
 * — apagar o lease dela por baixo seria o oposto de "travado", e abriria a fresta do invariante
 * 9 (duas hospedagens do mesmo personagem) na próxima vez que alguém desse `--start`. Só o
 * lease de um nó SEM batimento (o processo `game` caiu sem drenar) é apagado — e mesmo esse caso
 * o `jobs` varre sozinho em até dez segundos (FUN-28); isto só evita a espera.
 */
async function resetDragonParty(
  options: DragonPartyOptions, log: (message: string) => void,
): Promise<DragonPartyRunResult> {
  if (options.redisUrl === undefined) {
    log(
      'ERRO: --reset precisa de REDIS_URL (ou --redis-url=) para conferir se a sessão de cada '
        + 'personagem ainda está viva antes de mexer em qualquer coisa — sem isso, apagar o lease '
        + 'às cegas arrisca duas sessões hospedadas para o MESMO personagem (invariante 8).',
    );
    return { exitCode: 1 };
  }

  const api = buildApi(options);
  const { default: Redis } = await import('ioredis');
  const redis = new Redis(options.redisUrl, { maxRetriesPerRequest: 1 });
  const directory = new SessionDirectory(redis);
  let exitCode = 0;

  try {
    for (const plan of DRAGON_PARTY_MEMBERS) {
      try {
        const session = await api.devLogin(plan.email);
        const characterId = await api.ensureCharacter(session, plan.characterName);

        const location = await directory.lookup(characterId);
        if (location !== null && await directory.isNodeAlive(location.nodeId)) {
          log(
            `AVISO: ${plan.characterName} tem uma sessão viva no nó "${location.nodeId}" `
              + `(tipo "${location.type}") — não vou apagar o lease dela. Espere a hunt encerrar `
              + 'sozinha, ou reinicie o processo `game` se ela estiver realmente travada.',
          );
          exitCode = 1;
          continue;
        }

        const mine = await api.myParty(session, characterId);
        if (mine.party !== null) {
          await api.leave(session, mine.party.id, characterId);
          log(`${plan.characterName} saiu da party ${mine.party.id}`);
        }
        if (location !== null) {
          // O nó registrado não bate mais: o lease é órfão (FUN-28), e apagá-lo aqui só adianta
          // o que o `jobs` faria sozinho no próximo ciclo.
          await redis.del(`char:${characterId}:session`);
          log(`${plan.characterName}: lease órfão (nó "${location.nodeId}" sem batimento) limpo.`);
        }
        await redis.del(`party:by-char:${characterId}`);
      } catch (error) {
        log(`ERRO ao resetar ${plan.characterName}: ${(error as Error).message}`);
        exitCode = 1;
      }
    }
  } finally {
    redis.disconnect();
  }
  return { exitCode };
}
