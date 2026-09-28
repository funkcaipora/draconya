-- #615 (M42, ADR 0054 decisão 7): a Boosted Creature do dia é do MUNDO, uma linha por dia — o
-- `jobs` a sorteia na hora de virada (`boosted.rolloverHourUtc`) e grava aqui, mais uma cópia em
-- Redis para a `api` (ver packages/server/src/world-daily.ts). `day` (UTC, `YYYY-MM-DD`, já
-- deslocado pela hora de virada) é a chave primária de propósito: `INSERT … ON CONFLICT (day) DO
-- NOTHING` faz o sorteio ser idempotente no mesmo dia sem lock a mais — a mesma trava que o
-- índice único já dá ao ledger (invariante 10). Sem `character_id`: todo mundo vê a mesma
-- boosted no mesmo dia.
CREATE TABLE "world_daily" (
	"day" text PRIMARY KEY NOT NULL,
	"boosted_monster_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
