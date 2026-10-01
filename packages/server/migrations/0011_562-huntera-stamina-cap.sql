-- #562 (M32-01, ADR 0043 emenda 2026-09-25 "copie do Huntera"): o teto de stamina muda de 24 h
-- (86.400.000 ms, o número com que o Draconya subiu, sem fonte) para 12 h (43.200.000 ms) — o
-- teto que o Huntera mostra cheio na Cidade (huntera-observed.md Parte II §15, linhas 361-362).
-- O consumo em hunt e a recuperação fora dela continuam 1:1 dos dois lados; só o teto muda.
--
-- Dado persistido migra, nunca é descartado às cegas (ADR 0014). Quem já tem MENOS que o novo
-- teto guardado mantém o valor exato — nenhuma stamina é inventada. Quem tem MAIS (a coluna
-- aceitava até 24 h) é CLAMPADO para 43.200.000: preserva o tempo ABSOLUTO de quem está abaixo
-- do novo teto, nunca reescala pela FRAÇÃO do teto antigo (a mesma regra que `clampStamina` já
-- aplica na LEITURA em packages/sim/src/stamina.ts — esta migração só antecipa o mesmo corte
-- para a linha durável, em vez de esperar a próxima entrada/saída de hunt que materializa).
ALTER TABLE character ALTER COLUMN stamina_ms SET DEFAULT 43200000;

UPDATE character SET stamina_ms = 43200000 WHERE stamina_ms > 43200000;
