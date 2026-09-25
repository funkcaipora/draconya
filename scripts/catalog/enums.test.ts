import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCanaryDir, sourceAvailable } from './env.js';
import {
  BESTIARY_TYPE_ENUM, BESTIARY_TYPE_HEADER, COMBAT_TYPE_ENUM, COMBAT_TYPE_HEADER,
  MAGIC_EFFECT_ENUM, MAGIC_EFFECT_HEADER, enumBody, extractEnum,
} from './enums.js';

// Fixtures PEQUENAS, escritas por nós no formato dos enums do Canary — sintaxe de C++, não
// conteúdo criativo, e nunca um trecho copiado (ADR 0019 limite 1). O objetivo aqui é a MECÂNICA
// de extração; os enums REAIS (`CombatType_t`, `BestiaryType_t`, `MagicEffectClasses`) são
// conferidos por um teste próprio contra o checkout local, condicional à máquina ter
// `things/sources/canary` — como `pnpm map:import --check`.
const SAMPLE_HEADER = `
// comentário de linha
enum class Color : uint8_t {
	RED,
	GREEN,
	BLUE,
};

/* comentário
   de bloco */
enum Flags : uint32_t {
	FLAG_NONE = 0,
	FLAG_A = 1 << 0,
	FLAG_B = 1 << 1,
	FLAG_AB = FLAG_A | FLAG_B,
};

enum Alias_t : uint8_t {
	ALIAS_FIRST = 1,
	ALIAS_SECOND = 2,

	ALIAS_ALSO_FIRST = ALIAS_FIRST,
};

enum Hex_t : uint8_t {
	HEX_A = 0x10,
	HEX_B = 0xFF,
};
`;

describe('enumBody', () => {
  it('extrai o corpo entre as chaves, sem elas', () => {
    const body = enumBody(SAMPLE_HEADER, 'Color');
    expect(body).toContain('RED');
    expect(body).not.toContain('{');
    expect(body).not.toContain('}');
  });

  it('lança quando o enum não existe no texto', () => {
    expect(() => enumBody(SAMPLE_HEADER, 'NaoExiste')).toThrow(/não encontrado/);
  });
});

describe('extractEnum', () => {
  it('sem valor explícito, incrementa a partir de 0 (regra do C++)', () => {
    expect(extractEnum(SAMPLE_HEADER, 'Color')).toEqual(new Map([
      ['RED', 0], ['GREEN', 1], ['BLUE', 2],
    ]));
  });

  it('shift e OR bit a bit, inclusive combinando enumeradores anteriores', () => {
    expect(extractEnum(SAMPLE_HEADER, 'Flags')).toEqual(new Map([
      ['FLAG_NONE', 0], ['FLAG_A', 1], ['FLAG_B', 2], ['FLAG_AB', 3],
    ]));
  });

  it('um enumerador pode valer o de outro já declarado no mesmo enum (BESTY_RACE_FIRST)', () => {
    expect(extractEnum(SAMPLE_HEADER, 'Alias_t')).toEqual(new Map([
      ['ALIAS_FIRST', 1], ['ALIAS_SECOND', 2], ['ALIAS_ALSO_FIRST', 1],
    ]));
  });

  it('hexadecimal', () => {
    expect(extractEnum(SAMPLE_HEADER, 'Hex_t')).toEqual(new Map([
      ['HEX_A', 16], ['HEX_B', 255],
    ]));
  });

  it('comentário de linha e de bloco não afetam o valor', () => {
    // A fixture já tem os dois tipos de comentário emoldurando os enums; a asserção acima já
    // prova que passam despercebidos, e este teste documenta a intenção.
    expect(extractEnum(SAMPLE_HEADER, 'Color').size).toBe(3);
  });
});

// O mesmo `--check` do `pnpm check` como teste (pack-inventory.test.ts segue o mesmo padrão
// para o pacote de arte): sem `things/sources/canary` nesta máquina (o CI) o bloco PULA — teste
// que passa sem conferir nada é falsa confiança, então ele aparece como pulado, não verde à toa.
const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const CANARY_DIR = resolveCanaryDir(REPO_ROOT);
const hasCanary = sourceAvailable(CANARY_DIR);

describe.skipIf(!hasCanary)('os três enums reais que os monstros e itens do Canary usam', () => {
  it('CombatType_t: COMBAT_PHYSICALDAMAGE é 0 e COMBAT_NONE é 255 (creatures_definitions.hpp)', () => {
    const header = readFileSync(join(CANARY_DIR, COMBAT_TYPE_HEADER), 'utf8');
    const combat = extractEnum(header, COMBAT_TYPE_ENUM);
    expect(combat.get('COMBAT_PHYSICALDAMAGE')).toBe(0);
    expect(combat.get('COMBAT_EARTHDAMAGE')).toBe(2);
    expect(combat.get('COMBAT_NONE')).toBe(255);
  });

  it('BestiaryType_t: BESTY_RACE_MAMMAL é 14, e FIRST/LAST resolvem por referência a outro enumerador', () => {
    const header = readFileSync(join(CANARY_DIR, BESTIARY_TYPE_HEADER), 'utf8');
    const bestiary = extractEnum(header, BESTIARY_TYPE_ENUM);
    expect(bestiary.get('BESTY_RACE_MAMMAL')).toBe(14);
    expect(bestiary.get('BESTY_RACE_FIRST')).toBe(bestiary.get('BESTY_RACE_AMPHIBIC'));
    expect(bestiary.get('BESTY_RACE_LAST')).toBe(bestiary.get('BESTY_RACE_INKBORN'));
  });

  it('MagicEffectClasses: CONST_ME_HITAREA é 10 (utils_definitions.hpp)', () => {
    const header = readFileSync(join(CANARY_DIR, MAGIC_EFFECT_HEADER), 'utf8');
    const magic = extractEnum(header, MAGIC_EFFECT_ENUM);
    expect(magic.get('CONST_ME_NONE')).toBe(0);
    expect(magic.get('CONST_ME_HITAREA')).toBe(10);
  });
});

describe.skipIf(hasCanary)('sem things/sources/canary nesta máquina', () => {
  it('só documenta que o bloco acima foi pulado — o CI não tem o Canary', () => {
    expect(existsSync(CANARY_DIR)).toBe(false);
  });
});
