-- FUN-82: onde a instância está — no corpo ou na mochila.
--
-- Coluna na INSTÂNCIA, e não uma tabela de equipamento à parte: o item está num lugar só, e um
-- lugar só é uma coluna. Uma tabela separada permitiria a mesma instância aparecer equipada e
-- na mochila ao mesmo tempo, que é um estado que ninguém quer ter de conciliar.
--
-- Nulável é "está na mochila", que é onde todo item nasce. Aditiva (ADR 0014): instância
-- gravada antes disto lê `null` e continua na mochila, que é onde ela estava.
ALTER TABLE item_instance ADD COLUMN equipped_slot text;

-- Um slot, um item. O índice parcial impede duas peças no mesmo lugar do mesmo personagem —
-- e impede no BANCO, que é o único lugar que continua valendo quando alguém escrever um
-- caminho novo de escrita.
CREATE UNIQUE INDEX item_instance_one_per_slot
  ON item_instance (owner_character_id, equipped_slot)
  WHERE equipped_slot IS NOT NULL;
