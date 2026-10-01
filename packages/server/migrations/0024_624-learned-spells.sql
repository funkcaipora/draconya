-- #624 (M44-06), ADR 0058, ADR 0052 decisão 1: as magias APRENDIDAS do personagem — o registro
-- `learnedSpells` que o cast passa a conferir (`Spell::playerSpellCheck` do Canary, com o
-- `toggleLearnSpells` ligado) e que `learn-spell` alimenta, cobrando `learnPrice` pelo ledger.
--
-- Duas partes numa migração só, porque uma não existe sem a outra:
--
-- 1. **Coluna** (aditiva, ADR 0014): `learned_spells jsonb`, nulável, sem default — o registro
--    `{ spellIds, version }`, lido INTEIRO no ticket e escrito INTEIRO pela transação do ledger,
--    ÚLTIMA ESCRITA VENCE (como `charms`). `NULL` é personagem NOVO: não sabe magia nenhuma, como
--    no Tibia, e o kit de nascimento (ADR 0026) não muda.
--
-- 2. **Concessão única a quem já existe** (ADR 0058 d.4, ADR 0014): "poder lançar" é capacidade
--    persistida por level, e exigir que quem já jogava COMPRASSE de novo o que lançava ontem seria
--    regressão de capacidade sem fonte que a justifique — a pergunta que a #624 deixou para o
--    dono. Cada personagem que existe AGORA e tem vocação recebe todas as magias da vocação dele
--    cujo `minLevel` é menor ou igual ao level dele; magia sem vocação (Cure Poison) vale para
--    quem já tem o level. Quem ainda não escolheu vocação recebe só o que não exige uma.
--
-- **O catálogo abaixo é um RETRATO** do `packages/content/data/spells/*.json` no dia em que esta
-- migração foi escrita (119 magias: id, vocação, `minLevel`). É proposital que seja fixo: uma
-- migração de dado descreve o que era verdade na hora dela, e uma magia que o conteúdo criar
-- depois NÃO é concedida retroativamente — ela é comprada, como no Tibia. Nenhuma linha é
-- descartada nem reescrita além da coluna nova; `great-death-beam` (level 300) entra no retrato
-- porque quem já tivesse o level 300 e a lançasse não a perde.
ALTER TABLE character ADD COLUMN learned_spells jsonb;

UPDATE character AS c
SET learned_spells = jsonb_build_object(
  'version', 1,
  'spellIds', COALESCE(
    (
      SELECT jsonb_agg(s.id ORDER BY s.id)
      FROM (
        VALUES
      ('annihilation', 'knight', 110),
      ('apprentices-strike-druid', 'druid', 8),
      ('apprentices-strike-sorcerer', 'sorcerer', 8),
      ('berserk', 'knight', 35),
      ('blood-rage', 'knight', 60),
      ('bruise-bane', 'knight', 1),
      ('brutal-strike', 'knight', 16),
      ('buzz', 'sorcerer', 1),
      ('cancel-invisibility', 'paladin', 26),
      ('cancel-magic-shield-druid', 'druid', 14),
      ('cancel-magic-shield-sorcerer', 'sorcerer', 14),
      ('challenge', 'knight', 20),
      ('charge', 'knight', 25),
      ('chill-out', 'druid', 1),
      ('chivalrous-challenge', 'knight', 150),
      ('conjure-arrow', 'paladin', 13),
      ('conjure-avalanche-rune', 'druid', 30),
      ('conjure-explosion-rune-druid', 'druid', 31),
      ('conjure-explosion-rune-sorcerer', 'sorcerer', 31),
      ('conjure-great-fireball-rune', 'sorcerer', 30),
      ('conjure-heavy-magic-missile-rune-druid', 'druid', 25),
      ('conjure-heavy-magic-missile-rune-sorcerer', 'sorcerer', 25),
      ('conjure-intense-healing-rune', 'druid', 15),
      ('conjure-power-bolt', 'paladin', 59),
      ('conjure-sniper-arrow', 'paladin', 24),
      ('conjure-stone-shower-rune', 'druid', 28),
      ('conjure-sudden-death-rune', 'sorcerer', 45),
      ('conjure-thunderstorm-rune', 'sorcerer', 28),
      ('conjure-ultimate-healing-rune', 'druid', 24),
      ('cure-bleeding-druid', 'druid', 45),
      ('cure-bleeding-knight', 'knight', 45),
      ('cure-burning', 'druid', 30),
      ('cure-curse', 'paladin', 80),
      ('cure-electrification', 'druid', 22),
      ('cure-poison', NULL, 10),
      ('death-strike', 'sorcerer', 16),
      ('divine-caldera', 'paladin', 50),
      ('divine-healing', 'paladin', 35),
      ('divine-missile', 'paladin', 40),
      ('electrify', 'sorcerer', 34),
      ('enchant-party', 'sorcerer', 32),
      ('energy-beam', 'sorcerer', 23),
      ('energy-strike-druid', 'druid', 12),
      ('energy-strike-sorcerer', 'sorcerer', 12),
      ('energy-wave', 'sorcerer', 38),
      ('envenom', 'druid', 50),
      ('eternal-winter', 'druid', 60),
      ('ethereal-spear', 'paladin', 23),
      ('fierce-berserk', 'knight', 90),
      ('fire-wave', 'sorcerer', 18),
      ('flame-strike-druid', 'druid', 14),
      ('flame-strike-sorcerer', 'sorcerer', 14),
      ('front-sweep', 'knight', 70),
      ('great-death-beam', 'sorcerer', 300),
      ('great-energy-beam', 'sorcerer', 29),
      ('great-fire-wave', 'sorcerer', 38),
      ('groundshaker', 'knight', 33),
      ('haste-druid', 'druid', 14),
      ('haste-knight', 'knight', 14),
      ('haste-paladin', 'paladin', 14),
      ('haste-sorcerer', 'sorcerer', 14),
      ('heal-friend-druid', 'druid', 18),
      ('heal-party', 'druid', 32),
      ('hells-core', 'sorcerer', 60),
      ('holy-flash', 'paladin', 70),
      ('ice-strike-druid', 'druid', 15),
      ('ice-strike-sorcerer', 'sorcerer', 15),
      ('ice-wave', 'druid', 18),
      ('ignite', 'sorcerer', 26),
      ('inflict-wound', 'knight', 40),
      ('intense-healing-druid', 'druid', 20),
      ('intense-healing-paladin', 'paladin', 20),
      ('intense-wound-cleansing', 'knight', 80),
      ('invisibility-druid', 'druid', 35),
      ('invisibility-sorcerer', 'sorcerer', 35),
      ('lesser-ethereal-spear', 'paladin', 1),
      ('lesser-front-sweep', 'knight', 1),
      ('light-healing-druid', 'druid', 8),
      ('light-healing-paladin', 'paladin', 8),
      ('lightning', 'sorcerer', 55),
      ('magic-patch-druid', 'druid', 1),
      ('magic-patch-sorcerer', 'sorcerer', 1),
      ('magic-shield-druid', 'druid', 14),
      ('magic-shield-sorcerer', 'sorcerer', 14),
      ('mass-healing', 'druid', 36),
      ('mud-attack', 'druid', 1),
      ('physical-strike', 'druid', 16),
      ('protect-party', 'paladin', 32),
      ('protector', 'knight', 55),
      ('rage-of-the-skies', 'sorcerer', 55),
      ('recovery-knight', 'knight', 50),
      ('recovery-paladin', 'paladin', 50),
      ('salvation', 'paladin', 60),
      ('scorch', 'sorcerer', 1),
      ('sharpshooter', 'paladin', 60),
      ('strong-energy-strike', 'sorcerer', 80),
      ('strong-ethereal-spear', 'paladin', 90),
      ('strong-flame-strike', 'sorcerer', 70),
      ('strong-haste-druid', 'druid', 20),
      ('strong-haste-sorcerer', 'sorcerer', 20),
      ('strong-ice-strike', 'druid', 80),
      ('strong-ice-wave', 'druid', 40),
      ('strong-terra-strike', 'druid', 70),
      ('summon-creature-druid', 'druid', 25),
      ('summon-creature-sorcerer', 'sorcerer', 25),
      ('swift-foot', 'paladin', 55),
      ('terra-strike-druid', 'druid', 13),
      ('terra-strike-sorcerer', 'sorcerer', 13),
      ('terra-wave', 'druid', 38),
      ('train-party', 'knight', 32),
      ('ultimate-energy-strike', 'sorcerer', 100),
      ('ultimate-flame-strike', 'sorcerer', 90),
      ('ultimate-healing-druid', 'druid', 30),
      ('ultimate-healing-sorcerer', 'sorcerer', 30),
      ('ultimate-ice-strike', 'druid', 100),
      ('ultimate-terra-strike', 'druid', 90),
      ('whirlwind-throw', 'knight', 28),
      ('wound-cleansing', 'knight', 8),
      ('wrath-of-nature', 'druid', 55)
      ) AS s(id, vocation, min_level)
      WHERE (s.vocation IS NULL OR s.vocation = c.vocation)
        AND s.min_level <= c.level
    ),
    '[]'::jsonb
  )
);
