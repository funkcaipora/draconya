-- #726, ADR 0049 decisão 5: comida ativa (`fedMs`) precisa sobreviver ao logout, como a
-- stamina — sem isto, quem comeu antes de deslogar voltaria em jejum na hunt seguinte.
--
-- Aditiva por construção (ADR 0014): uma coluna nova, `bigint` com default 0 (mesmo tipo e
-- razão de `stamina_ms` — cabe milissegundos além do que `integer` aguenta). Zero é "nunca
-- comeu", o mesmo comportamento de todo personagem existente antes desta migração.
ALTER TABLE character ADD COLUMN fed_ms bigint NOT NULL DEFAULT 0;
