// Ruleset de Hunt (FUN-43, §14) — o primeiro ruleset concreto, e o molde dos outros cinco.
//
// Um ruleset define QUATRO coisas, e são as mesmas para hunt, treino, quest, boss e guild
// war. Vale escrever de novo aqui, porque é o teste de fogo da interface:
//
//   | como entra          | pelo menu, com dificuldade escolhida; instância criada na entrada |
//   | o que encerra       | ação manual, regra de saída, ou morte (§14.8)                     |
//   | o que a morte faz   | encerra — devolver à PZ é a FUN-38, do lado do servidor           |
//   | como recompensa     | loot e XP por abate, bloqueados com stamina zero                  |
//
// Se a Guild War não couber nessa mesma interface depois, ela foi modelada em cima de hunt —
// e descobrir isso na F5 custa semanas. É por isso que nada aqui pede método novo em
// `Ruleset`: tudo o que a hunt precisa cabe em `onEnter`, `onEvent`, `onCreatureDied`, `onEnd`
// e no par `getState`/`restore`.
//
// A instância é ISOLADA: mapa, rota e spawns são desta sessão e de mais ninguém. Não existe
// disputa por spawn, e é isso que permite a hunt rodar sozinha, com o navegador fechado.

import { BOT_CATEGORIES, isBlocked } from '@draconya/content';
import type {
  BotAction, BotCategory, BotConfig, BotExitRule, Combat, Content, Hunt, HuntDifficulty,
  Monster, Progression, Route, Skill, Spell, SpawnPoint, Stamina, Supply, Tilemap, Vocation,
} from '@draconya/content';
import type { CharacterRuntime } from '../character.js';
import { NOT_IN_CATALOG, balanceOf, castSpell, useSupply } from '../casting.js';
import type { CastResult, SpellTarget } from '../casting.js';
import { resolveDamage } from '../combat/damage.js';
import type { Defender } from '../combat/damage.js';
import { forgetActor, recordDamage, resolveDeath } from '../death.js';
import type { KillCredit, Victim } from '../death.js';
import { Spawner } from '../hunt/spawner.js';
import type { SpawnerState } from '../hunt/spawner.js';
import { rollLoot } from '../loot.js';
import { compileBot } from '../bot.js';
import type { BotActuator, BotView, CompiledBot } from '../bot.js';
import {
  MonsterRuntime, chooseTarget, decideMonsterAction, monsterSubject,
} from '../monster/monster.js';
import type { MonsterState, Prey } from '../monster/monster.js';
import type { Blocked, GridPoint } from '../monster/step.js';
import { distance, fleeStep, greedyStep } from '../monster/step.js';
import { DEFAULT_TARGETING, countTargets, selectTarget } from '../targeting.js';
import type { Targeting } from '../targeting.js';
import { applyDeathPenalty, grantXp } from '../progression.js';
import { Rng } from '../rng.js';
import { TileOccupancy, canOccupy, move, place } from '../movement.js';
import type { Movable, MoveResult } from '../movement.js';
import { EventPriority } from '../schedule.js';
import type { ScheduledEvent } from '../schedule.js';
import { powerMultiplier } from '../skills.js';
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
 * Um evento POR CATEGORIA (FUN-84, §13.4/§13.5). Não existe prioridade global entre elas: uma
 * cura que executa não atrasa o ataque, porque são vencimentos independentes na mesma fila.
 */
const BOT_EVENT: Readonly<Record<BotCategory, string>> = {
  heal: 'bot-heal',
  potion: 'bot-potion',
  attack: 'bot-attack',
  rune: 'bot-rune',
  support: 'bot-support',
};

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

export type HuntDifficultyName = keyof Hunt['difficulties'];

/** O `SpellTarget` do lado de quem o PREENCHE. Ver `HuntRuleset.#spellTarget`. */
type MutableSpellTarget = { -readonly [K in keyof SpellTarget]: SpellTarget[K] };

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
 * Regra automática de saída (§14.8, §13.9).
 *
 * Predicado já compilado, avaliado a cada `EXIT_RULE_INTERVAL_MS` — é a forma que o ADR 0002
 * exige do motor de bot, e a razão é a mesma: interpretar JSON a cada avaliação é o caminho
 * fácil e caro. Quem TRADUZ a configuração do jogador nestes predicados é `compileExitRules`,
 * logo abaixo; a interface continua aberta para quem quiser injetar uma regra de teste.
 */
export interface HuntExitRule {
  readonly id: string;
  when(view: HuntView): boolean;
}

/**
 * Traduz as regras do jogador em predicados (FUN-86).
 *
 * Mora AQUI, e não no compilador do bot, porque o predicado lê a `HuntView` — e `bot.ts` não
 * conhece ruleset nenhum, nem pode: o mesmo bot vai valer para quest e boss, que terão outra
 * view. O compilador entrega a regra crua; quem tem a view é quem sabe fechar a closure.
 *
 * O `id` é o que vai para o extrato, e é ele que responde "por que a minha hunt encerrou". Por
 * isso `hp-below` carrega o percentual no id: duas regras de HP com limites diferentes
 * precisam ser distinguíveis na tela de retorno.
 */
export function compileExitRules(rules: readonly BotExitRule[]): readonly HuntExitRule[] {
  return rules.map((rule) => {
    switch (rule.kind) {
      case 'hp-below': {
        const { percent } = rule;
        return {
          id: `hp-below-${percent}`,
          when: (view: HuntView) => {
            // Só o personagem desta sessão. Party é F3, e quando existir a pergunta vira "o
            // MEU HP", não "o de alguém" — por isso o primeiro participante, e não um `some`
            // que passaria a significar outra coisa sem ninguém mudar esta linha.
            const self = view.participants[0];
            if (self === undefined || !self.alive) return false;
            if (self.maxHealth <= 0) return false;
            return (self.health / self.maxHealth) * 100 < percent;
          },
        };
      }
      case 'out-of-gold':
        return {
          id: 'out-of-gold',
          when: (view: HuntView) => {
            const self = view.participants[0];
            // Saldo é o de entrada mais o delta (FUN-77). Zero é "acabou": com zero não dá
            // para comprar a poção mais barata, e esperar chegar a negativo seria esperar por
            // um estado que o débito recusa antes de criar.
            return self !== undefined && self.alive && balanceOf(self) <= 0;
          },
        };
      case 'party-member-lost':
        return {
          id: 'party-member-lost',
          when: (view: HuntView) => {
            // INERTE numa hunt de um, e por construção: o laço começa no segundo participante.
            // Quando party existir (F3), "saiu" some da lista e "morreu" fica com `alive`
            // falso — os dois casos que o §13.9 junta numa regra só.
            for (let i = 1; i < view.participants.length; i += 1) {
              if (!(view.participants[i] as CharacterRuntime).alive) return true;
            }
            return false;
          },
        };
    }
  });
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
  /** Catálogo de magias (FUN-74). Vazio é uma hunt em que nenhuma magia sai. */
  readonly spells: ReadonlyMap<string, Spell>;
  /** Catálogo de supplies (FUN-77). Vazio é uma hunt sem poção. */
  readonly supplies: ReadonlyMap<string, Supply>;
  /** Skills que sobem por uso (FUN-75). Vazio é uma hunt em que nada sobe por fazer. */
  readonly skills: ReadonlyMap<string, Skill>;
  readonly player: PlayerProfile;
  readonly exitRules?: readonly HuntExitRule[];
  /**
   * A configuração do bot, CRUA (FUN-73, FUN-80, FUN-81).
   *
   * **Uma porta de entrada só.** Houve um tempo em que dava para passar o bot já compilado, e
   * as duas formas divergiram na primeira oportunidade: quem entrava pelo compilado ficava sem
   * as regras de saída, porque elas são compostas a partir da configuração crua. Compilar aqui
   * dentro torna a divergência impossível de escrever.
   *
   * **Sem configuração não há evento nenhum agendado** — o custo de cinco eventos por segundo
   * por hunt só existe para quem configurou.
   */
  readonly botConfig?: BotConfig;
  /**
   * Substitui o atuador embutido (FUN-74/FUN-77).
   *
   * O padrão é a própria hunt: magia e supply são executados aqui, onde estão o alvo, o RNG da
   * sessão e o relógio lógico. Este campo sobrou como costura de teste — e para o dia em que
   * um ruleset quiser outra política sem reescrever o resto.
   */
  readonly actuator?: BotActuator;
  /** Cooldown de cada categoria, do conteúdo (§13.5: 1 s). Parâmetro, não constante. */
  readonly botCooldownMs?: number;
  /**
   * Até onde o bot ENXERGA ao decidir para onde andar (FUN-85), do conteúdo. Não é o alcance
   * de ataque: só importa com postura `follow` ou `keep-distance`.
   */
  readonly targetSearchRadius?: number;
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
  /** Ver `HuntRuleset.#warnedNoGold`. Ausente é `false`: snapshot anterior à FUN-77. */
  readonly warnedNoGold?: boolean;
  /**
   * Até que instante lógico a stamina já foi consumida.
   *
   * Precisa entrar no snapshot: sem ele, uma sessão retomada com quatro horas de hunt no
   * relógio lógico cobraria as quatro horas de novo no primeiro evento.
   */
  readonly staminaAnchorMs: number;
  /** Ver `HuntRuleset.#onPlayerAttack`. Ausente é `true`: engatilhado. */
  readonly playerAttackReady?: boolean;
  /**
   * Quais categorias do bot estão AGENDADAS (FUN-84).
   *
   * Precisa entrar no snapshot pela mesma razão que `playerAttackReady`: o evento pendente da
   * categoria está na fila serializada, e restaurar como "engatilhada" faria o próximo
   * `#armBot` agendar um segundo — ação dobrada, que é a invariante que este par protege.
   *
   * Ausente é "nenhuma agendada", que é o estado de um snapshot anterior a esta issue: lá não
   * havia evento de bot na fila para conflitar.
   */
  readonly botScheduled?: readonly BotCategory[];
  /**
   * A configuração do bot, CRUA (FUN-81).
   *
   * Crua e não compilada: `CompiledBot` é um vetor de closures, e closure não serializa. O
   * `restore` recompila, que é barato — é um `map` sobre poucas dezenas de regras.
   *
   * Precisa entrar no snapshot porque a sessão é a DONA da configuração enquanto roda: uma
   * edição feita no meio da hunt vale na hora, e ler o banco na retomada descartaria tudo o
   * que foi salvo depois do último `UPDATE`. O banco é a fonte para COMEÇAR uma hunt; o
   * snapshot é a fonte para CONTINUAR a que já estava rodando.
   *
   * Opcional: snapshot gravado antes desta issue não tem a chave, e ausente é "sem bot" — que
   * é exatamente o que aquelas sessões tinham.
   */
  readonly botConfig?: BotConfig;
}

export class HuntRuleset implements Ruleset {
  readonly type = 'hunt' as const;

  readonly #options: HuntRulesetOptions;
  /**
   * O bot vigente. MUTÁVEL, ao contrário do resto das opções: o jogador troca a configuração
   * no meio da hunt e ela passa a valer na hora (FUN-81, §13).
   */
  #bot: CompiledBot | undefined;
  /** A configuração crua correspondente, para o snapshot. Anda junto com `#bot`, sempre. */
  #botConfig: BotConfig | undefined;
  readonly #difficulty: HuntDifficulty;
  #exitRules: readonly HuntExitRule[];
  /**
   * As regras injetadas por quem montou o ruleset, separadas das do jogador.
   *
   * Precisam ficar guardadas à parte porque a lista efetiva é RECOMPOSTA três vezes — na
   * construção, na restauração e a cada troca de configuração — e sem separar não há como
   * recompor sem duplicar as injetadas ou perdê-las. Foi assim que a restauração passou a
   * voltar sem as regras de saída, e o teste de retomada pegou.
   */
  readonly #injectedExitRules: readonly HuntExitRule[];
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

  /**
   * Já avisou que o gold acabou? A notícia sai UMA vez, como a da stamina.
   *
   * §20.3 sem a regra de saída: o personagem FICA, não paga o supply e pode morrer. Isso é
   * comportamento, não erro — mas é o tipo de coisa que o jogador ausente precisa encontrar na
   * tela de retorno, senão a hunt que acabou em morte não tem explicação nenhuma.
   *
   * Uma vez, e não por recusa: a categoria de poção tenta a cada mudança do mundo, e uma linha
   * por tentativa encheria a lista curta até ela deixar de ser lista.
   */
  #warnedNoGold = false;

  /** Até que instante lógico a stamina já foi cobrada. Ver `#burnStamina`. */
  #staminaAnchorMs = 0;

  /** O golpe do personagem está engatilhado? Ver `#onPlayerAttack`. */
  #playerAttackReady = true;

  /**
   * Por categoria: `true` = ENGATILHADA (nenhum evento pendente), `false` = agendada.
   *
   * É a mesma invariante do `#playerAttackReady`, e pela mesma razão: uma categoria com
   * evento pendente **e** reavaliação imediata é ação dobrada. Concentrar o agendamento em
   * `#scheduleBot` é o que a torna impossível de escrever errado.
   *
   * Engatilhada é o estado de quem avaliou e não achou regra válida: em vez de queimar um
   * evento por segundo esperando o mundo mudar, ela dorme até `#armBot`. Um bot configurado
   * e sem nada a fazer custa ZERO.
   */
  readonly #botReady: Record<BotCategory, boolean> = {
    heal: true, potion: true, attack: true, rune: true, support: true,
  };

  /** A view do bot, reaproveitada (FUN-80): montar uma por avaliação é alocar por evento. */
  readonly #botView: BotView = {
    self: null as unknown as CharacterRuntime, targetCount: 0, target: null,
  };

  /**
   * O alvo de magia, reaproveitado pela mesma razão que `#botView`.
   *
   * Mutável de propósito: `castSpell` só lê, e quem escreve é `#castSpell`, num lugar só.
   */
  readonly #spellTarget: MutableSpellTarget = { armor: 0, dodgeChance: 0, distance: 0 };

  /**
   * Quem escreve posição. **A hunt não escreve nenhuma** desde a FUN-69 — ela pede.
   *
   * A ocupação de tiles mora lá dentro. Ela precisa ser remontada uma vez quando a sessão
   * nasce ou é restaurada, porque `restore` não enxerga os participantes — a `Session` só os
   * reconstrói depois. Daí a bandeira: remonta no primeiro evento, e mantém incremental dali
   * em diante, porque remontar a cada evento seriam dezenas de varreduras por segundo.
   */
  readonly #world: TileOccupancy;
  #occupancyStale = true;

  constructor(options: HuntRulesetOptions) {
    const difficulty = options.hunt.difficulties[options.difficulty];
    if (difficulty === undefined) {
      throw new Error(
        `hunt "${options.hunt.id}" não define a dificuldade "${options.difficulty}"`,
      );
    }
    this.#options = options;
    this.#botConfig = options.botConfig;
    this.#bot = options.botConfig === undefined ? undefined : compileBot(options.botConfig);
    this.#difficulty = difficulty;
    this.#injectedExitRules = options.exitRules ?? [];
    this.#exitRules = this.#composeExitRules(options.botConfig);
    this.#walker = new RouteWalker(options.route);
    this.#spawner = new Spawner(options.route.spawnPoints.length, difficulty);
    this.#world = new TileOccupancy(options.map);
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
    // A colocação passa pela MESMA legalidade que um passo (FUN-69). O primeiro tile da rota
    // é validado no carregamento do conteúdo (FUN-9), então uma recusa aqui é conteúdo
    // quebrado — e falhar alto é melhor que entrar dentro de uma parede.
    // A ocupação nasce com quem JÁ está no mundo desta instância — e o personagem que está
    // entrando não está. A posição que ele traz é da sessão anterior, num mapa que não é
    // este; contá-la aqui marcaria como ocupado um tile da hunt por uma coordenada de
    // cidade. Antes da FUN-72 isso era limpo por acidente, porque `place` liberava a origem.
    this.#world.reset(session.participants.filter((p) => p !== character));
    // A duração do passo vem do CONTEÚDO e é copiada para a criatura, como `maxHealth` é: o
    // sistema de movimento pergunta a quem anda, e quem anda não conhece o conteúdo.
    character.stepDurationMs = this.#options.player.stepDurationMs;
    const refused = place(this.#world, character, this.#walker.current);
    if (refused !== null) {
      throw new Error(
        `não dá para entrar na hunt "${this.#options.hunt.id}": o primeiro tile da rota ` +
          `(${this.#walker.current.x},${this.#walker.current.y}) foi recusado — ${refused}`,
      );
    }
    this.#occupancyStale = false;
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
    // Só categoria COM regra entra na fila (FUN-84). Um personagem sem bot configurado — que
    // é todo mundo até a FUN-81 — não agenda nada, e os cinco eventos por segundo que a issue
    // orça só existem para quem de fato configurou.
    this.#armBot(session, character.id);
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
      case BOT_EVENT.heal: return this.#onBot(session, 'heal', event.subject);
      case BOT_EVENT.potion: return this.#onBot(session, 'potion', event.subject);
      case BOT_EVENT.attack: return this.#onBot(session, 'attack', event.subject);
      case BOT_EVENT.rune: return this.#onBot(session, 'rune', event.subject);
      case BOT_EVENT.support: return this.#onBot(session, 'support', event.subject);
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

  /**
   * Uma criatura morreu (FUN-63): a CONSEQUÊNCIA de hunt. O pipeline já congelou os eventos
   * dela e já resolveu quem matou — aqui só se decide o que isso significa numa hunt.
   */
  onCreatureDied(session: Session, victim: Victim, credit: KillCredit): void {
    if (victim.kind === 'character') this.#onCharacterDied(session, victim.character);
    else this.#onMonsterDied(session, victim.monster, credit);
  }

  #onCharacterDied(session: Session, character: CharacterRuntime): void {
    this.#world.vacate(character.position.x, character.position.y);

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
      warnedNoGold: this.#warnedNoGold,
      staminaAnchorMs: this.#staminaAnchorMs,
      playerAttackReady: this.#playerAttackReady,
      botScheduled: BOT_CATEGORIES.filter((category) => !this.#botReady[category]),
      ...(this.#botConfig === undefined ? {} : { botConfig: this.#botConfig }),
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
    // Snapshot anterior à FUN-69 não traz a duração do passo; ela é do conteúdo, e repor
    // daqui é o que impede um monstro restaurado de andar com duração zero.
    for (const monster of this.#monsters) {
      if (monster.stepDurationMs > 0) continue;
      monster.stepDurationMs = this.#options.monsters.get(monster.monsterId)?.stepDurationMs ?? 0;
    }
    this.#monsterBySubject.clear();
    for (const monster of this.#monsters) {
      this.#monsterBySubject.set(monsterSubject(monster.id), monster);
    }
    this.#nextCreatureId = restored.nextCreatureId;
    this.#warnedExhausted = restored.warnedExhausted;
    this.#warnedNoGold = restored.warnedNoGold ?? false;
    this.#staminaAnchorMs = restored.staminaAnchorMs;
    this.#playerAttackReady = restored.playerAttackReady ?? true;
    for (const category of BOT_CATEGORIES) {
      this.#botReady[category] = !(restored.botScheduled ?? []).includes(category);
    }
    // A configuração volta CRUA e é recompilada aqui (FUN-81). Sem isto, uma hunt retomada
    // roda sem bot: continua andando e matando com o ataque básico, então nada PARECE
    // quebrado — o que some é a cura, e o jogador descobre pelo personagem morto.
    if (restored.botConfig !== undefined) {
      this.#botConfig = restored.botConfig;
      this.#bot = compileBot(restored.botConfig);
      // As regras de SAÍDA também. Esquecê-las aqui foi um defeito de verdade: a hunt voltava
      // curando de novo, mas sem a regra que a tirava de lá — e o jogador que configurou
      // "sair abaixo de 20%" descobriria pelo personagem morto.
      this.#exitRules = this.#composeExitRules(restored.botConfig);
    }
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
      this.#spawnBlocked,
      session.rng,
    );
    if (request === null) {
      // Lugar ocupado é caso normal (o monstro está vivo) e não pede reagendamento: quem
      // devolve o lugar é `#onMonsterDied`, e é ele que marca a próxima hora.
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
      stepDurationMs: definition.stepDurationMs,
      cooldowns: {},
    });
    this.#monsters.push(monster);
    this.#monsterBySubject.set(monsterSubject(monster.id), monster);
    // O tile já foi escolhido livre pelo spawner; `place` é quem o marca como ocupado, e é
    // ele que recusaria se algo tivesse mudado entre uma coisa e outra.
    place(this.#world, monster, request.position);
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
    if (this.#attackTarget(character) !== null) {
      this.#walker.stop();
      this.#armPlayerAttack(session);
      return;
    }

    // Ninguém ao alcance, e a postura pode mandar ele SAIR DA ROTA atrás do alvo (FUN-85).
    // Com `stand` — o padrão — isto não roda, e o comportamento é o de sempre.
    if (this.#holdPosture(session, character)) {
      this.#armPlayerAttack(session);
      return;
    }

    // Ninguém ao alcance: anda. Com postura `stand` o personagem NÃO persegue — ele percorre a
    // rota e deixa o monstro vir. É o que dispensa pathfinding dos dois lados (ADR 0009).
    this.#walker.resume();
    const to = this.#walker.step();
    if (to === null) return;
    const result = this.#step(session, character, to, character.id);
    if (!result.ok) {
      if (result.reason === 'not-adjacent') {
        // O personagem não está onde a rota acha que ele está — andou à mão (FUN-69) ou foi
        // empurrado. Reentrar pelo tile mais próximo, em vez de segurar um índice que nunca
        // mais vai ficar adjacente.
        this.#walker.rejoinNearest(character.position);
      } else {
        // Rota bloqueada por monstro é normal, e o walker precisa saber: sem `hold` o índice
        // avançaria e o personagem "pularia" o tile ocupado na volta seguinte.
        this.#walker.hold();
      }
    }
    this.#armPlayerAttack(session);
  }

  /**
   * A postura assume o passo, ou devolve `false` e a rota segue (FUN-85, §13.6).
   *
   * `true` significa "a postura decidiu o que fazer com este vencimento" — e isso inclui
   * DECIDIR FICAR PARADO. Um personagem já na distância que pediu não anda, e também não volta
   * a percorrer a rota: voltar seria ele oscilar entre manter distância e seguir o laço, que
   * de fora parece o bot travado.
   *
   * O passo sai pelo MESMO `#step` do monstro e do `walk` do socket — `movement.ts` é o único
   * escritor de posição (FUN-69), e a postura não é exceção. O walker fica parado enquanto
   * isso; quando o alvo morre, o vencimento seguinte cai na rota, o passo é recusado por
   * `not-adjacent` e `rejoinNearest` reentra pelo tile mais próximo. O caminho de volta já
   * existia, e é o mesmo de quem foi empurrado.
   */
  #holdPosture(session: Session, character: CharacterRuntime): boolean {
    const posture = this.#targeting.posture;
    if (posture.kind === 'stand') return false;

    const target = this.#approachTarget(character);
    if (target === null) return false;

    const from = character.position;
    const d = distance(from, target.position);
    const blocked = this.#blockedFor(character);
    // `follow` persegue até poder bater; `keep-distance` mira a distância configurada. Os dois
    // são o mesmo cálculo com alvos diferentes, e escrever dois laços seria a mesma geometria
    // divergindo na terceira mudança.
    const want = posture.kind === 'follow' ? this.#options.player.attackRange : posture.tiles;
    if (d === want) return true;

    const to = d > want
      ? greedyStep(from, target.position, blocked)
      : fleeStep(from, target.position, blocked);
    // Empacado — cercado, ou contra a parede recuando. Esperar é o comportamento certo, e é o
    // mesmo que o passo guloso do monstro já faz (ADR 0009).
    if (to === null) return true;

    this.#walker.stop();
    this.#step(session, character, { ...to, z: from.z }, character.id);
    return true;
  }

  /**
   * O jogador salvou uma configuração nova no meio da hunt (FUN-81, §13).
   *
   * Recompila e passa a valer NA HORA. Esperar a próxima hunt seria o jogador corrigir a regra
   * de cura enquanto o personagem morre — e a configuração é dado puro, então recompilar não
   * tem risco nenhum.
   *
   * Quem chama é a sessão dona, nunca outro processo (invariante 9). As regras de saída são
   * recompiladas junto: elas vêm da mesma configuração, e deixar as antigas valendo faria a
   * hunt encerrar por uma regra que o jogador acabou de apagar.
   */
  configureBot(session: Session, config: BotConfig): void {
    this.#botConfig = config;
    this.#bot = compileBot(config);
    this.#exitRules = this.#composeExitRules(config);
    // Categoria que ganhou regra agora precisa acordar. `#armBot` só toca as ENGATILHADAS, e
    // as que já tinham evento pendente seguem com ele — a invariante "engatilhada ou agendada"
    // continua valendo do outro lado de uma troca de configuração.
    for (const character of session.participants) {
      if (character.alive) this.#armBot(session, character.id);
    }
  }

  /**
   * Um jogador pediu para andar (FUN-69). Mesmo caminho do bot, mesma razão de recusa.
   *
   * Não mexe no walker: se o passo tirou o personagem da rota, o vencimento seguinte de
   * `PLAYER_STEP` descobre e reentra pelo tile mais próximo.
   */
  requestMove(session: Session, characterId: string, to: GridPoint): MoveResult {
    const character = findById(session.participants, characterId);
    if (character === null) return { ok: false, reason: 'tile-blocked' };
    if (this.#occupancyStale) this.#rebuildOccupancy(session);
    return this.#step(session, character, { ...to, z: character.position.z }, characterId);
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

    const target = this.#attackTarget(character);
    if (target === null) {
      this.#playerAttackReady = true;
      return;
    }

    this.#schedulePlayerAttack(session, characterId, this.#options.player.attackIntervalMs);
    this.#strike(session, character, target);
    // Quem aplica dano não decide morte: o pipeline resolve quem matou e devolve a
    // consequência a `onCreatureDied`, o mesmo caminho da morte do personagem.
    if (!target.alive) resolveDeath(session, { kind: 'monster', monster: target });
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
  /**
   * Uma categoria venceu: avalia os slots de cima para baixo e executa a primeira válida
   * (§13.4). As demais daquela categoria não rodam neste ciclo.
   *
   * O reagendamento depende do que aconteceu, e a distinção importa:
   *
   * - **executou** → volta no cooldown da categoria. É o rate limit do §13.5, e ele conta a
   *   partir da AÇÃO, não do relógio de parede;
   * - **nenhuma regra valeu, ou o atuador recusou** → ENGATILHA. Não custa evento nenhum até
   *   o mundo mudar. Uma categoria que reagenda no vazio é cinco eventos por segundo por
   *   personagem gastos para descobrir que não há nada a fazer.
   *
   * Atuador que recusa (sem mana, sem supply) NÃO consome o cooldown: seria o bot parando um
   * segundo por ter tentado curar sem ter com quê.
   */
  #onBot(session: Session, category: BotCategory, characterId: string): void {
    this.#botReady[category] = true;
    const bot = this.#bot;
    const character = findById(session.participants, characterId);
    if (bot === undefined || character === null || !character.alive) return;

    const action = bot.select(category, this.#botViewOf(character));
    if (action === null) return;

    const external = this.#options.actuator;
    if (external !== undefined) {
      if (!external.perform(action, this.#botView)) return;
      this.#scheduleBot(session, category, characterId, this.#botCooldownMs());
      return;
    }

    const result = this.#perform(session, character, action);
    if (result.ok) {
      this.#scheduleBot(session, category, characterId, this.#botCooldownMs());
      // A ação mudou HP, mana ou gold: o que está engatilhado reavalia AGORA, sobre o mundo
      // já resolvido. Uma poção de mana que não acorda a cura é o bot esperando dano novo
      // para usar a mana que acabou de repor.
      this.#armBot(session, characterId);
      return;
    }
    // Recusa por COOLDOWN volta no vencimento dele; as outras engatilham.
    //
    // A distinção não é detalhe. Uma categoria engatilhada só acorda quando o mundo muda, e
    // "o mundo mudar" pode simplesmente não acontecer: o personagem com a cura em cooldown,
    // parado, sem levar dano, ficaria sem curar até alguém bater nele de novo. As outras
    // recusas são o oposto — sem mana e sem gold não melhoram com o tempo passar, e reagendar
    // por elas seria um evento por segundo para redescobrir a mesma falta.
    if (result.retryInMs > 0) {
      this.#scheduleBot(session, category, characterId, result.retryInMs);
    }
  }

  /**
   * Executa a ação escolhida pelo bot (FUN-74, FUN-77).
   *
   * É o `BotActuator` embutido, e mora aqui — e não numa classe à parte — porque tudo o que
   * ele precisa é da hunt: o alvo mais próximo, o RNG semeado da sessão, o relógio lógico e o
   * pipeline de morte. Uma classe separada receberia os quatro por parâmetro e não ganharia
   * nada em troca.
   */
  #perform(session: Session, character: CharacterRuntime, action: BotAction): CastResult {
    switch (action.kind) {
      case 'spell': return this.#castSpell(session, character, action.spellId);
      case 'supply': return this.#useSupply(session, character, action.supplyId);
      // Catálogo de ITEM é M8. `validateBotConfig` já recusa a regra na entrada; aqui a
      // resposta é não fazer nada, que é o que "sem catálogo" significa.
      case 'item': return NOT_IN_CATALOG;
    }
  }

  /**
   * Lança a magia. O alvo é o mesmo do golpe — o monstro mais próximo —, e o alcance é o da
   * MAGIA, não o da arma: uma magia de alcance 3 alcança de onde o corpo a corpo não alcança.
   */
  #castSpell(session: Session, character: CharacterRuntime, spellId: string): CastResult {
    const spell = this.#options.spells.get(spellId);
    if (spell === undefined) return NOT_IN_CATALOG;

    let monster: MonsterRuntime | null = null;
    let target: SpellTarget | null = null;
    if (spell.effect.kind === 'damage') {
      monster = this.#attackTarget(character);
      if (monster !== null) {
        // Monstro não esquiva do jogador — é a mesma regra do `#strike`, e ela vale igual
        // para magia. Escrever `0` aqui e lá é o mesmo dado em dois lugares; quando esquiva
        // de monstro existir, vem do conteúdo e os dois leem do mesmo campo.
        this.#spellTarget.armor = this.#options.monsters.get(monster.monsterId)?.armor ?? 0;
        this.#spellTarget.dodgeChance = 0;
        this.#spellTarget.distance = distance(character.position, monster.position);
        target = this.#spellTarget;
      }
    }

    const result = castSpell(
      character, spell, target, session.nowMs, this.#options.combat, session.rng,
      // A skill de magia escala o poder, como a de arma escala o golpe (FUN-75).
      this.#scaledPower(character, 'spell-cast', 1),
    );
    // A magia SAIU: a mana gasta é o que ela rende de skill (§9.4). Recusa não rende nada —
    // não gastou mana, não praticou.
    if (result.ok) this.#gainSkills(session, character, 'spell-cast', spell.manaCost);
    if (!result.ok || monster === null) return result;

    // Aplicar é também ATRIBUIR: o dano de magia conta para quem matou, como o do golpe.
    recordDamage(monster.contribution, character.id, monster.receiveDamage(result.damage));
    if (!monster.alive) resolveDeath(session, { kind: 'monster', monster });
    return result;
  }

  /** Usa o supply e leva o gasto ao extrato. O débito em si é do `useSupply`. */
  #useSupply(session: Session, character: CharacterRuntime, supplyId: string): CastResult {
    const supply = this.#options.supplies.get(supplyId);
    if (supply === undefined) return NOT_IN_CATALOG;

    const result = useSupply(character, supply);
    if (result.ok) {
      // Gold gasto é agregado da SESSÃO, como `goldGained` é no abate: o extrato leva os dois
      // ao ledger, e o personagem só carrega o delta.
      session.aggregates.goldSpent += result.goldSpent;
      return result;
    }

    // §20.3 sem a regra de saída: a hunt CONTINUA, sem poção, e o personagem pode morrer. Vale
    // a linha no extrato pela mesma razão que a stamina zerada vale: descobrir isso só pelo
    // personagem morto é como o modo idle perde a confiança de quem o deixou rendendo.
    if (!this.#warnedNoGold) {
      this.#warnedNoGold = true;
      session.record('supply-unaffordable', supply.id);
    }
    return result;
  }

  /**
   * Reavalia agora o que está engatilhado (FUN-84).
   *
   * O mundo mudou de um jeito que pode tornar uma regra válida — o personagem levou dano, um
   * alvo entrou no alcance. Esperar o próximo múltiplo de um relógio para curar quem está
   * caindo é a mesma perda que o golpe engatilhado da FUN-68 corrigiu do outro lado.
   *
   * Só toca categoria ENGATILHADA: quem tem evento pendente já vai vencer, e agendar de novo
   * seria a ação dobrada.
   */
  #armBot(session: Session, characterId: string): void {
    const bot = this.#bot;
    if (bot === undefined) return;
    for (const category of BOT_CATEGORIES) {
      if (!this.#botReady[category]) continue;
      if ((bot.categories.get(category)?.length ?? 0) === 0) continue;
      this.#scheduleBot(session, category, characterId, 0);
    }
  }

  /** O ÚNICO lugar que agenda categoria. É o que torna "engatilhada ou agendada" verdade. */
  #scheduleBot(
    session: Session, category: BotCategory, characterId: string, delayMs: number,
  ): void {
    this.#botReady[category] = false;
    session.scheduleIn(BOT_EVENT[category], delayMs, {
      // Depois do movimento e do ataque: o bot decide sobre o mundo já resolvido do instante.
      priority: EventPriority.Housekeeping, subject: characterId,
    });
  }

  /**
   * A lista efetiva: as do JOGADOR primeiro, as injetadas depois.
   *
   * A ordem decide qual `id` vai para o extrato quando duas valem no mesmo instante, e a do
   * jogador é a que ele consegue explicar — `exitRules` é costura de teste e do dia em que a
   * hunt tiver regra própria.
   */
  #composeExitRules(config: BotConfig | undefined): readonly HuntExitRule[] {
    if (config === undefined) return this.#injectedExitRules;
    return [...compileExitRules(config.exit), ...this.#injectedExitRules];
  }

  #botCooldownMs(): number {
    return this.#options.botCooldownMs ?? 1_000;
  }

  /** A política do jogador, ou a de sempre: mais próximo, sem preferência, sem sair da rota. */
  get #targeting(): Targeting {
    return this.#bot?.targeting ?? DEFAULT_TARGETING;
  }

  /** A view REAPROVEITADA: campos reescritos, objeto nunca recriado (FUN-80). */
  #botViewOf(character: CharacterRuntime): BotView {
    const target = this.#attackTarget(character);
    this.#botView.self = character;
    this.#botView.targetCount = this.#targetsInReach(character);
    this.#botView.target = target === null
      ? null
      : { health: target.health, maxHealth: this.#maxHealthOf(target) };
    return this.#botView;
  }

  #maxHealthOf(monster: MonsterRuntime): number {
    return this.#options.monsters.get(monster.monsterId)?.health ?? monster.health;
  }

  /**
   * Quantos alvos ao alcance. O NÚMERO, sem materializar a lista (FUN-80).
   *
   * Monstro IGNORADO não conta (FUN-85): "3 ou mais alvos → onda" disparando por causa de
   * quem o jogador mandou o bot deixar em paz é a regra reagindo ao que ela não vai atingir.
   */
  #targetsInReach(character: CharacterRuntime): number {
    return countTargets(
      this.#targeting, this.#monsters, character.position, this.#options.player.attackRange,
    );
  }

  #armPlayerAttack(session: Session): void {
    if (!this.#playerAttackReady) return;
    for (const character of session.participants) {
      if (!character.alive) continue;
      if (this.#attackTarget(character) === null) continue;
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
    const action = decideMonsterAction(monster, target, definition, this.#blockedFor(monster));

    if (which === 'step') {
      // O passo reagenda sempre: um monstro parado precisa continuar acordando para descobrir
      // que o alvo se mexeu. É a única cadência que roda mesmo sem nada a fazer.
      session.scheduleIn(MONSTER_STEP, definition.stepDurationMs, {
        priority: EventPriority.Movement, subject,
      });
      if (action.kind === 'step') this.#step(session, monster, action.to, subject);
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
    recordDamage(character.contribution, subject, character.receiveDamage(result.damage));
    // HP caiu: reavalia AGORA o que está engatilhado (FUN-84). Esperar o próximo múltiplo de
    // um relógio para curar quem está caindo é a mesma perda que o golpe engatilhado da
    // FUN-68 corrigiu do outro lado — só que aqui ela custa a vida do personagem.
    this.#armBot(session, character.id);
    if (character.health > 0) return;

    // `receiveDamage` já marcou `alive = false`; `kill` é o que conta a morte no extrato e
    // avisa o ruleset. Chamar os dois é deliberado: quem aplica dano não decide morte.
    session.kill(character);
  }

  /**
   * Pede um passo e emite o que voltou.
   *
   * É por aqui que TODO passo da hunt passa — bot, monstro e o `walk` do socket. Uma recusa
   * não é erro: o tile pode estar ocupado agora, e ficar parado até o vencimento seguinte é o
   * mesmo que o passo guloso já fazia ao empacar (ADR 0009).
   */
  #step<P extends GridPoint>(
    session: Session, mover: Movable<P>, to: P, creatureId: string,
  ): MoveResult {
    const result = move(this.#world, mover, to);
    if (result.ok) {
      session.emit({
        kind: 'creature-moved', creatureId,
        from: result.from, to: result.to, durationMs: result.durationMs,
      });
    }
    return result;
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
      // A skill escala o poder do golpe (FUN-75). O número base continua sendo do conteúdo;
      // o que a skill faz é multiplicá-lo, e quanto por nível também é conteúdo.
      { power: this.#scaledPower(character, 'melee-hit', this.#options.player.attackPower),
        kind: 'melee' },
      { armor: definition.armor, dodgeChance: 0 },
      'pve',
      this.#options.combat,
      session.rng,
    );
    recordDamage(monster.contribution, character.id, monster.receiveDamage(result.damage));
    // O golpe ACONTECEU: conta como uso, tenha ele acertado forte ou de raspão. Contar só
    // acerto cheio faria a skill subir mais devagar contra alvo blindado, que é o oposto do
    // que "sobe pelo uso" quer dizer.
    this.#gainSkills(session, character, 'melee-hit', 1);
  }

  /**
   * O poder já escalado pelas skills que alimentam esta fonte.
   *
   * Percorre o catálogo em vez de procurar uma skill por nome: quais skills existem e o que
   * alimenta cada uma é DADO (§9.4), e um `'melee'` escrito aqui faria o motor conhecer o
   * nome de uma skill que o conteúdo pode renomear.
   */
  #scaledPower(character: CharacterRuntime, on: Skill['gain']['on'], base: number): number {
    let power = base;
    for (const definition of this.#options.skills.values()) {
      if (definition.gain.on !== on || definition.damagePerLevel === 0) continue;
      power *= powerMultiplier(definition, character.skills.levelOf(definition));
    }
    return Math.round(power);
  }

  /**
   * Credita uso a toda skill alimentada por esta fonte.
   *
   * `amount` é o que a fonte rende: um golpe é um golpe; uma magia rende a MANA que gastou
   * (§9.4, modelo do Tibia). Sem isso, a forma ótima de subir magia seria lançar mil vezes a
   * magia mais barata, e o jogo viraria macro de spam.
   *
   * Subir de nível é evento notável: numa hunt de oito horas é uma das poucas coisas que o
   * jogador quer ver ao voltar, ao lado do level up (§16.2).
   */
  #gainSkills(
    session: Session, character: CharacterRuntime, on: Skill['gain']['on'], amount: number,
  ): void {
    if (amount <= 0) return;
    for (const definition of this.#options.skills.values()) {
      const gain = definition.gain;
      if (gain.on !== on) continue;
      const points = gain.on === 'melee-hit' ? gain.points * amount : gain.pointsPerMana * amount;
      if (character.skills.gain(definition, points) > 0) {
        session.record('skill-up', `${definition.id}/${character.skills.levelOf(definition)}`);
      }
    }
  }

  /**
   * O monstro morreu: conta o abate, recompensa quem matou e devolve o lugar ao spawner.
   *
   * A recompensa vai ao ÚLTIMO GOLPE (DT-03). A atribuição inteira fica guardada em
   * `credit.damageByActor`; a divisão entre participantes é regra de produto e entra com
   * party — os dados já vão estar lá.
   */
  #onMonsterDied(session: Session, monster: MonsterRuntime, credit: KillCredit): void {
    session.aggregates.kills++;
    const definition = this.#options.monsters.get(monster.monsterId);
    const killer = findById(session.participants, credit.lastHitBy);

    // Sem dono (dano de fonte que sumiu) ou dono morto antes da vítima: o abate conta, a
    // recompensa não — morto não recebe. Stamina zero bloqueia a RECOMPENSA, não a hunt
    // (§10.2), e vale para loot E para XP. O abate continua contando em todos os casos: o
    // jogador matou, e o extrato mentiria se dissesse que não.
    if (definition !== undefined && killer !== null && killer.alive && !isExhausted(killer)) {
      // Gold vira DELTA no personagem e agregado na sessão. O extrato leva os dois ao ledger
      // (invariante 10) — nada aqui escreve banco, e nada aqui inventa saldo final.
      const loot = rollLoot(definition.loot, session.rng);
      killer.goldDelta += loot.gold;
      session.aggregates.goldGained += loot.gold;

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
    this.#world.vacate(monster.position.x, monster.position.y);
    // Os eventos dele já saíram da fila: congelar é o primeiro estágio do pipeline. Aqui só
    // se tira o monstro dos índices desta instância — e da atribuição de quem ele bateu, senão
    // o mapa do personagem cresce uma chave por respawn até o fim da hunt.
    const subject = monster.subject;
    for (const character of session.participants) forgetActor(character.contribution, subject);
    this.#monsterBySubject.delete(subject);
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

  /**
   * Em quem bater AGORA: o melhor alvo dentro do alcance da arma (FUN-85).
   *
   * Era `#nearestMonster`, e a política era o motor. Agora ela vem da configuração — e
   * `nearest` continua sendo o padrão, então uma hunt sem bot se comporta exatamente como
   * antes. O desempate segue estável, e é `selectTarget` que o garante.
   */
  #attackTarget(character: CharacterRuntime): MonsterRuntime | null {
    return selectTarget(
      this.#targeting, this.#monsters, character.position, this.#options.player.attackRange,
    );
  }

  /**
   * Atrás de quem ANDAR: o melhor alvo dentro do raio de visão.
   *
   * Só é consultado quando a postura não é `stand`. Separar dos dois é o que destravou esta
   * issue: enquanto a busca parava no alcance da arma, "seguir o alvo" não tinha como ser
   * expresso — quem já está ao alcance não precisa ser seguido.
   */
  #approachTarget(character: CharacterRuntime): MonsterRuntime | null {
    return selectTarget(
      this.#targeting, this.#monsters, character.position, this.#options.targetSearchRadius ?? 8,
    );
  }

  // --- ocupação -----------------------------------------------------------------------------

  /**
   * Os predicados `Blocked` que o passo guloso e o spawner consomem, derivados de `canOccupy`
   * — uma fonte de verdade, dois formatos.
   *
   * UMA closure, reaproveitada, com o mover num campo e um ponto de sondagem mutado no lugar,
   * e não uma closure nova (nem um `{ x, y }` novo) por chamada. Parece detalhe e não é: isto
   * roda até três vezes por passo de cada monstro, e com 5.000 instâncias uma alocação aqui é
   * o coletor rodando o tempo todo. Só é seguro porque ninguém guarda o predicado — ele é
   * usado e descartado dentro da mesma chamada.
   */
  #mover: Movable<GridPoint> | null = null;
  readonly #probe = { x: 0, y: 0 };

  readonly #moverBlocked: Blocked = (x, y) => {
    this.#probe.x = x;
    this.#probe.y = y;
    return canOccupy(this.#world, this.#mover as Movable<GridPoint>, this.#probe) !== null;
  };

  #blockedFor(mover: Movable<GridPoint>): Blocked {
    this.#mover = mover;
    return this.#moverBlocked;
  }

  /** Para o spawn não há quem se mova: só parede e ocupação. */
  readonly #spawnBlocked: Blocked = (x, y) =>
    isBlocked(this.#options.map, x, y) || this.#world.occupied(x, y);

  /**
   * Remonta a ocupação do zero. Chamado UMA vez, no primeiro evento depois de a sessão nascer
   * ou ser restaurada — dali em diante `move` e `place` a mantêm incremental.
   */
  #rebuildOccupancy(session: Session): void {
    this.#occupancyStale = false;
    this.#world.reset([...this.#monsters, ...session.participants]);
  }
}

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
  /** A configuração do bot, crua. Ver `HuntRulesetOptions.botConfig`. */
  readonly botConfig?: BotConfig;
  /** Substitui o atuador embutido. Ver `HuntRulesetOptions.actuator`. */
  readonly actuator?: BotActuator;
}

export class HuntUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HuntUnavailableError';
  }
}

/** Monta o ruleset com tudo o que a hunt escolhida precisa. Lança quando falta alguma peça. */
/**
 * O que não é conteúdo nem identidade da hunt. Objeto, e não posicionais (FUN-84): já eram
 * cinco parâmetros, e o bot traria o sétimo — a essa altura a chamada vira uma fila de
 * `undefined` no meio para alcançar o último.
 */
export interface HuntRulesetExtras {
  readonly exitRules?: readonly HuntExitRule[];
  readonly premium?: boolean;
  /** A configuração do bot, crua. Ver `HuntRulesetOptions.botConfig`. */
  readonly botConfig?: BotConfig;
  /** Substitui o atuador embutido. Ver `HuntRulesetOptions.actuator`. */
  readonly actuator?: BotActuator;
}

export function createHuntRuleset(
  content: Content,
  huntId: string,
  difficulty: HuntDifficultyName,
  extras: HuntRulesetExtras = {},
): HuntRuleset {
  const { premium, botConfig, exitRules, actuator } = extras;
  // A configuração passa CRUA para o ruleset, e ele compila. Compilar aqui criaria uma segunda
  // forma de entrar — e as regras de saída, que saem da mesma configuração, ficariam de fora
  // de quem entrasse pela outra. Já aconteceu.
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
    skills: content.skills,
    targetSearchRadius: content.bot.targetSearchRadius,
    spells: content.spells,
    supplies: content.supplies,
    player: { ...content.combat.player, stepDurationMs: content.progression.stepDurationMs },
    ...(exitRules === undefined ? {} : { exitRules }),
    ...(premium === undefined ? {} : { premium }),
    ...(botConfig === undefined ? {} : { botConfig }),
    ...(actuator === undefined ? {} : { actuator }),
    // O cooldown de categoria vem do CONTEÚDO (§13.5), como todo parâmetro de balanceamento.
    botCooldownMs: content.bot.categoryCooldownMs,
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
    ruleset: createHuntRuleset(options.content, options.huntId, options.difficulty, {
      ...(options.exitRules === undefined ? {} : { exitRules: options.exitRules }),
      ...(options.premium === undefined ? {} : { premium: options.premium }),
      ...(options.botConfig === undefined ? {} : { botConfig: options.botConfig }),
      ...(options.actuator === undefined ? {} : { actuator: options.actuator }),
    }),
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
    // Sem `extras`: o bot volta do próprio estado do ruleset, em `restore`, e não daqui. Quem
    // monta o ruleset não conhece o snapshot inteiro — só a hunt e a dificuldade, que são a
    // IDENTIDADE da instância. O resto é estado, e estado é assunto de `restore`.
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
