-- #731 (ADR 0050 d.6 T2): storages por personagem — `storageKey → value`, a semente do motor de
-- quest. A mesma pergunta do Canary (`player:getStorageValue`/`setStorageValue`); ausente é
-- SEMPRE "nunca setado" (-1, convenção do Tibia), e não é gravado (ver `character-storage.ts`,
-- `sim`): quem quer "esquecer" um storage apaga a linha, nunca grava `-1` nela.
--
-- Aditiva por construção (ADR 0014): tabela nova, sem tocar coluna existente.
--
-- Uma linha por chave, e NÃO uma coluna `jsonb` em `character` (ao contrário de `bestiary`/
-- `ammo`/`supply_stock`): só a Cidade de Thais tem ~110 interativos gated por storage (51
-- portas de chave + 59 baús, ADR 0050 contexto), e o motor de quest que este sistema semeia só
-- cresce daqui — ler/escrever POR CHAVE, sem reescrever um blob inteiro a cada storage tocado,
-- é o que essa forma compra desde já.
--
-- `id` próprio, como `friend`: a linha é uma entidade, e o índice único faz o papel de trava
-- contra duplo clique/retry — o extrato do ledger faz `ON CONFLICT` contra ele (invariantes 9
-- e 10: storage é estado do personagem, escrito só pelo extrato da sessão dona, na mesma régua
-- do overlay de item por instância, #604).
CREATE TABLE character_storage (
  id text PRIMARY KEY,
  character_id text NOT NULL REFERENCES character(id),
  storage_key text NOT NULL,
  value integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Um personagem, uma chave — uma linha. A trava contra duplo clique/retry, como
-- `friend_pair_unique`.
CREATE UNIQUE INDEX character_storage_key_unique ON character_storage (character_id, storage_key);

-- O acesso real é "os storages DESTE personagem", na emissão do ticket — sem índice, ler varre
-- a tabela inteira.
CREATE INDEX character_storage_character ON character_storage (character_id);
