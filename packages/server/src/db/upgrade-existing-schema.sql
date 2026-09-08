-- Aplicar uma vez em bancos que já usam o schema em inglês anterior à FUN-11.
-- A transação preserva o schema anterior inteiro se nomes existentes colidirem sem diferenciar caixa.
BEGIN;

ALTER TABLE character ADD COLUMN deleted_at timestamptz;
UPDATE character SET name = normalize(name, NFC) WHERE name <> normalize(name, NFC);
ALTER TABLE character ADD CONSTRAINT character_name_nfc CHECK (name = normalize(name, NFC));
DROP INDEX character_name_unique;
CREATE UNIQUE INDEX character_name_unique
  ON character (lower(normalize(name, NFC)))
  WHERE deleted_at IS NULL;

COMMIT;
