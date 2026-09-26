// scripts/catalog/enums.ts — extrai os enums C++ que o Canary registra como constante global
// para o Lua (COMBAT_*, BESTY_RACE_*, CONST_ME_*, …), direto do cabeçalho onde o VALOR mora.
//
// O Lua nunca declara `COMBAT_PHYSICALDAMAGE = 0`: o número vem do `registerEnum` do C++
// (`src/lua/functions/core/game/lua_enums.cpp`), que só reexporta o enum já definido em
// `.hpp`. Ler o `.hpp` é o único jeito de saber o valor sem rodar o Canary de verdade — e é
// leitura de FATO (um inteiro, por nome), nunca de código (ADR 0019 limite 1, ADR 0038 decisão
// 7): o que sai daqui é um `Map<string, number>`, nunca uma linha de C++ reproduzida.
//
// A extração é por REGEX sobre o corpo do enum, não um parser de C++ completo — os enums que
// interessam (`enum NAME : tipo { ... }` ou `enum class NAME { ... }`) são todos planos, sem
// enumerador aninhado, então não precisam de mais que balanceamento de chaves e um avaliador de
// expressão bem pequeno (literal, hex, `<<`/`>>`/`|`/`&`/`+`/`-`, e referência a um enumerador
// ANTERIOR do mesmo enum — o caso real de `BESTY_RACE_FIRST = BESTY_RACE_AMPHIBIC`).

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');
}

/** O corpo bruto (sem as chaves) do primeiro `enum [class] NAME [: tipo] { ... }` do texto. */
export function enumBody(source: string, enumName: string): string {
  const clean = stripComments(source);
  const header = new RegExp(`enum(?:\\s+class)?\\s+${escapeRegExp(enumName)}\\b[^{;]*\\{`);
  const start = header.exec(clean);
  if (start === null) throw new Error(`enum "${enumName}" não encontrado`);
  let depth = 1;
  let index = start.index + start[0].length;
  const openAt = index;
  while (depth > 0) {
    if (index >= clean.length) throw new Error(`enum "${enumName}": chave de abertura sem par`);
    const char = clean[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    index += 1;
  }
  return clean.slice(openAt, index - 1);
}

/**
 * Uma expressão de valor de enumerador: inteiro, hex, sinal unário, ou operação binária simples
 * entre dois. O sinal unário importa de verdade: `skills_t`/`charmRune_t`
 * (`src/creatures/creatures_definitions.hpp`) e `ImbuementTypes_t`
 * (`src/items/items_definitions.hpp`) usam `= -1` como sentinela de "nenhum valor" — o padrão
 * Tibia/Canary de sempre.
 */
function evaluateEnumExpression(expression: string, known: ReadonlyMap<string, number>): number {
  const trimmed = expression.trim();
  const binary = /^(.+?)\s*(<<|>>|\||&|\+|-)\s*(.+)$/.exec(trimmed);
  if (binary !== null) {
    const [, leftText, operator, rightText] = binary as unknown as [string, string, string, string];
    const left = evaluateEnumExpression(leftText, known);
    const right = evaluateEnumExpression(rightText, known);
    switch (operator) {
      case '<<': return left << right;
      case '>>': return left >> right;
      case '|': return left | right;
      case '&': return left & right;
      case '+': return left + right;
      case '-': return left - right;
      default: throw new Error(`operador "${operator}" não suportado`);
    }
  }
  // Só depois do binário: `-1` sozinho não tem operando ESQUERDO, então o regex acima nunca
  // casa (`.+?` exige pelo menos 1 caractere antes do operador) — cai aqui, e não em
  // "não avaliável". `A - 1` continua caindo no ramo binário de cima, porque "A" já é um
  // operando esquerdo não vazio.
  const unary = /^([-+])\s*(.+)$/.exec(trimmed);
  if (unary !== null) {
    const [, sign, rest] = unary as unknown as [string, string, string];
    const value = evaluateEnumExpression(rest, known);
    return sign === '-' ? -value : value;
  }
  if (/^0[xX][0-9a-fA-F]+$/.test(trimmed)) return Number.parseInt(trimmed, 16);
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const resolved = known.get(trimmed);
  if (resolved !== undefined) return resolved;
  throw new Error(`valor de enumerador "${expression}" não avaliável (nem literal, nem enumerador anterior)`);
}

/**
 * Extrai `nome → valor` de um `enum` C++ plano. Sem valor explícito, o valor é o anterior + 1
 * (0 para o primeiro) — a mesma regra do C++. Um enumerador pode se referir a outro JÁ
 * declarado no mesmo enum (`BESTY_RACE_FIRST = BESTY_RACE_AMPHIBIC`).
 */
export function extractEnum(source: string, enumName: string): Map<string, number> {
  const body = enumBody(source, enumName);
  const result = new Map<string, number>();
  let next = 0;
  for (const rawEntry of body.split(',')) {
    const entry = rawEntry.trim();
    if (entry === '') continue;
    const match = /^([A-Za-z_]\w*)\s*(?:=\s*(.+))?$/.exec(entry);
    if (match === null) throw new Error(`enum "${enumName}": entrada não reconhecida: "${entry}"`);
    const [, name, valueExpression] = match as unknown as [string, string, string | undefined];
    const value = valueExpression === undefined ? next : evaluateEnumExpression(valueExpression, result);
    result.set(name, value);
    next = value + 1;
  }
  return result;
}

// Os três cabeçalhos e nomes de enum REAIS que os monstros e itens do Canary usam para as
// constantes globais que o Lua enxerga como `COMBAT_*`, `BESTY_RACE_*` e `CONST_ME_*` —
// conferidos contra o checkout de `things/sources/canary` (47dfd51) linha a linha antes de
// entrar aqui. Só o CAMINHO relativo e o nome do enum: este módulo não lê arquivo nem sabe onde
// fica `CANARY_DIR` (isso é `env.ts`) — quem importa junta os dois, por exemplo:
//
//   extractEnum(readFileSync(join(canaryDir, COMBAT_TYPE_HEADER), 'utf8'), COMBAT_TYPE_ENUM)

/** `src/creatures/creatures_definitions.hpp`, enum `CombatType_t` — `COMBAT_PHYSICALDAMAGE`, … */
export const COMBAT_TYPE_HEADER = 'src/creatures/creatures_definitions.hpp';
export const COMBAT_TYPE_ENUM = 'CombatType_t';

/** Mesmo arquivo, enum `BestiaryType_t` — `BESTY_RACE_MAMMAL`, … */
export const BESTIARY_TYPE_HEADER = 'src/creatures/creatures_definitions.hpp';
export const BESTIARY_TYPE_ENUM = 'BestiaryType_t';

/** `src/utils/utils_definitions.hpp`, enum `MagicEffectClasses` — `CONST_ME_HITAREA`, … */
export const MAGIC_EFFECT_HEADER = 'src/utils/utils_definitions.hpp';
export const MAGIC_EFFECT_ENUM = 'MagicEffectClasses';
