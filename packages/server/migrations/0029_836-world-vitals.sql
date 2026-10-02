-- #836, OW-15 (ADR 0060 decisões 3.b, 6 e 10.f): o personagem em REPOUSO passa a existir no mundo
-- com o que o Tibia guarda dele — o mundo, a posição absoluta, a cidade, a vida, a mana e as
-- condições (`canary/src/creatures/players/player.cpp:4041, 12332-12336`). É o que faz deslogar a
-- 10 HP não curar ninguém: hoje o ticket nasce cheio (`game/sessions.ts`) e a linha não guarda nada
-- disso.
--
-- Aditiva por construção (ADR 0014): só colunas novas, e nenhuma linha é reescrita — o `DEFAULT` das
-- duas `NOT NULL` preenche as existentes sem mudar o comportamento de ninguém, e as demais são
-- anuláveis, onde NULO é "não há o que restaurar":
--
--   world_id    o mundo a que o personagem pertence, escolhido na criação (`'main'` é o único hoje).
--   world_x/y/z a posição ABSOLUTA do Tibia (a do `otservbr.otbm`), onde ele saiu. Os três juntos ou
--               nenhum: nulo é o `0,0,0` do Canary (`iologindata_load_player.cpp:207-210`) — nasce no
--               templo. É absoluta desde o primeiro dia (decisão 3.b) para que crescer o mundo até o
--               mapa inteiro não custe migração.
--   town_id     a cidade do personagem — o templo para onde ele volta ao morrer (`player.cpp:4041`).
--   health,mana a vida e a mana com que ele saiu. NULO é CHEIO, como todo personagem existente vive
--               hoje: o ticket só as aplica quando existem, e sempre limitadas pelo máximo.
--   conditions  as condições ativas, como PRAZO RESTANTE (jsonb). NULO é nenhuma.
--
-- Todas são ABSOLUTAS e última escrita vence, guardadas por `durable_version` (#823): o `jobs` só as
-- escreve quando o extrato é mais novo que o que a coluna já viu — extrato atrasado nunca desfaz o
-- que um mais novo gravou. Vêm do extrato da sessão dona (`jobs/ledger.ts`), nunca de um caminho
-- `api`, e só com `OPEN_WORLD` ligado: com a flag desligada nada as escreve e o jogo é o de hoje.
--
-- CHECK porque o código garante as duas formas e o banco é quem continua valendo quando alguém
-- escrever um caminho novo de escrita: uma coordenada pela metade não aponta tile nenhum, e vida ou
-- mana negativa é lixo. Cada CHECK é conferido contra as linhas existentes, todas nulas nas colunas
-- novas — passam sem reescrever nada.
ALTER TABLE character
  ADD COLUMN world_id text NOT NULL DEFAULT 'main',
  ADD COLUMN world_x integer,
  ADD COLUMN world_y integer,
  ADD COLUMN world_z smallint,
  ADD COLUMN town_id text NOT NULL DEFAULT 'thais',
  ADD COLUMN health integer,
  ADD COLUMN mana integer,
  ADD COLUMN conditions jsonb,
  ADD CONSTRAINT character_world_position_complete CHECK (
    (world_x IS NULL AND world_y IS NULL AND world_z IS NULL)
    OR (world_x IS NOT NULL AND world_y IS NOT NULL AND world_z IS NOT NULL)
  ),
  ADD CONSTRAINT character_vitals_not_negative CHECK (
    (health IS NULL OR health >= 0) AND (mana IS NULL OR mana >= 0)
  );
