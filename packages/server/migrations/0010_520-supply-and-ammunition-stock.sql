-- #520 (revisão do PR #536): loot de Dragon/Dragon Lord pode ser um supply (Strong Health
-- Potion) ou uma munição física (Burst Arrow, Power Bolt) — os dois abstratos no USO (sem
-- pilha física, ADR 0026 d.7/ADR 0032 d.6), mas o que caiu em loot precisa sobreviver à sessão
-- para poder ser gasto antes do gold, senão o jogador perde o drop a cada logout.
--
-- Aditiva por construção (ADR 0014): duas colunas novas, nuláveis, sem default. `null` é quem
-- nunca recebeu um drop. `jsonb` como `ammo`/`bestiary`: mapa pequeno (`{ supplyId: quantidade }`
-- / `{ ammunitionId: quantidade }`), lido inteiro no ticket e escrito inteiro no extrato — ÚLTIMA
-- ESCRITA VENCE, como `ammo` (não monotônico como o Bestiário: o estoque sobe por loot e desce
-- por uso na MESMA sessão). Sem CHECK: os ids são conteúdo, versionado à parte, e um id que saiu
-- do catálogo simplesmente não é gasto por `useSupply`/o tiro, nunca uma linha ilegível.
ALTER TABLE character ADD COLUMN supply_stock jsonb;
ALTER TABLE character ADD COLUMN ammunition_stock jsonb;
