-- #521 (ADR 0037): a curva de XP passa a ser a do Tibia (`Player::getExpForLevel`, Canary/TFS
-- — verificado em `opentibiabr/canary` `main` 2026-09-24), substituindo `round(20 × level²)`.
-- `xp` no personagem é o TOTAL ACUMULADO (`packages/sim/src/progression.ts`), e uma curva nova
-- muda o que esse número SIGNIFICA — o mesmo `xp` aponta para um level diferente sob a curva
-- nova. Migração de dado, não de schema (ADR 0014): quem já existe PRESERVA o level e a fração
-- de progresso dentro dele, recalculada na curva nova.
--
-- A fórmula: `xp_novo = total_novo(L) + fração × completar_novo(L)`, com
-- `fração = (xp_antigo − total_antigo(L)) / completar_antigo(L)` e `L` o level ATUAL da linha
-- (nunca muda aqui — só a XP muda; o `game` recalcula o level a partir da XP nova na próxima
-- leitura, como sempre fez).
--
-- As duas curvas em SQL fechado, sem laço, sem função:
--   antiga — `round(20 × level²)` somado de 1 a L−1 é soma de quadrados:
--            `total_antigo(L) = 20 × (L−1) × L × (2L−1) / 6` (sempre inteira: um produto de
--            três inteiros consecutivos, `(L-1)·L·(2L-1)`, é sempre múltiplo de 6 — a mesma
--            razão de "soma de quadrados" de sempre, não precisa arredondar).
--   nova   — a cúbica do Tibia: `total_novo(L) = (L³ − 6L² + 17L − 12) / 6 × 100`, também
--            sempre inteira: `L³ − L` é o produto de três inteiros consecutivos e por isso
--            múltiplo de 6, e o resto da expressão já é múltiplo de 6 sozinho.
--
-- Sem proteção contra `level` fora de alcance: todo `character.level` existente é >= 1 por
-- `CHECK`/default do schema, e as duas curvas valem para qualquer inteiro positivo.
WITH old_curve AS (
  SELECT
    id,
    level,
    xp,
    (20::bigint * (level - 1) * level * (2 * level - 1) / 6) AS old_total,
    (20::bigint * level * level) AS old_to_complete
  FROM character
),
progress AS (
  SELECT
    id,
    level,
    -- Piso 0 e teto 1: rede de segurança contra uma linha com `xp` fora da faixa esperada do
    -- seu próprio `level` (nunca deveria acontecer — a aplicação mantém os dois em sincronia —,
    -- mas uma migração não deve produzir XP negativa ou acima do próximo level por causa de um
    -- dado que já estava inconsistente antes dela).
    LEAST(1.0, GREATEST(0.0,
      CASE WHEN old_to_complete = 0 THEN 0.0
           ELSE (xp - old_total)::double precision / old_to_complete
      END
    )) AS fraction
  FROM old_curve
),
new_curve AS (
  SELECT
    p.id,
    p.fraction,
    ((p.level::bigint * p.level * p.level - 6 * p.level * p.level + 17 * p.level - 12) / 6 * 100) AS new_total,
    (
      ((p.level + 1)::bigint * (p.level + 1) * (p.level + 1)
        - 6 * (p.level + 1) * (p.level + 1) + 17 * (p.level + 1) - 12) / 6 * 100
    ) AS new_total_next
  FROM progress p
)
UPDATE character AS c
SET xp = ROUND(n.new_total + n.fraction * (n.new_total_next - n.new_total))::bigint
FROM new_curve n
WHERE c.id = n.id;
