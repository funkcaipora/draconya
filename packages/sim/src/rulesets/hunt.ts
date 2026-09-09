// Ruleset de Hunt (FUN-43, §14) — o primeiro ruleset concreto, e o molde dos outros cinco.
//
// Um ruleset define QUATRO coisas, e são as mesmas para hunt, treino, quest, boss e guild
// war. Vale escrever de novo aqui, porque é o teste de fogo da interface:
//
//   | como entra          | pelo menu, com dificuldade escolhida; instância criada na entrada |
//   | o que encerra       | ação manual, regra de saída, ou morte (§14.8)                     |
//   | o que a morte faz   | encerra — devolver à PZ é a FUN-38, do lado do servidor           |
//   | como recompensa     | XP por abate, bloqueada com stamina zero                          |
//
// Se a Guild War não couber nessa mesma interface depois, ela foi modelada em cima de hunt —
// e descobrir isso na F5 custa semanas. É por isso que nada aqui pede método novo em
// `Ruleset`: tudo o que a hunt precisa cabe em `onEnter`, `onTick`, `onDeath`, `onEnd` e no
// par `getState`/`restore`.
//
// A instância é ISOLADA: mapa, rota e spawns são desta sessão e de mais ninguém. Não existe
// disputa por spawn, e é isso que permite a hunt rodar sozinha, com o navegador fechado.

import type {
  Combat, Content, Hunt, HuntDifficulty, Monster, Progression, Route, SpawnPoint, Stamina,
  Tilemap, Vocation,
} from '@draconya/content';
import { isBlocked } from '@draconya/content';
import type { CharacterRuntime } from '../character.js';
import { resolveDamage } from '../combat/damage.js';
import type { Defender } from '../combat/damage.js';
import { Spawner } from '../hunt/spawner.js';
import type { SpawnerState } from '../hunt/spawner.js';
import { MonsterRuntime, chooseTarget, decideMonsterAction } from '../monster/monster.js';
import type { MonsterState, Prey } from '../monster/monster.js';
import type { Blocked } from '../monster/step.js';
import { distance } from '../monster/step.js';
import { applyDeathPenalty, grantXp } from '../progression.js';
import { Rng } from '../rng.js';
import { EventPriority } from '../schedule.js';
import type { ScheduledEvent } from '../schedule.js';
import { drainStamina, isExhausted } from '../stamina.js';
import { RouteWalker } from '../route/walker.js';
import type { RouteState } from '../route/walker.js';
import { Session } from '../session.js';
import type { Aggregates, EndReason, Receipt, Ruleset, SessionSnapshot } from '../session.js';

/**
 * Os eventos da hunt. Uma cadência, um tipo — e cada um reagenda a si mesmo.
 *
 * Antes tudo isto era uma fase do `onTick`, avaliada a cada passo para quase sempre não fazer
 * nada. Agora cada cadência acorda na hora dela.
 */
const PLAYER_STEP = 'player-step';
const PLAYER_ATTACK = 'player-attack';
const MONSTER_STEP = 'monster-step';
const MONSTER_ATTACK = 'monster-attack';
const HEALTH_REGEN = 'health-regen';
const MANA_REGEN = 'mana-regen';
const SPAWN = 'spawn';
const EXIT_RULES = 'exit-rules';

/**
 * De quanto em quanto tempo as regras de saída são avaliadas.
 *
 * Antes era "a cada tick", o que fazia a hunt anexada checar dez vezes por segundo e a
 * desanexada uma — a mesma regra reagindo em tempos diferentes conforme houvesse alguém
 * olhando, que é exatamente o que o invariante 3 proíbe. Um período fixo resolve; 250 ms é
 * responsivo o bastante para uma regra de "vida abaixo de X" e custa quatro avaliações por
 * segundo.
 */
const EXIT_RULE_INTERVAL_MS = 250;

/**
 * Quando o lugar de spawn estava bloqueado, de quanto em quanto tempo tentar de novo.
 *
 * O lugar continua devendo um monstro; o que falta é espaço. Tentar no vencimento seguinte
 * ao invés de insistir é o que evita um laço quente quando o jogador acampa em cima do ponto.
 */
const SPAWN_RETRY_MS = 1000;

const monsterSubject = (id: number): string => `m:${id}`;

export type HuntDifficultyName = keyof Hunt['difficulties'];

/**
 * O que o personagem bate e o quanto aguenta. Vem de `content` (§12.1) — nenhum coeficiente
 * mora neste arquivo.
 */
export interface PlayerProfile {
  readonly attackPower: number;
  readonly attackIntervalMs: number;
  readonly attackRange: number;
  readonly armor: number;
  readonly dodgeChance: number;
  /** Milissegundos por tile ao percorrer a rota. */
  readonly stepDurationMs: number;
}

/** O que uma regra de saída consegue enxergar. Estreito de propósito: regra não muda estado. */
export interface HuntView {
  readonly elapsedMs: number;
  readonly aggregates: Readonly<Aggregates>;
  readonly participants: readonly CharacterRuntime[];
  readonly monstersAlive: number;
}

/**
 * Regra automática de saída (§14.8).
 *
 * Predicado já compilado, avaliado a cada tick — é a forma que o ADR 0002 exige do motor de
 * bot, e a razão é a mesma: interpretar JSON a cada avaliação é o caminho fácil e caro. O
 * motor que TRADUZ a configuração do jogador nestes predicados é a F2; o que existe aqui é o
 * ponto onde ele vai encaixar.
 */
export interface HuntExitRule {
  readonly id: string;
  when(view: HuntView): boolean;
}

export interface HuntRulesetOptions {
  readonly hunt: Hunt;
  readonly difficulty: HuntDifficultyName;
  readonly map: Tilemap;
  readonly route: Route;
  readonly monsters: ReadonlyMap<string, Monster>;
  readonly combat: Combat;
  readonly progression: Progression;
  readonly stamina: Stamina;
  readonly vocations: ReadonlyMap<string, Vocation>;
  readonly player: PlayerProfile;
  readonly exitRules?: readonly HuntExitRule[];
  /**
   * Premium reduz a penalidade de morte de 60% para 54% (§26.2). É atributo da CONTA, não do
   * personagem, e por isso entra por aqui em vez de morar no `CharacterRuntime`.
   */
  readonly premium?: boolean;
}

export interface HuntRulesetState {
  readonly huntId: string;
  readonly difficulty: HuntDifficultyName;
  readonly route: RouteState;
  readonly spawner: SpawnerState;
  readonly monsters: readonly MonsterState[];
  readonly nextCreatureId: number;
  readonly warnedExhausted: boolean;
  /**
   * Até que instante lógico a stamina já foi consumida.
   *
   * Precisa entrar no snapshot: sem ele, uma sessão retomada com quatro horas de hunt no
   * relógio lógico cobraria as quatro horas de novo no primeiro evento.
   */
  readonly staminaAnchorMs: number;
  /** Ver `HuntRuleset.#onPlayerAttack`. Ausente é `true`: engatilhado. */
  readonly playerAttackReady?: boolean;
}

export class HuntRuleset implements Ruleset {
  readonly type = 'hunt' as const;

  readonly #options: HuntRulesetOptions;
  readonly #difficulty: HuntDifficulty;
  readonly #exitRules: readonly HuntExitRule[];
  #walker: RouteWalker;
  #spawner: Spawner;
  #monsters: MonsterRuntime[] = [];
  /**
   * Índice `"m:<id>"` → monstro, para o despacho de evento não varrer a lista.
   *
   * Custa uma entrada de mapa por monstro e paga na hora: com 38 monstros, uma varredura por
   * evento é a diferença entre 9 e 35 µs por instância no `pnpm bench:hunts`, e o custo por
   * instância é o número que a FUN-46 cobra.
   */
  readonly #monsterBySubject = new Map<string, MonsterRuntime>();
  #nextCreatureId = 1;

  /**
   * Já avisou que a stamina zerou? A notícia sai UMA vez.
   *
   * O cenário comum é o jogador ausente: a hunt continua andando, gastando supply e não
   * gerando nada (§10.2). Repetir o evento a cada tick encheria a lista curta da tela de
   * retorno com a mesma linha até ela deixar de ser lista.
   */
  #warnedExhausted = false;

  /** Até que instante lógico a stamina já foi cobrada. Ver `#burnStamina`. */
  #staminaAnchorMs = 0;

  /** O golpe do personagem está engatilhado? Ver `#onPlayerAttack`. */
  #playerAttackReady = true;

  /**
   * Tiles ocupados, `"x,y"`. Mantido de forma incremental: quem escreve posição passa por
   * `#vacate` e `#occupy`.
   *
   * Era reconstruído a cada tick, e a razão era boa — uma sessão retomada de snapshot chega
   * sem ele, porque `restore` não enxerga os participantes, que a `Session` só reconstrói
   * depois. Mas reconstruir a cada evento seria muito pior que a cada tick: são dezenas de
   * eventos por segundo contra um punhado de ticks. A saída é a bandeira abaixo — reconstrói
   * UMA vez, no primeiro evento depois de nascer ou de ser restaurado, e mantém dali em
   * diante.
   */
  readonly #occupied = new Set<number>();
  #occupancyStale = true;

  constructor(options: HuntRulesetOptions) {
    const difficulty = options.hunt.difficulties[options.difficulty];
    if (difficulty === undefined) {
      throw new Error(
        `hunt "${options.hunt.id}" não define a dificuldade "${options.difficulty}"`,
      );
    }
    this.#options = options;
    this.#difficulty = difficulty;
    this.#exitRules = options.exitRules ?? [];
    this.#walker = new RouteWalker(options.route);
    this.#spawner = new Spawner(options.route.spawnPoints.length, difficulty);
  }

  get monsters(): readonly MonsterRuntime[] {
    return this.#monsters;
  }

  get routeIndex(): number {
    return this.#walker.index;
  }

  /**
   * 10 Hz anexada, 1 Hz desanexada (ADR 0003).
   *
   * A conta fecha porque nada aqui é escrito por tick (invariante 2): o resultado a 1 Hz é o
   * mesmo que a 10 Hz, e o que se perde ao desanexar é só a suavidade do que ninguém está
   * vendo. É esta linha que torna milhares de hunts simultâneas pagáveis.
   */
  hz(attached: boolean): number {
    return attached ? 10 : 1;
  }

  onEnter(session: Session, character: CharacterRuntime): void {
    // Uma instância, um personagem — por enquanto, e de forma barulhenta.
    //
    // Party divide a rota (§14.7 fala em votação para trocar dificuldade), e sustentar isso
    // pede um caminhante por participante. Aceitar o segundo em silêncio faria ele ficar
    // parado no tile de entrada a hunt inteira, rendendo zero, sem nada explicando.
    if (session.participants.length > 1) {
      throw new Error('a hunt hospeda um personagem por instância; party é trabalho da F3');
    }
    character.position = this.#walker.current;
    session.record('entered-hunt', `${this.#options.hunt.id}/${this.#options.difficulty}`);

    // A fila inicial. Tudo começa PRONTO — vencendo agora —, que é o comportamento que os
    // cooldowns tinham (FUN-25) e a razão continua a mesma: entrar numa hunt e ficar meio
    // segundo parado antes do primeiro passo é um atraso sem explicação na tela.
    const { attackIntervalMs } = this.#options.player;
    session.scheduleIn(PLAYER_STEP, 0, {
      priority: EventPriority.Movement, subject: character.id,
    });
    this.#schedulePlayerAttack(session, character.id, 0);
    if (attackIntervalMs <= 0) throw new Error('attackIntervalMs must be positive');

    const { healthPerSecond, manaPerSecond } = this.#options.progression.regen;
    // Taxa zero não é intervalo infinito: é "não regenera", e então não há evento nenhum.
    if (healthPerSecond > 0) {
      session.scheduleIn(HEALTH_REGEN, 0, {
        priority: EventPriority.Upkeep, subject: character.id,
      });
    }
    if (manaPerSecond > 0) {
      session.scheduleIn(MANA_REGEN, 0, { priority: EventPriority.Upkeep, subject: character.id });
    }

    for (let slot = 0; slot < this.#spawner.slots.length; slot++) {
      session.scheduleIn(SPAWN, 0, { priority: EventPriority.Spawn, subject: String(slot) });
    }
    session.scheduleIn(EXIT_RULES, EXIT_RULE_INTERVAL_MS, {
      priority: EventPriority.Housekeeping,
    });
  }

  /**
   * Um evento venceu. `session.nowMs` é o instante exato do vencimento.
   *
   * Não existe mais ordem de fases: a ordem entre eventos que vencem no mesmo instante é a
   * prioridade deles (`EventPriority`), que reproduz a ordem que o `onTick` executava.
   */
  onEvent(session: Session, event: ScheduledEvent): void {
    if (this.#occupancyStale) this.#rebuildOccupancy(session);
    this.#burnStamina(session);

    switch (event.kind) {
      case PLAYER_STEP: return this.#onPlayerStep(session, event.subject);
      case PLAYER_ATTACK: return this.#onPlayerAttack(session, event.subject);
      case MONSTER_STEP: return this.#onMonsterAction(session, event.subject, 'step');
      case MONSTER_ATTACK: return this.#onMonsterAction(session, event.subject, 'attack');
      case HEALTH_REGEN: return this.#onRegen(session, event.subject, 'health');
      case MANA_REGEN: return this.#onRegen(session, event.subject, 'mana');
      case SPAWN: return this.#onSpawn(session, event.subject);
      case EXIT_RULES: return this.#onExitRules(session);
      // Evento de um tipo que este ruleset não conhece. Acontece com snapshot gravado por uma
      // versão que agendava algo que não existe mais; ignorar é a degradação certa.
      default: return;
    }
  }

  /**
   * Stamina cai 1:1 com o tempo de hunt, e zerar NÃO encerra nada (§10.2). É a regra que mais
   * parece bug para quem implementa, e a que mais precisa ser respeitada: o personagem
   * continua caçando, matando e apanhando — só para de ganhar XP.
   *
   * Cobrada pelo tempo LÓGICO decorrido desde a última cobrança, e não por um evento próprio:
   * é uma grandeza contínua, e um evento periódico daria a ela uma granularidade que ela não
   * tem. Assim a conta é exata em qualquer cadência, e o custo é uma subtração.
   */
  #burnStamina(session: Session): void {
    const dtMs = session.nowMs - this.#staminaAnchorMs;
    if (dtMs <= 0) return;
    this.#staminaAnchorMs = session.nowMs;
    for (const character of session.participants) {
      if (!character.alive) continue;
      const exhausted = drainStamina(character, dtMs, this.#options.stamina);
      if (!exhausted || this.#warnedExhausted) continue;
      this.#warnedExhausted = true;
      // Vale a linha no extrato: daqui para a frente a hunt queima supply sem gerar nada, e
      // descobrir isso só pelo gold que sumiu é como o modo idle perde a confiança de quem
      // deixou o personagem rendendo.
      session.record('stamina-exhausted', character.id);
    }
  }

  /**
   * Regeneração passiva (FUN-36), um ponto por vencimento.
   *
   * Vale mesmo com stamina zerada: regenerar não é recompensa, é sobrevivência — e o §10.2 é
   * explícito que o personagem continua podendo morrer, não que ele passa a morrer mais
   * rápido.
   *
   * Morto não regenera, e o evento morre com ele. Sem isso, um personagem que caiu voltaria
   * sozinho na hunt em que morreu, e a morte deixaria de encerrar coisa nenhuma.
   */
  #onRegen(session: Session, characterId: string, what: 'health' | 'mana'): void {
    const character = findById(session.participants, characterId);
    if (character === null || !character.alive) return;

    const { healthPerSecond, manaPerSecond } = this.#options.progression.regen;
    const perSecond = what === 'health' ? healthPerSecond : manaPerSecond;
    if (perSecond <= 0) return;

    if (what === 'health') character.heal(1);
    else character.mana = Math.min(character.maxMana, character.mana + 1);

    // `r` por segundo é um evento a cada `1000 / r` ms. Escrever assim, em vez de somar
    // `r * dtMs / 1000` num acumulador fracionário, é o que mantém a conta exata: somar
    // `0,1` dez vezes em ponto flutuante dá `0,9999…` e some uma unidade a cada dez.
    session.scheduleIn(what === 'health' ? HEALTH_REGEN : MANA_REGEN, 1000 / perSecond, {
      priority: EventPriority.Upkeep, subject: characterId,
    });
  }

  onDeath(session: Session, character: CharacterRuntime): void {
    this.#vacate(character.position.x, character.position.y);
    // Morto não anda, não bate e não regenera: os eventos dele saem da fila em vez de
    // vencerem para descobrir isso.
    session.cancelEvents(character.id);

    // A penalidade sai AQUI, na morte, e não no encerramento: quem morre paga, e uma hunt que
    // termina por saída manual ou por regra não custa XP nenhuma (§26.2).
    const penalty = applyDeathPenalty(
      character,
      { premium: this.#options.premium ?? false },
      this.#vocationOf(character),
      this.#options.progression,
    );
    if (penalty.xpLost > 0) {
      // Entra no agregado como perda: o extrato é o que vira linha de ledger, e creditar a XP
      // ganha sem descontar a perdida daria ao jogador uma XP que ele não tem.
      session.aggregates.xpGained -= penalty.xpLost;
      session.record('xp-penalty', String(penalty.xpLost));
    }
    if (penalty.levelChange !== null) {
      session.record('level-down', `${penalty.levelChange.from} → ${penalty.levelChange.to}`);
    }

    // Encerra quando não sobrou ninguém de pé. Com um personagem — o caso de hoje — é a
    // morte dele; escrito assim, party não vira exceção espalhada quando chegar.
    if (session.participants.some((p) => p.alive)) return;
    session.end('death');
  }

  onEnd(_session: Session, _reason: EndReason): void {
    // Nada a desfazer: a instância morre com a sessão, e o extrato é a `Session` que monta.
    // Todo encerramento produz extrato, inclusive o que acontece sem ninguém assistindo —
    // e é exatamente por isso que ele não depende de nada feito aqui.
  }

  getState(): HuntRulesetState {
    return {
      huntId: this.#options.hunt.id,
      difficulty: this.#options.difficulty,
      route: this.#walker.getState(),
      spawner: this.#spawner.getState(),
      monsters: this.#monsters.map((m) => m.getState()),
      nextCreatureId: this.#nextCreatureId,
      warnedExhausted: this.#warnedExhausted,
      staminaAnchorMs: this.#staminaAnchorMs,
      playerAttackReady: this.#playerAttackReady,
    };
  }

  restore(state: unknown): void {
    const restored = state as HuntRulesetState;
    // A hunt e a dificuldade são a IDENTIDADE da instância. Restaurar o estado de uma hunt
    // dentro de outra produziria monstros de um mapa andando em outro — e o §14.7 diz que
    // trocar de dificuldade cria instância nova justamente para isso nunca acontecer.
    if (
      restored.huntId !== this.#options.hunt.id ||
      restored.difficulty !== this.#options.difficulty
    ) {
      throw new Error(
        `snapshot é de "${restored.huntId}/${restored.difficulty}", mas este ruleset é de ` +
          `"${this.#options.hunt.id}/${this.#options.difficulty}"`,
      );
    }
    this.#walker = new RouteWalker(this.#options.route, restored.route);
    this.#spawner = new Spawner(
      this.#options.route.spawnPoints.length,
      this.#difficulty,
      restored.spawner,
    );
    this.#monsters = restored.monsters.map((m) => new MonsterRuntime(m));
    this.#monsterBySubject.clear();
    for (const monster of this.#monsters) {
      this.#monsterBySubject.set(monsterSubject(monster.id), monster);
    }
    this.#nextCreatureId = restored.nextCreatureId;
    this.#warnedExhausted = restored.warnedExhausted;
    this.#staminaAnchorMs = restored.staminaAnchorMs;
    this.#playerAttackReady = restored.playerAttackReady ?? true;
    // Os participantes ainda não existem: a `Session` os reconstrói depois desta chamada.
    // A ocupação é remontada no primeiro evento, quando todo mundo já está de pé.
    this.#occupancyStale = true;
  }

  // --- eventos ------------------------------------------------------------------------------

  /**
   * Um lugar de spawn venceu. Nasce um monstro, ou tenta de novo mais tarde.
   *
   * O monstro nasce já com os eventos dele vencendo AGORA, o que reproduz o comportamento
   * anterior — cooldown novo começa pronto, então ele agia no mesmo tick em que nascia. Como
   * `Spawn` tem prioridade menor que `Movement` e `Attack`, isso acontece neste mesmo
   * instante lógico, na ordem certa.
   */
  #onSpawn(session: Session, subject: string): void {
    const slot = Number(subject);
    const request = this.#spawner.fill(
      slot,
      this.#difficulty,
      (pointIndex) => (this.#options.route.spawnPoints[pointIndex] as SpawnPoint).at,
      this.#blocked(),
      session.rng,
    );
    if (request === null) {
      // Lugar ocupado é caso normal (o monstro está vivo) e não pede reagendamento: quem
      // devolve o lugar é `#reap`, e é ele que marca a próxima hora.
      if (this.#spawner.slots[slot]?.occupantId != null) return;
      session.scheduleIn(SPAWN, SPAWN_RETRY_MS, {
        priority: EventPriority.Spawn, subject,
      });
      return;
    }

    const definition = this.#options.monsters.get(request.monsterId);
    // Conteúdo válido não chega aqui com monstro inexistente: `buildContent` checa a
    // referência cruzada e derruba o boot. Sair é o resto defensivo, não a regra.
    if (definition === undefined) return;

    const monster = new MonsterRuntime({
      id: this.#nextCreatureId++,
      monsterId: definition.id,
      position: request.position,
      home: request.position,
      health: definition.health,
      targetId: null,
      cooldowns: {},
    });
    this.#monsters.push(monster);
    this.#monsterBySubject.set(monsterSubject(monster.id), monster);
    this.#occupy(monster.position.x, monster.position.y);
    this.#spawner.occupy(request.slot, monster.id);

    const subjectOf = monsterSubject(monster.id);
    session.scheduleIn(MONSTER_STEP, 0, {
      priority: EventPriority.Movement, subject: subjectOf,
    });
    this.#scheduleMonsterAttack(session, monster, 0);
    // Nasceu colado no personagem: se o golpe dele estava engatilhado, sai agora.
    this.#armPlayerAttack(session);
  }

  /**
   * O passo do personagem venceu.
   *
   * UM tile, e reavaliado da posição nova no vencimento seguinte. A versão anterior pulava
   * quantos tiles coubessem no tick, e é de lá que vinha a divergência de dano: num tick de
   * 1 s o personagem atravessava dois tiles de uma vez, o monstro também, e a adjacência era
   * conferida uma vez só, no fim.
   */
  #onPlayerStep(session: Session, characterId: string): void {
    const character = findById(session.participants, characterId);
    if (character === null || !character.alive) return;
    session.scheduleIn(PLAYER_STEP, this.#options.player.stepDurationMs, {
      priority: EventPriority.Movement, subject: characterId,
    });

    // Para para lutar, e retoma DEPOIS no mesmo índice (FUN-42). Como ele para assim que há
    // monstro ao alcance, nunca pisa no tile de um: o combate começa antes do passo.
    if (this.#nearestMonster(character) !== null) {
      this.#walker.stop();
      this.#armPlayerAttack(session);
      return;
    }

    // Ninguém ao alcance: anda. O personagem NÃO persegue — ele percorre a rota e deixa o
    // monstro vir. É o que dispensa pathfinding dos dois lados (ADR 0009).
    this.#walker.resume();
    const to = this.#walker.step();
    if (to === null) return;
    this.#vacate(character.position.x, character.position.y);
    character.position = to;
    this.#occupy(to.x, to.y);
    this.#armPlayerAttack(session);
  }

  /**
   * O ataque do personagem venceu: um golpe, no que estiver ao alcance agora.
   *
   * Sem alvo, o golpe fica ENGATILHADO em vez de ser desperdiçado, e o evento não é
   * reagendado — quem o traz de volta é `#armPlayerAttack`, no instante em que alguém entra
   * no alcance. Um cooldown que corre no vazio faria o dano do personagem depender de o
   * respawn cair em fase com um relógio, o que é aleatório e invisível: medido na fixture do
   * critério de saída da Fase 1, custava o dobro de encontros por minuto e matava um
   * personagem que antes sobrevivia à hunt inteira.
   */
  #onPlayerAttack(session: Session, characterId: string): void {
    const character = findById(session.participants, characterId);
    if (character === null || !character.alive) return;

    const target = this.#nearestMonster(character);
    if (target === null) {
      this.#playerAttackReady = true;
      return;
    }

    this.#schedulePlayerAttack(session, characterId, this.#options.player.attackIntervalMs);
    this.#strike(session, character, target);
    if (!target.alive) this.#reap(session, target, character);
  }

  /**
   * Agenda o golpe do personagem e DESENGATILHA, numa operação só.
   *
   * A invariante é "engatilhado OU agendado, nunca os dois": um golpe engatilhado com evento
   * pendente vira dois ataques por intervalo, que é o dobro do dano. Ela mora aqui, e não na
   * memória de quem escreve a próxima chamada.
   */
  #schedulePlayerAttack(session: Session, characterId: string, delayMs: number): void {
    this.#playerAttackReady = false;
    session.scheduleIn(PLAYER_ATTACK, delayMs, {
      priority: EventPriority.Attack, subject: characterId,
    });
  }

  /** O mesmo do lado do monstro, e pela mesma razão. */
  #scheduleMonsterAttack(session: Session, monster: MonsterRuntime, delayMs: number): void {
    monster.attackReady = false;
    session.scheduleIn(MONSTER_ATTACK, delayMs, {
      priority: EventPriority.Attack, subject: monsterSubject(monster.id),
    });
  }

  /**
   * Alguém entrou no alcance e o golpe estava engatilhado: ele sai AGORA.
   *
   * Chamado de onde uma criatura pode ter chegado perto — o passo do personagem e o
   * nascimento de um monstro. Não do passo de cada monstro: ali seria uma varredura por
   * monstro por passo, e o custo por instância é o número que a FUN-46 cobra.
   */
  #armPlayerAttack(session: Session): void {
    if (!this.#playerAttackReady) return;
    for (const character of session.participants) {
      if (!character.alive) continue;
      if (this.#nearestMonster(character) === null) continue;
      this.#schedulePlayerAttack(session, character.id, 0);
      return;
    }
  }

  /**
   * O passo ou o ataque de um monstro venceu.
   *
   * Os dois eventos passam pela mesma decisão e agem só quando ela bate com o tipo deles: é
   * `decideMonsterAction` que sabe se, deste tile, cabe andar ou bater — e ter uma decisão só
   * evita que a regra de alcance exista escrita duas vezes, divergindo na terceira mudança.
   */
  #onMonsterAction(session: Session, subject: string, which: 'step' | 'attack'): void {
    const monster = this.#monsterBySubject.get(subject);
    if (monster === undefined || !monster.alive) return;
    const definition = this.#options.monsters.get(monster.monsterId);
    if (definition === undefined) return;

    // `CharacterRuntime` já satisfaz `Prey` — id, posição e vida. Montar um vetor novo a cada
    // evento era uma alocação por monstro por vencimento, e com 5.000 instâncias isso é o
    // coletor rodando o tempo todo.
    const prey: readonly Prey[] = session.participants;
    monster.targetId = chooseTarget(monster, prey, definition);
    const target = findById(prey, monster.targetId);
    const action = decideMonsterAction(monster, target, definition, this.#blocked(monster));

    if (which === 'step') {
      // O passo reagenda sempre: um monstro parado precisa continuar acordando para descobrir
      // que o alvo se mexeu. É a única cadência que roda mesmo sem nada a fazer.
      session.scheduleIn(MONSTER_STEP, definition.stepDurationMs, {
        priority: EventPriority.Movement, subject,
      });
      if (action.kind === 'step') {
        this.#vacate(monster.position.x, monster.position.y);
        monster.position = action.to;
        this.#occupy(action.to.x, action.to.y);
      }
      // Chegou ao alcance com o golpe engatilhado: ele sai agora, e não no próximo múltiplo
      // de um relógio. É a mesma regra do personagem, do outro lado.
      if (action.kind === 'attack' && monster.attackReady) {
        this.#scheduleMonsterAttack(session, monster, 0);
      }
      return;
    }

    if (action.kind !== 'attack') {
      // Sem ninguém ao alcance: engatilha em vez de desperdiçar, e para de acordar. Quem o
      // traz de volta é o passo, que já reavalia a distância a cada vencimento.
      monster.attackReady = true;
      return;
    }

    this.#scheduleMonsterAttack(session, monster, definition.attackIntervalMs);

    const character = findById(session.participants, action.targetId);
    if (character === null || !character.alive) return;

    const result = resolveDamage(
      { power: definition.attack, kind: 'melee' },
      this.#playerDefender(),
      'pve',
      this.#options.combat,
      session.rng,
    );
    character.receiveDamage(result.damage);
    if (character.health > 0) return;

    // `receiveDamage` já marcou `alive = false`; `kill` é o que conta a morte no extrato e
    // avisa o ruleset. Chamar os dois é deliberado: quem aplica dano não decide morte.
    session.kill(character);
  }

  #onExitRules(session: Session): void {
    session.scheduleIn(EXIT_RULES, EXIT_RULE_INTERVAL_MS, {
      priority: EventPriority.Housekeeping,
    });
    this.#applyExitRules(session);
  }

  #applyExitRules(session: Session): void {
    const view: HuntView = {
      elapsedMs: session.aggregates.durationMs,
      aggregates: session.aggregates,
      participants: session.participants,
      monstersAlive: this.#monsters.filter((m) => m.alive).length,
    };
    for (const rule of this.#exitRules) {
      if (!rule.when(view)) continue;
      // O extrato precisa dizer QUAL regra — "sua hunt encerrou por uma regra de saída" sem
      // dizer qual é a mensagem que faz o jogador desconfiar do bot que ele mesmo configurou.
      session.record('exit-rule', rule.id);
      session.end('exit-rule');
      return;
    }
  }

  // --- combate ------------------------------------------------------------------------------

  #strike(session: Session, character: CharacterRuntime, monster: MonsterRuntime): void {
    const definition = this.#options.monsters.get(monster.monsterId);
    if (definition === undefined) return;
    const result = resolveDamage(
      { power: this.#options.player.attackPower, kind: 'melee' },
      { armor: definition.armor, dodgeChance: 0 },
      'pve',
      this.#options.combat,
      session.rng,
    );
    monster.receiveDamage(result.damage);
  }

  /** O monstro morreu: conta o abate, credita XP e devolve o lugar ao spawner. */
  #reap(session: Session, monster: MonsterRuntime, killer: CharacterRuntime): void {
    session.aggregates.kills++;
    const definition = this.#options.monsters.get(monster.monsterId);

    // Stamina zero bloqueia a RECOMPENSA, não a hunt (§10.2). O abate continua contando: o
    // jogador matou, e o extrato mentiria se dissesse que não.
    if (definition !== undefined && !isExhausted(killer)) {
      const change = grantXp(
        killer, definition.experience, this.#vocationOf(killer), this.#options.progression,
      );
      session.aggregates.xpGained += definition.experience;
      // Level up É evento notável, ao contrário do abate: é a única coisa que aconteceu numa
      // hunt de oito horas que o jogador quer ver ao voltar (§16.2).
      if (change !== null) session.record('level-up', String(change.to));
    }
    // Abate comum NÃO vira evento notável. `notableEvents` é a lista curta da tela de retorno
    // (§16.2), e uma hunt de oito horas com uma linha por rato não é lista, é log.

    // O lugar volta a contar o tempo — e é aqui que a próxima hora dele é marcada, agora que
    // o spawner não guarda mais instante nenhum.
    const slot = this.#spawner.release(monster.id);
    if (slot !== null) {
      session.scheduleIn(SPAWN, this.#difficulty.respawnDelayMs, {
        priority: EventPriority.Spawn, subject: String(slot),
      });
    }
    this.#vacate(monster.position.x, monster.position.y);
    // Os eventos dele saem da fila junto com ele. Deixá-los vencer custaria um despacho para
    // descobrir que não há mais ninguém ali, uma vez por cadência, para sempre.
    session.cancelEvents(monsterSubject(monster.id));
    this.#monsterBySubject.delete(monsterSubject(monster.id));
    this.#monsters = this.#monsters.filter((m) => m.id !== monster.id);
  }

  #vocationOf(character: CharacterRuntime): Vocation | null {
    if (character.vocationId === null) return null;
    // Vocação que saiu do conteúdo cai para a tabela base em vez de derrubar a hunt: perder
    // stats é ruim, perder a sessão inteira de quem estava caçando é pior.
    return this.#options.vocations.get(character.vocationId) ?? null;
  }

  #playerDefender(): Defender {
    return {
      armor: this.#options.player.armor,
      dodgeChance: this.#options.player.dodgeChance,
    };
  }

  #nearestMonster(character: CharacterRuntime): MonsterRuntime | null {
    let best: MonsterRuntime | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const monster of this.#monsters) {
      if (!monster.alive) continue;
      const d = distance(character.position, monster.position);
      // `>=` desempata pelo monstro que nasceu antes, e a ordem da lista é a de nascimento.
      // Desempate estável é o que faz duas execuções da mesma semente baterem.
      if (d > this.#options.player.attackRange || d >= bestDistance) continue;
      best = monster;
      bestDistance = d;
    }
    return best;
  }

  // --- ocupação -----------------------------------------------------------------------------

  /**
   * O predicado de tile bloqueado, para o passo guloso e para o spawn.
   *
   * UMA closure, reaproveitada, com a exclusão num campo — e não uma closure nova por
   * chamada. Parece detalhe e não é: isto é consultado até três vezes por passo de monstro,
   * e com 5.000 instâncias uma alocação aqui é o coletor rodando o tempo todo.
   *
   * Só é seguro porque ninguém guarda o predicado: ele é usado e descartado dentro da mesma
   * chamada, nunca dois ao mesmo tempo.
   */
  #excludedMonster: MonsterRuntime | null = null;

  readonly #blockedFn: Blocked = (x, y) => {
    if (isBlocked(this.#options.map, x, y)) return true;
    if (!this.#occupied.has(tileKey(x, y))) return false;
    // O próprio monstro ocupa o tile de onde está saindo; sem esta exceção ele nunca sai.
    const self = this.#excludedMonster;
    return self === null || self.position.x !== x || self.position.y !== y;
  };

  #blocked(exclude: MonsterRuntime | null = null): Blocked {
    this.#excludedMonster = exclude;
    return this.#blockedFn;
  }

  /**
   * Remonta a ocupação do zero. Chamado UMA vez, no primeiro evento depois de a sessão nascer
   * ou ser restaurada — dali em diante ela é mantida por `#occupy` e `#vacate`.
   */
  #rebuildOccupancy(session: Session): void {
    this.#occupancyStale = false;
    this.#occupied.clear();
    for (const monster of this.#monsters) {
      if (monster.alive) this.#occupied.add(tileKey(monster.position.x, monster.position.y));
    }
    for (const character of session.participants) {
      if (character.alive) {
        this.#occupied.add(tileKey(character.position.x, character.position.y));
      }
    }
  }

  #occupy(x: number, y: number): void {
    this.#occupied.add(tileKey(x, y));
  }

  #vacate(x: number, y: number): void {
    this.#occupied.delete(tileKey(x, y));
  }
}

/**
 * Chave NUMÉRICA de tile. `\`${x},${y}\`` alocava uma string por consulta de ocupação, e o
 * passo guloso consulta até três por vencimento.
 *
 * Só é chamada com coordenada dentro do mapa: `#blockedFn` pergunta ao tilemap primeiro, e
 * fora dos limites nem chega aqui. Por isso o fator não precisa acomodar negativo.
 */
const tileKey = (x: number, y: number): number => x * 100_000 + y;

/**
 * Busca por id sem closure.
 *
 * `array.find((p) => p.id === x)` aloca uma closure por chamada, e estes caminhos rodam
 * dezenas de vezes por segundo por instância — com 5.000 instâncias, é coletor.
 */
function findById<T extends { readonly id: string }>(
  items: readonly T[],
  id: string | null,
): T | null {
  if (id === null) return null;
  for (const item of items) if (item.id === id) return item;
  return null;
}

// --- montagem a partir de `content` ----------------------------------------------------------

export interface HuntSessionOptions {
  readonly id: string;
  readonly content: Content;
  readonly huntId: string;
  readonly difficulty: HuntDifficultyName;
  readonly createdAtMs: number;
  readonly exitRules?: readonly HuntExitRule[];
  readonly premium?: boolean;
}

export class HuntUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HuntUnavailableError';
  }
}

/** Monta o ruleset com tudo o que a hunt escolhida precisa. Lança quando falta alguma peça. */
export function createHuntRuleset(
  content: Content,
  huntId: string,
  difficulty: HuntDifficultyName,
  exitRules?: readonly HuntExitRule[],
  premium?: boolean,
): HuntRuleset {
  const hunt = content.hunts.get(huntId);
  if (hunt === undefined) throw new HuntUnavailableError(`hunt "${huntId}" não existe`);
  const map = content.maps.get(hunt.mapId);
  if (map === undefined) {
    throw new HuntUnavailableError(`hunt "${huntId}" aponta mapa inexistente "${hunt.mapId}"`);
  }
  const route = content.routes.get(hunt.routeId);
  if (route === undefined) {
    throw new HuntUnavailableError(`hunt "${huntId}" aponta rota inexistente "${hunt.routeId}"`);
  }
  return new HuntRuleset({
    hunt,
    difficulty,
    map,
    route,
    monsters: content.monsters,
    combat: content.combat,
    progression: content.progression,
    stamina: content.stamina,
    vocations: content.vocations,
    player: { ...content.combat.player, stepDurationMs: content.progression.stepDurationMs },
    ...(exitRules === undefined ? {} : { exitRules }),
    ...(premium === undefined ? {} : { premium }),
  });
}

/**
 * Cria a instância. É a ENTRADA: a sessão nasce com o mapa, a rota e os spawns da dificuldade
 * escolhida, e a versão de conteúdo congelada (invariante 7).
 *
 * O personagem entra depois, com `session.enter` — quem o constrói é o servidor, que é o dono
 * do estado durável.
 */
export function createHuntSession(options: HuntSessionOptions): Session {
  return new Session({
    id: options.id,
    contentVersion: options.content.version,
    ruleset: createHuntRuleset(
      options.content, options.huntId, options.difficulty, options.exitRules, options.premium,
    ),
    // Semente derivada do id: a mesma sessão reproduz a mesma sequência de combate, que é o
    // que torna "por que eu morri" uma pergunta investigável.
    rng: Rng.fromSeed(options.id),
    createdAtMs: options.createdAtMs,
  });
}

/**
 * Reconstrói o ruleset de um snapshot de hunt (FUN-28).
 *
 * A hunt e a dificuldade vêm do PRÓPRIO snapshot: são identidade da instância, não escolha de
 * quem retoma. Devolve `null` quando o conteúdo não tem mais as peças — e `null` é a resposta
 * certa, porque retomar numa hunt diferente é pior que não retomar.
 */
export function huntRulesetFromSnapshot(
  snapshot: SessionSnapshot,
  content: Content,
): HuntRuleset | null {
  const state = snapshot.ruleset as Partial<HuntRulesetState> | undefined;
  if (state?.huntId === undefined || state.difficulty === undefined) return null;
  try {
    return createHuntRuleset(content, state.huntId, state.difficulty);
  } catch {
    return null;
  }
}

/**
 * Trocar de dificuldade ENCERRA a instância e cria outra (§14.7). Não existe alteração
 * dinâmica, e não tente ser esperto aqui: mudar `perSpawnPoint` no meio deixaria monstros da
 * densidade antiga vivos ao lado dos novos, e o jogador veria uma dificuldade que não é
 * nenhuma das duas.
 *
 * O extrato da instância antiga sai por `manual-exit` — o jogador pediu — com um evento
 * notável dizendo o que ele trocou, para a tela de retorno não ficar com um encerramento sem
 * explicação.
 */
export function changeDifficulty(
  session: Session,
  options: {
    readonly content: Content;
    readonly to: HuntDifficultyName;
    readonly newSessionId: string;
    readonly nowMs: number;
  },
): { readonly session: Session; readonly receipt: Receipt } {
  const ruleset = session.ruleset;
  if (!(ruleset instanceof HuntRuleset)) {
    throw new Error(`sessão ${session.id} não é uma hunt`);
  }
  const state = ruleset.getState();
  const characters = [...session.participants];

  session.record('difficulty-changed', `${state.difficulty} → ${options.to}`);
  const receipt = session.end('manual-exit');

  const next = createHuntSession({
    id: options.newSessionId,
    content: options.content,
    huntId: state.huntId,
    difficulty: options.to,
    createdAtMs: options.nowMs,
  });
  for (const character of characters) next.enter(character);
  return { session: next, receipt };
}
