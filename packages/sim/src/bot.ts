// Compilador de regras do bot (FUN-80, ADR 0002; motor de grupos no AB-07, ADR 0032 d.2).
//
// A configuração do jogador chega como DADO — o vocabulário v2 — e sai daqui como um vetor de
// funções puras `(view) => boolean`, agrupado pelo GRUPO DE COOLDOWN do conteúdo. Interpretar o
// JSON a cada avaliação é o caminho fácil e errado: com 5.000 hunts e dezenas de slots por
// personagem, cada avaliação alocaria o objeto de condição de novo, e o `AGENTS.md` deste pacote
// é explícito — "alocação por evento é o que custa caro aqui".
//
// **A ordem do slot É a prioridade (RP-002).** O vetor de cada grupo sai na ordem da barra —
// fileira 1 da esquerda para a direita, depois a fileira 2 —, e quem percorre pula o inelegível
// no MESMO ciclo (RP-003/RP-004). Quem decide isso é o ruleset, que tem o atuador.
//
// **Compilar não é executar.** O compilador entrega os slots agrupados; quem os tenta, em ordem,
// é o motor de magia e de item, por uma interface — não por um `if` aqui dentro que cresce a
// cada grupo novo.

import type {
  BotActionV2, BotConditionV2, BotConfigV2, BotExitRule, BotLure, BotOperator,
} from '@draconya/content';
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
}

/** O que uma condição precisa saber do alvo. Nada além disto. */
export interface BotTarget {
  readonly health: number;
  readonly maxHealth: number;
}

/**
 * Um slot compilado da barra v2. `when` é a E das condições do slot (RG-006), `act` é a ação
 * crua que o atuador executa, e `cooldownKey` é o livro que a EXECUÇÃO inicia — `group:<g>` para
 * o grupo do conteúdo, ou `spell:<id>`/`item:<id>` para a ação fora de grupo.
 */
export interface CompiledSlot {
  readonly when: (view: BotView) => boolean;
  readonly act: BotActionV2;
  /** A chave de cooldown que a execução INICIA: `group:<g>` ou `spell:<id>`/`item:<id>`. */
  readonly cooldownKey: string;
}

export interface CompiledBot {
  /**
   * Grupo do conteúdo → slots na ORDEM da barra (RP-002). Substitui as categorias v1.
   *
   * A chave é o grupo do CONTEÚDO (`healing`/`attack`/`support`/`potion`), resolvido uma vez na
   * compilação; ações sem grupo caem num grupo sintético `spell:<id>`/`item:<id>`, para não
   * inventar prioridade compartilhada que o conteúdo não declarou (DT-06).
   */
  readonly groups: ReadonlyMap<string, readonly CompiledSlot[]>;
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
   */
  readonly lure: BotLure | undefined;
}

/** Quem sabe executar a ação escolhida. Implementado por M7 (magia) e M8 (supply e item). */
export interface BotActuator {
  /**
   * `false` quando a ação não aconteceu — sem mana, sem supply, alvo fora de alcance.
   *
   * Importa porque um slot não pode consumir o cooldown de uma ação que não aconteceu: seria o
   * bot parado um segundo por ter tentado curar sem mana. A recusa PULA para o próximo slot do
   * mesmo grupo no MESMO ciclo (RP-004).
   */
  perform(action: BotActionV2, view: BotView): boolean;
}

/**
 * Traduz uma condição em função pura.
 *
 * O `switch` fecha sobre `kind` UMA vez, na compilação, e o que sobra é uma closure que só faz
 * a comparação. É a diferença entre percorrer o JSON por avaliação e chamar uma função.
 */
export function compileCondition(condition: BotConditionV2): (view: BotView) => boolean {
  switch (condition.kind) {
    case 'hp': {
      const { op, percent } = condition;
      return (view) => compare(percentOf(view.self.health, view.self.maxHealth), op, percent);
    }
    case 'mana': {
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
    case 'condition': {
      const { conditionId, present } = condition;
      // O efeito vive no `Conditions` do personagem, com chave SEMÂNTICA (`haste`,
      // `mana-shield`, `buff`) — não o id da magia. "Castar haste só sem haste" é
      // `present: false`; com o efeito ativo o predicado é falso e o slot é pulado.
      return (view) => (view.self.conditions.get(conditionId) !== null) === present;
    }
  }
}

/**
 * A E entre as condições do slot (RG-006): todas verdadeiras, na ordem declarada.
 *
 * `when: []` é elegível sempre (RG-007), e por isso devolve o predicado constante em vez de uma
 * closure com laço vazio — o caso mais comum não paga nem a chamada de função do laço.
 */
const ALWAYS = (): boolean => true;

function compileAll(conditions: readonly BotConditionV2[]): (view: BotView) => boolean {
  if (conditions.length === 0) return ALWAYS;
  const predicates = conditions.map(compileCondition);
  return (view) => {
    for (let i = 0; i < predicates.length; i += 1) {
      if (!(predicates[i] as (v: BotView) => boolean)(view)) return false;
    }
    return true;
  };
}

/** Percentual inteiro, com o zero protegido: `maxHealth` zero é dado quebrado, não divisão. */
function percentOf(current: number, max: number): number {
  if (max <= 0) return 0;
  return (current / max) * 100;
}

function compare(left: number, op: BotOperator, right: number): boolean {
  switch (op) {
    case '<': return left < right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '>=': return left >= right;
  }
}

/**
 * Grupo e chave de cooldown de uma ação, resolvidos do CONTEÚDO (puro, DT-01).
 *
 * Quem tem o catálogo (o ruleset) resolve; `bot.ts` só carrega o par pronto. Ler o conteúdo a
 * cada avaliação seria a alocação/busca por evento que o `AGENTS.md` do `sim` proíbe — e um
 * resolvedor não reintroduz o `Content` que a FUN-81 tirou da compilação.
 */
export type CooldownOfAction = (
  action: BotActionV2,
) => { readonly group: string; readonly cooldownKey: string };

/**
 * Compila a configuração v2 inteira, uma vez, na entrada da sessão.
 *
 * **Não recebe `Content`, e não deve** (FUN-81/DT-01): o grupo e a chave de cooldown de cada ação
 * chegam prontos pelo `cooldownOf`, resolvidos uma vez por slot. O conteúdo é da sessão, e a
 * sessão é quem o tem — reler o disco aqui seria a versão de conteúdo mudando no meio da hunt
 * (invariante 7).
 *
 * A ordem continua sendo: valida com `validateBotConfigV2` (que tem o conteúdo), compila depois.
 */
export function compileBot(config: BotConfigV2, cooldownOf: CooldownOfAction): CompiledBot {
  const groups = new Map<string, CompiledSlot[]>();
  // O conjunto ATIVO; a ordem do vetor É a prioridade (RP-002). Fileira 1 (0..11) antes da 2,
  // porque `sets[activeSet].slots` já é o vetor na ordem da barra.
  const active = config.sets[config.activeSet];
  if (active !== undefined) {
    for (const slot of active.slots) {
      if (slot === null) continue;
      if (slot.enabled === false) continue;    // desligado não disputa (RP-004)
      if (slot.auto === false) continue;       // manual-only não entra no automático (AB-09)
      const { group, cooldownKey } = cooldownOf(slot.do);
      const compiled: CompiledSlot = { when: compileAll(slot.when), act: slot.do, cooldownKey };
      const list = groups.get(group);
      if (list === undefined) groups.set(group, [compiled]);
      else list.push(compiled);
    }
  }

  return {
    groups,
    targeting: compileTargeting(config.targeting),
    exit: config.exit,
    lure: config.lure,
  };
}
