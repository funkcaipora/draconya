-- FUN-76: a instância de item, com identidade própria desde o dia um.
--
-- `docs/technical-architecture.md` §9 diz por que ela nasce assim e não como contador: **sem
-- identidade, lendário não tem proveniência.** Um inventário guardado como `{itemId: n}` é
-- barato até o dia em que alguém pergunta de onde veio aquela espada — e nesse dia a resposta
-- não existe em lugar nenhum, para item nenhum, retroativamente.
--
-- `item_id` é o id do CATÁLOGO, e catálogo é conteúdo (`packages/content/data/items/`). Por isso
-- não há chave estrangeira: o alvo dela não é uma tabela, e uma FK aqui obrigaria a espelhar o
-- catálogo no banco — dois lugares para a mesma verdade, divergindo no primeiro deploy em que
-- só um dos dois subir.
--
-- `quantity` existe por causa de item EMPILHÁVEL (munição). Item não empilhável usa 1, e é o
-- schema de conteúdo que diz qual é qual.
--
-- Nada nesta migration DÁ item a ninguém. Loot de item, inventário e caixa de loot são as
-- issues seguintes do marco.
CREATE TABLE item_instance (
  id text PRIMARY KEY,
  item_id text NOT NULL,
  owner_character_id text NOT NULL REFERENCES character(id),
  quantity integer NOT NULL DEFAULT 1,
  -- De onde veio (§25.3). Preencher isto é toda a proveniência de lendário que a arquitetura
  -- pede — e ela só vale se estiver certa desde a primeira instância, não a partir do dia em
  -- que alguém lembrar.
  origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_instance_quantity_positive CHECK (quantity > 0)
);

-- O acesso real é "o que este personagem tem": inventário, equipamento, caixa de loot. Sem
-- índice, cada abertura de inventário é varredura da tabela inteira.
CREATE INDEX item_instance_owner ON item_instance (owner_character_id);
