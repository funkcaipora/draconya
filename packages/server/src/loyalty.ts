// Loyalty na emissão do ticket (M44, #628, ADR 0052 decisão 5).
//
// O bônus depende da IDADE DA CONTA, que é dado de banco e de relógio de parede — duas coisas
// que o `sim` nunca lê (invariante 1). Quem as junta é a `api`, no único momento em que a linha
// não tem dono quente (a emissão do ticket, com o personagem em repouso): ela conta os dias
// desde `account.created_at`, escolhe o degrau da tabela do conteúdo e põe o PERCENTUAL no
// ticket. O `game` o fixa no `CharacterRuntime` e o `sim` só o converte em níveis (`loyalty.ts`
// do `sim`) — o valor não muda no meio da sessão, como a versão de conteúdo (invariante 7), e é
// o mesmo que o Canary faz: `initializeLoyaltySystem` roda no login e nunca mais.
//
// Nada disto é persistido: é derivado de `account.created_at` a cada ticket, então não há
// migração, extrato nem ledger — e uma conta que completa o 360º dia no meio de uma sessão só
// passa a valer o degrau na PRÓXIMA entrada, como no Canary.

import type { Loyalty } from '@draconya/content';
import { loyaltyBonusPercentOf, loyaltyPointsOf } from '@draconya/sim';
import type { GameRepository } from './db/repository.js';

const DAY_MS = 86_400_000;

/**
 * Dias INTEIROS de conta — `Account::getAccountAgeInDays` do Canary (`account.cpp:315`), que
 * divide segundos inteiros por 86.400 (divisão inteira: o `ceil` em volta não muda nada) e por
 * isso é o piso. Uma conta com relógio à frente do da `api` (`createdAt` no futuro) tem zero
 * dias, nunca negativo.
 */
export function accountAgeDays(createdAt: Date, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - createdAt.getTime()) / DAY_MS));
}

/**
 * O bônus de Loyalty de uma conta nascida em `createdAt`, no instante `nowMs` — ou `undefined`
 * quando o ticket não deve carregar nada (sistema desligado, ou conta abaixo do primeiro degrau).
 * Ausente e zero valem o mesmo para o `game`, mas ausente mantém o ticket do caso comum idêntico
 * ao de antes desta issue.
 */
export function loyaltyBonusPercentFor(
  config: Loyalty, createdAt: Date, nowMs: number,
): number | undefined {
  const points = loyaltyPointsOf(config, accountAgeDays(createdAt, nowMs));
  const percent = loyaltyBonusPercentOf(config, points);
  return percent > 0 ? percent : undefined;
}

/**
 * A função que as rotas de ticket e de party chamam: `accountId → percentual`. Uma leitura do
 * carimbo da conta por ticket emitido — nunca no caminho de tick. Conta que não existe (não
 * deveria: a posse do personagem já foi conferida) devolve `undefined`, o lado seguro.
 */
export function createLoyaltyBonusResolver(deps: {
  readonly repository: Pick<GameRepository, 'getAccountCreatedAt'>;
  readonly config: Loyalty;
  readonly now?: () => number;
}): (accountId: string) => Promise<number | undefined> {
  const now = deps.now ?? Date.now;
  return async (accountId) => {
    const createdAt = await deps.repository.getAccountCreatedAt(accountId);
    return createdAt === null ? undefined : loyaltyBonusPercentFor(deps.config, createdAt, now());
  };
}
