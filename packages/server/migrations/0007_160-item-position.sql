-- #160: onde a instância está DENTRO do inventário (ADR 0026, decisão 6 — a mochila de 20 e a
-- bolsa de 10 do Huntera, crescendo por linhas). Aditiva por construção (ADR 0014): duas
-- colunas nuláveis, sem default. `null`/`null` com `equipped_slot` nulo é "na mochila, sem
-- posição gravada" — toda linha anterior a esta migração —, e o ticket a põe no primeiro
-- lugar livre. Sem índice único por posição: a sessão é a única escritora do layout e grava o
-- vetor inteiro pelo extrato; um índice esbarraria na troca A↔B no meio do UPDATE, como o de
-- slot esbarra, e o custo de "limpar antes" seria uma varredura por extrato.
ALTER TABLE item_instance ADD COLUMN container text;
ALTER TABLE item_instance ADD COLUMN slot_index integer;
