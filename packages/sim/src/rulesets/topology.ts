// A costura de topologia do `HuntRuleset` (OW-12, ADR 0060 decisão 4).
//
// O `HuntRuleset` nasceu para uma sessão que É uma party: todo participante leva o abate, todos
// são elegíveis, o loot vai a um sorteado, a sessão acaba quando esvazia, o líder é o mais
// antigo e o spawn começa com o primeiro corredor. O mundo aberto (ADR 0060) quer o MESMO motor
// — combate, IA, campos, movimento por tile — sem entregar a estranhos o que é de outro. Em vez
// de um segundo ruleset, isto isola num objeto tudo o que hoje supõe "sessão = party", e o
// `HuntRuleset` o recebe em `HuntRulesetOptions.topology`.
//
// **`instanceTopology` é o código de hoje, movido sem tocar numa condição.** É o default, e é por
// isso que a hunt (solo e party) é byte a byte a de antes: as sequências do FUN-63, 1 Hz = 10 Hz,
// a retomada de snapshot e o `pnpm bench:hunts` são os portões. A topologia de mundo (OW-13) é
// outra peça e outro arquivo; esta issue só abre a porta.
//
// Quatro famílias de pergunta moram aqui, e o que NÃO mora aqui é tão importante quanto o que
// mora — a classificação de cada uso de `session.participants` do `HuntRuleset` está em
// `docs/session-topology-audit.md`:
//
// - **recompensa** — quem leva a contagem do abate, quem é elegível, quem recebe o loot;
// - **vida da sessão** — quem lidera, o que acontece quando esvazia, quando o líder sai, quando
//   alguém morre ou conclui a saída;
// - **começo** — quando as agendas da instância (spawn, regras de saída) nascem e onde o
//   personagem é colocado ao entrar;
// - **o que roda** — a rota, as regras de saída e a queima de stamina por tempo.
//
// Fica FORA: tudo o que trata `session.participants` como "criaturas presentes" (procurar um
// personagem por id, ocupação de tile, alvo de monstro, área de magia, campo). Isso é verdade em
// qualquer topologia e não é decisão desta costura. Fica fora também o que só roda com
// `partyOptions` (bolsa compartilhada, rateio de custo, votação de encerramento, XP dividida pelo
// roster): o mundo não passa essa opção, e a party do mundo (OW-43) e o crédito do Canary
// (OW-28) são outras peças — a auditoria diz, uso por uso, o que ficou para quem.
//
// Uma topologia é um VALOR: não guarda estado, é compartilhada por toda sessão que a usa, e tudo
// o que muda mora no `HuntRuleset` ou na `Session`. Também não entra no snapshot — é identidade
// de QUEM monta o ruleset, como o `huntId`, e a sessão retomada pelo mesmo caminho volta com a
// mesma (o default é a de instância, que é o que toda sessão salva já é).

import type { CharacterRuntime } from '../character.js';
import type { KillCredit } from '../death.js';
import { place, placeNear } from '../movement.js';
import type { MovementWorld, WorldPoint } from '../movement.js';
import type { EndReason, Session } from '../session.js';
import { isExhausted } from '../stamina.js';

/**
 * Até onde o segundo participante procura tile livre ao entrar (#203): o anel de `placeNear`. O
 * primeiro entra exatamente no tile inicial da rota; o segundo em diante, no livre mais próximo.
 */
export const ENTRY_RADIUS = 3;

const NO_MEMBERS: readonly CharacterRuntime[] = [];

/** Por que um personagem sai da sessão por decisão do ruleset: os três motivos de `#depart`. */
export type DepartureReason = Extract<EndReason, 'death' | 'manual-exit' | 'exit-rule'>;

/** O motivo de uma saída CONCLUÍDA pelo jogador ou pela regra do bot (sem a morte). */
export type ExitFinishedReason = Extract<DepartureReason, 'manual-exit' | 'exit-rule'>;

/**
 * O que o ruleset oferece à topologia para ela agir. Existe porque a decisão é da topologia mas o
 * mecanismo é do `HuntRuleset`: `depart` emite o extrato de quem sai, avisa o hospedeiro
 * (`member-left`) e roda a cascata pendente, e isso mexe em estado privado dele.
 */
export interface TopologyHost {
  /** Tira o personagem da sessão com o extrato dele; a sessão continua para os outros. */
  depart(session: Session, characterId: string, reason: DepartureReason): void;
}

/**
 * O abate que o ruleset já resolveu, como a topologia o lê. É o que `#onMonsterDied` sabe antes de
 * perguntar "quem leva o quê": a atribuição de dano e quem deu o golpe final.
 */
export interface KillContext {
  /** O participante que deu o golpe final, ou `null` — monstro, campo, ou a fonte já saiu. */
  readonly lastHitter: CharacterRuntime | null;
  /**
   * O golpe final foi de OUTRO MONSTRO (#619, o Deepling que mata o Deathling)? Quem decide se
   * isso ainda paga alguém é o ruleset (`rewarded`); a topologia só é perguntada se paga.
   */
  readonly diedToMonster: boolean;
  /** A atribuição inteira do dano: quem bateu, quanto, e quem deu o último golpe. */
  readonly credit: KillCredit;
}

/**
 * O que `lootRecipient` lê da party desta sessão: só se o loot vai para a bolsa. Estrutural — a
 * topologia não conhece `PartyOptions`, e `undefined` é "sem party" (solo).
 */
export interface LootParty {
  /** `true` é o modo `shared`: o loot cai na bolsa da sessão e ninguém o recebe direto. */
  readonly splitLoot: boolean;
}

/**
 * O que `onLeaderGone` pode reescrever: o líder da party. Estrutural, como `LootParty`;
 * `PartyOptions` satisfaz sem importar nada daqui.
 */
export interface PartyLeadership {
  leaderId: string;
}

/**
 * Tudo o que `placeOnEnter` precisa para colocar quem entra. Objeto, e não posicionais: já são
 * cinco coisas, e a da rota só existe para a topologia que TEM rota.
 */
export interface EntryPlacement {
  /** A ocupação de tiles da sessão (a mesma que o ruleset usa para todo passo). */
  readonly world: MovementWorld;
  readonly character: CharacterRuntime;
  /** O tile inicial da rota deste corredor: a âncora da instância. */
  readonly routeStart: WorldPoint;
  /** Quantos corredores a sessão tem, contando quem está entrando: `1` é o primeiro. */
  readonly runnerCount: number;
  /** A hunt, para a mensagem de uma colocação recusada (que é conteúdo quebrado). */
  readonly huntId: string;
}

/**
 * O que hoje supõe sessão = party, em onze perguntas e três chaves. Os onze membros do ADR 0060
 * d.4 são `creditKill`, `rewardEligible`, `lootRecipient`, `onEmpty`, `onLeaderGone`,
 * `startsInstanceSchedules`, `placeOnEnter`, `onCharacterDied` e as chaves `runsRouteWalker`,
 * `runsExitRules` e `burnsStaminaByTime`; a auditoria achou mais três perguntas que também
 * decidiam por "quantos estão aqui" — `leaderOf` (a outra metade da liderança), `onExitFinished`
 * (a outra porta de saída, irmã da morte) e `namesOwnerInEvents` (o formato do extrato dependia de
 * quantos estavam online).
 *
 * As funções recebem a `Session` — o roster é `session.participants` — porque a decisão é sobre a
 * sessão inteira. Não guardam estado: ver o cabeçalho do arquivo.
 */
export interface SessionTopology {
  // --- recompensa -------------------------------------------------------------------------

  /**
   * Quem leva a CONTAGEM de abates (`Aggregates.kills`) de um monstro que morreu e que paga a
   * alguém presente.
   *
   * Instância: todo presente — "matei N" é a pergunta do analisador de cada um (#190, DT-01), e a
   * party matou junto. Conta mesmo com a fonte do golpe sumida ou o dono morto; o extrato
   * mentiria se dissesse que não. É o ponto onde o mundo vai creditar só quem bateu (OW-28).
   */
  creditKill(session: Session, kill: KillContext): void;

  /**
   * Quem pode RECEBER a recompensa de um abate (XP e loot): vivo e com stamina. Só é perguntada
   * quando o abate paga alguém (`rewarded`).
   *
   * Instância: com um participante só, o pagável — o matador, ou, na morte por monstro com dano
   * dele antes (#619), o único presente —, se pode receber; sem dono (fonte sumida) ou dono morto,
   * ninguém. Com mais de um, todo presente que pode receber. É a condição que decidia se o
   * matador recebia, aplicada a cada membro. Devolve a lista VAZIA compartilhada quando não há
   * ninguém.
   */
  rewardEligible(session: Session, kill: KillContext): readonly CharacterRuntime[];

  /**
   * Quem recebe o loot de um abate (#191, ADR 0027 decisão 5), dentre `eligible`. `killer` é o
   * dono do cadáver (quem mais causou dano, ou o do último golpe), `party` é `undefined` sem
   * party.
   *
   * Instância: solo — ou party que virou solo — é o matador, e NENHUM sorteio: um `rng` a mais
   * aqui mudaria a sequência de loot de toda hunt existente (FUN-63). Party `split` com ≥ 2: um
   * elegível sorteado, uniforme, ANTES de `rollLoot`. Party `shared`: ninguém — o loot vai para
   * a bolsa. **Consome `session.rng`**: o número e a ordem dos sorteios são contrato.
   */
  lootRecipient(
    session: Session, killer: CharacterRuntime | null, eligible: readonly CharacterRuntime[],
    party: LootParty | undefined,
  ): CharacterRuntime | null;

  // --- vida da sessão ---------------------------------------------------------------------

  /**
   * O líder presente, ou `undefined` quando a topologia não tem líder. `preferredId` é o
   * `leaderId` da party, quando há.
   *
   * Instância: o líder da party presente, ou o mais antigo (`participants[0]`) — mesmo sem party.
   * É dele a caixa do excedente e o invendável, e é quem `follow: leader` segue. O mundo não tem
   * líder: devolver o mais antigo faria a primeira pessoa online ser seguida por estranhos.
   */
  leaderOf(session: Session, preferredId: string | undefined): CharacterRuntime | undefined;

  /**
   * A sessão ficou sem ninguém depois de uma saída decidida pelo ruleset. `reason` é o motivo do
   * ÚLTIMO a sair (já resolvido: se a cascata de regras levou alguém, foi a regra dele).
   *
   * Instância: a sessão acaba. O mundo nunca termina por esvaziar.
   */
  onEmpty(session: Session, reason: EndReason): void;

  /**
   * O líder da party saiu e a sessão continua (#193, D9): quem fica mais antigo assume, e a troca
   * entra no extrato (`leader-changed`). `party` é `undefined` sem party.
   *
   * Instância: o líder passa a ser `participants[0]`. O mundo não tem líder e não faz nada.
   */
  onLeaderGone(session: Session, party: PartyLeadership | undefined): void;

  /**
   * Um personagem morreu e a penalidade já foi aplicada: o que a morte faz com A SESSÃO (§26.1).
   *
   * Instância: solo — ou party que virou solo — encerra a sessão; em party o morto SAI com o
   * próprio extrato e a sessão continua para os outros (#193, ADR 0027 decisão 7).
   */
  onCharacterDied(session: Session, character: CharacterRuntime, host: TopologyHost): void;

  /**
   * Um personagem CONCLUIU a saída — manual ou por regra do bot — depois do `exitDelayMs` e fora
   * da janela de combate (#625). É a mesma pergunta de `onCharacterDied`, para a outra porta de
   * saída.
   *
   * Instância: solo — ou party que virou solo — encerra a sessão com o motivo dele; em party ele
   * sai com o extrato dele e a sessão continua.
   */
  onExitFinished(
    session: Session, characterId: string, reason: ExitFinishedReason, host: TopologyHost,
  ): void;

  // --- começo -----------------------------------------------------------------------------

  /**
   * As agendas da INSTÂNCIA (o spawn inicial e as regras de saída) nascem agora? `runnerCount`
   * conta quem está entrando.
   *
   * Instância: com o primeiro corredor — o segundo não as dobra (#203). O mundo semeia o próprio
   * spawn na criação, sem ninguém, e nunca com quem entra.
   */
  startsInstanceSchedules(runnerCount: number): boolean;

  /**
   * Coloca quem entra, pela MESMA legalidade que um passo (FUN-69). Lança quando a colocação é
   * recusada: lá fora é conteúdo quebrado, e falhar alto é melhor que entrar dentro de uma parede.
   *
   * Instância: o primeiro no tile inicial da rota; o segundo em diante no livre mais próximo
   * (`placeNear`), e o `rejoinNearest` do primeiro passo o traz para a rota.
   */
  placeOnEnter(entry: EntryPlacement): void;

  // --- o que roda -------------------------------------------------------------------------

  /**
   * O personagem percorre a ROTA da hunt quando não tem nada melhor a fazer? Com `false`, o
   * passo do personagem faz o resto (combate, andar-até, follow, postura) e, sem alvo, fica onde
   * está — o mundo não tem rota (ADR 0009, ADR 0060 d.4).
   */
  readonly runsRouteWalker: boolean;

  /**
   * As regras de saída do bot valem? Inclui o evento periódico (`hp-below`, `out-of-gold`,
   * `out-of-capacity`) E a cascata `party-member-lost`, que sai de quem a configurou quando OUTRO
   * membro sai. No mundo ela tiraria da sessão quem tem a regra sempre que um estranho saísse.
   */
  readonly runsExitRules: boolean;

  /**
   * A stamina queima por TEMPO de sessão (§10.2)? Instância: sim, 1:1 com o tempo de hunt. O mundo
   * a queima quando se ganha XP, como o Canary, e isso é a OW-46.
   */
  readonly burnsStaminaByTime: boolean;

  // --- apresentação no extrato ------------------------------------------------------------

  /**
   * O detalhe dos eventos notáveis de progresso (`level-up`, `bestiary-milestone`,
   * `bosstiary-level` e `hazard-level-up`) NOMEIA o dono?
   *
   * Instância: só com mais de um presente — solo mantém o formato de sempre, e `event-text.ts` o
   * lê. É uma decisão sobre o FORMATO que dependia de quantos estão online; no mundo o número de
   * presentes não pode decidir o que vai para o ledger.
   */
  namesOwnerInEvents(session: Session): boolean;
}

/**
 * A topologia de hoje: sessão = party (de um, em solo). É o default do `HuntRuleset`, e cada
 * função aqui é o código que morava nele antes da costura, na mesma ordem e com as mesmas
 * condições — não é uma reescrita, é uma mudança de endereço.
 */
export const instanceTopology: SessionTopology = Object.freeze({
  creditKill(session: Session): void {
    // O abate conta SEMPRE, para todo presente.
    for (const participant of session.participants) session.credit(participant.id, 'kills', 1);
  },

  rewardEligible(session: Session, kill: KillContext): readonly CharacterRuntime[] {
    // Em solo, a XP é de quem está presente — o matador, ou (morte por monstro com dano dele
    // antes) o único participante, que bateu; em party, dos vivos com stamina, e `#xpShares`
    // decide a cota de cada um.
    const solo = session.participants.length === 1;
    const payee = kill.diedToMonster ? session.participants[0] ?? null : kill.lastHitter;
    return solo
      ? (payee !== null && payee.alive && !isExhausted(payee) ? [payee] : NO_MEMBERS)
      : session.participants.filter((p) => p.alive && !isExhausted(p));
  },

  lootRecipient(
    session: Session, killer: CharacterRuntime | null, eligible: readonly CharacterRuntime[],
    party: LootParty | undefined,
  ): CharacterRuntime | null {
    if (party === undefined || session.participants.length < 2) {
      return killer !== null && killer.alive && !isExhausted(killer) ? killer : null;
    }
    if (party.splitLoot) return null;
    if (eligible.length === 0) return null;
    return eligible[session.rng.integer(0, eligible.length - 1)] ?? null;
  },

  leaderOf(session: Session, preferredId: string | undefined): CharacterRuntime | undefined {
    return session.participants.find((p) => p.id === preferredId) ?? session.participants[0];
  },

  onEmpty(session: Session, reason: EndReason): void {
    if (session.ended === null) session.end(reason);
  },

  onLeaderGone(session: Session, party: PartyLeadership | undefined): void {
    if (party === undefined || session.participants.some((p) => p.id === party.leaderId)) return;
    const next = session.participants[0];
    if (next === undefined) return;
    party.leaderId = next.id;
    session.record('leader-changed', next.id);
  },

  onCharacterDied(session: Session, character: CharacterRuntime, host: TopologyHost): void {
    // Solo — ou party que virou solo —: a morte encerra a sessão (§26.1).
    if (session.participants.length <= 1) {
      session.end('death');
      return;
    }
    host.depart(session, character.id, 'death');
  },

  onExitFinished(
    session: Session, characterId: string, reason: ExitFinishedReason, host: TopologyHost,
  ): void {
    if (session.participants.length <= 1) {
      if (session.ended === null) session.end(reason);
      return;
    }
    host.depart(session, characterId, reason);
  },

  startsInstanceSchedules(runnerCount: number): boolean {
    return runnerCount === 1;
  },

  placeOnEnter(entry: EntryPlacement): void {
    const { world, character, routeStart, runnerCount, huntId } = entry;
    const refused = runnerCount === 1
      ? place(world, character, routeStart)
      : placeNear(world, character, routeStart, ENTRY_RADIUS);
    if (refused !== null) {
      throw new Error(
        `não dá para entrar na hunt "${huntId}": o primeiro tile da rota ` +
          `(${routeStart.x},${routeStart.y}) foi recusado — ${refused}`,
      );
    }
  },

  runsRouteWalker: true,
  runsExitRules: true,
  burnsStaminaByTime: true,

  namesOwnerInEvents(session: Session): boolean {
    return session.participants.length !== 1;
  },
} satisfies SessionTopology);
