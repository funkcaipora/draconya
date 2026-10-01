// scripts/catalog/spell-formula.ts — reconhece `function onGetFormulaValues(...)` do Canary
// (`data/scripts/spells/**`, `data/scripts/runes/**`) nas DUAS formas que o #523 transcreveu à
// mão (issue #595): `(player, level, maglevel)` — `CALLBACK_PARAM_LEVELMAGICVALUE` — e
// `(player, skill, attack[, factor])` — `CALLBACK_PARAM_SKILLVALUE`.
//
// A redução é ÁLGEBRA ESTRUTURAL sobre a AST já parseada — nunca EXECUÇÃO. Nenhuma função é
// chamada com valor concreto nenhum; o que este módulo faz é a mesma regra de sempre,
// `a*(b+c) = a*b+a*c`, aplicada a uma árvore de somas/produtos cujas folhas são as quatro
// variáveis conhecidas (`level`, `skill`, `attack`, e o produto `skill*attack`) mais constante.
// É o limite do ADR 0019/decisão 7 do ADR 0038: número e mecanismo saem, execução não.
//
// A prova de que a redução bate com o #523: `brutal_strike.lua` (`skillTotal = skill*attack`,
// fator externo `1.28`) reduz para exatamente `{ skillAttackMin: 0.0256, skillAttackMax: 0.0512,
// baseMin: 5.12, baseMax: 11.52, levelFactor: 0.256 }` — os seis números de
// `packages/content/data/spells/brutal-strike.json` — e `fierce_berserk.lua` (termos lineares de
// `skill`/`attack` com fator aninhado duas vezes) reduz para `{ levelFactor: 0.22, skillMin: 1.21,
// skillMax: 3.3, attackMin: 2.42, attackMax: 6.6 }`, os números de `fierce-berserk.json`.

import type {
  Chunk, Expression, FunctionDeclaration, LocalStatement, ReturnStatement, Statement,
} from 'luaparse';

export class SpellFormulaError extends Error {}

/** Os quatro átomos que este reconhecedor conhece, mais a constante. */
type LinearForm = {
  const: number;
  level: number;
  skill: number;
  attack: number;
  skillAttack: number;
};

function zero(): LinearForm {
  return { const: 0, level: 0, skill: 0, attack: 0, skillAttack: 0 };
}

function addForms(a: LinearForm, b: LinearForm): LinearForm {
  return {
    const: a.const + b.const, level: a.level + b.level, skill: a.skill + b.skill,
    attack: a.attack + b.attack, skillAttack: a.skillAttack + b.skillAttack,
  };
}

function negateForm(a: LinearForm): LinearForm {
  return {
    const: -a.const, level: -a.level, skill: -a.skill, attack: -a.attack, skillAttack: -a.skillAttack,
  };
}

function scaleForm(a: LinearForm, factor: number): LinearForm {
  return {
    const: a.const * factor, level: a.level * factor, skill: a.skill * factor,
    attack: a.attack * factor, skillAttack: a.skillAttack * factor,
  };
}

/** Só a constante é diferente de zero (ou tudo zero) — o lado "número puro" de uma multiplicação/divisão. */
function isPureConstant(a: LinearForm): boolean {
  return a.level === 0 && a.skill === 0 && a.attack === 0 && a.skillAttack === 0;
}

/** Exatamente UM átomo de variável, coeficiente qualquer, sem constante — `skill`/`2*attack`/etc. */
function pureSingleAtom(a: LinearForm): { atom: 'level' | 'skill' | 'attack'; coeff: number } | null {
  if (a.const !== 0) return null;
  const present = (['level', 'skill', 'attack'] as const).filter((atom) => a[atom] !== 0);
  if (present.length !== 1) return null;
  const atom = present[0] as 'level' | 'skill' | 'attack';
  return { atom, coeff: a[atom] };
}

function multiplyForms(a: LinearForm, b: LinearForm): LinearForm {
  if (isPureConstant(a)) return scaleForm(b, a.const);
  if (isPureConstant(b)) return scaleForm(a, b.const);
  const sa = pureSingleAtom(a);
  const sb = pureSingleAtom(b);
  if (sa !== null && sb !== null) {
    const atoms = new Set([sa.atom, sb.atom]);
    if (atoms.size === 2 && atoms.has('skill') && atoms.has('attack')) {
      const form = zero();
      form.skillAttack = sa.coeff * sb.coeff;
      return form;
    }
  }
  throw new SpellFormulaError('multiplicação entre dois termos não constantes fora de skill*attack — forma não reconhecida');
}

function divideForms(a: LinearForm, b: LinearForm): LinearForm {
  if (!isPureConstant(b) || b.const === 0) {
    throw new SpellFormulaError('divisão por termo que não é uma constante não nula — forma não reconhecida');
  }
  return scaleForm(a, 1 / b.const);
}

/** `player:getLevel()`/`player:getMagicLevel()` — os únicos dois métodos que este leitor entende. */
function playerAtomOf(node: Expression): 'level' | 'skill' | null {
  if (node.type !== 'CallExpression') return null;
  const base = node.base;
  if (base.type !== 'MemberExpression' || base.indexer !== ':') return null;
  if (base.base.type !== 'Identifier' || base.base.name !== 'player') return null;
  if (base.identifier.name === 'getLevel') return 'level';
  if (base.identifier.name === 'getMagicLevel') return 'skill';
  return null;
}

/** O mapa nome-de-parâmetro → átomo, pela posição (`player` é sempre o primeiro, ignorado). */
type ParamMap = ReadonlyMap<string, 'level' | 'skill' | 'attack'>;

function reduceExpression(node: Expression, params: ParamMap, locals: ReadonlyMap<string, Expression>): LinearForm {
  switch (node.type) {
    case 'NumericLiteral': {
      const form = zero();
      form.const = node.value;
      return form;
    }
    case 'Identifier': {
      const local = locals.get(node.name);
      if (local !== undefined) return reduceExpression(local, params, locals);
      const atom = params.get(node.name);
      if (atom === undefined) {
        throw new SpellFormulaError(`identificador "${node.name}" não reconhecido (nem parâmetro, nem local)`);
      }
      const form = zero();
      form[atom] = 1;
      return form;
    }
    case 'UnaryExpression': {
      if (node.operator !== '-') {
        throw new SpellFormulaError(`operador unário "${node.operator}" não suportado na fórmula`);
      }
      return negateForm(reduceExpression(node.argument, params, locals));
    }
    case 'BinaryExpression': {
      const left = reduceExpression(node.left, params, locals);
      const right = reduceExpression(node.right, params, locals);
      switch (node.operator) {
        case '+': return addForms(left, right);
        case '-': return addForms(left, negateForm(right));
        case '*': return multiplyForms(left, right);
        case '/': return divideForms(left, right);
        default: throw new SpellFormulaError(`operador "${node.operator}" não suportado na fórmula`);
      }
    }
    case 'CallExpression': {
      const atom = playerAtomOf(node);
      if (atom === null) throw new SpellFormulaError('chamada não reconhecida — só player:getLevel()/getMagicLevel()');
      const form = zero();
      form[atom] = 1;
      return form;
    }
    default:
      throw new SpellFormulaError(`expressão "${node.type}" não suportada na fórmula`);
  }
}

/** Se o termo de referência (level, senão skill, senão attack, senão skillAttack) é negativo, inverte os dois — a convenção `-min, -max` do Canary para dano. Cura, sem o `-` externo, não inverte. */
function normalizeSign(min: LinearForm, max: LinearForm): [LinearForm, LinearForm] {
  const reference = min.level !== 0 ? min.level
    : min.skill !== 0 ? min.skill
      : min.attack !== 0 ? min.attack
        : min.skillAttack;
  if (reference < 0) return [negateForm(min), negateForm(max)];
  return [min, max];
}

export type FormulaShape = 'magic' | 'skill-attack';

export interface RecognizedFormula {
  readonly shape: FormulaShape;
  readonly min: Readonly<LinearForm>;
  readonly max: Readonly<LinearForm>;
}

function paramNames(decl: FunctionDeclaration): string[] {
  return decl.parameters.map((p) => (p.type === 'Identifier' ? p.name : '...'));
}

/** `(player, level, maglevel)` ou `(player, skill, attack[, factor])` — as duas formas do #523. */
function paramMapOf(names: readonly string[]): { shape: FormulaShape; map: ParamMap } | null {
  const rest = names.slice(1);
  if (rest.length === 2 && rest[0] === 'level' && rest[1] === 'maglevel') {
    return { shape: 'magic', map: new Map([[rest[0] as string, 'level'], [rest[1] as string, 'skill']]) };
  }
  if ((rest.length === 2 || rest.length === 3) && rest[0] === 'skill' && rest[1] === 'attack') {
    return { shape: 'skill-attack', map: new Map([[rest[0] as string, 'skill'], [rest[1] as string, 'attack']]) };
  }
  // Fallback textual — nome incomum, mas ainda reconhecível pela substring (raro nos arquivos reais).
  if (rest.some((name) => /mag/i.test(name))) {
    const map = new Map<string, 'level' | 'skill'>();
    if (rest[0] !== undefined) map.set(rest[0], 'level');
    const magIndex = rest.findIndex((name) => /mag/i.test(name));
    if (magIndex >= 0 && rest[magIndex] !== undefined) map.set(rest[magIndex] as string, 'skill');
    return rest.length === 2 ? { shape: 'magic', map } : null;
  }
  return null;
}

function collectLocals(body: readonly Statement[]): Map<string, Expression> {
  const locals = new Map<string, Expression>();
  for (const statement of body) {
    if (statement.type !== 'LocalStatement') continue;
    const local = statement as LocalStatement;
    local.variables.forEach((variable, index) => {
      const init = local.init[index];
      if (init !== undefined) locals.set(variable.name, init);
    });
  }
  return locals;
}

function findReturn(body: readonly Statement[]): ReturnStatement | null {
  for (const statement of body) {
    if (statement.type === 'ReturnStatement') return statement;
  }
  return null;
}

/**
 * `null`: a função não existe (magia sem fórmula de dano/cura — utilitária, invocação, etc.).
 * `string`: a função existe, mas a assinatura ou o corpo fogem das duas formas reconhecidas — o
 * motivo, para o relatório (RF-05, `SkippedEntity.reason`).
 * `RecognizedFormula`: as duas faixas, já com o sinal normalizado para MAGNITUDE (nunca negativo
 * por convenção do Lua) — `toSpellFormula` monta o `SpellFormula` do schema a partir daqui.
 */
export function recognizeFormula(chunk: Chunk): RecognizedFormula | null | string {
  const declaration = chunk.body.find(
    (statement): statement is FunctionDeclaration => statement.type === 'FunctionDeclaration'
      && !statement.isLocal
      && statement.identifier?.type === 'Identifier'
      && statement.identifier.name === 'onGetFormulaValues',
  );
  if (declaration === undefined) return null;
  const names = paramNames(declaration);
  const recognized = paramMapOf(names);
  if (recognized === null) return `onGetFormulaValues(${names.join(', ')}): assinatura não reconhecida`;
  const returnStatement = findReturn(declaration.body);
  if (returnStatement === null) return 'onGetFormulaValues sem "return"';
  if (returnStatement.arguments.length !== 2) {
    return `onGetFormulaValues: "return" com ${returnStatement.arguments.length} valor(es), esperava 2 (min, max)`;
  }
  const locals = collectLocals(declaration.body);
  try {
    const rawMin = reduceExpression(returnStatement.arguments[0] as Expression, recognized.map, locals);
    const rawMax = reduceExpression(returnStatement.arguments[1] as Expression, recognized.map, locals);
    const [min, max] = normalizeSign(rawMin, rawMax);
    return { shape: recognized.shape, min, max };
  } catch (error) {
    if (error instanceof SpellFormulaError) return error.message;
    throw error;
  }
}

/** O `SpellFormula` do `@draconya/content` (`packages/content/src/schemas.ts`), pronto para JSON. */
/**
 * O encadeamento de multiplicações/divisões (`(1/5)*1.1*1.1`, três operações de ponto flutuante)
 * produz ruído na casa de `1e-15` que NENHUM coeficiente real do Canary tem — os arquivos usam no
 * máximo quatro ou cinco casas decimais (`2.203`, `0.0256`). Arredondar em 9 casas elimina o
 * ruído sem tocar em nenhum dígito que um arquivo real declare.
 */
function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

export function toSpellFormula(formula: RecognizedFormula): Record<string, unknown> {
  const { min, max } = formula;
  const levelFactor = round(min.level);
  if (levelFactor !== round(max.level)) {
    throw new SpellFormulaError('levelFactor difere entre min e max — forma não suportada');
  }
  const result: Record<string, unknown> = {
    levelFactor, skillMin: round(min.skill), skillMax: round(max.skill),
    baseMin: round(min.const), baseMax: round(max.const),
  };
  const attackMin = round(min.attack);
  const attackMax = round(max.attack);
  if (attackMin !== 0 || attackMax !== 0) { result['attackMin'] = attackMin; result['attackMax'] = attackMax; }
  const skillAttackMin = round(min.skillAttack);
  const skillAttackMax = round(max.skillAttack);
  if (skillAttackMin !== 0 || skillAttackMax !== 0) {
    result['skillAttackMin'] = skillAttackMin; result['skillAttackMax'] = skillAttackMax;
  }
  if (formula.shape === 'magic') result['scaling'] = 'magic';
  return result;
}
