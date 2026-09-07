-- Aplicar uma vez em bancos criados com o schema em português, antes de subir o código novo.
-- Renomeia sem recriar tabelas nem descartar linhas. Bancos novos usam diretamente schema.ts.
BEGIN;

ALTER TABLE account RENAME COLUMN senha_hash TO password_hash;
ALTER TABLE account RENAME COLUMN criado_em TO created_at;
ALTER INDEX account_email_unico RENAME TO account_email_unique;
ALTER INDEX account_external_auth_unico RENAME TO account_external_auth_unique;

ALTER TABLE character RENAME COLUMN nome TO name;
ALTER TABLE character RENAME COLUMN vocacao TO vocation;
ALTER TABLE character RENAME COLUMN capacidade TO capacity;
ALTER TABLE character RENAME COLUMN premium_ate TO premium_until;
ALTER TABLE character RENAME COLUMN stamina_atualizada_em TO stamina_updated_at;
ALTER TABLE character RENAME COLUMN estado TO state;
ALTER TABLE character RENAME COLUMN sessao_id TO session_id;
ALTER TABLE character RENAME COLUMN criado_em TO created_at;
ALTER TABLE character ALTER COLUMN state SET DEFAULT 'city';
UPDATE character SET state = CASE state
  WHEN 'cidade' THEN 'city'
  WHEN 'treino' THEN 'training'
  ELSE state
END WHERE state IN ('cidade', 'treino');
ALTER INDEX character_nome_unico RENAME TO character_name_unique;
ALTER INDEX character_por_conta RENAME TO character_by_account;

ALTER TABLE ledger RENAME COLUMN tipo TO type;
ALTER TABLE ledger RENAME COLUMN criado_em TO created_at;
ALTER INDEX ledger_sessao_seq_unico RENAME TO ledger_session_seq_unique;
ALTER INDEX ledger_por_personagem RENAME TO ledger_by_character;

COMMIT;
