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
import { drainStamina, isExhausted } from '../stamina.js';
import { RouteWalker } from '../route/walker.js';
import type { RouteState } from '../route/walker.js';
import { Session } from '../session.js';
import type { Aggregates, EndReason, Receipt, Ruleset, SessionSnapshot } from '../session.js';

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
}

export class HuntRuleset implements Ruleset {
  readonly type = 'hunt' as const;

  readonly #options: HuntRulesetOptions;
  readonly #difficulty: HuntDifficulty;
  readonly #exitRules: readonly HuntExitRule[];
  #walker: RouteWalker;
  #spawner: Spawner;
  #monsters: MonsterRuntime[] = [];
  #nextCreatureId = 1;

  /**
   * Já avisou que a stamina zerou? A notícia sai UMA vez.
   *
   * O cenário comum é o jogador ausente: a hunt continua andando, gastando supply e não
   * gerando nada (§10.2). Repetir o evento a cada tick encheria a lista curta da tela de
   * retorno com a mesma linha até ela deixar de ser lista.
   */
  #warnedExhausted = false;

  /** Tiles ocupados neste tick, `"x,y"`. Reconstruído a cada tick — ver `onTick`. */
  readonly #occupied = new Set<string>();

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
  }

  onTick(session: Session, dtMs: number): void {
    // Ocupação reconstruída do zero a cada tick, e não mantida entre eles, porque uma sessão
    // retomada de snapshot (FUN-28) chega sem ela: `restore` não vê os participantes, que a
    // `Session` só reconstrói depois. Com 48 monstros o custo é ruído; a alternativa é um
    // índice que nasce vazio numa retomada e deixa monstro nascer em cima de monstro.
    this.#rebuildOccupancy(session);
    this.#burnStamina(session, dtMs);
    this.#regenerate(session, dtMs);

    this.#spawn(session);
    this.#actPlayers(session, dtMs);
    if (session.ended !== null) return;
    this.#actMonsters(session, dtMs);
    if (session.ended !== null) return;
    this.#applyExitRules(session);
  }

  /**
   * Stamina cai 1:1 com o tempo de hunt, e zerar NÃO encerra nada (§10.2). É a regra que mais
   * parece bug para quem implementa, e a que mais precisa ser respeitada: o personagem
   * continua caçando, matando e apanhando — só para de ganhar XP.
   */
  #burnStamina(session: Session, dtMs: number): void {
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
   * Regeneração passiva, por tempo decorrido (FUN-36).
   *
   * Vale mesmo com stamina zerada: regenerar não é recompensa, é sobrevivência — e o §10.2 é
   * explícito que o personagem continua podendo morrer, não que ele passa a morrer mais
   * rápido.
   *
   * Morto não regenera. Sem esta linha, um personagem que caiu voltaria sozinho na hunt em
   * que morreu, e a morte deixaria de encerrar coisa nenhuma.
   */
  #regenerate(session: Session, dtMs: number): void {
    const { healthPerSecond, manaPerSecond } = this.#options.progression.regen;
    for (const character of session.participants) {
      if (!character.alive) continue;
      character.heal(pointsRegenerated(character, 'health-regen', healthPerSecond, dtMs));
      const mana = pointsRegenerated(character, 'mana-regen', manaPerSecond, dtMs);
      character.mana = Math.min(character.maxMana, character.mana + mana);
    }
  }

  onDeath(session: Session, character: CharacterRuntime): void {
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
    this.#nextCreatureId = restored.nextCreatureId;
    this.#warnedExhausted = restored.warnedExhausted;
  }

  // --- tick ---------------------------------------------------------------------------------

  #spawn(session: Session): void {
    const requests = this.#spawner.due(
      session.nowMs,
      this.#difficulty,
      (pointIndex) => (this.#options.route.spawnPoints[pointIndex] as SpawnPoint).at,
      this.#blocked(),
      session.rng,
    );
    for (const request of requests) {
      const definition = this.#options.monsters.get(request.monsterId);
      // Conteúdo válido não chega aqui com monstro inexistente: `buildContent` checa a
      // referência cruzada e derruba o boot. Pular é o resto defensivo, não a regra.
      if (definition === undefined) continue;
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
      this.#occupy(monster.position.x, monster.position.y);
      this.#spawner.occupy(request.slot, monster.id);
    }
  }

  #actPlayers(session: Session, dtMs: number): void {
    for (const character of session.participants) {
      if (!character.alive) continue;

      const target = this.#nearestMonster(character);
      if (target === null) {
        // Ninguém ao alcance: anda. O personagem NÃO persegue — ele percorre a rota e deixa
        // o monstro vir. É o que dispensa pathfinding dos dois lados (ADR 0009).
        this.#walker.resume();
        const to = this.#walker.advance(dtMs, this.#options.player.stepDurationMs);
        if (to === null) continue;
        this.#vacate(character.position.x, character.position.y);
        character.position = to;
        this.#occupy(to.x, to.y);
        continue;
      }

      // Para para lutar, e retoma DEPOIS no mesmo índice (FUN-42). Como ele para assim que
      // há monstro ao alcance, nunca pisa no tile de um: o combate começa antes do passo.
      this.#walker.stop();
      const times = character.cooldowns.timesThatFit(
        'attack', dtMs, this.#options.player.attackIntervalMs,
      );
      for (let i = 0; i < times && target.alive; i++) {
        this.#strike(session, character, target);
      }
      if (!target.alive) this.#reap(session, target, character);
    }
  }

  #actMonsters(session: Session, dtMs: number): void {
    const prey: Prey[] = session.participants.map((p) => ({
      id: p.id, position: p.position, alive: p.alive,
    }));

    for (const monster of this.#monsters) {
      if (!monster.alive) continue;
      const definition = this.#options.monsters.get(monster.monsterId);
      if (definition === undefined) continue;

      monster.targetId = chooseTarget(monster, prey, definition);
      const target = prey.find((p) => p.id === monster.targetId) ?? null;
      const action = decideMonsterAction(
        monster, target, definition, dtMs, this.#blocked(monster.id),
      );

      if (action.kind === 'step') {
        this.#vacate(monster.position.x, monster.position.y);
        monster.position = action.to;
        this.#occupy(action.to.x, action.to.y);
        continue;
      }
      if (action.kind !== 'attack') continue;

      const character = session.participants.find((p) => p.id === action.targetId);
      if (character === undefined || !character.alive) continue;

      const result = resolveDamage(
        { power: definition.attack, kind: 'melee' },
        this.#playerDefender(),
        'pve',
        this.#options.combat,
        session.rng,
      );
      character.receiveDamage(result.damage);
      if (character.health > 0) continue;

      // `receiveDamage` já marcou `alive = false`; `kill` é o que conta a morte no extrato e
      // avisa o ruleset. Chamar os dois é deliberado: quem aplica dano não decide morte.
      session.kill(character);
      // A sessão pode ter acabado agora. Os monstros restantes não agem num mundo encerrado.
      if (session.ended !== null) return;
      // O alvo caiu: o que os outros monstros enxergam mudou no meio da varredura.
      const entry = prey.find((p) => p.id === character.id);
      if (entry !== undefined) prey[prey.indexOf(entry)] = { ...entry, alive: false };
    }
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

    this.#spawner.release(monster.id, session.nowMs, this.#difficulty);
    this.#vacate(monster.position.x, monster.position.y);
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

  #blocked(excludeMonsterId?: number): Blocked {
    return (x, y) => {
      if (isBlocked(this.#options.map, x, y)) return true;
      if (!this.#occupied.has(key(x, y))) return false;
      // O próprio monstro ocupa o tile de onde está saindo; sem esta exceção ele nunca sai.
      if (excludeMonsterId === undefined) return true;
      const self = this.#monsters.find((m) => m.id === excludeMonsterId);
      return self === undefined || self.position.x !== x || self.position.y !== y;
    };
  }

  #rebuildOccupancy(session: Session): void {
    this.#occupied.clear();
    for (const monster of this.#monsters) {
      if (monster.alive) this.#occupied.add(key(monster.position.x, monster.position.y));
    }
    for (const character of session.participants) {
      if (character.alive) this.#occupied.add(key(character.position.x, character.position.y));
    }
  }

  #occupy(x: number, y: number): void {
    this.#occupied.add(key(x, y));
  }

  #vacate(x: number, y: number): void {
    this.#occupied.delete(key(x, y));
  }
}

const key = (x: number, y: number): string => `${x},${y}`;

/**
 * Quantos pontos inteiros a taxa rendeu no tempo decorrido.
 *
 * `r` por segundo é uma ação periódica de `1000 / r` milissegundos — e escrever assim, em vez
 * de somar `r * dtMs / 1000` num acumulador fracionário, é o que mantém a conta exata: somar
 * `0,1` dez vezes em ponto flutuante dá `0,9999…`, e some uma unidade a cada dez. Numa hunt
 * de oito horas isso é regeneração faltando sem nada explicando.
 */
function pointsRegenerated(
  character: CharacterRuntime,
  key: string,
  perSecond: number,
  dtMs: number,
): number {
  // Taxa zero não é intervalo infinito: é "não regenera". Sem esta saída, o intervalo viraria
  // `Infinity` e o laço de recuperação rodaria até o teto de catch-up a cada tick.
  if (perSecond <= 0) return 0;
  return character.cooldowns.timesThatFit(key, dtMs, 1000 / perSecond);
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
