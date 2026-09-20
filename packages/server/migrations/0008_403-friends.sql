-- #403: a lista de amigos, mínimo do §21 (ADR 0031 decisão 6 — "Sala pública e Amigos").
--
-- Amizade é dado social plano, não mecânica de jogo: uma tabela e três rotas HTTP, sem pedido
-- de amizade nem bloqueio (o kit desenha as abas, e elas esperam o épico social). A direção é
-- ÚNICA — A ter B como amigo não implica B ter A; a reciprocidade automática é a alternativa
-- "Amigos completo" que o ADR 0031 descarta.
--
-- `id` próprio, e não chave composta: a linha é uma entidade (tem `created_at`), e o par único
-- é a trava contra duplo clique e retry, não a identidade. Nenhuma coluna de presença: online e
-- onde vêm do diretório de sessões, que já é a única fonte de verdade (invariante 9 — nenhuma
-- cópia de estado quente fora do dono).
CREATE TABLE friend (
  id text PRIMARY KEY,
  character_id text NOT NULL REFERENCES character(id),
  friend_character_id text NOT NULL REFERENCES character(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friend_not_self CHECK (character_id <> friend_character_id)
);

-- Retry de "adicionar" nunca duplica: o índice é a trava, não uma checagem otimista antes do
-- insert. É o que faz o duplo clique devolver 409 em vez de duas linhas.
CREATE UNIQUE INDEX friend_pair_unique ON friend (character_id, friend_character_id);

-- O acesso real é "os amigos DESTE personagem"; sem índice, listar varre a tabela inteira.
CREATE INDEX friend_character ON friend (character_id);
