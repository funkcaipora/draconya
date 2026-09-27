-- #568 (ADR 0014): a #567 (PR #736) separou a skill única `melee` em quatro —
-- `fist`/`club`/`sword`/`axe` — mas não migrou o dado já gravado. Quem já tinha
-- `skills.melee` fica com essa entrada ÓRFÃ (nada mais escreve nela) até uma remoção
-- declarada; o progresso VÁLIDO vai para `club`/`sword`/`axe`, que tinham EXATAMENTE a
-- mesma curva que `melee` tinha antes da separação (`base: 50`, `factor` de fallback
-- 2.0, mesmo `startingLevel: 10` — só o `fist` divergia, com fallback 1.5, e por isso
-- NÃO herda o progresso: não há como saber, olhando `melee`, quanto daquele progresso
-- veio de golpe de punho versus de espada/machado/maça). `fist` nasce no inicial, por
-- OMISSÃO — é o mesmo comportamento de qualquer skill nunca usada (`Skills.levelOf`,
-- packages/sim/src/skills.ts).
--
-- `coalesce` protege contra sobrescrever progresso REAL: entre o deploy do #567 e o
-- desta migração, um personagem pode ter treinado `club`/`sword`/`axe` de verdade (o
-- `sim` já credita cada uma desde o #567) — se a chave já existe, ela VENCE, e `melee`
-- não a atropela. `melee` nunca é apagada (ADR 0014, nunca descartar dado).
UPDATE character
SET skills = skills || jsonb_build_object(
  'club',  coalesce(skills -> 'club',  skills -> 'melee'),
  'sword', coalesce(skills -> 'sword', skills -> 'melee'),
  'axe',   coalesce(skills -> 'axe',   skills -> 'melee')
)
WHERE skills ? 'melee';
