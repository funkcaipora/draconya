-- #570, ADR 0052: as sete bênçãos PvE do Tibia, compradas na Cidade e consumidas na morte.
--
-- `blessings` é o BITMASK que `CharacterRuntime.blessings` guarda em memória — um bit por
-- `order` do catálogo (`content.blessings`). Mesmo padrão de `fed_ms` (#726): `bigint`/`number`
-- absoluto, última escrita vence, nunca fundido por máximo — bênção DESCE na morte, e fundir
-- pelo maior ressuscitaria uma bênção que acabou de ser consumida se um extrato antigo, fora de
-- ordem, chegasse depois de um mais novo já aplicado. Zero é "nenhuma bênção", o comportamento
-- de todo personagem existente antes desta migração (o antigo `premium` binário nunca escrevia
-- esta coluna — ela não existia).
ALTER TABLE character ADD COLUMN blessings bigint NOT NULL DEFAULT 0;
