-- #566, ADR 0042 decisão 1: promoção de vocação como estado do personagem, obtida na Cidade
-- (level 20, 20.000 gold). `promoted` é `not null default false` — diferente de `vocation`
-- (nulável): não precisa distinguir "nunca promovido" de "false", os dois são o mesmo estado, e
-- ele SÓ SOBE — não existe des-promoção no Tibia.
ALTER TABLE character ADD COLUMN promoted boolean NOT NULL DEFAULT false;
