// Escolha de alvo e postura (FUN-85, §13.6).
//
// Até aqui a hunt tinha UMA política, escrita no motor: o monstro mais próximo ao alcance da
// arma, desempatando pelo que nasceu antes. Ela continua sendo o padrão — e agora é um caso de
// uma política que vem da configuração do jogador, como o resto do vocabulário do bot.
//
// **Escolher alvo e alcançar o alvo são coisas diferentes**, e conflacionar as duas foi o que
// travou isto até agora. O `#nearestMonster` só enxergava dentro do alcance de ataque, então
// "seguir o alvo" era impossível de expressar: quem já está ao alcance não precisa ser seguido.
// Aqui a busca recebe o raio como parâmetro — alcance da arma quando a pergunta é "em quem eu
// bato", raio de visão quando é "para onde eu ando".

import type { BotPosture, BotTargeting } from '@draconya/content';
import type { GridPoint } from './monster/step.js';
import { distance } from './monster/step.js';

/** O que a escolha precisa saber de um candidato. `MonsterRuntime` já satisfaz. */
export interface TargetLike {
  /** Id de CONTEÚDO — é o que `prioritize` e `ignore` nomeiam, não o id da instância. */
  readonly monsterId: string;
  readonly health: number;
  readonly alive: boolean;
  readonly position: GridPoint;
}

/** A política compilada. Conjuntos em vez de arrays: a checagem é por candidato por varredura. */
export interface Targeting {
  readonly policy: BotTargeting['policy'];
  readonly prioritize: ReadonlySet<string>;
  readonly ignore: ReadonlySet<string>;
  readonly posture: BotPosture;
}

const NONE: ReadonlySet<string> = new Set();

/** O que a hunt sempre fez: o mais próximo, sem preferência, sem sair da rota. */
export const DEFAULT_TARGETING: Targeting = {
  policy: 'nearest', prioritize: NONE, ignore: NONE, posture: { kind: 'stand' },
};

/**
 * Compila a configuração uma vez, na entrada da sessão — mesmo motivo do compilador de regras
 * (ADR 0002): `array.includes` por candidato por varredura é linear onde um `Set` é constante,
 * e esta varredura roda a cada passo e a cada ataque.
 */
export function compileTargeting(config: BotTargeting | undefined): Targeting {
  if (config === undefined) return DEFAULT_TARGETING;
  return {
    policy: config.policy,
    prioritize: config.prioritize.length === 0 ? NONE : new Set(config.prioritize),
    ignore: config.ignore.length === 0 ? NONE : new Set(config.ignore),
    posture: config.posture,
  };
}

/**
 * O melhor alvo dentro de `maxDistance`, ou `null`.
 *
 * A ordem de desempate é CONTRATO, e é o que faz duas execuções da mesma semente escolherem o
 * mesmo monstro:
 *
 *   1. priorizado ganha de não-priorizado — antes da política, senão "mate o mago primeiro"
 *      não valeria quando o mago está mais longe, que é justamente quando ele importa;
 *   2. dentro da mesma faixa, a política — mais perto, menos vida, mais vida;
 *   3. empate fica com quem já era o campeão, e a varredura é na ordem da lista, que é a ordem
 *      de nascimento.
 *
 * Laço indexado e comparação por escalar: nada aqui aloca. Roda a cada passo do personagem e a
 * cada vencimento de ataque, vezes o número de instâncias.
 */
export function selectTarget<M extends TargetLike>(
  targeting: Targeting,
  monsters: readonly M[],
  from: GridPoint,
  maxDistance: number,
): M | null {
  let best: M | null = null;
  let bestDistance = 0;
  let bestPriority = false;

  for (let i = 0; i < monsters.length; i += 1) {
    const monster = monsters[i] as M;
    if (!monster.alive) continue;
    if (targeting.ignore.has(monster.monsterId)) continue;
    const d = distance(from, monster.position);
    if (d > maxDistance) continue;

    const priority = targeting.prioritize.has(monster.monsterId);
    if (best === null) {
      best = monster; bestDistance = d; bestPriority = priority;
      continue;
    }
    if (priority !== bestPriority) {
      // Faixa diferente: a política nem é consultada. Um priorizado a dez tiles ganha de um
      // comum encostado, e é exatamente isso que o jogador pediu ao priorizar.
      if (priority) { best = monster; bestDistance = d; bestPriority = priority; }
      continue;
    }
    if (!better(targeting.policy, monster, d, best, bestDistance)) continue;
    best = monster; bestDistance = d; bestPriority = priority;
  }
  return best;
}

/** `true` só quando o candidato ganha DE VERDADE — empate mantém o campeão (desempate estável). */
function better(
  policy: Targeting['policy'],
  candidate: TargetLike, candidateDistance: number,
  champion: TargetLike, championDistance: number,
): boolean {
  switch (policy) {
    case 'nearest': return candidateDistance < championDistance;
    case 'lowest-hp': return candidate.health < champion.health;
    case 'highest-hp': return candidate.health > champion.health;
    // `follow` é o nome do dropdown para "o alvo que eu escolhi" (ADR 0032 d.5). Sem escolha
    // viva, a comparação cai em `nearest` — o fallback que a decisão 5 promete.
    case 'follow': return candidateDistance < championDistance;
  }
}

/**
 * Quantos alvos VÁLIDOS estão dentro do raio — o número, sem materializar a lista.
 *
 * Ignorado não conta: "3 ou mais alvos → onda" contando monstros que o jogador mandou o bot
 * deixar em paz faria a regra disparar por causa de quem ela não vai atingir.
 */
export function countTargets<M extends TargetLike>(
  targeting: Targeting, monsters: readonly M[], from: GridPoint, maxDistance: number,
): number {
  let count = 0;
  for (let i = 0; i < monsters.length; i += 1) {
    const monster = monsters[i] as M;
    if (!monster.alive) continue;
    if (targeting.ignore.has(monster.monsterId)) continue;
    if (distance(from, monster.position) <= maxDistance) count += 1;
  }
  return count;
}
