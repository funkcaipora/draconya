// Configuração do personagem Caiporinha:
// - Saldo de 20 milhões de gold
// - Limpeza completa do inventário (sem sobras na mochila)
// - Equipamento com o melhor set disponível para a vocação
//
// Uso:
//   pnpm setup:caiporinha
//   pnpm setup:caiporinha --database-url=postgres://draconya:draconya@localhost:5432/draconya
//   pnpm setup:caiporinha --vocation=druid --gold=20000000

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { loadContent } from '../packages/content/src/load.js';
import type { Content } from '../packages/content/src/index.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface GearPiece {
  readonly slot: string;
  readonly itemId: string;
}

export const TOP_SETS_BY_VOCATION: Record<string, readonly GearPiece[]> = {
  knight: [
    { slot: 'back', itemId: 'backpack' },
    { slot: 'head', itemId: 'royal-helmet' },
    { slot: 'chest', itemId: 'magic-plate-armor' },
    { slot: 'legs', itemId: 'crown-legs' },
    { slot: 'feet', itemId: 'boots-of-haste' },
    { slot: 'shield', itemId: 'mastermind-shield' },
    { slot: 'hand', itemId: 'mystic-blade' },
    { slot: 'neck', itemId: 'dragon-necklace' },
    { slot: 'finger', itemId: 'might-ring' },
  ],
  druid: [
    { slot: 'back', itemId: 'backpack' },
    { slot: 'head', itemId: 'hat-of-the-mad' },
    { slot: 'chest', itemId: 'focus-cape' },
    { slot: 'legs', itemId: 'zaoan-legs' },
    { slot: 'feet', itemId: 'boots-of-haste' },
    { slot: 'shield', itemId: 'spellbook-of-mind-control' },
    { slot: 'hand', itemId: 'underworld-rod' },
    { slot: 'neck', itemId: 'dragon-necklace' },
    { slot: 'finger', itemId: 'ring-of-healing' },
  ],
  sorcerer: [
    { slot: 'back', itemId: 'backpack' },
    { slot: 'head', itemId: 'hat-of-the-mad' },
    { slot: 'chest', itemId: 'focus-cape' },
    { slot: 'legs', itemId: 'zaoan-legs' },
    { slot: 'feet', itemId: 'boots-of-haste' },
    { slot: 'shield', itemId: 'spellbook-of-mind-control' },
    { slot: 'hand', itemId: 'wand-of-starstorm' },
    { slot: 'neck', itemId: 'dragon-necklace' },
    { slot: 'finger', itemId: 'ring-of-healing' },
  ],
  paladin: [
    { slot: 'back', itemId: 'backpack' },
    { slot: 'head', itemId: 'royal-helmet' },
    { slot: 'chest', itemId: 'paladin-armor' },
    { slot: 'legs', itemId: 'crown-legs' },
    { slot: 'feet', itemId: 'boots-of-haste' },
    { slot: 'hand', itemId: 'royal-crossbow' },
    { slot: 'neck', itemId: 'dragon-necklace' },
    { slot: 'finger', itemId: 'might-ring' },
  ],
};

export const BACKPACK_ITEMS_BY_VOCATION: Record<string, readonly string[]> = {
  druid: [
    'energy-ring',
    'ring-of-healing',
    'springsprout-rod',
    'hailstorm-rod',
  ],
  sorcerer: [
    'energy-ring',
    'ring-of-healing',
    'wand-of-inferno',
  ],
  paladin: [
    'energy-ring',
    'might-ring',
  ],
  knight: [
    'energy-ring',
    'might-ring',
  ],
};

export const DEFAULT_SET: readonly GearPiece[] = [
  { slot: 'back', itemId: 'backpack' },
  { slot: 'head', itemId: 'royal-helmet' },
  { slot: 'chest', itemId: 'magic-plate-armor' },
  { slot: 'legs', itemId: 'crown-legs' },
  { slot: 'feet', itemId: 'boots-of-haste' },
  { slot: 'shield', itemId: 'mastermind-shield' },
  { slot: 'hand', itemId: 'mystic-blade' },
  { slot: 'neck', itemId: 'dragon-necklace' },
  { slot: 'finger', itemId: 'might-ring' },
];

export interface SetupCaiporinhaOptions {
  readonly characterName?: string | undefined;
  readonly gold?: number | undefined;
  readonly vocation?: string | undefined;
  readonly log?: ((msg: string) => void) | undefined;
}

export async function setupCaiporinha(
  sql: postgres.Sql,
  content: Content,
  options: SetupCaiporinhaOptions = {},
): Promise<{
  readonly characterId: string;
  readonly characterName: string;
  readonly gold: number;
  readonly vocation: string;
  readonly equippedPieces: readonly GearPiece[];
}> {
  const charName = options.characterName ?? 'Caiporinha';
  const targetGold = options.gold ?? 20_000_000;
  const log = options.log ?? ((msg: string) => console.log(msg));

  // Busca o personagem de forma case-insensitive
  const rows = await sql<Array<{ id: string; name: string; vocation: string | null; capacity: number }>>`
    select id, name, vocation, capacity from "character"
    where lower(name) = lower(${charName})
    limit 1
  `;

  let character = rows[0];

  if (character === undefined) {
    log(`Personagem "${charName}" não encontrado. Criando nova conta e personagem...`);
    const accounts = await sql<Array<{ id: string }>>`select id from "account" limit 1`;
    let accountId: string;
    if (accounts.length > 0 && accounts[0]) {
      accountId = accounts[0].id;
    } else {
      accountId = 'account:caiporinha';
      await sql`insert into "account" (id, email, coins) values (${accountId}, 'caiporinha@draconya.test', 100)`;
    }

    const charId = `char:${charName.toLowerCase()}`;
    const initialVocation = options.vocation ?? 'druid';
    await sql`
      insert into "character" (id, account_id, name, vocation, level, gold, capacity)
      values (${charId}, ${accountId}, ${charName}, ${initialVocation}, 100, ${targetGold}, 2500)
    `;

    const newRows = await sql<Array<{ id: string; name: string; vocation: string | null; capacity: number }>>`
      select id, name, vocation, capacity from "character" where id = ${charId} limit 1
    `;
    character = newRows[0];
    if (character === undefined) {
      throw new Error(`Falha ao criar personagem "${charName}"`);
    }
  }

  const effectiveVocation = options.vocation ?? character.vocation ?? 'druid';
  const gearList = TOP_SETS_BY_VOCATION[effectiveVocation] ?? DEFAULT_SET;
  const backpackList = BACKPACK_ITEMS_BY_VOCATION[effectiveVocation] ?? [];

  // Validação: garante que todos os itens existam no catálogo de conteúdo
  for (const piece of gearList) {
    if (!content.items.has(piece.itemId)) {
      throw new Error(`Item "${piece.itemId}" do set não existe em content.items`);
    }
  }
  for (const itemId of backpackList) {
    if (!content.items.has(itemId)) {
      throw new Error(`Item "${itemId}" da mochila não existe em content.items`);
    }
  }

  await sql.begin(async (tx) => {
    // 1. Atualiza saldo de gold e vocação (se especificada)
    if (options.vocation) {
      await tx`
        update "character"
        set gold = ${targetGold}, vocation = ${options.vocation}, capacity = greatest(capacity, 2500)
        where id = ${character.id}
      `;
    } else {
      await tx`
        update "character"
        set gold = ${targetGold}, capacity = greatest(capacity, 2500)
        where id = ${character.id}
      `;
    }

    // 2. Limpa todo o inventário e equipamentos antigos do personagem
    await tx`delete from "item_instance" where owner_character_id = ${character.id}`;

    // 3. Insere o novo melhor set vestido nos slots apropriados
    for (let i = 0; i < gearList.length; i++) {
      const piece = gearList[i]!;
      const instanceId = `${character.id}:gear:${piece.slot}:${i + 1}`;
      await tx`
        insert into "item_instance" (id, item_id, owner_character_id, origin, equipped_slot, quantity)
        values (${instanceId}, ${piece.itemId}, ${character.id}, 'setup-caiporinha', ${piece.slot}, 1)
      `;
    }

    // 4. Insere os itens extras na mochila
    for (let i = 0; i < backpackList.length; i++) {
      const itemId = backpackList[i]!;
      const instanceId = `${character.id}:bag:${itemId}:${i + 1}`;
      await tx`
        insert into "item_instance" (id, item_id, owner_character_id, origin, container, slot_index, quantity)
        values (${instanceId}, ${itemId}, ${character.id}, 'setup-caiporinha', 'backpack', ${i}, 1)
      `;
    }
  });

  log(`✓ Personagem "${character.name}" atualizado:`);
  log(`  - Saldo de gold: ${targetGold.toLocaleString('pt-BR')} gp`);
  log(`  - Vocação: ${effectiveVocation}`);
  log(`  - Set equipado (${gearList.length} peças):`);
  for (const piece of gearList) {
    const item = content.items.get(piece.itemId);
    log(`      [${piece.slot.toUpperCase()}] ${item?.name ?? piece.itemId}`);
  }
  if (backpackList.length > 0) {
    log(`  - Itens na mochila (${backpackList.length} itens):`);
    for (const itemId of backpackList) {
      const item = content.items.get(itemId);
      log(`      [MOCHILA] ${item?.name ?? itemId}`);
    }
  }

  return {
    characterId: character.id,
    characterName: character.name,
    gold: targetGold,
    vocation: effectiveVocation,
    equippedPieces: gearList,
  };
}

// Execução via linha de comando
async function main(): Promise<void> {
  function getFlag(name: string): string | undefined {
    const prefix = `--${name}=`;
    const arg = process.argv.find((a) => a.startsWith(prefix));
    return arg?.slice(prefix.length);
  }

  const databaseUrl =
    getFlag('database-url') ??
    process.env['DATABASE_URL'] ??
    'postgres://draconya:draconya@localhost:5432/draconya';

  const vocation = getFlag('vocation');
  const gold = getFlag('gold') ? Number(getFlag('gold')) : undefined;
  const name = getFlag('name') ?? 'Caiporinha';

  const contentDir = resolve(REPO_ROOT, 'packages', 'content', 'data');
  const content = loadContent(contentDir);
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    try {
      await sql`select 1`;
    } catch {
      console.error(
        `setup:caiporinha: não foi possível conectar ao Postgres em "${databaseUrl}".\n` +
          'Certifique-se de que o Postgres está rodando ou passe --database-url= (veja docs/local-dragon-party.md).',
      );
      process.exitCode = 1;
      return;
    }
    await setupCaiporinha(sql, content, {
      characterName: name,
      vocation,
      gold,
    });
  } catch (error) {
    console.error('setup:caiporinha falhou:', error);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
