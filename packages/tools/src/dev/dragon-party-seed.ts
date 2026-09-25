// A ESCRITA no Postgres da semente da party de dragões (#526): level, xp, skills, gold,
// capacidade, munição, equipamento e bot config de UM personagem. Chamado pelo runner (depois
// de o personagem já existir via `POST /api/characters`) e pelo teste `*.postgres.test.ts`
// (depois de `repository.createCharacter`) — os dois entregam um `characterId` que já existe na
// tabela `character`.
//
// HP/mana/velocidade NÃO são gravados aqui: `packages/server/src/game/sessions.ts` os deriva de
// `level` + `vocation` na entrada da sessão (FUN-34) — só `capacity` é coluna própria
// (FUN-82), e sai de `statsForLevel`.

import { eq } from 'drizzle-orm';
import { schema, type Database } from '@draconya/server';
import { statsForLevel, totalXpForLevel } from '@draconya/sim';
import { validateBotConfigV2, type Content } from '@draconya/content';
import {
  ammoFor, botConfigFor, DRAGON_PARTY_LEVEL, goldForOneHour, resolveEquipment, skillsFor,
  type DragonPartyVocation,
} from './dragon-party-plan.js';

export interface DragonPartySeedResult {
  readonly characterId: string;
  readonly vocationId: DragonPartyVocation;
  readonly level: number;
  readonly xp: number;
  readonly gold: number;
  readonly capacity: number;
  readonly equippedItemIds: readonly string[];
}

/**
 * Sobe um personagem JÁ EXISTENTE para o level 200 da party de dragões: vocação, xp coerente com
 * o level pela curva do Tibia (#521), skills, ouro para uma hora, o kit do #524 e o bot v2.
 *
 * Idempotente: reroda sobre o MESMO personagem e converge para o mesmo estado — a linha é
 * sobrescrita inteira, e o equipamento é apagado e reinserido (o índice único de
 * `item_instance_one_per_slot` derrubaria um segundo kit por cima do kit de nascimento ou de uma
 * corrida anterior se a escrita fosse aditiva).
 *
 * `gold` e o kit NÃO passam pelo ledger (invariante 10) de propósito — pela mesma razão que o
 * kit de nascimento não passa (`packages/server/src/db/repository.ts`, `createCharacter`): isto
 * é INICIALIZAÇÃO de linha, não movimentação durante uma sessão. O ledger existe para auditar
 * ganho e gasto ao vivo com `(session_id, seq)` único; aqui não há sessão nenhuma rodando, e
 * "de onde veio o ouro" é sempre a mesma resposta — este script, com este `characterId` — então
 * não há nada para uma chave de idempotência proteger.
 */
export async function seedCharacterStats(
  db: Database, content: Content, characterId: string, vocationId: DragonPartyVocation,
): Promise<DragonPartySeedResult> {
  const vocation = content.vocations.get(vocationId);
  if (vocation === undefined) {
    throw new Error(`dragon-party: vocação "${vocationId}" não existe no conteúdo desta branch`);
  }

  const level = DRAGON_PARTY_LEVEL;
  const xp = totalXpForLevel(level, content.progression);
  const stats = statsForLevel(level, vocation, content.progression);
  const skills = skillsFor(vocationId);
  const ammo = ammoFor(vocationId);
  const botConfig = botConfigFor(vocationId);

  const botProblems = validateBotConfigV2(botConfig, content);
  if (botProblems.length > 0) {
    throw new Error(`dragon-party: bot config inválida para ${vocationId}: ${botProblems.join('; ')}`);
  }
  const gold = goldForOneHour(content, botConfig, ammo);

  // Resolve e confere o kit ANTES de abrir a transação — um item ausente nesta branch (por
  // exemplo, rodando antes do #524 estar integrado) falha com mensagem clara, sem deixar a linha
  // do personagem escrita pela metade.
  const equipment = resolveEquipment(content, vocationId);

  await db.transaction(async (tx) => {
    await tx.update(schema.characters).set({
      vocation: vocationId,
      level,
      xp,
      skills,
      gold,
      capacity: stats.capacity,
      botConfig,
      ...(ammo === null ? {} : { ammo }),
    }).where(eq(schema.characters.id, characterId));

    await tx.delete(schema.itemInstances).where(eq(schema.itemInstances.ownerCharacterId, characterId));
    await tx.insert(schema.itemInstances).values(equipment.map((piece, index) => ({
      id: `${characterId}:dragon-kit:${index + 1}`,
      itemId: piece.itemId,
      ownerCharacterId: characterId,
      origin: 'dragon-party-seed',
      equippedSlot: piece.slot,
    })));
  });

  return {
    characterId, vocationId, level, xp, gold, capacity: stats.capacity,
    equippedItemIds: equipment.map((piece) => piece.itemId),
  };
}
