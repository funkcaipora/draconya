CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"external_auth_id" text,
	"password_hash" text,
	"coins" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"vocation" text,
	"level" integer DEFAULT 1 NOT NULL,
	"xp" bigint DEFAULT 0 NOT NULL,
	"skills" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gold" bigint DEFAULT 0 NOT NULL,
	"capacity" integer DEFAULT 400 NOT NULL,
	"premium_until" timestamp with time zone,
	"stamina_ms" bigint DEFAULT 86400000 NOT NULL,
	"stamina_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'city' NOT NULL,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "character_name_nfc" CHECK ("character"."name" = normalize("character"."name", NFC))
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"character_id" text NOT NULL,
	"session_id" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"delta" bigint NOT NULL,
	"ref" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character" ADD CONSTRAINT "character_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_character_id_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "character"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_email_unique" ON "account" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "account_external_auth_unique" ON "account" USING btree ("external_auth_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_name_unique" ON "character" USING btree (lower(normalize("name", NFC))) WHERE "character"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "character_by_account" ON "character" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_session_seq_unique" ON "ledger" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "ledger_by_character" ON "ledger" USING btree ("character_id","created_at");