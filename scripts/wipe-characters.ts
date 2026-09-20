// Limpeza de personagens (#496): `TRUNCATE TABLE "character" CASCADE` com o que ele leva
// junto — `item_instance`, `ledger` e `friend` têm FK para `character` e caem na cascata.
//
// Existe para reiniciar a progressão (nível 1 ao 8 com o novo fluxo) sem personagem antigo
// atravessando a mudança. É IRREVERSÍVEL: o backup do Postgres é a única volta
// (`./scripts/backup-postgres.sh`, e o cron da VPS já o roda todo dia).
//
// Uso:
//   pnpm db:wipe-characters                    # local: lê DATABASE_URL do .env, pede confirmação
//   pnpm db:wipe-characters -- --yes           # sem pergunta (CI, ssh)
//   pnpm db:wipe-characters -- --redis         # limpa também as chaves de sessão do Redis
//
// O Redis é opcional e opt-in: sem ele, as chaves órfãs do diretório têm TTL e morrem sozinhas.
// Com `--redis`, as chaves de CICLO DE VIDA de personagem e sessão vão junto — extratos
// pendentes (`receipt:*`) que virariam linha de ledger sobre personagem inexistente, snapshots
// que reviveriam uma sessão sem dono, tickets, parties e configuração de bot.

import postgres from 'postgres';

// Prefixos de CICLO DE VIDA de sessão e personagem (ADR 0024, FUN-28, FUN-88). Nada de conta
// pura — `auth:session:*` é do login, e a conta não é apagada aqui.
const REDIS_PREFIXES = [
  'char:*',                    // diretório: onde o personagem está (lease)
  'session:*',                 // snapshots de sessão
  'receipt:*',                 // extratos pendentes, legacy e por membro
  'receipts:char:*',           // índice de extrato por personagem
  'lootbox:*',                 // caixas de loot com TTL
  'ticket:*',                  // claims de ticket
  'tickets:pending',           // reservas de slot em aberto
  'party:*',                   // formulário e estado de party
  'matchmaking:*',             // fila de matchmaking
  'bot-config:*',              // pendência e corrompidas de bot
  'account:*:active',          // contagem de personagens ativos (limite de 2)
];

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const yes = args.includes('--yes');
const cleanRedis = args.includes('--redis');
const flag = (name: string): string | undefined => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg === undefined ? undefined : arg.slice(name.length + 3);
};

const databaseUrl = flag('database-url') ?? process.env['DATABASE_URL'] ?? '';
if (databaseUrl === '') {
  console.error('wipe: DATABASE_URL não definida — passe --database-url= ou rode com o .env carregado');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });

// As tabelas são CONSTANTES deste script — nenhuma chega por argumento, então o texto delas
// na query é seguro ("character" precisa de aspas: é palavra reservada do SQL). Só as que o
// schema já tem entram na contagem: um banco sem migração nenhuma não tem nada a apagar, e o
// erro do Postgres por tabela ausente diria menos que uma linha dizendo por quê.
const WIPE_TABLES = ['character', 'item_instance', 'ledger', 'friend'] as const;

async function wipe(): Promise<void> {
  const present = await sql`
    select table_name::text from information_schema.tables
    where table_schema = current_schema()
      and table_name in ('character', 'item_instance', 'ledger', 'friend')
  `;
  const names = present.map((row) => row.table_name as (typeof WIPE_TABLES)[number]).sort();
  if (!names.includes('character')) {
    console.log('wipe: o schema ainda não tem a tabela "character" — rode as migrações primeiro; nada a apagar.');
    return;
  }
  const columns = names
    .map((name) => `(select count(*)::int from "${name}") as "${name}"`)
    .join(', ');
  const before = (await sql.unsafe(`select ${columns}`))[0] as Record<string, number>;
  const values = Object.entries(before);
  const total = values.reduce((sum, [, n]) => sum + n, 0);

  console.log(`wipe: contagem antes da limpeza (${databaseUrl.replace(/:\/\/[^@]*@/, '://***@')})`);
  for (const [table, rows] of values) {
    console.log(`  ${table}: ${rows}`);
  }
  if (total === 0) {
    console.log('wipe: nada a apagar.');
    return;
  }
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error('wipe: sem terminal interativo — confirme com --yes.');
      process.exit(1);
    }
    process.stdout.write(`wipe: apagar ${total} linhas, incluindo ${before.character} personagens? Escreva WIPE para confirmar: `);
    const answer = await new Promise<string>((resolve) => {
      process.stdin.once('data', (data: Buffer) => {
        process.stdin.pause();
        resolve(data.toString().trim());
      });
    });
    if (answer !== 'WIPE') {
      console.log('wipe: cancelado.');
      return;
    }
  }

  await sql`truncate table "character" cascade`;
  const afterRows = await sql`
    select count(*)::int as characters from "character"
  `;
  const after = (afterRows[0] as { characters: number } | undefined)?.characters ?? 1;
  if (after !== 0) {
    // A cascata é confiança, não verificação: conferir que o truncado truncou.
    throw new Error(`wipe: a tabela "character" ainda tem ${after} linhas depois do truncate`);
  }
  console.log('wipe: "character" truncada; cascata apagou item_instance, ledger e friend.');
}

// Opcional e opt-in (--redis): chaves órfãs têm TTL e morrem sozinhas, mas as de extrato
// pendente virariam linha de ledger para personagem que não existe mais — FK violada, e a
// liquidação falhando para sempre. Limpar junto é o que mantém o ambiente arejado.
async function wipeRedis(): Promise<void> {
  const url = flag('redis-url') ?? process.env['REDIS_URL'];
  if (!url) {
    console.error('wipe: --redis pede REDIS_URL (env) ou --redis-url=.');
    process.exit(1);
  }
  const { default: Redis } = await import('ioredis');
  const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: false });

  const deleted: Record<string, number> = {};
  for (const prefix of REDIS_PREFIXES) {
    let cursor = '0';
    let n = 0;
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', prefix, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) {
        await redis.unlink(...keys);
        n += keys.length;
      }
    } while (cursor !== '0');
    if (n > 0) deleted[prefix] = n;
  }
  redis.disconnect();
  const entries = Object.entries(deleted);
  if (entries.length === 0) {
    console.log('wipe(redis): nenhuma chave de sessão.');
    return;
  }
  for (const [prefix, n] of entries) console.log(`  ${prefix}: ${n} chaves`);
  console.log('wipe(redis): chaves de sessão e extratos limpas.');
}

try {
  await wipe();
  if (cleanRedis) await wipeRedis();
} catch (error) {
  console.error('wipe: falhou.', error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}