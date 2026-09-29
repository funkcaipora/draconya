-- #550, M30-03 (ADR 0040): a postura de luta do jogador — o `fightMode` do Canary (ofensiva,
-- balanceada, defensiva) —, escolhida na HUD com a intenção `set-fight-mode` e aplicada pela
-- sessão dona (invariante 9) ao dano de arma, à defesa e à mitigação do `combat-v3`.
--
-- Aditiva por construção (ADR 0014): coluna nova, `NOT NULL DEFAULT 'attack'` — o
-- `FIGHTMODE_ATTACK` que o Canary usa quando ninguém escolheu (`player.hpp:1857`), e o que todo
-- personagem existente já vivia (o `attackFactor` do conteúdo era 1,0 = ofensivo, e a defesa lia
-- a postura ofensiva fixa). Nenhuma linha é reescrita: o `DEFAULT` preenche as existentes sem
-- mudar o comportamento de ninguém.
--
-- ABSOLUTO e última escrita vence, como `blessings`/`soul`: a postura DESCE e SOBE por escolha, e
-- fundir por máximo seria um erro de tipo — não há ordem entre os três modos. Vem do extrato da
-- sessão dona (`jobs/ledger.ts`), nunca de um caminho `api`.
--
-- CHECK porque, ao contrário de `vocation`/`ammo` (ids de CONTEÚDO, versionado à parte), este é
-- um vocabulário FECHADO do protocolo e do Canary (`FightMode_t`): um valor fora dos três é
-- lixo, e o banco é quem continua valendo quando alguém escrever um caminho novo de escrita.
ALTER TABLE character ADD COLUMN fight_mode text NOT NULL DEFAULT 'attack'
  CONSTRAINT character_fight_mode CHECK (fight_mode IN ('attack', 'balanced', 'defense'));
