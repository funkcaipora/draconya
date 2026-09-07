import type { Config } from 'drizzle-kit';

export default {
  schema: './packages/server/src/db/schema.ts',
  out: './packages/server/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://draconya:draconya@localhost:5432/draconya',
  },
  // Migração gerada é conveniente e NÃO é confiável sem leitura: sempre leia o SQL
  // antes de aplicar. Geração automática de migração destrutiva é armadilha conhecida (ADR 0011).
  verbose: true,
  strict: true,
} satisfies Config;
