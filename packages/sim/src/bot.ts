// Compilador de regras do bot (FUN-80, ADR 0002).
//
// A configuração do jogador chega como DADO — o vocabulário fechado da FUN-73 — e sai daqui
// como um vetor de funções puras `(view) => boolean`. Interpretar o JSON a cada avaliação é o
// caminho fácil e errado: com 5.000 hunts e cinco categorias por personagem, cada avaliação
// alocaria o objeto de condição de novo, e o `AGENTS.md` deste pacote é explícito — "alocação
// por evento é o que custa caro aqui".
//
// O molde já existia: `HuntExitRule.when(view)` é um predicado compilado avaliado por evento,
// e não por tick. Isto é o mesmo desenho, com a ação junto.
//
// **Compilar não é executar.** `select` devolve a ação escolhida; quem a executa é o motor de
// magia (M7) e o de supply (M8), por uma interface — não por um `if` aqui dentro que cresce a
// cada categoria nova.

import type {
  BotAction, BotCategory, BotCondition, BotConfig, BotExitRule, BotLure, BotRingSwap,
  BotRuleTarget,
} from '@draconya/content';
import { BOT_CATEGORIES } from '@draconya/content';
import type { CharacterRuntime } from './character.js';
import { compileTargeting } from './targeting.js';
import type { Targeting } from './targeting.js';

/**
 * O que uma condição enxerga.
 *
 * **Reaproveitada, nunca montada por avaliação.** É a mesma técnica de `#blockedFor` no
 * `hunt.ts`: o objeto vive na instância e os campos são reescritos antes de avaliar. Montar
 * uma view por categoria por segundo, vezes 5.000 sessões, é o coletor rodando o tempo todo
 * por dados que morrem em microssegundos.
 *
 * Mutável de propósito, e por isso `BotView` não é `readonly` — quem a lê é predicado puro, e
 * quem a escreve é um lugar só.
 */
export interface BotView {
  self: CharacterRuntime;
  /**
   * Quantos alvos estão ao alcance — o NÚMERO, não a lista.
   *
   * A especificação desta issue previa `targets: readonly MonsterRuntime[]`, e isso brigaria
   * com o próprio critério dela: materializar o array dos monstros ao alcance é uma alocação
   * por avaliação, cinco por segundo por personagem, vezes 5.000 sessões. Nenhuma condição do
   * vocabulário (FUN-73) lê o array — só o tamanho.
   */
  targetCount: number;
  /**
   * O alvo atual, se houver. Sem alvo, `target-hp` é FALSA — nunca um erro.
   *
   * Forma estreita, e não `MonsterRuntime`: o `maxHealth` de um monstro vive na DEFINIÇÃO de
   * conteúdo, não no runtime, e o bot não tem por que conhecer nem um nem outro. Quem monta a
   * view sabe os dois.
   */
  target: BotTarget | null;
  /**
   * O candidato de party sob avaliação por uma regra de alvo != self. `null` fora dessa
   * avaliação (§26-30, ADR 0033 d.10).
   *
   * É a peça que faz "HP < 50%" numa regra `target: 'lowest-hp-member'` filtrar MEMBROS, e não
   * o próprio lançador: `compileCondition` lê daqui quando o alvo da regra não é `self`.
   */
  partyTarget: CharacterRuntime | null;
}

/** O que uma condição precisa saber do alvo. Nada além disto. */
export interface BotTarget {
  readonly health: number;
  readonly maxHealth: number;
}

/** Nenhum candidato: regra `target != self` sem resolvedor, ou resolvedor que filtrou todos. */
const NO_CANDIDATES: readonly CharacterRuntime[] = [];

export interface CompiledRule {
  readonly when: (view: BotView) => boolean;
  readonly act: BotAction;
  /**
   * O alvo CRU da regra — como `exit`/`lure` continuam crus: quem resolve tem
   * `session.participants`, e `bot.ts` não conhece nem sessão nem party.
   */
  readonly target: BotRuleTarget;
}

export interface CompiledBot {
  readonly categories: ReadonlyMap<BotCategory, readonly CompiledRule[]>;
  /**
   * Alvo e postura (FUN-85), compilados da MESMA configuração.
   *
   * Aqui, e não num segundo parâmetro do ruleset, porque é uma configuração só: quem tem o bot
   * tem a política de alvo dele, e separar os dois criaria o estado em que uma sessão roda com
   * as regras de um jogador e o targeting de outro.
   */
  readonly targeting: Targeting;
  /**
   * As regras de saída, ainda CRUAS (FUN-86).
   *
   * As outras duas peças saem daqui compiladas, e esta não: o predicado de uma regra de saída
   * lê a `HuntView`, que é do ruleset de hunt — e `bot.ts` não conhece ruleset nenhum, nem
   * pode, porque o mesmo bot vai valer para quest e boss. Quem compila é quem tem a view.
   */
  readonly exit: readonly BotExitRule[];
  /**
   * O bot AVANÇADO (§13.2, FUN-87), cru como as regras de saída e pela mesma razão: quem os
   * executa precisa do mundo — a rota e o inventário —, e `bot.ts` não conhece ruleset nenhum.
   *
   * Ausentes é o bot básico, que é o de todo mundo abaixo do level 50.
   */
  readonly lure: BotLure | undefined;
  readonly ringSwap: BotRingSwap | undefined;
  /**
   * A primeira regra válida da categoria, ou `null` (§13.4).
   *
   * "Primeira válida executa" é a ordem do vetor, e a avaliação PARA na primeira que vale —
   * as demais daquela categoria nem são consultadas. Sem prioridade global entre categorias:
   * cada uma decide a sua.
   *
   * `resolveCandidates` só é chamado para regra com `target.kind !== 'self'`. Devolve a lista
   * JÁ filtrada (vivo, ao alcance) e, para `lowest-hp-member`, JÁ ordenada por percentual
   * ascendente — o `select` só decide QUAL delas satisfaz a condição, chamando o MESMO `when`
   * compilado uma vez por candidato, na ordem em que a lista chegou (§29: "usa o primeiro que
   * satisfaz"). Ausente: nenhum candidato, que é o mesmo de uma lista vazia.
   */
  select(
    category: BotCategory,
    view: BotView,
    resolveCandidates?: (rule: CompiledRule) => readonly CharacterRuntime[],
  ): { readonly action: BotAction; readonly recipient: CharacterRuntime | null } | null;
}

/** Quem sabe executar a ação escolhida. Implementado por M7 (magia) e M8 (supply e item). */
export interface BotActuator {
  /**
   * `false` quando a ação não aconteceu — sem mana, sem supply, alvo fora de alcance.
   *
   * Importa porque uma categoria não pode consumir o cooldown de uma ação que não aconteceu:
   * seria o bot ficando um segundo parado por ter tentado curar sem mana.
   */
  perform(action: BotAction, view: BotView): boolean;
}

/**
 * Traduz uma condição em função pura.
 *
 * O `switch` fecha sobre `kind` UMA vez, na compilação, e o que sobra é uma closure que só faz
 * a comparação. É a diferença entre percorrer o JSON por avaliação e chamar uma função.
 */
function compileCondition(condition: BotCondition, target: BotRuleTarget): (view: BotView) => boolean {
  switch (condition.kind) {
    case 'hp': {
      const { op, percent } = condition;
      // Alvo != self: quem tem o HP relevante é o candidato resolvido, não o lançador — é
      // isto que faz "HP < 50%" na regra do §29 filtrar MEMBROS, não o próprio druida.
      if (target.kind !== 'self') {
        return (view) => {
          const candidate = view.partyTarget;
          // Sem candidato a condição é FALSA, nunca um erro — a mesma regra de `target-hp`.
          return candidate !== null && compare(percentOf(candidate.health, candidate.maxHealth), op, percent);
        };
      }
      return (view) => compare(percentOf(view.self.health, view.self.maxHealth), op, percent);
    }
    case 'mana': {
      // Mana continua SEMPRE do lançador (D11): quem paga o cast é quem lança, alvo != self
      // não muda isso.
      const { op, percent } = condition;
      return (view) => compare(percentOf(view.self.mana, view.self.maxMana), op, percent);
    }
    case 'targets': {
      const { op, count } = condition;
      return (view) => compare(view.targetCount, op, count);
    }
    case 'target-hp': {
      const { op, percent } = condition;
      return (view) => {
        const target = view.target;
        // Sem alvo a condição é FALSA, e não um erro: "ataque quando o alvo estiver abaixo de
        // 30%" não vale quando não há alvo, e lançar aqui derrubaria a sessão por uma regra
        // que o jogador escreveu certo.
        if (target === null) return false;
        return compare(percentOf(target.health, target.maxHealth), op, percent);
      };
    }
  }
}

/** Percentual inteiro, com o zero protegido: `maxHealth` zero é dado quebrado, não divisão. */
export function percentOf(current: number, max: number): number {
  if (max <= 0) return 0;
  return (current / max) * 100;
}

function compare(left: number, op: BotCondition['op'], right: number): boolean {
  switch (op) {
    case '<': return left < right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '>=': return left >= right;
  }
}

/**
 * Compila a configuração inteira, uma vez, na entrada da sessão.
 *
 * **Não recebe `Content`, e recebia** (FUN-81). O parâmetro existia para a referência cruzada
 * de magia e supply, que a FUN-74 acabou pondo em `validateBotConfig` — o lugar certo, porque
 * a recusa precisa chegar ao jogador com motivo, e a compilação acontece quando a hunt já vai
 * abrir. O parâmetro ficou sem uso, e sem uso ele passou a ATRAPALHAR: `restore` recompila a
 * configuração vinda do snapshot e não tem conteúdo na mão.
 *
 * A ordem continua sendo: valida com `validateBotConfig` (que tem o conteúdo), compila depois.
 */
export function compileBot(config: BotConfig): CompiledBot {
  const categories = new Map<BotCategory, readonly CompiledRule[]>();
  for (const category of BOT_CATEGORIES) {
    categories.set(
      category,
      // Regra desligada não vira predicado (#162): custo zero no tick, e a ordem das que ficam
      // é a ordem de sempre — desligar a segunda faz a terceira ser avaliada logo depois da
      // primeira.
      config[category]
        .filter((rule) => rule.enabled !== false)
        .map((rule) => ({
          when: compileCondition(rule.when, rule.target ?? { kind: 'self' }),
          act: rule.do,
          target: rule.target ?? { kind: 'self' },
        })),
    );
  }

  // O resultado REAPROVEITADO, como a `BotView`: `select` roda cinco vezes por segundo por
  // personagem, e devolver um objeto novo por avaliação é alocação por evento — o custo que
  // este pacote evita. Quem chama o consome ANTES de chamar de novo (o ruleset lê `action` e
  // `recipient` na hora), então a referência única é segura.
  const selection = {
    action: null as unknown as BotAction,
    recipient: null as CharacterRuntime | null,
  };

  return {
    categories,
    targeting: compileTargeting(config.targeting),
    exit: config.exit,
    lure: config.lure,
    ringSwap: config.ringSwap,
    select(category, view, resolveCandidates) {
      const rules = categories.get(category);
      if (rules === undefined) return null;
      // Laço indexado, e não `find`: `find` aloca a closure por chamada, e esta é a função
      // mais chamada do bot — cinco vezes por segundo por personagem, vezes 5.000 sessões.
      for (let i = 0; i < rules.length; i += 1) {
        const rule = rules[i] as CompiledRule;
        if (rule.target.kind === 'self') {
          view.partyTarget = null;
          if (rule.when(view)) {
            selection.action = rule.act;
            selection.recipient = null;
            return selection;
          }
          continue;
        }
        // Alvo != self: tenta cada candidato, NA ORDEM em que chegou (já rankeado por quem
        // resolveu), até o primeiro cuja condição vale — é o "usa o primeiro válido" do §29.
        const candidates = resolveCandidates === undefined ? NO_CANDIDATES : resolveCandidates(rule);
        for (let j = 0; j < candidates.length; j += 1) {
          const candidate = candidates[j] as CharacterRuntime;
          view.partyTarget = candidate;
          if (rule.when(view)) {
            selection.action = rule.act;
            selection.recipient = candidate;
            return selection;
          }
        }
      }
      return null;
    },
  };
}
