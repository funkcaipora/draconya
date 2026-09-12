-- #152: a munição escolhida por família é preferência do personagem (ADR 0026, decisão 3), e
-- sobrevive à sessão como a configuração do bot — quem escolheu onyx arrow não volta à arrow
-- grátis a cada login.
--
-- Aditiva por construção (ADR 0014): coluna nova, nulável, sem default. `null` é quem nunca
-- escolheu, e o `game` trata ausência como "a grátis de cada família". `jsonb` porque é um mapa
-- pequeno (`{ "arrow": "sniper-arrow" }`), lido inteiro no ticket e escrito inteiro no extrato.
-- Sem CHECK: os ids são conteúdo, versionado à parte, e uma escolha de munição que saiu do
-- catálogo vira a grátis na sessão, nunca uma linha que não se consegue ler.
ALTER TABLE character ADD COLUMN ammo jsonb;
