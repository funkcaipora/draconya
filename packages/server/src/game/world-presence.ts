// A presença do mundo, do lado do hospedeiro (#840, OW-19, ADR 0060 decisão 7).
//
// No Tibia fechar o cliente não tira o personagem do mundo (`canary/src/server/network/protocol/
// protocolgame.cpp:918-933`): ele fica parado, vulnerável, e a SAÍDA é decidida pelo jogo
// (`canary/src/creatures/players/player.cpp:2321-2338`). O `sim` decide e emite — `WorldRuleset`,
// OW-14 —, e este arquivo é só o que o hospedeiro precisa saber para ligar o socket a essas decisões:
// quando um personagem do mundo ficou sem ninguém olhando, quando voltou, e o que significa o pedido
// de saída que o `sim` devolve.
//
// **Nenhuma decisão de gameplay mora aqui nem em `host.ts`.** O hospedeiro traduz SOCKET em INTENÇÃO
// (`presenceLost`, `presenceRestored`, `requestLogout`) e EVENTO em I/O (o checkpoint e o `release`);
// se o personagem pode sair, quando e de onde, é do `sim` (`canLogout`, o relógio lógico, a janela de
// luta). É o que mantém o invariante 3: perder a conexão chega ao `sim` como intenção do servidor, no
// instante lógico, nunca como leitura de socket.

import type { EndReason, LogoutVerdict, Session, WorldDepartureReason } from '@draconya/sim';

/**
 * O que o hospedeiro pede a um ruleset de MUNDO. Os três métodos são do `WorldRuleset`
 * (`packages/sim/src/rulesets/world.ts`) e só dele: o `Ruleset` genérico do `sim` não os declara, a
 * hunt e a Cidade não os têm.
 */
export interface WorldPresence {
  /** A intenção `logout` do jogador: passa por `canLogout` e vira `departure-requested` ou `logout-refused`. */
  requestLogout(session: Session, characterId: string): unknown;
  /** O último visualizador do personagem se soltou, ou ele chegou sem nenhum. Idempotente. */
  presenceLost(session: Session, characterId: string): void;
  /** Um visualizador voltou ao personagem. Idempotente. */
  presenceRestored(session: Session, characterId: string): void;
}

/**
 * A presença do ruleset, ou `undefined` se ele não é um mundo.
 *
 * Consulta POR FORMA, e não por tipo nem por `instanceof` — a mesma razão de `worldPositionOf`
 * (`world-checkpoint.ts`): o hospedeiro não conhece a classe, e um ruleset de teste que fale a língua
 * do mundo vale como mundo. A Cidade e a hunt devolvem `undefined`, e é o que as mantém byte a byte
 * como eram: nenhuma presença é entregue a quem não a tem.
 */
export function worldPresenceOf(ruleset: object): WorldPresence | undefined {
  const candidate = ruleset as Partial<WorldPresence>;
  if (
    typeof candidate.presenceLost !== 'function'
    || typeof candidate.presenceRestored !== 'function'
    || typeof candidate.requestLogout !== 'function'
  ) {
    return undefined;
  }
  return candidate as WorldPresence;
}

/**
 * O motivo da SAÍDA DO MUNDO (`departure-requested`) no `EndReason` do extrato que o hospedeiro
 * grava. Só a morte tem motivo próprio — o ledger a registra como `session-death`, como a da hunt —;
 * o logout, o x-log e o idle kick são o personagem saindo do jogo, `manual-exit`, que é o que o
 * `logout` de antes já gravava. O motivo original continua nos logs e no fechamento do socket.
 */
export function endReasonOf(reason: WorldDepartureReason): EndReason {
  return reason === 'death' ? 'death' : 'manual-exit';
}

/**
 * O que o hospedeiro pergunta a um ruleset de MUNDO antes de levar o personagem para uma instância (OW-20,
 * ADR 0060 d.6a): ele poderia sair AGORA? É `WorldRuleset#logoutVerdictOf` — o `canLogout` do Canary
 * respondido sem agir, ao contrário de `requestLogout`, que emite a saída.
 */
interface LogoutVerdictSource {
  logoutVerdictOf(session: Session, characterId: string): LogoutVerdict | null;
}

/**
 * O veredicto de `canLogout` do personagem no ruleset, ou `undefined` se o ruleset não responde.
 *
 * Por FORMA, como `worldPresenceOf`, e separado dele de propósito: um ruleset de teste que fale a língua
 * da presença (os três métodos) sem saber responder ao `canLogout` continua valendo como mundo, e a
 * pergunta não o recusa — só quem declara a regra a aplica. A Cidade e a hunt devolvem `undefined`, e é o
 * que mantém a entrada na instância — de onde eles vêm — como era: nenhum portão.
 *
 * `null` é o ruleset que não conhece o personagem (ou ele já morreu): quem pergunta decide, e o
 * hospedeiro o trata como "sem o que recusar".
 */
export function logoutVerdictOf(
  ruleset: object, session: Session, characterId: string,
): LogoutVerdict | null | undefined {
  const candidate = ruleset as Partial<LogoutVerdictSource>;
  if (typeof candidate.logoutVerdictOf !== 'function') return undefined;
  return candidate.logoutVerdictOf(session, characterId);
}
